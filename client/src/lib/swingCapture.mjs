// On-device clip analysis for V1 guided capture (Swing Intelligence).
//
// Extracts the two signal series the tempo engine needs from a recorded
// clip — entirely inside WKWebView, no upload, no server round-trip:
//
//   motion[] — per-frame mean-luminance (YAVG) deltas. Frames are sampled by
//     drawing the video to a small offscreen canvas and averaging luma; the
//     same signal the server importer gets from ffmpeg signalstats.
//   audio[]  — per-frame-window RMS from WebAudio decodeAudioData, mapped
//     onto the video frame count (same normalization as the importer CLI).
//
// DOM-touching functions live at the bottom (analyzeVideoBlob); the pure
// math (lumaFromImageData, rmsSeries) is exported separately and unit-tested
// in node (lib/__tests__/swing-capture.test.mjs) with synthetic buffers.

// ── pure math (node-testable) ───────────────────────────────────────────────

// Mean luma (Rec. 601) of an RGBA pixel buffer. Step > 1 subsamples for
// speed — luma averages are stable at 1/4 resolution for motion energy.
export function lumaFromImageData(data, step = 4) {
  let sum = 0, n = 0
  for (let i = 0; i < data.length; i += 4 * step) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    n++
  }
  return n ? sum / n : 0
}

// Motion energy series: abs frame-to-frame luma delta, first frame 0.
export function motionSeries(lumas) {
  return lumas.map((_, i) => (i === 0 ? 0 : Math.abs(lumas[i] - lumas[i - 1])))
}

// Per-window RMS of a PCM channel, resampled onto `count` buckets.
// Matches the importer CLI's mapping: bucket v ← window floor(v·N/count).
export function rmsSeries(pcm, count) {
  if (!pcm || !pcm.length || count <= 0) return null
  const win = Math.max(1, Math.floor(pcm.length / count))
  const rms = []
  for (let w = 0; w * win < pcm.length; w++) {
    let sum = 0, n = 0
    for (let i = w * win; i < Math.min((w + 1) * win, pcm.length); i++) { sum += pcm[i] * pcm[i]; n++ }
    rms.push(n ? Math.sqrt(sum / n) : 0)
  }
  return Array.from({ length: count }, (_, v) => rms[Math.floor((v * rms.length) / count)] ?? 0)
}

// Effective fps of a sampled series given the clip duration.
export function effectiveFps(frameCount, durationMs) {
  return durationMs > 0 ? (frameCount / durationMs) * 1000 : 0
}

// ── DOM: blob → signals (browser only) ─────────────────────────────────────

const SAMPLE_W = 96          // luma averages don't need resolution
const TARGET_FPS = 30        // sampling cadence; engine is fps-agnostic
const MAX_CLIP_MS = 20_000   // guided capture records short clips

/**
 * Analyze a recorded video blob on-device.
 * @param {Blob} blob
 * @returns {Promise<{ motion:number[], audio:number[]|null, fps:number,
 *                     duration_ms:number } | { error:string }>}
 */
export async function analyzeVideoBlob(blob) {
  if (typeof document === 'undefined') return { error: 'no_dom' }
  const url = URL.createObjectURL(blob)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    await new Promise((res, rej) => {
      video.onloadedmetadata = res
      video.onerror = () => rej(new Error('video_load'))
    })
    const duration_ms = Math.round(video.duration * 1000)
    if (!Number.isFinite(duration_ms) || duration_ms <= 0) return { error: 'unreadable_clip' }
    if (duration_ms > MAX_CLIP_MS) return { error: 'clip_too_long' }

    // Frame sampling: seek-and-draw at TARGET_FPS. WKWebView-safe (no
    // requestVideoFrameCallback on older WebKit — seek is universally OK).
    const canvas = document.createElement('canvas')
    const scale = SAMPLE_W / (video.videoWidth || SAMPLE_W)
    canvas.width = SAMPLE_W
    canvas.height = Math.max(1, Math.round((video.videoHeight || SAMPLE_W) * scale))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const frames = Math.max(10, Math.floor((duration_ms / 1000) * TARGET_FPS))
    const lumas = []
    for (let f = 0; f < frames; f++) {
      video.currentTime = (f / frames) * video.duration
      await new Promise((res) => { video.onseeked = res })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      lumas.push(lumaFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height).data))
    }
    const fps = effectiveFps(frames, duration_ms)

    // Audio: decode the same blob. Silent clips / missing track → null
    // (the tempo engine flags no_impact_audio honestly).
    let audio = null
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      const actx = new AC()
      const buf = await actx.decodeAudioData(await blob.arrayBuffer())
      audio = rmsSeries(buf.getChannelData(0), frames)
      actx.close?.()
    } catch { audio = null }

    return { motion: motionSeries(lumas), audio, fps, duration_ms }
  } catch {
    return { error: 'analysis_failed' }
  } finally {
    URL.revokeObjectURL(url)
  }
}
