const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// GET /api/stats/summary — handicap + recent averages + top clubs
router.get('/summary', async (req, res) => {
  const uid = req.user.id

  const [roundData, clubData, userRow] = await Promise.all([
    db.many(
      `SELECT total, course_par, course_rating, slope_rating, date, scores
       FROM tm_rounds WHERE user_id = $1 ORDER BY date DESC LIMIT 20`,
      [uid]
    ),
    db.one('SELECT club_data FROM tm_club_stats WHERE user_id = $1', [uid]),
    db.one('SELECT handicap FROM tm_users WHERE id = $1', [uid]),
  ])

  if (!roundData.length) return res.json(null)

  // Handicap Index — read the persisted, WHS-correct value (computed by
  // lib/handicap.maybeUpdateUserHandicap on every round/match completion:
  // net-double-bogey AGS, sliding table, no 0.96, soft/hard caps). Single source
  // of truth, so the DISPLAYED index always matches the official calc — no
  // divergent recompute here. (audit 2026-06-25)
  const handicap = (userRow && userRow.handicap != null && Number.isFinite(Number(userRow.handicap))) ? Number(userRow.handicap) : null

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
