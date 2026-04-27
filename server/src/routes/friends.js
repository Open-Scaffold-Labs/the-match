const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// ── Season helpers ────────────────────────────────────────────────────────────
function currentSeasonYear() {
  const now = new Date()
  return now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
}
function seasonStart(year) { return new Date(year, 4, 1) }

// GET /api/friends — accepted friends + pending incoming requests + activity
router.get('/', async (req, res) => {
  try {
    const uid = req.user.id

    const [friends, incoming, outgoing, activity] = await Promise.all([
      db.many(
        `SELECT f.id, f.created_at,
                CASE WHEN f.requester_id = $1 THEN u2.id ELSE u1.id END AS friend_id,
                CASE WHEN f.requester_id = $1 THEN u2.name ELSE u1.name END AS friend_name,
                CASE WHEN f.requester_id = $1 THEN u2.home_course ELSE u1.home_course END AS friend_home_course,
                CASE WHEN f.requester_id = $1 THEN u2.handicap ELSE u1.handicap END AS friend_handicap
         FROM tm_friends f
         JOIN tm_users u1 ON u1.id = f.requester_id
         JOIN tm_users u2 ON u2.id = f.requestee_id
         WHERE (f.requester_id = $1 OR f.requestee_id = $1) AND f.status = 'accepted'
         ORDER BY friend_name`,
        [uid]
      ),
      db.many(
        `SELECT f.id, f.created_at, u.id AS requester_id, u.name AS requester_name, u.handicap AS requester_handicap
         FROM tm_friends f
         JOIN tm_users u ON u.id = f.requester_id
         WHERE f.requestee_id = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC`,
        [uid]
      ),
      // Outgoing pending requests FROM me
      db.many(
        `SELECT f.id, f.created_at, u.id AS requestee_id, u.name AS requestee_name, u.handicap AS requestee_handicap
         FROM tm_friends f
         JOIN tm_users u ON u.id = f.requestee_id
         WHERE f.requester_id = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC`,
        [uid]
      ),
      db.many(
        `SELECT DISTINCT ON (r.user_id)
                r.user_id, u.name, r.total, r.course_name, r.date,
                r.course_par,
                r.total - COALESCE(r.course_par, 72) AS diff
         FROM tm_rounds r
         JOIN tm_users u ON u.id = r.user_id
         WHERE r.user_id IN (
           SELECT CASE WHEN requester_id = $1 THEN requestee_id ELSE requester_id END
           FROM tm_friends
           WHERE (requester_id = $1 OR requestee_id = $1) AND status = 'accepted'
         )
         ORDER BY r.user_id, r.date DESC`,
        [uid]
      ),
    ])

    res.json({ friends, incoming, outgoing, activity })
  } catch (err) {
    console.error('[friends]', err.message)
    res.status(500).json({ error: 'Failed to load friends' })
  }
})

// GET /api/friends/:friendId/profile — full friend profile + H2H + availability
router.get('/:friendId/profile', async (req, res) => {
  try {
    const uid      = req.user.id
    const friendId = req.params.friendId
    const year     = currentSeasonYear()
    const start    = seasonStart(year)

    // Verify they're actually friends
    const link = await db.one(
      `SELECT id FROM tm_friends
       WHERE ((requester_id = $1 AND requestee_id = $2) OR (requester_id = $2 AND requestee_id = $1))
         AND status = 'accepted'`,
      [uid, friendId]
    )
    if (!link) return res.status(403).json({ error: 'Not friends' })

    const [friend, seasonRows, roundRows, h2hRow, availability] = await Promise.all([
      // Friend's profile
      db.one(
        `SELECT id, name, handicap, home_course, bio FROM tm_users WHERE id = $1`,
        [friendId]
      ),

      // Friend's season W/L/T
      db.many(
        `SELECT winner_id, loser_id, is_tie
         FROM tm_match_history
         WHERE (winner_id = $1 OR loser_id = $1) AND played_at >= $2`,
        [friendId, start]
      ),

      // Friend's last 3 rounds
      db.many(
        `SELECT total, course_par, course_name, date
         FROM tm_rounds WHERE user_id = $1 ORDER BY date DESC LIMIT 3`,
        [friendId]
      ),

      // H2H record between me and this friend
      db.one(
        `SELECT
           CASE WHEN player_a_id = $1 THEN a_wins ELSE b_wins END AS my_wins,
           CASE WHEN player_a_id = $1 THEN b_wins ELSE a_wins END AS their_wins,
           ties
         FROM tm_h2h_records
         WHERE (player_a_id = $1 AND player_b_id = $2)
            OR (player_a_id = $2 AND player_b_id = $1)`,
        [uid, friendId]
      ),

      // Friend's upcoming availability (next 14 days)
      db.many(
        `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, note FROM tm_availability
         WHERE user_id = $1 AND date >= CURRENT_DATE AND date <= CURRENT_DATE + 14
         ORDER BY date`,
        [friendId]
      ),
    ])

    // Season stats
    let wins = 0, losses = 0, ties = 0
    for (const r of seasonRows) {
      if (r.is_tie) { ties++; continue }
      if (String(r.winner_id) === String(friendId)) wins++
      else losses++
    }

    const avg3 = roundRows.length
      ? parseFloat((roundRows.reduce((s, r) => s + r.total, 0) / roundRows.length).toFixed(1))
      : null

    res.json({
      friend,
      season: { year, wins, losses, ties },
      avg3,
      recentRounds: roundRows,
      h2h: h2hRow ?? { my_wins: 0, their_wins: 0, ties: 0 },
      availability,
    })
  } catch (err) {
    console.error('[friends/profile]', err.message)
    res.status(500).json({ error: 'Failed to load friend profile' })
  }
})


// GET /api/friends/search?q= — find players by name or email (exclude self + existing relations)
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query
    if (!q || q.trim().length < 2) return res.json([])
    const uid = req.user.id
    const term = `%${q.trim().toLowerCase()}%`

    const results = await db.many(
      `SELECT u.id, u.name, u.email, u.handicap, u.home_course,
              f.status AS friend_status
       FROM tm_users u
       LEFT JOIN tm_friends f
         ON (f.requester_id = u.id AND f.requestee_id = $1)
         OR (f.requestee_id = u.id AND f.requester_id = $1)
       WHERE u.id != $1
         AND (LOWER(u.name) LIKE $2 OR LOWER(u.email) LIKE $2)
       ORDER BY u.name
       LIMIT 10`,
      [uid, term]
    )
    res.json(results)
  } catch (err) {
    console.error('[friends/search]', err.message)
    res.status(500).json({ error: 'Search failed' })
  }
})

// POST /api/friends/request — send friend request by email
router.post('/request', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'Email required' })

    const target = await db.one('SELECT id, name FROM tm_users WHERE email = $1', [email.toLowerCase()])
    if (!target) return res.status(404).json({ error: 'No player found with that email' })
    if (String(target.id) === String(req.user.id)) return res.status(400).json({ error: "Can't add yourself" })

    const existing = await db.one(
      `SELECT id, status FROM tm_friends
       WHERE (requester_id = $1 AND requestee_id = $2)
          OR (requester_id = $2 AND requestee_id = $1)`,
      [req.user.id, target.id]
    )
    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' })
      if (existing.status === 'pending')  return res.status(409).json({ error: 'Request already pending' })
    }

    await db.query(
      `INSERT INTO tm_friends (requester_id, requestee_id) VALUES ($1, $2)`,
      [req.user.id, target.id]
    )
    res.status(201).json({ ok: true, name: target.name })
  } catch (err) {
    console.error('[friends/request]', err.message)
    res.status(500).json({ error: 'Failed to send request' })
  }
})

// PUT /api/friends/:id/respond — accept or decline
router.put('/:id/respond', async (req, res) => {
  try {
    const { status } = req.body
    if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
    const row = await db.one(
      `UPDATE tm_friends SET status = $1, updated_at = NOW()
       WHERE id = $2 AND requestee_id = $3 RETURNING id`,
      [status, req.params.id, req.user.id]
    )
    if (!row) return res.status(404).json({ error: 'Request not found' })
    res.json({ ok: true })
  } catch (err) {
    console.error('[friends/respond]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// DELETE /api/friends/:id — remove friend
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      `DELETE FROM tm_friends WHERE id = $1 AND (requester_id = $2 OR requestee_id = $2)`,
      [req.params.id, req.user.id]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
