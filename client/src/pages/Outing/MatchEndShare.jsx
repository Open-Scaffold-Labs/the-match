import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// ─── Outing/MatchEndShare.jsx ────────────────────────────────────────────────
// Match-end share card. Same Canvas pipeline as HighlightShare.jsx — 1080×1080
// PNG, gold halo over Augusta-night gradient, rendered into a hidden canvas
// and exposed via navigator.share with a file blob (or download fallback).
//
// Different content though: this card commemorates the WINNER of an outing
// (the whole match), not a single sub-par hole. Shows the winner name + total,
// the format ("MATCH PLAY · COURSE NAME"), top-3 podium with score diffs, an
// optional highlights line ("John × 3 birdies"), and a date footer.
//
// Triggered from EndMatchScreen as a "Save share image" button alongside the
// existing text + live-link share buttons. Doesn't auto-open — the host taps
// the button when they want a graphic. (2026-05-06 — polish task #4.)
//
// Helper functions (loadImage, drawInitials, the wordmark + footer flourish
// drawing) MIRROR HighlightShare.jsx's. They were not extracted into a shared
// module because the duplication is small and HighlightShare ships in
// production — refactoring on the day we add a sibling would be a drive-by.
// If a third share card lands, extract then.

async function renderMatchEnd({ winner, podium, format, courseName, name, highlights, viewerEntry, totalHoles }) {
  const SIZE = 1080
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')

  // Background — Augusta-night gradient. Mirrors HighlightShare.
  const bg = ctx.createLinearGradient(0, 0, 0, SIZE)
  bg.addColorStop(0, '#0E3B23')
  bg.addColorStop(0.55, '#0A2C1A')
  bg.addColorStop(1, '#070C09')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Gold halo behind the trophy area.
  const halo = ctx.createRadialGradient(SIZE / 2, SIZE * 0.30, 0, SIZE / 2, SIZE * 0.30, SIZE * 0.55)
  halo.addColorStop(0, 'rgba(232,192,90,0.20)')
  halo.addColorStop(1, 'rgba(232,192,90,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Wordmark + rule.
  ctx.fillStyle = '#E8C05A'
  ctx.font = 'bold 28px Georgia, serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('THE MATCH', SIZE / 2, 64)
  ctx.strokeStyle = 'rgba(232,192,90,0.40)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(SIZE / 2 - 60, 108)
  ctx.lineTo(SIZE / 2 + 60, 108)
  ctx.stroke()

  // Trophy SVG, drawn directly. 96×96 nominal, centered horizontally.
  drawTrophy(ctx, SIZE / 2, 200, 100)

  // "WINNER" cap + format/course line.
  ctx.fillStyle = '#E8C05A'
  ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('WINNER', SIZE / 2, 320)
  ctx.fillStyle = 'rgba(232,192,90,0.65)'
  ctx.font = '600 18px "Helvetica Neue", Arial, sans-serif'
  const formatLabel = format === 'match' ? 'MATCH PLAY'
    : format === 'stableford' ? 'STABLEFORD'
    : format === 'skins' ? 'SKINS'
    : 'STROKE PLAY'
  const holesLabel = Number.isFinite(totalHoles) ? `${totalHoles} HOLES` : null
  const headerLine = [formatLabel, holesLabel, (courseName || name || '').toUpperCase()]
    .filter(Boolean).join('  ·  ')
  ctx.fillText(headerLine, SIZE / 2, 354)

  // Winner name — large, white.
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 64px "Helvetica Neue Black", "Arial Black", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(winner?.name || 'Player', SIZE / 2, 400)

  // Winner score — total + diff in gold.
  if (winner) {
    const diff = Number(winner.diff)
    const sign = !Number.isFinite(diff) ? '' : (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`)
    const scoreLine = `${winner.total ?? '—'} strokes${sign ? `  (${sign})` : ''}`
    ctx.fillStyle = '#F5D78A'
    ctx.font = '700 36px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(scoreLine, SIZE / 2, 480)
  }

  // Podium — up to 3 rows, drawn as small cards with rank pill.
  const top3 = (podium || []).slice(0, 3)
  const podiumStart = 568
  const rowH = 92
  const cardX = 120
  const cardW = SIZE - 240
  const pillColors = ['#E8C05A', 'rgba(255,255,255,0.55)', '#CD7F32']
  ctx.textBaseline = 'middle'
  top3.forEach((p, i) => {
    const y = podiumStart + i * rowH
    // Card bg.
    ctx.fillStyle = i === 0 ? 'rgba(232,192,90,0.10)' : 'rgba(255,253,248,0.04)'
    roundedRect(ctx, cardX, y, cardW, rowH - 12, 18)
    ctx.fill()
    ctx.strokeStyle = i === 0 ? 'rgba(232,192,90,0.45)' : 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1.5
    roundedRect(ctx, cardX, y, cardW, rowH - 12, 18)
    ctx.stroke()
    // Rank pill.
    ctx.fillStyle = pillColors[i] || 'rgba(255,255,255,0.20)'
    ctx.beginPath()
    ctx.arc(cardX + 36, y + (rowH - 12) / 2, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#070C09'
    ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(String(i + 1), cardX + 36, y + (rowH - 12) / 2 + 1)
    // Name.
    ctx.fillStyle = i === 0 ? '#F5D78A' : 'rgba(255,253,248,0.92)'
    ctx.font = '700 30px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'left'
    const nameLabel = (p.name || 'Player') + (p.is_guest ? ' (guest)' : '')
    ctx.fillText(truncate(ctx, nameLabel, cardW - 280), cardX + 76, y + (rowH - 12) / 2 + 1)
    // Score + diff at the right.
    const total = p.total ?? '—'
    const diff = Number(p.diff)
    const sign = !Number.isFinite(diff) ? '' : (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`)
    ctx.fillStyle = i === 0 ? '#F5D78A' : 'rgba(255,253,248,0.92)'
    ctx.font = 'bold 36px "Helvetica Neue", Arial, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(String(total), cardX + cardW - 28, y + (rowH - 12) / 2 - 4)
    if (sign) {
      ctx.fillStyle = !Number.isFinite(diff) ? 'rgba(255,253,248,0.45)'
        : diff < 0 ? '#C9A040'
        : diff > 0 ? '#F87171'
        : 'rgba(255,253,248,0.55)'
      ctx.font = '600 18px "Helvetica Neue", Arial, sans-serif'
      ctx.fillText(sign, cardX + cardW - 28, y + (rowH - 12) / 2 + 24)
    }
  })

  // Highlights — single small line, optional.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  let highlightY = podiumStart + top3.length * rowH + 8
  // 2026-05-06 hardening — when the viewer didn't make the podium,
  // surface their own finish position so the share card still feels
  // about the user, not just about the winner. Renders ABOVE the
  // highlights section in a small "you finished" pill.
  if (viewerEntry && viewerEntry.rank > 3) {
    const diff = Number(viewerEntry.diff)
    const sign = !Number.isFinite(diff) ? '' : (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`)
    ctx.fillStyle = 'rgba(232,192,90,0.85)'
    ctx.font = '600 22px "Helvetica Neue", Arial, sans-serif'
    const ranks = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']
    const rankStr = ranks[viewerEntry.rank] || `${viewerEntry.rank}th`
    ctx.fillText(`Your finish: ${rankStr}  ·  ${viewerEntry.total}${sign ? ` (${sign})` : ''}`, SIZE / 2, highlightY)
    highlightY += 36
  }
  if (highlights?.most_eagles) {
    ctx.fillStyle = '#E8C05A'
    ctx.font = '600 22px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(`${highlights.most_eagles.name} · ${highlights.most_eagles.count} eagle${highlights.most_eagles.count !== 1 ? 's' : ''}`, SIZE / 2, highlightY)
    highlightY += 30
  }
  if (highlights?.most_birdies) {
    ctx.fillStyle = '#C9A040'
    ctx.font = '500 20px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(`Most birdies: ${highlights.most_birdies.name} (${highlights.most_birdies.count})`, SIZE / 2, highlightY)
  }

  // Date footer.
  const dateStr = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  ctx.fillStyle = 'rgba(232,192,90,0.65)'
  ctx.font = '600 24px "Helvetica Neue", Arial, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText(dateStr.toUpperCase(), SIZE / 2, SIZE - 100)

  // Bottom flourish.
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

// ─── Canvas helpers ──────────────────────────────────────────────────────────

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// Trophy SVG drawn directly to canvas. Cup body, handles, stem, base.
// Centered on (cx, cy), sized so the bounding height ≈ size.
function drawTrophy(ctx, cx, cy, size) {
  const s = size / 48                // SVG was authored at 48-unit
  const px = (n) => cx + (n - 24) * s
  const py = (n) => cy + (n - 24) * s
  // Cup body.
  ctx.fillStyle = '#F5D78A'
  ctx.strokeStyle = '#E8C05A'
  ctx.lineWidth = Math.max(2, 2.4 * s)
  ctx.beginPath()
  ctx.moveTo(px(16), py(10))
  ctx.lineTo(px(32), py(10))
  ctx.lineTo(px(32), py(20))
  ctx.quadraticCurveTo(px(32), py(28), px(24), py(28))
  ctx.quadraticCurveTo(px(16), py(28), px(16), py(20))
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Left handle.
  ctx.beginPath()
  ctx.moveTo(px(16), py(13))
  ctx.quadraticCurveTo(px(10), py(13), px(10), py(18))
  ctx.quadraticCurveTo(px(10), py(22), px(16), py(22))
  ctx.stroke()
  // Right handle.
  ctx.beginPath()
  ctx.moveTo(px(32), py(13))
  ctx.quadraticCurveTo(px(38), py(13), px(38), py(18))
  ctx.quadraticCurveTo(px(38), py(22), px(32), py(22))
  ctx.stroke()
  // Stem.
  ctx.beginPath()
  ctx.moveTo(px(24), py(28))
  ctx.lineTo(px(24), py(34))
  ctx.stroke()
  // Mid base.
  ctx.beginPath()
  ctx.moveTo(px(20), py(34))
  ctx.lineTo(px(28), py(34))
  ctx.stroke()
  // Bottom base.
  ctx.lineWidth = Math.max(2.4, 2.8 * s)
  ctx.beginPath()
  ctx.moveTo(px(17), py(38))
  ctx.lineTo(px(31), py(38))
  ctx.stroke()
}

function truncate(ctx, text, maxWidth) {
  if (!text) return ''
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
    s = s.slice(0, -1)
  }
  return s + '…'
}

// ─── Modal ──────────────────────────────────────────────────────────────────

export default function MatchEndShareModal({ summary, viewerId, onClose }) {
  const { winner, podium = [], highlights, course, course_par: _cp, format, name, holes } = summary || {}
  const courseName = course || name
  // 2026-05-06 hardening — find the viewer's full standing so the card
  // can render their finish even when they're not on the top 3 podium.
  // Walks the FULL podium (which includes everyone, not just top 3 —
  // server returns the full sorted list as `podium`).
  const viewerEntry = (() => {
    if (!viewerId) return null
    const idx = podium.findIndex(p => String(p.user_id) === String(viewerId))
    if (idx < 0) return null
    return { ...podium[idx], rank: idx + 1 }
  })()
  // Holes count for the format header. Falls back to the podium leader's
  // holes_played (a finished-match snapshot should have everyone at the
  // same number).
  const totalHoles = Number(holes) || podium[0]?.holes_played || null
  const [imgUrl, setImgUrl] = useState(null)
  const [imgBlob, setImgBlob] = useState(null)
  const [error, setError] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [shared, setShared] = useState(false)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    let createdUrl = null
    ;(async () => {
      try {
        const blob = await renderMatchEnd({
          winner, podium, format, courseName, name, highlights,
          viewerEntry, totalHoles,
        })
        if (cancelledRef.current) return
        if (!blob) throw new Error('Could not render image')
        createdUrl = URL.createObjectURL(blob)
        setImgUrl(createdUrl)
        setImgBlob(blob)
      } catch (e) {
        console.error('[match-end share render]', e)
        if (!cancelledRef.current) setError('Could not render the share image.')
      }
    })()
    return () => {
      cancelledRef.current = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function share() {
    if (!imgBlob || sharing) return
    setSharing(true)
    try {
      const file = new File([imgBlob], 'the-match-result.png', { type: 'image/png' })
      const text = winner ? `${winner.name} won ${courseName || 'The Match'}` : 'Final results — The Match'
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text })
          setShared(true)
        } catch (e) {
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
    a.download = `the-match-result-${(winner?.name || 'final').toLowerCase().replace(/\s+/g, '-')}.png`
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
          Match results · Share-card ready
        </div>
        <div style={{
          fontSize: 17, fontWeight: 800, color: '#0D1F12', lineHeight: 1.25,
        }}>
          {winner ? `${winner.name} wins` : 'Final results'}
          {courseName && (
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'rgba(13,31,18,0.55)', marginTop: 2 }}>
              {courseName}
            </span>
          )}
        </div>

        {/* Image preview. */}
        <div style={{
          width: '100%', aspectRatio: '1 / 1',
          background: '#0E3B23',
          borderRadius: 16, overflow: 'hidden',
          border: '2px solid rgba(201,160,64,0.55)',
          boxShadow: '0 6px 22px rgba(201,160,64,0.22)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
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
            {sharing ? 'Opening share sheet…' : shared ? 'Shared! Tap to share again' : 'Share image'}
          </button>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '10px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'transparent', color: 'rgba(13,31,18,0.55)',
              fontWeight: 700, fontSize: 13,
            }}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
