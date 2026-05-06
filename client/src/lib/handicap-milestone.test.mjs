// Node test for computeHandicapMilestone.
//   node client/src/lib/handicap-milestone.test.mjs
// (2026-05-06 polish task #6 hardening pass.)

import { computeHandicapMilestone } from './handicap-milestone.js'

let passed = 0
let failed = 0
const fails = []

function assertEq(actual, expected, label) {
  if (actual === expected) { passed++; return }
  failed++
  fails.push({ label, expected, actual })
}

// 1. Personal best — newest is unique minimum across 3+ rounds.
assertEq(
  computeHandicapMilestone([
    { score: 78 }, { score: 82 }, { score: 85 },
  ]),
  'New personal best — 78.',
  'PB: newest 78 is min of [78,82,85]'
)

// 1b. PB skipped when minimum is tied (not unique).
assertEq(
  computeHandicapMilestone([
    { score: 78 }, { score: 78 }, { score: 85 },
  ]),
  // No PB (tied), no first-sub-80 (prior was sub-80 too), trend skip
  // (only 3 rounds), steady skip (only 3). Should return null.
  null,
  'PB tied → skip; no other signal applies → null'
)

// 2. First sub-80 — newest < 80, all prior >= 80. Personal-best
//    check ALSO triggers here (78 is unique min) so the result is
//    "New personal best" by priority. (PB beats first-sub-80 as
//    designed — both are true, the more notable one wins.)
assertEq(
  computeHandicapMilestone([
    { score: 78 }, { score: 90 },
  ]),
  // Length 2 — PB needs >= 3, first sub-80 fires.
  'First sub-80 round in the books — 78.',
  'First sub-80: 78 with prior 90'
)

// 2b. First sub-80 skipped when prior was already sub-80.
assertEq(
  computeHandicapMilestone([
    { score: 79 }, { score: 78 }, { score: 90 },
  ]),
  null,  // PB skipped (78 < 79), first-sub-80 skipped (78 was already sub-80), trend skip (need 6).
  'No first sub-80 when prior round was already sub-80'
)

// 3. Improvement when NOT also a PB — PB beats trend by priority,
//    so to test the trend label we need a case where the newest
//    score is NOT a unique minimum.
assertEq(
  computeHandicapMilestone([
    { score: 82 }, { score: 88 }, { score: 88 }, { score: 88 }, { score: 88 }, { score: 80 }, // 80 was old PB
  ]),
  // PB skipped (82 not unique min — there's a 80 deeper in history).
  // Trend: prior5 avg = (88+88+88+88+80)/5 = 86.4. Delta = 82-86.4 = -4.4.
  'Down 4.4 strokes vs your prior 5.',
  'Improvement when not a PB: 82 vs prior5 avg 86.4 → -4.4'
)

// 3b. PB beats trend by priority — when newest is BOTH a PB AND
//     a big improvement, PB wins.
assertEq(
  computeHandicapMilestone([
    { score: 80 }, { score: 88 }, { score: 88 }, { score: 88 }, { score: 88 }, { score: 88 },
  ]),
  'New personal best — 80.',
  'Priority: PB wins when both PB + trend would fire'
)

// 4. Decline — newest +2 over prior 5 avg.
assertEq(
  computeHandicapMilestone([
    { score: 90 }, { score: 88 }, { score: 88 }, { score: 88 }, { score: 88 }, { score: 88 },
  ]),
  'Up 2.0 strokes vs your prior 5 — practice mode?',
  'Decline: 90 vs prior5 avg 88 → +2'
)

// 5. Steady — 5 rounds within 2 strokes.
assertEq(
  computeHandicapMilestone([
    { score: 85 }, { score: 84 }, { score: 86 }, { score: 85 }, { score: 87 },
  ]),
  // PB: 84 unique min but newest is 85, not the min — PB skipped.
  // Trend skipped (length=5, need 6). Steady: 87-84=3, NOT within 2 — skip.
  null,
  'Steady spread of 3 → null (rule is ≤ 2)'
)

assertEq(
  computeHandicapMilestone([
    { score: 85 }, { score: 84 }, { score: 86 }, { score: 85 }, { score: 86 },
  ]),
  // Spread = 86-84 = 2 ≤ 2 → steady fires.
  'Steady — last 5 rounds within 2 strokes.',
  'Steady spread of 2 → steady label'
)

// Edge cases
assertEq(computeHandicapMilestone([]), null, 'empty → null')
assertEq(computeHandicapMilestone([{ score: 80 }]), null, '1 round → null')
assertEq(computeHandicapMilestone([{ score: 0 }, { score: 80 }]), null, '0 score filtered → 1 valid → null')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const f of fails) {
    console.log(`  ✗ ${f.label}\n    expected: ${JSON.stringify(f.expected)}\n    actual:   ${JSON.stringify(f.actual)}`)
  }
  process.exit(1)
}
process.exit(0)
