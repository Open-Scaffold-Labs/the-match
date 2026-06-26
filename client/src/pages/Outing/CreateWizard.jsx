import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../../lib/api.js'
import { warn } from '../../lib/logger.js'
import { dedupeTees } from '../../lib/tees.js'
import { useActiveMatchGuard } from './useActiveMatchGuard.jsx'

// ─── Create Outing Wizard ─────────────────────────────────────────────────────
const FORMATS = [
  { id: 'stroke',    label: 'Stroke Play',    desc: 'Total strokes wins' },
  { id: 'match',     label: 'Match Play',     desc: 'Hole-by-hole wins' },
  { id: 'stableford',label: 'Stableford',     desc: 'Points system' },
  { id: 'skins',     label: 'Skins',          desc: 'Win each hole outright' },
  { id: 'best_ball', label: 'Best Ball',      desc: 'Best of each team per hole — pairs or foursomes' },
]
const TEAMS = [
  { id: 'individual', label: 'Individual',     desc: 'Everyone scores for themselves — head-to-head records tracked' },
  { id: 'teams',      label: '2 Teams',        desc: 'Split your group into two teams — you assign players after' },
  { id: 'big_team',   label: 'Multiple Teams', desc: 'Create 3 or more teams — ideal for larger groups' },
]

// For outings > 4 players. Replaces the "Competition Structure" step
// (TEAMS) with a simpler 3-button question: how is the field split
// into competitive units within each foursome? Maps directly to the
// team_breakdown column on tm_outings (migration 013).
const TEAM_BREAKDOWNS = [
  { id: 'singles',   label: 'Singles',   desc: 'No teams — everyone plays for themselves across all foursomes' },
  { id: 'doubles',   label: 'Doubles',   desc: '2-vs-2 within each foursome — paired by join order' },
  { id: 'foursomes', label: 'Foursomes', desc: 'Each foursome is one team — group-vs-group competition' },
]

// CoursePicker — search-as-you-type for real courses (GolfCourseAPI via
// /api/courses/search). When the host picks a course, it loads the full
// course detail and lets them choose a tee; the resulting hole_pars[] flows
// up to the wizard via onPick. Includes a "type your own" fallback for
// courses that aren't in the API. (2026-04-30)
//
// Exported 2026-05-07 so the solo-round SetupSheet (ActiveRound.jsx) can
// reuse the same picker — Matt: 'setup screen should be exactly the same
// as the other just without the multiplayer questions'. Same component,
// same API, same look — solo just doesn't pass onCourseTeeSelected since
// it has no shared-course pipeline.
export function CoursePicker({ value, onPick, onClear, onTypedName, onCourseTeeSelected, gender }) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [coords, setCoords]     = useState(null)   // { lat, lng } once geolocation resolves
  const [openCourse, setOpenCourse] = useState(null) // { id, club_name, course_name, tees: { male, female } }
  const [loadingCourse, setLoadingCourse] = useState(false)

  // Request geolocation once; gracefully no-op if denied
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* user denied or unavailable — search still works */ },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60 * 1000 }
    )
  }, [])

  // Debounced search after 2+ chars
  useEffect(() => {
    if (openCourse) return    // don't keep searching while picking a tee
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
    }, 250)
    return () => clearTimeout(t)
  }, [query, coords, openCourse])

  async function selectCourse(c) {
    setLoadingCourse(true)
    try {
      const detail = await api(`/api/courses/${c.id}`)
      setOpenCourse(detail)
    } catch {
      setOpenCourse(null)
    } finally {
      setLoadingCourse(false)
    }
  }

  function selectTee(tee) {
    if (!openCourse) return
    const holes = (tee.holes || []).map(h => h.par)
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
    // ratings"). EagleEye's CoursePicker already used dedupeTees;
    // factored it into lib/tees.js so this picker shares the same
    // single-source-of-truth implementation.
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

// Derive the slim form-friendly course shape from the App-level
// sharedCourse {course, tee} pair. Used by CreateWizard's initial state
// when the user navigates here with a course already selected from
// EagleEye or a previous match. (2026-05-01)
function deriveSlimFromSharedCourse(sc) {
  if (!sc?.course || !sc?.tee) return null
  const holes = sc.tee.holes || []
  return {
    courseId:      sc.course.id,
    courseName:    sc.course.club_name || sc.course.course_name,
    courseTee:     sc.tee.tee_name,
    holePars:      holes.map(h => h.par),
    holeYardages:  holes.map(h => h.yardage),
    holeHandicaps: holes.map(h => h.handicap),
    coursePar:     sc.tee.par_total,
  }
}

export default function CreateWizard({ user, onClose, onCreated, pendingPlayers = [], pendingLeagueId = null, sharedCourse = null, onCourseSelected }) {
  const [step, setStep] = useState(0)
  const { ensureSingleActive, modalEl: activeMatchModal } = useActiveMatchGuard(user)
  const [form, setForm] = useState(() => {
    // Pre-fill from sharedCourse so the wizard opens with a course
    // already selected when the user got here via EagleEye -> Scorecard.
    const slim = deriveSlimFromSharedCourse(sharedCourse)
    return {
      name: '',
      courseName: slim?.courseName || '',
      // 2026-05-06 — formats is now an ARRAY so users can compose
      // real combinations (Match + Best Ball = four-ball match play,
      // Stroke + Skins = round with side bet, etc.). Default keeps
      // the simple single-format experience for first-timers.
      formats: ['stroke'],
      team: 'individual',
      holes: 18,
      // Expected total golfers in the match. Defaults to 1 + any
      // pre-filled players (e.g. when this wizard was opened from a
      // schedule modal that already knows the group size). Capped
      // at 150 — large outings split into foursomes.
      players: Math.max(2, Math.min(150, 1 + (pendingPlayers?.length || 0))),
      // For outings > 4, the host picks how the field is divided into
      // competitive units within each foursome. See migration 013.
      // Null for small outings — the legacy team_format field handles
      // their 1v1 / 2v2 setup.
      teamBreakdown: null,
      // Handicap allowance percentage. 100 = full handicap; common
      // alternatives are 80/85/90/95 for various tournament formats.
      // (B4a)
      handicapAllowance: 100,
      // Stableford preset: 'standard' (USGA traditional 1-2-3-4),
      // 'modified' (PGA Tour Reno-Tahoe -3/-1/0/2/5), or 'custom' so
      // the league can author its own point map. Only meaningful when
      // format='stableford'. (B4b · 6.5)
      stablefordPreset: 'standard',
      // 6.5 — Custom Stableford point map. Used only when
      // stablefordPreset === 'custom'. Initialized to the standard
      // map so partial edits yield a sensible scoreboard.
      customStablefordPoints: { double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1 },
      // No-show policy default. Item 6 + Round 4 audit fix: was
      // previously undefined in form init, which worked only because
      // server defaults to 'dns'. Initializing here makes the wizard's
      // own state reads consistent.
      noShowPolicy: 'dns',
      // Real course data captured by the picker; null when host opts out
      courseId:      slim?.courseId ?? null,
      courseTee:     slim?.courseTee ?? null,
      holePars:      slim?.holePars ?? null,
      holeYardages:  slim?.holeYardages ?? null,
      holeHandicaps: slim?.holeHandicaps ?? null,
      coursePar:     slim?.coursePar ?? null,    // computed from picked tee's par_total when set
      // Rating + slope (captured by CoursePicker when the tee carries them)
      courseRating: null,
      slopeRating:  null,
    }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 2026-05-02 — When opened from a league, fetch league.config and
  // seed the form with its default rules. This is what bridges the
  // per-event tooling (handicap allowance, Stableford map, no-show
  // policy) DOWN from the league level so commissioners only set
  // those rules once. Form fields stay editable — host can override
  // for a particular event without affecting the league default.
  const [linkedLeague, setLinkedLeague] = useState(null)
  // Round 14 audit fix — user-touched flag. Without it, a user who
  // starts editing the wizard form BEFORE the league pre-fill fetch
  // completes (~500ms) gets their edits clobbered when the response
  // lands. The flag flips true the first time `set()` is called and
  // gates the pre-fill setForm.
  const userTouchedRef = useRef(false)
  useEffect(() => {
    if (!pendingLeagueId) { setLinkedLeague(null); return }
    let cancelled = false
    api(`/api/leagues/${pendingLeagueId}`)
      .then(d => {
        if (cancelled || !d?.league) return
        setLinkedLeague(d.league)
        if (userTouchedRef.current) {
          // User started editing before fetch landed — respect their
          // choices. They can still see the linked-league banner and
          // edit any field they want.
          return
        }
        const l = d.league
        const cfg = (l.config && typeof l.config === 'object') ? l.config : {}
        setForm(f => ({
          ...f,
          // Default scoring format flows down. Host can change it.
          format: l.scoring_format || f.format,
          // Handicap allowance, no-show policy from config.
          handicapAllowance: Number.isFinite(Number(cfg.handicap_allowance))
            ? Number(cfg.handicap_allowance) : f.handicapAllowance,
          // Stableford map: the league may store either a preset name
          // ('standard'/'modified') or a full custom point map. Both
          // get translated into the wizard's two pieces of state.
          stablefordPreset: cfg.stableford_preset || f.stablefordPreset,
          customStablefordPoints: (cfg.stableford_points && typeof cfg.stableford_points === 'object')
            ? cfg.stableford_points
            : f.customStablefordPoints,
          // No-show policy threads through state on the outing itself
          // (see outings.js create handler). Stored separately so the
          // POST body can carry it.
          noShowPolicy: cfg.no_show_policy || f.noShowPolicy,
          // Default expected players if league sets a target field count.
          ...(Number.isFinite(Number(cfg.expected_players))
            ? { players: Math.max(2, Math.min(150, Math.round(Number(cfg.expected_players)))) }
            : {}),
        }))
      })
      .catch(() => { /* silently fall through to wizard defaults */ })
    return () => { cancelled = true }
  }, [pendingLeagueId])

  function set(k, v) {
    userTouchedRef.current = true   // round 14 — gate the league pre-fill
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleCreate() {
    setLoading(true); setError('')
    try {
      // 2026-05-06 — formats is an array now. At least one required.
      const formats = Array.isArray(form.formats) ? form.formats : []
      if (formats.length === 0) {
        setLoading(false)
        setError('Pick at least one scoring format.')
        return
      }
      // One-active-match guard. Detects any other active match the user
      // is in — hosted OR merely joined (the old check was host-only) —
      // and shows an in-app confirm sheet (no window.confirm). Accepting
      // ends it (if host) or leaves it (if participant); cancelling backs
      // out of this create. (2026-06-23 — Matt: one active match at a time.)
      const cleared = await ensureSingleActive()
      if (!cleared) {
        setLoading(false)
        return
      }
      // Validation: best_ball + match (= four-ball match play) require
      // team membership. Players are assigned a team_id either through
      // the small-outing TEAMS setup (team_format='teams') OR the >4
      // team_breakdown ('doubles' / 'foursomes'). Without one of those
      // there's no grouping for per-team math, so block creation rather
      // than ship a confusing leaderboard. (Iteration fix B4d-2;
      // generalized 2026-05-06 from format==='best_ball' to a check
      // that fires for any team-required format.)
      const needsTeams = formats.includes('best_ball')
      if (needsTeams) {
        const hasSmallTeams = form.players <= 4 && form.team !== 'individual'
        const hasLargeTeams = form.players > 4 && (form.teamBreakdown === 'doubles' || form.teamBreakdown === 'foursomes')
        if (!hasSmallTeams && !hasLargeTeams) {
          setLoading(false)
          setError(form.players <= 4
            ? 'Best Ball needs teams. Pick "2 Teams" or "Multiple Teams" on the next step.'
            : 'Best Ball needs teams. Pick "Doubles" or "Foursomes" on the next step.')
          return
        }
      }

      // If user picked a real course, slice hole_pars to the chosen hole count;
      // if they only typed a name (or skipped), fall back to the legacy default.
      const slice = (arr) => Array.isArray(arr) ? arr.slice(0, form.holes) : null
      const slicedPars     = slice(form.holePars)
      const computedPar    = slicedPars ? slicedPars.reduce((a, b) => a + (b || 0), 0) : null

      const data = await post('/api/outings', {
        name: form.name || `${user.name}'s Match`,
        courseName: form.courseName || 'TBD',
        scoringFormats: formats,
        teamFormat: form.team,
        coursePar: computedPar || form.coursePar || (form.holes === 9 ? 36 : 72),
        // Real per-hole data — server stores nulls when not provided
        courseId:      form.courseId,
        courseTee:     form.courseTee,
        holePars:      slicedPars,
        holeYardages:  slice(form.holeYardages),
        holeHandicaps: slice(form.holeHandicaps),
        // Tee rating + slope (paid-tier USGA handicap inputs). Server
        // stores nulls when the picked tee didn't carry them.
        courseRating:  form.courseRating ?? null,
        slopeRating:   form.slopeRating  ?? null,
        // Expected total golfers in the match (host + opponents). Used
        // by the Match page Live Now card to show "waiting for N more"
        // until the slots fill in.
        expectedPlayers: form.players,
        // Only meaningful for > 4. Server ignores when count ≤ 4.
        teamBreakdown: form.players > 4 ? form.teamBreakdown : null,
        // Handicap allowance % for net scoring. (B4a)
        handicapAllowance: form.handicapAllowance,
        // Stableford preset (only used when stableford is selected). (B4b)
        stablefordPreset: formats.includes('stableford') ? form.stablefordPreset : null,
        // 6.5 — when the host picked Custom, ship the point map.
        // Server validates each bucket and falls back to standard if
        // anything's malformed.
        customStablefordPoints: formats.includes('stableford') && form.stablefordPreset === 'custom'
          ? form.customStablefordPoints
          : null,
        // 2026-05-02 — when the wizard was opened from inside a league,
        // attach the new event to that league. Server validates that
        // the caller is a league member or commissioner before honoring.
        leagueId: pendingLeagueId || null,
        // No-show policy default flows from the league or wizard form.
        // Server normalizes / falls back to 'dns' if missing. (Item 6.)
        noShowPolicy: form.noShowPolicy || null,
      })
      // Auto-add all pre-filled players — they're already committed, skip the join-code step
      if (pendingPlayers.length > 0) {
        try {
          await post(`/api/outings/${data.outing.code}/bulk-join`, {
            user_ids: pendingPlayers.map(p => p.id),
          })
        } catch (e) { warn('[bulk-join]', e) }
      }
      onCreated(data.outing)
    } catch (e) {
      setError(e.message || 'Failed to create outing')
    } finally { setLoading(false) }
  }

  const steps = [
    // Step 0: Name + Course
    <div key="0" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Linked-to-league hint banner — surfaces when wizard was opened
          from inside a league. Tells the host the new event will
          inherit league rules + auto-attach. (2026-05-02) */}
      {linkedLeague && (
        <div style={{
          padding: '10px 12px', borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(245,215,138,0.18), rgba(201,160,64,0.10))',
          border: '1px solid rgba(245,215,138,0.45)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: 'rgba(201,160,64,0.20)',
            border: '1px solid rgba(201,160,64,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* Round 27 audit — emoji 🏆 replaced with bespoke SVG to
                match the rest of the app's Augusta iconography. */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/>
              <path d="M8 6H6a2 2 0 0 0 2 2"/>
              <path d="M16 6h2a2 2 0 0 1-2 2"/>
              <line x1="12" y1="12" x2="12" y2="16"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
              <line x1="10" y1="16" x2="14" y2="16"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#7A5800', textTransform: 'uppercase' }}>
              Event for league
            </div>
            <div style={{
              fontSize: 14, fontWeight: 800, color: 'var(--tm-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{linkedLeague.name}</div>
            <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.55)', marginTop: 1 }}>
              Format + handicap rules + Stableford map prefilled from the league. Edit any field to override for this event only.
            </div>
          </div>
        </div>
      )}
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Match Name</div>
        <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={`${user.name}'s Match`}
          style={{ width: '100%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border-2)', borderRadius: 'var(--tm-radius)', color: 'var(--tm-text)', fontSize: 16, padding: '12px 14px', outline: 'none', boxSizing: 'border-box' }} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Course</div>
        <CoursePicker
          value={form.courseId ? form : null}
          onPick={picked => setForm(f => ({
            ...f,
            courseId:      picked.courseId,
            courseName:    picked.courseName,
            courseTee:     picked.courseTee,
            holePars:      picked.holePars,
            holeYardages:  picked.holeYardages,
            holeHandicaps: picked.holeHandicaps,
            coursePar:     picked.coursePar,
            courseRating:  picked.courseRating ?? null,
            slopeRating:   picked.slopeRating  ?? null,
          }))}
          onClear={() => setForm(f => ({
            ...f,
            courseId:      null,
            courseTee:     null,
            holePars:      null,
            holeYardages:  null,
            holeHandicaps: null,
            coursePar:     null,
            courseRating:  null,
            slopeRating:   null,
          }))}
          onTypedName={text => set('courseName', text)}
          onCourseTeeSelected={onCourseSelected}
          gender={user?.gender}
        />
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Holes</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[9,18].map(h => <button key={h} onClick={() => set('holes', h)} style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--tm-radius)', border: '1px solid', borderColor: form.holes === h ? 'var(--tm-green)' : 'var(--tm-border)', background: form.holes === h ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)', color: form.holes === h ? 'var(--tm-green-text)' : 'var(--tm-text-2)', fontWeight: 700 }}>{h} Holes</button>)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Golfers</div>
        {/* Stepper +/- around a numeric value, plus quick-pick chips
            for common sizes. Supports 2-150; large outings (>4)
            unlock a Team Breakdown step. (2026-05-01) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button
            onClick={() => set('players', Math.max(2, Number(form.players) - 1))}
            disabled={Number(form.players) <= 2}
            style={{
              width: 44, height: 44, borderRadius: 'var(--tm-radius)',
              border: '1px solid var(--tm-border)',
              background: 'var(--tm-surface-2)',
              color: Number(form.players) <= 2 ? 'var(--tm-text-3)' : 'var(--tm-text)',
              fontSize: 22, fontWeight: 800, cursor: Number(form.players) <= 2 ? 'default' : 'pointer',
            }}
          >−</button>
          <input
            type="number" inputMode="numeric" min={2} max={150}
            value={form.players}
            onChange={e => {
              const n = Math.max(2, Math.min(150, Math.round(Number(e.target.value) || 2)))
              set('players', n)
            }}
            style={{
              flex: 1, textAlign: 'center', fontSize: 22, fontWeight: 800,
              background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border-2)',
              borderRadius: 'var(--tm-radius)', color: 'var(--tm-text)',
              padding: '10px 0', outline: 'none',
            }}
          />
          <button
            onClick={() => set('players', Math.min(150, Number(form.players) + 1))}
            disabled={Number(form.players) >= 150}
            style={{
              width: 44, height: 44, borderRadius: 'var(--tm-radius)',
              border: '1px solid var(--tm-border)',
              background: 'var(--tm-surface-2)',
              color: Number(form.players) >= 150 ? 'var(--tm-text-3)' : 'var(--tm-text)',
              fontSize: 22, fontWeight: 800, cursor: Number(form.players) >= 150 ? 'default' : 'pointer',
            }}
          >+</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[4,8,12,16,24,32,48,72,100,144].map(n => (
            <button key={n} onClick={() => set('players', n)} style={{
              padding: '6px 12px',
              borderRadius: 999, border: '1px solid',
              borderColor: Number(form.players) === n ? 'var(--tm-green)' : 'var(--tm-border)',
              background:  Number(form.players) === n ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)',
              color:       Number(form.players) === n ? 'var(--tm-green-text)' : 'var(--tm-text-2)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{n}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 8 }}>
          Including you. {Number(form.players) > 4
            ? `Splits into ${Math.ceil(Number(form.players) / 4)} foursomes — you'll pick a team breakdown next.`
            : 'Used to show "waiting for N more" on the Live card.'}
        </div>
      </div>
    </div>,

    // Step 1: Format(s) + handicap allowance %
    //
    // 2026-05-06 — multi-select. Each format is independently
    // togglable. The user can compose real golf combinations:
    //   • Match Play + Best Ball  = Four-Ball Match Play (the most
    //     common 2v2 format)
    //   • Stroke Play + Skins      = stroke round with skins side bet
    //   • Stableford alone, etc.
    // Default: just ['stroke']. At least one required (validated at
    // create-time). The "Pick combos like…" hint at the top teaches
    // the most common pairings without forcing extra UI.
    <div key="1" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        padding: '8px 12px', borderRadius: 'var(--tm-radius)',
        background: 'rgba(232,192,90,0.10)',
        border: '1px solid rgba(232,192,90,0.28)',
        fontSize: 11, color: 'var(--tm-gold-text)',
        lineHeight: 1.45,
      }}>
        Tap multiple to combine. <b>Match&nbsp;Play&nbsp;+&nbsp;Best&nbsp;Ball</b> = four-ball match play.
        &nbsp;<b>Stroke&nbsp;+&nbsp;Skins</b> = round with a skins side bet.
      </div>
      {FORMATS.map(f => {
        const selected = (form.formats || []).includes(f.id)
        function toggle() {
          setForm(prev => {
            const cur = Array.isArray(prev.formats) ? prev.formats : []
            const next = cur.includes(f.id)
              ? cur.filter(x => x !== f.id)
              : [...cur, f.id]
            return { ...prev, formats: next }
          })
          userTouchedRef.current = true
        }
        return (
          <button key={f.id} onClick={toggle}
            style={{ padding: '16px', borderRadius: 'var(--tm-radius-lg)', border: '2px solid', borderColor: selected ? 'var(--tm-green)' : 'var(--tm-border)', background: selected ? 'var(--tm-green-muted)' : 'var(--tm-surface)', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15 }}>{f.label}</div>
              <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginTop: 2 }}>{f.desc}</div>
            </div>
            {/* Square checkbox-style indicator instead of round radio
                so multi-select reads visually. Empty when unselected,
                gold-checked when selected. */}
            <div style={{
              width: 22, height: 22, borderRadius: 6,
              background: selected ? 'linear-gradient(135deg, var(--tm-gold), var(--tm-gold-dim))' : 'var(--tm-surface-2)',
              border: selected ? '1px solid rgba(122,88,0,0.45)' : '1px solid var(--tm-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#0D1F12', fontSize: 13, fontWeight: 900,
              flexShrink: 0,
            }}>{selected ? '✓' : ''}</div>
          </button>
        )
      })}

      {/* Stableford preset (only when stableford is in the selected
          formats). Standard = 1/2/3/4 (USGA traditional); Modified =
          -3/-1/0/2/5 (PGA Tour Reno-Tahoe variant); Custom = league-
          authored point map (6.5). */}
      {(form.formats || []).includes('stableford') && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Stableford Preset
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { id: 'standard', label: 'Standard', desc: 'Bogey 1 · Par 2 · Birdie 3 · Eagle 4' },
              { id: 'modified', label: 'Modified', desc: 'Bogey −1 · Par 0 · Birdie 2 · Eagle 5 · Double −3' },
              { id: 'custom',   label: 'Custom',   desc: 'Set your league’s own point map below' },
            ].map(opt => (
              <button key={opt.id} onClick={() => set('stablefordPreset', opt.id)} style={{
                flex: '1 1 30%', minWidth: 110, padding: '10px 12px', borderRadius: 'var(--tm-radius)',
                border: '1px solid', borderColor: form.stablefordPreset === opt.id ? 'var(--tm-green)' : 'var(--tm-border)',
                background: form.stablefordPreset === opt.id ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)',
                color: 'var(--tm-text)', textAlign: 'left', cursor: 'pointer',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{opt.label}</div>
                <div style={{ fontSize: 10, color: 'var(--tm-text-3)', marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
          {/* 6.5 — Custom point map editor. Renders inline when 'custom'
              is selected. 7 buckets, each 0-20 (or down to -10 for
              penalty schemes like the modified variant). */}
          {form.stablefordPreset === 'custom' && (
            <div style={{
              marginTop: 10, padding: '12px',
              background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
              borderRadius: 'var(--tm-radius)',
            }}>
              <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginBottom: 8, lineHeight: 1.4 }}>
                Points awarded for each score relative to par. Range −10 to 20. The leaderboard recomputes live as players score.
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8,
              }}>
                {[
                  { key: 'double_eagle', label: 'Double Eagle (−3)' },
                  { key: 'eagle',        label: 'Eagle (−2)' },
                  { key: 'birdie',       label: 'Birdie (−1)' },
                  { key: 'par',          label: 'Par' },
                  { key: 'bogey',        label: 'Bogey (+1)' },
                  { key: 'double',       label: 'Double (+2)' },
                  { key: 'worse',        label: 'Triple+ (+3 or worse)' },
                ].map(b => {
                  const v = form.customStablefordPoints?.[b.key]
                  return (
                    <label key={b.key} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 8, padding: '6px 8px',
                      background: 'var(--tm-surface)', border: '1px solid var(--tm-border)',
                      borderRadius: 8,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-text-2)' }}>{b.label}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        step="1"
                        min="-10"
                        max="20"
                        value={v == null ? '' : v}
                        onChange={e => {
                          const raw = e.target.value
                          set('customStablefordPoints', {
                            ...(form.customStablefordPoints || {}),
                            [b.key]: raw === '' ? 0 : Number(raw),
                          })
                        }}
                        style={{
                          width: 56, height: 30, textAlign: 'center',
                          fontSize: 14, fontWeight: 800, color: 'var(--tm-text)',
                          background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
                          borderRadius: 6,
                        }}
                      />
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Handicap allowance — 100% means full hcp, lower percentages
          are common in tournament settings (member-guest 80%, 4ball
          stroke 85%, singles match 90%, stroke tournaments 95%).
          Only relevant when scoring is net; no harm if gross. (B4a) */}
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Handicap Allowance
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[100, 95, 90, 85, 80, 75].map(pct => (
            <button key={pct} onClick={() => set('handicapAllowance', pct)} style={{
              padding: '6px 12px', borderRadius: 999, border: '1px solid',
              borderColor: form.handicapAllowance === pct ? 'var(--tm-green)' : 'var(--tm-border)',
              background:  form.handicapAllowance === pct ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)',
              color:       form.handicapAllowance === pct ? 'var(--tm-green-text)' : 'var(--tm-text-2)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{pct}%</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 6 }}>
          {form.handicapAllowance === 100 ? 'Full handicap.'
           : form.handicapAllowance >= 95 ? 'Stroke-play tournament standard.'
           : form.handicapAllowance >= 90 ? 'Singles match-play standard.'
           : form.handicapAllowance >= 85 ? '4-ball stroke / better-ball.'
           : form.handicapAllowance >= 80 ? 'Member-guest / scramble standard.'
           : 'Scramble.'}
        </div>
      </div>
    </div>,

    // Step 2: Competition Structure — content forks on player count.
    // ≤4 players → existing TEAMS picker (individual / 2 teams / multi).
    // >4 players  → TEAM_BREAKDOWNS picker (singles / doubles / foursomes).
    Number(form.players) > 4 ? (
      <div key="2-large" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginBottom: 4 }}>
          {Math.ceil(Number(form.players) / 4)} foursomes · {form.players} golfers
        </div>
        {TEAM_BREAKDOWNS.map(t => (
          <button key={t.id} onClick={() => set('teamBreakdown', t.id)}
            style={{ padding: '16px', borderRadius: 'var(--tm-radius-lg)', border: '2px solid', borderColor: form.teamBreakdown === t.id ? 'var(--tm-gold)' : 'var(--tm-border)', background: form.teamBreakdown === t.id ? 'var(--tm-gold-muted)' : 'var(--tm-surface)', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15 }}>{t.label}</div>
              <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginTop: 2 }}>{t.desc}</div>
            </div>
            {form.teamBreakdown === t.id && <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--tm-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-inv)', fontSize: 11, fontWeight: 800 }}>✓</div>}
          </button>
        ))}
      </div>
    ) : (
      <div key="2-small" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TEAMS.map(t => (
          <button key={t.id} onClick={() => set('team', t.id)}
            style={{ padding: '16px', borderRadius: 'var(--tm-radius-lg)', border: '2px solid', borderColor: form.team === t.id ? 'var(--tm-gold)' : 'var(--tm-border)', background: form.team === t.id ? 'var(--tm-gold-muted)' : 'var(--tm-surface)', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15 }}>{t.label}</div>
              <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginTop: 2 }}>{t.desc}</div>
            </div>
            {form.team === t.id && <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--tm-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-inv)', fontSize: 11, fontWeight: 800 }}>✓</div>}
          </button>
        ))}
      </div>
    ),
  ]

  // Step 2's title shifts when the outing is large — same step number,
  // different question.
  const stepTitles = [
    'Set the Stage',
    'Scoring Format',
    Number(form.players) > 4 ? 'Team Breakdown' : 'Competition Structure',
  ]

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {activeMatchModal}
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tm-text)' }}>{stepTitles[step]}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 20 }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginBottom: 16 }}>Step {step+1} of 3</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {[0,1,2].map(i => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? 'var(--tm-green)' : 'var(--tm-surface-3)' }} />)}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {/* Pre-filled players from schedule modal */}
          {pendingPlayers.length > 0 && (
            <div style={{
              marginBottom: 16, padding: '12px 14px',
              background: 'rgba(232,192,90,0.08)', border: '1px solid rgba(232,192,90,0.2)',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(232,192,90,0.7)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                Pre-filled · {pendingPlayers.length + 1} Players
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {pendingPlayers.map(p => (
                  <div key={p.id} style={{
                    background: 'rgba(232,192,90,0.12)', border: '1px solid rgba(232,192,90,0.25)',
                    borderRadius: 20, padding: '4px 12px',
                    fontSize: 12, fontWeight: 600, color: '#F5D78A',
                  }}>{p.name}</div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>
                These players will be auto-added when you create the outing.
              </div>
            </div>
          )}
          {steps[step]}
        </div>
        {error && <div style={{ color: 'var(--tm-danger)', fontSize: 13, padding: '8px 20px', textAlign: 'center' }}>{error}</div>}
        <div style={{ padding: '16px 20px', display: 'flex', gap: 12, flexShrink: 0 }}>
          {step > 0 && <button onClick={() => setStep(s => s-1)} style={{ flex: 1, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text-2)', fontWeight: 700 }}>Back</button>}
          {step < 2
            ? <button onClick={() => setStep(s => s+1)} style={{ flex: 2, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))', color: '#fff', fontWeight: 800, fontSize: 15, border: 'none' }}>Next →</button>
            : <button onClick={handleCreate} disabled={loading} style={{ flex: 2, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))', color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 15, border: 'none' }}>{loading ? 'Creating…' : 'Create Match'}</button>
          }
        </div>
      </div>
    </div>,
    document.body
  )
}
