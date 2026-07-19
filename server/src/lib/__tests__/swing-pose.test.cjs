// Unit tests for pose metrics (lib/swingPose.js). Run: node server/src/lib/__tests__/swing-pose.test.cjs
const assert = require('node:assert/strict')
const P = require('../swingPose.js')
let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

// COCO-17 frame factory. Golfer facing camera (face-on): x lateral, y down.
function mkFrame({ shoulderAngle = 0, hipAngle = 0, hipShiftX = 0, headShiftX = 0, score = 0.9 } = {}) {
  const f = new Array(17).fill(null).map(() => ({ x: 0, y: 0, score: 0 }))
  const rad = (deg) => (deg * Math.PI) / 180
  // Shoulders: 40px apart at y=100
  f[5] = { x: 100 - 20 * Math.cos(rad(shoulderAngle)), y: 100 - 20 * Math.sin(rad(shoulderAngle)), score }
  f[6] = { x: 100 + 20 * Math.cos(rad(shoulderAngle)), y: 100 + 20 * Math.sin(rad(shoulderAngle)), score }
  // Hips: 24px apart at y=180
  f[11] = { x: 100 + hipShiftX - 12 * Math.cos(rad(hipAngle)), y: 180 - 12 * Math.sin(rad(hipAngle)), score }
  f[12] = { x: 100 + hipShiftX + 12 * Math.cos(rad(hipAngle)), y: 180 + 12 * Math.sin(rad(hipAngle)), score }
  f[0] = { x: 100 + headShiftX, y: 60, score }
  return f
}

// ── happy path: planted rotation measured ───────────────────────────────────
{
  const frames = {
    address: mkFrame({ shoulderAngle: 0, hipAngle: 0 }),
    top: mkFrame({ shoulderAngle: 85, hipAngle: 40, hipShiftX: 8, headShiftX: 5 }),
    impact: mkFrame({ shoulderAngle: -20, hipAngle: -30 }),
  }
  const m = P.computePoseMetrics(frames, 'face_on')
  ok('shoulder turn ≈ 85° planted', Math.abs(m.shoulder_turn.value - 85) < 1)
  ok('hip turn ≈ 40° planted', Math.abs(m.hip_turn.value - 40) < 1)
  ok('sway = 8px / 40px shoulder width = 0.2', Math.abs(m.sway.value - 0.2) < 0.01)
  ok('head movement ≈ 5px / 40px = 0.125', Math.abs(m.head_movement.value - 0.125) < 0.02)
  ok('face-on → early extension honestly null', m.early_extension.value === null && m.early_extension.flags.includes('down_the_line_only'))
  ok('high-score frames → high confidence', m.shoulder_turn.confidence >= 0.8)
}

// ── view validity: down-the-line ────────────────────────────────────────────
{
  const frames = {
    address: mkFrame({ hipShiftX: 0 }),
    top: mkFrame({}),
    impact: mkFrame({ hipShiftX: 10 }),
  }
  const m = P.computePoseMetrics(frames, 'down_the_line')
  ok('DTL → sway honestly null (face_on_only)', m.sway.value === null && m.sway.flags.includes('face_on_only'))
  ok('early extension = 10px / 40px = 0.25', Math.abs(m.early_extension.value - 0.25) < 0.01)
}

// ── honesty: low keypoint scores → null + flag, never fabricated ────────────
{
  const frames = {
    address: mkFrame({ score: 0.2 }),
    top: mkFrame({ score: 0.2 }),
  }
  const m = P.computePoseMetrics(frames, 'face_on')
  ok('low-score keypoints → shoulder turn null + low_confidence',
     m.shoulder_turn.value === null && m.shoulder_turn.flags.includes('low_confidence'))
  ok('no metric invented anywhere', Object.values(m).every((x) => x.value === null))
}

// ── honesty: missing frames ─────────────────────────────────────────────────
{
  const m = P.computePoseMetrics({}, 'face_on')
  ok('no frames → all metrics insufficient_frames',
     Object.values(m).every((x) => x.value === null && x.flags.includes('insufficient_frames')))

  const noImpact = P.computePoseMetrics({ address: mkFrame({}), top: mkFrame({}) }, 'down_the_line')
  ok('missing impact frame → no_impact_frame flag',
     noImpact.early_extension.flags.includes('no_impact_frame'))
}

// ── unoriented line: 175° turn reads as 5°, not 175 ────────────────────────
{
  const m = P.computePoseMetrics({ address: mkFrame({ shoulderAngle: 0 }), top: mkFrame({ shoulderAngle: 175 }) }, 'face_on')
  ok('shoulder line unoriented (175° → 5°)', Math.abs(m.shoulder_turn.value - 5) < 1)
}

console.log(`\nswing-pose: ${pass} passed`)
