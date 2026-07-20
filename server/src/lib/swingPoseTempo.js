// Swing Intelligence — pose-based swing detection + tempo (DTL view).
//
// The archive pilot (2026-07-20) proved luma+audio tempo cannot read
// uncontrolled phone footage: walk-back-to-camera beats a small-in-frame
// golfer on frame-brightness, and impact clicks drown in wind. Pose is
// person-centric: the wrist-height cycle (address -> rise -> top -> return
// to ball height) IS the swing, immune to camera handling.
//
// Contract (same doctrine as swingTempo.js):
//   - PURE: no IO, no model, no DB. Caller (scripts/swing-import.mjs via
//     scripts/pose-extract.py) supplies 33-point MediaPipe keypoint frames.
//   - HONEST: view-validity gate (face-on wrists are occluded at impact —
//     tempo is DTL-only); no clean cycle -> null + flags, never fabricated.
//   - Walk-back / fidget motion fails the cycle structure and is refused.

const round1 = (x) => Math.round(x * 10) / 10

// MediaPipe Pose landmark indexes we use.
const L_WRIST = 15, R_WRIST = 16

// Tuned on frame-verified ground truth (Dale's pilot clips, 2026-07-20):
const ADDR_PCT = 85        // address height = 85th pct of wrist-y (hands low)
const MIN_AMP_PX = 80      // top must rise at least this far above address
const RET_FRAC = 0.25      // impact = return to within 25% of cycle amplitude
const TK_FRAC = 0.08       // takeaway = departure of 8% of cycle amplitude
const MIN_DUR_MS = 550
const MAX_DUR_MS = 2200
const MIN_DOWN_MS = 120
const MAX_DOWN_TO_BACK = 1.3

function percentile(xs, p) {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

// Moving-average smooth (odd window), parity note: prototype used savgol;
// a plain mean window is equivalent for boundary detection at 60fps.
function smooth(xs, win = 15) {
  const w = win % 2 ? win : win + 1
  const h = (w - 1) / 2
  return xs.map((_, i) => {
    let s = 0, n = 0
    for (let j = Math.max(0, i - h); j <= Math.min(xs.length - 1, i + h); j++) { s += xs[j]; n++ }
    return n ? s / n : 0
  })
}

// Local minima of wrist-y (tops) with amplitude prominence and spacing.
function findTops(wy, fps) {
  const prom = 40, dist = Math.floor(0.5 * fps)
  const tops = []
  for (let i = 1; i < wy.length - 1; i++) {
    if (wy[i] > wy[i - 1] || wy[i] > wy[i + 1]) continue
    // prominence: rise on both sides within the spacing window
    const l = Math.max(...wy.slice(Math.max(0, i - dist), i + 1))
    const r = Math.max(...wy.slice(i, Math.min(wy.length, i + dist + 1)))
    if (Math.min(l, r) - wy[i] < prom) continue
    if (tops.length && i - tops[tops.length - 1] < dist && wy[i] >= wy[tops[tops.length - 1]]) continue
    tops.push(i)
  }
  return tops
}

/**
 * Detect the swing and compute tempo from 33-keypoint pose frames.
 *
 * @param {object} input
 * @param {Array<Array<[number,number,number]>|null>} input.frames  per-frame
 *   33 MediaPipe landmarks [y, x, visibility] in pixels (null = no detection)
 * @param {number} input.fps
 * @param {string} input.view  'face_on' | 'down_the_line'
 * @returns {{ detectable:boolean, frames:?{takeaway:number,top:number,impact:number},
 *   duration_ms:?number, tempo_ratio:?number, flags:string[] }}
 */
function detectSwingFromPose(input) {
  const flags = ['pose_tempo']
  const view = input && input.view
  if (view !== 'down_the_line') {
    // Face-on wrists are occluded by the torso at impact (pilot-verified);
    // tempo from face-on would be a guess. Metrics (sway, head) still run.
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, flags: [...flags, 'tempo_requires_dtl_view'] }
  }
  const fps = Number(input && input.fps)
  const raw = input && input.frames
  if (!Array.isArray(raw) || raw.length < Math.round(2 * fps) || !Number.isFinite(fps) || fps <= 0) {
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, flags: [...flags, 'insufficient_signal'] }
  }

  // Per-frame wrist: higher-visibility of the two; null frame -> NaN -> interp.
  const wyRaw = raw.map((f) => {
    if (!f) return NaN
    const lw = f[L_WRIST], rw = f[R_WRIST]
    if (!lw && !rw) return NaN
    if (!lw) return rw[2] > 0.3 ? rw[0] : NaN
    if (!rw) return lw[2] > 0.3 ? lw[0] : NaN
    const w = rw[2] >= lw[2] ? rw : lw
    return w[2] > 0.3 ? w[0] : NaN
  })
  const valid = wyRaw.filter((v) => Number.isFinite(v))
  if (valid.length < wyRaw.length * 0.6) {
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, flags: [...flags, 'subject_not_found'] }
  }
  // Linear interpolation across detection gaps.
  const wy = wyRaw.map((v, i) => {
    if (Number.isFinite(v)) return v
    let a = i - 1, b = i + 1
    while (a >= 0 && !Number.isFinite(wyRaw[a])) a--
    while (b < wyRaw.length && !Number.isFinite(wyRaw[b])) b++
    if (a < 0) return wyRaw[b]
    if (b >= wyRaw.length) return wyRaw[a]
    return wyRaw[a] + ((wyRaw[b] - wyRaw[a]) * (i - a)) / (b - a)
  })
  const ys = smooth(wy, Math.max(5, Math.round(fps / 4) | 1))
  const addr = percentile(ys, ADDR_PCT)

  let best = null
  for (const top of findTops(ys, fps)) {
    if (ys[top] > addr - MIN_AMP_PX) continue
    const amp = addr - ys[top]
    const retLevel = addr - RET_FRAC * amp
    const tkLevel = addr - TK_FRAC * amp
    let impact = null
    for (let j = top + 1; j < Math.min(ys.length, top + Math.round(0.8 * fps)); j++) {
      if (ys[j] >= retLevel) { impact = j; break }
    }
    if (impact == null) continue
    let takeaway = null
    for (let j = top; j > Math.max(0, top - Math.round(1.8 * fps)); j--) {
      if (ys[j] >= tkLevel) { takeaway = j; break }
    }
    if (takeaway == null) continue
    const durMs = ((impact - takeaway) / fps) * 1000
    const backF = top - takeaway, downF = impact - top
    if (durMs < MIN_DUR_MS || durMs > MAX_DUR_MS) continue
    if (backF <= 0 || downF < (MIN_DOWN_MS / 1000) * fps || downF > backF * MAX_DOWN_TO_BACK) continue
    if (!best || amp > best.amp) best = { takeaway, top, impact, amp }
  }
  if (!best) {
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, flags: [...flags, 'no_swing_cycle'] }
  }
  const duration_ms = Math.round(((best.impact - best.takeaway) / fps) * 1000)
  const tempo_ratio = round1((best.top - best.takeaway) / (best.impact - best.top))
  return {
    detectable: true,
    frames: { takeaway: best.takeaway, top: best.top, impact: best.impact },
    duration_ms,
    tempo_ratio,
    flags,
  }
}

module.exports = { detectSwingFromPose, L_WRIST, R_WRIST }
