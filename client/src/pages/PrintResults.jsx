// Print-friendly results page (item 9 — clubhouse bulletin board).
//
// /?print=ABCD opens a black-on-white, full-bleed leaderboard +
// scorecard grid styled for an 8.5×11 portrait page. Auto-triggers
// window.print() ~600ms after the data lands so the host taps once
// and the system print dialog pops. Re-printable any time via the
// "Print again" button at the top.
//
// Design intent: looks like a tournament results sheet you'd pin to
// the bulletin board — bold serif title block, leaderboard with
// to-par column, scorecard grid with hole-by-hole scores.
//
// Pulls from the existing /api/outings/:code/public endpoint so it
// works without auth.
//
// (2026-05-02 — league readiness item 9.)

import { useEffect, useState } from 'react'

export default function PrintResults({ code }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/outings/${encodeURIComponent(code)}/public`)
        if (!res.ok) {
          if (!cancelled) setError(res.status === 404 ? 'Match not found' : 'Could not load')
          return
        }
        const body = await res.json()
        if (!cancelled) setData(body.outing)
      } catch {
        if (!cancelled) setError('Could not load')
      }
    }
    load()
    return () => { cancelled = true }
  }, [code])

  // Auto-trigger the print dialog once data is rendered. Small delay
  // so the layout settles. The user can also tap "Print again" if
  // they need another copy.
  useEffect(() => {
    if (!data) return
    const t = setTimeout(() => {
      try { window.print() } catch { /* some browsers throttle, no-op */ }
    }, 600)
    return () => clearTimeout(t)
  }, [data])

  if (error) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fff', color: '#222', fontFamily: '"Georgia", serif', fontSize: 14,
        padding: 24, textAlign: 'center',
      }}>{error} — code {code}</div>
    )
  }
  if (!data) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#fff', color: '#222', fontFamily: '"Georgia", serif', fontSize: 14,
      }}>Preparing print sheet…</div>
    )
  }

  const holes = data.state?.holes ?? 18
  const realPars = Array.isArray(data.hole_pars) ? data.hole_pars : null
  const holePars = realPars && realPars.length >= holes
    ? realPars.slice(0, holes)
    : (() => {
        const cp = data.course_par ?? 72
        const base = Math.floor(cp / holes), extra = cp - base * holes
        return Array.from({ length: holes }, (_, i) => i < extra ? base + 1 : base)
      })()
  const coursePar = holePars.reduce((s, p) => s + (p || 0), 0)
  const noShowPolicy = data.state?.no_show_policy || 'dns'
  const participants = (data.state?.participants ?? [])
    .filter(p => !p.withdrawn)
    .filter(p => !(p.no_show && noShowPolicy === 'dns'))
  const noShowList = noShowPolicy === 'dns'
    ? (data.state?.participants ?? []).filter(p => !p.withdrawn && p.no_show)
    : []

  function totalStp(p) {
    const sc = p.scores || []
    let total = 0, par = 0
    for (let h = 0; h < holes; h++) {
      const s = sc[h] || 0
      if (s > 0) { total += s; par += holePars[h] || 4 }
    }
    return total > 0 ? total - par : null
  }
  function totalGross(p) {
    return (p.scores || []).reduce((s, v) => s + (v || 0), 0)
  }

  const sorted = [...participants].sort((a, b) => {
    const ta = totalGross(a), tb = totalGross(b)
    if (ta === 0 && tb === 0) return 0
    if (ta === 0) return 1
    if (tb === 0) return -1
    return ta - tb
  })

  const dateStr = (() => {
    const d = new Date()
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  })()

  return (
    <div style={{
      minHeight: '100dvh', background: '#fff', color: '#111',
      fontFamily: '"Georgia", "Times New Roman", serif',
      padding: '24px 36px',
      maxWidth: 850, margin: '0 auto',
    }}>
      {/* Print stylesheet — hide screen-only chrome; force black on white */}
      <style>{`
        @page { size: letter portrait; margin: 0.5in; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; color: #000 !important; }
          .pr-table { page-break-inside: avoid; }
        }
        .pr-table { border-collapse: collapse; width: 100%; font-size: 11px; }
        .pr-table th, .pr-table td { border: 1px solid #333; padding: 4px 6px; text-align: center; }
        .pr-table th { background: #f1e7c8; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; font-size: 9px; }
        .pr-table td.name { text-align: left; font-weight: 700; }
        .pr-table td.pos  { font-weight: 800; }
      `}</style>

      {/* Re-print bar (screen only) */}
      <div className="no-print" style={{
        background: '#f6f0d8', border: '1px solid #c9a040',
        padding: '8px 12px', borderRadius: 6, marginBottom: 16,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12,
      }}>
        <span>This page is print-formatted. Browser dialog should open automatically.</span>
        <button onClick={() => window.print()} style={{
          padding: '6px 14px', borderRadius: 4, border: '1px solid #2a7a38',
          background: '#2a7a38', color: '#fff', fontWeight: 800, fontSize: 11, cursor: 'pointer',
        }}>Print again</button>
      </div>

      {/* Title block */}
      <div style={{ textAlign: 'center', borderBottom: '3px double #000', paddingBottom: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 9, letterSpacing: '0.3em', fontWeight: 700, marginBottom: 4 }}>
          {data.status === 'closed' || data.status === 'ended' ? 'FINAL RESULTS' : 'LIVE STANDINGS'}
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.01em' }}>{data.name}</div>
        <div style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>
          {data.course_name} · Par {data.course_par || coursePar} · {dateStr}
        </div>
        {data.state?.season && (
          <div style={{ fontSize: 10, marginTop: 4, letterSpacing: '0.06em' }}>
            SEASON · {data.state.season.toUpperCase()}
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.10em', marginBottom: 6 }}>LEADERBOARD</div>
      <table className="pr-table" style={{ marginBottom: 18 }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>Pos</th>
            <th style={{ textAlign: 'left' }}>Player</th>
            <th style={{ width: 60 }}>Total</th>
            <th style={{ width: 60 }}>To Par</th>
            <th style={{ width: 60 }}>Holes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const stp = totalStp(p)
            const tot = totalGross(p)
            const played = (p.scores || []).filter(s => s > 0).length
            return (
              <tr key={p.user_id}>
                <td className="pos">{tot > 0 ? i + 1 : '—'}</td>
                <td className="name">
                  {p.name}
                  {p.handle ? <span style={{ color: '#666', fontWeight: 400, fontSize: 9 }}> · @{p.handle}</span> : null}
                </td>
                <td>{tot > 0 ? tot : '—'}</td>
                <td>{stp == null ? '—' : stp === 0 ? 'E' : stp > 0 ? `+${stp}` : `${stp}`}</td>
                <td>{played}</td>
              </tr>
            )
          })}
          {noShowList.length > 0 && (
            <>
              <tr>
                <td colSpan={5} style={{
                  background: '#eee', fontSize: 9, fontWeight: 800,
                  letterSpacing: '0.10em', textAlign: 'left',
                }}>DID NOT START</td>
              </tr>
              {noShowList.map(p => (
                <tr key={p.user_id} style={{ color: '#666' }}>
                  <td className="pos">DNS</td>
                  <td className="name">{p.name}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>0</td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>

      {/* Scorecard grid — only render when there's at least one score */}
      {sorted.some(p => totalGross(p) > 0) && (
        <>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.10em', marginBottom: 6 }}>SCORECARD</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="pr-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', minWidth: 110 }}>Player</th>
                  {Array.from({ length: Math.min(holes, 18) }, (_, h) => (
                    <th key={h} style={{ width: 22 }}>{h + 1}</th>
                  ))}
                  <th style={{ width: 38 }}>Total</th>
                </tr>
                <tr>
                  <td className="name" style={{ background: '#f1e7c8', fontSize: 9, fontWeight: 700 }}>PAR</td>
                  {holePars.slice(0, Math.min(holes, 18)).map((p, h) => (
                    <td key={h} style={{ background: '#f1e7c8', fontWeight: 700, fontSize: 9 }}>{p}</td>
                  ))}
                  <td style={{ background: '#f1e7c8', fontWeight: 800, fontSize: 9 }}>{coursePar}</td>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => {
                  const sc = p.scores || []
                  const tot = totalGross(p)
                  return (
                    <tr key={p.user_id}>
                      <td className="name">{p.name}</td>
                      {Array.from({ length: Math.min(holes, 18) }, (_, h) => {
                        const s = sc[h] || 0
                        const par = holePars[h] || 4
                        const diff = s > 0 ? s - par : null
                        // Print colors are tasteful — a faint underline for
                        // birdies+ and a tiny dot for bogeys+, no big color
                        // splashes. Better in B&W copies.
                        let style = {}
                        if (diff != null && diff <= -1) style.borderBottom = '2px solid #000'
                        if (diff != null && diff >= 2)  style.fontStyle = 'italic'
                        return (
                          <td key={h} style={style}>{s > 0 ? s : '—'}</td>
                        )
                      })}
                      <td style={{ fontWeight: 800 }}>{tot > 0 ? tot : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 8, color: '#666', marginTop: 4, fontStyle: 'italic' }}>
            Underline = birdie or better · italic = double bogey or worse
          </div>
        </>
      )}

      {/* Footer brand */}
      <div style={{
        marginTop: 24, paddingTop: 12, borderTop: '1px solid #ccc',
        textAlign: 'center', fontSize: 9, color: '#666',
      }}>
        Generated {new Date().toLocaleString()} · the-match.app · Code {data.code}
      </div>
    </div>
  )
}
