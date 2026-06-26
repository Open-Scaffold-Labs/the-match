const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { analyze } = require('../lib/practice')

router.use(requireAuth)

// GET /api/practice?minutes=60
// The data → practice loop (Leapfrog 3.5). Reads the user's recent completed
// rounds + persisted Handicap Index, runs the score-only weakness analysis, and
// returns transparent weakness signals + a benchmarked practice session.
//
// Per-hole pars + Stroke Index come from the round itself (solo, migrations 027 +
// 033) or its linked outing — same COALESCE the handicap engine uses, so solo and
// outing rounds analyse identically.
router.get('/', async (req, res) => {
  const uid = req.user.id
  try {
    const [rounds, userRow] = await Promise.all([
      db.many(
        `SELECT r.total, r.course_par, r.course_rating, r.slope_rating, r.date, r.scores,
                COALESCE(r.hole_pars, o.hole_pars)             AS hole_pars,
                COALESCE(r.hole_handicaps, o.hole_handicaps)   AS hole_handicaps
         FROM tm_rounds r
         LEFT JOIN tm_outings o ON o.id = r.outing_id
         WHERE r.user_id = $1
         ORDER BY r.date DESC
         LIMIT 20`,
        [uid]
      ),
      db.one('SELECT handicap FROM tm_users WHERE id = $1', [uid]),
    ])

    const handicap = (userRow && userRow.handicap != null && Number.isFinite(Number(userRow.handicap)))
      ? Number(userRow.handicap) : null

    const payload = analyze(rounds, { handicap, minutes: req.query.minutes })
    res.json(payload)
  } catch (e) {
    console.error('[practice] analyze failed:', e.message)
    res.status(500).json({ error: 'Failed to build practice plan' })
  }
})

module.exports = router
