// Talk Your Round — Phase 0 voice NLU (deterministic layer).
// (wiki/synthesis/voice-interface-build-spec-2026-07-15.md)
//
// The server does LANGUAGE only: transcript → one structured intent via
// forced tool use. It never writes rounds — the client executes intents
// through the exact same save paths the tap UI uses, so voice can never
// corrupt state in a way a tap couldn't. Everything in this file is pure
// and unit-tested; the model's output passes through sanitizeIntent before
// anyone trusts it.

// Keep in sync: buckets with lib/puttFacts SG_BUCKETS; lies with
// lib/sg/baselines LIES (docs/SG-DESIGN.md).
const FIRST_PUTT_BUCKETS = ['in3', '3-10', '10-25', '25plus']
const LIES = ['tee', 'fairway', 'rough', 'sand', 'recovery', 'green']
const INTENTS = ['log_score', 'log_shot', 'get_status', 'ask_caddie', 'undo', 'unknown']

const VOICE_TOOL = {
  name: 'deliver_intent',
  description: 'Deliver the single structured intent parsed from the golfer\'s utterance.',
  input_schema: {
    type: 'object',
    required: ['intent', 'confirmation'],
    properties: {
      intent: { type: 'string', enum: INTENTS },
      hole: { type: 'integer', description: 'Hole number the utterance refers to. Omit to mean the active hole.' },
      score: { type: 'integer', description: 'Strokes for log_score. Resolve words like birdie/bogey/double against the hole\'s par from context.' },
      putts: { type: 'integer', description: 'Putt count when stated.' },
      firstPutt: { type: 'string', enum: FIRST_PUTT_BUCKETS, description: 'First-putt distance bucket when a distance is stated (feet): <3 → in3, 3-10, 10-25, >25 → 25plus.' },
      club: { type: 'string', description: 'Club for log_shot, normalized like "driver", "7i", "PW".' },
      lie: { type: 'string', enum: LIES, description: 'Lie for log_shot. "missed the green right/short/long" → rough unless they say bunker/sand.' },
      toPin: { type: 'integer', description: 'Yards to the pin for log_shot when stated ("ten yards right of the green" → 10).' },
      question: { type: 'string', description: 'For ask_caddie: the golfer\'s question, verbatim-ish.' },
      confirmation: { type: 'string', description: 'Spoken acknowledgment, ≤ 12 words, caddie voice. For unknown: a one-line "didn\'t catch that".' },
    },
  },
}

const PARSER_SYSTEM = [
  'You parse a golfer\'s spoken utterance into exactly ONE structured intent for The Match scorecard.',
  'Golf language: par/birdie/bogey/eagle/double resolve against the hole\'s par from CONTEXT. "Snowman" = 8. "Up and down" alone is not a score.',
  '"Two putts from twenty feet" → putts 2, firstPutt 10-25. Distances in feet map to buckets; yards near the green are toPin.',
  'Scores go to the ACTIVE hole unless the golfer names one ("five on six" → hole 6).',
  'If the utterance is a question about strategy, clubs, or how to play a shot → ask_caddie with the question.',
  '"How do I stand / where am I / what\'s my score" → get_status. "Scratch that / undo / no wait" → undo.',
  'Ambiguous or non-golf audio → unknown. NEVER guess a score that wasn\'t said.',
  'confirmation: short spoken ack a caddie would give ("Bogey five on six, two putts."). No emoji, no filler.',
].join('\n')

// CONTEXT message for the parser — compact, numbers only.
function buildParserContext(ctx = {}) {
  const lines = []
  const holeCount = Number(ctx.holeCount) || 18
  const active = Number(ctx.activeHole)
  if (Number.isFinite(active) && active >= 1 && active <= holeCount) lines.push(`Active hole: ${active}`)
  if (Array.isArray(ctx.pars) && ctx.pars.length) {
    lines.push(`Pars: ${ctx.pars.slice(0, holeCount).map((p, i) => `H${i + 1}:${p}`).join(' ')}`)
  }
  if (Array.isArray(ctx.scores) && ctx.scores.some(s => s)) {
    const done = ctx.scores.map((s, i) => s ? `H${i + 1}:${s}` : null).filter(Boolean)
    if (done.length) lines.push(`Scored so far: ${done.join(' ')}`)
  }
  lines.push(`Hole count: ${holeCount}`)
  return `CONTEXT\n${lines.join('\n')}`
}

// The model's output is UNTRUSTED. Coerce + range-check every field against
// the round context; unknown intent when the core payload doesn't survive.
function sanitizeIntent(raw, ctx = {}) {
  const holeCount = Number(ctx.holeCount) || 18
  const num = (v, min, max) => {
    const x = Number(v)
    return Number.isFinite(x) && x >= min && x <= max ? Math.round(x) : null
  }
  const str = (v, n) => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, n) : null

  const intent = INTENTS.includes(raw?.intent) ? raw.intent : 'unknown'
  const out = {
    intent,
    confirmation: str(raw?.confirmation, 140) ?? 'Didn’t catch that — try again.',
  }
  if (intent === 'log_score') {
    out.hole = num(raw?.hole, 1, holeCount) // null = active hole (client resolves)
    out.score = num(raw?.score, 1, 15)
    out.putts = num(raw?.putts, 0, 6)
    out.firstPutt = FIRST_PUTT_BUCKETS.includes(raw?.firstPutt) && (out.putts ?? 0) > 0 ? raw.firstPutt : null
    if (out.score == null) return { intent: 'unknown', confirmation: out.confirmation }
  } else if (intent === 'log_shot') {
    out.club = str(raw?.club, 20)
    out.lie = LIES.includes(raw?.lie) ? raw.lie : null
    out.toPin = num(raw?.toPin, 1, 500)
    if (!out.club && !out.lie && out.toPin == null) return { intent: 'unknown', confirmation: out.confirmation }
  } else if (intent === 'ask_caddie') {
    out.question = str(raw?.question, 300)
    if (!out.question) return { intent: 'unknown', confirmation: out.confirmation }
  }
  return out
}

module.exports = {
  VOICE_TOOL, PARSER_SYSTEM, buildParserContext, sanitizeIntent,
  FIRST_PUTT_BUCKETS, LIES, INTENTS,
}
