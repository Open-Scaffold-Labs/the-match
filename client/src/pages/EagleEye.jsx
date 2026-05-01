import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../lib/api.js'
import { log } from '../lib/logger.js'

// Module-level cache: keyed by `${courseId}-${teeName}` — survives re-renders,
// cleared only on page reload. Means switching holes is instant after first load.
const osmPositionCache = new Map()

// ─── localStorage persistence for OSM data (7-day TTL) ───────────────────────
// After the first load of a course, pins are instant on every subsequent visit.
const OSM_LS_TTL = 7 * 24 * 60 * 60 * 1000
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
function dedupeTees(teesObj) {
  const out = []
  const seen = new Set()
  for (const t of (teesObj?.male || [])) {
    const key = `${t.tee_name}|${t.total_yards}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  for (const t of (teesObj?.female || [])) {
    const key = `${t.tee_name}|${t.total_yards}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...t, tee_name: `${t.tee_name} (W)` })
  }
  return out
}

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

// ─── Satellite hole map (Leaflet + ESRI tiles + OSM hole positions) ──────────
// geocoded, holePositions, greenPositions fetched by parent EagleEye and passed as props
function HoleMap({ courseCtx, currentHole, gps, geocoded, holePositions = {}, greenPositions = {} }) {
  const containerRef      = useRef(null)
  const mapRef            = useRef(null)
  const markerRef         = useRef(null)   // GPS dot
  const holeMarkerRef     = useRef(null)   // gold tee pin
  const greenMarkerRef    = useRef(null)   // red flag on green
  const [mapErr, setMapErr] = useState(null)
  const [mapReady, setMapReady] = useState(false)

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
        attributionControl: false,
        rotate: true,           // leaflet-rotate: enable bearing control
        touchRotate: false,     // disable confusing pinch-rotate gesture
        bearing: 0,
      })

      // ESRI satellite imagery — keepBuffer:4 keeps more tiles in memory during pans
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, tileSize: 256, keepBuffer: 4, updateWhenZooming: false }
      ).addTo(map)

      // GPS dot — only show if user is within ~5 miles of course
      if (gps && geocoded) {
        const dist = haversineYards(gps, { lat: geocoded.lat, lon: geocoded.lon })
        if (dist != null && dist < 8800) {
          markerRef.current = L.circleMarker([gps.lat, gps.lon], {
            radius: 9, color: '#F5D78A', weight: 3,
            fillColor: '#F5D78A', fillOpacity: 0.95,
          }).addTo(map)
        }
      }

      mapRef.current = map
      // Don't fitBounds here — the hole-pan effect will position the map
      // correctly once OSM data arrives. Avoids a redundant double-move.
      setMapReady(true)
    }

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
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      markerRef.current = null
      holeMarkerRef.current = null
      greenMarkerRef.current = null
      setMapReady(false)
    }
  }, [geocoded])

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
    // Zoom based on hole length — par 3s tighter, long par 5s wider
    const holeDist  = teePt && greenPt ? haversineYards(teePt, greenPt) : 0
    const zoom = holeDist > 400 ? 16 : holeDist > 220 ? 17 : 18

    // animate:false = instant teleport to the hole
    mapRef.current.setView([centerLat, centerLon], zoom, { animate: false })

    // setBearing MUST come AFTER setView — setView resets bearing to 0 (north-up).
    // setBearing(b) puts compass bearing b at the top of the screen.
    // leaflet-rotate applies CSS rotateZ(-b), which places bearing b at the top.
    // "course-up": green at top → bearing = direction from tee to green.
    if (teePt && greenPt && typeof mapRef.current.setBearing === 'function') {
      mapRef.current.setBearing(calcBearing(teePt, greenPt))
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
  }, [currentHole, holePositions, greenPositions, mapReady])

  // Update GPS marker position without panning away from the course
  useEffect(() => {
    if (!mapRef.current || !gps || !geocoded) return
    const L = window.L
    if (!L) return
    // Only show/update the dot if user is actually on the course
    const dist = haversineYards(gps, { lat: geocoded.lat, lon: geocoded.lon })
    if (dist == null || dist > 8800) return // more than ~5 miles away — don't show dot
    if (markerRef.current) {
      markerRef.current.setLatLng([gps.lat, gps.lon])
    } else {
      markerRef.current = L.circleMarker([gps.lat, gps.lon], {
        radius: 9, color: '#F5D78A', weight: 3,
        fillColor: '#F5D78A', fillOpacity: 0.95,
      }).addTo(mapRef.current)
    }
  }, [gps?.lat, gps?.lon, geocoded])

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
      {/* Hole badge overlay */}
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 1000,
        background: 'rgba(7,12,9,0.85)', border: '1px solid rgba(245,215,138,0.3)',
        borderRadius: 12, padding: '8px 14px', backdropFilter: 'blur(8px)',
      }}>
        <div style={{ color: '#F5D78A', fontWeight: 800, fontSize: 14 }}>HOLE {currentHole}</div>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 1 }}>
          {courseCtx?.tee?.holes?.find(h => h.hole === currentHole)?.yardage ?? '—'}y · Par {courseCtx?.tee?.holes?.find(h => h.hole === currentHole)?.par ?? '—'}
        </div>
      </div>
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
export default function EagleEye({ onGoToScorecard, eyeHoleNudge = null, onConsumeEyeHoleNudge } = {}) {
  const [gps, setGps]               = useState(null)
  const [gpsError, setGpsError]     = useState(null) // 'denied' | 'unavailable' | 'timeout'
  const [teeGps, setTeeGps]         = useState(null)
  const [weather, setWeather]       = useState(null)
  const [courseCtx, setCourseCtx]   = useState(null)
  const [currentHole, setCurrentHole] = useState(1)

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

  // OSM course data: geocoded position, tee coords, green coords
  const [courseGeocoded, setCourseGeocoded] = useState(null)
  const [holePositions, setHolePositions]   = useState({}) // { 1: {lat,lon}, ... } tees
  const [greenPositions, setGreenPositions] = useState({}) // { 1: {lat,lon}, ... } greens
  const [osmLoading, setOsmLoading]         = useState(false)

  const watchIdRef = useRef(null)

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

  function startGpsWatch() {
    if (!navigator.geolocation || watchIdRef.current != null) return
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        setGpsError(null)
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude }
        setGps(coords)
        fetchWeather(coords)
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
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude }
        setGps(coords)
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
    setOsmLoading(true)

    const { club_name, city, state } = courseCtx.course
    const cacheKey = `${courseCtx.course.id}-${courseCtx.tee.tee_name}`

    // 1️⃣ In-memory cache (survives re-renders within a page session)
    if (osmPositionCache.has(cacheKey)) {
      const cached = osmPositionCache.get(cacheKey)
      setCourseGeocoded(cached.geocoded)
      setHolePositions(cached.tees)
      setGreenPositions(cached.greens)
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
        ]).then(([osmHoles, osmNodes]) => {
            const scorecard = courseCtx?.tee?.holes ?? []
            const holeTees = {}, holeGreens = {}

            // ── Primary: golf=hole ways (have authoritative ref → hole number) ──
            const holeWaysByRef = {}
            for (const el of osmHoles.elements) {
              if (el.type !== 'way' || el.geometry?.length < 2) continue
              const ref = parseInt(el.tags?.ref)
              if (!(ref >= 1 && ref <= 18)) continue
              if (!holeWaysByRef[ref]) holeWaysByRef[ref] = []
              const first   = el.geometry[0]
              const last    = el.geometry[el.geometry.length - 1]
              const teePt   = { lat: first.lat, lon: first.lon }
              const greenPt = { lat: last.lat,  lon: last.lon }
              holeWaysByRef[ref].push({ tee: teePt, green: greenPt, dist: haversineYards(teePt, greenPt) })
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

            log('[OSM] coverage:', Object.keys(holeTees).length, 'tees,', Object.keys(holeGreens).length, 'greens — gap-fills:', gapFills)
            setHolePositions(holeTees)
            setGreenPositions(holeGreens)
            const cachePayload = { geocoded: gc, tees: holeTees, greens: holeGreens }
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
  const greenCoord = greenPositions[currentHole]
  const gpsToGreen = (greenCoord && gps) ? haversineYards(gps, greenCoord) : null

  // Fallback: distance walked from tee subtracted from DB yardage
  const distanceWalked = haversineYards(teeGps, gps) ?? 0
  const remainingYards = holeData
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
  }

  const wind = weather
    ? { speed: Math.round(weather.wind_speed_10m), dir: Math.round(weather.wind_direction_10m) }
    : null
  const temp = weather ? Math.round(weather.temperature_2m) : null

  const displayYards = gpsToGreen ?? (distanceWalked > 10 && remainingYards != null
    ? remainingYards
    : (holeData?.yardage ?? null))

  const teeHoles = courseCtx?.tee?.holes ?? []

  return (
    <div style={{ height: 'calc(100dvh - var(--nav-height))', background: '#070C09', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`
        @keyframes ee-spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ee-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .ee-hole-chip::-webkit-scrollbar { display: none; }
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
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: gps ? 'rgba(42,122,56,0.18)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${gps ? 'rgba(42,122,56,0.35)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 20, padding: '4px 8px',
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: gps ? '#5ED47A' : 'rgba(255,255,255,0.2)' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: gps ? '#5ED47A' : 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>GPS</span>
            </div>
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

          {/* Full-screen satellite map */}
          <HoleMap courseCtx={courseCtx} currentHole={currentHole} gps={gps} geocoded={courseGeocoded} holePositions={holePositions} greenPositions={greenPositions} />

          {/* HUD overlay */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '12px 16px 20px', pointerEvents: 'none' }}>

            {/* ── Top: yardage card ── */}
            <div style={{ alignSelf: 'center', pointerEvents: 'auto', textAlign: 'center',
              background: 'rgba(4,8,6,0.78)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
              borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)',
              padding: '16px 32px 14px', boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: gpsToGreen != null ? '#5ED47A' : 'rgba(255,255,255,0.35)', marginBottom: 2 }}>
                {gpsToGreen != null ? 'TO GREEN · LIVE GPS' : distanceWalked > 10 && remainingYards != null ? 'REMAINING' : 'FROM TEE'}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', lineHeight: 1 }}>
                <span style={{ fontSize: 88, fontWeight: 900, letterSpacing: '-4px', color: '#fff', lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                  {displayYards ?? '—'}
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.35)', paddingTop: 14, marginLeft: 5 }}>YDS</span>
              </div>
              {osmLoading && <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 4, letterSpacing: '0.06em' }}>Loading course data…</div>}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'center' }}>
                <div style={{ background: 'rgba(42,122,56,0.3)', border: '1px solid rgba(42,122,56,0.5)', borderRadius: 6, padding: '3px 12px' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#5ED47A' }}>PAR {holeData?.par ?? '—'}</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '3px 12px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)' }}>HDCP {holeData?.handicap ?? '—'}</span>
                </div>
                {holeData?.yardage && gpsToGreen != null && (
                  <div style={{ background: 'rgba(201,160,64,0.15)', border: '1px solid rgba(201,160,64,0.3)', borderRadius: 6, padding: '3px 12px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#C9A040' }}>{holeData.yardage}Y TEE</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── Bottom: conditions + actions ── */}
            <div style={{ pointerEvents: 'auto' }}>
              {/* Conditions pills */}
              {(wind || temp != null) && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
                  {wind && (
                    <div style={{ background: 'rgba(4,8,6,0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <WindArrow deg={wind.dir} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{wind.speed} mph</span>
                    </div>
                  )}
                  {temp != null && (
                    <div style={{ background: 'rgba(4,8,6,0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '6px 14px' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{temp}°F</span>
                    </div>
                  )}
                  {gps?.alt != null && (
                    <div style={{ background: 'rgba(4,8,6,0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, padding: '6px 14px' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{Math.round(gps.alt * 3.281)}ft</span>
                    </div>
                  )}
                </div>
              )}

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

              {/* Analyze Shot — primary CTA */}
              <button onClick={() => setShowCamera(true)} style={{
                width: '100%', padding: '17px', borderRadius: 18, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #B8860B 0%, #C9A040 40%, #E8C05A 100%)',
                color: '#070C09', fontWeight: 900, fontSize: 16, letterSpacing: '0.04em',
                boxShadow: '0 8px 32px rgba(201,160,64,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                marginBottom: 10,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(7,12,9,0.8)" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>
                  <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                  <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                </svg>
                Analyze Shot
              </button>

              {/* Mark Tee secondary */}
              <button onClick={() => setTeeGps(gps)} style={{
                width: '100%', padding: '11px', borderRadius: 14, cursor: 'pointer',
                background: 'rgba(4,8,6,0.72)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                Mark Tee Position
              </button>
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

      {/* Floating bottom-right Scorecard pill. Persistent across all Eagle
          Eye view states — distance, map, camera-result. Sits above the
          bottom nav. Only renders when the parent (App.jsx) provided
          onGoToScorecard, so EagleEye still works standalone. (2026-05-01) */}
      {onGoToScorecard && !showCamera && !showPicker && (
        <button onClick={onGoToScorecard} style={{
          position: 'absolute',
          bottom: 16, right: 16,
          background: 'linear-gradient(135deg, rgba(232,192,90,0.95), rgba(201,160,64,0.95))',
          border: '1px solid rgba(245,215,138,0.6)',
          borderRadius: 999, padding: '10px 16px',
          color: '#0D1F12',
          fontSize: 12, fontWeight: 800, letterSpacing: '0.06em',
          cursor: 'pointer',
          boxShadow: '0 6px 18px rgba(0,0,0,0.45), 0 0 0 1px rgba(245,215,138,0.15)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: 'inherit',
          zIndex: 30,
        }}>
          SCORECARD
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0D1F12" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      )}
    </div>
  )
}
