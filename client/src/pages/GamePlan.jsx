// Game Day Strategy (GamePlan) — Phase 0 client.
// (wiki/synthesis/gameday-strategy-build-spec-2026-07-15.md)
//
// Full-screen overlay in the Practice/Caddie pattern: portals to <body>,
// dark Augusta shell. Flow: pick course (debounced /api/courses/search →
// /api/courses/:id for tees) → pick tee + game mode → POST /api/gameplan →
// hole-by-hole cards under a front-page summary. Reopening shows the most
// recent stored plan (/api/gameplan/latest) so the night-before plan is one
// tap away on the first tee.

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../lib/api.js'

function ChevronLeft({ size = 20, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
}
function FlagGlyph({ size = 16, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="21" x2="5" y2="3"/><path d="M5 4h13l-3 4 3 4H5"/></svg>
}

const MODES = [
  { key: 'medal', label: 'Medal', hint: 'Protect the card' },
  { key: 'net', label: 'Net match', hint: 'Win holes with your strokes' },
  { key: 'money', label: 'Money game', hint: 'Play the bet' },
]

const S = {
  label: { fontSize: 9, letterSpacing: '0.28em', fontWeight: 800, color: 'var(--tm-gold)', textTransform: 'uppercase' },
  card: {
    borderRadius: 14, padding: '14px 16px', marginBottom: 10,
    background: 'var(--tm-dark-1)', border: '1px solid rgba(255,255,255,0.07)',
  },
  input: {
    width: '100%', padding: '12px 14px', borderRadius: 12, fontSize: 15,
    background: 'var(--tm-dark-1)', border: '1px solid rgba(255,255,255,0.12)',
    color: 'var(--tm-dark-text)', outline: 'none',
  },
}

export default function GamePlan({ onClose }) {
  // step: 'latest' (stored plan or picker) | 'tee' | 'plan'
  const [latest, setLatest] = useState(undefined)   // undefined=loading, null=none
  const [plan, setPlan] = useState(null)            // the plan being viewed
  const [picking, setPicking] = useState(false)     // course picker open

  // Course search (CoursePicker pattern: geolocate once, 250ms debounce, 2+ chars)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState(null)
  const coordsRef = useRef(null)
  // Tee step
  const [course, setCourse] = useState(null)        // /api/courses/:id detail
  const [loadingCourse, setLoadingCourse] = useState(false)
  const [gender, setGender] = useState('male')
  const [mode, setMode] = useState('medal')
  const [notes, setNotes] = useState('') // golfer's self-report (2026-07-15)
  const [generating, setGenerating] = useState(false)
  const [genErr, setGenErr] = useState(null)

  useEffect(() => {
    api('/api/gameplan/latest')
      .then(d => { setLatest(d); if (d) setPlan(d) })
      .catch(() => setLatest(null))
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => { coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude } },
      () => { /* search works without location */ },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60 * 1000 }
    )
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); setSearchErr(null); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q })
        const c = coordsRef.current
        if (c) { params.set('lat', String(c.lat)); params.set('lng', String(c.lng)) }
        const r = await api(`/api/courses/search?${params.toString()}`)
        setResults(Array.isArray(r?.courses) ? r.courses : [])
        setSearchErr(null)
      } catch { setResults([]); setSearchErr('Course search is unavailable — try again shortly.') }
      finally { setSearching(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const selectCourse = useCallback(async (c) => {
    setLoadingCourse(true)
    try {
      const detail = await api(`/api/courses/${c.id}`)
      setCourse(detail)
    } catch { setSearchErr('Couldn’t load that course — try another.') }
    finally { setLoadingCourse(false) }
  }, [])

  async function generate(tee) {
    setGenerating(true)
    setGenErr(null)
    try {
      const holes = (tee.holes || []).map((h) => ({ hole: h.hole, par: h.par, yardage: h.yardage, handicap: h.handicap }))
      const d = await post('/api/gameplan', {
        courseId: course.id,
        courseName: course.club_name || course.course_name,
        teeName: tee.tee_name, gender, mode,
        courseRating: tee.course_rating, slopeRating: tee.slope_rating, coursePar: tee.par_total,
        playerNotes: notes.trim() || undefined,
        holes,
      })
      setPlan(d)
      setLatest(d)
      setPicking(false)
      setCourse(null)
      setQuery('')
    } catch (e) {
      setGenErr(e?.message?.includes('429') ? 'The caddie is still working — give it a few minutes.' : 'Couldn’t build the plan — try again.')
    } finally { setGenerating(false) }
  }

  const showPicker = picking || (latest === null && !plan)

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
        <button onClick={course ? () => setCourse(null) : onClose} aria-label="Back" className="touch-press" style={{
          width: 40, height: 40, borderRadius: 'var(--tm-radius-full)',
          background: 'var(--tm-dark-2)', border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--tm-dark-text)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><ChevronLeft size={20} /></button>
        <div style={{ flex: 1 }}>
          <div style={S.label}>The Match · GamePlan</div>
          <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 1 }}>
            {course ? (course.club_name || course.course_name) : 'Game Day Strategy'}
          </div>
        </div>
        {plan && !showPicker && (
          <button onClick={() => setPicking(true)} className="touch-press" style={{
            padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 800,
            background: 'rgba(201,160,64,0.15)', border: '1px solid rgba(201,160,64,0.35)',
            color: '#F5D78A', cursor: 'pointer',
          }}>New plan</button>
        )}
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch', overscrollBehavior: 'none',
        padding: '16px 18px calc(var(--safe-bottom) + 32px)',
      }}>
        {latest === undefined && <div style={{ ...S.card, color: 'var(--tm-dark-text-2)' }}>Checking for your latest plan…</div>}

        {/* ── Course picker ── */}
        {latest !== undefined && showPicker && !course && (
          <>
            <div style={{ ...S.label, marginBottom: 8 }}>Where are you playing?</div>
            <input
              style={S.input} value={query} placeholder="Search your course"
              onChange={e => setQuery(e.target.value)} autoFocus
            />
            {searching && <div style={{ padding: '10px 2px', fontSize: 12.5, color: 'var(--tm-dark-text-2)' }}>Searching…</div>}
            {searchErr && <div style={{ padding: '10px 2px', fontSize: 12.5, color: '#E08A8A' }}>{searchErr}</div>}
            <div style={{ marginTop: 10 }}>
              {results.map(c => (
                <button key={c.id} onClick={() => selectCourse(c)} className="touch-press" style={{
                  ...S.card, width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--tm-dark-text)',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <FlagGlyph size={15} color="var(--tm-gold)" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700 }}>{c.club_name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--tm-dark-text-2)', marginTop: 1 }}>
                      {[c.city, c.state].filter(Boolean).join(', ')}
                      {c.distance_km != null && ` · ${Math.round(c.distance_km * 0.621)} mi`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {loadingCourse && <div style={{ padding: '10px 2px', fontSize: 12.5, color: 'var(--tm-dark-text-2)' }}>Loading course…</div>}
          </>
        )}

        {/* ── Tee + mode → generate ── */}
        {course && (
          <>
            <div style={{ ...S.label, marginBottom: 8 }}>Game mode</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              {MODES.map(m => (
                <button key={m.key} onClick={() => setMode(m.key)} className="touch-press" style={{
                  flex: 1, padding: '10px 6px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                  background: mode === m.key ? 'rgba(201,160,64,0.18)' : 'var(--tm-dark-1)',
                  border: mode === m.key ? '1.5px solid rgba(201,160,64,0.55)' : '1px solid rgba(255,255,255,0.09)',
                  color: mode === m.key ? '#F5D78A' : 'var(--tm-dark-text)',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--tm-dark-text-2)', marginTop: 2 }}>{m.hint}</div>
                </button>
              ))}
            </div>
            {/* Self-report (2026-07-15): "how are you hitting it lately?"
                asked BEFORE the plan runs — tonight's words outrank stored
                tendencies, and they drive the warm-up prescription. */}
            <div style={{ ...S.label, marginBottom: 8 }}>How&rsquo;s your game lately? <span style={{ opacity: 0.55, letterSpacing: 0, textTransform: 'none', fontWeight: 600 }}>(optional — the caddie plans around it)</span></div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value.slice(0, 400))}
              placeholder="e.g. I've been hooking my driver lately, and my chipping has felt great"
              rows={3}
              style={{ ...S.input, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, marginBottom: 18 }}
            />
            <div style={{ ...S.label, marginBottom: 8 }}>Pick your tee</div>
            {['male', 'female'].map(g => (course.tees?.[g] || []).length > 0 && (
              <div key={g} style={{ marginBottom: 6 }}>
                {(course.tees[g] || []).map((t, i) => (
                  <button key={`${g}-${i}`} disabled={generating} className="touch-press"
                    onClick={() => { setGender(g); generate(t) }} style={{
                      ...S.card, width: '100%', textAlign: 'left', color: 'var(--tm-dark-text)',
                      cursor: generating ? 'default' : 'pointer', opacity: generating ? 0.55 : 1,
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{t.tee_name}{g === 'female' ? ' (W)' : ''}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--tm-dark-text-2)', marginTop: 1 }}>
                        {t.total_yards ? `${t.total_yards} yds · ` : ''}par {t.par_total ?? '—'}
                        {t.course_rating ? ` · ${t.course_rating}/${t.slope_rating}` : ''}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--tm-gold)' }}>BUILD →</span>
                  </button>
                ))}
              </div>
            ))}
            {generating && <div style={{ ...S.card, color: '#F5D78A', fontSize: 13 }}>The caddie is marking up your yardage book…</div>}
            {genErr && <div style={{ padding: '10px 2px', fontSize: 12.5, color: '#E08A8A' }}>{genErr}</div>}
          </>
        )}

        {/* ── The plan ── */}
        {plan && !showPicker && !course && <PlanView data={plan} />}
      </div>
    </div>,
    document.body
  )
}

function PlanView({ data }) {
  const { plan, facts, courseName, teeName, mode, createdAt } = data
  const decisive = new Set(plan?.summary?.decisiveHoles ?? [])
  const when = createdAt ? new Date(createdAt) : null
  return (
    <>
      <div style={{ marginBottom: 4, fontSize: 11.5, color: 'var(--tm-dark-text-2)' }}>
        {courseName}{teeName ? ` · ${teeName} tees` : ''} · {MODES.find(m => m.key === mode)?.label ?? mode}
        {when ? ` · ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
        {facts?.courseHandicap != null && ` · CH ${facts.courseHandicap}`}
      </div>

      <div style={{
        borderRadius: 16, padding: '16px 18px', marginBottom: 14,
        background: 'linear-gradient(135deg, rgba(201,160,64,0.14) 0%, rgba(255,255,255,0.03) 70%)',
        border: '1px solid rgba(201,160,64,0.30)',
      }}>
        <div style={{ ...S.label, marginBottom: 6 }}>Tonight&rsquo;s read</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>{plan?.summary?.headline}</div>
        {plan?.summary?.leak && (
          <div style={{ fontSize: 12.5, color: 'var(--tm-dark-text-2)', marginTop: 8 }}>
            <span style={{ color: '#F5D78A', fontWeight: 800 }}>The leak to watch: </span>{plan.summary.leak}
          </div>
        )}
        {decisive.size > 0 && (
          <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--tm-dark-text-2)' }}>
            <span style={{ color: '#F5D78A', fontWeight: 800 }}>Decisive holes: </span>
            {[...decisive].join(' · ')}
          </div>
        )}
        {plan?.summary?.expectedRange && (
          <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--tm-dark-text-2)' }}>
            <span style={{ color: '#F5D78A', fontWeight: 800 }}>Expected: </span>{plan.summary.expectedRange}
          </div>
        )}
      </div>

      {/* Warm-up prescription (2026-07-15) — what to hit on the range before
          the round, grounded in the golfer's own self-report. */}
      {plan?.warmup?.focus && (
        <div style={{
          borderRadius: 16, padding: '16px 18px', marginBottom: 14,
          background: 'linear-gradient(135deg, rgba(42,122,56,0.18) 0%, rgba(255,255,255,0.03) 70%)',
          border: '1px solid rgba(42,122,56,0.4)',
        }}>
          <div style={{ ...S.label, marginBottom: 6, color: '#9FD8A8' }}>On the range first</div>
          <div style={{ fontSize: 14, lineHeight: 1.55 }}>{plan.warmup.focus}</div>
          {(plan.warmup.keys ?? []).length > 0 && (
            <div style={{ marginTop: 8 }}>
              {plan.warmup.keys.map((k, i) => (
                <div key={i} style={{ fontSize: 12.5, color: 'var(--tm-dark-text-2)', marginTop: 4, display: 'flex', gap: 8 }}>
                  <span style={{ color: '#9FD8A8', fontWeight: 900 }}>{i + 1}.</span>
                  <span>{k}</span>
                </div>
              ))}
            </div>
          )}
          {plan.warmup.inRound && (
            <div style={{ fontSize: 12.5, marginTop: 10, color: 'var(--tm-dark-text-2)' }}>
              <span style={{ color: '#9FD8A8', fontWeight: 800 }}>If it shows up mid-round: </span>{plan.warmup.inRound}
            </div>
          )}
        </div>
      )}

      {(plan?.holes ?? []).map(h => (
        <div key={h.hole} style={{
          ...S.card,
          border: decisive.has(h.hole) ? '1px solid rgba(201,160,64,0.45)' : S.card.border,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: decisive.has(h.hole) ? '#F5D78A' : 'var(--tm-dark-text)' }}>{h.hole}</div>
            <div style={{ fontSize: 11.5, color: 'var(--tm-dark-text-2)' }}>
              par {h.par}{h.yards ? ` · ${h.yards}y` : ''}{h.si ? ` · SI ${h.si}` : ''}
            </div>
            {h.netStroke > 0 && (
              <span style={{
                marginLeft: 'auto', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em',
                padding: '3px 8px', borderRadius: 999, textTransform: 'uppercase',
                background: 'rgba(42,122,56,0.25)', border: '1px solid rgba(42,122,56,0.5)', color: '#9FD8A8',
              }}>{h.netStroke > 1 ? `${h.netStroke} strokes` : 'stroke hole'}</span>
            )}
            <span style={{ marginLeft: h.netStroke > 0 ? 0 : 'auto', fontSize: 12, fontWeight: 800, color: 'var(--tm-gold)' }}>{h.expect}</span>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 800, color: '#F5D78A' }}>{h.club}</span>
            {h.aim ? <> — {h.aim}</> : null}
          </div>
          {h.avoid && <div style={{ fontSize: 12, color: '#E0A3A3', marginTop: 4 }}>Avoid: {h.avoid}</div>}
          {h.why && <div style={{ fontSize: 12, color: 'var(--tm-dark-text-2)', marginTop: 4 }}>{h.why}</div>}
        </div>
      ))}
    </>
  )
}
