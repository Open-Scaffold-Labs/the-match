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

// Round 7 audit fix — DON'T gate every route behind requireElite.
// Free-tier players added to a paying commissioner's league must
// still be able to view standings, events, roster, and announcements.
// That's the whole GTM lever: commissioner pays once, brings 16
// players for free, those players become exposed to Elite via the
// product. Only CREATE league + commissioner-only actions require
// Elite tier. Read-only routes are auth + membership.
//
// Routes gated by Elite explicitly call requireElite below.

// Round 3 audit fix — whitelist scoring formats. Without this any 32-char
// string was accepted into tm_leagues.scoring_format and would later
// flow into the wizard pre-fill, leaving the format selector in an
// unknown state. Source of truth matches FORMATS in client wizard.
const LEGAL_FORMATS = ['stroke', 'match', 'skins', 'stableford', 'best_ball']
function sanitizeFormat(v) {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return LEGAL_FORMATS.includes(trimmed) ? trimmed : null
}

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

// ─── POST /api/leagues — create (Elite only) ────────────────────────────
router.post('/', requireElite, async (req, res) => {
  try {
    const { name, season, scoring_format, description, config } = req.body
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' })
    }
    if (name.length > 80) {
      return res.status(400).json({ error: 'name must be 80 characters or fewer' })
    }
    const seasonTag = (typeof season === 'string') ? season.trim().slice(0, 64) : null
    const fmt       = sanitizeFormat(scoring_format)
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

// ─── PUT /api/leagues/:id — commissioner update (Elite only) ───────────
router.put('/:id', requireElite, async (req, res) => {
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
      const fmt = sanitizeFormat(scoring_format)
      if (fmt == null && scoring_format !== '') {
        return res.status(400).json({ error: `scoring_format must be one of: ${LEGAL_FORMATS.join(', ')}` })
      }
      add('scoring_format', fmt)
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

// ─── DELETE /api/leagues/:id — commissioner delete (Elite only) ────────
router.delete('/:id', requireElite, async (req, res) => {
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
      `SELECT id, name, code, status, state, scoring_formats, course_par, hole_pars
       FROM tm_outings
       WHERE league_id = $1 AND status IN ('closed', 'cancelled', 'ended')
       ORDER BY id ASC`,
      [league.id]
    )

    // Round 6 audit fix — format-aware event winner computation.
    // Skins league: winner = player with most skins. Stableford: most
    // points. Stroke / match / best_ball / unknown: lowest gross total.
    // Without this, a Tuesday Night Skins commissioner's standings
    // would rank by gross-stroke (wrong winner). Inlined here so the
    // client doesn't need to recompute per-event ranking.
    function holeParsFor(ev) {
      const real = Array.isArray(ev.hole_pars) ? ev.hole_pars : null
      const state = ev.state || {}
      const holes = state.holes ?? 18
      if (real && real.length >= holes) return real.slice(0, holes)
      const cp = ev.course_par ?? 72
      const base = Math.floor(cp / holes), extra = cp - base * holes
      return Array.from({ length: holes }, (_, i) => i < extra ? base + 1 : base)
    }
    function rankParticipants(ev, parts) {
      const formats = Array.isArray(ev.scoring_formats) ? ev.scoring_formats : []
      const isSkins      = formats.includes('skins')
      const isStableford = formats.includes('stableford')
      const holePars     = holeParsFor(ev)

      // Skins: 1 point per hole low-tied-only, ties carry forward.
      function computeSkins() {
        const skinsByPlayer = {}
        let carry = 0
        for (let h = 0; h < holePars.length; h++) {
          const entries = parts
            .map(p => ({ id: p.user_id, s: (p.scores || [])[h] || 0 }))
            .filter(x => x.s > 0)
          if (entries.length < 2) continue
          let low = Infinity, lowCount = 0, lowId = null
          for (const e of entries) {
            if (e.s < low)        { low = e.s; lowCount = 1; lowId = e.id }
            else if (e.s === low) { lowCount += 1 }
          }
          if (lowCount === 1) {
            skinsByPlayer[lowId] = (skinsByPlayer[lowId] || 0) + (1 + carry)
            carry = 0
          } else { carry += 1 }
        }
        return skinsByPlayer
      }
      // Stableford with the standard preset; honors any custom map
      // stored on state.stableford_points.
      function computeStableford() {
        const pts = (ev.state && ev.state.stableford_points) || {
          double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1,
        }
        const out = {}
        for (const p of parts) {
          let total = 0
          const sc = p.scores || []
          for (let h = 0; h < holePars.length; h++) {
            const s = sc[h] || 0
            if (s <= 0) continue
            const diff = s - (holePars[h] || 4)
            const bucket = diff <= -3 ? 'double_eagle'
              : diff === -2 ? 'eagle'
              : diff === -1 ? 'birdie'
              : diff === 0  ? 'par'
              : diff === 1  ? 'bogey'
              : diff === 2  ? 'double'
              : 'worse'
            total += (pts[bucket] ?? 0)
          }
          out[p.user_id] = total
        }
        return out
      }
      if (isSkins) {
        const s = computeSkins()
        return [...parts].sort((a, b) => (s[b.user_id] || 0) - (s[a.user_id] || 0))
      }
      if (isStableford) {
        const p = computeStableford()
        return [...parts].sort((a, b) => (p[b.user_id] || 0) - (p[a.user_id] || 0))
      }
      // Stroke / match / best_ball / unknown — lowest gross wins.
      return [...parts].sort((a, b) => (a.total ?? 9_999_999) - (b.total ?? 9_999_999))
    }

    const playerMap = new Map()
    for (const ev of (events || [])) {
      const state = ev.state || {}
      const parts = (state.participants || []).filter(p => !p.withdrawn && !p.no_show)
      const sorted = rankParticipants(ev, parts)
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

// ─── POST /api/leagues/:id/members — commissioner adds player (Elite) ─
router.post('/:id/members', requireElite, async (req, res) => {
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
// NOT Elite-gated — a free-tier member must be able to remove THEMSELVES.
// Commissioner restrictions still apply via membership check inside.
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

// ─── POST /api/leagues/:id/announcement — push to every member (Elite) ─
// Distinct from the per-event /:code/announcement (which only fans out to
// one event's participants). This one targets the entire league roster.
// Stored on league.config.announcements[] (capped at 50 most-recent).
router.post('/:id/announcement', requireElite, async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (role !== 'commissioner') return res.status(403).json({ error: 'Commissioner only' })

    const { text } = req.body
    if (typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'text required' })
    }
    if (text.length > 600) return res.status(400).json({ error: 'too long (600 char max)' })

    const author = await db.one('SELECT name FROM tm_users WHERE id = $1', [req.user.id])
    const announcement = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim(),
      posted_by_id: req.user.id,
      posted_by_name: author?.name || 'Commissioner',
      posted_at: new Date().toISOString(),
    }
    const cfg = (league.config && typeof league.config === 'object') ? league.config : {}
    const list = Array.isArray(cfg.announcements) ? cfg.announcements : []
    const next = [announcement, ...list].slice(0, 50)
    cfg.announcements = next

    await db.query(
      'UPDATE tm_leagues SET config = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(cfg), league.id]
    )

    // Push fan-out to every active league member except the sender.
    try {
      const { sendPushToUser } = require('../lib/push')
      const members = await db.many(
        `SELECT user_id FROM tm_league_members
         WHERE league_id = $1 AND removed_at IS NULL AND user_id <> $2`,
        [league.id, req.user.id]
      )
      for (const m of (members || [])) {
        sendPushToUser(m.user_id, {
          title: `${league.name} · Commissioner`,
          body: announcement.text.slice(0, 180),
          url: `/?league=${league.id}`,
          tag: `league-announcement-${league.id}`,
        })
      }
    } catch (err) {
      console.error('[leagues/announcement] push fan-out failed', err.message)
    }

    res.json({ ok: true, announcement, announcements: next })
  } catch (err) {
    console.error('[leagues/announcement]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/leagues/:id/audit — cross-event audit (Elite commish) ────
// Aggregates tm_score_audit entries across every event in the league,
// ordered newest first. Cursor pagination matches the per-event endpoint.
// Commissioner-only — audit content reveals score corrections that the
// roster shouldn't see.
router.get('/:id/audit', requireElite, async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (role !== 'commissioner') return res.status(403).json({ error: 'Commissioner only' })

    const rawLimit = Number(req.query.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(200, Math.max(1, Math.round(rawLimit))) : 100

    let cursorClause = ''
    const params = [league.id]
    if (typeof req.query.cursor === 'string' && req.query.cursor.length > 0) {
      const [ts, idRaw] = req.query.cursor.split('|')
      const id = Number(idRaw)
      const tsDate = new Date(ts)
      if (Number.isFinite(id) && !Number.isNaN(tsDate.getTime())) {
        params.push(tsDate.toISOString(), id)
        cursorClause = ` AND (a.created_at < $${params.length - 1}
                              OR (a.created_at = $${params.length - 1} AND a.id < $${params.length}))`
      }
    }
    params.push(limit + 1)
    const rows = await db.many(
      `SELECT a.id, a.outing_id, a.user_id, a.hole, a.old_score, a.new_score, a.created_at,
              a.edited_by_id, u.name AS edited_by_name,
              o.name AS outing_name, o.code AS outing_code
       FROM tm_score_audit a
       LEFT JOIN tm_users   u ON u.id = a.edited_by_id
       LEFT JOIN tm_outings o ON o.id = a.outing_id
       WHERE o.league_id = $1${cursorClause}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length}`,
      params
    )
    const all = rows || []
    let nextCursor = null
    let entries = all
    if (all.length > limit) {
      entries = all.slice(0, limit)
      const last = entries[entries.length - 1]
      nextCursor = `${new Date(last.created_at).toISOString()}|${last.id}`
    }
    res.json({ entries, next_cursor: nextCursor })
  } catch (err) {
    console.error('[leagues/audit]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// ─── GET /api/leagues/:id/export.csv — bundled season CSV (Elite) ──────
// Concatenates every event's results into one CSV with an extra
// 'Event' column so the commissioner can pivot/filter externally.
// Same formula-injection guards as the per-event export.
router.get('/:id/export.csv', requireElite, async (req, res) => {
  try {
    const { league, role } = await loadLeagueMembership(req.params.id, req.user.id)
    if (!league) return res.status(404).json({ error: 'Not found' })
    if (role !== 'commissioner') return res.status(403).json({ error: 'Commissioner only' })

    const events = await db.many(
      `SELECT id, code, name, course_name, course_par, hole_pars, scoring_formats, status, state
       FROM tm_outings
       WHERE league_id = $1
       ORDER BY id ASC`,
      [league.id]
    )

    // Round 5 audit fix — pull live scores from tm_outing_participants,
    // not from the state.participants JSONB cache. Cache lags behind
    // commissioner score edits in tm_outing_participants until the next
    // refresh; the per-event CSV was fixed in a prior round but the
    // league CSV still read stale state. Single bulk query keyed by
    // outing_id, then attach to each event below.
    const outingIds = events.map(e => e.id)
    const liveByOuting = new Map()
    if (outingIds.length > 0) {
      const liveRows = await db.many(
        `SELECT op.outing_id, op.user_id, op.scores, u.name, u.handle
         FROM tm_outing_participants op
         LEFT JOIN tm_users u ON u.id = op.user_id
         WHERE op.outing_id = ANY($1::int[])`,
        [outingIds]
      )
      for (const r of (liveRows || [])) {
        if (!liveByOuting.has(r.outing_id)) liveByOuting.set(r.outing_id, [])
        liveByOuting.get(r.outing_id).push(r)
      }
    }

    function csvEscape(v) {
      if (v == null) return ''
      let s = String(v)
      if (/^[=+\-@]/.test(s)) s = "'" + s
      if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
      return s
    }

    const lines = []
    lines.push(`# League: ${csvEscape(league.name)}`)
    lines.push(`# Season: ${csvEscape(league.season || '—')}`)
    lines.push(`# Events: ${events.length}`)
    lines.push(`# Exported: ${new Date().toISOString()}`)
    lines.push('')
    lines.push(['Event', 'Code', 'Course', 'Position', 'Player', 'Total', 'Front', 'Back', 'Status'].map(csvEscape).join(','))

    for (const ev of (events || [])) {
      const state = ev.state || {}
      const live  = liveByOuting.get(ev.id) || []
      const sorted = (state.participants || [])
        .filter(p => !p.withdrawn)
        .map(p => {
          // Live scores from tm_outing_participants take precedence
          // over state.participants[i].scores (the JSONB cache).
          // Guests have no live row; fall back to state. (Round 5 audit.)
          const dp = live.find(r => String(r.user_id) === String(p.user_id))
          const sc = Array.isArray(dp?.scores) ? dp.scores
            : (Array.isArray(p.scores) ? p.scores : [])
          const total = sc.reduce((s, v) => s + (Number(v) || 0), 0)
          return {
            ...p,
            name: dp?.name || p.name,
            handle: dp?.handle || p.handle,
            _total: total,
            _front: sc.slice(0, 9).reduce((s, v) => s + (v || 0), 0),
            _back:  sc.slice(9, 18).reduce((s, v) => s + (v || 0), 0),
            _status: p.no_show ? 'NoShow' : (total > 0 ? 'Active' : 'Inactive'),
            _sortKey: p.no_show ? 9_999_999 : (total > 0 ? total : 9_999_998),
          }
        })
        .sort((a, b) => a._sortKey - b._sortKey)
      sorted.forEach((p, i) => {
        lines.push([
          ev.name || `Event ${ev.id}`,
          ev.code || '',
          ev.course_name || '',
          String(i + 1),
          p.name || `Player ${p.user_id}`,
          p._total > 0 ? String(p._total) : '',
          p._front > 0 ? String(p._front) : '',
          p._back  > 0 ? String(p._back)  : '',
          p._status,
        ].map(csvEscape).join(','))
      })
    }

    const filename = `league-${league.id}-${(league.name || 'export').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(lines.join('\r\n') + '\r\n')
  } catch (err) {
    console.error('[leagues/export]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
