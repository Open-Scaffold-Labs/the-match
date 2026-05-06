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
//   1. Iterate male first, key by (tee_name + total_yards), keep all
//      first-occurrences as-is.
//   2. Iterate female, skip ones already keyed (these are dupes of a
//      male-rated tee), keep the rest WITH a " (W)" suffix so any
//      genuinely-female-only forward tees are still distinguishable.
//
// Caller gets one entry per physical tee box.
export function dedupeTees(teesObj) {
  const out = []
  const seen = new Set()
  for (const t of (teesObj?.male || [])) {
    const key = `${t.tee_name}|${t.total_yards}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  for (const t of (teesObj?.female || [])) {
    const key = `${t.tee_name}|${t.total_yards}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...t, tee_name: `${t.tee_name} (W)` })
  }
  return out
}
