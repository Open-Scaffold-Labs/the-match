import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { post } from '../lib/api.js'
import { analyzeClip } from '../lib/swingTempo.mjs'
import { analyzeVideoBlob } from '../lib/swingCapture.mjs'

// Swing Capture — Swing Intelligence V1: guided in-app filming (spec:
// wiki/synthesis/swing-intelligence-build-spec-2026-07-16.md §Pipeline.1).
//
// Framing hints (face-on / down-the-line), 8-second clips, then ON-DEVICE
// analysis — the clip never uploads; only the measured facts (duration_ms,
// tempo_ratio, frames, flags) POST to /api/swing/session. Privacy is a
// feature: "your video stays on your phone" (user-owned storage per spec;
// metrics outlive footage).
//
// WKWebView notes (App Store target): getUserMedia + MediaRecorder work on
// iOS 14.3+; camera permission needs NSCameraUsageDescription in the native
// shell (already present for Eagle Eye shot photos). No browser-framed
// fallbacks — unsupported states are honest and actionable.

const GOLD = 'var(--tm-gold)'
const GOLD_BRIGHT = '#F5D78A'
const TXT2 = 'var(--tm-dark-text-2)'
const CLIP_SECONDS = 8

const CTA = {
  width: '100%', minHeight: 50, borderRadius: 12, cursor: 'pointer',
  background: 'rgba(201,160,64,0.18)', border: `1px solid ${GOLD}`,
  color: GOLD_BRIGHT, fontSize: 15, fontWeight: 800,
}

const VIEWS = {
  face_on: {
    label: 'Face-on',
    hint: 'Phone at belt height, 8–10 feet away, your whole body + club in frame at address.',
    best: 'sway, head movement, tempo',
  },
  down_the_line: {
    label: 'Down-the-line',
    hint: 'Phone behind you on the target line, belt height, hands centered in frame.',
    best: 'swing plane, early extension, tempo',
  },
}

export default function SwingCapture({ onClose, onSaved }) {
  const [view, setView]         = useState('face_on')
  const [phase, setPhase]       = useState('setup') // setup | ready | recording | analyzing | result
  const [streamErr, setStreamErr] = useState(null)
  const [result, setResult]     = useState(null)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [count, setCount]       = useState(CLIP_SECONDS)
  const videoRef  = useRef(null)
  const streamRef = useRef(null)
  const recRef    = useRef(null)
  const chunksRef = useRef([])

  const startCamera = useCallback(async () => {
    setStreamErr(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true, // impact spike detection
      })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play?.() }
      setPhase('ready')
    } catch {
      setStreamErr('Camera access is off. Enable it in Settings → The Match, then tap to retry.')
    }
  }, [])

  useEffect(() => {
    startCamera()
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [startCamera])

  const record = useCallback(() => {
    const stream = streamRef.current
    if (!stream) return
    chunksRef.current = []
    const mime = ['video/mp4', 'video/webm'].find(m => window.MediaRecorder?.isTypeSupported?.(m)) || ''
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    recRef.current = rec
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data) }
    rec.onstop = async () => {
      setPhase('analyzing')
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'video/mp4' })
      const signals = await analyzeVideoBlob(blob)
      if (signals.error) {
        setResult({ detectable: false, flags: [signals.error], error: true })
      } else {
        setResult(analyzeClip(signals))
      }
      setPhase('result')
    }
    rec.start(250)
    setPhase('recording')
    setCount(CLIP_SECONDS)
    const t0 = Date.now()
    const tick = setInterval(() => {
      const left = CLIP_SECONDS - Math.floor((Date.now() - t0) / 1000)
      setCount(Math.max(0, left))
      if (left <= 0) { clearInterval(tick); rec.state !== 'inactive' && rec.stop() }
    }, 250)
  }, [])

  const stop = useCallback(() => { recRef.current?.state !== 'inactive' && recRef.current?.stop() }, [])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await post('/api/swing/session', {
        context: 'range',
        source: 'capture',
        view,
        swings: [{
          duration_ms: result.duration_ms,
          tempo_ratio: result.tempo_ratio,
          frames: result.frames,
          flags: result.flags,
        }],
      })
      setSaved(true)
      onSaved?.()
    } catch { /* honest: leave the button live for retry */ }
    finally { setSaving(false) }
  }, [result, view, onSaved])

  const v = VIEWS[view]

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--tm-dark-0)',
      color: 'var(--tm-dark-text)', display: 'flex', flexDirection: 'column',
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'max(env(safe-area-inset-top), 12px) 16px 8px' }}>
        <button onClick={onClose} aria-label="Close capture" className="touch-press" style={{ background: 'none', border: 'none', color: GOLD_BRIGHT, fontSize: 15, fontWeight: 700, padding: 8, cursor: 'pointer' }}>✕</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>Swing Intelligence</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Film your swing</div>
        </div>
      </div>

      {/* view picker */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 10px' }}>
        {Object.entries(VIEWS).map(([k, vv]) => (
          <button key={k} onClick={() => setView(k)} className="touch-press" style={{
            flex: 1, minHeight: 44, borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13,
            border: `1px solid ${view === k ? GOLD : 'rgba(232,193,90,0.2)'}`,
            background: view === k ? 'rgba(201,160,64,0.18)' : 'rgba(255,255,255,0.04)',
            color: view === k ? GOLD_BRIGHT : TXT2,
          }}>{vv.label}</button>
        ))}
      </div>

      {/* camera / result area */}
      <div style={{ flex: 1, position: 'relative', margin: '0 16px', borderRadius: 16, overflow: 'hidden', background: '#000', border: '1px solid rgba(232,193,90,0.15)' }}>
        <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: phase === 'result' ? 'none' : 'block' }} />

        {/* framing guide overlay */}
        {(phase === 'ready' || phase === 'recording') && (
          <svg viewBox="0 0 100 160" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {view === 'face_on' ? (
              <>
                <ellipse cx="50" cy="95" rx="14" ry="34" fill="none" stroke="rgba(245,215,138,0.45)" strokeWidth="0.8" strokeDasharray="3 2" />
                <line x1="50" y1="30" x2="50" y2="135" stroke="rgba(245,215,138,0.3)" strokeWidth="0.5" strokeDasharray="2 2" />
              </>
            ) : (
              <>
                <line x1="62" y1="20" x2="38" y2="140" stroke="rgba(245,215,138,0.45)" strokeWidth="0.8" strokeDasharray="3 2" />
                <ellipse cx="50" cy="95" rx="10" ry="34" fill="none" stroke="rgba(245,215,138,0.3)" strokeWidth="0.6" />
              </>
            )}
          </svg>
        )}

        {phase === 'setup' && !streamErr && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TXT2 }}>Starting camera…</div>
        )}
        {streamErr && (
          <button onClick={startCamera} style={{ position: 'absolute', inset: 0, background: 'none', border: 'none', color: GOLD_BRIGHT, padding: 24, fontSize: 14, lineHeight: 1.6, cursor: 'pointer' }}>{streamErr}</button>
        )}

        {phase === 'recording' && (
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.55)', borderRadius: 99, padding: '6px 12px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#E14B4B', animation: 'pulse 1s ease-in-out infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>{count}s</span>
          </div>
        )}

        {phase === 'analyzing' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', justifyContent: 'center', background: 'rgba(10,14,12,0.92)' }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Reading your swing…</div>
            <div style={{ fontSize: 12, color: TXT2 }}>On-device — the clip never leaves your phone</div>
          </div>
        )}

        {phase === 'result' && result && (
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: 'rgba(10,14,12,0.96)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {result.detectable ? (
              <>
                <div style={{ textAlign: 'center', marginTop: 8 }}>
                  <div style={{ fontSize: 44, fontWeight: 800, color: GOLD_BRIGHT, letterSpacing: '-1px' }}>{result.tempo_ratio}:1</div>
                  <div style={{ fontSize: 12, color: TXT2, textTransform: 'uppercase', letterSpacing: 1.5 }}>tempo ratio</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 24 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{result.duration_ms}ms</div>
                    <div style={{ fontSize: 11, color: TXT2 }}>takeaway → impact</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{result.impact_via === 'audio' ? 'Heard' : 'Seen'}</div>
                    <div style={{ fontSize: 11, color: TXT2 }}>impact detection</div>
                  </div>
                </div>
                {result.flags.length > 0 && (
                  <div style={{ fontSize: 12, color: TXT2, textAlign: 'center' }}>
                    Note: {result.flags.includes('impact_from_motion') ? 'no clear impact audio — timing is close but approximate' : result.flags.join(', ')}
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>We couldn’t read that one</div>
                <div style={{ fontSize: 13, color: TXT2, lineHeight: 1.6 }}>
                  {result.flags.includes('clip_too_long') ? 'Clips are 8 seconds — one swing per clip.'
                    : result.flags.includes('no_motion') ? 'No swing movement found — check the framing hint below and keep the phone steady.'
                    : 'Check the framing hint below: steady phone, whole swing in frame, then one committed swing.'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* hint + actions */}
      <div style={{ padding: '12px 16px max(env(safe-area-inset-bottom), 16px)' }}>
        {phase !== 'result' && (
          <div style={{ fontSize: 12.5, color: TXT2, lineHeight: 1.5, marginBottom: 10, textAlign: 'center' }}>
            {v.hint} <span style={{ color: GOLD }}>Best for: {v.best}.</span>
          </div>
        )}
        {phase === 'ready' && (
          <button onClick={record} className="touch-press" style={CTA}>Record {CLIP_SECONDS}s clip</button>
        )}
        {phase === 'recording' && (
          <button onClick={stop} className="touch-press" style={{ ...CTA, background: 'rgba(225,75,75,0.2)', borderColor: 'rgba(225,75,75,0.5)', color: '#F2A0A0' }}>Stop early</button>
        )}
        {phase === 'result' && result && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setResult(null); setSaved(false); setPhase('ready') }} className="touch-press" style={{ ...CTA, flex: 1, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(232,193,90,0.25)', color: TXT2 }}>Film again</button>
            {result.detectable && !saved && (
              <button onClick={save} disabled={saving} className="touch-press" style={{ ...CTA, flex: 1, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save to timeline'}</button>
            )}
            {saved && <div style={{ ...CTA, flex: 1, borderColor: 'rgba(94,212,122,0.5)', color: '#5ED47A', textAlign: 'center', cursor: 'default' }}>On your timeline ✓</div>}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

