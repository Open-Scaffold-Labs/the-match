// /api/admin — admin-only endpoints. Gated on tm_users.role = 'admin'.
// (2026-05-01 — Matt: see new accounts as friends sign up to test.)

const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

router.use(requireAuth)

// All routes below require the caller's tm_users.role = 'admin'.
async function requireAdmin(req, res, next) {
  try {
    const u = await db.one('SELECT role FROM tm_users WHERE id = $1', [req.user.id])
    if (!u || u.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
    next()
  } catch (err) {
    res.status(500).json({ error: 'Auth check failed' })
  }
}
router.use(requireAdmin)

// GET /api/admin/users — every account, newest first. Returns a thin
// projection (no sensitive fields like pin_hash). Used by the admin
// gear-icon Users modal on the home page.
router.get('/users', async (req, res) => {
  try {
    const rows = await db.many(
      `SELECT
         u.id, u.name, u.email, u.role, u.handicap, u.home_course,
         u.created_at, u.onboarding_completed_at, u.onboarding_steps,
         (SELECT COUNT(*)::int FROM tm_rounds   r WHERE r.user_id = u.id) AS round_count,
         (SELECT COUNT(*)::int FROM tm_outings  o WHERE o.host_id = u.id) AS match_count,
         (SELECT COUNT(*)::int FROM tm_user_clubs c WHERE c.user_id = u.id) AS club_count
       FROM tm_users u
       ORDER BY u.created_at DESC
       LIMIT 200`
    )
    res.json({ users: rows })
  } catch (err) {
    console.error('[admin/users]', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

module.exports = router
