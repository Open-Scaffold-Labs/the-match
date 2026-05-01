const router     = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// ── Season helpers ────────────────────────────────────────────────────────────
// Season year = the calendar year in which May 1 opens the season.
// May 1 2025 → season 2025 runs May 1 2025 – Apr 30 2026.
function currentSeasonYear() {
  const now = new Date()
  return now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
}
function seasonStart(year) { return new Date(year, 4, 1) } // May 1

// GET /api/profile — full profile snapshot
router.get('/', async (req, res) => {
  try {
    const uid = req.user.id
    const year = currentSeasonYear()
    const start = seasonStart(year)

    const [user, seasonRows, roundRows, streakRows, seasonStarted] = await Promise.all([
      db.one('SELECT id, name, email, role, home_course, bio, handicap, avatar, cutout, onboarding_completed_at, onboarding_steps, coach_marks_seen FROM tm_users WHERE id = $1', [uid]),

      // Season W / L / T from match history
      db.many(
        `SELECT winner_id, loser_id, is_tie
         FROM tm_match_history
         WHERE (winner_id = $1 OR loser_id = $1) AND played_at >= $2`,
        [uid, start]
      ),

      // Last 3 rounds for rolling average
      db.many(
        `SELECT total, course_par FROM tm_rounds WHERE user_id = $1 ORDER BY date DESC LIMIT 3`,
        [uid]
      ),

      // All rounds this season for streak calculation (consecutive weeks with ≥1 round)
      db.many(
        `SELECT date FROM tm_rounds WHERE user_id = $1 AND date >= $2 ORDER BY date DESC`,
        [uid, start.toISOString().slice(0, 10)]
      ),

      // Has this user started the current season?
      db.one('SELECT 1 FROM tm_user_seasons WHERE user_id = $1 AND season_year = $2', [uid, year]),
    ])

    // W/L/T
    let wins = 0, losses = 0, ties = 0
    for (const r of seasonRows) {
      if (r.is_tie) { ties++; continue }
      if (String(r.winner_id) === String(uid)) wins++
      else losses++
    }

    // 3-round rolling avg
    const avg3 = roundRows.length
      ? parseFloat((roundRows.reduce((s, r) => s + r.total, 0) / roundRows.length).toFixed(1))
      : null

    // Consecutive-week streak
    let streak = 0
    if (streakRows.length) {
      const weekSet = new Set(streakRows.map(r => {
        const d = new Date(r.date)
        const jan1 = new Date(d.getFullYear(), 0, 1)
        return `${d.getFullYear()}-${Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7)}`
      }))
      const weeks = [...weekSet].sort().reverse()
      const nowWeek = (() => {
        const d = new Date()
        const jan1 = new Date(d.getFullYear(), 0, 1)
        return `${d.getFullYear()}-${Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7)}`
      })()
      if (weeks[0] === nowWeek || weeks[0] === `${new Date().getFullYear()}-${Math.ceil(((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 86400000 + new Date(new Date().getFullYear(), 0, 1).getDay() + 1) / 7) - 1}`) {
        streak = 1
        for (let i = 1; i < weeks.length; i++) {
          const [y1, w1] = weeks[i - 1].split('-').map(Number)
          const [y2, w2] = weeks[i].split('-').map(Number)
          if ((y1 === y2 && w1 - w2 === 1) || (y1 - y2 === 1 && w2 >= 51 && w1 === 1)) streak++
          else break
        }
      }
    }

    res.json({
      user,
      season: { year, wins, losses, ties, seasonStarted: !!seasonStarted },
      avg3,
      streak,
    })
  } catch (err) {
    console.error('[profile]', err.message)
    res.status(500).json({ error: 'Failed to load profile' })
  }
})

// POST /api/profile/update — edit home course / bio / handicap
router.post('/update', async (req, res) => {
  try {
    const { home_course, bio, handicap, name } = req.body
    // Parse handicap — accept "+2.1", "8.4", null/undefined
    let hcp = null
    if (handicap !== undefined && handicap !== null && handicap !== '') {
      const parsed = parseFloat(String(handicap).replace(/^\+/, ''))
      if (!isNaN(parsed)) hcp = parsed
    }
    const cleanName = (typeof name === 'string') ? name.trim() : null
    const user = await db.one(
      `UPDATE tm_users SET
         name        = COALESCE($5, name),
         home_course = COALESCE($1, home_course),
         bio         = COALESCE($2, bio),
         handicap    = CASE WHEN $3::numeric IS NOT NULL THEN $3::numeric ELSE handicap END,
         updated_at  = NOW()
       WHERE id = $4
       RETURNING id, name, email, role, home_course, bio, handicap`,
      [home_course ?? null, bio ?? null, hcp, req.user.id, cleanName || null]
    )
    res.json({ user })
  } catch (err) {
    console.error('[profile/update]', err.message)
    res.status(500).json({ error: 'Update failed' })
  }
})

// POST /api/profile/avatar — save player card image + body cutout
router.post('/avatar', async (req, res) => {
  try {
    const { avatar, cutout } = req.body
    if (!avatar || typeof avatar !== 'string') {
      return res.status(400).json({ error: 'Missing avatar' })
    }
    if (!avatar.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image format' })
    }
    const user = await db.one(
      `UPDATE tm_users SET avatar = $1, cutout = $2, updated_at = NOW()
       WHERE id = $3 RETURNING id, avatar, cutout`,
      [avatar, cutout ?? null, req.user.id]
    )
    res.json({ ok: true, user })
  } catch (err) {
    console.error('[profile/avatar]', err.message)
    res.status(500).json({ error: 'Failed to save avatar' })
  }
})

// POST /api/profile/start-season — dismiss banner, record season start
router.post('/start-season', async (req, res) => {
  try {
    const year = currentSeasonYear()
    await db.query(
      `INSERT INTO tm_user_seasons (user_id, season_year) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, year]
    )
    res.json({ ok: true, season_year: year })
  } catch (err) {
    console.error('[start-season]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
