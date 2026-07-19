import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../lib/api.js'
import SwingCapture from './SwingCapture.jsx'
import SwingImport from './SwingImport.jsx'

// Swing Timeline — Swing Intelligence V0 surface (spec: wiki/synthesis/
// swing-intelligence-build-spec-2026-07-16.md §Surfaces).
//
// Longitudinal tempo view across every session: one point per session
// (median tempo ratio / duration), era bands behind the chart ("the
// flat-backswing era" — the archive-import hook no competitor has claimed),
// and ONE glanceable headline. Same doctrines as Practice:
//   • honesty — unmeasurable sessions render as hollow points, never
//     interpolated; eras only appear when the server detected a real shift
//   • dark Augusta-at-night instrument surface (matches Practice/Eagle Eye)
//   • portals to <body> (the pull-to-refresh container traps position:fixed)
//
// V0 note: tempo_ratio + duration_ms are the only measured dimensions (the
// tempo engine). Pose metrics join the same payload shape in V1 — the chart
// already tolerates null dimensions.

const GOLD = 'var(--tm-gold)'
const GOLD_BRIGHT = '#F5D78A'
const AMBER = '#E8A13C'
const TXT2 = 'var(--tm-dark-text-2)'

const CARD = (bg = 'var(--tm-dark-1)') => ({
  background: bg,
  border: '1px solid rgba(232,193,90,0.14)',
  borderRadius: 14,
  padding: '14px 16px',
})

function ChevronLeft({ size = 20, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
}

const ERA_TINTS = ['rgba(201,160,64,0.10)', 'rgba(94,212,122,0.08)', 'rgba(232,161,60,0.10)', 'rgba(122,162,255,0.08)']

export default function SwingTimeline({ onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [sel, setSel]         = useState(null)   // selected timeline point
  const [capture, setCapture] = useState(false)  // V1 guided capture overlay
  const [importOpen, setImportOpen] = useState(false) // V3 archive import

  const load = useCallback(async () => {
    try {
      setError(null)
      const [tl, jn] = await Promise.all([
        api('/api/swing/timeline'),
        api('/api/swing/join').catch(() => null), // join is additive; never block the timeline on it
      ])
      setData(jn ? { ...tl, join: jn } : tl)
    } catch { setError('We couldn’t load your swing timeline. Tap to retry.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const points = useMemo(() => (data?.timeline || []), [data])
  const measurable = useMemo(() => points.filter(p => p.measurable > 0 && p.median_tempo_ratio != null), [points])
  const eras = data?.eras || []

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'linear-gradient(180deg, var(--tm-dark-0) 0%, #0D1310 100%)',
      color: 'var(--tm-dark-text)',
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      padding: 'max(env(safe-area-inset-top), 14px) 16px max(env(safe-area-inset-bottom), 24px)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <button onClick={onClose} aria-label="Back" className="touch-press" style={{
          background: 'none', border: 'none', color: GOLD_BRIGHT, padding: 8, marginLeft: -8, cursor: 'pointer',
        }}>
          <ChevronLeft />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: GOLD, textTransform: 'uppercase' }}>Swing Intelligence</div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px' }}>Swing Timeline</div>
        </div>
        {measurable.length > 0 && (
          <button onClick={() => shareSummary(data)} className="touch-press" aria-label="Share swing summary with your coach" style={{
            minHeight: 44, padding: '0 14px', borderRadius: 12, cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(232,193,90,0.25)',
            color: TXT2, fontSize: 13, fontWeight: 700,
          }}>Share</button>
        )}
        <button onClick={() => setImportOpen(true)} className="touch-press" aria-label="Import archive videos" style={{
          minHeight: 44, padding: '0 14px', borderRadius: 12, cursor: 'pointer',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(232,193,90,0.25)',
          color: TXT2, fontSize: 13, fontWeight: 700,
        }}>Import</button>
        <button onClick={() => setCapture(true)} className="touch-press" style={{
          minHeight: 44, padding: '0 16px', borderRadius: 12, cursor: 'pointer',
          background: 'rgba(201,160,64,0.18)', border: `1px solid ${GOLD}`,
          color: GOLD_BRIGHT, fontSize: 13, fontWeight: 800,
        }}>Film a swing</button>
      </div>

      {loading && <div style={{ color: TXT2, padding: 24, textAlign: 'center' }}>Reading your sessions…</div>}

      {error && (
        <button onClick={() => { setLoading(true); load() }} style={{ ...CARD(), width: '100%', color: GOLD_BRIGHT, cursor: 'pointer', textAlign: 'center' }}>
          {error}
        </button>
      )}

      {!loading && !error && data && (
        <>
          {/* ONE headline, honest about sample size */}
          <div style={{ ...CARD(), marginBottom: 12 }}>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{data.headline?.text}</div>
            {data.headline && data.headline.confidence !== 'strong' && (
              <div style={{ fontSize: 11, color: TXT2, marginTop: 6, textTransform: 'uppercase', letterSpacing: 1.2 }}>
                {data.headline.confidence === 'insufficient' ? 'Building profile' : `${data.headline.confidence} read`}
              </div>
            )}
          </div>

          {/* Caddie narration — deterministic V0 narrator (LLM narrator
              consumes the same facts later). Silent below sample gates. */}
          {data.narration?.lines?.length > 0 && (
            <div style={{ ...CARD('var(--tm-dark-2)'), marginBottom: 12, borderLeft: `3px solid ${GOLD}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: GOLD, textTransform: 'uppercase', marginBottom: 6 }}>Caddie read</div>
              {data.narration.lines.map((l, i) => (
                <div key={i} style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: i < data.narration.lines.length - 1 ? 8 : 0 }}>{l}</div>
              ))}
            </div>
          )}
          {data.narration?.lines?.length === 0 && data.narration?.note && measurable.length > 0 && (
            <div style={{ fontSize: 12, color: TXT2, marginBottom: 12, padding: '0 4px' }}>{data.narration.note}</div>
          )}

          {/* V2 — THE JOIN: worth-strokes ranking. Association, never
              causation; gated to 'too_early' until the windows exist. */}
          {data.join && <JoinCard join={data.join} />}

          {measurable.length === 0 ? (
            <EmptyState onFilm={() => setCapture(true)} onImport={() => setImportOpen(true)} />
          ) : (
            <>
              {/* Tempo chart with era bands */}
              <div style={{ ...CARD(), marginBottom: 12, padding: '14px 10px 8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 6px 8px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: TXT2, textTransform: 'uppercase', letterSpacing: 1.2 }}>Tempo ratio</div>
                  <div style={{ fontSize: 11, color: TXT2 }}>backswing : downswing</div>
                </div>
                <TempoChart points={points} measurable={measurable} eras={eras} sel={sel} onSelect={setSel} />
                <div style={{ display: 'flex', gap: 14, padding: '6px 6px 4px', fontSize: 11, color: TXT2 }}>
                  <span><Dot color={GOLD_BRIGHT} /> session median</span>
                  <span><Dot color="transparent" hollow /> no measurable swing</span>
                  <span style={{ marginLeft: 'auto' }}>3.0:1 = Tour Tempo band</span>
                </div>
              </div>

              {/* Era chips */}
              {eras.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {eras.map((e, i) => (
                    <div key={i} style={{ ...CARD(), display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${i === eras.length - 1 ? GOLD : 'rgba(232,193,90,0.25)'}` }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: i === eras.length - 1 ? GOLD_BRIGHT : 'var(--tm-dark-text)' }}>{e.label}</div>
                        <div style={{ fontSize: 12, color: TXT2, marginTop: 2 }}>{e.from} → {e.to} · {e.points} sessions</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: AMBER }}>{e.median_tempo_ratio}:1</div>
                        {e.median_duration_ms && <div style={{ fontSize: 11, color: TXT2 }}>{e.median_duration_ms}ms</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Selected session detail / latest sessions list */}
              <div style={{ ...CARD('var(--tm-dark-2)') }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TXT2, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>
                  {sel ? `Session · ${sel.date}` : 'Sessions'}
                </div>
                {sel ? (
                  <SessionDetail p={sel} onClear={() => setSel(null)} />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {points.slice(-5).reverse().map((p) => (
                      <button key={p.session_id} onClick={() => setSel(p)} className="touch-press" style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(232,193,90,0.10)',
                        borderRadius: 10, padding: '10px 12px', color: 'inherit', cursor: 'pointer', textAlign: 'left',
                      }}>
                        <span style={{ fontSize: 13 }}>{p.date}{p.club_slot ? ` · ${p.club_slot}` : ''}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: p.measurable ? GOLD_BRIGHT : TXT2 }}>
                          {p.measurable ? `${p.median_tempo_ratio}:1 · ${p.median_duration_ms}ms` : 'unmeasurable'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
      {capture && (
        <SwingCapture onClose={() => setCapture(false)} onSaved={() => { setCapture(false); setLoading(true); load() }} />
      )}
      {importOpen && (
        <SwingImport onClose={() => setImportOpen(false)} onSaved={() => { setImportOpen(false); setLoading(true); load() }} />
      )}
    </div>,
    document.body
  )
}

// V3 coach-share export: a plain-text summary of the facts (eras, latest
// tempo, worth-strokes) via the native share sheet; clipboard fallback.
// Facts only — the same numbers the app shows, never extra claims.
function shareSummary(data) {
  const lines = ['The Match — Swing Summary', '']
  if (data.headline?.text) lines.push(data.headline.text)
  for (const e of data.eras || []) {
    lines.push(`• ${e.label}: ${e.median_tempo_ratio}:1 (${e.from} → ${e.to}, ${e.points} sessions)`)
  }
  const top = data.join?.worth_strokes?.top
  if (top) lines.push(`• Worth strokes: ${top.label} tracks with ${top.delta} strokes (association, not causation)`)
  const text = lines.join('\n')
  if (navigator.share) {
    navigator.share({ title: 'Swing Summary', text }).catch(() => {})
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {})
  }
}

// V2 worth-strokes card. Three honest states: gated (progress toward the
// window threshold), no-fault (splits formed but nothing tracks with lost
// strokes), and ranked (top fault + prescription). Always the disclaimer.
function JoinCard({ join }) {
  const ws = join.worth_strokes
  const corr = join.correlation
  if (!ws) return null

  if (ws.status === 'too_early') {
    return (
      <div style={{ ...CARD('var(--tm-dark-2)'), marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: GOLD, textTransform: 'uppercase', marginBottom: 6 }}>Swing × Score</div>
        <div style={{ fontSize: 13, color: TXT2, lineHeight: 1.6 }}>
          {ws.pairs || 0} of {ws.needed || 8} weeks with both a filmed session and a round.
          Then I can tell you which tempo habits track with your scoring.
        </div>
        <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.08)', marginTop: 10, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, ((ws.pairs || 0) / (ws.needed || 8)) * 100)}%`, height: '100%', background: GOLD, borderRadius: 99 }} />
        </div>
      </div>
    )
  }

  const top = ws.top
  const rx = join.prescription
  const strongest = corr?.correlations?.[0]
  return (
    <div style={{ ...CARD('var(--tm-dark-2)'), marginBottom: 12, borderLeft: `3px solid ${top ? AMBER : 'rgba(94,212,122,0.5)'}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: GOLD, textTransform: 'uppercase', marginBottom: 8 }}>Swing × Score · worth strokes</div>
      {top ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.4 }}>
            {top.label.replace(' windows', '')} tracks with <span style={{ color: AMBER }}>{top.delta} strokes</span> worse scoring
          </div>
          <div style={{ fontSize: 12, color: TXT2, marginTop: 4 }}>
            {top.sg_fault >= 0 ? '+' : ''}{top.sg_fault} SG in {top.fault_label} windows vs {top.sg_good >= 0 ? '+' : ''}{top.sg_good} in {top.good_label} windows
          </div>
          {rx && (
            <div style={{ marginTop: 10, background: 'rgba(201,160,64,0.10)', border: '1px solid rgba(201,160,64,0.25)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: GOLD_BRIGHT }}>{rx.drill}</div>
              <div style={{ fontSize: 12, color: TXT2, lineHeight: 1.55, marginTop: 4 }}>{rx.how}</div>
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          No tempo habit tracks with lost strokes right now{strongest ? ` — the strongest signal is ${strongest.metric_label} × ${strongest.sg_label} (r ${strongest.r}, ${strongest.strength})` : ''}. That\'s a good place to be.
        </div>
      )}
      <div style={{ fontSize: 11, color: 'rgba(232,237,234,0.45)', marginTop: 10, lineHeight: 1.5 }}>{ws.disclaimer}</div>
    </div>
  )
}

function Dot({ color, hollow }) {
  return <span style={{
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 5, verticalAlign: 'middle',
    background: hollow ? 'transparent' : color, border: hollow ? `1.5px solid ${TXT2}` : 'none',
  }} />
}

// Hand-rolled SVG chart (no chart lib in the bundle — matches the app's
// custom-SVG approach everywhere else). Era bands behind, Tour Tempo 3:1
// guide line, session points, tap-to-select.
function TempoChart({ points, measurable, eras, sel, onSelect }) {
  const W = 340, H = 170, PAD = { t: 14, r: 12, b: 22, l: 34 }
  if (!measurable.length) return null

  const dates = points.map(p => p.date)
  const ratios = measurable.map(p => p.median_tempo_ratio)
  const lo = Math.max(1.2, Math.min(...ratios) - 0.3)
  const hi = Math.min(4.6, Math.max(...ratios, 3.0) + 0.3)
  const x = (i) => PAD.l + (points.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (points.length - 1)) * (W - PAD.l - PAD.r))
  const y = (r) => PAD.t + (1 - (r - lo) / (hi - lo)) * (H - PAD.t - PAD.b)

  // Era bands: map each era's date span onto chart x-range.
  const idxOf = (date) => {
    let best = 0, bd = Infinity
    dates.forEach((d, i) => { const dd = Math.abs(new Date(d) - new Date(date)); if (dd < bd) { bd = dd; best = i } })
    return best
  }

  const pathPts = points.map((p, i) => (p.measurable && p.median_tempo_ratio != null) ? [x(i), y(p.median_tempo_ratio)] : null)
  // Line segments break at unmeasurable sessions — gaps, never interpolated.
  const segDs = []
  pathPts.forEach((pt, i) => {
    if (!pt) return
    const coord = `${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`
    if (i > 0 && pathPts[i - 1]) segDs[segDs.length - 1] += ` L ${coord}`
    else segDs.push(`M ${coord}`)
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} role="img" aria-label="Tempo ratio over time">
      {/* era bands */}
      {eras.map((e, k) => {
        const x0 = x(idxOf(e.from)) - 8, x1 = x(idxOf(e.to)) + 8
        return <rect key={k} x={Math.max(PAD.l - 4, x0)} y={PAD.t - 6} width={Math.min(W - PAD.r + 4, x1) - Math.max(PAD.l - 4, x0)} height={H - PAD.t - PAD.b + 12} fill={ERA_TINTS[k % ERA_TINTS.length]} rx={6} />
      })}
      {/* Tour Tempo 3:1 guide */}
      {3.0 > lo && 3.0 < hi && (
        <>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(3.0)} y2={y(3.0)} stroke="rgba(94,212,122,0.35)" strokeWidth="1" strokeDasharray="4 4" />
          <text x={W - PAD.r} y={y(3.0) - 4} textAnchor="end" fontSize="9" fill="rgba(94,212,122,0.6)">3:1</text>
        </>
      )}
      {/* ratio line segments */}
      {segDs.map((d, i) => <path key={i} d={d} fill="none" stroke={GOLD_BRIGHT} strokeWidth="2" strokeLinecap="round" />)}
      {/* session points */}
      {points.map((p, i) => {
        const okPt = p.measurable && p.median_tempo_ratio != null
        const cy = okPt ? y(p.median_tempo_ratio) : H - PAD.b + 6
        const isSel = sel && sel.session_id === p.session_id
        return (
          <g key={p.session_id} onClick={() => onSelect(isSel ? null : p)} style={{ cursor: 'pointer' }}>
            <circle cx={x(i)} cy={okPt ? cy : H - PAD.b + 6} r={isSel ? 7 : 5}
              fill={okPt ? (isSel ? AMBER : GOLD_BRIGHT) : 'transparent'}
              stroke={okPt ? 'none' : TXT2} strokeWidth="1.5" opacity={okPt ? 1 : 0.7} />
            {/* fat invisible hit target (44px doctrine) */}
            <rect x={x(i) - 16} y={0} width={32} height={H} fill="transparent" />
          </g>
        )
      })}
      {/* axis labels: first/last date */}
      <text x={PAD.l} y={H - 6} fontSize="9" fill={TXT2}>{dates[0]}</text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="9" fill={TXT2}>{dates[dates.length - 1]}</text>
      <text x={4} y={y(hi) + 10} fontSize="9" fill={TXT2}>{hi.toFixed(1)}</text>
      <text x={4} y={y(lo) + 3} fontSize="9" fill={TXT2}>{lo.toFixed(1)}</text>
    </svg>
  )
}

function SessionDetail({ p, onClear }) {
  const [ballOpen, setBallOpen] = useState(false)
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Stat label="Tempo" value={p.median_tempo_ratio != null ? `${p.median_tempo_ratio}:1` : '—'} />
        <Stat label="Duration" value={p.median_duration_ms != null ? `${p.median_duration_ms}ms` : '—'} />
        <Stat label="Consistency" value={p.consistency != null ? `${p.consistency}%` : '—'} />
        <Stat label="Swings" value={`${p.measurable}/${p.swings}`} />
      </div>
      {p.consistency == null && p.measurable > 0 && p.measurable < 3 && (
        <div style={{ fontSize: 12, color: TXT2, marginTop: 8 }}>
          Too few measurable swings for a consistency read — film a few more next session.
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={onClear} className="touch-press" style={{
          background: 'none', border: `1px solid rgba(232,193,90,0.3)`, borderRadius: 10,
          color: GOLD_BRIGHT, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 44,
        }}>All sessions</button>
        <button onClick={() => setBallOpen(o => !o)} className="touch-press" style={{
          background: 'none', border: '1px solid rgba(232,193,90,0.18)', borderRadius: 10,
          color: TXT2, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 44,
        }}>{ballOpen ? 'Hide monitor numbers' : '+ Monitor numbers'}</button>
      </div>
      {ballOpen && <BallDataForm sessionId={p.session_id} />}
    </div>
  )
}

// V3 optional monitor leg — manual quick-entry (spec §5 ladder: manual →
// CSV → Garmin API). Session-level pairing. Any subset of fields; the
// server rejects a fully-empty row.
const BALL_INPUTS = [
  ['club_speed', 'Club mph'], ['ball_speed', 'Ball mph'], ['smash', 'Smash'],
  ['launch_deg', 'Launch °'], ['spin', 'Spin rpm'], ['carry', 'Carry yds'], ['total', 'Total yds'],
]
function BallDataForm({ sessionId }) {
  const [vals, setVals] = useState({})
  const [state, setState] = useState('idle') // idle | saving | saved | err
  const set = (k) => (e) => setVals(v => ({ ...v, [k]: e.target.value }))
  const save = async () => {
    setState('saving')
    try {
      await post('/api/swing/ball-data', { session_id: sessionId, ...vals })
      setState('saved')
    } catch { setState('err') }
  }
  if (state === 'saved') return <div style={{ fontSize: 13, color: '#5ED47A', marginTop: 10 }}>Monitor numbers attached to this session ✓</div>
  return (
    <div style={{ marginTop: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(232,193,90,0.12)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 11, color: TXT2, marginBottom: 8 }}>Launch-monitor numbers from this session (any subset):</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {BALL_INPUTS.map(([k, label]) => (
          <label key={k} style={{ fontSize: 11, color: TXT2 }}>
            {label}
            <input
              inputMode="decimal" value={vals[k] || ''} onChange={set(k)}
              style={{
                width: '100%', marginTop: 3, padding: '8px 6px', borderRadius: 8, fontSize: 15,
                background: 'var(--tm-dark-1)', color: 'var(--tm-dark-text)',
                border: '1px solid rgba(232,193,90,0.2)', boxSizing: 'border-box',
              }}
            />
          </label>
        ))}
      </div>
      <button onClick={save} disabled={state === 'saving'} className="touch-press" style={{
        marginTop: 10, minHeight: 44, padding: '0 18px', borderRadius: 10, cursor: 'pointer',
        background: 'rgba(201,160,64,0.18)', border: `1px solid ${GOLD}`,
        color: GOLD_BRIGHT, fontSize: 13, fontWeight: 800, opacity: state === 'saving' ? 0.6 : 1,
      }}>{state === 'saving' ? 'Saving…' : 'Attach to session'}</button>
      {state === 'err' && <span style={{ fontSize: 12, color: '#F2A0A0', marginLeft: 10 }}>Save failed — try again.</span>}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, color: GOLD_BRIGHT }}>{value}</div>
      <div style={{ fontSize: 11, color: TXT2, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
    </div>
  )
}

// Empty state — TWO hooks: film one swing now (V1) or import the whole
// camera-roll archive (V3, the unclaimed-in-market onboarding).
function EmptyState({ onFilm, onImport }) {
  return (
    <div style={{ ...CARD(), textAlign: 'center', padding: '28px 20px' }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Your swing history starts here</div>
      <div style={{ fontSize: 13, color: TXT2, lineHeight: 1.6, marginBottom: 16 }}>
        Import years of range videos from your camera roll — read on-device,
        nothing uploads — and your timeline builds back through every era of
        your swing. Or film one swing on your next range visit.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button onClick={onImport} className="touch-press" style={{
          minHeight: 50, padding: '0 24px', borderRadius: 12, cursor: 'pointer',
          background: 'rgba(201,160,64,0.18)', border: `1px solid ${GOLD}`,
          color: GOLD_BRIGHT, fontSize: 14, fontWeight: 800,
        }}>Import my video archive</button>
        <button onClick={onFilm} className="touch-press" style={{
          minHeight: 50, padding: '0 24px', borderRadius: 12, cursor: 'pointer',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(232,193,90,0.25)',
          color: TXT2, fontSize: 14, fontWeight: 700,
        }}>Film your first swing</button>
      </div>
    </div>
  )
}
