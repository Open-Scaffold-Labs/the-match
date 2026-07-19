// Unit tests for the pure math of the on-device clip analyzer
// (lib/swingCapture.mjs). DOM extraction (analyzeVideoBlob) is covered by
// the device checklist; the signal math is covered here.
// Run: node --test client/src/lib/__tests__/swing-capture.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lumaFromImageData, motionSeries, rmsSeries, effectiveFps } from '../swingCapture.mjs'

test('lumaFromImageData: Rec.601 weighting', () => {
  // Pure white pixel → 255; pure red → 0.299*255 ≈ 76.2
  const white = new Uint8ClampedArray([255, 255, 255, 255])
  assert.equal(lumaFromImageData(white), 255)
  const red = new Uint8ClampedArray([255, 0, 0, 255])
  assert.ok(Math.abs(lumaFromImageData(red) - 76.245) < 0.01)
  const black = new Uint8ClampedArray([0, 0, 0, 255])
  assert.equal(lumaFromImageData(black), 0)
})

test('motionSeries: abs deltas, first frame 0', () => {
  assert.deepEqual(motionSeries([10, 12, 11, 20]), [0, 2, 1, 9])
  assert.deepEqual(motionSeries([5]), [0])
  assert.deepEqual(motionSeries([]), [])
})

test('rmsSeries: windowed RMS mapped onto bucket count', () => {
  // Constant-amplitude signal → every bucket equals that amplitude.
  const pcm = new Float32Array(1000).fill(0.5)
  const rms = rmsSeries(pcm, 10)
  assert.equal(rms.length, 10)
  assert.ok(rms.every((v) => Math.abs(v - 0.5) < 1e-6))
  // Impulse in the middle → one bucket spikes above the floor.
  const quiet = new Float32Array(1000).fill(0.001)
  quiet[500] = 1.0
  const r2 = rmsSeries(quiet, 10)
  assert.ok(Math.max(...r2) > 10 * Math.min(...r2))
  assert.equal(rmsSeries(null, 10), null)
  assert.equal(rmsSeries(new Float32Array(0), 10), null)
})

test('effectiveFps', () => {
  assert.equal(effectiveFps(150, 5000), 30)
  assert.equal(effectiveFps(10, 0), 0)
})
