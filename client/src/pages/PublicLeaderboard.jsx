// Public live leaderboard — no auth required. Designed for the
// tee-box QR-code scan path:
//   league commissioner posts a flyer with a QR code linking to
//   the-match.app/?live=ABCD on the first tee box. Players or
//   spectators scan it, see the live league standings, and can tap
//   "Install" to bring up the PWA install prompt.
//
// Renders a single Augusta-style scoreboard pulled from
// /api/outings/:code/public (which strips emails / commissioner
// config / per-player permissions). Polls every 5 seconds for
// fresh scores.
//
// (2026-05-01 — Matt: WOW commissioners by giving them a tee-box
// shareable that auto-updates and looks like the Tour.)

import { useEffect, useState } from 'react'

const AUGUSTA_GREEN  = '#0E3B23'
const AUGUSTA_GOLD   = '#C9A040'
const AUGUSTA_CREAM  = '#F1E7C8'
const AUGUSTA_INK    = '#1A1A1A'

function diffStr(p, holePars) {
  const sc = p.scores || []
  const played = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
  if (!played.length) return 'E'
  const par = played.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
  const tot = played.reduce((sum, x) => sum + x.s, 0)
  const d = tot - par
  return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`
}

function thruLabel(p, holeCount) {
  const played = (p.scores || []).filter(s => s > 0).length
  if (played === 0) return '—'
  if (played >= holeCount) return 'F'
  return String(played)
}

function totalStp(p, holePars) {
  const sc = p.scores || []
  const played = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
  if (!played.length) return null
  return played.reduce((sum, x) => sum + (x.s - (holePars[x.i] || 4)), 0)
}

export default function PublicLeaderboard({ code }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  // Reconnecting indicator — turns on when two or more consecutive
  // polls fail. Spectators with bad signal see "reconnecting" rather
  // than silently stale data. Round 4 audit fix.
  const [reconnecting, setReconnecting] = useState(false)

  // Polling fetch loop. Sets up once, lives until the component
  // unmounts (e.g. user navigates away).
  useEffect(() => {
    let cancelled = false
    let interval = null
    let consecutiveFailures = 0
    async function load() {
      try {
        const res = await fetch(`/api/outings/${encodeURIComponent(code)}/public`)
        if (!res.ok) {
          consecutiveFailures += 1
          if (!cancelled) {
            // 404 is permanent (match doesn't exist) — show fatal error.
            // 5xx and other transient codes flip to reconnecting state
            // after 2 failures so spectators know data may be stale.
            if (res.status === 404) {
              setError('Match not found')
              setReconnecting(false)
            } else if (data && consecutiveFailures >= 2) {
              setReconnecting(true)
            } else if (!data) {
              setError('Could not load')
            }
          }
          return
        }
        consecutiveFailures = 0
        const body = await res.json()
        if (!cancelled) {
          setData(body.outing)
          setError(null)
          setReconnecting(false)
        }
      } catch {
        consecutiveFailures += 1
        if (!cancelled) {
          if (data && consecutiveFailures >= 2) setReconnecting(true)
          else if (!data) setError('Could not load')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    interval = setInterval(load, 5000)
    return () => { cancelled = true; if (interval) clearInterval(interval) }
  }, [code, data])

  if (loading && !data) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: AUGUSTA_GREEN, color: AUGUSTA_CREAM, fontFamily: '"Georgia", serif', fontSize: 14,
      }}>Loading live leaderboard…</div>
    )
  }
  if (error) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: AUGUSTA_GREEN, color: AUGUSTA_CREAM, fontFamily: '"Georgia", serif',
        padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{error}</div>
        <div style={{ fontSize: 12, color: 'rgba(241,231,200,0.6)' }}>Code: {code}</div>
      </div>
    )
  }

  const holePars = (() => {
    const real = Array.isArray(data.hole_pars) ? data.hole_pars : null
    const holes = data.state?.holes ?? 18
    if (real && real.length >= holes) return real.slice(0, holes)
    const cp = data.course_par ?? 72
    const base = Math.floor(cp / holes), extra = cp - base * holes
    return Array.from({ length: holes }, (_, i) => i < extra ? base + 1 : base)
  })()
  const participants = data.state?.participants ?? []
  const sorted = [...participants].sort((a, b) => {
    const da = totalStp(a, holePars), db = totalStp(b, holePars)
    if (da == null && db == null) return 0
    if (da == null) return 1
    if (db == null) return -1
    return da - db
  })

  return (
    <div style={{
      minHeight: '100dvh',
      background: `linear-gradient(180deg, ${AUGUSTA_GREEN} 0%, #0A2918 100%)`,
      color: AUGUSTA_CREAM,
      fontFamily: '"Georgia", "Times New Roman", serif',
      paddingBottom: 40,
    }}>
      {/* Top brand bar */}
      <div style={{
        padding: '24px 20px 8px',
        textAlign: 'center',
        borderBottom: `1px solid ${AUGUSTA_GOLD}`,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.30), transparent)',
      }}>
        {/* Status kicker — flips to FINAL when the host has ended
            the match. Spectators can tell at a glance whether the
            board is still updating. (Round 4 audit.) */}
        <div style={{
          fontSize: 11, letterSpacing: '0.30em', color: AUGUSTA_GOLD, fontWeight: 700,
          marginBottom: 6,
        }}>{data.status === 'ended' || data.status === 'closed' ? 'FINAL RESULTS' : 'LIVE LEADERBOARD'}</div>
        <div style={{
          fontSize: 22, fontWeight: 900, color: AUGUSTA_CREAM,
          letterSpacing: '-0.01em', marginBottom: 4,
        }}>{data.name}</div>
        <div style={{ fontSize: 12, color: 'rgba(241,231,200,0.65)', letterSpacing: '0.06em' }}>
          {data.course_name}
          {data.scoring_formats && data.scoring_formats.length > 0 && (
            <> · {String(data.scoring_formats[0]).replace('_', ' ').toUpperCase()}</>
          )}
        </div>
        {/* Reconnecting badge — appears when polls have failed twice
            in a row but we have stale cached data to keep showing.
            (Round 4 audit.) */}
        {reconnecting && (
          <div style={{
            marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 999,
            background: 'rgba(248,180,113,0.15)', border: '1px solid rgba(248,180,113,0.50)',
            color: '#F8B471', fontSize: 10, fontWeight: 700, letterSpacing: '0.10em',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F8B471' }} />
            RECONNECTING · DATA MAY BE STALE
          </div>
        )}
      </div>

      {/* Leaders banner */}
      <div style={{
        background: `linear-gradient(180deg, ${AUGUSTA_CREAM} 0%, #DDD2A8 100%)`,
        textAlign: 'center', padding: '10px 0 8px',
        position: 'relative',
        boxShadow: 'inset 0 -1px 2px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.6)',
      }}>
        <div style={{
          fontSize: 28, fontWeight: 900, color: AUGUSTA_GREEN,
          letterSpacing: '0.20em',
          textShadow: '0 1px 0 rgba(255,255,255,0.7)',
        }}>LEADERS</div>
      </div>

      {/* Player rows */}
      <div style={{ padding: '6px 14px 0' }}>
        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '40px 1fr 60px 60px',
          gap: 8, alignItems: 'center',
          padding: '8px 6px', borderBottom: `1px solid rgba(201,160,64,0.40)`,
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em', textAlign: 'center' }}>POS</div>
          <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em' }}>PLAYER</div>
          <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em', textAlign: 'center' }}>TOT</div>
          <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em', textAlign: 'center' }}>THRU</div>
        </div>

        {sorted.length === 0 && (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            color: 'rgba(241,231,200,0.55)', fontStyle: 'italic',
          }}>Waiting for the first scores…</div>
        )}

        {sorted.map((p, idx) => {
          const tot = totalStp(p, holePars)
          const totDisplay = tot == null ? '—' : (tot === 0 ? 'E' : tot > 0 ? `+${tot}` : `${tot}`)
          return (
            <div key={p.user_id} style={{
              display: 'grid', gridTemplateColumns: '40px 1fr 60px 60px',
              gap: 8, alignItems: 'center',
              padding: '12px 6px',
              borderBottom: '1px solid rgba(241,231,200,0.10)',
              background: idx === 0 && tot != null ? 'rgba(201,160,64,0.14)' : 'transparent',
            }}>
              <div style={{
                fontSize: 14, fontWeight: 900, textAlign: 'center',
                color: idx === 0 && tot != null ? AUGUSTA_GOLD : AUGUSTA_CREAM,
              }}>{tot == null ? '—' : idx + 1}</div>
              <div style={{ minWidth: 0, overflow: 'hidden' }}>
                <div style={{
                  fontSize: 14, fontWeight: 800, color: AUGUSTA_CREAM,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  letterSpacing: '0.02em',
                }}>{p.name}</div>
                {p.handle && (
                  <div style={{ fontSize: 10, color: 'rgba(201,160,64,0.65)' }}>@{p.handle}</div>
                )}
              </div>
              <div style={{
                textAlign: 'center', fontSize: 16, fontWeight: 900,
                color: tot == null ? 'rgba(241,231,200,0.40)'
                  : tot < 0 ? '#E55858'
                  : tot === 0 ? AUGUSTA_CREAM
                  : 'rgba(241,231,200,0.85)',
              }}>{totDisplay}</div>
              <div style={{
                textAlign: 'center', fontSize: 13,
                color: 'rgba(241,231,200,0.65)', fontWeight: 700,
              }}>{thruLabel(p, data.state?.holes ?? 18)}</div>
            </div>
          )
        })}
      </div>

      {/* Footer brand + install CTA */}
      <div style={{ marginTop: 32, padding: '20px', textAlign: 'center' }}>
        <div style={{
          display: 'inline-block',
          background: 'rgba(201,160,64,0.10)', border: `1px solid ${AUGUSTA_GOLD}`,
          borderRadius: 14, padding: '14px 22px',
        }}>
          <div style={{ fontSize: 10, color: AUGUSTA_GOLD, letterSpacing: '0.20em', fontWeight: 700, marginBottom: 6 }}>
            POWERED BY
          </div>
          <div style={{
            fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #F5D78A, #E8C05A, #C9A040)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: 8,
          }}>The Match</div>
          <a href="/" style={{
            display: 'inline-block', padding: '8px 20px',
            background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
            color: '#070C09', textDecoration: 'none',
            borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '0.04em',
          }}>GET THE APP →</a>
        </div>
        <div style={{ marginTop: 16, fontSize: 9, color: 'rgba(241,231,200,0.40)', letterSpacing: '0.10em' }}>
          MATCH CODE · {data.code} · UPDATES LIVE
        </div>
      </div>
    </div>
  )
}
