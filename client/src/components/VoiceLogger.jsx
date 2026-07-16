// Talk Your Round — Phase 0 hold-to-talk voice capture.
// (wiki/synthesis/voice-interface-build-spec-2026-07-15.md)
//
// Push-to-talk, deliberately crude: hold the mic, speak, release.
// On-device dictation (webkitSpeechRecognition — free, no vendor, works in
// the installed PWA) → POST /api/voice/parse (server NLU, sanitized intent)
// → parent executes through the SAME handlers the tap UI uses → spoken
// confirmation via speechSynthesis. No wake word, no streaming session —
// that's Phase 1 (Round Mode); this exists to put a microphone in the
// Friday group's hands and validate the utterance grammar on-course.
//
// Contract: onIntent(intent) may return a string (spoken instead of the
// parser's confirmation — used for get_status / ask_caddie answers), or
// nothing to speak intent.confirmation as-is.

import { useState, useRef, useCallback, useEffect } from 'react'
import { post } from '../lib/api.js'

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null

export const voiceSupported = () => Boolean(SR)

export function speak(text) {
  try {
    if (!text || !window.speechSynthesis) return
    window.speechSynthesis.cancel() // one caddie voice at a time
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.05
    window.speechSynthesis.speak(u)
  } catch { /* speech is a nicety, never an error */ }
}

function MicGlyph({ size = 22, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" /><line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  )
}

// state: idle | listening | thinking | error
export default function VoiceLogger({ getContext, onIntent, bottom = 92 }) {
  const [state, setState] = useState('idle')
  const [display, setDisplay] = useState('')   // live transcript / status line
  const recRef = useRef(null)
  const finalRef = useRef('')
  const holdingRef = useRef(false)

  useEffect(() => () => { try { recRef.current?.abort() } catch { /* unmount */ } }, [])

  const finish = useCallback(async () => {
    const transcript = finalRef.current.trim()
    finalRef.current = ''
    if (!transcript) { setState('idle'); setDisplay(''); return }
    setState('thinking')
    setDisplay(`“${transcript}”`)
    try {
      const intent = await post('/api/voice/parse', { transcript, context: getContext?.() ?? {} })
      let spoken = null
      try { spoken = await onIntent?.(intent) } catch { /* parent handled/failed — confirmation still speaks */ }
      speak(typeof spoken === 'string' && spoken ? spoken : intent.confirmation)
      setDisplay(typeof spoken === 'string' && spoken ? spoken : intent.confirmation)
      setState('idle')
      setTimeout(() => setDisplay(d => (d ? '' : d)), 3500)
    } catch {
      setState('error')
      setDisplay('Voice lost signal — try again.')
      setTimeout(() => { setState('idle'); setDisplay('') }, 2500)
    }
  }, [getContext, onIntent])

  const start = useCallback(() => {
    if (!SR || holdingRef.current) return
    holdingRef.current = true
    finalRef.current = ''
    try {
      const rec = new SR()
      recRef.current = rec
      rec.lang = 'en-US'
      rec.continuous = true
      rec.interimResults = true
      rec.onresult = (e) => {
        let interim = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) finalRef.current += r[0].transcript + ' '
          else interim += r[0].transcript
        }
        setDisplay(`“${(finalRef.current + interim).trim()}”`)
      }
      // iOS fires onend on its own schedule; only parse once the finger is up.
      rec.onend = () => { if (!holdingRef.current) finish() }
      rec.onerror = () => { /* no-speech etc — onend follows and resolves */ }
      rec.start()
      setState('listening')
      setDisplay('Listening…')
    } catch {
      holdingRef.current = false
      setState('error')
      setDisplay('Mic unavailable.')
      setTimeout(() => { setState('idle'); setDisplay('') }, 2000)
    }
  }, [finish])

  const stop = useCallback(() => {
    if (!holdingRef.current) return
    holdingRef.current = false
    try { recRef.current?.stop() } catch { finish() }
  }, [finish])

  if (!SR) return null // no dictation on this browser — tap UI unaffected

  const live = state === 'listening'
  return (
    <>
      {display && (
        <div style={{
          position: 'fixed', left: 16, right: 86, bottom: bottom + 6, zIndex: 60,
          padding: '10px 14px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.45,
          background: 'rgba(13,31,18,0.92)', color: '#fff',
          border: '1px solid rgba(201,160,64,0.35)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
        }}>{display}</div>
      )}
      <button
        aria-label="Hold to talk"
        onPointerDown={(e) => { e.preventDefault(); start() }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onPointerLeave={() => { if (holdingRef.current) stop() }}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'fixed', right: 16, bottom, zIndex: 60,
          width: 58, height: 58, borderRadius: '50%', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: live ? '#0D1F12' : '#F5D78A',
          background: live
            ? 'radial-gradient(circle at 35% 30%, #F8E3A6, #C9A040)'
            : 'linear-gradient(145deg, rgba(13,31,18,0.96), rgba(13,31,18,0.88))',
          border: live ? '2px solid #F5D78A' : '1.5px solid rgba(201,160,64,0.55)',
          boxShadow: live
            ? '0 0 0 8px rgba(201,160,64,0.22), 0 8px 24px rgba(0,0,0,0.4)'
            : '0 8px 24px rgba(0,0,0,0.4)',
          transition: 'box-shadow 160ms ease, background 160ms ease',
          touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none',
        }}
      >
        {state === 'thinking'
          ? <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em' }}>…</span>
          : <MicGlyph size={24} />}
      </button>
    </>
  )
}
