// Unit tests for THE JOIN — swing × score correlation engine (lib/swingJoin.js).
// Run: node server/src/lib/__tests__/swing-join.test.cjs
const assert = require('node:assert/strict')
const J = require('../swingJoin.js')
let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

// Fixture helpers. One window = 14 days; plant a swing session + rounds in
// each window with controlled tempo/SG relationships.
function mkWindow(i, ratio, sgTotal, { cv = 5, dur = 1200 } = {}) {
  const base = new Date('2025-01-06').getTime() + i * 14 * 86400000
  const d = (off) => new Date(base + off * 86400000).toISOString().slice(0, 10)
  return {
    session: { session_id: 1000 + i, date: d(1), club_slot: '7i', measurable: 3, swings: 3,
               median_tempo_ratio: ratio, median_duration_ms: dur, consistency: cv, confidence: 'usable' },
    rounds: [
      { date: d(3), sgTotal: sgTotal - 0.4, sgT2G: sgTotal - 1.2, sgP: 0.6 + (i % 3) * 0.3 },
      { date: d(9), sgTotal: sgTotal + 0.4, sgT2G: sgTotal - 0.8, sgP: 1.0 + (i % 4) * 0.2 },
    ],
  }
}
function buildSet(specs) {
  const timeline = [], rounds = []
  specs.forEach((s, i) => {
    const w = mkWindow(i, s.ratio, s.sg, { cv: s.cv ?? 5, dur: s.dur ?? 1200 })
    timeline.push(w.session); rounds.push(...w.rounds)
  })
  return { timeline, rounds }
}

// ── windowize ───────────────────────────────────────────────────────────────
{
  const { timeline, rounds } = buildSet([
    { ratio: 3.0, sg: 1.0 }, { ratio: 3.1, sg: 1.2 },
  ])
  const w = J.windowize(timeline, rounds)
  ok('windows pair sessions with rounds', w.length === 2 && w[0].sessions === 1 && w[0].rounds === 2)
  ok('window SG is the round mean', Math.abs(w[0].sg_total - 1.0) < 0.01)
  ok('window carries tempo median', w[0].tempo_ratio === 3.0)

  // A round-only window and a session-only window must NOT pair.
  const lonely = J.windowize(
    [{ session_id: 1, date: '2025-03-01', measurable: 2, swings: 2, median_tempo_ratio: 3.0, median_duration_ms: 1200, consistency: 5 }],
    [{ date: '2025-05-01', sgTotal: 0 }]
  )
  ok('single-stream windows excluded (no invented alignment)', lonely.length === 0)

  // Unmeasurable sessions are skipped.
  const u = J.windowize(
    [{ session_id: 2, date: '2025-03-01', measurable: 0, swings: 2, median_tempo_ratio: null, median_duration_ms: null, consistency: null }],
    [{ date: '2025-03-02', sgTotal: 0 }]
  )
  ok('unmeasurable sessions skipped', u.length === 0)
}

// ── correlate: gates ────────────────────────────────────────────────────────
{
  const { timeline, rounds } = buildSet(Array.from({ length: 5 }, (_, i) => ({ ratio: 2.5 + i * 0.2, sg: i * 0.5 })))
  const g = J.correlate(J.windowize(timeline, rounds))
  ok('below MIN_PAIRS → too_early with honest count', g.status === 'too_early' && g.pairs === 5 && g.needed === 8)
  ok('gated payload carries no correlations', g.correlations.length === 0)
  ok('gated payload still carries the causation disclaimer', /not proof of cause/.test(g.disclaimer))
}

// ── correlate: planted relationships ────────────────────────────────────────
{
  // 12 windows: higher ratio → higher SG (r ≈ +1).
  const specs = Array.from({ length: 12 }, (_, i) => ({ ratio: 2.4 + i * 0.12, sg: -2 + i * 0.5 }))
  const { timeline, rounds } = buildSet(specs)
  const c = J.correlate(J.windowize(timeline, rounds))
  ok('12 windows → ready', c.status === 'ready' && c.pairs === 12)
  const t2g = c.correlations.find((x) => x.metric === 'tempo_ratio' && x.sg === 'sg_t2g')
  ok('planted positive correlation found (r ≈ +1)', t2g && t2g.r > 0.95 && t2g.strength === 'strong')
  ok('sorted strongest first', Math.abs(c.correlations[0].r) >= Math.abs(c.correlations[c.correlations.length - 1].r))
  ok('control dimension (putting) included', c.correlations.some((x) => x.sg === 'sg_p'))

  // Inverse relationship: higher variance (cv) → lower SG.
  const specs2 = Array.from({ length: 12 }, (_, i) => ({ ratio: 3.0, sg: 2 - i * 0.4, cv: 2 + i }))
  const s2 = buildSet(specs2)
  const c2 = J.correlate(J.windowize(s2.timeline, s2.rounds))
  const cvCorr = c2.correlations.find((x) => x.metric === 'consistency' && x.sg === 'sg_total')
  ok('variance tracks negatively with scoring', cvCorr && cvCorr.r < -0.95)
}

// ── worthStrokes ────────────────────────────────────────────────────────────
{
  // 6 in-norm windows (ratio 3.0) scoring +1; 3 quick windows (2.5) scoring -1.5;
  // 3 slow windows (3.5) scoring +0.5. Quick split: good=9 bad=3 → delta 2.5.
  const specs = [
    ...Array.from({ length: 6 }, () => ({ ratio: 3.0, sg: 1.0 })),
    ...Array.from({ length: 3 }, () => ({ ratio: 2.5, sg: -1.5 })),
    ...Array.from({ length: 3 }, () => ({ ratio: 3.5, sg: 0.5 })),
  ]
  const { timeline, rounds } = buildSet(specs)
  const ws = J.worthStrokes(J.windowize(timeline, rounds))
  ok('worth-strokes ready with 12 windows', ws.status === 'ready')
  const quick = ws.splits.find((s) => s.id === 'quick_tempo')
  ok('quick-tempo split found with both sides ≥ MIN_SIDE', !!quick && quick.windows_fault === 3 && quick.windows_good === 9)
  // good side pools the 6 norm windows (+1.0) AND the 3 slow windows (+0.5)
  // → sg_good = 7.5/9 ≈ 0.833; delta = 0.833 − (−1.5) ≈ 2.33
  ok('delta = SG(norm) − SG(fault) ≈ 2.33', Math.abs(quick.delta - 2.33) < 0.05)
  ok('top fault is the quick tempo', ws.top && ws.top.id === 'quick_tempo')
  ok('median norm reported', Math.abs(ws.median_tempo_ratio - 3.0) < 0.15)

  // Honest negatives: if the "fault" side scores BETTER, delta is negative
  // and it cannot be the top fault.
  const specs2 = [
    ...Array.from({ length: 6 }, () => ({ ratio: 3.0, sg: 0.0 })),
    ...Array.from({ length: 4 }, () => ({ ratio: 2.5, sg: 2.0 })),
  ]
  const s2 = buildSet(specs2)
  const ws2 = J.worthStrokes(J.windowize(s2.timeline, s2.rounds))
  const q2 = ws2.splits.find((s) => s.id === 'quick_tempo')
  ok('fault-side-better → negative delta reported honestly', q2 && q2.delta < 0)
  ok('no top fault when faults don\'t track with lost strokes', ws2.top === null || ws2.top.delta > 0)
}

// ── worthStrokes gates ──────────────────────────────────────────────────────
{
  const { timeline, rounds } = buildSet(Array.from({ length: 4 }, (_, i) => ({ ratio: 2.5 + i * 0.3, sg: 0 })))
  const ws = J.worthStrokes(J.windowize(timeline, rounds))
  ok('worth-strokes gated below MIN_PAIRS', ws.status === 'too_early' && ws.splits.length === 0)

  // All-same-ratio windows: no split can form (one side < MIN_SIDE).
  const flat = buildSet(Array.from({ length: 10 }, () => ({ ratio: 3.0, sg: 0 })))
  const wsf = J.worthStrokes(J.windowize(flat.timeline, flat.rounds))
  ok('no variance → no invented splits', wsf.splits.length === 0)
}

// ── prescribe ───────────────────────────────────────────────────────────────
{
  const p = J.prescribe({ id: 'quick_tempo', delta: 2.5 })
  ok('quick tempo → Tour Tempo rehearsal drill', /Tour Tempo/.test(p.drill) && p.category === 'tempo')
  ok('prescription carries the delta + disclaimer', p.delta === 2.5 && /not proof of cause/.test(p.disclaimer))
  ok('null top → no prescription', J.prescribe(null) === null)
  ok('unknown fault → no prescription', J.prescribe({ id: 'mystery' }) === null)
}

console.log(`\nswing-join: ${pass} passed`)
