// CoursePicker — THE course picker (Phase 1 / S1 of the Play-funnel plan,
// wiki/synthesis/play-funnel-phase1-build-spec-2026-07-10.md).
//
// Unifies the two divergent implementations that grew in parallel:
//   - the dark full-screen sheet from EagleEye.jsx (~line 432, 2026-05-xx)
//   - the light inline field from Outing/CreateWizard.jsx (~line 60,
//     2026-04-30), reused by the solo SetupSheet (ActiveRound.jsx)
// Same backend (/api/courses/search + /api/courses/:id), divergent
// theme/shape. Phase-1 rule: JSX for each variant is moved VERBATIM —
// pixel fidelity comes from keeping the literal markup; only the data
// layer (debounced search + course-detail fetch) is shared. Do NOT
// genericize the styles into a theme object.
//
// Variants:
//   <CoursePicker variant="sheet"  onSelect({course,tee}) onClose gps gender />
//   <CoursePicker variant="inline" value onPick(slim) onClear onTypedName
//                 onCourseTeeSelected({course,tee}) gender />
//
// Emission contracts are unchanged from the originals:
//   sheet  → onSelect({ course, tee })            (full pair)
//   inline → onPick(slim incl. teeRatings both-gender for mixed-match CH)
//            + parallel onCourseTeeSelected({ course, tee })

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api.js'
import { dedupeTees } from '../lib/tees.js'
import { addRecent } from '../lib/course-recents.js'

// ─── Shared data layer ────────────────────────────────────────────────────────

// Debounced course search against /api/courses/search. When coords are
// available they're sent as lat/lng so the server returns distance_km and
// sorts by proximity (the inline picker's long-standing behavior; the sheet
// now benefits too, and still applies its own client-side miles sort on top).
export function useCourseSearch({ coords = null, debounceMs = 300, paused = false }) {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState([])
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (paused) return
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q })
        if (coords) {
          params.set('lat', String(coords.lat))
          params.set('lng', String(coords.lng))
        }
        const res = await api(`/api/courses/search?${params.toString()}`)
        setResults(Array.isArray(res?.courses) ? res.courses : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, debounceMs)
    return () => clearTimeout(t)
  }, [query, coords?.lat, coords?.lng, paused, debounceMs]) // eslint-disable-line react-hooks/exhaustive-deps
  return { query, setQuery, results, setResults, searching }
}

// One-shot coarse geolocation — the inline picker's original pattern.
// Gracefully no-ops if denied/unavailable; search still works.
function useOneShotCoords(enabled) {
  const [coords, setCoords] = useState(null)
  useEffect(() => {
    if (!enabled) return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* user denied or unavailable — search still works */ },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60 * 1000 }
    )
  }, [enabled])
  return coords
}

async function fetchCourseDetail(id) {
  return api(`/api/courses/${id}`)
}

// ─── Public component ─────────────────────────────────────────────────────────

export function CoursePicker({ variant = 'inline', ...props }) {
  return variant === 'sheet' ? <SheetPicker {...props} /> : <InlinePicker {...props} />
}

// ─── Sheet variant (dark, full-screen portal) — JSX verbatim from EagleEye ────

function SheetPicker({ onSelect, onClose, gps, gender }) {
  const [selected, setSelected] = useState(null)
  const [course, setCourse]     = useState(null)
  const [teeIdx, setTeeIdx]     = useState(0)
  const [loadingCourse, setLoadingCourse] = useState(false)
  const gpsRef = useRef(gps)

  // Keep gpsRef current so distance labels always see the latest value
  useEffect(() => { gpsRef.current = gps }, [gps])

  const { query, setQuery, results, searching } = useCourseSearch({
    coords: gps ? { lat: gps.lat, lng: gps.lon } : null,
    debounceMs: 350,
    paused: !!selected,
  })
  const loading = searching || loadingCourse

  function distMiles(c, loc) {
    const g = loc ?? gpsRef.current
    if (!g || c.latitude == null || c.longitude == null) return Infinity
    const R = 3958.8
    const dLat = (c.latitude - g.lat) * Math.PI / 180
    const dLon = (c.longitude - g.lon) * Math.PI / 180
    const a = Math.sin(dLat/2)**2 + Math.cos(g.lat * Math.PI/180) * Math.cos(c.latitude * Math.PI/180) * Math.sin(dLon/2)**2
    return R * 2 * Math.asin(Math.sqrt(a))
  }

  // Sort at render time — re-sorts automatically whenever GPS locks in or
  // updates (the original kept a rawResults ref + effect for this; the render
  // path re-runs on the gps prop change, so sorting here is equivalent).
  const sortedResults = [...results].sort((a, b) => distMiles(a) - distMiles(b))

  async function pickCourse(c) {
    setSelected(c)
    setLoadingCourse(true)
    try {
      const d = await fetchCourseDetail(c.id)
      setCourse(d)
    } catch {} finally { setLoadingCourse(false) }
  }

  // Dedupe tees by tee_name + total_yards. The API returns separate male/female
  // arrays, but most tee boxes (Blue, White, Red, etc.) are physically the same
  // box — same name + same total yardage = same physical tees, same per-hole
  // yardages. Showing both as chips made every multi-tee course display dupes.
  // We keep the first occurrence (male if present, otherwise female), and
  // suffix " (W)" on female-only tees to disambiguate when a course has a
  // genuinely separate forward tee.
  const tees = course ? dedupeTees(course.tees, gender) : []
  const activeTee = tees[teeIdx]

  return createPortal(
    /* Outer backdrop container: full-viewport on every device, centers + clamps
       the actual modal panel to mobile width on desktop. The existing modal
       structure below this is unchanged — same background, same padding, same
       content. Audit finding R2 / 2026-04-29. */
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgb(var(--tm-ee-black-rgb) / 0.5)',
      display: 'flex', justifyContent: 'center',
    }}>
    <div style={{ width: '100%', maxWidth: 430, height: '100%', background: 'var(--tm-ee-bg-sheet)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'max(16px, env(safe-area-inset-top)) 20px 12px', borderBottom: '1px solid rgb(var(--tm-ee-white-rgb) / 0.1)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgb(var(--tm-ee-white-rgb) / 0.5)', fontSize: 22, cursor: 'pointer' }}>←</button>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Select Course</div>
        </div>
        <div style={{ position: 'relative', marginTop: 12 }}>
          <input
            autoFocus value={query}
            onChange={e => { setSelected(null); setCourse(null); setQuery(e.target.value) }}
            placeholder="Search course name…"
            style={{ width: '100%', background: 'rgb(var(--tm-ee-white-rgb) / 0.08)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.15)', borderRadius: 10, padding: '10px 40px 10px 14px', color: '#fff', fontSize: 15, outline: 'none' }}
          />
          {loading && (
            <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, borderRadius: '50%', border: '2px solid rgb(var(--tm-ee-gold-light-rgb) / 0.3)', borderTopColor: 'var(--tm-ee-gold-light)', animation: 'ee-spin-slow 0.7s linear infinite' }} />
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
        {!selected && sortedResults.map(c => {
          const miles = distMiles(c)
          const distLabel = miles < Infinity ? (miles < 0.1 ? 'Here' : miles < 1 ? `${Math.round(miles * 10) / 10} mi` : `${Math.round(miles)} mi`) : null
          return (
            <div key={c.id} onClick={() => pickCourse(c)} style={{ padding: '14px 0', borderBottom: '1px solid rgb(var(--tm-ee-white-rgb) / 0.07)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>{c.club_name}</div>
                <div style={{ fontSize: 12, color: 'rgb(var(--tm-ee-white-rgb) / 0.45)', marginTop: 2 }}>{[c.city, c.state, c.country].filter(Boolean).join(', ')}</div>
              </div>
              {distLabel && (
                <div style={{ fontSize: 11, fontWeight: 700, color: miles < 5 ? 'var(--tm-ee-green)' : 'rgb(var(--tm-ee-white-rgb) / 0.3)', flexShrink: 0, marginLeft: 12 }}>{distLabel}</div>
              )}
            </div>
          )
        })}

        {course && activeTee && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--tm-ee-gold-bright-rgb) / 0.8)', marginBottom: 10 }}>{course.club_name}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {tees.map((t, i) => (
                <button key={i} onClick={() => setTeeIdx(i)} style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: i === teeIdx ? 'rgb(var(--tm-ee-gold-bright-rgb) / 0.2)' : 'rgb(var(--tm-ee-white-rgb) / 0.07)',
                  border: `1px solid ${i === teeIdx ? 'rgb(var(--tm-ee-gold-bright-rgb) / 0.5)' : 'rgb(var(--tm-ee-white-rgb) / 0.1)'}`,
                  color: i === teeIdx ? 'var(--tm-ee-gold-light)' : 'rgb(var(--tm-ee-white-rgb) / 0.6)',
                }}>{t.tee_name} ({t.total_yards}y)</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              {activeTee.holes.map(h => (
                <div key={h.hole} style={{ background: 'rgb(var(--tm-ee-white-rgb) / 0.05)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.1)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'rgb(var(--tm-ee-white-rgb) / 0.4)', fontWeight: 700 }}>HOLE {h.hole} · PAR {h.par}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 2 }}>{h.yardage}<span style={{ fontSize: 11, color: 'rgb(var(--tm-ee-white-rgb) / 0.4)', marginLeft: 3 }}>yds</span></div>
                  <div style={{ fontSize: 10, color: 'rgb(var(--tm-ee-white-rgb) / 0.35)' }}>Hdcp {h.handicap}</div>
                </div>
              ))}
            </div>
            <button onClick={() => {
              // Recents (S3a): the Play funnel's nearest-course default reads
              // this list. lat/lon ride from the search row (detail lacks them).
              addRecent({
                id: course.id,
                club_name: course.club_name || course.course_name,
                lat: selected?.latitude ?? null,
                lon: selected?.longitude ?? null,
                lastTee: activeTee.tee_name ?? null,
              })
              onSelect({ course, tee: activeTee })
            }} style={{
              width: '100%', padding: '16px', borderRadius: 14, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, var(--tm-ee-green-grad-a), var(--tm-ee-green-grad-b))',
              color: '#fff', fontWeight: 800, fontSize: 16,
            }}>Use This Course & Tee</button>
          </>
        )}
      </div>
    </div>
    </div>,
    document.body
  )
}

// ─── Inline variant (light field) — JSX verbatim from CreateWizard ────────────

function InlinePicker({ value, onPick, onClear, onTypedName, onCourseTeeSelected, gender }) {
  const [openCourse, setOpenCourse] = useState(null) // { id, club_name, course_name, tees: { male, female } }
  const [loadingCourse, setLoadingCourse] = useState(false)
  // The tapped search row — kept so the recents entry gets lat/lon (the
  // course DETAIL payload doesn't carry coordinates). (S3a, 2026-07-10)
  const pickedRowRef = useRef(null)

  // Request geolocation once; gracefully no-op if denied
  const coords = useOneShotCoords(true)

  const { query, setQuery, results, setResults, searching } = useCourseSearch({
    coords,
    debounceMs: 250,
    paused: !!openCourse, // don't keep searching while picking a tee
  })

  async function selectCourse(c) {
    pickedRowRef.current = c
    setLoadingCourse(true)
    try {
      const detail = await fetchCourseDetail(c.id)
      setOpenCourse(detail)
    } catch {
      setOpenCourse(null)
    } finally {
      setLoadingCourse(false)
    }
  }

  function selectTee(tee) {
    if (!openCourse) return
    // Recents (S3a): the Play funnel's nearest-course default reads this list.
    addRecent({
      id: openCourse.id,
      club_name: openCourse.club_name || openCourse.course_name,
      lat: pickedRowRef.current?.latitude ?? null,
      lon: pickedRowRef.current?.longitude ?? null,
      lastTee: tee.tee_name ?? null,
    })
    const holes = (tee.holes || []).map(h => h.par)
    // Capture BOTH genders' ratings for this physical tee (matched by total
    // yards) so each player's Course Handicap can use their gender's rating in
    // a mixed match. Either side may be absent for a one-gender-only tee.
    // (2026-06-25)
    const findByYards = (list) => (list || []).find(t => t.total_yards === tee.total_yards)
    const m = findByYards(openCourse.tees?.male)
    const f = findByYards(openCourse.tees?.female)
    const teeRatings = {}
    if (m && (m.course_rating != null || m.slope_rating != null)) teeRatings.male = { cr: m.course_rating ?? null, sr: m.slope_rating ?? null }
    if (f && (f.course_rating != null || f.slope_rating != null)) teeRatings.female = { cr: f.course_rating ?? null, sr: f.slope_rating ?? null }
    onPick({
      courseId:    openCourse.id,
      courseName:  openCourse.club_name || openCourse.course_name,
      courseTee:   tee.tee_name,
      holePars:    holes,
      holeYardages: (tee.holes || []).map(h => h.yardage),
      holeHandicaps:(tee.holes || []).map(h => h.handicap),
      coursePar:   tee.par_total,
      // Tee rating + slope from GolfCourseAPI. Captured here so the
      // match-end handler can write a USGA-method differential into
      // the tm_rounds row. Falls back to par-based differential when
      // these are absent (free tier / unrated course).
      // (2026-05-01)
      courseRating: tee.course_rating ?? null,
      slopeRating:  tee.slope_rating ?? null,
      teeRatings:   (teeRatings.male || teeRatings.female) ? teeRatings : null, // both genders for mixed-match CH (2026-06-25)
    })
    // Parallel emission of the full {course, tee} pair so the App-level
    // sharedCourse can be updated for cross-tab sync with EagleEye.
    // (2026-05-01)
    onCourseTeeSelected?.({ course: openCourse, tee })
    setQuery('')
    setResults([])
    setOpenCourse(null)
  }

  // ─── Selected state — show the chosen course + tee compactly ─────────
  if (value?.courseId && value?.holePars) {
    return (
      <div style={{
        background: 'var(--tm-green-muted)',
        border: '1px solid rgba(46,158,69,0.40)',
        borderRadius: 'var(--tm-radius)',
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--tm-green-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ✓ {value.courseName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--tm-text-2)', marginTop: 2 }}>
            {value.courseTee} tees · Par {value.coursePar} · {value.holePars.length} holes
          </div>
        </div>
        <button onClick={onClear} style={{
          background: 'rgba(255,255,255,0.6)', border: '1px solid var(--tm-border)',
          borderRadius: 8, padding: '6px 10px',
          color: 'var(--tm-text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          flexShrink: 0,
        }}>Change</button>
      </div>
    )
  }

  // ─── Tee selection ───────────────────────────────────────────────────
  if (openCourse) {
    // 2026-05-06 — dedupe via the shared lib/tees.js helper. Earlier
    // this was a naive `[...male, ...female]` concat, which showed
    // each physical tee box twice when the course had both M and W
    // ratings (Matt's complaint: "multiple sets of tees with different
    // ratings").
    const allTees = dedupeTees(openCourse.tees, gender) // player's-gender ratings (handicap-correct)
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--tm-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {openCourse.club_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--tm-text-3)' }}>Choose a tee</div>
          </div>
          <button onClick={() => setOpenCourse(null)} style={{
            background: 'none', border: 'none', color: 'var(--tm-text-3)',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>← Back</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
          {allTees.length === 0 && (
            <div style={{ color: 'var(--tm-text-3)', fontSize: 13, padding: 10 }}>
              No tee data — try another course or type the name manually.
            </div>
          )}
          {allTees.map((t, i) => (
            <button key={`${t.tee_name}-${i}`} onClick={() => selectTee(t)} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', borderRadius: 'var(--tm-radius)',
              border: '1px solid var(--tm-border)', background: 'var(--tm-surface-2)',
              cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 13 }}>{t.tee_name}</div>
                <div style={{ fontSize: 11, color: 'var(--tm-text-3)' }}>
                  Par {t.par_total} · {t.total_yards} yds
                  {t.course_rating ? ` · ${t.course_rating}/${t.slope_rating}` : ''}
                </div>
              </div>
              <span style={{ color: 'var(--tm-green-text)', fontWeight: 800, fontSize: 13 }}>Pick →</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ─── Search state ────────────────────────────────────────────────────
  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={e => { setQuery(e.target.value); onTypedName?.(e.target.value) }}
        placeholder={coords ? 'Type a course (closest first)' : 'Type a course'}
        style={{
          width: '100%', background: 'var(--tm-surface-2)',
          border: '1px solid var(--tm-border-2)', borderRadius: 'var(--tm-radius)',
          color: 'var(--tm-text)', fontSize: 16, padding: '12px 14px',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
      {(searching || loadingCourse || results.length > 0) && (
        <div style={{
          marginTop: 8, maxHeight: 220, overflowY: 'auto',
          border: '1px solid var(--tm-border)', borderRadius: 'var(--tm-radius)',
          background: 'var(--tm-surface-2)',
        }}>
          {(searching || loadingCourse) && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--tm-text-3)' }}>
              {loadingCourse ? 'Loading course…' : 'Searching…'}
            </div>
          )}
          {results.map(c => (
            <button key={c.id} onClick={() => selectCourse(c)} style={{
              width: '100%', textAlign: 'left', cursor: 'pointer',
              padding: '10px 14px', border: 'none', background: 'transparent',
              borderBottom: '1px solid var(--tm-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.club_name || c.course_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--tm-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[c.city, c.state, c.country].filter(Boolean).join(', ')}
                </div>
              </div>
              {c.distance_km != null && (
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-green-text)', flexShrink: 0 }}>
                  {c.distance_km < 1 ? `${Math.round(c.distance_km * 1000)}m` :
                    c.distance_km < 100 ? `${c.distance_km.toFixed(1)}km` :
                    `${Math.round(c.distance_km)}km`}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 8 }}>
        Can't find it? Just leave the name typed — we'll use your course name without the per-hole pars.
      </div>
    </div>
  )
}
