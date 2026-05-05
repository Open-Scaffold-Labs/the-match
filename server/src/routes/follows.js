// Asymmetric follow graph (Phase 1 — added 2026-05-01).
//
// All endpoints require auth. The follower is always req.user.id; the
// other party (the user being followed / unfollowed / queried) is
// identified by :userId in the URL.
//
// Mutuals (rows where both (A, B) and (B, A) exist) used to be a
// separate count + list. Removed as a top-level surface 2026-05-02
// (Matt: "no reason for it"). The schema still supports it; the
// followers list still surfaces per-row mutual status via the
// is_followed_by + is_following flags, which the UI renders as a
// "Mutual ✓" badge.

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
    // 2026-05-04 hotfix — req.user.id is a STRING (pg returns BIGINT as
    // string); target is a NUMBER from parseInt. The previous strict-eq
    // check NEVER fired, letting users self-follow. Compare as strings.
    if (String(target) === String(me)) return res.status(400).json({ error: "Can't follow yourself" })

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
// Returns { following, followers } for the authenticated user.
router.get('/counts', async (req, res) => {
  try {
    const me = req.user.id
    const row = await db.one(
      `SELECT
         (SELECT COUNT(*)::int FROM tm_follows WHERE follower_id  = $1) AS following,
         (SELECT COUNT(*)::int FROM tm_follows WHERE following_id = $1) AS followers`,
      [me]
    )
    res.json({
      following: row?.following ?? 0,
      followers: row?.followers ?? 0,
    })
  } catch (e) {
    console.error('[follows.counts]', e)
    res.status(500).json({ error: e.message })
  }
})

// ─── GET /api/follows/list?type=following|followers ──────────────────────────
// Returns the user list backing a given pill. Each row has the user's id,
// name, handicap, home_course, avatar, plus relationship flags
// (isFollowing / isFollowedBy) so the client can render the right
// follow / unfollow / following-back affordance per row.
router.get('/list', async (req, res) => {
  try {
    // 2026-05-04 — add ?userId to view ANOTHER user's list (e.g. tapping
    // Followers on a friend's profile). When omitted, defaults to the
    // authed user's own list (existing behavior, no breakage).
    //
    // Two distinct user_ids are now in play:
    //   subject = whose list is being viewed (defaults to me)
    //   me      = the viewer; the relationship flags (is_following,
    //             is_followed_by, has_pending_request) are always from
    //             the VIEWER's perspective so the buttons render right.
    const me      = req.user.id
    const subject = req.query.userId ? parseInt(req.query.userId, 10) : me
    if (req.query.userId && !Number.isFinite(subject)) {
      return res.status(400).json({ error: 'Bad userId' })
    }
    const type = req.query.type || 'following'
    if (!['following', 'followers'].includes(type)) {
      return res.status(400).json({ error: 'type must be following or followers' })
    }

    let sql
    if (type === 'following') {
      // Users that 'subject' follows. is_following / is_followed_by are
      // computed from the VIEWER's POV (me), not subject's, so the per-row
      // affordance (Mutual badge / Follow back / Pending) renders right
      // when viewing someone else's list. is_self flags the row that IS
      // the viewer — client renders a "You" badge there instead of any
      // action button (you can't unfollow yourself, follow yourself, etc).
      sql = `
        SELECT u.id, u.name, u.handicap, u.home_course, u.avatar,
               (u.id = $2) AS is_self,
               EXISTS(SELECT 1 FROM tm_follows b WHERE b.follower_id = $2 AND b.following_id = u.id) AS is_following,
               EXISTS(SELECT 1 FROM tm_follows b WHERE b.follower_id = u.id AND b.following_id = $2) AS is_followed_by
        FROM tm_follows f
        JOIN tm_users u ON u.id = f.following_id
        WHERE f.follower_id = $1
        ORDER BY u.name`
    } else {
      // followers — Users following 'subject'. has_pending_request is
      // viewer-vs-u (the "Pending" chip is about whether *I* have a
      // pending follow-back to that user, regardless of whose list this is).
      // is_self: same purpose as in the following branch.
      sql = `
        SELECT u.id, u.name, u.handicap, u.home_course, u.avatar,
               (u.id = $2) AS is_self,
               EXISTS(SELECT 1 FROM tm_follows b WHERE b.follower_id = $2 AND b.following_id = u.id) AS is_following,
               EXISTS(SELECT 1 FROM tm_follows b WHERE b.follower_id = u.id AND b.following_id = $2) AS is_followed_by,
               EXISTS(
                 SELECT 1 FROM tm_friends fr
                 WHERE fr.requester_id = $2 AND fr.requestee_id = u.id AND fr.status = 'pending'
               ) AS has_pending_request
        FROM tm_follows f
        JOIN tm_users u ON u.id = f.follower_id
        WHERE f.following_id = $1
        ORDER BY u.name`
    }

    const rows = await db.many(sql, [subject, me])
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
