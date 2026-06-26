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
//
// Visual language (premium pass 2026-06-26): no emoji — crafted SVG glyphs on
// the 2px stroke system; weaknesses are framed as OPPORTUNITIES on a warm
// gold→amber ramp (never the red error/danger semantic); dark shimmer skeletons;
// inset top-rim highlight for "lit-from-above" elevation; sheet-up entrance.

// Opportunity ramp — warm, on-brand (trophy gold), encouraging. More severe =
// warmer amber; never red. Keeps a weakness reading as "your next gain", not
// "an error". (Research: avoid alarmist framing of weaknesses.)
const OPP = (s) => s >= 0.66 ? '#E8A13C' : s >= 0.4 ? 'var(--tm-gold)' : '#9A864F'
const CONF_LABEL = {
  strong: 'Strong read', solid: 'Solid read', usable: 'Usable read',
  building: 'Early read', insufficient: 'Building profile',
}

// ── crafted glyphs (2px stroke, matches the app icon system) ────────────────
function ChevronLeft({ size = 20, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}
function TargetGlyph({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.6" fill={color} />
    </svg>
  )
}
function LoopGlyph({ size = 15, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="21 3 21 9 15 9" /><polyline points="3 21 3 15 9 15" />
      <path d="M19.5 9A8 8 0 0 0 6 6.3L3 9" /><path d="M4.5 15A8 8 0 0 0 18 17.7l3-2.7" />
    </svg>
  )
}

export default function Practice({ onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    try { setError(null); const d = await api('/api/practice'); setData(d) }
    catch { setError('We couldn’t load your practice plan. Tap to retry.') }
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
      animation: 'tm-sheet-up 320ms var(--tm-ease-out) both',
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        padding: 'calc(var(--safe-top) + 12px) 18px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid var(--tm-dark-2)',
        background: 'linear-gradient(180deg, var(--tm-dark-1) 0%, var(--tm-dark-0) 100%)',
      }}>
        <button onClick={onClose} aria-label="Back" className="touch-press" style={{
          width: 40, height: 40, borderRadius: 'var(--tm-radius-full)',
          background: 'var(--tm-dark-2)', border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--tm-dark-text)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><ChevronLeft size={20} /></button>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.28em', fontWeight: 800,
            color: 'var(--tm-gold)', textTransform: 'uppercase',
          }}>The Match · Practice</div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 1 }}>
            Your Focus Areas
          </div>
        </div>
        {data?.meta?.roundsAnalyzed > 0 && (
          <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--tm-dark-text-2)', lineHeight: 1.35 }}>
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

// Inset top-rim highlight + tiered surface = "lit from above" dark elevation.
const CARD = (bg = 'var(--tm-dark-1)') => ({
  background: bg, border: '1px solid rgba(255,255,255,0.07)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
})

function Shimmer({ height, radius = 'var(--tm-radius-lg)', style }) {
  return (
    <div aria-hidden="true" style={{
      height, borderRadius: radius, background: 'var(--tm-dark-1)',
      position: 'relative', overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.05)', ...style,
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)',
        animation: 'tm-shimmer 1.4s ease-in-out infinite',
      }} />
    </div>
  )
}

function LoadingState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Shimmer height={104} />
      <Shimmer height={132} />
      <Shimmer height={132} />
      <div style={{ textAlign: 'center', color: 'var(--tm-dark-text-2)', fontSize: 12, marginTop: 4 }}>
        Reading your rounds…
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px' }}>
      <div style={{ fontSize: 14, color: 'var(--tm-dark-text-2)', marginBottom: 16, lineHeight: 1.5 }}>{message}</div>
      <button onClick={onRetry} className="touch-press" style={{
        padding: '11px 22px', borderRadius: 'var(--tm-radius-full)',
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
      <div style={{ marginTop: 16, padding: 18, borderRadius: 'var(--tm-radius-lg)', ...CARD() }}>
        <div style={{ fontSize: 11, color: 'var(--tm-dark-text-2)', marginBottom: 12, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
          Profile progress
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              flex: 1, height: 8, borderRadius: 'var(--tm-radius-full)',
              background: i < done ? 'var(--tm-gold)' : 'rgba(255,255,255,0.10)',
              boxShadow: i < done ? '0 0 10px rgba(201,160,64,0.45)' : 'none',
              transition: 'background 260ms var(--tm-ease-out)',
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
  const tracked = data.weaknesses.filter(w => !data.focus.some(f => f.weaknessId === w.id))
  return (
    <div>
      <HeadlineCard headline={data.headline} severity={data.focus[0]?.severity ?? 0.2} />

      {data.focus.length > 0 && (
        <Section title="What to work on">
          {data.focus.map((f, i) => <WeaknessCard key={f.weaknessId} focus={f} rank={i + 1} />)}
        </Section>
      )}

      {tracked.length > 0 && (
        <Section title="Also tracked">
          {tracked.map(w => (
            <div key={w.id} style={{ padding: '12px 14px', borderRadius: 'var(--tm-radius)', marginBottom: 8, ...CARD() }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-dark-text)' }}>{w.label}</div>
                <SeverityDot severity={w.severity} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--tm-dark-text-2)', marginTop: 4, lineHeight: 1.45 }}>{w.explanation}</div>
            </div>
          ))}
        </Section>
      )}

      {data.session && data.session.blocks.length > 0 && (
        <Section title={`This week · ${data.session.totalMinutes} min`}>
          {data.session.blocks.map((b, i) => <SessionBlock key={i} block={b} />)}
          <div style={{
            marginTop: 4, padding: '12px 14px', borderRadius: 'var(--tm-radius)',
            background: 'rgba(27,94,59,0.20)', border: '1px solid rgba(46,158,69,0.32)',
            fontSize: 12.5, color: 'var(--tm-dark-text)', lineHeight: 1.5,
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <span style={{ color: 'var(--tm-green-bright)', flexShrink: 0, marginTop: 1 }}><LoopGlyph size={15} /></span>
            <span>{data.session.note}</span>
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
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), var(--tm-shadow-lg)',
    }}>
      <div style={{
        fontSize: 9, letterSpacing: '0.22em', fontWeight: 800,
        color: OPP(severity), textTransform: 'uppercase', marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <TargetGlyph size={12} color={OPP(severity)} /> Biggest opportunity
      </div>
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
  const c = OPP(focus.severity)
  return (
    <div style={{ padding: 16, borderRadius: 'var(--tm-radius-lg)', marginBottom: 12, ...CARD() }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 'var(--tm-radius-full)', flexShrink: 0,
          background: c, color: '#0A0E0C', fontSize: 12, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{rank}</div>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 800 }}>{focus.label}</div>
        <div style={{ fontSize: 10, color: 'var(--tm-dark-text-2)', fontWeight: 700 }}>
          {focus.allocationMinutes} min
        </div>
      </div>

      <div style={{ height: 6, borderRadius: 'var(--tm-radius-full)', background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: `${Math.round(focus.severity * 100)}%`, height: '100%', background: c, transition: 'width 320ms var(--tm-ease-out)' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--tm-gold)', fontWeight: 700 }}>
          {focus.categoryLabel}
        </div>
        {focus.drills.map(d => (
          <div key={d.id} style={{ padding: '10px 12px', borderRadius: 'var(--tm-radius)', ...CARD('var(--tm-dark-2)') }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{d.title}</div>
              <div style={{ fontSize: 10, color: 'var(--tm-dark-text-2)', flexShrink: 0 }}>{d.durationMin}m</div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--tm-dark-text-2)', marginTop: 3, lineHeight: 1.45 }}>{d.why}</div>
            {d.target && (
              <div style={{
                marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '3px 9px 3px 7px', borderRadius: 'var(--tm-radius-full)',
                background: 'rgba(201,160,64,0.15)', border: '1px solid rgba(201,160,64,0.32)',
                color: 'var(--tm-gold-bright)', fontSize: 11, fontWeight: 700,
              }}><TargetGlyph size={11} color="var(--tm-gold-bright)" /> {d.target}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionBlock({ block }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 'var(--tm-radius)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, ...CARD() }}>
      <div style={{
        minWidth: 48, textAlign: 'center', padding: '6px 8px',
        borderRadius: 'var(--tm-radius-sm)', background: 'var(--tm-dark-3)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        fontSize: 16, fontWeight: 900, color: 'var(--tm-gold-bright)', lineHeight: 1,
      }}>
        {block.minutes}<span style={{ fontSize: 9, fontWeight: 600, color: 'var(--tm-dark-text-2)', display: 'block', marginTop: 2 }}>MIN</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{block.label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--tm-dark-text-2)', marginTop: 2, lineHeight: 1.4 }}>
          {block.drills.map(d => d.title).join(' · ')}
        </div>
      </div>
    </div>
  )
}

function SeverityDot({ severity }) {
  const c = OPP(severity)
  return <div style={{ width: 10, height: 10, borderRadius: 'var(--tm-radius-full)', flexShrink: 0, background: c, boxShadow: `0 0 8px ${c}` }} />
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 800, color: 'var(--tm-dark-text-2)', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

function Disclaimer({ text }) {
  return (
    <div style={{
      marginTop: 22, padding: '12px 14px', borderRadius: 'var(--tm-radius)',
      background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)',
      fontSize: 11, color: 'var(--tm-dark-text-2)', lineHeight: 1.5,
    }}>
      {text}
    </div>
  )
}
