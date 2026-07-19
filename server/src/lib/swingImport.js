// Swing Intelligence V0 — archive import pipeline (pure logic).
//
// Turns Dale's multi-year range archive into tm_swing_sessions / tm_swings /
// tm_ball_data rows. Two halves:
//
//   1. CLIP GROUPING — archive folders are heterogeneous (one swing per clip,
//      many swings per clip, mixed dates). We group clips into sessions by
//      capture date (+ optional folder hint) and let the tempo engine find
//      the swings inside each clip.
//
//   2. BALL-DATA ATTACH — OPTIONAL launch-monitor CSV exports (Rapsodo,
//      Garmin R10, Mevo) are normalised into a common row shape, then paired
//      to sessions by timestamp. Session-level pairing is the DEFAULT
//      (spec §5); a row is joined to a specific swing only when its timestamp
//      falls inside that swing's detected clip window ±PAIR_WINDOW_MS.
//
// Pure functions only — no fs, no ffmpeg, no DB. The CLI (scripts/
// swing-import.mjs) does IO and calls these. Fully unit-tested
// (lib/__tests__/swing-import.test.cjs).

// ── CSV parsing ─────────────────────────────────────────────────────────────

// Minimal RFC-4180-ish CSV parse (quoted fields, commas, CRLF). Monitor
// exports are small; no streaming needed.
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

// ── device header maps ──────────────────────────────────────────────────────
// Each map: canonical field → list of header aliases (lowercased, trimmed).
// Devices rename columns between firmware versions; aliases keep us working
// across exports from different years of the archive.
const HEADER_MAPS = {
  rapsodo: {
    recorded_at: ['date', 'timestamp', 'time'],
    club_speed:  ['club speed', 'club head speed', 'club speed (mph)'],
    ball_speed:  ['ball speed', 'ball speed (mph)'],
    smash:       ['smash factor', 'smash'],
    launch_deg:  ['launch angle', 'launch angle (deg)', 'launch direction'],
    spin:        ['spin rate', 'total spin', 'spin (rpm)'],
    carry:       ['carry distance', 'carry', 'carry (yds)'],
    total:       ['total distance', 'total', 'total (yds)'],
  },
  garmin_r10: {
    recorded_at: ['date', 'timestamp'],
    club_speed:  ['club head speed', 'club speed'],
    ball_speed:  ['ball speed'],
    smash:       ['smash factor'],
    launch_deg:  ['launch angle'],
    spin:        ['back spin', 'spin rate', 'total spin'],
    carry:       ['carry distance', 'carry'],
    total:       ['total distance', 'total'],
  },
  mevo: {
    recorded_at: ['date', 'time', 'timestamp'],
    club_speed:  ['club speed', 'club head speed'],
    ball_speed:  ['ball speed'],
    smash:       ['smash', 'smash factor'],
    launch_deg:  ['vertical launch angle', 'launch angle'],
    spin:        ['spin rate', 'back spin'],
    carry:       ['carry', 'carry distance'],
    total:       ['total', 'total distance'],
  },
}

// Sniff which device produced an export from its headers. Returns null when
// fewer than 3 canonical fields resolve — we do not guess at partial maps
// (honesty contract: an unmappable export is skipped and reported, not mangled).
function sniffDevice(headerRow) {
  const headers = headerRow.map((h) => String(h).trim().toLowerCase())
  let best = null, bestHits = 0
  for (const [device, map] of Object.entries(HEADER_MAPS)) {
    const hits = Object.values(map).filter((aliases) => aliases.some((a) => headers.includes(a))).length
    if (hits > bestHits) { bestHits = hits; best = device }
  }
  return bestHits >= 3 ? best : null
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Normalise a monitor CSV export into canonical ball-data rows.
 * @returns {{ device: ?string, rows: Array, skipped: number }}
 *   rows: { recorded_at: Date|null, club_speed, ball_speed, smash,
 *           launch_deg, spin, carry, total } — any metric NULL when absent.
 *   device NULL (rows empty) when the export is unmappable.
 */
function normalizeExport(csvText) {
  const rows = parseCsv(csvText)
  if (rows.length < 2) return { device: null, rows: [], skipped: 0 }
  const device = sniffDevice(rows[0])
  if (!device) return { device: null, rows: [], skipped: Math.max(0, rows.length - 1) }

  const headers = rows[0].map((h) => String(h).trim().toLowerCase())
  const map = HEADER_MAPS[device]
  const idx = {}
  for (const [field, aliases] of Object.entries(map)) {
    idx[field] = aliases.map((a) => headers.indexOf(a)).find((i) => i >= 0) ?? -1
  }
  const out = []
  let skipped = 0
  for (const r of rows.slice(1)) {
    const get = (f) => (idx[f] >= 0 ? r[idx[f]] : undefined)
    const t = get('recorded_at')
    const when = t ? new Date(isNaN(Number(t)) ? t : Number(t)) : null
    const row = {
      recorded_at: when && !isNaN(when) ? when : null,
      club_speed: num(get('club_speed')),
      ball_speed: num(get('ball_speed')),
      smash:      num(get('smash')),
      launch_deg: num(get('launch_deg')),
      spin:       num(get('spin')),
      carry:      num(get('carry')),
      total:      num(get('total')),
    }
    // A row with no metrics at all is a blank/export-artifact line — skip it.
    if (['club_speed', 'ball_speed', 'carry'].every((k) => row[k] == null)) skipped++
    else out.push(row)
  }
  return { device, rows: out, skipped }
}

// ── session grouping ────────────────────────────────────────────────────────

/**
 * Group archive clips into sessions by capture date. Clips already belonging
 * to a folder may pass folderHint; same-date same-folder clips merge into one
 * session (a bucket filmed across several iPhone clips is ONE session).
 *
 * @param {Array<{ path:string, captured_at:Date|string, folder?:string }>} clips
 * @returns {Array<{ key:string, date:string, clips:Array }>} sorted by date
 */
function groupSessions(clips) {
  const groups = new Map()
  for (const c of clips || []) {
    const d = new Date(c.captured_at)
    if (isNaN(d)) continue // undated clips are reported by the CLI, not guessed
    const date = d.toISOString().slice(0, 10)
    const key = `${date}|${c.folder || ''}`
    if (!groups.has(key)) groups.set(key, { key, date, clips: [] })
    groups.get(key).clips.push(c)
  }
  return [...groups.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

// ── ball-data pairing ───────────────────────────────────────────────────────

// Per-swing join window: a monitor row joins a swing only when its timestamp
// lands within ±90s of the swing's absolute clip window. Monitor clocks and
// phone clocks drift; wider than this and pairing confidence collapses.
const PAIR_WINDOW_MS = 90_000

/**
 * Pair normalised ball-data rows to a session (and, when timestamps allow,
 * to specific swings).
 *
 * @param {Array} ballRows   from normalizeExport()
 * @param {object} session   { clips: [{ captured_at, duration_ms, swings: [{clip_start_ms, duration_ms}] }] }
 * @returns {{ sessionLevel: Array, perSwing: Map<number, Array>, unpaired: Array }}
 *   perSwing maps swing index → rows; rows with no timestamp go session-level.
 */
function pairBallData(ballRows, session) {
  const sessionLevel = [], unpaired = [], perSwing = new Map()

  // Absolute window for each detected swing in the session.
  const windows = []
  for (const clip of session.clips || []) {
    const clipStart = new Date(clip.captured_at).getTime()
    if (isNaN(clipStart)) continue
    for (const sw of clip.swings || []) {
      windows.push({
        index: windows.length,
        start: clipStart + (sw.clip_start_ms || 0),
        end:   clipStart + (sw.clip_start_ms || 0) + (sw.duration_ms || 0),
      })
    }
  }

  for (const row of ballRows || []) {
    if (!row.recorded_at) { sessionLevel.push(row); continue }
    const t = row.recorded_at.getTime()
    const hit = windows.find((w) => t >= w.start - PAIR_WINDOW_MS && t <= w.end + PAIR_WINDOW_MS)
    if (hit) {
      if (!perSwing.has(hit.index)) perSwing.set(hit.index, [])
      perSwing.get(hit.index).push(row)
    } else {
      // Timestamp exists but matches no swing window: still valuable at
      // session level (spec: session-level pairing default). Unpaired only
      // when the session has NO detected swings at all.
      (windows.length ? sessionLevel : unpaired).push(row)
    }
  }
  return { sessionLevel, perSwing, unpaired }
}

module.exports = { parseCsv, sniffDevice, normalizeExport, groupSessions, pairBallData, PAIR_WINDOW_MS }
