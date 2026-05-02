// PermissionsPrompt — first-signin sheet that asks for notifications +
// location in sequence. Shown once per device (gated by localStorage
// 'tm-perms-asked'). On iOS Safari outside a home-screen PWA we show
// an Add-to-Home-Screen hint instead, since web push won't work there.
//
// Flow:
//   - User taps "Allow"
//     → Notification.requestPermission() (native iOS/Chrome dialog)
//     → if granted, register push subscription server-side
//     → ask for geolocation (will trigger native permission dialog)
//   - User taps "Skip"
//     → set tm-perms-asked, close. They can re-enable later via Settings.
//
// (2026-05-01 — Matt: request permissions on first sign-in.)

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ensurePushSubscription, pushSupported, isStandalonePwa, isIosSafari } from '../lib/push.js'

export default function PermissionsPrompt({ user, onClose }) {
  const [busy, setBusy]   = useState(false)
  const [stage, setStage] = useState('intro')  // 'intro' | 'install-hint' | 'done'
  const firstName = (user?.name || '').trim().split(/\s+/)[0]

  // Detect the iOS-Safari-outside-PWA case once.
  const needsPwaInstall = isIosSafari() && !isStandalonePwa()

  function dismiss() {
    try { localStorage.setItem('tm-perms-asked', String(Date.now())) } catch { /* ignore */ }
    onClose?.()
  }

  async function allowAll() {
    setBusy(true)
    try {
      // 1. Notifications. requestPermission resolves with the user's
      //    choice ('granted' / 'denied' / 'default'). On grant we wire
      //    up the push subscription server-side.
      if (pushSupported() && Notification.permission === 'default') {
        try {
          const perm = await Notification.requestPermission()
          if (perm === 'granted') {
            await ensurePushSubscription()
          }
        } catch { /* user dismissed or browser denied */ }
      } else if (Notification.permission === 'granted') {
        // Already granted — make sure the subscription is registered.
        await ensurePushSubscription()
      }

      // 2. Location. Triggers the native location prompt. We don't
      //    actually need the position right now; we just want the
      //    permission cached so EagleEye can read GPS later without
      //    an unexpected permission dialog mid-round.
      if ('geolocation' in navigator) {
        await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => resolve(),
            () => resolve(),  // fail silently; we asked, that's all we wanted
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
          )
        })
      }
    } finally {
      setBusy(false)
      dismiss()
    }
  }

  function showInstallHint() {
    setStage('install-hint')
  }

  return createPortal(
    <div
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'tm-fade-in 200ms ease-out',
      }}
    >
      <style>{`
        @keyframes tm-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes tm-pp-slide-up {
          from { transform: translateY(40px); opacity: 0 }
          to   { transform: translateY(0);    opacity: 1 }
        }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 430, margin: '0 auto',
          background: 'linear-gradient(180deg, #11201A 0%, #0A1410 100%)',
          borderRadius: '24px 24px 0 0',
          padding: '28px 22px 32px',
          boxShadow: '0 -10px 50px rgba(0,0,0,0.7)',
          animation: 'tm-pp-slide-up 320ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18, marginTop: -10 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
        </div>

        {needsPwaInstall || stage === 'install-hint' ? (
          // iOS Safari outside a home-screen install — push won't work
          // until the user adds the app to their home screen.
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: 'linear-gradient(135deg, #C9A040, #E8C05A)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#070C09', fontSize: 26, fontWeight: 900,
              }}>+</div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', textAlign: 'center', marginBottom: 8, letterSpacing: '-0.01em' }}>
              Add to your home screen
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 1.5, marginBottom: 22 }}>
              On iPhone, friend-request and match notifications only work when The Match is installed as an app. Tap the <strong>Share</strong> icon below, then <strong>Add to Home Screen</strong>, and reopen from the new icon.
            </div>
            <button onClick={dismiss} style={{
              width: '100%', padding: '14px',
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 14, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>Got it</button>
          </>
        ) : (
          // Default Allow / Skip card
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(245,215,138,0.20), rgba(201,160,64,0.10))',
                border: '1px solid rgba(201,160,64,0.40)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F5D78A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
                </svg>
              </div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', textAlign: 'center', marginBottom: 8, letterSpacing: '-0.01em' }}>
              {firstName ? `Welcome, ${firstName}` : 'One last thing'}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 1.5, marginBottom: 22 }}>
              Allow <strong>notifications</strong> so you never miss a friend request or match invite, and <strong>location</strong> so Eagle Eye can give you live yardages.
            </div>

            {/* Two-line summary — mirrors the iOS-style permission card */}
            <div style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 14, padding: '12px 14px', marginBottom: 18,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5ED47A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
                </svg>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
                  Notifications — friend requests, match invites
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7FBFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
                  Location — live distances on Eagle Eye
                </div>
              </div>
            </div>

            <button
              onClick={allowAll}
              disabled={busy}
              style={{
                width: '100%', padding: '14px', marginBottom: 8,
                background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
                color: '#070C09', border: 'none', borderRadius: 14,
                fontSize: 15, fontWeight: 800, cursor: busy ? 'default' : 'pointer',
                fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
              }}>
              {busy ? 'Asking…' : 'Allow notifications & location'}
            </button>
            <button
              onClick={dismiss}
              disabled={busy}
              style={{
                width: '100%', padding: '11px',
                background: 'transparent', border: 'none',
                color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
              }}>Maybe later</button>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
