import { useState } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'

// 2026-05-05 — Show-QR button. Tapping opens a portal modal with a
// large QR code encoding the join URL. Friends standing next to the
// host can scan it with their iPhone camera; URL has a ?join=CODE
// param that App.jsx routes to auto-join (if signed in) or
// stash-and-redirect (if not signed in yet).
function ShareQRButton({ code, name, course }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        width: '100%', padding: '14px', borderRadius: 14, cursor: 'pointer', border: 'none',
        background: 'linear-gradient(135deg, #1A6B28 0%, #0E3B23 100%)',
        color: '#fff', fontWeight: 800, fontSize: 15,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        boxShadow: '0 4px 16px rgba(46,158,69,0.30), inset 0 1px 0 rgba(255,255,255,0.12)',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><line x1="14" y1="14" x2="14" y2="14.01"/>
          <line x1="17" y1="14" x2="17" y2="17"/><line x1="14" y1="17" x2="14" y2="20"/>
          <line x1="17" y1="20" x2="20" y2="20"/><line x1="20" y1="14" x2="20" y2="17"/>
        </svg>
        Show QR Code
      </button>
      {open && <ShareQRModal code={code} name={name} course={course} onClose={() => setOpen(false)} />}
    </>
  )
}

// QR modal — portal to document.body, dark backdrop, big QR card.
// stopPropagation on the inner card so taps on the QR/copy don't
// bubble out and close the modal accidentally.
function ShareQRModal({ code, name, course, onClose }) {
  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/?join=${encodeURIComponent(code)}`
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 360,
          background: '#FFFDF8',
          borderRadius: 24, padding: '28px 24px 24px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.50)',
          textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        }}>
        <div style={{ fontSize: 11, color: 'var(--tm-gold-text)', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          Scan to Join
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--tm-text)', lineHeight: 1.2 }}>{name}</div>
        {course && (
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1A6B28' }}>{course}</div>
        )}
        <div style={{
          padding: 16, borderRadius: 16,
          background: '#fff',
          border: '2px solid rgba(201,160,64,0.55)',
          boxShadow: '0 4px 18px rgba(201,160,64,0.18)',
        }}>
          <QRCodeSVG value={url} size={232} level="M" includeMargin={false} fgColor="#0D1F12" bgColor="#FFFFFF" />
        </div>
        <div style={{
          fontSize: 28, fontWeight: 900, letterSpacing: 8, color: 'var(--tm-gold)',
          fontFamily: '"Arial Black", Arial, sans-serif',
        }}>{code}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(13,31,18,0.70)', lineHeight: 1.45 }}>
          Have your friends point their iPhone camera at this code.
        </div>
        <button onClick={onClose} style={{
          marginTop: 4,
          padding: '10px 20px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: 'rgba(13,31,18,0.06)', color: 'rgba(13,31,18,0.65)',
          fontWeight: 700, fontSize: 13,
        }}>Close</button>
      </div>
    </div>,
    document.body
  )
}

function ShareCodeButton({ code, name }) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const msg = `Join my golf match "${name}" on The Match!\n\nOpen the app → Scorecard tab → "Enter a Code" → type: ${code}`
    if (navigator.share) {
      try { await navigator.share({ text: msg }) } catch {}
    } else {
      await navigator.clipboard.writeText(msg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  // 2026-05-05 — solid gold (was a translucent gold tint that read as
  // un-tappable on the cream page background). Matches the rest of
  // the gold-accent buttons in the app (Profile's Request a Match
  // CTA pattern). Dark text on gold for contrast.
  return (
    <button onClick={share} style={{
      width: '100%', padding: '14px', borderRadius: 14, cursor: 'pointer', border: 'none',
      background: 'linear-gradient(135deg, #F5D78A 0%, var(--tm-gold) 100%)',
      color: '#070C09', fontWeight: 800, fontSize: 15,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      boxShadow: '0 4px 16px rgba(201,160,64,0.30), inset 0 1px 0 rgba(255,255,255,0.30)',
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
      {copied ? 'Copied to clipboard!' : 'Share Code with Group'}
    </button>
  )
}

// ─── Code Share ───────────────────────────────────────────────────────────────
export default function CodeShare({ outing, onEnter }) {
  return (
    // 2026-05-05 — kept transparent (sits over the page-level cream
    // tint). Two fixes vs the earlier version:
    //   1. Text colors: white-on-transparent was invisible on cream;
    //      switched to dark-on-cream. Gold accents preserved.
    //   2. Layout: was justifyContent:center on a fixed-height
    //      container, which caused content taller than the viewport
    //      to overflow top + bottom (Matt: "the entire bottom half is
    //      sticking through"). Now flex-start with a scrollable
    //      container, safe-area padding, and bottom padding to clear
    //      the nav so the Enter Scorecard button is always reachable.
    <div data-no-pull-refresh="true" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      padding: 'calc(var(--safe-top) + 24px) 32px calc(var(--safe-bottom) + 24px)',
      gap: 16,
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(46,158,69,0.20) 0%, rgba(46,158,69,0.04) 100%)',
        border: '1px solid rgba(46,158,69,0.35)',
        boxShadow: '0 2px 12px rgba(46,158,69,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1A6B28" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
          <line x1="4" y1="22" x2="4" y2="15"/>
        </svg>
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, color: 'var(--tm-text)', textAlign: 'center' }}>{outing.name}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1A6B28', textAlign: 'center' }}>{outing.course_name}</div>
      <div style={{
        background: 'rgba(255,253,248,0.85)',
        border: '1.5px solid rgba(201,160,64,0.55)',
        borderRadius: 20, padding: '22px 40px', textAlign: 'center',
        boxShadow: '0 4px 18px rgba(201,160,64,0.18)',
      }}>
        <div style={{ fontSize: 11, color: 'var(--tm-gold-text)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Join Code</div>
        <div style={{
          fontSize: 54, fontWeight: 900, letterSpacing: 10,
          background: 'linear-gradient(135deg, var(--tm-gold), #8A6B28)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>{outing.code}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tm-text)', textAlign: 'center', lineHeight: 1.45 }}>
        Share this code with your group — they open The Match app, tap the Scorecard tab, and hit "Enter a Code"
      </div>
      {/* Share button */}
      <ShareCodeButton code={outing.code} name={outing.name} />
      {/* QR-code share — opens a modal with a large scannable QR. */}
      <ShareQRButton code={outing.code} name={outing.name} course={outing.course_name} />
      <button onClick={onEnter}
        style={{
          width: '100%', padding: '16px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
          color: '#fff', fontWeight: 800, fontSize: 16,
          boxShadow: '0 4px 16px rgba(46,158,69,0.30), inset 0 1px 0 rgba(255,255,255,0.12)',
          flexShrink: 0,
        }}>
        Enter Scorecard →
      </button>
    </div>
  )
}
