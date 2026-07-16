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

// state: hidden | off | connecting | listening | speaking | error
export default function RoundMode({ getContext, executeTool, bottom = 162 }) {
  const [state, setState] = useState('off')
  const [available, setAvailable] = useState(null) // null = unknown yet
  const [muted, setMuted] = useState(false)
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
          if (s === 'ended') { ctrlRef.current = null; setState('off') }
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
