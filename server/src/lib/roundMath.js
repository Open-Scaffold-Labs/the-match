// ── roundMath — the ONE shared holes-played-aware round math library ─────────
//
// Spec: wiki/synthesis/partial-rounds-stats-build-spec-2026-07-16.md (§2, §4 D2).
// Every reader that aggregates or displays round scores (stats /summary,
// profile avg3, friends profile + activity, rounds GET) imports THESE
// functions. No route computes an average from r.total directly anymore —
// the -71 bug (2026-07-16) reached four surfaces precisely because each did
// its own math.
//
// Definitions (canonical):
//   played hole      — Number(scores[i]) > 0. A golfer can never take 0
//                      strokes, so 0/null is unambiguously "no score".
//   full round       — every hole of the course scored. A full 9-hole-course
//                      round is FULL, not partial.
//   partial round    — 1 ≤ playedCount < scores.length.
//   qualifying round — playedCount ≥ 9 (enters averages; below = display-only).
//   par_played       — sum of hole pars over played holes; pro-rated from
//                      course_par when hole_pars is unusable.
//   equiv18          — 18-hole-equivalent score: to-par-per-played-hole × 18
//                      + 18-hole par. For a FULL 18-hole round this is exactly
//                      the raw total (returned directly — no float drift).
//
// All inputs Number()-coerced: pg NUMERIC arrives as string, JSONB may arrive
// as string. All functions return null (never NaN/Infinity) on unusable input.

function asArr(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : null } catch { return null } }
  return null
}

// Count of holes with a real score.
function playedCount(scores) {
  const arr = asArr(scores)
  if (!arr) return 0
  return arr.filter(s => Number(s) > 0).length
}

// True when every hole of the course carries a score (9- or 18-hole course).
function isFullRound(round) {
  const arr = asArr(round?.scores)
  if (!arr || arr.length === 0) return false
  return arr.every(s => Number(s) > 0)
}

// Qualifying = enough golf to mean something statistically (and the WHS
// 9-hole posting floor). Sub-9 rounds are display-only.
function isQualifying(round) {
  return playedCount(round?.scores) >= 9
}

// Par of the holes actually played. Exact when hole_pars lines up with the
// scores array (every played hole has a numeric 3..6 par); otherwise pro-rate
// course_par by playedCount/holes. Null when even that isn't computable.
function parPlayed(round) {
  const scores = asArr(round?.scores)
  if (!scores || scores.length === 0) return null
  const played = scores.map((s, i) => (Number(s) > 0 ? i : -1)).filter(i => i >= 0)
  if (played.length === 0) return null

  const pars = asArr(round?.hole_pars)
  if (pars && pars.length === scores.length
      && played.every(i => Number.isFinite(Number(pars[i])) && Number(pars[i]) >= 3 && Number(pars[i]) <= 6)) {
    return played.reduce((sum, i) => sum + Number(pars[i]), 0)
  }

  const coursePar = Number(round?.course_par)
  if (!Number.isFinite(coursePar) || coursePar <= 0) return null
  return Math.round(coursePar * (played.length / scores.length))
}

// Strokes over/under the par of the holes played. Null when not computable.
function toParThrough(round) {
  const total = Number(round?.total)
  if (!Number.isFinite(total) || total <= 0) return null
  const pp = parPlayed(round)
  if (pp == null) return null
  return total - pp
}

// 18-hole par of the course this round was played on: course_par for an
// 18-hole course, course_par × 2 for a 9-hole course. Course size keys off
// scores.length (the card the round was scored on).
function par18(round) {
  const scores = asArr(round?.scores)
  const coursePar = Number(round?.course_par)
  if (!scores || !Number.isFinite(coursePar) || coursePar <= 0) return null
  return scores.length === 9 ? coursePar * 2 : coursePar
}

// 18-hole-equivalent score, rounded to 0.1.
//   • FULL 18-hole round → the raw total, exactly (no normalization, no float
//     drift — this is the §7 parity guarantee).
//   • everything else    → (toParThrough / playedCount) × 18 + par18.
// Null when the round has no usable score/par data.
function equiv18(round) {
  const scores = asArr(round?.scores)
  const total = Number(round?.total)
  if (!scores || scores.length === 0 || !Number.isFinite(total) || total <= 0) return null

  const played = playedCount(scores)
  if (played === 0) return null
  if (played === scores.length && scores.length === 18) return total // exact parity

  const tp = toParThrough(round)
  const p18 = par18(round)
  if (tp == null || p18 == null) return null
  return Math.round(((tp / played) * 18 + p18) * 10) / 10
}

module.exports = { playedCount, isFullRound, isQualifying, parPlayed, toParThrough, par18, equiv18 }
