import { useState, useEffect, useCallback, useRef } from 'react'
import { scoreColor } from '../lib/scoreColors.js'

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard'
// Tour leaderboard refresh cadence. Bumped 30s -> 5min on 2026-05-01 because
// App.jsx lazy-keep-alive keeps the Tour tab mounted in the background once
// visited; 30s polls running while the user is on Match/Eye/etc. is wasted
// work. 5 minutes is plenty of resolution for a leaderboard you only
// glance at, and the manual refresh button covers the "I want it now" case.
const REFRESH_MS = 300_000

function parseScore(str) {
  if (!str || str === 'E') return 0
  const n = parseInt(str, 10)
  return isNaN(n) ? null : n
}

// "STARTS THU MAY 1" — used when a tournament hasn't begun yet (round = 0).
// Falls back to "SOON" if the ESPN date string is malformed.
function formatStartDate(iso) {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return 'SOON'
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    }).toUpperCase()
  } catch { return 'SOON' }
}

function ScoreBadge({ value, label, small }) {
  const color = scoreColor(value)
  const display = value == null ? '—' : value === 0 ? 'E' : value > 0 ? `+${value}` : String(value)
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: small ? 14 : 18, fontWeight: 800, color, lineHeight: 1,
        letterSpacing: '-0.02em',
      }}>{display}</div>
      {label && <div style={{ fontSize: 9, color: 'rgba(27,94,59,0.40)', letterSpacing: '0.08em', marginTop: 2 }}>{label}</div>}
    </div>
  )
}

function LiveDot() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: '#C9A040',
        boxShadow: '0 0 6px rgba(201,160,64,0.8)',
        animation: 'pulse-dot 1.4s ease-in-out infinite',
        display: 'inline-block',
      }} />
      <span style={{ color: '#C9A040', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>LIVE</span>
    </span>
  )
}

function PlayerPhoto({ id, name, flagUrl, size = 38 }) {
  const [imgFailed, setImgFailed] = useState(false)
  const initials = name
    ? name.split(' ').map(w => w[0]).filter(Boolean).slice(-2).join('').toUpperCase()
    : '?'
  const headshot = `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png`

  return (
    <div style={{
      width: size, height: size, borderRadius: 10, overflow: 'hidden',
      position: 'relative', flexShrink: 0,
      background: 'rgba(27,94,59,0.08)',
      border: '1px solid rgba(27,94,59,0.12)',
    }}>
      {/* Country flag as faded background */}
      {flagUrl && (
        <img
          src={flagUrl}
          alt=""
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center',
            opacity: 0.18,
          }}
        />
      )}
      {/* Headshot */}
      {!imgFailed ? (
        <img
          src={headshot}
          alt={name}
          onError={() => setImgFailed(true)}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'top center',
          }}
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.32, fontWeight: 800, color: '#1B5E3B',
        }}>{initials}</div>
      )}
    </div>
  )
}

export default function PGAScores({ user }) {
  const [events, setEvents]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [activeEvent, setActiveEvent] = useState(0)
  const [cutLine, setCutLine]   = useState(null)
  const timerRef = useRef(null)

  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch(ESPN_URL)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      const raw = (data.events || []).map(ev => {
        const comp = ev.competitions?.[0]
        const status = ev.status?.type?.description ?? ''
        const inProgress = status === 'In Progress'
        const isComplete = status === 'Final' || status === 'Official'
        const round = comp?.status?.period ?? 1

        // Extract cut line if present
        const cutVal = comp?.situation?.cutLine ?? null

        // 2026-05-01 — ESPN moved the per-player live data. The
        // /scoreboard endpoint stopped populating `competitor.status`
        // (no more position/displayValue/thru there). Live data now
        // lives at:
        //   • competitor.score         → total to par (e.g. "-13")
        //   • competitor.linescores[round-1].displayValue → round to par
        //   • competitor.linescores[round-1].linescores   → per-hole rows;
        //                                                    .length = thru
        //   • competitor.order         → leaderboard rank (sequential,
        //                                so we compute T-ties locally)
        // Cut/WD/DQ markers no longer appear in this payload — fall
        // back to including everyone returned by ESPN.
        const rawCompetitors = comp?.competitors ?? []
        const mapped = rawCompetitors.map(p => {
          const tot   = parseScore(p.score)
          const round0 = (p.linescores ?? [])[round - 1] ?? {}
          const today = parseScore(round0.displayValue)
          const holesPlayed = Array.isArray(round0.linescores) ? round0.linescores.length : 0
          return {
            id:       p.id,
            name:     p.athlete?.displayName ?? '—',
            short:    p.athlete?.shortName ?? p.athlete?.displayName ?? '—',
            country:  p.athlete?.flag?.href ?? null,
            countryName: p.athlete?.flag?.alt ?? '',
            order:    p.order ?? 999,
            total:    tot,
            today:    today,
            thru:     holesPlayed >= 18 ? 'F' : holesPlayed > 0 ? String(holesPlayed) : '—',
            // pos / isTied filled in below after we know the full sort
            pos:      '—',
            isTied:   false,
            status:   '',
          }
        })

        // Sort by total to par (lower = better; nulls sink to the
        // bottom) and assign positions with ties — players sharing
        // the same total all get a "T2" / "T15" prefix.
        mapped.sort((a, b) => (a.total ?? 99) - (b.total ?? 99))
        let curRank = 0, prevTotal = null, tiedRunStart = 0
        for (let i = 0; i < mapped.length; i++) {
          const m = mapped[i]
          if (m.total !== prevTotal) {
            curRank = i + 1
            tiedRunStart = i
            prevTotal = m.total
          }
        }
        // Re-walk to mark ties (group by total)
        const totalsCount = {}
        for (const m of mapped) {
          if (m.total != null) totalsCount[m.total] = (totalsCount[m.total] || 0) + 1
        }
        let rank = 0, last = Symbol()
        for (let i = 0; i < mapped.length; i++) {
          const m = mapped[i]
          if (m.total !== last) { rank = i + 1; last = m.total }
          const tied = m.total != null && totalsCount[m.total] > 1
          m.pos = m.total == null ? '—' : (tied ? 'T' : '') + rank
          m.isTied = tied
        }
        const players = mapped

        // Cut markers aren't currently exposed by ESPN's response;
        // leave the cut list empty so the UI still renders cleanly.
        const cutPlayers = []

        return {
          id:          ev.id,
          name:        ev.name,
          shortName:   ev.shortName ?? ev.name,
          course:      comp?.venue?.fullName ?? null,
          city:        comp?.venue?.address?.city ?? null,
          state:       comp?.venue?.address?.state ?? null,
          purse:       ev.displayPurse ?? null,
          round,
          totalRounds: comp?.status?.period ?? 4,
          startDate:   ev.date ?? comp?.date ?? null,  // for "STARTS THU MAY 1" pre-tournament label
          inProgress,
          isComplete,
          status,
          players,
          cutPlayers,
          cutVal,
        }
      })

      setEvents(raw)
      setLastUpdate(new Date())
      setError(null)
    } catch (e) {
      setError('Could not load scores. Tap to retry.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchScores()
    timerRef.current = setInterval(fetchScores, REFRESH_MS)
    return () => clearInterval(timerRef.current)
  }, [fetchScores])

  const ev = events[activeEvent]

  return (
    <div style={{ minHeight: '100dvh', background: 'transparent', paddingBottom: 90 }}>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'rgba(255,255,255,0.22)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.35)',
        padding: '52px 20px 16px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em',
              background: 'linear-gradient(135deg, #A07828, #C9A040, #E8C05A)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>PGA Tour</div>
            {ev?.inProgress && <LiveDot />}
          </div>
          <button
            onClick={fetchScores}
            style={{
              background: 'rgba(27,94,59,0.08)', border: '1px solid rgba(27,94,59,0.16)',
              borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
              color: '#1B5E3B', fontSize: 11, fontWeight: 600,
            }}
          >
            {lastUpdate ? `↻ ${lastUpdate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>

        {loading && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <div style={{ color: 'rgba(27,94,59,0.50)', fontSize: 13 }}>Loading scores…</div>
          </div>
        )}

        {error && (
          <div style={{
            margin: '20px 0',
            background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(220,38,38,0.25)',
            borderRadius: 14, padding: '20px', textAlign: 'center',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          }}>
            <div style={{ color: '#DC2626', fontSize: 13, marginBottom: 8 }}>{error}</div>
            <button onClick={fetchScores} style={{
              background: '#1B5E3B', color: '#fff', border: 'none',
              borderRadius: 10, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>Retry</button>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div style={{
            margin: '20px 0',
            background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.45)',
            borderRadius: 14, padding: '32px 20px', textAlign: 'center',
            backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>⛳</div>
            <div style={{ color: '#1B5E3B', fontSize: 14, fontWeight: 700 }}>No active tournament</div>
            <div style={{ color: 'rgba(27,94,59,0.50)', fontSize: 12, marginTop: 4 }}>Check back during a PGA Tour event</div>
          </div>
        )}

        {!loading && ev && (
          <>
            {/* Event selector (if multiple events) */}
            {events.length > 1 && (
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginTop: 12 }}>
                {events.map((e, i) => (
                  <button key={e.id} onClick={() => setActiveEvent(i)} style={{
                    flexShrink: 0,
                    background: i === activeEvent ? '#1B5E3B' : 'rgba(255,255,255,0.22)',
                    border: '1px solid ' + (i === activeEvent ? '#1B5E3B' : 'rgba(255,255,255,0.45)'),
                    borderRadius: 20, padding: '5px 14px',
                    color: i === activeEvent ? '#fff' : '#1B5E3B',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                  }}>{e.shortName}</button>
                ))}
              </div>
            )}

            {/* Tournament card */}
            <div style={{
              marginTop: 12,
              background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.45)',
              borderRadius: 16, padding: '16px',
              backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
              marginBottom: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 16, fontWeight: 800, color: '#0D1F12',
                    letterSpacing: '-0.01em', lineHeight: 1.2, marginBottom: 4,
                  }}>{ev.name}</div>
                  {ev.course && (
                    <div style={{ color: 'rgba(27,94,59,0.60)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {ev.course}{ev.city ? ` · ${ev.city}${ev.state ? `, ${ev.state}` : ''}` : ''}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                    color: ev.inProgress ? '#C9A040' : ev.isComplete ? 'rgba(27,94,59,0.60)' : 'rgba(27,94,59,0.60)',
                    background: ev.inProgress ? 'rgba(201,160,64,0.12)' : 'rgba(27,94,59,0.07)',
                    borderRadius: 6, padding: '3px 9px', display: 'inline-block',
                  }}>
                    {ev.isComplete
                      ? 'FINAL'
                      : ev.inProgress
                        ? `RD ${ev.round} · LIVE`
                        : ev.round > 0
                          ? `RD ${ev.round}`
                          : ev.startDate
                            ? `STARTS ${formatStartDate(ev.startDate)}`
                            : 'PRE-TOURNAMENT'}
                  </div>
                  {ev.purse && (
                    <div style={{ color: 'rgba(27,94,59,0.45)', fontSize: 10, marginTop: 4 }}>{ev.purse}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Translucent glass card wrapping the entire leaderboard table.
                Matches the rest of the Tour page's glass-morphism pattern
                (0.22 white + backdrop blur). Individual rows below are
                transparent — the container handles the bg + border, rows
                just stack with subtle dividers. (User request 2026-04-29.) */}
            <div style={{
              background: 'rgba(255,255,255,0.22)',
              backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.45)',
              borderRadius: 16,
              padding: '12px 12px 4px',
              marginBottom: 8,
              boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
            }}>

            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '28px 44px 1fr 42px 42px 36px',
              gap: 4, padding: '0 4px 6px',
              borderBottom: '1px solid rgba(27,94,59,0.18)',
              marginBottom: 6,
            }}>
              <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>POS</div>
              <div />
              <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em' }}>PLAYER</div>
              <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>TOT</div>
              <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>TODAY</div>
              <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>THRU</div>
            </div>

            {/* Leaderboard */}
            {ev.players.map((p, idx) => (
              <div key={p.id} style={{
                display: 'grid',
                gridTemplateColumns: '28px 44px 1fr 42px 42px 36px',
                gap: 4, alignItems: 'center',
                padding: '7px 4px',
                borderBottom: '1px solid rgba(27,94,59,0.10)',
                /* Rows are transparent — the wrapping translucent card
                   above provides the readable backdrop. Gold-tint the
                   leader so they pop within the table. */
                background: idx === 0 ? 'rgba(201,160,64,0.20)' : 'transparent',
                borderRadius: idx === 0 ? 8 : 0,
              }}>
                {/* Position */}
                <div style={{
                  textAlign: 'center',
                  fontSize: p.pos.length > 3 ? 9 : 11,
                  fontWeight: 700,
                  color: idx < 3 ? '#C9A040' : 'rgba(27,94,59,0.50)',
                }}>
                  {p.pos}
                </div>

                {/* Headshot + flag */}
                <PlayerPhoto id={p.id} name={p.name} flagUrl={p.country} size={38} />

                {/* Name + country */}
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: idx < 5 ? 700 : 500,
                    color: '#0D1F12',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{p.name}</div>
                  {p.countryName && (
                    <div style={{
                      fontSize: 9, color: 'rgba(27,94,59,0.45)', fontWeight: 500,
                      letterSpacing: '0.02em', marginTop: 1,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{p.countryName}</div>
                  )}
                </div>

                {/* Total */}
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontSize: 13, fontWeight: 800,
                    color: scoreColor(p.total),
                  }}>
                    {p.total == null ? '—' : p.total === 0 ? 'E' : p.total > 0 ? `+${p.total}` : p.total}
                  </span>
                </div>

                {/* Today */}
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: scoreColor(p.today),
                  }}>
                    {p.today == null ? '—' : p.today === 0 ? 'E' : p.today > 0 ? `+${p.today}` : p.today}
                  </span>
                </div>

                {/* Thru */}
                <div style={{
                  textAlign: 'center', fontSize: 11,
                  color: p.thru === 'F' ? 'rgba(27,94,59,0.55)' : 'rgba(27,94,59,0.45)',
                  fontWeight: p.thru === 'F' ? 700 : 400,
                }}>
                  {p.thru}
                </div>
              </div>
            ))}

            {/* Cut line */}
            {ev.cutPlayers.length > 0 && (
              <>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px',
                }}>
                  <div style={{ flex: 1, height: 1, background: 'rgba(220,38,38,0.25)' }} />
                  <span style={{ color: '#DC2626', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>CUT</span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(220,38,38,0.25)' }} />
                </div>
                {ev.cutPlayers.slice(0, 5).map(p => (
                  <div key={p.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '28px 44px 1fr 42px 42px 36px',
                    gap: 4, alignItems: 'center',
                    padding: '7px 4px',
                    borderBottom: '1px solid rgba(27,94,59,0.04)',
                    opacity: 0.6,
                  }}>
                    <div style={{ textAlign: 'center', fontSize: 10, color: '#DC2626', fontWeight: 700 }}>CUT</div>
                    <PlayerPhoto id={p.id} name={p.name} flagUrl={p.country} size={38} />
                    <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.55)', fontWeight: 500 }}>{p.name}</div>
                    <div style={{ textAlign: 'center', fontSize: 12, color: scoreColor(p.total), fontWeight: 700 }}>
                      {p.total == null ? '—' : p.total === 0 ? 'E' : p.total > 0 ? `+${p.total}` : p.total}
                    </div>
                    <div />
                    <div />
                  </div>
                ))}
              </>
            )}

            {/* Footer */}
            <div style={{ padding: '12px 4px 4px', color: 'rgba(27,94,59,0.50)', fontSize: 10, textAlign: 'center' }}>
              Updates every 30s · Data via ESPN
            </div>

            </div>{/* end translucent leaderboard card */}
          </>
        )}
      </div>
    </div>
  )
}
