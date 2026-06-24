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

const NAIP_TILES = 'https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/tile/{z}/{y}/{x}'

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
  el.style.cssText = `background:${primary ? 'rgba(7,12,9,0.95)' : 'rgba(7,12,9,0.82)'};color:#fff;`
    + `font-weight:800;font-size:${primary ? 14 : 12}px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;`
    + `padding:${primary ? '4px 11px' : '3px 9px'};border-radius:999px;white-space:nowrap;`
    + `border:1px solid rgba(255,255,255,0.45);box-shadow:0 2px 8px rgba(0,0,0,0.5)`
  el.textContent = text
  return el
}

export default function HoleMapGL({
  courseCtx, currentHole, gps, geocoded,
  holePositions = {}, greenPositions = {}, holeGeometries = {}, greenPolys = {},
  clubYards = null, clubLabel = null,
  onInitError,
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
  const [failed, setFailed] = useState(false)

  // live snapshots so once-attached handlers (click, drag) read fresh values
  const gpsRef = useRef(gps)
  const greenRef = useRef(null)
  const clubRef = useRef({ yards: clubYards, label: clubLabel })
  useEffect(() => { gpsRef.current = gps }, [gps])
  useEffect(() => { clubRef.current = { yards: clubYards, label: clubLabel } }, [clubYards, clubLabel])

  // ── Init the map once we know where the course is ──
  useEffect(() => {
    if (!containerRef.current || !geocoded || mapRef.current) return
    let cancelled = false
    let loadTimer = 0
    const fail = (e) => {
      if (cancelled) return
      console.error('[HoleMapGL] init failed:', e?.message || e)
      clearTimeout(loadTimer)
      setFailed(true)
      onInitError?.()
    }
    ;(async () => {
      let maplibregl
      try { maplibregl = await importMaplibre() } catch (e) { return fail(e) }
      if (cancelled || !containerRef.current) return
      glRef.current = maplibregl
      let map
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: { naip: { type: 'raster', tiles: [NAIP_TILES], tileSize: 256, maxzoom: 18, attribution: 'Imagery: USDA NAIP' } },
            layers: [
              { id: 'bg', type: 'background', paint: { 'background-color': '#0c1a10' } },
              { id: 'naip', type: 'raster', source: 'naip' },
              { id: 'tint', type: 'background', paint: { 'background-color': '#0E3B23', 'background-opacity': 0.05 } },
            ],
          },
          center: lngLat(geocoded), zoom: 16, pitch: 0, bearing: 0,
          attributionControl: false, dragRotate: false, pitchWithRotate: false,
          maxPitch: 75, fadeDuration: 120,
        })
      } catch (e) { return fail(e) }
      mapRef.current = map
      // Silent-stall guard: if the style/tiles never reach 'load' (the failure
      // mode where MapLibre constructs but renders nothing, with no error
      // event), fall back to Leaflet rather than leave a black map.
      // 20s, not 9s: a cold first load downloads the ~284KB maplibre chunk +
      // NAIP tiles, which can exceed 9s on a slow link and was tripping a
      // spurious fallback to Leaflet (then sticking for the session). 20s only
      // fires on a genuine stall.
      loadTimer = setTimeout(() => { if (!readyRef.current) fail(new Error('map load timeout (20s)')) }, 20000)
      map.on('error', (e) => { /* tile errors are non-fatal; only log */ if (e?.error) console.warn('[HoleMapGL]', e.error.message) })
      map.addControl(new maplibregl.AttributionControl({ compact: true }))
      map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-left')

      map.on('load', () => {
        if (cancelled) return
        clearTimeout(loadTimer)
        readyRef.current = true
        // overlay sources
        map.addSource('fairway', { type: 'geojson', data: fc([]) })
        map.addSource('green', { type: 'geojson', data: fc([]) })
        map.addSource('halo', { type: 'geojson', data: fc([]) })
        map.addLayer({ id: 'fairway-glow', type: 'line', source: 'fairway', paint: { 'line-color': '#F5E070', 'line-width': 7, 'line-opacity': 0.22, 'line-blur': 4 }, layout: { 'line-cap': 'round' } })
        map.addLayer({ id: 'fairway', type: 'line', source: 'fairway', paint: { 'line-color': '#F5E070', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [2, 1.4] }, layout: { 'line-cap': 'round' } })
        map.addLayer({ id: 'green-fill', type: 'fill', source: 'green', paint: { 'fill-color': '#5ED47A', 'fill-opacity': 0.20 } })
        map.addLayer({ id: 'green-line', type: 'line', source: 'green', paint: { 'line-color': '#5ED47A', 'line-width': 2, 'line-opacity': 0.85 } })
        map.addLayer({ id: 'halo-fill', type: 'fill', source: 'halo', paint: { 'fill-color': '#F5D78A', 'fill-opacity': 0.08 } })
        map.addLayer({ id: 'halo-line', type: 'line', source: 'halo', paint: { 'line-color': '#F5D78A', 'line-width': 1, 'line-opacity': 0.30 } })
        map.addSource('landing', { type: 'geojson', data: fc([]) })
        map.addLayer({ id: 'landing-fill', type: 'fill', source: 'landing', paint: { 'fill-color': '#F5E070', 'fill-opacity': 0.30 } })
        map.addLayer({ id: 'landing-line', type: 'line', source: 'landing', paint: { 'line-color': '#F5E070', 'line-width': 2.5, 'line-opacity': 0.95 } })

        // tap-to-measure: carry from player + distance to green at the tapped point
        map.on('click', (e) => {
          const tap = { lat: e.lngLat.lat, lon: e.lngLat.lng }
          const g = gpsRef.current
          const player = (g && g.lat != null) ? { lat: g.lat, lon: g.lon } : null
          const grn = greenRef.current
          const carry = player ? haversineYards(player, tap) : null
          const toGreen = grn ? haversineYards(tap, grn) : null
          if (carry == null && toGreen == null) return
          const txt = (carry != null && toGreen != null) ? `${carry}y · ${toGreen} to grn`
            : (carry != null) ? `${carry}y` : `${toGreen}y to grn`
          new glRef.current.Popup({ closeButton: false, className: 'ee-gl-pop', offset: 10 })
            .setLngLat([tap.lon, tap.lat]).setHTML(`<span>${txt}</span>`).addTo(map)
        })

        drawHole(true)
        syncPuck()
      })
    })()
    return () => {
      cancelled = true
      clearTimeout(loadTimer)
      cancelAnimationFrame(puckRafRef.current)
      readyRef.current = false
      if (mapRef.current) { try { mapRef.current.remove() } catch { /* gone */ } mapRef.current = null }
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

    // tee + green DOM markers
    if (tee) {
      if (!teeMarkerRef.current) {
        const el = document.createElement('div')
        el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#C9A040;border:2px solid #fff;box-shadow:0 0 8px rgba(201,160,64,0.8)'
        teeMarkerRef.current = new gl.Marker({ element: el }).setLngLat([tee.lon, tee.lat]).addTo(map)
      } else teeMarkerRef.current.setLngLat([tee.lon, tee.lat])
    } else if (teeMarkerRef.current) { teeMarkerRef.current.remove(); teeMarkerRef.current = null }
    if (green) {
      if (!greenMarkerRef.current) {
        // Red pin-flag (matches the Leaflet map's flag), anchored at the pole base.
        const el = document.createElement('div')
        el.style.cssText = 'width:22px;height:28px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6))'
        el.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><line x1="4" y1="2" x2="4" y2="27" stroke="white" stroke-width="1.8" stroke-linecap="round"/><polygon points="4,2 20,8 4,14" fill="#E53935" stroke="white" stroke-width="0.8"/><circle cx="4" cy="27" r="2.5" fill="#E53935" stroke="white" stroke-width="1.2"/></svg>'
        greenMarkerRef.current = new gl.Marker({ element: el, anchor: 'bottom', offset: [7, 0] }).setLngLat([green.lon, green.lat]).addTo(map)
      } else greenMarkerRef.current.setLngLat([green.lon, green.lat])
    } else if (greenMarkerRef.current) { greenMarkerRef.current.remove(); greenMarkerRef.current = null }

    // draggable aim target (par-aware default, drag to re-plan the line)
    const aim = aimRef.current || (tee && green
      ? getDefaultAim({ par, totalYards, teePt: tee, greenPt: green, geometry: holeGeometries[currentHole] })
      : null)
    if (tee && green && aim) {
      if (!aimMarkerRef.current) {
        // 44px transparent hit area (touch-target min) wrapping a 26px visual.
        const el = document.createElement('div')
        el.style.cssText = 'width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:grab'
        el.innerHTML = '<div style="width:26px;height:26px;border-radius:50%;background:rgba(245,224,112,0.16);border:2px solid #F5E070;box-shadow:0 0 10px rgba(245,224,112,0.7);display:flex;align-items:center;justify-content:center"><div style="width:8px;height:8px;border-radius:50%;background:#F5E070"></div></div>'
        aimMarkerRef.current = new gl.Marker({ element: el, draggable: true }).setLngLat([aim.lon, aim.lat]).addTo(map)
        aimMarkerRef.current.on('drag', () => {
          const ll = aimMarkerRef.current.getLngLat()
          aimRef.current = { lat: ll.lat, lon: ll.lng }
          redrawRef.current()
        })
      } else aimMarkerRef.current.setLngLat([aim.lon, aim.lat])
    } else if (aimMarkerRef.current) { aimMarkerRef.current.remove(); aimMarkerRef.current = null }

    redrawAim()

    // cinematic course-up camera: bearing tee→green, pitched down the fairway.
    // Zoom adapts to hole length so the green stays on screen on long par 5s
    // (mirrors the Leaflet map's length-based zoom; a touch looser for pitch).
    if (tee && green) {
      const brg = calcBearing(tee, green)
      const mid = [(tee.lon + green.lon) / 2, (tee.lat + green.lat) / 2]
      const holeDist = haversineYards(tee, green) || 0
      const zoom = holeDist > 550 ? 16.2 : holeDist > 220 ? 16.8 : 17.4
      const prefersReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const cam = { center: mid, bearing: brg, pitch: prefersReduce ? 0 : 62, zoom }
      if (intro && !prefersReduce) map.flyTo({ ...cam, duration: 3200, essential: true, curve: 1.4 })
      else map.jumpTo(cam)
    }
  }

  // ── Aim line (tee→aim→green) + split yardages + club landing-zone ring ──
  // Split-proportional so the two pills always sum to the official hole
  // yardage. Recomputed live as the aim target is dragged.
  function redrawAim() {
    const map = mapRef.current, gl = glRef.current
    if (!map || !readyRef.current || !gl) return
    const tee = holePositions[currentHole]
    const green = greenPositions[currentHole]
    const clearAll = () => {
      map.getSource('fairway')?.setData(fc([]))
      map.getSource('landing')?.setData(fc([]))
      for (const r of [teeAimLabelRef, aimGreenLabelRef, landingLabelRef]) { if (r.current) { r.current.remove(); r.current = null } }
    }
    if (!tee || !green) return clearAll()
    const meta = holeMeta()
    const totalYards = meta?.yardage ?? Math.round(haversineYards(tee, green) || 0)
    const par = meta?.par ?? 4
    const aim = aimRef.current || getDefaultAim({ par, totalYards, teePt: tee, greenPt: green, geometry: holeGeometries[currentHole] })
      || { lat: (tee.lat + green.lat) / 2, lon: (tee.lon + green.lon) / 2 }

    map.getSource('fairway')?.setData(fc([lineF([[tee.lon, tee.lat], [aim.lon, aim.lat], [green.lon, green.lat]])]))

    const a = haversineYards(tee, aim) || 0
    const b = haversineYards(aim, green) || 0
    const tot = (a + b) || 1
    const teeAim = Math.round((a / tot) * totalYards)
    const aimGreen = Math.round((b / tot) * totalYards)
    const mid = (p, q) => [(p.lon + q.lon) / 2, (p.lat + q.lat) / 2]
    // Labels are offset to the SIDES of the (course-up, ~vertical) line so they
    // never sit on the line/markers, and the two segment pills go on opposite
    // sides — the aim→green pill to the right so it clears the top-left HUD.
    const setLabel = (ref, text, primary, lnglat, anchor = 'center', offset = [0, 0]) => {
      if (!ref.current) ref.current = new gl.Marker({ element: pillEl(text, primary), anchor, offset }).setLngLat(lnglat).addTo(map)
      else { ref.current.getElement().textContent = text; ref.current.setLngLat(lnglat) }
    }
    setLabel(teeAimLabelRef, `${teeAim}y`, false, mid(tee, aim), 'right', [-10, 0])
    setLabel(aimGreenLabelRef, `${aimGreen} to grn`, true, mid(aim, green), 'left', [10, 0])

    // landing-zone ring: club distance from the player along player→aim
    const club = clubRef.current
    const g = gpsRef.current
    const onCourse = g && g.lat != null && geocoded && haversineYards(g, geocoded) < 8800
    const player = onCourse ? { lat: g.lat, lon: g.lon } : tee
    const yards = Number(club?.yards)
    if (Number.isFinite(yards) && yards > 0) {
      const brng = calcBearing(player, aim)
      if (Number.isFinite(brng)) {
        const landing = projectByYards(player, brng, yards)
        map.getSource('landing')?.setData(fc([polyF(ringCoords(landing, 11))]))
        setLabel(landingLabelRef, club.label ? `${club.label} · ${yards}y` : `${yards}y`, false, [landing.lon, landing.lat], 'left', [16, 0])
        return
      }
    }
    map.getSource('landing')?.setData(fc([]))
    if (landingLabelRef.current) { landingLabelRef.current.remove(); landingLabelRef.current = null }
  }
  redrawRef.current = redrawAim

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
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#F5D78A;border:3px solid #fff;box-shadow:0 0 10px rgba(245,215,138,0.9)'
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
    <div style={{ position: 'absolute', inset: 0, background: '#0c1a10', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
      <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: 600, lineHeight: 1.5 }}>
        The course map didn’t load.<br />Check your connection and try again.
      </div>
      <button onClick={() => window.location.reload()} style={{
        background: 'linear-gradient(135deg, #C9A040, #E8C05A)', border: '1px solid rgba(245,215,138,0.85)',
        borderRadius: 999, padding: '10px 22px', color: '#070C09', fontWeight: 900, fontSize: 13,
        letterSpacing: '0.04em', cursor: 'pointer',
        boxShadow: '0 8px 22px rgba(201,160,64,0.45), inset 0 1px 0 rgba(255,255,255,0.5)' }}>
        Retry
      </button>
    </div>
  )

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <style>{`
        .ee-gl-pop .maplibregl-popup-content{background:rgba(7,12,9,0.92);color:#fff;font-weight:800;font-size:12px;
          font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:4px 10px;border-radius:999px;
          border:1px solid rgba(255,255,255,0.55);box-shadow:0 2px 8px rgba(0,0,0,0.55);white-space:nowrap}
        .ee-gl-pop .maplibregl-popup-tip{display:none}
        .maplibregl-ctrl-group{background:rgba(7,12,9,0.66)!important;border:none!important;border-radius:14px!important;
          box-shadow:0 6px 18px rgba(0,0,0,0.45)!important;overflow:hidden;backdrop-filter:blur(14px) saturate(150%)}
        .maplibregl-ctrl-group button{background:transparent!important;width:34px!important;height:34px!important}
        .maplibregl-ctrl-group button+button{border-top:1px solid rgba(245,215,138,0.18)!important}
        .maplibregl-ctrl-group button .maplibregl-ctrl-icon{filter:invert(78%) sepia(38%) saturate(560%) hue-rotate(2deg) brightness(101%)}
        .maplibregl-ctrl-attrib{background:rgba(7,12,9,0.50)!important;color:rgba(255,255,255,0.45)!important}
        .maplibregl-ctrl-attrib a{color:rgba(245,215,138,0.65)!important}
        .maplibregl-canvas{outline:none}
        /* Push the zoom control to the mid-left so it clears the top-left
           glass instrument card (was hidden behind it). Mirrors the Leaflet
           map's mid-left zoom placement. */
        .maplibregl-ctrl-top-left{top:42%!important}
      `}</style>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#0c1a10' }} />
    </div>
  )
}
