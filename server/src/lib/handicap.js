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

// ── Adjusted Gross Score (net double bogey) — WHS Rule 3.1 ──────────────────
// Strokes a player receives on a hole given its Stroke Index (1..18) and their
// rounded Course Handicap. 1 stroke where SI ≤ CH; wraps (2nd stroke) for
// CH>18. Plus handicaps (CH<0) GIVE strokes back from the easiest holes (SI 18)
// downward (negative). (audit 2026-06-25)
function strokesOnHole(si, ch) {
  if (!Number.isFinite(si) || !Number.isFinite(ch) || ch === 0) return 0
  const H = 18
  if (ch > 0) return Math.floor(ch / H) + (si <= (ch % H) ? 1 : 0)
  const mag = -ch // plus handicap: strokes back from SI 18 down
  return -(Math.floor(mag / H) + ((H - si + 1) <= (mag % H) ? 1 : 0))
}

// Per-hole maximum for Adjusted Gross Score. Established index → net double
// bogey (par + 2 + strokes received). Before an established index → flat par+5.
function netDoubleBogey(par, si, ch, established) {
  if (!established) return par + 5
  return par + 2 + Math.max(0, strokesOnHole(si, ch))
}

// Adjusted Gross Score: each hole's score capped at its net double bogey, summed.
// strokeIndex defaults to 1..18 by hole order when not provided (the documented
// fallback for rounds with no stored Stroke Index). Returns null when the
// per-hole data isn't usable (caller then falls back to the raw total).
function adjustedGrossScore(scores, holePars, strokeIndex, courseHandicap, established = true) {
  if (!Array.isArray(scores) || !Array.isArray(holePars) || scores.length < 9) return null
  if (holePars.length < scores.length) return null
  const ch = Math.round(Number(courseHandicap))
  let ags = 0
  for (let i = 0; i < scores.length; i++) {
    const s = Number(scores[i]); if (!Number.isFinite(s) || s <= 0) return null
    const par = Number(holePars[i]); if (!Number.isFinite(par)) return null
    const si = (Array.isArray(strokeIndex) && Number.isFinite(Number(strokeIndex[i]))) ? Number(strokeIndex[i]) : (i + 1)
    ags += Math.min(s, netDoubleBogey(par, si, established ? ch : 0, established))
  }
  return ags
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

const asArr = (v) => {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : null } catch { return null } }
  return null
}

// Rounded Course Handicap for a round, from the player's current Index + the
// round's tee. Used to allocate net-double-bogey strokes. (audit Tier-2)
function courseHandicapFor(r, index) {
  if (!Number.isFinite(index)) return null
  const slope = Number(r.slope_rating), rating = Number(r.course_rating), par = Number(r.course_par)
  if (Number.isFinite(slope) && slope > 0 && Number.isFinite(rating) && Number.isFinite(par)) {
    return Math.round(index * (slope / 113) + (rating - par))
  }
  return Math.round(index) // unrated: Course Handicap ≈ Index
}

// Per-round Score Differential applying net-double-bogey Adjusted Gross Score
// when the per-hole data is available (scores + pars; stroke index if present,
// else default 1..18), else the raw total. Rounded to 0.1. `index` = the
// player's current Handicap Index (for stroke allocation + established check;
// the standard consumer-app approximation — we don't reconstruct historical
// per-round indexes). (audit Tier-2 2026-06-25)
function roundDifferential(r, index) {
  const established = Number.isFinite(index)
  const ch = courseHandicapFor(r, index)
  let gross = Number(r.total)
  const scores = asArr(r.scores), holePars = asArr(r.hole_pars)
  if (scores && holePars) {
    const ags = adjustedGrossScore(scores, holePars, asArr(r.hole_handicaps), ch ?? 0, established)
    if (ags != null) gross = ags
  }
  if (!Number.isFinite(gross)) return null
  const rating = Number(r.course_rating), slope = Number(r.slope_rating)
  let d
  if (Number.isFinite(rating) && Number.isFinite(slope) && slope > 0) d = ((gross - rating) * 113) / slope
  else { const par = Number(r.course_par); if (!Number.isFinite(par)) return null; d = gross - par }
  return Math.round(d * 10) / 10
}

// Handicap Index (WHS Rule 5.2). `rounds` must be most-recent-first (callers
// pass ORDER BY date DESC). Applies net-double-bogey AGS per round (Tier-2) when
// `currentIndex` + per-hole data are present. Uses the most recent 20 acceptable
// differentials, averages the lowest N per the sliding table + low-count
// adjustment, rounds to 0.1, clamps to the WHS maximum 54.0. No 0.96 multiplier.
function computeHandicapFromRounds(rounds, currentIndex) {
  const idx = Number(currentIndex)
  const diffs = (rounds || [])
    .filter(isRoundCompleted)
    .map(r => roundDifferential(r, idx))
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
    // Current Index for net-double-bogey stroke allocation (the standard
    // approximation — we don't reconstruct historical per-round indexes).
    let currentIndex = null
    try {
      const u = await db.one('SELECT handicap FROM tm_users WHERE id = $1', [userId])
      if (u && u.handicap != null && Number.isFinite(Number(u.handicap))) currentIndex = Number(u.handicap)
    } catch { /* no current index → pre-establishment caps (par+5) */ }
    // Per-hole pars from the round (solo) or its outing; stroke index from the
    // outing (solo rounds don't store it → AGS defaults SI to 1..18).
    const rounds = await db.many(
      `SELECT r.total, r.course_par, r.course_rating, r.slope_rating, r.scores,
              COALESCE(r.hole_pars, o.hole_pars) AS hole_pars,
              o.hole_handicaps AS hole_handicaps
       FROM tm_rounds r
       LEFT JOIN tm_outings o ON o.id = r.outing_id
       WHERE r.user_id = $1
       ORDER BY r.date DESC
       LIMIT 20`,
      [userId]
    )
    const completedCount = rounds.filter(isRoundCompleted).length
    if (completedCount < 3) return null
    const hcp = computeHandicapFromRounds(rounds, currentIndex)
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
  strokesOnHole,
  netDoubleBogey,
  adjustedGrossScore,
  computeHandicapFromRounds,
  maybeUpdateUserHandicap,
}
