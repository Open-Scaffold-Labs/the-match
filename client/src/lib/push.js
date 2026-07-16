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
import { Capacitor } from '@capacitor/core'

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

// Native-shell sentinel (Track F.10 / audit N2). When The Match runs inside
// the native iOS WKWebView shell (the App Store build), the shell injects
// `window.__TM_NATIVE__ = true` (or appends a "TheMatchNative" token to the
// UA). Inside WKWebView `navigator.standalone` is false and the UA still says
// "Safari", so isIosSafari() && !isStandalonePwa() would otherwise be TRUE and
// we'd show a nonsensical "Add to Home Screen" instruction to a native-app
// user (an App Store review red flag). Push in the native build comes via
// APNs, so the web-push install nudges are suppressed entirely there.
export function isNativeShell() {
  if (typeof window === 'undefined') return false
  if (window.__TM_NATIVE__ === true) return true
  // Capacitor iOS/Android shell (the App Store build).
  try { if (Capacitor?.isNativePlatform?.()) return true } catch { /* not native */ }
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  return /TheMatchNative/i.test(ua)
}

// ── Native push (APNs via Capacitor) ────────────────────────────────────────
// The App Store build receives notifications through APNs, not web push. This
// registers the device with APNs, then POSTs the device token to the server so
// it can send pushes. No-op on web (returns immediately). Call AFTER sign-in
// (needs the auth token to POST). Idempotent: the server upserts on token.
let _nativePushListenersBound = false
export async function registerNativePush() {
  if (!Capacitor?.isNativePlatform?.()) return { ok: false, reason: 'not-native' }
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') return { ok: false, reason: 'no-permission' }

    // Bind listeners once per session.
    if (!_nativePushListenersBound) {
      _nativePushListenersBound = true
      await PushNotifications.addListener('registration', async token => {
        try {
          await post('/api/notifications/register-native', {
            token: token.value,
            platform: Capacitor.getPlatform(),
          })
        } catch (e) { console.warn('[push] native token post failed', e?.message) }
      })
      await PushNotifications.addListener('registrationError', err => {
        console.warn('[push] native registration error', err?.error)
      })
    }

    // Triggers the 'registration' event above with the APNs token.
    await PushNotifications.register()
    return { ok: true }
  } catch (e) {
    console.warn('[push] native register failed', e?.message)
    return { ok: false, reason: 'error', error: e }
  }
}
