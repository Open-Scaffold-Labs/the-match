const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { isRoundCompletedAndRated, computeHandicapFromRounds } = require('../lib/handicap')

router.use(requireAuth)

// GET /api/stats/summary — handicap + recent averages + top clubs
router.get('/summary', async (req, res) => {
  const uid = req.user.id

  const [roundData, clubData, userRow] = await Promise.all([
    // Per-hole pars (round/outing) + stroke index (outing) so the displayed
    // index uses the SAME net-double-bogey AGS calc as the persisted one.
    db.many(
      `SELECT r.total, r.course_par, r.course_rating, r.slope_rating, r.date, r.scores,
              COALESCE(r.hole_pars, o.hole_pars) AS hole_pars,
              o.hole_handicaps AS hole_handicaps
       FROM tm_rounds r
       LEFT JOIN tm_outings o ON o.id = r.outing_id
       WHERE r.user_id = $1 ORDER BY r.date DESC LIMIT 20`,
      [uid]
    ),
    db.one('SELECT club_data FROM tm_club_stats WHERE user_id = $1', [uid]),
    db.one('SELECT handicap FROM tm_users WHERE id = $1', [uid]),
  ])

  if (!roundData.length) return res.json(null)

  // WHS Handicap Index (matches lib/handicap.js exactly): sliding table, no
  // 0.96, net-double-bogey AGS using the player's current Index for stroke
  // allocation. Published after 3 completed rounds (54 holes); below that the
  // seeded handicap stays. (audit 2026-06-25)
  const currentIndex = (userRow && userRow.handicap != null && Number.isFinite(Number(userRow.handicap))) ? Number(userRow.handicap) : null
  const completed = roundData.filter(isRoundCompletedAndRated)
  const handicap  = completed.length >= 3 ? computeHandicapFromRounds(roundData, currentIndex) : null

  const avgScore = parseFloat(
    (roundData.reduce((s, r) => s + Number(r.total || 0), 0) / roundData.length).toFixed(1)
  )

  // Top 5 clubs by average distance
  const clubObj = clubData?.club_data ?? {}
  const topClubs = Object.entries(clubObj)
    .map(([club, dists]) => ({
      club,
      avg: Math.round(dists.reduce((s, d) => s + d, 0) / dists.length),
      shots: dists.length,
    }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)

  const bestScore = Math.min(...roundData.map(r => Number(r.total)).filter(Number.isFinite))

  res.json({
    handicap,
    handicapTrend: null,
    roundCount: roundData.length,
    avgScore,
    bestScore,
    topClubs,
  })
})

module.exports = router
