// Middleware: gate a route behind the Elite paid tier.
//
// Usage in a router:
//   const requireAuth   = require('../middleware/auth')
//   const requireElite  = require('../middleware/requireElite')
//   router.use(requireAuth)
//   router.use(requireElite)
//
// Behavior: 402 Payment Required when tm_users.tier !== 'elite'. Body
// includes { error: 'tier_required', required: 'elite', current: '<tier>' }
// so the client can render a paywall page tailored to the user's
// current tier. Kept as a Payment Required (not 403) because the
// user is authenticated — they just don't have the right plan.
//
// (2026-05-02 — Leagues paid-tier surface.)

const db = require('../db')

module.exports = async function requireElite(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Auth required' })
  try {
    const row = await db.one('SELECT tier FROM tm_users WHERE id = $1', [req.user.id])
    const tier = row?.tier || 'free'
    if (tier !== 'elite') {
      return res.status(402).json({
        error: 'tier_required',
        required: 'elite',
        current: tier,
        message: 'This feature is part of The Match Elite. Upgrade to unlock leagues.',
      })
    }
    req.userTier = tier
    next()
  } catch (err) {
    console.error('[requireElite]', err.message)
    res.status(500).json({ error: 'Tier check failed' })
  }
}
