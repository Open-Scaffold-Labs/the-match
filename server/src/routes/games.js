const express     = require('express')
const router      = express.Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// ─── POST /api/games — create a group match and invite up to 3 friends ─────────
// (Note: route is /api/games for legacy reasons; in user-facing copy these are
// "matches" — golf parlance. The DB table is tm_games; renaming would be a
// bigger schema migration than is currently warranted.)
router.post('/', async (req, res) => {
  try {
    const uid = req.user.id
    const { date, start_time, course_name, request_type = 'tee_time', message, invitee_ids = [] } = req.body
    if (!date) return res.status(400).json({ error: 'date required' })
    if (invitee_ids.length > 3) return res.status(400).json({ error: 'max 3 invitees' })
    // start_time is optional — accepted as 'HH:MM' or 'HH:MM:SS' or null
    if (start_time && !/^\d{2}:\d{2}(:\d{2})?$/.test(start_time)) {
      return res.status(400).json({ error: 'start_time must be HH:MM or HH:MM:SS' })
    }

    // Create the match
    const game = await db.one(
      `INSERT INTO tm_games (created_by, date, start_time, course_name, request_type, message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [uid, date, start_time || null, course_name || null, request_type, message || null]
    )
    const gameId = game.id

    // Organizer is auto-accepted
    await db.query(
      `INSERT INTO tm_game_participants (game_id, user_id, status) VALUES ($1, $2, 'accepted')`,
      [gameId, uid]
    )

    // Invitees start pending
    for (const invId of invitee_ids) {
      await db.query(
        `INSERT INTO tm_game_participants (game_id, user_id, status) VALUES ($1, $2, 'pending')
         ON CONFLICT (game_id, user_id) DO NOTHING`,
        [gameId, invId]
      )
    }

    res.json({ id: gameId })
  } catch (err) {
    console.error('[games/create]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/games — my inbox: pending invites + all my upcoming games ───────
router.get('/', async (req, res) => {
  try {
    const uid = req.user.id

    // All matches I'm part of (any status) that haven't passed.
    // Sort by date ASC, then start_time ASC (NULLs last) so multiple
    // matches on the same day appear in time order.
    const rows = await db.many(
      `SELECT
         g.id, g.created_by, TO_CHAR(g.date, 'YYYY-MM-DD') AS date,
         TO_CHAR(g.start_time, 'HH24:MI') AS start_time,
         g.course_name, g.request_type, g.message, g.created_at,
         g.broadcast,
         gp.status AS my_status,
         u.name AS organizer_name
       FROM tm_game_participants gp
       JOIN tm_games g ON g.id = gp.game_id
       JOIN tm_users u ON u.id = g.created_by
       WHERE gp.user_id = $1 AND g.date >= CURRENT_DATE
       ORDER BY g.date ASC, g.start_time ASC NULLS LAST`,
      [uid]
    )

    // Attach participants to each game
    const gameIds = rows.map(r => r.id)
    let participants = []
    if (gameIds.length > 0) {
      participants = await db.many(
        `SELECT gp.game_id, gp.user_id, gp.status, u.name, u.handicap
         FROM tm_game_participants gp
         JOIN tm_users u ON u.id = gp.user_id
         WHERE gp.game_id = ANY($1::bigint[])`,
        [gameIds]
      )
    }

    const partMap = {}
    for (const p of participants) {
      if (!partMap[p.game_id]) partMap[p.game_id] = []
      partMap[p.game_id].push(p)
    }

    const games = rows.map(r => ({
      ...r,
      participants: partMap[r.id] ?? [],
    }))

    // Split into pending invites (I haven't accepted) and confirmed (I accepted)
    const incoming = games.filter(g => g.my_status === 'pending')
    const confirmed = games.filter(g => g.my_status === 'accepted' && g.date >= new Date().toISOString().slice(0, 10))

    res.json({ incoming, confirmed })
  } catch (err) {
    console.error('[games/list]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/games/:id/respond — accept or decline ──────────────────────────
router.put('/:id/respond', async (req, res) => {
  try {
    const uid = req.user.id
    const { status } = req.body // 'accepted' | 'declined'
    if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: 'invalid status' })

    // If accepting, make sure there's still a spot
    if (status === 'accepted') {
      const countRow = await db.one(
        `SELECT COUNT(*) AS c FROM tm_game_participants WHERE game_id = $1 AND status = 'accepted'`,
        [req.params.id]
      )
      if (parseInt(countRow.c) >= 4)
        return res.status(409).json({ error: 'Sorry, all spots have been filled' })
    }

    await db.query(
      `UPDATE tm_game_participants SET status = $1
       WHERE game_id = $2 AND user_id = $3`,
      [status, req.params.id, uid]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[games/respond]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/games/:id/course — set or change course ────────────────────────
router.put('/:id/course', async (req, res) => {
  try {
    const uid = req.user.id
    const { course_name } = req.body

    // Only organizer or participant can update
    const part = await db.one(
      `SELECT id FROM tm_game_participants WHERE game_id = $1 AND user_id = $2`,
      [req.params.id, uid]
    )
    if (!part) return res.status(403).json({ error: 'Not a participant' })

    await db.query(
      `UPDATE tm_games SET course_name = $1 WHERE id = $2`,
      [course_name || null, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[games/course]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/games/:id/time — set or change start_time ─────────────────────
// Used by the Awaiting Tee Time section on Home: a game without a
// start_time sits in "awaiting" until someone pins a time on it, at
// which point it moves to Upcoming.
router.put('/:id/time', async (req, res) => {
  try {
    const uid = req.user.id
    let { start_time } = req.body
    // Accept "HH:MM" or "HH:MM:SS"; null clears it.
    if (start_time && !/^\d{2}:\d{2}(:\d{2})?$/.test(start_time)) {
      return res.status(400).json({ error: 'Invalid time format' })
    }

    // Only a participant can update.
    const part = await db.one(
      `SELECT id FROM tm_game_participants WHERE game_id = $1 AND user_id = $2`,
      [req.params.id, uid]
    )
    if (!part) return res.status(403).json({ error: 'Not a participant' })

    await db.query(
      `UPDATE tm_games SET start_time = $1 WHERE id = $2`,
      [start_time || null, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[games/time]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── POST /api/games/:id/broadcast — send open-spot invite to all friends ────
router.post('/:id/broadcast', async (req, res) => {
  try {
    const uid = req.user.id
    const gameId = req.params.id

    // Must be organizer
    const game = await db.one(`SELECT created_by, date FROM tm_games WHERE id = $1`, [gameId])
    if (!game || String(game.created_by) !== String(uid))
      return res.status(403).json({ error: 'Only organizer can broadcast' })

    // Count current accepted/pending players
    const countRow = await db.one(
      `SELECT COUNT(*) AS c FROM tm_game_participants WHERE game_id = $1 AND status != 'declined'`,
      [gameId]
    )
    const filled = parseInt(countRow.c)
    if (filled >= 4) return res.status(400).json({ error: 'Match already full' })

    // Get all accepted friends not already in the game
    const friends = await db.many(
      `SELECT CASE WHEN f.requester_id = $1 THEN f.requestee_id ELSE f.requester_id END AS friend_id
       FROM tm_friends f
       WHERE (f.requester_id = $1 OR f.requestee_id = $1) AND f.status = 'accepted'`,
      [uid]
    )

    const existing = await db.many(
      `SELECT user_id FROM tm_game_participants WHERE game_id = $1`,
      [gameId]
    )
    const existingIds = new Set(existing.map(r => String(r.user_id)))

    let invited = 0
    for (const { friend_id } of friends) {
      if (!existingIds.has(String(friend_id))) {
        await db.query(
          `INSERT INTO tm_game_participants (game_id, user_id, status)
           VALUES ($1, $2, 'pending') ON CONFLICT (game_id, user_id) DO NOTHING`,
          [gameId, friend_id]
        )
        invited++
      }
    }

    // Mark game as broadcasting
    await db.query(`UPDATE tm_games SET broadcast = TRUE WHERE id = $1`, [gameId])

    res.json({ ok: true, invited, spots_open: 4 - filled })
  } catch (err) {
    console.error('[games/broadcast]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── POST /api/games/:id/invite — add a player to existing game ──────────────
router.post('/:id/invite', async (req, res) => {
  try {
    const uid = req.user.id
    const { user_id } = req.body

    // Verify organizer
    const game = await db.one(`SELECT created_by FROM tm_games WHERE id = $1`, [req.params.id])
    if (!game || game.created_by !== uid) return res.status(403).json({ error: 'Only organizer can invite' })

    // Check max 4
    const count = await db.one(
      `SELECT COUNT(*) AS c FROM tm_game_participants WHERE game_id = $1 AND status != 'declined'`,
      [req.params.id]
    )
    if (parseInt(count.c) >= 4) return res.status(400).json({ error: 'Match is full (max 4)' })

    await db.query(
      `INSERT INTO tm_game_participants (game_id, user_id, status) VALUES ($1, $2, 'pending')
       ON CONFLICT (game_id, user_id) DO NOTHING`,
      [req.params.id, user_id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[games/invite]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
