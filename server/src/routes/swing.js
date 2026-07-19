const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { buildTimeline, detectEras, headline, narrate } = require('../lib/swingTimeline')

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
        `INSERT INTO tm_swings (session_id, duration_ms, tempo_ratio, frames, flags)
         VALUES ($1, $2, $3, $4, $5)`,
        [sid,
         s.duration_ms != null ? Math.round(Number(s.duration_ms)) : null,
         s.tempo_ratio != null ? Number(s.tempo_ratio) : null,
         s.frames ? JSON.stringify(s.frames) : null,
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

module.exports = router
