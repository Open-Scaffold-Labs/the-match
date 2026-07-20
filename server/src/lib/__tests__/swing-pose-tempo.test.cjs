// Unit tests for pose-based swing detection (lib/swingPoseTempo.js).
// Run: node server/src/lib/__tests__/swing-pose-tempo.test.cjs
const assert = require('node:assert/strict')
const P = require('../swingPoseTempo.js')
let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

// ── synthetic keypoint-frame generator ──────────────────────────────────────
// Builds 33-landmark frames whose wrist-y follows a planted swing cycle:
// address (low) -> rise -> top (high) -> return (impact). Other landmarks
// parked at a fixed plausible spot; only wrists matter to the detector.
function mkPoseSwing({ fps = 60, backswingMs = 800, downswingMs = 270, addrY = 900, topY = 580 } = {}) {
  const backF = Math.round((backswingMs / 1000) * fps)
  const downF = Math.round((downswingMs / 1000) * fps)
  const address = Math.round(0.8 * fps), follow = Math.round(1.5 * fps)
  const wy = []
  for (let i = 0; i < address; i++) wy.push(addrY + (Math.random() - 0.5) * 6)
  const takeaway = wy.length
  for (let i = 0; i < backF; i++) wy.push(addrY - (addrY - topY) * Math.sin((i / backF) * Math.PI / 2))
  const top = wy.length - 1
  for (let i = 1; i <= downF; i++) wy.push(topY + (addrY - topY) * (i / downF) ** 2)
  const impact = wy.length - 1
  for (let i = 0; i < follow; i++) wy.push(addrY - (addrY - topY) * Math.min(1, i / (0.5 * fps)) * 0.9)
  const frames = wy.map((y) => {
    const f = Array.from({ length: 33 }, () => [500, 500, 0.9])
    f[P.L_WRIST] = [y, 700, 0.9]
    f[P.R_WRIST] = [y, 700, 0.9]
    return f
  })
  return { frames, fps, truth: { takeaway, top, impact } }
}

// ── view-validity gate ──────────────────────────────────────────────────────
{
  const { frames, fps } = mkPoseSwing()
  const r = P.detectSwingFromPose({ frames, fps, view: 'face_on' })
  ok('face-on refused for tempo (wrist occlusion doctrine)',
    r.detectable === false && r.flags.includes('tempo_requires_dtl_view'))
  ok('refusal carries null metrics', r.duration_ms === null && r.tempo_ratio === null)
}

// ── happy path: clean DTL swing ─────────────────────────────────────────────
{
  const { frames, fps, truth } = mkPoseSwing({ backswingMs: 800, downswingMs: 270 })
  const r = P.detectSwingFromPose({ frames, fps, view: 'down_the_line' })
  ok('synthetic DTL swing detected', r.detectable === true)
  ok('flagged pose_tempo', r.flags.includes('pose_tempo'))
  ok(`takeaway near planted (±4f): got ${r.frames?.takeaway} vs ${truth.takeaway}`,
    Math.abs(r.frames.takeaway - truth.takeaway) <= 4)
  ok(`top near planted (±4f): got ${r.frames?.top} vs ${truth.top}`,
    Math.abs(r.frames.top - truth.top) <= 4)
  ok(`impact near planted (±4f): got ${r.frames?.impact} vs ${truth.impact}`,
    Math.abs(r.frames.impact - truth.impact) <= 4)
  ok('duration ≈ 1070ms planted (±70ms)', Math.abs(r.duration_ms - 1070) <= 70)
  ok('ratio ≈ 3.0 planted (±0.8; top-detection bias shifts ratio more than frames)', Math.abs(r.tempo_ratio - 3.0) <= 0.8)
}

// ── walk-back / fidget footage: no swing cycle → honest refusal ─────────────
{
  // Wrist wanders with small oscillations (walking, fidgeting) and never
  // rises far enough above the clip's address level to be a swing. (A true
  // walk-back AFTER a real swing is refused by the amplitude gate measured
  // against the real address plateau — covered by the pilot clips' flags.)
  const fps = 60, N = 6 * fps
  const frames = Array.from({ length: N }, (_, i) => {
    const y = 620 + 35 * Math.sin(i / 20) + (Math.random() - 0.5) * 15
    const f = Array.from({ length: 33 }, () => [500, 500, 0.9])
    f[P.L_WRIST] = [y, 700, 0.9]
    f[P.R_WRIST] = [y, 700, 0.9]
    return f
  })
  const r = P.detectSwingFromPose({ frames, fps, view: 'down_the_line' })
  ok('walk-back refused with no_swing_cycle',
    r.detectable === false && r.flags.includes('no_swing_cycle'))
}

// ── low detection rate → subject_not_found ──────────────────────────────────
{
  const { frames, fps } = mkPoseSwing()
  const sparse = frames.map((f, i) => (i % 2 ? null : f)) // 50% null
  const r = P.detectSwingFromPose({ frames: sparse, fps, view: 'down_the_line' })
  ok('sparse detections refused honestly',
    r.detectable === false && r.flags.includes('subject_not_found'))
}

// ── degenerate inputs ───────────────────────────────────────────────────────
{
  const r1 = P.detectSwingFromPose({ frames: [], fps: 60, view: 'down_the_line' })
  ok('empty frames → insufficient_signal', r1.detectable === false && r1.flags.includes('insufficient_signal'))
  const r2 = P.detectSwingFromPose({ frames: null, fps: 0, view: 'down_the_line' })
  ok('null frames/bad fps → insufficient_signal', r2.detectable === false)
}

console.log(`\nswing-pose-tempo: ${pass} passed`)
