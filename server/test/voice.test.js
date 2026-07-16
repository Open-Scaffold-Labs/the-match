// Talk Your Round Phase 0 — voice NLU unit tests (deterministic layer).
// The covenant under test: the model's output is untrusted; sanitizeIntent
// is the only door into the client's save paths.

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const {
  sanitizeIntent, buildParserContext, VOICE_TOOL, FIRST_PUTT_BUCKETS, LIES,
} = require('../src/lib/voice')

const CTX = { activeHole: 6, holeCount: 18, pars: [4, 3, 5, 4, 4, 4], scores: [5, 3, null] }

describe('sanitizeIntent — log_score', () => {
  it('passes a clean score with putt facts', () => {
    const out = sanitizeIntent({ intent: 'log_score', score: 5, putts: 2, firstPutt: '10-25', confirmation: 'Bogey five.' }, CTX)
    expect(out).toEqual({ intent: 'log_score', hole: null, score: 5, putts: 2, firstPutt: '10-25', confirmation: 'Bogey five.' })
  })
  it('rejects out-of-range holes and scores', () => {
    expect(sanitizeIntent({ intent: 'log_score', hole: 25, score: 5, confirmation: 'x' }, CTX).hole).toBeNull()
    expect(sanitizeIntent({ intent: 'log_score', score: 55, confirmation: 'x' }, CTX).intent).toBe('unknown')
    expect(sanitizeIntent({ intent: 'log_score', confirmation: 'x' }, CTX).intent).toBe('unknown')
  })
  it('drops firstPutt when putts is 0 or missing (no bucket without a putt)', () => {
    expect(sanitizeIntent({ intent: 'log_score', score: 4, putts: 0, firstPutt: 'in3', confirmation: 'x' }, CTX).firstPutt).toBeNull()
    expect(sanitizeIntent({ intent: 'log_score', score: 4, firstPutt: 'in3', confirmation: 'x' }, CTX).firstPutt).toBeNull()
  })
  it('rejects invented bucket values', () => {
    expect(sanitizeIntent({ intent: 'log_score', score: 4, putts: 2, firstPutt: 'yes', confirmation: 'x' }, CTX).firstPutt).toBeNull()
  })
})

describe('sanitizeIntent — log_shot', () => {
  it('passes club/lie/toPin', () => {
    const out = sanitizeIntent({ intent: 'log_shot', club: '7i', lie: 'rough', toPin: 10, confirmation: 'Got it.' }, CTX)
    expect(out.lie).toBe('rough')
    expect(out.toPin).toBe(10)
  })
  it('unknown when the shot carries nothing usable', () => {
    expect(sanitizeIntent({ intent: 'log_shot', lie: 'water', toPin: 9999, confirmation: 'x' }, CTX).intent).toBe('unknown')
  })
})

describe('sanitizeIntent — other intents + hostile input', () => {
  it('ask_caddie requires a question', () => {
    expect(sanitizeIntent({ intent: 'ask_caddie', question: 'What club here?', confirmation: 'x' }, CTX).question).toBe('What club here?')
    expect(sanitizeIntent({ intent: 'ask_caddie', confirmation: 'x' }, CTX).intent).toBe('unknown')
  })
  it('unknown for junk intents; confirmation length-capped', () => {
    const out = sanitizeIntent({ intent: 'drop_tables', confirmation: 'c'.repeat(999) }, CTX)
    expect(out.intent).toBe('unknown')
    expect(out.confirmation.length).toBe(140)
  })
  it('survives null/garbage', () => {
    expect(sanitizeIntent(null, CTX).intent).toBe('unknown')
    expect(sanitizeIntent({}, {}).intent).toBe('unknown')
  })
})

describe('buildParserContext', () => {
  it('carries active hole, pars, and scored holes', () => {
    const s = buildParserContext(CTX)
    expect(s).toContain('Active hole: 6')
    expect(s).toContain('H3:5')          // pars
    expect(s).toContain('Scored so far: H1:5 H2:3')
  })
  it('empty context still valid', () => {
    expect(buildParserContext({})).toContain('Hole count: 18')
  })
})

describe('VOICE_TOOL schema', () => {
  it('locks enums to the SG fact vocabulary', () => {
    expect(VOICE_TOOL.input_schema.properties.firstPutt.enum).toEqual(FIRST_PUTT_BUCKETS)
    expect(VOICE_TOOL.input_schema.properties.lie.enum).toEqual(LIES)
    expect(VOICE_TOOL.input_schema.required).toEqual(['intent', 'confirmation'])
  })
})
