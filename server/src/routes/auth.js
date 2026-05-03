const router    = require('express').Router()
const rateLimit = require('express-rate-limit')
const bcrypt    = require('bcryptjs')
const jwt       = require('jsonwebtoken')
const db        = require('../db')
const { generateUniqueHandle } = require('../lib/handle')
const { sendVerificationCode } = require('../lib/email')

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

// Tighter limiter on resend-code so the email channel isn't a free
// SMS-bomb vector. One resend per minute per IP. The verify endpoint
// itself doesn't need a separate limiter — the per-row attempts cap
// (5 wrong tries → row consumed) handles brute-force.
const resendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Please wait a minute before requesting another code.' },
})

const CODE_TTL_MS    = 10 * 60 * 1000  // 10 minutes
const MAX_ATTEMPTS   = 5

// Generate a 6-digit code as a string with leading zeros preserved
// (e.g. '042913'). Used for email verification.
function generateCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
}

// Insert a fresh code row for the user + channel, hashed at rest.
// Returns the cleartext code so the caller can send it. Older
// unconsumed rows are left in place (harmless — the verify lookup
// uses the most recent row only) so we don't accidentally invalidate
// a code the user is mid-typing.
async function issueCode(userId, channel) {
  const code = generateCode()
  const hash = await bcrypt.hash(code, 10)
  const expires = new Date(Date.now() + CODE_TTL_MS)
  await db.query(
    `INSERT INTO tm_verification_codes (user_id, channel, code_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, channel, hash, expires]
  )
  return code
}

// POST /api/auth/signup
// Creates an UNVERIFIED user, emails a 6-digit code, returns
// { pending_verification: true, user_id, email }. The client routes
// to a Verify screen which POSTs to /verify with { user_id, code }.
// No JWT is minted until verification succeeds.
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email, name, pin } = req.body
    if (!email || !name || !pin) return res.status(400).json({ error: 'email, name, and pin required' })
    if (!/^\d{4}$/.test(pin))   return res.status(400).json({ error: 'PIN must be 4 digits' })

    const lowered = String(email).toLowerCase().trim()
    // db.one returns null when no row — safe to use as existence check
    const exists = await db.one('SELECT id, email_verified_at FROM tm_users WHERE email = $1', [lowered])
    if (exists) {
      // Special case: a row exists but was never verified. Treat the
      // re-signup as a "resend code" and let the user proceed to
      // verify, rather than hard-blocking with "Email already
      // registered." Prevents the dead-end where someone abandons
      // signup, comes back, and can't get past the duplicate check.
      if (!exists.email_verified_at) {
        const code = await issueCode(exists.id, 'email')
        sendVerificationCode(lowered, code, name).catch(err =>
          console.error('[signup.resend]', err.message))
        return res.status(200).json({
          pending_verification: true,
          user_id: exists.id,
          email: lowered,
        })
      }
      return res.status(409).json({ error: 'Email already registered' })
    }

    const hash = await bcrypt.hash(pin, 10)
    // Auto-generate a unique handle from name + email. Mirrors the
    // backfill in migration 014. (2026-05-01 — Matt)
    const handle = await generateUniqueHandle(name, email, db)
    const user = await db.one(
      `INSERT INTO tm_users (email, name, pin_hash, handle) VALUES ($1, $2, $3, $4)
       RETURNING id, email, name`,
      [lowered, name.trim(), hash, handle]
    )

    // Issue + send the verification code. Send is awaited so we can
    // return a real error to the client if Resend rejects (rather
    // than silently dead-lettering the verification email and
    // leaving the user stuck waiting on a code that never arrives).
    const code = await issueCode(user.id, 'email')
    const sendResult = await sendVerificationCode(lowered, code, user.name)
    if (!sendResult.ok) {
      // Don't delete the user row — they can retry via /resend-code.
      // But surface the failure so the client can show a real
      // message instead of a green "check your email" that never
      // arrives. (2026-05-02 — verify-before-claim.)
      console.error('[signup.send] failed', sendResult.reason)
      return res.status(502).json({
        error: "We couldn't send your verification email. Please try again.",
        user_id: user.id,
        pending_verification: true,
      })
    }

    res.status(201).json({
      pending_verification: true,
      user_id: user.id,
      email: lowered,
    })
  } catch (err) {
    console.error('[signup]', err.message)
    res.status(500).json({ error: 'Signup failed. Please try again.' })
  }
})

// POST /api/auth/verify
// Body: { user_id, code }. On success: marks email_verified_at,
// returns { token, user } same shape as /login.
router.post('/verify', authLimiter, async (req, res) => {
  try {
    const { user_id, code } = req.body
    if (!user_id || !code) return res.status(400).json({ error: 'user_id and code required' })
    if (!/^\d{6}$/.test(String(code))) return res.status(400).json({ error: 'Code must be 6 digits' })

    // Most recent unconsumed code for this user. (Multiple rows can
    // exist if they hit resend; we always check the latest.)
    const row = await db.one(
      `SELECT id, code_hash, expires_at, attempts
       FROM tm_verification_codes
       WHERE user_id = $1 AND channel = 'email' AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [user_id]
    )
    if (!row) return res.status(400).json({ error: 'No pending code. Request a new one.' })

    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Code expired. Request a new one.' })
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      // Mark consumed so a fresh /resend-code is required.
      await db.query('UPDATE tm_verification_codes SET consumed_at = NOW() WHERE id = $1', [row.id])
      return res.status(429).json({ error: 'Too many wrong attempts. Request a new code.' })
    }

    const ok = await bcrypt.compare(String(code), row.code_hash)
    if (!ok) {
      await db.query('UPDATE tm_verification_codes SET attempts = attempts + 1 WHERE id = $1', [row.id])
      return res.status(401).json({ error: 'Invalid code', attempts_left: MAX_ATTEMPTS - row.attempts - 1 })
    }

    // Success — burn the code, mark the user verified, mint a token.
    await db.query('UPDATE tm_verification_codes SET consumed_at = NOW() WHERE id = $1', [row.id])
    const user = await db.one(
      `UPDATE tm_users SET email_verified_at = NOW()
       WHERE id = $1
       RETURNING id, email, name, handle, role, onboarding_completed_at, onboarding_steps, coach_marks_seen`,
      [user_id]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })

    res.json({ token: mintToken(user.id), user })
  } catch (err) {
    console.error('[verify]', err.message)
    res.status(500).json({ error: 'Verification failed. Please try again.' })
  }
})

// POST /api/auth/resend-code
// Body: { user_id }. Issues a new code and emails it. Rate limited
// to 1/min per IP (resendLimiter) AND ignored if the user is already
// verified (defensive — client shouldn't ask, but safe to no-op).
router.post('/resend-code', resendLimiter, async (req, res) => {
  try {
    const { user_id } = req.body
    if (!user_id) return res.status(400).json({ error: 'user_id required' })

    const user = await db.one(
      'SELECT id, email, name, email_verified_at FROM tm_users WHERE id = $1',
      [user_id]
    )
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.email_verified_at) return res.status(409).json({ error: 'Already verified' })

    const code = await issueCode(user.id, 'email')
    const sendResult = await sendVerificationCode(user.email, code, user.name)
    if (!sendResult.ok) {
      console.error('[resend-code.send] failed', sendResult.reason)
      return res.status(502).json({ error: "We couldn't send the email. Please try again." })
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[resend-code]', err.message)
    res.status(500).json({ error: 'Resend failed. Please try again.' })
  }
})

// POST /api/auth/login
// Existing flow — unchanged for verified users. If the account
// exists but isn't verified, returns 403 with { error: 'unverified',
// user_id, email } so the client can route to the Verify screen.
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, pin } = req.body
    if (!email || !pin) return res.status(400).json({ error: 'email and pin required' })

    const user = await db.one(
      'SELECT id, email, name, handle, role, pin_hash, email_verified_at FROM tm_users WHERE email = $1',
      [email.toLowerCase()]
    )
    if (!user) return res.status(401).json({ error: 'Invalid email or PIN' })

    const ok = await bcrypt.compare(pin, user.pin_hash)
    if (!ok)  return res.status(401).json({ error: 'Invalid email or PIN' })

    if (!user.email_verified_at) {
      // Same shape as the signup pending response so the client can
      // route through the same Verify screen with one code path.
      // Issue a fresh code so the user has something current to
      // type when they land on Verify.
      try {
        const code = await issueCode(user.id, 'email')
        sendVerificationCode(user.email, code, user.name).catch(err =>
          console.error('[login.unverified.send]', err.message))
      } catch (e) { console.error('[login.unverified.issue]', e.message) }
      return res.status(403).json({
        error: 'unverified',
        message: 'Please verify your email to continue. We just sent you a fresh code.',
        user_id: user.id,
        email: user.email,
        pending_verification: true,
      })
    }

    const { pin_hash: _, email_verified_at: __, ...safeUser } = user
    res.json({ token: mintToken(user.id), user: safeUser })
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
    const user = await db.one('SELECT id, email, name, handle, role, tier, onboarding_completed_at, onboarding_steps, coach_marks_seen FROM tm_users WHERE id = $1', [sub])
    if (!user) return res.status(401).json({ error: 'Not found' })
    res.json({ user })
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
})

module.exports = router
