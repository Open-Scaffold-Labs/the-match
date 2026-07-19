import { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { post } from '../lib/api.js'
import { analyzeClip } from '../lib/swingTempo.mjs'
import { analyzeVideoBlob } from '../lib/swingCapture.mjs'
import { analyzeBatch } from '../lib/swingBatch.mjs'

// Archive Import — V3 onboarding hook (spec §Surfaces: "unclaimed in
// market"). Pick a stack of old range videos; every clip is analyzed
// ON-DEVICE (nothing uploads), grouped into sessions by capture date, and
// the measured facts build the Swing Timeline backwards through every era.
//
// Flow: pick → analyzing (per-clip progress) → review (sessions + honest
// skips) → save (POST /api/swing/import) → done.

const GOLD = 'var(--tm-gold)'
const GOLD_BRIGHT = '#F5D78A'
const TXT2 = 'var(--tm-dark-text-2)'
const CTA = {
  minHeight: 50, padding: '12px 20px', borderRadius: 12, cursor: 'pointer',
  background: 'rgba(201,160,64,0.18)', border: `1px solid ${GOLD}`,
  color: GOLD_BRIGHT, fontSize: 15, fontWeight: 800,
}

const ARCHIVE_MAX_CLIP_MS = 120_000 // archive clips aren't the 8s guided kind

export default function SwingImport({ onClose, onSaved }) {
  const [phase, setPhase] = useState('pick') // pick | analyzing | review | saving | done
  const [progress, setProgress] = useState({ done: 0, total: 0, file: '' })
  const [result, setResult] = useState(null)
  const [saveErr, setSaveErr] = useState(false)
  const inputRef = useRef(null)

  const start = useCallback(async (fileList) => {
    const files = [...fileList]
    if (!files.length) return
    setPhase('analyzing')
    setProgress({ done: 0, total: files.length, file: '' })
    const out = await analyzeBatch(files, {
      analyze: (blob, opts) => analyzeVideoBlob(blob, { maxClipMs: ARCHIVE_MAX_CLIP_MS, ...opts }),
      engine: analyzeClip,
      onProgress: (done, total, file) => setProgress({ done, total, file }),
    })
    setResult(out)
    setPhase('review')
  }, [])

  const save = useCallback(async () => {
    setPhase('saving')
    setSaveErr(false)
    try {
      await post('/api/swing/import', { sessions: result.sessions })
      setPhase('done')
      onSaved?.()
    } catch {
      setSaveErr(true)
      setPhase('review')
    }
  }, [result, onSaved])

  const measurable = result ? result.sessions.reduce((a, s) => a + s.swings.filter((w) => w.duration_ms != null).length, 0) : 0

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000, background: 'var(--tm-dark-0)',
      color: 'var(--tm-dark-text)', display: 'flex', flexDirection: 'column',
      padding: 'max(env(safe-area-inset-top), 14px) 16px max(env(safe-area-inset-bottom), 16px)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button onClick={onClose} aria-label="Close import" className="touch-press" style={{ background: 'none', border: 'none', color: GOLD_BRIGHT, fontSize: 15, fontWeight: 700, padding: 8, cursor: 'pointer' }}>✕</button>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>Swing Intelligence</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Import your archive</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {phase === 'pick' && (
          <div style={{ textAlign: 'center', paddingTop: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⛳</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Years of range videos, finally useful</div>
            <div style={{ fontSize: 13.5, color: TXT2, lineHeight: 1.7, maxWidth: 300, margin: '0 auto 24px' }}>
              Select old swing videos from your camera roll. The Match reads
              every tempo on-device — <em>nothing uploads</em> — and builds
              your Swing Timeline back through every era of your game.
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => start(e.target.files)}
            />
            <button onClick={() => inputRef.current?.click()} className="touch-press" style={CTA}>
              Choose videos
            </button>
            <div style={{ fontSize: 11.5, color: TXT2, marginTop: 14 }}>
              One swing per clip works best · clips stay on your phone
            </div>
          </div>
        )}

        {phase === 'analyzing' && (
          <div style={{ paddingTop: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Reading your archive…</div>
            <div style={{ fontSize: 13, color: TXT2, marginBottom: 20 }}>
              {progress.done} of {progress.total} · {progress.file}
            </div>
            <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', maxWidth: 280, margin: '0 auto' }}>
              <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, height: '100%', background: GOLD, transition: 'width 200ms ease' }} />
            </div>
            <div style={{ fontSize: 11.5, color: TXT2, marginTop: 16 }}>On-device — clips never leave your phone</div>
          </div>
        )}

        {(phase === 'review' || phase === 'saving') && result && (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              {measurable} swings read across {result.sessions.length} sessions
            </div>
            <div style={{ fontSize: 12.5, color: TXT2, marginBottom: 14 }}>
              {result.skipped.length > 0 && `${result.skipped.length} files skipped (reported below — never guessed). `}
              Review, then build your timeline.
            </div>
            {result.sessions.map((s) => (
              <div key={s.date} style={{ background: 'var(--tm-dark-1)', border: '1px solid rgba(232,193,90,0.14)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{s.date}</span>
                  <span style={{ fontSize: 12, color: TXT2 }}>{s.swings.length} swings</span>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                  {s.swings.map((w, i) => (
                    <span key={i} style={{ fontSize: 12, color: w.duration_ms != null ? GOLD_BRIGHT : TXT2 }}>
                      {w.duration_ms != null ? `${w.tempo_ratio}:1 · ${w.duration_ms}ms` : 'unreadable'}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {result.skipped.length > 0 && (
              <div style={{ fontSize: 12, color: TXT2, lineHeight: 1.7, marginTop: 10 }}>
                {result.skipped.map((s, i) => <div key={i}>• {s.file} — {s.reason.replace(/_/g, ' ')}</div>)}
              </div>
            )}
            {saveErr && <div style={{ fontSize: 13, color: '#F2A0A0', marginTop: 10 }}>Save failed — check your connection and try again.</div>}
          </div>
        )}

        {phase === 'done' && (
          <div style={{ textAlign: 'center', paddingTop: 48 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Your timeline goes back years</div>
            <div style={{ fontSize: 13, color: TXT2, lineHeight: 1.7, maxWidth: 300, margin: '0 auto' }}>
              {measurable} swings are on your Swing Timeline. Film fresh
              sessions and play rounds — the join unlocks as the weeks pair up.
            </div>
          </div>
        )}
      </div>

      {phase === 'review' && (
        <div style={{ display: 'flex', gap: 10, paddingTop: 12 }}>
          <button onClick={() => { setResult(null); setPhase('pick') }} className="touch-press" style={{ ...CTA, flex: 1, background: 'rgba(255,255,255,0.05)', color: TXT2 }}>Back</button>
          <button onClick={save} className="touch-press" style={{ ...CTA, flex: 2 }}>Build my timeline</button>
        </div>
      )}
      {phase === 'saving' && <div style={{ ...CTA, textAlign: 'center', opacity: 0.6, marginTop: 12, paddingTop: 14 }}>Saving…</div>}
      {phase === 'done' && (
        <button onClick={onClose} className="touch-press" style={{ ...CTA, marginTop: 12 }}>See my timeline</button>
      )}
    </div>,
    document.body
  )
}

