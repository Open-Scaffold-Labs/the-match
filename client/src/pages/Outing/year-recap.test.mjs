// Self-contained Node test for aggregateYear.
//
// Run from repo root:
//   node client/src/pages/Outing/year-recap.test.mjs
//
// (2026-05-06 — polish task #10 hardening pass.)

import { aggregateYear } from '../../lib/year-recap.js'

let passed = 0
let failed = 0
const fails = []

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { passed++; return }
  failed++
  fails.push({ label, expected: e, actual: a })
}

// Construct a fixture set that spans two years and a few different
// shapes — solo rounds, repeat courses, distinct days, sub-80 mix.
const fixtures = [
  { played_at: '2026-01-15', score: 78, course_par: 72, course_name: 'Augusta National' },
  { played_at: '2026-02-04', score: 82, course_par: 72, course_name: 'Pebble Beach' },
  { played_at: '2026-02-04', score: 88, course_par: 72, course_name: 'Pebble Beach' },  // same day, two rounds
  { played_at: '2026-03-10', score: 76, course_par: 71, course_name: 'Augusta National' },
  { played_at: '2026-04-22', score: 91, course_par: 72, course_name: 'Local Muni' },
  // Prior year — should be excluded from 2026 aggregate.
  { played_at: '2025-10-12', score: 70, course_par: 72, course_name: 'Augusta National' },
]

const r = aggregateYear(fixtures, 2026)

assertEq(r.totalRounds,    5,     '5 rounds in 2026')
assertEq(r.daysOnCourse,   4,     '4 distinct days (two on Feb 4)')
assertEq(r.sub80,          2,     '2 sub-80 rounds (78, 76)')
assertEq(r.best.total,     76,    'best total = 76')
assertEq(r.best.par,       71,    'best par = 71 (best by DIFF, not raw)')
// best DIFF = 76-71 = +5; 78-72=+6; so 76 wins. ✓
assertEq(Number(r.avgScore.toFixed(2)), 83, 'avg = (78+82+88+76+91)/5 = 83')
assertEq(r.topCourse.name,  'Augusta National', 'top course = Augusta')
assertEq(r.topCourse.count, 2,                  'Augusta played 2x in year')

// Empty year returns null.
assertEq(aggregateYear(fixtures, 2024), null, 'no rounds in 2024 → null')

// Empty rounds list
assertEq(aggregateYear([], 2026), null, 'empty input → null')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const f of fails) {
    console.log(`  ✗ ${f.label}\n    expected: ${f.expected}\n    actual:   ${f.actual}`)
  }
  process.exit(1)
}
process.exit(0)
