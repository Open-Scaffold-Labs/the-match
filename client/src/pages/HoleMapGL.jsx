// ─── Eagle Eye hole map — MapLibre GL renderer (Phase 2.1 / 2.2) ────────────
// A premium vector renderer for the hole view: crisp NAIP satellite base +
// branded green/gold vector overlays (tee, green, fairway/aim line), course-up
// bearing, a smoothly-lerped player puck with a true-ground accuracy halo, and
// a cinematic flyTo hole intro (look down the fairway at a pitch angle).
//
// Drop-in alternative to the Leaflet <HoleMap>. maplibre-gl is dynamically
// imported inside the init effect so (a) it code-splits out of the main bundle
// and (b) ANY failure to load/init calls onInitError(), letting the parent fall
// back to the proven Leaflet map — the beta can never hard-break on this path.
//
// NOTE (first cut): renders the hero viewing experience + tap-to-measure.
// Draggable aim-point and the per-club landing-zone ring are still on the
// Leaflet path; they're the next porting pass once this is device-verified.
import { useRef, useEffect, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { haversineYards, calcBearing } from '../lib/geo.js'
import { dispersionEllipse } from '../lib/clubModel.js'
import { dispersionZonePolygon, arcBandPolygon, layupRingsInPlay } from '../lib/mapOverlays.js'

// NAIP tiles load through a custom 'naipc://' protocol so EVERY tile request
// (including the ones MapLibre issues from its worker thread, which a service
// worker can't intercept) is routed through our main-thread handler and cached.
// Per MapLibre's raster addProtocol contract (discussion #4480): return
// { data: ArrayBuffer } where the ArrayBuffer is the encoded image-FILE bytes
// (the JPEG), which MapLibre then decodes — NOT raw pixels.
const NAIP_TILES = 'naipc://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/tile/{z}/{y}/{x}'
const TILE_CACHE = 'naip-tiles-v1'
const TILE_CACHE_MAX = 2000

// Offline tile cache — bad-coverage resilience. Cache-first via the Cache API:
// a hole you've already loaded keeps rendering its imagery with ZERO signal
// mid-round (golf courses are notorious dead zones). Tiles are immutable per
// (z,y,x) → safe to serve cached forever; FIFO-trimmed so it can't grow
// unbounded. Registered once, globally (addProtocol is a global registration).
let naipProtocolRegistered = false
function registerNaipCacheProtocol(maplibregl) {
  if (naipProtocolRegistered) return
  naipProtocolRegistered = true
  maplibregl.addProtocol('naipc', async (params, abortController) => {
    const realUrl = 'https://' + params.url.replace(/^naipc:\/\//, '')
    let cache = null
    try { cache = await caches.open(TILE_CACHE) } catch { /* Cache API blocked (rare) */ }
    if (cache) {
      const hit = await cache.match(realUrl)
      if (hit) return { data: await hit.arrayBuffer() }   // served fully offline
    }
    const res = await fetch(realUrl, { signal: abortController.signal })
    if (!res.ok) throw new Error('NAIP tile ' + res.status)
    const buf = await res.arrayBuffer()                   // the JPEG file bytes
    if (cache) {
      cache.put(realUrl, new Response(buf.slice(0), {     // cache a copy (buf may be transferred)
        headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg' },
      })).catch(() => {})
      cache.keys().then(keys => {                          // FIFO trim
        const excess = keys.length - TILE_CACHE_MAX
        for (let i = 0; i < excess; i++) cache.delete(keys[i])
      }).catch(() => {})
    }
    return { data: buf }
  })
}

// Load the maplibre-gl chunk with a few retries + backoff so a transient
// network blip (common on a course with spotty signal) self-heals instead of
// dropping the user onto the retry card.
async function importMaplibre(tries = 4) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try { return (await import('maplibre-gl')).default }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 500 * (i + 1))) }
  }
  throw lastErr
}

const lngLat = (p) => (p && p.lat != null ? [p.lon, p.lat] : null)

// True-ground circle as a GeoJSON ring (radius in yards). Used for the green
// outline + the accuracy halo, so both are real ground distances, not pixels.
function ringCoords(center, radiusYards, n = 64) {
  const out = []
  const rm = radiusYards * 0.9144
  const mLat = 110540, mLon = 111320 * Math.cos(center.lat * Math.PI / 180)
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI
    out.push([center.lon + (rm * Math.cos(a)) / mLon, center.lat + (rm * Math.sin(a)) / mLat])
  }
  return out
}

const fc = (features) => ({ type: 'FeatureCollection', features })
const lineF = (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } })
const polyF = (ring) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } })

// Project a point `yards` along `bearingDeg` from a start {lat,lon}.
function projectByYards(start, bearingDeg, yards) {
  const R = 6371000, d = (yards * 0.9144) / R, br = bearingDeg * Math.PI / 180
  const lat1 = start.lat * Math.PI / 180, lon1 = start.lon * Math.PI / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br))
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI }
}

// Walk a polyline and return the {lat,lon} `targetYards` along it (doglegs).
function pointAlongGeometryAtYards(geom, targetYards) {
  if (!geom || geom.length < 2) return null
  let accum = 0
  for (let i = 0; i < geom.length - 1; i++) {
    const a = geom[i], b = geom[i + 1]
    const segLen = haversineYards(a, b) || 0
    if (accum + segLen >= targetYards) {
      const t = segLen > 0 ? (targetYards - accum) / segLen : 0
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }
    }
    accum += segLen
  }
  const last = geom[geom.length - 1]
  return { lat: last.lat, lon: last.lon }
}

// Par-aware default aim: par 3 → the green; par 4/5 → ~250y drive zone (never
// within 100y of the green), routed along the OSM fairway centreline when
// present so doglegs don't aim out of bounds. Mirrors the Leaflet map.
function getDefaultAim({ par, totalYards, teePt, greenPt, geometry }) {
  if (!teePt || !greenPt) return null
  if (par === 3) return { lat: greenPt.lat, lon: greenPt.lon }
  const targetYards = Math.max(150, Math.min(250, (totalYards || 0) - 100))
  if (geometry && geometry.length >= 2) {
    const pt = pointAlongGeometryAtYards(geometry, targetYards)
    if (pt) return pt
  }
  const t = totalYards > 0 ? Math.max(0, Math.min(1, targetYards / totalYards)) : 0.6
  return { lat: teePt.lat + (greenPt.lat - teePt.lat) * t, lon: teePt.lon + (greenPt.lon - teePt.lon) * t }
}

// Small DOM helper for a glassy yardage pill used as a map marker.
function pillEl(text, primary) {
  const el = document.createElement('div')
  el.style.cssText = `background:${primary ? 'rgb(var(--tm-ee-bg-rgb) / 0.95)' : 'rgb(var(--tm-ee-bg-rgb) / 0.82)'};color:#fff;`
    + `font-weight:800;font-size:${primary ? 14 : 12}px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;`
    + `padding:${primary ? '4px 11px' : '3px 9px'};border-radius:999px;white-space:nowrap;`
    + `border:1px solid rgb(var(--tm-ee-white-rgb) / 0.45);box-shadow:0 2px 8px rgb(var(--tm-ee-black-rgb) / 0.5)`
  el.textContent = text
  return el
}

// ── Design-token bridge for MapLibre paint (Phase 4.3 pattern, established
// 2026-07-02; full HoleMapGL conversion 2026-07-07): MapLibre paint
// properties do NOT resolve CSS var(), so layers read the --tm-ee-* tokens
// via getComputedStyle at layer-creation. `name` may be a solid token
// (returns its value) or a `-rgb` triplet token (combined with `alpha` into
// a comma-form rgba() string — the safest MapLibre interchange format).
// Literal fallbacks are load-bearing, not decoration: an invalid color at
// addLayer SILENTLY DROPS THE WHOLE LAYER (maplibre-style-spec validation
// returns early — no exception, only an ErrorEvent). The computed-style
// object is cached module-level (documentElement never detaches; the object
// is live, so reads stay correct) — one style-resolution force per session.
let eeStyles = null
function eeColor(name, alpha, fallback) {
  try {
    eeStyles ||= getComputedStyle(document.documentElement)
    const v = eeStyles.getPropertyValue(name).trim()   // .trim() guards WebKit leading-whitespace serialization
    if (!v) {
      if (import.meta.env?.DEV) console.warn('[HoleMapGL] token read empty, using fallback:', name)
      return fallback
    }
    if (alpha == null) return v
    if (v.startsWith('#')) {
      // Alpha path requires a `-rgb` triplet token; a hex value would emit
      // invalid `rgba(#hex,a)` and silently drop the layer. Fall back loud.
      if (import.meta.env?.DEV) console.warn('[HoleMapGL] alpha needs a -rgb triplet token, got hex:', name)
      return fallback
    }
    return `rgba(${v.split(/\s+/).join(',')},${alpha})`
  } catch { return fallback }
}

// On-map distance label — premium map-native style (Golfshot/Hole19, 2026-07
// research): NO pill. A bare white bold TABULAR number with a dark contrast
// halo so it reads over any imagery; the aim→green number carries a small gold
// flag glyph. Numbers only, no units (users know). (Matt 2026-07)
function distEl(numText, toGreen) {
  const size = toGreen ? 22 : 20
  const el = document.createElement('div')
  el.style.cssText = 'display:flex;align-items:center;gap:3px;white-space:nowrap;pointer-events:none'
  if (toGreen) {
    const flag = document.createElement('span')
    flag.style.cssText = 'display:inline-flex;filter:drop-shadow(0 1px 2px rgb(var(--tm-ee-black-rgb) / 0.8))'
    // Token colors via style= declarations, NOT presentation attrs: var() is
    // only guaranteed to substitute in CSS declarations (2026-07-07 research).
    flag.innerHTML = '<svg width="12" height="14" viewBox="0 0 22 28"><line x1="4" y1="3" x2="4" y2="26" stroke-width="2.4" stroke-linecap="round" style="stroke:var(--tm-ee-flag)"/><polygon points="4,2.5 19,8 4,13.5" style="fill:var(--tm-ee-flag)"/></svg>'
    el.appendChild(flag)
  }
  const num = document.createElement('span')
  num.className = 'ee-dist-num'
  num.textContent = numText
  // C3 staged A/B (2026-07-07, Matt: tune on device, don't ship blind):
  // localStorage 'tm-ee-halo-soft' = '1' swaps the hard 0.75px text-stroke
  // for a soft blurred dark casing (cartography guidance: soft 40-60% halo
  // beats a hard stroke over imagery). Default OFF = today's halo, untouched.
  const softHalo = (() => { try { return localStorage.getItem('tm-ee-halo-soft') === '1' } catch { return false } })()
  num.style.cssText = 'color:#fff;font-weight:800;font-size:' + size + 'px;line-height:1;'
    + 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-variant-numeric:tabular-nums;'
    + (softHalo
      ? 'text-shadow:0 0 4px rgb(var(--tm-ee-black-rgb) / 0.6),0 0 8px rgb(var(--tm-ee-black-rgb) / 0.5),0 1px 3px rgb(var(--tm-ee-black-rgb) / 0.55)'
      : '-webkit-text-stroke:0.75px rgb(var(--tm-ee-black-rgb) / 0.55);'
        + 'text-shadow:0 0 3px rgb(var(--tm-ee-black-rgb) / 0.85),0 1px 3px rgb(var(--tm-ee-black-rgb) / 0.9)')
  el.appendChild(num)
  return el
}

export default function HoleMapGL({
  courseCtx, currentHole, gps, geocoded,
  holePositions = {}, greenPositions = {}, holeGeometries = {}, greenPolys = {},
  clubYards = null, clubLabel = null,
  bagArcs = [],
  rangeRingsOn = false,   // layup range-arcs to the green (100/150/200/250), opt-in
  onInitError,
  onAimChange,          // ({userPlaced, teeAimYds, aimGreenYds, aim}|null) — B: retarget plays-like to a user aim
  editMode = false,     // "Map this course" editor — tap to place tee/green
  editDraft = null,     // current hole's draft { tee, green, aim } (nulls allowed)
  editCandidates = null,// { greens:[{lat,lon}], tees:[{lat,lon}] } — OSM guide dots
  onMapTap,             // (coord) => void — a map tap in edit mode (raw lat/lon)
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const glRef = useRef(null)          // the maplibregl namespace once imported
  const readyRef = useRef(false)
  const teeMarkerRef = useRef(null)
  const greenMarkerRef = useRef(null)
  const aimMarkerRef = useRef(null)   // draggable aim target
  const teeAimLabelRef = useRef(null) // tee→aim yardage pill
  const aimGreenLabelRef = useRef(null) // aim→green yardage pill
  const landingLabelRef = useRef(null) // club landing-zone yardage pill
  const aimRef = useRef(null)         // current aim {lat,lon} (null = default)
  const redrawRef = useRef(() => {})  // latest redrawAim, so the once-attached drag handler never goes stale
  const puckRef = useRef(null)        // DOM marker for the player
  const puckRafRef = useRef(0)
  const puckPosRef = useRef(null)
  const lastHoleRef = useRef(null)
  const resizeObsRef = useRef(null)   // keeps the map canvas matched to its container
  const [failed, setFailed] = useState(false)

  // live snapshots so once-attached handlers (click, drag) read fresh values
  const gpsRef = useRef(gps)
  const greenRef = useRef(null)
  const clubRef = useRef({ yards: clubYards, label: clubLabel })
  const bagArcsRef = useRef(bagArcs)   // [{label, yards, estimated, highlight}] — Phase 3.3
  const bagLabelsRef = useRef([])      // dynamic list of club-zone label markers
  const ringsOnRef = useRef(rangeRingsOn) // layup range-arcs toggle (opt-in, persisted upstream)
  const ringLabelsRef = useRef([])     // dynamic list of range-ring label chips
  const lastAimRef = useRef(null)      // aim {lat,lon} from the last redrawAim, shared with drawBagArcs
  const onAimChangeRef = useRef(onAimChange)   // latest callback for the once-attached dragend handler
  const emitAimRef = useRef(() => {})          // latest emitAim (avoids stale closure)
  useEffect(() => { onAimChangeRef.current = onAimChange }, [onAimChange])
  // Editor snapshots — once-attached click handler reads these live. All edit
  // rendering + the click handler are GUARDED by editModeRef, so normal mode is
  // completely untouched (zero risk to the core hole view). (2026-07-09)
  const editModeRef = useRef(editMode)
  const editDraftRef = useRef(editDraft)
  const editCandRef = useRef(editCandidates)
  const onMapTapRef = useRef(onMapTap)
  const redrawEditRef = useRef(() => {})
  useEffect(() => { editModeRef.current = editMode; redrawEditRef.current() }, [editMode])
  useEffect(() => { editDraftRef.current = editDraft; redrawEditRef.current() }, [editDraft])
  useEffect(() => { editCandRef.current = editCandidates; redrawEditRef.current() }, [editCandidates])
  useEffect(() => { onMapTapRef.current = onMapTap }, [onMapTap])
  useEffect(() => { gpsRef.current = gps }, [gps])
  useEffect(() => { clubRef.current = { yards: clubYards, label: clubLabel } }, [clubYards, clubLabel])
  useEffect(() => { bagArcsRef.current = bagArcs; redrawRef.current() }, [bagArcs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ringsOnRef.current = rangeRingsOn; redrawRef.current() }, [rangeRingsOn]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Init the map once we know where the course is ──
  useEffect(() => {
    if (!containerRef.current || !geocoded || mapRef.current) return
    let cancelled = false
    let loadTimer = 0
    let onStallVis = null
    const dropStallGuard = () => {
      clearTimeout(loadTimer)
      if (onStallVis) { document.removeEventListener('visibilitychange', onStallVis); onStallVis = null }
    }
    const fail = (e) => {
      if (cancelled) return
      console.error('[HoleMapGL] init failed:', e?.message || e)
      dropStallGuard()
      setFailed(true)
      onInitError?.()
    }
    ;(async () => {
      let maplibregl
      try { maplibregl = await importMaplibre() } catch (e) { return fail(e) }
      if (cancelled || !containerRef.current) return
      glRef.current = maplibregl
      registerNaipCacheProtocol(maplibregl)   // offline-capable, worker-safe tile caching
      let map
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: { naip: { type: 'raster', tiles: [NAIP_TILES], tileSize: 256, maxzoom: 18, attribution: 'Imagery: USDA NAIP' } },
            layers: [
              { id: 'bg', type: 'background', paint: { 'background-color': eeColor('--tm-ee-map-bg', null, '#0c1a10') } },
              { id: 'naip', type: 'raster', source: 'naip' },
              { id: 'tint', type: 'background', paint: { 'background-color': eeColor('--tm-ee-map-tint', null, '#0E3B23'), 'background-opacity': 0.05 } },
            ],
          },
          center: lngLat(geocoded), zoom: 16, pitch: 0, bearing: 0,
          attributionControl: false, dragRotate: false, pitchWithRotate: false,
          maxPitch: 75, fadeDuration: 120,
        })
      } catch (e) { return fail(e) }
      mapRef.current = map
      // Keep the GL canvas exactly matched to its container. Without this the
      // canvas keeps its INIT size; when the fixed full-screen container's true
      // height settles (device safe-area insets resolving after first paint),
      // the map leaves dark strips at the top/bottom instead of bleeding fully
      // edge-to-edge. A ResizeObserver re-fits the canvas on any size change.
      // (2026-06-26 — the black-bars-at-top/bottom fix)
      try {
        const ro = new ResizeObserver(() => { try { map.resize() } catch { /* gone */ } })
        ro.observe(containerRef.current)
        resizeObsRef.current = ro
      } catch { /* ResizeObserver unsupported (ancient engines) — no-op */ }
      // Silent-stall guard: if the style/tiles never reach 'load' (the failure
      // mode where MapLibre constructs but renders nothing, with no error
      // event), fall back to Leaflet rather than leave a black map.
      // 20s, not 9s: a cold first load downloads the ~284KB maplibre chunk +
      // NAIP tiles, which can exceed 9s on a slow link and was tripping a
      // spurious fallback to Leaflet (then sticking for the session). 20s only
      // fires on a genuine stall.
      // 2026-07-06 — the guard counts only VISIBLE time. While the page is
      // hidden (phone app-switch mid-load, backgrounded tab, fully-occluded
      // window) Chrome freezes requestAnimationFrame, so MapLibre CANNOT
      // advance to 'load' — burning the budget while hidden produced a
      // spurious "check your connection" card on a healthy map. Diagnosed
      // live: visibility=hidden, rAF ticks in 2s = 0, zero tile requests,
      // zero errors. Timer arms only while visible; hiding pauses it;
      // returning to visible re-arms a fresh 35s of visible stall.
      const armStallGuard = () => {
        clearTimeout(loadTimer)
        loadTimer = setTimeout(() => { if (!readyRef.current) fail(new Error('map load timeout (35s visible)')) }, 35000)
      }
      onStallVis = () => {
        if (readyRef.current || cancelled) return
        if (document.visibilityState === 'visible') armStallGuard()
        else clearTimeout(loadTimer)
      }
      document.addEventListener('visibilitychange', onStallVis)
      if (document.visibilityState === 'visible') armStallGuard()
      map.on('error', (e) => { /* tile errors are non-fatal; only log */ if (e?.error) console.warn('[HoleMapGL]', e.error.message) })
      map.addControl(new maplibregl.AttributionControl({ compact: true }))
      map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-left')

      map.on('load', () => {
        if (cancelled) return
        dropStallGuard()
        readyRef.current = true
        // Re-fit the canvas to the container now that the first frame is up —
        // catches any size the container settled to after init (safe-area insets).
        try { map.resize() } catch { /* noop */ }
        requestAnimationFrame(() => { try { map.resize() } catch { /* noop */ } })
        // overlay sources
        map.addSource('fairway', { type: 'geojson', data: fc([]) })
        map.addSource('green', { type: 'geojson', data: fc([]) })
        map.addSource('halo', { type: 'geojson', data: fc([]) })
        map.addLayer({ id: 'fairway-glow', type: 'line', source: 'fairway', paint: { 'line-color': eeColor('--tm-ee-gold-pulse', null, '#F5E070'), 'line-width': 7, 'line-opacity': 0.22, 'line-blur': 4 }, layout: { 'line-cap': 'round' } })
        map.addLayer({ id: 'fairway', type: 'line', source: 'fairway', paint: { 'line-color': eeColor('--tm-ee-gold-pulse', null, '#F5E070'), 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [2, 1.4] }, layout: { 'line-cap': 'round' } })
        map.addLayer({ id: 'green-fill', type: 'fill', source: 'green', paint: { 'fill-color': eeColor('--tm-ee-green', null, '#5ED47A'), 'fill-opacity': 0.20 } })
        map.addLayer({ id: 'green-line', type: 'line', source: 'green', paint: { 'line-color': eeColor('--tm-ee-green', null, '#5ED47A'), 'line-width': 2, 'line-opacity': 0.85 } })
        map.addLayer({ id: 'halo-fill', type: 'fill', source: 'halo', paint: { 'fill-color': eeColor('--tm-ee-gold-light', null, '#F5D78A'), 'fill-opacity': 0.08 } })
        map.addLayer({ id: 'halo-line', type: 'line', source: 'halo', paint: { 'line-color': eeColor('--tm-ee-gold-light', null, '#F5D78A'), 'line-width': 1, 'line-opacity': 0.30 } })
        // Layup range-arcs (2.5, market-corrected form 2026-07-02): green-anchored
        // 100/150/200/250 arcs, opt-in via the RINGS toggle. Stroke-only (never
        // fill — hazards must stay readable through them) in the white=raw-distance
        // semantic, over a dark under-halo so the thin line survives bright
        // fairway pixels. Added first so club overlays render above.
        map.addSource('rangeRings', { type: 'geojson', data: fc([]) })
        map.addLayer({ id: 'rangeRings-halo', type: 'line', source: 'rangeRings', paint: {
          'line-color': eeColor('--tm-ee-bg-rgb', 0.6, 'rgba(7,12,9,0.6)'),
          'line-width': 4, 'line-blur': 3, 'line-opacity': 0.55,
        }, layout: { 'line-cap': 'round' } })
        map.addLayer({ id: 'rangeRings-line', type: 'line', source: 'rangeRings', paint: {
          'line-color': eeColor('--tm-ee-white-rgb', 0.6, 'rgba(255,255,255,0.6)'),
          'line-width': 1.5, 'line-opacity': 0.75,
        }, layout: { 'line-cap': 'round' } })
        // Dispersion band for the HIGHLIGHTED bag-arc club (one club at a time —
        // honest zone, not a boundary): soft feathered fill under the arc lines.
        map.addSource('bagArcBand', { type: 'geojson', data: fc([]) })
        map.addLayer({ id: 'bagArcBand-fill', type: 'fill', source: 'bagArcBand', paint: {
          'fill-color': eeColor('--tm-ee-gold-pulse', null, '#F5E070'), 'fill-opacity': 0.12,
        } })
        map.addLayer({ id: 'bagArcBand-edge', type: 'line', source: 'bagArcBand', paint: {
          'line-color': eeColor('--tm-ee-gold-pulse-rgb', 0.5, 'rgba(245,224,112,0.5)'),
          'line-width': 5, 'line-blur': 6, 'line-opacity': 0.22,
        } })
        map.addSource('landing', { type: 'geojson', data: fc([]) })
        // Landing ZONE (2026-07-02): now the honest dispersionEllipse shape, drawn
        // soft — feathered blurred edge, no crisp outline (a hard 2.5px line read
        // as false precision; risk D1 in the range-rings/dispersion spec).
        map.addLayer({ id: 'landing-fill', type: 'fill', source: 'landing', paint: { 'fill-color': eeColor('--tm-ee-gold-pulse', null, '#F5E070'), 'fill-opacity': 0.14 } })
        map.addLayer({ id: 'landing-line', type: 'line', source: 'landing', paint: { 'line-color': eeColor('--tm-ee-gold-pulse', null, '#F5E070'), 'line-width': 5, 'line-blur': 6, 'line-opacity': 0.35 } })
        // Bag arcs (Phase 3.3, rebuilt 2026-06-26): own-club distance ARCS — a
        // curved band per club at its true-ground yardage, swept across the line
        // of play. Drawn as LineStrings. A wide low-opacity glow under a crisp
        // line reads premium; the best-match club (highlight) is brighter +
        // thicker. Data-driven from the player's REAL bag only.
        map.addSource('bagArcs', { type: 'geojson', data: fc([]) })
        map.addLayer({ id: 'bagArcs-glow', type: 'line', source: 'bagArcs', paint: {
          'line-color': ['case', ['get', 'highlight'], eeColor('--tm-ee-gold-pulse', null, '#F5E070'), eeColor('--tm-ee-gold-light', null, '#F5D78A')],
          'line-width': ['case', ['get', 'highlight'], 9, 6],
          'line-opacity': ['case', ['get', 'highlight'], 0.28, 0.14],
          'line-blur': 4,
        }, layout: { 'line-cap': 'round' } })
        map.addLayer({ id: 'bagArcs-line', type: 'line', source: 'bagArcs', paint: {
          'line-color': ['case', ['get', 'highlight'], eeColor('--tm-ee-gold-pulse', null, '#F5E070'), eeColor('--tm-ee-gold-pulse-rgb', 0.62, 'rgba(245,224,112,0.62)')],
          'line-width': ['case', ['get', 'highlight'], 3.5, 2],
          'line-opacity': 0.95,
        }, layout: { 'line-cap': 'round' } })

        // ── "Map this course" editor overlays (guarded by editModeRef) ──
        // Candidate guide dots (real OSM greens/tees), the placed draft points,
        // and the tee→(aim)→green draft line. Empty + inert unless editing.
        map.addSource('editCand', { type: 'geojson', data: fc([]) })
        map.addLayer({ id: 'editCand', type: 'circle', source: 'editCand', paint: {
          'circle-radius': 5,
          'circle-color': ['case', ['==', ['get', 'kind'], 'green'], eeColor('--tm-ee-green', null, '#5ED47A'), eeColor('--tm-ee-gold', null, '#C9A040')],
          'circle-opacity': 0.45, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff',
        } })
        map.addSource('editLine', { type: 'geojson', data: fc([]) })
        map.addLayer({ id: 'editLine', type: 'line', source: 'editLine', paint: {
          'line-color': eeColor('--tm-ee-gold-pulse', null, '#F5E070'), 'line-width': 2.5, 'line-dasharray': [2, 1.4],
        }, layout: { 'line-cap': 'round' } })
        map.addSource('editPts', { type: 'geojson', data: fc([]) })
        map.addLayer({ id: 'editPts', type: 'circle', source: 'editPts', paint: {
          'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
        } })
        // A tap in edit mode reports the raw coord up; the page snaps it to the
        // nearest candidate for the current step. Inert when not editing.
        map.on('click', (e) => {
          if (!editModeRef.current) return
          onMapTapRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng })
        })
        redrawEditRef.current()

        // tap-to-measure popup removed 2026-07 (Matt): redundant with the aim
        // line's distances, looked poor, and the popup didn't dismiss on tap.

        drawHole(true)
        syncPuck()
      })
    })()
    return () => {
      cancelled = true
      dropStallGuard()
      cancelAnimationFrame(puckRafRef.current)
      readyRef.current = false
      if (resizeObsRef.current) { try { resizeObsRef.current.disconnect() } catch { /* noop */ } resizeObsRef.current = null }
      if (mapRef.current) { try { mapRef.current.remove() } catch { /* gone */ } mapRef.current = null }
      // map.remove() destroys every DOM marker too, so their refs are now
      // dangling. Null them ALL — otherwise after a course switch (this effect
      // re-runs on `geocoded` change) drawHole/redrawAim/syncPuck see a
      // non-null ref and try to MOVE the old (destroyed) marker instead of
      // creating a fresh one on the new map → tee/green/aim/puck/label markers
      // silently never reappear until an app restart. (2026-06-24 — Matt:
      // switched courses, markers vanished.)
      teeMarkerRef.current = null
      greenMarkerRef.current = null
      aimMarkerRef.current = null
      teeAimLabelRef.current = null
      aimGreenLabelRef.current = null
      landingLabelRef.current = null
      bagLabelsRef.current = []   // markers destroyed with the map; drop the dangling refs
      ringLabelsRef.current = []  // ditto for the range-ring chips
      lastAimRef.current = null
      puckRef.current = null
      puckPosRef.current = null
      aimRef.current = null
      greenRef.current = null
      lastHoleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geocoded])

  const holeMeta = () => courseCtx?.tee?.holes?.find(h => h.hole === currentHole)

  // ── Draw / update the hole overlays + cinematic camera ──
  function drawHole(intro) {
    const map = mapRef.current, gl = glRef.current
    if (!map || !readyRef.current || !gl) return
    const tee = holePositions[currentHole]
    const green = greenPositions[currentHole]
    greenRef.current = green || null
    // Layout confidence: a hole bound from an authoritative golf=hole centerline
    // has geometry; a yardage-reconstructed hole (refless course — e.g. Beacon
    // Hill, no golf=hole ways) does not. Without it we must NOT draw the guessed
    // tee or the tee→green line: a wrong line that crosses other holes is worse
    // than none. The green + GPS distance stay (green-anchored, reliable). Real
    // routing reconstruction is the follow-up; this gate keeps the beta honest
    // in the meantime. (2026-07-09)
    const layoutConfident = Array.isArray(holeGeometries[currentHole]) && holeGeometries[currentHole].length >= 2
    const meta = holeMeta()
    const par = meta?.par ?? 4
    const totalYards = meta?.yardage ?? Math.round(haversineYards(tee, green) || 0)

    // Green shape: the real OSM green polygon when we have it, else a ~13yd
    // circle from the green centre as a fallback. (Parity with the Leaflet map.)
    const gp = greenPolys[currentHole]
    const greenFeature = (Array.isArray(gp) && gp.length >= 3)
      ? polyF([...gp.map(p => [p.lon, p.lat]), [gp[0].lon, gp[0].lat]])
      : (green ? polyF(ringCoords(green, 13)) : null)
    map.getSource('green')?.setData(greenFeature ? fc([greenFeature]) : fc([]))

    // tee + green DOM markers. Tee only when the layout is confident — a guessed
    // tee on a refless course sits at a mis-paired spot, so hide it.
    if (tee && layoutConfident) {
      if (!teeMarkerRef.current) {
        const el = document.createElement('div')
        el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:var(--tm-ee-gold);border:2px solid #fff;box-shadow:0 0 8px rgb(var(--tm-ee-gold-rgb) / 0.8)'
        teeMarkerRef.current = new gl.Marker({ element: el }).setLngLat([tee.lon, tee.lat]).addTo(map)
      } else teeMarkerRef.current.setLngLat([tee.lon, tee.lat])
    } else if (teeMarkerRef.current) { teeMarkerRef.current.remove(); teeMarkerRef.current = null }
    if (green) {
      if (!greenMarkerRef.current) {
        // Red pin-flag (matches the Leaflet map's flag), anchored at the pole base.
        const el = document.createElement('div')
        el.style.cssText = 'width:22px;height:28px;filter:drop-shadow(0 2px 3px rgb(var(--tm-ee-black-rgb) / 0.6))'
        // Flag red via style= declarations (var() in presentation attrs is not guaranteed).
        el.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><line x1="4" y1="2" x2="4" y2="27" stroke="white" stroke-width="1.8" stroke-linecap="round"/><polygon points="4,2 20,8 4,14" stroke="white" stroke-width="0.8" style="fill:var(--tm-ee-flag)"/><circle cx="4" cy="27" r="2.5" stroke="white" stroke-width="1.2" style="fill:var(--tm-ee-flag)"/></svg>'
        greenMarkerRef.current = new gl.Marker({ element: el, anchor: 'bottom', offset: [7, 0] }).setLngLat([green.lon, green.lat]).addTo(map)
      } else greenMarkerRef.current.setLngLat([green.lon, green.lat])
    } else if (greenMarkerRef.current) { greenMarkerRef.current.remove(); greenMarkerRef.current = null }

    // draggable aim target (par-aware default, drag to re-plan the line)
    const aim = aimRef.current || (tee && green
      ? getDefaultAim({ par, totalYards, teePt: tee, greenPt: green, geometry: holeGeometries[currentHole] })
      : null)
    if (tee && green && aim && layoutConfident) {
      if (!aimMarkerRef.current) {
        // 44px transparent hit area (touch-target min) wrapping a 26px visual.
        const el = document.createElement('div')
        el.style.cssText = 'width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:grab'
        el.innerHTML = '<div style="width:26px;height:26px;border-radius:50%;background:rgb(var(--tm-ee-gold-pulse-rgb) / 0.16);border:2px solid var(--tm-ee-gold-pulse);box-shadow:0 0 10px rgb(var(--tm-ee-gold-pulse-rgb) / 0.7);display:flex;align-items:center;justify-content:center"><div style="width:8px;height:8px;border-radius:50%;background:var(--tm-ee-gold-pulse)"></div></div>'
        aimMarkerRef.current = new gl.Marker({ element: el, draggable: true }).setLngLat([aim.lon, aim.lat]).addTo(map)
        aimMarkerRef.current.on('drag', () => {
          const ll = aimMarkerRef.current.getLngLat()
          aimRef.current = { lat: ll.lat, lon: ll.lng }
          redrawRef.current()
        })
        // Retarget the HUD's plays-like to the user aim on release (not per
        // drag frame — avoids re-rendering the HUD mid-drag). (2026-06-30, B)
        aimMarkerRef.current.on('dragend', () => { emitAimRef.current() })
      } else aimMarkerRef.current.setLngLat([aim.lon, aim.lat])
    } else if (aimMarkerRef.current) { aimMarkerRef.current.remove(); aimMarkerRef.current = null }

    redrawAim()
    emitAim()   // report the (default or hole-reset) aim to the HUD — userPlaced=false

    // cinematic course-up camera: bearing tee→green, pitched down the fairway.
    // Zoom adapts to hole length so the green stays on screen on long par 5s
    // (mirrors the Leaflet map's length-based zoom; a touch looser for pitch).
    const prefersReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (tee && green && layoutConfident) {
      const brg = calcBearing(tee, green)
      const mid = [(tee.lon + green.lon) / 2, (tee.lat + green.lat) / 2]
      const holeDist = haversineYards(tee, green) || 0
      const zoom = holeDist > 550 ? 16.2 : holeDist > 220 ? 16.8 : 17.4
      const cam = { center: mid, bearing: brg, pitch: prefersReduce ? 0 : 62, zoom }
      if (intro && !prefersReduce) map.flyTo({ ...cam, duration: 3200, essential: true, curve: 1.4 })
      else map.jumpTo(cam)
    } else if (green) {
      // Low-confidence layout: no trustworthy tee, so frame top-down on the
      // green (north-up, no fabricated course-up bearing) — an honest view.
      const cam = { center: [green.lon, green.lat], bearing: 0, pitch: 0, zoom: 16.6 }
      if (intro && !prefersReduce) map.flyTo({ ...cam, duration: 2000, essential: true })
      else map.jumpTo(cam)
    }
  }

  // ── Aim line (tee→aim→green) + segment yardages + club landing-zone ring ──
  // Segment labels are RAW great-circle distances (no scorecard scaling), with a
  // tee-offset correction for misplaced OSM tee nodes — recomputed as aim drags.
  function redrawAim() {
    const map = mapRef.current, gl = glRef.current
    if (!map || !readyRef.current || !gl) return
    const tee = holePositions[currentHole]
    const green = greenPositions[currentHole]
    const layoutConfident = Array.isArray(holeGeometries[currentHole]) && holeGeometries[currentHole].length >= 2
    const clearAll = () => {
      map.getSource('fairway')?.setData(fc([]))
      map.getSource('landing')?.setData(fc([]))
      // also clear the 2026-07-02 overlays so nothing goes stale on a hole with
      // missing tee/green data (drawBagArcs/drawRangeRings won't run below)
      map.getSource('bagArcBand')?.setData(fc([]))
      map.getSource('rangeRings')?.setData(fc([]))
      for (const m of ringLabelsRef.current) { try { m.remove() } catch { /* gone */ } }
      ringLabelsRef.current = []
      for (const r of [teeAimLabelRef, aimGreenLabelRef, landingLabelRef]) { if (r.current) { r.current.remove(); r.current = null } }
    }
    // No trustworthy tee-based line on a low-confidence (reconstructed) layout:
    // clear the tee→green line + its segment/ring labels. Green + GPS remain.
    if (!tee || !green || !layoutConfident) return clearAll()
    const meta = holeMeta()
    const totalYards = meta?.yardage ?? Math.round(haversineYards(tee, green) || 0)
    const par = meta?.par ?? 4
    const aim = aimRef.current || getDefaultAim({ par, totalYards, teePt: tee, greenPt: green, geometry: holeGeometries[currentHole] })
      || { lat: (tee.lat + green.lat) / 2, lon: (tee.lon + green.lon) / 2 }
    lastAimRef.current = aim   // shared with drawBagArcs (Phase 3.3)

    map.getSource('fairway')?.setData(fc([lineF([[tee.lon, tee.lat], [aim.lon, aim.lat], [green.lon, green.lat]])]))

    // RAW great-circle distances — what every rangefinder + the USGA use. NEVER
    // scale to the scorecard (that's a dogleg-path number; scaling to it compresses
    // distances and breaks PAST the green — the 219-for-a-435-shot bug). Small
    // safety `teeOffset`: if the app's tee→green comes out LONGER than the scorecard,
    // subtract the excess so tee→aim stays scorecard-consistent (fires only when it
    // reads long, so real doglegs aren't inflated). NOTE (verified 2026-07 from
    // tm_osm_cache): the OSM hole-6 LINE is accurate — tee→green ≈ 338 ≈ scorecard 335,
    // so any residual gap is a tee/green PARSING/matching artifact, NOT OSM being
    // wrong. aim→green stays fully raw (green-based, correct even past the green).
    const teeOffset = totalYards > 0 ? Math.max(0, (haversineYards(tee, green) || 0) - totalYards) : 0
    const teeAim = Math.max(0, Math.round((haversineYards(tee, aim) || 0) - teeOffset))
    const aimGreen = Math.round(haversineYards(aim, green) || 0)
    const mid = (p, q) => [(p.lon + q.lon) / 2, (p.lat + q.lat) / 2]
    // Labels are offset to the SIDES of the (course-up, ~vertical) line so they
    // never sit on the line/markers, and the two segment pills go on opposite
    // sides — the aim→green pill to the right so it clears the top-left HUD.
    const setLabel = (ref, text, primary, lnglat, anchor = 'center', offset = [0, 0]) => {
      if (!ref.current) ref.current = new gl.Marker({ element: pillEl(text, primary), anchor, offset }).setLngLat(lnglat).addTo(map)
      else { ref.current.getElement().textContent = text; ref.current.setLngLat(lnglat) }
    }
    // Bare outlined distance numbers (no pill / no units). Update the number
    // span in place on drag; recreate only when the flag state flips (rare) so
    // the flag can appear/disappear correctly.
    const setDistLabel = (ref, numText, toGreen, lnglat, anchor, offset) => {
      const cur = ref.current
      if (cur && cur.getElement().dataset.flag === String(toGreen)) {
        const n = cur.getElement().querySelector('.ee-dist-num'); if (n) n.textContent = numText
        cur.setLngLat(lnglat)
      } else {
        if (cur) cur.remove()
        const elm = distEl(numText, toGreen); elm.dataset.flag = String(toGreen)
        ref.current = new gl.Marker({ element: elm, anchor, offset }).setLngLat(lnglat).addTo(map)
      }
    }
    // On a par 3 (or any time the aim sits on the green) the aim→green distance
    // is ~0 and meaningless — show ONLY the to-pin number, with the flag on it.
    const aimAtGreen = aimGreen <= 2
    setDistLabel(teeAimLabelRef, `${teeAim}`, aimAtGreen, mid(tee, aim), 'right', [-10, 0])
    if (!aimAtGreen) {
      setDistLabel(aimGreenLabelRef, `${aimGreen}`, true, mid(aim, green), 'left', [10, 0])
    } else if (aimGreenLabelRef.current) {
      aimGreenLabelRef.current.remove(); aimGreenLabelRef.current = null
    }

    // landing-zone ring: single selected club from the player along player→aim.
    // Suppressed while in bag-arcs mode (Phase 3.3) so the two never double up.
    const club = clubRef.current
    const g = gpsRef.current
    const onCourse = g && g.lat != null && geocoded && haversineYards(g, geocoded) < 8800
    const player = onCourse ? { lat: g.lat, lon: g.lon } : tee
    const yards = Number(club?.yards)
    if (!bagArcsRef.current?.length && Number.isFinite(yards) && yards > 0) {
      const brng = calcBearing(player, aim)
      if (Number.isFinite(brng)) {
        const landing = projectByYards(player, brng, yards)
        // Honest landing ZONE (2026-07-02): the dispersionEllipse model (1 SD ≈ 5%
        // of distance, short-skewed toward the player) replaces the old fixed
        // 11-yd circle, which asserted the same precision for a wedge and a
        // driver. "~" on the label = model estimate, never a measured figure.
        map.getSource('landing')?.setData(fc([polyF(dispersionZonePolygon(landing, brng, dispersionEllipse(yards)))]))
        setLabel(landingLabelRef, club.label ? `${club.label} · ~${yards}y` : `~${yards}y`, false, [landing.lon, landing.lat], 'left', [16, 0])
      }
    } else {
      map.getSource('landing')?.setData(fc([]))
      if (landingLabelRef.current) { landingLabelRef.current.remove(); landingLabelRef.current = null }
    }
    drawBagArcs(player)
    drawRangeRings(player)
  }
  redrawRef.current = redrawAim

  // ── "Map this course" editor overlays redraw (2026-07-10) ──
  // Paints the three edit sources from the live edit refs (kept current by the
  // effects near the top). GUARDED: when editMode is off all three sources are
  // emptied, so normal mode stays pixel-identical. Function declaration +
  // assign-after-declaration mirrors the redrawRef/redrawAim contract above
  // (no-use-before-define safe: the mount-time redrawEditRef.current() calls
  // run post-render / at map load, after this assignment).
  function redrawEdit() {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (!editModeRef.current) {
      map.getSource('editCand')?.setData(fc([]))
      map.getSource('editLine')?.setData(fc([]))
      map.getSource('editPts')?.setData(fc([]))
      return
    }
    const cand = editCandRef.current
    const candFeats = []
    for (const t of cand?.tees || []) candFeats.push({ type: 'Feature', properties: { kind: 'tee' }, geometry: { type: 'Point', coordinates: [t.lon, t.lat] } })
    for (const g of cand?.greens || []) candFeats.push({ type: 'Feature', properties: { kind: 'green' }, geometry: { type: 'Point', coordinates: [g.lon, g.lat] } })
    map.getSource('editCand')?.setData(fc(candFeats))
    const draft = editDraftRef.current
    const pts = []
    if (draft?.tee) pts.push({ type: 'Feature', properties: { color: eeColor('--tm-ee-gold', null, '#C9A040') }, geometry: { type: 'Point', coordinates: [draft.tee.lon, draft.tee.lat] } })
    if (draft?.green) pts.push({ type: 'Feature', properties: { color: eeColor('--tm-ee-green', null, '#5ED47A') }, geometry: { type: 'Point', coordinates: [draft.green.lon, draft.green.lat] } })
    map.getSource('editPts')?.setData(fc(pts))
    map.getSource('editLine')?.setData(
      draft?.tee && draft?.green
        ? fc([lineF([[draft.tee.lon, draft.tee.lat], [draft.green.lon, draft.green.lat]])])
        : fc([])
    )
  }
  redrawEditRef.current = redrawEdit

  // Report the current aim up to the parent (Option B). userPlaced=false for the
  // auto-default (par-aware layup / green); true once the golfer drags it. Yards
  // are the same split-proportional values the on-map pills show. Called on
  // default draw + on dragend (not per drag frame). (2026-06-30)
  function emitAim() {
    const cb = onAimChangeRef.current
    if (!cb) return
    const tee = holePositions[currentHole]
    const green = greenPositions[currentHole]
    if (!tee || !green) { cb(null); return }
    const meta = holeMeta()
    const totalYards = meta?.yardage ?? Math.round(haversineYards(tee, green) || 0)
    const par = meta?.par ?? 4
    const aim = aimRef.current || getDefaultAim({ par, totalYards, teePt: tee, greenPt: green, geometry: holeGeometries[currentHole] })
      || { lat: (tee.lat + green.lat) / 2, lon: (tee.lon + green.lon) / 2 }
    // Raw great-circle + tee-offset correction (same as redrawAim); no scorecard
    // scaling — so the Option-B "TO AIM" hero is correct even past the green.
    const teeOffset = totalYards > 0 ? Math.max(0, (haversineYards(tee, green) || 0) - totalYards) : 0
    cb({
      userPlaced: aimRef.current != null,
      teeAimYds: Math.max(0, Math.round((haversineYards(tee, aim) || 0) - teeOffset)),
      aimGreenYds: Math.round(haversineYards(aim, green) || 0),
      aim,
    })
  }
  emitAimRef.current = emitAim

  const ARC_HALF_DEG = 26
  // A curved arc of `radiusYards` from `center`, swept ±ARC_HALF_DEG around
  // `bearingDeg`. Returns LineString coords [[lon,lat],…].
  function arcCoords(center, bearingDeg, radiusYards, halfAngleDeg = ARC_HALF_DEG, n = 28) {
    const pts = []
    for (let i = 0; i <= n; i++) {
      const b = bearingDeg - halfAngleDeg + (2 * halfAngleDeg) * (i / n)
      const p = projectByYards(center, b, radiusYards)
      pts.push([p.lon, p.lat])
    }
    return pts
  }

  // ── Bag arcs (Phase 3.3, rebuilt 2026-06-26): the player's real clubs as
  // labeled DISTANCE ARCS swept across the line of play (player→green). Anchored
  // at the player on course, else the tee — so the arcs render reliably whether
  // or not GPS has locked. The best-match club is highlighted. Labels recreated
  // each redraw (the set is ≤6, decluttered upstream by arcClubs). ──
  function drawBagArcs(player) {
    const map = mapRef.current, gl = glRef.current
    if (!map || !readyRef.current || !gl) return
    for (const m of bagLabelsRef.current) { try { m.remove() } catch { /* gone */ } }
    bagLabelsRef.current = []
    const clubs = bagArcsRef.current
    const target = greenPositions[currentHole] || lastAimRef.current
    const clearArcs = () => { map.getSource('bagArcs')?.setData(fc([])); map.getSource('bagArcBand')?.setData(fc([])) }
    if (!Array.isArray(clubs) || !clubs.length || !player || !target) { clearArcs(); return }
    const brng = calcBearing(player, target)
    if (!Number.isFinite(brng)) { clearArcs(); return }
    // Dispersion band on the HIGHLIGHTED club only (one honest zone at a time —
    // spec risk D2/D1): annular sector between yards − depth×shortSkew (misses
    // are mostly short) and yards + depth, rendered as a soft feathered fill.
    const hi = clubs.find(c => c.highlight && Number.isFinite(Number(c.yards)) && Number(c.yards) > 0)
    map.getSource('bagArcBand')?.setData(hi
      ? fc([polyF(arcBandPolygon(player, brng, Number(hi.yards), dispersionEllipse(Number(hi.yards)), ARC_HALF_DEG - 2))])
      : fc([]))
    const feats = []
    for (const c of clubs) {
      const y = Number(c?.yards)
      if (!Number.isFinite(y) || y <= 0) continue
      feats.push({ type: 'Feature', properties: { highlight: !!c.highlight }, geometry: { type: 'LineString', coordinates: arcCoords(player, brng, y) } })
      // Collision-aware label side: default to the LEFT end of the arc (open
      // fairway, clear of the right-edge ARCS/BAG buttons). But if that apex
      // projects into the top-left distance-card zone, flip the label to the
      // RIGHT end so it isn't hidden behind the card. (2026-06-26)
      let side = -1 // -1 = left, +1 = right
      try {
        const sp = map.project([projectByYards(player, brng, y).lon, projectByYards(player, brng, y).lat])
        const cw = map.getContainer().clientWidth, ch = map.getContainer().clientHeight
        if (sp && sp.y < ch * 0.50 && sp.x < cw * 0.50) side = +1 // would sit under the card → go right
      } catch { /* projection unavailable → keep left */ }
      const labelPt = projectByYards(player, brng + side * (ARC_HALF_DEG - 3), y)
      const el = pillEl(`${c.label ? c.label + ' · ' : ''}${Math.round(y)}y`, !!c.highlight)
      bagLabelsRef.current.push(new gl.Marker({ element: el, anchor: side > 0 ? 'left' : 'right', offset: [side > 0 ? 6 : -6, 0] }).setLngLat([labelPt.lon, labelPt.lat]).addTo(map))
    }
    map.getSource('bagArcs')?.setData(fc(feats))
  }

  // ── Layup range-arcs (2.5, 2026-07-02): 100/150/200/250 TO THE GREEN, swept
  // across the line of play around the green→player bearing. The market-
  // validated semantic ("what do I leave myself?") — NOT player-centered
  // concentric circles (documented clutter anti-pattern). Opt-in via the RINGS
  // toggle; only rings meaningfully between the player and the green draw. ──
  function drawRangeRings(player) {
    const map = mapRef.current, gl = glRef.current
    if (!map || !readyRef.current || !gl) return
    for (const m of ringLabelsRef.current) { try { m.remove() } catch { /* gone */ } }
    ringLabelsRef.current = []
    const green = greenPositions[currentHole]
    const clear = () => map.getSource('rangeRings')?.setData(fc([]))
    if (!ringsOnRef.current || !green || !player) return clear()
    const dist = haversineYards(player, green)
    const brng = calcBearing(green, player)   // arcs open back toward the player
    const rings = layupRingsInPlay(dist)
    if (!Number.isFinite(brng) || !rings.length) return clear()
    const feats = []
    for (const r of rings) {
      feats.push(lineF(arcCoords(green, brng, r, 30)))
      // small chip at the arc's RIGHT end (bag-arc labels default left — D7)
      const lp = projectByYards(green, brng + 27, r)
      const el = pillEl(String(r), false)
      ringLabelsRef.current.push(new gl.Marker({ element: el, anchor: 'left', offset: [6, 0] }).setLngLat([lp.lon, lp.lat]).addTo(map))
    }
    map.getSource('rangeRings')?.setData(fc(feats))
  }

  // ── Smooth player puck + true-ground accuracy halo ──
  function syncPuck() {
    const map = mapRef.current, gl = glRef.current
    if (!map || !readyRef.current || !gl) return
    const g = gpsRef.current
    if (!g || g.lat == null || !geocoded) return
    const dist = haversineYards(g, geocoded)
    if (dist == null || dist > 8800) return            // not on this course
    const target = { lat: g.lat, lon: g.lon }
    const accYds = (typeof g.acc === 'number' && g.acc > 0) ? g.acc / 0.9144 : null

    if (!puckRef.current) {
      const el = document.createElement('div')
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:var(--tm-ee-gold-light);border:3px solid #fff;box-shadow:0 0 10px rgb(var(--tm-ee-gold-light-rgb) / 0.9)'
      puckRef.current = new gl.Marker({ element: el }).setLngLat([target.lon, target.lat]).addTo(map)
      puckPosRef.current = target
    }
    const setHalo = (c) => map.getSource('halo')?.setData(accYds ? fc([polyF(ringCoords(c, accYds))]) : fc([]))
    const from = puckPosRef.current || target
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || (from.lat === target.lat && from.lon === target.lon)) {
      puckRef.current.setLngLat([target.lon, target.lat]); setHalo(target); puckPosRef.current = target; return
    }
    const start = performance.now(), DUR = 700
    cancelAnimationFrame(puckRafRef.current)
    const tick = (now) => {
      const t = Math.min(1, (now - start) / DUR)
      const e = 1 - Math.pow(1 - t, 3)
      const lat = from.lat + (target.lat - from.lat) * e
      const lon = from.lon + (target.lon - from.lon) * e
      puckPosRef.current = { lat, lon }
      try { puckRef.current?.setLngLat([lon, lat]); setHalo({ lat, lon }) } catch { /* gone */ }
      if (t < 1) puckRafRef.current = requestAnimationFrame(tick)
    }
    puckRafRef.current = requestAnimationFrame(tick)
  }

  // redraw overlays + recentre when the hole or its OSM data changes
  useEffect(() => {
    const isNewHole = lastHoleRef.current !== currentHole
    lastHoleRef.current = currentHole
    if (isNewHole) aimRef.current = null   // each hole starts at its default aim
    drawHole(isNewHole)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHole, holePositions, greenPositions, holeGeometries])

  // refresh the aim line + landing ring when the selected club changes
  useEffect(() => { redrawRef.current() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubYards, clubLabel])

  // move the puck on each GPS fix
  useEffect(() => { syncPuck() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps?.lat, gps?.lon, gps?.acc])

  // Genuine init/load failure (no fallback renderer anymore) → a graceful,
  // on-brand retry rather than a blank map. Almost never hit in the shipped
  // iOS app (WKWebView on iOS 15+ has WebGL2); the realistic trigger is a
  // transient network failure loading the map chunk or tiles.
  if (failed) return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--tm-ee-map-bg)', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
      <div style={{ color: 'rgb(var(--tm-ee-white-rgb) / 0.6)', fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>
        The course map didn’t load.<br />Check your connection and try again.
      </div>
      <button onClick={() => window.location.reload()} style={{
        background: 'linear-gradient(135deg, var(--tm-ee-gold), var(--tm-ee-gold-bright))', border: '1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.85)',
        borderRadius: 999, padding: '10px 22px', color: 'var(--tm-ee-bg)', fontWeight: 900, fontSize: 13,
        letterSpacing: '0.04em', cursor: 'pointer',
        boxShadow: '0 8px 22px rgb(var(--tm-ee-gold-rgb) / 0.45), inset 0 1px 0 rgb(var(--tm-ee-white-rgb) / 0.5)' }}>
        Retry
      </button>
    </div>
  )

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <style>{`
        .ee-gl-pop .maplibregl-popup-content{background:rgb(var(--tm-ee-bg-rgb) / 0.92);color:#fff;font-weight:800;font-size:12px;
          font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:4px 10px;border-radius:999px;
          border:1px solid rgb(var(--tm-ee-white-rgb) / 0.55);box-shadow:0 2px 8px rgb(var(--tm-ee-black-rgb) / 0.55);white-space:nowrap}
        .ee-gl-pop .maplibregl-popup-tip{display:none}
        .maplibregl-ctrl-group{background:rgb(var(--tm-ee-bg-rgb) / 0.66)!important;border:none!important;border-radius:14px!important;
          box-shadow:0 6px 18px rgb(var(--tm-ee-black-rgb) / 0.45)!important;overflow:hidden;backdrop-filter:blur(14px) saturate(150%)}
        .maplibregl-ctrl-group button{background:transparent!important;width:34px!important;height:34px!important}
        .maplibregl-ctrl-group button+button{border-top:1px solid rgb(var(--tm-ee-gold-light-rgb) / 0.18)!important}
        .maplibregl-ctrl-group button .maplibregl-ctrl-icon{filter:invert(78%) sepia(38%) saturate(560%) hue-rotate(2deg) brightness(101%)}
        .maplibregl-ctrl-attrib{background:rgb(var(--tm-ee-bg-rgb) / 0.50)!important;color:rgb(var(--tm-ee-white-rgb) / 0.45)!important}
        .maplibregl-ctrl-attrib a{color:rgb(var(--tm-ee-gold-light-rgb) / 0.65)!important}
        .maplibregl-canvas{outline:none}
        /* Push the zoom control to the mid-left so it clears the top-left
           glass instrument card (was hidden behind it). Mirrors the Leaflet
           map's mid-left zoom placement. */
        .maplibregl-ctrl-top-left{top:42%!important}
      `}</style>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: 'var(--tm-ee-map-bg)' }} />
    </div>
  )
}
