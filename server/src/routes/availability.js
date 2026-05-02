const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { sendPushToUser } = require('../lib/push')

router.use(requireAuth)

// GET /api/availability?month=2025-05
// Returns my availability + friends' availability for the month.
router.get('/', async (req, res) => {
  try {
    const uid = req.user.id
    const month = req.query.month || new Date().toISOString().slice(0, 7)
    const [year, mon] = month.split('-').map(Number)
    const start = new Date(year, mon - 1, 1).toISOString().slice(0, 10)
    const end   = new Date(year, mon, 0).toISOString().slice(0, 10)

    const [mine, friends] = await Promise.all([
      db.many(
        `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, note FROM tm_availability
         WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
        [uid, start, end]
      ),

      db.many(
        `SELECT TO_CHAR(a.date, 'YYYY-MM-DD') AS date, a.note, u.id AS user_id, u.name
         FROM tm_availability a
         JOIN tm_users u ON u.id = a.user_id
         WHERE a.user_id IN (
           SELECT CASE WHEN requester_id = $1 THEN requestee_id ELSE requester_id END
           FROM tm_friends
           WHERE (requester_id = $1 OR requestee_id = $1) AND status = 'accepted'
         ) AND a.date BETWEEN $2 AND $3
         ORDER BY a.date, u.name`,
        [uid, start, end]
      ),
    ])

    res.json({ mine, friends })
  } catch (err) {
    console.error('[availability]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// GET /api/availability/user/:userId?month=YYYY-MM — read-only view of
// another user's availability for a month. Used by the calendar that
// renders on FriendProfile so Matt can see when a friend is free
// without seeing his own availability mixed in. (2026-05-01)
router.get('/user/:userId', async (req, res) => {
  try {
    const targetId = req.params.userId
    if (!targetId) return res.status(400).json({ error: 'userId required' })
    const month = req.query.month || new Date().toISOString().slice(0, 7)
    const [year, mon] = month.split('-').map(Number)
    const start = new Date(year, mon - 1, 1).toISOString().slice(0, 10)
    const end   = new Date(year, mon, 0).toISOString().slice(0, 10)
    const dates = await db.many(
      `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, note FROM tm_availability
       WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
      [targetId, start, end]
    )
    res.json({ dates })
  } catch (err) {
    console.error('[availability/user]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// POST /api/availability — toggle a date on/off
router.post('/', async (req, res) => {
  try {
    const { date, note } = req.body
    if (!date) return res.status(400).json({ error: 'date required' })

    // If already exists, delete (toggle off). Otherwise insert.
    const existing = await db.one(
      'SELECT id FROM tm_availability WHERE user_id = $1 AND date = $2',
      [req.user.id, date]
    )
    if (existing) {
      await db.query('DELETE FROM tm_availability WHERE id = $1', [existing.id])
      res.json({ action: 'removed', date })
    } else {
      await db.query(
        'INSERT INTO tm_availability (user_id, date, note) VALUES ($1, $2, $3)',
        [req.user.id, date, note ?? null]
      )
      res.json({ action: 'added', date })
    }
  } catch (err) {
    console.error('[availability/post]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})


// GET /api/availability/confirmed-games — accepted upcoming tee time plans
router.get('/confirmed-games', async (req, res) => {
  try {
    const uid = req.user.id
    const games = await db.many(
      `SELECT t.id, t.from_user_id, t.to_user_id,
              TO_CHAR(t.date, 'YYYY-MM-DD') AS date,
              t.course_name, t.request_type, t.status,
              CASE WHEN t.from_user_id = $1 THEN u2.name ELSE u1.name END AS partner_name,
              CASE WHEN t.from_user_id = $1 THEN u2.handicap ELSE u1.handicap END AS partner_handicap,
              CASE WHEN t.from_user_id = $1 THEN t.to_user_id ELSE t.from_user_id END AS partner_id
       FROM tm_tee_time_requests t
       JOIN tm_users u1 ON u1.id = t.from_user_id
       JOIN tm_users u2 ON u2.id = t.to_user_id
       WHERE (t.from_user_id = $1 OR t.to_user_id = $1)
         AND t.status = 'accepted'
         AND t.date >= CURRENT_DATE
       ORDER BY t.date ASC`,
      [uid]
    )
    res.json(games)
  } catch (err) {
    console.error('[confirmed-games]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// PUT /api/availability/tee-requests/:id/course — set course on an accepted game
router.put('/tee-requests/:id/course', async (req, res) => {
  try {
    const { course_name } = req.body
    if (!course_name?.trim()) return res.status(400).json({ error: 'course_name required' })
    await db.query(
      `UPDATE tm_tee_time_requests SET course_name = $1, updated_at = NOW()
       WHERE id = $2 AND (from_user_id = $3 OR to_user_id = $3)`,
      [course_name.trim(), req.params.id, req.user.id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[set-course]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// POST /api/availability/tee-request — send a tee time request to a friend
router.post('/tee-request', async (req, res) => {
  try {
    const { to_user_id, date, course_name, message, request_type } = req.body
    if (!to_user_id || !date) return res.status(400).json({ error: 'to_user_id and date required' })
    const rtype = ['tee_time','availability_match'].includes(request_type) ? request_type : 'tee_time'

    await db.query(
      `INSERT INTO tm_tee_time_requests (from_user_id, to_user_id, date, course_name, message, request_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, to_user_id, date, course_name ?? null, message ?? null, rtype]
    )

    // Push the recipient.
    const dateLabel = (() => {
      try { return new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
      catch { return date }
    })()
    sendPushToUser(to_user_id, {
      title: 'Tee time request',
      body: `${req.user.name || 'Someone'} wants to play${course_name ? ` at ${course_name}` : ''} · ${dateLabel}`,
      url: '/?notifs=open',
      tag: 'tee-request',
    }).catch(err => console.error('[push] tee-request', err.message))

    res.status(201).json({ ok: true })
  } catch (err) {
    console.error('[tee-request]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// GET /api/availability/tee-requests — incoming + outgoing
router.get('/tee-requests', async (req, res) => {
  try {
    const uid = req.user.id
    const [incoming, outgoing] = await Promise.all([
      db.many(
        `SELECT t.id, t.from_user_id, t.to_user_id,
                TO_CHAR(t.date, 'YYYY-MM-DD') AS date,
                t.course_name, t.message, t.status, t.request_type, t.created_at, t.updated_at,
                u.name AS from_name
         FROM tm_tee_time_requests t
         JOIN tm_users u ON u.id = t.from_user_id
         WHERE t.to_user_id = $1 AND t.status = 'pending'
         ORDER BY t.date ASC`,
        [uid]
      ),
      db.many(
        `SELECT t.id, t.from_user_id, t.to_user_id,
                TO_CHAR(t.date, 'YYYY-MM-DD') AS date,
                t.course_name, t.message, t.status, t.request_type, t.created_at, t.updated_at,
                u.name AS to_name
         FROM tm_tee_time_requests t
         JOIN tm_users u ON u.id = t.to_user_id
         WHERE t.from_user_id = $1 AND t.date >= CURRENT_DATE
         ORDER BY t.date ASC`,
        [uid]
      ),
    ])
    res.json({ incoming, outgoing })
  } catch (err) {
    console.error('[tee-requests/get]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// PUT /api/availability/tee-requests/:id — accept / decline
router.put('/tee-requests/:id', async (req, res) => {
  try {
    const { status } = req.body
    if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
    await db.query(
      `UPDATE tm_tee_time_requests SET status = $1, updated_at = NOW()
       WHERE id = $2 AND to_user_id = $3`,
      [status, req.params.id, req.user.id]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
