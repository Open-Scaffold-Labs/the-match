// Client-side handicap helpers for match net scoring.
//
// WHS Course Handicap from a handicap index + the tee's rating data:
//   Course Handicap = Index × (Slope / 113) + (Course Rating − Par)
//
// This is the WHS-correct basis for net strokes — slope-adjusted, and (because
// the captured course_rating/slope_rating are now gender-correct per tee) it's
// where gender actually changes the strokes a player gets in a match.
//
// Returned as a FLOAT; the caller's existing allowance × floor pipeline
// finishes it (keeps current rounding behaviour, just substitutes Course
// Handicap for the raw index). Falls back to the raw index when the outing has
// no valid slope/rating/par, so unrated / free-tier matches are UNCHANGED.
// (2026-06-25)
export function courseHandicap(index, { slope, rating, par } = {}) {
  if (!Number.isFinite(index)) return index
  const s = Number(slope), r = Number(rating), p = Number(par)
  if (Number.isFinite(s) && s > 0 && Number.isFinite(r) && Number.isFinite(p)) {
    return index * (s / 113) + (r - p)
  }
  return index // unrated → raw index (graceful fallback)
}
