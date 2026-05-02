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
// Letter labels for foursomes. Group A, Group B, ... (only ever need
// up to 38 = ceil(150/4), so 26 letters + AA-MM is plenty.)
function groupLetter(idx) {
  if (idx < 26) return String.fromCharCode(65 + idx)
  // Past Z, repeat: AA, BB, CC ...
  const second = idx - 26
  return String.fromCharCode(65 + (second % 26)).repeat(2)
}

// Builds the empty groups skeleton for a large outing. Players slot
// into groups as they join via /:code/join (FCFS into first group
// with capacity). team_breakdown determines team labeling within
// each foursome — see migration 013 for the value semantics.
function makeGroupsSkeleton(expectedPlayers) {
  const n = Math.max(0, Math.min(150, Math.round(expectedPlayers)))
  if (n <= 4) return []  // small outings don't need group structure
  const groupCount = Math.ceil(n / 4)
  const groups = []
  for (let i = 0; i < groupCount; i++) {
    groups.push({
      id: i + 1,                     // 1-indexed for human readability
      name: `Group ${groupLetter(i)}`,
      capacity: Math.min(4, n - i * 4),
    })
  }
  return groups
}

// Slots a participant into the first group with remaining capacity.
// Mutates state.participants[i].group_id. If a group has just filled,
// assigns team_id to all its members based on team_breakdown:
//   'singles'   → team_id stays null
//   'doubles'   → join-order pairs: 0+1 = "{group}-A", 2+3 = "{group}-B"
//   'foursomes' → all 4 share team_id = "G{group_id}"
// Returns the participant entry that was placed (with group_id set).
function assignParticipantToGroup(state, participant) {
  if (!state.groups || state.groups.length === 0) return participant
  // Count current members per group from the existing participants
  // array (excluding the one being placed).
  const counts = {}
  for (const p of state.participants) {
    if (p.group_id != null) counts[p.group_id] = (counts[p.group_id] || 0) + 1
  }
  // Find first group with capacity remaining.
  const target = state.groups.find(g => (counts[g.id] || 0) < g.capacity)
  if (!target) return participant  // outing full; participant joins without a group_id
  participant.group_id = target.id

  // Did this fill the group? If so, assign team_ids to everyone in it.
  const newCount = (counts[target.id] || 0) + 1
  if (newCount === target.capacity && state.team_breakdown) {
    const members = state.participants.filter(p => p.group_id === target.id)
    members.push(participant)  // include the one being placed
    // Sort by join order — participants array order IS join order.
    members.sort((a, b) => state.participants.indexOf(a) - state.participants.indexOf(b))
    if (state.team_breakdown === 'foursomes') {
      const teamId = `G${target.id}`
      for (const m of members) m.team_id = teamId
    } else if (state.team_breakdown === 'doubles') {
      // First two members = sub-team A, second two = sub-team B.
      // For groups smaller than 4 (last group when N % 4 != 0), still
      // pair join-order: 0+1=A, 2=B (alone).
      members.forEach((m, i) => { m.team_id = `G${target.id}-${i < 2 ? 'A' : 'B'}` })
    }
    // 'singles' → no team_id assigned.
  }
  return participant
}

router.post('/', async (req, res) => {
  const {
    name, courseName, coursePar, scoringFormats, teamFormat, pointMethod,
    // New (2026-04-30): real per-hole course data from the create-wizard course picker
    courseId, courseTee, holePars, holeYardages, holeHandicaps,
    // New (2026-05-01): tee rating + slope from the picker. Captured when
    // the tee carries them (paid tier / GolfCourseAPI-sourced courses);
    // null otherwise — handicap then falls back to par-based differentials.
    courseRating, slopeRating,
    // New (2026-05-01): expected total golfers in the match. Used by the
    // Match page to show "Waiting for N more" until the field fills up.
    expectedPlayers,
    // New (2026-05-01 — large outings): when expectedPlayers > 4, host
    // picks how the field's broken into competitive units. See
    // migration 013 for the allowed values.
    teamBreakdown,
    // Handicap allowance % for net scoring (B4a). 100 = full handicap.
    // Common values: 100, 95, 90, 85, 80, 75. Outside that range we
    // clamp to 100 server-side rather than reject (the wizard already
    // restricts to those buttons).
    handicapAllowance,
    // Stableford preset (B4b): 'standard' or 'modified'. Only stored
    // when format=stableford. Server resolves to the full point map
    // and stashes it in state so the client can read it without
    // shipping the preset table to every render.
    stablefordPreset,
  } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  // Ensure unique code
  let code, existing
  do {
    code = genCode()
    existing = await db.one('SELECT id FROM tm_outings WHERE code = $1', [code])
  } while (existing)

  const holes  = coursePar && coursePar <= 40 ? 9 : 18

  // Clamp expected_players to 2-150 (DB CHECK enforces 1-150).
  const expN = Number(expectedPlayers)
  const expectedPlayersVal = Number.isFinite(expN) && expN >= 2 && expN <= 150 ? Math.round(expN) : null

  // Clamp team_breakdown to valid set; null otherwise. Only meaningful
  // for outings > 4 players — small outings still use scoring_formats
  // + team_format for their 1v1 / 2v2 setup.
  const validBreakdowns = ['singles', 'doubles', 'foursomes']
  const teamBreakdownVal = (expectedPlayersVal != null && expectedPlayersVal > 4 && validBreakdowns.includes(teamBreakdown))
    ? teamBreakdown
    : null

  // Build empty groups skeleton for large outings. Each group is an
  // empty foursome at this point; players slot in via /:code/join.
  const groupsSkeleton = makeGroupsSkeleton(expectedPlayersVal || 0)
  // Sanitize handicap allowance — clamp to 1-100, default 100.
  const allowanceN = Number(handicapAllowance)
  const allowanceVal = Number.isFinite(allowanceN) && allowanceN > 0 && allowanceN <= 100
    ? Math.round(allowanceN)
    : 100
  // Resolve Stableford preset to its full point map. Only attached
  // when the active format actually uses Stableford. (B4b)
  const STABLEFORD_PRESETS_S = {
    standard: { double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1 },
    modified: { double_eagle: 8, eagle: 5, birdie: 2, par: 0, bogey: -1, double: -3, worse: -3 },
  }
  const stablefordPointMap = (Array.isArray(scoringFormats) && scoringFormats.includes('stableford'))
    ? (STABLEFORD_PRESETS_S[stablefordPreset] || STABLEFORD_PRESETS_S.standard)
    : null

  const state  = {
    holes,
    participants: [],
    handicap_allowance: allowanceVal,
    ...(stablefordPointMap ? { stableford_points: stablefordPointMap } : {}),
    ...(groupsSkeleton.length > 0 ? { groups: groupsSkeleton } : {}),
    ...(teamBreakdownVal ? { team_breakdown: teamBreakdownVal } : {}),
  }

  const row = await db.one(
    `INSERT INTO tm_outings (
       code, name, host_id, course_name, course_par,
       team_format, point_method, scoring_formats, state,
       course_id, course_tee, hole_pars, hole_yardages, hole_handicaps,
       course_rating, slope_rating, expected_players, team_breakdown
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      code, name, req.user.id,
      courseName || 'TBD', coursePar || 72,
      teamFormat || 'individual', pointMethod || null,
      JSON.stringify(scoringFormats || ['stroke']), JSON.stringify(state),
      courseId || null,
      courseTee || null,
      Array.isArray(holePars)      ? JSON.stringify(holePars)      : null,
      Array.isArray(holeYardages)  ? JSON.stringify(holeYardages)  : null,
      Array.isArray(holeHandicaps) ? JSON.stringify(holeHandicaps) : null,
      Number.isFinite(Number(courseRating)) ? Number(courseRating) : null,
      Number.isFinite(Number(slopeRating))  ? Number(slopeRating)  : null,
      expectedPlayersVal,
      teamBreakdownVal,
    ]
  )

  // Auto-add host as participant. For large outings, slot host into
  // Group A (first foursome) as the first member.
  await db.query(
    `INSERT INTO tm_outing_participants (outing_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [row.id, req.user.id]
  )
  const hostEntry = { user_id: req.user.id, name: req.user.name, total: 0, holes_played: 0 }
  if (groupsSkeleton.length > 0) {
    hostEntry.group_id = groupsSkeleton[0].id  // host = Group A
    // Team assignment within group is deferred until the group fills,
    // since pair-vs-pair structure depends on join order.
  }
  state.participants.push(hostEntry)
  await db.query('UPDATE tm_outings SET state = $1 WHERE id = $2', [JSON.stringify(state), row.id])

  res.status(201).json({ outing: { ...row, code, state } })
})

// ─── GET /api/outings/recent ──────────────────────────────────────────────────
// Returns the user's recent matches enriched with:
//   - opponent_names: comma-separated names of OTHER participants (max 3 listed)
//   - opponent_count: total other participants
//   - updated_at / created_at: timestamps for "Today / Yesterday / Mar 12" labels
// The Match tab uses this to render meaningful cards instead of the boilerplate
// "Matt Lavin's Match" repeated for every row. (2026-04-30)
router.get('/recent', async (req, res) => {
  const rows = await db.many(
    `SELECT o.id, o.code, o.name, o.course_name, o.status, o.host_id,
            o.expected_players,
            o.created_at, o.updated_at,
            (SELECT COUNT(*) FROM tm_outing_participants p WHERE p.outing_id = o.id) AS player_count,
            (SELECT COALESCE(json_agg(u.name ORDER BY u.name), '[]'::json)
               FROM tm_outing_participants p2
               LEFT JOIN tm_users u ON u.id = p2.user_id
               WHERE p2.outing_id = o.id
                 AND p2.user_id IS NOT NULL
                 AND p2.user_id <> $1) AS opponent_names
     FROM tm_outings o
     JOIN tm_outing_participants p ON p.outing_id = o.id AND p.user_id = $1
     ORDER BY o.updated_at DESC LIMIT 10`,
    [req.user.id]
  )
  res.json({
    outings: rows.map(r => ({
      ...r,
      player_count: parseInt(r.player_count),
      opponent_names: r.opponent_names || [],
    })),
  })
})

// DELETE /api/outings/:code — only the host can delete, and only while
// the match is still active (you can't delete a finished match —
// rivalry stats already point at it). Cascades through participants
// via the FK (tm_outing_participants ON DELETE CASCADE).
// (2026-05-01 — Matt: swipe-to-delete on the Match page Live Now strip.)
router.delete('/:code', async (req, res) => {
  try {
    const { code } = req.params
    const row = await db.one(
      'SELECT id, host_id, status FROM tm_outings WHERE code = $1',
      [code]
    )
    if (!row) return res.status(404).json({ error: 'Match not found' })
    if (String(row.host_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the host can delete this match' })
    }
    if (row.status !== 'active') {
      return res.status(400).json({ error: 'Only active matches can be deleted' })
    }
    await db.query('DELETE FROM tm_outings WHERE id = $1', [row.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[outings/delete]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/outings/rivalry/:opponentId ────────────────────────────────────
// MUST be before /:code wildcard or Express will swallow it
router.get('/rivalry/:opponentId', async (req, res) => {
  try {
    const uid = req.user.id
    const oid = req.params.opponentId
    const rows = await db.many(
      `SELECT mh.id, mh.is_tie, mh.winner_score, mh.loser_score, mh.course_name,
              o.name AS outing_name, o.created_at,
              CASE WHEN mh.winner_id = $1 THEN true ELSE false END AS i_won,
              CASE WHEN mh.winner_id = $1 THEN mh.winner_score ELSE mh.loser_score END AS my_score,
              CASE WHEN mh.winner_id = $1 THEN mh.loser_score  ELSE mh.winner_score END AS opp_score
       FROM tm_match_history mh
       JOIN tm_outings o ON o.id = mh.outing_id
       WHERE (mh.winner_id = $1 AND mh.loser_id = $2)
          OR (mh.winner_id = $2 AND mh.loser_id = $1)
       ORDER BY o.created_at DESC
       LIMIT 20`,
      [uid, oid]
    )
    // Opponent name
    const opp = await db.one('SELECT id, name, handicap FROM tm_users WHERE id = $1', [oid])
    res.json({ matches: rows, opponent: opp || null })
  } catch (err) {
    console.error('[outings/rivalry]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/outings/my-rivalries ───────────────────────────────────────────
// Returns the user's head-to-head record vs every opponent they've ever
// played — name, avatar, handicap, W-L-T, last_played, and the avg
// scores both players have posted across their shared closed outings.
// Used by the Profile view's Rivalries card (top 3) and the Match-tab
// rivalry list (full set).
router.get('/my-rivalries', async (req, res) => {
  const uid = req.user.id
  const rows = await db.many(
    `WITH shared AS (
       -- Aggregate avg score per opponent across closed outings where
       -- BOTH players were participants. Skips zero-totals (rounds that
       -- weren't actually played to completion).
       SELECT
         CASE WHEN op_me.user_id = $1 THEN op_opp.user_id ELSE op_me.user_id END AS opp_id,
         AVG(NULLIF(op_me.total, 0))  AS my_avg,
         AVG(NULLIF(op_opp.total, 0)) AS opp_avg
       FROM tm_outing_participants op_me
       JOIN tm_outing_participants op_opp
         ON op_opp.outing_id = op_me.outing_id
        AND op_opp.user_id  <> op_me.user_id
       JOIN tm_outings o ON o.id = op_me.outing_id
       WHERE op_me.user_id = $1
         AND o.status = 'closed'
         AND op_me.total  > 0
         AND op_opp.total > 0
       GROUP BY opp_id
     )
     SELECT
       CASE WHEN h.player_a_id = $1 THEN h.player_b_id ELSE h.player_a_id END AS opponent_id,
       CASE WHEN h.player_a_id = $1 THEN ub.name ELSE ua.name END AS opponent_name,
       CASE WHEN h.player_a_id = $1 THEN ub.avatar ELSE ua.avatar END AS opponent_avatar,
       CASE WHEN h.player_a_id = $1 THEN ub.handicap ELSE ua.handicap END AS opponent_handicap,
       CASE WHEN h.player_a_id = $1 THEN h.a_wins ELSE h.b_wins END AS my_wins,
       CASE WHEN h.player_a_id = $1 THEN h.b_wins ELSE h.a_wins END AS opp_wins,
       h.ties,
       h.last_played,
       s.my_avg,
       s.opp_avg
     FROM tm_h2h_records h
     JOIN tm_users ua ON ua.id = h.player_a_id
     JOIN tm_users ub ON ub.id = h.player_b_id
     LEFT JOIN shared s
       ON s.opp_id = (CASE WHEN h.player_a_id = $1 THEN h.player_b_id ELSE h.player_a_id END)
     WHERE h.player_a_id = $1 OR h.player_b_id = $1
     ORDER BY (h.a_wins + h.b_wins + h.ties) DESC, h.last_played DESC
     LIMIT 20`,
    [uid]
  )
  res.json({ rivalries: rows })
})

// ─── GET /api/outings/:code ───────────────────────────────────────────────────
router.get('/:code', async (req, res) => {
  try {
    const row = await db.one('SELECT * FROM tm_outings WHERE code = $1', [req.params.code.toUpperCase()])
    if (!row) return res.status(404).json({ error: 'Outing not found' })

    // Enrich state participants with per-hole scores, handicap, and avatar
    // from tm_users so the Augusta scorecard can show profile pictures.
    // (avatar added 2026-04-30 — user requested player photos on the board)
    const partRows = await db.many(
      `SELECT op.user_id, op.scores, u.handicap, u.avatar
       FROM tm_outing_participants op
       LEFT JOIN tm_users u ON u.id = op.user_id
       WHERE op.outing_id = $1`,
      [row.id]
    )
    const state = row.state || { participants: [] }
    const enriched = (state.participants || []).map(p => {
      if (p.is_guest) return p  // guests: scores already in state JSONB, no avatar
      const dp = partRows.find(r => String(r.user_id) === String(p.user_id))
      return {
        ...p,
        scores: dp?.scores || [],
        handicap: dp?.handicap ?? null,
        avatar: dp?.avatar ?? null,
      }
    })
    res.json({ outing: { ...row, state: { ...state, participants: enriched } } })
  } catch (err) {
    console.error('[outings/get]', err)
    res.status(500).json({ error: 'Failed' })
  }
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
    const entry = { user_id: req.user.id, name: req.user.name, total: 0, holes_played: 0 }
    // Slot into next available foursome (large outings only). Mutates
    // entry to add group_id and may assign team_id to other group
    // members if this join fills the group.
    assignParticipantToGroup(state, entry)
    state.participants = [...(state.participants || []), entry]
    await db.query('UPDATE tm_outings SET state = $1 WHERE id = $2', [JSON.stringify(state), outing.id])
  }

  res.json({ outing: { ...outing, state } })
})

// ─── POST /api/outings/:code/bulk-join ────────────────────────────────────────
// Host-only: auto-add an array of user_ids as participants
router.post('/:code/bulk-join', async (req, res) => {
  try {
    const code   = req.params.code.toUpperCase()
    const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Only the host can bulk-add players' })

    const { user_ids } = req.body
    if (!Array.isArray(user_ids) || user_ids.length === 0)
      return res.status(400).json({ error: 'user_ids array required' })

    const state = outing.state || { participants: [] }

    for (const uid of user_ids) {
      await db.query(
        `INSERT INTO tm_outing_participants (outing_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [outing.id, uid]
      )
      const u = await db.one(`SELECT id, name FROM tm_users WHERE id = $1`, [uid])
      if (u && !state.participants?.find(p => String(p.user_id) === String(uid))) {
        const entry = { user_id: u.id, name: u.name, total: 0, holes_played: 0 }
        // Slot into next available foursome for large outings.
        assignParticipantToGroup(state, entry)
        state.participants.push(entry)
      }
    }

    await db.query('UPDATE tm_outings SET state = $1 WHERE id = $2', [JSON.stringify(state), outing.id])
    res.json({ ok: true, added: user_ids.length })
  } catch (err) {
    console.error('[outings/bulk-join]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

// Append to tm_score_audit. Used by both score-write endpoints below.
// Failures here don't roll back the score write — audit is best-effort.
async function writeScoreAudit({ outing_id, user_id, hole, old_score, new_score, edited_by_id }) {
  try {
    await db.query(
      `INSERT INTO tm_score_audit (outing_id, user_id, hole, old_score, new_score, edited_by_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [outing_id, String(user_id), Number(hole), old_score == null ? null : Number(old_score), Number(new_score), edited_by_id]
    )
  } catch (err) {
    // The audit table CHECK only allows hole 0-17. Guest user_ids are
    // strings so we'd already break tm_outings.user_id BIGINT — but we
    // store them as text via String() above. If the migration's
    // user_id BIGINT type rejects, log + continue.
    console.warn('[score-audit] insert failed', err.message)
  }
}

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

  // Capture old score for audit. Self-entry path — no conflict check
  // needed (you own your own card; you can change your mind freely).
  const scores = existing.scores || []
  const oldScore = scores[hole] ?? 0

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

  // Audit — only when the value actually changed (don't log no-ops
  // from network retries or repeated taps on the same number).
  if (Number(oldScore || 0) !== Number(score)) {
    writeScoreAudit({
      outing_id: outing.id, user_id: req.user.id, hole,
      old_score: oldScore || null, new_score: score, edited_by_id: req.user.id,
    })
  }

  res.json({ ok: true, total, holesPlayed })
})

// ─── POST /api/outings/:code/guests ──────────────────────────────────────────
// Host-only: add a named guest (no app account) to the match
router.post('/:code/guests', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { name } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' })

    const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })

    const guestId = `guest_${Date.now()}`
    const holes   = outing.state?.holes ?? 18
    const state   = outing.state || { participants: [] }
    state.participants = state.participants || []
    state.participants.push({
      user_id: guestId, name: name.trim(), is_guest: true,
      total: 0, holes_played: 0, scores: new Array(holes).fill(0),
    })
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])

    res.status(201).json({ ok: true, guest_id: guestId })
  } catch (err) {
    console.error('[outings/guests]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/outings/:code/scores/host ───────────────────────────────────────
// Permissioned score-on-behalf endpoint. Was host-only; widened on
// 2026-05-01 (Matt) so any participant in the SAME FOURSOME as the
// target user can enter their score. Host can still enter for anyone
// across groups. Marker assignments (state.markers) also bypass the
// same-group check. Mirror of the client-side isMarkerFor logic.
router.put('/:code/scores/host', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { hole, score, user_id, force } = req.body
    if (hole === undefined || score === undefined || !user_id)
      return res.status(400).json({ error: 'hole, score, user_id required' })

    const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })

    // Permission gate: host (creator) OR explicit marker OR same-group.
    const isHost = String(outing.host_id) === String(req.user.id)
    const stParticipants = outing.state?.participants ?? []
    const stMarkers      = outing.state?.markers ?? []
    const me     = stParticipants.find(p => String(p.user_id) === String(req.user.id))
    const target = stParticipants.find(p => String(p.user_id) === String(user_id))
    const isExplicitMarker = stMarkers.some(m =>
      String(m.marker_id) === String(req.user.id) &&
      (m.member_ids || []).map(String).includes(String(user_id))
    )
    const isSameGroup = me?.group_id != null && target?.group_id != null &&
      me.group_id === target.group_id
    if (!isHost && !isExplicitMarker && !isSameGroup)
      return res.status(403).json({ error: 'Not permitted to enter scores for this player' })

    const state = outing.state || { participants: [] }
    const isGuest = String(user_id).startsWith('guest_')

    if (isGuest) {
      // Guest scores live in state JSONB only
      const pi = (state.participants || []).findIndex(p => String(p.user_id) === String(user_id))
      if (pi < 0) return res.status(404).json({ error: 'Guest not found' })
      const holes  = outing.state?.holes ?? 18
      const scores = Array.isArray(state.participants[pi].scores) ? [...state.participants[pi].scores] : new Array(holes).fill(0)
      while (scores.length < holes) scores.push(0)
      const oldScore = scores[hole] ?? 0
      // Conflict guard: refuse to silently overwrite a different
      // existing non-zero score unless the requester is the host
      // OR they explicitly confirmed via force:true. Self-edits
      // never hit this path (guests have no auth) so always check.
      if (!force && !isHost && Number(oldScore) > 0 && Number(oldScore) !== Number(score)) {
        return res.status(409).json({
          error: 'score_conflict',
          message: `Hole ${Number(hole) + 1} already has a score of ${oldScore}. Resubmit with force:true to overwrite.`,
          existing_score: Number(oldScore),
        })
      }
      scores[hole] = score
      const total       = scores.reduce((s, x) => s + (x || 0), 0)
      const holesPlayed = scores.filter(x => x > 0).length
      state.participants[pi].scores      = scores
      state.participants[pi].total       = total
      state.participants[pi].holes_played = holesPlayed
      await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
      if (Number(oldScore || 0) !== Number(score)) {
        writeScoreAudit({
          outing_id: outing.id, user_id, hole,
          old_score: oldScore || null, new_score: score, edited_by_id: req.user.id,
        })
      }
      return res.json({ ok: true, total, holesPlayed })
    }

    // App user — update tm_outing_participants row + sync state
    const existing = await db.one(
      'SELECT * FROM tm_outing_participants WHERE outing_id = $1 AND user_id = $2',
      [outing.id, user_id]
    )
    if (!existing) return res.status(404).json({ error: 'Participant not found' })

    const holes  = outing.state?.holes ?? 18
    const scores = Array.isArray(existing.scores) ? [...existing.scores] : new Array(holes).fill(0)
    while (scores.length < holes) scores.push(0)
    const oldScore = scores[hole] ?? 0
    // Same conflict guard as the guest path. Player overwriting their
    // own score is allowed without force (they're using a different
    // endpoint anyway — /:code/scores — but this covers the case
    // where the host endpoint is called for self).
    const isSelfEdit = String(user_id) === String(req.user.id)
    if (!force && !isHost && !isSelfEdit && Number(oldScore) > 0 && Number(oldScore) !== Number(score)) {
      return res.status(409).json({
        error: 'score_conflict',
        message: `Hole ${Number(hole) + 1} already has a score of ${oldScore}. Resubmit with force:true to overwrite.`,
        existing_score: Number(oldScore),
      })
    }
    scores[hole] = score

    const total       = scores.reduce((s, x) => s + (x || 0), 0)
    const holesPlayed = scores.filter(x => x > 0).length

    await db.query(
      'UPDATE tm_outing_participants SET scores=$1, total=$2 WHERE outing_id=$3 AND user_id=$4',
      [JSON.stringify(scores), total, outing.id, user_id]
    )

    const pi = (state.participants || []).findIndex(p => String(p.user_id) === String(user_id))
    if (pi >= 0) {
      state.participants[pi].total       = total
      state.participants[pi].holes_played = holesPlayed
    }
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])

    if (Number(oldScore || 0) !== Number(score)) {
      writeScoreAudit({
        outing_id: outing.id, user_id, hole,
        old_score: oldScore || null, new_score: score, edited_by_id: req.user.id,
      })
    }

    res.json({ ok: true, total, holesPlayed })
  } catch (err) {
    console.error('[outings/scores/host]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/outings/:code/audit ────────────────────────────────────────────
// Host-only readout of every score change in this outing, newest first.
// Powers the commissioner correction panel's history view.
// (2026-05-01 — league must-have B2.)
router.get('/:code/audit', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const outing = await db.one('SELECT id, host_id FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })

    const rows = await db.many(
      `SELECT a.id, a.user_id, a.hole, a.old_score, a.new_score, a.created_at,
              a.edited_by_id, u.name AS edited_by_name
       FROM tm_score_audit a
       LEFT JOIN tm_users u ON u.id = a.edited_by_id
       WHERE a.outing_id = $1
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [outing.id]
    )
    res.json({ entries: rows || [] })
  } catch (err) {
    console.error('[outings/audit]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── POST /api/outings/:code/withdraw ────────────────────────────────────────
// Host-only: mark a participant withdrawn (or un-withdraw). Their
// scores stay in the DB for posterity but they're excluded from
// leaderboard / handicap calc / final results. Body: { user_id,
// withdrawn: bool }. (2026-05-01 — league must-have B3.)
router.post('/:code/withdraw', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { user_id, withdrawn } = req.body
    if (!user_id) return res.status(400).json({ error: 'user_id required' })

    const outing = await db.one('SELECT id, host_id, state FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })

    const state = outing.state || { participants: [] }
    const idx = (state.participants || []).findIndex(p => String(p.user_id) === String(user_id))
    if (idx < 0) return res.status(404).json({ error: 'Participant not found' })

    state.participants[idx].withdrawn = !!withdrawn
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[outings/withdraw]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── POST /api/outings/:code/end ──────────────────────────────────────────────
router.post('/:code/end', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Outing not found' })
    if (String(outing.host_id) !== String(req.user.id)) return res.status(403).json({ error: 'Only host can end outing' })

    const dbParticipants = await db.many(
      `SELECT op.*, u.name, u.handicap
       FROM tm_outing_participants op
       LEFT JOIN tm_users u ON u.id = op.user_id
       WHERE op.outing_id = $1 ORDER BY op.total ASC NULLS LAST`,
      [outing.id]
    )
    // Merge in guest participants from state (no DB row)
    const state      = outing.state || { participants: [] }
    const holePars   = (() => {
      const cp = outing.course_par ?? 72; const h = state.holes ?? 18
      const base = Math.floor(cp / h), extra = cp - base * h
      return Array.from({ length: h }, (_, i) => (i < extra ? base + 1 : base))
    })()
    const allParticipants = (state.participants || []).map(sp => {
      const dp = dbParticipants.find(r => String(r.user_id) === String(sp.user_id))
      return dp
        ? { ...sp, scores: dp.scores || [], name: dp.name || sp.name, handicap: dp.handicap }
        : sp // guest
    }).sort((a, b) => (a.total ?? 999) - (b.total ?? 999))

    // For individual play: write 1v1 match history for every pair
    if (outing.team_format === 'individual' && dbParticipants.length >= 2) {
      const winner = dbParticipants[0]
      for (let i = 1; i < dbParticipants.length; i++) {
        const loser   = dbParticipants[i]
        const isTie   = winner.total === loser.total
        await db.query(
          `INSERT INTO tm_match_history
             (outing_id, winner_id, loser_id, is_tie, winner_score, loser_score, course_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT DO NOTHING`,
          [outing.id, isTie ? null : winner.user_id, isTie ? null : loser.user_id,
           isTie, winner.total, loser.total, outing.course_name]
        )
      }
      for (const p of dbParticipants) {
        const result = p.total === dbParticipants[0].total
          ? (dbParticipants.filter(x => x.total === dbParticipants[0].total).length > 1 ? 'tie' : 'win')
          : 'loss'
        await db.query('UPDATE tm_outing_participants SET result=$1 WHERE id=$2', [result, p.id])
      }
    }

    await db.query("UPDATE tm_outings SET status='closed' WHERE id=$1", [outing.id])

    // Emit a tm_rounds row for every non-guest participant whose scores
    // are valid (9+ holes, every hole > 0). Idempotent via the
    // UNIQUE(user_id, outing_id) index from migration 008. Each insert
    // also fires a handicap recompute so the user's index updates
    // immediately when they cross the 5-completed-rounds threshold.
    // (2026-05-01 — fix for "matches don't show in recent rounds")
    try {
      const { maybeUpdateUserHandicap } = require('../lib/handicap')
      for (const p of dbParticipants) {
        // tm_outing_participants only carries rows for real users —
        // guests live in tm_outings.state JSON only and never make
        // it into the dbParticipants list. So a NOT NULL user_id
        // check is sufficient.
        if (!p.user_id) continue
        const scores = Array.isArray(p.scores) ? p.scores : (() => { try { return JSON.parse(p.scores ?? '[]') } catch { return [] } })()
        if (!Array.isArray(scores) || scores.length < 9) continue
        if (!scores.every(s => s != null && Number(s) > 0)) continue
        const total = Number(p.total)
        if (!Number.isFinite(total) || total <= 0) continue
        await db.query(
          `INSERT INTO tm_rounds (
             user_id, outing_id, course_name, course_par,
             course_rating, slope_rating, game_type, scores, total, date
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (user_id, outing_id) DO NOTHING`,
          [
            p.user_id, outing.id,
            outing.course_name || 'Match',
            outing.course_par,
            outing.course_rating ?? null,
            outing.slope_rating ?? null,
            (outing.scoring_formats?.[0] ?? 'stroke'),
            JSON.stringify(scores),
            total,
          ]
        )
        // Fire-and-forget per-user handicap recompute. Errors logged in helper.
        maybeUpdateUserHandicap(p.user_id)
      }
    } catch (e) {
      console.error('[outings/end] round-emit failed:', e.message)
      // Don't fail the whole end-match response over this — the match is
      // already closed; the user can re-trigger the rounds backfill via
      // a future migration if necessary.
    }

    // Build summary for winner ceremony
    const coursePar = outing.course_par ?? 72
    function playerHighlights(p) {
      const sc = Array.isArray(p.scores) ? p.scores : []
      let birdies = 0, eagles = 0, pars = 0, bogeys = 0
      let bestHoleDiff = 99, bestHole = null
      sc.forEach((s, h) => {
        if (!s) return
        const d = s - (holePars[h] || 4)
        if (d <= -2) { eagles++; if (d < bestHoleDiff) { bestHoleDiff = d; bestHole = { hole: h + 1, score: s, par: holePars[h] || 4 } } }
        else if (d === -1) { birdies++; if (d < bestHoleDiff) { bestHoleDiff = d; bestHole = { hole: h + 1, score: s, par: holePars[h] || 4 } } }
        else if (d === 0) pars++
        else if (d === 1) bogeys++
      })
      return { birdies, eagles, pars, bogeys, bestHole }
    }

    const podium = allParticipants.slice(0, 5).map(p => {
      const hl = playerHighlights(p)
      const played = (p.scores || []).filter(s => s > 0).length
      const parSoFar = (p.scores || []).map((s, i) => s > 0 ? (holePars[i] || 4) : 0).reduce((a, b) => a + b, 0)
      const diff = (p.total || 0) - parSoFar
      return {
        user_id: p.user_id, name: p.name, total: p.total || 0,
        holes_played: played, diff, is_guest: p.is_guest || false,
        handicap: p.handicap || null, ...hl,
      }
    })

    // Overall highlights
    const mostBirdies  = [...allParticipants].sort((a, b) => playerHighlights(b).birdies - playerHighlights(a).birdies)[0]
    const mostEagles   = allParticipants.find(p => playerHighlights(p).eagles > 0)
    const mbHL         = mostBirdies ? playerHighlights(mostBirdies) : null

    res.json({
      ok: true,
      summary: {
        winner: podium[0] || null,
        podium,
        course: outing.course_name,
        course_par: coursePar,
        format: outing.scoring_formats?.[0] || 'stroke',
        team_format: outing.team_format,
        highlights: {
          most_birdies: mbHL?.birdies > 0 ? { name: mostBirdies.name, count: mbHL.birdies } : null,
          most_eagles:  mostEagles && playerHighlights(mostEagles).eagles > 0
            ? { name: mostEagles.name, count: playerHighlights(mostEagles).eagles } : null,
        },
      },
    })
  } catch (err) {
    console.error('[outings/end]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/outings/:code/markers ──────────────────────────────────────────
// Host-only: save group marker assignments
// Body: { markers: [{ marker_id, member_ids[] }] }
router.put('/:code/markers', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })

    const { markers } = req.body
    if (!Array.isArray(markers)) return res.status(400).json({ error: 'markers array required' })

    const state = { ...(outing.state || {}), markers }
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
    res.json({ ok: true, markers })
  } catch (err) {
    console.error('[outings/markers]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/outings/:code/scores/marker ────────────────────────────────────
// Assigned marker: enter scores for any player in their group
router.put('/:code/scores/marker', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { hole, score, user_id } = req.body
    if (hole === undefined || score === undefined || !user_id)
      return res.status(400).json({ error: 'hole, score, user_id required' })

    const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })

    // Verify caller is an assigned marker for the target player
    const markers = outing.state?.markers ?? []
    const callerIsMarker = markers.some(m =>
      String(m.marker_id) === String(req.user.id) &&
      m.member_ids.map(String).includes(String(user_id))
    )
    if (!callerIsMarker)
      return res.status(403).json({ error: 'Not a marker for this player' })

    const state = outing.state || { participants: [] }
    const isGuest = String(user_id).startsWith('guest_')

    if (isGuest) {
      const pi = (state.participants || []).findIndex(p => String(p.user_id) === String(user_id))
      if (pi < 0) return res.status(404).json({ error: 'Guest not found' })
      const holes  = outing.state?.holes ?? 18
      const scores = Array.isArray(state.participants[pi].scores) ? [...state.participants[pi].scores] : new Array(holes).fill(0)
      while (scores.length < holes) scores.push(0)
      scores[hole] = score
      const total       = scores.reduce((s, x) => s + (x || 0), 0)
      const holesPlayed = scores.filter(x => x > 0).length
      state.participants[pi].scores      = scores
      state.participants[pi].total       = total
      state.participants[pi].holes_played = holesPlayed
      await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
      return res.json({ ok: true, total, holesPlayed })
    }

    // App user
    const existing = await db.one(
      'SELECT * FROM tm_outing_participants WHERE outing_id=$1 AND user_id=$2',
      [outing.id, user_id]
    )
    if (!existing) return res.status(404).json({ error: 'Participant not found' })

    const holes  = outing.state?.holes ?? 18
    const scores = Array.isArray(existing.scores) ? [...existing.scores] : new Array(holes).fill(0)
    while (scores.length < holes) scores.push(0)
    scores[hole] = score
    const total       = scores.reduce((s, x) => s + (x || 0), 0)
    const holesPlayed = scores.filter(x => x > 0).length

    await db.query(
      'UPDATE tm_outing_participants SET scores=$1, total=$2 WHERE outing_id=$3 AND user_id=$4',
      [JSON.stringify(scores), total, outing.id, user_id]
    )
    const pi = (state.participants || []).findIndex(p => String(p.user_id) === String(user_id))
    if (pi >= 0) {
      state.participants[pi].total       = total
      state.participants[pi].holes_played = holesPlayed
    }
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
    res.json({ ok: true, total, holesPlayed })
  } catch (err) {
    console.error('[outings/scores/marker]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/outings/:code/teams ─────────────────────────────────────────────
// Host-only: save/update team assignments in the outing state
router.put('/:code/teams', async (req, res) => {
  try {
    const code   = req.params.code.toUpperCase()
    const outing = await db.one('SELECT * FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Only the host can set teams' })

    const { teams } = req.body   // [{ id, name, color, member_ids: [user_id, ...] }]
    if (!Array.isArray(teams)) return res.status(400).json({ error: 'teams array required' })

    const state = { ...(outing.state || {}), teams }
    await db.query('UPDATE tm_outings SET state = $1 WHERE id = $2', [JSON.stringify(state), outing.id])
    res.json({ ok: true, teams })
  } catch (err) {
    console.error('[outings/teams]', err)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
