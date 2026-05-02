// Notifications subscribe/unsubscribe + VAPID public-key surface.
//
// Client flow:
//   1. GET /api/notifications/vapid-key  → returns the public key
//   2. Browser asks Notification.requestPermission()
//   3. If granted, browser calls navigator.serviceWorker.ready then
//      pushManager.subscribe({ applicationServerKey: <publicKey> })
//   4. Client POSTs the resulting subscription to /api/notifications/subscribe
//   5. Server stores the (endpoint, p256dh, auth) tuple in
//      tm_push_subscriptions, scoped to the authenticated user.
//
// (2026-05-01 — Matt: web push.)

const router      = require('express').Router()
const requireAuth = require('../middleware/auth')
const db          = require('../db')

// Public route — VAPID public key. No auth gate; the public key is
// public by design and the client needs it before the user is even
// signed in (unlikely but harmless).
router.get('/vapid-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) return res.status(503).json({ error: 'Push not configured' })
  res.json({ publicKey: key })
})

// Everything below requires auth.
router.use(requireAuth)

// Save a push subscription for the authed user. Request body shape
// matches the JSON returned by PushSubscription.toJSON() in the
// browser, which includes:
//   { endpoint, expirationTime?, keys: { p256dh, auth } }
router.post('/subscribe', async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {}
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'subscription endpoint + keys required' })
    }

    const ua = String(req.headers['user-agent'] || '').slice(0, 500)
    // Upsert on endpoint — if the user re-subscribes from the same
    // browser, we keep one row per endpoint. ON CONFLICT updates
    // user_id (in case the device was previously another account on
    // the same browser) and refreshes the keys.
    await db.query(
      `INSERT INTO tm_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh  = EXCLUDED.p256dh,
             auth    = EXCLUDED.auth,
             user_agent = EXCLUDED.user_agent`,
      [req.user.id, endpoint, keys.p256dh, keys.auth, ua]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[notifications/subscribe]', err.message)
    res.status(500).json({ error: 'Failed to subscribe' })
  }
})

// Drop a subscription. Body: { endpoint }. Used when the user
// disables notifications or signs out from a device.
router.delete('/subscribe', async (req, res) => {
  try {
    const { endpoint } = req.body || {}
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' })
    await db.query(
      'DELETE FROM tm_push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.user.id, endpoint]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('[notifications/unsubscribe]', err.message)
    res.status(500).json({ error: 'Failed to unsubscribe' })
  }
})

module.exports = router
