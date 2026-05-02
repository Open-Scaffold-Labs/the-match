// Leagues — paid-tier (Elite) league surface. All routes require auth +
// the elite tier. Free users get 402 Payment Required so the client can
// render a paywall page.
//
// Routes:
//   GET  /api/leagues                  — leagues this user is a member of
//   POST /api/leagues                  — create a league (caller becomes commissioner)
//   GET  /api/leagues/:id              — league detail (config, member count, event count)
//   PUT  /api/leagues/:id              — commissioner-only: update name/season/config
//   DELETE /api/leagues/:id            — commissioner-only: hard-delete (cascades members + nulls outings.league_id)
//   GET  /api/leagues/:id/standings    — aggregated cross-event standings
//   GET  /api/leagues/:id/events       — outings tagged to this league
//   GET  /api/leagues/:id/members      — roster
//   POST /api/leagues/:id/members      — add member { user_id, role? }
//   DELETE /api/leagues/:id/members/:userId — soft-remove (sets removed_at)
//
// (2026-05-02 — League first-class surface.)

const router        = require('express').Router()
const requireAuth   = require('../middleware/auth')
const requireElite  = require('../middleware/requireElite')
const db            = require('../db')

router.use(requireAuth)
router.use(requireElite)

// ─── GET /api/leagues — leagues I'm a member of ──────────────────────────
router.get('/', async (req, res) => {
  try {
    const rows = await db.many(
      `SELECT l.id, l.name, l.season, l.scoring_format, l.description, l.created_at,
              l.commissioner_id,
              (SELECT COUNT(*) FROM tm_league_members m
                 WHERE m.league_id = l.id AND m.removed_at IS NULL) AS member_count,
              (SELECT COUNT(*) FROM tm_outings o WHERE o.league_id = l.id) AS event_count
       FROM tm_leagues l
       JOIN tm_league_members lm ON lm.league_id = l.id AND lm.removed_at IS NULL
       WHERE lm.user_id = $1
       ORDER BY l.updated_at DESC NULLS LAST, l.id DESC`,
      [req.user.id]
    )
    res.json({ leagues: rows || [] })
  } catch (err) {
    console.error('[leagues/list]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── POST /api/leagues — create ──────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, season, scoring_format, description, config } = req.body
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' })
    }
    if (name.length > 80) {
      return res.status(400).json({ error: 'name must be 80 characters or fewer' })
    }
    const seasonTag = (typeof season === 'string') ? season.trim().slice(0, 64) : null
    const fmt       = (typeof scoring_format === 'string') ? scoring_format.trim().slice(0, 32) : null
    const desc      = (typeof description === 'string') ? description.trim().slice(0, 500) : null
    const cfg       = (config && typeof config === 'object') ? config : {}

    const league = await db.one(
      `INSERT INTO tm_leagues (name, commissioner_id, season, scoring_format, description, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name.trim(), req.user.id, seasonTag, fmt, desc, JSON.stringify(cfg)]
    )
    // Auto-add the commissioner as a member with the 'commissioner' role.
    await db.query(
      `INSERT INTO tm_league_members (league_id, user_id, role)
       VALUES ($1, $2, 'commissioner')
       ON CONFLICT (league_id, user_id) DO NOTHING`,
      [league.id, req.user.id]
    )
    res.json({ league })
  } catch (err) {
    console.error('[leagues/create]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// Helper — ensure the caller is a member (or commissioner) of the league.
async function loadLeagueMembership(leagueId, userId) {
  const league = await db.one('SELECT * FROM tm_leagues WHERE id = $1', [leagueId])
  if (!league) return { league: null, role: null }
  const membership = await db.one(
    `SELECT role FROM tm_league_members
     WHERE league_id = $1 AND user_id = $2 AND removed_at IS NULL`,
    [leagueId, userId]
  )
  const role = String(league.commissioner_id) === String(userId)
    ? 'commissioner'
    : (membership?.role || null)
  return { league, role }
}

// ─── GET /api/leagues/:id — detail ───────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (!role)   return res.status(403).json({ error: 'Not a member of this league' })

    const memberCount = await db.one(
      `SELECT COUNT(*)::int AS n FROM tm_league_members
       WHERE league_id = $1 AND removed_at IS NULL`,
      [league.id]
    )
    const eventCount = await db.one(
      'SELECT COUNT(*)::int AS n FROM tm_outings WHERE league_id = $1',
      [league.id]
    )
    res.json({
      league: { ...league, member_count: memberCount?.n ?? 0, event_count: eventCount?.n ?? 0 },
      role,
    })
  } catch (err) {
    console.error('[leagues/detail]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── PUT /api/leagues/:id — commissioner update ─────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (role !== 'commissioner') return res.status(403).json({ error: 'Commissioner only' })

    const { name, season, scoring_format, description, config } = req.body
    const sets = []
    const params = []
    function add(col, val) { params.push(val); sets.push(`${col} = $${params.length}`) }

    if (typeof name === 'string' && name.trim().length > 0) {
      if (name.length > 80) return res.status(400).json({ error: 'name too long' })
      add('name', name.trim())
    }
    if (season != null) {
      const tag = (typeof season === 'string') ? season.trim().slice(0, 64) : null
      add('season', tag)
    }
    if (scoring_format != null) {
      add('scoring_format', (typeof scoring_format === 'string') ? scoring_format.trim().slice(0, 32) : null)
    }
    if (description != null) {
      add('description', (typeof description === 'string') ? description.trim().slice(0, 500) : null)
    }
    if (config && typeof config === 'object') {
      add('config', JSON.stringify(config))
    }
    if (sets.length === 0) return res.json({ league })

    sets.push('updated_at = NOW()')
    params.push(league.id)
    const updated = await db.one(
      `UPDATE tm_leagues SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    )
    res.json({ league: updated })
  } catch (err) {
    console.error('[leagues/update]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── DELETE /api/leagues/:id — commissioner delete ──────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (role !== 'commissioner') return res.status(403).json({ error: 'Commissioner only' })
    // ON DELETE SET NULL on tm_outings.league_id — events become standalone.
    await db.query('DELETE FROM tm_leagues WHERE id = $1', [league.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[leagues/delete]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/leagues/:id/events — outings under this league ────────────
router.get('/:id/events', async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (!role)   return res.status(403).json({ error: 'Not a member' })

    const events = await db.many(
      `SELECT id, code, name, course_name, course_par, status, scoring_formats,
              created_at, expected_players,
              (state->>'season') AS state_season
       FROM tm_outings
       WHERE league_id = $1
       ORDER BY id DESC`,
      [league.id]
    )
    res.json({ events: events || [] })
  } catch (err) {
    console.error('[leagues/events]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/leagues/:id/standings — cross-event aggregation ───────────
router.get('/:id/standings', async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (!role)   return res.status(403).json({ error: 'Not a member' })

    // Pull every closed/cancelled event for this league. We aggregate
    // per-player from each event's state.participants snapshot — same
    // approach as /season/:tag but scoped to league_id.
    const events = await db.many(
      `SELECT id, name, code, status, state
       FROM tm_outings
       WHERE league_id = $1 AND status IN ('closed', 'cancelled', 'ended')
       ORDER BY id ASC`,
      [league.id]
    )

    const playerMap = new Map()
    for (const ev of (events || [])) {
      const state = ev.state || {}
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
        m.played   += 1
        if (idx === 0) m.wins += 1
        if (idx < 3)   m.top3 += 1
        if (Number(p.total) > 0) {
          m.scoresum   += Number(p.total)
          m.scorecount += 1
        }
      })
    }
    const players = Array.from(playerMap.values())
      .map(m => ({
        ...m,
        avg_score: m.scorecount > 0 ? +(m.scoresum / m.scorecount).toFixed(1) : null,
      }))
      .sort((a, b) => b.wins - a.wins || b.top3 - a.top3 || (a.avg_score ?? 999) - (b.avg_score ?? 999))

    res.json({
      league_id: league.id,
      events_count: events.length,
      players,
    })
  } catch (err) {
    console.error('[leagues/standings]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/leagues/:id/members — roster ──────────────────────────────
router.get('/:id/members', async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (!role)   return res.status(403).json({ error: 'Not a member' })

    const members = await db.many(
      `SELECT lm.user_id, lm.role, lm.joined_at,
              u.name, u.handle, u.handicap, u.avatar
       FROM tm_league_members lm
       LEFT JOIN tm_users u ON u.id = lm.user_id
       WHERE lm.league_id = $1 AND lm.removed_at IS NULL
       ORDER BY lm.role = 'commissioner' DESC, u.name ASC`,
      [league.id]
    )
    res.json({ members: members || [] })
  } catch (err) {
    console.error('[leagues/members]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── POST /api/leagues/:id/members — commissioner adds player ──────────
router.post('/:id/members', async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (role !== 'commissioner') return res.status(403).json({ error: 'Commissioner only' })

    const { user_id, role: newRole } = req.body
    if (!user_id) return res.status(400).json({ error: 'user_id required' })
    const legalRoles = ['player', 'spectator', 'commissioner']
    const r = legalRoles.includes(newRole) ? newRole : 'player'

    // Ensure the user exists
    const u = await db.one('SELECT id FROM tm_users WHERE id = $1', [user_id])
    if (!u) return res.status(404).json({ error: 'User not found' })

    await db.query(
      `INSERT INTO tm_league_members (league_id, user_id, role, removed_at)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (league_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, removed_at = NULL`,
      [league.id, user_id, r]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[leagues/members/add]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── DELETE /api/leagues/:id/members/:userId — soft-remove ─────────────
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    const targetId = req.params.userId
    // Commissioner can remove anyone; non-commissioner can only remove themselves.
    if (role !== 'commissioner' && String(targetId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Commissioner only' })
    }
    // Don't allow removing the commissioner themselves.
    if (String(targetId) === String(league.commissioner_id)) {
      return res.status(400).json({
        error: 'Cannot remove the commissioner. Transfer the league first or delete it.',
      })
    }
    await db.query(
      `UPDATE tm_league_members SET removed_at = NOW()
       WHERE league_id = $1 AND user_id = $2`,
      [league.id, targetId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[leagues/members/remove]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
