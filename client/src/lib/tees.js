// Shared helper for deduplicating tee arrays returned by the course
// API. Many courses publish the same physical tee box once in `male`
// and once in `female` (different gender ratings, same tee_name + same
// yardage). Showing both produces duplicates like "Gold (6464y) ·
// Gold (6464y)" with confusingly different ratings to a user trying
// to pick which tees they're playing.
//
// Strategy (matches the original EagleEye.jsx implementation, lifted
// out 2026-05-06 so the CreateWizard tee picker can share it instead
// of growing a parallel codepath):
//
//   1. Iterate the PLAYER'S-GENDER list first, key by (tee_name +
//      total_yards), keep all first-occurrences as-is — so the
//      course_rating/slope_rating captured for a shared physical tee is the
//      one rated for the player's gender (CRITICAL for correct handicapping:
//      a woman on the Gold tees must get the women's CR/SR, not the men's).
//   2. Iterate the OTHER gender, skip ones already keyed (dupes of a
//      same-gender-rated tee), keep the rest WITH a suffix so any
//      genuinely-one-gender-only forward/back tees stay distinguishable.
//
// gender: 'male' | 'female' (default 'male' — null/unset users keep the
// original behaviour exactly, so nothing changes until a player sets gender).
// Caller gets one entry per physical tee box, rated for the player.
export function dedupeTees(teesObj, gender = 'male') {
  const female = gender === 'female'
  const primary   = (female ? teesObj?.female : teesObj?.male) || []
  const secondary = (female ? teesObj?.male   : teesObj?.female) || []
  const otherSuffix = female ? ' (M)' : ' (W)'
  const out = []
  const seen = new Set()
  for (const t of primary) {
    const key = `${t.tee_name}|${t.total_yards}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t) // player's-gender rating, no suffix
  }
  for (const t of secondary) {
    const key = `${t.tee_name}|${t.total_yards}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...t, tee_name: `${t.tee_name}${otherSuffix}` })
  }
  return out
}
