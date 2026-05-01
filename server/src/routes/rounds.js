const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { maybeUpdateUserHandicap } = require('../lib/handicap')

router.use(requireAuth)

// GET /api/rounds
// Returns the user's recent rounds. Field names are the snake_case the
// DB uses, matched by the Profile view's recent-rounds list (r.score,
// r.course_par, r.played_at, r.holes). Older callers receiving camelCase
// keep working via duplicated keys.
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? 10), 50)
  const rows  = await db.many(
    `SELECT r.id, r.course_name, r.course_par, r.total, r.date, r.game_type, r.scores
     FROM tm_rounds r
     WHERE r.user_id = $1
     ORDER BY r.date DESC LIMIT $2`,
    [req.user.id, limit]
  )
  res.json({ rounds: rows.map(r => {
    const scoresArr = Array.isArray(r.scores) ? r.scores : (() => { try { return JSON.parse(r.scores) } catch { return [] } })()
    const holes     = Array.isArray(scoresArr) ? scoresArr.length : null
    return {
      id:          r.id,
      // snake_case (Profile view + future consumers)
      course_name: r.course_name,
      course_par:  r.course_par,
      score:       r.total,
      played_at:   r.date,
      holes,
      game_type:   r.game_type,
      // camelCase legacy keys (kept so existing callers don't break)
      courseName:  r.course_name,
      coursePar:   r.course_par,
      total:       r.total,
      date:        r.date,
      gameType:    r.game_type,
    }
  }) })
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

  // Fire-and-forget: recompute and persist handicap. Don't block the
  // response on it — failures are logged in the helper.
  maybeUpdateUserHandicap(req.user.id)

  res.status(201).json({ id: row.id })
})

// GET /api/rounds/:id
// Returns the round + per-hole par data from the linked outing (when
// outing_id is set). Any authenticated user can fetch any round —
// scorecards aren't private (they show up on friend profiles via the
// Recent Rounds list, and matches are inherently shared between
// participants). Tighten this if/when round privacy becomes a thing.
// (2026-05-01 — was r.user_id = req.user.id; loosened so the
// FriendProfile's Recent Rounds list can open the same scorecards
// the My Profile view opens.)
router.get('/:id', async (req, res) => {
  const row = await db.one(
    `SELECT r.*, o.hole_pars, o.course_name AS outing_course_name
     FROM tm_rounds r
     LEFT JOIN tm_outings o ON o.id = r.outing_id
     WHERE r.id = $1`,
    [req.params.id]
  )
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

module.exports = router
