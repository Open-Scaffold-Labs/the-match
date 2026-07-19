// Unit tests for the LLM narrator prompt block (lib/swingNarrator.js).
// Run: node server/src/lib/__tests__/swing-narrator.test.cjs
const assert = require('node:assert/strict')
const N = require('../swingNarrator.js')
let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

const tl = [
  { session_id: 1, date: '2025-05-01', measurable: 3, swings: 3, median_tempo_ratio: 2.8, median_duration_ms: 1150, consistency: 6.2 },
  { session_id: 2, date: '2025-06-01', measurable: 4, swings: 4, median_tempo_ratio: 3.1, median_duration_ms: 1210, consistency: 4.8 },
]
const eras = [
  { from: '2025-01-01', to: '2025-04-15', points: 4, median_tempo_ratio: 2.4, label: 'Quickened era' },
  { from: '2025-05-01', to: '2025-06-01', points: 5, median_tempo_ratio: 3.0, label: 'Tour-tempo era' },
]

// ── empty inputs → no narration ─────────────────────────────────────────────
ok('empty timeline → empty block (nothing to narrate)', N.factsPromptBlock({}) === '')
ok('all-unmeasurable timeline → empty block',
   N.factsPromptBlock({ timeline: [{ measurable: 0, median_tempo_ratio: null }] }) === '')

// ── facts present ───────────────────────────────────────────────────────────
const block = N.factsPromptBlock({ timeline: tl, eras })
ok('carries latest measured numbers', /3\.1:1 tempo, 1210ms/.test(block))
ok('carries tempo range', /2\.8:1 to 3\.1:1/.test(block))
ok('carries era shift', /Quickened era 2\.4:1/.test(block) && /Tour-tempo era 3:1/.test(block))
ok('single-era case says no shift',
   /no shift detected/.test(N.factsPromptBlock({ timeline: tl, eras: [eras[1]] })))

// ── join framing: correlation, never cause ──────────────────────────────────
const joined = N.factsPromptBlock({
  timeline: tl, eras,
  join: { worth_strokes: { status: 'ready', top: { label: 'Quick tempo windows', delta: 2.3, windows_fault: 3, windows_good: 9 } } },
})
ok('worth-strokes included with MANDATORY correlation framing', /ASSOCIATION ONLY/.test(joined) && /never cause/i.test(joined))

const gated = N.factsPromptBlock({
  timeline: tl, eras,
  join: { worth_strokes: { status: 'too_early', pairs: 3, needed: 8 } },
})
ok('gated join forbids scoring speculation', /Do NOT speculate about scoring impact/.test(gated))
ok('gated join carries honest counts', /3\/8/.test(gated))

// ── ball data ───────────────────────────────────────────────────────────────
const withBall = N.factsPromptBlock({
  timeline: tl, eras,
  ball: [{ club_speed: 98, carry: 240 }, { club_speed: 101, carry: 248 }, { club_speed: null, carry: null }],
})
ok('ball data range included, nulls skipped', /club speed 98–101 mph over 2 entries/.test(withBall))

// ── fabrication guards ──────────────────────────────────────────────────────
ok('forbids inventing unmeasured faults', /NOT measured/.test(block) && /clubface/.test(block))
ok('never-add-metrics instruction present', /never add metrics/i.test(block))

console.log(`\nswing-narrator: ${pass} passed`)
