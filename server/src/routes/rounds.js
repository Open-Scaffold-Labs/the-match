const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// GET /api/rounds
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? 10), 50)
  const rows  = await db.many(
    `SELECT r.id, r.course_name, r.course_par, r.total, r.date, r.game_type
     FROM tm_rounds r
     WHERE r.user_id = $1
     ORDER BY r.date DESC LIMIT $2`,
    [req.user.id, limit]
  )
  res.json({ rounds: rows.map(r => ({
    id: r.id, courseName: r.course_name, coursePar: r.course_par,
    total: r.total, date: r.date, gameType: r.game_type,
  })) })
})

// POST /api/rounds
router.post('/', async (req, res) => {
  const { courseName, coursePar, courseRating, slopeRating, gameType, scores, shots } = req.body
  const total = scores?.reduce((s, x) => s + (x ?? 0), 0) ?? 0

  const row = await db.one(
    `INSERT INTO tm_rounds
       (user_id, course_name, course_par, course_rating, slope_rating, game_type, scores, shots, total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [req.user.id, courseName, coursePar ?? 72, courseRating, slopeRating,
     gameType ?? 'stroke', JSON.stringify(scores ?? []), JSON.stringify(shots ?? []), total]
  )
  res.status(201).json({ id: row.id })
})

// GET /api/rounds/:id
router.get('/:id', async (req, res) => {
  const row = await db.one(
    'SELECT * FROM tm_rounds WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

module.exports = router
