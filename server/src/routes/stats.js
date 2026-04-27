const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// GET /api/stats/summary — handicap + recent averages + top clubs
router.get('/summary', async (req, res) => {
  const uid = req.user.id

  const [roundData, clubData] = await Promise.all([
    db.many(
      `SELECT total, course_par, course_rating, slope_rating, date
       FROM tm_rounds WHERE user_id = $1 ORDER BY date DESC LIMIT 20`,
      [uid]
    ),
    db.oneOrNone('SELECT club_data FROM tm_club_stats WHERE user_id = $1', [uid]),
  ])

  if (!roundData.length) return res.json(null)

  // Handicap index: avg of best 8 of last 20 differentials
  const diffs = roundData
    .filter(r => r.course_rating && r.slope_rating)
    .map(r => ((r.total - r.course_rating) * 113) / r.slope_rating)
    .sort((a, b) => a - b)
    .slice(0, 8)

  const handicap = diffs.length
    ? parseFloat((diffs.reduce((s, d) => s + d, 0) / diffs.length * 0.96).toFixed(1))
    : null

  const avgScore = parseFloat(
    (roundData.reduce((s, r) => s + r.total, 0) / roundData.length).toFixed(1)
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

  const bestScore = Math.min(...roundData.map(r => r.total))

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
