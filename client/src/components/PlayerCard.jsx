import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { post } from '../lib/api.js'
import CoachMark from './CoachMark.jsx'

// ─── Country flag definitions ──────────────────────────────────────────────────
// iso = flagcdn.com ISO code (CORS-enabled, supports subdivisions like gb-eng)
// accent = primary color used for the selected-state ring + flat fallback
//          if the flag image fails to load
// 2026-04-30: switched from canvas-drawn diagonal stripes to real flag
//             images for full PGA-Tour parity (the user's reference look).
const COUNTRY_FLAGS = [
  { id: 'usa',         name: 'USA',          emoji: '🇺🇸',  iso: 'us',     accent: '#3C3B6E' },
  { id: 'england',     name: 'England',      emoji: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', iso: 'gb-eng', accent: '#CF142B' },
  { id: 'ireland',     name: 'Ireland',      emoji: '🇮🇪',  iso: 'ie',     accent: '#169B62' },
  { id: 'scotland',    name: 'Scotland',     emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', iso: 'gb-sct', accent: '#003087' },
  { id: 'australia',   name: 'Australia',    emoji: '🇦🇺',  iso: 'au',     accent: '#00008B' },
  { id: 'canada',      name: 'Canada',       emoji: '🇨🇦',  iso: 'ca',     accent: '#D80621' },
  { id: 'japan',       name: 'Japan',        emoji: '🇯🇵',  iso: 'jp',     accent: '#BC002D' },
  { id: 'spain',       name: 'Spain',        emoji: '🇪🇸',  iso: 'es',     accent: '#AA151B' },
  { id: 'sweden',      name: 'Sweden',       emoji: '🇸🇪',  iso: 'se',     accent: '#006AA7' },
  { id: 'germany',     name: 'Germany',      emoji: '🇩🇪',  iso: 'de',     accent: '#DD0000' },
  { id: 'southafrica', name: 'South Africa', emoji: '🇿🇦',  iso: 'za',     accent: '#007A4D' },
  { id: 'newzealand',  name: 'New Zealand',  emoji: '🇳🇿',  iso: 'nz',     accent: '#00247D' },
  { id: 'southkorea',  name: 'South Korea',  emoji: '🇰🇷',  iso: 'kr',     accent: '#C60C30' },
  { id: 'norway',      name: 'Norway',       emoji: '🇳🇴',  iso: 'no',     accent: '#002868' },
  { id: 'france',      name: 'France',       emoji: '🇫🇷',  iso: 'fr',     accent: '#002395' },
  { id: 'mexico',      name: 'Mexico',       emoji: '🇲🇽',  iso: 'mx',     accent: '#006847' },
  { id: 'argentina',   name: 'Argentina',    emoji: '🇦🇷',  iso: 'ar',     accent: '#74ACDF' },
]

// flagcdn URL helper — returns a high-res CORS-enabled flag PNG.
const flagUrl = (iso) => `https://flagcdn.com/w1280/${iso}.png`

// ─── Processing messages ───────────────────────────────────────────────────────
const PROC_MSGS = [
  'Analyzing your fit…',
  'Removing the crowd…',
  'Setting up the spotlight…',
  'Generating your card…',
]

// ─── Canvas helpers ────────────────────────────────────────────────────────────

async function resizeCutout(blob, maxH = 280) {
  const objUrl = URL.createObjectURL(blob)
  try {
    const img = await loadImg(objUrl)
    const aspect = img.naturalWidth / img.naturalHeight
    const h = Math.min(img.naturalHeight, maxH)
    const w = Math.round(h * aspect)
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(objUrl)
  }
}

function loadImg(src, { crossOrigin = null } = {}) {
  return new Promise((res, rej) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

// Build the player card — PGA Tour Tour-page look:
// faded country flag fills the full background; the cutout sits on top,
// top-aligned. No diagonal stripes, no info panel, no name overlay.
// `profile` is no longer rendered (we strip name/handicap/stats per the
// user's spec); kept in the signature for callers' backwards compat.
// (2026-04-30 — matches the PlayerPhoto component on the Tour tab.)
async function buildCard(cutoutBlob, flag /* , profile */) {
  const W = 750, H = 1040
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  // 1 ── Soft cream base — gives the flag something neutral to fade onto
  ctx.fillStyle = '#F5F2EC'
  ctx.fillRect(0, 0, W, H)

  // 2 ── Country flag, stretched to fill the full canvas at low opacity.
  // Stretch (don't crop or letterbox) so the entire flag is always visible —
  // for horizontal flags like Ireland (2:1) cover-cropping into this 0.72:1
  // portrait was clipping the green and orange bands and only showing the
  // white middle. At 0.22 opacity the aspect-ratio distortion reads as a
  // tinted background rather than a stretched flag.
  try {
    const flagImg = await loadImg(flagUrl(flag.iso), { crossOrigin: 'anonymous' })
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.drawImage(flagImg, 0, 0, W, H)
    ctx.restore()
  } catch {
    // Fallback: solid accent at low opacity if the flag image fails to load
    ctx.save()
    ctx.globalAlpha = 0.16
    ctx.fillStyle = flag.accent
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }

  // 3 ── Player cutout — full size, top-aligned (mirrors objectPosition: top center)
  const objUrl = URL.createObjectURL(cutoutBlob)
  try {
    const playerImg = await loadImg(objUrl)
    const aspect = playerImg.naturalWidth / playerImg.naturalHeight
    // Fill the card height; allow cropping at the sides if the cutout is narrow,
    // and let it spill below if the player is tall (overflow is clipped to canvas).
    const tH = H
    const tW = tH * aspect
    const px = (W - tW) / 2
    const py = 0
    ctx.drawImage(playerImg, px, py, tW, tH)
  } finally {
    URL.revokeObjectURL(objUrl)
  }

  return canvas.toDataURL('image/jpeg', 0.92)
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function PlayerCard({ user, season, onClose, onSave, existingCard }) {
  const [phase, setPhase] = useState(existingCard ? 'view' : 'intro')
  const [procIdx, setProcIdx] = useState(0)
  const [cutoutBlob, setCutoutBlob] = useState(null)
  const [cutoutDataUrl, setCutoutDataUrl] = useState(null)
  const [flagIdx, setFlagIdx] = useState(0)
  const [cardUrl, setCardUrl] = useState(existingCard ?? null)
  const [error, setError] = useState(null)
  const [rebuildKey, setRebuildKey] = useState(0)

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  async function startCamera() {
    setError(null)
    setPhase('camera')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      })
      streamRef.current = stream
      const attach = () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        } else {
          requestAnimationFrame(attach)
        }
      }
      requestAnimationFrame(attach)
    } catch {
      setError('Camera access denied. Please allow camera permission and try again.')
      setPhase('intro')
    }
  }

  function captureFrame() {
    const video = videoRef.current
    if (!video) return
    const c = document.createElement('canvas')
    c.width = video.videoWidth || 640
    c.height = video.videoHeight || 480
    const ctx = c.getContext('2d')
    ctx.translate(c.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    stopCamera()
    c.toBlob(blob => processImage(blob), 'image/jpeg', 0.92)
  }

  async function processImage(blob) {
    setPhase('processing')
    setProcIdx(0)
    let i = 0
    timerRef.current = setInterval(() => {
      i = Math.min(i + 1, PROC_MSGS.length - 1)
      setProcIdx(i)
    }, 1500)

    try {
      const { removeBackground } = await import('@imgly/background-removal')
      const result = await removeBackground(blob, {
        model: 'medium',
        output: { format: 'image/png', quality: 1.0 },
      })
      clearInterval(timerRef.current)
      setCutoutBlob(result)
      const cutoutUrl = await resizeCutout(result)
      setCutoutDataUrl(cutoutUrl)
      const url = await buildCard(result, COUNTRY_FLAGS[0], buildProfile())
      setCardUrl(url)
      setFlagIdx(0)
      setPhase('customize')
    } catch (err) {
      clearInterval(timerRef.current)
      setCutoutBlob(blob)
      setCutoutDataUrl(null)
      const url = await buildCard(blob, COUNTRY_FLAGS[0], buildProfile())
      setCardUrl(url)
      setFlagIdx(0)
      setPhase('customize')
    }
  }

  function buildProfile() {
    return {
      name: user?.name,
      handicap: user?.handicap,
      home_course: user?.home_course,
      wins: season?.wins,
      losses: season?.losses,
    }
  }

  async function applyFlag(idx) {
    if (!cutoutBlob) return
    setFlagIdx(idx)
    const url = await buildCard(cutoutBlob, COUNTRY_FLAGS[idx], buildProfile())
    setCardUrl(url)
    setRebuildKey(k => k + 1)
  }

  async function saveCard() {
    if (!cardUrl) return
    setPhase('saving')
    try {
      await post('/api/profile/avatar', { avatar: cardUrl, cutout: cutoutDataUrl ?? null })
      onSave?.(cardUrl, cutoutDataUrl ?? null)
      setPhase('view')
    } catch {
      setError('Could not save. Please try again.')
      setPhase('customize')
    }
  }

  function retake() {
    setCutoutBlob(null)
    setCutoutDataUrl(null)
    setCardUrl(existingCard ?? null)
    setPhase('intro')
  }

  useEffect(() => () => {
    stopCamera()
    clearInterval(timerRef.current)
  }, [])

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'flex-start',
      overflowY: 'auto',
    }}>
      <CoachMark
        id="player_card"
        user={user}
        title="Your AI player card"
        body="Take a selfie and we'll cut out your body, drop in your country flag, and render a PGA Tour broadcast-style card. Used for the leaderboard and match recaps. Re-take anytime."
      />
      {/* Header */}
      <div style={{
        width: '100%', maxWidth: 430,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'max(16px, env(safe-area-inset-top)) 20px 0',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(0,0,0,0.88)',
        backdropFilter: 'blur(16px)',
      }}>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 20,
          color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 600,
          padding: '6px 14px', cursor: 'pointer',
        }}>✕ Close</button>
        <div style={{
          fontSize: 13, fontWeight: 700, letterSpacing: '0.1em',
          background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>PLAYER CARD</div>
        <div style={{ width: 70 }} />
      </div>

      {/* Content */}
      <div style={{ width: '100%', maxWidth: 430, padding: '20px 20px 32px' }}>
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 12, padding: '12px 16px', marginBottom: 16,
            color: '#FCA5A5', fontSize: 13,
          }}>{error}</div>
        )}

        {phase === 'intro' && (
          <IntroScreen onStart={startCamera} hasExisting={!!existingCard} onViewExisting={() => setPhase('view')} />
        )}
        {phase === 'camera' && (
          <CameraScreen videoRef={videoRef} onCapture={captureFrame} onCancel={() => { stopCamera(); setPhase('intro') }} />
        )}
        {phase === 'processing' && <ProcessingScreen msg={PROC_MSGS[procIdx]} />}
        {phase === 'customize' && cardUrl && (
          <CustomizeScreen
            cardUrl={cardUrl}
            rebuildKey={rebuildKey}
            flagIdx={flagIdx}
            flags={COUNTRY_FLAGS}
            onFlag={applyFlag}
            onSave={saveCard}
            onRetake={retake}
          />
        )}
        {phase === 'saving' && <SavingScreen />}
        {phase === 'view' && cardUrl && (
          <ViewScreen cardUrl={cardUrl} onRetake={retake} onClose={onClose} />
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── Sub-screens ──────────────────────────────────────────────────────────────

function IntroScreen({ onStart, hasExisting, onViewExisting }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <div style={{
        width: 100, height: 100, borderRadius: '50%', margin: '0 auto 24px',
        background: 'radial-gradient(circle, rgba(197,160,64,0.15) 0%, rgba(197,160,64,0.04) 100%)',
        border: '1px solid rgba(197,160,64,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 40px rgba(197,160,64,0.1)',
      }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="rgba(245,215,138,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>
      </div>

      <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', marginBottom: 10 }}>
        Your Player Card
      </div>
      <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: 32, maxWidth: 300, margin: '0 auto 32px' }}>
        Take a selfie and we'll generate a broadcast-style card with your country's flag — just like the PGA Tour.
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16, padding: '20px', marginBottom: 28, textAlign: 'left',
      }}>
        {[
          { n: '1', text: 'Take a selfie in your golf gear' },
          { n: '2', text: 'AI removes the background automatically' },
          { n: '3', text: 'Choose your country flag background' },
          { n: '4', text: 'Your card is saved to your profile' },
        ].map(s => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: s.n === '4' ? 0 : 14 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: '#070C09',
            }}>{s.n}</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{s.text}</div>
          </div>
        ))}
      </div>

      <button onClick={onStart} style={{
        width: '100%', padding: '16px', borderRadius: 16,
        background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9A040 100%)',
        border: 'none', color: '#070C09', fontWeight: 800, fontSize: 16,
        cursor: 'pointer', letterSpacing: '0.04em',
        boxShadow: '0 4px 24px rgba(201,160,64,0.35)',
      }}>
        📸  Take Selfie
      </button>

      {hasExisting && (
        <button onClick={onViewExisting} style={{
          width: '100%', marginTop: 12, padding: '14px',
          background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16, color: 'rgba(255,255,255,0.55)', fontSize: 14, cursor: 'pointer',
        }}>
          View current card
        </button>
      )}
    </div>
  )
}

function CameraScreen({ videoRef, onCapture, onCancel }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 16, letterSpacing: '0.08em' }}>
        CENTER YOURSELF IN FRAME
      </div>
      <div style={{
        position: 'relative', borderRadius: 20, overflow: 'hidden',
        border: '1px solid rgba(197,160,64,0.3)',
        boxShadow: '0 0 40px rgba(197,160,64,0.1)',
        background: '#000', aspectRatio: '3/4',
      }}>
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
        />
        {[
          { top: 12, left: 12, borderTop: '3px solid rgba(245,215,138,0.8)', borderLeft: '3px solid rgba(245,215,138,0.8)' },
          { top: 12, right: 12, borderTop: '3px solid rgba(245,215,138,0.8)', borderRight: '3px solid rgba(245,215,138,0.8)' },
          { bottom: 12, left: 12, borderBottom: '3px solid rgba(245,215,138,0.8)', borderLeft: '3px solid rgba(245,215,138,0.8)' },
          { bottom: 12, right: 12, borderBottom: '3px solid rgba(245,215,138,0.8)', borderRight: '3px solid rgba(245,215,138,0.8)' },
        ].map((s, i) => (
          <div key={i} style={{ position: 'absolute', width: 24, height: 24, ...s, borderRadius: 3 }} />
        ))}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ width: '62%', height: '55%', borderRadius: '50%', border: '1.5px dashed rgba(245,215,138,0.25)' }} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: '14px 0 24px', lineHeight: 1.5 }}>
        Wear your polo and golf cap for the full PGA Tour look
      </div>
      <button onClick={onCapture} style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
        border: '4px solid rgba(255,255,255,0.15)',
        boxShadow: '0 4px 32px rgba(201,160,64,0.5)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 16px',
      }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#070C09' }} />
      </button>
      <button onClick={onCancel} style={{
        background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
        fontSize: 14, cursor: 'pointer', padding: '8px',
      }}>Cancel</button>
    </div>
  )
}

function ProcessingScreen({ msg }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ marginBottom: 32, position: 'relative', width: 80, height: 80, margin: '0 auto 32px' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid rgba(197,160,64,0.15)' }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid transparent', borderTopColor: '#E8C05A', animation: 'tm-spin 0.9s linear infinite' }} />
        <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', border: '2px solid transparent', borderTopColor: 'rgba(232,192,90,0.4)', animation: 'tm-spin 1.4s linear infinite reverse' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>✦</div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Building your card…</div>
      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', minHeight: 22, transition: 'opacity 0.3s' }}>{msg}</div>
      <div style={{ marginTop: 32, fontSize: 12, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6 }}>
        First run takes ~30 sec to load the AI model.<br />Subsequent cards are instant.
      </div>
      <style>{`@keyframes tm-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function CustomizeScreen({ cardUrl, rebuildKey, flagIdx, flags, onFlag, onSave, onRetake }) {
  return (
    <div>
      {/* Card preview */}
      <div style={{
        borderRadius: 20, overflow: 'hidden', marginBottom: 20,
        boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
      }}>
        <img key={rebuildKey} src={cardUrl} alt="Player card" style={{ width: '100%', display: 'block' }} />
      </div>

      {/* Country flag selector */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em',
          marginBottom: 12, fontWeight: 600,
        }}>CHOOSE YOUR COUNTRY</div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
          maxHeight: 280, overflowY: 'auto',
          paddingRight: 2,
        }}>
          {flags.map((f, i) => (
            <button key={f.id} onClick={() => onFlag(i)} style={{
              padding: '10px 8px', borderRadius: 12, cursor: 'pointer',
              border: i === flagIdx
                ? `2px solid ${f.accent}`
                : '2px solid rgba(255,255,255,0.08)',
              background: i === flagIdx
                ? `rgba(${hexToRgb(f.accent)},0.14)`
                : 'rgba(255,255,255,0.04)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              transition: 'all 0.18s ease',
            }}>
              {/* Mini flag preview — real flag image, matches what gets used on the card */}
              <div style={{
                width: 36, height: 24, borderRadius: 4, overflow: 'hidden',
                position: 'relative', background: '#F5F2EC',
                border: '1px solid rgba(255,255,255,0.1)',
                flexShrink: 0,
              }}>
                <img
                  src={`https://flagcdn.com/w80/${f.iso}.png`}
                  alt={f.name}
                  loading="lazy"
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover', objectPosition: 'center',
                    display: 'block',
                  }}
                />
              </div>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                color: i === flagIdx ? '#fff' : 'rgba(255,255,255,0.40)',
                textAlign: 'center', lineHeight: 1.2,
              }}>{f.name}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <button onClick={onSave} style={{
        width: '100%', padding: '16px', borderRadius: 16, marginBottom: 12,
        background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9A040 100%)',
        border: 'none', color: '#070C09', fontWeight: 800, fontSize: 16,
        cursor: 'pointer', letterSpacing: '0.04em',
        boxShadow: '0 4px 24px rgba(201,160,64,0.35)',
      }}>
        Save Card to Profile
      </button>
      <button onClick={onRetake} style={{
        width: '100%', padding: '14px', borderRadius: 16,
        background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
        color: 'rgba(255,255,255,0.5)', fontSize: 14, cursor: 'pointer',
      }}>
        Retake Photo
      </button>
    </div>
  )
}

function SavingScreen() {
  return (
    <div style={{ textAlign: 'center', padding: '80px 20px' }}>
      <div style={{
        width: 56, height: 56, margin: '0 auto 20px', borderRadius: '50%',
        border: '3px solid transparent', borderTopColor: '#E8C05A',
        animation: 'tm-spin 0.9s linear infinite',
      }} />
      <div style={{ color: '#fff', fontSize: 16, fontWeight: 600 }}>Saving your card…</div>
      <style>{`@keyframes tm-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ViewScreen({ cardUrl, onRetake, onClose }) {
  function handleShare() {
    if (navigator.share) {
      navigator.share({ title: 'My Player Card — The Match', text: 'Check out my player card!', url: window.location.href }).catch(() => {})
    }
  }
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)',
        borderRadius: 20, padding: '6px 14px', marginBottom: 16,
        fontSize: 13, fontWeight: 600, color: '#4ADE80',
      }}>✓ Card saved to your profile</div>
      <div style={{
        borderRadius: 20, overflow: 'hidden', marginBottom: 20,
        boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)',
      }}>
        <img src={cardUrl} alt="Your player card" style={{ width: '100%', display: 'block' }} />
      </div>
      {navigator.share && (
        <button onClick={handleShare} style={{
          width: '100%', padding: '16px', borderRadius: 16, marginBottom: 12,
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
          color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
        }}>Share Card ↗</button>
      )}
      <button onClick={onRetake} style={{
        width: '100%', padding: '14px', borderRadius: 16, marginBottom: 10,
        background: 'transparent', border: '1px solid rgba(255,255,255,0.10)',
        color: 'rgba(255,255,255,0.5)', fontSize: 14, cursor: 'pointer',
      }}>Retake Photo</button>
      <button onClick={onClose} style={{
        width: '100%', padding: '14px', borderRadius: 16,
        background: 'linear-gradient(135deg, #F5D78A 0%, #C9A040 100%)',
        border: 'none', color: '#070C09', fontWeight: 700, fontSize: 15, cursor: 'pointer',
      }}>Done</button>
    </div>
  )
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}
