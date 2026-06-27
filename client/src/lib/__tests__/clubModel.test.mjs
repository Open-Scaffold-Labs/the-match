// Unit tests for arcClubs (Eagle Eye own-club distance arcs).
// Run: node client/src/lib/__tests__/clubModel.test.mjs
import assert from 'node:assert/strict'
import { arcClubs } from '../clubModel.js'

let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

// Matt's real bag (realBag() shape): long → short.
const bag = [
  { slot: 'driver', label: 'Driver', yards: 290 },
  { slot: '3w', label: '3W', yards: 250 },
  { slot: 'iron_5', label: '5i', yards: 205 },
  { slot: 'iron_6', label: '6i', yards: 195 },
  { slot: 'iron_7', label: '7i', yards: 185 },
  { slot: 'iron_8', label: '8i', yards: 175 },
  { slot: 'iron_9', label: '9i', yards: 165 },
  { slot: 'pw', label: 'PW', yards: 155 },
  { slot: 'gw', label: 'GW', yards: 135 },
  { slot: 'lw', label: 'LW', yards: 110 },
]

// Empty bag → nothing (never fabricate).
ok('empty bag → []', arcClubs([], 150).length === 0)

// 150-yard approach: short clubs that fit + the club that covers it; PW highlighted.
const a150 = arcClubs(bag, 150)
ok('approach 150 returns a usable set (1..6)', a150.length >= 1 && a150.length <= 6)
ok('approach 150 highlights the best match (PW)', a150.find(c => c.highlight)?.slot === 'pw')
ok('approach 150 does NOT include clubs that fly well past (no driver)', !a150.some(c => c.slot === 'driver'))
ok('approach 150 includes the short clubs that land in', a150.some(c => c.slot === 'lw') && a150.some(c => c.slot === 'gw'))

// Tee shot on a long hole: every club reaches short → thinned to <=6, driver longest.
const a400 = arcClubs(bag, 400)
ok('tee 400 thinned to <=6 arcs', a400.length <= 6 && a400.length >= 1)
ok('tee 400 keeps the longest club (driver)', a400.some(c => c.slot === 'driver'))
ok('tee 400 keeps the shortest club (lw)', a400.some(c => c.slot === 'lw'))
ok('tee 400 highlights the club nearest the distance (driver)', a400.find(c => c.highlight)?.slot === 'driver')

// Unknown distance → whole bag, thinned, no highlight forced.
const aNull = arcClubs(bag, null)
ok('null distance → up to 6 arcs (whole bag thinned)', aNull.length <= 6 && aNull.length >= 1)

// Always sorted long → short for stable draw order.
const sorted = a400.every((c, i, arr) => i === 0 || arr[i - 1].yards >= c.yards)
ok('arcs sorted long → short', sorted)

// Every returned arc carries label + positive yardage.
ok('every arc has a label + positive yards', a150.every(c => typeof c.label === 'string' && c.yards > 0))

console.log(`\nALL ${pass} ARC-CLUBS ASSERTIONS PASSED`)
