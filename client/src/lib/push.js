// Web push subscription helpers (client-side).
//
// Flow:
//   ensurePushSubscription()
//     1. Bail if Notification permission isn't granted
//     2. Bail if SW + PushManager unavailable (older browsers, iOS
//        Safari outside a home-screen PWA)
//     3. Fetch the VAPID public key from /api/notifications/vapid-key
//     4. Subscribe via PushManager and POST the subscription to the
//        server so it can deliver pushes
//
//   removePushSubscription()
//     Reverse the process — used on sign-out / disable.
//
// Idempotent: re-calling ensure when already subscribed just upserts
// the row server-side (the endpoint UNIQUE constraint handles it).
//
// (2026-05-01 — Matt: web push.)

import { api, post } from './api.js'

// Convert the URL-safe base64 VAPID public key into the Uint8Array
// format that PushManager.subscribe wants.
function urlB64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64  = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = atob(base64)
  const out     = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export async function ensurePushSubscription() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' }
  if (Notification.permission !== 'granted') return { ok: false, reason: 'no-permission' }

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const { publicKey } = await api('/api/notifications/vapid-key')
      if (!publicKey) return { ok: false, reason: 'no-vapid' }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(publicKey),
      })
    }
    // POST to server (idempotent on endpoint UNIQUE).
    const json = sub.toJSON()
    await post('/api/notifications/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
    })
    return { ok: true, endpoint: json.endpoint }
  } catch (err) {
    console.warn('[push] subscribe failed', err)
    return { ok: false, reason: 'error', error: err }
  }
}

export async function removePushSubscription() {
  if (!pushSupported()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    // Best-effort server delete; ignore failures.
    try {
      await fetch('/api/notifications/subscribe', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('tm_token') || ''}`,
        },
        body: JSON.stringify({ endpoint }),
      })
    } catch { /* ignore */ }
  } catch { /* ignore */ }
}

// iOS Safari only allows web push when the app has been added to the
// home screen as a PWA. Detect that mode so we can show an
// "Add to Home Screen" hint instead of a prompt that won't work.
export function isStandalonePwa() {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator?.standalone === true
}

export function isIosSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iP(hone|od|ad)/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}
