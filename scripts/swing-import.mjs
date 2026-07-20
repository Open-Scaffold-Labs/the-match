#!/usr/bin/env node
/**
 * Swing Intelligence V0 — archive importer CLI.
 *
 * Points at a folder of range-session videos (+ optional launch-monitor CSV
 * exports) and produces staged tm_swing_sessions / tm_swings / tm_ball_data
 * rows. This is the V0 pilot entry point (spec: wiki/synthesis/
 * swing-intelligence-build-spec-2026-07-16.md): batch importer + tempo engine
 * on Dale's archive, validated against his paired monitor stats.
 *
 * IO lives here; all logic lives in the pure, unit-tested libs:
 *   server/src/lib/swingTempo.js   — detection + tempo metrics
 *   server/src/lib/swingImport.js  — CSV mapping + session grouping + pairing
 *
 * Signal extraction uses ffmpeg (already a dev-machine dependency for media
 * work — install via `brew install ffmpeg` / `apt install ffmpeg`):
 *   motion[] — per-frame mean-luminance (YAVG) deltas via signalstats
 *   audio[]  — per-frame RMS level via astats (impact spike)
 *
 * Usage:
 *   node scripts/swing-import.mjs --videos /path/to/archive [--csv /path/to/exports]
 *                                 [--user 1] [--write] [--out staging.json]
 *
 * Default is DRY-RUN: prints a summary + writes staging JSON. --write inserts
 * into the DB (requires DATABASE_URL; never applied without explicit flag).
 */
import { createRequire } from 'node:module'
import { readdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const tempo = require('../server/src/lib/swingTempo.js')
const poseTempo = require('../server/src/lib/swingPoseTempo.js')
const swingPose = require('../server/src/lib/swingPose.js')
const imp = require('../server/src/lib/swingImport.js')
const run = promisify(execFile)

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.avi'])

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args[i + 1] : dflt
}
const VIDEO_DIR = opt('videos', null)
const CSV_DIR = opt('csv', null)
const USER_ID = Number(opt('user', 0))
const WRITE = args.includes('--write')
const POSE = args.includes('--pose')           // MediaPipe wrist-cycle tempo + pose metrics
const VIEW = opt('view', null)                 // default view: face_on | down_the_line

// Per-clip view override via filename (one folder can hold both angles):
//   "...dtl..." / "...behind..."  -> down_the_line
//   "...faceon..." / "...fo."     -> face_on
// Clips with no token and no --view default are honestly view_unknown:
// pose extraction still runs (metrics where valid), tempo is skipped.
function viewForClip(name) {
  const n = name.toLowerCase()
  if (/(^|[^a-z])(dtl|down[-_ ]?the[-_ ]?line|behind)([^a-z]|$)/.test(n)) return 'down_the_line'
  if (/(^|[^a-z])(fo|face[-_ ]?on)([^a-z]|$)/.test(n)) return 'face_on'
  return VIEW || null
}
const OUT = opt('out', path.join(process.cwd(), 'swing-import-staging.json'))

if (!VIDEO_DIR) {
  console.error('Usage: node scripts/swing-import.mjs --videos <dir> [--csv <dir>] [--user <id>] [--write] [--out file]')
  process.exit(1)
}

// ── ffmpeg signal extraction ────────────────────────────────────────────────
async function probe(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate,duration', '-of', 'json', file,
  ])
  const j = JSON.parse(stdout)
  const st = j.streams && j.streams[0]
  if (!st) return null
  const [n, d] = String(st.r_frame_rate || '30/1').split('/').map(Number)
  return { fps: d ? n / d : n, duration_s: Number(st.duration) || null }
}

async function extractSignals(file, fps) {
  // Per-frame mean luma; motion energy = abs frame-to-frame delta.
  const { stdout: vout } = await run('ffmpeg', [
    '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null', '-',
  ], { maxBuffer: 256 * 1024 * 1024 }).catch((e) => ({ stdout: e.stdout || '' }))
  const yavg = [...vout.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
  const motion = yavg.map((_, i) => (i === 0 ? 0 : Math.abs(yavg[i] - yavg[i - 1])))

  // Per-frame audio RMS (dB); resampled onto the video frame count by time.
  const { stdout: aout } = await run('ffmpeg', [
    '-i', file, '-af', 'astats=metadata=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-',
  ], { maxBuffer: 256 * 1024 * 1024 }).catch((e) => ({ stdout: e.stdout || '' }))
  const rmsDb = [...aout.matchAll(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)/g)].map((m) => Number(m[1]))
  let audio = null
  if (rmsDb.length > 0 && motion.length > 0) {
    // Map audio frame i → video frame floor(i * |V| / |A|); dB → linear-ish.
    audio = Array.from({ length: motion.length }, (_, v) => {
      const a = rmsDb[Math.floor((v * rmsDb.length) / motion.length)]
      return Number.isFinite(a) ? Math.pow(10, a / 20) : 0
    })
  }
  return { motion, audio, fps }
}

// ── pose extraction (MediaPipe via python helper) ───────────────────────────
// MP Pose 33 -> COCO-17 index map (feeds lib/swingPose.js computePoseMetrics).
const MP_TO_COCO = { 0: 0, 2: 1, 5: 2, 7: 3, 8: 4, 11: 5, 12: 6, 13: 7, 14: 8, 15: 9, 16: 10, 23: 11, 24: 12, 25: 13, 26: 14, 27: 15, 28: 16 }

async function extractPose(file) {
  try {
    const { stdout } = await run('python3', [path.join(SCRIPT_DIR, 'pose-extract.py'), file], { maxBuffer: 1024 * 1024 * 1024 })
    return JSON.parse(stdout)
  } catch (e) {
    return { error: e.message }
  }
}

// MediaPipe frames ([y,x,vis] px) -> COCO-17 [{x,y,score}] per frame.
function mpFramesToCoco(frames) {
  return (frames || []).map((f) => {
    if (!f) return null
    const out = new Array(17).fill(null)
    for (const [mp, coco] of Object.entries(MP_TO_COCO)) {
      const p = f[Number(mp)]
      if (p) out[coco] = { x: p[1], y: p[0], score: p[2] }
    }
    return out
  })
}

// ── walk inputs ─────────────────────────────────────────────────────────────
async function walkVideos(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  const clips = []
  for (const e of entries) {
    if (!e.isFile() || !VIDEO_EXT.has(path.extname(e.name).toLowerCase())) continue
    const full = path.join(e.parentPath || e.path || dir, e.name)
    clips.push({ path: full, folder: path.basename(path.dirname(full)), captured_at: null })
  }
  return clips
}

async function fillCaptureDates(clips) {
  for (const c of clips) {
    try {
      const { stdout } = await run('ffprobe', [
        '-v', 'error', '-show_entries', 'format_tags=creation_time', '-of', 'json', c.path,
      ])
      const t = JSON.parse(stdout)?.format?.tags?.creation_time
      c.captured_at = t ? new Date(t) : null
    } catch { c.captured_at = null }
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const clips = await walkVideos(VIDEO_DIR)
console.log(`Found ${clips.length} video clips under ${VIDEO_DIR}`)
await fillCaptureDates(clips)
const undated = clips.filter((c) => !c.captured_at)
if (undated.length) console.log(`  ! ${undated.length} clips have no creation_time — skipped (no guessing)`)

const sessions = imp.groupSessions(clips.filter((c) => c.captured_at))
console.log(`Grouped into ${sessions.length} sessions by capture date + folder`)

const staged = { user_id: USER_ID || null, generated_at: new Date().toISOString(), sessions: [] }

for (const s of sessions) {
  const stagedSession = { date: s.date, context: 'import', source: 'archive', club_slot: null, notes: null, swings: [], clips: [] }
  for (const c of s.clips) {
    const meta = await probe(c.path)
    if (!meta) { console.log(`  ! could not probe ${c.path} — skipped`); continue }
    const sig = await extractSignals(c.path, meta.fps)
    let result = tempo.analyzeClip(sig)
    let poseMetrics = null
    if (POSE) {
      const view = viewForClip(path.basename(c.path))
      const pose = view ? await extractPose(c.path) : { error: 'view_unknown (no --view default, no filename token)' }
      if (pose.error) {
        console.log(`  ! pose skipped for ${path.basename(c.path)}: ${pose.error.split('\n')[0]}`)
      } else {
        const pr = poseTempo.detectSwingFromPose({ frames: pose.frames, fps: pose.fps, view })
        if (pr.detectable) {
          // Pose wins when it fires: person-centric, immune to camera handling.
          result = { ...pr, impact_via: 'pose' }
        } else {
          result.flags = [...result.flags, ...pr.flags.filter((f) => f !== 'pose_tempo')]
        }
        // Pose metrics need phase frames; only a detected swing has them.
        if (pr.detectable) {
          const coco = mpFramesToCoco(pose.frames)
          const pf = {
            address: coco[pr.frames.takeaway] || null,
            top: coco[pr.frames.top] || null,
            impact: coco[pr.frames.impact] || null,
          }
          poseMetrics = swingPose.computePoseMetrics(pf, view)
        }
      }
    }
    stagedSession.clips.push({
      path: c.path,
      captured_at: c.captured_at,
      duration_ms: meta.duration_s ? Math.round(meta.duration_s * 1000) : null,
      swings: result.detectable ? [{ clip_start_ms: Math.round((result.frames.takeaway / sig.fps) * 1000), duration_ms: result.duration_ms }] : [],
    })
    stagedSession.swings.push({
      video_ref: c.path,
      clip_start_ms: result.frames ? Math.round((result.frames.takeaway / sig.fps) * 1000) : null,
      duration_ms: result.duration_ms,
      tempo_ratio: result.tempo_ratio,
      frames: result.frames,
      pose_metrics: poseMetrics,
      flags: result.flags,
    })
    const tag = result.detectable
      ? `${result.duration_ms}ms  ratio ${result.tempo_ratio}:1  (impact via ${result.impact_via || 'motion'})`
      : `undetectable [${result.flags.join(', ')}]`
    console.log(`  ${s.date}  ${path.basename(c.path)}  →  ${tag}`)
  }
  stagedSession.summary = tempo.summarize(
    stagedSession.swings.map((sw) => ({ detectable: sw.duration_ms != null, duration_ms: sw.duration_ms, tempo_ratio: sw.tempo_ratio }))
  )
  staged.sessions.push(stagedSession)
}

// ── optional ball-data attach ───────────────────────────────────────────────
if (CSV_DIR) {
  const entries = await readdir(CSV_DIR, { withFileTypes: true })
  for (const e of entries.filter((x) => x.isFile() && x.name.toLowerCase().endsWith('.csv'))) {
    const csv = readFileSync(path.join(CSV_DIR, e.name), 'utf8')
    const norm = imp.normalizeExport(csv)
    if (!norm.device) {
      console.log(`  ! ${e.name}: unmappable export (headers matched <3 fields) — reported, not guessed`)
      continue
    }
    console.log(`Ball data ${e.name}: ${norm.rows.length} rows (${norm.device}, ${norm.skipped} blank skipped)`)
    // Attach to same-date sessions; pairing to specific swings when
    // timestamps land inside a detected swing window (±PAIR_WINDOW_MS).
    for (const s of staged.sessions) {
      const dayRows = norm.rows.filter((r) => !r.recorded_at || r.recorded_at.toISOString().slice(0, 10) === s.date)
      if (!dayRows.length) continue
      const paired = imp.pairBallData(dayRows, s)
      s.ball_data = {
        source: 'csv', device: norm.device,
        session_level: paired.sessionLevel,
        per_swing: Object.fromEntries(paired.perSwing),
        unpaired: paired.unpaired,
      }
      console.log(`  → ${s.date}: ${paired.perSwing.size} swings joined, ${paired.sessionLevel.length} session-level, ${paired.unpaired.length} unpaired`)
    }
  }
}

// ── write / stage ───────────────────────────────────────────────────────────
await writeFile(OUT, JSON.stringify(staged, null, 2))
console.log(`\nStaging JSON → ${OUT}`)
const totals = staged.sessions.map((s) => s.summary)
console.log(`Totals: ${staged.sessions.length} sessions, ${totals.reduce((a, t) => a + t.swings, 0)} swings, ${totals.reduce((a, t) => a + t.measurable, 0)} measurable`)

if (WRITE) {
  if (!USER_ID) { console.error('--write requires --user <id>'); process.exit(1) }
  if (!process.env.DATABASE_URL) { console.error('--write requires DATABASE_URL'); process.exit(1) }
  const { Client } = require('pg')
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try {
    for (const s of staged.sessions) {
      const { rows } = await db.query(
        `INSERT INTO tm_swing_sessions (user_id, date, context, source) VALUES ($1,$2,$3,$4) RETURNING id`,
        [USER_ID, s.date, s.context, s.source]
      )
      const sid = rows[0].id
      for (const sw of s.swings) {
        await db.query(
          `INSERT INTO tm_swings (session_id, video_ref, clip_start_ms, duration_ms, tempo_ratio, frames, pose_metrics, flags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [sid, sw.video_ref, sw.clip_start_ms, sw.duration_ms, sw.tempo_ratio,
           sw.frames ? JSON.stringify(sw.frames) : null,
           sw.pose_metrics ? JSON.stringify(sw.pose_metrics) : null, sw.flags]
        )
      }
      if (s.ball_data) {
        for (const r of s.ball_data.session_level) {
          await db.query(
            `INSERT INTO tm_ball_data (session_id, recorded_at, club_speed, ball_speed, smash, launch_deg, spin, carry, total, source, device)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [sid, r.recorded_at, r.club_speed, r.ball_speed, r.smash, r.launch_deg, r.spin, r.carry, r.total, 'csv', s.ball_data.device]
          )
        }
      }
    }
    console.log('Inserted into DB. Migration 050 must be applied first.')
  } finally { await db.end() }
} else {
  console.log('DRY-RUN (no --write): nothing inserted.')
}
