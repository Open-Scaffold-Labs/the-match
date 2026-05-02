// Asymmetric follow graph (Phase 1 — added 2026-05-01).
//
// All endpoints require auth. The follower is always req.user.id; the
// other party (the user being followed / unfollowed / queried) is
// identified by :userId in the URL.
//
// Mutuals are derived: a row in tm_follows where both (A, B) and (B, A)
// exist. Counted via INNER JOIN against the same table.

const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// ─── POST /api/follows/:userId ────────────────────────────────────────────────
// Start following the given user. Idempotent — re-following is a no-op.
router.post('/:userId', async (req, res) => {
  try {
    const me     = req.user.id
    const target = parseInt(req.params.userId, 10)
    if (!Number.isFinite(target)) return res.status(400).json({ error: 'Bad user id' })
    if (target === me)            return res.status(400).json({ error: "Can't follow yourself" })

    // Verify target exists
    const exists = await db.one(`SELECT id FROM tm_users WHERE id = $1`, [target])
    if (!exists) return res.status(404).json({ error: 'User not found' })

    await db.query(
      `INSERT INTO tm_follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT (follower_id, following_id) DO NOTHING`,
      [me, target]
    )

    res.json({ ok: true, following: true })
  } catch (e) {
    console.error('[follows.post]', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── DELETE /api/follows/:userId ──────────────────────────────────────────────
// Stop following. Idempotent — unfollowing a non-followed user is a no-op.
router.delete('/:userId', async (req, res) => {
  try {
    const me     = req.user.id
    const target = parseInt(req.params.userId, 10)
    if (!Number.isFinite(target)) return res.status(400).json({ error: 'Bad user id' })

    await db.query(
      `DELETE FROM tm_follows WHERE follower_id = $1 AND following_id = $2`,
      [me, target]
    )

    res.json({ ok: true, following: false })
  } catch (e) {
    console.error('[follows.delete]', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /api/follows/counts ──────────────────────────────────────────────────
// Returns { following, followers, mutuals } for the authenticated user.
// Mutuals = users where (me → them) AND (them → me) both exist.
router.get('/counts', async (req, res) => {
  try {
    const me = req.user.id
    const row = await db.one(
      `SELECT
         (SELECT COUNT(*)::int FROM tm_follows WHERE follower_id  = $1) AS following,
         (SELECT COUNT(*)::int FROM tm_follows WHERE following_id = $1) AS followers,
         (SELECT COUNT(*)::int FROM tm_follows a
          JOIN tm_follows b
            ON a.follower_id  = b.following_id
           AND a.following_id = b.follower_id
          WHERE a.follower_id = $1) AS mutuals`,
      [me]
    )
    res.json({
      following: row?.following ?? 0,
      followers: row?.followers ?? 0,
      mutuals:   row?.mutuals   ?? 0,
    })
  } catch (e) {
    console.error('[follows.counts]', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /api/follows/list?type=following|followers|mutuals ──────────────────
// Returns the user list backing a given pill. Each row has the user's id,
// name, handicap, home_course, avatar, plus relationship flags
// (isFollowing / isFollowedBy) so the client can render the right
// follow / unfollow / following-back affordance per row.
router.get('/list', async (req, res) => {
  try {
    const me   = req.user.id
    const type = req.query.type || 'following'
    if (!['following', 'followers', 'mutuals'].includes(type)) {
      return res.status(400).json({ error: 'type must be following, followers, or mutuals' })
    }

    let sql
    if (type === 'following') {
      // Users I follow
      sql = `
        SELECT u.id, u.name, u.handicap, u.home_course, u.avatar,
               TRUE AS is_following,
               EXISTS(SELECT 1 FROM tm_follows b WHERE b.follower_id = u.id AND b.following_id = $1) AS is_followed_by
        FROM tm_follows f
        JOIN tm_users u ON u.id = f.following_id
        WHERE f.follower_id = $1
        ORDER BY u.name`
    } else if (type === 'followers') {
      // Users following me. has_pending_request = I've already sent
      // them a follow-back request that's pending their acceptance.
      // Drives the "Pending" chip on the followers list. (2026-05-02)
      sql = `
        SELECT u.id, u.name, u.handicap, u.home_course, u.avatar,
               EXISTS(SELECT 1 FROM tm_follows b WHERE b.follower_id = $1 AND b.following_id = u.id) AS is_following,
               TRUE AS is_followed_by,
               EXISTS(
                 SELECT 1 FROM tm_friends fr
                 WHERE fr.requester_id = $1 AND fr.requestee_id = u.id AND fr.status = 'pending'
               ) AS has_pending_request
        FROM tm_follows f
        JOIN tm_users u ON u.id = f.follower_id
        WHERE f.following_id = $1
        ORDER BY u.name`
    } else {
      // Mutuals — both directions exist
      sql = `
        SELECT u.id, u.name, u.handicap, u.home_course, u.avatar,
               TRUE AS is_following,
               TRUE AS is_followed_by
        FROM tm_follows a
        JOIN tm_follows b
          ON a.follower_id  = b.following_id
         AND a.following_id = b.follower_id
        JOIN tm_users u ON u.id = a.following_id
        WHERE a.follower_id = $1
        ORDER BY u.name`
    }

    const rows = await db.many(sql, [me])
    res.json({ users: rows })
  } catch (e) {
    console.error('[follows.list]', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /api/follows/:userId/relationship ────────────────────────────────────
// Returns { isFollowing, isFollowedBy } for the given user vs. the
// authenticated user. Useful for FriendProfile / user pages.
router.get('/:userId/relationship', async (req, res) => {
  try {
    const me     = req.user.id
    const target = parseInt(req.params.userId, 10)
    if (!Number.isFinite(target)) return res.status(400).json({ error: 'Bad user id' })

    const row = await db.one(
      `SELECT
         EXISTS(SELECT 1 FROM tm_follows WHERE follower_id = $1 AND following_id = $2) AS is_following,
         EXISTS(SELECT 1 FROM tm_follows WHERE follower_id = $2 AND following_id = $1) AS is_followed_by`,
      [me, target]
    )
    res.json({
      isFollowing:  row?.is_following  ?? false,
      isFollowedBy: row?.is_followed_by ?? false,
    })
  } catch (e) {
    console.error('[follows.relationship]', e)
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
