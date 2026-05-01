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

// During testing (and for free-tier users when paid-tier ships), the
// handicap formula uses the simpler par-based differential — no course
// rating / slope adjustments. Flip this flag to true once paid-tier
// is wired up; rated rounds will then use the USGA-method formula and
// unrated rounds keep falling back to par-based. (2026-05-01)
const USE_USGA_DIFFERENTIAL = false

// Per-round differential. With USGA mode on AND the round has both
// course_rating and slope_rating, returns (score-rating)*113/slope.
// Otherwise (free-tier or unrated), returns score-course_par.
// Null when the round lacks the data needed to evaluate either path.
function differentialFor(r) {
  const total = Number(r.total)
  if (!Number.isFinite(total)) return null
  if (USE_USGA_DIFFERENTIAL) {
    const rating = Number(r.course_rating)
    const slope  = Number(r.slope_rating)
    if (Number.isFinite(rating) && Number.isFinite(slope) && slope > 0) {
      return ((total - rating) * 113) / slope
    }
  }
  const par = Number(r.course_par)
  if (Number.isFinite(par)) return total - par
  return null
}

function computeHandicapFromRounds(rounds) {
  const completed = (rounds || []).filter(isRoundCompleted)
  if (!completed.length) return null
  const diffs = completed
    .map(differentialFor)
    .filter(d => d != null)
    .sort((a, b) => a - b)
    .slice(0, 8)
  if (!diffs.length) return null
  return parseFloat((diffs.reduce((s, d) => s + d, 0) / diffs.length * 0.96).toFixed(1))
}

// Recompute and (if 5+ completed rounds exist) persist the handicap
// to tm_users.handicap. Below the 5-round threshold, the manually-
// seeded base value stays in place untouched.
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
  isRoundCompleted,
  // Backwards-compat alias — older imports referenced
  // isRoundCompletedAndRated. Now any completed round counts; a
  // missing rating just shifts the differential formula.
  isRoundCompletedAndRated: isRoundCompleted,
  differentialFor,
  computeHandicapFromRounds,
  maybeUpdateUserHandicap,
}
