import { useState, useEffect, useRef, useCallback } from 'react'
import { api, post } from '../lib/api.js'

const CLUBS = [
  { label: 'Dr', name: 'Driver' },
  { label: '3W', name: '3-Wood' },
  { label: '5W', name: '5-Wood' },
  { label: '3H', name: '3-Hybrid' },
  { label: '4H', name: '4-Hybrid' },
  { label: '4i', name: '4-Iron' },
  { label: '5i', name: '5-Iron' },
  { label: '6i', name: '6-Iron' },
  { label: '7i', name: '7-Iron' },
  { label: '8i', name: '8-Iron' },
  { label: '9i', name: '9-Iron' },
  { label: 'PW', name: 'Pitching Wedge' },
  { label: 'GW', name: 'Gap Wedge' },
  { label: 'SW', name: 'Sand Wedge' },
  { label: 'LW', name: 'Lob Wedge' },
  { label: 'Pt', name: 'Putter' },
]

const DEFAULT_PARS = [4,4,3,4,5,4,3,5,4, 4,4,3,4,5,4,3,5,4]

function scoreColor(strokes, par) {
  if (!strokes || !par) return 'var(--tm-text-2)'
  const d = strokes - par
  if (d <= -2) return 'var(--tm-eagle)'
  if (d === -1) return 'var(--tm-birdie)'
  if (d === 0)  return 'var(--tm-par)'
  if (d === 1)  return 'var(--tm-bogey)'
  return 'var(--tm-double)'
}
function scoreBadge(strokes, par) {
  if (!strokes || !par) return null
  const d = strokes - par
  if (d <= -2) return 'Eagle'
  if (d === -1) return 'Birdie'
  if (d === 0)  return 'Par'
  if (d === 1)  return 'Bogey'
  if (d === 2)  return 'Double'
  return `+${d}`
}

// ─── Setup Sheet ────────────────────────────────────────────────────────────
function SetupSheet({ onStart, onBack }) {
  const [courseName, setCourseName] = useState('')
  const [holes, setHoles] = useState(18)
  const [pars, setPars] = useState(DEFAULT_PARS.slice(0, 18))
  const [editPars, setEditPars] = useState(false)

  function togglePar(i) {
    const cycle = [3, 4, 5]
    setPars(p => { const n = [...p]; n[i] = cycle[(cycle.indexOf(p[i]) + 1) % 3]; return n })
  }
  const totalPar = pars.slice(0, holes).reduce((s, p) => s + p, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
        {onBack && (
          <button onClick={onBack} style={{
            background: 'none', border: 'none', color: 'var(--tm-text-3)',
            fontSize: 14, fontWeight: 600, padding: '0 0 12px 0', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            ← Back
          </button>
        )}
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--tm-gold-text)', marginBottom: 4 }}>Start Round</div>
        <div style={{ fontSize: 14, color: 'var(--tm-text-3)' }}>Set up your scorecard</div>
      </div>
      <div className="page-scroll" style={{ padding: '20px', gap: 16, display: 'flex', flexDirection: 'column' }}>
        {/* Course name */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Course</div>
          <input
            value={courseName}
            onChange={e => setCourseName(e.target.value)}
            placeholder="Course name (optional)"
            style={{ width: '100%', background: 'var(--tm-surface)', border: '1px solid var(--tm-border)', borderRadius: 'var(--tm-radius)', color: 'var(--tm-text)', fontSize: 16, padding: '12px 14px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        {/* Holes */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Holes</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[9, 18].map(h => (
              <button key={h} onClick={() => { setHoles(h); setPars(DEFAULT_PARS.slice(0, h)) }}
                style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--tm-radius)', border: '1px solid', borderColor: holes === h ? 'var(--tm-green)' : 'var(--tm-border)', background: holes === h ? 'var(--tm-green-muted)' : 'var(--tm-surface)', color: holes === h ? 'var(--tm-green-text)' : 'var(--tm-text-2)', fontWeight: 700, fontSize: 15 }}>
                {h} Holes
              </button>
            ))}
          </div>
        </div>
        {/* Par grid */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1 }}>Par ({totalPar})</div>
            <button onClick={() => setEditPars(e => !e)} style={{ fontSize: 12, color: 'var(--tm-gold-text)', background: 'none', border: 'none', fontWeight: 600 }}>
              {editPars ? 'Done' : 'Edit'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${holes === 9 ? 9 : 9}, 1fr)`, gap: 4 }}>
            {pars.slice(0, 9).map((p, i) => (
              <button key={i} onClick={() => editPars && togglePar(i)}
                style={{ aspectRatio: '1', borderRadius: 8, border: '1px solid var(--tm-border)', background: editPars ? 'var(--tm-surface-2)' : 'var(--tm-surface)', color: p === 3 ? 'var(--tm-birdie)' : p === 5 ? 'var(--tm-gold-text)' : 'var(--tm-text-2)', fontWeight: 700, fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.2 }}>
                <span style={{ fontSize: 9, opacity: 0.6 }}>{i+1}</span>
                {p}
              </button>
            ))}
          </div>
          {holes === 18 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 4, marginTop: 4 }}>
              {pars.slice(9, 18).map((p, i) => (
                <button key={i+9} onClick={() => editPars && togglePar(i+9)}
                  style={{ aspectRatio: '1', borderRadius: 8, border: '1px solid var(--tm-border)', background: editPars ? 'var(--tm-surface-2)' : 'var(--tm-surface)', color: p === 3 ? 'var(--tm-birdie)' : p === 5 ? 'var(--tm-gold-text)' : 'var(--tm-text-2)', fontWeight: 700, fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.2 }}>
                  <span style={{ fontSize: 9, opacity: 0.6 }}>{i+10}</span>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: '16px 20px', flexShrink: 0 }}>
        <button onClick={() => onStart({ courseName: courseName || 'Course', pars: pars.slice(0, holes) })}
          style={{ width: '100%', padding: '16px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))', color: '#fff', fontWeight: 800, fontSize: 17, border: 'none' }}>
          Tee It Up
        </button>
      </div>
    </div>
  )
}

// ─── Hole Scorer ─────────────────────────────────────────────────────────────
function HoleScorer({ hole, par, strokes, shots, onScore, onAddShot, gps, onNext, onPrev, isLast, holeCount }) {
  const [showClubs, setShowClubs] = useState(false)
  const badge = scoreBadge(strokes, par)
  const color = scoreColor(strokes, par)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Hole header */}
      <div style={{ padding: '16px 20px 12px', background: 'var(--tm-surface)', borderBottom: '1px solid var(--tm-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Hole</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--tm-text)', lineHeight: 1 }}>{hole}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Par</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: 'var(--tm-green-text)', lineHeight: 1 }}>{par}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Score</div>
            <div style={{ fontSize: 36, fontWeight: 900, color, lineHeight: 1 }}>{strokes || '—'}</div>
            {badge && <div style={{ fontSize: 11, color, fontWeight: 700 }}>{badge}</div>}
          </div>
        </div>
        {/* GPS distance display */}
        {gps && (
          <div style={{ marginTop: 10, padding: '6px 12px', background: 'var(--tm-surface-2)', borderRadius: 'var(--tm-radius-sm)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--tm-green-text)', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 12, color: 'var(--tm-text-2)', fontWeight: 600 }}>GPS Active</span>
            {gps.accuracy && <span style={{ fontSize: 11, color: 'var(--tm-text-3)' }}>±{Math.round(gps.accuracy)}m</span>}
          </div>
        )}
      </div>

      <div className="page-scroll" style={{ padding: '16px 20px', gap: 16, flex: 1 }}>
        {/* Stroke counter */}
        <div style={{ background: 'var(--tm-surface)', borderRadius: 'var(--tm-radius-lg)', padding: '20px', border: '1px solid var(--tm-border)' }}>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, marginBottom: 16, textAlign: 'center' }}>Strokes</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <button onClick={() => onScore(Math.max(1, (strokes || 0) - 1))}
              style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '2px solid var(--tm-border-2)', color: 'var(--tm-text)', fontSize: 28, fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
            <div style={{ minWidth: 60, textAlign: 'center' }}>
              <div style={{ fontSize: 56, fontWeight: 900, color, lineHeight: 1 }}>{strokes || 0}</div>
            </div>
            <button onClick={() => onScore((strokes || 0) + 1)}
              style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--tm-green-muted)', border: '2px solid var(--tm-green)', color: 'var(--tm-green-text)', fontSize: 28, fontWeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          </div>
          {/* Quick-tap par presets */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
            {[par-1, par, par+1, par+2].map(s => (
              <button key={s} onClick={() => s > 0 && onScore(s)}
                style={{ flex: 1, maxWidth: 60, padding: '8px 0', borderRadius: 'var(--tm-radius-sm)', border: '1px solid', borderColor: strokes === s ? scoreColor(s, par) : 'var(--tm-border)', background: strokes === s ? 'var(--tm-surface-3)' : 'var(--tm-surface-2)', color: scoreColor(s, par), fontWeight: 700, fontSize: 14 }}>
                {s > 0 ? s : '—'}
              </button>
            ))}
          </div>
        </div>

        {/* Shot log */}
        <div style={{ background: 'var(--tm-surface)', borderRadius: 'var(--tm-radius-lg)', border: '1px solid var(--tm-border)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--tm-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-2)' }}>Shot Log</div>
            <button onClick={() => setShowClubs(true)}
              style={{ padding: '6px 14px', borderRadius: 'var(--tm-radius-full)', background: 'var(--tm-gold-muted)', border: '1px solid var(--tm-gold-dim)', color: 'var(--tm-gold-text)', fontSize: 12, fontWeight: 700 }}>
              + Log Shot
            </button>
          </div>
          {shots.length === 0
            ? <div style={{ padding: '20px', textAlign: 'center', color: 'var(--tm-text-3)', fontSize: 13 }}>No shots logged yet</div>
            : shots.map((s, i) => (
              <div key={i} style={{ padding: '10px 16px', borderBottom: i < shots.length-1 ? '1px solid var(--tm-border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--tm-surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--tm-gold-text)' }}>{i+1}</div>
                  <span style={{ color: 'var(--tm-text)', fontWeight: 600, fontSize: 14 }}>{s.club}</span>
                </div>
                {s.dist && <span style={{ color: 'var(--tm-text-3)', fontSize: 13 }}>{s.dist}yd</span>}
              </div>
            ))
          }
        </div>
      </div>

      {/* Navigation */}
      <div style={{ padding: '12px 20px', flexShrink: 0, display: 'flex', gap: 12 }}>
        {hole > 1 && (
          <button onClick={onPrev}
            style={{ flex: 1, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'var(--tm-surface)', border: '1px solid var(--tm-border)', color: 'var(--tm-text-2)', fontWeight: 700, fontSize: 15 }}>
            ← H{hole-1}
          </button>
        )}
        <button onClick={onNext}
          style={{ flex: 2, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: isLast ? 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))' : 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))', color: isLast ? 'var(--tm-text-inv)' : '#fff', fontWeight: 800, fontSize: 15, border: 'none' }}>
          {isLast ? 'Finish Round' : `Hole ${hole+1} →`}
        </button>
      </div>

      {/* Club picker sheet */}
      {showClubs && <ClubSheet onSelect={club => { onAddShot({ club, dist: null, gps }); setShowClubs(false) }} onClose={() => setShowClubs(false)} />}
    </div>
  )
}

// ─── Club Sheet ───────────────────────────────────────────────────────────────
function ClubSheet({ onSelect, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--tm-text)' }}>Which club?</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 20 }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {CLUBS.map(c => (
            <button key={c.label} onClick={() => onSelect(c.label)}
              style={{ padding: '12px 4px', borderRadius: 'var(--tm-radius)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontWeight: 700, fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span>{c.label}</span>
              <span style={{ fontSize: 9, color: 'var(--tm-text-3)', fontWeight: 400 }}>{c.name.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Scorecard Summary ────────────────────────────────────────────────────────
function ScorecardSummary({ pars, scores, courseName, onSave, saving }) {
  const totalPar   = pars.reduce((s, p) => s + p, 0)
  const totalScore = scores.reduce((s, x) => s + (x || 0), 0)
  const diff       = totalScore - totalPar
  const diffLabel  = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`
  const diffColor  = diff < 0 ? 'var(--tm-birdie)' : diff === 0 ? 'var(--tm-par)' : 'var(--tm-bogey)'
  const front9Par  = pars.slice(0,9).reduce((s,p)=>s+p,0)
  const back9Par   = pars.slice(9).reduce((s,p)=>s+p,0)
  const front9     = scores.slice(0,9).reduce((s,x)=>s+(x||0),0)
  const back9      = scores.slice(9).reduce((s,x)=>s+(x||0),0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '24px 20px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginBottom: 4 }}>Round Complete</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--tm-text)', marginBottom: 2 }}>{courseName}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 56, fontWeight: 900, color: diffColor, lineHeight: 1 }}>{totalScore}</span>
          <span style={{ fontSize: 28, color: diffColor, fontWeight: 700 }}>{diffLabel}</span>
        </div>
      </div>

      <div className="page-scroll" style={{ padding: '16px 20px', gap: 12 }}>
        {/* Front / Back 9 split */}
        {pars.length === 18 && (
          <div style={{ display: 'flex', gap: 12 }}>
            {[['Front 9', front9, front9Par], ['Back 9', back9, back9Par]].map(([label, score, par]) => (
              <div key={label} style={{ flex: 1, background: 'var(--tm-surface)', borderRadius: 'var(--tm-radius-lg)', padding: '14px', border: '1px solid var(--tm-border)', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--tm-text-3)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor(score, par) }}>{score}</div>
                <div style={{ fontSize: 12, color: 'var(--tm-text-3)' }}>Par {par}</div>
              </div>
            ))}
          </div>
        )}

        {/* Hole-by-hole grid */}
        <div style={{ background: 'var(--tm-surface)', borderRadius: 'var(--tm-radius-lg)', border: '1px solid var(--tm-border)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--tm-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-2)' }}>Scorecard</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 2, padding: 8 }}>
            {pars.map((par, i) => {
              const s = scores[i] || 0
              const color = scoreColor(s, par)
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 2px', borderRadius: 8, background: s ? 'var(--tm-surface-2)' : 'transparent' }}>
                  <span style={{ fontSize: 9, color: 'var(--tm-text-3)', fontWeight: 600 }}>{i+1}</span>
                  <span style={{ fontSize: 11, color: 'var(--tm-text-3)' }}>P{par}</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color }}>{s || '—'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 20px', flexShrink: 0 }}>
        <button onClick={onSave} disabled={saving}
          style={{ width: '100%', padding: '16px', borderRadius: 'var(--tm-radius-lg)', background: saving ? 'var(--tm-surface-2)' : 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))', color: saving ? 'var(--tm-text-3)' : 'var(--tm-text-inv)', fontWeight: 800, fontSize: 17, border: 'none' }}>
          {saving ? 'Saving…' : '💾 Save Round'}
        </button>
      </div>
    </div>
  )
}

// ─── Main ActiveRound Component ───────────────────────────────────────────────
export default function ActiveRound({ user, onBack }) {
  const [phase, setPhase] = useState('setup') // 'setup' | 'scoring' | 'summary'
  const [config, setConfig] = useState(null)  // { courseName, pars[] }
  const [hole, setHole]     = useState(0)     // 0-indexed
  const [scores, setScores] = useState([])    // per-hole strokes
  const [shots, setShots]   = useState([])    // per-hole shot logs: [[{club,dist,gps}...]]
  const [gps, setGps]       = useState(null)
  const [saving, setSaving] = useState(false)
  const watchRef = useRef(null)

  // GPS watch
  useEffect(() => {
    if (!navigator.geolocation) return
    watchRef.current = navigator.geolocation.watchPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 }
    )
    return () => navigator.geolocation.clearWatch(watchRef.current)
  }, [])

  function handleStart({ courseName, pars }) {
    setConfig({ courseName, pars })
    setScores(new Array(pars.length).fill(0))
    setShots(new Array(pars.length).fill(null).map(() => []))
    setHole(0)
    setPhase('scoring')
  }

  function setScore(idx, val) {
    setScores(s => { const n = [...s]; n[idx] = val; return n })
  }

  function addShot(idx, shot) {
    setShots(sh => { const n = [...sh]; n[idx] = [...(n[idx] || []), { ...shot, ts: Date.now() }]; return n })
    // Bump stroke count with each shot if not already set
    setScores(s => { const n = [...s]; if (!n[idx]) n[idx] = 1; return n })
  }

  function nextHole() {
    if (hole < config.pars.length - 1) setHole(h => h + 1)
    else setPhase('summary')
  }

  async function saveRound() {
    if (!config) return
    setSaving(true)
    try {
      const totalPar = config.pars.reduce((s, p) => s + p, 0)
      await post('/api/rounds', {
        courseName:   config.courseName,
        coursePar:    totalPar,
        courseRating: null,
        slopeRating:  null,
        gameType:     'stroke',
        scores:       scores,
        shots:        shots,
      })
      // Reset and return to hub if launched from Outing tab
      setPhase('setup')
      setConfig(null)
      setHole(0)
      setScores([])
      setShots([])
      onBack?.()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  if (phase === 'setup') return <SetupSheet onStart={handleStart} onBack={onBack} />

  if (phase === 'summary') return (
    <ScorecardSummary
      pars={config.pars}
      scores={scores}
      courseName={config.courseName}
      onSave={saveRound}
      saving={saving}
    />
  )

  return (
    <HoleScorer
      hole={hole + 1}
      par={config.pars[hole]}
      strokes={scores[hole]}
      shots={shots[hole] || []}
      gps={gps}
      holeCount={config.pars.length}
      isLast={hole === config.pars.length - 1}
      onScore={val => setScore(hole, val)}
      onAddShot={shot => addShot(hole, shot)}
      onNext={nextHole}
      onPrev={() => setHole(h => Math.max(0, h - 1))}
    />
  )
}
