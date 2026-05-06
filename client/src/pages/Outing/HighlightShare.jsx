import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// ─── Outing/HighlightShare.jsx ───────────────────────────────────────────────
// Auto-generated celebratory image after a birdie / eagle / albatross /
// hole-in-one. Renders a 1080x1080 (Instagram square) Canvas with the
// player's avatar, name, the score badge ("BIRDIE", "EAGLE", "HOLE-IN-ONE"),
// the course, hole number, and a "The Match" wordmark. Hosts the
// `navigator.share` flow with a PNG attachment, falling back to a
// download for browsers without share support.
//
// Triggered from LiveOuting on every score-write where the score is
// at least one stroke under par. Render is deferred to a portal modal
// so the user gets a chance to look at the image before sending — that
// "wow, this looks like a real share-card" moment is the point.
//
// (2026-05-06 — Matt: auto-generated highlight image for birdie/eagle.)

function badgeLabel(diff) {
  if (diff <= -3) return 'ALBATROSS'
  if (diff === -2) return 'EAGLE'
  if (diff === -1) return 'BIRDIE'
  return 'GREAT SCORE'
}

// "Hole in One" overrides BIRDIE/EAGLE if score === 1 (par-3 ace).
// Even on a par-4 (improbable but possible) it's a HIO and gets the
// big label.
function badgeForScore(score, par) {
  if (score === 1) return 'HOLE-IN-ONE'
  return badgeLabel(score - par)
}

// Render the highlight image into a hidden canvas. Returns a Promise
// that resolves with a Blob (PNG). Loads the player's avatar image
// before drawing; if it fails (CORS, missing) renders the initials
// fallback in the same Augusta gold gradient as in the scorecard.
async function renderHighlight({ playerName, avatarUrl, score, par, holeNumber, courseName }) {
  const SIZE = 1080
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')

  // Background — Augusta-night gradient, dark green → black-green.
  // Same palette as the rest of the dark surfaces in the app.
  const bg = ctx.createLinearGradient(0, 0, 0, SIZE)
  bg.addColorStop(0, '#0E3B23')
  bg.addColorStop(0.55, '#0A2C1A')
  bg.addColorStop(1, '#070C09')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Subtle radial gold halo at top-center to make the badge pop.
  const halo = ctx.createRadialGradient(SIZE / 2, SIZE * 0.32, 0, SIZE / 2, SIZE * 0.32, SIZE * 0.55)
  halo.addColorStop(0, 'rgba(232,192,90,0.18)')
  halo.addColorStop(1, 'rgba(232,192,90,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Top wordmark — small, gold serif.
  ctx.fillStyle = '#E8C05A'
  ctx.font = 'bold 28px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('THE MATCH', SIZE / 2, 64)
  // Wordmark divider — small gold rule.
  ctx.strokeStyle = 'rgba(232,192,90,0.40)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(SIZE / 2 - 60, 108)
  ctx.lineTo(SIZE / 2 + 60, 108)
  ctx.stroke()

  // Avatar — circle with image or initials. Augusta gold ring.
  const avatarSize = 180
  const avatarX = SIZE / 2
  const avatarY = 240
  ctx.save()
  ctx.beginPath()
  ctx.arc(avatarX, avatarY, avatarSize / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  if (avatarUrl) {
    try {
      const img = await loadImage(avatarUrl)
      const ratio = Math.max(avatarSize / img.width, avatarSize / img.height)
      const dw = img.width * ratio
      const dh = img.height * ratio
      ctx.drawImage(img, avatarX - dw / 2, avatarY - dh / 2, dw, dh)
    } catch {
      drawInitials(ctx, playerName, avatarX, avatarY, avatarSize)
    }
  } else {
    drawInitials(ctx, playerName, avatarX, avatarY, avatarSize)
  }
  ctx.restore()
  // Gold ring around avatar.
  ctx.strokeStyle = '#E8C05A'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(avatarX, avatarY, avatarSize / 2 + 3, 0, Math.PI * 2)
  ctx.stroke()

  // Player name — under avatar.
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 56px "Helvetica Neue", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(playerName || 'Player', SIZE / 2, avatarY + avatarSize / 2 + 30)

  // The big score badge — "BIRDIE" / "EAGLE" / "HOLE-IN-ONE" in gold.
  const badge = badgeForScore(score, par)
  ctx.fillStyle = '#F5D78A'
  ctx.font = 'bold 144px "Helvetica Neue Black", "Arial Black", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Slight letter-spacing simulation by drawing each glyph manually
  // would be heavy; the visual difference at this size is small enough
  // that the default kerning is fine.
  ctx.fillText(badge, SIZE / 2, 620)

  // Subtitle: "Hole 7 · Pebble Creek Golf Club"
  const holeStr = holeNumber != null ? `Hole ${holeNumber}` : ''
  const courseStr = courseName ? courseName : ''
  const subtitle = [holeStr, courseStr].filter(Boolean).join('  ·  ')
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = '500 38px "Helvetica Neue", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(subtitle, SIZE / 2, 740)

  // Score row — "Scored a 3 on a par 4" or similar, smaller, muted.
  const overUnder = score - par
  const detail = score === 1
    ? 'a hole-in-one on a par ' + par
    : `a ${score} on a par ${par} ${overUnder === -1 ? '(birdie)' : overUnder === -2 ? '(eagle)' : overUnder <= -3 ? '(albatross)' : ''}`
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = '400 28px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText(detail.trim(), SIZE / 2, 802)

  // Date footer.
  const dateStr = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  ctx.fillStyle = 'rgba(232,192,90,0.65)'
  ctx.font = '600 24px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText(dateStr.toUpperCase(), SIZE / 2, SIZE - 100)

  // Bottom gold flourish.
  ctx.strokeStyle = 'rgba(232,192,90,0.45)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(SIZE / 2 - 80, SIZE - 56)
  ctx.lineTo(SIZE / 2 + 80, SIZE - 56)
  ctx.stroke()
  ctx.fillStyle = 'rgba(232,192,90,0.65)'
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE - 56, 4, 0, Math.PI * 2)
  ctx.fill()

  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'))
}

function drawInitials(ctx, name, cx, cy, size) {
  // Same color palette as the in-app avatarBg helper. Hash the name
  // so the same player always gets the same color.
  const palette = ['#1B5E20', '#0D47A1', '#6A1B9A', '#B71C1C', '#006064', '#E65100', '#33691E', '#4527A0']
  let h = 0
  for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) & 0xffff
  const bg = palette[h % palette.length]
  ctx.fillStyle = bg
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size)
  // Initials.
  const initials = (name || '·').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${Math.round(size * 0.40)}px "Arial Black", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(initials, cx, cy)
}

// Load an image with crossorigin set so the canvas remains
// untainted (otherwise toBlob would fail for cross-origin avatars).
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

// ─── HighlightShareModal — the user-visible portal ─────────────────────────
// Pops up with a preview of the rendered image + Share + Skip buttons.
// Dismissable via tap-outside or Skip. Uses navigator.share with the
// PNG blob attached when available; falls back to a download link.
export default function HighlightShareModal({
  playerName, avatarUrl, score, par, holeNumber, courseName, onClose,
}) {
  const [imgUrl, setImgUrl] = useState(null)
  const [imgBlob, setImgBlob] = useState(null)
  const [error, setError] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [shared, setShared] = useState(false)
  const cancelledRef = useRef(false)

  // Render the image once on mount. Cancellation guard so an unmount
  // mid-render doesn't trigger a setState on a dead component.
  useEffect(() => {
    cancelledRef.current = false
    let createdUrl = null
    ;(async () => {
      try {
        const blob = await renderHighlight({ playerName, avatarUrl, score, par, holeNumber, courseName })
        if (cancelledRef.current) return
        if (!blob) throw new Error('Could not render image')
        createdUrl = URL.createObjectURL(blob)
        setImgUrl(createdUrl)
        setImgBlob(blob)
      } catch (e) {
        console.error('[highlight render]', e)
        if (!cancelledRef.current) setError('Could not render the highlight image.')
      }
    })()
    return () => {
      cancelledRef.current = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [playerName, avatarUrl, score, par, holeNumber, courseName])

  async function share() {
    if (!imgBlob || sharing) return
    setSharing(true)
    try {
      const file = new File([imgBlob], 'the-match-highlight.png', { type: 'image/png' })
      const text = `${badgeForScore(score, par)} on Hole ${holeNumber} at ${courseName || 'the course'}`
      // Try file-share first (iOS 15+ / modern Android).
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text })
          setShared(true)
        } catch (e) {
          // User cancelled — silent. Other errors fall through to download.
          if (e?.name !== 'AbortError') downloadFallback()
        }
      } else {
        downloadFallback()
      }
    } finally {
      setSharing(false)
    }
  }

  function downloadFallback() {
    if (!imgUrl) return
    const a = document.createElement('a')
    a.href = imgUrl
    a.download = `the-match-${badgeForScore(score, par).toLowerCase()}-hole-${holeNumber}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setShared(true)
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10001,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        animation: 'tm-celebrate-pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380,
          background: '#FFFDF8',
          borderRadius: 24, padding: '20px 20px 18px',
          boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
          textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase',
          color: '#7A5800',
        }}>
          {badgeForScore(score, par)} · Share-card ready
        </div>
        <div style={{
          fontSize: 17, fontWeight: 800, color: '#0D1F12', lineHeight: 1.25,
        }}>
          {playerName || 'You'} on Hole {holeNumber}
        </div>

        {/* Image preview (or skeleton while rendering). */}
        <div style={{
          width: '100%', aspectRatio: '1 / 1',
          background: '#0E3B23',
          borderRadius: 16, overflow: 'hidden',
          border: '2px solid rgba(201,160,64,0.55)',
          boxShadow: '0 6px 22px rgba(201,160,64,0.22)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          {imgUrl
            ? <img src={imgUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : error
              ? <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, padding: 20, textAlign: 'center' }}>{error}</div>
              : <div style={{ color: 'rgba(232,192,90,0.65)', fontSize: 12, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Rendering…</div>
          }
        </div>

        {/* Action buttons. */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <button
            onClick={share}
            disabled={!imgBlob || sharing}
            style={{
              width: '100%', padding: '14px', borderRadius: 14, border: 'none',
              background: imgBlob && !sharing
                ? 'linear-gradient(135deg, #F5D78A 0%, #C9A040 100%)'
                : 'rgba(13,31,18,0.10)',
              color: imgBlob && !sharing ? '#070C09' : 'rgba(13,31,18,0.40)',
              fontWeight: 800, fontSize: 15,
              cursor: imgBlob && !sharing ? 'pointer' : 'default',
              boxShadow: imgBlob && !sharing
                ? '0 4px 14px rgba(201,160,64,0.30), inset 0 1px 0 rgba(255,255,255,0.30)'
                : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            {sharing ? 'Opening share sheet…' : shared ? 'Shared! Tap to share again' : 'Share'}
          </button>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '10px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'transparent', color: 'rgba(13,31,18,0.55)',
              fontWeight: 700, fontSize: 13,
            }}>
            Skip
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Convenience export — used by LiveOuting to decide whether to fire
// the modal at all. Returns true for any score that should celebrate
// (sub-par OR a hole-in-one regardless of par).
export function shouldCelebrate(score, par) {
  if (!Number.isFinite(score) || !Number.isFinite(par)) return false
  if (score < 1) return false
  if (score === 1) return true                   // hole-in-one on any par
  return (score - par) <= -1                     // birdie or better
}
