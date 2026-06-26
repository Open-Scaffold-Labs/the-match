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

// The tee rating a given player should use for their Course Handicap — THEIR
// gender's CR/SR from the outing's both-gender `teeRatings`, falling back to the
// single captured rating when their gender's isn't available (one-gender tee,
// gender unset, or an old outing without tee_ratings). This is what makes a
// MIXED-gender match correct: each player's strokes use their own rating.
//   gender: 'male' | 'female' | null
//   meta:   { teeRatings:{male:{cr,sr},female:{cr,sr}}, courseRating, slopeRating, coursePar }
// (2026-06-25)
export function playerTeeRatings(gender, meta = {}) {
  const g = (gender === 'male' || gender === 'female') ? gender : null
  const byG = (g && meta.teeRatings && meta.teeRatings[g]) ? meta.teeRatings[g] : null
  return {
    slope: byG?.sr ?? meta.slopeRating,
    rating: byG?.cr ?? meta.courseRating,
    par: meta.coursePar,
  }
}
