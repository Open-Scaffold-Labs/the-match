import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../lib/api.js'

// Practice — the interactive data → practice loop (Leapfrog 3.5).
//
//   • ONE glanceable headline (no post-round dashboard overload)
//   • every weakness shows the exact numbers behind it (radical transparency)
//   • every drill is TAPPABLE → full how-to (setup, steps, scoring, target)
//   • a guided "Start session" runner walks the drills and logs each result
//   • the loop is CLOSED — logged results snapshot the weakness metric, and the
//     screen shows before → after once you've played more rounds
//   • honest about score-only limits; confidence grows with sample size
//
// Dark Augusta-at-night instrument surface (matches Eagle Eye). Portals to
// <body> (the tab content lives in a transformed pull-to-refresh container that
// would otherwise trap a position:fixed overlay).

const OPP = (s) => s >= 0.66 ? '#E8A13C' : s >= 0.4 ? 'var(--tm-gold)' : '#9A864F'
const CONF_LABEL = {
  strong: 'Strong read', solid: 'Solid read', usable: 'Usable read',
  building: 'Early read', insufficient: 'Building profile',
}

function ChevronLeft({ size = 20, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
}
function TargetGlyph({ size = 16, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6" fill={color}/></svg>
}
function LoopGlyph({ size = 15, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="21 3 21 9 15 9"/><polyline points="3 21 3 15 9 15"/><path d="M19.5 9A8 8 0 0 0 6 6.3L3 9"/><path d="M4.5 15A8 8 0 0 0 18 17.7l3-2.7"/></svg>
}
function CheckGlyph({ size = 16, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
}
function PlayGlyph({ size = 16, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" aria-hidden="true"><polygon points="6 4 20 12 6 20"/></svg>
}
function TrendGlyph({ size = 14, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>
}

const CARD = (bg = 'var(--tm-dark-1)') => ({
  background: bg, border: '1px solid rgba(255,255,255,0.07)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
})

export default function Practice({ onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [detail, setDetail]   = useState(null)   // { weaknessId, categoryLabel, drill }
  const [runner, setRunner]   = useState(false)  // guided session active
  const [logged, setLogged]   = useState(() => new Set()) // drillIds logged this visit

  const load = useCallback(async () => {
    try { setError(null); const d = await api('/api/practice'); setData(d) }
    catch { setError('We couldn’t load your practice plan. Tap to retry.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  const logDrill = useCallback(async (weaknessId, drill, passed) => {
    setLogged(prev => new Set(prev).add(drill.id))
    try {
      await post('/api/practice/log', { weaknessId, drillId: drill.id, target: drill.target, passed })
    } catch { /* optimistic — the check stays; a failed log is low-stakes */ }
  }, [])

  // Flatten the week's session into an ordered drill list for the runner —
  // every focus area's drills (carrying their weaknessId), then maintenance.
  const runnerSteps = useMemo(() => {
    if (!data?.ready) return []
    const steps = []
    for (const f of (data.focus || [])) {
      for (const d of f.drills) steps.push({ weaknessId: f.weaknessId, categoryLabel: f.categoryLabel, drill: d })
    }
    const maint = (data.session?.blocks || []).find(b => b.category === 'maintenance')
    if (maint) for (const d of maint.drills) steps.push({ weaknessId: 'maintenance', categoryLabel: maint.label, drill: d })
    return steps
  }, [data])

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--tm-dark-0)', color: 'var(--tm-dark-text)',
      display: 'flex', flexDirection: 'column',
      animation: 'tm-sheet-up 320ms var(--tm-ease-out) both',
    }}>
      <div style={{
        flexShrink: 0, padding: 'calc(var(--safe-top) + 12px) 18px 14px',
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
          <div style={{ fontSize: 9, letterSpacing: '0.28em', fontWeight: 800, color: 'var(--tm-gold)', textTransform: 'uppercase' }}>The Match · Practice</div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 1 }}>Your Focus Areas</div>
        </div>
        {data?.meta?.roundsAnalyzed > 0 && (
          <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--tm-dark-text-2)', lineHeight: 1.35 }}>
            <div style={{ fontWeight: 700, color: 'var(--tm-dark-text)' }}>{CONF_LABEL[data.meta.confidence] || ''}</div>
            <div>{data.meta.roundsAnalyzed} round{data.meta.roundsAnalyzed === 1 ? '' : 's'}</div>
          </div>
        )}
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none',
        padding: '16px 18px calc(var(--safe-bottom) + 32px)',
      }}>
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && data && !data.ready && <BuildingState data={data} />}
        {!loading && !error && data && data.ready && (
          <ReadyState data={data} logged={logged} onOpenDrill={setDetail} onStartSession={() => setRunner(true)} />
        )}
      </div>

      {detail && (
        <DrillDetailSheet
          step={detail} logged={logged.has(detail.drill.id)}
          onLog={(passed) => { logDrill(detail.weaknessId, detail.drill, passed); setDetail(null) }}
          onClose={() => setDetail(null)}
        />
      )}
      {runner && (
        <SessionRunner
          steps={runnerSteps}
          onLog={logDrill}
          onDone={() => { setRunner(false); load() }}
          onClose={() => setRunner(false)}
        />
      )}
    </div>,
    document.body
  )
}

function Shimmer({ height, radius = 'var(--tm-radius-lg)', style }) {
  return (
    <div aria-hidden="true" style={{ height, borderRadius: radius, background: 'var(--tm-dark-1)', position: 'relative', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)', ...style }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', animation: 'tm-shimmer 1.4s ease-in-out infinite' }} />
    </div>
  )
}
function LoadingState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Shimmer height={104} /><Shimmer height={132} /><Shimmer height={132} />
      <div style={{ textAlign: 'center', color: 'var(--tm-dark-text-2)', fontSize: 12, marginTop: 4 }}>Reading your rounds…</div>
    </div>
  )
}
function ErrorState({ message, onRetry }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px' }}>
      <div style={{ fontSize: 14, color: 'var(--tm-dark-text-2)', marginBottom: 16, lineHeight: 1.5 }}>{message}</div>
      <button onClick={onRetry} className="touch-press" style={{ padding: '11px 22px', borderRadius: 'var(--tm-radius-full)', background: 'var(--tm-green-bright)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Try again</button>
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
        <div style={{ fontSize: 11, color: 'var(--tm-dark-text-2)', marginBottom: 12, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>Profile progress</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ flex: 1, height: 8, borderRadius: 'var(--tm-radius-full)', background: i < done ? 'var(--tm-gold)' : 'rgba(255,255,255,0.10)', boxShadow: i < done ? '0 0 10px rgba(201,160,64,0.45)' : 'none', transition: 'background 260ms var(--tm-ease-out)' }} />
          ))}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>
          {need === 0 ? 'Crunching your rounds — refresh in a moment.' : `Log ${need} more complete round${need === 1 ? '' : 's'} and we’ll pinpoint exactly where you’re losing strokes — then build a session to win them back.`}
        </div>
      </div>
      <Disclaimer text={data.disclaimer} />
    </div>
  )
}

function ReadyState({ data, logged, onOpenDrill, onStartSession }) {
  const tracked = data.weaknesses.filter(w => !data.focus.some(f => f.weaknessId === w.id))
  return (
    <div>
      <HeadlineCard headline={data.headline} severity={data.focus[0]?.severity ?? 0.2} />

      {data.session && data.session.blocks.length > 0 && (
        <button onClick={onStartSession} className="touch-press" style={{
          width: '100%', marginTop: 14, padding: '15px 18px', cursor: 'pointer',
          borderRadius: 'var(--tm-radius-lg)', border: '1px solid rgba(46,158,69,0.45)',
          background: 'linear-gradient(135deg, var(--tm-green) 0%, #0F3D24 100%)',
          color: '#fff', display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
        }}>
          <div style={{ width: 38, height: 38, borderRadius: 'var(--tm-radius-full)', background: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <PlayGlyph size={16} color="#fff" />
          </div>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Start this week’s session</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', marginTop: 1 }}>{data.session.totalMinutes} min · guided, with check-off</div>
          </div>
        </button>
      )}

      {data.focus.length > 0 && (
        <Section title="What to work on">
          {data.focus.map((f, i) => (
            <WeaknessCard key={f.weaknessId} focus={f} rank={i + 1} logged={logged} onOpenDrill={onOpenDrill} />
          ))}
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
          <div style={{ marginTop: 4, padding: '12px 14px', borderRadius: 'var(--tm-radius)', background: 'rgba(27,94,59,0.20)', border: '1px solid rgba(46,158,69,0.32)', fontSize: 12.5, color: 'var(--tm-dark-text)', lineHeight: 1.5, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
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
    <div style={{ padding: 20, borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(150deg, var(--tm-dark-2) 0%, var(--tm-dark-1) 100%)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), var(--tm-shadow-lg)' }}>
      <div style={{ fontSize: 9, letterSpacing: '0.22em', fontWeight: 800, color: OPP(severity), textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <TargetGlyph size={12} color={OPP(severity)} /> Biggest opportunity
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8 }}>{headline.title}</div>
      <div style={{ fontSize: 14, color: 'var(--tm-dark-text-2)', lineHeight: 1.5 }}>{headline.detail}</div>
    </div>
  )
}

function ProgressPill({ progress }) {
  if (!progress) return null
  const good = progress.improved
  const c = good ? 'var(--tm-green-bright)' : 'var(--tm-dark-text-2)'
  return (
    <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 'var(--tm-radius)', background: good ? 'rgba(27,94,59,0.20)' : 'rgba(255,255,255,0.03)', border: `1px solid ${good ? 'rgba(46,158,69,0.32)' : 'rgba(255,255,255,0.06)'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: c, flexShrink: 0 }}><TrendGlyph size={14} color={c} /></span>
      <span style={{ fontSize: 12, color: 'var(--tm-dark-text)', lineHeight: 1.4 }}>
        <b style={{ fontWeight: 800 }}>{progress.label}</b>{' '}
        {progress.before} → {progress.after} {progress.unit}
        {good ? ' since you started practising this' : progress.unchanged ? ' — no change yet, keep at it' : ' — keep logging rounds'}
      </span>
    </div>
  )
}

function WeaknessCard({ focus, rank, logged, onOpenDrill }) {
  const c = OPP(focus.severity)
  return (
    <div style={{ padding: 16, borderRadius: 'var(--tm-radius-lg)', marginBottom: 12, ...CARD() }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ width: 22, height: 22, borderRadius: 'var(--tm-radius-full)', flexShrink: 0, background: c, color: '#0A0E0C', fontSize: 12, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{rank}</div>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 800 }}>{focus.label}</div>
        <div style={{ fontSize: 10, color: 'var(--tm-dark-text-2)', fontWeight: 700 }}>{focus.allocationMinutes} min</div>
      </div>
      <div style={{ height: 6, borderRadius: 'var(--tm-radius-full)', background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: `${Math.round(focus.severity * 100)}%`, height: '100%', background: c, transition: 'width 320ms var(--tm-ease-out)' }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--tm-gold)', fontWeight: 700 }}>{focus.categoryLabel}</div>
        {focus.drills.map(d => {
          const done = logged.has(d.id)
          return (
            <button key={d.id} onClick={() => onOpenDrill({ weaknessId: focus.weaknessId, categoryLabel: focus.categoryLabel, drill: d })} className="touch-press" style={{
              width: '100%', textAlign: 'left', cursor: 'pointer', padding: '10px 12px',
              borderRadius: 'var(--tm-radius)', ...CARD('var(--tm-dark-2)'),
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--tm-dark-text)' }}>{d.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--tm-dark-text-2)', flexShrink: 0 }}>{d.durationMin}m</div>
                </div>
                {d.target && (
                  <div style={{ marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px 3px 7px', borderRadius: 'var(--tm-radius-full)', background: 'rgba(201,160,64,0.15)', border: '1px solid rgba(201,160,64,0.32)', color: 'var(--tm-gold-bright)', fontSize: 11, fontWeight: 700 }}>
                    <TargetGlyph size={11} color="var(--tm-gold-bright)" /> {d.target}
                  </div>
                )}
              </div>
              {done
                ? <span style={{ color: 'var(--tm-green-bright)', flexShrink: 0 }}><CheckGlyph size={18} /></span>
                : <span style={{ color: 'var(--tm-dark-text-2)', flexShrink: 0, fontSize: 18 }}>›</span>}
            </button>
          )
        })}
      </div>

      <ProgressPill progress={focus.progress} />
    </div>
  )
}

function SessionBlock({ block }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 'var(--tm-radius)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, ...CARD() }}>
      <div style={{ minWidth: 48, textAlign: 'center', padding: '6px 8px', borderRadius: 'var(--tm-radius-sm)', background: 'var(--tm-dark-3)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)', fontSize: 16, fontWeight: 900, color: 'var(--tm-gold-bright)', lineHeight: 1 }}>
        {block.minutes}<span style={{ fontSize: 9, fontWeight: 600, color: 'var(--tm-dark-text-2)', display: 'block', marginTop: 2 }}>MIN</span>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{block.label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--tm-dark-text-2)', marginTop: 2, lineHeight: 1.4 }}>{block.drills.map(d => d.title).join(' · ')}</div>
      </div>
    </div>
  )
}

// Drill how-to: setup, steps, scoring, target + log buttons.
function DrillHowTo({ drill }) {
  return (
    <div>
      {drill.where && <Meta label="Where" value={drill.where} />}
      {drill.setup && <Meta label="Setup" value={drill.setup} />}
      {Array.isArray(drill.steps) && drill.steps.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <MetaLabel>How to do it</MetaLabel>
          <ol style={{ margin: '8px 0 0', paddingLeft: 0, listStyle: 'none', counterReset: 'step' }}>
            {drill.steps.map((s, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, fontSize: 13.5, lineHeight: 1.45, color: 'var(--tm-dark-text)' }}>
                <span style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 'var(--tm-radius-full)', background: 'var(--tm-dark-3)', color: 'var(--tm-gold-bright)', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {drill.scoring && <Meta label="Scoring" value={drill.scoring} />}
      {drill.target && (
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 'var(--tm-radius)', background: 'rgba(201,160,64,0.12)', border: '1px solid rgba(201,160,64,0.32)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <TargetGlyph size={16} color="var(--tm-gold-bright)" />
          <div><div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--tm-gold)', fontWeight: 700 }}>Your target</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--tm-gold-bright)' }}>{drill.target}</div></div>
        </div>
      )}
    </div>
  )
}
function MetaLabel({ children }) {
  return <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--tm-dark-text-2)', fontWeight: 700 }}>{children}</div>
}
function Meta({ label, value }) {
  return (
    <div style={{ marginTop: 14 }}>
      <MetaLabel>{label}</MetaLabel>
      <div style={{ fontSize: 13.5, color: 'var(--tm-dark-text)', marginTop: 4, lineHeight: 1.5 }}>{value}</div>
    </div>
  )
}

function LogButtons({ onLog, primaryLabel = 'Hit the target' }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <button onClick={() => onLog(true)} className="touch-press" style={{ flex: 1, padding: '13px', borderRadius: 'var(--tm-radius)', border: 'none', cursor: 'pointer', background: 'var(--tm-green-bright)', color: '#fff', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
        <CheckGlyph size={16} color="#fff" /> {primaryLabel}
      </button>
      <button onClick={() => onLog(false)} className="touch-press" style={{ flex: 1, padding: '13px', borderRadius: 'var(--tm-radius)', cursor: 'pointer', background: 'var(--tm-dark-2)', color: 'var(--tm-dark-text)', border: '1px solid rgba(255,255,255,0.10)', fontSize: 14, fontWeight: 700 }}>
        Not yet
      </button>
    </div>
  )
}

// Bottom-sheet drill detail (tap a drill).
function DrillDetailSheet({ step, logged, onLog, onClose }) {
  const { drill, categoryLabel } = step
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', animation: 'tm-sheet-up 220ms var(--tm-ease-out) both' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--tm-dark-1)', borderTopLeftRadius: 'var(--tm-radius-xl)', borderTopRightRadius: 'var(--tm-radius-xl)', borderTop: '1px solid rgba(255,255,255,0.10)', maxHeight: '88%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px 10px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '0 auto 14px' }} />
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--tm-gold)', fontWeight: 700 }}>{categoryLabel}</div>
          <div style={{ fontSize: 19, fontWeight: 800, marginTop: 3, lineHeight: 1.2 }}>{drill.title}</div>
          <div style={{ fontSize: 13, color: 'var(--tm-dark-text-2)', marginTop: 6, lineHeight: 1.5 }}>{drill.why}</div>
        </div>
        <div style={{ padding: '0 18px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <DrillHowTo drill={drill} />
        </div>
        <div style={{ padding: '14px 18px calc(var(--safe-bottom) + 16px)', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 12 }}>
          {logged
            ? <div style={{ textAlign: 'center', color: 'var(--tm-green-bright)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '4px 0' }}><CheckGlyph size={16} color="var(--tm-green-bright)" /> Logged — nice work</div>
            : <><div style={{ fontSize: 12, color: 'var(--tm-dark-text-2)', marginBottom: 10, textAlign: 'center' }}>Done practising? Log how it went.</div><LogButtons onLog={onLog} /></>}
        </div>
      </div>
    </div>
  )
}

// Guided session runner — step through every drill with check-off.
function SessionRunner({ steps, onLog, onDone, onClose }) {
  const [i, setI] = useState(0)
  const [hits, setHits] = useState(0)
  const total = steps.length
  const finished = i >= total

  const handle = (passed) => {
    const s = steps[i]
    onLog(s.weaknessId, s.drill, passed)
    if (passed) setHits(h => h + 1)
    setI(n => n + 1)
  }

  if (total === 0) { onClose(); return null }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--tm-dark-0)', display: 'flex', flexDirection: 'column', animation: 'tm-sheet-up 240ms var(--tm-ease-out) both' }}>
      <div style={{ flexShrink: 0, padding: 'calc(var(--safe-top) + 12px) 18px 12px', borderBottom: '1px solid var(--tm-dark-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button onClick={onClose} aria-label="Close session" className="touch-press" style={{ width: 36, height: 36, borderRadius: 'var(--tm-radius-full)', background: 'var(--tm-dark-2)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--tm-dark-text)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--tm-dark-text)' }}>
            {finished ? 'Session complete' : `Drill ${i + 1} of ${total}`}
          </div>
        </div>
        <div style={{ height: 6, borderRadius: 'var(--tm-radius-full)', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
          <div style={{ width: `${Math.round((Math.min(i, total) / total) * 100)}%`, height: '100%', background: 'var(--tm-green-bright)', transition: 'width 320ms var(--tm-ease-out)' }} />
        </div>
      </div>

      {!finished ? (
        <>
          <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '18px 18px 8px' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--tm-gold)', fontWeight: 700 }}>{steps[i].categoryLabel}</div>
            <div style={{ fontSize: 21, fontWeight: 800, marginTop: 3, lineHeight: 1.2 }}>{steps[i].drill.title}</div>
            <div style={{ fontSize: 13, color: 'var(--tm-dark-text-2)', marginTop: 6, lineHeight: 1.5 }}>{steps[i].drill.why}</div>
            <DrillHowTo drill={steps[i].drill} />
          </div>
          <div style={{ flexShrink: 0, padding: '14px 18px calc(var(--safe-bottom) + 16px)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 12, color: 'var(--tm-dark-text-2)', marginBottom: 10, textAlign: 'center' }}>Did you hit the target?</div>
            <LogButtons onLog={handle} primaryLabel="Hit it" />
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: 'var(--tm-radius-full)', background: 'rgba(27,94,59,0.25)', border: '1px solid rgba(46,158,69,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
            <CheckGlyph size={34} color="var(--tm-green-bright)" />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>Session done</div>
          <div style={{ fontSize: 15, color: 'var(--tm-dark-text-2)', marginTop: 8, lineHeight: 1.5, maxWidth: 280 }}>
            You hit <b style={{ color: 'var(--tm-gold-bright)', fontWeight: 800 }}>{hits} of {total}</b> targets. Logged to your record — play a few rounds and we’ll show whether your focus areas moved.
          </div>
          <button onClick={onDone} className="touch-press" style={{ marginTop: 26, padding: '13px 28px', borderRadius: 'var(--tm-radius-full)', border: 'none', cursor: 'pointer', background: 'var(--tm-green-bright)', color: '#fff', fontSize: 15, fontWeight: 800 }}>Done</button>
        </div>
      )}
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
    <div style={{ marginTop: 22, padding: '12px 14px', borderRadius: 'var(--tm-radius)', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)', fontSize: 11, color: 'var(--tm-dark-text-2)', lineHeight: 1.5 }}>{text}</div>
  )
}
