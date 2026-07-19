// CLIENT TWIN of server/src/lib/swingPose.js — pose metric math.
// Parity enforced by client/src/lib/__tests__/swing-pose-parity.test.mjs
// (byte-identical outputs vs the server copy on a fixture battery).
// If you change one side, change the other — the test is the tripwire.

// Swing Intelligence V1.5 — pose metrics from 2D keypoints.
//
// The second measurement stream (spec §Pipeline.2–3): a pose model yields
// 17 COCO keypoints per frame; THIS module turns keypoints at the tempo
// engine's frame indexes (address ≈ takeaway, top, impact) into biomechanic
// metrics. The pose model runs on-device (client twin: swingPoseEstimate.mjs);
// this math is pure and shared.
//
// HONESTY CONTRACT — the spec's hardest rule, enforced per-metric:
//   • every metric returns { value, confidence } OR { value: null, flags[] }
//   • view-invalid metrics are null + flag ('down_the_line_only',
//     'face_on_only') — early extension from a face-on camera is a guess,
//     and we don't guess
//   • low keypoint confidence → null + 'low_confidence' flag
//   • clubface is NEVER produced — video can't measure it (monitor leg only)
//
// Keypoint format: COCO-17 (MoveNet): [{ x, y, score }], normalized or
// pixel coords (we normalize internally by shoulder width at address).

const KP = {
  nose: 0, leftEye: 1, rightEye: 2, leftEar: 3, rightEar: 4,
  leftShoulder: 5, rightShoulder: 6, leftElbow: 7, rightElbow: 8,
  leftWrist: 9, rightWrist: 10, leftHip: 11, rightHip: 12,
  leftKnee: 13, rightKnee: 14, leftAnkle: 15, rightAnkle: 16,
}

const MIN_KP_SCORE = 0.35      // below this a keypoint is a guess
const MIN_CONFIDENCE = 0.45    // below this a metric is reported as null

const round1 = (x) => Math.round(x * 10) / 10
const round2 = (x) => Math.round(x * 100) / 100

function kp(frame, name) {
  const p = frame && frame[KP[name]]
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.score ?? 0) >= MIN_KP_SCORE ? p : null
}

const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, score: Math.min(a.score, b.score) } : null)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// Angle of the line between two keypoints, degrees from horizontal.
function lineAngle(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function meanScore(pts) {
  const ok = pts.filter(Boolean)
  return ok.length ? ok.reduce((s, p) => s + (p.score ?? 0), 0) / ok.length : 0
}

/**
 * Compute pose metrics for one swing.
 * @param {object} frames  { address: KP[], top: KP[], impact: KP[] } — COCO-17
 *   keypoint arrays per phase frame (address ≈ takeaway frame)
 * @param {'face_on'|'down_the_line'} view  camera angle (affects validity)
 * @returns {object} pose_metrics JSONB-ready:
 *   { shoulder_turn, hip_turn, sway, head_movement, early_extension } —
 *   each { value, confidence } or { value: null, confidence, flags[] }
 */
function computePoseMetrics(frames, view) {
  const out = {}
  const addr = frames?.address, top = frames?.top, impact = frames?.impact
  if (!addr || !top) {
    for (const m of ['shoulder_turn', 'hip_turn', 'sway', 'head_movement', 'early_extension']) {
      out[m] = { value: null, confidence: 0, flags: ['insufficient_frames'] }
    }
    return out
  }

  // Normalization unit: shoulder width at address. Everything becomes
  // body-relative, so camera distance doesn't matter.
  const aLS = kp(addr, 'leftShoulder'), aRS = kp(addr, 'rightShoulder')
  const unit = aLS && aRS ? dist(aLS, aRS) : null
  const noUnit = unit == null || unit < 1e-6

  // ── shoulder turn (both views) ────────────────────────────────────────────
  {
    const tLS = kp(top, 'leftShoulder'), tRS = kp(top, 'rightShoulder')
    const conf = meanScore([aLS, aRS, tLS, tRS])
    if (aLS && aRS && tLS && tRS && conf >= MIN_CONFIDENCE) {
      // Rotation magnitude: change in the shoulder-line angle.
      let d = Math.abs(lineAngle(aLS, aRS) - lineAngle(tLS, tRS))
      if (d > 90) d = 180 - d // line is unoriented; take the acute turn
      out.shoulder_turn = { value: round1(d), confidence: round2(conf) }
    } else {
      out.shoulder_turn = { value: null, confidence: round2(conf), flags: ['low_confidence'] }
    }
  }

  // ── hip turn (both views) ─────────────────────────────────────────────────
  {
    const aLH = kp(addr, 'leftHip'), aRH = kp(addr, 'rightHip')
    const tLH = kp(top, 'leftHip'), tRH = kp(top, 'rightHip')
    const conf = meanScore([aLH, aRH, tLH, tRH])
    if (aLH && aRH && tLH && tRH && conf >= MIN_CONFIDENCE) {
      let d = Math.abs(lineAngle(aLH, aRH) - lineAngle(tLH, tRH))
      if (d > 90) d = 180 - d
      out.hip_turn = { value: round1(d), confidence: round2(conf) }
    } else {
      out.hip_turn = { value: null, confidence: round2(conf), flags: ['low_confidence'] }
    }
  }

  // ── sway — lateral hip drift, face-on only ────────────────────────────────
  {
    if (view !== 'face_on') {
      out.sway = { value: null, confidence: 0, flags: ['face_on_only'] }
    } else {
      const aH = mid(kp(addr, 'leftHip'), kp(addr, 'rightHip'))
      const tH = mid(kp(top, 'leftHip'), kp(top, 'rightHip'))
      const conf = meanScore([aH, tH])
      if (aH && tH && !noUnit && conf >= MIN_CONFIDENCE) {
        // + = drift away from target (right-handed), in shoulder-width units
        out.sway = { value: round2((tH.x - aH.x) / unit), confidence: round2(conf) }
      } else {
        out.sway = { value: null, confidence: round2(conf), flags: [noUnit ? 'no_reference_frame' : 'low_confidence'] }
      }
    }
  }

  // ── head movement — both views ────────────────────────────────────────────
  {
    const aN = kp(addr, 'nose'), tN = kp(top, 'nose')
    const conf = meanScore([aN, tN])
    if (aN && tN && !noUnit && conf >= MIN_CONFIDENCE) {
      out.head_movement = { value: round2(dist(aN, tN) / unit), confidence: round2(conf) }
    } else {
      out.head_movement = { value: null, confidence: round2(conf), flags: [noUnit ? 'no_reference_frame' : 'low_confidence'] }
    }
  }

  // ── early extension — down-the-line only, needs impact frame ─────────────
  {
    if (view !== 'down_the_line') {
      out.early_extension = { value: null, confidence: 0, flags: ['down_the_line_only'] }
    } else if (!impact) {
      out.early_extension = { value: null, confidence: 0, flags: ['no_impact_frame'] }
    } else {
      const aH = mid(kp(addr, 'leftHip'), kp(addr, 'rightHip'))
      const iH = mid(kp(impact, 'leftHip'), kp(impact, 'rightHip'))
      const conf = meanScore([aH, iH])
      if (aH && iH && !noUnit && conf >= MIN_CONFIDENCE) {
        // Hip-center drift toward the target line (x toward camera/away
        // depending on orientation; magnitude is the honest part — sign is
        // orientation-dependent, so report |drift| in shoulder units).
        out.early_extension = { value: round2(Math.abs(iH.x - aH.x) / unit), confidence: round2(conf) }
      } else {
        out.early_extension = { value: null, confidence: round2(conf), flags: [noUnit ? 'no_reference_frame' : 'low_confidence'] }
      }
    }
  }

  return out
}



export { computePoseMetrics, KP, MIN_KP_SCORE, MIN_CONFIDENCE }
