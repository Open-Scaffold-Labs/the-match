const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// Generate a random 4-char alphanumeric code (no 0/O/I/1 confusion)
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let c = ''
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)]
  return c
}

// ─── POST /api/outings — create ───────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, courseName, coursePar, scoringFormats, teamFormat, pointMethod } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  // Ensure unique code
  let code, existing
  do {
    code = genCode()
    existing = await db.one('SELECT id FROM tm_outings WHERE code = $1', [code])
  } while (existing)

  const holes  = coursePar && coursePar <= 40 ? 9 : 18
  const state  = { holes, participants: [] }

  const row = await db.one(
    `INSERT INTO tm_outings (code, name, host_id, course_name, course_par, team_format, point_method, scoring_formats, state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [code, name, req.user.id, courseName || 'TBD', coursePar || 72,
     teamFormat || 'individual', pointMethod || null,
     JSON.stringify(scoringFormats || ['stroke']), JSON.stringify(state)]
  )

  // Auto-add host as participant
  await db.query(
    `INSERT INTO tm_outing_participants (outing_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [row.id, req.user.id]
  )
  state.participants.push({ user_id: req.user.id, name: req.user.name, total: 0, holes_played: 0 })
  await db.query('UPDATE tm_outings SET state = $1 WHERE id = $2', [JSON.stringify(state), row.id])

  res.status(201).json({ outing: { ...row, code, state } })
})

// ─── GET /api/outings/recent ──────────────────────────────────────────────────
router.get('/recent', async (req, res) => {
  const rows = await db.many(
    `SELECT o.id, o.code, o.name, o.course_name, o.status,
            (SELECT COUNT(*) FROM tm_outing_participants p WHERE p.outing_id = o.id) AS player_count
     FROM tm_outings o
     JOIN tm_outing_participants p ON p.outing_id = o.id AND p.user_id = $1
     ORDER BY o.updated_at DESC LIMIT 10`,
    [req.user.id]
  )
  res.json({ outings: rows.map(r => ({ ...r, player_count: parseInt(r.player_count) })) })
})

// ─── GET /api/outings/my-rivalries ───────────────────────────────────────────
router.get('/my-rivalries', async (req, res) => {
  const uid = req.user.id
  const rows = await db.many(
    `SELECT
       CASE WHEN h.player_a_id = $1 THEN h.player_b_id ELSE h.player_a_id END AS opponent_id,
       CASE WHEN h.player_a_id = $1 THEN u.name ELSE u2.name END AS opponent_name,
       CASE WHEN h.player_a_id = $1 THEN h.a_wins ELSE h.b_wins END AS my_wins,
       CASE WHEN h.player_a_id = $1 THEN h.b_wins ELSE h.a_wins END AS opp_wins,
       h.ties,
       h.last_played
     FROM tm_h2h_records h
     JOIN tm_users u  ON u.id  = h.player_b_id
     JOIN tm_users u2 ON u2.id = h.player_a_id
     WHERE h.player_a_id = $1 OR h.player_b_id = $1
     ORDER BY (h.a_wins + h.b_wins + h.ties) DESC, h.last_played DESC
     LIMIT 20`,
    [uid]
  )
  res.json({ rivalries: rows })
})

// ─── GET /api/outings/:code ───────────────────────────────────────────────────
router.get('/:code', async (req, res) => {
  const row = await db.one('SELECT * FROM tm_outings WHERE code = $1', [req.params.code.toUpperCase()])
  if (!row) return res.status(404).json({ error: 'Outing not found' })
  res.json({ outing: row })
})

// ─── POST /api/outings/:code/join ─────────────────────────────────────────────
router.post('/:code/join', async (req, res) => {
  const code = req.params.code.toUpperCase()
  const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
  if (!outing) return res.status(404).json({ error: 'Outing not found' })
  if (outing.status !== 'active') return res.status(400).json({ error: 'Outing is closed' })

  await db.query(
    `INSERT INTO tm_outing_participants (outing_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [outing.id, req.user.id]
  )

  // Update participants in state JSONB
  const state = outing.state || { holes: 18, participants: [] }
  const exists = state.participants?.find(p => p.user_id === req.user.id)
  if (!exists) {
    state.participants = [...(state.participants || []), {
      user_id: req.user.id, name: req.user.name, total: 0, holes_played: 0,
    }]
    await db.query('UPDATE tm_outings SET state = $1 WHERE id = $2', [JSON.stringify(state), outing.id])
  }

  res.json({ outing: { ...outing, state } })
})

// ─── PUT /api/outings/:code/scores ────────────────────────────────────────────
router.put('/:code/scores', async (req, res) => {
  const { hole, score } = req.body
  if (hole === undefined || score === undefined) return res.status(400).json({ error: 'hole and score required' })
  const code = req.params.code.toUpperCase()

  const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
  if (!outing) return res.status(404).json({ error: 'Outing not found' })

  // Update participant row
  const existing = await db.one(
    'SELECT * FROM tm_outing_participants WHERE outing_id = $1 AND user_id = $2',
    [outing.id, req.user.id]
  )
  if (!existing) return res.status(403).json({ error: 'Not in this outing' })

  const scores = existing.scores || []
  scores[hole] = score
  const total = scores.reduce((s, x) => s + (x || 0), 0)
  const holesPlayed = scores.filter(x => x > 0).length

  await db.query(
    'UPDATE tm_outing_participants SET scores=$1, total=$2 WHERE outing_id=$3 AND user_id=$4',
    [JSON.stringify(scores), total, outing.id, req.user.id]
  )

  // Sync to state JSONB so leaderboard reads are fast
  const state = outing.state || { participants: [] }
  const pi = state.participants?.findIndex(p => p.user_id === req.user.id)
  if (pi >= 0) {
    state.participants[pi].total = total
    state.participants[pi].holes_played = holesPlayed
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
  }

  res.json({ ok: true, total, holesPlayed })
})

// ─── POST /api/outings/:code/end ──────────────────────────────────────────────
router.post('/:code/end', async (req, res) => {
  const code = req.params.code.toUpperCase()
  const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
  if (!outing) return res.status(404).json({ error: 'Outing not found' })
  if (outing.host_id !== req.user.id) return res.status(403).json({ error: 'Only host can end outing' })

  const participants = await db.many(
    'SELECT * FROM tm_outing_participants WHERE outing_id = $1 ORDER BY total ASC',
    [outing.id]
  )

  // For individual play: write 1v1 match history for every pair
  if (outing.team_format === 'individual' && participants.length >= 2) {
    const winner = participants[0]
    for (let i = 1; i < participants.length; i++) {
      const loser = participants[i]
      const isTie = winner.total === loser.total
      await db.query(
        `INSERT INTO tm_match_history
           (outing_id, winner_id, loser_id, is_tie, winner_score, loser_score, course_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [outing.id, isTie ? null : winner.user_id, isTie ? null : loser.user_id,
         isTie, winner.total, loser.total, outing.course_name]
      )
    }
    // Update participant results
    for (const p of participants) {
      const result = p.total === winner.total ? (participants.filter(x => x.total === winner.total).length > 1 ? 'tie' : 'win') : 'loss'
      await db.query('UPDATE tm_outing_participants SET result=$1 WHERE id=$2', [result, p.id])
    }
  }

  await db.query("UPDATE tm_outings SET status='closed' WHERE id=$1", [outing.id])
  res.json({ ok: true })
})

module.exports = router
