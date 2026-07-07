import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api.js'
import { aggregateYear } from '../../lib/year-recap.js'

// ─── Outing/YearRecap.jsx ───────────────────────────────────────────────────
// "Your year in golf" share card. 1080x1080 PNG rendered via Canvas (same
// pipeline as HighlightShare + MatchEndShare). Aggregates the user's
// round history for a given year (default: current year) into a stats
// grid, then offers navigator.share with a file blob (download fallback).
//
// MVP stats shown on the card:
//   • Rounds played
//   • Best round (lowest gross + course_par diff)
//   • Sub-80 round count
//   • Eagles + birdies counted across all rounds
//   • Most-played course
//
// Data source: /api/rounds?limit=400 (caller can filter year client-side).
// 400 is generous — even a heavy player rarely posts more than 200/yr.
//
// (2026-05-06 — polish task #10)

// aggregateYear lives in lib/year-recap.js — extracted 2026-05-06 so
// it can be unit-tested with plain Node (no JSX in the parse path).

async function renderRecap(stats) {
  const SIZE = 1080
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')

  // Background — same Augusta-night gradient as the other share cards.
  const bg = ctx.createLinearGradient(0, 0, 0, SIZE)
  bg.addColorStop(0, '#0E3B23')
  bg.addColorStop(0.55, '#0A2C1A')
  bg.addColorStop(1, '#070C09')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Gold halo bottom-third for the year numerals.
  const halo = ctx.createRadialGradient(SIZE / 2, SIZE * 0.62, 0, SIZE / 2, SIZE * 0.62, SIZE * 0.55)
  halo.addColorStop(0, 'rgba(232,192,90,0.18)')
  halo.addColorStop(1, 'rgba(232,192,90,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Wordmark + rule.
  ctx.fillStyle = 'var(--tm-gold-bright)'
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

  // Year header.
  ctx.fillStyle = 'rgba(232,192,90,0.7)'
  ctx.font = '600 24px "Helvetica Neue", Arial, sans-serif'
  ctx.fillText('YOUR YEAR IN GOLF', SIZE / 2, 168)
  ctx.fillStyle = '#F5D78A'
  ctx.font = 'bold 188px "Helvetica Neue Black", Arial, sans-serif'
  ctx.fillText(String(stats.year), SIZE / 2, 220)

  // Stats grid — 2 columns, 3 rows. Every value is computable from
  // the rounds we actually store; no per-hole inference. (Hardening
  // pass — earlier version had eagles/birdies derived by assuming
  // par-4-per-hole, which was wrong.)
  const cells = [
    { label: 'ROUNDS', value: String(stats.totalRounds) },
    { label: 'BEST',   value: stats.best
        ? `${stats.best.total}${Number.isFinite(stats.best.par) ? `  (${diffStr(stats.best.total - stats.best.par)})` : ''}`
        : '—' },
    { label: 'DAYS ON COURSE', value: String(stats.daysOnCourse) },
    { label: 'SUB-80', value: String(stats.sub80) },
    { label: 'AVG SCORE', value: Number.isFinite(stats.avgScore) ? stats.avgScore.toFixed(1) : '—' },
    { label: 'TOP COURSE', value: stats.topCourse ? truncate(ctx, stats.topCourse.name, 280) : '—' },
  ]
  const startY = 510
  const cellW  = 460
  const cellH  = 140
  const gapX   = 20
  const gapY   = 16
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  cells.forEach((c, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = (SIZE - 2 * cellW - gapX) / 2 + col * (cellW + gapX)
    const y = startY + row * (cellH + gapY)
    // Card bg.
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    roundedRect(ctx, x, y, cellW, cellH, 18)
    ctx.fill()
    ctx.strokeStyle = 'rgba(232,192,90,0.22)'
    ctx.lineWidth = 1.5
    roundedRect(ctx, x, y, cellW, cellH, 18)
    ctx.stroke()
    // Label.
    ctx.fillStyle = 'rgba(232,192,90,0.65)'
    ctx.font = '700 18px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(c.label, x + 22, y + 22)
    // Value (resize down if too wide).
    let fontSize = 56
    let value = c.value
    ctx.fillStyle = '#FFFFFF'
    while (fontSize > 24) {
      ctx.font = `bold ${fontSize}px "Helvetica Neue Black", Arial, sans-serif`
      if (ctx.measureText(value).width <= cellW - 44) break
      fontSize -= 4
    }
    ctx.fillText(value, x + 22, y + 56)
  })

  // Footer flourish.
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

function diffStr(d) {
  if (!Number.isFinite(d)) return ''
  if (d === 0) return 'E'
  if (d > 0)   return `+${d}`
  return String(d)
}

function truncate(ctx, text, maxWidth) {
  if (!text) return ''
  ctx.font = '500 28px "Helvetica Neue", Arial, sans-serif'
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1)
  return s + '…'
}

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

// ─── Modal ──────────────────────────────────────────────────────────────────

export default function YearRecapModal({ year = new Date().getFullYear(), onClose }) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [imgUrl, setImgUrl] = useState(null)
  const [imgBlob, setImgBlob] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [shared, setShared]   = useState(false)
  const cancelledRef = useRef(false)

  // Load + render on mount.
  useEffect(() => {
    cancelledRef.current = false
    let createdUrl = null
    ;(async () => {
      try {
        const r = await api('/api/rounds?limit=400')
        if (cancelledRef.current) return
        const agg = aggregateYear(Array.isArray(r?.rounds) ? r.rounds : [], year)
        if (cancelledRef.current) return
        if (!agg) {
          setError(`No rounds in ${year} yet — log a round and come back.`)
          setStats({ year, totalRounds: 0 })
          return
        }
        setStats(agg)
        const blob = await renderRecap(agg)
        if (cancelledRef.current || !blob) return
        createdUrl = URL.createObjectURL(blob)
        setImgUrl(createdUrl)
        setImgBlob(blob)
      } catch (e) {
        console.error('[year-recap]', e)
        if (!cancelledRef.current) setError('Could not build your year recap.')
      }
    })()
    return () => {
      cancelledRef.current = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  async function share() {
    if (!imgBlob || sharing) return
    setSharing(true)
    try {
      const file = new File([imgBlob], `the-match-${year}-recap.png`, { type: 'image/png' })
      const text = `My ${year} in golf — tracked on The Match`
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
    a.download = `the-match-${year}-recap.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setShared(true)
  }

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'rgba(0,0,0,0.78)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      animation: 'tm-celebrate-pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 380,
        background: '#FFFDF8',
        borderRadius: 24, padding: '20px 20px 18px',
        boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
        textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--tm-gold-text)',
        }}>{year} in golf · share-card ready</div>

        {stats && stats.totalRounds > 0 && (
          <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.62)', fontWeight: 600 }}>
            {stats.totalRounds} rounds · {stats.daysOnCourse} day{stats.daysOnCourse === 1 ? '' : 's'} on course · {stats.sub80} sub-80
          </div>
        )}

        {/* Image preview (or skeleton while rendering). */}
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
              ? <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, padding: 24, textAlign: 'center', lineHeight: 1.4 }}>{error}</div>
              : <div style={{ color: 'rgba(232,192,90,0.65)', fontSize: 12, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Rendering…</div>
          }
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <button
            onClick={share}
            disabled={!imgBlob || sharing}
            style={{
              width: '100%', padding: '14px', borderRadius: 14, border: 'none',
              background: imgBlob && !sharing
                ? 'linear-gradient(135deg, #F5D78A 0%, var(--tm-gold) 100%)'
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
          <button onClick={onClose} style={{
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
