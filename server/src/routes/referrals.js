// ─── routes/referrals.js ────────────────────────────────────────────────────
// Public surface for the referral / invite-link program.
//
//   GET /api/referrals/me
//     Returns the viewer's referral code (lazily creates one on first
//     hit), the full shareable URL (built from APP_BASE_URL or the
//     request's Host header), and stats — total signups, qualifying
//     count, next milestone target with days remaining, list of
//     already-awarded rewards, full milestone schedule for client-side
//     rendering.
//
// Mounted at /api/referrals in server/src/index.js so the path is
// /api/referrals/me. Auth required (req.user must be set by the global
// /api auth middleware).

const router = require('express').Router()
const { getOrCreateCode, getReferralStats } = require('../lib/referrals')

router.get('/me', async (req, res) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const userId = req.user.id
    const code = await getOrCreateCode(userId)
    const stats = await getReferralStats(userId)
    const base = process.env.APP_BASE_URL || `https://${req.headers.host || 'the-match-roan.vercel.app'}`
    const url = `${base}/?ref=${code}`
    res.json({ code, url, ...stats })
  } catch (err) {
    console.error('[referrals/me]', err.message)
    res.status(500).json({ error: 'Failed to load referral info' })
  }
})

module.exports = router
