// On-device pose estimation — Swing Intelligence V1.5.
//
// Runs a MoveNet-class single-pose ONNX model in WKWebView via
// onnxruntime-web (already bundled). The model loads LAZILY from a
// configurable URL (import.meta.env.VITE_POSE_MODEL_URL) and the whole
// module is FAIL-SOFT: no model URL, failed download, or inference error →
// null, and the caller simply saves no pose metrics. The honesty contract
// is structural: we only ever report what the model actually saw, with
// per-metric confidence from lib/swingPose.mjs.
//
// Only THREE frames are estimated per swing (address/top/impact from the
// tempo engine) — inference cost is trivial even on older iPhones.

const MODEL_INPUT = 192 // MoveNet lightning input size
// Bundled default (Option A hosting, decided 2026-07-19): MoveNet
// SinglePose Lightning int8, converted TFLite→ONNX (tf2onnx, opset 13).
// Apache 2.0 — see THIRD_PARTY_NOTICES.md. Override with VITE_POSE_MODEL_URL.
const DEFAULT_MODEL_URL = '/models/movenet-lightning-192.onnx'

let _session = null
let _tried = false

// Lazy singleton. Returns null when unavailable — never throws.
async function getSession() {
  if (_session || _tried) return _session
  _tried = true
  const url = import.meta.env?.VITE_POSE_MODEL_URL || DEFAULT_MODEL_URL
  try {
    const ort = await import('onnxruntime-web')
    _session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'] })
  } catch { _session = null }
  return _session
}

// Draw one video frame to a 192×192 tensor (NHWC uint8 — the bundled int8
// model's input type; float variants take int32 instead, override URL only).
function frameToTensor(video, ort) {
  const canvas = document.createElement('canvas')
  canvas.width = MODEL_INPUT
  canvas.height = MODEL_INPUT
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  // Center-crop to square, then scale — matches MoveNet preprocessing.
  const side = Math.min(video.videoWidth, video.videoHeight)
  const sx = (video.videoWidth - side) / 2
  const sy = (video.videoHeight - side) / 2
  ctx.drawImage(video, sx, sy, side, side, 0, 0, MODEL_INPUT, MODEL_INPUT)
  const { data } = ctx.getImageData(0, 0, MODEL_INPUT, MODEL_INPUT)
  const rgb = new Uint8Array(MODEL_INPUT * MODEL_INPUT * 3)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2]
  }
  return new ort.Tensor('uint8', rgb, [1, MODEL_INPUT, MODEL_INPUT, 3])
}

async function estimateFrame(video, t, session, ort) {
  video.currentTime = t
  await new Promise((res) => { video.onseeked = res })
  const feeds = { [session.inputNames[0]]: frameToTensor(video, ort) }
  const out = await session.run(feeds)
  const raw = out[session.outputNames[0]].data // Float32 [1,1,17,3] → y,x,score
  const kps = []
  for (let k = 0; k < 17; k++) {
    const y = raw[k * 3], x = raw[k * 3 + 1], score = raw[k * 3 + 2]
    // Model outputs normalized [0,1] within the SQUARE CROP — convert back
    // to original-frame pixel space so metric normalization is consistent.
    const side = Math.min(video.videoWidth, video.videoHeight)
    kps.push({
      x: x * side + (video.videoWidth - side) / 2,
      y: y * side + (video.videoHeight - side) / 2,
      score,
    })
  }
  return kps
}

/**
 * Estimate keypoints at the tempo engine's phase frames.
 * @param {Blob} blob     recorded clip
 * @param {object} frames { takeaway, top, impact } frame indexes
 * @param {number} fps    sampling fps used by the tempo engine
 * @returns {Promise<{ address:KP[], top:KP[], impact:KP[] } | null>}
 *   null when the model is unavailable or estimation fails — callers must
 *   treat null as "no pose data", never as an error state.
 */
export async function estimatePoseFrames(blob, frames, fps) {
  if (typeof document === 'undefined' || !frames || !(fps > 0)) return null
  const session = await getSession()
  if (!session) return null
  try {
    const ort = await import('onnxruntime-web')
    const url = URL.createObjectURL(blob)
    try {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      video.src = url
      await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = rej })
      const tOf = (f) => Math.min(video.duration - 0.001, f / fps)
      // Sequential — seeks on a single <video> race if parallelized.
      const address = await estimateFrame(video, tOf(frames.takeaway), session, ort)
      const top = await estimateFrame(video, tOf(frames.top), session, ort)
      const impact = await estimateFrame(video, tOf(frames.impact), session, ort)
      return { address, top, impact }
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return null
  }
}

// Test hook: reset the lazy singleton (unit tests / model URL changes).
export function _resetPoseSession() { _session = null; _tried = false }
