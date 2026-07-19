// CLIENT TWIN of server/src/lib/swingTempo.js — the swing tempo engine.
//
// The engine is pure and dependency-free, so V1 guided capture runs it
// ON-DEVICE (WKWebView): frames are sampled to a canvas for motion energy,
// audio RMS comes from WebAudio decodeAudioData, and this module computes
// takeaway/top/impact → duration_ms + tempo_ratio without the clip ever
// leaving the phone. The server copy (CJS) is used by the archive importer
// CLI and read-time surfaces.
//
// PARITY IS ENFORCED: client/src/lib/__tests__/swing-tempo-parity.test.mjs
// loads BOTH copies (this one via import, the server one via createRequire)
// and asserts byte-identical outputs on a fixture battery. If you change one
// side, change the other — the test is the tripwire.

const BASELINE_K = 1.5
const MIN_SWING_MS = 600
const MAX_SWING_MS = 4000

const round1 = (x) => Math.round(x * 10) / 10
function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0 }
function stdev(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))))
}
function smooth(xs, win = 5) {
  if (xs.length < 3) return xs.slice()
  const w = Math.max(3, win % 2 ? win : win + 1)
  const h = (w - 1) / 2
  return xs.map((_, i) => {
    const lo = Math.max(0, i - h), hi = Math.min(xs.length - 1, i + h)
    return mean(xs.slice(lo, hi + 1))
  })
}

const EDGE_LEAD_MS = 500    // record-press / settle window at clip start
const EDGE_TAIL_PCT = 0.10  // walk-back / camera-grab window at clip end

function edgeWindows(fps, frameCount) {
  const lead = Math.min(Math.ceil((EDGE_LEAD_MS / 1000) * fps), Math.floor(frameCount / 4))
  const tail = Math.min(Math.ceil(frameCount * EDGE_TAIL_PCT), Math.floor(frameCount / 4))
  return { lead, tail }
}

function findImpact(motion, audio, lead) {
  if (Array.isArray(audio) && audio.length) {
    const m = mean(audio), s = stdev(audio)
    let best = -1, bestV = m + 4 * s
    for (let i = lead; i < audio.length; i++) if (audio[i] > bestV) { bestV = audio[i]; best = i }
    if (best >= 0) return { frame: best, via: 'audio' }
  }
  let best = Math.max(1, lead)
  for (let i = best + 1; i < motion.length; i++) if (motion[i] > motion[best]) best = i
  return { frame: best, via: 'motion' }
}

function findTop(motion, impactFrame) {
  const lo = Math.floor(impactFrame * 0.15)
  const hi = Math.floor(impactFrame * 0.85)
  if (hi - lo < 3) return null
  let best = lo
  for (let i = lo + 1; i <= hi; i++) if (motion[i] < motion[best]) best = i
  return best
}

function findTakeaway(motion, topFrame) {
  const addrEnd = Math.max(3, Math.floor(topFrame * 0.15))
  const addr = motion.slice(0, addrEnd)
  const base = mean(addr)
  const dev = stdev(addr)
  const peak = Math.max(...motion.slice(0, topFrame + 1))
  const threshold = Math.max(base + BASELINE_K * dev, base + 0.2 * (peak - base))
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

export function analyzeClip(clip) {
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

  if (stdev(motion) < 1e-6) {
    return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, impact_via: null, flags: [...flags, 'no_motion'] }
  }

  const { lead, tail } = edgeWindows(fps, motion.length)
  const impact = findImpact(motion, audio, lead)
  // Impact in the tail window that never decays = camera handling, not a
  // swing (a true impact is followed by follow-through DECAY). Refuse.
  if (impact.frame >= motion.length - tail) {
    const post = motion.slice(impact.frame + 1)
    const decayed = post.length > 0 && mean(post) < 0.3 * motion[impact.frame]
    if (!decayed) {
      return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, impact_via: impact.via, flags: [...flags, 'impact_at_clip_edge'] }
    }
  }
  // A motion-picked impact followed by SUSTAINED high motion (not decay) is
  // camera handling, not a swing: a true follow-through decays within ~0.3s,
  // a grabbed phone keeps thrashing. (Dale's archive pilot: practice swing +
  // real swing + walk-back clip — the walk-back won the global motion peak.)
  if (impact.via === 'motion') {
    const post = motion.slice(impact.frame + 1, impact.frame + 1 + Math.round(fps))
    if (post.length >= Math.round(fps / 2)) {
      const fracHigh = post.filter((v) => v > 0.3 * motion[impact.frame]).length / post.length
      if (fracHigh > 0.5) {
        return { detectable: false, frames: null, duration_ms: null, tempo_ratio: null, impact_via: impact.via, flags: [...flags, 'impact_unstable_tail'] }
      }
    }
  }
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
  if (!audio) flags.push('impact_from_motion')

  return {
    detectable: true,
    frames: { takeaway, top, impact: impact.frame },
    duration_ms,
    tempo_ratio: round1(backswingF / downswingF),
    impact_via: impact.via,
    flags,
  }
}

export function summarize(swings) {
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

export { MIN_SWING_MS, MAX_SWING_MS }
