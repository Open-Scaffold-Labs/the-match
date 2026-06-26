// Handicap calculation helpers shared by /api/rounds + /api/stats.
//
// Two-tier formula (graceful degradation):
//
//   • USGA-method (when course_rating + slope_rating present):
//       differential = (score − course_rating) × 113 / slope_rating
//
//   • Par-based fallback (free tier or course without ratings):
//       differential = score − course_par
//
// In both cases: best 8 of last 20 differentials × 0.96 → handicap.
//
// A round counts only when it's **fully completed**:
//   - scores array has at least 9 entries
//   - every entry is a non-null, non-zero number
//
// Per Matt's 2026-05-01 requirement: a round in progress where some
// holes haven't been entered must NOT pollute the index. Ratings are
// captured at match-create time when the picked tee carries them
// (paid tier); when absent, the par-based fallback still produces
// a usable index from completed scores.
//
// At least 5 completed rounds in the most recent 20 are required
// before the calculated index displaces the manually-seeded base.

const db = require('../db')

function isRoundCompleted(r) {
  if (!r) return false
  let scores
  try {
    scores = Array.isArray(r.scores)
      ? r.scores
      : JSON.parse(r.scores ?? '[]')
  } catch {
    return false
  }
  if (!Array.isArray(scores) || scores.length < 9) return false
  return scores.every(s => s != null && Number(s) > 0)
}

// Per-round differential.
//   • USGA-method when the round carries a valid course_rating + slope_rating:
//       (score − rating) × 113 / slope
//   • Par-based fallback (free tier / unrated course): score − course_par
// Null when the round lacks the data for either path.
//
// USGA mode was previously gated OFF behind a flag while the captured ratings
// weren't gender-correct (a woman on a shared tee captured the men's rating).
// Now that tee selection is gender-aware (lib/tees.js dedupeTees), rated rounds
// use the proper WHS differential and gender flows through correctly. Unrated
// rounds are unaffected. (Enabled 2026-06-25.)
// Score Differential, rounded to the nearest 0.1 per WHS Rule 5.1a. PCC is set
// to 0 (a standalone app can't compute the field's same-day PCC; it's 0 on most
// days anyway — the consumer-app norm). AGS (net-double-bogey adjusted gross) is
// NOT yet applied — uses raw total; that's the Tier-2 follow-up. (audit 2026-06-25)
function differentialFor(r) {
  const total = Number(r.total)
  if (!Number.isFinite(total)) return null
  const rating = Number(r.course_rating)
  const slope  = Number(r.slope_rating)
  let d
  if (Number.isFinite(rating) && Number.isFinite(slope) && slope > 0) {
    d = ((total - rating) * 113) / slope
  } else {
    const par = Number(r.course_par)
    if (!Number.isFinite(par)) return null
    d = total - par // par-based fallback (unrated/free)
  }
  return Math.round(d * 10) / 10
}

// WHS Rule 5.2a sliding table: given the number of acceptable Score
// Differentials in the record, how many of the LOWEST to average + the
// low-count adjustment. (No ×0.96 — that "bonus for excellence" was REMOVED in
// WHS 2020; the 8-of-20 selection replaced it.) (audit 2026-06-25)
function whsSelection(n) {
  if (n < 3) return null
  if (n === 3) return { count: 1, adj: -2.0 }
  if (n === 4) return { count: 1, adj: -1.0 }
  if (n === 5) return { count: 1, adj: 0 }
  if (n === 6) return { count: 2, adj: -1.0 }
  if (n <= 8) return { count: 2, adj: 0 }
  if (n <= 11) return { count: 3, adj: 0 }
  if (n <= 14) return { count: 4, adj: 0 }
  if (n <= 16) return { count: 5, adj: 0 }
  if (n <= 18) return { count: 6, adj: 0 }
  if (n === 19) return { count: 7, adj: 0 }
  return { count: 8, adj: 0 } // 20+
}

// Handicap Index (WHS Rule 5.2). `rounds` must be most-recent-first (callers
// pass ORDER BY date DESC). Uses the most recent 20 acceptable differentials,
// averages the lowest N per the sliding table + low-count adjustment, rounds to
// 0.1, clamps to the WHS maximum 54.0. No 0.96 multiplier.
function computeHandicapFromRounds(rounds) {
  const diffs = (rounds || [])
    .filter(isRoundCompleted)
    .map(differentialFor)
    .filter(d => d != null)
    .slice(0, 20) // most recent 20 (caller is date-DESC)
  const sel = whsSelection(diffs.length)
  if (!sel) return null // fewer than 3 acceptable scores → no index yet
  const lowest = [...diffs].sort((a, b) => a - b).slice(0, sel.count)
  const index = (lowest.reduce((s, d) => s + d, 0) / lowest.length) + sel.adj
  return Math.min(54.0, Math.max(-10.0, Math.round(index * 10) / 10))
}

// Recompute and (if 3+ completed rounds exist) persist the handicap
// to tm_users.handicap. WHS issues an index after 54 holes (≈3 18-hole
// rounds; the sliding table starts at 3 differentials). Below that, the
// manually-seeded base value stays in place untouched. (audit 2026-06-25 —
// was 5; WHS minimum is 3.)
async function maybeUpdateUserHandicap(userId) {
  try {
    const rounds = await db.many(
      `SELECT total, course_par, course_rating, slope_rating, scores
       FROM tm_rounds
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT 20`,
      [userId]
    )
    const completedCount = rounds.filter(isRoundCompleted).length
    if (completedCount < 3) return null
    const hcp = computeHandicapFromRounds(rounds)
    if (hcp == null) return null
    await db.query('UPDATE tm_users SET handicap = $1 WHERE id = $2', [hcp, userId])
    return hcp
  } catch (e) {
    console.error('[handicap] maybeUpdateUserHandicap failed:', e.message)
    return null
  }
}

module.exports = {
  isRoundCompleted,
  // Backwards-compat alias — older imports referenced
  // isRoundCompletedAndRated. Now any completed round counts; a
  // missing rating just shifts the differential formula.
  isRoundCompletedAndRated: isRoundCompleted,
  differentialFor,
  computeHandicapFromRounds,
  maybeUpdateUserHandicap,
}
