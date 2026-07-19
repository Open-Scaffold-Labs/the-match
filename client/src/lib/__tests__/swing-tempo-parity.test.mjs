// Parity tripwire: the client tempo engine (swingTempo.mjs, ESM — used by
// on-device V1 capture) and the server engine (server/src/lib/swingTempo.js,
// CJS — used by the archive importer + read-time surfaces) MUST produce
// byte-identical results on the same inputs. A golfer's tempo for a clip
// cannot depend on where it was analyzed.
// Run: node --test client/src/lib/__tests__/swing-tempo-parity.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as client from '../swingTempo.mjs'

const require = createRequire(import.meta.url)
const server = require('../../../../server/src/lib/swingTempo.js')

function mkSwing({ fps = 240, backswingMs = 900, downswingMs = 300, audio = true } = {}) {
  const backF = Math.round((backswingMs / 1000) * fps)
  const downF = Math.round((downswingMs / 1000) * fps)
  const address = 30, follow = 40, motion = []
  for (let i = 0; i < address; i++) motion.push(0.05 + Math.random() * 0.02)
  const takeaway = motion.length
  for (let i = 0; i < backF; i++) motion.push(0.4 + 0.5 * Math.sin((i / backF) * Math.PI) + Math.random() * 0.05)
  motion[motion.length - 1] = 0.35
  for (let i = 0; i < downF; i++) motion.push(0.8 + (i / downF) * 3 + Math.random() * 0.1)
  const impact = motion.length - 1
  motion[impact] = 5.0
  for (let i = 0; i < follow; i++) motion.push(Math.max(0.05, 2.5 * Math.exp(-i / 10)))
  let audioArr = null
  if (audio) {
    audioArr = motion.map(() => 0.01 + Math.random() * 0.005)
    audioArr[impact] = 1.0
  }
  return { motion, audio: audioArr, fps }
}

const fixtures = [
  ['audio swing 3:1', mkSwing({ backswingMs: 900, downswingMs: 300 })],
  ['motion-only swing', mkSwing({ audio: false })],
  ['fast swing', mkSwing({ backswingMs: 700, downswingMs: 280 })],
  ['slow swing', mkSwing({ backswingMs: 1100, downswingMs: 320 })],
  ['flat signal', { motion: Array.from({ length: 200 }, () => 1), fps: 240 }],
  ['tiny series', { motion: [1, 2, 3], fps: 240 }],
  ['bad fps', { motion: Array.from({ length: 100 }, () => Math.random()), fps: 0 }],
  ['empty', {}],
]

test('analyzeClip parity across fixture battery', () => {
  for (const [name, clip] of fixtures) {
    assert.deepEqual(client.analyzeClip(clip), server.analyzeClip(clip), `analyzeClip diverged: ${name}`)
  }
})

test('summarize parity', () => {
  const sets = [
    [],
    [{ detectable: true, duration_ms: 1200, tempo_ratio: 3.0 }],
    Array.from({ length: 7 }, (_, i) => ({ detectable: true, duration_ms: 1190 + i * 10, tempo_ratio: 3.0 })),
    [{ detectable: false }, { detectable: true, duration_ms: 1250, tempo_ratio: 2.9 }, { detectable: false }],
  ]
  for (const [i, s] of sets.entries()) {
    assert.deepEqual(client.summarize(s), server.summarize(s), `summarize diverged on set ${i}`)
  }
})

test('constants parity', () => {
  assert.equal(client.MIN_SWING_MS, server.MIN_SWING_MS)
  assert.equal(client.MAX_SWING_MS, server.MAX_SWING_MS)
})
