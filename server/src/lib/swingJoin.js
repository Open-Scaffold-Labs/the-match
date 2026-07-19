// Swing Intelligence V2 — THE JOIN (spec: wiki/synthesis/
// swing-intelligence-build-spec-2026-07-16.md §Pipeline.6 + §Worth-strokes).
//
// The moat: swing metrics × scoring co-movement. Nobody else joins swing
// video to strokes gained — 18Birdies has both halves, unjoined.
//
// Method: bucket the player's swing sessions and rounds into rolling
// windows; correlate windowed tempo stats against windowed SG; rank tempo
// faults by the SG delta between in-band and out-of-band windows
// ("worth strokes" — faults ordered by scoring impact, not by distance
// from a Platonic ideal).
//
// HONESTY CONTRACT (the spec's core rule, enforced here mechanically):
//   1. ASSOCIATION, NEVER CAUSATION. Every payload carries the disclaimer;
//      labels say "tracks with", never "costs you".
//   2. Sample gates: MIN_PAIRS windows for any correlation; MIN_SIDE
//      windows on EACH side of a worth-strokes split. Below the gate →
//      status 'too_early' with the honest count, never a weak claim.
//   3. Only windows containing BOTH a swing session and a round pair the
//      two streams — no invented alignment across gaps.
//
// Pure functions only. routes/swing.js feeds it timeline points (from
// lib/swingTimeline.buildTimeline) and per-round SG (from lib/sg.roundSG).

const round2 = (x) => Math.round(x * 100) / 100
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

const MIN_PAIRS = 8   // windows before ANY correlation is reported
const MIN_SIDE = 3    // windows per side of a worth-strokes split
const WINDOW_DAYS = 14

const CAUSATION_DISCLAIMER =
  'These are associations in your own data, not proof of cause. The trend is real even when the reason is unknown.'

// ── windowing ───────────────────────────────────────────────────────────────

const dayMs = 86_400_000
function windowKey(dateStr) {
  const t = new Date(dateStr).getTime()
  if (isNaN(t)) return null
  return Math.floor(t / (WINDOW_DAYS * dayMs))
}

/**
 * Pair swing sessions with rounds into shared time windows.
 * @param {Array} timeline  from swingTimeline.buildTimeline (date, medians,
 *                          consistency, measurable)
 * @param {Array} sgRounds  [{ date, sgTotal, sgT2G, sgP }] (nulls allowed)
 * @returns {Array<{ window:number, from:string,
 *                   tempo_ratio, duration_ms, consistency,      // medians/null
 *                   sg_total, sg_t2g, sg_p,                     // means/null
 *                   sessions:number, rounds:number }>}
 *   Only windows with BOTH streams present are returned, sorted by time.
 */
function windowize(timeline, sgRounds) {
  const wins = new Map()
  const wk = (k) => {
    if (!wins.has(k)) wins.set(k, { window: k, ratios: [], durations: [], cvs: [], sgT: [], sgT2G: [], sgP: [], sessions: 0, rounds: 0, minT: Infinity })
    return wins.get(k)
  }
  for (const p of timeline || []) {
    if (!p.measurable) continue
    const k = windowKey(p.date)
    if (k == null) continue
    const w = wk(k)
    w.sessions++
    w.minT = Math.min(w.minT, new Date(p.date).getTime())
    if (p.median_tempo_ratio != null) w.ratios.push(p.median_tempo_ratio)
    if (p.median_duration_ms != null) w.durations.push(p.median_duration_ms)
    if (p.consistency != null) w.cvs.push(p.consistency)
  }
  for (const r of sgRounds || []) {
    const k = windowKey(r.date)
    if (k == null) continue
    const w = wk(k)
    w.rounds++
    w.minT = Math.min(w.minT, new Date(r.date).getTime())
    if (r.sgTotal != null) w.sgT.push(r.sgTotal)
    if (r.sgT2G != null) w.sgT2G.push(r.sgT2G)
    if (r.sgP != null) w.sgP.push(r.sgP)
  }
  const med = (xs) => {
    if (!xs.length) return null
    const s = xs.slice().sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  return [...wins.values()]
    .filter((w) => w.sessions > 0 && w.rounds > 0 && w.ratios.length > 0 && w.sgT.length > 0)
    .sort((a, b) => a.window - b.window)
    .map((w) => ({
      window: w.window,
      from: new Date(w.minT).toISOString().slice(0, 10),
      tempo_ratio: round2(med(w.ratios)),
      duration_ms: med(w.durations) != null ? Math.round(med(w.durations)) : null,
      consistency: w.cvs.length ? round2(med(w.cvs)) : null,
      sg_total: round2(mean(w.sgT)),
      sg_t2g: w.sgT2G.length ? round2(mean(w.sgT2G)) : null,
      sg_p: w.sgP.length ? round2(mean(w.sgP)) : null,
      sessions: w.sessions,
      rounds: w.rounds,
    }))
}

// ── correlation ─────────────────────────────────────────────────────────────

function pearson(xs, ys) {
  const n = xs.length
  if (n < 3) return null
  const mx = mean(xs), my = mean(ys)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  if (sxx < 1e-12 || syy < 1e-12) return null
  return sxy / Math.sqrt(sxx * syy)
}

function strength(r) {
  const a = Math.abs(r)
  return a >= 0.6 ? 'strong' : a >= 0.35 ? 'moderate' : 'weak'
}

// What we correlate. SG:T2G is the swing-relevant dimension (tee-to-green);
// SG:Total is the headline. Putting is included as a CONTROL — tempo
// shouldn't track putting; if it does, something's confounded and we say so.
const METRICS = [
  { key: 'tempo_ratio', label: 'tempo ratio', unit: ':1' },
  { key: 'duration_ms', label: 'swing duration', unit: 'ms' },
  { key: 'consistency', label: 'tempo variance', unit: '%' },
]
const SG_DIMS = [
  { key: 'sg_t2g', label: 'SG tee-to-green' },
  { key: 'sg_total', label: 'SG total' },
  { key: 'sg_p', label: 'SG putting (control)' },
]

/**
 * Correlate windowed swing metrics against windowed SG.
 * @returns {{ status:'ready'|'too_early', pairs:number, needed:number,
 *             correlations:Array, disclaimer:string }}
 */
function correlate(windows) {
  const w = (windows || []).filter((x) => x.tempo_ratio != null && x.sg_total != null)
  if (w.length < MIN_PAIRS) {
    return { status: 'too_early', pairs: w.length, needed: MIN_PAIRS, correlations: [], disclaimer: CAUSATION_DISCLAIMER }
  }
  const out = []
  for (const m of METRICS) {
    for (const d of SG_DIMS) {
      const pts = w.filter((x) => x[m.key] != null && x[d.key] != null)
      if (pts.length < MIN_PAIRS) continue
      const r = pearson(pts.map((x) => x[m.key]), pts.map((x) => x[d.key]))
      if (r == null) continue
      out.push({
        metric: m.key, metric_label: m.label, sg: d.key, sg_label: d.label,
        r: round2(r), n: pts.length, strength: strength(r),
        direction: r > 0 ? 'higher tracks better' : 'higher tracks worse',
      })
    }
  }
  out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
  return { status: 'ready', pairs: w.length, needed: MIN_PAIRS, correlations: out, disclaimer: CAUSATION_DISCLAIMER }
}

// ── worth-strokes ranking ───────────────────────────────────────────────────

/**
 * Rank tempo faults by associated SG delta (the spec's "worth strokes"
 * ranking). Split windows on each fault condition; the delta is
 * mean(SG in-band) − mean(SG fault). Gates: MIN_SIDE per side.
 *
 * @returns {{ status, splits:Array, top: ?object, disclaimer }}
 */
function worthStrokes(windows) {
  const w = (windows || []).filter((x) => x.tempo_ratio != null && x.sg_total != null)
  const empty = { status: 'too_early', splits: [], top: null, disclaimer: CAUSATION_DISCLAIMER }
  if (w.length < MIN_PAIRS) return { ...empty, pairs: w.length, needed: MIN_PAIRS }

  const ratios = w.map((x) => x.tempo_ratio).sort((a, b) => a - b)
  const medRatio = ratios[Math.floor(ratios.length / 2)]
  const cvs = w.filter((x) => x.consistency != null).map((x) => x.consistency)
  const medCv = cvs.length ? cvs.slice().sort((a, b) => a - b)[Math.floor(cvs.length / 2)] : null

  const split = (id, label, isFault, goodLabel, faultLabel) => {
    const good = w.filter((x) => !isFault(x))
    const bad = w.filter(isFault)
    if (good.length < MIN_SIDE || bad.length < MIN_SIDE) return null
    const delta = round2(mean(good.map((x) => x.sg_total)) - mean(bad.map((x) => x.sg_total)))
    return {
      id, label, delta, // +delta: fault windows score WORSE by delta strokes
      windows_good: good.length, windows_fault: bad.length,
      good_label: goodLabel, fault_label: faultLabel,
      sg_good: round2(mean(good.map((x) => x.sg_total))),
      sg_fault: round2(mean(bad.map((x) => x.sg_total))),
    }
  }

  const splits = [
    split('quick_tempo', 'Quick tempo windows',
      (x) => x.tempo_ratio < medRatio - 0.25,
      `tempo near your ${round2(medRatio)}:1 norm`, 'tempo rushed (≤ −0.25)'),
    split('slow_tempo', 'Long-simmer tempo windows',
      (x) => x.tempo_ratio > medRatio + 0.25,
      `tempo near your ${round2(medRatio)}:1 norm`, 'tempo stretched (≥ +0.25)'),
    medCv != null && split('loose_tempo', 'Loose tempo windows',
      (x) => x.consistency != null && x.consistency > medCv + 2,
      `variance under ${round2(medCv)}%`, `variance above ${round2(medCv + 2)}%`),
  ].filter(Boolean)

  // +delta = fault side scores worse. Rank by positive delta (faults that
  // track with lost strokes first); keep negatives (the "fault" side
  // actually scored BETTER — we report that too, honestly).
  splits.sort((a, b) => b.delta - a.delta)
  return {
    status: splits.length ? 'ready' : 'too_early',
    pairs: w.length, needed: MIN_PAIRS,
    median_tempo_ratio: round2(medRatio),
    splits,
    top: splits.find((s) => s.delta > 0) || null,
    disclaimer: CAUSATION_DISCLAIMER,
  }
}

// ── drill prescriptions ─────────────────────────────────────────────────────

// Maps the top worth-strokes fault to a practice prescription. Categories
// align with lib/practice.js so a later merge can route drills through the
// existing practice runner.
const PRESCRIPTIONS = {
  quick_tempo: {
    category: 'tempo',
    drill: 'Tour Tempo rehearsal',
    how: 'Five rehearsal swings counting "one-two-three" back, "one" through — then step in and hit within ten seconds. Three balls, full commitment.',
    why: 'Your rushed-tempo windows track with worse scoring in your own data.',
  },
  slow_tempo: {
    category: 'tempo',
    drill: 'Continuous-motion swings',
    how: 'Ten swings with NO pause at the top — start the downswing as the club is still going back (Step-change drill). Then normal swings, keeping the flow.',
    why: 'Your stretched-tempo windows track with worse scoring in your own data.',
  },
  loose_tempo: {
    category: 'focus',
    drill: 'Metronome ladder',
    how: 'Film five swings at one target, one ball per minute, same rehearsal every time. Goal: three of five inside your usual duration ±50ms.',
    why: 'Your high-variance windows track with worse scoring in your own data.',
  },
}

function prescribe(topSplit) {
  if (!topSplit || !PRESCRIPTIONS[topSplit.id]) return null
  return { ...PRESCRIPTIONS[topSplit.id], delta: topSplit.delta, disclaimer: CAUSATION_DISCLAIMER }
}

module.exports = { windowize, correlate, worthStrokes, prescribe, MIN_PAIRS, MIN_SIDE, WINDOW_DAYS, CAUSATION_DISCLAIMER }
