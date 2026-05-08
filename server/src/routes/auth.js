const router    = require('express').Router()
const rateLimit = require('express-rate-limit')
const bcrypt    = require('bcryptjs')
const jwt       = require('jsonwebtoken')
const crypto    = require('crypto')
const db        = require('../db')
const { generateUniqueHandle } = require('../lib/handle')
const {
  USER_PUBLIC_COLUMNS,
  USER_PUBLIC_COLUMNS_WITH_PIN_HASH,
  sanitizeUser,
} = require('../lib/user')

function mintToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '90d' })
}

// 5 login/signup attempts per IP per minute. Real burst protection against
// brute-forcing the 4-digit PIN (10,000 combinations is otherwise feasible
// to enumerate in hours). Vercel serverless functions reset state per cold
// start, so this is in-memory phase-1 protection — phase 2 (later) should
// move to a Postgres-backed or Redis-backed store. Audit B5 / 2026-04-29.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a minute.' },
})

// POST /api/auth/signup
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email, name, pin, ref } = req.body
    if (!email || !name || !pin) return res.status(400).json({ error: 'email, name, and pin required' })
    if (!/^\d{4}$/.test(pin))   return res.status(400).json({ error: 'PIN must be 4 digits' })

    // db.one returns null when no row — safe to use as existence check
    const exists = await db.one('SELECT id FROM tm_users WHERE email = $1', [email.toLowerCase()])
    if (exists) return res.status(409).json({ error: 'Email already registered' })

    const hash = await bcrypt.hash(pin, 10)
    // Auto-generate a unique handle from name + email. Mirrors the
    // backfill in migration 014. (2026-05-01 — Matt)
    const handle = await generateUniqueHandle(name, email, db)
    const user = await db.one(
      `INSERT INTO tm_users (email, name, pin_hash, handle) VALUES ($1, $2, $3, $4)
       RETURNING ${USER_PUBLIC_COLUMNS}`,
      [email.toLowerCase(), name.trim(), hash, handle]
    )

    // If a referral code was supplied, record the referral and credit
    // the new user with their 7-day Elite trial. Failure is non-blocking
    // — a bad ref code or DB hiccup shouldn't fail the signup itself.
    // (2026-05-07 PM3 — referral program v1.)
    if (ref) {
      try {
        const { recordSignupReferral } = require('../lib/referrals')
        await recordSignupReferral(user.id, ref)
      } catch (refErr) {
        console.warn('[signup] referral record failed (non-blocking):', refErr.message)
      }
    }

    res.status(201).json({ token: mintToken(user.id), user })
  } catch (err) {
    console.error('[signup]', err.message)
    res.status(500).json({ error: 'Signup failed. Please try again.' })
  }
})

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, pin } = req.body
    if (!email || !pin) return res.status(400).json({ error: 'email and pin required' })

    const user = await db.one(
      `SELECT ${USER_PUBLIC_COLUMNS_WITH_PIN_HASH} FROM tm_users WHERE email = $1`,
      [email.toLowerCase()]
    )
    if (!user) return res.status(401).json({ error: 'Invalid email or PIN' })

    const ok = await bcrypt.compare(pin, user.pin_hash)
    if (!ok)  return res.status(401).json({ error: 'Invalid email or PIN' })

    res.json({ token: mintToken(user.id), user: sanitizeUser(user) })
  } catch (err) {
    console.error('[login]', err.message)
    res.status(500).json({ error: 'Login failed. Please try again.' })
  }
})

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { sub } = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    const user = await db.one(
      `SELECT ${USER_PUBLIC_COLUMNS} FROM tm_users WHERE id = $1`,
      [sub]
    )
    if (!user) return res.status(401).json({ error: 'Not found' })
    res.json({ user })
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
})

// DELETE /api/auth/me
//
// Hard-delete the authenticated user's account. App Store / Google Play
// submission requires this — users must be able to delete their account
// from inside the app. (POST-LAUNCH-TODO #11 → audit-2026-05-07 bug #1
// paired with the no-logout finding.)
//
// FK chain handled automatically:
//   CASCADE → tm_rounds, tm_outing_participants, tm_friends, tm_follows,
//             tm_achievements, tm_user_clubs, tm_push_subscriptions,
//             tm_availability, tm_club_stats, tm_h2h_records,
//             tm_league_members, tm_leagues, tm_game_participants,
//             tm_games, tm_tee_time_requests, tm_user_seasons,
//             tm_verification_codes
//   SET NULL → tm_outings.host_id, tm_outing_messages.user_id,
//              tm_outing_side_bets.created_by, tm_score_audit.edited_by_id,
//              tm_match_history.winner_id/loser_id (preserve historical
//              record, anonymize the link).
//
// Migration 024 added the SET NULL behavior for host_id + edited_by_id,
// which previously had ON DELETE NO ACTION and would have refused the
// delete for any user who had hosted an outing.
//
// Server-side typed-confirm guard requires `confirm: "DELETE"` in the
// request body — the client modal enforces it too but we don't trust the
// client to be the only gate.
router.delete('/me', async (req, res) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  let userId
  try {
    const { sub } = jwt.verify(header.slice(7), process.env.JWT_SECRET)
    userId = sub
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
  if (req.body?.confirm !== 'DELETE') {
    return res.status(400).json({ error: 'Confirmation required: send { confirm: "DELETE" } in the request body.' })
  }
  try {
    const result = await db.query('DELETE FROM tm_users WHERE id = $1 RETURNING id', [userId])
    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' })
    }
    console.log(`[auth/me DELETE] hard-deleted user_id=${userId}`)
    return res.json({ deleted: true })
  } catch (err) {
    console.error('[auth/me DELETE]', err.message)
    return res.status(500).json({ error: 'Account deletion failed. Please contact support.' })
  }
})

// ── Forgot-PIN flow ────────────────────────────────────────────────────────
//
// Migration 025 introduced tm_pin_reset_tokens. The flow:
//
//   1. POST /api/auth/forgot-pin { email }
//      - Always returns 200 (security: never reveal which emails are
//        registered). If the email IS registered, generates a token,
//        stores it in tm_pin_reset_tokens with 30min expiry, and emails
//        the user a reset link with ?reset=<token>.
//
//   2. POST /api/auth/reset-pin { token, pin }
//      - Looks up unconsumed + unexpired token, replaces the user's
//        pin_hash with bcrypt(new_pin), marks consumed_at = NOW().
//        Returns the user's tier/role so the client can drop them
//        directly into the app (or just back to login).
//
// EMAIL DELIVERY IS CURRENTLY STUBBED — when a Resend / SendGrid /
// Postmark / SES key is added to env vars, replace the console.log
// inside sendResetEmail with the provider call. Until then, the token
// is created and the link is logged so the dev/admin can copy it
// from server logs to test the reset path. This means the front-door
// "Forgot PIN?" link IS functional in dev (check Vercel function logs)
// but does not actually email a real user yet.
//
// Audit-2026-05-07 medium bug #5.

// 3 forgot-pin requests per IP per minute. Generous enough to handle
// "user typo'd email twice" but tight enough to prevent enumeration
// attacks (someone scraping which emails are registered by triggering
// the same flow many times — though the 200-on-everything response
// already mitigates that primary attack).
const forgotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reset requests. Try again in a minute.' },
})

async function sendResetEmail(toEmail, resetUrl) {
  // TODO: replace with provider call once an email key is in env.
  // Suggested: Resend (https://resend.com) — free tier 100/day, simple API.
  //   const { Resend } = require('resend')
  //   const resend = new Resend(process.env.RESEND_API_KEY)
  //   await resend.emails.send({
  //     from: 'The Match <hello@thematch.app>',
  //     to: [toEmail],
  //     subject: 'Reset your PIN',
  //     html: `<p>Tap below to reset your PIN. Link expires in 30 minutes.</p>
  //            <p><a href="${resetUrl}">Reset PIN</a></p>
  //            <p>If you didn't request this, ignore this email.</p>`,
  //   })
  console.log(`[forgot-pin] STUB: would email ${toEmail} with ${resetUrl}`)
}

router.post('/forgot-pin', forgotLimiter, async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase()
    if (!email) return res.status(400).json({ error: 'email required' })

    // Look up the user — if not found, still return 200 to avoid email
    // enumeration. The work below only runs if a user exists.
    const user = await db.one('SELECT id, email FROM tm_users WHERE email = $1', [email])
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url')
      // 30-minute expiry. Long enough that a slow email pipeline isn't
      // the failure mode; short enough that a stolen reset link in a
      // shared inbox doesn't sit live for days.
      await db.query(
        `INSERT INTO tm_pin_reset_tokens (user_id, token, expires_at, request_ip)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes', $3)`,
        [user.id, token, req.ip || null]
      )
      const base = process.env.APP_BASE_URL || `https://${req.headers.host || 'the-match-roan.vercel.app'}`
      const resetUrl = `${base}/?reset=${token}`
      await sendResetEmail(user.email, resetUrl)
    }
    // Always 200 — uniform timing isn't perfect (we do an extra DB write
    // for real users) but the response shape is identical so a client-side
    // attacker can't tell whether the email exists from the response alone.
    return res.json({ ok: true })
  } catch (err) {
    console.error('[forgot-pin]', err.message)
    // Even on internal error, return 200 to keep the security property.
    // The error gets logged for ops to investigate.
    return res.json({ ok: true })
  }
})

router.post('/reset-pin', authLimiter, async (req, res) => {
  try {
    const { token, pin } = req.body || {}
    if (!token || !pin) return res.status(400).json({ error: 'token and pin required' })
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' })

    const row = await db.one(
      `SELECT id, user_id FROM tm_pin_reset_tokens
        WHERE token = $1 AND consumed_at IS NULL AND expires_at > NOW()
        LIMIT 1`,
      [token]
    )
    if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired.' })

    const pin_hash = await bcrypt.hash(pin, 10)

    // Atomic-ish: mark the token consumed AND update the PIN. If something
    // fails between, the token is consumed (one-shot, no replay) but the
    // PIN didn't change — the user can request a new link. Acceptable.
    await db.query('UPDATE tm_pin_reset_tokens SET consumed_at = NOW() WHERE id = $1', [row.id])
    await db.query('UPDATE tm_users SET pin_hash = $1 WHERE id = $2', [pin_hash, row.user_id])

    const user = await db.one(
      `SELECT ${USER_PUBLIC_COLUMNS} FROM tm_users WHERE id = $1`,
      [row.user_id]
    )
    return res.json({ token: mintToken(user.id), user })
  } catch (err) {
    console.error('[reset-pin]', err.message)
    return res.status(500).json({ error: 'Reset failed. Please request a new reset link.' })
  }
})

module.exports = router
