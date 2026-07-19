// Swing Intelligence V0 — swing detection + tempo engine.
//
// The flagship metric of the swing module (spec: wiki/synthesis/
// swing-intelligence-build-spec-2026-07-16.md §3): duration_ms (takeaway →
// impact) and tempo_ratio (backswing : downswing), computed from FRAME INDEXES
// alone — zero pose-model uncertainty. Tour Tempo lineage: ~3:1 ratio, and
// total time is itself a teaching factor (the stat Dale tracked for years).
//
// Detection contract: the caller (scripts/swing-import.mjs, later the in-app
// capture path) extracts two per-frame signal series from a clip with ffmpeg:
//   motion[]  — per-frame visual motion energy (mean abs luminance diff,
//               scene-change signal, or pose-wrist speed in later phases)
//   audio[]   — per-frame audio RMS (impact spike detection); may be null
// plus the clip's fps. This lib is PURE — no ffmpeg, no DB, no IO — so the
// detection logic is fully unit-testable (lib/__tests__/swing-tempo.test.cjs).
//
// Honesty contract (same doctrine as practice.js): when a phase boundary
// can't be determined credibly the metric is NULL plus a flag — never
// interpolated, never fabricated.

// ── signal helpers ──────────────────────────────────────────────────────────
const round1 = (x) => Math.round(x * 10) / 10

function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0 }

function stdev(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))))
}

// Simple moving average smoothing (window must be odd; clamped to series).
function smooth(xs, win = 5) {
  if (xs.length < 3) return xs.slice()
  const w = Math.max(3, win % 2 ? win : win + 1)
  const h = (w - 1) / 2
  return xs.map((_, i) => {
    const lo = Math.max(0, i - h), hi = Math.min(xs.length - 1, i + h)
    return mean(xs.slice(lo, hi + 1))
  })
}

// ── phase detection ─────────────────────────────────────────────────────────
//
// Swing model for a single swing inside a clip window:
//   address  — golfer set, motion near baseline
//   takeaway — motion rises off baseline and STAYS rising (the club starts back)
//   top      — local motion minimum between the backswing and downswing bursts
//              (the transition; many swings pause microscopically here)
//   impact   — audio spike when available, else the global motion peak
//
// We search backwards from impact: top = the lowest-motion frame in the
// middle band before impact; takeaway = the last frame before top whose
// motion is at/below baseline + k·σ and after which motion stays elevated.

const BASELINE_K = 1.5 // σ above mean = "moving"
const MIN_SWING_MS = 600   // faster than this isn't a full swing (practice waggle etc.)
const MAX_SWING_MS = 4000  // slower than this means detection lost the plot

function findImpact(motion, audio) {
  if (Array.isArray(audio) && audio.length) {
    const m = mean(audio), s = stdev(audio)
    let best = -1, bestV = m + 4 * s
    for (let i = 0; i < audio.length; i++) if (audio[i] > bestV) { bestV = audio[i]; best = i }
    if (best >= 0) return { frame: best, via: 'audio' }
  }
  let best = 0
  for (let i = 1; i < motion.length; i++) if (motion[i] > motion[best]) best = i
  return { frame: best, via: 'motion' }
}

function findTop(motion, impactFrame) {
  // Transition lives in the band [impact − 85%, impact − 15%] of the pre-impact
  // span. Restricting the band stops us locking onto address (too early) or
  // the downswing burst (too late).
  const lo = Math.floor(impactFrame * 0.15)
  const hi = Math.floor(impactFrame * 0.85)
  if (hi - lo < 3) return null
  let best = lo
  for (let i = lo + 1; i <= hi; i++) if (motion[i] < motion[best]) best = i
  return best
}

function findTakeaway(motion, topFrame) {
  // Baseline must come from the ADDRESS window (just before the takeaway),
  // not the whole clip — the downswing/follow-through tail inflates a global
  // mean+σ so much that a real backswing never crosses it.
  const addrEnd = Math.max(3, Math.floor(topFrame * 0.15))
  const addr = motion.slice(0, addrEnd)
  const base = mean(addr)
  const dev = stdev(addr)
  const peak = Math.max(...motion.slice(0, topFrame + 1))
  // Threshold: clearly above address noise, but a fraction of the backswing
  // rise — whichever is larger (noisy address wins, quiet address uses rise).
  const threshold = Math.max(base + BASELINE_K * dev, base + 0.2 * (peak - base))
  // Walk back from the top: the takeaway is where motion last sat at baseline
  // BEFORE the sustained rise. We require a few consecutive elevated frames
  // after the chosen point to reject one-frame noise.
  for (let i = topFrame - 1; i >= 0; i--) {
    if (motion[i] <= threshold) {
      let elevated = 0
      for (let j = i + 1; j <= Math.min(topFrame, i + 6); j++) {
        if (motion[j] > threshold) elevated++
      }
      if (elevated >= 3) return i
    }
  }
  return null
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Detect the single most prominent swing in a clip and compute tempo metrics.
 *
 * @param {object} clip
 * @param {number[]} clip.motion  per-frame motion energy (required)
 * @param {number[]} [clip.audio] per-frame audio RMS (optional; improves impact)
 * @param {number}   clip.fps     frames per second (required, > 0)
 * @returns {{
 *   detectable: boolean,
 *   frames: ?{ takeaway:number, top:number, impact:number },
 *   duration_ms: ?number,      // takeaway → impact
 *   tempo_ratio: ?number,      // backswing frames : downswing frames
 *   impact_via: ?'audio'|'motion',
 *   flags: string[]
 * }}
 */
function analyzeClip(clip) {
  const flags = []
  const fps = Number(clip && clip.fps)
  const rawMotion = clip && clip.motion
  if (!Array.isArray(rawMotion) || rawMotion.length < 10 || !Number.isFinite(fps) || fps <= 0) {
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, impact_via: null, flags: ['insufficient_signal'] }
  }

  const motion = smooth(rawMotion.map((x) => Math.max(0, Number(x) || 0)))
  const audio = Array.isArray(clip.audio) && clip.audio.length === rawMotion.length
    ? clip.audio.map((x) => Math.max(0, Number(x) || 0))
    : null
  if (!audio) flags.push('no_impact_audio')

  // Flat signal = nothing happened (or a static tripod shot of nothing).
  if (stdev(motion) < 1e-6) {
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, impact_via: null, flags: [...flags, 'no_motion'] }
  }

  const impact = findImpact(motion, audio)
  const top = findTop(motion, impact.frame)
  if (top == null) {
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, impact_via: impact.via, flags: [...flags, 'top_not_found'] }
  }
  const takeaway = findTakeaway(motion, top)
  if (takeaway == null) {
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, impact_via: impact.via, flags: [...flags, 'takeaway_not_found'] }
  }

  const duration_ms = Math.round(((impact.frame - takeaway) / fps) * 1000)
  const backswingF = top - takeaway
  const downswingF = impact.frame - top
  if (downswingF <= 0 || backswingF <= 0) {
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, impact_via: impact.via, flags: [...flags, 'degenerate_phases'] }
  }
  if (duration_ms < MIN_SWING_MS || duration_ms > MAX_SWING_MS) {
    flags.push(duration_ms < MIN_SWING_MS ? 'too_fast_for_full_swing' : 'too_slow_for_single_swing')
    return { detectable: false, frames: { takeaway, top, impact: impact.frame }, duration_ms: null, tempo_ratio: null, impact_via: impact.via, flags }
  }
  if (!audio) flags.push('impact_from_motion') // honest: peak-motion impact is ±2 frames

  return {
    detectable: true,
    frames: { takeaway, top, impact: impact.frame },
    duration_ms,
    tempo_ratio: round1(backswingF / downswingF),
    impact_via: impact.via,
    flags,
  }
}

/**
 * Summarise a set of analysed swings (one session, or an era of the timeline).
 * Medians, not means — tempo has outlier-prone tails (half swings, mis-hits).
 */
function summarize(swings) {
  const ok = (swings || []).filter((s) => s && s.detectable)
  if (!ok.length) {
    return { swings: (swings || []).length, measurable: 0, median_duration_ms: null, median_tempo_ratio: null, consistency: null, confidence: 'insufficient' }
  }
  const med = (xs) => {
    const s = xs.slice().sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  const durations = ok.map((s) => s.duration_ms)
  const ratios = ok.map((s) => s.tempo_ratio)
  const md = med(durations)
  // Consistency: coefficient of variation of duration. <5% is Tour-tight,
  // <10% is solid amateur. NULL below 3 measurable swings (sample-size gate).
  const cv = ok.length >= 3 && md > 0 ? round1((stdev(durations) / md) * 100) : null
  const confidence = ok.length >= 10 ? 'strong' : ok.length >= 5 ? 'usable' : 'building'
  return {
    swings: swings.length,
    measurable: ok.length,
    median_duration_ms: Math.round(md),
    median_tempo_ratio: round1(med(ratios)),
    consistency: cv,
    confidence,
  }
}

module.exports = { analyzeClip, summarize, MIN_SWING_MS, MAX_SWING_MS }
