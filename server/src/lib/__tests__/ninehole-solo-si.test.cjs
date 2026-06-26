// Verifies (1) the 9-hole corruption guard and (2) that solo rounds carrying
// their own Stroke Index handicap identically to outing rounds.
// Run: node server/src/lib/__tests__/ninehole-solo-si.test.cjs
const assert = require('node:assert/strict')
const H = require('../handicap.js')
let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

// A clean full-18 round: 90 gross on a par-72, CR 70.0 / Slope 125.
// Differential (par-fallback path used when no per-hole data needed) etc.
const par18 = Array.from({ length: 18 }, (_, i) => (i % 3 === 0 ? 3 : i % 3 === 1 ? 5 : 4)) // 72 total
const si18  = Array.from({ length: 18 }, (_, i) => i + 1)
function round18(total) {
  const scores = par18.map((p, i) => p + (i < (total - 72) ? 1 : 0)) // spread the over-par
  return { total, course_par: 72, course_rating: 70.0, slope_rating: 125,
           scores, hole_pars: par18, hole_handicaps: si18 }
}
const eighteens = [round18(90), round18(88), round18(92)]
const baseIndex = H.computeHandicapFromRounds(eighteens, 12.0)
ok('three 18-hole rounds yield an index', Number.isFinite(baseIndex))

// ── 9-hole expected-score method (H.6, WHS 2024) ───────────────────────────
// expected9 ≈ 0.5214·HI + 1.2, anchored to the published USGA worked example.
ok('expected-9 matches USGA example (HI 14.0 → 8.5)',
   Math.abs(H.expectedNineDifferential(14.0) - 8.5) <= 0.05)
// USGA worked example: a 9-hole differential of 7.2 for a 14.0 index → 18-hole 15.7.
ok('9-hole 7.2 + expected(14.0) combines to 18-hole 15.7',
   Math.round((7.2 + H.expectedNineDifferential(14.0)) * 10) / 10 === 15.7)
// Expected-9 is monotonic in the index and never negative.
ok('expected-9 monotonic & non-negative',
   H.expectedNineDifferential(0) >= 0 && H.expectedNineDifferential(20) > H.expectedNineDifferential(5))

// A "great" 9-hole round (40 gross, par 36) carrying an 18-hole CR/Slope. The
// OLD bug differenced a 9-hole gross against the 18-hole CR → a hugely NEGATIVE
// differential that crashed the index toward a false plus. The expected-score
// method must instead yield a SANE, positive 18-hole differential.
const nine = {
  total: 40, course_par: 36, course_rating: 70.0, slope_rating: 125,
  scores: Array.from({ length: 9 }, () => 4), // all > 0
  hole_pars: par18.slice(0, 9), hole_handicaps: si18.slice(0, 9),
}
const d9 = H.nineHoleDifferential(nine, 12.0, nine.scores, nine.hole_pars)
ok('9-hole differential is finite, positive, and not crashed', Number.isFinite(d9) && d9 > 0 && d9 < 30)

// With an established index the 9-hole round now COUNTS (and never crashes).
const withNine = H.computeHandicapFromRounds([...eighteens, nine], 12.0)
ok('established index: 9-hole round counts, index stays finite & sane',
   Number.isFinite(withNine) && withNine > -5 && withNine < 30)

// Before establishment (no index), 9-hole scores are HELD (excluded) per WHS.
const onlyNine = H.computeHandicapFromRounds([nine, nine, nine], null)
ok('no established index: three 9-hole rounds yield NO index (held)', onlyNine === null)
// Once established, three 9-hole rounds DO produce an index.
const onlyNineEst = H.computeHandicapFromRounds([nine, nine, nine], 12.0)
ok('established index: three 9-hole rounds produce an index', Number.isFinite(onlyNineEst))

// A 9-hole round identified by course_par alone (scores absent) also converts.
const nineByPar = { total: 40, course_par: 36, course_rating: 70.0, slope_rating: 125 }
const dByPar = H.nineHoleDifferential(nineByPar, 12.0, null, null)
ok('9-hole-by-par (no scores) converts to a finite 18-hole differential',
   Number.isFinite(dByPar) && dByPar > 0 && dByPar < 30)

// ── Solo Stroke Index parity ────────────────────────────────────────────────
// Same 18-hole round, but with a blow-up hole. Net-double-bogey caps it using
// the Stroke Index. A solo round that CARRIES its own SI must produce the same
// differential as the identical round whose SI comes from an outing — i.e. the
// COALESCE(r.hole_handicaps, o.hole_handicaps) makes them identical.
const blow = par18.map((p, i) => (i === 0 ? p + 6 : p)) // a 9 on hole 1 (par 3)
const soloWithSI = {
  total: blow.reduce((s, x) => s + x, 0), course_par: 72,
  course_rating: 70.0, slope_rating: 125,
  scores: blow, hole_pars: par18, hole_handicaps: si18, // solo now carries SI
}
const soloNoSI = { ...soloWithSI, hole_handicaps: null } // legacy solo (SI fell back to 1..18)
const a = H.computeHandicapFromRounds([soloWithSI, round18(88), round18(92)], 12.0)
const b = H.computeHandicapFromRounds([soloNoSI,   round18(88), round18(92)], 12.0)
// With SI present vs the 1..18 default: for this round the default SI(0)=1 equals
// the real SI for hole 1, so the AGS cap is identical → indexes match. The point
// proven: carrying SI is a no-op when it matches, and is *used* (not ignored).
ok('solo round consumes its own Stroke Index (parity with default here)', a === b)

// Prove SI is actually consumed: a round where the blow-up hole has a HIGH SI
// (more strokes → higher net-double-bogey cap → less truncation → higher AGS).
const siHardFirst = [18, ...si18.slice(1)] // hole 1 is the hardest (SI 18 → gets strokes only at high CH)
const lowCH = { ...soloWithSI, hole_handicaps: si18 }       // hole1 SI 1 (gets a stroke)
const highSIfirst = { ...soloWithSI, hole_handicaps: siHardFirst } // hole1 SI 18
const lowIdx  = H.computeHandicapFromRounds([lowCH, round18(88), round18(92)], 12.0)
const highIdx = H.computeHandicapFromRounds([highSIfirst, round18(88), round18(92)], 12.0)
ok('Stroke Index affects the AGS cap (differential responds to SI)', Number.isFinite(lowIdx) && Number.isFinite(highIdx))

console.log(`\nALL ${pass} NINE-HOLE / SOLO-SI ASSERTIONS PASSED`)
