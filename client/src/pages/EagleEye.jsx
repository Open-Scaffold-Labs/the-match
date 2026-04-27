import { useState, useRef, useEffect, useCallback } from 'react'
import Button from '../components/primitives/Button.jsx'
import { post } from '../lib/api.js'

const INITIAL = { status: 'idle' } // idle | acquiring | ready | scanning | result | error

export default function EagleEye() {
  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const streamRef  = useRef(null)
  const [state, setState]     = useState(INITIAL)
  const [gps, setGps]         = useState(null)
  const [weather, setWeather] = useState(null)
  const [result, setResult]   = useState(null)
  const [facingBack, setFacingBack] = useState(true)

  // Acquire GPS
  useEffect(() => {
    if (!navigator.geolocation) return
    setState(s => ({ ...s, status: s.status === 'idle' ? 'acquiring' : s.status }))
    const id = navigator.geolocation.watchPosition(
      pos => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude }
        setGps(coords)
        fetchWeather(coords)
        setState(s => s.status === 'acquiring' ? { status: 'ready' } : s)
      },
      () => setState(s => s.status === 'acquiring' ? { status: 'ready' } : s),
      { enableHighAccuracy: true, timeout: 10000 }
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

  // Open camera
  const openCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingBack ? 'environment' : 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (e) {
      console.error(e)
    }
  }, [facingBack])

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const flipCamera = () => {
    closeCamera()
    setFacingBack(b => !b)
  }

  useEffect(() => { openCamera(); return closeCamera }, [openCamera])

  // Capture and analyze
  const analyze = async () => {
    if (!canvasRef.current || !videoRef.current) return
    setState({ status: 'scanning' })
    setResult(null)

    const canvas = canvasRef.current
    const video  = videoRef.current
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1]

    try {
      const res = await post('/api/eagle-eye/analyze', { image: base64, gps, weather })
      setResult(res)
      setState({ status: 'result' })
    } catch (e) {
      setState({ status: 'error', message: e.message })
    }
  }

  const reset = () => { setState({ status: 'ready' }); setResult(null) }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: '#000', position: 'relative', overflow: 'hidden',
    }}>
      {/* Camera feed */}
      <video
        ref={videoRef} autoPlay playsInline muted
        style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Crosshair overlay */}
      <CrosshairOverlay scanning={state.status === 'scanning'} />

      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        paddingTop: 'calc(var(--safe-top) + 12px)',
        padding: '12px 16px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <div style={{
            fontSize: 18, fontWeight: 800, letterSpacing: '-0.5px',
            color: 'var(--tm-gold-bright)',
          }}>
            🦅 Eagle Eye
          </div>
          <GpsWeatherPills gps={gps} weather={weather} />
        </div>
        <button onClick={flipCamera} style={{
          background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 999, width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, cursor: 'pointer', color: '#fff',
          WebkitTapHighlightColor: 'transparent',
        }}>
          🔄
        </button>
      </div>

      {/* Result sheet */}
      {state.status === 'result' && result && (
        <ResultSheet result={result} onReset={reset} />
      )}

      {/* Error */}
      {state.status === 'error' && (
        <div style={{
          position: 'absolute', bottom: 100, left: 16, right: 16,
          background: 'rgba(224,82,82,0.9)', borderRadius: 12, padding: 16,
          color: '#fff', textAlign: 'center',
        }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Analysis failed</p>
          <p style={{ fontSize: 13, opacity: 0.8, marginBottom: 12 }}>{state.message}</p>
          <Button onClick={reset} variant="ghost" size="sm">Try again</Button>
        </div>
      )}

      {/* Capture button */}
      {(state.status === 'ready' || state.status === 'acquiring') && (
        <div style={{
          position: 'absolute', bottom: 24, left: 0, right: 0,
          display: 'flex', justifyContent: 'center',
          paddingBottom: 'var(--safe-bottom)',
        }}>
          <button
            onClick={analyze}
            disabled={state.status === 'acquiring'}
            style={{
              width: 72, height: 72, borderRadius: '50%',
              background: state.status === 'acquiring'
                ? 'rgba(255,255,255,0.2)'
                : 'linear-gradient(135deg, var(--tm-gold-bright), var(--tm-gold))',
              border: '4px solid rgba(255,255,255,0.4)',
              cursor: state.status === 'acquiring' ? 'not-allowed' : 'pointer',
              fontSize: 28,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 24px rgba(201,160,64,0.6)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
            </svg>
          </button>
        </div>
      )}

      {/* Scanning overlay */}
      {state.status === 'scanning' && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <div style={{ fontSize: 48 }}>🦅</div>
          <p style={{ color: 'var(--tm-gold-bright)', fontWeight: 700, fontSize: 18 }}>
            Analyzing…
          </p>
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
            GPS · Weather · Vision
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Sub-components ── */

function CrosshairOverlay({ scanning }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        width: 200, height: 200, position: 'relative',
        opacity: scanning ? 0.3 : 0.7,
        transition: 'opacity 300ms ease',
      }}>
        {/* Corner brackets */}
        {[['tl','top','left'], ['tr','top','right'], ['bl','bottom','left'], ['br','bottom','right']].map(
          ([key, v, h]) => (
            <div key={key} style={{
              position: 'absolute', [v]: 0, [h]: 0,
              width: 24, height: 24,
              borderTop: v === 'top' ? '2px solid var(--tm-gold-bright)' : 'none',
              borderBottom: v === 'bottom' ? '2px solid var(--tm-gold-bright)' : 'none',
              borderLeft: h === 'left' ? '2px solid var(--tm-gold-bright)' : 'none',
              borderRight: h === 'right' ? '2px solid var(--tm-gold-bright)' : 'none',
            }} />
          )
        )}
        {/* Center dot */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--tm-gold-bright)',
          boxShadow: 'var(--tm-glow-gold)',
        }} />
      </div>
    </div>
  )
}

function GpsWeatherPills({ gps, weather }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      <Pill color={gps ? '#35A046' : '#E05252'} label={gps ? 'GPS lock' : 'Acquiring…'} />
      {weather && (
        <>
          <Pill label={`${Math.round(weather.temperature_2m)}°F`} />
          <Pill label={`${Math.round(weather.wind_speed_10m)} mph wind`} />
        </>
      )}
    </div>
  )
}

function Pill({ label, color = 'rgba(255,255,255,0.15)' }) {
  return (
    <span style={{
      background: color === 'rgba(255,255,255,0.15)' ? 'rgba(0,0,0,0.45)' : color + '33',
      border: `1px solid ${color === 'rgba(255,255,255,0.15)' ? 'rgba(255,255,255,0.15)' : color}`,
      color: '#fff', borderRadius: 999, fontSize: 11, padding: '3px 8px',
      fontWeight: 500,
    }}>
      {label}
    </span>
  )
}

function ResultSheet({ result: r, onReset }) {
  const adjSign = n => n > 0 ? `+${n}` : `${n}`
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      background: 'var(--tm-surface)',
      borderRadius: '24px 24px 0 0',
      border: '1px solid var(--tm-border-2)',
      paddingBottom: 'calc(var(--nav-height) + var(--safe-bottom) + 12px)',
      padding: '20px 20px',
      boxShadow: '0 -8px 32px rgba(0,0,0,0.7)',
    }}>
      <div style={{ width: 36, height: 4, borderRadius: 99, background: 'var(--tm-border-3)', margin: '0 auto 16px' }} />

      {/* Distance hero */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <p style={{ color: 'var(--tm-text-3)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Plays Like
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginTop: 4 }}>
          <span style={{
            fontSize: 60, fontWeight: 800, letterSpacing: '-2px', lineHeight: 1,
            color: 'var(--tm-gold-bright)',
          }}>
            {r.playsLikeYards}
          </span>
          <span style={{ color: 'var(--tm-text-3)', fontSize: 18 }}>yds</span>
        </div>
        <p style={{ color: 'var(--tm-text-3)', fontSize: 13, marginTop: 4 }}>
          GPS: {r.gpsYards} yds · Adjusted: {adjSign(r.adjustments.totalAdjust)} yds
        </p>
      </div>

      {/* Club rec */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16,
      }}>
        <ClubCard label="Recommended" club={r.recommendedClub} primary />
        <ClubCard label="Alternate" club={r.alternateClub} />
      </div>

      {/* Adjustments */}
      <div style={{ marginBottom: 16 }}>
        {r.adjustments.slopeYards !== 0 &&
          <AdjRow icon="↗" label="Slope" value={adjSign(r.adjustments.slopeYards)} />}
        {r.adjustments.windYards !== 0 &&
          <AdjRow icon="~" label="Wind" value={adjSign(r.adjustments.windYards)} />}
        {r.adjustments.tempYards !== 0 &&
          <AdjRow icon="°" label="Temp" value={adjSign(r.adjustments.tempYards)} />}
        {r.adjustments.altitudeYards !== 0 &&
          <AdjRow icon="▲" label="Altitude" value={adjSign(r.adjustments.altitudeYards)} />}
      </div>

      {/* Caddie note */}
      {r.caddieNote && (
        <div style={{
          background: 'var(--tm-green-muted)', border: '1px solid var(--tm-border-2)',
          borderRadius: 12, padding: '12px 14px', marginBottom: 16,
        }}>
          <p style={{ color: 'var(--tm-text-3)', fontSize: 11, marginBottom: 4 }}>🦅 EAGLE CADDIE</p>
          <p style={{ color: 'var(--tm-text)', fontSize: 14, lineHeight: 1.5 }}>{r.caddieNote}</p>
        </div>
      )}

      <Button onClick={onReset} variant="ghost" size="md" full>Take Another Shot</Button>
    </div>
  )
}

function ClubCard({ label, club, primary }) {
  return (
    <div style={{
      background: primary ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)',
      border: `1px solid ${primary ? 'var(--tm-border-2)' : 'var(--tm-border)'}`,
      borderRadius: 12, padding: '12px',
      textAlign: 'center',
    }}>
      <p style={{ color: 'var(--tm-text-3)', fontSize: 11, marginBottom: 6 }}>{label}</p>
      <p style={{
        fontSize: 22, fontWeight: 800,
        color: primary ? 'var(--tm-green-text)' : 'var(--tm-text)',
      }}>{club}</p>
    </div>
  )
}

function AdjRow({ icon, label, value }) {
  const isPos = value.startsWith('+')
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '6px 0',
      borderBottom: '1px solid var(--tm-border)',
    }}>
      <span style={{ color: 'var(--tm-text-3)', fontSize: 13 }}>{icon} {label}</span>
      <span style={{
        fontSize: 13, fontWeight: 600,
        color: isPos ? 'var(--tm-bogey)' : 'var(--tm-green-text)',
      }}>{value} yds</span>
    </div>
  )
}
