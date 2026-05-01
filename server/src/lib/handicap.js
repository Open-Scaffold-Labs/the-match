// Handicap calculation helpers shared by /api/rounds + /api/stats.
//
// USGA-method index: best 8 of last 20 differentials × 0.96, where each
// differential = (score − course_rating) × 113 / slope_rating.
//
// A round only counts toward the handicap if it's both **rated** and
// **fully completed**:
//   - rated: course_rating + slope_rating both present
//   - fully completed: scores array has at least 9 entries AND every
//     entry is a non-null, non-zero number
//
// Per Matt's requirement (2026-05-01): a round in progress where some
// holes haven't been entered must NOT pollute the index.
//
// At least 5 completed-rated rounds in the most recent 20 are required
// before the calculated index displaces the manually-seeded base.

const db = require('../db')

function isRoundCompletedAndRated(r) {
  if (!r) return false
  if (r.course_rating == null || r.slope_rating == null) return false
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

function computeHandicapFromRounds(rounds) {
  const completed = (rounds || []).filter(isRoundCompletedAndRated)
  if (!completed.length) return null
  const diffs = completed
    .map(r => ((Number(r.total) - Number(r.course_rating)) * 113) / Number(r.slope_rating))
    .sort((a, b) => a - b)
    .slice(0, 8)
  if (!diffs.length) return null
  return parseFloat((diffs.reduce((s, d) => s + d, 0) / diffs.length * 0.96).toFixed(1))
}

// Recompute and (if 5+ completed-rated rounds exist) persist the
// handicap to tm_users.handicap. Below the 5-round threshold, the
// manually-seeded base value stays in place untouched.
async function maybeUpdateUserHandicap(userId) {
  try {
    const rounds = await db.many(
      `SELECT total, course_rating, slope_rating, scores
       FROM tm_rounds
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT 20`,
      [userId]
    )
    const completedCount = rounds.filter(isRoundCompletedAndRated).length
    if (completedCount < 5) return null
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
  isRoundCompletedAndRated,
  computeHandicapFromRounds,
  maybeUpdateUserHandicap,
}
