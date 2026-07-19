// Swing Intelligence V0 — Swing Timeline (read-time assembly + era detection).
//
// Turns tm_swing_sessions + tm_swings rows into the longitudinal surface
// (spec: wiki/synthesis/swing-intelligence-build-spec-2026-07-16.md §Surfaces):
// one point per session (median tempo/duration via swingTempo.summarize),
// plus ERA DETECTION — the archive-import onboarding hook ("the flat-
// backswing era"). For V0 the only measured dimensions are tempo_ratio and
// duration_ms, so eras are tempo eras; pose dimensions join in V1 without
// changing this contract (each era already carries a `metrics` bag).
//
// Honesty contract: eras need ENOUGH points on both sides of a change to be
// claimed (MIN_ERA_SESSIONS), the change must exceed a noise-scaled threshold,
// and sessions with no measurable swings are skipped — never interpolated.
//
// Pure functions only — no DB, no IO. routes/swing.js feeds it rows.

const { summarize } = require('./swingTempo.js')

const round1 = (x) => Math.round(x * 10) / 10
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const stdev = (xs) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))))
}

const MIN_ERA_SESSIONS = 3   // measurable sessions on EACH side of a boundary

/**
 * Build one timeline point per session from joined DB rows.
 * @param {Array} rows — tm_swings joined to tm_swing_sessions, any order;
 *   each: { session_id, date, club_slot, duration_ms, tempo_ratio }
 * @returns {Array<{ session_id, date, club_slot, measurable, swings,
 *                   median_duration_ms, median_tempo_ratio, consistency,
 *                   confidence }>} sorted by date ascending
 */
function buildTimeline(rows) {
  const bySession = new Map()
  for (const r of rows || []) {
    if (!bySession.has(r.session_id)) {
      bySession.set(r.session_id, { session_id: r.session_id, date: r.date, club_slot: r.club_slot || null, swings: [] })
    }
    bySession.get(r.session_id).swings.push({
      detectable: r.duration_ms != null && r.tempo_ratio != null,
      duration_ms: r.duration_ms,
      tempo_ratio: r.tempo_ratio != null ? Number(r.tempo_ratio) : null,
    })
  }
  return [...bySession.values()]
    .map((s) => {
      const sum = summarize(s.swings)
      return {
        session_id: s.session_id,
        date: s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date).slice(0, 10),
        club_slot: s.club_slot,
        measurable: sum.measurable,
        swings: sum.swings,
        median_duration_ms: sum.median_duration_ms,
        median_tempo_ratio: sum.median_tempo_ratio,
        consistency: sum.consistency,
        confidence: sum.confidence,
      }
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}

/**
 * Detect tempo eras across a timeline (change-point detection).
 *
 * For each candidate boundary between consecutive MEASURABLE points, compare
 * the windowed medians on both sides. A boundary is an era break when the
 * shift in median tempo_ratio exceeds max(0.3, 2× the combined window noise)
 * — below that it's practice-week variance, not an era ("too early to tell"
 * doctrine: no invented significance).
 *
 * @returns {Array<{ from, to, points, median_tempo_ratio, median_duration_ms,
 *                   label }>} chronological eras; single 'era' when no break
 *   qualifies, empty when nothing is measurable.
 */
function detectEras(timeline) {
  const pts = (timeline || []).filter((p) => p.measurable > 0 && p.median_tempo_ratio != null)
  if (!pts.length) return []

  // Sliding windows re-detect the SAME boundary at adjacent indexes, so:
  // collect all candidates, then greedily accept strongest-shift-first,
  // requiring accepted breaks to sit at least 2×MIN_ERA_SESSIONS apart.
  const candidates = []
  for (let i = MIN_ERA_SESSIONS; i <= pts.length - MIN_ERA_SESSIONS; i++) {
    const left = pts.slice(Math.max(0, i - MIN_ERA_SESSIONS * 2), i)
    const right = pts.slice(i, i + MIN_ERA_SESSIONS * 2)
    const medL = median(left.map((p) => p.median_tempo_ratio))
    const medR = median(right.map((p) => p.median_tempo_ratio))
    const noise = (stdev(left.map((p) => p.median_tempo_ratio)) + stdev(right.map((p) => p.median_tempo_ratio))) / 2
    if (Math.abs(medR - medL) > Math.max(0.3, 2 * noise)) {
      candidates.push({ index: i, shift: round1(medR - medL) })
    }
  }
  const breaks = []
  for (const c of candidates.sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift) || a.index - b.index)) {
    if (breaks.every((b) => Math.abs(b.index - c.index) >= MIN_ERA_SESSIONS * 2)) breaks.push(c)
  }
  breaks.sort((a, b) => a.index - b.index)

  const bounds = [0, ...breaks.map((b) => b.index), pts.length]
  const eras = []
  for (let k = 0; k < bounds.length - 1; k++) {
    const seg = pts.slice(bounds[k], bounds[k + 1])
    const ratios = seg.map((p) => p.median_tempo_ratio)
    const durations = seg.map((p) => p.median_duration_ms).filter((x) => x != null)
    const medRatio = round1(median(ratios))
    eras.push({
      from: seg[0].date,
      to: seg[seg.length - 1].date,
      points: seg.length,
      median_tempo_ratio: medRatio,
      median_duration_ms: durations.length ? Math.round(median(durations)) : null,
      label: eraLabel(medRatio),
    })
  }
  return eras
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Tour Tempo lineage: ~3:1 is the textbook full-swing ratio. Labels describe
// the era's SHAPE, never a judgement of "good" — that's the Caddie's job at
// narration time, with score context this lib doesn't have.
function eraLabel(ratio) {
  if (ratio == null) return 'Unmeasured era'
  if (ratio >= 3.4) return 'Long-simmer era'       // slow, deliberate backswing
  if (ratio >= 2.7) return 'Tour-tempo era'        // the ~3:1 band
  if (ratio >= 2.2) return 'Quickened era'
  return 'Snatch era'                               // ratio collapsed — rushed back
}

/**
 * The headline for the top of the surface. ONE sentence, era-aware, honest
 * about sample size — same doctrine as practice.js's headline.
 */
function headline(timeline, eras) {
  const measurable = (timeline || []).filter((p) => p.measurable > 0)
  if (!measurable.length) {
    return { text: 'No measurable swings yet — import an archive session or film one on the range.', confidence: 'insufficient' }
  }
  const latest = measurable[measurable.length - 1]
  const conf = measurable.length >= 10 ? 'strong' : measurable.length >= 5 ? 'usable' : 'building'
  let text = `Latest session: ${latest.median_tempo_ratio}:1 tempo, ${latest.median_duration_ms}ms takeaway to impact`
  if (latest.consistency != null) text += `, ${latest.consistency}% swing-to-swing`
  if (eras && eras.length > 1) {
    const cur = eras[eras.length - 1]
    text += ` — currently in a ${cur.label.toLowerCase()} (${cur.median_tempo_ratio}:1 since ${cur.from})`
  }
  return { text: text + '.', confidence: conf }
}

/**
 * Caddie narration of the swing data (spec §Pipeline.6 — deterministic,
 * computed at read time; V0 ships the TEMPLATE narrator, the LLM narrator
 * consumes the same facts later). Rules: reference the player's own numbers,
 * one observation + one actionable thought max, and silence ("too early to
 * tell") below sample gates. NEVER invents causality with scoring — the
 * swing×SG join is V2 and says so.
 */
function narrate(timeline, eras) {
  const measurable = (timeline || []).filter((p) => p.measurable > 0)
  if (measurable.length < 3) {
    return { lines: [], confidence: 'insufficient',
      note: 'A few more filmed sessions and I\'ll start reading your tempo patterns.' }
  }
  const lines = []
  const ratios = measurable.map((p) => p.median_tempo_ratio)
  const latest = measurable[measurable.length - 1]

  // 1. Where you are vs the Tour Tempo band.
  const med = ratios.slice().sort((a, b) => a - b)[Math.floor(ratios.length / 2)]
  if (med >= 2.7 && med <= 3.3) {
    lines.push(`Your tempo lives in the Tour band (${latest.median_tempo_ratio}:1 last session) — that\'s a foundation, not something to chase.`)
  } else if (med < 2.7) {
    lines.push(`Your backswing runs quick relative to your downswing (${med}:1 across ${ratios.length} sessions). One rehearsal swing counting "one-two-three" back, "one" through can show you the difference.`)
  } else {
    lines.push(`You take a long simmer at the top (${med}:1). That\'s a style, not a flaw — the number to protect is your consistency, not the ratio.`)
  }

  // 2. Consistency trend (needs the gates the summarize() already applies).
  const withCv = measurable.filter((p) => p.consistency != null)
  if (withCv.length >= 3) {
    const recent = withCv.slice(-3).reduce((s, p) => s + p.consistency, 0) / 3
    const early = withCv.slice(0, 3).reduce((s, p) => s + p.consistency, 0) / 3
    if (recent < early - 1) lines.push(`Your swing-to-swing tempo is tightening — ${recent.toFixed(1)}% variance lately, down from ${early.toFixed(1)}%. Whatever you\'re doing, keep doing it.`)
    else if (recent > early + 1) lines.push(`Tempo variance has crept up (${early.toFixed(1)}% → ${recent.toFixed(1)}%). Fatigue or a swing change are the usual suspects — worth one deliberate session.`)
  }

  // 3. Era awareness.
  if (eras && eras.length > 1) {
    const prev = eras[eras.length - 2], cur = eras[eras.length - 1]
    lines.push(`You\'ve shifted eras: ${prev.median_tempo_ratio}:1 (${prev.label.toLowerCase()}) → ${cur.median_tempo_ratio}:1 now. Once the scoring data joins this (V2), I\'ll tell you whether it\'s costing or saving you strokes.`)
  }

  return { lines, confidence: measurable.length >= 10 ? 'strong' : 'usable' }
}

module.exports = { buildTimeline, detectEras, headline, narrate, MIN_ERA_SESSIONS }
