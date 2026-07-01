// Self-contained Node test for client/src/lib/geo.js.
//
// Run from the repo root with:
//   node client/src/lib/geo.test.mjs
//
// Prints PASS/FAIL per scenario; exits 0 on full pass, 1 on any failure.
// Dependency-free (matches side-bets.test.mjs / handicap-milestone.test.mjs).
// (2026-06-06 — Eagle Eye next-level: proven math core for F/C/B + plays-like.)

import { haversineYards, calcBearing, computePlaysLike, polygonCentroid, greenFCB, matchPolygonsToHoles, estimateAltFromPressure } from './geo.js'

let passed = 0, failed = 0
const fails = []
function assert(cond, label) { if (cond) { passed++; return } failed++; fails.push(label) }
function near(actual, expected, tol, label) {
  const ok = actual != null && Math.abs(actual - expected) <= tol
  if (ok) { passed++; return }
  failed++; fails.push(`${label} — expected ~${expected}±${tol}, got ${actual}`)
}

// ── haversineYards ──
// 0.001° latitude ≈ 111.32 m ≈ 121.8 yd.
near(haversineYards({ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 }), 122, 3, 'haversine 0.001 lat ≈ 122y')
assert(haversineYards(null, { lat: 1, lon: 1 }) === null, 'haversine null input → null')
assert(haversineYards({ lat: 5, lon: 5 }, { lat: 5, lon: 5 }) === 0, 'haversine same point → 0')

// ── calcBearing ──
near(calcBearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 0, 1, 'bearing due north ≈ 0')
near(calcBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90, 1, 'bearing due east ≈ 90')
near(calcBearing({ lat: 0, lon: 0 }, { lat: -1, lon: 0 }), 180, 1, 'bearing due south ≈ 180')

// ── computePlaysLike (rebuilt 2026-06-30: sourced, asymmetric coefficients) ──
// Wind is ASYMMETRIC: headwind +1%/mph, tailwind −0.5%/mph (~2:1, Trackman).
// Headwind: 150y, 20mph from N (0°), shot due N (0°) → +1%·20·150 = +30.
near(computePlaysLike(150, { windSpeed: 20, windFromDeg: 0, shotBearing: 0, tempF: 70, altFt: 0 }).adj, 30, 1, 'headwind 20mph → +30')
// Tailwind: shot due S (180°) → −0.5%·20·150 = −15 (half the headwind).
near(computePlaysLike(150, { windSpeed: 20, windFromDeg: 0, shotBearing: 180, tempF: 70, altFt: 0 }).adj, -15, 1, 'tailwind 20mph → −15 (asymmetric)')
// The 2:1 asymmetry, explicitly: |headwind| === 2·|tailwind|.
assert(Math.abs(computePlaysLike(150, { windSpeed: 20, windFromDeg: 0, shotBearing: 0 }).factors.wind)
       === 2 * Math.abs(computePlaysLike(150, { windSpeed: 20, windFromDeg: 0, shotBearing: 180 }).factors.wind),
       'headwind hurts ~2× as much as tailwind helps')
// Crosswind: shot due E (90°) → along-component ≈ 0 → no distance change.
near(computePlaysLike(150, { windSpeed: 20, windFromDeg: 0, shotBearing: 90, tempF: 70, altFt: 0 }).adj, 0, 1, 'crosswind ≈ 0 distance')
// Cold: 50°F, no wind → ((70−50)/10)·0.8%·150 = +2.4 → +2.
near(computePlaysLike(150, { tempF: 50, altFt: 0 }).adj, 2, 1, 'cold 50°F → +2')
// Altitude: 5000 ft → −5·1.16%·150 ≈ −9 (was the folk 2% = −15).
near(computePlaysLike(150, { tempF: 70, altFt: 5000 }).adj, -9, 1, 'altitude 5000ft → −9')
// Elevation asymmetry: uphill full (1yd/3ft), downhill ~⅔.
near(computePlaysLike(150, { elevDeltaFt: 30 }).adj, 10, 1, 'uphill +30ft → +10')
near(computePlaysLike(150, { elevDeltaFt: -30 }).adj, -7, 1, 'downhill −30ft → −7 (smaller than uphill)')
// Cap: a garbage 100mph wind can't blow past +40% (App-Store robustness).
assert(computePlaysLike(150, { windSpeed: 100, windFromDeg: 0, shotBearing: 0 }).factors.wind === 60, 'extreme wind capped at +40% (60 on 150)')
// Realism regression — the hole-6 case (335y, 9mph tailwind, 90°F) that was an
// absurd −36 under the old symmetric model; with the carry cap now ≈ −15
// (wind/temp scale on min(335,250)=250, not the full 335).
near(computePlaysLike(335, { windSpeed: 9, windFromDeg: 180, shotBearing: 0, tempF: 90, altFt: 0 }).adj, -15, 2, 'hole-6: 335y/9mph tail/90°F ≈ −15 (was −36)')
// Carry cap: wind/air-density scale on min(dist,250), so a long-hole number
// can't balloon. 400y @ 15mph head → wind on 250 = +37.5 (flat-on-400 was +60).
assert(computePlaysLike(400, { windSpeed: 15, windFromDeg: 0, shotBearing: 0 }).factors.wind === 250 * 0.01 * 15, 'wind scales on capped carry (250), not full 400')
// Approach shots (≤250) are unaffected by the cap — 200y matches uncapped.
assert(computePlaysLike(200, { windSpeed: 10, windFromDeg: 0, shotBearing: 0 }).factors.wind === 200 * 0.01 * 10, 'approach ≤250 unchanged by cap')
assert(computePlaysLike(0).adj === 0, 'plays-like zero base → 0 adj')

// ── estimateAltFromPressure ──
near(estimateAltFromPressure(1013.25), 0, 5, 'altitude at sea-level pressure ≈ 0')
assert(estimateAltFromPressure(null) === 0, 'altitude no pressure → 0')
near(estimateAltFromPressure(845), 4950, 250, 'altitude ~845 hPa ≈ 5000 ft (Denver)')

// ── polygonCentroid ──
const square = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, { lat: 0.001, lon: 0.001 }, { lat: 0.001, lon: 0 }]
const cen = polygonCentroid(square)
near(cen.lat, 0.0005, 1e-6, 'centroid lat'); near(cen.lon, 0.0005, 1e-6, 'centroid lon')
assert(polygonCentroid([]) === null, 'centroid empty → null')

// ── greenFCB ──
// Player due south of a small square green; front (south edge) < center < back (north edge).
const player = { lat: -0.002, lon: 0.0005 }
const fcb = greenFCB(player, square, cen)
assert(fcb && fcb.front < fcb.center && fcb.center < fcb.back, 'F/C/B ordering front<center<back')
assert(greenFCB(player, square.slice(0, 2), cen) === null, 'F/C/B <3 vertices → null')
assert(greenFCB(null, square, cen) === null, 'F/C/B no player → null')

// ── matchPolygonsToHoles ──
// Two greens far apart; two hole centers near each; a decoy far green unassigned.
const greenA = [{ lat: 10, lon: 10 }, { lat: 10, lon: 10.001 }, { lat: 10.001, lon: 10.0005 }]
const greenB = [{ lat: 20, lon: 20 }, { lat: 20, lon: 20.001 }, { lat: 20.001, lon: 20.0005 }]
const decoy = [{ lat: 50, lon: 50 }, { lat: 50, lon: 50.001 }, { lat: 50.001, lon: 50.0005 }]
const centersByHole = { 1: polygonCentroid(greenA), 2: polygonCentroid(greenB) }
const matched = matchPolygonsToHoles(centersByHole, [greenB, decoy, greenA], 40)
assert(matched['1'] === greenA, 'hole 1 → greenA')
assert(matched['2'] === greenB, 'hole 2 → greenB')
// A hole whose center is far from every polygon stays unassigned.
const farCenters = { 9: { lat: 80, lon: 80 } }
assert(Object.keys(matchPolygonsToHoles(farCenters, [greenA, greenB], 40)).length === 0, 'far hole → unassigned (no false match)')

// ── report ──
console.log(`\ngeo.js tests: ${passed} passed, ${failed} failed`)
if (failed) { console.log('FAILURES:'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1) }
else { console.log('ALL PASS'); process.exit(0) }
