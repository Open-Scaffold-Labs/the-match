const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

// ─── PUBLIC live leaderboard — no auth ────────────────────────────────────────
// GET /api/outings/:code/public
//
// Returns a sanitized snapshot of an outing's leaderboard so anyone
// with the URL (e.g. tee-box QR scan, group-chat share) can see
// live scores without an account. Strips emails + per-player
// permissions + commissioner config; keeps name, handle, score,
// position, and the format / course context.
//
// Mounted BEFORE the requireAuth middleware so the endpoint is
// genuinely public. Cache-friendly (no Authorization header).
//
// IMPORTANT — Vercel Deployment Protection. If Vercel's "Deployment
// Protection" is on for the project, ALL routes (including this
// public one) get an upstream 401 before our app ever sees the
// request. To make the QR / share-link path actually work in prod,
// Project Settings → Deployment Protection → Production must be
// "Disabled" (or use a public bypass token). This is a deploy-time
// setting, not a code change. (Round 20 audit — flagging here so a
// future fresh deploy doesn't get caught by the same block.)
//
// (Round 2 audit — public live leaderboard.)
router.get('/:code/public', async (req, res) => {
  try {
    const row = await db.one(
      'SELECT id, code, name, course_name, course_par, scoring_formats, status, hole_pars, hole_handicaps, expected_players, team_breakdown, state FROM tm_outings WHERE code = $1',
      [req.params.code.toUpperCase()]
    )
    if (!row) return res.status(404).json({ error: 'Outing not found' })

    // Enrich participants with live scores from tm_outing_participants
    // (same pattern as the authed GET) but trim to public fields only.
    const partRows = await db.many(
      `SELECT op.user_id, op.scores, u.name, u.handle, u.handicap, u.avatar
       FROM tm_outing_participants op
       LEFT JOIN tm_users u ON u.id = op.user_id
       WHERE op.outing_id = $1`,
      [row.id]
    )
    const state = row.state || { participants: [] }
    const enriched = (state.participants || []).map(p => {
      if (p.is_guest) {
        return {
          user_id: p.user_id,
          name: p.name,
          is_guest: true,
          scores: p.scores || [],
          total: p.total ?? 0,
          holes_played: p.holes_played ?? 0,
          group_id: p.group_id ?? null,
          team_id:  p.team_id  ?? null,
          withdrawn: !!p.withdrawn,
          no_show:   !!p.no_show,
        }
      }
      const dp = partRows.find(r => String(r.user_id) === String(p.user_id))
      return {
        user_id: p.user_id,
        name: dp?.name || p.name || 'Player',
        handle: dp?.handle || null,
        avatar: dp?.avatar ?? null,
        handicap: dp?.handicap ?? null,
        scores: dp?.scores || [],
        total: p.total ?? 0,
        holes_played: p.holes_played ?? 0,
        group_id: p.group_id ?? null,
        team_id:  p.team_id  ?? null,
        withdrawn: !!p.withdrawn,
        no_show:   !!p.no_show,
      }
    })

    res.json({
      outing: {
        code: row.code,
        name: row.name,
        course_name: row.course_name,
        course_par:  row.course_par,
        scoring_formats: row.scoring_formats,
        status: row.status,
        hole_pars: row.hole_pars,
        hole_handicaps: row.hole_handicaps,
        expected_players: row.expected_players,
        team_breakdown: row.team_breakdown,
        state: {
          holes: state.holes ?? 18,
          handicap_allowance: state.handicap_allowance ?? 100,
          stableford_points: state.stableford_points ?? null,
          groups: state.groups ?? [],
          // Expose teams so the public Best Ball leaderboard (6.3) can
          // cluster players by team and show per-team total. Only id /
          // name / color / member_ids — no internal commissioner fields.
          // (2026-05-02)
          teams: Array.isArray(state.teams)
            ? state.teams.map(t => ({
                id: t.id,
                name: t.name,
                color: t.color || null,
                member_ids: Array.isArray(t.member_ids) ? t.member_ids : [],
              }))
            : [],
          team_breakdown: state.team_breakdown ?? null,
          // Item 6 — expose no_show_policy so the public client can
          // render no-shows correctly (DNS pill, max+2 ghost row, etc.)
          no_show_policy: state.no_show_policy || 'dns',
          // Keep no-show players in the response (unlike withdrawn)
          // because the policy may dictate they show on the
          // leaderboard with a synthetic max+2 score. Public client
          // decides how to render.
          participants: enriched.filter(p => !p.withdrawn),
        },
      },
    })
  } catch (err) {
    console.error('[outings/public]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

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
    // Stableford preset (B4b): 'standard' or 'modified' or 'custom'.
    // Only stored when format=stableford. Server resolves to the full
    // point map and stashes it in state so the client can read it
    // without shipping the preset table to every render.
    stablefordPreset,
    // 6.5 — when stablefordPreset is 'custom', the wizard ships the
    // full point map. Server validates each bucket as a finite number
    // in [-10, 20] (covers every real-world variant) and falls back
    // to 'standard' if anything is malformed.
    customStablefordPoints,
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
  // 6.5 — sanitizer for a custom Stableford point map. Returns the
  // sanitized map if every required bucket is a finite number in the
  // allowed range, or null if anything's missing/invalid (caller
  // should fall back to a preset).
  function sanitizeStablefordPointMap(raw) {
    if (!raw || typeof raw !== 'object') return null
    const buckets = ['double_eagle', 'eagle', 'birdie', 'par', 'bogey', 'double', 'worse']
    const out = {}
    for (const key of buckets) {
      const v = Number(raw[key])
      if (!Number.isFinite(v) || v < -10 || v > 20) return null
      out[key] = v
    }
    return out
  }
  // 6.5 — when 'custom' is selected, reject the create if the map
  // is malformed instead of silently falling through to 'standard'.
  // Otherwise the host sees their custom values disappear without
  // any signal as to why. (Round 11 double-check pass.)
  let sanitizedCustom = null
  if (stablefordPreset === 'custom' && Array.isArray(scoringFormats) && scoringFormats.includes('stableford')) {
    sanitizedCustom = sanitizeStablefordPointMap(customStablefordPoints)
    if (!sanitizedCustom) {
      return res.status(400).json({
        error: 'customStablefordPoints invalid — every bucket (double_eagle, eagle, birdie, par, bogey, double, worse) must be a number between -10 and 20',
      })
    }
  }
  const stablefordPointMap = (Array.isArray(scoringFormats) && scoringFormats.includes('stableford'))
    ? (sanitizedCustom || STABLEFORD_PRESETS_S[stablefordPreset] || STABLEFORD_PRESETS_S.standard)
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
//
// Guest user_ids ("guest_<timestamp>") are strings, but the column
// is BIGINT — so we skip them entirely rather than log noise on every
// guest score update. The trade-off: guest score changes aren't
// auditable. For league play (the audit log's primary use case)
// guests are atypical anyway. (Iteration 2 fix.)
async function writeScoreAudit({ outing_id, user_id, hole, old_score, new_score, edited_by_id }) {
  if (String(user_id).startsWith('guest_')) return
  try {
    await db.query(
      `INSERT INTO tm_score_audit (outing_id, user_id, hole, old_score, new_score, edited_by_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [outing_id, Number(user_id), Number(hole), old_score == null ? null : Number(old_score), Number(new_score), edited_by_id]
    )
  } catch (err) {
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

  // Withdrawn-self check. Players who've been withdrawn shouldn't
  // be able to enter their own scores via this endpoint either.
  // (Round 5 audit fix.)
  const stSelfState = (outing.state?.participants || []).find(p => String(p.user_id) === String(req.user.id))
  if (stSelfState?.withdrawn) {
    return res.status(409).json({
      error: 'player_withdrawn',
      message: "You've been withdrawn from this outing. Ask the host to reinstate you before entering scores.",
    })
  }

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
      // Withdrawn players don't accept new scores — host must
      // reinstate first. Round 5 audit fix.
      if (state.participants[pi].withdrawn) {
        return res.status(409).json({
          error: 'player_withdrawn',
          message: 'This player has been withdrawn from the outing. Reinstate from Manage to resume scoring.',
        })
      }
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

    // Withdrawn check (mirrors the guest path). Round 5 audit fix.
    const stEntry = (state.participants || []).find(p => String(p.user_id) === String(user_id))
    if (stEntry?.withdrawn) {
      return res.status(409).json({
        error: 'player_withdrawn',
        message: 'This player has been withdrawn from the outing. Reinstate from Manage to resume scoring.',
      })
    }

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
//
// Pagination (6.6):
//   - ?limit=N (default 100, capped at 200) — page size
//   - ?cursor=<created_at>|<id> — opaque cursor returned from the
//     previous page's `next_cursor`. We page on (created_at, id) so
//     ties on created_at don't drop rows.
// Response: { entries, next_cursor } where next_cursor is null on the
// final page. Cursor is a string the client treats as opaque.
//
// (2026-05-01 / 2026-05-02 — league must-have B2 → 6.6.)
router.get('/:code/audit', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const outing = await db.one('SELECT id, host_id FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })

    // Page size — capped so a malicious or careless client can't
    // demand a 100k row dump in one shot.
    const rawLimit = Number(req.query.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(200, Math.max(1, Math.round(rawLimit)))
      : 100

    // Decode cursor — format: "<iso_timestamp>|<id>". An invalid
    // cursor is silently ignored (just returns the first page) so a
    // stale link doesn't 500.
    let cursorClause = ''
    const params = [outing.id]
    if (typeof req.query.cursor === 'string' && req.query.cursor.length > 0) {
      const [ts, idRaw] = req.query.cursor.split('|')
      const id = Number(idRaw)
      const tsDate = new Date(ts)
      if (Number.isFinite(id) && !Number.isNaN(tsDate.getTime())) {
        params.push(tsDate.toISOString(), id)
        // Keyset: rows strictly older than the cursor, OR same
        // created_at but smaller id (so equal-timestamp rows don't
        // get visited twice or skipped).
        cursorClause = ` AND (a.created_at < $${params.length - 1}
                              OR (a.created_at = $${params.length - 1} AND a.id < $${params.length}))`
      }
    }
    params.push(limit + 1)  // fetch one extra row to detect "has next"
    const rows = await db.many(
      `SELECT a.id, a.user_id, a.hole, a.old_score, a.new_score, a.created_at,
              a.edited_by_id, u.name AS edited_by_name
       FROM tm_score_audit a
       LEFT JOIN tm_users u ON u.id = a.edited_by_id
       WHERE a.outing_id = $1${cursorClause}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length}`,
      params
    )

    const all = rows || []
    let nextCursor = null
    let entries = all
    if (all.length > limit) {
      // Trim the extra row and use the LAST returned row as the
      // cursor for the next page.
      entries = all.slice(0, limit)
      const last = entries[entries.length - 1]
      nextCursor = `${new Date(last.created_at).toISOString()}|${last.id}`
    }
    res.json({ entries, next_cursor: nextCursor })
  } catch (err) {
    console.error('[outings/audit]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/outings/:code/export.csv ──────────────────────────────────────
// Host-only: download a CSV of the outing's current state for the
// commissioner's own reporting (insurance, skins-pool payouts, league
// records, etc.). Columns: Position, Player, Handle, Handicap (effective
// — uses per-event override if set), Total, Front, Back, Hole 1..N,
// Status (Active / Withdrawn / DNS / NoShow).
//
// CSV escaping: anything containing comma, quote, newline, or starting
// with =/+/-/@ (Excel formula injection) gets quoted with internal
// quotes doubled. Player names + announcements are the realistic
// vectors for an injection attack via this endpoint.
//
// (2026-05-02 — league readiness item 8.)
router.get('/:code/export.csv', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const outing = await db.one(
      'SELECT id, host_id, name, code, course_name, course_par, hole_pars, scoring_formats, status, state FROM tm_outings WHERE code = $1',
      [code]
    )
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })

    const partRows = await db.many(
      `SELECT op.user_id, op.scores, op.total, u.name, u.handle, u.handicap
       FROM tm_outing_participants op
       LEFT JOIN tm_users u ON u.id = op.user_id
       WHERE op.outing_id = $1`,
      [outing.id]
    )
    const state = outing.state || { participants: [] }
    const holeCount = state.holes ?? 18
    const holePars = (() => {
      const real = Array.isArray(outing.hole_pars) ? outing.hole_pars : null
      if (real && real.length >= holeCount) return real.slice(0, holeCount)
      const cp = outing.course_par ?? 72
      const base = Math.floor(cp / holeCount), extra = cp - base * holeCount
      return Array.from({ length: holeCount }, (_, i) => i < extra ? base + 1 : base)
    })()
    const overrides = state.handicap_overrides || {}

    function csvEscape(v) {
      if (v == null) return ''
      let s = String(v)
      // Excel formula-injection guard — prefix the cell with a single
      // quote so the formula char is treated as literal text.
      if (/^[=+\-@]/.test(s)) s = "'" + s
      if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
      return s
    }

    // Build rows. Sort by total ascending, withdrawn / no-show pushed
    // to the bottom so the leaderboard order matches what spectators
    // see in the app.
    const rows = (state.participants || []).map(sp => {
      const dp = partRows.find(r => String(r.user_id) === String(sp.user_id))
      const scores = (dp?.scores && Array.isArray(dp.scores)) ? dp.scores : (sp.scores || [])
      // Compute total from scores rather than trusting dp.total — the
      // cached total can be stale relative to the latest score writes.
      // (Self-review fix on item 8.)
      const total = (Array.isArray(scores) ? scores : []).reduce((s, v) => s + (Number(v) || 0), 0)
      const front = scores.slice(0, 9).reduce((s, v) => s + (v || 0), 0)
      const back  = scores.slice(9, 18).reduce((s, v) => s + (v || 0), 0)
      const ov    = overrides[String(sp.user_id)]
      const effective = ov != null && Number.isFinite(Number(ov)) ? Number(ov) : (dp?.handicap ?? null)
      const status = sp.withdrawn ? 'Withdrawn'
        : sp.no_show ? 'NoShow'
        : (Array.isArray(scores) && scores.filter(s => s > 0).length === 0) ? 'Inactive'
        : 'Active'
      return {
        sortKey: sp.withdrawn || sp.no_show ? 9_999_999 : (total > 0 ? total : 9_999_998),
        cells: [
          dp?.name || sp.name || `Player ${sp.user_id}`,
          dp?.handle ? `@${dp.handle}` : '',
          effective != null ? String(effective) : '',
          total > 0 ? String(total) : '',
          front > 0 ? String(front) : '',
          back > 0 ? String(back) : '',
          ...Array.from({ length: holeCount }, (_, h) => scores[h] > 0 ? String(scores[h]) : ''),
          status,
        ],
      }
    }).sort((a, b) => a.sortKey - b.sortKey)
      .map((r, i) => [String(i + 1), ...r.cells])

    const header = [
      'Position', 'Player', 'Handle', 'Handicap', 'Total', 'Front', 'Back',
      ...Array.from({ length: holeCount }, (_, h) => `Hole ${h + 1}`),
      'Status',
    ]

    const lines = [header, ...rows].map(row => row.map(csvEscape).join(','))
    // Course/format header so the file is self-describing
    const meta = [
      `# Match: ${csvEscape(outing.name)}`,
      `# Code: ${csvEscape(outing.code)}`,
      `# Course: ${csvEscape(outing.course_name)} (par ${outing.course_par})`,
      `# Format: ${csvEscape((outing.scoring_formats || []).join('+'))}`,
      `# Status: ${csvEscape(outing.status)}`,
      `# Exported: ${new Date().toISOString()}`,
      '',
    ]
    const body = [...meta, ...lines].join('\r\n') + '\r\n'

    const filename = `match-${outing.code}-${new Date().toISOString().slice(0, 10)}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(body)
  } catch (err) {
    console.error('[outings/export]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/outings/season/:season — season standings ─────────────────────
// Cross-outing rollup keyed by season string ("2026", "2026-spring",
// whatever the league uses). Returns aggregated stats per player across
// every closed outing tagged with this season:
//   { season, outings_count, players: [{ user_id, name, handle, played,
//                                         won, top3, total_points, avg_to_par }] }
//
// Season tag lives on outing.state.season. Hosts set it at creation
// (via the wizard) or post-hoc through PUT /:code/season.
router.get('/season/:season', async (req, res) => {
  try {
    const season = String(req.params.season || '').slice(0, 64)
    if (!season) return res.status(400).json({ error: 'season required' })

    const rows = await db.many(
      `SELECT id, name, code, status, state, scoring_formats
       FROM tm_outings
       WHERE state->>'season' = $1
         AND status IN ('closed', 'cancelled')
       ORDER BY id ASC`,
      [season]
    )

    // Aggregate per-player. Position is computed from the participant
    // ordering at end-time (state.participants is sorted by total asc
    // by the time the outing closes).
    const playerMap = new Map()
    for (const o of rows) {
      const state = o.state || {}
      const parts = (state.participants || []).filter(p => !p.withdrawn && !p.no_show)
      const sorted = [...parts].sort((a, b) => (a.total ?? 9_999_999) - (b.total ?? 9_999_999))
      sorted.forEach((p, idx) => {
        if (!p.user_id) return
        const k = String(p.user_id)
        if (!playerMap.has(k)) {
          playerMap.set(k, {
            user_id: p.user_id, name: p.name, handle: p.handle || null,
            played: 0, wins: 0, top3: 0, scoresum: 0, scorecount: 0,
          })
        }
        const m = playerMap.get(k)
        m.played += 1
        if (idx === 0) m.wins += 1
        if (idx < 3)   m.top3 += 1
        if (Number(p.total) > 0) {
          m.scoresum += Number(p.total)
          m.scorecount += 1
        }
      })
    }
    const players = Array.from(playerMap.values())
      .map(m => ({
        ...m,
        avg_score: m.scorecount > 0 ? +(m.scoresum / m.scorecount).toFixed(1) : null,
      }))
      .sort((a, b) => b.wins - a.wins || b.top3 - a.top3 || a.avg_score - b.avg_score)
    res.json({
      season,
      outings_count: rows.length,
      outings: rows.map(o => ({ id: o.id, name: o.name, code: o.code, status: o.status })),
      players,
    })
  } catch (err) {
    console.error('[outings/season]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/outings/:code/season — set season tag ─────────────────────────
router.put('/:code/season', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { season } = req.body
    const tag = (typeof season === 'string') ? season.trim().slice(0, 64) : ''
    const outing = await db.one('SELECT id, host_id, state FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })
    const state = { ...(outing.state || {}) }
    if (tag) state.season = tag
    else delete state.season
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
    res.json({ ok: true, season: tag || null })
  } catch (err) {
    console.error('[outings/season-set]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── POST /api/outings/:code/announcement ───────────────────────────────────
// Host-only: post an announcement to the outing's participants. Stored
// on outing.state.announcements[] as { id, text, posted_by_id,
// posted_by_name, posted_at }. Push fan-out notifies every non-host
// participant. (Item 7 — communication.)
router.post('/:code/announcement', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { text } = req.body
    if (typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text required' })
    }
    if (text.length > 600) {
      return res.status(400).json({ error: 'announcement is too long (max 600 chars)' })
    }

    const outing = await db.one(
      'SELECT id, host_id, name, code, state FROM tm_outings WHERE code = $1',
      [code]
    )
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })

    const author = await db.one('SELECT name FROM tm_users WHERE id = $1', [req.user.id])

    const announcement = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim(),
      posted_by_id: req.user.id,
      posted_by_name: author?.name || 'Commissioner',
      posted_at: new Date().toISOString(),
    }
    const state = outing.state || { participants: [] }
    const list = Array.isArray(state.announcements) ? state.announcements : []
    // Cap at 50 most-recent announcements per outing — older ones drop
    // off the bottom. Prevents the JSON state from ballooning.
    const next = [announcement, ...list].slice(0, 50)
    state.announcements = next
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])

    // Push fan-out to every non-host participant. Best-effort — we
    // don't fail the request if push fails for any individual sub.
    try {
      const { sendPushToUser } = require('../lib/push')
      for (const p of (state.participants || [])) {
        if (p.is_guest) continue
        if (String(p.user_id) === String(req.user.id)) continue
        if (p.withdrawn) continue
        sendPushToUser(p.user_id, {
          title: `${outing.name} · Commissioner`,
          body: announcement.text.slice(0, 180),
          url: `/?match=${outing.code}`,
          tag: `announcement-${outing.code}`,
        })
      }
    } catch (err) {
      console.error('[outings/announcement] push fan-out failed', err.message)
    }

    res.json({ ok: true, announcement, announcements: next })
  } catch (err) {
    console.error('[outings/announcement]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── POST /api/outings/:code/cancel ─────────────────────────────────────────
// Host-only: cancel a scheduled outing. Sets status='cancelled' and
// fans out a push to every non-host participant. Distinct from /end
// (which closes a played match) and /:code DELETE (hard removal).
// Cancelled matches stay in the DB so they can be referenced later
// in player history; they just don't render as "active".
router.post('/:code/cancel', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { reason } = req.body
    const outing = await db.one(
      'SELECT id, host_id, name, code, status, state FROM tm_outings WHERE code = $1',
      [code]
    )
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })
    if (outing.status === 'closed' || outing.status === 'cancelled') {
      return res.status(409).json({ error: `Outing already ${outing.status}` })
    }

    await db.query("UPDATE tm_outings SET status='cancelled' WHERE id=$1", [outing.id])

    // Push fan-out
    try {
      const { sendPushToUser } = require('../lib/push')
      const reasonLine = (typeof reason === 'string' && reason.trim()) ? ` — ${reason.trim()}` : ''
      const state = outing.state || {}
      for (const p of (state.participants || [])) {
        if (p.is_guest) continue
        if (String(p.user_id) === String(req.user.id)) continue
        if (p.withdrawn) continue
        sendPushToUser(p.user_id, {
          title: `${outing.name} cancelled`,
          body: `The commissioner cancelled this match${reasonLine}.`,
          url: `/?match=${outing.code}`,
          tag: `cancel-${outing.code}`,
        })
      }
    } catch (err) {
      console.error('[outings/cancel] push fan-out failed', err.message)
    }

    res.json({ ok: true, status: 'cancelled' })
  } catch (err) {
    console.error('[outings/cancel]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── POST /api/outings/:code/no-show ────────────────────────────────────────
// Host-only: mark a participant as a no-show (or clear). Different from
// withdraw — withdraw is a mid-round dropout (player started but
// stopped); no-show means the player never started. Both flags can be
// set, but typically a no-show stays at status no_show=true,
// withdrawn=false.
//
// The OUTING-level no_show_policy (state.no_show_policy) controls how
// no-shows render on the leaderboard:
//   - 'dns' (default): excluded from ranking, shown with a "DNS" pill
//   - 'max_plus_2': counted as if they posted (par + 2) on every hole
//   - 'manual': commissioner enters a final score themselves
//
// Body: { user_id, no_show: bool }
// (2026-05-02 — league readiness item 6.)
router.post('/:code/no-show', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { user_id, no_show } = req.body
    if (!user_id) return res.status(400).json({ error: 'user_id required' })

    const outing = await db.one('SELECT id, host_id, state FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })

    const state = outing.state || { participants: [] }
    const idx = (state.participants || []).findIndex(p => String(p.user_id) === String(user_id))
    if (idx < 0) return res.status(404).json({ error: 'Participant not found' })

    state.participants[idx].no_show = !!no_show
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[outings/no-show]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/outings/:code/no-show-policy ──────────────────────────────────
// Host-only: change the outing's no-show policy. Body: { policy: 'dns' |
// 'max_plus_2' | 'manual' }. Validation: only one of the three legal
// values; anything else returns 400.
router.put('/:code/no-show-policy', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { policy } = req.body
    const legal = ['dns', 'max_plus_2', 'manual']
    if (!legal.includes(policy)) {
      return res.status(400).json({ error: `policy must be one of: ${legal.join(', ')}` })
    }
    const outing = await db.one('SELECT id, host_id, state FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })
    const state = { ...(outing.state || {}), no_show_policy: policy }
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
    res.json({ ok: true, no_show_policy: policy })
  } catch (err) {
    console.error('[outings/no-show-policy]', err.message)
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

// ─── PUT /api/outings/:code/stableford-points ────────────────────────────────
// Host-only: replace the outing's Stableford point map with a custom
// one (6.5). Only legal when the outing's scoring_formats includes
// 'stableford' — for everything else the map is irrelevant. Body:
//   { points: { double_eagle, eagle, birdie, par, bogey, double, worse } }
// Each bucket must be a finite number in [-10, 20]. Affects future
// score-driven leaderboard renders only — historical entries in the
// audit log are not retroactively re-scored.
//
// (2026-05-02 — league must-have 6.5.)
router.put('/:code/stableford-points', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { points } = req.body
    const outing = await db.one(
      'SELECT id, host_id, scoring_formats, state FROM tm_outings WHERE code = $1',
      [code]
    )
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })
    const formats = Array.isArray(outing.scoring_formats) ? outing.scoring_formats : []
    if (!formats.includes('stableford'))
      return res.status(400).json({ error: 'Outing is not a Stableford format' })

    if (!points || typeof points !== 'object')
      return res.status(400).json({ error: 'points object required' })
    const buckets = ['double_eagle', 'eagle', 'birdie', 'par', 'bogey', 'double', 'worse']
    const sanitized = {}
    for (const key of buckets) {
      const v = Number(points[key])
      if (!Number.isFinite(v) || v < -10 || v > 20) {
        return res.status(400).json({
          error: `points.${key} must be a number between -10 and 20`,
        })
      }
      sanitized[key] = v
    }

    const state = { ...(outing.state || {}), stableford_points: sanitized }
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
    res.json({ ok: true, stableford_points: sanitized })
  } catch (err) {
    console.error('[outings/stableford-points]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/outings/:code/handicap-override ────────────────────────────────
// Host-only: set or clear a per-event handicap override for a single
// player. Stored in outing.state.handicap_overrides as a flat
// { [user_id]: number } map. The override DOES NOT touch the player's
// stored handicap on tm_users — this is a one-outing adjustment a
// commissioner can apply for league handicap rules, sandbagger
// flags, or guest players who don't have a stored index.
//
// Body: { user_id, handicap }
//   - handicap: a finite number (positive or negative for plus
//     handicaps), or null/empty to clear the override.
//
// Validation: handicap must be in [-10, 54] — covers every realistic
// case (USGA cap is 54.0, lowest plus is around -10 for tour pros).
//
// (2026-05-02 — league must-have 6.4.)
router.put('/:code/handicap-override', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase()
    const { user_id, handicap } = req.body
    if (!user_id) return res.status(400).json({ error: 'user_id required' })

    const outing = await db.one('SELECT id, host_id, state FROM tm_outings WHERE code = $1', [code])
    if (!outing) return res.status(404).json({ error: 'Not found' })
    if (String(outing.host_id) !== String(req.user.id))
      return res.status(403).json({ error: 'Host only' })

    const state = outing.state || { participants: [] }
    const overrides = (state.handicap_overrides && typeof state.handicap_overrides === 'object')
      ? { ...state.handicap_overrides }
      : {}

    if (handicap == null || handicap === '') {
      delete overrides[String(user_id)]
    } else {
      const n = Number(handicap)
      if (!Number.isFinite(n) || n < -10 || n > 54) {
        return res.status(400).json({ error: 'handicap must be a number between -10 and 54' })
      }
      overrides[String(user_id)] = n
    }

    state.handicap_overrides = overrides
    await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(state), outing.id])
    res.json({ ok: true, handicap_overrides: overrides })
  } catch (err) {
    console.error('[outings/handicap-override]', err.message)
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

    // ─ Auto-mark no-shows at end (item 6). Anyone with zero scored
    // holes and not already withdrawn gets no_show=true. The
    // leaderboard render respects state.no_show_policy ('dns' default,
    // 'max_plus_2', or 'manual'). Host can override via POST
    // /:code/no-show. Persisted in state.participants[i].no_show.
    {
      const stateNow = outing.state || { participants: [] }
      const updated = (stateNow.participants || []).map(sp => {
        if (sp.withdrawn || sp.no_show) return sp   // don't touch existing flags
        const dp = dbParticipants.find(r => String(r.user_id) === String(sp.user_id))
        const sc = dp?.scores || sp.scores || []
        const played = Array.isArray(sc) ? sc.filter(s => s > 0).length : 0
        if (played === 0) return { ...sp, no_show: true }
        return sp
      })
      stateNow.participants = updated
      // Default policy if not set, so the leaderboard render has
      // something to read on first end.
      if (!stateNow.no_show_policy) stateNow.no_show_policy = 'dns'
      await db.query('UPDATE tm_outings SET state=$1 WHERE id=$2', [JSON.stringify(stateNow), outing.id])
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
        // Outing identifier + name — needed by EndMatchScreen so it
        // can build the public live URL (now FINAL) and print flyer.
        // (Round 8 audit.)
        code: outing.code,
        name: outing.name,
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
