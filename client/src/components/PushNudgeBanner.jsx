// PushNudgeBanner — inline reminder for users who haven't enabled push
// notifications yet. Lives at the top of the TEE TIMES section on Home
// because that's the surface where the missing-push consequence bites
// hardest: when a friend invites you to a tee time, you only see it
// next time you open the app — instead of a real OS-level alert.
//
// Three states:
//   1. iOS Safari NOT installed as a home-screen PWA
//      → "Add to Home Screen" hint (web push is impossible until then)
//   2. Notification.permission === 'default'
//      → "Turn on" button. Calls requestPermission + ensurePushSubscription.
//   3. Notification.permission === 'denied'
//      → "Enable in your phone's settings" hint (we can't reprompt).
//
// If permission is granted AND a subscription is registered, the
// banner never renders.
//
// Dismissible per user (localStorage `tm-push-nudge-dismissed-<userId>`).
// We don't auto-bring it back — they can re-enable in Settings.
//
// (2026-05-06 — Matt: close the loop after the new tee time feature
// shipped and we noticed invitees with 0 push subscriptions silently
// missed the OS-level alert.)

import { useEffect, useState } from 'react'
import { ensurePushSubscription, pushSupported, isStandalonePwa, isIosSafari, isNativeShell } from '../lib/push.js'

export default function PushNudgeBanner({ user }) {
  const dismissKey = user?.id ? `tm-push-nudge-dismissed-${user.id}` : null

  // Initial state determined synchronously on mount so we don't
  // flicker the banner in/out on first paint.
  const [state, setState] = useState(() => computeState())
  const [dismissed, setDismissed] = useState(() => {
    try { return dismissKey && localStorage.getItem(dismissKey) === '1' }
    catch { return false }
  })
  const [busy, setBusy] = useState(false)

  function computeState() {
    if (typeof window === 'undefined') return 'hidden'
    // Native shell (Track F.10): push arrives via APNs, not web push — never
    // show the "Add to Home Screen" nudge inside the native app.
    if (isNativeShell()) return 'hidden'
    // iOS Safari outside a home-screen install — push is impossible
    // here. Show the "Add to Home Screen" variant first; the
    // permission state doesn't matter until they install.
    if (isIosSafari() && !isStandalonePwa()) return 'pwa-install'
    if (!pushSupported()) return 'hidden' // browser doesn't speak push at all
    if (Notification.permission === 'granted') return 'hidden'
    if (Notification.permission === 'denied')  return 'denied'
    return 'default' // 'default' permission — we can prompt
  }

  // Re-check on visibility change (user came back from Settings, etc.)
  useEffect(() => {
    function recheck() { setState(computeState()) }
    document.addEventListener('visibilitychange', recheck)
    return () => document.removeEventListener('visibilitychange', recheck)
  }, [])

  // After permission flips to granted, also push the subscription
  // up to the server so the next invite actually delivers.
  useEffect(() => {
    if (state === 'hidden' && pushSupported() && Notification.permission === 'granted') {
      ensurePushSubscription().catch(() => { /* silent */ })
    }
  }, [state])

  function dismiss() {
    setDismissed(true)
    try { dismissKey && localStorage.setItem(dismissKey, '1') } catch { /* ignore */ }
  }

  async function turnOn() {
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm === 'granted') {
        await ensurePushSubscription()
        setState('hidden')
      } else if (perm === 'denied') {
        setState('denied')
      }
    } catch { /* user cancelled */ }
    finally { setBusy(false) }
  }

  if (dismissed) return null
  if (state === 'hidden') return null

  // Color tokens — leans gold/amber to read as "heads-up" rather than
  // urgent (which red would do) and to stay sibling-y with the
  // surrounding TEE TIMES box.
  const accent = 'rgba(232,192,90,0.65)'
  const titleColor = '#3D2F08'
  const bodyColor  = 'rgba(58,46,12,0.78)'

  let icon, title, body, action
  if (state === 'pwa-install') {
    icon = (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8A6A18" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14"/><path d="M5 12l7 7 7-7"/><path d="M5 21h14"/>
      </svg>
    )
    title = 'Add to your Home Screen for alerts'
    body  = 'On iPhone, tee time and match invites only push when The Match is installed. Tap Share, then Add to Home Screen.'
    action = null
  } else if (state === 'denied') {
    icon = (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8A6A18" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
        <line x1="2" y1="2" x2="22" y2="22"/>
      </svg>
    )
    title = 'Notifications are off'
    body  = 'Enable in your phone\'s Settings → The Match → Notifications to get tee time and match invite alerts.'
    action = null
  } else {
    // 'default' — we can prompt
    icon = (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8A6A18" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
      </svg>
    )
    title = 'Turn on tee time alerts'
    body  = 'Get a push when a friend schedules a tee time or invites you to a match.'
    action = (
      <button
        onClick={turnOn}
        disabled={busy}
        style={{
          padding: '8px 14px',
          background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
          color: '#070C09', border: 'none', borderRadius: 10,
          fontSize: 12, fontWeight: 800, cursor: busy ? 'default' : 'pointer',
          fontFamily: 'inherit', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap',
        }}
      >
        {busy ? 'Asking…' : 'Turn on'}
      </button>
    )
  }

  return (
    <div style={{
      position: 'relative',
      borderRadius: 12,
      background: 'linear-gradient(135deg, rgba(245,215,138,0.32) 0%, rgba(232,192,90,0.18) 100%)',
      border: `1px solid ${accent}`,
      padding: '12px 36px 12px 14px', // right padding for the X
      marginBottom: 12,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        flexShrink: 0,
        width: 36, height: 36, borderRadius: 10,
        background: 'rgba(255,255,255,0.40)',
        border: '1px solid rgba(232,192,90,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 800, color: titleColor,
          marginBottom: 2, lineHeight: 1.2,
        }}>{title}</div>
        <div style={{
          fontSize: 11.5, color: bodyColor, lineHeight: 1.35,
        }}>{body}</div>
      </div>

      {action}

      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          position: 'absolute', top: 6, right: 6,
          width: 24, height: 24, borderRadius: 6,
          background: 'transparent', border: 'none',
          color: 'rgba(58,46,12,0.55)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6"  y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  )
}
