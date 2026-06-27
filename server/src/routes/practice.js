const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { analyze, primaryMetric, DRILL_IDS } = require('../lib/practice')

router.use(requireAuth)

// Shared loader: the user's recent completed rounds + persisted Handicap Index.
// Per-hole pars + Stroke Index come from the round itself (solo, migrations 027 +
// 033) or its linked outing — the same COALESCE the handicap engine uses.
async function loadRoundsAndHandicap(uid) {
  const [rounds, userRow] = await Promise.all([
    db.many(
      `SELECT r.total, r.course_par, r.course_rating, r.slope_rating, r.date, r.scores,
              COALESCE(r.hole_pars, o.hole_pars)           AS hole_pars,
              COALESCE(r.hole_handicaps, o.hole_handicaps) AS hole_handicaps
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
  return { rounds, handicap }
}

// GET /api/practice?minutes=60
// The data → practice loop (Leapfrog 3.5). Weakness analysis + a benchmarked
// session, plus per-focus before→after progress from the player's prior logs.
router.get('/', async (req, res) => {
  const uid = req.user.id
  try {
    const { rounds, handicap } = await loadRoundsAndHandicap(uid)
    // Prior practice logs → closed-loop progress.
    const priorLogs = await db.many(
      `SELECT weakness_id, metric_value, logged_at
       FROM tm_practice_logs WHERE user_id = $1
       ORDER BY logged_at DESC LIMIT 200`,
      [uid]
    )
    const payload = analyze(rounds, { handicap, minutes: req.query.minutes, priorLogs })
    // Drills logged in the last 7 days → the client pre-checks them so the
    // check-offs persist across reopens.
    const recent = await db.many(
      `SELECT DISTINCT drill_id FROM tm_practice_logs
       WHERE user_id = $1 AND logged_at >= now() - interval '7 days'`,
      [uid]
    )
    payload.recentDrillIds = recent.map(r => r.drill_id)
    res.json(payload)
  } catch (e) {
    console.error('[practice] analyze failed:', e.message)
    res.status(500).json({ error: 'Failed to build practice plan' })
  }
})

// POST /api/practice/log
// Logs a drill the player completed, snapshotting the current weakness metric so
// a later analysis can show whether the focus area improved.
// Body: { weaknessId, drillId, target, passed, value }
router.post('/log', async (req, res) => {
  const uid = req.user.id
  const { weaknessId, drillId, target, passed, value } = req.body || {}
  if (!weaknessId || typeof weaknessId !== 'string') return res.status(400).json({ error: 'weaknessId required' })
  if (!drillId || !DRILL_IDS.has(drillId)) return res.status(400).json({ error: 'valid drillId required' })
  try {
    // Snapshot the CURRENT primary metric for this weakness (authoritative,
    // server-computed — not trusted from the client).
    const { rounds, handicap } = await loadRoundsAndHandicap(uid)
    const a = analyze(rounds, { handicap })
    const w = (a.weaknesses || []).find(x => x.id === weaknessId)
    const m = w ? primaryMetric(w) : null
    const metricValue = m && Number.isFinite(Number(m.value)) ? Number(m.value) : null

    const row = await db.one(
      `INSERT INTO tm_practice_logs (user_id, weakness_id, drill_id, target, passed, value, metric_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, logged_at`,
      [uid, weaknessId, drillId,
       (typeof target === 'string' ? target.slice(0, 120) : null),
       (typeof passed === 'boolean' ? passed : null),
       (value != null ? String(value).slice(0, 60) : null),
       metricValue]
    )
    res.status(201).json({ id: row.id, logged_at: row.logged_at, metricSnapshot: metricValue })
  } catch (e) {
    console.error('[practice] log failed:', e.message)
    res.status(500).json({ error: 'Failed to log practice' })
  }
})

module.exports = router
