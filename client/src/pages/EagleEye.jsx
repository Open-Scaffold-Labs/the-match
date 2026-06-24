import { useState, useRef, useEffect, useCallback, Component } from 'react'
import { createPortal } from 'react-dom'
import HoleMapGL from './HoleMapGL.jsx'
import { api, post } from '../lib/api.js'
import { greenFCB, matchPolygonsToHoles, estimateAltFromPressure } from '../lib/geo.js'

// Feature flags — flip to false to disable a feature that isn't yet
// device-tested, without a revert/redeploy. Both degrade safely when off:
// tap-to-measure simply doesn't attach; F/C/B falls back to the single
// center number. (2026-06-06)
const ENABLE_TAP_MEASURE = true
const ENABLE_FCB = true
// MapLibre GL renderer (Phase 2.1/2.2). ON in the beta so it gets tested, but
// HoleMapSwitch auto-falls back to the proven Leaflet map if MapLibre fails to
// load or init at runtime — so the beta can never hard-break on this path.
const ENABLE_MAPLIBRE = true

// GPS accuracy gate (Phase 1.1) — a live yardage is only quoted when the fix
// is tight enough to be honest. coords.accuracy is the 68% horizontal radius
// in metres; beyond this we show "Acquiring GPS…" instead of a confidently-
// wrong number (the cold-start / tree-canopy / clubhouse failure mode that
// destroys trust on hole 1). ~10 m ≈ ±11 yd — past that the number isn't
// trustworthy to a golfer choosing a club. A null accuracy is untrusted.
const GPS_ACCURACY_GATE_M = 10
import { log } from '../lib/logger.js'
import { dedupeTees } from '../lib/tees.js'
import CoachMark from '../components/CoachMark.jsx'

// Module-level cache: keyed by `${courseId}-${teeName}` — survives re-renders,
// cleared only on page reload. Means switching holes is instant after first load.
const osmPositionCache = new Map()

// ─── localStorage persistence for OSM data (7-day TTL) ───────────────────────
// After the first load of a course, pins are instant on every subsequent visit.
const OSM_LS_TTL = 7 * 24 * 60 * 60 * 1000
// Per-course hole persistence so a reload (pull-to-refresh / SW update)
// resumes the exact hole instead of snapping back to hole 1. Keyed by
// course id so switching courses doesn't carry a stale hole. (2026-06-06)
const EYE_HOLE_KEY = 'tm-eye-hole'
function readEyeHole(courseId) {
  if (!courseId) return null
  try {
    const v = JSON.parse(localStorage.getItem(EYE_HOLE_KEY) || 'null')
    if (v && String(v.courseId) === String(courseId) && v.hole >= 1) return v.hole
  } catch { /* ignore */ }
  return null
}
function saveEyeHole(courseId, hole) {
  if (!courseId) return
  try { localStorage.setItem(EYE_HOLE_KEY, JSON.stringify({ courseId, hole })) } catch { /* ignore */ }
}

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
// aim bearing + club distance, returns the lat/lon where the ball lands.
function projectPoint(start, distMeters, bearingDeg) {
  if (!start || !Number.isFinite(distMeters) || !Number.isFinite(bearingDeg)) return null
  const R = 6371000
  const lat1 = start.lat * Math.PI / 180
  const lon1 = start.lon * Math.PI / 180
  const brng = bearingDeg * Math.PI / 180
  const d    = distMeters / R
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng))
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  )
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI }
}

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
function computePlaysLike(baseYds, { windSpeed = 0, windFromDeg = null, shotBearing = null, tempF = null, altFt = 0 } = {}) {
  if (!baseYds || baseYds <= 0) return { plays: baseYds, adj: 0 }
  const per100 = baseYds / 100
  let wind = 0
  if (windSpeed && windFromDeg != null && shotBearing != null) {
    const theta = ((shotBearing - windFromDeg) * Math.PI) / 180
    wind = windSpeed * Math.cos(theta) * per100   // +headwind plays longer, -tailwind shorter
  }
  const temp = tempF != null ? ((70 - tempF) / 10) * per100 : 0  // colder plays longer
  const alt  = -baseYds * ((altFt || 0) / 1000) * 0.02            // altitude plays shorter
  const adj  = wind + temp + alt
  return { plays: Math.max(0, Math.round(baseYds + adj)), adj: Math.round(adj) }
}

// ─── Pulsating Eagle Eye Button ───────────────────────────────────────────────
const PULSE_STYLE = `
  @keyframes ee-pulse {
    0%   { box-shadow: 0 0 0 0 rgba(201,160,64,0.55), 0 4px 20px rgba(201,160,64,0.3); transform: scale(1); }
    60%  { box-shadow: 0 0 0 16px rgba(201,160,64,0), 0 4px 24px rgba(201,160,64,0.4); transform: scale(1.04); }
    100% { box-shadow: 0 0 0 0 rgba(201,160,64,0), 0 4px 20px rgba(201,160,64,0.3); transform: scale(1); }
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
          background: 'linear-gradient(145deg, #E8C05A, #C9A040)',
          border: '3px solid rgba(255,255,255,0.25)',
          cursor: scanning ? 'default' : 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
          animation: scanning ? 'ee-scan 0.9s ease-in-out infinite' : 'ee-pulse 2s ease-out infinite',
          WebkitTapHighlightColor: 'transparent',
          outline: 'none',
        }}
      >
        {/* Eagle Eye target icon */}
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(7,12,9,0.85)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="5"/>
          <circle cx="12" cy="12" r="1.5" fill="rgba(7,12,9,0.85)"/>
          <line x1="12" y1="2" x2="12" y2="5"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
          <line x1="2" y1="12" x2="5" y2="12"/>
          <line x1="19" y1="12" x2="22" y2="12"/>
        </svg>
      </button>
      <div style={{ color: 'rgba(245,215,138,0.7)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginTop: 6, textTransform: 'uppercase' }}>
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

function DistanceInstrument({ yards, label, accent = '#5ED47A' }) {
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
            <stop offset="0%" stopColor="#F5E070" />
            <stop offset="55%" stopColor={accent} />
            <stop offset="100%" stopColor="#2A7A38" />
          </linearGradient>
        </defs>
        {/* track */}
        <path d={gaugeArc(C, C, R, 225, TRACK)} fill="none" stroke="rgba(255,255,255,0.12)"
          strokeWidth="7" strokeLinecap="round" />
        {/* value */}
        {has && sweep > 0 && (
          <path d={gaugeArc(C, C, R, 225, TRACK * sweep)} fill="none" stroke="url(#ee-gauge-grad)"
            strokeWidth="7" strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 5px rgba(245,224,112,0.45))' }} />
        )}
      </svg>
      {/* number + unit, centred */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
          color: has ? accent : 'rgba(255,255,255,0.45)', marginBottom: -2 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span style={{ fontSize: 46, fontWeight: 900, letterSpacing: '-2px', color: '#fff',
            lineHeight: 0.9, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"',
            textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>{display}</span>
        </div>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
          color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>YDS</div>
      </div>
    </div>
  )
}

// ─── Satellite hole map (Leaflet + USDA NAIP tiles + OSM hole positions) ─────
// geocoded, holePositions, greenPositions fetched by parent EagleEye and passed as props
// Walk a polyline geometry from its first point and return the
// {lat, lon} that's `targetYards` along it. Used to place the aim-point
// default on the fairway centerline (which, on doglegs, isn't on the
// straight tee→green line). Falls off the end → returns the last point.
function pointAlongGeometryAtYards(geom, targetYards) {
  if (!geom || geom.length < 2) return null
  let accum = 0
  for (let i = 0; i < geom.length - 1; i++) {
    const a = geom[i], b = geom[i + 1]
    const segLen = haversineYards(a, b) || 0
    if (accum + segLen >= targetYards) {
      const t = segLen > 0 ? (targetYards - accum) / segLen : 0
      return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
      }
    }
    accum += segLen
  }
  const last = geom[geom.length - 1]
  return { lat: last.lat, lon: last.lon }
}

// Decide where the aim-point should default to for a given hole.
// - Par 3 → on the green (dropping the target on the green communicates
//   "aim at the pin" — golfers go straight at it on a par 3).
// - Par 4/5 → typical drive landing zone: ~250 yards from the tee, but
//   leave at least 100 yards short of the green (so we never put the
//   target on top of the flag for short par 4s).
// - Walks the OSM hole-way geometry when available (handles doglegs);
//   otherwise interpolates linearly along the tee→green chord.
function getDefaultAim({ par, totalYards, teePt, greenPt, geometry }) {
  if (!teePt || !greenPt) return null
  if (par === 3) return { lat: greenPt.lat, lon: greenPt.lon }

  // Par 4/5 layup: cap drive at 250y, but never within 100y of the green
  const targetYards = Math.max(150, Math.min(250, (totalYards || 0) - 100))

  // Prefer geometry-walk so doglegs route through the fairway, not OOB
  if (geometry && geometry.length >= 2) {
    const pt = pointAlongGeometryAtYards(geometry, targetYards)
    if (pt) return pt
  }

  // Fallback: linear interpolation along the straight tee→green chord
  const t = totalYards > 0 ? Math.max(0, Math.min(1, targetYards / totalYards)) : 0.6
  return {
    lat: teePt.lat + (greenPt.lat - teePt.lat) * t,
    lon: teePt.lon + (greenPt.lon - teePt.lon) * t,
  }
}

function HoleMap({ courseCtx, currentHole, gps, geocoded, holePositions = {}, greenPositions = {}, holeGeometries = {}, clubYards = null, clubLabel = null }) {
  const containerRef      = useRef(null)
  const mapRef            = useRef(null)
  const markerRef         = useRef(null)   // GPS dot (player puck)
  const accHaloRef        = useRef(null)   // true-ground accuracy halo around the puck
  const puckRafRef        = useRef(0)      // rAF id for the puck-glide animation
  const puckPosRef        = useRef(null)   // last animated puck {lat, lon}
  const holeMarkerRef     = useRef(null)   // gold tee pin
  const greenMarkerRef    = useRef(null)   // red flag on green
  const lineRef           = useRef(null)   // white polyline tee → aim → green
  const distLabelRef      = useRef(null)   // tee → aim segment yardage
  const aimToGreenLabelRef = useRef(null)  // aim → green segment yardage
  const aimMarkerRef      = useRef(null)   // draggable target circle
  const landingZoneRef    = useRef(null)   // gold ring at GPS, radius = club avg
  const landingLabelRef   = useRef(null)   // small label on the ring
  // Live snapshot of tee/green/totalYards for the drag handler. The
  // handler is attached once at marker creation; without a ref the
  // closure would freeze the hole-1 values and aim-point drags on
  // hole 2+ would compute against the wrong tee/green. (2026-05-01)
  const livePosRef        = useRef({ teePt: null, greenPt: null, totalYards: 0 })
  // Tap-to-measure (Feature A, 2026-06-06): a white pin + label dropped where
  // the user taps the satellite — shows carry from the player and distance to
  // the green from that point. gpsPropRef gives the once-attached click
  // handler the live player position without a frozen closure.
  const measureMarkerRef  = useRef(null)
  const measureLabelRef   = useRef(null)
  const gpsPropRef         = useRef(gps)
  const [mapErr, setMapErr] = useState(null)
  const [mapReady, setMapReady] = useState(false)
  // Aim-point state. null means "use default" (midpoint of tee→green).
  // When the user drags the target, dragend commits the new {lat, lon}
  // here, which causes labels and line to re-render at the chosen spot.
  // Reset to null when the hole changes so each hole starts at its own
  // midpoint default. (2026-05-01)
  const [aimPoint, setAimPoint] = useState(null)

  // Load Leaflet from CDN and init map — only once geocoded location is known
  useEffect(() => {
    if (!containerRef.current || !geocoded) return
    const center = geocoded

    const init = () => {
      if (mapRef.current) return // already initialized
      const L = window.L
      if (!L) return

      // Always center on the course, not the user's current GPS
      const courseCenter = geocoded ?? center
      const map = L.map(containerRef.current, {
        center: [courseCenter.lat, courseCenter.lon],
        zoom: 16,
        zoomControl: true,
        attributionControl: true,   // imagery attribution is a license obligation
        rotate: true,           // leaflet-rotate: enable bearing control
        touchRotate: false,     // disable confusing pinch-rotate gesture
        bearing: 0,
        zoomSnap: 0.5,          // allow fractional zoom levels (e.g. 16.5)
      })
      // Drop the "Leaflet" prefix — keep just the imagery credit, compact.
      try { map.attributionControl.setPrefix(false) } catch { /* older build */ }

      // USDA NAIP (National Agriculture Imagery Program) — public-domain US
      // gov aerial orthoimagery, ~0.6 m/px (serves to z18), free for
      // commercial use with no API key. Replaces the keyless ESRI World
      // Imagery endpoint, whose Terms of Use bar commercial use without a paid
      // license (Phase 1.3 licensing fix, 2026-06-24). CONUS coverage at
      // launch; outside it the branded dark canvas (.leaflet-container bg) +
      // OSM hole overlays show through — the free vector hole view.
      // maxNativeZoom:18 = the deepest NAIP tile; Leaflet up-scales past it
      // (UI maxZoom 20) instead of requesting 404s. Verified z16–18 serve
      // imagery across Augusta/Pebble/Orlando, z19 404s. keepBuffer:4 keeps
      // more tiles in memory during pans.
      L.tileLayer(
        'https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, maxNativeZoom: 18, tileSize: 256, keepBuffer: 4, updateWhenZooming: false,
          attribution: 'Imagery: USDA NAIP' }
      ).addTo(map)

      // GPS dot (player puck) — only show if user is within ~5 miles of
      // course. White-ringed gold dot; the smooth-puck effect owns updates +
      // the accuracy halo from here on. (Phase 2.5)
      if (gps && geocoded) {
        const dist = haversineYards(gps, { lat: geocoded.lat, lon: geocoded.lon })
        if (dist != null && dist < 8800) {
          markerRef.current = L.circleMarker([gps.lat, gps.lon], {
            radius: 9, color: '#fff', weight: 3,
            fillColor: '#F5D78A', fillOpacity: 0.95,
          }).addTo(map)
          puckPosRef.current = { lat: gps.lat, lon: gps.lon }
        }
      }

      mapRef.current = map
      // Don't fitBounds here — the hole-pan effect will position the map
      // correctly once OSM data arrives. Avoids a redundant double-move.
      setMapReady(true)

      // iOS fix: the flex container often hasn't reached its final size at
      // init time (dynamic-viewport units + safe-area insets settle a frame
      // later), so Leaflet measures wrong and lays tiles out offset /
      // off-screen. Recompute once layout settles, and again after a beat
      // for slow first paints. Pure map sizing — no GPS/distance impact.
      // (2026-06-01 — map-rendered-off-screen glitch on iPhone.)
      requestAnimationFrame(() => { try { map.invalidateSize() } catch { /* map gone */ } })
      setTimeout(() => { try { map.invalidateSize() } catch { /* map gone */ } }, 350)

      // ── Tap-to-measure ── tap anywhere on the satellite to drop a pin
      // showing carry from the player + distance to the green from that
      // point. carry/toGreen are integers from haversineYards (XSS-safe in
      // the label html). Uses e.latlng; if an on-course test shows skew
      // under map rotation, switch to map.mouseEventToLatLng(e.originalEvent).
      // (2026-06-06 — Feature A.)
      if (ENABLE_TAP_MEASURE) map.on('click', (e) => {
        if (!mapRef.current) return
        const tap = { lat: e.latlng.lat, lon: e.latlng.lng }
        const g = gpsPropRef.current
        const gAtCourse = g?.lat != null && geocoded?.lat != null &&
          haversineYards({ lat: g.lat, lon: g.lon }, { lat: geocoded.lat, lon: geocoded.lon }) < 8800
        const player  = gAtCourse ? { lat: g.lat, lon: g.lon } : null
        const greenPt = livePosRef.current?.greenPt
        const carry   = player ? haversineYards(player, tap) : null
        const toGreen = greenPt ? haversineYards(tap, greenPt) : null
        if (carry == null && toGreen == null) return
        // White pin (circleMarker → reliable SVG pane). Tap it to clear.
        if (measureMarkerRef.current) {
          measureMarkerRef.current.setLatLng([tap.lat, tap.lon])
        } else {
          measureMarkerRef.current = L.circleMarker([tap.lat, tap.lon], {
            radius: 7, color: '#fff', weight: 2, fillColor: '#fff', fillOpacity: 0.9,
          }).addTo(map)
          measureMarkerRef.current.on('click', (ev) => { L.DomEvent.stopPropagation(ev); clearMeasure() })
        }
        const txt = (carry != null && toGreen != null) ? `${carry}y · ${toGreen} to grn`
                  : (carry != null) ? `${carry}y` : `${toGreen}y to grn`
        const html = `<div style="background:rgba(7,12,9,0.92);color:#fff;font-weight:800;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:4px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.6);box-shadow:0 2px 8px rgba(0,0,0,0.55);white-space:nowrap;">${txt}</div>`
        const icon = L.divIcon({ className: '', html, iconSize: [90, 22], iconAnchor: [45, 30] })
        if (measureLabelRef.current) { measureLabelRef.current.setLatLng([tap.lat, tap.lon]); measureLabelRef.current.setIcon(icon) }
        else measureLabelRef.current = L.marker([tap.lat, tap.lon], { icon, interactive: false, keyboard: false }).addTo(map)
      })
    }

    // Keep the map correctly sized across rotation / viewport changes
    // (address bar show/hide, orientation) — same iOS sizing gremlin.
    const onMapResize = () => { if (mapRef.current) { try { mapRef.current.invalidateSize() } catch { /* map gone */ } } }
    window.addEventListener('resize', onMapResize)
    window.addEventListener('orientationchange', onMapResize)

    // Load Leaflet + rotate plugin in parallel, init when both are ready
    const tryInit = () => { if (window.L && window.__leafletRotateReady) init() }

    const loadRotatePlugin = () => {
      if (window.__leafletRotateReady) { tryInit(); return }
      if (document.getElementById('leaflet-rotate-js')) return // already injecting
      const s = document.createElement('script')
      s.id  = 'leaflet-rotate-js'
      s.src = 'https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js'
      s.onload = () => { window.__leafletRotateReady = true; tryInit() }
      document.head.appendChild(s)
    }

    if (window.L) {
      loadRotatePlugin()
    } else {
      // Inject Leaflet CSS
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link')
        link.id = 'leaflet-css'
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }
      // Inject Leaflet JS and rotate plugin IN PARALLEL, init when both ready
      if (!document.getElementById('leaflet-js')) {
        const script = document.createElement('script')
        script.id  = 'leaflet-js'
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
        // Load rotate plugin AFTER Leaflet — rotate extends L.* prototypes,
        // so Leaflet must be present first. Then tryInit when both are ready.
        script.onload = () => { loadRotatePlugin() }
        document.head.appendChild(script)
      }
    }

    return () => {
      window.removeEventListener('resize', onMapResize)
      window.removeEventListener('orientationchange', onMapResize)
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      cancelAnimationFrame(puckRafRef.current)
      markerRef.current = null
      accHaloRef.current = null
      puckPosRef.current = null
      holeMarkerRef.current = null
      greenMarkerRef.current = null
      lineRef.current = null
      distLabelRef.current = null
      aimToGreenLabelRef.current = null
      aimMarkerRef.current = null
      measureMarkerRef.current = null
      measureLabelRef.current = null
      setMapReady(false)
    }
  }, [geocoded])

  // Reset aim-point when the hole changes. The position-update effect
  // below treats null as "use the new hole's midpoint default."
  useEffect(() => { setAimPoint(null) }, [currentHole])

  // Keep the live-gps ref current for the once-attached map click handler.
  useEffect(() => { gpsPropRef.current = gps }, [gps])

  // Remove the tap-to-measure pin + label. Reused by the click handler
  // (tap the pin to clear), the hole-change effect, and teardown. (2026-06-06)
  const clearMeasure = useCallback(() => {
    if (measureMarkerRef.current) { measureMarkerRef.current.remove(); measureMarkerRef.current = null }
    if (measureLabelRef.current)  { measureLabelRef.current.remove();  measureLabelRef.current = null }
  }, [])

  // Clear any measure pin when the hole changes so a stale pin doesn't
  // linger onto the next hole. (2026-06-06)
  useEffect(() => { clearMeasure() }, [currentHole, clearMeasure])

  // Landing-zone marker — projects a target along the aim line at the
  // selected club's distance, so the player sees exactly where the
  // ball would land if they hit this club toward the current aim.
  // Updates live on every toggle press and whenever the aim point is
  // dragged. (2026-05-01 — Matt: not a circle around the player; a
  // marker in the direction of aim.)
  useEffect(() => {
    if (!mapRef.current || !window.L) return
    const L = window.L
    const map = mapRef.current

    // Always tear down the previous marker + label first.
    if (landingZoneRef.current) { landingZoneRef.current.remove(); landingZoneRef.current = null }
    if (landingLabelRef.current) { landingLabelRef.current.remove(); landingLabelRef.current = null }

    if (!Number.isFinite(Number(clubYards)) || Number(clubYards) <= 0) return

    // Player position fallback chain. Use GPS only when within 5 miles
    // (8800 yards) of the course — otherwise the marker projects from
    // the user's home into nowhere visible on the map. Same gate the
    // GPS dot uses on line ~330. (2026-05-01 — Matt: marker invisible
    // because home-GPS + course-bearing put landing far off the map.)
    const teePt = holePositions[currentHole]
    let player
    const courseAnchor = geocoded?.lat != null && geocoded?.lon != null
      ? { lat: geocoded.lat, lon: geocoded.lon }
      : (teePt?.lat != null && teePt?.lon != null ? teePt : null)
    const gpsToCourse = (gps?.lat != null && courseAnchor)
      ? haversineYards({ lat: gps.lat, lon: gps.lon }, courseAnchor)
      : null
    const gpsAtCourse = gpsToCourse != null && gpsToCourse < 8800
    if (gpsAtCourse)                                 player = { lat: gps.lat, lon: gps.lon }
    else if (teePt?.lat != null && teePt?.lon != null) player = teePt
    else if (geocoded?.lat != null && geocoded?.lon != null) player = { lat: geocoded.lat, lon: geocoded.lon }
    else return

    // Aim direction: use the user's chosen aim point (state) if set;
    // otherwise fall back to the hole's default aim (par-aware
    // midpoint computed from OSM geometry).
    const greenPt = greenPositions[currentHole]
    const par     = courseCtx?.tee?.holes?.find(h => h.hole === currentHole)?.par ?? 4
    const totalYards = courseCtx?.tee?.holes?.find(h => h.hole === currentHole)?.yardage ?? 0
    const geometry = holeGeometries[currentHole]
    const aim = aimPoint || getDefaultAim({ par, totalYards, teePt, greenPt, geometry })
    if (!aim) return

    // Bearing from player → aim, project the landing point at distance
    // = club avg yards along that bearing.
    const brng = calcBearing(player, aim)
    if (!Number.isFinite(brng)) return
    const yards = Number(clubYards)
    const distMeters = yards * 0.9144
    const landing = projectPoint(player, distMeters, brng)
    if (!landing) return

    // Gold ring marker at the projected landing point. circleMarker
    // paints into the SVG overlay pane (more reliable than divIcon
    // inside leaflet-rotate's transformed marker pane).
    landingZoneRef.current = L.circleMarker([landing.lat, landing.lon], {
      radius: 12,
      color: '#F5E070',
      weight: 3,
      opacity: 1,
      fillColor: '#F5E070',
      fillOpacity: 0.45,
      interactive: false,
    }).addTo(map)
  }, [
    clubYards, clubLabel,
    gps?.lat, gps?.lon,
    aimPoint?.lat, aimPoint?.lon,
    currentHole,
  ])

  // Pan to current hole + update single marker (no 36-marker re-render)
  useEffect(() => {
    if (!mapRef.current || !window.L) return
    const teePos   = holePositions[currentHole]
    const greenPos = greenPositions[currentHole]
    const panPos   = teePos || greenPos
    if (!panPos) return

    const teePt   = holePositions[currentHole]
    const greenPt = greenPositions[currentHole]

    // Center between tee and green so both are visible, not just the tee
    const centerLat = teePt && greenPt ? (teePt.lat + greenPt.lat) / 2 : panPos.lat
    const centerLon = teePt && greenPt ? (teePt.lon + greenPt.lon) / 2 : panPos.lon
    // Zoom based on hole length. Tuned 2026-05-01 per Matt: par 5s
    // (typically 470-580y) at zoom 16 felt too zoomed-out, but the
    // longest holes still need a wider view than par 4s. Fractional
    // zoom enabled via zoomSnap:0.5 in the map options. Threshold is
    // 550y → 16.5 (a touch tighter than 16, looser than 17), 220-550y
    // → 17 (par 4 + standard par 5), ≤220y → 18 (par 3).
    const holeDist  = teePt && greenPt ? haversineYards(teePt, greenPt) : 0
    const zoom = holeDist > 550 ? 16.5 : holeDist > 220 ? 17 : 18

    // animate:false = instant teleport to the hole
    mapRef.current.setView([centerLat, centerLon], zoom, { animate: false })

    // setBearing MUST come AFTER setView — setView resets bearing to 0 (north-up).
    //
    // leaflet-rotate@0.2.8 inverts the sign of what its README implies:
    // setBearing(b) actually applies CSS rotateZ(+b) (clockwise), not
    // rotateZ(-b). So passing the raw compass-bearing tee→green puts the
    // tee at the top instead of the green. To get course-up (green at
    // top of the screen, tee at the bottom), pass the NEGATED bearing.
    // Verified empirically with the debug overlay 2026-05-01: hole 1 at
    // Colts Neck (tee→green = 117° ESE) was rendering with tee top-right;
    // negating fixes it to green-top, tee-bottom.
    if (teePt && greenPt && typeof mapRef.current.setBearing === 'function') {
      mapRef.current.setBearing(-calcBearing(teePt, greenPt))
    }

    const L = window.L

    // Gold circle at tee
    if (holeMarkerRef.current) {
      holeMarkerRef.current.setLatLng([panPos.lat, panPos.lon])
    } else {
      holeMarkerRef.current = L.circleMarker([panPos.lat, panPos.lon], {
        radius: 9, color: '#fff', weight: 2.5,
        fillColor: '#C9A040', fillOpacity: 1,
      }).addTo(mapRef.current)
    }

    // Red flag icon on the green
    const flagPos = greenPositions[currentHole]
    if (flagPos) {
      const flagIcon = L.divIcon({
        className: '',
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28">
          <!-- flagpole -->
          <line x1="4" y1="2" x2="4" y2="27" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
          <!-- flag -->
          <polygon points="4,2 20,8 4,14" fill="#E53935" stroke="white" stroke-width="0.8"/>
          <!-- base dot -->
          <circle cx="4" cy="27" r="2.5" fill="#E53935" stroke="white" stroke-width="1.2"/>
        </svg>`,
        iconSize:   [22, 28],
        iconAnchor: [4, 27],  // anchor at base of pole
      })
      if (greenMarkerRef.current) {
        greenMarkerRef.current.setLatLng([flagPos.lat, flagPos.lon])
        greenMarkerRef.current.setIcon(flagIcon)
      } else {
        greenMarkerRef.current = L.marker([flagPos.lat, flagPos.lon], { icon: flagIcon })
          .addTo(mapRef.current)
      }
    } else if (greenMarkerRef.current) {
      greenMarkerRef.current.remove()
      greenMarkerRef.current = null
    }

    // Polyline + aim-point + yardage labels — playing-perspective view
    // (tee at bottom of screen, green at top). Three points: tee → aim →
    // green. Two yardage badges: tee-to-aim and aim-to-green. Aim point
    // defaults to the midpoint of tee→green; the user drags the target
    // marker to reposition it. (2026-05-01 — aim-point feature)
    if (teePt && greenPt) {
      // Effective aim position. If the user has dragged the target, use
      // their position. Otherwise use the par-aware smart default:
      //   - par 3  → on the green
      //   - par 4/5 → drive landing zone along the OSM fairway path
      //               (cap 250y, never closer than 100y to the green)
      const holeData      = courseCtx?.tee?.holes?.find(h => h.hole === currentHole)
      const officialTotal = holeData?.yardage
      const haversineTotal = Math.round(haversineYards(teePt, greenPt) || 0)
      const totalYards    = officialTotal ?? haversineTotal
      const defaultAim    = getDefaultAim({
        par: holeData?.par,
        totalYards,
        teePt,
        greenPt,
        geometry: holeGeometries[currentHole],
      })
      const aimLat = aimPoint?.lat ?? defaultAim?.lat ?? (teePt.lat + greenPt.lat) / 2
      const aimLon = aimPoint?.lon ?? defaultAim?.lon ?? (teePt.lon + greenPt.lon) / 2
      const aimLL  = { lat: aimLat, lon: aimLon }

      // Polyline tee → aim → green
      const linePts = [
        [teePt.lat, teePt.lon],
        [aimLat,    aimLon],
        [greenPt.lat, greenPt.lon],
      ]
      if (lineRef.current) {
        lineRef.current.setLatLngs(linePts)
      } else {
        lineRef.current = L.polyline(linePts, {
          color: '#fff', weight: 3, opacity: 0.9,
          dashArray: '8,6',
        }).addTo(mapRef.current)
      }

      // Reusable label HTML builder. The bigger pill goes on the
      // aim→green leg (it's the more important "what's left" number);
      // the smaller pill goes on the tee→aim leg. totalYards / official
      // yardage are already computed above for the smart default-aim
      // calculation; reuse them here so labels add up to the official total.
      const teeToAimRaw   = haversineYards(teePt, aimLL) || 0
      const aimToGreenRaw = haversineYards(aimLL, greenPt) || 0
      const measuredTotal = teeToAimRaw + aimToGreenRaw || 1
      const teeToAimYds   = Math.round((teeToAimRaw   / measuredTotal) * totalYards)
      const aimToGreenYds = Math.round((aimToGreenRaw / measuredTotal) * totalYards)
      // Refresh the live ref so the drag handler reads the current
      // hole's tee/green/total instead of whatever the closure froze.
      livePosRef.current = { teePt, greenPt, totalYards }

      function makeLabelIcon(yds, isPrimary) {
        const html = `<div style="
          background: ${isPrimary ? 'rgba(7,12,9,0.95)' : 'rgba(7,12,9,0.85)'};
          color: #fff;
          font-weight: 800;
          font-size: ${isPrimary ? 14 : 12}px;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          padding: ${isPrimary ? '5px 12px' : '3px 9px'};
          border-radius: 999px;
          border: 1px solid rgba(245,215,138,${isPrimary ? 0.65 : 0.45});
          box-shadow: 0 2px 8px rgba(0,0,0,0.55);
          white-space: nowrap;
          line-height: 1.1;
        ">${yds}<span style='color: rgba(255,255,255,0.5); font-weight: 600; font-size: ${isPrimary ? 10 : 9}px; margin-left: 3px;'>YDS</span></div>`
        return L.divIcon({
          className: '',
          html,
          iconSize:   [isPrimary ? 64 : 56, isPrimary ? 24 : 20],
          iconAnchor: [isPrimary ? 32 : 28, isPrimary ? 12 : 10],
        })
      }

      // Tee → aim label at midpoint of that segment
      const teeAimMidLat = (teePt.lat + aimLat) / 2
      const teeAimMidLon = (teePt.lon + aimLon) / 2
      const teeAimIcon = makeLabelIcon(teeToAimYds, false)
      if (distLabelRef.current) {
        distLabelRef.current.setLatLng([teeAimMidLat, teeAimMidLon])
        distLabelRef.current.setIcon(teeAimIcon)
      } else {
        distLabelRef.current = L.marker([teeAimMidLat, teeAimMidLon], {
          icon: teeAimIcon, interactive: false, keyboard: false,
        }).addTo(mapRef.current)
      }

      // Aim → green label at midpoint of that segment (primary, bigger)
      const aimGreenMidLat = (aimLat + greenPt.lat) / 2
      const aimGreenMidLon = (aimLon + greenPt.lon) / 2
      const aimGreenIcon = makeLabelIcon(aimToGreenYds, true)
      if (aimToGreenLabelRef.current) {
        aimToGreenLabelRef.current.setLatLng([aimGreenMidLat, aimGreenMidLon])
        aimToGreenLabelRef.current.setIcon(aimGreenIcon)
      } else {
        aimToGreenLabelRef.current = L.marker([aimGreenMidLat, aimGreenMidLon], {
          icon: aimGreenIcon, interactive: false, keyboard: false,
        }).addTo(mapRef.current)
      }

      // Aim-point target marker — draggable. Larger touch target than
      // a typical Leaflet circleMarker so it's reliably grabbable on
      // mobile. Live drag updates the line + labels via the drag
      // handler below; dragend commits to React state.
      const targetIcon = L.divIcon({
        className: '',
        html: `<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5))">
          <circle cx="20" cy="20" r="18" fill="rgba(255,255,255,0.10)" stroke="#fff" stroke-width="2" stroke-dasharray="3,3"/>
          <circle cx="20" cy="20" r="7"  fill="#C9A040" stroke="#fff" stroke-width="2"/>
          <circle cx="20" cy="20" r="2.5" fill="#fff"/>
        </svg>`,
        iconSize:   [40, 40],
        iconAnchor: [20, 20],
      })
      if (aimMarkerRef.current) {
        aimMarkerRef.current.setLatLng([aimLat, aimLon])
        aimMarkerRef.current.setIcon(targetIcon)
      } else {
        aimMarkerRef.current = L.marker([aimLat, aimLon], {
          icon: targetIcon,
          draggable: true,
          autoPan: false,        // don't pan the map while dragging — keeps the line steady
        }).addTo(mapRef.current)
        // Live update during drag — recompute labels + polyline directly
        // on Leaflet objects for smoothness; commit to React state on
        // dragend so the next render is consistent. Reads tee/green/
        // totalYards from livePosRef so a drag on hole 2+ uses the
        // current hole's positions, not the hole-1 closure.
        aimMarkerRef.current.on('drag', e => {
          const ll = e.target.getLatLng()
          const { teePt: t, greenPt: g, totalYards: total } = livePosRef.current
          if (!t || !g) return
          const liveAim  = { lat: ll.lat, lon: ll.lng }
          const t2aRaw   = haversineYards(t, liveAim) || 0
          const a2gRaw   = haversineYards(liveAim, g) || 0
          const tot      = (t2aRaw + a2gRaw) || 1
          const t2a      = Math.round((t2aRaw / tot) * total)
          const a2g      = Math.round((a2gRaw / tot) * total)
          // polyline
          if (lineRef.current) {
            lineRef.current.setLatLngs([
              [t.lat, t.lon],
              [ll.lat, ll.lng],
              [g.lat, g.lon],
            ])
          }
          // label positions + content
          if (distLabelRef.current) {
            distLabelRef.current.setLatLng([(t.lat + ll.lat)/2, (t.lon + ll.lng)/2])
            distLabelRef.current.setIcon(makeLabelIcon(t2a, false))
          }
          if (aimToGreenLabelRef.current) {
            aimToGreenLabelRef.current.setLatLng([(ll.lat + g.lat)/2, (ll.lng + g.lon)/2])
            aimToGreenLabelRef.current.setIcon(makeLabelIcon(a2g, true))
          }
        })
        aimMarkerRef.current.on('dragend', e => {
          const ll = e.target.getLatLng()
          setAimPoint({ lat: ll.lat, lon: ll.lng })
        })
      }
    } else {
      // No tee or no green — drop everything aim-related
      if (lineRef.current)            { lineRef.current.remove();            lineRef.current = null }
      if (distLabelRef.current)       { distLabelRef.current.remove();       distLabelRef.current = null }
      if (aimToGreenLabelRef.current) { aimToGreenLabelRef.current.remove(); aimToGreenLabelRef.current = null }
      if (aimMarkerRef.current)       { aimMarkerRef.current.remove();       aimMarkerRef.current = null }
    }
  }, [currentHole, holePositions, greenPositions, holeGeometries, mapReady, aimPoint])

  // Smooth player puck + true-ground accuracy halo (Phase 2.5).
  // The dot rAF-glides from its current on-screen position to each new GPS
  // fix (~700ms easeOut) instead of teleporting, and a translucent halo whose
  // radius is coords.accuracy in METRES — a real geographic circle, not a
  // fixed pixel ring — makes the GPS uncertainty honestly visible (ties into
  // the Phase 1.1 accuracy gate). Reduced-motion snaps instead of gliding.
  useEffect(() => {
    if (!mapRef.current || !gps || !geocoded) return
    const L = window.L
    if (!L) return
    // Only show/update the puck if the user is actually on the course
    const dist = haversineYards(gps, { lat: geocoded.lat, lon: geocoded.lon })
    if (dist == null || dist > 8800) return // > ~5 miles away — don't show
    const target = { lat: gps.lat, lon: gps.lon }
    const accM = typeof gps.acc === 'number' && gps.acc > 0 ? gps.acc : null

    // Lazily create the puck (white-ringed gold dot) on first fix.
    if (!markerRef.current) {
      markerRef.current = L.circleMarker([target.lat, target.lon], {
        radius: 9, color: '#fff', weight: 3,
        fillColor: '#F5D78A', fillOpacity: 0.95,
      }).addTo(mapRef.current)
      puckPosRef.current = target
    }
    // Halo: create or resize to the live accuracy (metres).
    if (accM != null) {
      if (!accHaloRef.current) {
        accHaloRef.current = L.circle([target.lat, target.lon], {
          radius: accM, color: '#F5D78A', weight: 1, opacity: 0.30,
          fillColor: '#F5D78A', fillOpacity: 0.08,
        }).addTo(mapRef.current)
      } else {
        accHaloRef.current.setRadius(accM)
      }
    }

    const from = puckPosRef.current || target
    const reduce = typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const snap = () => {
      try {
        markerRef.current?.setLatLng([target.lat, target.lon])
        accHaloRef.current?.setLatLng([target.lat, target.lon])
      } catch { /* map gone */ }
      puckPosRef.current = target
    }
    if (reduce || (from.lat === target.lat && from.lon === target.lon)) { snap(); return }

    const start = performance.now(), DUR = 700
    cancelAnimationFrame(puckRafRef.current)
    const tick = (now) => {
      const t = Math.min(1, (now - start) / DUR)
      const e = 1 - Math.pow(1 - t, 3)            // easeOutCubic
      const lat = from.lat + (target.lat - from.lat) * e
      const lon = from.lon + (target.lon - from.lon) * e
      puckPosRef.current = { lat, lon }
      try {
        markerRef.current?.setLatLng([lat, lon])
        accHaloRef.current?.setLatLng([lat, lon])
      } catch { /* map gone */ }
      if (t < 1) puckRafRef.current = requestAnimationFrame(tick)
    }
    puckRafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(puckRafRef.current)
  }, [gps?.lat, gps?.lon, gps?.acc, geocoded])

  if (mapErr) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
        {mapErr}
      </div>
    )
  }

  if (!geocoded && !gps) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
        Loading map…
      </div>
    )
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Hole badge removed 2026-05-01 — the GPS yardage card in the
          top-left of the HUD overlay now carries the same info (PAR
          pill + TEE-yardage pill) plus live GPS distance, so the
          standalone HOLE/yardage·Par badge was repetitive. Hole
          number itself is shown in the chip-strip below the header. */}
      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12, zIndex: 1000,
        background: 'rgba(7,12,9,0.8)', borderRadius: 8, padding: '6px 10px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#F5D78A', boxShadow: '0 0 6px #F5D78A' }} />
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>Your position</span>
      </div>
    </div>
  )
}

// ─── Hole-map renderer switch (Phase 2.1) ────────────────────────────────────
// Renders the MapLibre <HoleMapGL> when ENABLE_MAPLIBRE is on, falling back to
// the proven Leaflet <HoleMap> if MapLibre throws at render (error boundary) or
// fails to load/init at runtime (onInitError). Two independent safety nets, so
// the beta can never hard-break on the new renderer while Matt device-tests it.
class GLBoundary extends Component {
  constructor(props) { super(props); this.state = { err: false } }
  static getDerivedStateFromError() { return { err: true } }
  componentDidCatch(e) { console.error('[HoleMapGL boundary]', e?.message || e) }
  render() { return this.state.err ? this.props.fallback : this.props.children }
}

function HoleMapSwitch(props) {
  const [glFailed, setGlFailed] = useState(false)
  if (!ENABLE_MAPLIBRE || glFailed) return <HoleMap {...props} />
  const leaflet = <HoleMap {...props} />
  return (
    <GLBoundary fallback={leaflet}>
      <HoleMapGL {...props} onInitError={() => setGlFailed(true)} />
    </GLBoundary>
  )
}

// ─── Camera modal (overlays the distance view) ────────────────────────────────
function CameraModal({ gps, weather, holeData, currentHole, courseCtx, greenPos, onClose, onResult }) {
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const streamRef  = useRef(null)
  const [facingBack, setFacingBack] = useState(true)
  const [scanning, setScanning]     = useState(false)
  const [error, setError]           = useState(null)
  const [compass, setCompass]       = useState(null)  // current device heading (degrees)

  // Target bearing: from the user's GPS position to the green
  const targetBearing = calcBearing(gps, greenPos)

  // Arrow rotation = how far to turn the phone to face the green
  const arrowRotation = (targetBearing != null && compass != null)
    ? ((targetBearing - compass + 360) % 360)
    : null
  const isAligned = arrowRotation != null && (arrowRotation < 22 || arrowRotation > 338)

  // Request compass / device orientation
  useEffect(() => {
    const handler = e => {
      // iOS: webkitCompassHeading is magnetic north (0-360)
      // Android: alpha is 0-360 but counts opposite; 360-alpha gives compass heading
      const heading = e.webkitCompassHeading ?? (e.alpha != null ? (360 - e.alpha) % 360 : null)
      if (heading != null) setCompass(heading)
    }
    const setup = async () => {
      if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
        try {
          const perm = await DeviceOrientationEvent.requestPermission()
          if (perm === 'granted') window.addEventListener('deviceorientation', handler, true)
        } catch {}
      } else {
        window.addEventListener('deviceorientation', handler, true)
      }
    }
    setup()
    return () => window.removeEventListener('deviceorientation', handler, true)
  }, [])

  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingBack ? 'environment' : 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (e) { setError('Camera unavailable: ' + e.message) }
  }, [facingBack])

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  useEffect(() => { openCamera(); return closeCamera }, [openCamera])

  const flip = () => { closeCamera(); setFacingBack(b => !b) }

  const capture = async () => {
    if (!canvasRef.current || !videoRef.current) return
    setScanning(true)
    setError(null)
    const canvas = canvasRef.current
    const video  = videoRef.current
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
    try {
      const res = await post('/api/eagle-eye/analyze', {
        image: base64,
        gps,
        weather,
        holeYardage: holeData?.yardage ?? null,
        holePar: holeData?.par ?? null,
        holeNumber: currentHole,
        courseName: courseCtx?.course?.club_name ?? null,
      })
      closeCamera()
      onResult(res)
    } catch (e) {
      setScanning(false)
      setError('Analysis failed: ' + e.message)
    }
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {/* Viewfinder */}
      <video ref={videoRef} autoPlay playsInline muted
        style={{ flex: 1, width: '100%', objectFit: 'cover' }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* ── Green direction compass ── */}
      {targetBearing != null && !scanning && (
        <div style={{
          position: 'absolute', bottom: 140, left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          pointerEvents: 'none',
        }}>
          {/* Rotating arrow ring */}
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: isAligned ? 'rgba(42,122,56,0.85)' : 'rgba(7,12,9,0.75)',
            border: `2px solid ${isAligned ? '#5ED47A' : 'rgba(255,255,255,0.25)'}`,
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.3s, border-color 0.3s',
          }}>
            <div style={{
              transform: `rotate(${arrowRotation ?? 0}deg)`,
              transition: arrowRotation != null ? 'transform 0.1s linear' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, lineHeight: 1,
              color: isAligned ? '#5ED47A' : '#F5D78A',
            }}>↑</div>
          </div>
          {/* Label */}
          <div style={{
            background: 'rgba(7,12,9,0.75)', backdropFilter: 'blur(8px)',
            borderRadius: 20, padding: '4px 12px',
            border: `1px solid ${isAligned ? 'rgba(94,212,122,0.4)' : 'rgba(255,255,255,0.15)'}`,
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: isAligned ? '#5ED47A' : 'rgba(255,255,255,0.7)', letterSpacing: '0.06em' }}>
              {isAligned
                ? '✓ FACING GREEN'
                : compass != null
                  ? `TURN ${arrowRotation < 180 ? 'RIGHT' : 'LEFT'} · ${bearingLabel(targetBearing)}`
                  : `GREEN · ${bearingLabel(targetBearing)}`}
            </span>
          </div>
        </div>
      )}

      {/* Crosshair */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ width: 180, height: 180, position: 'relative', opacity: scanning ? 0.3 : 0.7, transition: 'opacity 300ms' }}>
          {[['tl','top','left'], ['tr','top','right'], ['bl','bottom','left'], ['br','bottom','right']].map(([k, v, h]) => (
            <div key={k} style={{ position: 'absolute', [v]: 0, [h]: 0, width: 24, height: 24,
              borderTop:    v === 'top'    ? '2px solid #F5D78A' : 'none',
              borderBottom: v === 'bottom' ? '2px solid #F5D78A' : 'none',
              borderLeft:   h === 'left'   ? '2px solid #F5D78A' : 'none',
              borderRight:  h === 'right'  ? '2px solid #F5D78A' : 'none',
            }} />
          ))}
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 5, height: 5, borderRadius: '50%', background: '#F5D78A', boxShadow: '0 0 8px #F5D78A' }} />
        </div>
      </div>

      {/* Top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: '16px', padding: '12px 16px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => { closeCamera(); onClose() }} style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 999, width: 40, height: 40, color: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#F5D78A', fontWeight: 800, fontSize: 13, letterSpacing: '0.12em' }}>EAGLE EYE</div>
          {holeData && <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>H{currentHole} · {holeData.yardage}y · Par {holeData.par}</div>}
        </div>
        <button onClick={flip} style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 999, width: 40, height: 40, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⇄</button>
      </div>

      {/* Scanning overlay */}
      {scanning && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none" style={{ animation: 'ee-scan 0.9s ease-in-out infinite' }}>
            <circle cx="36" cy="36" r="32" stroke="#C9A040" strokeWidth="1" strokeOpacity="0.4"/>
            <circle cx="36" cy="36" r="20" stroke="#E8C05A" strokeWidth="1.5" strokeOpacity="0.8"/>
            <circle cx="36" cy="36" r="3" fill="#F5D78A"/>
            <line x1="36" y1="4" x2="36" y2="14" stroke="#C9A040" strokeWidth="1.5" strokeOpacity="0.8" strokeLinecap="round"/>
            <line x1="36" y1="58" x2="36" y2="68" stroke="#C9A040" strokeWidth="1.5" strokeOpacity="0.8" strokeLinecap="round"/>
            <line x1="4" y1="36" x2="14" y2="36" stroke="#C9A040" strokeWidth="1.5" strokeOpacity="0.8" strokeLinecap="round"/>
            <line x1="58" y1="36" x2="68" y2="36" stroke="#C9A040" strokeWidth="1.5" strokeOpacity="0.8" strokeLinecap="round"/>
          </svg>
          <div style={{ color: '#F5D78A', fontWeight: 800, fontSize: 18, letterSpacing: '0.04em' }}>Analyzing</div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, letterSpacing: '0.06em' }}>GPS · WEATHER · VISION{courseCtx ? ' · COURSE' : ''}</div>
        </div>
      )}

      {/* Error */}
      {error && !scanning && (
        <div style={{ position: 'absolute', bottom: 120, left: 16, right: 16, background: 'rgba(224,82,82,0.9)', borderRadius: 12, padding: '14px 16px', color: '#fff', textAlign: 'center' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Analysis failed</div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>{error}</div>
        </div>
      )}

      {/* Capture button */}
      {!scanning && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: '28px', display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={capture}
            style={{
              width: 76, height: 76, borderRadius: '50%',
              background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
              border: '4px solid rgba(255,255,255,0.35)',
              boxShadow: '0 0 28px rgba(201,160,64,0.7)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="rgba(7,12,9,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="5"/>
              <circle cx="12" cy="12" r="1.5" fill="rgba(7,12,9,0.8)"/>
              <line x1="12" y1="2" x2="12" y2="5"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="2" y1="12" x2="5" y2="12"/>
              <line x1="19" y1="12" x2="22" y2="12"/>
            </svg>
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}

// ─── Result Sheet ─────────────────────────────────────────────────────────────
function ResultSheet({ result: r, holeData, onClose }) {
  const adj = n => n > 0 ? `+${n}` : `${n}`
  const hasReal = holeData?.yardage != null

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }} />
      <div style={{
        background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0',
        border: '1px solid var(--tm-border-2)',
        padding: '20px 20px', paddingBottom: 'max(24px, calc(var(--nav-height) + 12px))',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.8)',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--tm-border-3)', margin: '0 auto 20px' }} />

        {/* Hero distance */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ color: 'var(--tm-text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Plays Like {hasReal ? `(from ${holeData.yardage}y tee)` : '(visual estimate)'}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 68, fontWeight: 800, letterSpacing: '-3px', lineHeight: 1, color: 'var(--tm-gold-bright)' }}>{r.playsLikeYards}</span>
            <span style={{ color: 'var(--tm-text-3)', fontSize: 20 }}>yds</span>
          </div>
          <div style={{ color: 'var(--tm-text-3)', fontSize: 13, marginTop: 4 }}>
            {hasReal ? `Course: ${holeData.yardage}y` : `Est: ${r.gpsYards}y`}
            {r.adjustments.totalAdjust !== 0 && ` · Adj: ${adj(r.adjustments.totalAdjust)}y`}
          </div>
        </div>

        {/* Club recommendation */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div style={{ background: 'rgba(42,122,56,0.2)', border: '1px solid rgba(42,122,56,0.4)', borderRadius: 12, padding: '12px', textAlign: 'center' }}>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Club</div>
            <div style={{ color: '#C9A040', fontWeight: 800, fontSize: 22 }}>{r.recommendedClub}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--tm-border-2)', borderRadius: 12, padding: '12px', textAlign: 'center' }}>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Alternate</div>
            <div style={{ color: 'var(--tm-text-2)', fontWeight: 800, fontSize: 22 }}>{r.alternateClub}</div>
          </div>
        </div>

        {/* Adjustments */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--tm-border-2)', borderRadius: 12, padding: '10px 14px', marginBottom: 14 }}>
          {[
            ['↗ Slope', r.adjustments.slopeYards],
            ['~ Wind',  r.adjustments.windYards],
            ['° Temp',  r.adjustments.tempYards],
            ['▲ Alt',   r.adjustments.altitudeYards],
          ].filter(([,v]) => v !== 0).map(([label, val]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{label}</span>
              <span style={{ color: val > 0 ? '#F87171' : '#C9A040', fontWeight: 700, fontSize: 13 }}>{adj(val)}y</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6 }}>
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 600 }}>Shot shape</span>
            <span style={{ color: '#F5D78A', fontSize: 13, fontWeight: 700 }}>{r.shotShape}</span>
          </div>
        </div>

        {/* Caddie note */}
        {r.caddieNote && (
          <div style={{ background: 'rgba(42,122,56,0.12)', border: '1px solid rgba(42,122,56,0.25)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ color: '#C9A040', fontSize: 10, fontWeight: 700, marginBottom: 4, letterSpacing: '0.1em' }}>CADDIE NOTE</div>
            <div style={{ color: 'var(--tm-text)', fontSize: 14, lineHeight: 1.55 }}>{r.caddieNote}</div>
          </div>
        )}

        <button onClick={onClose} style={{
          width: '100%', padding: '14px', borderRadius: 14,
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.7)', fontWeight: 700, fontSize: 15, cursor: 'pointer',
        }}>Done</button>
      </div>
    </div>,
    document.body
  )
}

// ─── Course Picker ────────────────────────────────────────────────────────────
function CoursePicker({ onSelect, onClose, gps }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [course, setCourse]   = useState(null)
  const [teeIdx, setTeeIdx]   = useState(0)
  const rawResults             = useRef([]) // unsorted cache so we can re-sort when gps arrives
  const gpsRef                 = useRef(gps)

  // Keep gpsRef current so async callbacks always see the latest value
  useEffect(() => { gpsRef.current = gps }, [gps])

  function distMiles(c, loc) {
    const g = loc ?? gpsRef.current
    if (!g || c.latitude == null || c.longitude == null) return Infinity
    const R = 3958.8
    const dLat = (c.latitude - g.lat) * Math.PI / 180
    const dLon = (c.longitude - g.lon) * Math.PI / 180
    const a = Math.sin(dLat/2)**2 + Math.cos(g.lat * Math.PI/180) * Math.cos(c.latitude * Math.PI/180) * Math.sin(dLon/2)**2
    return R * 2 * Math.asin(Math.sqrt(a))
  }

  function sortAndSet(courses) {
    const sorted = [...courses].sort((a, b) => distMiles(a) - distMiles(b))
    setResults(sorted)
  }

  // Re-sort existing results whenever GPS locks in or updates
  useEffect(() => {
    if (rawResults.current.length > 0) sortAndSet(rawResults.current)
  }, [gps])

  // Live search — fires 350ms after the user stops typing, min 2 chars
  useEffect(() => {
    if (selected) return
    const q = query.trim()
    if (q.length < 2) { rawResults.current = []; setResults([]); return }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const d = await api(`/api/courses/search?q=${encodeURIComponent(q)}`)
        rawResults.current = d.courses || []
        sortAndSet(rawResults.current)
      } catch {} finally { setLoading(false) }
    }, 350)
    return () => clearTimeout(timer)
  }, [query])

  async function pickCourse(c) {
    setSelected(c)
    setLoading(true)
    try {
      const d = await api(`/api/courses/${c.id}`)
      setCourse(d)
    } catch {} finally { setLoading(false) }
  }

  // Dedupe tees by tee_name + total_yards. The API returns separate male/female
  // arrays, but most tee boxes (Blue, White, Red, etc.) are physically the same
  // box — same name + same total yardage = same physical tees, same per-hole
  // yardages. Showing both as chips made every multi-tee course display dupes.
  // We keep the first occurrence (male if present, otherwise female), and
  // suffix " (W)" on female-only tees to disambiguate when a course has a
  // genuinely separate forward tee. Hole-position logic (cache keys, GPS
  // matching, OSM lookups) is unchanged because tee_name and holes shape
  // are identical across the male/female sources.
  const tees = course ? dedupeTees(course.tees) : []
  const activeTee = tees[teeIdx]

  return createPortal(
    /* Outer backdrop container: full-viewport on every device, centers + clamps
       the actual modal panel to mobile width on desktop. The existing modal
       structure below this is unchanged — same #07100C background, same
       padding, same content. Audit finding R2 / 2026-04-29. */
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', justifyContent: 'center',
    }}>
    <div style={{ width: '100%', maxWidth: 430, height: '100%', background: '#07100C', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'max(16px, env(safe-area-inset-top)) 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 22, cursor: 'pointer' }}>←</button>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Select Course</div>
        </div>
        <div style={{ position: 'relative', marginTop: 12 }}>
          <input
            autoFocus value={query}
            onChange={e => { setSelected(null); setCourse(null); setQuery(e.target.value) }}
            placeholder="Search course name…"
            style={{ width: '100%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 40px 10px 14px', color: '#fff', fontSize: 15, outline: 'none' }}
          />
          {loading && (
            <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(245,215,138,0.3)', borderTopColor: '#F5D78A', animation: 'ee-spin-slow 0.7s linear infinite' }} />
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
        {!selected && results.map(c => {
          const miles = distMiles(c)
          const distLabel = miles < Infinity ? (miles < 0.1 ? 'Here' : miles < 1 ? `${Math.round(miles * 10) / 10} mi` : `${Math.round(miles)} mi`) : null
          return (
            <div key={c.id} onClick={() => pickCourse(c)} style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>{c.club_name}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{[c.city, c.state, c.country].filter(Boolean).join(', ')}</div>
              </div>
              {distLabel && (
                <div style={{ fontSize: 11, fontWeight: 700, color: miles < 5 ? '#5ED47A' : 'rgba(255,255,255,0.3)', flexShrink: 0, marginLeft: 12 }}>{distLabel}</div>
              )}
            </div>
          )
        })}

        {course && activeTee && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(232,192,90,0.8)', marginBottom: 10 }}>{course.club_name}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {tees.map((t, i) => (
                <button key={i} onClick={() => setTeeIdx(i)} style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: i === teeIdx ? 'rgba(232,192,90,0.2)' : 'rgba(255,255,255,0.07)',
                  border: `1px solid ${i === teeIdx ? 'rgba(232,192,90,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  color: i === teeIdx ? '#F5D78A' : 'rgba(255,255,255,0.6)',
                }}>{t.tee_name} ({t.total_yards}y)</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              {activeTee.holes.map(h => (
                <div key={h.hole} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>HOLE {h.hole} · PAR {h.par}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 2 }}>{h.yardage}<span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginLeft: 3 }}>yds</span></div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Hdcp {h.handicap}</div>
                </div>
              ))}
            </div>
            <button onClick={() => onSelect({ course, tee: activeTee })} style={{
              width: '100%', padding: '16px', borderRadius: 14, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
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

// ─── Main EagleEye ────────────────────────────────────────────────────────────
export default function EagleEye({ user, onGoToScorecard, eyeHoleNudge = null, onConsumeEyeHoleNudge, sharedCourse = null, onCourseSelected } = {}) {
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
    onConsumeEyeHoleNudge?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eyeHoleNudge])
  const [showPicker, setShowPicker] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [result, setResult]         = useState(null)
  const [viewMode, setViewMode]     = useState('distance') // 'distance' | 'map'

  // ─── Bag picker (2026-05-01) ───
  // Pulls the user's bag once on mount. When a club is picked, HoleMap
  // draws an expected-landing-zone ring at the player's GPS position
  // with radius = club.avg_yards.
  const [myBag, setMyBag]           = useState([])
  const [bagOpen, setBagOpen]       = useState(false)
  const [selectedClub, setSelectedClub] = useState(null)
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
  // Full geometry of each golf=hole way: array of {lat, lon} tracing the
  // playing line from tee through the fairway to the green. Used for
  // dogleg-aware aim-point default placement (par 4/5 layup along the
  // fairway centerline). Empty {} if OSM had no way data for the hole.
  // (2026-05-01)
  const [holeGeometries, setHoleGeometries] = useState({})
  const [osmLoading, setOsmLoading]         = useState(false)

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

  // Preload Leaflet + rotate plugin the moment EagleEye mounts so both scripts
  // are cached and ready before the user ever opens the satellite map view.
  useEffect(() => {
    const preloadRotate = () => {
      if (window.__leafletRotateReady || document.getElementById('leaflet-rotate-js')) return
      const s = document.createElement('script')
      s.id  = 'leaflet-rotate-js'
      s.src = 'https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js'
      s.onload = () => { window.__leafletRotateReady = true }
      document.head.appendChild(s)
    }
    if (window.L) { preloadRotate(); return }
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'; link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script')
      script.id  = 'leaflet-js'
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
      script.onload = preloadRotate  // chain: Leaflet ready → load rotate plugin
      document.head.appendChild(script)
    }
  }, [])

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
    const cacheKey = `v3-${courseCtx.course.id}-${courseCtx.tee.tee_name}`

    // 1️⃣ In-memory cache (survives re-renders within a page session)
    if (osmPositionCache.has(cacheKey)) {
      const cached = osmPositionCache.get(cacheKey)
      setCourseGeocoded(cached.geocoded)
      setHolePositions(cached.tees)
      setGreenPositions(cached.greens)
      setHoleGeometries(cached.geoms || {})
      setGreenPolys(cached.polys || {})
      setOsmLoading(false)
      return
    }
    // 2️⃣ localStorage cache (survives page reloads — 7-day TTL)
    const stored = lsLoadOsm(cacheKey)
    if (stored) {
      osmPositionCache.set(cacheKey, stored) // also warm in-memory cache
      setCourseGeocoded(stored.geocoded)
      setHolePositions(stored.tees)
      setGreenPositions(stored.greens)
      setHoleGeometries(stored.geoms || {})
      setGreenPolys(stored.polys || {})
      setOsmLoading(false)
      return
    }

    const q = [club_name, city, state].filter(Boolean).join(', ')

    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`)
      .then(r => r.json())
      .then(data => {
        if (!data[0]) { setOsmLoading(false); return }
        // Store bounding box for fitBounds in map
        const bb = data[0].boundingbox // [minlat, maxlat, minlon, maxlon]
        const gc = {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          bbox: bb ? {
            south: parseFloat(bb[0]), north: parseFloat(bb[1]),
            west:  parseFloat(bb[2]), east:  parseFloat(bb[3]),
          } : null,
        }
        setCourseGeocoded(gc)

        // Use tight Nominatim bbox for Overpass (avoids picking up neighboring courses)
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
        ]).then(([osmHoles, osmNodes, osmGreenGeom]) => {
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
            setHolePositions(holeTees)
            setGreenPositions(holeGreens)
            setHoleGeometries(holeGeoms)
            setGreenPolys(holePolys)
            const cachePayload = { geocoded: gc, tees: holeTees, greens: holeGreens, geoms: holeGeoms, polys: holePolys }
            osmPositionCache.set(cacheKey, cachePayload)
            lsSaveOsm(cacheKey, cachePayload) // persist across page reloads
          })
      })
      .catch(err => { console.error('[OSM] fetch error:', err) })
      .finally(() => setOsmLoading(false))
  }, [courseCtx?.course?.id, courseCtx?.tee?.tee_name])

  const fetchWeather = useCallback(async ({ lat, lon }) => {
    try {
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m,surface_pressure&wind_speed_unit=mph&temperature_unit=fahrenheit`
      )
      const d = await r.json()
      setWeather(d.current)
    } catch {}
  }, [])

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
  const trustedGps  = gpsTrusted ? gps : null

  const greenCoord = greenPositions[currentHole]
  const gpsToGreen = (greenCoord && trustedGps) ? haversineYards(trustedGps, greenCoord) : null

  // Fallback: distance walked from tee subtracted from DB yardage — only when
  // the current fix is trusted (a loose fix would invent a bogus "remaining").
  const distanceWalked = gpsTrusted ? (haversineYards(teeGps, gps) ?? 0) : 0
  const remainingYards = (holeData && gpsTrusted)
    ? Math.max(0, (holeData.yardage ?? 0) - distanceWalked)
    : null

  function changeHole(delta) {
    const next = Math.min(totalHoles, Math.max(1, currentHole + delta))
    setCurrentHole(next)
    setTeeGps(gps)  // Reset tee position when changing hole
    setResult(null)
  }

  function handleCourseSelect(ctx) {
    setCourseCtx(ctx)
    setCurrentHole(1)
    setTeeGps(gps)
    setShowPicker(false)
    setResult(null)
    // Push the pick up to App.jsx's sharedCourse so the Match tab and
    // future Eye sessions stay in sync. (2026-05-01)
    onCourseSelected?.(ctx)
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
    setResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedCourse])

  const wind = weather
    ? { speed: Math.round(weather.wind_speed_10m), dir: Math.round(weather.wind_direction_10m) }
    : null
  const temp = weather ? Math.round(weather.temperature_2m) : null

  const displayYards = gpsToGreen ?? (gpsTrusted && distanceWalked > 10 && remainingYards != null
    ? remainingYards
    : (holeData?.yardage ?? null))

  // Hero-instrument label + accent (Phase 2.3). Green when the number is a
  // trusted live GPS-to-green read; amber while acquiring; muted for the
  // static tee/remaining fallback.
  const distLabel = gpsToGreen != null ? 'TO GREEN'
    : gpsAcquiring ? 'ACQUIRING'
    : (gpsTrusted && distanceWalked > 10 && remainingYards != null) ? 'REMAINING'
    : 'FROM TEE'
  const distAccent = gpsToGreen != null ? '#5ED47A' : gpsAcquiring ? '#F0A868' : '#C9A040'

  // "Plays like" on the live distance — only when we have a real GPS-to-green
  // reading + weather (so the wind/temp/altitude model has real inputs). Uses
  // the player→green bearing for the wind component. (2026-06-06)
  const altFt = gps?.alt != null
    ? Math.round(gps.alt * 3.281)
    : estimateAltFromPressure(weather?.surface_pressure)
  const shotBearing = (trustedGps && greenCoord) ? calcBearing({ lat: trustedGps.lat, lon: trustedGps.lon }, greenCoord) : null
  const playsLike = (gpsToGreen != null && weather)
    ? computePlaysLike(gpsToGreen, {
        windSpeed: wind?.speed ?? 0,
        windFromDeg: wind?.dir ?? null,
        shotBearing,
        tempF: temp,
        altFt,
      })
    : null

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
  const fcb = (ENABLE_FCB && greenPolygon && fcbPlayer && greenCoord) ? greenFCB(fcbPlayer, greenPolygon, greenCoord) : null

  const teeHoles = courseCtx?.tee?.holes ?? []

  return (
    // data-no-pull-refresh: Eagle Eye is a full-screen map tool — the view
    // never scrolls, so the app's pull-to-refresh (TabPanel) was firing on
    // every downward map-pan and reloading the page (dropping GPS + re-
    // fetching OSM). Opt the whole screen out of the gesture. (2026-06-24)
    <div data-no-pull-refresh="true" style={{ height: 'calc(100dvh - var(--nav-height))', background: '#070C09', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <CoachMark
        id="eagle_eye"
        user={user}
        title="Eagle Eye is your caddie"
        body='Top card shows live GPS distance to the green once you reach the course. Tap "Analyze Shot" to use the AI rangefinder — point your camera at the flag and it returns the exact carry yardage (factoring wind/elevation). The BAG button on the right lets you toggle clubs to see expected landing zones on the map.'
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
            box-shadow: 0 0 0 0 rgba(245,224,112,0.55), 0 0 16px rgba(245,224,112,0.55);
            transform: scale(0.95);
          }
          50% {
            box-shadow: 0 0 0 14px rgba(245,224,112,0), 0 0 28px rgba(245,224,112,0.85);
            transform: scale(1.08);
          }
        }
        .lz-marker {
          width: 36px; height: 36px;
          border-radius: 50%;
          background: radial-gradient(circle, #F5E070 0%, #E8C05A 60%, rgba(232,192,90,0.55) 100%);
          border: 2px solid #F5E070;
          animation: lz-pulse 1.5s ease-in-out infinite;
          pointer-events: none;
        }
        /* Leaflet container default background is light gray (#ddd) —
           any gap between tiles shows the container through. Match
           the page so worst-case gaps blend in. (2026-05-01) */
        .leaflet-container {
          background: #070C09 !important;
        }
        /* Move the +/- zoom control off the top-left where it gets
           covered by the hole-1 distance badge / hole-strip; park it
           on the middle-left edge instead. (2026-05-01 — Matt) */
        .leaflet-top.leaflet-left {
          top: 50% !important;
          transform: translateY(-50%);
        }
        /* Glass map controls (Phase 2.4) — replace Leaflet's default white
           squares + grey attribution with the dark-glass HUD language so the
           map reads as a premium instrument, not a stock embed. */
        .leaflet-control-zoom {
          border: none !important;
          border-radius: 14px !important;
          overflow: hidden;
          box-shadow: 0 6px 18px rgba(0,0,0,0.45) !important;
        }
        .leaflet-control-zoom a {
          background: rgba(7,12,9,0.66) !important;
          -webkit-backdrop-filter: blur(14px) saturate(150%);
          backdrop-filter: blur(14px) saturate(150%);
          color: #F5D78A !important;
          border-color: rgba(245,215,138,0.22) !important;
          width: 34px !important; height: 34px !important; line-height: 32px !important;
          font-size: 18px !important; font-weight: 700;
        }
        .leaflet-control-zoom a:hover { background: rgba(22,30,24,0.92) !important; }
        .leaflet-control-attribution {
          background: rgba(7,12,9,0.50) !important;
          -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
          color: rgba(255,255,255,0.45) !important;
          font-size: 9px !important; padding: 2px 6px !important;
          border-radius: 8px 0 0 0;
        }
        .leaflet-control-attribution a { color: rgba(245,215,138,0.65) !important; }
        /* Force GPU compositing on the tile pane + slightly oversize
           each tile so adjacent tiles physically overlap by ~1 pixel
           after the rotate plugin's transform. Together these kill
           the visible grid seams. The 1.01 scale is imperceptible on
           satellite imagery. */
        .leaflet-tile-pane {
          -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
          transform: translateZ(0);
        }
        .leaflet-tile {
          -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
          will-change: transform;
          transform: scale(1.01);
          transform-origin: 0 0;
        }
      `}</style>

      {/* ── Status bar ── */}
      <div style={{
        paddingTop: 'env(safe-area-inset-top, 44px)',
        background: '#070C09',
        borderBottom: courseCtx ? '1px solid rgba(255,255,255,0.05)' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px 10px' }}>
          {/* Title */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.14em', background: 'linear-gradient(90deg, #F5D78A, #C9A040)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              EAGLE EYE
            </div>
            {courseCtx && (
              <button onClick={() => setShowPicker(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>{courseCtx.course.club_name}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            )}
          </div>
          {/* Conditions pills */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Tap to enable GPS when off, or refresh the exact location when
                on — requestLocation() re-requests a fresh fix and (re)starts
                the watch either way. (2026-06-06) */}
            <button
              onClick={requestLocation}
              title={gpsTrusted ? 'GPS locked — tap to refresh' : gpsAcquiring ? 'Acquiring GPS — tap to refresh' : 'Tap to turn on GPS'}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: gpsTrusted ? 'rgba(42,122,56,0.18)' : gpsAcquiring ? 'rgba(240,168,104,0.14)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${gpsTrusted ? 'rgba(42,122,56,0.35)' : gpsAcquiring ? 'rgba(240,168,104,0.35)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 20, padding: '4px 8px', cursor: 'pointer',
                fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
              }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%',
                background: gpsTrusted ? '#5ED47A' : gpsAcquiring ? '#F0A868' : 'rgba(255,255,255,0.2)',
                animation: gpsAcquiring ? 'ee-acq-pulse 1.1s ease-in-out infinite' : 'none' }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                color: gpsTrusted ? '#5ED47A' : gpsAcquiring ? '#F0A868' : 'rgba(255,255,255,0.3)' }}>GPS</span>
              {/* refresh glyph — signals the pill is tappable */}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={gpsTrusted ? '#5ED47A' : gpsAcquiring ? '#F0A868' : 'rgba(255,255,255,0.35)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 1 }}>
                <path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            {wind && (
              <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 8px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>
                  <WindArrow deg={wind.dir} /> {wind.speed}
                </span>
              </div>
            )}
            {temp != null && (
              <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 8px' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>{temp}°</span>
              </div>
            )}
            {/* Inline Scorecard pill — sits next to the conditions pills so
                the user can pop into the live match's scorecard for the hole
                they're currently looking at. (2026-05-01) */}
            {onGoToScorecard && (
              <button onClick={onGoToScorecard} style={{
                background: 'rgba(232,192,90,0.14)',
                border: '1px solid rgba(232,192,90,0.40)',
                borderRadius: 20, padding: '4px 10px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
                fontFamily: 'inherit',
              }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#F5D78A', letterSpacing: '0.04em' }}>SCORECARD</span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#F5D78A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* ── Hole strip ── */}
        {courseCtx && (
          <div className="ee-hole-chip" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 20px 12px', scrollbarWidth: 'none' }}>
            {teeHoles.map(h => {
              const active = h.hole === currentHole
              return (
                <button key={h.hole} onClick={() => { setCurrentHole(h.hole); setTeeGps(gps); setResult(null) }}
                  style={{
                    flexShrink: 0, padding: '6px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: active ? 'rgba(201,160,64,0.2)' : 'rgba(255,255,255,0.05)',
                    outline: active ? '1px solid rgba(201,160,64,0.5)' : '1px solid transparent',
                    transition: 'all 0.15s',
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: active ? '#F5D78A' : 'rgba(255,255,255,0.5)', lineHeight: 1 }}>{h.hole}</div>
                  <div style={{ fontSize: 9, color: active ? 'rgba(245,215,138,0.6)' : 'rgba(255,255,255,0.25)', marginTop: 2, fontWeight: 600 }}>P{h.par}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── GPS error banner ── */}
      {gpsError && (
        <div style={{ margin: '8px 16px 0', padding: '12px 14px', borderRadius: 12, background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#F87171' }}>
                {gpsError === 'denied' ? 'Location access blocked' : gpsError === 'timeout' ? 'GPS signal lost' : 'Location unavailable'}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>
                {gpsError === 'denied' ? 'Tap below to enable, or go to Settings manually' : 'Move to an open area and try again'}
              </div>
            </div>
            <button onClick={requestLocation}
              style={{ background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 8, padding: '6px 12px', color: '#F87171', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              Enable GPS
            </button>
          </div>
          {gpsError === 'denied-hard' && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: 8, fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.8 }}>
              Location is blocked. Open Settings and allow access:<br/>
              <span style={{ color: 'rgba(255,255,255,0.75)' }}>
                If using from home screen:<br/>
                <span style={{ color: '#F5D78A' }}>Settings → Privacy &amp; Security → Location Services → The Match → While Using</span>
              </span><br/>
              <span style={{ color: 'rgba(255,255,255,0.75)' }}>
                If using in Safari:<br/>
                <span style={{ color: '#F5D78A' }}>Settings → Privacy &amp; Security → Location Services → Safari → While Using</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Main content ── */}
      {!courseCtx ? (
        /* ── Welcome hero ── */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 28px 16px', animation: 'ee-fade-in 0.4s ease' }}>
          {/* Animated crosshair */}
          <div style={{ position: 'relative', width: 140, height: 140, marginBottom: 24 }}>
            <svg width="140" height="140" viewBox="0 0 160 160" fill="none" style={{ position: 'absolute', inset: 0, animation: 'ee-spin-slow 20s linear infinite' }}>
              <circle cx="80" cy="80" r="74" stroke="rgba(201,160,64,0.10)" strokeWidth="1" strokeDasharray="6 8"/>
            </svg>
            <svg width="140" height="140" viewBox="0 0 160 160" fill="none" style={{ position: 'absolute', inset: 0, animation: 'ee-spin-slow 12s linear infinite reverse' }}>
              <circle cx="80" cy="80" r="60" stroke="rgba(201,160,64,0.14)" strokeWidth="1" strokeDasharray="4 10"/>
            </svg>
            <svg width="140" height="140" viewBox="0 0 160 160" fill="none" style={{ position: 'absolute', inset: 0 }}>
              <circle cx="80" cy="80" r="46" stroke="#C9A040" strokeWidth="1.5" strokeOpacity="0.55"/>
              <circle cx="80" cy="80" r="26" stroke="#E8C05A" strokeWidth="1.5" strokeOpacity="0.8"/>
              <circle cx="80" cy="80" r="4" fill="#F5D78A"/>
              <line x1="80" y1="6" x2="80" y2="50" stroke="#C9A040" strokeWidth="1.5" strokeOpacity="0.6" strokeLinecap="round"/>
              <line x1="80" y1="110" x2="80" y2="154" stroke="#C9A040" strokeWidth="1.5" strokeOpacity="0.6" strokeLinecap="round"/>
              <line x1="6" y1="80" x2="50" y2="80" stroke="#C9A040" strokeWidth="1.5" strokeOpacity="0.6" strokeLinecap="round"/>
              <line x1="110" y1="80" x2="154" y2="80" stroke="#C9A040" strokeWidth="1.5" strokeOpacity="0.6" strokeLinecap="round"/>
              {[45,135,225,315].map(a => {
                const rad = a * Math.PI / 180
                const x1 = 80 + 52*Math.cos(rad), y1 = 80 + 52*Math.sin(rad)
                const x2 = 80 + 62*Math.cos(rad), y2 = 80 + 62*Math.sin(rad)
                return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#C9A040" strokeWidth="1" strokeOpacity="0.3" strokeLinecap="round"/>
              })}
            </svg>
            <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: '0 0 80px rgba(201,160,64,0.08)', pointerEvents: 'none' }} />
          </div>

          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.22em', color: '#C9A040', marginBottom: 10 }}>AI-POWERED RANGEFINDER</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', marginBottom: 8, letterSpacing: '-0.03em', lineHeight: 1.1, textAlign: 'center' }}>
            Know Every Yard.<br/>Play Every Shot.
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.32)', lineHeight: 1.6, marginBottom: 24, maxWidth: 270, textAlign: 'center' }}>
            Select your course for live hole distances, GPS tracking, and AI shot analysis.
          </div>
          {!gps && (
            <button onClick={requestLocation} style={{
              padding: '11px 28px', borderRadius: 12, border: '1px solid rgba(94,212,122,0.4)', cursor: 'pointer',
              background: 'rgba(94,212,122,0.1)', color: '#5ED47A', fontWeight: 700, fontSize: 13,
              marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#5ED47A', boxShadow: '0 0 8px #5ED47A' }} />
              Enable Location
            </button>
          )}

          <button onClick={() => setShowPicker(true)} style={{
            padding: '15px 48px', borderRadius: 16, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #C9A040 0%, #E8C05A 100%)',
            color: '#070C09', fontWeight: 900, fontSize: 16, letterSpacing: '0.02em',
            boxShadow: '0 6px 32px rgba(201,160,64,0.4), 0 2px 8px rgba(0,0,0,0.3)',
          }}>Select Course</button>

          {/* Feature row */}
          <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
            {[
              { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>, label: 'GPS Live' },
              { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>, label: 'AI Analysis' },
              { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/></svg>, label: 'Weather' },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                {f.icon}
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.06em' }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── Distance view — satellite map background + HUD overlay ── */
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Full-screen satellite map — MapLibre (with Leaflet fallback) */}
          <HoleMapSwitch
            courseCtx={courseCtx}
            currentHole={currentHole}
            gps={gps}
            geocoded={courseGeocoded}
            holePositions={holePositions}
            greenPositions={greenPositions}
            holeGeometries={holeGeometries}
            clubYards={selectedClub ? Number(selectedClub.avg_yards) : null}
            clubLabel={selectedClub ? `${selectedClub.brand} ${selectedClub.model}` : null}
          />

          {/* HUD overlay — wrapper stays at auto z-index because it
              spans the full map (`inset: 0`) and at z-index 800 its
              empty middle was occluding the landing-zone marker
              inside Leaflet's marker pane. Instead, each visible
              child below carries its own zIndex: 800 so the yardage
              card + Analyze Shot still paint above the rotate-plugin
              transformed leaflet content, while the empty middle of
              the HUD lets the marker show through. Floating BAG sits
              at 1000. (2026-05-01 — Matt: landing-zone marker was
              hidden under the HUD layer.) */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '12px 16px 20px', pointerEvents: 'none' }}>

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
            <div style={{ alignSelf: 'flex-start', pointerEvents: 'auto', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: 'rgba(8,12,10,0.60)', backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
              borderRadius: 20, border: '1px solid rgba(255,255,255,0.14)',
              padding: '10px 14px 12px',
              boxShadow: '0 10px 34px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.20)',
              minWidth: 124,
              marginTop: 12,
              zIndex: 800,
            }}>
              {/* Hero distance instrument — arc gauge + number roll in lockstep */}
              <DistanceInstrument yards={displayYards} label={distLabel} accent={distAccent} />
              {/* GPS accuracy / acquiring chip (Phase 1.1) — the honesty
                  signal that earns trust on hole 1. Trusted: green "±Xm".
                  Acquiring: amber + pulsing, so the golfer knows the live
                  number isn't ready and the shown figure is the static tee
                  yardage, not a confident GPS read. */}
              {gpsTrusted ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#5ED47A', boxShadow: '0 0 6px rgba(94,212,122,0.8)' }} />
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'rgba(94,212,122,0.85)', fontVariantNumeric: 'tabular-nums' }}>
                    ±{Math.round(gpsAcc)} m
                  </span>
                </div>
              ) : gpsAcquiring ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#F0A868', animation: 'ee-acq-pulse 1.1s ease-in-out infinite' }} />
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'rgba(240,168,104,0.95)', fontVariantNumeric: 'tabular-nums' }}>
                    ACQUIRING · ±{Math.round(gpsAcc)} m
                  </span>
                </div>
              ) : null}
              {/* Front / Center / Back green — the big number above is center;
                  these flank it with the near + far edge. Only when a green
                  polygon matched (else the single number stands). (2026-06-06) */}
              {fcb && fcb.front != null && fcb.back != null && (
                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'rgba(94,212,122,0.9)' }}>
                    F <span style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fcb.front}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.55)' }}>
                    B <span style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fcb.back}</span>
                  </span>
                </div>
              )}
              {/* Plays-like — wind/temp/altitude-adjusted live distance.
                  Shown only when it actually differs from the raw GPS yardage.
                  (2026-06-06) */}
              {playsLike && playsLike.adj !== 0 && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
                  <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(245,215,138,0.7)' }}>PLAYS</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: '#F5D78A', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{playsLike.plays}</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: playsLike.adj > 0 ? '#F0A868' : '#5ED47A' }}>
                    {playsLike.adj > 0 ? `+${playsLike.adj}` : playsLike.adj}
                  </span>
                </div>
              )}
              {osmLoading && <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.30)', marginTop: 3, letterSpacing: '0.06em' }}>Loading…</div>}
              <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'flex-start' }}>
                <div style={{ background: 'rgba(42,122,56,0.3)', border: '1px solid rgba(42,122,56,0.5)', borderRadius: 4, padding: '1px 6px' }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#5ED47A' }}>PAR {holeData?.par ?? '—'}</span>
                </div>
                {holeData?.yardage && gpsToGreen != null && (
                  <div style={{ background: 'rgba(201,160,64,0.15)', border: '1px solid rgba(201,160,64,0.3)', borderRadius: 4, padding: '1px 6px' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#C9A040' }}>{holeData.yardage}Y TEE</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Bottom: actions ── */}
            <div style={{ pointerEvents: 'auto', zIndex: 800 }}>
              {/* Conditions pills removed 2026-05-01 — same wind/temp
                  values are already shown in the page header, so the
                  duplicate row above the Analyze Shot button was dead
                  weight blocking the satellite view. */}

              {/* Last analysis result */}
              {result && (
                <div onClick={() => setResult(result)} style={{
                  marginBottom: 10, padding: '10px 16px', borderRadius: 14, cursor: 'pointer',
                  background: 'rgba(4,8,6,0.78)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(201,160,64,0.3)', display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(245,215,138,0.5)', letterSpacing: '0.1em' }}>LAST ANALYSIS</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#F5D78A', marginTop: 1 }}>{result.playsLikeYards} yds · {result.recommendedClub}</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(245,215,138,0.4)" strokeWidth="2" strokeLinecap="round" style={{ marginLeft: 'auto' }}><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              )}

              {/* Analyze Shot button moved out of the HUD bottom-stack
                  on 2026-05-01 — it now lives as a small floating pill
                  at the bottom-left, mirroring the BAG toggle on the
                  right. The previous full-width primary CTA was eating
                  too much vertical map space. */}

              {/* Mark Tee Position button removed 2026-05-01 — every
                  hole now has tee coords from OSM (holePositions),
                  so the user no longer needs to manually anchor the
                  tee point. teeGps state stays defined on the off
                  chance a future code path wants to capture a custom
                  shot origin, but is no longer surfaced in the UI. */}
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {showCamera && (
        <CameraModal
          gps={gps}
          weather={weather}
          holeData={holeData}
          currentHole={currentHole}
          courseCtx={courseCtx}
          greenPos={greenPositions[currentHole] ?? null}
          onClose={() => setShowCamera(false)}
          onResult={res => { setResult(res); setShowCamera(false) }}
        />
      )}

      {result && !showCamera && (
        <ResultSheet
          result={result}
          holeData={holeData}
          onClose={() => {}}
        />
      )}

      {showPicker && (
        <CoursePicker
          onClose={() => setShowPicker(false)}
          onSelect={handleCourseSelect}
          gps={gps}
        />
      )}

      {/* Floating Scorecard pill removed 2026-05-01 — the page header
          already exposes a Scorecard link, the floating pill duplicated
          it and crowded the bottom-right where the BAG toggle lives. */}

      {/* Analyze Shot — small floating pill at bottom-left, mirrors
          the BAG toggle on the right. Replaces the full-width primary
          CTA that used to sit inside the HUD stack. (2026-05-01) */}
      {!showCamera && !showPicker && (
        <button onClick={() => setShowCamera(true)} style={{
          position: 'absolute',
          bottom: 16, left: 16,
          background: 'linear-gradient(135deg, #C9A040, #E8C05A)',
          border: '1px solid rgba(245,215,138,0.85)',
          borderRadius: 999, padding: '10px 16px',
          color: '#070C09',
          fontSize: 12, fontWeight: 900, letterSpacing: '0.06em',
          cursor: 'pointer',
          // inset top-rim highlight = the detail that reads as real glass/metal
          boxShadow: '0 8px 22px rgba(201,160,64,0.45), inset 0 1px 0 rgba(255,255,255,0.5)',
          display: 'inline-flex', alignItems: 'center', gap: 7,
          fontFamily: 'inherit',
          zIndex: 1000,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#070C09" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>
            <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
          </svg>
          ANALYZE
        </button>
      )}

      {/* Club toggle — idle state:
          single BAG button. Tap once → AI picks the best club match
          for the current target yardage and a vertical toggle takes
          over with ▲ (longer) and ▼ (shorter) arrows around the
          selected club. Each toggle press updates the landing-zone
          ring on the map. Tap the center to clear. (2026-05-01) */}
      {!showCamera && !showPicker && courseCtx && (
        <ClubToggle
          bag={myBag}
          selected={selectedClub}
          targetYards={displayYards}
          onSelect={setSelectedClub}
          onClear={() => setSelectedClub(null)}
          onOpenSheet={() => setBagOpen(true)}
        />
      )}

      {bagOpen && (
        <BagSheet
          clubs={myBag}
          selectedSlot={selectedClub?.slot}
          onPick={(c) => { setSelectedClub(c); setBagOpen(false) }}
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
    if (!usable.length) {
      onOpenSheet?.()  // empty bag — surface the sheet's empty-state hint
      return
    }
    const t = Number(targetYards)
    if (!Number.isFinite(t)) {
      onSelect?.(usable[Math.floor(usable.length / 2)])
      return
    }
    let best = usable[0]
    let bestDiff = Math.abs(Number(usable[0].avg_yards) - t)
    for (const c of usable) {
      const diff = Math.abs(Number(c.avg_yards) - t)
      if (diff < bestDiff) { best = c; bestDiff = diff }
    }
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
        background: 'rgba(7,12,9,0.62)',
        backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
        border: '1px solid rgba(245,215,138,0.40)',
        borderRadius: 999, padding: '10px 14px',
        color: '#F5D78A',
        fontSize: 12, fontWeight: 800, letterSpacing: '0.06em',
        cursor: 'pointer',
        boxShadow: '0 6px 18px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.14)',
        display: 'inline-flex', alignItems: 'center', gap: 8,
        fontFamily: 'inherit',
        zIndex: 1000,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="#F5D78A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
        background: disabled ? 'rgba(7,12,9,0.42)' : 'rgba(7,12,9,0.62)',
        backdropFilter: 'blur(16px) saturate(150%)', WebkitBackdropFilter: 'blur(16px) saturate(150%)',
        border: disabled ? '1px solid rgba(245,215,138,0.18)' : '1px solid rgba(245,215,138,0.55)',
        color: disabled ? 'rgba(245,215,138,0.30)' : '#F5D78A',
        borderRadius: 12, padding: '6px 10px',
        fontSize: 11, fontWeight: 800, letterSpacing: '0.02em',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit', minWidth: 96,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.12)',
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
            background: 'linear-gradient(135deg, rgba(245,215,138,0.97), rgba(201,160,64,0.97))',
            border: '1px solid rgba(245,215,138,0.85)',
            borderRadius: 12, padding: '10px 14px',
            color: '#070C09',
            fontFamily: 'inherit',
            cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(201,160,64,0.45)',
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
            background: 'rgba(7,12,9,0.85)',
            border: '1px solid rgba(245,215,138,0.40)',
            borderRadius: 12, padding: '0 10px',
            color: '#F5D78A',
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
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480,
        maxHeight: '78vh',
        display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, #0E1F13 0%, #070C09 100%)',
        border: '1px solid rgba(245,215,138,0.25)',
        borderRadius: '20px 20px 0 0',
        overflow: 'hidden',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(245,215,138,0.30)', margin: '12px auto 8px', flexShrink: 0 }} />

        <div style={{
          padding: '4px 18px 14px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'rgba(245,215,138,0.60)', fontWeight: 700, letterSpacing: '0.20em' }}>
              MY BAG
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginTop: 2 }}>
              Pick a club for landing zone
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10, color: 'rgba(255,255,255,0.70)', fontSize: 16,
            cursor: 'pointer', padding: '4px 10px', height: 32, lineHeight: 1,
            fontFamily: 'inherit',
          }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px 12px' }}>
          {usable.length === 0 && (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 1.55,
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
                background: active ? 'rgba(245,215,138,0.10)' : 'rgba(255,255,255,0.03)',
                border: active ? '1px solid rgba(245,215,138,0.55)' : '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12, padding: '12px 14px',
                marginBottom: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 10, color: 'rgba(245,215,138,0.65)', fontWeight: 700,
                    letterSpacing: '0.10em', textTransform: 'uppercase',
                  }}>{SLOT_LABELS[c.slot] || c.slot}</div>
                  <div style={{
                    fontSize: 14, fontWeight: 800, color: '#fff',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {c.brand} <span style={{ color: 'rgba(255,255,255,0.62)', fontWeight: 600 }}>{c.model}</span>
                  </div>
                </div>
                <div style={{
                  background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
                  color: '#070C09',
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
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}>
            <button onClick={onClear} style={{
              width: '100%', padding: '12px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              color: 'rgba(255,255,255,0.75)',
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
