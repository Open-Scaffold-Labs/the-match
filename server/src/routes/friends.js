const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')
const { isRoundCompleted, computeHandicapFromRounds } = require('../lib/handicap')
const { sendPushToUser } = require('../lib/push')

router.use(requireAuth)

// ── Season helpers ────────────────────────────────────────────────────────────
function currentSeasonYear() {
  const now = new Date()
  return now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
}
function seasonStart(year) { return new Date(year, 4, 1) }

// GET /api/friends — accepted friends + pending incoming requests + activity
router.get('/', async (req, res) => {
  try {
    const uid = req.user.id

    const [friends, incoming, outgoing, activity] = await Promise.all([
      db.many(
        `SELECT f.id, f.created_at,
                CASE WHEN f.requester_id = $1 THEN u2.id ELSE u1.id END AS friend_id,
                CASE WHEN f.requester_id = $1 THEN u2.name ELSE u1.name END AS friend_name,
                CASE WHEN f.requester_id = $1 THEN u2.handle ELSE u1.handle END AS friend_handle,
                CASE WHEN f.requester_id = $1 THEN u2.home_course ELSE u1.home_course END AS friend_home_course,
                CASE WHEN f.requester_id = $1 THEN u2.handicap ELSE u1.handicap END AS friend_handicap
         FROM tm_friends f
         JOIN tm_users u1 ON u1.id = f.requester_id
         JOIN tm_users u2 ON u2.id = f.requestee_id
         WHERE (f.requester_id = $1 OR f.requestee_id = $1) AND f.status = 'accepted'
         ORDER BY friend_name`,
        [uid]
      ),
      db.many(
        `SELECT f.id, f.created_at, u.id AS requester_id, u.name AS requester_name, u.handicap AS requester_handicap
         FROM tm_friends f
         JOIN tm_users u ON u.id = f.requester_id
         WHERE f.requestee_id = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC`,
        [uid]
      ),
      // Outgoing pending requests FROM me
      db.many(
        `SELECT f.id, f.created_at, u.id AS requestee_id, u.name AS requestee_name, u.handicap AS requestee_handicap
         FROM tm_friends f
         JOIN tm_users u ON u.id = f.requestee_id
         WHERE f.requester_id = $1 AND f.status = 'pending'
         ORDER BY f.created_at DESC`,
        [uid]
      ),
      db.many(
        `SELECT DISTINCT ON (r.user_id)
                r.user_id, u.name, r.total, r.course_name, r.date,
                r.course_par,
                r.total - COALESCE(r.course_par, 72) AS diff
         FROM tm_rounds r
         JOIN tm_users u ON u.id = r.user_id
         WHERE r.user_id IN (
           SELECT CASE WHEN requester_id = $1 THEN requestee_id ELSE requester_id END
           FROM tm_friends
           WHERE (requester_id = $1 OR requestee_id = $1) AND status = 'accepted'
         )
         ORDER BY r.user_id, r.date DESC`,
        [uid]
      ),
    ])

    res.json({ friends, incoming, outgoing, activity })
  } catch (err) {
    console.error('[friends]', err.message)
    res.status(500).json({ error: 'Failed to load friends' })
  }
})

// GET /api/friends/:friendId/profile — full friend profile + H2H + availability
router.get('/:friendId/profile', async (req, res) => {
  try {
    const uid      = req.user.id
    const friendId = req.params.friendId
    const year     = currentSeasonYear()
    const start    = seasonStart(year)

    // Find the friendship row in any state — accepted means full
    // access, anything else (or nothing) means we return a LIMITED
    // shape so search-and-tap from UserSearchModal can preview a
    // stranger's basic info instead of a hard 403.
    // (2026-05-01 — Matt: tap-to-view from search shouldn't dead-end.)
    const link = await db.one(
      `SELECT id, status, requester_id, requestee_id FROM tm_friends
       WHERE ((requester_id = $1 AND requestee_id = $2) OR (requester_id = $2 AND requestee_id = $1))`,
      [uid, friendId]
    )
    const isAccepted = link && link.status === 'accepted'

    if (!isAccepted) {
      // Limited preview — basic public info + empty arrays for the
      // friendship-gated sections. Client renders an Add-Friend
      // banner using `limited` + `friendStatus`.
      const friend = await db.one(
        `SELECT id, name, handle, handicap, home_course, bio, avatar FROM tm_users WHERE id = $1`,
        [friendId]
      )
      if (!friend) return res.status(404).json({ error: 'User not found' })

      let friendStatus = 'none'  // 'none' | 'pending_outgoing' | 'pending_incoming' | 'declined'
      if (link) {
        if (link.status === 'pending') {
          friendStatus = String(link.requester_id) === String(uid) ? 'pending_outgoing' : 'pending_incoming'
        } else if (link.status === 'declined') {
          friendStatus = 'declined'
        }
      }

      return res.json({
        friend,
        limited: true,
        friendStatus,
        season: { wins: 0, losses: 0, ties: 0 },
        rounds: [],
        rivalries: [],
        h2h: null,
        availability: [],
        followCounts: { following: 0, followers: 0 },
        clubs: {},
      })
    }

    // Big batch — same data shape as ProfileView consumes for "My Profile"
    // so the FriendProfile UI can mirror it exactly. Anything specific to
    // the viewer↔friend relationship (h2h, availability) is computed at
    // the bottom of this batch.
    const [friend, seasonRows, allRoundRows, clubData, h2hRow, availability, followCounts, rivalryRows] = await Promise.all([
      // Friend's profile + avatar
      db.one(
        `SELECT id, name, handle, handicap, home_course, bio, avatar FROM tm_users WHERE id = $1`,
        [friendId]
      ),

      // Friend's season W/L/T
      db.many(
        `SELECT winner_id, loser_id, is_tie
         FROM tm_match_history
         WHERE (winner_id = $1 OR loser_id = $1) AND played_at >= $2`,
        [friendId, start]
      ),

      // Friend's last 20 rounds (full shape — Profile view uses this for
      // the trend chart, Recent Rounds list, and Avg/Best calc).
      db.many(
        `SELECT r.id, r.course_name, r.course_par, r.course_rating, r.slope_rating,
                r.total, r.date, r.scores, r.outing_id, r.game_type
         FROM tm_rounds r
         WHERE r.user_id = $1
         ORDER BY r.date DESC LIMIT 20`,
        [friendId]
      ),

      // Friend's club data for the Distances card
      db.one('SELECT club_data FROM tm_club_stats WHERE user_id = $1', [friendId]),

      // H2H record between viewer and this friend
      db.one(
        `SELECT
           CASE WHEN player_a_id = $1 THEN a_wins ELSE b_wins END AS my_wins,
           CASE WHEN player_a_id = $1 THEN b_wins ELSE a_wins END AS their_wins,
           ties
         FROM tm_h2h_records
         WHERE (player_a_id = $1 AND player_b_id = $2)
            OR (player_a_id = $2 AND player_b_id = $1)`,
        [uid, friendId]
      ),

      // Friend's upcoming availability (next 14 days)
      db.many(
        `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, note FROM tm_availability
         WHERE user_id = $1 AND date >= CURRENT_DATE AND date <= CURRENT_DATE + 14
         ORDER BY date`,
        [friendId]
      ),

      // Friend's own follow counts (following / followers). Mutuals
      // dropped 2026-05-02 — Matt: "no reason for it." Mutual status
      // for individual rows is still surfaced on the Followers list
      // via is_following + is_followed_by flags.
      db.one(
        `SELECT
           (SELECT COUNT(*)::int FROM tm_follows WHERE follower_id  = $1) AS following,
           (SELECT COUNT(*)::int FROM tm_follows WHERE following_id = $1) AS followers`,
        [friendId]
      ),

      // Friend's top rivalries (mirrors /api/outings/my-rivalries shape)
      db.many(
        `WITH shared AS (
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
         LIMIT 5`,
        [friendId]
      ),
    ])

    // Season stats
    let wins = 0, losses = 0, ties = 0
    for (const r of seasonRows) {
      if (r.is_tie) { ties++; continue }
      if (String(r.winner_id) === String(friendId)) wins++
      else losses++
    }

    // 3-round average — uses the friend's last 3 rounds
    const lastThree = allRoundRows.slice(0, 3)
    const avg3 = lastThree.length
      ? parseFloat((lastThree.reduce((s, r) => s + Number(r.total || 0), 0) / lastThree.length).toFixed(1))
      : null

    // Stats summary (mirrors /api/stats/summary shape) — handicap from
    // completed rounds only (5+ threshold), avg/best score across all 20,
    // top 5 clubs by avg distance.
    const completed   = allRoundRows.filter(isRoundCompleted)
    const calcHcp     = completed.length >= 5 ? computeHandicapFromRounds(completed) : null
    const totals      = allRoundRows.map(r => Number(r.total)).filter(Number.isFinite)
    const avgScore    = totals.length ? parseFloat((totals.reduce((s, t) => s + t, 0) / totals.length).toFixed(1)) : null
    const bestScore   = totals.length ? Math.min(...totals) : null
    const clubObj     = clubData?.club_data ?? {}
    const topClubs = Object.entries(clubObj)
      .map(([club, dists]) => ({
        club,
        avgYards: Math.round(dists.reduce((s, d) => s + d, 0) / dists.length),
        shots: dists.length,
      }))
      .sort((a, b) => b.avgYards - a.avgYards)
      .slice(0, 5)

    // Map rounds for the Profile-style consumer (snake_case + score
    // alias for compatibility with the same renderer the My Profile view uses).
    const recentRounds = allRoundRows.map(r => ({
      id:          r.id,
      course_name: r.course_name,
      course_par:  r.course_par,
      score:       r.total,
      total:       r.total,
      played_at:   r.date,
      date:        r.date,
      holes:       Array.isArray(r.scores) ? r.scores.length : null,
      game_type:   r.game_type,
      outing_id:   r.outing_id,
    }))

    res.json({
      friend,
      season: { year, wins, losses, ties },
      avg3,
      recentRounds,
      stats: {
        handicap:   calcHcp,
        avgScore,
        bestScore,
        topClubs,
        roundCount: allRoundRows.length,
      },
      followCounts: followCounts ?? { following: 0, followers: 0 },
      rivalries:    rivalryRows ?? [],
      h2h:          h2hRow ?? { my_wins: 0, their_wins: 0, ties: 0 },
      availability,
    })
  } catch (err) {
    console.error('[friends/profile]', err.message)
    res.status(500).json({ error: 'Failed to load friend profile' })
  }
})


// GET /api/friends/search?q= — find players by name, email, or handle
// (excludes self; results carry friend_status so the UI can render
// the right pill). Strips a leading '@' from the query so users can
// type '@mlav' or 'mlav' interchangeably.
router.get('/search', async (req, res) => {
  try {
    const raw = (req.query.q ?? '').toString().trim()
    const cleaned = raw.startsWith('@') ? raw.slice(1) : raw
    if (!cleaned || cleaned.length < 2) return res.json([])
    const uid = req.user.id
    const term = `%${cleaned.toLowerCase()}%`

    // Handles are already stored lowercase per the CHECK constraint,
    // so the lowercased LIKE term works directly against u.handle.
    const results = await db.many(
      `SELECT u.id, u.name, u.email, u.handle, u.handicap, u.home_course,
              f.status AS friend_status
       FROM tm_users u
       LEFT JOIN tm_friends f
         ON (f.requester_id = u.id AND f.requestee_id = $1)
         OR (f.requestee_id = u.id AND f.requester_id = $1)
       WHERE u.id != $1
         AND (LOWER(u.name) LIKE $2 OR LOWER(u.email) LIKE $2 OR u.handle LIKE $2)
       ORDER BY u.name
       LIMIT 10`,
      [uid, term]
    )
    // Round 25 audit fix — strip email from results for non-friends.
    // The search WHERE clause still matches against email so 'email
    // address lookup' works (you can find a friend by typing their
    // email), but the response only INCLUDES email when the user is
    // already a friend (or has a pending request). Prevents PII leak
    // through bulk-scrape via repeated searches.
    const sanitized = (results || []).map(u => ({
      ...u,
      email: u.friend_status === 'accepted' ? u.email : null,
    }))
    res.json(sanitized)
  } catch (err) {
    console.error('[friends/search]', err.message)
    res.status(500).json({ error: 'Search failed' })
  }
})

// POST /api/friends/request — send friend request by email OR user_id.
// Email path is the legacy invite-by-typing-an-email flow. user_id is
// the new search → tap-to-add flow (we already know who they are).
router.post('/request', async (req, res) => {
  try {
    const { email, user_id } = req.body
    if (!email && !user_id) return res.status(400).json({ error: 'Email or user_id required' })

    const target = user_id
      ? await db.one('SELECT id, name FROM tm_users WHERE id = $1', [user_id])
      : await db.one('SELECT id, name FROM tm_users WHERE email = $1', [String(email).toLowerCase()])
    if (!target) return res.status(404).json({ error: 'No player found' })
    if (String(target.id) === String(req.user.id)) return res.status(400).json({ error: "Can't add yourself" })

    // Only block requests in the SAME direction. A→B being accepted
    // does NOT block B→A — that's the follow-back path. (2026-05-02
    // — Matt's asymmetric model: accept = one-way, mutual requires
    // each side to send + accept their own request.)
    const existing = await db.one(
      `SELECT id, status FROM tm_friends
       WHERE requester_id = $1 AND requestee_id = $2`,
      [req.user.id, target.id]
    )
    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ error: 'Already requested' })
      if (existing.status === 'pending')  return res.status(409).json({ error: 'Request already pending' })
    }

    await db.query(
      `INSERT INTO tm_friends (requester_id, requestee_id) VALUES ($1, $2)`,
      [req.user.id, target.id]
    )

    // No tm_follows insert here — sending a request is a REQUEST, not
    // a follow. Both follow rows get inserted in the accept handler.
    // (2026-05-02 — Matt: pending requests shouldn't appear in either
    // user's following list before acceptance.)

    // Fire-and-forget push to the recipient. Don't await it — the
    // request response shouldn't wait on push provider latency, and a
    // push failure shouldn't fail the friend-request creation.
    sendPushToUser(target.id, {
      title: 'New friend request',
      body: `${req.user.name || 'Someone'} wants to be friends`,
      url: '/?notifs=open',
      tag: 'friend-request',
    }).catch(err => console.error('[push] friend-request', err.message))

    res.status(201).json({ ok: true, name: target.name })
  } catch (err) {
    console.error('[friends/request]', err.message)
    res.status(500).json({ error: 'Failed to send request' })
  }
})

// PUT /api/friends/:id/respond — accept or decline
router.put('/:id/respond', async (req, res) => {
  try {
    const { status } = req.body
    if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: 'Invalid status' })
    // Pull requester_id back so we can push them on accept.
    const row = await db.one(
      `UPDATE tm_friends SET status = $1, updated_at = NOW()
       WHERE id = $2 AND requestee_id = $3 RETURNING id, requester_id`,
      [status, req.params.id, req.user.id]
    )
    if (!row) return res.status(404).json({ error: 'Request not found' })

    // Mirror into tm_follows. ACCEPT creates ONE direction:
    // requester → requestee. The requestee was approached and said
    // yes; the requester now follows them. Mutual requires the
    // requestee to follow back (send their own request, get accepted)
    // — not auto-created. (2026-05-02 — Matt: "in order for it to
    // be mutual they would then have to follow back")
    if (status === 'accepted') {
      await db.query(
        `INSERT INTO tm_follows (follower_id, following_id) VALUES ($1, $2)
         ON CONFLICT (follower_id, following_id) DO NOTHING`,
        [row.requester_id, req.user.id]
      )

      // Tell the original requester their request was accepted.
      sendPushToUser(row.requester_id, {
        title: 'Friend request accepted',
        body: `${req.user.name || 'They'} accepted your friend request`,
        url: '/',
        tag: 'friend-accepted',
      }).catch(err => console.error('[push] friend-accepted', err.message))
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[friends/respond]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// DELETE /api/friends/:id — remove friend
router.delete('/:id', async (req, res) => {
  try {
    // Look up the row first so we know both user ids — needed to clean
    // up tm_follows in both directions.
    const row = await db.one(
      `SELECT requester_id, requestee_id FROM tm_friends WHERE id = $1
       AND (requester_id = $2 OR requestee_id = $2)`,
      [req.params.id, req.user.id]
    )
    await db.query(
      `DELETE FROM tm_friends WHERE id = $1 AND (requester_id = $2 OR requestee_id = $2)`,
      [req.params.id, req.user.id]
    )
    // Tear down both follow directions so the counts shrink in sync.
    if (row) {
      await db.query(
        `DELETE FROM tm_follows
         WHERE (follower_id = $1 AND following_id = $2)
            OR (follower_id = $2 AND following_id = $1)`,
        [row.requester_id, row.requestee_id]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
