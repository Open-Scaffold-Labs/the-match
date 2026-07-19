// Parity tripwire: client pose-metric math (swingPose.mjs) and the server
// copy (server/src/lib/swingPose.js) MUST produce byte-identical results.
// Run: node --test client/src/lib/__tests__/swing-pose-parity.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as client from '../swingPose.mjs'

const require = createRequire(import.meta.url)
const server = require('../../../../server/src/lib/swingPose.js')

function mkFrame({ shoulderAngle = 0, hipAngle = 0, hipShiftX = 0, headShiftX = 0, score = 0.9 } = {}) {
  const f = new Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0 }))
  const rad = (deg) => (deg * Math.PI) / 180
  f[5] = { x: 100 - 20 * Math.cos(rad(shoulderAngle)), y: 100 - 20 * Math.sin(rad(shoulderAngle)), score }
  f[6] = { x: 100 + 20 * Math.cos(rad(shoulderAngle)), y: 100 + 20 * Math.sin(rad(shoulderAngle)), score }
  f[11] = { x: 100 + hipShiftX - 12 * Math.cos(rad(hipAngle)), y: 180 - 12 * Math.sin(rad(hipAngle)), score }
  f[12] = { x: 100 + hipShiftX + 12 * Math.cos(rad(hipAngle)), y: 180 + 12 * Math.sin(rad(hipAngle)), score }
  f[0] = { x: 100 + headShiftX, y: 60, score }
  return f
}

const fixtures = [
  ['face_on full', { address: mkFrame(), top: mkFrame({ shoulderAngle: 85, hipAngle: 40, hipShiftX: 8, headShiftX: 5 }), impact: mkFrame({ shoulderAngle: -20 }) }, 'face_on'],
  ['dtl full', { address: mkFrame(), top: mkFrame(), impact: mkFrame({ hipShiftX: 10 }) }, 'down_the_line'],
  ['low score', { address: mkFrame({ score: 0.2 }), top: mkFrame({ score: 0.2 }) }, 'face_on'],
  ['empty', {}, 'face_on'],
  ['no impact', { address: mkFrame(), top: mkFrame() }, 'down_the_line'],
  ['extreme turn', { address: mkFrame(), top: mkFrame({ shoulderAngle: 175 }) }, 'face_on'],
]

test('computePoseMetrics parity across fixture battery', () => {
  for (const [name, frames, view] of fixtures) {
    assert.deepEqual(client.computePoseMetrics(frames, view), server.computePoseMetrics(frames, view), `diverged: ${name}`)
  }
})

test('constants parity', () => {
  assert.equal(client.MIN_KP_SCORE, server.MIN_KP_SCORE)
  assert.equal(client.MIN_CONFIDENCE, server.MIN_CONFIDENCE)
  assert.deepEqual(client.KP, server.KP)
})
