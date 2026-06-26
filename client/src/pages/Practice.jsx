import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api.js'

// Practice — the data → practice loop (Leapfrog 3.5).
//
// Turns the player's logged rounds into a transparent weakness read + a
// benchmarked weekly session. Design principles from the competitive research:
//   • ONE glanceable headline (no post-round dashboard overload)
//   • every weakness shows the exact numbers behind it (radical transparency)
//   • every weakness maps to a benchmarked drill (never "data with no action")
//   • honest about score-only limits; confidence grows with sample size
//   • closed loop — we re-measure the same signals as more rounds land
//
// Dark Augusta-at-night instrument surface (matches Eagle Eye), full-screen
// overlay launched from the Profile view. Self-contained; fetches /api/practice.

const SEV = (s) => s >= 0.66 ? 'var(--tm-double)' : s >= 0.4 ? 'var(--tm-bogey)' : 'var(--tm-gold)'
const CONF_LABEL = {
  strong: 'Strong read', solid: 'Solid read', usable: 'Usable read',
  building: 'Early read', insufficient: 'Building profile',
}

export default function Practice({ onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    try { setError(null); const d = await api('/api/practice'); setData(d) }
    catch { setError('We couldn’t load your practice plan. Pull to retry.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Visibility-aware refetch — a backgrounded tab doesn't burn requests, but
  // jumps fresh on refocus (app convention).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
      background: 'var(--tm-dark-0)', color: 'var(--tm-dark-text)',
      display: 'flex', flexDirection: 'column',
      animation: 'tm-celebrate-pop 280ms var(--tm-ease-out) both',
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, paddingTop: 'calc(var(--safe-top) + 12px)',
        padding: 'calc(var(--safe-top) + 12px) 18px 12px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}>
        <button onClick={onClose} aria-label="Back" style={{
          width: 36, height: 36, borderRadius: 'var(--tm-radius-full)',
          background: 'var(--tm-dark-2)', border: '1px solid rgba(255,255,255,0.10)',
          color: 'var(--tm-dark-text)', fontSize: 18, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} className="touch-press">‹</button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.28em', fontWeight: 800,
            color: 'var(--tm-gold)', textTransform: 'uppercase',
          }}>The Match · Practice</div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em' }}>
            Your Focus Areas
          </div>
        </div>
        {data?.meta?.roundsAnalyzed > 0 && (
          <div style={{
            textAlign: 'right', fontSize: 10, color: 'var(--tm-dark-text-2)',
            lineHeight: 1.3,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--tm-dark-text)' }}>
              {CONF_LABEL[data.meta.confidence] || ''}
            </div>
            <div>{data.meta.roundsAnalyzed} round{data.meta.roundsAnalyzed === 1 ? '' : 's'}</div>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none',
        padding: '16px 18px calc(var(--safe-bottom) + 32px)',
      }}>
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && data && !data.ready && <BuildingState data={data} />}
        {!loading && !error && data && data.ready && <ReadyState data={data} />}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          height: i === 0 ? 96 : 120, borderRadius: 'var(--tm-radius-lg)',
          background: 'var(--tm-dark-1)', border: '1px solid rgba(255,255,255,0.05)',
          opacity: 1 - i * 0.18,
        }} />
      ))}
      <div style={{ textAlign: 'center', color: 'var(--tm-dark-text-2)', fontSize: 12, marginTop: 8 }}>
        Reading your rounds…
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px' }}>
      <div style={{ fontSize: 14, color: 'var(--tm-dark-text-2)', marginBottom: 16 }}>{message}</div>
      <button onClick={onRetry} className="touch-press" style={{
        padding: '10px 20px', borderRadius: 'var(--tm-radius-full)',
        background: 'var(--tm-green-bright)', color: '#fff', border: 'none',
        fontWeight: 700, fontSize: 14, cursor: 'pointer',
      }}>Try again</button>
    </div>
  )
}

function BuildingState({ data }) {
  const done = data.meta.roundsAnalyzed
  const need = Math.max(0, 3 - done)
  return (
    <div>
      <HeadlineCard headline={data.headline} severity={0.2} />
      <div style={{
        marginTop: 16, padding: 18, borderRadius: 'var(--tm-radius-lg)',
        background: 'var(--tm-dark-1)', border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--tm-dark-text-2)', marginBottom: 12, letterSpacing: '0.10em', textTransform: 'uppercase', fontWeight: 700 }}>
          Profile progress
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              flex: 1, height: 8, borderRadius: 'var(--tm-radius-full)',
              background: i < done ? 'var(--tm-gold)' : 'rgba(255,255,255,0.10)',
              transition: 'background 220ms var(--tm-ease-out)',
            }} />
          ))}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>
          {need === 0
            ? 'Crunching your rounds — refresh in a moment.'
            : `Log ${need} more complete round${need === 1 ? '' : 's'} and we’ll pinpoint exactly where you’re losing strokes — then build a session to win them back.`}
        </div>
      </div>
      <Disclaimer text={data.disclaimer} />
    </div>
  )
}

function ReadyState({ data }) {
  return (
    <div>
      <HeadlineCard headline={data.headline} severity={data.focus[0]?.severity ?? 0.2} />

      {/* Focus areas — the weaknesses we're acting on, each transparent. */}
      {data.focus.length > 0 && (
        <Section title="What to work on">
          {data.focus.map((f, i) => <WeaknessCard key={f.weaknessId} focus={f} rank={i + 1} />)}
        </Section>
      )}

      {/* Other signals we tracked but aren't prioritising (still transparent). */}
      {data.weaknesses.filter(w => !data.focus.some(f => f.weaknessId === w.id)).length > 0 && (
        <Section title="Also tracked">
          {data.weaknesses
            .filter(w => !data.focus.some(f => f.weaknessId === w.id))
            .map(w => (
              <div key={w.id} style={{
                padding: '12px 14px', borderRadius: 'var(--tm-radius)',
                background: 'var(--tm-dark-1)', border: '1px solid rgba(255,255,255,0.05)',
                marginBottom: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-dark-text)' }}>{w.label}</div>
                  <SeverityDot severity={w.severity} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--tm-dark-text-2)', marginTop: 4, lineHeight: 1.4 }}>{w.explanation}</div>
              </div>
            ))}
        </Section>
      )}

      {/* This week's session */}
      {data.session && data.session.blocks.length > 0 && (
        <Section title={`This week · ${data.session.totalMinutes} min`}>
          {data.session.blocks.map((b, i) => <SessionBlock key={i} block={b} />)}
          <div style={{
            marginTop: 4, padding: '12px 14px', borderRadius: 'var(--tm-radius)',
            background: 'rgba(27,94,59,0.18)', border: '1px solid rgba(46,158,69,0.30)',
            fontSize: 12.5, color: 'var(--tm-dark-text)', lineHeight: 1.5,
          }}>
            🔁 {data.session.note}
          </div>
        </Section>
      )}

      <Disclaimer text={data.disclaimer} />
    </div>
  )
}

function HeadlineCard({ headline, severity }) {
  return (
    <div style={{
      padding: 20, borderRadius: 'var(--tm-radius-lg)',
      background: 'linear-gradient(150deg, var(--tm-dark-2) 0%, var(--tm-dark-1) 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
    }}>
      <div style={{
        fontSize: 9, letterSpacing: '0.22em', fontWeight: 800,
        color: SEV(severity), textTransform: 'uppercase', marginBottom: 8,
      }}>Biggest opportunity</div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>
        {headline.title}
      </div>
      <div style={{ fontSize: 14, color: 'var(--tm-dark-text-2)', lineHeight: 1.5 }}>
        {headline.detail}
      </div>
    </div>
  )
}

function WeaknessCard({ focus, rank }) {
  return (
    <div style={{
      padding: 16, borderRadius: 'var(--tm-radius-lg)',
      background: 'var(--tm-dark-1)', border: '1px solid rgba(255,255,255,0.07)',
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 'var(--tm-radius-full)', flexShrink: 0,
          background: SEV(focus.severity), color: '#0A0E0C', fontSize: 12, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{rank}</div>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 800 }}>{focus.label}</div>
        <div style={{ fontSize: 10, color: 'var(--tm-dark-text-2)', fontWeight: 700 }}>
          {focus.allocationMinutes} min
        </div>
      </div>

      {/* Severity bar */}
      <div style={{ height: 6, borderRadius: 'var(--tm-radius-full)', background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{
          width: `${Math.round(focus.severity * 100)}%`, height: '100%',
          background: SEV(focus.severity), transition: 'width 320ms var(--tm-ease-out)',
        }} />
      </div>

      {/* Drills — each with its benchmarked target (the "pass/fail") */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--tm-gold)', fontWeight: 700 }}>
          {focus.categoryLabel}
        </div>
        {focus.drills.map(d => (
          <div key={d.id} style={{
            padding: '10px 12px', borderRadius: 'var(--tm-radius)',
            background: 'var(--tm-dark-2)', border: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{d.title}</div>
              <div style={{ fontSize: 10, color: 'var(--tm-dark-text-2)', flexShrink: 0 }}>{d.durationMin}m</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--tm-dark-text-2)', marginTop: 3, lineHeight: 1.4 }}>{d.why}</div>
            {d.target && (
              <div style={{
                marginTop: 6, display: 'inline-block', padding: '3px 9px',
                borderRadius: 'var(--tm-radius-full)', background: 'rgba(201,160,64,0.16)',
                border: '1px solid rgba(201,160,64,0.34)', color: 'var(--tm-gold-bright)',
                fontSize: 11, fontWeight: 700,
              }}>🎯 {d.target}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionBlock({ block }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 'var(--tm-radius)',
      background: 'var(--tm-dark-1)', border: '1px solid rgba(255,255,255,0.05)',
      marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        minWidth: 48, textAlign: 'center', padding: '6px 8px',
        borderRadius: 'var(--tm-radius-sm)', background: 'var(--tm-dark-3)',
        fontSize: 15, fontWeight: 900, color: 'var(--tm-gold-bright)',
      }}>
        {block.minutes}<span style={{ fontSize: 9, fontWeight: 600, color: 'var(--tm-dark-text-2)', display: 'block' }}>min</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{block.label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--tm-dark-text-2)', marginTop: 2 }}>
          {block.drills.map(d => d.title).join(' · ')}
        </div>
      </div>
    </div>
  )
}

function SeverityDot({ severity }) {
  return (
    <div style={{
      width: 10, height: 10, borderRadius: 'var(--tm-radius-full)', flexShrink: 0,
      background: SEV(severity), boxShadow: `0 0 8px ${SEV(severity)}`,
    }} />
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{
        fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
        fontWeight: 800, color: 'var(--tm-dark-text-2)', marginBottom: 12,
      }}>{title}</div>
      {children}
    </div>
  )
}

function Disclaimer({ text }) {
  return (
    <div style={{
      marginTop: 22, padding: '12px 14px', borderRadius: 'var(--tm-radius)',
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
      fontSize: 11, color: 'var(--tm-dark-text-2)', lineHeight: 1.5,
    }}>
      {text}
    </div>
  )
}
