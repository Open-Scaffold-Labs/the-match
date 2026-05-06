// Self-contained Node test for client/src/lib/side-bets.js.
//
// Run from the repo root with:
//   node client/src/lib/side-bets.test.mjs
//
// Prints PASS/FAIL per scenario; exits 0 on full pass, 1 on any failure.
// Uses plain assertions — keeps the file dependency-free so we can run
// it locally without setting up vitest. (2026-05-06 — polish task #7
// hardening pass.)

import { computeNassau, computeSkins } from './side-bets.js'

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

function assert(cond, label) {
  if (cond) { passed++; return }
  failed++
  fails.push({ label, expected: 'truthy', actual: String(cond) })
}

// ─── Helpers to build a fake outing state ────────────────────────────────

function makeOuting(participants, holes = 18) {
  return {
    holes,
    participants: participants.map(p => ({
      user_id: p.id,
      name:    p.name,
      scores:  p.scores,
      is_guest: p.is_guest || false,
    })),
  }
}

// ─── Nassau scenarios ─────────────────────────────────────────────────────

console.log('\n# Nassau\n')

// Scenario 1: A and B play 18 holes. A wins front 9 by 2, B wins back 9 by 1,
// A wins total 18 by 1. Stakes $5 → A nets $5+0+$5 = $10 from settlement
// (front + total). B wins back 9 → A loses $5. Net A = $5.
{
  const A = { id: 1, name: 'Alice', scores: [4,5,3,4,5,4,3,5,4, 5,4,4,4,5,5,5,4,4] }
  const B = { id: 2, name: 'Bob',   scores: [5,4,4,3,5,4,4,5,5, 4,5,4,5,4,5,5,4,3] }
  const state = makeOuting([A, B])
  const r = computeNassau(state, { stakes: 5, participant_ids: [1, 2] })
  // Front 9 differentials (A view): 4v5=+1, 5v4=-1, 3v4=+1, 4v3=-1, 5v5=0,
  //   4v4=0, 3v4=+1, 5v5=0, 4v5=+1 → cum=+2. A wins front 9.
  assertEq(r.front9.cumDelta,  2, 'F9 cum=+2 (A wins by 2)')
  assertEq(r.front9.holesPlayed, 9, 'F9 settled')
  assertEq(r.front9.leaderId, '1', 'F9 leader = A')
  assert(r.front9.settled, 'F9 settled flag true')
  // Back 9 differentials: 5v4=-1, 4v5=+1, 4v4=0, 4v5=+1, 5v4=-1, 5v5=0,
  //   5v5=0, 4v4=0, 4v3=-1 → cum = -1. B wins back 9.
  assertEq(r.back9.cumDelta, -1, 'B9 cum=-1 (B wins by 1)')
  assertEq(r.back9.leaderId, '2', 'B9 leader = B')
  assert(r.back9.settled, 'B9 settled flag true')
  // Total 18 = front + back = +2 + -1 = +1. A wins.
  assertEq(r.total18.cumDelta, 1, 'T18 cum=+1 (A wins by 1)')
  assertEq(r.total18.leaderId, '1', 'T18 leader = A')
  // Settled dollars: A wins F9 (+5), B wins B9 (A: -5), A wins T18 (+5) = A: +5
  assertEq(r.totalDollars['1'], 5, 'A nets $5')
  assertEq(r.totalDollars['2'], -5, 'B nets -$5')
}

// Scenario 2: Tied front 9 (no money settled). Mid-round (back 9 unsettled).
{
  const A = { id: 1, name: 'Alice', scores: [4,4,4,4,4,4,4,4,4, 0,0,0,0,0,0,0,0,0] }
  const B = { id: 2, name: 'Bob',   scores: [4,4,4,4,4,4,4,4,4, 0,0,0,0,0,0,0,0,0] }
  const state = makeOuting([A, B])
  const r = computeNassau(state, { stakes: 5, participant_ids: [1, 2] })
  assertEq(r.front9.cumDelta, 0, 'tied F9 cum=0')
  assertEq(r.front9.leaderId, null, 'tied F9 leader = null')
  assert(r.front9.settled, 'tied F9 still settled')
  assertEq(r.back9.holesPlayed, 0, 'B9 0 holes played')
  assert(!r.back9.settled, 'B9 not settled')
  // Settled $ — only F9 counts (B9 + T18 unsettled). F9 was a tie → no $.
  assertEq(r.totalDollars['1'], 0, 'tied F9 → $0 settled')
  assertEq(r.totalDollars['2'], 0, 'tied F9 → $0 settled')
}

// Scenario 3: Mid-round, only 5 holes scored. Nothing should be settled.
{
  const A = { id: 1, name: 'Alice', scores: [4,4,4,4,4, 0,0,0,0, 0,0,0,0,0,0,0,0,0] }
  const B = { id: 2, name: 'Bob',   scores: [5,5,5,5,5, 0,0,0,0, 0,0,0,0,0,0,0,0,0] }
  const state = makeOuting([A, B])
  const r = computeNassau(state, { stakes: 5, participant_ids: [1, 2] })
  // 5 holes, A wins all = +5. Front 9 not settled (only 5 of 9 played).
  assertEq(r.front9.cumDelta, 5, 'F9 cum=+5 mid-round')
  assertEq(r.front9.holesPlayed, 5, 'F9 5 holes played')
  assert(!r.front9.settled, 'F9 not settled mid-round')
  assertEq(r.totalDollars['1'], 0, 'unsettled → no $ owed yet')
}

// Scenario 4: Press mid-round.
{
  const A = { id: 1, name: 'Alice', scores: [5,5,5,5,5,5,5,5,5, 4,4,4,4,4,4,4,4,4] }
  const B = { id: 2, name: 'Bob',   scores: [4,4,4,4,4,4,4,4,4, 5,5,5,5,5,5,5,5,5] }
  const state = makeOuting([A, B])
  // B wins all front 9 (cum from A's view = -9). A wins all back 9 (+9). T18 = 0 (tied).
  // Press from hole 9 (0-indexed) — i.e., back 9. Press goes from hole 9 → 18.
  const r = computeNassau(state, {
    stakes: 5, participant_ids: [1, 2],
    presses: [{ start_hole: 9, between_ids: [1, 2] }],
  })
  assertEq(r.front9.cumDelta, -9, 'F9 cum=-9 (B sweep)')
  assertEq(r.back9.cumDelta, 9, 'B9 cum=+9 (A sweep)')
  assertEq(r.total18.cumDelta, 0, 'T18 cum=0 (tied)')
  assertEq(r.presses.length, 1, 'one press')
  assertEq(r.presses[0].cumDelta, 9, 'press cum=+9 (A sweep on press)')
  assertEq(r.presses[0].leaderId, '1', 'press leader = A')
  assert(r.presses[0].settled, 'press settled')
  // Settled $: B wins F9 → A: -5. A wins B9 → A: +5. T18 tied → 0. Press A wins → +5.
  // Net A: +5.
  assertEq(r.totalDollars['1'], 5, 'A nets $5 (B9 + press won, F9 lost, T18 tied)')
}

// Scenario 5: 9-hole outing — back 9 should report 0 holes played, and the
// dollar math must NOT double-count F9 + T18 (which span the same range
// when there are only 9 holes). A wins all 9 → A gets exactly $stakes,
// not 2*$stakes.
{
  const A = { id: 1, name: 'Alice', scores: [4,4,4,4,4,4,4,4,4] }
  const B = { id: 2, name: 'Bob',   scores: [5,5,5,5,5,5,5,5,5] }
  const state = makeOuting([A, B], 9)
  const r = computeNassau(state, { stakes: 5, participant_ids: [1, 2] })
  assertEq(r.front9.cumDelta, 9, '9-hole F9 = +9')
  assertEq(r.back9.cumDelta, 0, '9-hole B9 = 0 (no holes)')
  assertEq(r.back9.holesPlayed, 0, '9-hole B9 played 0')
  // T18 spans 0..9 too — so it's identical to F9 in a 9-hole outing.
  // The settle() must NOT count both. Fix is in computeNassau.
  assertEq(r.totalDollars['1'], 5, '9-hole: A nets $5 (F9 only, no double-count)')
  assertEq(r.totalDollars['2'], -5, '9-hole: B nets -$5')
}

// ─── Skins scenarios ──────────────────────────────────────────────────────

console.log('\n# Skins\n')

// Scenario 1: 4 players, 9 holes, alternating wins + carryovers.
{
  // P1 wins hole 1 outright (4 vs 5,5,5).
  // Hole 2 ties between P1+P2 at 4 → carry $stakes.
  // Hole 3 P3 wins outright with 3 (others 5) → P3 takes 2*stakes.
  // Hole 4-9: all par 4 (everyone ties) → all carry. carry = 6*stakes.
  // pendingValue at end = 6*stakes.
  const P1 = { id: 1, name: 'P1', scores: [4,4,5,4,4,4,4,4,4] }
  const P2 = { id: 2, name: 'P2', scores: [5,4,5,4,4,4,4,4,4] }
  const P3 = { id: 3, name: 'P3', scores: [5,5,3,4,4,4,4,4,4] }
  const P4 = { id: 4, name: 'P4', scores: [5,5,5,4,4,4,4,4,4] }
  const state = makeOuting([P1, P2, P3, P4], 9)
  const r = computeSkins(state, { stakes: 1, participant_ids: [1,2,3,4] })
  assertEq(r.totals['1'].skinsWon, 1, 'P1 won 1 skin')
  assertEq(r.totals['1'].dollars,  1, 'P1 won $1')
  assertEq(r.totals['2'].skinsWon, 0, 'P2 won 0 skins')
  assertEq(r.totals['3'].skinsWon, 1, 'P3 won 1 skin')
  assertEq(r.totals['3'].dollars,  2, 'P3 won $2 (1 + 1 carry)')
  assertEq(r.totals['4'].skinsWon, 0, 'P4 won 0 skins')
  assertEq(r.pendingValue, 6, '6 holes tied at end → $6 pending')
}

// Scenario 2: All 18 holes tied → no skins won, big pending pot.
{
  const P1 = { id: 1, name: 'P1', scores: Array(18).fill(4) }
  const P2 = { id: 2, name: 'P2', scores: Array(18).fill(4) }
  const state = makeOuting([P1, P2])
  const r = computeSkins(state, { stakes: 1, participant_ids: [1, 2] })
  assertEq(r.totals['1'].skinsWon, 0, 'all-tie: 0 skins')
  assertEq(r.totals['2'].skinsWon, 0, 'all-tie: 0 skins')
  assertEq(r.pendingValue, 18, 'all-tie: $18 pending')
}

// Scenario 3: Mid-round, hole 1 unscored. Should not corrupt carry.
{
  const P1 = { id: 1, name: 'P1', scores: [0, 4, 5, 0,0,0,0,0,0] }   // hole 1 unscored
  const P2 = { id: 2, name: 'P2', scores: [0, 4, 4, 0,0,0,0,0,0] }   // hole 2 tied; hole 3 P2 wins
  const state = makeOuting([P1, P2], 9)
  const r = computeSkins(state, { stakes: 2, participant_ids: [1, 2] })
  // Hole 1 unsettled (carry stays 0). Hole 2 tied → carry = $2. Hole 3 P2 wins → P2 gets $2 + carry $2 = $4.
  assertEq(r.perHole[0].settled, false, 'hole 1 unsettled')
  assertEq(r.perHole[1].winnerId, null, 'hole 2 tie')
  assertEq(r.perHole[2].winnerId, '2', 'hole 3 P2 wins')
  assertEq(r.totals['2'].dollars, 4, 'P2 takes $4 ($2 + $2 carry)')
}

// Scenario 4: Carry compounds across multiple consecutive ties.
// Ties on holes 1, 2, 3 (each adds $1 carry). P1 wins hole 4 → takes
// $1 (hole 4) + $3 carry = $4. Carry resets to 0.
{
  const P1 = { id: 1, name: 'P1', scores: [4, 4, 4, 3, 4, 4, 4, 4, 4] }
  const P2 = { id: 2, name: 'P2', scores: [4, 4, 4, 4, 4, 4, 4, 4, 4] }
  const state = makeOuting([P1, P2], 9)
  const r = computeSkins(state, { stakes: 1, participant_ids: [1, 2] })
  assertEq(r.totals['1'].dollars, 4, 'P1 takes $1 + $3 carry = $4')
  assertEq(r.totals['1'].skinsWon, 1, 'P1 won 1 skin')
  // Holes 5-9 all tied → 5 more carry → pendingValue = 5
  assertEq(r.pendingValue, 5, '$5 pending after 5 trailing ties')
}

// Scenario 5: One player with no scores at all (shouldn't crash).
{
  const P1 = { id: 1, name: 'P1', scores: [4,4,4,4,4,4,4,4,4] }
  const P2 = { id: 2, name: 'P2', scores: [] }
  const state = makeOuting([P1, P2], 9)
  const r = computeSkins(state, { stakes: 1, participant_ids: [1, 2] })
  // Every hole: P1 has score, P2 doesn't → unsettled. No skins, no carry.
  assertEq(r.totals['1'].skinsWon, 0, 'P2 absent: no skins awarded')
  assertEq(r.pendingValue, 0, 'P2 absent: no carry accrued')
}

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  for (const f of fails) {
    console.log(`  ✗ ${f.label}`)
    console.log(`    expected: ${f.expected}`)
    console.log(`    actual:   ${f.actual}`)
  }
  process.exit(1)
}
process.exit(0)
