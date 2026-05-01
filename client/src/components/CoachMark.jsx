// CoachMark — small first-time-only tooltip overlay for any tab. Shown
// once per user per mark; dismissed state persists server-side via
// /api/onboarding/coach-mark so it survives reloads on any device.
//
// Usage:
//   <CoachMark id="home" user={user} title="Welcome home" body="..." />
// The overlay anchors to the bottom-center of the screen by default so
// it doesn't fight with whatever's at the top of the page.
//
// (2026-05-01 — Matt: friends-test prep, third leg of the onboarding
// triad alongside the mandatory wizard + checklist.)

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { put } from '../lib/api.js'

export default function CoachMark({
  id,                // unique key matching tm_users.coach_marks_seen jsonb
  user,              // current user — checks coach_marks_seen[id]
  title,
  body,
  anchor = 'bottom', // 'bottom' | 'top'
  delay = 600,       // ms before showing (let the page paint first)
}) {
  // Local visible state, gated on:
  //   - the prop user has loaded
  //   - this mark hasn't been seen yet
  //   - delay has elapsed
  // Defaults to false so we never flash on first render.
  const seen = !!user?.coach_marks_seen?.[id]
  const [visible, setVisible]   = useState(false)
  const [closing, setClosing]   = useState(false)
  const [dismissed, setDismissed] = useState(seen)

  useEffect(() => {
    if (seen || dismissed) return
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [seen, dismissed, delay])

  async function dismiss() {
    setClosing(true)
    setTimeout(() => {
      setVisible(false)
      setDismissed(true)
    }, 200)
    try { await put('/api/onboarding/coach-mark', { mark: id }) } catch {}
  }

  if (seen || dismissed || !visible) return null

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      pointerEvents: 'none',
      display: 'flex',
      alignItems: anchor === 'top' ? 'flex-start' : 'flex-end',
      justifyContent: 'center',
      paddingTop: anchor === 'top' ? 96 : 0,
      paddingBottom: anchor === 'bottom' ? 'calc(80px + env(safe-area-inset-bottom))' : 0,
      padding: '12px',
    }}>
      <style>{`
        @keyframes cm-pop {
          0%   { opacity: 0; transform: translateY(${anchor === 'top' ? '-' : ''}10px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes cm-out {
          0%   { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.94); }
        }
        .cm-card { animation: ${closing ? 'cm-out 200ms ease forwards' : 'cm-pop 280ms cubic-bezier(0.34,1.56,0.64,1) both'}; }
      `}</style>
      <div className="cm-card" onClick={dismiss} style={{
        pointerEvents: 'auto',
        maxWidth: 360, width: '100%',
        background: 'linear-gradient(160deg, #1A2D1F 0%, #0E1F13 60%, #060E08 100%)',
        border: '1px solid rgba(245,215,138,0.45)',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,215,138,0.12)',
        padding: '14px 16px',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: 'linear-gradient(90deg, transparent, rgba(245,215,138,0.7), transparent)',
        }} />
        <div style={{
          fontSize: 10, fontWeight: 800, color: 'rgba(245,215,138,0.65)',
          letterSpacing: '0.20em', marginBottom: 4,
        }}>TIP</div>
        <div style={{
          fontSize: 15, fontWeight: 800, color: '#fff',
          marginBottom: 4, letterSpacing: '-0.01em',
        }}>{title}</div>
        <div style={{
          fontSize: 13, color: 'rgba(255,255,255,0.70)',
          lineHeight: 1.5,
        }}>{body}</div>
        <div style={{
          fontSize: 11, color: 'rgba(245,215,138,0.55)', fontWeight: 700,
          letterSpacing: '0.10em', textAlign: 'right', marginTop: 6,
        }}>TAP TO DISMISS</div>
      </div>
    </div>,
    document.body
  )
}
