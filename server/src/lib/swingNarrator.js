// Swing Intelligence — LLM narrator prompt block (spec §Pipeline.6:
// "pose-model + LLM narrator — an LLM never watches video directly").
//
// The narrator receives DETERMINISTIC FACTS ONLY (tempo engine outputs,
// eras, worth-strokes splits, optional ball-data aggregates) and writes the
// human sentence. It never sees video, never sees raw clips, and the system
// instructions hard-forbid inventing metrics, faults, or causality. If the
// model call fails, the route falls back to the template narrator
// (lib/swingTimeline.narrate) — the player always gets an honest read.
//
// Pure function — builds the block; routes/swing.js does the IO.

const { CAUSATION_DISCLAIMER } = require('./swingJoin')

/**
 * Build the facts block for the narrator's system prompt.
 * @param {object} facts
 * @param {Array}  facts.timeline  from buildTimeline
 * @param {Array}  facts.eras      from detectEras
 * @param {object} [facts.join]    { correlation, worth_strokes } from /join
 * @param {Array}  [facts.ball]    recent tm_ball_data rows (session-level)
 * @returns {string} the block; empty string when there's nothing to narrate
 */
function factsPromptBlock({ timeline = [], eras = [], join = null, ball = [] } = {}) {
  const measurable = timeline.filter((p) => p.measurable > 0)
  if (!measurable.length) return ''

  const L = []
  const latest = measurable[measurable.length - 1]
  L.push('SWING FACTS (measured, deterministic — never contradict, never add metrics):')
  L.push(`- Sessions with measurable swings: ${measurable.length}; latest ${latest.date}: ` +
    `${latest.median_tempo_ratio}:1 tempo, ${latest.median_duration_ms}ms takeaway→impact` +
    (latest.consistency != null ? `, ${latest.consistency}% swing-to-swing variance` : ' (variance not yet measurable)'))

  const ratios = measurable.map((p) => p.median_tempo_ratio)
  L.push(`- Tempo range across sessions: ${Math.min(...ratios)}:1 to ${Math.max(...ratios)}:1`)

  if (eras.length > 1) {
    L.push('- Detected tempo eras (chronological): ' +
      eras.map((e) => `${e.label} ${e.median_tempo_ratio}:1 (${e.from}→${e.to})`).join('; '))
  } else if (eras.length === 1) {
    L.push(`- Single era so far: ${eras[0].label} at ${eras[0].median_tempo_ratio}:1 — no shift detected`)
  }

  const ws = join?.worth_strokes
  if (ws?.status === 'ready' && ws.top) {
    L.push(`- Worth-strokes (ASSOCIATION ONLY): "${ws.top.label}" windows show ${ws.top.delta} strokes worse ` +
      `scoring than norm windows (${ws.top.windows_fault} vs ${ws.top.windows_good} windows). ` +
      `You MUST frame this as correlation, never cause.`)
  } else if (ws?.status === 'too_early') {
    L.push(`- Swing×score join: not enough paired weeks yet (${ws.pairs}/${ws.needed}). Do NOT speculate about scoring impact.`)
  }

  if (ball.length) {
    const numOrNull = (v) => (v == null || v === '' ? null : Number(v))
    const spd = ball.map((b) => numOrNull(b.club_speed)).filter((v) => v != null && Number.isFinite(v))
    const carry = ball.map((b) => numOrNull(b.carry)).filter((v) => v != null && Number.isFinite(v))
    if (spd.length) L.push(`- Launch monitor: club speed ${Math.min(...spd)}–${Math.max(...spd)} mph over ${spd.length} entries` +
      (carry.length ? `, carry ${Math.min(...carry)}–${Math.max(...carry)} yds` : ''))
  }

  L.push('')
  L.push('RULES: 2–3 sentences, coach voice, second person. Reference only these numbers. ' +
    'One observation, one actionable thought. If data is thin, say what more data would tell you. ' +
    'Never invent faults (clubface, plane, hip turn are NOT measured). ' +
    `Causality disclaimer lives in the UI ("${CAUSATION_DISCLAIMER}") — do not restate it, do not override it.`)
  return L.join('\n')
}

module.exports = { factsPromptBlock }
