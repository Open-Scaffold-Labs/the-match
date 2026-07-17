// Putt-fact integrity rules for live outing capture (2026-07-06,
// wiki/synthesis/live-putt-capture-outings-build-spec-2026-07-06.md).
// Pure, no DOM/IO — unit-tests in Node. Shared by the /scores +
// /scores/host ride-along and the /end fan-out.
//
// Contract (matches the solo scorer + tm_rounds 039 conventions):
//   putt count  — int 0..6 AND ≤ that hole's score; anything else → null.
//                 0 is valid (holed out from off the green).
//   first putt  — closed bucket set, stored only when count > 0.
// Invalid shapes are DROPPED, never errors: putt capture is optional and
// must never be able to break a score write (F.5 prime directive).

const SG_BUCKETS = ['in3', '3-10', '10-25', '25plus']

/** Clean ONE hole's self-entered putt facts against that hole's score.
 *  Returns { putts, firstPutt } with nulls for anything invalid. */
function cleanPuttEntry(putts, firstPutt, score) {
  const s = Number(score)
  // strict: only a real number counts — Number([]) coerces to 0 and would
  // otherwise record a phantom "0 putts" from a garbage payload
  const n = typeof putts === 'number' ? putts : null
  // s > 0: a hole with no real score (0 = unplayed, partial-rounds spec
  // 2026-07-16) can't carry putt facts — 0<=0 used to let a phantom
  // "0 putts" (= holed from off the green) through on an unplayed hole.
  const validCount = n != null && Number.isInteger(n) && n >= 0 && n <= 6
    && Number.isFinite(s) && s > 0 && n <= s
  if (!validCount) return { putts: null, firstPutt: null }
  const validBucket = n > 0 && SG_BUCKETS.includes(firstPutt)
  return { putts: n, firstPutt: validBucket ? firstPutt : null }
}

/** Set one hole's facts into the parallel arrays (sparse-safe, same index
 *  semantics as the scores array). Returns NEW arrays. */
function setPuttAtHole(puttsArr, firstPuttsArr, hole, entry) {
  const p = Array.isArray(puttsArr) ? [...puttsArr] : []
  const f = Array.isArray(firstPuttsArr) ? [...firstPuttsArr] : []
  p[hole] = entry.putts
  f[hole] = entry.firstPutt
  // normalize sparse slots to null so JSON round-trips cleanly
  for (let i = 0; i < p.length; i++) { if (p[i] === undefined) p[i] = null; if (f[i] === undefined) f[i] = null }
  for (let i = p.length; i < f.length; i++) { if (f[i] === undefined) f[i] = null }
  return { putts: p, firstPutts: f }
}

/** Fan-out clean: re-validate whole arrays against FINAL scores (a conflict
 *  resolution can lower a score below an earlier putt count). Returns null
 *  arrays when there is no usable data at all (store nothing, not []). */
function cleanPuttArraysForRound(scores, puttsArr, firstPuttsArr) {
  if (!Array.isArray(scores) || !Array.isArray(puttsArr)) return { putts: null, firstPutts: null }
  const f = Array.isArray(firstPuttsArr) ? firstPuttsArr : []
  const outP = [], outF = []
  let any = false
  for (let i = 0; i < scores.length; i++) {
    const e = cleanPuttEntry(puttsArr[i], f[i], scores[i])
    outP.push(e.putts); outF.push(e.firstPutt)
    if (e.putts != null) any = true
  }
  return any ? { putts: outP, firstPutts: outF } : { putts: null, firstPutts: null }
}

module.exports = { cleanPuttEntry, setPuttAtHole, cleanPuttArraysForRound, SG_BUCKETS }
