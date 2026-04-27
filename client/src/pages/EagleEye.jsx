import { useState, useRef, useEffect, useCallback } from 'react'
import { api, post } from '../lib/api.js'

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
function HoleMap({ courseCtx, currentHole, gps }) {
  const containerRef      = useRef(null)
  const mapRef            = useRef(null)
  const markerRef         = useRef(null)
  const teeMarkersRef     = useRef({})
  const [geocoded, setGeocoded]         = useState(null)
  const [holePositions, setHolePositions] = useState({}) // { 1: {lat,lon}, 2: ... }
  const [mapErr, setMapErr]             = useState(null)

  // Step 1: Geocode course name → lat/lon via Nominatim
  useEffect(() => {
    if (!courseCtx) return
    const { club_name, city, state } = courseCtx.course
    const q = [club_name, city, state].filter(Boolean).join(', ')
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`)
      .then(r => r.json())
      .then(data => {
        if (data[0]) setGeocoded({ lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) })
        else setMapErr('Course location not found')
      })
      .catch(() => setMapErr('Geocoding failed'))
  }, [courseCtx?.course?.club_name])

  // Step 2: Once geocoded, query Overpass API for per-hole tee positions from OSM
  useEffect(() => {
    if (!geocoded) return
    const pad = 0.025 // ~1.7 mile radius bounding box
    const bbox = `${geocoded.lat - pad},${geocoded.lon - pad},${geocoded.lat + pad},${geocoded.lon + pad}`
    const query = `[out:json][timeout:25];(node["golf"="tee"](${bbox});way["golf"="tee"](${bbox}););out center;`
    fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`)
      .then(r => r.json())
      .then(data => {
        const positions = {}
        for (const el of data.elements) {
          const ref = parseInt(el.tags?.ref)
          if (!ref || ref < 1 || ref > 18) continue
          const lat = el.lat ?? el.center?.lat
          const lon = el.lon ?? el.center?.lon ?? el.center?.lng
          if (lat && lon) positions[ref] = { lat, lon }
        }
        if (Object.keys(positions).length > 0) setHolePositions(positions)
        // If OSM has no hole data, map stays centered on course — still useful as aerial view
      })
      .catch(() => {}) // Overpass failure is non-fatal
  }, [geocoded])

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
        zoom: 17,
        zoomControl: true,
        attributionControl: false,
      })

      // ESRI satellite imagery (free, no key)
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 20, tileSize: 256 }
      ).addTo(map)

      // GPS dot — only show if user is within ~5 miles of course (on the course)
      if (gps && geocoded) {
        const dist = haversineYards(gps, { lat: geocoded.lat, lon: geocoded.lon })
        if (dist != null && dist < 8800) { // 5 miles in yards
          markerRef.current = L.circleMarker([gps.lat, gps.lon], {
            radius: 9, color: '#F5D78A', weight: 3,
            fillColor: '#F5D78A', fillOpacity: 0.95,
          }).addTo(map)
        }
      }

      mapRef.current = map
    }

    if (window.L) {
      init()
    } else {
      // Inject Leaflet CSS
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link')
        link.id = 'leaflet-css'
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }
      // Inject Leaflet JS
      if (!document.getElementById('leaflet-js')) {
        const script = document.createElement('script')
        script.id = 'leaflet-js'
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
        script.onload = init
        document.head.appendChild(script)
      }
    }

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      markerRef.current = null
    }
  }, [geocoded])

  // Pan to specific hole tee when hole changes or OSM data arrives
  useEffect(() => {
    if (!mapRef.current) return
    const pos = holePositions[currentHole]
    if (pos) {
      mapRef.current.setView([pos.lat, pos.lon], 18)
      // Highlight current hole tee
      Object.entries(teeMarkersRef.current).forEach(([num, m]) => {
        if (!window.L) return
        const isCurrent = parseInt(num) === currentHole
        m.setStyle({ radius: isCurrent ? 10 : 6, fillOpacity: isCurrent ? 1 : 0.5, weight: isCurrent ? 3 : 1.5 })
      })
    }
  }, [currentHole, holePositions])

  // Add tee markers to map when OSM positions arrive
  useEffect(() => {
    if (!mapRef.current || !window.L || Object.keys(holePositions).length === 0) return
    const L = window.L
    // Clear old tee markers
    Object.values(teeMarkersRef.current).forEach(m => m.remove())
    teeMarkersRef.current = {}
    // Add a small marker for each tee
    Object.entries(holePositions).forEach(([num, pos]) => {
      const isCurrent = parseInt(num) === currentHole
      const m = L.circleMarker([pos.lat, pos.lon], {
        radius: isCurrent ? 10 : 6,
        color: '#fff', weight: isCurrent ? 3 : 1.5,
        fillColor: '#C9A040', fillOpacity: isCurrent ? 1 : 0.5,
      })
        .bindTooltip(`H${num}`, { permanent: false, direction: 'top', className: 'ee-tip' })
        .addTo(mapRef.current)
      teeMarkersRef.current[num] = m
    })
  }, [holePositions])

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
    <div style={{ flex: 1, position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 340 }} />
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
function CameraModal({ gps, weather, holeData, currentHole, courseCtx, onClose, onResult }) {
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const streamRef  = useRef(null)
  const [facingBack, setFacingBack] = useState(true)
  const [scanning, setScanning]     = useState(false)
  const [error, setError]           = useState(null)

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

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {/* Viewfinder */}
      <video ref={videoRef} autoPlay playsInline muted
        style={{ flex: 1, width: '100%', objectFit: 'cover' }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

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
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 'max(16px, env(safe-area-inset-top))', padding: '12px 16px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => { closeCamera(); onClose() }} style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 999, width: 40, height: 40, color: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#F5D78A', fontWeight: 800, fontSize: 15 }}>🦅 Eagle Eye</div>
          {holeData && <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>H{currentHole} · {holeData.yardage}y · Par {holeData.par}</div>}
        </div>
        <button onClick={flip} style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 999, width: 40, height: 40, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⇄</button>
      </div>

      {/* Scanning overlay */}
      {scanning && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <div style={{ fontSize: 52 }}>🦅</div>
          <div style={{ color: '#F5D78A', fontWeight: 800, fontSize: 20 }}>Analyzing…</div>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>GPS · Weather · Vision{courseCtx ? ' · Course Data' : ''}</div>
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
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 'max(28px, env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center' }}>
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
    </div>
  )
}

// ─── Result Sheet ─────────────────────────────────────────────────────────────
function ResultSheet({ result: r, holeData, onClose }) {
  const adj = n => n > 0 ? `+${n}` : `${n}`
  const hasReal = holeData?.yardage != null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
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
            <div style={{ color: '#4ADE80', fontWeight: 800, fontSize: 22 }}>{r.recommendedClub}</div>
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
              <span style={{ color: val > 0 ? '#F87171' : '#4ADE80', fontWeight: 700, fontSize: 13 }}>{adj(val)}y</span>
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
            <div style={{ color: '#4ADE80', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>🦅 EAGLE CADDIE</div>
            <div style={{ color: 'var(--tm-text)', fontSize: 14, lineHeight: 1.55 }}>{r.caddieNote}</div>
          </div>
        )}

        <button onClick={onClose} style={{
          width: '100%', padding: '14px', borderRadius: 14,
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.7)', fontWeight: 700, fontSize: 15, cursor: 'pointer',
        }}>Done</button>
      </div>
    </div>
  )
}

// ─── Course Picker ────────────────────────────────────────────────────────────
function CoursePicker({ onSelect, onClose }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [course, setCourse]   = useState(null)
  const [teeIdx, setTeeIdx]   = useState(0)

  async function search() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const d = await api(`/api/courses/search?q=${encodeURIComponent(query)}`)
      setResults(d.courses || [])
    } catch {} finally { setLoading(false) }
  }

  async function pickCourse(c) {
    setSelected(c)
    setLoading(true)
    try {
      const d = await api(`/api/courses/${c.id}`)
      setCourse(d)
    } catch {} finally { setLoading(false) }
  }

  const tees = course ? [...(course.tees?.male || []), ...(course.tees?.female || [])] : []
  const activeTee = tees[teeIdx]

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#07100C', zIndex: 400, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 22, cursor: 'pointer' }}>←</button>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>Select Course</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            autoFocus value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Search course name…"
            style={{ flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 14px', color: '#fff', fontSize: 15, outline: 'none' }}
          />
          <button onClick={search} disabled={loading} style={{ background: 'rgba(232,192,90,0.2)', border: '1px solid rgba(232,192,90,0.4)', borderRadius: 10, padding: '10px 16px', color: '#F5D78A', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            {loading ? '…' : 'Search'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
        {!selected && results.map(c => (
          <div key={c.id} onClick={() => pickCourse(c)} style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer' }}>
            <div style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>{c.club_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{[c.city, c.state, c.country].filter(Boolean).join(', ')}</div>
          </div>
        ))}

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
  )
}

// ─── Main EagleEye ────────────────────────────────────────────────────────────
export default function EagleEye() {
  const [gps, setGps]               = useState(null)
  const [teeGps, setTeeGps]         = useState(null)
  const [weather, setWeather]       = useState(null)
  const [courseCtx, setCourseCtx]   = useState(null)
  const [currentHole, setCurrentHole] = useState(1)
  const [showPicker, setShowPicker] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [result, setResult]         = useState(null)
  const [viewMode, setViewMode]     = useState('distance') // 'distance' | 'map'

  // Live GPS watch
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      pos => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude }
        setGps(coords)
        fetchWeather(coords)
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

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

  // Distance walked from tee this hole
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

  return (
    <div style={{ minHeight: '100dvh', background: '#070C09', display: 'flex', flexDirection: 'column', paddingBottom: 'var(--nav-height)' }}>

      {/* ── Top bar ── */}
      <div style={{ paddingTop: 'max(52px, calc(var(--safe-top) + 12px))', padding: '52px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.03em', background: 'linear-gradient(135deg, #F5D78A 0%, #C9A040 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Eagle Eye
          </div>
          {/* GPS + weather strip */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: gps ? '#4ADE80' : 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: gps ? '#4ADE80' : 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
              {gps ? 'GPS' : 'No GPS'}
            </span>
            {temp != null && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{temp}°F</span>}
            {wind && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}><WindArrow deg={wind.dir} /> {wind.speed}mph</span>}
          </div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 20px 10px' }}>

        {/* ── Distance / Map toggle ── */}
        {courseCtx && (
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 3, marginBottom: 16, width: '100%', maxWidth: 340 }}>
            {['distance', 'map'].map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                flex: 1, padding: '8px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: viewMode === mode ? 'rgba(245,215,138,0.15)' : 'transparent',
                color: viewMode === mode ? '#F5D78A' : 'rgba(255,255,255,0.4)',
                fontWeight: 700, fontSize: 13, transition: 'all 0.2s',
              }}>
                {mode === 'distance' ? '📐 Distance' : '🛰 Map'}
              </button>
            ))}
          </div>
        )}

        {!courseCtx ? (
          /* ── No course: welcome prompt ── */
          <div style={{ textAlign: 'center', padding: '0 20px' }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🦅</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 8 }}>Select Your Course</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, marginBottom: 32 }}>
              Pick a course to see live hole distances and get AI-powered rangefinder readings.
            </div>
            <button onClick={() => setShowPicker(true)} style={{
              padding: '16px 36px', borderRadius: 16, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
              color: '#fff', fontWeight: 800, fontSize: 17,
              boxShadow: '0 4px 20px rgba(42,122,56,0.4)',
            }}>Choose Course</button>
          </div>
        ) : (
          /* ── Course selected: distance or map display ── */
          <>
            {/* Course name + change button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: viewMode === 'map' ? 0 : 24 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
                {courseCtx.course.club_name}
              </span>
              <button onClick={() => setShowPicker(true)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 20, padding: '2px 10px', color: 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer' }}>
                Change
              </button>
            </div>

            {/* ── Map view ── */}
            {viewMode === 'map' && (
              <div style={{ width: '100%', maxWidth: 340, borderRadius: 20, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', height: 340, display: 'flex', flexDirection: 'column', marginBottom: 12 }}>
                {/* Hole navigator on top of map */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'rgba(7,12,9,0.9)', padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <button onClick={() => changeHole(-1)} disabled={currentHole === 1} style={{ background: 'none', border: 'none', color: currentHole === 1 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.6)', fontSize: 20, cursor: currentHole === 1 ? 'default' : 'pointer' }}>‹</button>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, minWidth: 80, textAlign: 'center' }}>Hole {currentHole} of {totalHoles}</span>
                  <button onClick={() => changeHole(1)} disabled={currentHole === totalHoles} style={{ background: 'none', border: 'none', color: currentHole === totalHoles ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.6)', fontSize: 20, cursor: currentHole === totalHoles ? 'default' : 'pointer' }}>›</button>
                </div>
                <HoleMap courseCtx={courseCtx} currentHole={currentHole} gps={gps} />
              </div>
            )}

            {/* ── Big distance card ── */}
            {viewMode === 'distance' && <div style={{ width: '100%', maxWidth: 340, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: '28px 24px 24px', textAlign: 'center', marginBottom: 20 }}>
              {/* Hole badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
                <button onClick={() => changeHole(-1)} disabled={currentHole === 1} style={{ background: 'none', border: 'none', color: currentHole === 1 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)', fontSize: 22, cursor: currentHole === 1 ? 'default' : 'pointer', padding: '0 4px' }}>‹</button>
                <div style={{ background: 'rgba(42,122,56,0.25)', border: '1px solid rgba(42,122,56,0.4)', borderRadius: 12, padding: '6px 20px' }}>
                  <div style={{ color: '#4ADE80', fontWeight: 800, fontSize: 16 }}>HOLE {currentHole}</div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 1 }}>PAR {holeData?.par ?? '—'} · Hdcp {holeData?.handicap ?? '—'}</div>
                </div>
                <button onClick={() => changeHole(1)} disabled={currentHole === totalHoles} style={{ background: 'none', border: 'none', color: currentHole === totalHoles ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)', fontSize: 22, cursor: currentHole === totalHoles ? 'default' : 'pointer', padding: '0 4px' }}>›</button>
              </div>

              {/* Main yardage */}
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
                {distanceWalked > 10 ? 'Est. Remaining' : 'From Tee'}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 6, lineHeight: 1 }}>
                <span style={{ fontSize: 80, fontWeight: 900, letterSpacing: '-4px', color: '#fff', lineHeight: 0.9 }}>
                  {distanceWalked > 10 && remainingYards != null ? remainingYards : (holeData?.yardage ?? '—')}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 20, paddingBottom: 8 }}>yds</span>
              </div>

              {/* Tee yardage sub-label when showing remaining */}
              {distanceWalked > 10 && remainingYards != null && (
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 8 }}>
                  Full hole: {holeData?.yardage}y · Walked: ~{distanceWalked}y
                </div>
              )}

              {/* Wind/conditions mini strip */}
              {wind && (
                <div style={{ marginTop: 16, padding: '10px 0 0', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'center', gap: 20 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Wind</div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, marginTop: 2 }}><WindArrow deg={wind.dir} /> {wind.speed} mph</div>
                  </div>
                  {temp != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Temp</div>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, marginTop: 2 }}>{temp}°F</div>
                    </div>
                  )}
                  {gps?.alt != null && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Alt</div>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, marginTop: 2 }}>{Math.round(gps.alt * 3.281)}ft</div>
                    </div>
                  )}
                </div>
              )}

              {/* Set tee position button */}
              <button onClick={() => setTeeGps(gps)} style={{
                marginTop: 14, background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20,
                padding: '5px 14px', color: 'rgba(255,255,255,0.35)', fontSize: 11, cursor: 'pointer',
              }}>
                📍 Mark Tee Position
              </button>
            </div>}

            {/* ── Last Eagle Eye result summary ── */}
            {result && (
              <div onClick={() => setResult(result)} style={{
                width: '100%', maxWidth: 340, background: 'rgba(201,160,64,0.08)', border: '1px solid rgba(201,160,64,0.2)',
                borderRadius: 16, padding: '14px 16px', cursor: 'pointer', marginBottom: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ color: 'rgba(245,215,138,0.6)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Last Range</div>
                  <div style={{ color: '#F5D78A', fontWeight: 800, fontSize: 20, marginTop: 2 }}>{result.playsLikeYards} yds</div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{result.recommendedClub} · {result.shotShape}</div>
                </div>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Tap to view ›</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Pulsating Eagle Eye button ── */}
      {courseCtx && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 20 }}>
          <EagleEyeBtn onPress={() => setShowCamera(true)} scanning={false} />
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
        />
      )}
    </div>
  )
}
