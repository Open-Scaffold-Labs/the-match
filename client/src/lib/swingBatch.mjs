// Archive batch import — grouping + orchestration for V3 onboarding
// (spec §Surfaces: archive import is the onboarding hook).
//
// The user picks a stack of camera-roll videos; we group them into sessions
// by capture date (file.lastModified — camera-roll exports preserve it),
// analyze each clip ON-DEVICE via lib/swingCapture.mjs, and hand the caller
// session-shaped results ready for POST /api/swing/import.
//
// Pure grouping logic is exported separately for node tests; the analysis
// loop takes injected analyzers so progress + cancellation are testable.

// ── grouping (pure) ─────────────────────────────────────────────────────────

/**
 * Group picked files into sessions by capture date (UTC day of
 * file.lastModified — same convention as the server importer CLI's
 * creation_time grouping).
 * @param {Array<{ name:string, lastModified:number }>} files
 * @returns {Array<{ date:string, files:Array }>} sorted ascending
 */
export function groupFilesByDate(files) {
  const groups = new Map()
  for (const f of files || []) {
    const t = Number(f.lastModified)
    if (!Number.isFinite(t) || t <= 0) continue // undated: caller reports, never guessed
    const date = new Date(t).toISOString().slice(0, 10)
    if (!groups.has(date)) groups.set(date, { date, files: [] })
    groups.get(date).files.push(f)
  }
  return [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

// ── analysis loop ───────────────────────────────────────────────────────────

const VIDEO_EXT = /\.(mp4|mov|m4v|avi|webm)$/i

/**
 * Analyze picked files into session payloads.
 * @param {File[]} files
 * @param {object} io
 * @param {(blob:Blob, opts?:object)=>Promise<object>} io.analyze  analyzeVideoBlob
 * @param {(engineResult:object)=>object} io.engine  tempo analyzeClip
 * @param {(done:number,total:number,file:string)=>void} [io.onProgress]
 * @param {{maxClipMs?:number}} [opts]  archive clips can exceed the guided
 *   8s capture limit — pass a larger maxClipMs (one swing per clip assumed;
 *   longer clips are still analyzed, flagged by the engine if undetectable)
 * @returns {Promise<{ sessions:Array, skipped:Array<{file:string,reason:string}> }>}
 */
export async function analyzeBatch(files, io, opts = {}) {
  const videos = (files || []).filter((f) => VIDEO_EXT.test(f.name))
  const skipped = (files || []).filter((f) => !VIDEO_EXT.test(f.name))
    .map((f) => ({ file: f.name, reason: 'not_a_video' }))
  const groups = groupFilesByDate(videos)

  const sessions = []
  let done = 0
  for (const g of groups) {
    const session = { date: g.date, context: 'import', source: 'archive', swings: [] }
    for (const f of g.files) {
      io.onProgress?.(++done, videos.length, f.name)
      try {
        const signals = await io.analyze(f, opts)
        if (signals.error) { skipped.push({ file: f.name, reason: signals.error }); continue }
        const r = io.engine(signals)
        session.swings.push({
          duration_ms: r.duration_ms,
          tempo_ratio: r.tempo_ratio,
          frames: r.frames,
          flags: r.flags,
        })
      } catch {
        skipped.push({ file: f.name, reason: 'analysis_failed' })
      }
    }
    // Sessions where every clip failed still go back — the route keeps them
    // honest (a date marker with zero measurable swings) and the UI reports.
    sessions.push(session)
  }
  return { sessions, skipped }
}
