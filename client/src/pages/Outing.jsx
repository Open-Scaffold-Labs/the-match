import { useState, useEffect, useCallback } from 'react'
import { api, post, put } from '../lib/api.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(strokes, par) {
  if (!strokes || !par) return 'var(--tm-text-2)'
  const d = strokes - par
  if (d <= -2) return 'var(--tm-eagle)'
  if (d === -1) return 'var(--tm-birdie)'
  if (d === 0)  return 'var(--tm-par)'
  if (d === 1)  return 'var(--tm-bogey)'
  return 'var(--tm-double)'
}
function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)
}
function wlLabel(w, l, t) {
  if (!w && !l && !t) return '—'
  return `${w}-${l}${t ? `-${t}` : ''}`
}

// ─── Outing Hub (main landing) ────────────────────────────────────────────────
function OutingHub({ user, onJoin, onCreate, onOpenOuting, onOpenRivalry }) {
  const [rivalries, setRivalries] = useState([])
  const [recentOutings, setRecentOutings] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api('/api/outings/my-rivalries').catch(() => ({ rivalries: [] })),
      api('/api/outings/recent').catch(() => ({ outings: [] })),
    ]).then(([rv, ro]) => {
      setRivalries(rv.rivalries || [])
      setRecentOutings(ro.outings || [])
      setLoading(false)
    })
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
        <div style={{
          fontSize: 28, fontWeight: 900, letterSpacing: '-1px',
          background: 'linear-gradient(135deg, #F5D78A, #E8C05A)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: 2,
        }}>Outings</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>Your rivalries live here</div>
      </div>

      <div className="page-scroll" style={{ padding: '16px 20px', gap: 16 }}>
        {/* CTA buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={onCreate}
            style={{
              flex: 1, padding: '16px 0', borderRadius: 14, border: 'none',
              background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
              color: '#fff', fontWeight: 800, fontSize: 15,
              boxShadow: '0 4px 16px rgba(46,158,69,0.3), inset 0 1px 0 rgba(255,255,255,0.12)',
              cursor: 'pointer',
            }}>
            + Create
          </button>
          <button onClick={onJoin}
            style={{
              flex: 1, padding: '16px 0', borderRadius: 14,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(94,212,122,0.35)',
              color: '#5ED47A', fontWeight: 800, fontSize: 15,
              cursor: 'pointer',
            }}>
            Enter a Code
          </button>
        </div>

        {/* Head-to-head rivalries */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Your Rivalries</div>
          {loading
            ? <div style={{ color: 'var(--tm-text-3)', textAlign: 'center', padding: '20px 0', fontSize: 14 }}>Loading…</div>
            : rivalries.length === 0
            ? <EmptyRivalries />
            : rivalries.map(r => <RivalryCard key={r.opponent_id} r={r} userId={user.id} onOpen={() => onOpenRivalry?.(r)} />)
          }
        </div>

        {/* Recent outings */}
        {recentOutings.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Recent Outings</div>
            {recentOutings.map(o => (
              <button key={o.id} onClick={() => onOpenOuting(o.code)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 14, padding: '14px 16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 8,
                }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>{o.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {o.course_name} · {o.player_count}p · <span style={{ color: '#E8C05A', fontWeight: 700, letterSpacing: 2 }}>{o.code}</span>
                  </div>
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 20,
                  background: o.status === 'active' ? 'rgba(94,212,122,0.15)' : 'rgba(255,255,255,0.06)',
                  color: o.status === 'active' ? '#5ED47A' : 'rgba(255,255,255,0.4)',
                  border: o.status === 'active' ? '1px solid rgba(94,212,122,0.3)' : '1px solid rgba(255,255,255,0.1)',
                }}>
                  {o.status === 'active' ? '● LIVE' : 'Final'}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Rivalry Card ─────────────────────────────────────────────────────────────
function RivalryCard({ r, userId, onOpen }) {
  const myWins   = r.my_wins ?? 0
  const oppWins  = r.opp_wins ?? 0
  const ties     = r.ties ?? 0
  const total    = myWins + oppWins + ties
  const lead     = myWins > oppWins ? 'up' : myWins < oppWins ? 'down' : 'even'
  const leadColor = lead === 'up' ? 'var(--tm-birdie)' : lead === 'down' ? 'var(--tm-bogey)' : 'var(--tm-par)'

  return (
    <div onClick={onOpen} style={{
      borderRadius: 18,
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: '0 2px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
      padding: '16px', marginBottom: 10, cursor: onOpen ? 'pointer' : 'default',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(30,80,35,0.8), rgba(15,50,20,0.8))',
            border: '1.5px solid rgba(94,212,122,0.4)',
            boxShadow: '0 0 12px rgba(94,212,122,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#5ED47A',
          }}>
            {initials(r.opponent_name)}
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#fff', fontSize: 15 }}>{r.opponent_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{total} match{total !== 1 ? 'es' : ''}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: leadColor }}>{wlLabel(myWins, oppWins, ties)}</div>
          <div style={{ fontSize: 11, color: leadColor, fontWeight: 600, marginTop: 1 }}>
            {lead === 'up' ? `+${myWins - oppWins} up` : lead === 'down' ? `${myWins - oppWins} down` : 'EVEN'}
          </div>
        </div>
      </div>
      {/* Win bar */}
      {total > 0 && (
        <>
          <div style={{ marginTop: 14, height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', display: 'flex', gap: 1 }}>
            <div style={{ width: `${(myWins/total)*100}%`, background: 'linear-gradient(90deg, #2A7A38, #5ED47A)', borderRadius: '99px 0 0 99px', transition: 'width 400ms ease' }} />
            {ties > 0 && <div style={{ width: `${(ties/total)*100}%`, background: 'rgba(138,180,248,0.5)' }} />}
            <div style={{ flex: 1, background: 'rgba(224,122,90,0.5)', borderRadius: '0 99px 99px 0' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 11, color: 'rgba(94,212,122,0.7)', fontWeight: 600 }}>You {myWins}W</span>
            {ties > 0 && <span style={{ fontSize: 11, color: 'rgba(138,180,248,0.6)', fontWeight: 600 }}>{ties}T</span>}
            <span style={{ fontSize: 11, color: 'rgba(224,122,90,0.7)', fontWeight: 600 }}>{oppWins}W {r.opponent_name?.split(' ')[0]}</span>
          </div>
        </>
      )}
    </div>
  )
}

function EmptyRivalries() {
  return (
    <div style={{
      borderRadius: 18,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      padding: '32px 20px', textAlign: 'center',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 16px',
      }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87"/>
          <path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
      </div>
      <div style={{ fontWeight: 700, color: '#fff', fontSize: 15, marginBottom: 8 }}>No rivalries yet</div>
      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, lineHeight: 1.6 }}>Create or join a match to start tracking your head-to-head record.</div>
    </div>
  )
}

// ─── Rivalry Detail ───────────────────────────────────────────────────────────
function RivalryDetail({ rivalry, userId, onBack }) {
  const [matches, setMatches]     = useState(null)
  const [opponent, setOpponent]   = useState(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    api(`/api/outings/rivalry/${rivalry.opponent_id}`)
      .then(d => { setMatches(d.matches || []); setOpponent(d.opponent) })
      .catch(() => setMatches([]))
      .finally(() => setLoading(false))
  }, [rivalry.opponent_id])

  const myWins  = rivalry.my_wins ?? 0
  const oppWins = rivalry.opp_wins ?? 0
  const ties    = rivalry.ties ?? 0
  const total   = myWins + oppWins + ties
  const lead    = myWins > oppWins ? 'up' : myWins < oppWins ? 'down' : 'even'
  const lColor  = lead === 'up' ? '#4ADE80' : lead === 'down' ? '#F87171' : 'rgba(255,255,255,0.5)'

  // Form guide: last 5 results
  const recent = (matches || []).slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--tm-bg)' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px 12px', background: 'var(--tm-surface)', borderBottom: '1px solid var(--tm-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 22, padding: '0 4px', cursor: 'pointer' }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--tm-text)' }}>{rivalry.opponent_name}</div>
            <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginTop: 1 }}>{total} match{total !== 1 ? 'es' : ''}{opponent?.handicap != null ? ` · HCP ${opponent.handicap}` : ''}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: lColor }}>{myWins}-{oppWins}{ties > 0 ? `-${ties}` : ''}</div>
            <div style={{ fontSize: 11, color: lColor, fontWeight: 700 }}>{lead === 'up' ? `You lead +${myWins - oppWins}` : lead === 'down' ? `You trail ${myWins - oppWins}` : 'EVEN'}</div>
          </div>
        </div>

        {/* Win bar */}
        {total > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', display: 'flex', gap: 1 }}>
              <div style={{ width: `${(myWins/total)*100}%`, background: 'linear-gradient(90deg, #2A7A38, #4ADE80)', borderRadius: '99px 0 0 99px', transition: 'width 400ms ease' }} />
              {ties > 0 && <div style={{ width: `${(ties/total)*100}%`, background: 'rgba(138,180,248,0.5)' }} />}
              <div style={{ flex: 1, background: 'rgba(248,113,113,0.4)', borderRadius: '0 99px 99px 0' }} />
            </div>
          </div>
        )}

        {/* Form dots */}
        {recent.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1, marginRight: 4 }}>Form</div>
            {recent.map((m, i) => {
              const won = m.is_tie ? null : m.i_won
              return (
                <div key={i} style={{
                  width: 22, height: 22, borderRadius: '50%', fontSize: 10, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: m.is_tie ? 'rgba(138,180,248,0.2)' : won ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)',
                  border: m.is_tie ? '1px solid rgba(138,180,248,0.4)' : won ? '1px solid rgba(74,222,128,0.4)' : '1px solid rgba(248,113,113,0.4)',
                  color: m.is_tie ? '#93C5FD' : won ? '#4ADE80' : '#F87171',
                }}>{m.is_tie ? 'T' : won ? 'W' : 'L'}</div>
              )
            })}
          </div>
        )}
      </div>

      {/* Match history list */}
      <div className="page-scroll" style={{ padding: '16px 20px', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Match History</div>
        {loading
          ? <div style={{ color: 'var(--tm-text-3)', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading…</div>
          : matches?.length === 0
          ? <div style={{ color: 'var(--tm-text-3)', textAlign: 'center', padding: 24, fontSize: 13 }}>No recorded matches yet.</div>
          : matches?.map((m, i) => {
              const won = m.is_tie ? null : m.i_won
              const diff = (m.my_score || 0) - (m.opp_score || 0)
              return (
                <div key={m.id || i} style={{
                  background: 'var(--tm-surface)', border: '1px solid var(--tm-border)',
                  borderRadius: 14, padding: '14px 16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 14 }}>{m.outing_name || m.course_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginTop: 2 }}>
                      {m.course_name}{m.created_at ? ` · ${new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginBottom: 4,
                      background: m.is_tie ? 'rgba(138,180,248,0.12)' : won ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                      border: m.is_tie ? '1px solid rgba(138,180,248,0.3)' : won ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(248,113,113,0.3)',
                      color: m.is_tie ? '#93C5FD' : won ? '#4ADE80' : '#F87171',
                    }}>{m.is_tie ? 'TIE' : won ? 'WIN' : 'LOSS'}</div>
                    <div style={{ fontSize: 12, color: 'var(--tm-text-3)' }}>
                      {m.my_score} – {m.opp_score}
                      {!m.is_tie && <span style={{ color: won ? '#4ADE80' : '#F87171', fontWeight: 700, marginLeft: 4 }}>({diff > 0 ? '+' : ''}{diff})</span>}
                    </div>
                  </div>
                </div>
              )
            })
        }
      </div>
    </div>
  )
}

// ─── End Match / Winner Ceremony ──────────────────────────────────────────────
function EndMatchScreen({ summary, onDone }) {
  const { winner, podium = [], highlights, course, course_par, format } = summary
  const [shared, setShared] = useState(false)

  async function share() {
    const lines = [`${winner?.name} wins ${winner?.name ? '"' + (course || 'The Match') + '"' : ''}!`]
    podium.forEach((p, i) => {
      const sign = p.diff >= 0 ? `+${p.diff}` : `${p.diff}`
      lines.push(`${i + 1}. ${p.name}  ${p.total}  (${sign})`)
    })
    if (highlights?.most_birdies) lines.push(`Most birdies: ${highlights.most_birdies.name} (${highlights.most_birdies.count})`)
    lines.push('Tracked on The Match')
    const text = lines.join('\n')
    if (navigator.share) {
      try { await navigator.share({ text }) } catch {}
    } else {
      await navigator.clipboard.writeText(text)
      setShared(true); setTimeout(() => setShared(false), 2500)
    }
  }

  const podiumColors = ['#E8C05A', 'rgba(255,255,255,0.5)', '#CD7F32']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--tm-bg)', overflowY: 'auto' }}>
      {/* Trophy hero */}
      <div style={{ padding: '32px 24px 24px', textAlign: 'center', background: 'radial-gradient(ellipse at top, rgba(197,160,64,0.12) 0%, transparent 70%)' }}>
        <div style={{ fontSize: 64, marginBottom: 12, lineHeight: 1 }}>
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#E8C05A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 21h8M12 17v4M17 3H7l1 7a5 5 0 0010 0l1-7z"/>
            <path d="M7 3H4a2 2 0 000 4h3M17 3h3a2 2 0 010 4h-3"/>
          </svg>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-gold-text)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>
          {format === 'match' ? 'Match Play' : format === 'stableford' ? 'Stableford' : format === 'skins' ? 'Skins' : 'Stroke Play'} · {course || 'Final Results'}
        </div>
        {winner && (
          <>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#F5D78A', lineHeight: 1.1, marginBottom: 6 }}>
              {winner.name}
            </div>
            <div style={{ fontSize: 16, color: 'var(--tm-text-3)' }}>
              {winner.total} strokes
              {winner.diff !== undefined && (
                <span style={{ marginLeft: 8, fontWeight: 800, color: winner.diff < 0 ? '#4ADE80' : winner.diff > 0 ? '#F87171' : 'var(--tm-text-2)' }}>
                  ({winner.diff === 0 ? 'E' : winner.diff > 0 ? `+${winner.diff}` : winner.diff})
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Podium */}
      <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Final Standings</div>
        {podium.map((p, i) => {
          const sign = p.diff === 0 ? 'E' : p.diff > 0 ? `+${p.diff}` : `${p.diff}`
          const diffC = p.diff < 0 ? '#4ADE80' : p.diff > 0 ? '#F87171' : 'var(--tm-text-2)'
          return (
            <div key={p.user_id} style={{
              background: i === 0 ? 'rgba(232,192,90,0.1)' : 'var(--tm-surface)',
              border: `1px solid ${i === 0 ? 'rgba(232,192,90,0.35)' : 'var(--tm-border)'}`,
              borderRadius: 14, padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: `1.5px solid ${podiumColors[i] ?? 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, color: podiumColors[i] ?? 'var(--tm-text-3)', flexShrink: 0 }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: i === 0 ? '#F5D78A' : 'var(--tm-text)', fontSize: 15 }}>{p.name}{p.is_guest ? ' (guest)' : ''}</div>
                <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 2 }}>
                  {p.birdies > 0 && <span style={{ color: '#4ADE80', marginRight: 8 }}>{p.birdies} birdie{p.birdies !== 1 ? 's' : ''}</span>}
                  {p.eagles > 0 && <span style={{ color: '#E8C05A', marginRight: 8 }}>{p.eagles} eagle{p.eagles !== 1 ? 's' : ''}</span>}
                  {p.holes_played} holes
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: i === 0 ? '#F5D78A' : 'var(--tm-text)' }}>{p.total}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: diffC }}>{sign}</div>
              </div>
            </div>
          )
        })}

        {/* Highlights */}
        {(highlights?.most_birdies || highlights?.most_eagles) && (
          <div style={{ background: 'var(--tm-surface)', border: '1px solid var(--tm-border)', borderRadius: 14, padding: '14px 16px', marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Round Highlights</div>
            {highlights.most_eagles && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--tm-text-2)' }}>Eagle{highlights.most_eagles.count > 1 ? 's' : ''}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#E8C05A' }}>{highlights.most_eagles.name} × {highlights.most_eagles.count}</span>
              </div>
            )}
            {highlights.most_birdies && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--tm-text-2)' }}>Most birdies</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#4ADE80' }}>{highlights.most_birdies.name} × {highlights.most_birdies.count}</span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <button onClick={share} style={{
          width: '100%', padding: '16px', borderRadius: 14, cursor: 'pointer', marginTop: 8,
          background: 'rgba(232,192,90,0.12)', border: '1px solid rgba(232,192,90,0.4)',
          color: '#F5D78A', fontWeight: 800, fontSize: 15,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          {shared ? 'Copied to clipboard!' : 'Share Results'}
        </button>
        <button onClick={onDone} style={{
          width: '100%', padding: '16px', borderRadius: 14, cursor: 'pointer',
          background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
          color: 'var(--tm-text-2)', fontWeight: 700, fontSize: 15,
        }}>Back to Matches</button>
      </div>
    </div>
  )
}

// ─── Join Sheet ───────────────────────────────────────────────────────────────
function JoinSheet({ onClose, onJoined }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin() {
    const c = code.toUpperCase().trim()
    if (c.length !== 4) { setError('Enter a 4-digit code'); return }
    setLoading(true); setError('')
    try {
      const data = await post(`/api/outings/${c}/join`, {})
      onJoined(data.outing)
    } catch (e) {
      setError(e.message || 'Outing not found')
    } finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', padding: '24px 20px calc(24px + env(safe-area-inset-bottom))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tm-text)' }}>Enter a Code</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 20 }}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginBottom: 12 }}>Enter the 4-character code from your group</div>
        <input
          autoFocus
          value={code} onChange={e => setCode(e.target.value.toUpperCase().slice(0,4))}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
          placeholder="CODE" maxLength={4}
          style={{ width: '100%', textAlign: 'center', fontSize: 32, fontWeight: 800, letterSpacing: 8, background: 'var(--tm-surface-2)', border: `2px solid ${error ? 'var(--tm-danger)' : 'var(--tm-border-2)'}`, borderRadius: 'var(--tm-radius)', color: 'var(--tm-gold-text)', padding: '16px', outline: 'none', boxSizing: 'border-box' }}
        />
        {error && <div style={{ color: 'var(--tm-danger)', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{error}</div>}
        <button onClick={handleJoin} disabled={loading || code.length < 4}
          style={{ width: '100%', marginTop: 16, padding: '16px', borderRadius: 'var(--tm-radius-lg)', background: code.length === 4 ? 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))' : 'var(--tm-surface-2)', color: code.length === 4 ? '#fff' : 'var(--tm-text-3)', fontWeight: 800, fontSize: 16, border: 'none' }}>
          {loading ? 'Joining…' : 'Join Outing'}
        </button>
      </div>
    </div>
  )
}

// ─── Create Outing Wizard ─────────────────────────────────────────────────────
const FORMATS = [
  { id: 'stroke',    label: 'Stroke Play',    desc: 'Total strokes wins' },
  { id: 'match',     label: 'Match Play',     desc: 'Hole-by-hole wins' },
  { id: 'stableford',label: 'Stableford',     desc: 'Points system' },
  { id: 'skins',     label: 'Skins',          desc: 'Win each hole outright' },
]
const TEAMS = [
  { id: 'individual', label: 'Individual',     desc: 'Everyone scores for themselves — head-to-head records tracked' },
  { id: 'teams',      label: '2 Teams',        desc: 'Split your group into two teams — you assign players after' },
  { id: 'big_team',   label: 'Multiple Teams', desc: 'Create 3 or more teams — ideal for larger groups' },
]

function CreateWizard({ user, onClose, onCreated, pendingPlayers = [] }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({ name: '', courseName: '', format: 'stroke', team: 'individual', holes: 18 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleCreate() {
    setLoading(true); setError('')
    try {
      const data = await post('/api/outings', {
        name: form.name || `${user.name}'s Match`,
        courseName: form.courseName || 'TBD',
        scoringFormats: [form.format],
        teamFormat: form.team,
        coursePar: form.holes === 9 ? 36 : 72,
      })
      // Auto-add all pre-filled players — they're already committed, skip the join-code step
      if (pendingPlayers.length > 0) {
        try {
          await post(`/api/outings/${data.outing.code}/bulk-join`, {
            user_ids: pendingPlayers.map(p => p.id),
          })
        } catch (e) { console.warn('[bulk-join]', e) }
      }
      onCreated(data.outing)
    } catch (e) {
      setError(e.message || 'Failed to create outing')
    } finally { setLoading(false) }
  }

  const steps = [
    // Step 0: Name + Course
    <div key="0" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Match Name</div>
        <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={`${user.name}'s Match`}
          style={{ width: '100%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border-2)', borderRadius: 'var(--tm-radius)', color: 'var(--tm-text)', fontSize: 16, padding: '12px 14px', outline: 'none', boxSizing: 'border-box' }} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Course</div>
        <input value={form.courseName} onChange={e => set('courseName', e.target.value)} placeholder="Course name (optional)"
          style={{ width: '100%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border-2)', borderRadius: 'var(--tm-radius)', color: 'var(--tm-text)', fontSize: 16, padding: '12px 14px', outline: 'none', boxSizing: 'border-box' }} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Holes</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[9,18].map(h => <button key={h} onClick={() => set('holes', h)} style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--tm-radius)', border: '1px solid', borderColor: form.holes === h ? 'var(--tm-green)' : 'var(--tm-border)', background: form.holes === h ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)', color: form.holes === h ? 'var(--tm-green-text)' : 'var(--tm-text-2)', fontWeight: 700 }}>{h} Holes</button>)}
        </div>
      </div>
    </div>,

    // Step 1: Format
    <div key="1" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {FORMATS.map(f => (
        <button key={f.id} onClick={() => set('format', f.id)}
          style={{ padding: '16px', borderRadius: 'var(--tm-radius-lg)', border: '2px solid', borderColor: form.format === f.id ? 'var(--tm-green)' : 'var(--tm-border)', background: form.format === f.id ? 'var(--tm-green-muted)' : 'var(--tm-surface)', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15 }}>{f.label}</div>
            <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginTop: 2 }}>{f.desc}</div>
          </div>
          {form.format === f.id && <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--tm-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800 }}>✓</div>}
        </button>
      ))}
    </div>,

    // Step 2: Team format
    <div key="2" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {TEAMS.map(t => (
        <button key={t.id} onClick={() => set('team', t.id)}
          style={{ padding: '16px', borderRadius: 'var(--tm-radius-lg)', border: '2px solid', borderColor: form.team === t.id ? 'var(--tm-gold)' : 'var(--tm-border)', background: form.team === t.id ? 'var(--tm-gold-muted)' : 'var(--tm-surface)', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15 }}>{t.label}</div>
            <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginTop: 2 }}>{t.desc}</div>
          </div>
          {form.team === t.id && <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--tm-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-inv)', fontSize: 11, fontWeight: 800 }}>✓</div>}
        </button>
      ))}
    </div>,
  ]

  const stepTitles = ['Set the Stage', 'Scoring Format', 'Competition Structure']

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tm-text)' }}>{stepTitles[step]}</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 20 }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginBottom: 16 }}>Step {step+1} of 3</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
            {[0,1,2].map(i => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? 'var(--tm-green)' : 'var(--tm-surface-3)' }} />)}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {/* Pre-filled players from schedule modal */}
          {pendingPlayers.length > 0 && (
            <div style={{
              marginBottom: 16, padding: '12px 14px',
              background: 'rgba(232,192,90,0.08)', border: '1px solid rgba(232,192,90,0.2)',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(232,192,90,0.7)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                Pre-filled · {pendingPlayers.length + 1} Players
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {pendingPlayers.map(p => (
                  <div key={p.id} style={{
                    background: 'rgba(232,192,90,0.12)', border: '1px solid rgba(232,192,90,0.25)',
                    borderRadius: 20, padding: '4px 12px',
                    fontSize: 12, fontWeight: 600, color: '#F5D78A',
                  }}>{p.name}</div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 8 }}>
                These players will be auto-added when you create the outing.
              </div>
            </div>
          )}
          {steps[step]}
        </div>
        {error && <div style={{ color: 'var(--tm-danger)', fontSize: 13, padding: '8px 20px', textAlign: 'center' }}>{error}</div>}
        <div style={{ padding: '16px 20px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', display: 'flex', gap: 12, flexShrink: 0 }}>
          {step > 0 && <button onClick={() => setStep(s => s-1)} style={{ flex: 1, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text-2)', fontWeight: 700 }}>Back</button>}
          {step < 2
            ? <button onClick={() => setStep(s => s+1)} style={{ flex: 2, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))', color: '#fff', fontWeight: 800, fontSize: 15, border: 'none' }}>Next →</button>
            : <button onClick={handleCreate} disabled={loading} style={{ flex: 2, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))', color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 15, border: 'none' }}>{loading ? 'Creating…' : 'Create Match'}</button>
          }
        </div>
      </div>
    </div>
  )
}

// ─── Helpers for scorecard ────────────────────────────────────────────────────
function estimateHolePars(coursePar, holes) {
  // Distribute par fairly: base each hole at floor(coursePar/holes),
  // then add 1 to the first `remainder` holes to reach total.
  const base = Math.floor(coursePar / holes)
  const extra = coursePar - base * holes
  return Array.from({ length: holes }, (_, i) => (i < extra ? base + 1 : base))
}

// Cell coloring per golf scorecard tradition
function cellBg(score, par) {
  if (!score || !par) return 'transparent'
  const d = score - par
  if (d <= -2) return '#1a4a2e'   // eagle — dark green
  if (d === -1) return '#1e6b3a'  // birdie — green
  if (d === 0)  return 'transparent' // par — no fill
  if (d === 1)  return '#6b1e1e'  // bogey — dark red
  return '#8b1a1a'                // double+ — red
}
function cellBorder(score, par) {
  if (!score || !par) return '1px solid var(--tm-border)'
  const d = score - par
  if (d <= -2) return '2px solid #4ADE80'
  if (d === -1) return '1px solid #4ADE80'
  if (d === 0)  return '1px solid var(--tm-border)'
  if (d === 1)  return '1px solid #F87171'
  return '2px solid #F87171'
}
function cellColor(score, par) {
  if (!score || !par) return 'var(--tm-text-3)'
  const d = score - par
  if (d <= -2) return '#4ADE80'
  if (d === -1) return '#86EFAC'
  if (d === 0)  return 'var(--tm-text-2)'
  if (d === 1)  return '#FCA5A5'
  return '#F87171'
}

// Single scorecard cell — tappable by host for any player, or by self
function ScorecardCell({ score, par, canEdit, onTap, isSubtotal, overrideBg, overrideBorder, overrideColor }) {
  const bg     = overrideBg     ?? (isSubtotal ? 'var(--tm-surface-3)' : cellBg(score, par))
  const border = overrideBorder ?? (isSubtotal ? '1px solid var(--tm-border-2)' : cellBorder(score, par))
  const color  = overrideColor  ?? (isSubtotal ? 'var(--tm-text)' : cellColor(score, par))
  return (
    <div
      onClick={canEdit && !isSubtotal ? onTap : undefined}
      style={{
        minWidth: isSubtotal ? 36 : 32, height: 36,
        background: bg, border, borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: isSubtotal ? 13 : 14, fontWeight: isSubtotal ? 800 : 700,
        color, cursor: canEdit && !isSubtotal ? 'pointer' : 'default',
        flexShrink: 0, userSelect: 'none',
      }}
    >
      {score || (isSubtotal ? '—' : '')}
    </div>
  )
}

// Score entry modal — stepper + quick picks
function ScoreModal({ playerName, hole, par, currentScore, onSave, onClose }) {
  const [val, setVal] = useState(currentScore || par || 4)

  const quickPicks = [
    { label: 'Eagle',  diff: -2 },
    { label: 'Birdie', diff: -1 },
    { label: 'Par',    diff:  0 },
    { label: 'Bogey',  diff: +1 },
    { label: 'Double', diff: +2 },
  ].map(q => ({ ...q, score: (par || 4) + q.diff })).filter(q => q.score >= 1)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
      }} onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', textAlign: 'center', marginBottom: 4 }}>
          {playerName} — Hole {hole + 1}{par ? ` (Par ${par})` : ''}
        </div>

        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 20 }}>
          <button onClick={() => setVal(v => Math.max(1, v - 1))}
            style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontSize: 26, fontWeight: 300, cursor: 'pointer' }}>−</button>
          <div style={{ fontSize: 56, fontWeight: 900, color: cellColor(val, par), minWidth: 64, textAlign: 'center', lineHeight: 1 }}>{val}</div>
          <button onClick={() => setVal(v => v + 1)}
            style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontSize: 26, fontWeight: 300, cursor: 'pointer' }}>+</button>
        </div>

        {/* Quick picks */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          {quickPicks.map(q => (
            <button key={q.label} onClick={() => setVal(q.score)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: val === q.score ? cellBg(q.score, par) || 'var(--tm-surface-3)' : 'var(--tm-surface-2)',
                border: val === q.score ? cellBorder(q.score, par) : '1px solid var(--tm-border)',
                color: val === q.score ? cellColor(q.score, par) : 'var(--tm-text-3)',
              }}>{q.label} ({q.score})</button>
          ))}
        </div>

        <button onClick={() => onSave(val)} style={{
          width: '100%', padding: 16, borderRadius: 'var(--tm-radius-lg)',
          background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
          color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 16, border: 'none', cursor: 'pointer',
        }}>Save Score</button>
      </div>
    </div>
  )
}

// ─── Add Guest Modal ──────────────────────────────────────────────────────────
function GuestModal({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setSaving(true)
    await onAdd(name.trim())
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--tm-text)', marginBottom: 6 }}>Add Guest Player</div>
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginBottom: 20 }}>
          For players without the app — the host enters their scores manually.
        </div>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Player name"
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 'var(--tm-radius)',
            background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
            color: 'var(--tm-text)', fontSize: 16, outline: 'none', boxSizing: 'border-box',
            marginBottom: 16,
          }}
        />
        <button
          onClick={submit}
          disabled={!name.trim() || saving}
          style={{
            width: '100%', padding: 16, borderRadius: 'var(--tm-radius-lg)',
            background: name.trim() ? 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))' : 'var(--tm-surface-3)',
            color: name.trim() ? 'var(--tm-text-inv)' : 'var(--tm-text-3)',
            fontWeight: 800, fontSize: 16, border: 'none', cursor: name.trim() ? 'pointer' : 'default',
          }}
        >{saving ? 'Adding…' : 'Add to Scorecard'}</button>
      </div>
    </div>
  )
}

// ─── Match Play helpers ───────────────────────────────────────────────────────
// Only meaningful for exactly 2 players
function computeMatchPlay(p1, p2, getScores, holePars) {
  const s1 = getScores(p1), s2 = getScores(p2)
  let p1HolesUp = 0
  const holeResults = holePars.map((par, h) => {
    const a = s1[h] || 0, b = s2[h] || 0
    if (!a || !b) return null // not yet played
    if (a < b) return 'p1'
    if (b < a) return 'p2'
    return 'half'
  })
  holeResults.forEach(r => {
    if (r === 'p1') p1HolesUp++
    else if (r === 'p2') p1HolesUp--
  })
  const played = holeResults.filter(r => r !== null).length
  const remaining = holePars.length - played
  const dormie = played > 0 && Math.abs(p1HolesUp) > remaining
  return { holeResults, p1HolesUp, played, remaining, dormie }
}

// ─── Live Outing Scorer ───────────────────────────────────────────────────────
function LiveOuting({ code, user, onBack, onMatchEnd }) {
  const [outing, setOuting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showTeams, setShowTeams] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  const [scoreModal, setScoreModal] = useState(null) // { userId, userName, hole }
  const [showGuestModal, setShowGuestModal] = useState(false)
  const [netMode, setNetMode] = useState(false)
  const [ending, setEnding] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadOuting = useCallback(async () => {
    try {
      const data = await api(`/api/outings/${code}`)
      setOuting(data.outing)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [code])

  useEffect(() => { loadOuting() }, [loadOuting])
  // Poll every 5s for live scores
  useEffect(() => {
    const t = setInterval(loadOuting, 5000)
    return () => clearInterval(t)
  }, [loadOuting])
  // Auto-open team setup for host when outing has a team format but no teams yet
  useEffect(() => {
    if (!outing) return
    const isHost      = String(outing.host_id) === String(user?.id)
    const isTeamFmt   = outing.team_format && outing.team_format !== 'individual'
    const hasTeams    = (outing.state?.teams ?? []).length > 0
    if (isHost && isTeamFmt && !hasTeams) {
      setShowTeams(true)
    }
  }, [outing?.id])

  async function addGuest(name) {
    try {
      await post(`/api/outings/${code}/guests`, { name })
      await loadOuting()
      setShowGuestModal(false)
    } catch (e) { console.error(e) }
  }

  async function endMatch() {
    if (!window.confirm('End this match? Scores will be finalized and rivalries updated.')) return
    setEnding(true)
    try {
      const data = await post(`/api/outings/${code}/end`, {})
      onMatchEnd?.(data.summary)
    } catch (e) { console.error(e); setEnding(false) }
  }

  async function saveScore(hole, score, targetUserId) {
    setSaving(true)
    try {
      if (String(outing?.host_id) === String(user?.id)) {
        // Host can enter any player's score
        await put(`/api/outings/${code}/scores/host`, { hole, score, user_id: targetUserId })
      } else if (isMarkerFor(String(user?.id), String(targetUserId))) {
        // Assigned marker enters scores for their group via the marker endpoint
        await put(`/api/outings/${code}/scores/marker`, { hole, score, user_id: targetUserId })
      } else {
        // Non-marker: submit own score only
        await put(`/api/outings/${code}/scores`, { hole, score })
      }
      await loadOuting()
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--tm-text-3)' }}>
      Loading scorecard…
    </div>
  )
  if (!outing) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: 20 }}>
      <div style={{ color: 'var(--tm-text)', fontWeight: 700, fontSize: 16 }}>Match not found</div>
      <button onClick={onBack} style={{ color: 'var(--tm-green-text)', background: 'none', border: 'none', fontWeight: 700 }}>← Back</button>
    </div>
  )

  const participants = outing.state?.participants ?? []
  const teams        = outing.state?.teams ?? []
  const markers      = outing.state?.markers ?? []  // [{ marker_id, member_ids[] }]
  const holeCount    = outing.state?.holes ?? 18
  const coursePar    = outing.course_par ?? 72
  const holePars     = estimateHolePars(coursePar, holeCount)
  const isHost       = String(outing.host_id) === String(user?.id)
  const isTeamFormat = outing.team_format && outing.team_format !== 'individual'

  // Returns true if userId is an assigned marker responsible for targetId's scores
  function isMarkerFor(userId, targetId) {
    return markers.some(m =>
      String(m.marker_id) === String(userId) &&
      m.member_ids.map(String).includes(String(targetId))
    )
  }
  // Returns true if userId is any marker in this match
  const isMarker = markers.some(m => String(m.marker_id) === String(user?.id))

  // Build hole index arrays: front 9 = 0..8, back 9 = 9..17
  const frontHoles = Array.from({ length: Math.min(9, holeCount) }, (_, i) => i)
  const backHoles  = holeCount > 9 ? Array.from({ length: holeCount - 9 }, (_, i) => i + 9) : []
  const frontPar   = frontHoles.reduce((s, h) => s + holePars[h], 0)
  const backPar    = backHoles.reduce((s, h) => s + holePars[h], 0)

  function playerTeam(userId) {
    return teams.find(t => t.member_ids?.map(String).includes(String(userId)))
  }

  // For each participant, build a scores array indexed by hole (0-based)
  function getScores(p) {
    const arr = p.scores || []
    if (Array.isArray(arr)) return arr
    return []
  }

  // +/- vs par for holes actually played
  function diffStr(p) {
    const sc = getScores(p)
    const played = sc.filter(s => s > 0)
    if (!played.length) return 'E'
    const holesPlayed = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    const parSoFar = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
    const d = totalSoFar - parSoFar
    return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`
  }
  function diffColor(p) {
    const sc = getScores(p)
    const holesPlayed = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    const parSoFar = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
    const d = totalSoFar - parSoFar
    return cellColor(totalSoFar || 0, parSoFar || 1)
  }

  // Sort leaderboard: fewer strokes vs par played = better
  function leaderboardSort(a, b) {
    const calcNet = p => {
      const sc = getScores(p)
      const holesPlayed = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
      if (!holesPlayed.length) return 999
      const parSoFar = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
      const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
      return totalSoFar - parSoFar
    }
    return calcNet(a) - calcNet(b)
  }

  const sorted = [...participants].sort(leaderboardSort)

  // Match Play: only active for 2-player matches with 'match' format
  const isMatchPlay   = (outing.scoring_formats || []).includes('match') && participants.length === 2
  const matchPlayData = isMatchPlay ? computeMatchPlay(sorted[0], sorted[1], getScores, holePars) : null

  // Net scoring helpers
  function netTotal(p) {
    const gross = getScores(p).reduce((s, v) => s + (v || 0), 0)
    const hcp   = Math.floor(Math.max(0, parseFloat(p.handicap) || 0))
    return gross - hcp
  }
  function netDiffStr(p) {
    const gross = getScores(p)
    const holesPlayed = gross.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    if (!holesPlayed.length) return 'E'
    const parSoFar = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
    const hcp = Math.floor(Math.max(0, parseFloat(p.handicap) || 0))
    const d = totalSoFar - hcp - parSoFar
    return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`
  }
  const hasHandicaps = participants.some(p => p.handicap != null && !p.is_guest)

  // Column width constants
  const PLAYER_COL = 80
  const HOLE_COL   = 32
  const SUB_COL    = 38

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--tm-bg)' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', background: 'var(--tm-surface)', borderBottom: '1px solid var(--tm-border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 22, padding: '0 4px', cursor: 'pointer' }}>←</button>
          <div style={{ textAlign: 'center', flex: 1, padding: '0 8px' }}>
            <div style={{ fontWeight: 800, color: 'var(--tm-text)', fontSize: 15, lineHeight: 1.2 }}>{outing.name}</div>
            <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 2 }}>{outing.course_name}{coursePar ? ` · Par ${coursePar}` : ''}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ background: 'var(--tm-green-muted)', padding: '3px 8px', borderRadius: 'var(--tm-radius-full)', fontSize: 10, fontWeight: 700, color: 'var(--tm-green-text)', letterSpacing: 2 }}>{code}</div>
            {isHost && isTeamFormat && (
              <button onClick={() => setShowTeams(true)} style={{
                background: teams.length > 0 ? 'rgba(232,192,90,0.15)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${teams.length > 0 ? 'rgba(232,192,90,0.4)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 20, padding: '2px 8px',
                color: teams.length > 0 ? '#F5D78A' : 'rgba(255,255,255,0.5)',
                fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em',
              }}>{teams.length > 0 ? 'Edit Teams' : 'Set Teams'}</button>
            )}
          </div>
        </div>

        {/* Host controls row */}
        {isHost && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: 'var(--tm-text-3)', flex: 1 }}>
              {markers.length > 0 ? `${markers.length} marker${markers.length !== 1 ? 's' : ''} assigned` : 'Tap any cell to enter scores'}
            </div>
            <button onClick={() => setShowGroups(true)} style={{
              background: markers.length > 0 ? 'rgba(138,180,248,0.12)' : 'rgba(255,255,255,0.07)',
              border: `1px solid ${markers.length > 0 ? 'rgba(138,180,248,0.35)' : 'var(--tm-border)'}`,
              borderRadius: 20, padding: '3px 10px',
              color: markers.length > 0 ? '#93C5FD' : 'var(--tm-text-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>{markers.length > 0 ? 'Edit Groups' : 'Set Groups'}</button>
            {hasHandicaps && (
              <button onClick={() => setNetMode(m => !m)} style={{
                background: netMode ? 'rgba(197,160,64,0.15)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${netMode ? 'rgba(197,160,64,0.4)' : 'var(--tm-border)'}`,
                borderRadius: 20, padding: '3px 10px',
                color: netMode ? '#F5D78A' : 'var(--tm-text-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>{netMode ? 'NET' : 'GROSS'}</button>
            )}
            <button onClick={() => setShowGuestModal(true)} style={{
              background: 'rgba(255,255,255,0.07)', border: '1px solid var(--tm-border)',
              borderRadius: 20, padding: '3px 10px',
              color: 'var(--tm-text-2)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>+ Guest</button>
            <button onClick={endMatch} disabled={ending} style={{
              background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 20, padding: '3px 10px',
              color: '#F87171', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>{ending ? 'Ending…' : 'End Match'}</button>
          </div>
        )}
        {/* Marker hint — shown to assigned markers who aren't host */}
        {!isHost && isMarker && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#93C5FD', fontWeight: 600 }}>
            ✎ You're a marker — tap any cell in your group to enter scores
          </div>
        )}

        {/* Match Play status banner */}
        {isMatchPlay && matchPlayData && matchPlayData.played > 0 && (
          <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, textAlign: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <span style={{
              fontSize: 14, fontWeight: 900,
              color: matchPlayData.p1HolesUp === 0 ? 'var(--tm-text-2)' : matchPlayData.p1HolesUp > 0 ? '#4ADE80' : '#F87171',
            }}>
              {matchPlayData.p1HolesUp === 0
                ? 'ALL SQUARE'
                : matchPlayData.dormie
                ? `${matchPlayData.p1HolesUp > 0 ? sorted[0].name?.split(' ')[0] : sorted[1].name?.split(' ')[0]} DORMY ${Math.abs(matchPlayData.p1HolesUp)}`
                : `${matchPlayData.p1HolesUp > 0 ? sorted[0].name?.split(' ')[0] : sorted[1].name?.split(' ')[0]} ${Math.abs(matchPlayData.p1HolesUp)} UP`
              }
            </span>
            <span style={{ fontSize: 11, color: 'var(--tm-text-3)', marginLeft: 8 }}>
              THRU {matchPlayData.played}
            </span>
          </div>
        )}
      </div>

      {/* Scorecard */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {participants.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--tm-text-3)', fontSize: 14 }}>
            Waiting for players to join…
          </div>
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {/* ── Front 9 ── */}
            <ScorecardTable
              label="FRONT 9"
              holes={frontHoles}
              holePars={holePars}
              subtotalPar={frontPar}
              participants={sorted}
              getScores={getScores}
              isHost={isHost}
              userId={user?.id}
              isMarkerFor={isMarkerFor}
              playerTeam={playerTeam}
              onCellTap={(p, h) => setScoreModal({ userId: p.user_id, userName: p.name, hole: h })}
              matchPlayData={isMatchPlay ? matchPlayData : null}
              isP1={(p) => isMatchPlay && String(p.user_id) === String(sorted[0]?.user_id)}
              PLAYER_COL={PLAYER_COL}
              HOLE_COL={HOLE_COL}
              SUB_COL={SUB_COL}
            />
            {/* ── Back 9 (if 18 holes) ── */}
            {backHoles.length > 0 && (
              <ScorecardTable
                label="BACK 9"
                holes={backHoles}
                holePars={holePars}
                subtotalPar={backPar}
                participants={sorted}
                getScores={getScores}
                isHost={isHost}
                userId={user?.id}
                isMarkerFor={isMarkerFor}
                playerTeam={playerTeam}
                onCellTap={(p, h) => setScoreModal({ userId: p.user_id, userName: p.name, hole: h })}
                matchPlayData={isMatchPlay ? matchPlayData : null}
                isP1={(p) => isMatchPlay && String(p.user_id) === String(sorted[0]?.user_id)}
                PLAYER_COL={PLAYER_COL}
                HOLE_COL={HOLE_COL}
                SUB_COL={SUB_COL}
              />
            )}
            {/* ── Totals row ── */}
            <TotalsRow
              participants={sorted}
              holePars={holePars}
              holeCount={holeCount}
              coursePar={coursePar}
              getScores={getScores}
              diffStr={netMode ? netDiffStr : diffStr}
              diffColor={diffColor}
              playerTeam={playerTeam}
              netMode={netMode}
              netTotal={netTotal}
              isMatchPlay={isMatchPlay}
              matchPlayData={matchPlayData}
              isP1={(p) => isMatchPlay && String(p.user_id) === String(sorted[0]?.user_id)}
              PLAYER_COL={PLAYER_COL}
              HOLE_COL={HOLE_COL}
              SUB_COL={SUB_COL}
            />
          </div>
        )}
      </div>

      {/* Score entry modal */}
      {scoreModal && (() => {
        const p = participants.find(x => String(x.user_id) === String(scoreModal.userId))
        const sc = getScores(p || {})
        const current = sc[scoreModal.hole] || 0
        const par = holePars[scoreModal.hole] || 4
        return (
          <ScoreModal
            playerName={scoreModal.userName}
            hole={scoreModal.hole}
            par={par}
            currentScore={current}
            onSave={async val => {
              setScoreModal(null)
              await saveScore(scoreModal.hole, val, scoreModal.userId)
            }}
            onClose={() => setScoreModal(null)}
          />
        )
      })()}

      {/* Guest add modal */}
      {showGuestModal && (
        <GuestModal onAdd={addGuest} onClose={() => setShowGuestModal(false)} />
      )}

      {/* Team Setup sheet */}
      {showTeams && outing && (
        <TeamSetup
          outing={outing}
          onClose={() => setShowTeams(false)}
          onSaved={savedTeams => {
            setOuting(prev => ({ ...prev, state: { ...(prev.state || {}), teams: savedTeams } }))
            setShowTeams(false)
          }}
        />
      )}

      {/* Group / Marker Setup sheet */}
      {showGroups && outing && (
        <GroupSetup
          outing={outing}
          onClose={() => setShowGroups(false)}
          onSaved={savedMarkers => {
            setOuting(prev => ({ ...prev, state: { ...(prev.state || {}), markers: savedMarkers } }))
            setShowGroups(false)
          }}
        />
      )}
    </div>
  )
}

// ─── Scorecard table (front or back 9) ───────────────────────────────────────
function ScorecardTable({ label, holes, holePars, subtotalPar, participants, getScores, isHost, userId, isMarkerFor, playerTeam, onCellTap, matchPlayData, isP1, PLAYER_COL, HOLE_COL, SUB_COL }) {
  return (
    <div style={{ marginBottom: 0 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--tm-border)', background: 'var(--tm-surface)' }}>
        {/* Player name col */}
        <div style={{ minWidth: PLAYER_COL, width: PLAYER_COL, padding: '6px 8px', fontSize: 10, fontWeight: 700, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>
          {label}
        </div>
        {/* Hole numbers */}
        <div style={{ display: 'flex', gap: 2, padding: '6px 4px', overflowX: 'visible' }}>
          {holes.map(h => (
            <div key={h} style={{ minWidth: HOLE_COL, width: HOLE_COL, textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--tm-text-3)', flexShrink: 0 }}>
              {h + 1}
            </div>
          ))}
          <div style={{ minWidth: SUB_COL, width: SUB_COL, textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--tm-gold-text)', letterSpacing: 1, flexShrink: 0 }}>OUT</div>
        </div>
      </div>

      {/* Par row */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--tm-border)', background: 'var(--tm-surface-2)' }}>
        <div style={{ minWidth: PLAYER_COL, width: PLAYER_COL, padding: '4px 8px', fontSize: 10, fontWeight: 700, color: 'var(--tm-text-3)', flexShrink: 0 }}>
          Par
        </div>
        <div style={{ display: 'flex', gap: 2, padding: '4px 4px' }}>
          {holes.map(h => (
            <div key={h} style={{ minWidth: HOLE_COL, width: HOLE_COL, textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--tm-text-2)', flexShrink: 0 }}>
              {holePars[h]}
            </div>
          ))}
          <div style={{ minWidth: SUB_COL, width: SUB_COL, textAlign: 'center', fontSize: 12, fontWeight: 800, color: 'var(--tm-text-2)', flexShrink: 0 }}>{subtotalPar}</div>
        </div>
      </div>

      {/* Player rows */}
      {participants.map((p, idx) => {
        const sc       = getScores(p)
        const isMe     = String(p.user_id) === String(userId)
        const team     = playerTeam(p.user_id)
        // Host edits all; assigned marker edits their group; no one else can edit
        const canEdit  = isHost || (isMarkerFor ? isMarkerFor(String(userId), String(p.user_id)) : false)
        const subtotal = holes.reduce((sum, h) => sum + (sc[h] || 0), 0)
        const p1       = matchPlayData ? isP1?.(p) : false

        // Streak: last 3 played holes across all holes (not just this section)
        const allPlayedWithPar = sc.map((s, i) => s > 0 ? { s, par: holePars[i] } : null).filter(Boolean)
        const last3 = allPlayedWithPar.slice(-3)

        return (
          <div key={p.user_id} style={{
            display: 'flex', alignItems: 'center',
            borderBottom: '1px solid var(--tm-border)',
            background: isMe ? 'rgba(197,160,64,0.07)' : idx % 2 === 0 ? 'var(--tm-surface)' : 'var(--tm-surface-2)',
          }}>
            {/* Player name + streak dots */}
            <div style={{ minWidth: PLAYER_COL, width: PLAYER_COL, padding: '6px 8px', flexShrink: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: isMe ? 800 : 600, color: isMe ? 'var(--tm-gold-text)' : 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.name?.split(' ')[0] ?? p.name}
              </div>
              {team && (
                <div style={{ fontSize: 10, color: team.color, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {team.name}
                </div>
              )}
              {/* Streak dots */}
              {last3.length > 0 && (
                <div style={{ display: 'flex', gap: 2, marginTop: 3 }}>
                  {last3.map((x, i) => {
                    const d = x.s - x.par
                    const c = d <= -2 ? '#E8C05A' : d === -1 ? '#4ADE80' : d === 0 ? 'rgba(255,255,255,0.25)' : d === 1 ? '#F87171' : '#EF4444'
                    return <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
                  })}
                </div>
              )}
            </div>
            {/* Score cells */}
            <div style={{ display: 'flex', gap: 2, padding: '6px 4px' }}>
              {holes.map(h => {
                // Match play cell override
                let mpBg = undefined, mpBorder = undefined, mpColor = undefined
                if (matchPlayData) {
                  const res = matchPlayData.holeResults[h]
                  if (res !== null) {
                    const won = p1 ? res === 'p1' : res === 'p2'
                    const halved = res === 'half'
                    if (won) { mpBg = '#1e4a2a'; mpBorder = '1px solid #4ADE80'; mpColor = '#4ADE80' }
                    else if (!halved) { mpBg = '#4a1e1e'; mpBorder = '1px solid #F87171'; mpColor = '#F87171' }
                    else { mpBg = undefined; mpBorder = '1px solid rgba(255,255,255,0.15)'; mpColor = 'var(--tm-text-3)' }
                  }
                }
                return (
                  <ScorecardCell
                    key={h}
                    score={sc[h] || 0}
                    par={holePars[h]}
                    canEdit={canEdit}
                    onTap={() => onCellTap(p, h)}
                    isSubtotal={false}
                    overrideBg={mpBg}
                    overrideBorder={mpBorder}
                    overrideColor={mpColor}
                  />
                )
              })}
              {/* Subtotal */}
              <ScorecardCell score={subtotal || null} par={null} canEdit={false} isSubtotal={true} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Totals row ───────────────────────────────────────────────────────────────
function TotalsRow({ participants, holePars, holeCount, coursePar, getScores, diffStr, diffColor, playerTeam, netMode, netTotal, isMatchPlay, matchPlayData, isP1, PLAYER_COL, HOLE_COL, SUB_COL }) {
  return (
    <div style={{ background: 'var(--tm-surface)', borderTop: '2px solid var(--tm-border)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--tm-border)', background: 'var(--tm-surface-2)' }}>
        <div style={{ minWidth: PLAYER_COL, width: PLAYER_COL, padding: '6px 8px', fontSize: 10, fontWeight: 700, color: 'var(--tm-gold-text)', textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>
          TOTALS
        </div>
        <div style={{ display: 'flex', gap: 2, padding: '6px 4px' }}>
          <div style={{ minWidth: SUB_COL + 4, width: SUB_COL + 4, textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--tm-text-3)', letterSpacing: 1, flexShrink: 0 }}>
            {netMode ? 'NET' : isMatchPlay ? 'HOLES' : 'TOT'}
          </div>
          <div style={{ minWidth: SUB_COL + 4, width: SUB_COL + 4, textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--tm-text-3)', letterSpacing: 1, flexShrink: 0 }}>
            {isMatchPlay ? 'STATUS' : '+/−'}
          </div>
          <div style={{ minWidth: 48, textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--tm-text-3)', letterSpacing: 1, flexShrink: 0 }}>THRU</div>
        </div>
      </div>
      {participants.map((p, idx) => {
        const sc          = getScores(p)
        const team        = playerTeam(p.user_id)
        const gross       = sc.reduce((s, v) => s + (v || 0), 0)
        const displayTot  = netMode ? (netTotal?.(p) ?? gross) : gross
        const holesPlayed = sc.filter(v => v > 0).length
        const dStr        = diffStr(p)
        const dColor      = diffColor(p)

        // Match play status for this player
        let mpStatus = null
        if (isMatchPlay && matchPlayData) {
          const p1 = isP1?.(p)
          const up = p1 ? matchPlayData.p1HolesUp : -matchPlayData.p1HolesUp
          mpStatus = up === 0 ? 'AS' : up > 0 ? `${up} UP` : `${Math.abs(up)} DN`
        }
        const mpStatusColor = isMatchPlay && matchPlayData
          ? (isP1?.(p)
            ? (matchPlayData.p1HolesUp > 0 ? '#4ADE80' : matchPlayData.p1HolesUp < 0 ? '#F87171' : 'var(--tm-text-2)')
            : (matchPlayData.p1HolesUp < 0 ? '#4ADE80' : matchPlayData.p1HolesUp > 0 ? '#F87171' : 'var(--tm-text-2)'))
          : 'var(--tm-text-2)'

        // Match play holes won
        const mpHolesWon = isMatchPlay && matchPlayData
          ? matchPlayData.holeResults.filter(r => r !== null && (isP1?.(p) ? r === 'p1' : r === 'p2')).length
          : null

        return (
          <div key={p.user_id} style={{
            display: 'flex', alignItems: 'center',
            borderBottom: '1px solid var(--tm-border)',
            background: idx % 2 === 0 ? 'var(--tm-surface)' : 'var(--tm-surface-2)',
          }}>
            <div style={{ minWidth: PLAYER_COL, width: PLAYER_COL, padding: '10px 8px', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.name?.split(' ')[0] ?? p.name}
              </div>
              {team && <div style={{ fontSize: 10, color: team.color, fontWeight: 700 }}>{team.name}</div>}
              {netMode && p.handicap != null && !p.is_guest && (
                <div style={{ fontSize: 9, color: 'rgba(197,160,64,0.7)', fontWeight: 700 }}>HCP {p.handicap}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 2, padding: '10px 4px', alignItems: 'center' }}>
              <div style={{ minWidth: SUB_COL + 4, width: SUB_COL + 4, textAlign: 'center', fontSize: 18, fontWeight: 900, color: displayTot ? 'var(--tm-text)' : 'var(--tm-text-3)', flexShrink: 0 }}>
                {isMatchPlay ? (mpHolesWon ?? '—') : (displayTot || '—')}
              </div>
              <div style={{ minWidth: SUB_COL + 4, width: SUB_COL + 4, textAlign: 'center', fontSize: isMatchPlay ? 12 : 15, fontWeight: 800, color: isMatchPlay ? mpStatusColor : (holesPlayed ? dColor : 'var(--tm-text-3)'), flexShrink: 0 }}>
                {isMatchPlay ? (matchPlayData?.played > 0 ? mpStatus : '—') : (holesPlayed ? dStr : '—')}
              </div>
              <div style={{ minWidth: 48, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--tm-text-3)', flexShrink: 0 }}>
                {holesPlayed || '—'}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Team Setup Sheet ─────────────────────────────────────────────────────────
const TEAM_PALETTE = ['#4ADE80', '#E8C05A', '#60A5FA', '#F87171', '#A78BFA', '#FB923C', '#34D399', '#FBBF24']

// ─── Group / Marker Setup ─────────────────────────────────────────────────────
// Host divides players into groups of ≤4 and designates one marker per group.
// Marker can enter scores for everyone in their group.
function GroupSetup({ outing, onClose, onSaved }) {
  const participants = outing.state?.participants ?? []

  function defaultGroups() {
    const existing = outing.state?.markers ?? []
    if (existing.length > 0) {
      // Re-hydrate: build groups from stored markers
      return existing.map(m => ({
        marker_id: String(m.marker_id),
        member_ids: m.member_ids.map(String),
      }))
    }
    // Default: one group containing everyone, no marker assigned yet
    return [{ marker_id: null, member_ids: participants.map(p => String(p.user_id)) }]
  }

  const [groups, setGroups] = useState(defaultGroups)
  const [saving, setSaving] = useState(false)

  // All players not yet in any group
  const assigned = groups.flatMap(g => g.member_ids)
  const unassigned = participants.filter(p => !assigned.includes(String(p.user_id)))

  function addGroup() {
    setGroups(prev => [...prev, { marker_id: null, member_ids: [] }])
  }

  function removeGroup(gi) {
    setGroups(prev => {
      const members = prev[gi].member_ids
      // Return members to the first group
      const next = prev.filter((_, i) => i !== gi)
      if (next.length > 0) next[0].member_ids = [...next[0].member_ids, ...members]
      return next
    })
  }

  function moveToGroup(userId, targetGi) {
    setGroups(prev => prev.map((g, i) => ({
      ...g,
      marker_id: g.marker_id === userId && i !== targetGi ? null : g.marker_id,
      member_ids: i === targetGi
        ? [...g.member_ids.filter(id => id !== userId), userId]
        : g.member_ids.filter(id => id !== userId),
    })))
  }

  function setMarker(gi, userId) {
    setGroups(prev => prev.map((g, i) => ({
      ...g,
      marker_id: i === gi ? (g.marker_id === userId ? null : userId) : g.marker_id,
    })))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = groups
        .filter(g => g.marker_id && g.member_ids.length > 0)
        .map(g => ({ marker_id: g.marker_id, member_ids: g.member_ids }))
      await put(`/api/outings/${outing.code}/markers`, { markers: payload })
      onSaved(payload)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  const CHIP_COLORS = ['#4ADE80', '#93C5FD', '#F5D78A', '#F87171', '#C4B5FD', '#FD8A4B']

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid var(--tm-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--tm-text)' }}>Set Groups & Markers</div>
              <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginTop: 2 }}>
                One marker per group (up to 4) — they enter scores for everyone in their group
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 22, cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        {/* Groups */}
        <div className="page-scroll" style={{ padding: '16px 20px', gap: 14 }}>
          {groups.map((group, gi) => {
            const members = participants.filter(p => group.member_ids.includes(String(p.user_id)))
            const color = CHIP_COLORS[gi % CHIP_COLORS.length]
            return (
              <div key={gi} style={{ background: 'var(--tm-surface-2)', border: `1px solid ${color}33`, borderRadius: 16, padding: '14px 16px' }}>
                {/* Group header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color, letterSpacing: 1 }}>
                    GROUP {gi + 1}
                    {group.marker_id && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--tm-text-3)', marginLeft: 8 }}>
                        · {members.find(m => String(m.user_id) === String(group.marker_id))?.name?.split(' ')[0] ?? '?'} is marker
                      </span>
                    )}
                  </div>
                  {groups.length > 1 && (
                    <button onClick={() => removeGroup(gi)} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
                  )}
                </div>

                {/* Members */}
                {members.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontStyle: 'italic', marginBottom: 8 }}>No players yet</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                    {members.map(p => {
                      const isMarker = String(group.marker_id) === String(p.user_id)
                      return (
                        <div key={p.user_id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          background: isMarker ? `${color}18` : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${isMarker ? color + '55' : 'transparent'}`,
                          borderRadius: 10, padding: '8px 10px',
                        }}>
                          <div style={{ flex: 1, fontWeight: isMarker ? 700 : 500, fontSize: 13, color: isMarker ? color : 'var(--tm-text)' }}>
                            {p.name}
                            {isMarker && <span style={{ fontSize: 10, marginLeft: 6, color }}>✎ MARKER</span>}
                          </div>
                          {/* Tap to set/unset as marker */}
                          <button
                            onClick={() => setMarker(gi, String(p.user_id))}
                            style={{
                              fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12, cursor: 'pointer',
                              background: isMarker ? color + '33' : 'rgba(255,255,255,0.07)',
                              border: `1px solid ${isMarker ? color : 'rgba(255,255,255,0.12)'}`,
                              color: isMarker ? color : 'var(--tm-text-3)',
                            }}
                          >{isMarker ? 'Marker ✓' : 'Set Marker'}</button>
                          {/* Move to another group */}
                          {groups.length > 1 && groups.map((_, ti) => ti !== gi && (
                            <button key={ti}
                              onClick={() => moveToGroup(String(p.user_id), ti)}
                              style={{ fontSize: 10, padding: '3px 7px', borderRadius: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--tm-text-3)' }}
                            >→G{ti + 1}</button>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Members count warning */}
                {members.length > 4 && (
                  <div style={{ fontSize: 11, color: '#F87171', marginTop: 4 }}>⚠ Groups should have at most 4 players</div>
                )}
                {!group.marker_id && members.length > 0 && (
                  <div style={{ fontSize: 11, color: '#F5D78A', marginTop: 4 }}>Tap "Set Marker" on one player</div>
                )}
              </div>
            )
          })}

          {/* Unassigned players */}
          {unassigned.length > 0 && (
            <div style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 14, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#F87171', marginBottom: 8, letterSpacing: 1 }}>UNASSIGNED</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {unassigned.map(p => (
                  <div key={p.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, fontSize: 13, color: 'var(--tm-text-2)' }}>{p.name}</div>
                    {groups.map((_, gi) => (
                      <button key={gi}
                        onClick={() => moveToGroup(String(p.user_id), gi)}
                        style={{ fontSize: 10, padding: '3px 8px', borderRadius: 12, cursor: 'pointer', background: `${CHIP_COLORS[gi % CHIP_COLORS.length]}22`, border: `1px solid ${CHIP_COLORS[gi % CHIP_COLORS.length]}44`, color: CHIP_COLORS[gi % CHIP_COLORS.length] }}
                      >G{gi + 1}</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add group button */}
          {participants.length > 4 && (
            <button onClick={addGroup} style={{
              width: '100%', padding: '10px', borderRadius: 12, cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.15)',
              color: 'var(--tm-text-3)', fontWeight: 700, fontSize: 13,
            }}>+ Add Group</button>
          )}
        </div>

        {/* Save */}
        <div style={{ padding: '12px 20px calc(16px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--tm-border)', flexShrink: 0 }}>
          <button onClick={save} disabled={saving} style={{
            width: '100%', padding: '16px', borderRadius: 14, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
            color: '#fff', fontWeight: 800, fontSize: 16,
            opacity: saving ? 0.6 : 1,
          }}>{saving ? 'Saving…' : 'Save Groups'}</button>
        </div>
      </div>
    </div>
  )
}

function TeamSetup({ outing, onClose, onSaved }) {
  const participants = outing.state?.participants ?? []

  function defaultTeams() {
    if (outing.state?.teams?.length > 0) return JSON.parse(JSON.stringify(outing.state.teams))
    const big = outing.team_format === 'big_team'
    const base = [
      { id: '1', name: 'Team 1', color: TEAM_PALETTE[0], member_ids: [] },
      { id: '2', name: 'Team 2', color: TEAM_PALETTE[1], member_ids: [] },
    ]
    if (big) base.push({ id: '3', name: 'Team 3', color: TEAM_PALETTE[2], member_ids: [] })
    return base
  }

  const [teams, setTeams]           = useState(defaultTeams)
  const [saving, setSaving]         = useState(false)
  const [editingId, setEditingId]   = useState(null)

  const unassigned = participants.filter(p =>
    !teams.some(t => t.member_ids.map(String).includes(String(p.user_id)))
  )

  function assign(userId, teamId) {
    setTeams(prev => prev.map(t => ({
      ...t,
      member_ids: String(t.id) === String(teamId)
        ? [...t.member_ids.filter(id => String(id) !== String(userId)), userId]
        : t.member_ids.filter(id => String(id) !== String(userId)),
    })))
  }

  function unassign(userId) {
    setTeams(prev => prev.map(t => ({
      ...t, member_ids: t.member_ids.filter(id => String(id) !== String(userId)),
    })))
  }

  function rename(teamId, name) {
    setTeams(prev => prev.map(t => t.id === teamId ? { ...t, name } : t))
  }

  function addTeam() {
    const color = TEAM_PALETTE[teams.length % TEAM_PALETTE.length]
    setTeams(prev => [...prev, { id: String(Date.now()), name: `Team ${prev.length + 1}`, color, member_ids: [] }])
  }

  function removeTeam(teamId) {
    setTeams(prev => prev.filter(t => t.id !== teamId))
  }

  async function save() {
    setSaving(true)
    try {
      await put(`/api/outings/${outing.code}/teams`, { teams })
      onSaved(teams)
      onClose()
    } catch (e) { console.error(e) }
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #0D1F12, #070C09)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: '22px 22px 0 0', padding: '20px 20px 48px',
        maxHeight: '92dvh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', margin: '0 auto 20px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>Set Teams</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginBottom: 20 }}>
          Tap a player to assign them · tap their name again to move or remove
        </div>

        {/* Teams — each one its own card */}
        {teams.map((team) => {
          const members = team.member_ids
            .map(uid => participants.find(p => String(p.user_id) === String(uid)))
            .filter(Boolean)

          return (
            <div key={team.id} style={{
              marginBottom: 12, padding: '14px',
              background: team.color + '0D', border: `1px solid ${team.color}30`,
              borderRadius: 14,
            }}>
              {/* Team header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: team.color, flexShrink: 0 }} />
                  {editingId === team.id ? (
                    <input
                      autoFocus
                      value={team.name}
                      onChange={e => rename(team.id, e.target.value)}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                      style={{
                        background: 'transparent', border: 'none',
                        borderBottom: `1px solid ${team.color}`,
                        color: team.color, fontSize: 13, fontWeight: 700,
                        outline: 'none', width: 120,
                      }}
                    />
                  ) : (
                    <button onClick={() => setEditingId(team.id)} style={{
                      background: 'none', border: 'none', color: team.color,
                      fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0,
                    }}>
                      {team.name}
                      <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.5 }}>✎</span>
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{members.length} players</span>
                  {teams.length > 2 && (
                    <button onClick={() => removeTeam(team.id)} style={{
                      background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)',
                      fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1,
                    }}>✕</button>
                  )}
                </div>
              </div>

              {/* Assigned players chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 28 }}>
                {members.map(p => (
                  <div key={p.user_id} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: team.color + '1A', border: `1px solid ${team.color}44`,
                    borderRadius: 20, padding: '4px 8px 4px 12px',
                  }}>
                    <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>{p.name}</span>
                    <button onClick={() => unassign(p.user_id)} style={{
                      background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
                      cursor: 'pointer', padding: 0, fontSize: 15, lineHeight: 1,
                    }}>×</button>
                  </div>
                ))}
                {/* Quick-add unassigned players inline */}
                {unassigned.map(p => (
                  <button key={p.user_id} onClick={() => assign(p.user_id, team.id)} style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.15)',
                    borderRadius: 20, padding: '4px 10px',
                    color: 'rgba(255,255,255,0.35)', fontSize: 12, cursor: 'pointer',
                  }}>+ {p.name}</button>
                ))}
                {members.length === 0 && unassigned.length === 0 && (
                  <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, fontStyle: 'italic' }}>
                    All players assigned — remove someone to move them here
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {/* Add team */}
        {teams.length < 8 && (
          <button onClick={addTeam} style={{
            width: '100%', padding: '11px',
            background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.12)',
            borderRadius: 10, color: 'rgba(255,255,255,0.3)', fontSize: 13,
            cursor: 'pointer', marginBottom: 16,
          }}>+ Add Team</button>
        )}

        <button onClick={save} disabled={saving} style={{
          width: '100%', padding: '14px',
          background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
          color: '#070C09', border: 'none', borderRadius: 12,
          fontSize: 15, fontWeight: 800, cursor: saving ? 'default' : 'pointer',
        }}>{saving ? 'Saving…' : 'Save Teams'}</button>
      </div>
    </div>
  )
}

// ─── Share Code Button ────────────────────────────────────────────────────────
function ShareCodeButton({ code, name }) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const msg = `Join my golf match "${name}" on The Match!\n\nOpen the app → Match tab → "Enter a Code" → type: ${code}`
    if (navigator.share) {
      try { await navigator.share({ text: msg }) } catch {}
    } else {
      await navigator.clipboard.writeText(msg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  return (
    <button onClick={share} style={{
      width: '100%', padding: '14px', borderRadius: 14, cursor: 'pointer',
      background: 'rgba(232,192,90,0.12)',
      border: '1px solid rgba(232,192,90,0.4)',
      color: '#F5D78A', fontWeight: 800, fontSize: 15,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
      {copied ? 'Copied to clipboard!' : 'Share Code with Group'}
    </button>
  )
}

// ─── Code Share ───────────────────────────────────────────────────────────────
function CodeShare({ outing, onEnter }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '0 32px', gap: 20 }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(30,80,35,0.5) 0%, rgba(10,30,14,0.3) 100%)',
        border: '1px solid rgba(94,212,122,0.25)',
        boxShadow: '0 0 32px rgba(94,212,122,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#5ED47A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
          <line x1="4" y1="22" x2="4" y2="15"/>
        </svg>
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, color: '#fff', textAlign: 'center' }}>{outing.name}</div>
      <div style={{ fontSize: 14, color: 'var(--tm-text-3)', textAlign: 'center' }}>{outing.course_name}</div>
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(232,192,90,0.35)',
        borderRadius: 20, padding: '24px 40px', textAlign: 'center',
        boxShadow: '0 0 40px rgba(232,192,90,0.08), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}>
        <div style={{ fontSize: 11, color: 'rgba(232,192,90,0.7)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Join Code</div>
        <div style={{
          fontSize: 54, fontWeight: 900, letterSpacing: 10,
          background: 'linear-gradient(135deg, #F5D78A, #E8C05A)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 0 8px rgba(232,192,90,0.3))',
        }}>{outing.code}</div>
      </div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>
        Share this code with your group — they open The Match app, tap the Match tab, and hit "Enter a Code"
      </div>
      {/* Share button */}
      <ShareCodeButton code={outing.code} name={outing.name} />
      <button onClick={onEnter}
        style={{
          width: '100%', padding: '16px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
          color: '#fff', fontWeight: 800, fontSize: 16,
          boxShadow: '0 4px 20px rgba(46,158,69,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
        }}>
        Enter Scorecard →
      </button>
    </div>
  )
}

// ─── Main Outing Component ────────────────────────────────────────────────────
export default function Outing({ user, pendingPlayers = [], onClearPending }) {
  const [view, setView]           = useState('hub')   // 'hub' | 'live' | 'code-share' | 'end' | 'rivalry'
  const [showJoin, setShowJoin]   = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [activeCode, setActiveCode] = useState(null)
  const [freshOuting, setFreshOuting] = useState(null)
  const [endSummary, setEndSummary]   = useState(null)
  const [activeRivalry, setActiveRivalry] = useState(null)

  // Auto-open CreateWizard when navigated here with pre-filled players
  useEffect(() => {
    if (pendingPlayers.length > 0) setShowCreate(true)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  if (view === 'live' && activeCode) return (
    <LiveOuting
      code={activeCode}
      user={user}
      onBack={() => setView('hub')}
      onMatchEnd={summary => { setEndSummary(summary); setView('end') }}
    />
  )
  if (view === 'end' && endSummary) return (
    <EndMatchScreen
      summary={endSummary}
      onDone={() => { setEndSummary(null); setView('hub') }}
    />
  )
  if (view === 'code-share' && freshOuting) return (
    <CodeShare
      outing={freshOuting}
      onEnter={() => { setActiveCode(freshOuting.code); setView('live') }}
    />
  )
  if (view === 'rivalry' && activeRivalry) return (
    <RivalryDetail
      rivalry={activeRivalry}
      userId={user?.id}
      onBack={() => { setActiveRivalry(null); setView('hub') }}
    />
  )

  return (
    <>
      <OutingHub
        user={user}
        onJoin={() => setShowJoin(true)}
        onCreate={() => setShowCreate(true)}
        onOpenOuting={code => { setActiveCode(code); setView('live') }}
        onOpenRivalry={r => { setActiveRivalry(r); setView('rivalry') }}
      />
      {showJoin && (
        <JoinSheet
          onClose={() => setShowJoin(false)}
          onJoined={o => { setShowJoin(false); setActiveCode(o.code); setView('live') }}
        />
      )}
      {showCreate && (
        <CreateWizard
          user={user}
          pendingPlayers={pendingPlayers}
          onClose={() => { setShowCreate(false); onClearPending?.() }}
          onCreated={o => {
            setShowCreate(false)
            setFreshOuting(o)
            setView('code-share')
            onClearPending?.()
          }}
        />
      )}
    </>
  )
}
