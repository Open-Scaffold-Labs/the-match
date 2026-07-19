// Unit tests for the swing detection + tempo engine (lib/swingTempo.js).
// Run: node server/src/lib/__tests__/swing-tempo.test.cjs
const assert = require('node:assert/strict')
const T = require('../swingTempo.js')
let pass = 0
const ok = (n, c) => { assert.ok(c, n); console.log('  ✓ ' + n); pass++ }

// ── synthetic swing generator ───────────────────────────────────────────────
// Builds a per-frame motion series for one swing at a given fps:
//   quiet address → rising backswing → brief transition dip → violent
//   downswing → impact spike → follow-through decay.
// Ground truth: takeaway/top/impact frame indexes we planted.
function mkSwing({ fps = 240, backswingMs = 900, downswingMs = 300, audio = true } = {}) {
  const backF = Math.round((backswingMs / 1000) * fps)
  const downF = Math.round((downswingMs / 1000) * fps)
  const address = 30, follow = 40
  const motion = []
  for (let i = 0; i < address; i++) motion.push(0.05 + Math.random() * 0.02)
  const takeaway = motion.length
  for (let i = 0; i < backF; i++) motion.push(0.4 + 0.5 * Math.sin((i / backF) * Math.PI) + Math.random() * 0.05)
  const top = motion.length - 1
  motion[top] = 0.35 // transition dip
  for (let i = 0; i < downF; i++) motion.push(0.8 + (i / downF) * 3 + Math.random() * 0.1)
  const impact = motion.length - 1
  motion[impact] = 5.0
  for (let i = 0; i < follow; i++) motion.push(Math.max(0.05, 2.5 * Math.exp(-i / 10)))

  let audioArr = null
  if (audio) {
    audioArr = motion.map(() => 0.01 + Math.random() * 0.005)
    audioArr[impact] = 1.0 // impact spike
  }
  return { clip: { motion, audio: audioArr, fps }, truth: { takeaway, top, impact } }
}

// ── happy path: audio + motion ──────────────────────────────────────────────
{
  const { clip, truth } = mkSwing({ backswingMs: 900, downswingMs: 300 })
  const r = T.analyzeClip(clip)
  ok('synthetic swing detected', r.detectable === true)
  ok('impact found via audio', r.impact_via === 'audio' && r.frames.impact === truth.impact)
  ok('top within ±10% of planted transition', Math.abs(r.frames.top - truth.top) <= (truth.impact - truth.takeaway) * 0.1 + 2)
  ok('takeaway within ±10% of planted start', Math.abs(r.frames.takeaway - truth.takeaway) <= (truth.impact - truth.takeaway) * 0.1 + 2)
  ok('duration ≈ 1200ms planted', Math.abs(r.duration_ms - 1200) <= 150)
  ok('tempo ratio ≈ 3.0 planted', Math.abs(r.tempo_ratio - 3.0) <= 0.5)
  ok('no honesty flags on clean clip', r.flags.length === 0)
}

// ── no audio → motion fallback with honest flag ─────────────────────────────
{
  const { clip } = mkSwing({ audio: false })
  const r = T.analyzeClip(clip)
  ok('motion-only swing still detected', r.detectable === true)
  ok('flagged: no_impact_audio + impact_from_motion',
     r.flags.includes('no_impact_audio') && r.flags.includes('impact_from_motion'))
  ok('motion impact is near planted impact', Math.abs(r.frames.impact - (clip.motion.length - 41)) <= 3)
}

// ── tempo variety: fast vs slow swings measure differently ──────────────────
{
  const fast = T.analyzeClip(mkSwing({ backswingMs: 700, downswingMs: 280 }).clip)
  const slow = T.analyzeClip(mkSwing({ backswingMs: 1100, downswingMs: 320 }).clip)
  ok('fast swing measures shorter than slow', fast.duration_ms < slow.duration_ms)
  ok('both near planted ratios (2.5 vs 3.4)',
     Math.abs(fast.tempo_ratio - 2.5) <= 0.5 && Math.abs(slow.tempo_ratio - 3.4) <= 0.5)
}

// ── honesty: degenerate inputs return null + flags, never fabricated ────────
{
  const flat = { motion: Array.from({ length: 200 }, () => 1), fps: 240 }
  const r = T.analyzeClip(flat)
  ok('flat signal → undetectable, no_motion flag', r.detectable === false && r.flags.includes('no_motion'))
  ok('flat signal → null metrics', r.duration_ms === null && r.tempo_ratio === null && r.frames === null)

  const tooShort = T.analyzeClip({ motion: [1, 2, 3], fps: 240 })
  ok('tiny series → insufficient_signal', tooShort.detectable === false && tooShort.flags.includes('insufficient_signal'))

  const badFps = T.analyzeClip({ motion: Array.from({ length: 100 }, () => Math.random()), fps: 0 })
  ok('bad fps → insufficient_signal', badFps.detectable === false)

  // Waggle-speed burst: everything happens in 200ms — not a full swing.
  const waggle = { motion: Array.from({ length: 300 }, (_, i) => (i > 100 && i < 148 ? 3 * Math.random() + 1 : 0.05)), fps: 240 }
  const wr = T.analyzeClip(waggle)
  ok('sub-600ms burst rejected as full swing', wr.detectable === false || wr.duration_ms >= T.MIN_SWING_MS)
}

// ── summarize: medians, consistency gate, confidence ladder ─────────────────
{
  const empty = T.summarize([])
  ok('empty summary → insufficient, null medians', empty.confidence === 'insufficient' && empty.median_duration_ms === null)

  const mk = (ms, ratio) => ({ detectable: true, duration_ms: ms, tempo_ratio: ratio })
  const few = T.summarize([mk(1200, 3.0), mk(1240, 3.1)])
  ok('2 measurable → building, no consistency (sample gate)', few.confidence === 'building' && few.consistency === null)
  ok('median duration correct', few.median_duration_ms === 1220)

  const tight = T.summarize([mk(1200, 3), mk(1210, 3), mk(1195, 3), mk(1205, 3), mk(1200, 3), mk(1198, 3)])
  ok('6 tight swings → usable, tight consistency', tight.confidence === 'usable' && tight.consistency < 5)

  const many = T.summarize(Array.from({ length: 12 }, (_, i) => mk(1200 + (i % 3) * 10, 3)))
  ok('10+ measurable → strong confidence', many.confidence === 'strong')

  // Undetectable swings count toward the total but not the medians.
  const mixed = T.summarize([mk(1200, 3), { detectable: false }, mk(1300, 2.8)])
  ok('undetectable swings counted but excluded from medians', mixed.swings === 3 && mixed.measurable === 2 && mixed.median_duration_ms === 1250)
}

// ── clip-edge honesty guard (2026-07-20, from Dale's archive pilot) ─────────
// Real failure modes: record-button click at 0.0s read as audio impact;
// walk-back-to-camera in the last seconds read as motion impact (produced a
// plausible-looking, totally wrong 3900ms / 0.3:1). Both must now refuse.
{
  // Impact candidate (global motion peak) in the last 10% of the clip.
  const N = 300, fps = 60
  const motion = Array.from({ length: N }, () => 0.05 + Math.random() * 0.05)
  // A real swing mid-clip...
  for (let i = 90; i < 150; i++) motion[i] = 0.5 + Math.random() * 0.1
  for (let i = 150; i < 170; i++) motion[i] = 1.5 + (i - 150) * 0.1
  motion[170] = 3.5 // true impact
  // ...but camera handling at the end out-shouts it.
  for (let i = 285; i < N; i++) motion[i] = 4 + Math.random() * 2
  const r = T.analyzeClip({ motion, fps })
  ok('motion peak in last 10% → refused with impact_at_clip_edge',
    r.detectable === false && r.flags.includes('impact_at_clip_edge'))
  ok('edge refusal reports null metrics (never a fabricated tempo)',
    r.duration_ms === null && r.tempo_ratio === null)

  // Record-click audio spike at 0.0s must not be taken as impact.
  const { clip: c2, truth: t2 } = mkSwing({ fps: 240, backswingMs: 900, downswingMs: 300 })
  const audio = c2.motion.map(() => 0.01 + Math.random() * 0.005)
  audio[2] = 1.0 // record click inside the lead window
  audio[t2.impact] = 0.8 // true impact spike
  const r2 = T.analyzeClip({ motion: c2.motion, audio, fps: 240 })
  ok('lead-window audio spike ignored; true impact found',
    r2.detectable === true && r2.impact_via === 'audio' && Math.abs(r2.frames.impact - t2.impact) <= 2)

  // Camera-grab burst that starts BEFORE the tail window (Dale's Swing one:
  // real swing ~2-3.5s, phone picked up at 3.5s of a 4.9s clip). The burst
  // wins the global motion peak but never decays → unstable-tail refusal.
  {
    const N2 = 291, fps2 = 60
    const motion2 = Array.from({ length: N2 }, () => 0.05 + Math.random() * 0.05)
    for (let i = 120; i < 180; i++) motion2[i] = 0.4 + 0.4 * Math.sin(((i - 120) / 60) * Math.PI)
    for (let i = 180; i < 198; i++) motion2[i] = 0.8 + (i - 180) * 0.1
    motion2[198] = 2.2 // true impact
    for (let i = 199; i < 210; i++) motion2[i] = Math.max(0.05, 1.5 * Math.exp(-(i - 199) / 3))
    for (let i = 210; i < N2; i++) motion2[i] = 0.4 + Math.random() * 1.6 // grabbed phone
    const rr = T.analyzeClip({ motion: motion2, fps: fps2 })
    ok('sustained post-impact thrash → refused with impact_unstable_tail',
      rr.detectable === false && rr.flags.includes('impact_unstable_tail') && rr.duration_ms === null)
  }

  // A swing whose follow-through decays inside the tail window is still OK
  // (impact at ~90% of clip, exponential decay after — not camera handling).
  const { clip: c3, truth: t3 } = mkSwing({ fps: 240, backswingMs: 1100, downswingMs: 320 })
  const r3 = T.analyzeClip(c3)
  ok('decaying tail-window impact still detectable (follow-through, not handling)',
    r3.detectable === true && Math.abs(r3.frames.impact - t3.impact) <= 2)
}

console.log(`\nswing-tempo: ${pass} passed`)
