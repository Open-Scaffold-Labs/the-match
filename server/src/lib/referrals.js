// ─── lib/referrals.js ───────────────────────────────────────────────────────
// Referral-program logic. Two public-facing entry points:
//
//   getOrCreateCode(userId)             → returns the user's referral code
//   getReferralStats(userId)            → counts + awards for the GET endpoint
//   recordSignupReferral(refereeId, code) → INSERTs tm_referrals row + credits
//                                            the new user with 7 days Elite
//   markReferralQualified(refereeId)    → called after every round save;
//                                            sets qualifying_round_at if
//                                            the referee was referred and
//                                            this is their first qualifying
//                                            round. If newly qualified,
//                                            triggers checkAndAwardMilestones
//                                            for the referrer.
//
// Internal:
//   generateCode()                      → 6-char base32 (excluded I,L,O,0,1
//                                            for human-typing safety)
//   checkAndAwardMilestones(referrerId) → counts qualifying signups, awards
//                                            any newly-crossed milestones,
//                                            extends tm_users.elite_until.
//
// Reward model (Matt 2026-05-07 PM3):
//   Referrer milestones (cumulative qualifying signups → incremental days):
//     5  → +7   days
//     10 → +23  days  (total 30 days = 1 month)
//     50 → +335 days  (total 365 days = 1 year)
//   Referee:
//     +7 days at signup with a valid ref code.
//
// elite_until extension rule: if existing elite_until is in the future,
// the new credit extends from there (not from NOW). This means crediting
// 23 days while a user is on a 7-day trial gives them 30 days total from
// their original trial start, not 23 days from now (which would be less).

const db = require('../db')

// ─── Constants ──────────────────────────────────────────────────────────────

// Base32 alphabet without ambiguous chars: no 0/O, 1/I/L. 32 chars.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const SIGNUP_BONUS_DAYS = 7

// Milestone schedule. Each is the CUMULATIVE qualifying-signup count at
// which the reward fires; days_credited is INCREMENTAL (the difference
// from the previous tier). Sorted ascending so we walk in order.
const MILESTONES = [
  { count: 5,  days: 7   },
  { count: 10, days: 23  },
  { count: 50, days: 335 },
]

// ─── Code generation ────────────────────────────────────────────────────────

function generateCode() {
  let s = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return s
}

async function getOrCreateCode(userId) {
  const existing = await db.one(
    'SELECT code FROM tm_referral_codes WHERE user_id = $1',
    [Number(userId)]
  )
  if (existing) return existing.code

  // Insert with retry on UNIQUE-constraint violation (vanishingly unlikely
  // collision rate for 32^6 ≈ 1.07B keyspace, but we handle it for safety).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode()
    try {
      await db.query(
        'INSERT INTO tm_referral_codes (user_id, code) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
        [Number(userId), code]
      )
      // Re-read to handle the case where two parallel requests both
      // tried to create — the ON CONFLICT (user_id) DO NOTHING means
      // ours might have lost; either way, fetch the actual stored code.
      const row = await db.one('SELECT code FROM tm_referral_codes WHERE user_id = $1', [Number(userId)])
      if (row) return row.code
    } catch (err) {
      // Likely UNIQUE on code (collision). Retry.
      if (attempt === 4) throw err
    }
  }
  throw new Error('referral code generation exhausted retries')
}

// ─── Stats / reads ──────────────────────────────────────────────────────────

async function getReferralStats(userId) {
  const uid = Number(userId)
  const totalSignups = await db.one(
    'SELECT COUNT(*)::int AS n FROM tm_referrals WHERE referrer_id = $1',
    [uid]
  )
  const qualifyingSignups = await db.one(
    'SELECT COUNT(*)::int AS n FROM tm_referrals WHERE referrer_id = $1 AND qualifying_round_at IS NOT NULL',
    [uid]
  )
  const rewardRows = await db.many(
    'SELECT milestone, days_credited, awarded_at FROM tm_referral_rewards WHERE user_id = $1 ORDER BY milestone ASC',
    [uid]
  )
  const qualCount = qualifyingSignups?.n || 0

  // The next unclaimed milestone — i.e., the smallest milestone whose
  // count is greater than the user's current qualifying count, OR whose
  // milestone hasn't been awarded yet (handles the rare case where
  // qualifying count regresses below an already-awarded milestone, which
  // shouldn't happen in v1 but is defensive).
  const awardedMilestones = new Set(rewardRows.map(r => Number(r.milestone)))
  const nextMilestone = MILESTONES.find(m => !awardedMilestones.has(m.count) && qualCount < m.count)

  return {
    totalSignups: totalSignups?.n || 0,
    qualifyingCount: qualCount,
    nextMilestone: nextMilestone ? {
      target: nextMilestone.count,
      days: nextMilestone.days,
      remaining: Math.max(0, nextMilestone.count - qualCount),
    } : null,
    awarded: rewardRows.map(r => ({
      milestone: Number(r.milestone),
      daysCredited: Number(r.days_credited),
      awardedAt: r.awarded_at,
    })),
    milestones: MILESTONES.map(m => ({ count: m.count, days: m.days })),
  }
}

// ─── Mutations ──────────────────────────────────────────────────────────────

// Extend a user's elite_until column by N days. If their current
// elite_until is in the future, the credit stacks on top; if it's null
// or in the past, we credit from NOW.
async function extendEliteUntil(userId, days) {
  if (!days || days <= 0) return
  await db.query(
    `UPDATE tm_users
        SET elite_until = GREATEST(COALESCE(elite_until, NOW()), NOW()) + ($1 || ' days')::interval
      WHERE id = $2`,
    [String(days), Number(userId)]
  )
}

// Called inside POST /api/auth/signup when the request includes a ref
// code. Looks up the referrer, INSERTs tm_referrals (UNIQUE(referee_id)
// makes this idempotent — a second call for the same referee is a no-op),
// credits the new user 7 days of Elite. Returns true on success, false
// if the code was invalid, the referrer is the same as the referee, or
// the referee was already referred.
async function recordSignupReferral(refereeId, code) {
  if (!code || typeof code !== 'string') return false
  const trimmed = code.trim().toUpperCase()
  if (!/^[A-Z0-9]{4,12}$/.test(trimmed)) return false

  const referrer = await db.one(
    'SELECT user_id FROM tm_referral_codes WHERE code = $1',
    [trimmed]
  )
  if (!referrer) return false
  if (Number(referrer.user_id) === Number(refereeId)) return false

  // Try to insert. UNIQUE(referee_id) means a re-attempt for the same
  // referee fails; we treat that as a soft no-op (the referee was
  // already referred).
  try {
    await db.query(
      'INSERT INTO tm_referrals (referrer_id, referee_id) VALUES ($1, $2)',
      [Number(referrer.user_id), Number(refereeId)]
    )
  } catch (err) {
    // 23505 = unique_violation
    if (err.code === '23505') return false
    throw err
  }

  // Credit referee with 7-day Elite trial.
  await extendEliteUntil(refereeId, SIGNUP_BONUS_DAYS)
  return true
}

// Called from rounds.js (solo) and outings.js (matched) after a real
// round is saved. Sets qualifying_round_at if it isn't already set.
// If newly qualified, runs the milestone check for the referrer.
async function markReferralQualified(refereeId) {
  if (!refereeId) return
  const row = await db.one(
    'SELECT id, referrer_id, qualifying_round_at FROM tm_referrals WHERE referee_id = $1',
    [Number(refereeId)]
  )
  if (!row) return  // user wasn't referred — nothing to do
  if (row.qualifying_round_at) return  // already qualified — already credited

  await db.query(
    'UPDATE tm_referrals SET qualifying_round_at = NOW() WHERE id = $1',
    [row.id]
  )
  await checkAndAwardMilestones(row.referrer_id)
}

// Counts the referrer's qualifying signups and awards any newly-crossed
// milestones. UNIQUE(user_id, milestone) on tm_referral_rewards prevents
// double-credit, so this can be called multiple times safely.
async function checkAndAwardMilestones(referrerId) {
  const uid = Number(referrerId)
  const { n: qualCount } = await db.one(
    'SELECT COUNT(*)::int AS n FROM tm_referrals WHERE referrer_id = $1 AND qualifying_round_at IS NOT NULL',
    [uid]
  )
  const awardedRows = await db.many(
    'SELECT milestone FROM tm_referral_rewards WHERE user_id = $1',
    [uid]
  )
  const awardedSet = new Set(awardedRows.map(r => Number(r.milestone)))

  for (const m of MILESTONES) {
    if (qualCount >= m.count && !awardedSet.has(m.count)) {
      try {
        await db.query(
          'INSERT INTO tm_referral_rewards (user_id, milestone, days_credited) VALUES ($1, $2, $3)',
          [uid, m.count, m.days]
        )
        await extendEliteUntil(uid, m.days)
      } catch (err) {
        if (err.code === '23505') {
          // Race — another request already awarded this milestone.
          // Skip, don't double-credit.
        } else {
          throw err
        }
      }
    }
  }
}

module.exports = {
  MILESTONES,
  SIGNUP_BONUS_DAYS,
  getOrCreateCode,
  getReferralStats,
  recordSignupReferral,
  markReferralQualified,
  checkAndAwardMilestones,
  extendEliteUntil,
}
