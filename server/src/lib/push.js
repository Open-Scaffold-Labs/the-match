// Web-push helper. Configures web-push with the VAPID keys from env
// (lazily, on first import) and exposes a single sendPushToUser()
// function that the routes call when something happens that warrants
// a notification (friend request, match invite, etc.).
//
// Failure modes:
//   - VAPID env vars not set: log + no-op (don't crash signup).
//   - subscription endpoint stale (410/404): silently delete.
//   - any other push failure: log and continue (other devices might
//     still succeed).
//
// (2026-05-01 — Matt: web push for friend requests + invites.)

const webpush = require('web-push')
const db      = require('../db')

let configured = false
function configureOnce() {
  if (configured) return true
  // web-push wants URL-safe base64 with NO padding ('=') AND no
  // surrounding whitespace. The error it throws is misleadingly
  // narrow — 'Vapid public key must be a URL safe Base 64 (without
  // "=")' — but the underlying validator rejects ANY non-b64url char
  // including a trailing '\n' (which is what was actually on prod;
  // the key had no '=', it had a stray newline from a copy-paste).
  // Trim THEN strip trailing '=' so both failure modes are covered.
  // (2026-05-02 — first patch only stripped '=', didn't catch
  // the newline; this is the second pass.)
  const pub  = process.env.VAPID_PUBLIC_KEY?.trim().replace(/=+$/, '')
  const priv = process.env.VAPID_PRIVATE_KEY?.trim().replace(/=+$/, '')
  const sub  = process.env.VAPID_SUBJECT
  if (!pub || !priv || !sub) {
    console.warn('[push] VAPID env vars missing; push notifications disabled')
    return false
  }
  try {
    webpush.setVapidDetails(sub, pub, priv)
  } catch (err) {
    // Don't crash boot on a malformed key — log + leave configured
    // false so subsequent sends short-circuit cleanly via the
    // !configureOnce() guard in sendPushToUser.
    console.error('[push] setVapidDetails failed', err.message)
    return false
  }
  configured = true
  return true
}

// Send a notification payload to every subscription belonging to the
// target user. Payload should be a small JSON object the service
// worker will pick up; keep it compact (push providers cap at ~4KB).
//
// Recommended shape:
//   { title, body, url, tag }
//
// `url` is the deep link the SW will open when the notification is
// clicked. `tag` lets us collapse duplicates (e.g. multiple friend
// requests can collapse under tag='friend-request' so the user sees
// the latest one rather than a stack).
async function sendPushToUser(userId, payload) {
  if (!configureOnce()) return { sent: 0, failed: 0, skipped: 'no-vapid' }

  let subs = []
  try {
    subs = await db.many(
      'SELECT id, endpoint, p256dh, auth FROM tm_push_subscriptions WHERE user_id = $1',
      [userId]
    )
  } catch (err) {
    console.error('[push] failed to load subs', err.message)
    return { sent: 0, failed: 0, skipped: 'db-error' }
  }

  if (!subs || subs.length === 0) return { sent: 0, failed: 0 }

  const data = JSON.stringify(payload || {})
  let sent = 0, failed = 0

  await Promise.all(subs.map(async (s) => {
    try {
      const result = await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        data
      )
      // TEMPORARY diagnostic — prove the push gateway accepted us.
      // 201 from Apple/Google/Mozilla = accepted for delivery; the
      // gateway is then on the hook to forward to the device. If
      // we see 201 here but the device doesn't ding, the issue is
      // OS-level (notification permission revoked, Focus mode,
      // tag-collapse). Remove this log once push delivery is
      // proven stable. (2026-05-02)
      console.log('[push] OK', s.id, result?.statusCode, 'host:', new URL(s.endpoint).host)
      sent += 1
    } catch (err) {
      // 404/410 → subscription gone (uninstalled, browser cleared
      // storage, etc.). Drop the row so we don't keep hammering it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        try {
          await db.query('DELETE FROM tm_push_subscriptions WHERE id = $1', [s.id])
        } catch { /* ignore */ }
      } else {
        console.error('[push] sendNotification failed', err.statusCode, err.body)
      }
      failed += 1
    }
  }))

  return { sent, failed }
}

module.exports = { sendPushToUser }
