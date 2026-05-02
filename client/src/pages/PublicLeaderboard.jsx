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
    const da = totalStp(a, holePars), db = totalStp(b, holePars)
    if (da == null && db == null) return 0
    if (da == null) return 1
    if (db == null) return -1
    return da - db
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
