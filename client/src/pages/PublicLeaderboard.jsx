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
const AUGUSTA_GOLD   = 'var(--tm-gold)'
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

// ─── Format-aware scoring (mirrors Outing.jsx helpers) ─────────────
// We re-implement the math locally instead of importing from Outing.jsx
// because (a) it's small and (b) PublicLeaderboard is a no-auth page
// that shouldn't drag in the entire authoring surface. Keep these
// in sync with the in-app helpers — same algorithms, same outputs.
// (Round 7 audit: format-aware public leaderboard.)
const STABLEFORD_PRESETS_PUB = {
  standard: { double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1 },
  modified: { double_eagle: 8, eagle: 5, birdie: 2, par: 0, bogey: -1, double: -3, worse: -3 },
}

function computeSkinsPub(participants, holePars) {
  const skinsByPlayer = {}
  let carry = 0
  for (let h = 0; h < holePars.length; h++) {
    const entries = participants
      .map(p => ({ id: p.user_id, s: (p.scores || [])[h] || 0 }))
      .filter(x => x.s > 0)
    if (entries.length < 2) continue
    let low = Infinity, lowCount = 0, lowId = null
    for (const e of entries) {
      if (e.s < low)        { low = e.s; lowCount = 1; lowId = e.id }
      else if (e.s === low) { lowCount += 1 }
    }
    if (lowCount === 1) {
      skinsByPlayer[lowId] = (skinsByPlayer[lowId] || 0) + (1 + carry)
      carry = 0
    } else {
      carry += 1
    }
  }
  return skinsByPlayer
}

function computeStablefordPub(participants, holePars, pointMap) {
  const pts = pointMap || STABLEFORD_PRESETS_PUB.standard
  const out = {}
  for (const p of participants) {
    let total = 0
    const sc = p.scores || []
    for (let h = 0; h < holePars.length; h++) {
      const s = sc[h] || 0
      if (s <= 0) continue
      const diff = s - (holePars[h] || 4)
      const bucket = diff <= -3 ? 'double_eagle'
        : diff === -2 ? 'eagle'
        : diff === -1 ? 'birdie'
        : diff === 0  ? 'par'
        : diff === 1  ? 'bogey'
        : diff === 2  ? 'double'
        : 'worse'
      total += (pts[bucket] ?? 0)
    }
    out[p.user_id] = total
  }
  return out
}

// 6.3 — Best Ball clustering. Group participants by team_id, compute the
// per-team best score on each hole (gross, since the public board doesn't
// apply per-player handicap strokes), sum them, and return ranked teams
// with their member rosters. Players with no team_id are skipped here —
// they fall back to the per-player render so individual stragglers in a
// best-ball outing still show up. (2026-05-02)
function computeBestBallPub(participants, holePars, teams) {
  // Build a name+meta lookup for each declared team
  const teamMeta = new Map()
  for (const t of (teams || [])) {
    teamMeta.set(String(t.id), {
      id: String(t.id),
      name: t.name || `Team ${t.id}`,
      color: t.color || null,
    })
  }
  // Group participants by team_id; players without a team go into 'solo'
  const teamMap = new Map()
  for (const p of participants) {
    if (p.team_id == null) continue
    const key = String(p.team_id)
    if (!teamMap.has(key)) teamMap.set(key, [])
    teamMap.get(key).push(p)
  }
  const ranked = []
  for (const [teamId, members] of teamMap) {
    const meta = teamMeta.get(teamId) || { id: teamId, name: `Team ${teamId}`, color: null }
    let total = 0
    let parThrough = 0   // Sum of par for the EXACT holes the team scored,
                         //   not the first N holes by index. Fixes a
                         //   to-par bug when a team skips a hole. (Round 11
                         //   double-check pass — caught during 6.3 review.)
    let holesPlayed = 0
    for (let h = 0; h < holePars.length; h++) {
      const memberScores = members
        .map(m => (m.scores || [])[h] || 0)
        .filter(s => s > 0)
      if (memberScores.length === 0) continue
      total += Math.min(...memberScores)
      parThrough += (holePars[h] || 4)
      holesPlayed += 1
    }
    ranked.push({
      id: teamId,
      name: meta.name,
      color: meta.color,
      members,
      total,
      holesPlayed,
      stp: holesPlayed === 0 ? null : (total - parThrough),
    })
  }
  // Best (lowest) total wins — but a team that has played MORE holes
  // shouldn't be punished for having a bigger raw total than a team
  // with one hole done. Sort by stp (to-par) primarily; teams with no
  // holes played sort to the bottom.
  ranked.sort((a, b) => {
    if (a.stp == null && b.stp == null) return 0
    if (a.stp == null) return 1
    if (b.stp == null) return -1
    if (a.stp !== b.stp) return a.stp - b.stp
    return b.holesPlayed - a.holesPlayed
  })
  return ranked
}

export default function PublicLeaderboard({ code }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  // Reconnecting indicator — turns on when two or more consecutive
  // polls fail. Spectators with bad signal see "reconnecting" rather
  // than silently stale data. Round 4 audit fix.
  const [reconnecting, setReconnecting] = useState(false)

  // Polling fetch loop. Pauses when the tab is hidden — saves
  // battery + bandwidth for spectators who tabbed away or locked
  // their phone. Resumes (with one immediate refetch) on
  // visibilitychange. Round 6 audit.
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

    function startPolling() {
      if (interval) return
      load()
      interval = setInterval(load, 5000)
    }
    function stopPolling() {
      if (interval) { clearInterval(interval); interval = null }
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') stopPolling()
      else startPolling()
    }

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Don't start polling immediately if we already loaded once
      // and the tab is currently hidden.
      load()  // single load to populate initial state
    } else {
      startPolling()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      stopPolling()
      document.removeEventListener('visibilitychange', onVisibility)
    }
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
  // Format detection — skins / stableford have non-STP primary
  // sort keys, so the public leaderboard needs the same logic the
  // in-app scoreboard uses. Otherwise spectators see 'gross-to-par'
  // for a skins league, which is the wrong winner. (Round 7 audit.)
  const formats = data.scoring_formats || []
  const isSkins      = formats.includes('skins')
  const isStableford = formats.includes('stableford')
  // 6.3 — Best Ball clustering. When a best-ball outing has team data,
  // render team blocks with each member nested underneath instead of a
  // flat per-player list. The team total drives the leaderboard sort.
  const isBestBall   = formats.includes('best_ball')
  const teamsRaw     = data.state?.teams || []
  const skinsByPlayer = isSkins ? computeSkinsPub(participants, holePars) : {}
  const pointsByPlayer = isStableford
    ? computeStablefordPub(participants, holePars, data.state?.stableford_points)
    : {}
  // Compute team standings only when best-ball is the format AND
  // there are at least two teams declared. If no participants have
  // a team_id (best-ball outing where teams were never assigned),
  // computeBestBallPub returns []; fall back to the flat view in that
  // case so players still show up. (Round 15 edge-case audit.)
  const bestBallTeamsRaw = isBestBall && teamsRaw.length >= 2
    ? computeBestBallPub(participants, holePars, teamsRaw)
    : null
  const bestBallTeams = bestBallTeamsRaw && bestBallTeamsRaw.length > 0 ? bestBallTeamsRaw : null

  // 33-round audit fix: bring the USGA card-back tiebreak chain to
  // the public board so spectators see the same order the in-app
  // leaderboard shows. Chain: total stp → back-9 stp → last-6 → last-3
  // → 18th hole. Only kicks in for the stroke-play sort path; skins
  // and Stableford keep their existing primary sort and only fall
  // back to gross-to-par as a final tiebreaker.
  function rangeStp(p, lo, hi) {   // lo/hi inclusive, 0-indexed holes
    const sc = p.scores || []
    let s = 0
    for (let h = lo; h <= hi && h < holePars.length; h++) {
      const v = sc[h] || 0
      if (v > 0) s += v - (holePars[h] || 4)
    }
    return s
  }
  const lastHoleIdx = holePars.length - 1
  function cardBackChain(a, b) {
    const da = totalStp(a, holePars), db = totalStp(b, holePars)
    if (da == null && db == null) return 0
    if (da == null) return 1
    if (db == null) return -1
    if (da !== db) return da - db
    // Back-9 (only meaningful on 18+)
    if (holePars.length >= 18) {
      const ba = rangeStp(a, 9, 17), bb = rangeStp(b, 9, 17)
      if (ba !== bb) return ba - bb
    }
    // Last-6
    const lo6 = Math.max(0, lastHoleIdx - 5)
    const a6 = rangeStp(a, lo6, lastHoleIdx), b6 = rangeStp(b, lo6, lastHoleIdx)
    if (a6 !== b6) return a6 - b6
    // Last-3
    const lo3 = Math.max(0, lastHoleIdx - 2)
    const a3 = rangeStp(a, lo3, lastHoleIdx), b3 = rangeStp(b, lo3, lastHoleIdx)
    if (a3 !== b3) return a3 - b3
    // Last hole
    const al = rangeStp(a, lastHoleIdx, lastHoleIdx)
    const bl = rangeStp(b, lastHoleIdx, lastHoleIdx)
    return al - bl
  }
  const sorted = [...participants].sort((a, b) => {
    if (isSkins) {
      const sa = skinsByPlayer[a.user_id] || 0
      const sb = skinsByPlayer[b.user_id] || 0
      if (sa !== sb) return sb - sa
    }
    if (isStableford) {
      const pa = pointsByPlayer[a.user_id] || 0
      const pb = pointsByPlayer[b.user_id] || 0
      if (pa !== pb) return pb - pa
    }
    return cardBackChain(a, b)
  })

  // Headline metric for the TOT column. Format-driven.
  const totColLabel = isSkins ? 'SKINS' : isStableford ? 'PTS' : 'TOT'
  function totDisplayFor(p) {
    if (isSkins)      return `${skinsByPlayer[p.user_id] || 0}`
    if (isStableford) {
      const v = pointsByPlayer[p.user_id]
      return v == null || v === 0 ? '0' : (v > 0 ? `+${v}` : `${v}`)
    }
    const stp = totalStp(p, holePars)
    return stp == null ? '—' : (stp === 0 ? 'E' : stp > 0 ? `+${stp}` : `${stp}`)
  }
  function hasPlayedAny(p) {
    return (p.scores || []).some(s => s > 0)
  }

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
        }}>{data.status === 'cancelled'
              ? 'MATCH CANCELLED'
              : (data.status === 'ended' || data.status === 'closed')
                ? 'FINAL RESULTS'
                : 'LIVE LEADERBOARD'}</div>
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
        {/* 2026-05-02 audit — Part-of-League pill on the public board.
            GTM lever: spectators scanning the tee-box QR see this is
            part of a season and the footer CTA flips to 'Run your own
            league with Elite' instead of the generic 'Get the App'. */}
        {data.league && (
          <div style={{
            marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 999,
            background: 'rgba(201,160,64,0.18)',
            border: '1px solid rgba(201,160,64,0.55)',
            color: AUGUSTA_GOLD, fontSize: 10, fontWeight: 800, letterSpacing: '0.10em',
          }}>
            {/* Round 28 audit — bespoke trophy SVG. This is THE pill on
                the GTM-critical tee-box QR surface. Visual polish here
                is directly tied to conversion. */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={AUGUSTA_GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/>
              <path d="M8 6H6a2 2 0 0 0 2 2"/>
              <path d="M16 6h2a2 2 0 0 1-2 2"/>
              <line x1="12" y1="12" x2="12" y2="16"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
            </svg>
            <span style={{ textTransform: 'uppercase' }}>
              Part of {data.league.name}{data.league.season ? ` · ${data.league.season}` : ''}
            </span>
          </div>
        )}
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

      {/* Leaders banner — kept as the cream tournament-board strip
          but now serves as the ribbon over the spotlight card. */}
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

      {/* 1st-PLACE SPOTLIGHT
          GTM-critical surface: this is what spectators scanning the
          tee-box QR see first. Was just a row in the table; now a
          hero card with portrait, large headline, and big metric.
          Only renders when at least one player (or team) has a
          scored hole. (Visual polish #4.) */}
      {(bestBallTeams ? (bestBallTeams[0]?.holesPlayed > 0) : sorted.some(hasPlayedAny)) && (
        <LeaderSpotlight
          team={bestBallTeams ? bestBallTeams[0] : null}
          player={!bestBallTeams ? sorted[0] : null}
          totColLabel={totColLabel}
          totDisplay={!bestBallTeams ? totDisplayFor(sorted[0]) : null}
          holes={data.state?.holes ?? 18}
          holePars={holePars}
        />
      )}

      {/* Player rows — flat for stroke / skins / stableford, team-clustered
          for Best Ball when there are 2+ teams declared (6.3). */}
      <div style={{ padding: '6px 14px 0' }}>
        {bestBallTeams ? (
          /* TEAM-CLUSTERED VIEW (Best Ball, 2+ teams) ─────────────────── */
          <>
            {/* Team column header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '40px 1fr 60px 60px',
              gap: 8, alignItems: 'center',
              padding: '8px 6px', borderBottom: `1px solid rgba(201,160,64,0.40)`,
            }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em', textAlign: 'center' }}>POS</div>
              <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em' }}>TEAM</div>
              <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em', textAlign: 'center' }}>TOT</div>
              <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em', textAlign: 'center' }}>THRU</div>
            </div>

            {bestBallTeams.length === 0 && (
              <div style={{
                padding: '40px 20px', textAlign: 'center',
                color: 'rgba(241,231,200,0.55)', fontStyle: 'italic',
              }}>Waiting for the first scores…</div>
            )}

            {bestBallTeams.map((team, idx) => {
              const played = team.holesPlayed > 0
              const stp = team.stp
              const stpStr = !played
                ? '—'
                : stp === 0 ? 'E' : stp > 0 ? `+${stp}` : `${stp}`
              const totColor = !played
                ? 'rgba(241,231,200,0.40)'
                : idx === 0
                  ? AUGUSTA_GOLD
                  : stp < 0 ? '#E55858'
                    : stp === 0 ? AUGUSTA_CREAM
                    : 'rgba(241,231,200,0.85)'
              const teamAccent = team.color || (idx === 0 ? AUGUSTA_GOLD : 'rgba(201,160,64,0.30)')
              return (
                <div key={team.id} style={{
                  borderBottom: '1px solid rgba(241,231,200,0.10)',
                  background: idx === 0 && played ? 'rgba(201,160,64,0.12)' : 'transparent',
                  paddingBottom: 8,
                }}>
                  {/* Team header row — POS · NAME · TOT · THRU */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '40px 1fr 60px 60px',
                    gap: 8, alignItems: 'center',
                    padding: '12px 6px 8px',
                    borderLeft: `4px solid ${teamAccent}`,
                  }}>
                    <div style={{
                      fontSize: 14, fontWeight: 900, textAlign: 'center',
                      color: idx === 0 && played ? AUGUSTA_GOLD : AUGUSTA_CREAM,
                    }}>{played ? idx + 1 : '—'}</div>
                    <div style={{ minWidth: 0, overflow: 'hidden' }}>
                      <div style={{
                        fontSize: 14, fontWeight: 900, color: AUGUSTA_CREAM,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        letterSpacing: '0.04em', textTransform: 'uppercase',
                      }}>{team.name}</div>
                      <div style={{ fontSize: 10, color: 'rgba(201,160,64,0.65)', marginTop: 2 }}>
                        {team.members.length} player{team.members.length === 1 ? '' : 's'} · best ball
                      </div>
                    </div>
                    <div style={{
                      textAlign: 'center', fontSize: 16, fontWeight: 900,
                      color: totColor,
                    }}>{stpStr}</div>
                    <div style={{
                      textAlign: 'center', fontSize: 13,
                      color: 'rgba(241,231,200,0.65)', fontWeight: 700,
                    }}>{played ? (team.holesPlayed >= (data.state?.holes ?? 18) ? 'F' : team.holesPlayed) : '—'}</div>
                  </div>
                  {/* Member rows — gross score per player nested under the
                      team. Subtler styling so the team total is the
                      primary read. */}
                  {team.members.map(m => {
                    const mPlayed = (m.scores || []).some(s => s > 0)
                    const mStp    = totalStp(m, holePars)
                    const mDisp   = mStp == null ? '—' : (mStp === 0 ? 'E' : mStp > 0 ? `+${mStp}` : `${mStp}`)
                    return (
                      <div key={m.user_id} style={{
                        display: 'grid', gridTemplateColumns: '40px 1fr 60px 60px',
                        gap: 8, alignItems: 'center',
                        padding: '6px 6px 6px 14px',
                        marginLeft: 4,
                        borderLeft: `2px solid rgba(201,160,64,0.20)`,
                      }}>
                        <div />
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                          <div style={{
                            fontSize: 12, fontWeight: 700,
                            color: 'rgba(241,231,200,0.85)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>{m.name}</div>
                          {m.handle && (
                            <div style={{ fontSize: 9, color: 'rgba(201,160,64,0.50)' }}>@{m.handle}</div>
                          )}
                        </div>
                        <div style={{
                          textAlign: 'center', fontSize: 12, fontWeight: 700,
                          color: !mPlayed
                            ? 'rgba(241,231,200,0.30)'
                            : mStp == null ? 'rgba(241,231,200,0.30)'
                              : mStp < 0 ? '#E55858'
                              : mStp === 0 ? 'rgba(241,231,200,0.85)'
                              : 'rgba(241,231,200,0.55)',
                        }}>{mDisp}</div>
                        <div style={{
                          textAlign: 'center', fontSize: 11,
                          color: 'rgba(241,231,200,0.40)', fontWeight: 600,
                        }}>{thruLabel(m, data.state?.holes ?? 18)}</div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </>
        ) : (
          /* FLAT PLAYER VIEW (everything else) ──────────────────────────── */
          <>
            {/* Column headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '40px 1fr 60px 60px',
              gap: 8, alignItems: 'center',
              padding: '8px 6px', borderBottom: `1px solid rgba(201,160,64,0.40)`,
            }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em', textAlign: 'center' }}>POS</div>
              <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em' }}>PLAYER</div>
              <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em', textAlign: 'center' }}>{totColLabel}</div>
              <div style={{ fontSize: 9, fontWeight: 800, color: AUGUSTA_GOLD, letterSpacing: '0.08em', textAlign: 'center' }}>THRU</div>
            </div>

            {sorted.length === 0 && (
              <div style={{
                padding: '40px 20px', textAlign: 'center',
                color: 'rgba(241,231,200,0.55)', fontStyle: 'italic',
              }}>Waiting for the first scores…</div>
            )}

            {sorted.map((p, idx) => {
          const played = hasPlayedAny(p)
          const stp = totalStp(p, holePars)
          // Color rules: under-par red, even cream, over dim. For
          // skins/stableford, brighten the leader.
          const totColor = !played
            ? 'rgba(241,231,200,0.40)'
            : isSkins || isStableford
              ? (idx === 0 ? AUGUSTA_GOLD : AUGUSTA_CREAM)
              : stp == null ? 'rgba(241,231,200,0.40)'
                : stp < 0 ? '#E55858'
                : stp === 0 ? AUGUSTA_CREAM
                : 'rgba(241,231,200,0.85)'
          return (
            <div key={p.user_id} style={{
              display: 'grid', gridTemplateColumns: '40px 1fr 60px 60px',
              gap: 8, alignItems: 'center',
              padding: '12px 6px',
              borderBottom: '1px solid rgba(241,231,200,0.10)',
              background: idx === 0 && played ? 'rgba(201,160,64,0.14)' : 'transparent',
            }}>
              <div style={{
                fontSize: 14, fontWeight: 900, textAlign: 'center',
                color: idx === 0 && played ? AUGUSTA_GOLD : AUGUSTA_CREAM,
              }}>{played ? idx + 1 : '—'}</div>
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
                color: totColor,
              }}>{totDisplayFor(p)}</div>
              <div style={{
                textAlign: 'center', fontSize: 13,
                color: 'rgba(241,231,200,0.65)', fontWeight: 700,
              }}>{thruLabel(p, data.state?.holes ?? 18)}</div>
            </div>
          )
        })}
          </>
        )}
      </div>

      {/* Footer brand + install CTA. When the event is league-attached
          the CTA flips to a tailored 'Run your own league' upsell
          (Elite tier) — that's the whole point of the tee-box QR
          flyer as an acquisition channel: convert spectators into
          paying commissioners. (2026-05-02 audit — GTM lever.) */}
      <div style={{ marginTop: 32, padding: '20px', textAlign: 'center' }}>
        <div style={{
          display: 'inline-block',
          background: 'rgba(201,160,64,0.10)', border: `1px solid ${AUGUSTA_GOLD}`,
          borderRadius: 14, padding: '14px 22px',
          maxWidth: 320,
        }}>
          <div style={{ fontSize: 10, color: AUGUSTA_GOLD, letterSpacing: '0.20em', fontWeight: 700, marginBottom: 6 }}>
            POWERED BY
          </div>
          <div style={{
            fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold-bright), var(--tm-gold))',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: 8,
          }}>The Match</div>
          {data.league ? (
            <>
              <div style={{ fontSize: 11, color: 'rgba(241,231,200,0.85)', lineHeight: 1.5, marginBottom: 10 }}>
                Run your own league — standings, rosters, push notifications, season exports — for half what other apps charge.
              </div>
              <a href="/" style={{
                display: 'inline-block', padding: '9px 20px',
                background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold))',
                color: '#070C09', textDecoration: 'none',
                borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '0.04em',
              }}>START A LEAGUE →</a>
              <div style={{ fontSize: 9, color: 'rgba(241,231,200,0.55)', marginTop: 8, letterSpacing: '0.10em' }}>
                THE MATCH ELITE · $7.50/MO ANNUAL
              </div>
            </>
          ) : (
            <a href="/" style={{
              display: 'inline-block', padding: '8px 20px',
              background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold))',
              color: '#070C09', textDecoration: 'none',
              borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: '0.04em',
            }}>GET THE APP →</a>
          )}
        </div>
        <div style={{ marginTop: 16, fontSize: 9, color: 'rgba(241,231,200,0.40)', letterSpacing: '0.10em' }}>
          MATCH CODE · {data.code} · UPDATES LIVE
        </div>
      </div>
    </div>
  )
}

// ─── LeaderSpotlight ─────────────────────────────────────────────────
// Hero card for the leader (player or team). Sits directly under the
// LEADERS banner on the public board. The board is the GTM lever:
// every spectator scanning the tee-box QR sees this surface first, so
// the leader gets broadcast-style treatment instead of just being row 1.
function LeaderSpotlight({ team, player, totColLabel, totDisplay, holes, holePars }) {
  if (!team && !player) return null

  // Compute leader's portrait initials + meta. For a team, we show the
  // team name and member count + best-ball stp. For a player, we show
  // name + handle + their format-specific headline metric.
  const isTeam = !!team
  const display = (() => {
    if (isTeam) {
      const stp = team.stp
      return {
        name: team.name,
        sub:  `${team.members.length} player${team.members.length === 1 ? '' : 's'} · best ball`,
        big:  stp == null ? '—' : stp === 0 ? 'E' : stp > 0 ? `+${stp}` : `${stp}`,
        bigLabel: 'TO PAR',
        thru: team.holesPlayed >= holes ? 'F' : `${team.holesPlayed}`,
        portrait: team.name?.slice(0, 1).toUpperCase() || 'T',
      }
    }
    const played = (player.scores || []).filter(s => s > 0).length
    return {
      name: player.name,
      sub:  player.handle ? `@${player.handle}` : null,
      big:  totDisplay,
      bigLabel: totColLabel,
      thru: played >= holes ? 'F' : `${played}`,
      portrait: (player.name || '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase(),
    }
  })()

  return (
    <div style={{
      margin: '14px 16px 8px',
      borderRadius: 18, overflow: 'hidden',
      background: 'linear-gradient(135deg, #1A4A24 0%, #0E3B23 50%, #062014 100%)',
      border: '2px solid var(--tm-gold)',
      boxShadow: '0 8px 28px rgba(0,0,0,0.40), inset 0 1px 0 rgba(245,215,138,0.22)',
      position: 'relative',
    }}>
      {/* Subtle radial gold shine pinned top-left */}
      <div aria-hidden style={{
        position: 'absolute', top: -40, left: -40, width: 220, height: 220,
        background: 'radial-gradient(circle, rgba(232,192,90,0.22) 0%, transparent 65%)',
        pointerEvents: 'none',
      }} />
      {/* Top stripe with LEADER overline */}
      <div style={{
        padding: '6px 14px',
        background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.45), transparent)',
        borderBottom: '1px solid rgba(201,160,64,0.55)',
        textAlign: 'center', position: 'relative',
      }}>
        <div style={{
          fontSize: 9, fontWeight: 900, letterSpacing: '0.40em',
          color: '#F5D78A', textTransform: 'uppercase',
          fontFamily: '"Arial Black", Arial, sans-serif',
        }}>{isTeam ? 'TEAM IN FRONT' : 'IN FRONT'}</div>
      </div>
      {/* Body */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px 16px',
        position: 'relative',
      }}>
        {/* Portrait — large gold-ringed initials medallion. If we ever
            wire avatars, swap the inner contents to an <img>. */}
        <div style={{
          width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--tm-green-bright), #1A4A24)',
          border: '2px solid var(--tm-gold)',
          boxShadow: '0 0 0 4px rgba(201,160,64,0.18), 0 4px 12px rgba(0,0,0,0.40)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#F1E7C8', fontWeight: 900, fontSize: 22,
          fontFamily: '"Arial Black", Arial, sans-serif', letterSpacing: '0.04em',
        }}>{display.portrait}</div>
        {/* Identity */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 18, fontWeight: 900, color: '#F1E7C8',
            fontFamily: '"Georgia", serif', letterSpacing: '-0.01em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textShadow: '0 1px 2px rgba(0,0,0,0.40)',
          }}>{display.name}</div>
          {display.sub && (
            <div style={{
              fontSize: 11, color: 'rgba(201,160,64,0.85)', marginTop: 2,
              fontWeight: 700, letterSpacing: '0.04em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{display.sub}</div>
          )}
          <div style={{
            fontSize: 10, color: 'rgba(241,231,200,0.55)', marginTop: 4,
            letterSpacing: '0.10em', fontWeight: 700,
          }}>THRU {display.thru}</div>
        </div>
        {/* Big metric tile */}
        <div style={{
          flexShrink: 0, textAlign: 'center',
          padding: '8px 14px', borderRadius: 12,
          background: 'rgba(201,160,64,0.14)',
          border: '1px solid rgba(201,160,64,0.45)',
          minWidth: 76,
        }}>
          <div style={{
            fontSize: 8, color: '#F5D78A', letterSpacing: '0.18em',
            fontWeight: 800, marginBottom: 2,
            fontFamily: '"Arial Black", Arial, sans-serif',
          }}>{display.bigLabel}</div>
          <div style={{
            fontSize: 28, fontWeight: 900, color: '#F1E7C8', lineHeight: 1,
            fontFamily: '"Georgia", serif', letterSpacing: '-0.02em',
            textShadow: '0 1px 2px rgba(0,0,0,0.45)',
          }}>{display.big}</div>
        </div>
      </div>
    </div>
  )
}
