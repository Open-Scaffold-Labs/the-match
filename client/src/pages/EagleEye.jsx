import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import HoleMapGL from './HoleMapGL.jsx'
import { api, post, put } from '../lib/api.js'
import { greenFCB, matchPolygonsToHoles, matchTeesToHoles, estimateAltFromPressure, pointInPolygon, classifyLie } from '../lib/geo.js'
import { realBag, arcClubs, recommendClub } from '../lib/clubModel.js'
import { SHOT_LIES } from '../components/scorecard/ShotSheet.jsx'
import { readHoleBuffer, appendShot } from '../lib/shot-capture.js'
import { readSavedSoloRound, startSoloRound } from '../lib/solo-round.js'
import { CoursePicker } from '../components/CoursePicker.jsx'
import { readEyeHole, saveEyeHole } from '../lib/eye-hole.js'
import PlayStart from './PlayStart.jsx'
import { addRecent } from '../lib/course-recents.js'
import { useActiveMatchGuard } from './Outing/useActiveMatchGuard.jsx'
import { readSession, writeSession, clearSession } from '../lib/active-round-session.js'

// Feature flags — flip to false to disable a feature that isn't yet
// device-tested, without a revert/redeploy. Both degrade safely when off:
// tap-to-measure simply doesn't attach; F/C/B falls back to the single
// center number. (2026-06-06)
const ENABLE_FCB = true

// GPS accuracy gate (Phase 1.1) — a live yardage is only quoted when the fix
// is tight enough to be honest. coords.accuracy is the 68% horizontal radius
// in metres; beyond this we show "Acquiring GPS…" instead of a confidently-
// wrong number (the cold-start / tree-canopy / clubhouse failure mode that
// destroys trust on hole 1). ~10 m ≈ ±11 yd — past that the number isn't
// trustworthy to a golfer choosing a club. A null accuracy is untrusted.
const GPS_ACCURACY_GATE_M = 10
// GPS range gate (2026-07-07, Matt) — a fix can be accuracy-TRUSTED yet
// distance-IRRELEVANT: GPS on while away from the course quoted the drive
// to the course as a hole distance ("TO GREEN 16128"). No real hole
// approach exceeds 800 yds; past the gate the live read is discarded —
// the hero falls back to the static tee→green yardage and the GPS chip
// reads OUT OF RANGE. Per-hole, so it also covers standing on the course
// but far from the currently-viewed hole's green.
const GPS_RANGE_GATE_YDS = 800
import { log } from '../lib/logger.js'
import CoachMark from '../components/CoachMark.jsx'

// Module-level cache: keyed by `${courseId}-${teeName}` — survives re-renders,
// cleared only on page reload. Means switching holes is instant after first load.
const osmPositionCache = new Map()

// ─── localStorage persistence for OSM data (7-day TTL) ───────────────────────
// After the first load of a course, pins are instant on every subsequent visit.
const OSM_LS_TTL = 7 * 24 * 60 * 60 * 1000
// Per-course hole persistence (readEyeHole/saveEyeHole) extracted to
// lib/eye-hole.js (Phase 1 / S2, 2026-07-10) so round-start flows outside
// this file can reset the hole to 1 before seeding sharedCourse.

function lsLoadOsm(key) {
  try {
    const raw = localStorage.getItem(`tm-osm-${key}`)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > OSM_LS_TTL) { localStorage.removeItem(`tm-osm-${key}`); return null }
    return data
  } catch { return null }
}
function lsSaveOsm(key, data) {
  try { localStorage.setItem(`tm-osm-${key}`, JSON.stringify({ data, ts: Date.now() })) } catch {}
}

// ─── Dedupe male+female tee arrays into a single chip list ──────────────────
// The Golf Course API returns tees separately by gender. Most tee boxes
// (Blue, White, Red…) are physically the same and have identical hole data
// in both arrays — showing both as chips produces duplicates like
// "Gold (6464y), Gold (6464y)". This helper merges, keeping the first
// occurrence keyed by tee_name + total_yards. Female-only tees (rare —
// genuinely separate forward boxes) are suffixed " (W)" to keep them
// distinct without breaking equality with downstream cache keys.
// dedupeTees moved to client/src/lib/tees.js so the CreateWizard tee
// picker can share the same logic. Imported above; same behavior.
// (2026-05-06.)

// ─── Nearest-neighbor sort for untagged greens (spatial fallback) ────────────
function nearestNeighborSort(points, startLat, startLon) {
  if (!points.length) return []
  const remaining = [...points]
  const result = []
  let curLat = startLat, curLon = startLon
  while (remaining.length > 0) {
    let minD = Infinity, minI = 0
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].lat - curLat, remaining[i].lon - curLon)
      if (d < minD) { minD = d; minI = i }
    }
    const picked = remaining.splice(minI, 1)[0]
    result.push(picked)
    curLat = picked.lat; curLon = picked.lon
  }
  return result
}

// ─── Match greens to hole numbers using scorecard yardages ───────────────────
// Each hole has a unique yardage — find the tee→green distance that best matches
// the scorecard, then assign that green the correct hole number.
function matchGreensToHoles(greens, tees, scorecard) {
  if (!greens.length || !tees.length || !scorecard.length) return {}
  const assigned = {}
  const usedGreenIdxs = new Set()

  // Process most-distinctive yardages first (shortest par 3s and longest par 5s
  // are the most unique anchors, reducing cascading mis-assignments)
  const medY = [...scorecard].map(h => h.yardage).sort((a, b) => a - b)[Math.floor(scorecard.length / 2)]
  const sorted = [...scorecard].sort((a, b) =>
    Math.abs(b.yardage - medY) - Math.abs(a.yardage - medY)
  )

  for (const hole of sorted) {
    let bestGreenIdx = -1, bestDiff = Infinity

    for (let gi = 0; gi < greens.length; gi++) {
      if (usedGreenIdxs.has(gi)) continue
      // For this green, find the tee whose distance to the green is closest
      // to this hole's scorecard yardage
      for (const tee of tees) {
        const dist = haversineYards(tee, greens[gi])
        const diff = Math.abs(dist - hole.yardage)
        if (diff < bestDiff) { bestDiff = diff; bestGreenIdx = gi }
      }
    }

    if (bestGreenIdx >= 0 && bestDiff < 200) {
      assigned[hole.hole] = greens[bestGreenIdx]
      usedGreenIdxs.add(bestGreenIdx)
    }
  }

  log('[OSM] yardage-matched holes:', Object.keys(assigned).length, '/ 18, worst diff:', Math.round(
    Math.max(...Object.keys(assigned).map(h => {
      const g = assigned[h]; const s = scorecard.find(x => x.hole === parseInt(h))
      return Math.min(...tees.map(t => Math.abs(haversineYards(t, g) - s.yardage)))
    }))
  ), 'yds')
  return assigned
}

// ─── Bearing from one GPS point to another (0 = N, 90 = E, 180 = S, 270 = W) ─
function calcBearing(from, to) {
  if (!from || !to) return null
  const lat1 = from.lat * Math.PI / 180
  const lat2 = to.lat  * Math.PI / 180
  const dLon = (to.lon - from.lon) * Math.PI / 180
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

// ─── Project a GPS point along a bearing (degrees) for a given distance (m) ─
// Used by the bag-toggle landing-zone marker — given player position +

// ─── Cardinal direction label ─────────────────────────────────────────────────
function bearingLabel(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

// ─── Haversine distance in yards ─────────────────────────────────────────────
function haversineYards(a, b) {
  if (!a || !b) return null
  const R = 6371000 // metres
  const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180
  const Δφ = (b.lat - a.lat) * Math.PI / 180
  const Δλ = (b.lon - a.lon) * Math.PI / 180
  const x = Math.sin(Δφ/2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) ** 2
  return Math.round(Math.sqrt(x + (1-x)) * 2 * Math.asin(Math.sqrt(x)) * R * 1.09361)
}

// ─── Client-side "plays like" ────────────────────────────────────────────────
// Applies the same wind / temperature / altitude model the AI rangefinder
// uses (minus visual slope, which needs the photo) to the live GPS distance,
// so every glance shows an adjusted "plays like" number — not just the
// camera. Headwind + cold + low altitude all play longer. (2026-06-06)
// Mirror of PLAYSLIKE_K_ELEV in lib/geo.js — keep in sync. Uphill full;
// downhill ~⅔ (asymmetric). (rebuilt 2026-06-30)
const PLAYSLIKE_K_ELEV = 1 / 3
const PLAYSLIKE_DOWNHILL_FACTOR = 0.67
const PLAYSLIKE_CARRY_CEILING = 250   // wind/air-density act on one carry, not a whole hole (mirror geo.js)
// Mirrors computePlaysLike in lib/geo.js EXACTLY — edit BOTH. Sourced
// coefficients (see wiki/synthesis/playslike-accuracy-rebuild-2026-06-30.md):
// wind asymmetric (+1%/mph head, −0.5%/mph tail), temp 0.8%/10°F @70°F,
// altitude 1.16%/1000 ft, elevation geometric (separate from altitude).
// Per-channel caps. Additive so the UI's four factors sum to the total.
// `altFt` = ASL height; `elevDeltaFt` = target-minus-ball delta.
function computePlaysLike(baseYds, { windSpeed = 0, windFromDeg = null, shotBearing = null, tempF = null, altFt = 0, elevDeltaFt = null } = {}) {
  if (!baseYds || baseYds <= 0) return { plays: baseYds, adj: 0, base: baseYds || 0, factors: { wind: 0, temp: 0, alt: 0, elevation: 0 } }

  // Wind + air density act on a single carry, not the full distance — cap what
  // they scale on (≤250 ⇒ no change; a real aim/approach shot passes its own dist).
  const flightYds = Math.min(baseYds, PLAYSLIKE_CARRY_CEILING)

  // Wind — asymmetric; only the along-shot (cosine) component changes distance.
  let wind = 0
  if (windSpeed && windFromDeg != null && shotBearing != null) {
    const along = windSpeed * Math.cos(((shotBearing - windFromDeg) * Math.PI) / 180) // + head, − tail
    let pct = along >= 0 ? 0.010 * along : 0.005 * along                              // 1%/mph head, 0.5%/mph tail
    pct = Math.max(-0.30, Math.min(0.40, pct))
    wind = pct * flightYds
  }
  // Temperature — air density vs a 70°F baseline; colder plays longer.
  let temp = tempF != null ? ((70 - tempF) / 10) * 0.008 * flightYds : 0
  temp = Math.max(-0.10 * flightYds, Math.min(0.10 * flightYds, temp))
  // Altitude (ASL) — thinner air plays shorter.
  let alt = -((altFt || 0) / 1000) * 0.0116 * flightYds
  alt = Math.max(-0.15 * flightYds, Math.min(0.15 * flightYds, alt))
  // Elevation — geometric; uphill full, downhill ~⅔.
  let elevation = 0
  if (elevDeltaFt != null) {
    elevation = elevDeltaFt >= 0
      ? elevDeltaFt * PLAYSLIKE_K_ELEV
      : elevDeltaFt * PLAYSLIKE_K_ELEV * PLAYSLIKE_DOWNHILL_FACTOR
    elevation = Math.max(-40, Math.min(40, elevation))
  }
  const adj = wind + temp + alt + elevation
  return {
    plays: Math.max(0, Math.round(baseYds + adj)),
    adj: Math.round(adj),
    base: Math.round(baseYds),
    factors: { wind, temp, alt, elevation },
  }
}

// Round the precise plays-like factors to signed integers and derive a total
// that reconciles EXACTLY with them (total = base + Σ rounded factors), so the
// sheet's rows always add up to the number on the chip — no off-by-one between
// "the breakdown" and "the answer". (Phase 3.1, 2026-06-25)
function playsLikeView(pl) {
  if (!pl) return null
  const f = pl.factors || { wind: 0, temp: 0, alt: 0, elevation: 0 }
  const wind = Math.round(f.wind), temp = Math.round(f.temp), alt = Math.round(f.alt), elevation = Math.round(f.elevation)
  const adj = wind + temp + alt + elevation
  return { base: pl.base, wind, temp, alt, elevation, adj, total: Math.max(0, pl.base + adj) }
}

// ─── Pulsating Eagle Eye Button ───────────────────────────────────────────────
const PULSE_STYLE = `
  @keyframes ee-pulse {
    0%   { box-shadow: 0 0 0 0 rgb(var(--tm-ee-gold-rgb) / 0.55), 0 4px 20px rgb(var(--tm-ee-gold-rgb) / 0.3); transform: scale(1); }
    60%  { box-shadow: 0 0 0 16px rgb(var(--tm-ee-gold-rgb) / 0), 0 4px 24px rgb(var(--tm-ee-gold-rgb) / 0.4); transform: scale(1.04); }
    100% { box-shadow: 0 0 0 0 rgb(var(--tm-ee-gold-rgb) / 0), 0 4px 20px rgb(var(--tm-ee-gold-rgb) / 0.3); transform: scale(1); }
  }
  @keyframes ee-scan {
    0%   { opacity: 1; }
    50%  { opacity: 0.4; }
    100% { opacity: 1; }
  }
`

function EagleEyeBtn({ onPress, scanning }) {
  return (
    <>
      <style>{PULSE_STYLE}</style>
      <button
        onClick={onPress}
        disabled={scanning}
        style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'linear-gradient(145deg, var(--tm-ee-gold-bright), var(--tm-ee-gold))',
          border: '3px solid rgb(var(--tm-ee-white-rgb) / 0.25)',
          cursor: scanning ? 'default' : 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
          animation: scanning ? 'ee-scan 0.9s ease-in-out infinite' : 'ee-pulse 2s ease-out infinite',
          WebkitTapHighlightColor: 'transparent',
          outline: 'none',
        }}
      >
        {/* Eagle Eye target icon */}
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--tm-ee-bg-rgb) / 0.85)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="5"/>
          <circle cx="12" cy="12" r="1.5" fill="rgb(var(--tm-ee-bg-rgb) / 0.85)"/>
          <line x1="12" y1="2" x2="12" y2="5"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
          <line x1="2" y1="12" x2="5" y2="12"/>
          <line x1="19" y1="12" x2="22" y2="12"/>
        </svg>
      </button>
      <div style={{ color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.7)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginTop: 6, textTransform: 'uppercase' }}>
        {scanning ? 'Analyzing…' : 'Eagle Eye'}
      </div>
    </>
  )
}

// ─── Wind direction arrow ─────────────────────────────────────────────────────
function WindArrow({ deg }) {
  return (
    <span style={{ display: 'inline-block', transform: `rotate(${deg}deg)`, fontSize: 14 }}>↑</span>
  )
}

// ─── Distance instrument (Phase 2.3) ─────────────────────────────────────────
// The hero readout as a real rangefinder dial: a 270° SVG arc gauge wrapping
// an odometer-style number roll, both driven by the SAME rAF tween so they
// move in lockstep. The tween (ease-out toward the target) gives the "roll"
// without a heavyweight dependency and is reduced-motion aware. Angle θ is
// measured clockwise from 12 o'clock; the 270° track runs 225°→495° (a 90°
// gap centred on the bottom). (2026-06-24)
function useTween(target, ms = 480) {
  const [, force] = useState(0)
  const valRef = useRef(typeof target === 'number' ? target : 0)
  const rafRef = useRef(0)
  useEffect(() => {
    if (typeof target !== 'number') return
    const reduce = typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { valRef.current = target; force(n => n + 1); return }
    const from = valRef.current
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms)
      const e = 1 - Math.pow(1 - t, 3)            // easeOutCubic
      valRef.current = from + (target - from) * e
      force(n => n + 1)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, ms])
  return valRef.current
}

// Arc path: θ clockwise from top. x = cx + r·sinθ, y = cy − r·cosθ.
function gaugeArc(cx, cy, r, startDeg, sweepDeg) {
  const a0 = startDeg * Math.PI / 180
  const a1 = (startDeg + sweepDeg) * Math.PI / 180
  const x0 = cx + r * Math.sin(a0), y0 = cy - r * Math.cos(a0)
  const x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1)
  const large = Math.abs(sweepDeg) > 180 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

function DistanceInstrument({ yards, label, accent = 'var(--tm-ee-green)' }) {
  const RANGE = 320                               // yds at full 270° sweep
  const has = typeof yards === 'number'
  const shown = useTween(has ? yards : null)
  const sweep = Math.max(0, Math.min(1, (has ? shown : 0) / RANGE))
  const SZ = 132, C = SZ / 2, R = 56, GAP = 90, TRACK = 360 - GAP
  const display = has ? Math.round(shown) : '—'
  return (
    <div style={{ position: 'relative', width: SZ, height: SZ }}>
      <svg width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="ee-gauge-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--tm-ee-gold-pulse)" />
            <stop offset="55%" stopColor={accent} />
            <stop offset="100%" stopColor="var(--tm-ee-green-deep)" />
          </linearGradient>
        </defs>
        {/* track */}
        <path d={gaugeArc(C, C, R, 225, TRACK)} fill="none" stroke="rgb(var(--tm-ee-white-rgb) / 0.12)"
          strokeWidth="7" strokeLinecap="round" />
        {/* value */}
        {has && sweep > 0 && (
          <path d={gaugeArc(C, C, R, 225, TRACK * sweep)} fill="none" stroke="url(#ee-gauge-grad)"
            strokeWidth="7" strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 5px rgb(var(--tm-ee-gold-pulse-rgb) / 0.45))' }} />
        )}
      </svg>
      {/* number + unit, centred */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        {/* C2 (2026-07-07): micro-labels raised to the 11px outdoor floor */}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em',
          color: has ? accent : 'rgb(var(--tm-ee-white-rgb) / 0.45)', marginBottom: -2 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span style={{ fontSize: 46, fontWeight: 900, letterSpacing: '-2px', color: 'var(--tm-ee-raw)',
            lineHeight: 0.9, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"',
            textShadow: '0 2px 12px rgb(var(--tm-ee-black-rgb) / 0.5)' }}>{display}</span>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em',
          color: 'rgb(var(--tm-ee-white-rgb) / 0.5)', marginTop: 1 }}>YDS</div>
      </div>
    </div>
  )
}

// Primary readout view switch — DIAL (arc instrument) vs BIG (arm's-length
// glance). A labeled 2-segment control: the canonical pattern for switching
// between mutually-exclusive views of the same content (cf. the Maps
// Map/Satellite switcher), kept visible so it stays discoverable — a hidden
// gesture measurably hurts use. Each segment clears the 44pt touch floor.
// (C4, 2026-07-07)
function ModeToggle({ mode, onChange }) {
  const seg = (id, label) => {
    const active = mode === id
    return (
      <button
        key={id}
        onClick={() => onChange(id)}
        aria-pressed={active}
        aria-label={id === 'big' ? 'Big Numbers view' : 'Dial view'}
        style={{
          minWidth: 30, height: 44, padding: '0 7px', borderRadius: 999, border: 'none',
          background: active
            ? 'linear-gradient(180deg, rgb(var(--tm-ee-gold-rgb) / 0.32), rgb(var(--tm-ee-gold-rgb) / 0.18))'
            : 'transparent',
          color: active ? 'var(--tm-ee-gold-light)' : 'rgb(var(--tm-ee-white-rgb) / 0.5)',
          fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', cursor: 'pointer',
          fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
          boxShadow: active ? 'inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.18)' : 'none',
          transition: 'color 0.18s var(--tm-ease), background 0.18s var(--tm-ease)',
        }}>{label}</button>
    )
  }
  return (
    <div role="group" aria-label="Distance readout view" style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, padding: 2,
      background: 'rgb(var(--tm-ee-glass-rgb) / 0.62)',
      backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
      border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)', borderRadius: 999,
      boxShadow: '0 6px 18px rgb(var(--tm-ee-black-rgb) / 0.45), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.12)',
    }}>
      {seg('dial', 'DIAL')}
      {seg('big', 'BIG')}
    </div>
  )
}

// ─── Course Picker ────────────────────────────────────────────────────────────
// Extracted to components/CoursePicker.jsx (variant="sheet") — Phase 1 / S1a of
// the Play-funnel plan (2026-07-10). One picker, two verbatim variants; this
// file's dark sheet JSX moved unchanged.

// ─── Plays-Like Sheet (Phase 3.1) ────────────────────────────────────────────
// The transparent, adjustable breakdown. Tap the chip → this glass bottom sheet
// shows base → Wind / Elevation / Temp → total, each factor labeled auto/manual
// and individually overridable. Design-audit fixes baked in: total is the hero,
// wind dial is SHOT-RELATIVE (headwind at top, matching the course-up map),
// "manual" uses a text badge (never colour alone), ≥44px controls, tabular-nums,
// grabber handle, reduced-motion aware.
const PL_SHEET_STYLE = `
  @keyframes ee-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes ee-scrim-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .ee-pl-panel { animation: none !important; }
    .ee-pl-scrim { animation: none !important; }
  }
`
const normDeg = (d) => ((d % 360) + 360) % 360
const PL_LONGER = 'var(--tm-ee-amber)'   // plays longer (warm) — matches the existing PLAYS row
const PL_SHORTER = 'var(--tm-ee-green)'  // plays shorter (green)
const yardStr = (n) => (n > 0 ? `+${n}` : `${n}`)
const factorColor = (n) => (n > 0 ? PL_LONGER : n < 0 ? PL_SHORTER : 'rgb(var(--tm-ee-white-rgb) / 0.5)')

function PlStepper({ label, value, suffix, onDec, onInc, onReset, isManual }) {
  const btn = {
    width: 44, height: 44, borderRadius: 12, border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.16)',
    background: 'rgb(var(--tm-ee-white-rgb) / 0.06)', color: '#fff', fontSize: 22, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--tm-ee-white-rgb) / 0.7)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button aria-label={`decrease ${label}`} style={btn} onClick={onDec}>−</button>
        <span style={{ minWidth: 70, textAlign: 'center', fontSize: 18, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{value}{suffix}</span>
        <button aria-label={`increase ${label}`} style={btn} onClick={onInc}>+</button>
        {isManual && (
          <button onClick={onReset} style={{ ...btn, width: 'auto', height: 32, padding: '0 10px', fontSize: 12, fontWeight: 700, color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.9)' }}>RESET</button>
        )}
      </div>
    </div>
  )
}

// Shot-relative wind dial. "Toward target" is up (12 o'clock); the marker sits
// at the wind's FROM-direction relative to the shot, so a marker at the top is
// a pure headwind. Drag the marker to set wind direction. (≥44px hit handle.)
function WindDial({ windDir, windSpeed, shotBearing, onChange }) {
  const ref = useRef(null)
  const size = 150, c = size / 2, r = 56
  const relFrom = shotBearing != null && windDir != null ? normDeg(windDir - shotBearing) : 0
  const rad = (relFrom * Math.PI) / 180
  const mx = c + r * Math.sin(rad)
  const my = c - r * Math.cos(rad)
  const setFromPointer = (clientX, clientY) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const dx = clientX - (box.left + c), dy = clientY - (box.top + c)
    const angleFromTop = normDeg((Math.atan2(dx, -dy) * 180) / Math.PI)
    onChange(normDeg((shotBearing ?? 0) + angleFromTop))
  }
  const onDown = (e) => {
    e.preventDefault()
    const move = (ev) => { const t = ev.touches?.[0] ?? ev; setFromPointer(t.clientX, t.clientY) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
    const t = e.touches?.[0] ?? e; setFromPointer(t.clientX, t.clientY)
  }
  const label = relFrom <= 22.5 || relFrom >= 337.5 ? 'Headwind'
    : relFrom >= 157.5 && relFrom <= 202.5 ? 'Tailwind'
    : relFrom < 180 ? 'Wind off the right' : 'Wind off the left'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 10 }}>
      <svg ref={ref} width={size} height={size} onPointerDown={onDown} style={{ touchAction: 'none', cursor: 'grab' }}>
        <circle cx={c} cy={c} r={r} fill="rgb(var(--tm-ee-white-rgb) / 0.04)" stroke="rgb(var(--tm-ee-white-rgb) / 0.16)" strokeWidth="1.5" />
        {/* toward-target marker (top) */}
        <path d={`M ${c} ${c - r - 8} l -5 9 l 10 0 z`} fill="rgb(var(--tm-ee-green-rgb) / 0.9)" />
        <text x={c} y={c - r - 12} textAnchor="middle" fontSize="9" fontWeight="700" fill="rgb(var(--tm-ee-green-rgb) / 0.9)" letterSpacing="0.5">TARGET</text>
        <line x1={c} y1={c} x2={mx} y2={my} stroke={PL_LONGER} strokeWidth="2.5" strokeLinecap="round" />
        {/* draggable handle — visual 18px, generous hit via the whole svg pointerdown */}
        <circle cx={mx} cy={my} r="11" fill={PL_LONGER} stroke="var(--tm-ee-ink)" strokeWidth="2" />
        <text x={c} y={c + 4} textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" style={{ fontVariantNumeric: 'tabular-nums' }}>{windSpeed}</text>
        <text x={c} y={c + 18} textAnchor="middle" fontSize="8" fontWeight="600" fill="rgb(var(--tm-ee-white-rgb) / 0.5)">MPH</text>
      </svg>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'rgb(var(--tm-ee-white-rgb) / 0.75)', marginTop: 4 }}>{label}</span>
    </div>
  )
}

function PlRow({ name, sub, yds, isManual, expanded, onToggle, available = true, autoKnown = true, readOnly = false, children }) {
  const showValue = isManual || autoKnown
  const interactive = available && !readOnly
  return (
    <div style={{ borderTop: '1px solid rgb(var(--tm-ee-white-rgb) / 0.08)' }}>
      <button onClick={interactive ? onToggle : undefined} aria-expanded={readOnly ? undefined : expanded} style={{
        width: '100%', minHeight: 52, padding: '12px 4px', display: 'flex', alignItems: 'center', gap: 10,
        background: 'none', border: 'none', cursor: interactive ? 'pointer' : 'default', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
      }}>
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{name}</span>
          {sub && <span style={{ fontSize: 10, fontWeight: 600, color: 'rgb(var(--tm-ee-white-rgb) / 0.4)', marginTop: 1 }}>{sub}</span>}
        </span>
        {isManual ? (
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: 'var(--tm-ee-ink)', background: 'rgb(var(--tm-ee-gold-light-rgb) / 0.95)', borderRadius: 4, padding: '2px 5px' }}>MANUAL</span>
        ) : autoKnown && available ? (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgb(var(--tm-ee-white-rgb) / 0.4)' }}>AUTO</span>
        ) : available && !autoKnown ? (
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.6)' }}>SET</span>
        ) : null}
        {!available ? (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--tm-ee-white-rgb) / 0.35)' }}>—</span>
        ) : showValue ? (
          <span style={{ fontSize: 17, fontWeight: 800, color: factorColor(yds), fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' }}>{yardStr(yds)}</span>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'rgb(var(--tm-ee-white-rgb) / 0.3)', minWidth: 44, textAlign: 'right' }}>—</span>
        )}
        {interactive && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--tm-ee-white-rgb) / 0.4)" strokeWidth="2.5" strokeLinecap="round" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s' }}><polyline points="9 18 15 12 9 6"/></svg>
        )}
      </button>
      {!readOnly && expanded && available && <div style={{ padding: '0 4px 14px' }}>{children}</div>}
    </div>
  )
}

function PlaysLikeSheet({ open, onClose, view, eff, overrides, setOverrides, shotBearing, elevAvailable }) {
  const [activeRow, setActiveRow] = useState(null)
  if (!open || !view) return null
  const set = (k, v) => setOverrides(o => ({ ...o, [k]: v }))
  const clear = (...keys) => setOverrides(o => { const n = { ...o }; keys.forEach(k => delete n[k]); return n })
  const anyManual = Object.keys(overrides).length > 0
  const windManual = overrides.windSpeed != null || overrides.windDir != null
  const toggle = (row) => setActiveRow(r => (r === row ? null : row))
  const ftToYd = (ft) => Math.round(ft / 3) // display hint only

  return createPortal(
    <>
      <style>{PL_SHEET_STYLE}</style>
      <div className="ee-pl-scrim" onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgb(var(--tm-ee-black-rgb) / 0.5)', zIndex: 4000, animation: 'ee-scrim-in 0.2s ease-out',
      }} />
      <div className="ee-pl-panel" role="dialog" aria-label="Plays-like breakdown" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 4001, maxWidth: 480, margin: '0 auto',
        background: 'rgb(var(--tm-ee-glass-panel-rgb) / 0.92)', backdropFilter: 'blur(28px) saturate(160%)', WebkitBackdropFilter: 'blur(28px) saturate(160%)',
        borderTopLeftRadius: 22, borderTopRightRadius: 22, border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)', borderBottom: 'none',
        boxShadow: '0 -12px 40px rgb(var(--tm-ee-black-rgb) / 0.6), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.16)',
        padding: '8px 18px max(22px, env(safe-area-inset-bottom)) 18px', animation: 'ee-sheet-up 0.26s cubic-bezier(0.32,0.72,0,1)',
      }}>
        {/* grabber */}
        <div onClick={onClose} style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 12px', cursor: 'pointer' }}>
          <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgb(var(--tm-ee-white-rgb) / 0.22)' }} />
        </div>

        {/* hero total */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.8)' }}>PLAYS LIKE</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {/* C1 (2026-07-07): computed plays-like wears the ADJUSTED semantic (green) */}
              <span style={{ fontSize: 52, fontWeight: 900, lineHeight: 1, color: 'var(--tm-ee-adjusted)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px' }}>{view.total}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'rgb(var(--tm-ee-white-rgb) / 0.5)' }}>yds</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', paddingBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'rgb(var(--tm-ee-white-rgb) / 0.45)' }}>actual {view.base} yds</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: factorColor(view.adj), fontVariantNumeric: 'tabular-nums' }}>{yardStr(view.adj)} yds</div>
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <PlRow name="Wind" yds={view.wind} isManual={windManual} expanded={activeRow === 'wind'} onToggle={() => toggle('wind')} available={shotBearing != null}>
            <WindDial windDir={eff.windDir} windSpeed={eff.windSpeed} shotBearing={shotBearing} onChange={(d) => set('windDir', d)} />
            <PlStepper label="Wind speed" value={eff.windSpeed} suffix=" mph" isManual={windManual}
              onDec={() => set('windSpeed', Math.max(0, (eff.windSpeed ?? 0) - 1))}
              onInc={() => set('windSpeed', Math.min(60, (eff.windSpeed ?? 0) + 1))}
              onReset={() => clear('windSpeed', 'windDir')} />
          </PlRow>

          <PlRow name="Elevation" yds={view.elevation} isManual={overrides.elevDeltaFt != null} expanded={activeRow === 'elev'} onToggle={() => toggle('elev')} autoKnown={elevAvailable}>
            <div style={{ fontSize: 12, color: 'rgb(var(--tm-ee-white-rgb) / 0.5)', marginTop: 8 }}>
              {(eff.elevDeltaFt ?? 0) >= 0 ? 'Uphill' : 'Downhill'} {Math.abs(Math.round(eff.elevDeltaFt ?? 0))} ft (~{Math.abs(ftToYd(eff.elevDeltaFt ?? 0))} yd)
            </div>
            <PlStepper label="Elevation change" value={Math.round(eff.elevDeltaFt ?? 0)} suffix=" ft" isManual={overrides.elevDeltaFt != null}
              onDec={() => set('elevDeltaFt', (eff.elevDeltaFt ?? 0) - 3)}
              onInc={() => set('elevDeltaFt', (eff.elevDeltaFt ?? 0) + 3)}
              onReset={() => clear('elevDeltaFt')} />
          </PlRow>

          <PlRow name="Temperature" yds={view.temp} isManual={overrides.tempF != null} expanded={activeRow === 'temp'} onToggle={() => toggle('temp')}>
            <PlStepper label="Temperature" value={Math.round(eff.tempF ?? 70)} suffix="°F" isManual={overrides.tempF != null}
              onDec={() => set('tempF', Math.max(-20, Math.round(eff.tempF ?? 70) - 1))}
              onInc={() => set('tempF', Math.min(130, Math.round(eff.tempF ?? 70) + 1))}
              onReset={() => clear('tempF')} />
          </PlRow>

          {/* Altitude (air density) — auto, read-only. Shown only when it moves
              the number, so the rows ALWAYS sum to the total. It's a fact of
              where you're playing (thinner air at elevation), not a guess like
              wind, so it isn't overridable. (Phase 3.1) */}
          {view.alt !== 0 && (
            <PlRow name="Altitude" sub="thinner air at elevation" yds={view.alt} readOnly autoKnown />
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {anyManual && (
            <button onClick={() => setOverrides({})} style={{
              flex: 1, height: 46, borderRadius: 13, border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.16)', background: 'rgb(var(--tm-ee-white-rgb) / 0.05)',
              color: 'rgb(var(--tm-ee-white-rgb) / 0.8)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>Reset all to auto</button>
          )}
          <button onClick={onClose} style={{
            flex: 1, height: 46, borderRadius: 13, border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.4)',
            background: 'linear-gradient(180deg, rgb(var(--tm-ee-gold-rgb) / 0.28), rgb(var(--tm-ee-gold-rgb) / 0.16))',
            color: 'var(--tm-ee-gold-light)', fontSize: 14, fontWeight: 800, cursor: 'pointer', boxShadow: 'inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.15)',
          }}>Done</button>
        </div>
      </div>
    </>,
    document.body
  )
}

const CAPTURE_SHEET_STYLE = `
@keyframes ee-cap-scrim { from { opacity: 0 } to { opacity: 1 } }
@keyframes ee-cap-up { from { transform: translateY(100%) } to { transform: translateY(0) } }
`

// ── Shot capture confirm sheet (walk-and-confirm, Slice 1, 2026-07-07) ──────
// A dark "instrument" bottom sheet modeled on PlaysLikeSheet: a big tabular
// GPS-to-pin hero (frozen snapshot; manual entry when GPS isn't usable), a
// one-gesture club strip (auto-suggested from the bag), lie chips (default
// tee/fairway; keys are the server-valid VALID_LIES incl. `recovery`), and a
// single gold Confirm. Confirm-not-build: everything is pre-filled.
function ShotCaptureSheet({ open, snapshot, playsLike = null, gpsUsable, bag = [], suggestedSlot, firstShot, prevToPin = null, onGreen = false, autoLie = null, onConfirm, onClose }) {
  const [selSlot, setSelSlot] = useState(null)
  const [lie, setLie]         = useState(null)
  const [manual, setManual]   = useState('')
  // Initialise ONCE per opening. The prefill reads live inputs (e.g. gpsUsable)
  // that can flip mid-interaction; without this guard a re-run would clobber a
  // lie / club / distance the player just picked → a silently-wrong shot. So we
  // seed on the open false→true transition only, never on later dep churn.
  const initedRef = useRef(false)

  useEffect(() => {
    if (!open) { initedRef.current = false; return }
    if (initedRef.current) return
    initedRef.current = true
    setSelSlot(suggestedSlot ?? null)
    // Slice 4: a HIGH-confidence GPS auto-lie pre-selects the chip — never for
    // the tee shot (definitionally the tee). Otherwise the Slice-1 default; a
    // MEDIUM auto-lie only *suggests* (below), it never changes the selection.
    const hi = !firstShot && autoLie && autoLie.confidence === 'high' && autoLie.lie
    setLie(hi ? autoLie.lie : (firstShot ? 'tee' : 'fairway'))
    setManual(gpsUsable && snapshot != null ? String(Math.round(snapshot)) : '')
  }, [open, suggestedSlot, firstShot, gpsUsable, snapshot, autoLie?.lie, autoLie?.confidence])

  if (!open) return null

  const dist = gpsUsable && snapshot != null ? Math.round(snapshot) : parseInt(manual, 10)
  const distOk = Number.isFinite(dist) && dist > 0
  const selClub = bag.find(c => c.slot === selSlot) || null
  const canConfirm = distOk && !!lie
  const commit = () => {
    if (!canConfirm) return
    onConfirm({ lie, toPin: dist, ...(selClub ? { club: selClub.label } : {}) })
  }
  // Show the plays-like line only when it differs from the raw number.
  const showPlays = gpsUsable && snapshot != null && playsLike != null && playsLike !== Math.round(snapshot)
  // Trust nudges (non-blocking): a single shot over ~500y, or a distance-to-pin
  // that didn't DROP from the last shot, is almost always a mis-tap. Warn, never
  // block — a real recovery can legitimately go backwards.
  const farther = distOk && !firstShot && Number.isFinite(prevToPin) && dist >= prevToPin
  const implausible = distOk && dist > 500

  return createPortal(
    <>
      <style>{CAPTURE_SHEET_STYLE}</style>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgb(var(--tm-ee-black-rgb) / 0.62)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 4000, animation: 'ee-cap-scrim 0.2s ease-out' }} />
      <div role="dialog" aria-label="Log shot" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 4001, maxWidth: 480, margin: '0 auto',
        background: 'rgb(var(--tm-ee-glass-panel-rgb) / 0.94)', backdropFilter: 'blur(28px) saturate(160%)', WebkitBackdropFilter: 'blur(28px) saturate(160%)',
        borderTopLeftRadius: 22, borderTopRightRadius: 22, border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)', borderBottom: 'none',
        boxShadow: '0 -12px 40px rgb(var(--tm-ee-black-rgb) / 0.6), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.16)',
        padding: '8px 18px max(22px, env(safe-area-inset-bottom)) 18px', animation: 'ee-cap-up 0.26s cubic-bezier(0.32,0.72,0,1)',
      }}>
        <div onClick={onClose} style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 10px', cursor: 'pointer' }}>
          <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgb(var(--tm-ee-white-rgb) / 0.22)' }} />
        </div>

        {onGreen && (
          <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 12, background: 'rgb(var(--tm-ee-gold-rgb) / 0.12)', border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.3)', fontSize: 11.5, fontWeight: 600, color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.95)', lineHeight: 1.4, textAlign: 'center' }}>
            You're on the green — this looks like a putt. Log putts on the scorecard, not here.
          </div>
        )}

        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.8)' }}>TO PIN</div>
          {gpsUsable && snapshot != null ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: 60, fontWeight: 900, lineHeight: 1.05, color: 'var(--tm-ee-gold-light)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-1px' }}>{Math.round(snapshot)}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'rgb(var(--tm-ee-white-rgb) / 0.5)' }}>yds</span>
              </div>
              {showPlays && (
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-ee-adjusted)', marginTop: 2 }}>
                  plays <span style={{ fontVariantNumeric: 'tabular-nums' }}>{playsLike}</span>{selClub ? ` · ${selClub.label}` : ''}
                </div>
              )}
            </>
          ) : (
            <div style={{ marginTop: 6 }}>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={manual} placeholder="yds"
                onChange={e => setManual(e.target.value.replace(/\D/g, '').slice(0, 3))}
                style={{ width: 150, textAlign: 'center', padding: '10px 12px', borderRadius: 12, background: 'rgb(var(--tm-ee-white-rgb) / 0.06)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.16)', color: 'var(--tm-ee-gold-light)', fontSize: 30, fontWeight: 900, fontVariantNumeric: 'tabular-nums', outline: 'none' }} />
              <div style={{ fontSize: 10, fontWeight: 600, color: 'rgb(var(--tm-ee-white-rgb) / 0.55)', marginTop: 4 }}>GPS not locked — enter yards to pin</div>
            </div>
          )}
        </div>

        {bag.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'rgb(var(--tm-ee-white-rgb) / 0.55)', marginBottom: 6 }}>CLUB</div>
            <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 6, marginBottom: 14, WebkitOverflowScrolling: 'touch' }}>
              {bag.map(c => {
                const on = c.slot === selSlot
                return (
                  <button key={c.slot} onClick={() => setSelSlot(c.slot)} style={{
                    flex: '0 0 auto', minWidth: 46, padding: '8px 12px', borderRadius: 12, cursor: 'pointer',
                    background: on ? 'rgb(var(--tm-ee-gold-rgb) / 0.22)' : 'rgb(var(--tm-ee-white-rgb) / 0.05)',
                    border: on ? '1.5px solid rgb(var(--tm-ee-gold-rgb) / 0.5)' : '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)',
                    color: on ? 'var(--tm-ee-gold-light)' : 'rgb(var(--tm-ee-white-rgb) / 0.7)', fontWeight: 800, fontSize: 13,
                  }}>{c.label}</button>
                )
              })}
            </div>
          </>
        )}

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'rgb(var(--tm-ee-white-rgb) / 0.55)', marginBottom: 6 }}>LIE</div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18 }}>
          {SHOT_LIES.map(l => {
            const on = l.key === lie
            return (
              <button key={l.key} onClick={() => setLie(l.key)} style={{
                padding: '8px 14px', borderRadius: 14, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: on ? 'rgb(var(--tm-ee-gold-rgb) / 0.22)' : 'rgb(var(--tm-ee-white-rgb) / 0.05)',
                border: on ? '1.5px solid rgb(var(--tm-ee-gold-rgb) / 0.5)' : '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)',
                color: on ? 'var(--tm-ee-gold-light)' : 'rgb(var(--tm-ee-white-rgb) / 0.7)',
              }}>{l.label}</button>
            )
          })}
        </div>

        {autoLie && autoLie.lie && !firstShot && !onGreen && (autoLie.confidence === 'high' || autoLie.confidence === 'medium') && (() => {
          const autoLabel = (SHOT_LIES.find(l => l.key === autoLie.lie) || {}).label || autoLie.lie
          if (autoLie.confidence === 'high' && lie === autoLie.lie) {
            return (
              <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 12, background: 'rgb(var(--tm-ee-gold-rgb) / 0.12)', border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.28)', fontSize: 11, fontWeight: 700, color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.95)', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span aria-hidden="true">✓</span> {autoLabel} · detected from GPS
              </div>
            )
          }
          if (lie === autoLie.lie) return null
          return (
            <button onClick={() => setLie(autoLie.lie)} style={{
              width: '100%', marginBottom: 12, padding: '9px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
              background: 'rgb(var(--tm-ee-gold-rgb) / 0.10)', border: '1px dashed rgb(var(--tm-ee-gold-rgb) / 0.4)',
              fontSize: 11.5, fontWeight: 700, color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.95)', lineHeight: 1.4,
            }}>
              GPS suggests <strong>{autoLabel}</strong> — tap to set
            </button>
          )
        })()}

        {(farther || implausible) && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 12, background: 'rgb(var(--tm-ee-gold-rgb) / 0.10)', border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.28)', fontSize: 11, fontWeight: 600, color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.95)', lineHeight: 1.4 }}>
            {implausible
              ? `${dist} yds is a long way for one shot — double-check the number.`
              : `Farther than your last shot (${prevToPin} yds). Distance to the pin usually drops — sure?`}
          </div>
        )}
        <button onClick={commit} disabled={!canConfirm} style={{
          width: '100%', height: 52, borderRadius: 14, border: 'none', cursor: canConfirm ? 'pointer' : 'default',
          background: canConfirm ? 'linear-gradient(135deg, var(--tm-ee-gold), var(--tm-ee-gold-light))' : 'rgb(var(--tm-ee-white-rgb) / 0.08)',
          color: canConfirm ? 'rgb(var(--tm-ee-black-rgb))' : 'rgb(var(--tm-ee-white-rgb) / 0.4)', fontSize: 16, fontWeight: 900, letterSpacing: '0.04em',
        }}>Confirm Shot</button>
      </div>
    </>,
    document.body
  )
}

// ─── Main EagleEye ────────────────────────────────────────────────────────────
export default function EagleEye({ user, onGoToScorecard, onExit, eyeHoleNudge = null, onConsumeEyeHoleNudge, sharedCourse = null, onCourseSelected, activeScoring = null, onMatchStarted, isActive = true, quickSheet = null, onQuickSheetChange } = {}) {
  const [gps, setGps]               = useState(null)
  const [gpsError, setGpsError]     = useState(null) // 'denied' | 'unavailable' | 'timeout'
  const [teeGps, setTeeGps]         = useState(null)
  const [weather, setWeather]       = useState(null)
  const [courseCtx, setCourseCtx]   = useState(null)
  const [currentHole, setCurrentHole] = useState(() => readEyeHole(sharedCourse?.course?.id) || 1)

  // Cross-tab nudge from the live match's score modal: "user just scored
  // hole N, take them to Eagle Eye on hole N+1." App.jsx sets the nudge,
  // we pick it up here, advance currentHole, and tell App we've consumed
  // it so it can clear. (2026-05-01)
  useEffect(() => {
    if (eyeHoleNudge == null) return
    if (eyeHoleNudge !== currentHole) setCurrentHole(eyeHoleNudge)
    // GET DISTANCES is an explicit "take me to the map" — never land it on
    // the start screen. (2026-07-10 session model.)
    setShowStart(false)
    onConsumeEyeHoleNudge?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eyeHoleNudge])
  const [showPicker, setShowPicker] = useState(false)
  const [viewMode, setViewMode]     = useState('distance') // 'distance' | 'map'

  // ─── Bag picker (2026-05-01) ───
  // Pulls the user's bag once on mount. When a club is picked, HoleMap
  // draws an expected-landing-zone ring at the player's GPS position
  // with radius = club.avg_yards.
  const [myBag, setMyBag]           = useState([])
  const [bagOpen, setBagOpen]       = useState(false)
  const [selectedClub, setSelectedClub] = useState(null)
  const [bagArcsOn, setBagArcsOn] = useState(false) // Phase 3.3 — show own-club zones
  // Layup range-arcs toggle (2.5, 2026-07-02) — opt-in + persisted; the
  // category-correct default is a clean map, and the preference is remembered.
  const [ringsOn, setRingsOn] = useState(() => {
    try { return localStorage.getItem('tm-eye-rings') === '1' } catch { return false }
  })
  const toggleRings = () => setRingsOn(v => {
    const next = !v
    try { localStorage.setItem('tm-eye-rings', next ? '1' : '0') } catch { /* private mode */ }
    return next
  })
  // C4 "Big Numbers" glance mode (2026-07-07) — a stripped, arm's-length
  // readout: giant centre-to-green with FRONT/BACK promoted to labels, the map
  // scrimmed for sunlight contrast. Opt-in + persisted (tm-eye-bignums),
  // mirroring the rings/halo pattern; the DIAL|BIG segmented switch lives
  // bottom-centre in the thumb zone. Cheap revert: this flag + the bigMode
  // branch in the distance-view render.
  const [bigMode, setBigMode] = useState(() => {
    try { return localStorage.getItem('tm-eye-bignums') === '1' } catch { return false }
  })
  const setBig = (on) => {
    try { localStorage.setItem('tm-eye-bignums', on ? '1' : '0') } catch { /* private mode */ }
    setBigMode(on)
  }
  useEffect(() => {
    let alive = true
    api('/api/clubs/bag').then(d => {
      if (alive) setMyBag(d?.clubs ?? [])
    }).catch(() => {})
    return () => { alive = false }
  }, [])
  // Reset the active club whenever the user switches holes — each hole
  // starts fresh with the toggle in its idle BAG state, ready for a
  // new recommendation. (2026-05-01)
  useEffect(() => { setSelectedClub(null) }, [currentHole])
  useEffect(() => { setBagArcsOn(false) }, [currentHole])

  // Persist the current hole per course so a reload resumes it. (2026-06-06)
  useEffect(() => {
    const cid = courseCtx?.course?.id ?? sharedCourse?.course?.id
    if (cid) saveEyeHole(cid, currentHole)
  }, [currentHole, courseCtx, sharedCourse])

  // Keep the screen awake while on a course — golfers leave the app up
  // between shots and the screen sleeping mid-round is a constant
  // annoyance. The Wake Lock auto-releases when the tab is backgrounded,
  // so re-acquire on visibilitychange. Engages only once a course is
  // selected, releases when cleared. No-ops where unsupported. (2026-06-06)
  useEffect(() => {
    if (!courseCtx) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let lock = null
    let released = false
    const acquire = async () => {
      try { lock = await navigator.wakeLock.request('screen') } catch { /* denied / not visible */ }
    }
    const onVis = () => { if (document.visibilityState === 'visible' && !released) acquire() }
    acquire()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVis)
      try { lock && lock.release() } catch { /* already gone */ }
    }
  }, [courseCtx])

  // OSM course data: geocoded position, tee coords, green coords
  const [courseGeocoded, setCourseGeocoded] = useState(null)
  const [holePositions, setHolePositions]   = useState({}) // { 1: {lat,lon}, ... } tees
  const [greenPositions, setGreenPositions] = useState({}) // { 1: {lat,lon}, ... } greens
  const [greenPolys, setGreenPolys]         = useState({}) // { 1: [{lat,lon},...] } OSM green polygons → F/C/B
  const [fairwayPolys, setFairwayPolys]     = useState([]) // Slice 4: course-wide golf=fairway polygons → auto-lie
  const [bunkerPolys, setBunkerPolys]       = useState([]) // Slice 4: course-wide golf=bunker polygons → auto-lie
  // Full geometry of each golf=hole way: array of {lat, lon} tracing the
  // playing line from tee through the fairway to the green. Used for
  // dogleg-aware aim-point default placement (par 4/5 layup along the
  // fairway centerline). Empty {} if OSM had no way data for the hole.
  // (2026-05-01)
  const [holeGeometries, setHoleGeometries] = useState({})
  const [osmLoading, setOsmLoading]         = useState(false)
  // Curated per-course hole overrides (tm_course_holes, migration 043) — the
  // AUTHORITATIVE layout for courses OSM can't place (no golf=hole routing, e.g.
  // Beacon Hill). Kept in a ref so the OSM load can overlay them onto its result
  // no matter which finishes first (override always wins). Shape:
  // { tees:{[hole]:{lat,lon}}, greens:{...}, geoms:{[hole]:[{lat,lon},...]} }.
  // A hole with tee+green here gets a real tee→(aim)→green line and reads as
  // layout-confident downstream. (2026-07-09)
  const [holeOverrides, setHoleOverrides]   = useState({ tees: {}, greens: {}, geoms: {}, count: 0 })
  const holeOverridesRef = useRef({ tees: {}, greens: {}, geoms: {} })

  const watchIdRef = useRef(null)
  // Weather is fetched from open-meteo and changes slowly over a round, so
  // we throttle it to once per WEATHER_TTL instead of firing it on every
  // GPS tick (the watch fires continuously while walking — the per-tick
  // fetch was hundreds of needless requests + re-renders per round, a
  // primary cause of on-course lag). This gates ONLY the weather call; the
  // GPS position + distance path is untouched and stays full-frequency.
  // (2026-06-01)
  const lastWeatherRef = useRef(0)
  const WEATHER_TTL = 10 * 60 * 1000 // 10 min

  // Hybrid GPS auto-start on mount. Without this, GPS only kicks in when
  // the user taps "Enable Location" — but the cross-tab flow (GET DISTANCES
  // pill on the scorecard → land on Eye with a course already loaded) skips
  // past the landing UI's Enable button, so GPS never starts and Eye sits
  // empty. Strategy:
  //   1. If Permissions API exists, query geolocation state. If 'granted',
  //      iOS has cached the prior user-gesture grant — startGpsWatch
  //      silently. If 'prompt' / 'denied', leave it to the user gesture
  //      / existing error UI. Cleanest path on iOS 16+.
  //   2. If no Permissions API (older Safari, etc.), just attempt
  //      startGpsWatch directly. iOS will succeed if permission is cached;
  //      otherwise watchPosition's onError fires and the existing GPS
  //      error banner appears.
  // First-time visitors (no cached permission, no Permissions API support)
  // still see the Enable Location button as the explicit user-gesture path.
  // (2026-05-01)
  useEffect(() => {
    if (!navigator.geolocation) return
    let cancelled = false
    ;(async () => {
      if (navigator.permissions?.query) {
        try {
          const result = await navigator.permissions.query({ name: 'geolocation' })
          if (cancelled) return
          if (result.state === 'granted') startGpsWatch()
        } catch {
          if (!cancelled) startGpsWatch()
        }
      } else {
        startGpsWatch()
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startGpsWatch() {
    if (!navigator.geolocation || watchIdRef.current != null) return
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        setGpsError(null)
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude, acc: pos.coords.accuracy }
        setGps(coords)
        // Weather only — throttled. GPS position above is unthrottled.
        const now = Date.now()
        if (now - lastWeatherRef.current >= WEATHER_TTL) {
          lastWeatherRef.current = now
          fetchWeather(coords)
        }
      },
      err => {
        if (err.code === 1) setGpsError('denied-hard')
        else if (err.code === 2) setGpsError('unavailable')
        else setGpsError('timeout')
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  // requestLocation must be called from a user tap — iOS won't show the dialog otherwise
  function requestLocation() {
    if (!navigator.geolocation) { setGpsError('unavailable'); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGpsError(null)
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude, acc: pos.coords.accuracy }
        setGps(coords)
        // First fix on arrival → fetch weather once and seed the throttle.
        lastWeatherRef.current = Date.now()
        fetchWeather(coords)
        startGpsWatch()
      },
      err => {
        if (err.code === 1) setGpsError('denied-hard')
        else if (err.code === 2) setGpsError('unavailable')
        else setGpsError('timeout')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // Cleanup only — no auto-request on mount
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [])

  // Geocode course + fetch tee/green coordinates from OSM when course is selected
  useEffect(() => {
    if (!courseCtx) return
    setCourseGeocoded(null)
    setHolePositions({})
    setGreenPositions({})
    setHoleGeometries({})
    setOsmLoading(true)

    const { club_name, city, state } = courseCtx.course
    // v2 cache: bumped 2026-05-01 when holeGeometries was added to the
    // payload. Pre-v2 entries lack the geometry array, which means
    // par 4/5 aim defaults fall back to a straight-line interpolation
    // and can land OOB on dogleg holes. Bumping the key forces a single
    // fresh Overpass fetch per (course, tee) combo so the new geometry-
    // aware behavior kicks in immediately.
    // v3 (2026-06-06): added green polygons (polys) to the payload for
    // Front/Center/Back green distances. Bumping the key forces one fresh
    // fetch per (course, tee) so stale v2 entries without polygons fall
    // back cleanly to the single center number.
    // v4 (2026-07-08): added course-wide fairway + bunker polygons
    // (fairwayPolys/bunkerPolys) for Slice-4 auto-lie.
    // v5 (2026-07-09): refless-course tee binding + resilient geocode changed
    // what a successful load produces (tees now bind on courses OSM maps as
    // unlabeled polygons). Bump forces one fresh fetch so a pre-v5 entry — which
    // may hold an empty / tee-less payload written by the old abort-on-Nominatim
    // path — is discarded instead of replayed forever.
    const cacheKey = `v5-${courseCtx.course.id}-${courseCtx.tee.tee_name}`

    // A cached payload with neither tees nor greens is not useful and must NOT
    // be served on an early return — otherwise one bad load (a transient
    // geocode/Overpass miss) poisons the course until the 7-day TTL expires and
    // the map stays blank on every reload (exactly the Beacon Hill symptom:
    // weather showed from the centroid, but geometry replayed empty). Treat
    // empty as a cache miss → re-fetch; the server's Overpass L1/L2 cache
    // absorbs the repeat. (2026-07-09)
    const hasGeom = p => !!p && ((p.tees && Object.keys(p.tees).length > 0) || (p.greens && Object.keys(p.greens).length > 0))

    // 1️⃣ In-memory cache (survives re-renders within a page session)
    if (osmPositionCache.has(cacheKey) && hasGeom(osmPositionCache.get(cacheKey))) {
      const cached = osmPositionCache.get(cacheKey)
      const ov = holeOverridesRef.current
      setCourseGeocoded(cached.geocoded)
      setHolePositions({ ...cached.tees, ...ov.tees })
      setGreenPositions({ ...cached.greens, ...ov.greens })
      setHoleGeometries({ ...(cached.geoms || {}), ...ov.geoms })
      setGreenPolys(cached.polys || {})
      setFairwayPolys(cached.fairwayPolys || [])
      setBunkerPolys(cached.bunkerPolys || [])
      setOsmLoading(false)
      return
    }
    // 2️⃣ localStorage cache (survives page reloads — 7-day TTL)
    const stored = lsLoadOsm(cacheKey)
    if (stored && hasGeom(stored)) {
      osmPositionCache.set(cacheKey, stored) // also warm in-memory cache
      const ov = holeOverridesRef.current
      setCourseGeocoded(stored.geocoded)
      setHolePositions({ ...stored.tees, ...ov.tees })
      setGreenPositions({ ...stored.greens, ...ov.greens })
      setHoleGeometries({ ...(stored.geoms || {}), ...ov.geoms })
      setGreenPolys(stored.polys || {})
      setFairwayPolys(stored.fairwayPolys || [])
      setBunkerPolys(stored.bunkerPolys || [])
      setOsmLoading(false)
      return
    }

    const q = [club_name, city, state].filter(Boolean).join(', ')
    // The course's OWN coordinates (golfcourseapi, via /api/courses/:id) are the
    // authoritative anchor. We used to geocode via public Nominatim and ABORT the
    // entire OSM load when it returned nothing — which blanked the whole Eye (no
    // tees/greens/lines/weather) on any course Nominatim couldn't find, e.g.
    // Beacon Hill CC. Now the course lat/lon anchors the bbox; Nominatim only
    // *tightens* it (and only when it resolves near the anchor, so a same-named
    // course elsewhere can't hijack the box). A Nominatim miss no longer aborts.
    // (2026-07-09)
    const courseLat = Number(courseCtx.course?.latitude)
    const courseLon = Number(courseCtx.course?.longitude)
    const haveCourseLoc = Number.isFinite(courseLat) && Number.isFinite(courseLon)

    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`)
      .then(r => r.json())
      .catch(() => null)   // flaky public dep — a miss must degrade, not abort
      .then(data => {
        const hit = Array.isArray(data) ? data[0] : null
        let gc = null
        if (hit) {
          const nLat = parseFloat(hit.lat), nLon = parseFloat(hit.lon)
          // Trust Nominatim's tighter bbox only if it lands near the course
          // anchor (≤5000 yds); otherwise it's a same-named course elsewhere.
          const near = !haveCourseLoc || (Number.isFinite(nLat) && Number.isFinite(nLon) &&
            (haversineYards({ lat: courseLat, lon: courseLon }, { lat: nLat, lon: nLon }) ?? Infinity) <= 5000)
          if (near) {
            const bb = hit.boundingbox // [minlat, maxlat, minlon, maxlon]
            gc = {
              lat: Number.isFinite(nLat) ? nLat : courseLat,
              lon: Number.isFinite(nLon) ? nLon : courseLon,
              bbox: bb ? {
                south: parseFloat(bb[0]), north: parseFloat(bb[1]),
                west:  parseFloat(bb[2]), east:  parseFloat(bb[3]),
              } : null,
            }
          }
        }
        // Fall back to the course's own coordinates when Nominatim missed or was
        // rejected as a namesake — this is the resilience that keeps the Eye alive.
        if (!gc && haveCourseLoc) gc = { lat: courseLat, lon: courseLon, bbox: null }
        if (!gc) { setOsmLoading(false); return }   // no location anywhere — can't query OSM
        setCourseGeocoded(gc)

        // Use tight Nominatim bbox for Overpass (avoids picking up neighboring
        // courses); else a ~1mi box around the course anchor.
        const ovBbox = gc.bbox
          ? `${gc.bbox.south},${gc.bbox.west},${gc.bbox.north},${gc.bbox.east}`
          : `${gc.lat - 0.015},${gc.lon - 0.015},${gc.lat + 0.015},${gc.lon + 0.015}`

        log('[OSM] Overpass bbox:', ovBbox)
        // Fetch both queries in parallel:
        //   holes  — golf=hole ways with ref tags (authoritative hole numbers + tee/green geometry)
        //   teegreen — individual tee/green nodes (gap-fill for any holes the way query missed)
        // Server proxies via 3 Overpass mirrors with internal fallback.
        // If all mirrors return non-OK, server returns { error: ... } — we
        // coerce that to an empty {elements:[]} so downstream loops still
        // work (the localStorage 7-day cache is the actual fallback).
        const safeOsm = r => r.json().then(d => d?.error ? { elements: [] } : d).catch(() => ({ elements: [] }))
        return Promise.all([
          fetch(`/api/eagle-eye/osm?bbox=${encodeURIComponent(ovBbox)}&type=holes`).then(safeOsm),
          fetch(`/api/eagle-eye/osm?bbox=${encodeURIComponent(ovBbox)}&type=teegreen`).then(safeOsm),
          fetch(`/api/eagle-eye/osm?bbox=${encodeURIComponent(ovBbox)}&type=greengeom`).then(safeOsm),
          fetch(`/api/eagle-eye/osm?bbox=${encodeURIComponent(ovBbox)}&type=surfaces`).then(safeOsm).catch(() => ({ elements: [] })),
        ]).then(([osmHoles, osmNodes, osmGreenGeom, osmSurfaces]) => {
            const scorecard = courseCtx?.tee?.holes ?? []
            const holeTees = {}, holeGreens = {}

            // ── Primary: golf=hole ways (have authoritative ref → hole number) ──
            // We also keep el.geometry — the full path of {lat,lon} points
            // tracing the playing line through the fairway. This lets the
            // aim-point default sit on the fairway centerline even on
            // doglegs. (2026-05-01)
            const holeWaysByRef = {}
            const holeGeoms     = {}
            for (const el of osmHoles.elements) {
              if (el.type !== 'way' || el.geometry?.length < 2) continue
              const ref = parseInt(el.tags?.ref)
              if (!(ref >= 1 && ref <= 18)) continue
              if (!holeWaysByRef[ref]) holeWaysByRef[ref] = []
              const first   = el.geometry[0]
              const last    = el.geometry[el.geometry.length - 1]
              const teePt   = { lat: first.lat, lon: first.lon }
              const greenPt = { lat: last.lat,  lon: last.lon }
              const geom    = el.geometry.map(p => ({ lat: p.lat, lon: p.lon }))
              holeWaysByRef[ref].push({ tee: teePt, green: greenPt, dist: haversineYards(teePt, greenPt), geom })
            }
            for (const [refStr, ways] of Object.entries(holeWaysByRef)) {
              const holeNum    = parseInt(refStr)
              const scoreYards = scorecard.find(h => h.hole === holeNum)?.yardage
              // Pick the tee-set whose distance best matches the selected tee color yardage
              const picked = (scoreYards && ways.length > 1)
                ? ways.reduce((b, w) => Math.abs(w.dist - scoreYards) < Math.abs(b.dist - scoreYards) ? w : b)
                : ways[0]
              holeTees[holeNum]   = picked.tee
              holeGreens[holeNum] = picked.green
              holeGeoms[holeNum]  = picked.geom
            }
            log('[OSM] golf=hole ways found:', Object.keys(holeTees).length)

            // ── Gap-fill: teegreen nodes for any holes the way query missed ──
            const refTees = {}, refGreens = {}
            const unrefGreens = [], unrefTees = []
            for (const el of osmNodes.elements) {
              const lat = el.lat ?? el.center?.lat
              const lon = el.lon ?? el.center?.lon ?? el.center?.lng
              if (!lat || !lon) continue
              const ref = parseInt(el.tags?.ref)
              if (ref >= 1 && ref <= 18) {
                if (el.tags?.golf === 'tee')        refTees[ref]   = { lat, lon }
                else if (el.tags?.golf === 'green') refGreens[ref] = { lat, lon }
              } else if (el.tags?.golf === 'green') {
                unrefGreens.push({ lat, lon })
              } else if (el.tags?.golf === 'tee') {
                unrefTees.push({ lat, lon })
              }
            }

            // Fill any hole not already covered by golf=hole ways
            const missingHoles = scorecard.filter(h => !holeTees[h.hole] || !holeGreens[h.hole])
            let gapFills = 0
            for (const h of missingHoles) {
              if (!holeTees[h.hole]   && refTees[h.hole])   { holeTees[h.hole]   = refTees[h.hole];   gapFills++ }
              if (!holeGreens[h.hole] && refGreens[h.hole]) { holeGreens[h.hole] = refGreens[h.hole]; gapFills++ }
            }

            // For holes still missing greens, try yardage-matching unref'd green nodes
            const stillNoGreen = scorecard.filter(h => !holeGreens[h.hole])
            if (stillNoGreen.length > 0 && unrefGreens.length > 0) {
              const teePool = Object.values(holeTees).length > 0 ? Object.values(holeTees) : unrefTees
              const matched = matchGreensToHoles(unrefGreens, teePool, stillNoGreen)
              for (const [hStr, green] of Object.entries(matched)) {
                holeGreens[parseInt(hStr)] = green
                gapFills++
              }
            }
            // Last resort: spatial sort for completely unmapped courses
            const stillNoAnything = scorecard.filter(h => !holeTees[h.hole] && !holeGreens[h.hole])
            if (stillNoAnything.length === scorecard.length && unrefGreens.length >= 9) {
              const ordered = nearestNeighborSort(unrefGreens, gc.lat, gc.lon)
              ordered.forEach((g, i) => { holeGreens[i + 1] = g })
            }

            // ── Tee gap-fill for refless / no-golf=hole courses (e.g. Beacon
            // Hill: 45 unlabeled tee nodes, zero hole numbers). A hole may now
            // have a green but still no tee — so the tee marker and the straight
            // tee→green hole line can't draw. Bind each tee-less hole the UNUSED
            // tee whose green-distance best matches the scorecard yardage.
            // (2026-07-09)
            const stillNoTee = scorecard.filter(h => !holeTees[h.hole] && holeGreens[h.hole])
            if (stillNoTee.length > 0 && unrefTees.length > 0) {
              const matchedTees = matchTeesToHoles(unrefTees, holeGreens, stillNoTee)
              for (const [hStr, tee] of Object.entries(matchedTees)) {
                holeTees[parseInt(hStr)] = tee
                gapFills++
              }
            }

            // ── Front/Center/Back: associate green polygons to holes ──
            // golf=green ways carry no hole ref and the count exceeds 18
            // (practice greens), so match each hole's green-center point to
            // the nearest polygon centroid within ~40y. (2026-06-06)
            const greenPolygons = (osmGreenGeom?.elements ?? [])
              .filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 3)
              .map(el => el.geometry.map(p => ({ lat: p.lat, lon: p.lon })))
            const holePolys = matchPolygonsToHoles(holeGreens, greenPolygons, 40)
            log('[OSM] green polygons:', greenPolygons.length, '→ matched holes:', Object.keys(holePolys).length)

            log('[OSM] coverage:', Object.keys(holeTees).length, 'tees,', Object.keys(holeGreens).length, 'greens,', Object.keys(holeGeoms).length, 'geoms — gap-fills:', gapFills)
            // Curated overrides win over the OSM/reconstructed layout. Overlaid
            // at setState only — the cache below stays PURE OSM so overrides can
            // change independently without poisoning the geometry cache.
            const ov = holeOverridesRef.current
            setHolePositions({ ...holeTees, ...ov.tees })
            setGreenPositions({ ...holeGreens, ...ov.greens })
            setHoleGeometries({ ...holeGeoms, ...ov.geoms })
            setGreenPolys(holePolys)
            // ── Slice 4: course-wide fairway + bunker polygons for auto-lie ──
            // Parse golf=fairway / golf=bunker (ways + multipolygon `outer`
            // members), split by tag. Course-wide (a lie is a here-and-now test,
            // not per-hole). Missing data → [] → auto-lie stays silent.
            const toRing = (geom) => (Array.isArray(geom) ? geom : [])
              .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
              .map(p => ({ lat: p.lat, lon: p.lon }))
            const surfPolys = (val) => {
              const acc = []
              const els = Array.isArray(osmSurfaces?.elements) ? osmSurfaces.elements : []
              for (const el of els) {
                if (el?.tags?.golf !== val) continue
                if (el.type === 'way') {
                  const ring = toRing(el.geometry)
                  if (ring.length >= 3) acc.push(ring)
                } else if (el.type === 'relation' && Array.isArray(el.members)) {
                  for (const m of el.members) {
                    if (m?.role === 'outer') {
                      const ring = toRing(m.geometry)
                      if (ring.length >= 3) acc.push(ring)
                    }
                  }
                }
              }
              return acc
            }
            const fairwayPolyList = surfPolys('fairway')
            const bunkerPolyList  = surfPolys('bunker')
            setFairwayPolys(fairwayPolyList)
            setBunkerPolys(bunkerPolyList)
            log('[OSM] surfaces:', fairwayPolyList.length, 'fairway,', bunkerPolyList.length, 'bunker')
            const cachePayload = { geocoded: gc, tees: holeTees, greens: holeGreens, geoms: holeGeoms, polys: holePolys, fairwayPolys: fairwayPolyList, bunkerPolys: bunkerPolyList }
            osmPositionCache.set(cacheKey, cachePayload)
            lsSaveOsm(cacheKey, cachePayload) // persist across page reloads
          })
      })
      .catch(err => { console.error('[OSM] fetch error:', err) })
      .finally(() => setOsmLoading(false))
  }, [courseCtx?.course?.id, courseCtx?.tee?.tee_name])

  // ── Curated hole overrides (tm_course_holes) ──────────────────────────────
  // Fetch the human-verified layout for this course and overlay it on top of
  // the OSM/reconstructed result (override always wins). Runs alongside the OSM
  // load; the ref-based overlay in the OSM effect + this functional merge both
  // ensure overrides survive whichever finishes last. A hole with tee+green
  // here draws a real, confident tee→(aim)→green line. (2026-07-09)
  useEffect(() => {
    const cid = courseCtx?.course?.id
    holeOverridesRef.current = { tees: {}, greens: {}, geoms: {} }
    setHoleOverrides({ tees: {}, greens: {}, geoms: {}, count: 0 })
    if (!cid) return
    let cancelled = false
    api(`/api/courses/${cid}/holes`).then(d => {
      if (cancelled || !d?.holes) return
      const tees = {}, greens = {}, geoms = {}
      for (const h of d.holes) {
        if (h.tee) tees[h.hole] = h.tee
        if (h.green) greens[h.hole] = h.green
        if (h.tee && h.green) geoms[h.hole] = h.aim ? [h.tee, h.aim, h.green] : [h.tee, h.green]
      }
      if (cancelled) return
      holeOverridesRef.current = { tees, greens, geoms }
      setHoleOverrides({ tees, greens, geoms, count: Object.keys({ ...tees, ...greens }).length })
      setHolePositions(p => ({ ...p, ...tees }))
      setGreenPositions(p => ({ ...p, ...greens }))
      setHoleGeometries(p => ({ ...p, ...geoms }))
    }).catch(() => { /* no overrides yet — OSM/reconstruction stands */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseCtx?.course?.id])

  const fetchWeather = useCallback(async ({ lat, lon }) => {
    try {
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m,surface_pressure&wind_speed_unit=mph&temperature_unit=fahrenheit`
      )
      const d = await r.json()
      setWeather(d.current)
    } catch {}
  }, [])

  // Plays-like elevation (Phase 3.1) — uphill/downhill is auto-derived from a
  // terrain model (USGS 3DEP) via /api/eagle-eye/elevation, keyed on the green
  // (target) + the player's spot. Throttled to ~11 m player moves (toFixed(4))
  // and hole changes; the server caches each coordinate so repeats are cheap.
  // elevDelta = green − player FEET (null = unknown / non-US / fetch fail).
  // This is an OPTIONAL factor — the distance and every other readout never
  // block on or break from it; any failure simply leaves elevDelta null.
  const [elevDelta, setElevDelta] = useState(null)
  // Option B (2026-06-30): when the golfer drags the aim point short of the pin,
  // the whole readout (distance + plays-like) retargets to that aim — a real
  // shot — instead of the pin. `aimInfo` is reported up by HoleMapGL. userPlaced
  // is false for the auto-default aim, which stays Option A (to the pin, capped).
  // aimGreenYds > 8 ⇒ the aim is meaningfully short of the green.
  const [aimInfo, setAimInfo] = useState(null)
  const userAim = (aimInfo?.userPlaced && aimInfo.aimGreenYds > 8) ? aimInfo : null
  const gpsLat4 = gps ? gps.lat.toFixed(4) : null
  const gpsLon4 = gps ? gps.lon.toFixed(4) : null
  useEffect(() => {
    // Elevation to the ACTIVE target: the user aim when Option B is on, else the
    // green. Same endpoint (server caches per coordinate), so retargeting is cheap.
    const target = userAim ? userAim.aim : greenPositions[currentHole]
    const acc = gps?.acc ?? null
    const trusted = gps != null && acc != null && acc <= GPS_ACCURACY_GATE_M
    // Range gate (2026-07-07): an accuracy-trusted fix beyond the gate would
    // fetch the elevation delta from the player's HOUSE to the green.
    const inRange = trusted && target ? (haversineYards(gps, target) ?? Infinity) <= GPS_RANGE_GATE_YDS : false
    if (!trusted || !target || !inRange) { setElevDelta(null); return }   // reset stale elevation on hole/GPS/aim change
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(`/api/eagle-eye/elevation?glat=${target.lat}&glon=${target.lon}&plat=${gps.lat}&plon=${gps.lon}`)
        if (!r.ok) return
        const d = await r.json()
        if (!cancelled) setElevDelta(typeof d.deltaFt === 'number' ? d.deltaFt : null)
      } catch { /* optional factor — never break the screen */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHole, greenPositions, gpsLat4, gpsLon4, userAim])

  // Seed weather from the course's own location as soon as the geometry loads,
  // so plays-like (and its chip) appear without waiting for a GPS fix — a fix
  // can be slow or absent when the app is opened off-course or indoors, which
  // is exactly why the chip wasn't showing. A real GPS fix refines it later via
  // the throttled fetch in the watch handler. (3.1 visibility fix 2026-06-25)
  useEffect(() => {
    if (weather) return
    // Prefer the current hole's coords; fall back to the course centroid so the
    // wind/temp pills never depend on per-hole binding — on a refless course
    // (no golf=hole, no ref tags) a hole may bind no coords at all, which is
    // exactly what blanked the pills at Beacon Hill. courseGeocoded is now
    // always set (course lat/lon anchor), so this is a reliable last resort.
    // (2026-07-09)
    const c = greenPositions[currentHole] || holePositions[currentHole] || courseGeocoded
    if (c && c.lat != null && c.lon != null) fetchWeather({ lat: c.lat, lon: c.lon })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greenPositions, holePositions, currentHole, weather, courseGeocoded])

  // Plays-like sheet (Phase 3.1) — the transparent, adjustable breakdown.
  // `plOverrides` holds per-factor manual values; a present key = "manual"
  // (auto otherwise). Overrides RESET on hole change so a stale manual wind
  // from hole 3 can never silently corrupt hole 12. (build-spec risk U2)
  const [plSheetOpen, setPlSheetOpen] = useState(false)
  const [plOverrides, setPlOverrides] = useState({})
  // Slice 1 (2026-07-07): walk-and-confirm capture. captureSnap freezes the
  // GPS-to-pin distance at the moment LOG SHOT is tapped so it can't drift
  // while the sheet is open. Both reset on hole change (with plays-like).
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureSnap, setCaptureSnap] = useState(null)   // frozen raw GPS-to-pin (stored for SG + the hero)
  const [capturePlays, setCapturePlays] = useState(null) // frozen PLAYS-LIKE of the pin (drives club advice + the secondary line)
  const [captureOnGreen, setCaptureOnGreen] = useState(false) // frozen "player is on the green" at tap → putt guard
  const [captureLie, setCaptureLie] = useState(null) // Slice 4: frozen auto-lie { lie, confidence } at tap
  useEffect(() => { setPlOverrides({}); setPlSheetOpen(false); setCaptureOpen(false); setCaptureSnap(null); setCapturePlays(null); setCaptureOnGreen(false); setCaptureLie(null) }, [currentHole])
  // Walk-and-confirm capture is available for ANY active Eagle Eye round — a
  // live OUTING (published from the scorecard) OR a saved SOLO round (self-
  // discovered here). `scope` routes the buffer write; solo writes go through
  // the shared round blob (lib/solo-round) + notify ActiveRound to re-hydrate.
  // P2-B (2026-07-10): the session index keeps outing capture alive even when
  // the Match tab sits at the hub (activeScoring null but the match is live).
  const sessionForCapture = readSession(user?.id)
  const activeCapture = activeScoring?.kind === 'outing'
    ? { scope: `outing:${activeScoring.code}` }
    : sessionForCapture?.kind === 'match' && sessionForCapture.code
      ? { scope: `outing:${sessionForCapture.code}` }
      : (readSavedSoloRound(user?.id) ? { scope: 'solo' } : null)
  // Current hole's logged shots — drives the sheet's first-shot lie default +
  // the "farther than your last shot" trust nudge.
  const captureBuf = activeCapture
    ? readHoleBuffer({ scope: activeCapture.scope, uid: user?.id, holeIdx: currentHole - 1 })
    : []

  // P2-D — the QuickScoreSheet FOLLOWS Eagle Eye's current hole while open
  // (one-way sync: EE hole drives the sheet; the sheet never drives the hole —
  // that two-way loop is the race the risk register warned about).
  useEffect(() => {
    if (quickSheet?.open && quickSheet.hole !== currentHole) {
      onQuickSheetChange?.({ open: true, hole: currentHole })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHole])

  const holeData = courseCtx
    ? courseCtx.tee.holes.find(h => h.hole === currentHole) ?? null
    : null

  const totalHoles = courseCtx?.tee?.holes?.length ?? 18

  // Real GPS distance to green center (OSM data)
  // GPS accuracy gate (Phase 1.1) — only a fix tight enough to be honest is
  // allowed to drive a quoted yardage. acc is the 68% horizontal radius in
  // metres; cold-start / canopy fixes arrive coarse and tighten over a few
  // seconds. Until trusted, we surface "Acquiring GPS…" rather than a wrong
  // number. trustedGps is the only GPS value the distance math is allowed to
  // see — everything downstream (green distance, plays-like, F/C/B, bearing)
  // keys off it, so an untrusted fix can never produce a confident yardage.
  const gpsAcc      = gps?.acc ?? null
  const gpsTrusted  = gps != null && gpsAcc != null && gpsAcc <= GPS_ACCURACY_GATE_M
  const gpsAcquiring = gps != null && !gpsTrusted   // have a fix, too loose to quote

  const greenCoord = greenPositions[currentHole]
  // Range gate (GPS_RANGE_GATE_YDS): accuracy-trusted but too far from THIS
  // hole's green to be a real approach → discard the live read entirely.
  const rawGpsToGreen = (greenCoord && gpsTrusted) ? haversineYards(gps, greenCoord) : null
  const gpsOutOfRange = rawGpsToGreen != null && rawGpsToGreen > GPS_RANGE_GATE_YDS
  // gpsUsable is the only trust signal distance math may key off — the
  // accuracy gate AND the range gate together. trustedGps keeps the Phase
  // 1.1 doctrine: everything downstream (green distance, plays-like, F/C/B,
  // bearing) sees GPS only through it, so an unusable fix can never produce
  // a confident yardage.
  const gpsUsable   = gpsTrusted && !gpsOutOfRange
  const trustedGps  = gpsUsable ? gps : null
  const gpsToGreen  = gpsOutOfRange ? null : rawGpsToGreen

  // Fallback: distance walked from tee subtracted from DB yardage — only when
  // the current fix is usable (a loose or out-of-range fix would invent a
  // bogus "remaining", e.g. yardage minus a 9-mile walk clamped to 0).
  const distanceWalked = gpsUsable ? (haversineYards(teeGps, gps) ?? 0) : 0
  const remainingYards = (holeData && gpsUsable)
    ? Math.max(0, (holeData.yardage ?? 0) - distanceWalked)
    : null

  function changeHole(delta) {
    const next = Math.min(totalHoles, Math.max(1, currentHole + delta))
    setCurrentHole(next)
    setTeeGps(gps)  // Reset tee position when changing hole
  }

  function handleCourseSelect(ctx) {
    setCourseCtx(ctx)
    setCurrentHole(1)
    setTeeGps(gps)
    setShowPicker(false)
    setShowStart(false)
    // Push the pick up to App.jsx's sharedCourse so the Match tab and
    // future Eye sessions stay in sync. (2026-05-01)
    onCourseSelected?.(ctx)
  }

  // ── Play funnel round start (Phase 1 / S3, 2026-07-10) ─────────────────────
  // PlayStart hands us a resolved {course, tee} + mode + hole count. Solo
  // writes the round blob directly (startSoloRound — refuses if one exists);
  // Match creates a light outing (stroke play, 2 expected players; the heavy
  // CreateWizard stays on the Match tab for events/leagues). Both paths reset
  // the per-course hole memory to 1 BEFORE seeding the course context — a new
  // round must open on hole 1, not resume the course's last-viewed hole.
  const { ensureSingleActive, modalEl: activeMatchModal } = useActiveMatchGuard(user)
  const [startBusy, setStartBusy] = useState(false)
  const [startError, setStartError] = useState('')
  const [startedMatchCode, setStartedMatchCode] = useState(null)
  // Play session model (2026-07-10, Matt): the MAP is only the default when a
  // round is actually ACTIVE (solo blob or live-outing scoring); otherwise the
  // Play tab opens on the start screen — even though sharedCourse persists the
  // last-viewed course underneath (reachable via "Back to map" / a pick).
  // showStart forces the start screen over an existing course view. Cleared by
  // Back-to-map, any course pick, any round start, or entering with an active
  // round; re-armed every time the Play tab is (re)entered with no active round.
  // P2-B (2026-07-10): "is a round active?" now reads the active-round SESSION
  // index first (lib/active-round-session.js) — fixing the Phase-1 blind spot
  // where a live match with the Match tab at the hub read as "no round"
  // (activeScoring publishes only while the live view is open). Doctrine:
  // solo truth = blob; match truth = server (reconciled below); no session →
  // degrade to the old inference.
  const roundActive = () => {
    const s = readSession(user?.id)
    if (s?.kind === 'solo') return !!readSavedSoloRound(user?.id)
    if (s?.kind === 'match') return true
    return !!activeScoring || !!readSavedSoloRound(user?.id)
  }
  const [showStart, setShowStart] = useState(() => !roundActive())
  // Re-evaluate on every Play-tab entry (EE stays mounted across tab switches,
  // so mount-time state alone would go stale after a round ends elsewhere).
  // Also self-heal the session: a solo session without its blob clears; a
  // match session is verified against the server (throttled) — if the match
  // is no longer active anywhere, clear + land on the start screen.
  const wasActiveTabRef = useRef(isActive)
  const lastReconcileRef = useRef(0)
  useEffect(() => {
    if (isActive && !wasActiveTabRef.current) {
      setShowStart(!roundActive())
      const s = readSession(user?.id)
      if (s?.kind === 'solo' && !readSavedSoloRound(user?.id)) {
        clearSession(user?.id)
        setShowStart(true)
      } else if (s?.kind === 'match' && Date.now() - lastReconcileRef.current > 60000) {
        lastReconcileRef.current = Date.now()
        api('/api/outings/recent').then(r => {
          const live = (r?.outings || []).some(o =>
            o?.status === 'active' && String(o.code).toUpperCase() === String(s.code).toUpperCase())
          if (!live) {
            clearSession(user?.id, { code: s.code })
            setShowStart(true)
          }
        }).catch(() => { /* offline — keep trusting the session */ })
      }
    }
    wasActiveTabRef.current = isActive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, activeScoring, user?.id])
  // Leave/end prompt for the back button while a round is active.
  const [showLeavePrompt, setShowLeavePrompt] = useState(false)
  // When PlayStart routes through the full picker ("Not here?" / no recents),
  // the pending mode+holes ride here so the picker's onSelect can continue
  // the start instead of just loading the rangefinder. Null = plain pick.
  const pendingStartRef = useRef(null)

  async function startRound(sel, mode, holes = 18) {
    const { course, tee } = sel || {}
    if (!course?.id || !tee) { setStartError('Pick a course and tee first.'); return }
    const holeArr = Array.isArray(tee.holes) ? tee.holes : []
    const pars = holeArr.map(h => h.par).slice(0, holes)
    if (pars.length === 0) { setStartError('No hole data for this tee — try another course.'); return }
    const courseName = course.club_name || course.course_name || 'Course'
    const sIdx = holeArr.map(h => h.handicap).slice(0, holes)
    setStartError('')

    if (mode === 'solo') {
      const ok = startSoloRound(user?.id, {
        courseName,
        pars,
        courseRating:  tee.course_rating ?? null,
        slopeRating:   tee.slope_rating ?? null,
        holeHandicaps: sIdx.some(h => h != null) ? sIdx : null,
        courseId:  course.id,
        courseTee: tee.tee_name ?? null,
      })
      if (!ok) { setStartError('A round is already in progress — resume it from the Match tab.'); return }
      // P2-A W1 — register the active-round session index.
      writeSession(user?.id, { kind: 'solo', courseId: course.id, courseName, courseTee: tee.tee_name ?? null, holeCount: pars.length })
      addRecent({ id: course.id, club_name: courseName, lastTee: tee.tee_name ?? null })
      saveEyeHole(course.id, 1)
      handleCourseSelect(sel)
      return
    }

    // mode === 'match'
    setStartBusy(true)
    try {
      // One-active-match guard — same sheet the wizard/join flows use.
      const cleared = await ensureSingleActive()
      if (!cleared) return
      // Both genders' ratings for this physical tee (matched by total yards)
      // so mixed-match Course Handicap works — same logic as the picker's
      // selectTee (2026-06-25).
      const findByYards = (list) => (list || []).find(t => t.total_yards === tee.total_yards)
      const m = findByYards(course.tees?.male)
      const f = findByYards(course.tees?.female)
      const teeRatings = {}
      if (m && (m.course_rating != null || m.slope_rating != null)) teeRatings.male = { cr: m.course_rating ?? null, sr: m.slope_rating ?? null }
      if (f && (f.course_rating != null || f.slope_rating != null)) teeRatings.female = { cr: f.course_rating ?? null, sr: f.slope_rating ?? null }
      const data = await post('/api/outings', {
        name: `${user?.name ? `${user.name}'s` : 'Quick'} Match`,
        courseName,
        scoringFormats: ['stroke'],
        teamFormat: 'individual',
        coursePar: pars.reduce((a, b) => a + (b || 0), 0),
        courseId:      course.id,
        courseTee:     tee.tee_name ?? null,
        holePars:      pars,
        holeYardages:  holeArr.map(h => h.yardage).slice(0, holes),
        holeHandicaps: sIdx.some(h => h != null) ? sIdx : null,
        courseRating:  tee.course_rating ?? null,
        slopeRating:   tee.slope_rating ?? null,
        teeRatings:    (teeRatings.male || teeRatings.female) ? teeRatings : null,
        expectedPlayers: 2,
        // WHS Appendix C: individual stroke play = 95%.
        handicapAllowance: 95,
      })
      const code = data?.outing?.code
      // P2-A W2 — register the active-round session index.
      if (code) writeSession(user?.id, { kind: 'match', code, courseId: course.id, courseName, courseTee: tee.tee_name ?? null, holeCount: pars.length })
      addRecent({ id: course.id, club_name: courseName, lastTee: tee.tee_name ?? null })
      saveEyeHole(course.id, 1)
      handleCourseSelect(sel)
      if (code) {
        setStartedMatchCode(code)
        // App mounts the Match tab hidden + opens the live outing there, so
        // scoring/activeScoring are armed while the user stays on the map.
        onMatchStarted?.(code)
      }
    } catch (e) {
      setStartError(e?.message || 'Could not create the match.')
    } finally {
      setStartBusy(false)
    }
  }

  // Cross-tab course sync: when sharedCourse changes (e.g., user picked a
  // course on the Match tab, or LiveOuting just loaded a match with a
  // course), pick it up here. Guarded by a course-id "differs" check so
  // the writeback in handleCourseSelect doesn't trigger a feedback loop,
  // and so subsequent identical sharedCourse values don't reload.
  // (2026-05-01)
  useEffect(() => {
    if (!sharedCourse?.course?.id) return
    const sameCourse = courseCtx?.course?.id === sharedCourse.course.id
    const sameTee    = courseCtx?.tee?.tee_name === sharedCourse.tee?.tee_name
    if (sameCourse && sameTee) return
    // Avoid calling onCourseSelected from within handleCourseSelect here —
    // we already have this ctx FROM sharedCourse. Inline the body instead.
    setCourseCtx(sharedCourse)
    // Resume the persisted hole for this course on reload; fall back to 1
    // for a genuinely new course. (2026-06-06)
    setCurrentHole(readEyeHole(sharedCourse.course.id) || 1)
    setTeeGps(gps)
    setShowPicker(false)
    // NOTE: deliberately does NOT clear showStart — this effect also fires on
    // mount-time hydration of the persisted course, and the Play tab must
    // open on the start screen when no round is active (2026-07-10, Matt).
    // Mid-session seeds that should land on the map (live-outing open, GET
    // DISTANCES) are covered by the eyeHoleNudge consume + tab-entry effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedCourse])

  const wind = weather
    ? { speed: Math.round(weather.wind_speed_10m), dir: Math.round(weather.wind_direction_10m) }
    : null
  const temp = weather ? Math.round(weather.temperature_2m) : null

  const pinYards = gpsToGreen ?? (gpsUsable && distanceWalked > 10 && remainingYards != null
    ? remainingYards
    : (holeData?.yardage ?? null))
  // Option B: a user-placed aim short of the pin becomes the target — the hero
  // distance follows it (a real shot), else the pin distance (Option A).
  const displayYards = userAim ? userAim.teeAimYds : pinYards

  // Hero-instrument label + accent (Phase 2.3; accents re-ruled Stage C1
  // 2026-07-07). Gold-light when aimed at a user target; ALIGNED gold for a
  // trusted live GPS-to-green read (locked = gold, we own it); ACQUIRING is
  // dim — unverified data never wears a reward color; muted gold for the
  // static tee/remaining fallback.
  const distLabel = userAim ? 'TO AIM'
    : gpsToGreen != null ? 'TO GREEN'
    : gpsAcquiring ? 'ACQUIRING'
    : (gpsUsable && distanceWalked > 10 && remainingYards != null) ? 'REMAINING'
    : 'FROM TEE'
  const distAccent = userAim ? 'var(--tm-ee-gold-light)' : gpsToGreen != null ? 'var(--tm-ee-aligned)' : gpsAcquiring ? 'var(--tm-ee-acquiring)' : 'var(--tm-ee-gold)'

  // "Plays like" wind needs a shot DIRECTION. Prefer the live player→green
  // bearing once we have a trusted GPS fix; otherwise fall back to the
  // tee→green bearing from the course geometry (the same tee/green we draw the
  // hole line + "FROM TEE" distance from). Without this fallback the wind term
  // was silently 0 on the pre-shot/from-tee view, so the header could show a
  // headwind that wasn't in the plays-like number. (2026-06-30 — Matt caught
  // "wind in our face but plays 6 shorter"; temp/alt already applied, wind didn't.)
  const altFt = gps?.alt != null
    ? Math.round(gps.alt * 3.281)
    : estimateAltFromPressure(weather?.surface_pressure)
  const teeCoord = holePositions[currentHole] || null
  const shotOrigin = trustedGps ? { lat: trustedGps.lat, lon: trustedGps.lon } : teeCoord
  const shotBearing = (userAim && shotOrigin)
    ? calcBearing(shotOrigin, userAim.aim)                    // B: wind relative to the aim shot
    : (trustedGps && greenCoord)
      ? calcBearing({ lat: trustedGps.lat, lon: trustedGps.lon }, greenCoord)
      : (teeCoord && greenCoord)
        ? calcBearing(teeCoord, greenCoord)
        : null
  // Auto-derived conditions (from weather + DEM) and the effective conditions
  // after any manual overrides from the plays-like sheet. The chip + sheet both
  // read `playsLike`, computed from the effective values. (Phase 3.1)
  const plAuto = { windSpeed: wind?.speed ?? 0, windDir: wind?.dir ?? null, tempF: temp, elevDeltaFt: elevDelta }
  const plEff = {
    windSpeed:   plOverrides.windSpeed   ?? plAuto.windSpeed,
    windDir:     plOverrides.windDir     ?? plAuto.windDir,
    tempF:       plOverrides.tempF       ?? plAuto.tempF,
    elevDeltaFt: plOverrides.elevDeltaFt ?? plAuto.elevDeltaFt,
  }
  // Base the plays-like on whatever distance the hero is showing — live GPS-to-
  // green when trusted, else the tee/remaining yardage — so the chip is present
  // whenever there's a distance + conditions, not only on a pinpoint GPS fix.
  // Factors needing a trusted fix (wind, elevation) just read 0 until GPS
  // tightens; temperature/altitude always apply. (3.1 visibility fix 2026-06-25)
  const playsLike = (displayYards != null && displayYards > 0 && weather)
    ? computePlaysLike(displayYards, {
        windSpeed: plEff.windSpeed,
        windFromDeg: plEff.windDir,
        shotBearing,
        tempF: plEff.tempF,
        altFt,
        elevDeltaFt: plEff.elevDeltaFt,
      })
    : null
  // Integer-reconciled view for the chip + sheet (rows always sum to total).
  const plView = playsLikeView(playsLike)

  // Own-club distance arcs (Phase 3.3). Uses ONLY the player's real entered bag
  // distances — no handicap guessing (corrected 2026-06-25, Matt: handicap does
  // not map to club distance; entered data is the accurate source). When ON,
  // declutter to the 1–2 clubs that bracket the displayed distance; highlight
  // the one that reaches it. Empty bag → prompt to set distances (handled at
  // the toggle), never fabricate.
  const playerBag = realBag(myBag)
  // Own-club distance ARCS: the player's relevant clubs swept across the hole.
  // arcClubs handles a null distance (→ whole bag), so the arcs render whenever
  // the toggle is on — they don't wait for a live GPS-to-green lock. (rebuilt 2026-06-26)
  const bagArcsData = bagArcsOn ? arcClubs(playerBag, displayYards) : []

  // Front/Center/Back green from the OSM polygon (Feature B). Player = GPS
  // when available, else the tee. Null → single number, unchanged. (2026-06-06)
  const greenPolygon = greenPolys[currentHole]
  // Front/Center/Back only from a TRUSTED live fix. Measuring F/B from the OSM
  // tee position is unreliable — patchy OSM tee geometry can sit 100+ yds off,
  // producing front/back that contradict the authoritative DB hole yardage
  // (the "502/534 on a 360-yd hole" bug). With no trusted GPS, the hero hole
  // yardage stands alone rather than showing numbers we can't stand behind.
  // (2026-06-24)
  const fcbPlayer = (trustedGps?.lat != null) ? { lat: trustedGps.lat, lon: trustedGps.lon } : null
  // F/C/B is a green concept — hide it when the readout is aimed at a user
  // target short of the pin (Option B).
  const fcb = (ENABLE_FCB && !userAim && greenPolygon && fcbPlayer && greenCoord) ? greenFCB(fcbPlayer, greenPolygon, greenCoord) : null

  const teeHoles = courseCtx?.tee?.holes ?? []

  return (
    // data-no-pull-refresh: Eagle Eye is a full-screen map tool — the view
    // never scrolls, so the app's pull-to-refresh (TabPanel) was firing on
    // every downward map-pan and reloading the page (dropping GPS + re-
    // fetching OSM). Opt the whole screen out of the gesture. (2026-06-24)
    <div data-no-pull-refresh="true" style={{ position: 'fixed', inset: 0, background: 'var(--tm-ee-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <CoachMark
        id="eagle_eye"
        user={user}
        title="Eagle Eye is your caddie"
        body='Top card shows live GPS distance to the green once you reach the course, with a plays-like number that factors wind and elevation. Drag the aim point on the map to measure any target. The BAG button on the right lets you toggle clubs to see expected landing zones on the map.'
        anchor="top"
      />
      <style>{`
        @keyframes ee-spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ee-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ee-acq-pulse { 0%,100% { opacity: 0.4; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.1); } }
        .ee-hole-chip::-webkit-scrollbar { display: none; }
        /* Landing-zone marker — pulsing yellow disc shown along the
           aim line at the active club's distance. No background box. */
        @keyframes lz-pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgb(var(--tm-ee-gold-pulse-rgb) / 0.55), 0 0 16px rgb(var(--tm-ee-gold-pulse-rgb) / 0.55);
            transform: scale(0.95);
          }
          50% {
            box-shadow: 0 0 0 14px rgb(var(--tm-ee-gold-pulse-rgb) / 0), 0 0 28px rgb(var(--tm-ee-gold-pulse-rgb) / 0.85);
            transform: scale(1.08);
          }
        }
      `}</style>

      {/* ── Status bar ── On a course the map is full-bleed: this header FLOATS
          over it as a gradient scrim (pointer-events pass through to the map
          except on the actual buttons) so the satellite view fills the whole
          screen, like the leading rangefinder apps. Off-course (welcome hero)
          it stays a normal solid band. (2026-06-26 — Matt: make it all map) */}
      <div style={{
        paddingTop: 'env(safe-area-inset-top, 44px)',
        // Floating gradient header only over the MAP; the start screen
        // (no course OR showStart) gets the normal solid band.
        ...((courseCtx && !showStart) ? {
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
          background: 'linear-gradient(to bottom, rgb(var(--tm-ee-bg-rgb) / 0.92) 0%, rgb(var(--tm-ee-bg-rgb) / 0.55) 58%, rgb(var(--tm-ee-bg-rgb) / 0) 100%)',
          pointerEvents: 'none',
        } : {
          background: 'var(--tm-ee-bg)',
        }),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px 10px', pointerEvents: 'auto' }}>
          {/* Back + Title — the tab bar is hidden on Eagle Eye (full-immersion),
              so this back chevron is the way out, returning to the prior tab. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {onExit && (
              <button onClick={() => {
                // Back semantics (2026-07-10 session model):
                //   start screen → plain tab exit.
                //   map, NO active round (browsing) → exit; re-arm the start
                //     screen so the next Play open doesn't resume stale state.
                //   map, ACTIVE round → ask (end via scorecard / exit & keep).
                if (showStart) { onExit?.(); return }
                if (!roundActive()) { setShowStart(true); onExit?.(); return }
                setShowLeavePrompt(true)
              }} aria-label="Back" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', background: 'rgb(var(--tm-ee-glass-rgb) / 0.5)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)', color: 'var(--tm-ee-gold-light)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
            )}
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.14em', background: 'linear-gradient(90deg, var(--tm-ee-gold-light), var(--tm-ee-gold))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                EAGLE EYE
              </div>
              {courseCtx && !showStart && (
                /* Tap the course name → back to the Play start screen (course
                   change, solo/match start, all live there). Was a direct
                   picker-open; rerouted 2026-07-10 so the start screen is
                   reachable once a course is active. */
                <button onClick={() => setShowStart(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                  <span style={{ fontSize: 11, color: 'rgb(var(--tm-ee-white-rgb) / 0.45)', fontWeight: 500 }}>{courseCtx.course.club_name}</span>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--tm-ee-white-rgb) / 0.3)" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
              )}
            </div>
          </div>
          {/* Conditions pills — map-view HUD only. Hidden while the Play start
              screen is showing (no course OR showStart): the start screen has
              its own location affordance and no use for wind/temp/scorecard
              chrome. (2026-07-10 — Matt: clean start screen.) */}
          {courseCtx && !showStart && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Tap to enable GPS when off, or refresh the exact location when
                on — requestLocation() re-requests a fresh fix and (re)starts
                the watch either way. (2026-06-06) */}
            <button
              onClick={requestLocation}
              title={gpsUsable ? 'GPS locked — tap to refresh' : gpsOutOfRange ? 'GPS out of range for this hole — tap to refresh' : gpsAcquiring ? 'Acquiring GPS — tap to refresh' : 'Tap to turn on GPS'}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                // C1 (2026-07-07): locked = gold (aligned), acquiring = dim white.
                // Out-of-range (range gate) reads as dim/static — usable never lies.
                background: gpsUsable ? 'rgb(var(--tm-ee-gold-rgb) / 0.16)' : gpsAcquiring ? 'rgb(var(--tm-ee-white-rgb) / 0.08)' : 'rgb(var(--tm-ee-white-rgb) / 0.06)',
                border: `1px solid ${gpsUsable ? 'rgb(var(--tm-ee-gold-rgb) / 0.35)' : gpsAcquiring ? 'rgb(var(--tm-ee-white-rgb) / 0.18)' : 'rgb(var(--tm-ee-white-rgb) / 0.1)'}`,
                borderRadius: 20, padding: '4px 8px', cursor: 'pointer',
                fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
              }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%',
                background: gpsUsable ? 'var(--tm-ee-aligned)' : gpsAcquiring ? 'var(--tm-ee-acquiring)' : 'rgb(var(--tm-ee-white-rgb) / 0.2)',
                animation: gpsAcquiring ? 'ee-acq-pulse 1.1s ease-in-out infinite' : 'none' }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                color: gpsUsable ? 'var(--tm-ee-aligned)' : gpsAcquiring ? 'var(--tm-ee-acquiring)' : 'rgb(var(--tm-ee-white-rgb) / 0.3)' }}>GPS</span>
              {/* refresh glyph — signals the pill is tappable */}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={gpsUsable ? 'var(--tm-ee-aligned)' : gpsAcquiring ? 'var(--tm-ee-acquiring)' : 'rgb(var(--tm-ee-white-rgb) / 0.35)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 1 }}>
                <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            {/* Wind arrow is SHOT-RELATIVE and shows which way the wind BLOWS
                relative to facing the pin. wind.dir is the FROM direction, so
                rotate by (wind.dir − shotBearing + 180): arrow points DOWN when
                the wind is in your face (headwind), UP when it's at your back
                toward the pin (tailwind), sideways = crosswind. Same real wind
                reads differently per hole (each faces a different bearing).
                Falls back to absolute blow-direction until a bearing exists.
                (2026-06-30 — Matt: per-hole + down = in your face.) */}
            {wind && (
              <div style={{ background: 'rgb(var(--tm-ee-white-rgb) / 0.06)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.1)', borderRadius: 20, padding: '4px 8px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgb(var(--tm-ee-white-rgb) / 0.5)' }}>
                  <WindArrow deg={shotBearing != null ? wind.dir - shotBearing + 180 : wind.dir + 180} /> {wind.speed}
                </span>
              </div>
            )}
            {temp != null && (
              <div style={{ background: 'rgb(var(--tm-ee-white-rgb) / 0.06)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.1)', borderRadius: 20, padding: '4px 8px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgb(var(--tm-ee-white-rgb) / 0.5)' }}>{temp}°</span>
              </div>
            )}
            {/* Inline Scorecard pill — sits next to the conditions pills so
                the user can pop into the live match's scorecard for the hole
                they're currently looking at. (2026-05-01) */}
            {onGoToScorecard && (
              <button onClick={onGoToScorecard} style={{
                background: 'rgb(var(--tm-ee-gold-bright-rgb) / 0.14)',
                border: '1px solid rgb(var(--tm-ee-gold-bright-rgb) / 0.40)',
                borderRadius: 20, padding: '4px 10px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
                fontFamily: 'inherit',
              }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--tm-ee-gold-light)', letterSpacing: '0.04em' }}>SCORECARD</span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--tm-ee-gold-light)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            )}
          </div>
          )}
        </div>

        {/* ── Hole selector ── one clean glass pill with ‹ › navigation, instead
            of the old cluttered 10-chip strip (the biggest "cheap" tell). The
            number+par read as a single elegant control. (2026-06-26 premium pass) */}
        {courseCtx && !showStart && (() => {
          const idx = teeHoles.findIndex(h => h.hole === currentHole)
          const cur = teeHoles[idx] || teeHoles[0]
          const go = (delta) => {
            const ni = Math.max(0, Math.min(teeHoles.length - 1, idx + delta))
            const nh = teeHoles[ni]
            if (nh && nh.hole !== currentHole) { setCurrentHole(nh.hole); setTeeGps(gps) }
          }
          const NavBtn = ({ dir, disabled }) => (
            <button onClick={() => go(dir)} disabled={disabled} aria-label={dir < 0 ? 'Previous hole' : 'Next hole'} style={{
              width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent',
              color: disabled ? 'rgb(var(--tm-ee-gold-light-rgb) / 0.22)' : 'rgb(var(--tm-ee-gold-light-rgb) / 0.9)',
              cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points={dir < 0 ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
              </svg>
            </button>
          )
          return (
            <div style={{ padding: '0 20px 12px', marginTop: 8, pointerEvents: 'auto', display: 'flex', justifyContent: 'center' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 2,
                background: 'rgb(var(--tm-ee-glass-rgb) / 0.55)', backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)', borderRadius: 999, padding: '3px 5px',
                boxShadow: '0 6px 18px rgb(var(--tm-ee-black-rgb) / 0.45), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.12)',
              }}>
                <NavBtn dir={-1} disabled={idx <= 0} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>Hole {cur?.hole}</span>
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgb(var(--tm-ee-white-rgb) / 0.35)' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--tm-ee-white-rgb) / 0.62)' }}>Par {cur?.par}</span>
                </div>
                <NavBtn dir={1} disabled={idx >= teeHoles.length - 1} />
              </div>
            </div>
          )
        })()}

        {/* P2-D — SCORE pill: opens the QuickScoreSheet (rendered by the
            round's owner, portaled over this map) so the current hole is
            scored without leaving Play. Only when a round is active for
            capture. In the header stack — never overlaps the HUD. */}
        {courseCtx && !showStart && activeCapture && onQuickSheetChange && (
          <div style={{ padding: '0 20px 10px', pointerEvents: 'auto', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => onQuickSheetChange({ open: !quickSheet?.open, hole: currentHole })}
              aria-pressed={!!quickSheet?.open}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                background: quickSheet?.open ? 'rgb(var(--tm-ee-gold-rgb) / 0.30)' : 'rgb(var(--tm-ee-glass-rgb) / 0.55)',
                backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                border: `1px solid ${quickSheet?.open ? 'rgb(var(--tm-ee-gold-light-rgb) / 0.85)' : 'rgb(var(--tm-ee-gold-light-rgb) / 0.40)'}`,
                borderRadius: 999, padding: '8px 14px', cursor: 'pointer',
                color: 'var(--tm-ee-gold-light)', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em',
                boxShadow: '0 6px 18px rgb(var(--tm-ee-black-rgb) / 0.45), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.12)',
                WebkitTapHighlightColor: 'transparent', fontFamily: 'inherit',
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--tm-ee-gold-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="3" rx="0.8" />
                <path d="M9 4H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3" />
                <line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="16" y2="15" />
              </svg>
              {quickSheet?.open ? 'HIDE SCORING' : `SCORE HOLE ${currentHole}`}
            </button>
          </div>
        )}

        {/* One-time invite chip after a Play-funnel Match start (S3c). Lives
            IN the header stack, under the hole selector, so it can never
            overlap the map HUD (2026-07-10 — Matt: it was absolutely
            positioned and covered the hole pill). Tap → live outing (where
            MatchMenu has the full share flow); ✕ dismisses. */}
        {courseCtx && !showStart && startedMatchCode && (
          <div style={{ padding: '0 20px 12px', pointerEvents: 'auto', display: 'flex', justifyContent: 'center' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10, padding: '7px 8px 7px 14px',
              borderRadius: 999,
              background: 'rgb(var(--tm-ee-glass-rgb) / 0.72)',
              backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
              border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.45)',
              boxShadow: '0 6px 18px rgb(var(--tm-ee-black-rgb) / 0.45)',
              whiteSpace: 'nowrap',
            }}>
              <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--tm-ee-gold-light)' }}>
                MATCH {startedMatchCode}
              </span>
              <button onClick={() => { setStartedMatchCode(null); onGoToScorecard?.() }} style={{
                background: 'rgb(var(--tm-ee-gold-bright-rgb) / 0.18)', border: '1px solid rgb(var(--tm-ee-gold-bright-rgb) / 0.5)',
                borderRadius: 999, padding: '5px 12px', cursor: 'pointer',
                fontSize: 12, fontWeight: 800, color: 'var(--tm-ee-gold-light)',
              }}>Invite friends →</button>
              <button onClick={() => setStartedMatchCode(null)} aria-label="Dismiss" style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                fontSize: 14, color: 'rgb(var(--tm-ee-white-rgb) / 0.5)', lineHeight: 1,
              }}>✕</button>
            </div>
          </div>
        )}
      </div>

      {/* ── GPS error banner ── floats below the header on a course (map is
          full-bleed underneath), else normal flow on the welcome screen. */}
      {gpsError && (
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgb(var(--tm-ee-red-deep-rgb) / 0.12)', border: '1px solid rgb(var(--tm-ee-red-deep-rgb) / 0.3)',
          ...(courseCtx
            ? { position: 'absolute', top: 'calc(env(safe-area-inset-top, 44px) + 100px)', left: 16, right: 16, zIndex: 21, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }
            : { margin: '8px 16px 0' }) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--tm-ee-red)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-ee-red)' }}>
                {gpsError === 'denied-hard' ? 'Location access blocked' : gpsError === 'timeout' ? 'GPS signal lost' : 'Location unavailable'}
              </div>
              <div style={{ fontSize: 11, color: 'rgb(var(--tm-ee-white-rgb) / 0.4)', marginTop: 1 }}>
                {gpsError === 'denied-hard' ? 'Tap below to enable, or go to Settings manually' : 'Move to an open area and try again'}
              </div>
            </div>
            <button onClick={requestLocation}
              style={{ background: 'rgb(var(--tm-ee-red-rgb) / 0.15)', border: '1px solid rgb(var(--tm-ee-red-rgb) / 0.4)', borderRadius: 8, padding: '6px 12px', color: 'var(--tm-ee-red)', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              Enable GPS
            </button>
          </div>
          {gpsError === 'denied-hard' && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgb(var(--tm-ee-black-rgb) / 0.3)', borderRadius: 8, fontSize: 11, color: 'rgb(var(--tm-ee-white-rgb) / 0.55)', lineHeight: 1.8 }}>
              Location is blocked. Open Settings and allow access:<br/>
              <span style={{ color: 'rgb(var(--tm-ee-white-rgb) / 0.75)' }}>
                If using from home screen:<br/>
                <span style={{ color: 'var(--tm-ee-gold-light)' }}>Settings → Privacy &amp; Security → Location Services → The Match → While Using</span>
              </span><br/>
              <span style={{ color: 'rgb(var(--tm-ee-white-rgb) / 0.75)' }}>
                If using in Safari:<br/>
                <span style={{ color: 'var(--tm-ee-gold-light)' }}>Settings → Privacy &amp; Security → Location Services → Safari → While Using</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Main content ── */}
      {(!courseCtx || showStart) ? (
        /* ── Play start funnel (Phase 1 / S3b, 2026-07-10) — replaced the old
            Welcome hero. Course confirm card (nearest recent / last played) →
            9|18 → Solo|Match → START; picker as fallback; "Rangefinder only"
            keeps the old zero-scoring path. Renders when no course is active
            OR when showStart forces it over the map (course-name tap). */
        <PlayStart
          user={user}
          gps={gps}
          onRequestLocation={requestLocation}
          onOpenPicker={(mode, holes) => {
            pendingStartRef.current = mode ? { mode, holes } : null
            setShowPicker(true)
          }}
          onStart={startRound}
          onResumeSolo={() => onGoToScorecard?.()}
          onResumeMatch={code => {
            // P2-B — resume a live match from the start screen: the existing
            // onMatchStarted plumbing mounts the Match tab hidden + opens the
            // live view (activeScoring publishes); the map is right here.
            setShowStart(false)
            onMatchStarted?.(code)
          }}
          onBackToMap={courseCtx ? () => setShowStart(false) : null}
          startBusy={startBusy}
          startError={startError}
        />
      ) : (
        /* ── Distance view — satellite map background + HUD overlay. Full-bleed:
            the header floats (absolute, out of normal flow), so this flex:1 child
            fills the WHOLE container = fullscreen map. Kept flex:1 (NOT absolute)
            so the map container has a definite size at MapLibre init — making it
            absolute caused a 0-height mount race that broke the map render.
            (2026-06-26 — fix for the black map) ── */
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Full-screen satellite hole map — MapLibre GL (NAIP + branded overlays) */}
          <HoleMapGL
            courseCtx={courseCtx}
            currentHole={currentHole}
            gps={gps}
            geocoded={courseGeocoded}
            holePositions={holePositions}
            greenPositions={greenPositions}
            greenPolys={greenPolys}
            holeGeometries={holeGeometries}
            clubYards={selectedClub ? Number(selectedClub.avg_yards) : null}
            clubLabel={selectedClub ? `${selectedClub.brand} ${selectedClub.model}` : null}
            bagArcs={bagArcsData}
            rangeRingsOn={ringsOn}
            onAimChange={setAimInfo}
          />

          {/* Focus vignette — subtly darkens the map edges so the centre + the
              distance card pop (premium framing). Static, pointer-through. */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5,
            background: 'radial-gradient(125% 90% at 50% 40%, transparent 56%, rgb(var(--tm-ee-black-rgb) / 0.40) 100%)' }} />

          {/* HUD overlay — the wrapper spans the full map (`inset: 0`) with
              pointerEvents:none at auto z-index; each visible child carries
              its own zIndex: 800 so the yardage card + Analyze paint above
              the map while the empty middle stays click-through to the map
              (pan/tap-to-measure). Floating BAG sits at 1000. */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 'calc(env(safe-area-inset-top, 44px) + 96px) 16px 20px', pointerEvents: 'none' }}>

            {/* ── Top yardage card — top-LEFT corner. Replaces the
                standalone HOLE badge that used to live in HoleMap;
                this card already shows PAR + TEE-yardage pills plus
                live GPS distance to green, so the previous duplicate
                was deleted. (2026-05-01 — Matt: consolidate top-left
                hole/distance and top-right GPS card into one box.) */}
            {/* Premium glass HUD — frosted panel with an inset top-rim
                highlight (the detail that reads as real glass) + layered
                depth shadow. The hero yardage is the instrument: large
                tabular numeral with a soft shadow so it stays legible over
                bright satellite imagery. Compact enough not to occlude the
                map/markers. (2026-06-23 — premium pass, first visual slice.) */}
            {/* C4 (2026-07-07): the DIAL instrument renders only when NOT in
                Big-Numbers glance mode; BIG swaps to the full-screen readout below. */}
            {/* ── Bottom control row (2026-07-09, Matt): DIAL|BIG toggle on the
                LEFT, the distance rangefinder card CENTRED, LOG SHOT on the
                RIGHT — all sharing one row. The card slid down from its old
                standalone slot above. In BIG mode the card + LOG SHOT hide and
                the toggle recentres (BIG has its own full-screen readout). ── */}
            <div style={{ order: 3, alignSelf: 'stretch', marginTop: 12, marginBottom: 4,
              pointerEvents: 'none', zIndex: 810, position: 'relative',
              display: 'flex', justifyContent: 'center', alignItems: 'flex-end', minHeight: 46 }}>

              {/* DIAL|BIG toggle — pinned LEFT in DIAL mode so the distance box
                  can centre between it and LOG SHOT; recentres in BIG mode. */}
              <div style={bigMode
                ? { pointerEvents: 'auto' }
                : { position: 'absolute', left: 0, bottom: 0, pointerEvents: 'auto' }}>
                <ModeToggle mode={bigMode ? 'big' : 'dial'} onChange={(m) => setBig(m === 'big')} />
              </div>

              {!bigMode && (<>
              {/* ── distance rangefinder card — centred in the row ── */}
              <div style={{ pointerEvents: 'auto', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: 'rgb(var(--tm-ee-glass-rgb) / 0.60)', backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
              borderRadius: 20, border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.14)',
              padding: '10px 14px 12px',
              boxShadow: '0 10px 34px rgb(var(--tm-ee-black-rgb) / 0.55), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.20), 0 0 46px rgb(var(--tm-ee-gold-rgb) / 0.13)',
              position: 'relative', overflow: 'hidden',
              minWidth: 124,
            }}>
              {/* faint static grain — kills the flat-dark look (no blend mode → dodges the iOS mix-blend caveat) */}
              <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.05,
                backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />
              {/* Hero distance instrument — arc gauge + number roll in lockstep */}
              <DistanceInstrument yards={displayYards} label={distLabel} accent={distAccent} />
              {/* GPS ready / acquiring chip (Phase 1.1; ± margin removed
                  2026-06-30 — Matt: don't narrate the GPS's error on screen).
                  C1 re-rule 2026-07-07: Locked = a calm GOLD "GPS" dot (gold =
                  locked/trusted, we own it). Acquiring = DIM white + pulsing —
                  unverified data never wears a reward color; the pulse alone
                  says "working on it". The accuracy gate still uses
                  coords.accuracy under the hood; we just never quantify the
                  uncertainty to the user. */}
              {gpsUsable ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--tm-ee-aligned)', boxShadow: '0 0 6px rgb(var(--tm-ee-gold-rgb) / 0.8)' }} />
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgb(var(--tm-ee-gold-rgb) / 0.85)' }}>
                    GPS
                  </span>
                </div>
              ) : gpsOutOfRange ? (
                /* Range gate (2026-07-07): accuracy-trusted fix, but too far from
                   this hole's green to be a real approach — the hero above shows
                   the static tee→green yardage, and this chip says so honestly.
                   Dim + static: an unusable read never wears a confidence color. */
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgb(var(--tm-ee-white-rgb) / 0.25)' }} />
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgb(var(--tm-ee-white-rgb) / 0.55)' }}>
                    GPS · OUT OF RANGE
                  </span>
                </div>
              ) : gpsAcquiring ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--tm-ee-acquiring)', animation: 'ee-acq-pulse 1.1s ease-in-out infinite' }} />
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'rgb(var(--tm-ee-white-rgb) / 0.6)' }}>
                    ACQUIRING
                  </span>
                </div>
              ) : null}
              {/* Front / Center / Back green — the big number above is center;
                  these flank it with the near + far edge. Only when a green
                  polygon matched (else the single number stands). (2026-06-06) */}
              {fcb && fcb.front != null && fcb.back != null && (
                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'rgb(var(--tm-ee-green-rgb) / 0.9)' }}>
                    F <span style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fcb.front}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'rgb(var(--tm-ee-white-rgb) / 0.55)' }}>
                    B <span style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fcb.back}</span>
                  </span>
                </div>
              )}
              {/* Plays-like — now a legible, tappable chip (Phase 3.1). Coupled
                  to the hero distance (not a 5th floating island); opens the
                  transparent, adjustable breakdown sheet. Always shown on a
                  trusted distance + conditions, including the +0 case (a tap
                  target that vanishes is a bad tap target). */}
              {plView && (
                <button onClick={() => setPlSheetOpen(true)} style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, padding: '4px 9px',
                  background: 'rgb(var(--tm-ee-gold-rgb) / 0.16)', border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.38)', borderRadius: 9,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.8)' }}>PLAYS LIKE</span>
                  <span style={{ fontSize: 17, fontWeight: 900, color: 'var(--tm-ee-gold-light)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{plView.total}</span>
                  {plView.adj !== 0 && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: plView.adj > 0 ? 'var(--tm-ee-amber)' : 'var(--tm-ee-green)', fontVariantNumeric: 'tabular-nums' }}>
                      {plView.adj > 0 ? `+${plView.adj}` : plView.adj}
                    </span>
                  )}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgb(var(--tm-ee-gold-light-rgb) / 0.55)" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              )}
              {osmLoading && <div style={{ fontSize: 8, color: 'rgb(var(--tm-ee-white-rgb) / 0.30)', marginTop: 3, letterSpacing: '0.06em' }}>Loading…</div>}
              {/* PAR pill removed 2026-06-30 — par already shows in the top hole
                  toggle; dropping it shrinks the card so it doesn't crowd the tee. */}
              {holeData?.yardage && gpsToGreen != null && (
                <div style={{ marginTop: 6, background: 'rgb(var(--tm-ee-gold-rgb) / 0.15)', border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.3)', borderRadius: 4, padding: '1px 6px' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--tm-ee-gold)' }}>{holeData.yardage}Y TEE</span>
                </div>
              )}
            </div>

              {/* LOG SHOT — right flank of the row; same freeze-and-open handler.
                  DIAL-mode + active-round only (BIG has its own glance overlay). */}
              {activeCapture && (
                <button onClick={() => {
                  // Freeze BOTH the raw GPS-to-pin (for SG + the hero) and the
                  // PLAYS-LIKE distance (wind/elev/temp/alt-adjusted) so the club
                  // is advised for what the shot actually plays.
                  const raw = gpsToGreen
                  setCaptureSnap(raw)
                  const pv = (raw != null && raw > 0 && weather)
                    ? playsLikeView(computePlaysLike(raw, { windSpeed: plEff.windSpeed, windFromDeg: plEff.windDir, shotBearing, tempF: plEff.tempF, altFt, elevDeltaFt: plEff.elevDeltaFt }))
                    : null
                  setCapturePlays(pv?.total ?? null)
                  // On-green guard: standing inside the green ⇒ this is a putt.
                  setCaptureOnGreen(pointInPolygon(gps, greenPolygon))
                  // Confidence-gated auto-lie from GPS vs OSM surface polygons.
                  setCaptureLie(classifyLie(gps, { fairwayPolys, bunkerPolys, accM: gps?.acc ?? null }))
                  setCaptureOpen(true)
                }} style={{
                  position: 'absolute', right: 0, bottom: 0,
                  pointerEvents: 'auto', height: 36, padding: '0 15px', borderRadius: 999,
                  border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)',
                  background: 'rgb(var(--tm-ee-glass-rgb) / 0.62)',
                  backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                  color: 'var(--tm-ee-gold-light)', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em',
                  cursor: 'pointer', boxShadow: '0 6px 18px rgb(var(--tm-ee-black-rgb) / 0.45), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.12)',
                  whiteSpace: 'nowrap',
                }}>+ LOG SHOT</button>
              )}
              </>)}
            </div>
          </div>

          {/* ── Big-Numbers glance overlay (C4, 2026-07-07) — a full-screen
              takeover of the satellite view: giant centre-to-green with
              BACK/FRONT promoted to labels — BACK on top, FRONT on the bottom, so
              the stack descends toward you and matches BOTH the satellite map
              (green is ahead = up = back edge highest) and the universal
              rangefinder convention (every surveyed leader stacks back→center→front
              top-to-bottom). Dark scrim so the numbers hold sunlight contrast (text
              over raw imagery fails WCAG F83) AND the map/aim-line don't bleed
              through. Header (hole nav + GPS) stays. Reads at arm's length. ── */}
          {bigMode && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 12,
              background: 'linear-gradient(180deg, rgb(var(--tm-ee-bg-rgb) / 0.96) 0%, rgb(var(--tm-ee-bg-rgb) / 0.90) 50%, rgb(var(--tm-ee-bg-rgb) / 0.96) 100%)',
              backdropFilter: 'blur(7px) saturate(120%)', WebkitBackdropFilter: 'blur(7px) saturate(120%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: 'calc(env(safe-area-inset-top, 44px) + 104px) 20px calc(env(safe-area-inset-bottom, 0px) + 104px)',
              animation: 'ee-fade-in 0.24s ease-out', pointerEvents: 'none',
            }}>
              {/* BACK — far edge, on TOP (green is ahead/up, so the farthest edge
                  sits highest — matches the map and every rangefinder leader) */}
              {fcb && fcb.back != null && (
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 12 }}>
                  <span style={{ width: 66, textAlign: 'right', fontSize: 13, fontWeight: 800, letterSpacing: '0.16em', color: 'rgb(var(--tm-ee-white-rgb) / 0.6)' }}>BACK</span>
                  <span style={{ minWidth: 100, textAlign: 'left', fontSize: 'clamp(34px, 12vw, 48px)', fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1, letterSpacing: '-1px' }}>{fcb.back}</span>
                </div>
              )}

              {/* CENTRE — the hero. Same value + label + accent as the dial, just
                  sized for a glance; white = measured truth (C1 semantics). */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '6px 0' }}>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.22em', color: distAccent, marginBottom: 2 }}>{distLabel}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 'clamp(76px, 27vw, 132px)', fontWeight: 900, color: 'var(--tm-ee-raw)', fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"', lineHeight: 0.88, letterSpacing: '-4px', textShadow: '0 4px 24px rgb(var(--tm-ee-black-rgb) / 0.6)' }}>
                    {typeof displayYards === 'number' ? Math.round(displayYards) : '—'}
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '0.10em', color: 'rgb(var(--tm-ee-white-rgb) / 0.5)' }}>YDS</span>
                </div>
                {/* GPS state chip — same semantics as the dial (C1 re-rule) */}
                {gpsUsable ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--tm-ee-aligned)', boxShadow: '0 0 6px rgb(var(--tm-ee-gold-rgb) / 0.8)' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.10em', color: 'rgb(var(--tm-ee-gold-rgb) / 0.85)' }}>GPS</span>
                  </div>
                ) : gpsOutOfRange ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgb(var(--tm-ee-white-rgb) / 0.25)' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.10em', color: 'rgb(var(--tm-ee-white-rgb) / 0.55)' }}>GPS · OUT OF RANGE</span>
                  </div>
                ) : gpsAcquiring ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--tm-ee-acquiring)', animation: 'ee-acq-pulse 1.1s ease-in-out infinite' }} />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.10em', color: 'rgb(var(--tm-ee-white-rgb) / 0.6)' }}>ACQUIRING</span>
                  </div>
                ) : null}
              </div>

              {/* FRONT — near edge, on the BOTTOM (nearest to you) */}
              {fcb && fcb.front != null && (
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 12 }}>
                  <span style={{ width: 66, textAlign: 'right', fontSize: 13, fontWeight: 800, letterSpacing: '0.16em', color: 'rgb(var(--tm-ee-white-rgb) / 0.6)' }}>FRONT</span>
                  <span style={{ minWidth: 100, textAlign: 'left', fontSize: 'clamp(34px, 12vw, 48px)', fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1, letterSpacing: '-1px' }}>{fcb.front}</span>
                </div>
              )}

              {/* PLAYS LIKE — one subordinate line; still opens the breakdown sheet */}
              {plView && (
                <button onClick={() => setPlSheetOpen(true)} style={{
                  pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8, marginTop: 26, padding: '8px 16px',
                  background: 'rgb(var(--tm-ee-gold-rgb) / 0.16)', border: '1px solid rgb(var(--tm-ee-gold-rgb) / 0.38)', borderRadius: 12,
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.85)' }}>PLAYS LIKE</span>
                  <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--tm-ee-gold-light)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{plView.total}</span>
                  {plView.adj !== 0 && (
                    <span style={{ fontSize: 12, fontWeight: 800, color: plView.adj > 0 ? 'var(--tm-ee-amber)' : 'var(--tm-ee-green)', fontVariantNumeric: 'tabular-nums' }}>
                      {plView.adj > 0 ? `+${plView.adj}` : plView.adj}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      <PlaysLikeSheet
        open={plSheetOpen}
        onClose={() => setPlSheetOpen(false)}
        view={plView}
        eff={plEff}
        overrides={plOverrides}
        setOverrides={setPlOverrides}
        shotBearing={shotBearing}
        elevAvailable={elevDelta != null}
      />
      <ShotCaptureSheet
        open={captureOpen}
        snapshot={captureSnap}
        playsLike={capturePlays}
        gpsUsable={gpsUsable}
        bag={playerBag}
        suggestedSlot={recommendClub(myBag, capturePlays ?? captureSnap)?.slot ?? null}
        firstShot={captureBuf.length === 0}
        prevToPin={captureBuf.length ? captureBuf[captureBuf.length - 1].toPin : null}
        onGreen={captureOnGreen}
        autoLie={captureLie}
        onConfirm={(shot) => {
          if (activeCapture) {
            appendShot({ scope: activeCapture.scope, uid: user?.id, holeIdx: currentHole - 1 }, shot)
          }
          setCaptureOpen(false); setCaptureSnap(null); setCapturePlays(null); setCaptureOnGreen(false); setCaptureLie(null)
        }}
        onClose={() => { setCaptureOpen(false); setCaptureSnap(null); setCapturePlays(null); setCaptureOnGreen(false); setCaptureLie(null) }}
      />
      {showPicker && (
        <CoursePicker
          variant="sheet"
          onClose={() => { pendingStartRef.current = null; setShowPicker(false) }}
          onSelect={sel => {
            // If PlayStart routed here mid-start ("Not here?" / no recents),
            // continue the start in the pending mode; otherwise this is a
            // plain course pick (rangefinder-only — today's behavior).
            const pending = pendingStartRef.current
            pendingStartRef.current = null
            if (pending?.mode) {
              setShowPicker(false)
              startRound(sel, pending.mode, pending.holes)
            } else {
              handleCourseSelect(sel)
            }
          }}
          gps={gps}
          gender={user?.gender}
        />
      )}
      {/* One-active-match guard sheet (Play-funnel Match start). */}
      {activeMatchModal}

      {/* Back-button end/leave prompt — only when a round is ACTIVE (2026-07-10,
          Matt). "End round" routes to the scorecard where the PROPER end flows
          live (solo Finish saves the round; match End runs the save-or-discard
          sheet) — never a silent end from here, per never-lose-your-round.
          After ending there, the next Play open lands on the start screen
          automatically (tab-entry effect re-arms showStart). */}
      {showLeavePrompt && (
        <div onClick={() => setShowLeavePrompt(false)} style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgb(var(--tm-ee-black-rgb) / 0.6)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 430, borderRadius: '20px 20px 0 0',
            background: 'var(--tm-ee-bg-sheet)',
            border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)', borderBottom: 'none',
            padding: '20px 20px calc(env(safe-area-inset-bottom, 0px) + 20px)',
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
              You're in a round{courseCtx?.course?.club_name ? ` at ${courseCtx.course.club_name}` : ''}
            </div>
            <div style={{ fontSize: 12.5, color: 'rgb(var(--tm-ee-white-rgb) / 0.5)', lineHeight: 1.5, marginBottom: 16 }}>
              Ending brings up the save options right away — nothing is recorded without asking. Or exit and pick it back up any time.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => {
                // Fires the SAME end flow the scorecard's End Match uses (match:
                // endMatch() w/ its save-or-discard sheet, portaled to <body>;
                // solo: jump to the summary/save phase) — no extra hunting
                // through the menu (2026-07-10, Matt). Tab switch so the
                // ceremony/summary lands in view.
                setShowLeavePrompt(false)
                window.dispatchEvent(new Event('tm-request-end-round'))
                onGoToScorecard?.()
              }} style={{
                width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--tm-ee-gold) 0%, var(--tm-ee-gold-bright) 100%)',
                color: 'var(--tm-ee-bg)', fontWeight: 900, fontSize: 15,
              }}>End round</button>
              <button onClick={() => { setShowLeavePrompt(false); onExit?.() }} style={{
                width: '100%', padding: '14px 0', borderRadius: 14, cursor: 'pointer',
                background: 'rgb(var(--tm-ee-white-rgb) / 0.06)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.14)',
                color: 'rgb(var(--tm-ee-white-rgb) / 0.75)', fontWeight: 700, fontSize: 14,
              }}>Exit — keep the round going</button>
              <button onClick={() => setShowLeavePrompt(false)} style={{
                width: '100%', padding: '12px 0', borderRadius: 14, cursor: 'pointer',
                background: 'none', border: 'none',
                color: 'rgb(var(--tm-ee-white-rgb) / 0.4)', fontWeight: 600, fontSize: 13,
              }}>Keep playing</button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Scorecard pill removed 2026-05-01 — the page header
          already exposes a Scorecard link, the floating pill duplicated
          it and crowded the bottom-right where the BAG toggle lives. */}

      {/* ANALYZE (AI camera rangefinder) fully REMOVED 2026-07-07 (Matt): the
          camera flow (CameraModal + /api/eagle-eye/analyze + ResultSheet) was a
          less-accurate-than-GPS AI guess (monocular distance isn't credible at
          golf range) that duplicated the data-driven Caddie. Cut entirely; the
          real lever is per-shot capture feeding the SG engine. */}

      {/* Club toggle — idle state:
          single BAG button. Tap once → AI picks the best club match
          for the current target yardage and a vertical toggle takes
          over with ▲ (longer) and ▼ (shorter) arrows around the
          selected club. Each toggle press updates the landing-zone
          ring on the map. Tap the center to clear. (2026-05-01) */}
      {!showPicker && courseCtx && !showStart && !bigMode && (
        <ClubToggle
          bag={myBag}
          selected={selectedClub}
          targetYards={displayYards}
          onSelect={(c) => { setSelectedClub(c); setBagArcsOn(false) }}
          onClear={() => setSelectedClub(null)}
          onOpenSheet={() => setBagOpen(true)}
        />
      )}

      {/* My-bag arcs toggle (Phase 3.3) — summon the own-club distance zones.
          Calm by default; mutually exclusive with single-club selection. */}
      {!showPicker && courseCtx && !showStart && !bigMode && (
        <button
          onClick={() => {
            const turningOn = !bagArcsOn
            setBagArcsOn(turningOn); setSelectedClub(null)
            if (turningOn && playerBag.length === 0) setBagOpen(true) // no distances yet → prompt to set them, never guess
          }}
          aria-pressed={bagArcsOn}
          style={{
            // Sits clearly ABOVE the club/BAG toggle (which is centred at 50%+22px
            // and grows downward into a tall ▲/club/▼ pill when a club is picked).
            // 50%−72px keeps a comfortable gap so the two never collide. (2026-06-26)
            position: 'absolute', top: 'calc(50% - 72px)', right: 16, transform: 'translateY(-50%)',
            background: bagArcsOn ? 'rgb(var(--tm-ee-gold-rgb) / 0.30)' : 'rgb(var(--tm-ee-bg-rgb) / 0.62)',
            backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
            border: bagArcsOn ? '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.85)' : '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.40)',
            borderRadius: 999, padding: '8px 12px', color: 'var(--tm-ee-gold-light)',
            fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', cursor: 'pointer',
            boxShadow: '0 6px 18px rgb(var(--tm-ee-black-rgb) / 0.50), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.14)',
            display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', zIndex: 1000,
            WebkitTapHighlightColor: 'transparent',
          }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--tm-ee-gold-light)" strokeWidth="2.1" strokeLinecap="round">
            <path d="M3 18a9 9 0 0 1 18 0"/><path d="M6.5 18a5.5 5.5 0 0 1 11 0"/>
          </svg>
          ARCS
        </button>
      )}

      {/* Layup range-arcs toggle (2.5, 2026-07-02) — 100/150/200/250 to the green,
          the classic "what do I leave myself?" caddie view. Opt-in + persisted
          (tm-eye-rings); default off keeps the map clean (the market's #1
          documented overlay failure is clutter). Sits above ARCS on the same
          right-edge control rail — one coherent glass column. */}
      {!showPicker && courseCtx && !showStart && !bigMode && (
        <button
          onClick={toggleRings}
          aria-pressed={ringsOn}
          style={{
            position: 'absolute', top: 'calc(50% - 122px)', right: 16, transform: 'translateY(-50%)',
            background: ringsOn ? 'rgb(var(--tm-ee-gold-rgb) / 0.30)' : 'rgb(var(--tm-ee-bg-rgb) / 0.62)',
            backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
            border: ringsOn ? '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.85)' : '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.40)',
            borderRadius: 999, padding: '8px 12px', color: 'var(--tm-ee-gold-light)',
            fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', cursor: 'pointer',
            boxShadow: '0 6px 18px rgb(var(--tm-ee-black-rgb) / 0.50), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.14)',
            display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', zIndex: 1000,
            WebkitTapHighlightColor: 'transparent',
          }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--tm-ee-gold-light)" strokeWidth="2.1" strokeLinecap="round">
            <circle cx="12" cy="12" r="3"/><path d="M5.5 12a6.5 6.5 0 0 1 13 0"/><path d="M2 12a10 10 0 0 1 20 0"/>
          </svg>
          RINGS
        </button>
      )}

      {bagOpen && (
        <BagSheet
          clubs={myBag}
          selectedSlot={selectedClub?.slot}
          onPick={(c) => { setSelectedClub(c); setBagArcsOn(false); setBagOpen(false) }}
          onClear={() => { setSelectedClub(null); setBagOpen(false) }}
          onClose={() => setBagOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Club toggle (right-edge floating UI) ───────────────────────────────────
// Idle: single BAG button. Tap → recommend a club for the current
// target yardage (closest avg_yards match). After selection it
// morphs into a vertical 3-row pill: ▲ (longer club) / current /
// ▼ (shorter club). Each ▲/▼ tap re-selects, which feeds the
// landing-zone ring on the map. Center button = open the full bag
// sheet for browsing. (2026-05-01)
function ClubToggle({ bag = [], selected, targetYards, onSelect, onClear, onOpenSheet }) {
  const usable = bag
    .filter(c => c.slot !== 'putter' && Number.isFinite(Number(c.avg_yards)))
    .sort((a, b) => Number(a.avg_yards) - Number(b.avg_yards)) // shortest → longest

  // Recommend: pick the club whose avg_yards is closest to the target.
  function recommend() {
    // Shared with the walk-and-confirm capture sheet — lib/clubModel
    // recommendClub (extracted 2026-07-07; behavior identical).
    const best = recommendClub(bag, targetYards)
    if (!best) { onOpenSheet?.(); return }  // empty bag — surface the sheet
    onSelect?.(best)
  }

  // Idle state — single BAG button, tap to invoke recommendation
  if (!selected) {
    return (
      <button onClick={recommend} style={{
        position: 'absolute',
        // Anchor at calc(50% + 22px) so the BAG button visually lines
        // up with the zoom control on the left edge — the zoom stack
        // is two buttons tall (~60px) and centered at 50%, so its
        // midline sits a bit lower than a single 40px BAG centered
        // at the same point. (2026-05-01 — Matt)
        top: 'calc(50% + 22px)', right: 16,
        transform: 'translateY(-50%)',
        background: 'rgb(var(--tm-ee-bg-rgb) / 0.62)',
        backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
        border: '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.40)',
        borderRadius: 999, padding: '10px 14px',
        color: 'var(--tm-ee-gold-light)',
        fontSize: 12, fontWeight: 800, letterSpacing: '0.06em',
        cursor: 'pointer',
        boxShadow: '0 6px 18px rgb(var(--tm-ee-black-rgb) / 0.50), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.14)',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        fontFamily: 'inherit',
        zIndex: 1000,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="var(--tm-ee-gold-light)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9h12v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9z"/>
          <path d="M9 9V5a3 3 0 0 1 6 0v4"/>
          <line x1="12" y1="3" x2="12" y2="9" />
        </svg>
        BAG
      </button>
    )
  }

  // Active state — vertical toggle column
  const idx     = usable.findIndex(c => c.slot === selected.slot)
  const upClub   = idx < usable.length - 1 ? usable[idx + 1] : null  // longer
  const downClub = idx > 0 ? usable[idx - 1] : null                  // shorter

  const arrowBtn = (label, club, disabled) => (
    <button
      disabled={disabled}
      onClick={() => club && onSelect?.(club)}
      style={{
        background: disabled ? 'rgb(var(--tm-ee-bg-rgb) / 0.42)' : 'rgb(var(--tm-ee-bg-rgb) / 0.62)',
        backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
        border: disabled ? '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.18)' : '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.55)',
        color: disabled ? 'rgb(var(--tm-ee-gold-light-rgb) / 0.30)' : 'var(--tm-ee-gold-light)',
        borderRadius: 12, padding: '6px 10px',
        fontSize: 11, fontWeight: 800, letterSpacing: '0.02em',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit', minWidth: 96,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        boxShadow: '0 4px 12px rgb(var(--tm-ee-black-rgb) / 0.45), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.12)',
      }}
    >
      <span>{label}</span>
      {club ? <span style={{ opacity: 0.85 }}>{club.avg_yards}y</span> : <span style={{ opacity: 0.30 }}>—</span>}
    </button>
  )

  return (
    <div style={{
      position: 'absolute',
      // Same anchor as the idle BAG above — keeps the active toggle
      // visually parallel with the zoom control on the left.
      top: 'calc(50% + 22px)', right: 16,
      transform: 'translateY(-50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6,
      zIndex: 1000,
    }}>
      {arrowBtn('▲ LONGER', upClub, !upClub)}

      {/* Center: current selection. Tap = open full bag sheet. Long-tap
          fallback isn't supported on iOS easily, so we use a small ✕
          on the right to clear instead. */}
      <div style={{
        display: 'flex', alignItems: 'stretch', gap: 6,
      }}>
        <button
          onClick={onOpenSheet}
          style={{
            background: 'linear-gradient(135deg, rgb(var(--tm-ee-gold-light-rgb) / 0.97), rgb(var(--tm-ee-gold-rgb) / 0.97))',
            border: '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.85)',
            borderRadius: 12, padding: '10px 14px',
            color: 'var(--tm-ee-bg)',
            fontFamily: 'inherit',
            cursor: 'pointer',
            boxShadow: '0 6px 18px rgb(var(--tm-ee-gold-rgb) / 0.45)',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            minWidth: 96,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.01em', lineHeight: 1.1 }}>
            {SLOT_LABELS_TOGGLE[selected.slot] || 'Club'}
          </span>
          <span style={{ fontSize: 11, fontWeight: 800, opacity: 0.80, lineHeight: 1.1, marginTop: 2 }}>
            {selected.avg_yards}y
          </span>
        </button>
        <button
          onClick={onClear}
          aria-label="Clear club"
          style={{
            background: 'rgb(var(--tm-ee-bg-rgb) / 0.85)',
            border: '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.40)',
            borderRadius: 12, padding: '0 10px',
            color: 'var(--tm-ee-gold-light)',
            fontSize: 14, fontWeight: 800,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >✕</button>
      </div>

      {arrowBtn('▼ SHORTER', downClub, !downClub)}
    </div>
  )
}

// Slot labels (compact map for the toggle's center button — keeps the
// component self-contained without importing the full clubCatalog.)
const SLOT_LABELS_TOGGLE = {
  driver: 'Driver', '3w': '3 Wood', '5w': '5 Wood', '7w': '7 Wood',
  hybrid_1: 'Hybrid', hybrid_2: 'Hybrid 2',
  iron_3: '3 Iron', iron_4: '4 Iron', iron_5: '5 Iron', iron_6: '6 Iron',
  iron_7: '7 Iron', iron_8: '8 Iron', iron_9: '9 Iron',
  pw: 'PW', gw: 'Gap', sw: 'Sand', lw: 'Lob',
}

// ─── Bag picker bottom-sheet ────────────────────────────────────────────────
// Lists the user's bag (filled slots only), excluding the putter (no
// meaningful avg distance). Sorted longest to shortest so the player
// scans by reach. Tap a row to set as the active landing-zone club;
// "Clear" wipes the active selection so the ring disappears.
function BagSheet({ clubs = [], selectedSlot = null, onPick, onClear, onClose }) {
  const SLOT_LABELS = {
    driver: 'Driver', '3w': '3 Wood', '5w': '5 Wood', '7w': '7 Wood',
    hybrid_1: 'Hybrid 1', hybrid_2: 'Hybrid 2',
    iron_3: '3 Iron', iron_4: '4 Iron', iron_5: '5 Iron', iron_6: '6 Iron',
    iron_7: '7 Iron', iron_8: '8 Iron', iron_9: '9 Iron',
    pw: 'Pitching Wedge', gw: 'Gap Wedge', sw: 'Sand Wedge', lw: 'Lob Wedge',
    putter: 'Putter',
  }
  const usable = clubs
    .filter(c => c.slot !== 'putter' && Number.isFinite(Number(c.avg_yards)))
    .sort((a, b) => Number(b.avg_yards) - Number(a.avg_yards))

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgb(var(--tm-ee-black-rgb) / 0.65)', backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480,
        maxHeight: '78vh',
        display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, var(--tm-ee-bg-deep) 0%, var(--tm-ee-bg) 100%)',
        border: '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.25)',
        borderRadius: '20px 20px 0 0',
        overflow: 'hidden',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgb(var(--tm-ee-gold-light-rgb) / 0.30)', margin: '12px auto 8px', flexShrink: 0 }} />

        <div style={{
          padding: '4px 18px 14px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgb(var(--tm-ee-white-rgb) / 0.06)',
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.60)', fontWeight: 700, letterSpacing: '0.20em' }}>
              MY BAG
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginTop: 2 }}>
              Pick a club for landing zone
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgb(var(--tm-ee-white-rgb) / 0.06)', border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)',
            borderRadius: 10, color: 'rgb(var(--tm-ee-white-rgb) / 0.70)', fontSize: 16,
            cursor: 'pointer', padding: '4px 10px', height: 32, lineHeight: 1,
            fontFamily: 'inherit',
          }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px 12px' }}>
          {usable.length === 0 && (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              color: 'rgb(var(--tm-ee-white-rgb) / 0.55)', fontSize: 13, lineHeight: 1.55,
            }}>
              Your bag is empty (or no distances saved yet).<br/>
              Add clubs in the <strong>My Bag</strong> tab to use this picker.
            </div>
          )}
          {usable.map(c => {
            const active = c.slot === selectedSlot
            return (
              <button key={c.slot} onClick={() => onPick(c)} style={{
                width: '100%', textAlign: 'left',
                background: active ? 'rgb(var(--tm-ee-gold-light-rgb) / 0.10)' : 'rgb(var(--tm-ee-white-rgb) / 0.03)',
                border: active ? '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.55)' : '1px solid rgb(var(--tm-ee-white-rgb) / 0.06)',
                borderRadius: 12, padding: '12px 14px',
                marginBottom: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 10, color: 'rgb(var(--tm-ee-gold-light-rgb) / 0.65)', fontWeight: 700,
                    letterSpacing: '0.10em', textTransform: 'uppercase',
                  }}>{SLOT_LABELS[c.slot] || c.slot}</div>
                  <div style={{
                    fontSize: 14, fontWeight: 800, color: '#fff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {c.brand} <span style={{ color: 'rgb(var(--tm-ee-white-rgb) / 0.62)', fontWeight: 600 }}>{c.model}</span>
                  </div>
                </div>
                <div style={{
                  background: 'linear-gradient(135deg, var(--tm-ee-gold-light), var(--tm-ee-gold))',
                  color: 'var(--tm-ee-bg)',
                  padding: '4px 10px', borderRadius: 999,
                  fontSize: 13, fontWeight: 900, letterSpacing: '-0.01em',
                  flexShrink: 0,
                }}>{c.avg_yards}y</div>
              </button>
            )
          })}
        </div>

        {selectedSlot && (
          <div style={{
            padding: '10px 18px calc(10px + env(safe-area-inset-bottom)) 18px',
            borderTop: '1px solid rgb(var(--tm-ee-white-rgb) / 0.06)',
            flexShrink: 0,
          }}>
            <button onClick={onClear} style={{
              width: '100%', padding: '12px',
              background: 'rgb(var(--tm-ee-white-rgb) / 0.05)',
              border: '1px solid rgb(var(--tm-ee-white-rgb) / 0.12)',
              borderRadius: 12,
              color: 'rgb(var(--tm-ee-white-rgb) / 0.75)',
              fontSize: 13, fontWeight: 700,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>Clear selection</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
