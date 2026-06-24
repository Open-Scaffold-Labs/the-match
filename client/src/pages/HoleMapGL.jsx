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

export default function HoleMapGL({
  courseCtx, currentHole, gps, geocoded,
  holePositions = {}, greenPositions = {}, holeGeometries = {},
  onInitError,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const glRef = useRef(null)          // the maplibregl namespace once imported
  const readyRef = useRef(false)
  const teeMarkerRef = useRef(null)
  const greenMarkerRef = useRef(null)
  const puckRef = useRef(null)        // DOM marker for the player
  const puckRafRef = useRef(0)
  const puckPosRef = useRef(null)
  const lastHoleRef = useRef(null)
  const [failed, setFailed] = useState(false)

  // live snapshots so the (once-attached) click handler reads fresh values
  const gpsRef = useRef(gps)
  const greenRef = useRef(null)
  useEffect(() => { gpsRef.current = gps }, [gps])

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
      try { maplibregl = (await import('maplibre-gl')).default } catch (e) { return fail(e) }
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
      loadTimer = setTimeout(() => { if (!readyRef.current) fail(new Error('map load timeout (9s)')) }, 9000)
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

  // ── Draw / update the hole overlays + cinematic camera ──
  function drawHole(intro) {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const tee = holePositions[currentHole]
    const green = greenPositions[currentHole]
    greenRef.current = green || null
    const geom = holeGeometries[currentHole]

    // fairway / aim line: walk the OSM centreline when present, else tee→green
    let line = null
    if (Array.isArray(geom) && geom.length >= 2) line = geom.map(p => [p.lon, p.lat])
    else if (tee && green) line = [[tee.lon, tee.lat], [green.lon, green.lat]]
    map.getSource('fairway')?.setData(line ? fc([lineF(line)]) : fc([]))
    map.getSource('green')?.setData(green ? fc([polyF(ringCoords(green, 13))]) : fc([]))

    // tee + green DOM markers
    const gl = glRef.current
    if (tee) {
      if (!teeMarkerRef.current) {
        const el = document.createElement('div')
        el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#C9A040;border:2px solid #fff;box-shadow:0 0 8px rgba(201,160,64,0.8)'
        teeMarkerRef.current = new gl.Marker({ element: el }).setLngLat([tee.lon, tee.lat]).addTo(map)
      } else teeMarkerRef.current.setLngLat([tee.lon, tee.lat])
    } else if (teeMarkerRef.current) { teeMarkerRef.current.remove(); teeMarkerRef.current = null }
    if (green) {
      if (!greenMarkerRef.current) {
        const el = document.createElement('div')
        el.style.cssText = 'width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:18px solid #E24B4A;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6))'
        greenMarkerRef.current = new gl.Marker({ element: el, anchor: 'bottom' }).setLngLat([green.lon, green.lat]).addTo(map)
      } else greenMarkerRef.current.setLngLat([green.lon, green.lat])
    } else if (greenMarkerRef.current) { greenMarkerRef.current.remove(); greenMarkerRef.current = null }

    // cinematic course-up camera: bearing tee→green, pitched down the fairway
    if (tee && green) {
      const brg = calcBearing(tee, green)
      const mid = [(tee.lon + green.lon) / 2, (tee.lat + green.lat) / 2]
      const prefersReduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const cam = { center: mid, bearing: brg, pitch: prefersReduce ? 0 : 62, zoom: 17.2 }
      if (intro && !prefersReduce) map.flyTo({ ...cam, duration: 3200, essential: true, curve: 1.4 })
      else map.jumpTo(cam)
    }
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
    drawHole(isNewHole)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHole, holePositions, greenPositions, holeGeometries])

  // move the puck on each GPS fix
  useEffect(() => { syncPuck() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps?.lat, gps?.lon, gps?.acc])

  if (failed) return null   // parent swaps in the Leaflet map

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
      `}</style>
      <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#0c1a10' }} />
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 5,
        background: 'rgba(7,12,9,0.8)', borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#F5D78A', boxShadow: '0 0 6px #F5D78A' }} />
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11 }}>Your position</span>
      </div>
    </div>
  )
}
