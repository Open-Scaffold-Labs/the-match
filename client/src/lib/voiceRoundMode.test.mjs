// Round Mode pure helpers — node --test (same convention as geo.test.mjs).
//   node --test client/src/lib/voiceRoundMode.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUND_MODE_TOOLS, buildInstructions, buildContextBlock, parseToolArgs } from './voiceRoundMode.js'

test('tool schema locks enums to the SG fact vocabulary', () => {
  const byName = Object.fromEntries(ROUND_MODE_TOOLS.map(t => [t.name, t]))
  assert.deepEqual(byName.log_hole_score.parameters.properties.firstPutt.enum, ['in3', '3-10', '10-25', '25plus'])
  assert.deepEqual(byName.log_shot.parameters.properties.lie.enum, ['tee', 'fairway', 'rough', 'sand', 'recovery', 'green'])
  assert.deepEqual(byName.log_hole_score.parameters.required, ['score'])
  assert.deepEqual(byName.set_hole.parameters.required, ['hole'])
  assert.equal(ROUND_MODE_TOOLS.length, 6)
  assert.ok(ROUND_MODE_TOOLS.every(t => t.type === 'function'))
})

test('instructions carry the non-negotiables', () => {
  const s = buildInstructions()
  assert.match(s, /Never compute the golfer's score/i)
  assert.match(s, /Never invent/i)
  assert.match(s, /clarifying question rather than guessing/i)
})

test('context block: active hole, pars, scores, fresh-not-accumulated shape', () => {
  const s = buildContextBlock({
    activeHole: 6, holeCount: 9, pars: [4, 3, 5, 4, 4, 4, 5, 4, 4],
    scores: ['5', '3', null], courseName: 'Test GC',
  })
  assert.match(s, /Active hole: 6 \(par 4\)/)
  assert.match(s, /Pars: 4,3,5,4,4,4,5,4,4/)
  assert.match(s, /Scored: H1:5 H2:3/)
  assert.match(s, /Course: Test GC/)
  assert.match(s, /trust this, not memory/)
})

test('context block survives an empty round', () => {
  const s = buildContextBlock({ scores: [] })
  assert.match(s, /Card is empty/)
})

test('parseToolArgs: object passthrough, JSON string, junk → {}', () => {
  assert.deepEqual(parseToolArgs({ a: 1 }), { a: 1 })
  assert.deepEqual(parseToolArgs('{"score":5}'), { score: 5 })
  assert.deepEqual(parseToolArgs('not json'), {})
  assert.deepEqual(parseToolArgs(null), {})
})
