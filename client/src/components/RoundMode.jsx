// Talk Your Round — Phase 1 Round Mode UI.
// (wiki/synthesis/voice-interface-build-spec-2026-07-15.md)
//
// A pill above the Phase 0 mic: tap to arm a continuous voice session
// (WebRTC realtime, lib/voiceRoundMode), tap END to disarm. Mic state is
// always visible (spec: partners must never wonder if they're being
// recorded) — gold pulse while the caddie speaks, steady while listening,
// struck-through when muted. If the server says Round Mode isn't enabled
// (501) the pill hides itself and hold-to-talk remains the only surface.

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api.js'
import { startRoundMode } from '../lib/voiceRoundMode.js'

function MicGlyph({ size = 14, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" /><line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  )
}

// ── Walking Mode pocket shield (Dale, 2026-07-15) ────────────────────────────
// A walker carries the phone in a pocket with earbuds — no cart mount, and a
// PWA can't listen with the screen locked. The running-app trick: keep the
// session (and wake lock) alive under a full-black touch shield. Black pixels
// ≈ off on OLED, every touch is swallowed except a deliberate 1.2s hold to
// wake, and the caddie keeps talking through the earbuds.
function PocketShield({ state, muted, activeHole, onExit }) {
  const holdRef = useRef(null)
  const [holding, setHolding] = useState(false)

  const startHold = () => {
    setHolding(true)
    holdRef.current = setTimeout(() => { setHolding(false); onExit() }, 1200)
  }
  const cancelHold = () => {
    setHolding(false)
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null }
  }
  useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current) }, [])

  const live = state === 'listening' || state === 'speaking'
  return createPortal(
    <div
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onTouchMove={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000, background: '#000',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none', cursor: 'default',
      }}
    >
      <div style={{
        width: 10, height: 10, borderRadius: '50%', marginBottom: 18,
        background: !live ? '#5A5A5A' : muted ? '#7A3B3B' : state === 'speaking' ? '#F5D78A' : '#3E6B48',
        boxShadow: state === 'speaking' ? '0 0 18px rgba(245,215,138,0.5)' : 'none',
        animation: state === 'listening' && !muted ? 'tm-live-pulse 2.2s ease-in-out infinite' : 'none',
      }} />
      {activeHole != null && (
        <div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 34, fontWeight: 900, letterSpacing: '-0.02em' }}>
          {activeHole}
        </div>
      )}
      <div style={{ color: 'rgba(255,255,255,0.22)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.22em', marginTop: 10, textTransform: 'uppercase' }}>
        {!live ? 'Reconnecting…' : muted ? 'Muted' : state === 'speaking' ? 'Caddie' : 'Walking · listening'}
      </div>
      <div style={{
        position: 'absolute', bottom: 'calc(var(--safe-bottom) + 26px)',
        color: holding ? 'rgba(245,215,138,0.85)' : 'rgba(255,255,255,0.16)',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase',
        transition: 'color 150ms ease',
      }}>
        {holding ? 'Keep holding…' : 'Hold anywhere to wake'}
      </div>
    </div>,
    document.body
  )
}

// state: hidden | off | connecting | listening | speaking | error
export default function RoundMode({ getContext, executeTool, bottom = 162 }) {
  const [state, setState] = useState('off')
  const [available, setAvailable] = useState(null) // null = unknown yet
  const [muted, setMuted] = useState(false)
  const [pocket, setPocket] = useState(false) // Walking Mode shield up
  const ctrlRef = useRef(null)

  // Feature-detect once, quietly: 501 → hide the pill entirely.
  useEffect(() => {
    let gone = false
    api('/api/voice/session').then(
      () => { if (!gone) setAvailable(true) },
      (e) => { if (!gone) setAvailable(!/501|not enabled/i.test(String(e?.message))) }
    )
    return () => { gone = true }
  }, [])

  useEffect(() => () => { ctrlRef.current?.stop() }, [])

  const arm = useCallback(async () => {
    if (ctrlRef.current) return
    try {
      const ctrl = await startRoundMode({
        getContext,
        executeTool,
        onState: (s) => {
          if (s === 'ended') { ctrlRef.current = null; setState('off'); setPocket(false) }
          else setState(s)
        },
      })
      ctrlRef.current = ctrl
    } catch (e) {
      ctrlRef.current = null
      if (String(e?.message) === 'unavailable') { setAvailable(false); setState('off'); return }
      setState('error')
      setTimeout(() => setState('off'), 2500)
    }
  }, [getContext, executeTool])

  const disarm = useCallback(() => { ctrlRef.current?.stop() }, [])
  const toggleMute = useCallback(() => {
    const c = ctrlRef.current
    if (!c) return
    c.setMuted(!c.muted)
    setMuted(c.muted)
  }, [])

  if (available === false || available === null) return null

  const live = state === 'listening' || state === 'speaking'
  const label = state === 'off' ? 'ROUND MODE'
    : state === 'connecting' ? 'CONNECTING…'
    : state === 'error' ? 'NO SIGNAL'
    : muted ? 'MUTED'
    : state === 'speaking' ? 'CADDIE…'
    : 'LISTENING'

  return (
    <div style={{ position: 'fixed', right: 16, bottom, zIndex: 60, display: 'flex', gap: 8 }}>
      {pocket && (
        <PocketShield
          state={state} muted={muted}
          activeHole={getContext?.()?.activeHole ?? null}
          onExit={() => setPocket(false)}
        />
      )}
      {live && (
        <button onClick={() => setPocket(true)} aria-label="Walking mode — pocket the phone" style={{
          padding: '8px 12px', borderRadius: 999, cursor: 'pointer',
          background: 'rgba(13,31,18,0.92)', color: '#F5D78A',
          border: '1px solid rgba(201,160,64,0.4)', fontSize: 10, fontWeight: 800,
          letterSpacing: '0.1em',
        }}>WALK</button>
      )}
      {live && (
        <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} style={{
          padding: '8px 10px', borderRadius: 999, cursor: 'pointer',
          background: 'rgba(13,31,18,0.92)', color: muted ? '#E0A3A3' : '#F5D78A',
          border: '1px solid rgba(201,160,64,0.4)', fontSize: 10, fontWeight: 800,
          textDecoration: muted ? 'line-through' : 'none',
        }}><MicGlyph /></button>
      )}
      <button
        onClick={live ? disarm : state === 'off' ? arm : undefined}
        aria-label={live ? 'End Round Mode' : 'Start Round Mode'}
        style={{
          padding: '9px 14px', borderRadius: 999, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 7,
          fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em',
          color: live ? '#0D1F12' : '#F5D78A',
          background: live
            ? (state === 'speaking'
              ? 'radial-gradient(circle at 35% 30%, #F8E3A6, #C9A040)'
              : 'linear-gradient(135deg, #E8C05A, #C9A040)')
            : 'rgba(13,31,18,0.92)',
          border: live ? '1.5px solid #F5D78A' : '1.5px solid rgba(201,160,64,0.5)',
          boxShadow: state === 'speaking'
            ? '0 0 0 6px rgba(201,160,64,0.25), 0 6px 18px rgba(0,0,0,0.35)'
            : '0 6px 18px rgba(0,0,0,0.35)',
          transition: 'box-shadow 200ms ease, background 200ms ease',
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: live ? '#0D1F12' : state === 'error' ? '#E08A8A' : 'rgba(201,160,64,0.9)',
          animation: state === 'listening' ? 'tm-live-pulse 1.6s ease-in-out infinite' : 'none',
        }} />
        {label}
        {live && <span style={{ fontWeight: 900 }}>· END</span>}
      </button>
    </div>
  )
}
