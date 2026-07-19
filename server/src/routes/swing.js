const router      = require('express').Router()
const rateLimit   = require('express-rate-limit')
const Anthropic   = require('@anthropic-ai/sdk')
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { factsPromptBlock } = require('../lib/swingNarrator')

const anthropic = new Anthropic()
// Paid-model guard, same discipline as the Caddie route.
const narrateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  message: { error: 'The caddie needs a breather. Try again in a few minutes.' },
})
const { buildTimeline, detectEras, headline, narrate } = require('../lib/swingTimeline')
const { windowize, correlate, worthStrokes, prescribe } = require('../lib/swingJoin')
const { roundSG } = require('../lib/sg')

router.use(requireAuth)

// GET /api/swing/timeline
// Swing Intelligence V0 surface feed (spec: wiki/synthesis/
// swing-intelligence-build-spec-2026-07-16.md §Surfaces → Swing Timeline).
// Facts are stored deterministic in tm_swings; the timeline, eras, and
// headline are computed at READ time here — the same narration-at-read
// doctrine as the Caddie, so later phases enrich the payload without a
// data migration. Requires migration 050 (tm_swing_sessions / tm_swings).
router.get('/timeline', async (req, res) => {
  const uid = req.user.id
  try {
    const rows = await db.many(
      `SELECT w.session_id, s.date, s.club_slot, w.duration_ms, w.tempo_ratio
       FROM tm_swings w
       JOIN tm_swing_sessions s ON s.id = w.session_id
       WHERE s.user_id = $1
       ORDER BY s.date ASC`,
      [uid]
    )
    const timeline = buildTimeline(rows)
    const eras = detectEras(timeline)
    res.json({ timeline, eras, headline: headline(timeline, eras), narration: narrate(timeline, eras) })
  } catch (e) {
    // 42P01 = relation missing → migration 050 not applied on this env yet.
    // Honest empty state, not a 500: the surface renders its import prompt.
    if (e && e.code === '42P01') {
      return res.json({ timeline: [], eras: [], headline: headline([], []), narration: narrate([], []), pending_migration: true })
    }
    req.log?.error({ err: e }, 'swing timeline failed')
    res.status(500).json({ error: 'Failed to load swing timeline' })
  }
})

// POST /api/swing/session
// V1 guided capture: the client analyzes the clip ON-DEVICE and posts only
// the measured facts (spec §Privacy: video stays user-owned; metrics outlive
// footage). One session per capture; swings[] usually has one entry.
// Honesty contract enforced server-side: metrics may be null, flags pass
// through, nothing is back-filled.
router.post('/session', async (req, res) => {
  const uid = req.user.id
  const { context = 'range', source = 'capture', club_slot = null, view = null, swings = [] } = req.body || {}
  if (!['range', 'round', 'import'].includes(context)) return res.status(400).json({ error: 'bad context' })
  if (!['capture', 'archive'].includes(source)) return res.status(400).json({ error: 'bad source' })
  if (!Array.isArray(swings) || swings.length === 0 || swings.length > 20) {
    return res.status(400).json({ error: 'swings must be 1–20 entries' })
  }
  // Shape-check each swing: numbers or null, never coerced.
  for (const s of swings) {
    const okNum = (v) => v == null || Number.isFinite(Number(v))
    if (!okNum(s.duration_ms) || !okNum(s.tempo_ratio)) {
      return res.status(400).json({ error: 'duration_ms / tempo_ratio must be numbers or null' })
    }
  }
  try {
    const { rows } = await db.pool.query(
      `INSERT INTO tm_swing_sessions (user_id, date, context, club_slot, notes, source)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5) RETURNING id`,
      [uid, context, club_slot, view ? `view:${view}` : null, source]
    )
    const sid = rows[0].id
    for (const s of swings) {
      await db.pool.query(
        `INSERT INTO tm_swings (session_id, duration_ms, tempo_ratio, frames, pose_metrics, flags)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sid,
         s.duration_ms != null ? Math.round(Number(s.duration_ms)) : null,
         s.tempo_ratio != null ? Number(s.tempo_ratio) : null,
         s.frames ? JSON.stringify(s.frames) : null,
         s.pose_metrics ? JSON.stringify(s.pose_metrics) : null,
         Array.isArray(s.flags) ? s.flags.map(String).slice(0, 10) : []]
      )
    }
    res.status(201).json({ session_id: sid, swings: swings.length })
  } catch (e) {
    if (e && e.code === '42P01') return res.status(503).json({ error: 'Swing Intelligence not yet enabled', pending_migration: true })
    req.log?.error({ err: e }, 'swing session save failed')
    res.status(500).json({ error: 'Failed to save swing session' })
  }
})

// GET /api/swing/join
// V2 — THE JOIN (spec §Pipeline.6 + §Worth-strokes): swing metrics × SG
// co-movement, worth-strokes fault ranking, drill prescription. All computed
// at read time from tm_swings facts + the existing SG engine. Sample gates
// (MIN_PAIRS/MIN_SIDE in lib/swingJoin) mean most users see the honest
// 'too_early' state until they've filmed + played enough — that IS the
// feature working as designed.
router.get('/join', async (req, res) => {
  const uid = req.user.id
  try {
    const [swingRows, rounds, userRow] = await Promise.all([
      db.many(
        `SELECT w.session_id, s.date, s.club_slot, w.duration_ms, w.tempo_ratio
         FROM tm_swings w JOIN tm_swing_sessions s ON s.id = w.session_id
         WHERE s.user_id = $1 ORDER BY s.date ASC`,
        [uid]
      ),
      db.many(
        `SELECT total, course_par, course_rating, date, scores, putts, first_putts, shots, hole_pars
         FROM tm_rounds WHERE user_id = $1 ORDER BY date ASC LIMIT 60`,
        [uid]
      ),
      db.one('SELECT handicap, sg_baseline FROM tm_users WHERE id = $1', [uid]),
    ])
    const j = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return null } }
    const handicap = userRow && Number.isFinite(Number(userRow.handicap)) ? Number(userRow.handicap) : null
    const sgRounds = []
    for (const r of rounds) {
      const sg = roundSG(
        { ...r, scores: j(r.scores), putts: j(r.putts), first_putts: j(r.first_putts), shots: j(r.shots) },
        userRow?.sg_baseline ?? 'auto', handicap
      )
      if (sg) sgRounds.push({ date: r.date, sgTotal: sg.sgTotal, sgT2G: sg.sgT2G, sgP: sg.sgP })
    }
    const timeline = buildTimeline(swingRows)
    const windows = windowize(timeline, sgRounds)
    const ws = worthStrokes(windows)
    res.json({
      windows,
      correlation: correlate(windows),
      worth_strokes: ws,
      prescription: prescribe(ws.top),
    })
  } catch (e) {
    if (e && e.code === '42P01') {
      return res.json({ windows: [], correlation: correlate([]), worth_strokes: worthStrokes([]), prescription: null, pending_migration: true })
    }
    req.log?.error({ err: e }, 'swing join failed')
    res.status(500).json({ error: 'Failed to compute swing join' })
  }
})

// POST /api/swing/import
// V3 archive onboarding: the client analyzed every clip ON-DEVICE and posts
// session-shaped facts grouped by capture date. Same facts-only contract as
// /session — numbers-or-null, flags pass through, nothing back-filled.
// Caps bound abuse: 60 sessions, 10 swings each.
router.post('/import', async (req, res) => {
  const uid = req.user.id
  const sessions = req.body?.sessions
  if (!Array.isArray(sessions) || sessions.length === 0 || sessions.length > 60) {
    return res.status(400).json({ error: 'sessions must be 1–60 entries' })
  }
  const okNum = (v) => v == null || Number.isFinite(Number(v))
  for (const s of sessions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date || ''))) {
      return res.status(400).json({ error: 'each session needs a YYYY-MM-DD date' })
    }
    const swings = Array.isArray(s.swings) ? s.swings : []
    if (swings.length > 10) return res.status(400).json({ error: 'max 10 swings per session' })
    for (const w of swings) {
      if (!okNum(w.duration_ms) || !okNum(w.tempo_ratio)) {
        return res.status(400).json({ error: 'duration_ms / tempo_ratio must be numbers or null' })
      }
    }
  }
  try {
    let insertedSessions = 0, insertedSwings = 0
    for (const s of sessions) {
      const { rows } = await db.pool.query(
        `INSERT INTO tm_swing_sessions (user_id, date, context, club_slot, notes, source)
         VALUES ($1, $2, 'import', NULL, NULL, 'archive') RETURNING id`,
        [uid, s.date]
      )
      insertedSessions++
      for (const w of (s.swings || [])) {
        await db.pool.query(
          `INSERT INTO tm_swings (session_id, duration_ms, tempo_ratio, frames, pose_metrics, flags)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [rows[0].id,
           w.duration_ms != null ? Math.round(Number(w.duration_ms)) : null,
           w.tempo_ratio != null ? Number(w.tempo_ratio) : null,
           w.frames ? JSON.stringify(w.frames) : null,
           w.pose_metrics ? JSON.stringify(w.pose_metrics) : null,
           Array.isArray(w.flags) ? w.flags.map(String).slice(0, 10) : []]
        )
        insertedSwings++
      }
    }
    res.status(201).json({ sessions: insertedSessions, swings: insertedSwings })
  } catch (e) {
    if (e && e.code === '42P01') return res.status(503).json({ error: 'Swing Intelligence not yet enabled', pending_migration: true })
    req.log?.error({ err: e }, 'swing import failed')
    res.status(500).json({ error: 'Failed to import swing sessions' })
  }
})

// POST /api/swing/ball-data
// V3 optional monitor leg, manual quick-entry (spec §5: manual → CSV →
// Garmin API ladder). Session-level pairing by default. Facts-or-null; an
// empty row is rejected rather than stored blank.
const BALL_FIELDS = ['club_speed', 'ball_speed', 'smash', 'launch_deg', 'spin', 'carry', 'total']
router.post('/ball-data', async (req, res) => {
  const uid = req.user.id
  const { session_id, device = null } = req.body || {}
  if (!Number.isFinite(Number(session_id))) return res.status(400).json({ error: 'session_id required' })
  const vals = {}
  let present = 0
  for (const f of BALL_FIELDS) {
    const v = req.body[f]
    if (v == null || v === '') { vals[f] = null; continue }
    if (!Number.isFinite(Number(v))) return res.status(400).json({ error: `${f} must be a number` })
    vals[f] = Number(v)
    present++
  }
  if (!present) return res.status(400).json({ error: 'at least one metric required' })
  try {
    // Ownership check: the session must belong to this user.
    const own = await db.many('SELECT id FROM tm_swing_sessions WHERE id = $1 AND user_id = $2', [Number(session_id), uid])
    if (!own.length) return res.status(404).json({ error: 'session not found' })
    const { rows } = await db.pool.query(
      `INSERT INTO tm_ball_data (session_id, club_speed, ball_speed, smash, launch_deg, spin, carry, total, source, device)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9) RETURNING id`,
      [Number(session_id), vals.club_speed, vals.ball_speed, vals.smash, vals.launch_deg, vals.spin, vals.carry, vals.total, device]
    )
    res.status(201).json({ id: rows[0].id })
  } catch (e) {
    if (e && e.code === '42P01') return res.status(503).json({ error: 'Swing Intelligence not yet enabled', pending_migration: true })
    req.log?.error({ err: e }, 'ball data save failed')
    res.status(500).json({ error: 'Failed to save ball data' })
  }
})

// POST /api/swing/narrate
// The LLM narrator (spec §Pipeline.6): deterministic facts → prompt block →
// model writes the human sentence. NEVER the video. Fail-soft: any failure
// (no key, model error, empty completion) returns the TEMPLATE narrator's
// lines with source:'template' — the player always gets an honest read.
router.post('/narrate', narrateLimiter, async (req, res) => {
  const uid = req.user.id
  try {
    const [swingRows, ballRows] = await Promise.all([
      db.many(
        `SELECT w.session_id, s.date, s.club_slot, w.duration_ms, w.tempo_ratio
         FROM tm_swings w JOIN tm_swing_sessions s ON s.id = w.session_id
         WHERE s.user_id = $1 ORDER BY s.date ASC`,
        [uid]
      ),
      db.many(
        `SELECT b.club_speed, b.carry FROM tm_ball_data b
         JOIN tm_swing_sessions s ON s.id = b.session_id
         WHERE s.user_id = $1 ORDER BY b.created_at DESC LIMIT 50`,
        [uid]
      ).catch(() => []), // ball table may be empty; never fatal
    ])
    const timeline = buildTimeline(swingRows)
    const eras = detectEras(timeline)
    const fallback = narrate(timeline, eras)
    const block = factsPromptBlock({ timeline, eras, ball: ballRows })
    if (!block) return res.json({ lines: fallback.lines, note: fallback.note, source: 'template' })

    try {
      const msg = await anthropic.messages.create({
        model: process.env.CADDIE_MODEL || 'claude-sonnet-5',
        max_tokens: 300,
        system: 'You are The Match\'s swing caddie. Narrate the player\'s swing facts per the instructions.',
        messages: [{ role: 'user', content: block }],
      })
      const text = (msg.content ?? [])
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text).join('').trim()
      if (!text) throw new Error('empty completion')
      res.json({ lines: [text], source: 'llm' })
    } catch (e) {
      req.log?.warn({ err: e }, 'swing narrator LLM failed — template fallback')
      res.json({ lines: fallback.lines, note: fallback.note, source: 'template' })
    }
  } catch (e) {
    if (e && e.code === '42P01') return res.json({ lines: [], source: 'template', pending_migration: true })
    req.log?.error({ err: e }, 'swing narrate failed')
    res.status(500).json({ error: 'Failed to narrate' })
  }
})

// POST /api/swing/ball-data-csv
// Monitor leg, CSV rung (spec §5): upload a Rapsodo / Garmin R10 / Mevo
// export; rows normalize via lib/swingImport and attach session-level.
// Unmappable exports are reported, never guessed. Cap 500 rows.
const { normalizeExport } = require('../lib/swingImport')
router.post('/ball-data-csv', async (req, res) => {
  const uid = req.user.id
  const { session_id, csv } = req.body || {}
  if (!Number.isFinite(Number(session_id))) return res.status(400).json({ error: 'session_id required' })
  if (typeof csv !== 'string' || !csv.trim() || csv.length > 512_000) {
    return res.status(400).json({ error: 'csv text required (max 512KB)' })
  }
  const norm = normalizeExport(csv)
  if (!norm.device) return res.status(422).json({ error: 'Unrecognized export — headers matched fewer than 3 known fields', inserted: 0 })
  const rows = norm.rows.slice(0, 500)
  try {
    const own = await db.many('SELECT id FROM tm_swing_sessions WHERE id = $1 AND user_id = $2', [Number(session_id), uid])
    if (!own.length) return res.status(404).json({ error: 'session not found' })
    for (const r of rows) {
      await db.pool.query(
        `INSERT INTO tm_ball_data (session_id, recorded_at, club_speed, ball_speed, smash, launch_deg, spin, carry, total, source, device)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'csv',$10)`,
        [Number(session_id), r.recorded_at, r.club_speed, r.ball_speed, r.smash, r.launch_deg, r.spin, r.carry, r.total, norm.device]
      )
    }
    res.status(201).json({ inserted: rows.length, device: norm.device, skipped: norm.skipped })
  } catch (e) {
    if (e && e.code === '42P01') return res.status(503).json({ error: 'Swing Intelligence not yet enabled', pending_migration: true })
    req.log?.error({ err: e }, 'ball data csv failed')
    res.status(500).json({ error: 'Failed to import ball data' })
  }
})

module.exports = router
