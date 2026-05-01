import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { IconBarChart } from '../components/primitives/Icons.jsx'

function scoreColor(diff) {
  if (diff < 0)  return '#5ED47A'
  if (diff === 0) return '#8AB4F8'
  if (diff <= 2)  return '#E8A85A'
  return '#E07A5A'
}

// ── Cinematic handicap hero card ──────────────────────────────────────────
// Inline gold-on-dark mini line chart of score-to-par across up to the
// 10 most recent rounds. Lives inside HcpBadge between the big number
// row and the rounds/status footer. Dot colors mirror the score-color
// helper used elsewhere: under-par gold, even cream, over-par warm
// orange. Renders nothing for fewer than 2 rounds. (2026-05-01)
function HandicapTrendLine({ rounds }) {
  const recent = (rounds || []).slice(0, 10)
  if (recent.length < 2) return null

  // Plot oldest → newest left-to-right
  const sequence = recent.slice().reverse()
  const diffs = sequence.map(r => {
    const sc  = Number(r.score ?? r.total ?? 0)
    const par = Number(r.course_par ?? 72)
    return Number.isFinite(sc) && Number.isFinite(par) ? sc - par : 0
  })

  const W = 280
  const H = 56
  const pad = 8
  const max = Math.max(...diffs, 0)
  const min = Math.min(...diffs, 0)
  const range = (max - min) || 1
  const pts = diffs.map((d, i) => ({
    x: pad + (i / Math.max(1, diffs.length - 1)) * (W - pad * 2),
    y: pad + (1 - (d - min) / range) * (H - pad * 2),
    d,
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  // Position of the par (zero) line, only shown when the data crosses zero
  const showParLine = min < 0 && max > 0
  const parY = showParLine ? pad + (1 - (0 - min) / range) * (H - pad * 2) : null

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="hcpTrendStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#C9A040" />
          <stop offset="100%" stopColor="#F5E070" />
        </linearGradient>
        <linearGradient id="hcpTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(232,192,90,0.22)" />
          <stop offset="100%" stopColor="rgba(232,192,90,0)" />
        </linearGradient>
      </defs>

      {/* Soft area fill under the line for visual weight */}
      <path
        d={`${path} L${pts[pts.length - 1].x.toFixed(1)},${H - pad} L${pts[0].x.toFixed(1)},${H - pad} Z`}
        fill="url(#hcpTrendFill)"
      />

      {/* Par reference line — only when the trend crosses zero */}
      {parY != null && (
        <line x1={pad} y1={parY} x2={W - pad} y2={parY}
          stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="2,3" />
      )}

      {/* Trend line itself */}
      <path d={path} fill="none" stroke="url(#hcpTrendStroke)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />

      {/* Per-round dots, colored by score-to-par direction */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5"
          fill={p.d < 0 ? '#F5E070' : p.d === 0 ? '#E8C05A' : '#E8A85A'}
          stroke="rgba(7,18,9,0.95)" strokeWidth="1.5" />
      ))}
    </svg>
  )
}

export function HcpBadge({ hcp, roundCount, rounds }) {
  // Coerce — handicap can arrive as a string from Postgres NUMERIC
  // columns via the pg driver. Number() turns "17.0" into 17.0 and
  // null/undefined into NaN; Number.isFinite skips both. Guards against
  // the "o.toFixed is not a function" crash when a seeded handicap is
  // displayed before any rounds are logged. (2026-05-01)
  const hcpNum = hcp == null ? null : Number(hcp)
  const valid  = hcpNum != null && Number.isFinite(hcpNum)
  const display = !valid
    ? '—'
    : hcpNum >= 0
      ? hcpNum.toFixed(1)
      : `+${Math.abs(hcpNum).toFixed(1)}`
  const trendCount = Math.min((rounds || []).length, 10)

  return (
    <div style={{ margin: '0 0 16px', position: 'relative' }}>
      <div style={{
        borderRadius: 24, overflow: 'hidden', position: 'relative',
        background: 'linear-gradient(140deg, #0A1F10 0%, #0D2615 35%, #071209 100%)',
        border: '1px solid rgba(232,192,90,0.2)',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(27,94,59,0.07)',
        padding: '24px 22px 22px',
      }}>
        {/* Radial glow */}
        <div style={{
          position: 'absolute', left: -40, top: -40,
          width: 220, height: 220, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(232,192,90,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        {/* Grid texture */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 24, opacity: 0.03,
          backgroundImage: 'repeating-linear-gradient(0deg, #fff 0px, #fff 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, #fff 0px, #fff 1px, transparent 1px, transparent 24px)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative' }}>
          <div style={{
            fontSize: 11, color: 'rgba(232,192,90,0.7)',
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em',
            marginBottom: 8,
          }}>
            Handicap Index
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 16 }}>
            <div style={{
              fontSize: 76, fontWeight: 900, lineHeight: 0.9, letterSpacing: '-3px',
              background: 'linear-gradient(180deg, #F5E070 0%, #E8C05A 50%, #C9A040 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 12px rgba(232,192,90,0.25))',
            }}>
              {display}
            </div>
            <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.45)', lineHeight: 1.4 }}>
                USGA method
              </div>
              <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.45)', lineHeight: 1.4 }}>
                Best 8 of last 20
              </div>
            </div>
          </div>

          {/* Embedded score-trend line chart — last 10 rounds, score-to-par.
              Only renders when 2+ rounds exist; quietly disappears below
              that threshold. (2026-05-01 — Matt request) */}
          {trendCount >= 2 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 6,
              }}>
                <span style={{
                  fontSize: 9, color: 'rgba(232,192,90,0.65)',
                  fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
                }}>Score Trend</span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', fontWeight: 500 }}>
                  Last {trendCount} round{trendCount === 1 ? '' : 's'}
                </span>
              </div>
              <HandicapTrendLine rounds={rounds} />
              <div style={{
                display: 'flex', justifyContent: 'space-between', marginTop: 4,
                fontSize: 9, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.06em',
              }}>
                <span>Older</span>
                <span>Newer</span>
              </div>
            </div>
          )}

          <div style={{
            display: 'flex', gap: 8,
            background: 'rgba(255,255,255,0.85)',
            border: '1px solid rgba(27,94,59,0.10)',
            borderRadius: 10, padding: '10px 14px',
          }}>
            <div style={{ flex: 1, textAlign: 'center', borderRight: '1px solid rgba(27,94,59,0.10)' }}>
              <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.38)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Rounds</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#0D1F12' }}>{roundCount ?? '—'}</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.38)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Status</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#5ED47A' }}>Active</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Score trend SVG chart ─────────────────────────────────────────────────
export function MiniTrendBar({ rounds }) {
  if (!rounds || rounds.length < 2) return null
  const diffs = rounds.slice().reverse().map(r => r.total - (r.course_par || 72))
  const max = Math.max(...diffs)
  const min = Math.min(...diffs)
  const range = max - min || 1
  const W = 320, H = 60
  const pts = diffs.map((d, i) => ({
    x: (i / (diffs.length - 1)) * W,
    y: H - ((d - min) / range) * (H - 12) - 6,
    d,
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <div style={{
      borderRadius: 18, overflow: 'hidden',
      background: 'rgba(255,255,255,0.80)',
      border: '1px solid rgba(27,94,59,0.10)',
      boxShadow: '0 2px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.85)',
      padding: '18px 18px 14px',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(13,31,18,0.70)' }}>Score Trend</div>
        <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.35)' }}>Last {rounds.length} rounds</div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="trendLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#C9A040" />
            <stop offset="100%" stopColor="#5ED47A" />
          </linearGradient>
        </defs>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2}
          stroke="rgba(27,94,59,0.10)" strokeWidth="1" strokeDasharray="4,4" />
        <path d={path} fill="none" stroke="url(#trendLine)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4.5"
            fill={p.d < 0 ? '#5ED47A' : p.d === 0 ? '#8AB4F8' : '#E8A85A'}
            stroke="rgba(6,14,8,0.9)" strokeWidth="2" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: 11, color: 'rgba(13,31,18,0.28)' }}>Oldest</span>
        <span style={{ fontSize: 11, color: 'rgba(13,31,18,0.28)' }}>Latest</span>
      </div>
    </div>
  )
}

// ── Glass stat tile ───────────────────────────────────────────────────────
export function StatTile({ label, value, sub, accent }) {
  return (
    <div style={{
      borderRadius: 16,
      background: 'rgba(255,255,255,0.85)',
      border: '1px solid rgba(27,94,59,0.10)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(27,94,59,0.07)',
      padding: '18px 14px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.35)', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontSize: 34, fontWeight: 900, lineHeight: 1,
        color: accent ?? '#fff',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.35)', marginTop: 5 }}>{sub}</div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function Stats({ user }) {
  const [summary, setSummary] = useState(null)
  const [rounds,  setRounds]  = useState([])
  const [profile, setProfile] = useState(null)  // includes seeded handicap
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api('/api/stats/summary').catch(() => null),
      api('/api/rounds?limit=20').catch(() => ({ rounds: [] })),
      api('/api/profile').catch(() => null),  // seeded handicap when no rounds
    ]).then(([s, r, p]) => {
      setSummary(s)
      setRounds(r?.rounds ?? [])
      setProfile(p)
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: 'rgba(13,31,18,0.35)', fontSize: 14 }}>
      Loading stats…
    </div>
  )

  // Empty state — no rounds yet. Two flavors:
  //   1. User has set a starting handicap (via Edit Profile / Start Season) →
  //      show that handicap as their current one with copy explaining it'll
  //      switch to USGA-calculated once they log 5+ rounds.
  //   2. No seeded handicap either → original "play your first round" CTA.
  if (!summary && rounds.length === 0) {
    const seededHcp = profile?.handicap
    if (seededHcp != null) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ padding: '20px 20px 16px', flexShrink: 0 }}>
            <div style={{
              fontSize: 28, fontWeight: 900, letterSpacing: '-1px',
              background: 'linear-gradient(135deg, #F5D78A, #E8C05A)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Stats
            </div>
            <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.38)', marginTop: 1 }}>{user.name}</div>
          </div>
          <div className="page-scroll" style={{ padding: '0 16px 20px' }}>
            <HcpBadge hcp={seededHcp} roundCount={0} />
            <div style={{
              borderRadius: 16,
              background: 'rgba(255,255,255,0.92)',
              border: '1px solid rgba(27,94,59,0.10)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.20)',
              padding: '18px 18px',
              marginTop: 12,
            }}>
              <div style={{ fontWeight: 800, color: '#0D1F12', fontSize: 16, marginBottom: 8 }}>
                Your starting handicap
              </div>
              <div style={{ color: 'rgba(13,31,18,0.65)', fontSize: 13, lineHeight: 1.55 }}>
                You haven't logged any rounds yet, so we're showing the handicap you entered when starting your season.
                Once you log 5+ rounds, this switches to a USGA-method calculated index based on your best 8 of last 20.
              </div>
              <div style={{
                marginTop: 14, padding: '12px 14px', borderRadius: 10,
                background: 'rgba(27,94,59,0.06)',
                color: 'rgba(13,31,18,0.55)', fontSize: 12, lineHeight: 1.5,
              }}>
                Need to update it? Tap <strong>Edit Profile</strong> on the Home tab to adjust your starting handicap.
              </div>
            </div>
          </div>
        </div>
      )
    }
    // No rounds AND no seeded handicap → original empty state, with stronger CTA
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', padding: '0 32px', gap: 20, textAlign: 'center',
        position: 'relative' }}>
        {/* Dark overlay so the empty-state text stays readable over the bg image */}
        <div style={{
          position: 'absolute', inset: '20% 5%', borderRadius: 24,
          background: 'rgba(7,12,9,0.45)', pointerEvents: 'none',
        }} />
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'rgba(255,255,255,0.10)',
          border: '1px solid rgba(255,255,255,0.20)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          <IconBarChart size={32} color="rgba(255,255,255,0.85)" />
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ fontWeight: 800, color: '#fff', fontSize: 20, marginBottom: 8 }}>No stats yet</div>
          <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 1.6 }}>
            Set a starting handicap on the Home tab, or play your first round to start tracking your score trend and club distances.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '20px 20px 16px', flexShrink: 0 }}>
        <div style={{
          fontSize: 28, fontWeight: 900, letterSpacing: '-1px',
          background: 'linear-gradient(135deg, #F5D78A, #E8C05A)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Stats
        </div>
        <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.38)', marginTop: 1 }}>{user.name}</div>
      </div>

      <div className="page-scroll" style={{ padding: '0 16px 20px', display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* Handicap hero */}
        <HcpBadge hcp={summary?.handicap ?? null} roundCount={summary?.roundCount} />

        {/* Stat tiles */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <StatTile
              label="Avg Score"
              value={summary.avgScore != null ? summary.avgScore.toFixed(1) : '—'}
              sub={`Par ${rounds[0]?.course_par ?? 72}`}
            />
            <StatTile
              label="Best Round"
              value={summary.bestScore ?? '—'}
              sub="All time"
              accent="#5ED47A"
            />
          </div>
        )}

        {/* Trend chart */}
        <MiniTrendBar rounds={rounds} />

        {/* Club distances */}
        {summary?.topClubs?.length > 0 && (
          <div style={{
            borderRadius: 18,
            background: 'rgba(255,255,255,0.80)',
            border: '1px solid rgba(27,94,59,0.10)',
            overflow: 'hidden', marginBottom: 16,
          }}>
            <div style={{
              padding: '14px 18px', borderBottom: '1px solid rgba(27,94,59,0.08)',
              fontSize: 13, fontWeight: 700, color: 'rgba(13,31,18,0.70)',
            }}>
              Your Distances
            </div>
            {summary.topClubs.map((c, i) => (
              <div key={i} style={{
                padding: '13px 18px',
                borderBottom: i < summary.topClubs.length - 1 ? '1px solid rgba(27,94,59,0.07)' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <span style={{ fontWeight: 700, color: '#0D1F12', fontSize: 15 }}>{c.club}</span>
                  <span style={{ fontSize: 12, color: 'rgba(13,31,18,0.35)', marginLeft: 8 }}>{c.shots} shots</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                  <span style={{ fontSize: 22, fontWeight: 900, color: '#E8C05A' }}>{c.avg}</span>
                  <span style={{ fontSize: 12, color: 'rgba(13,31,18,0.38)' }}>yd</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recent rounds */}
        {rounds.length > 0 && (
          <div style={{
            borderRadius: 18,
            background: 'rgba(255,255,255,0.80)',
            border: '1px solid rgba(27,94,59,0.10)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '14px 18px', borderBottom: '1px solid rgba(27,94,59,0.08)',
              fontSize: 13, fontWeight: 700, color: 'rgba(13,31,18,0.70)',
            }}>
              Recent Rounds
            </div>
            {rounds.slice(0, 8).map((r, i) => {
              const diff  = r.total - (r.course_par || 72)
              const label = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`
              const col   = scoreColor(diff)
              return (
                <div key={r.id} style={{
                  padding: '13px 18px',
                  borderBottom: i < Math.min(7, rounds.length - 1) ? '1px solid rgba(27,94,59,0.07)' : 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#0D1F12', fontSize: 14 }}>{r.course_name}</div>
                    <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.35)', marginTop: 2 }}>
                      {new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: col }}>{r.total}</div>
                    <div style={{ fontSize: 11, color: col, fontWeight: 700 }}>{label}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
