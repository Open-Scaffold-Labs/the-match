import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api, post, put } from '../lib/api.js'
import { warn } from '../lib/logger.js'
import ActiveRound from './ActiveRound.jsx'
// Standalone AugustaBoard route was removed 2026-04-30 (Path A) — every
// match now renders the Augusta scorecard directly via LiveOuting.

// ─── Augusta theme palette ───────────────────────────────────────────────────
// Tournament-board look (revised 2026-04-30 PM after the teal misread):
// deep forest-green panels with white block-letter text, gold PAR numerals,
// cream score tiles slotted into the board, dark wood frame.
const AUGUSTA_GREEN       = '#0F3D1E'   // outer wood frame + footer plaque
const AUGUSTA_GREEN_DEEP  = '#0a2c14'   // deepest shadow line
const AUGUSTA_PANEL       = '#1A5230'   // main board panel (was teal)
const AUGUSTA_PANEL_HI    = '#235C36'   // subtle light-from-above gradient top
const AUGUSTA_PANEL_HOVER = '#2A6B40'   // current-user row tint (slightly lighter green)
const AUGUSTA_GOLD        = '#E8C05A'   // PAR numerals + leader accents
const AUGUSTA_GOLD_DIM    = '#A8862E'   // pinstripe / dimmed gold
const AUGUSTA_CREAM       = '#EAE0BF'   // LEADERS banner cream
const AUGUSTA_TILE        = '#F2EBD3'   // score tile (warmer cream)
const AUGUSTA_RED         = '#B22222'   // under-par red
const AUGUSTA_INK         = '#0F0F0F'   // over-par numerals on cream tiles
const AUGUSTA_WOOD        = '#5a3a16'   // hand-painted wood frame edge

// Backwards-compat aliases — older code still referenced these names
const AUGUSTA_TEAL        = AUGUSTA_PANEL
const AUGUSTA_TEAL_HOVER  = AUGUSTA_PANEL_HOVER

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

// Deterministic avatar ring color from name — used for initials fallback.
// Same palette as the standalone AugustaBoard, colors that read on cream/teal.
function avatarBg(name = '') {
  const palette = ['#1B5E20', '#0D47A1', '#6A1B9A', '#B71C1C', '#006064', '#E65100', '#33691E', '#4527A0']
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return palette[h % palette.length]
}

// PlayerAvatar — renders the user's profile photo if uploaded, otherwise
// a colored initials circle. Used in the scorecard player rows.
function PlayerAvatar({ name = '', avatar = null, size = 30, ringColor = AUGUSTA_GREEN }) {
  const initialsStr = initials(name) || '·'
  const baseStyle = {
    width: size, height: size, borderRadius: '50%',
    flexShrink: 0,
    border: `2px solid ${ringColor}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
    overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: avatarBg(name),
    color: '#fff',
    fontFamily: '"Arial Black", Arial, sans-serif',
    fontSize: Math.round(size * 0.36), fontWeight: 900,
    letterSpacing: 0,
  }
  if (avatar) {
    return (
      <div style={{ ...baseStyle, background: AUGUSTA_TILE }}>
        <img
          src={avatar} alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    )
  }
  return <div style={baseStyle}>{initialsStr}</div>
}
function wlLabel(w, l, t) {
  if (!w && !l && !t) return '—'
  return `${w}-${l}${t ? `-${t}` : ''}`
}

// Score-vs-par label used by the recent-event banner. Returns "EAGLE",
// "BIRDIE", "PAR", "BOGEY", "DOUBLE BOGEY", or "+N". (2026-04-30 PM round 10)
function scoreLabel(score, par) {
  const d = score - par
  if (d <= -3) return 'ALBATROSS'
  if (d === -2) return 'EAGLE'
  if (d === -1) return 'BIRDIE'
  if (d === 0)  return 'PAR'
  if (d === 1)  return 'BOGEY'
  if (d === 2)  return 'DOUBLE'
  if (d === 3)  return 'TRIPLE'
  return `+${d}`
}

// "Today" / "Yesterday" / "Mar 12" — used by Recent Matches cards
function relDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const ymd = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const diffMs = now - d
  if (ymd(d) === ymd(now)) return 'Today'
  const yest = new Date(now); yest.setDate(yest.getDate() - 1)
  if (ymd(d) === ymd(yest)) return 'Yesterday'
  if (diffMs < 7 * 24 * 60 * 60 * 1000) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Render a list of opponent names compactly: "Dale", "Dale + 2", or "—"
function fmtOpponents(names) {
  const n = (names || []).filter(Boolean)
  if (n.length === 0) return null
  const first = n[0].split(' ')[0]
  if (n.length === 1) return first
  if (n.length === 2) return `${first} & ${n[1].split(' ')[0]}`
  return `${first} +${n.length - 1}`
}

// Tap-to-copy a join code, with brief visual confirmation handled by the caller
async function copyCode(code) {
  if (!code) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code)
      return true
    }
  } catch { /* fall through */ }
  // Fallback for older browsers / iOS PWA when clipboard API blocked
  try {
    const ta = document.createElement('textarea')
    ta.value = code
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch { return false }
}

// ─── Outing Hub (main landing) ────────────────────────────────────────────────
//
// Match-tab redesign (2026-04-30) — content density first.
// Architecture:
//   1. Live Now strip   (only when ≥1 match has status === 'active')
//   2. Primary CTAs     (Create + Enter a Code)
//   3. Secondary icons  (Solo Round + Leaderboard, demoted to thin row)
//   4. Rivalries        (with search bar at ≥5; 1-line nudge when empty)
//   5. Recent Matches   (only finished matches — LIVE ones promoted to strip)
function OutingHub({ user, onJoin, onCreate, onOpenOuting, onOpenRivalry, onSoloRound }) {
  const [rivalries, setRivalries] = useState([])
  const [recentOutings, setRecentOutings] = useState([])
  const [loading, setLoading] = useState(true)
  const [rivalrySearch, setRivalrySearch] = useState('')
  const [copiedCode, setCopiedCode] = useState(null)

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

  // Split LIVE matches out of Recent — they get promoted to the Live Now strip
  const liveMatches     = recentOutings.filter(o => o.status === 'active')
  const finishedMatches = recentOutings.filter(o => o.status !== 'active')

  // Cap visible LIVE cards so a stale-data tail doesn't dominate the screen.
  // Anything beyond the cap is reachable via a "+N more" expand link.
  const MAX_LIVE = 3
  const [liveExpanded, setLiveExpanded] = useState(false)
  const visibleLive = liveExpanded ? liveMatches : liveMatches.slice(0, MAX_LIVE)
  const hiddenLive  = liveMatches.length - visibleLive.length

  // Filter rivalries by search input (only relevant once user has 5+)
  const filteredRivalries = rivalrySearch.trim()
    ? rivalries.filter(r => (r.opponent_name || '').toLowerCase().includes(rivalrySearch.toLowerCase()))
    : rivalries

  const onCopyCode = async (code, e) => {
    e?.stopPropagation()
    const ok = await copyCode(code)
    if (ok) {
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 1400)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
        <div style={{
          fontSize: 28, fontWeight: 900, letterSpacing: '-1px',
          background: 'linear-gradient(135deg, #F5D78A, #E8C05A)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: 2,
        }}>Matches</div>
        <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.55)', textShadow: '0 1px 2px rgba(255,255,255,0.6)' }}>
          {liveMatches.length > 0
            ? `You have ${liveMatches.length} match${liveMatches.length > 1 ? 'es' : ''} in progress.`
            : 'Create or join — your rivalries live here.'}
        </div>
      </div>

      <div className="page-scroll" style={{
        padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {/* ─── Live Now strip ─────────────────────────────────────────── */}
        {liveMatches.length > 0 && (
          <div>
            <div style={{
              fontSize: 12, fontWeight: 800, color: '#1A6B28',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10,
              background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              textShadow: '0 1px 1px rgba(255,255,255,0.4)',
            }}>
              <span className="tm-live-pulse" style={{
                width: 8, height: 8, borderRadius: '50%', background: '#2E9E45',
              }} />
              Live Now
            </div>
            {visibleLive.map(o => (
              <LiveMatchCard
                key={o.id} o={o}
                onResume={() => onOpenOuting(o.code)}
                onCopyCode={(e) => onCopyCode(o.code, e)}
                copied={copiedCode === o.code}
              />
            ))}
            {hiddenLive > 0 && (
              <button
                onClick={() => setLiveExpanded(true)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 10, marginBottom: 4,
                  background: 'rgba(255,255,255,0.55)',
                  border: '1px dashed rgba(46,158,69,0.35)',
                  color: '#1A6B28', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer',
                }}>
                + {hiddenLive} more in progress
              </button>
            )}
            {liveExpanded && liveMatches.length > MAX_LIVE && (
              <button
                onClick={() => setLiveExpanded(false)}
                style={{
                  width: '100%', padding: '6px 12px', borderRadius: 10,
                  background: 'transparent', border: 'none',
                  color: 'rgba(13,31,18,0.55)', fontSize: 11, fontWeight: 700,
                  cursor: 'pointer',
                }}>
                Show less
              </button>
            )}
          </div>
        )}

        {/* ─── Primary CTAs ──────────────────────────────────────────── */}
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
              background: 'rgba(255,255,255,0.85)',
              border: '1.5px solid rgba(46,158,69,0.55)',
              color: '#1A6B28', fontWeight: 800, fontSize: 15,
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(0,0,0,0.10)',
            }}>
            Enter a Code
          </button>
        </div>

        {/* Solo Round — secondary action under primary CTAs.
            Augusta Scoreboard hero card removed: the board IS the scorecard
            for every match now, no separate standalone access. (2026-04-30 Path A) */}
        <button onClick={onSoloRound} style={{
          width: '100%', padding: '11px 14px', borderRadius: 12,
          background: 'rgba(255,255,255,0.75)',
          border: '1px solid rgba(201,160,64,0.35)',
          color: '#7A5800', fontWeight: 700, fontSize: 13,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7A5800" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          Solo Round (just keep score)
        </button>

        {/* ─── Rivalries ─────────────────────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{
              fontSize: 12, fontWeight: 800, color: '#1B5E3B',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
              display: 'inline-block', textShadow: '0 1px 1px rgba(255,255,255,0.4)',
            }}>Your Rivalries</div>
            {rivalries.length >= 5 && (
              <div style={{
                background: 'rgba(255,255,255,0.75)',
                border: '1px solid rgba(27,94,59,0.15)',
                borderRadius: 10, padding: '4px 10px',
                display: 'flex', alignItems: 'center', gap: 6, flex: '0 1 200px',
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(13,31,18,0.40)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  value={rivalrySearch} onChange={e => setRivalrySearch(e.target.value)}
                  placeholder="Search…"
                  style={{
                    flex: 1, border: 'none', background: 'transparent', outline: 'none',
                    fontSize: 12, color: '#0D1F12', minWidth: 0,
                  }}
                />
              </div>
            )}
          </div>
          {loading
            ? <div style={{ color: 'var(--tm-text-3)', textAlign: 'center', padding: '20px 0', fontSize: 14 }}>Loading…</div>
            : rivalries.length === 0
            ? <EmptyRivalries />
            : filteredRivalries.length === 0
            ? <div style={{ color: 'rgba(13,31,18,0.55)', fontSize: 13, padding: '14px 4px' }}>No rivalries match "{rivalrySearch}".</div>
            : filteredRivalries.map(r => <RivalryCard key={r.opponent_id} r={r} userId={user.id} onOpen={() => onOpenRivalry?.(r)} />)
          }
        </div>

        {/* ─── Recent Matches (finished only — LIVE ones live in strip above) ─ */}
        {finishedMatches.length > 0 && (
          <div>
            <div style={{
              fontSize: 12, fontWeight: 800, color: '#1B5E3B',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10,
              background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
              display: 'inline-block', textShadow: '0 1px 1px rgba(255,255,255,0.4)',
            }}>Recent Matches</div>
            {finishedMatches.map(o => (
              <RecentMatchCard
                key={o.id} o={o} userId={user.id}
                onOpen={() => onOpenOuting(o.code)}
                onCopyCode={(e) => onCopyCode(o.code, e)}
                copied={copiedCode === o.code}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Live Match Card (top-of-page strip) ─────────────────────────────────────
// Big tappable card for in-progress matches. Pulsing dot, prominent
// "Resume →" label, opponent line, course line, copy-code chip.
function LiveMatchCard({ o, onResume, onCopyCode, copied }) {
  const opp = fmtOpponents(o.opponent_names)
  // When no opponents have joined yet, the auto-generated match name like
  // "Matt Lavin's Match" reads better as the title with "Waiting for players"
  // than the awkward "You vs Matt Lavin's Match".
  const title = opp ? `You vs ${opp}` : (o.name || 'New match')
  const subtitle = opp ? null : 'Waiting for players'
  return (
    <div onClick={onResume} style={{
      cursor: 'pointer',
      background: 'linear-gradient(135deg, rgba(46,158,69,0.18), rgba(255,255,255,0.85))',
      border: '1.5px solid rgba(46,158,69,0.45)',
      borderRadius: 16, padding: '14px 16px',
      marginBottom: 8,
      boxShadow: '0 4px 20px rgba(46,158,69,0.18), inset 0 1px 0 rgba(255,255,255,0.5)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span className="tm-live-pulse" style={{
            width: 8, height: 8, borderRadius: '50%', background: '#2E9E45',
            boxShadow: '0 0 6px rgba(46,158,69,0.6)',
          }} />
          <span style={{ fontSize: 11, fontWeight: 800, color: '#1A6B28', letterSpacing: 1.2, textTransform: 'uppercase' }}>Live</span>
          <span style={{ fontSize: 11, color: 'rgba(13,31,18,0.50)' }}>· {o.player_count}p</span>
        </div>
        <div style={{ fontWeight: 800, color: '#0D1F12', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.55)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {subtitle && (
            <span style={{ color: '#7A5800', fontWeight: 700 }}>{subtitle}</span>
          )}
          {o.course_name && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(13,31,18,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              {o.course_name}
            </span>
          )}
          <button onClick={onCopyCode} style={{
            border: 'none', cursor: 'pointer',
            background: copied ? 'rgba(46,158,69,0.20)' : 'rgba(122,88,0,0.10)',
            color: copied ? '#1A6B28' : '#7A5800',
            fontWeight: 800, fontSize: 11, letterSpacing: 2,
            padding: '2px 8px', borderRadius: 6,
            transition: 'background 200ms',
          }}>
            {copied ? '✓ Copied' : o.code}
          </button>
        </div>
      </div>
      <div style={{ color: '#1A6B28', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
        Resume →
      </div>
    </div>
  )
}

// ─── Recent (finished) Match Card ────────────────────────────────────────────
function RecentMatchCard({ o, userId, onOpen, onCopyCode, copied }) {
  const opp = fmtOpponents(o.opponent_names)
  const title = opp ? `You vs ${opp}` : (o.name || 'Solo round')
  const date = relDate(o.updated_at || o.created_at)
  return (
    <button onClick={onOpen} style={{
      width: '100%', textAlign: 'left', cursor: 'pointer',
      background: 'rgba(255,255,255,0.85)',
      border: '1px solid rgba(27,94,59,0.10)',
      borderRadius: 14, padding: '14px 16px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 8,
      boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: '#0D1F12', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.55)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {o.course_name && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(13,31,18,0.45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
              {o.course_name}
            </span>
          )}
          {date && <span>{date}</span>}
          <button onClick={onCopyCode} style={{
            border: 'none', cursor: 'pointer',
            background: copied ? 'rgba(46,158,69,0.20)' : 'transparent',
            color: copied ? '#1A6B28' : '#7A5800',
            fontWeight: 800, fontSize: 11, letterSpacing: 2,
            padding: '2px 6px', borderRadius: 5,
            transition: 'background 200ms',
          }}>
            {copied ? '✓' : o.code}
          </button>
        </div>
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 20,
        background: 'rgba(13,31,18,0.06)',
        color: 'rgba(13,31,18,0.55)',
        border: '1px solid rgba(13,31,18,0.12)',
        flexShrink: 0,
      }}>
        Final
      </div>
    </button>
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

  // Light theme colors for win/loss/tie indicators
  const upColor   = '#1A6B28'   // dark green
  const downColor = '#A04020'   // muted red-orange (bogey)
  const evenColor = 'rgba(13,31,18,0.55)'
  const lightLeadColor = lead === 'up' ? upColor : lead === 'down' ? downColor : evenColor

  return (
    <div onClick={onOpen} style={{
      borderRadius: 18,
      background: 'rgba(255,255,255,0.85)',
      border: '1px solid rgba(27,94,59,0.10)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      padding: '16px', marginBottom: 10, cursor: onOpen ? 'pointer' : 'default',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(46,158,69,0.18), rgba(27,94,59,0.10))',
            border: '1.5px solid rgba(46,158,69,0.45)',
            boxShadow: '0 1px 4px rgba(27,94,59,0.10)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: '#1A6B28',
          }}>
            {initials(r.opponent_name)}
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#0D1F12', fontSize: 15 }}>{r.opponent_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.55)', marginTop: 1 }}>{total} match{total !== 1 ? 'es' : ''}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: lightLeadColor }}>{wlLabel(myWins, oppWins, ties)}</div>
          <div style={{ fontSize: 11, color: lightLeadColor, fontWeight: 700, marginTop: 1 }}>
            {lead === 'up' ? `+${myWins - oppWins} up` : lead === 'down' ? `${myWins - oppWins} down` : 'EVEN'}
          </div>
        </div>
      </div>
      {/* Win bar */}
      {total > 0 && (
        <>
          <div style={{ marginTop: 14, height: 5, borderRadius: 99, background: 'rgba(27,94,59,0.08)', overflow: 'hidden', display: 'flex', gap: 1 }}>
            <div style={{ width: `${(myWins/total)*100}%`, background: 'linear-gradient(90deg, #1B5E3B, #2E9E45)', borderRadius: '99px 0 0 99px', transition: 'width 400ms ease' }} />
            {ties > 0 && <div style={{ width: `${(ties/total)*100}%`, background: 'rgba(80,120,200,0.55)' }} />}
            <div style={{ flex: 1, background: 'rgba(180,80,40,0.5)', borderRadius: '0 99px 99px 0' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 11, color: '#1A6B28', fontWeight: 700 }}>You {myWins}W</span>
            {ties > 0 && <span style={{ fontSize: 11, color: 'rgba(50,80,160,0.85)', fontWeight: 700 }}>{ties}T</span>}
            <span style={{ fontSize: 11, color: '#A04020', fontWeight: 700 }}>{oppWins}W {r.opponent_name?.split(' ')[0]}</span>
          </div>
        </>
      )}
    </div>
  )
}

// One-line nudge — much lighter than the original full empty card. Frees up
// the ~200px below the fold for actual Recent Matches content. (2026-04-30)
function EmptyRivalries() {
  return (
    <div style={{
      borderRadius: 12,
      background: 'rgba(255,255,255,0.55)',
      border: '1px dashed rgba(27,94,59,0.25)',
      padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1B5E3B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
      <div style={{ color: 'rgba(13,31,18,0.70)', fontSize: 12, lineHeight: 1.4 }}>
        Finish a match to start tracking your head-to-head record.
      </div>
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
  const lColor  = lead === 'up' ? '#C9A040' : lead === 'down' ? '#F87171' : 'rgba(255,255,255,0.5)'

  // Form guide: last 5 results
  const recent = (matches || []).slice(0, 5)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent' }}>
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
              <div style={{ width: `${(myWins/total)*100}%`, background: 'linear-gradient(90deg, #2A7A38, #C9A040)', borderRadius: '99px 0 0 99px', transition: 'width 400ms ease' }} />
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
                  background: m.is_tie ? 'rgba(138,180,248,0.2)' : won ? 'rgba(201,160,64,0.2)' : 'rgba(248,113,113,0.2)',
                  border: m.is_tie ? '1px solid rgba(138,180,248,0.4)' : won ? '1px solid rgba(201,160,64,0.4)' : '1px solid rgba(248,113,113,0.4)',
                  color: m.is_tie ? '#93C5FD' : won ? '#C9A040' : '#F87171',
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
                      background: m.is_tie ? 'rgba(138,180,248,0.12)' : won ? 'rgba(201,160,64,0.12)' : 'rgba(248,113,113,0.12)',
                      border: m.is_tie ? '1px solid rgba(138,180,248,0.3)' : won ? '1px solid rgba(201,160,64,0.3)' : '1px solid rgba(248,113,113,0.3)',
                      color: m.is_tie ? '#93C5FD' : won ? '#C9A040' : '#F87171',
                    }}>{m.is_tie ? 'TIE' : won ? 'WIN' : 'LOSS'}</div>
                    <div style={{ fontSize: 12, color: 'var(--tm-text-3)' }}>
                      {m.my_score} – {m.opp_score}
                      {!m.is_tie && <span style={{ color: won ? '#C9A040' : '#F87171', fontWeight: 700, marginLeft: 4 }}>({diff > 0 ? '+' : ''}{diff})</span>}
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent', overflowY: 'auto' }}>
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
                <span style={{ marginLeft: 8, fontWeight: 800, color: winner.diff < 0 ? '#C9A040' : winner.diff > 0 ? '#F87171' : 'var(--tm-text-2)' }}>
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
          const diffC = p.diff < 0 ? '#C9A040' : p.diff > 0 ? '#F87171' : 'var(--tm-text-2)'
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
                  {p.birdies > 0 && <span style={{ color: '#C9A040', marginRight: 8 }}>{p.birdies} birdie{p.birdies !== 1 ? 's' : ''}</span>}
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
                <span style={{ fontSize: 13, fontWeight: 700, color: '#C9A040' }}>{highlights.most_birdies.name} × {highlights.most_birdies.count}</span>
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

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', padding: '24px 20px' }}>
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
    </div>,
    document.body
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

// CoursePicker — search-as-you-type for real courses (GolfCourseAPI via
// /api/courses/search). When the host picks a course, it loads the full
// course detail and lets them choose a tee; the resulting hole_pars[] flows
// up to the wizard via onPick. Includes a "type your own" fallback for
// courses that aren't in the API. (2026-04-30)
function CoursePicker({ value, onPick, onClear, onTypedName }) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [coords, setCoords]     = useState(null)   // { lat, lng } once geolocation resolves
  const [openCourse, setOpenCourse] = useState(null) // { id, club_name, course_name, tees: { male, female } }
  const [loadingCourse, setLoadingCourse] = useState(false)

  // Request geolocation once; gracefully no-op if denied
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* user denied or unavailable — search still works */ },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60 * 1000 }
    )
  }, [])

  // Debounced search after 2+ chars
  useEffect(() => {
    if (openCourse) return    // don't keep searching while picking a tee
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q })
        if (coords) {
          params.set('lat', String(coords.lat))
          params.set('lng', String(coords.lng))
        }
        const res = await api(`/api/courses/search?${params.toString()}`)
        setResults(Array.isArray(res?.courses) ? res.courses : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, coords, openCourse])

  async function selectCourse(c) {
    setLoadingCourse(true)
    try {
      const detail = await api(`/api/courses/${c.id}`)
      setOpenCourse(detail)
    } catch {
      setOpenCourse(null)
    } finally {
      setLoadingCourse(false)
    }
  }

  function selectTee(tee) {
    if (!openCourse) return
    const holes = (tee.holes || []).map(h => h.par)
    onPick({
      courseId:    openCourse.id,
      courseName:  openCourse.club_name || openCourse.course_name,
      courseTee:   tee.tee_name,
      holePars:    holes,
      holeYardages: (tee.holes || []).map(h => h.yardage),
      holeHandicaps:(tee.holes || []).map(h => h.handicap),
      coursePar:   tee.par_total,
    })
    setQuery('')
    setResults([])
    setOpenCourse(null)
  }

  // ─── Selected state — show the chosen course + tee compactly ─────────
  if (value?.courseId && value?.holePars) {
    return (
      <div style={{
        background: 'var(--tm-green-muted)',
        border: '1px solid rgba(46,158,69,0.40)',
        borderRadius: 'var(--tm-radius)',
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--tm-green-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ✓ {value.courseName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--tm-text-2)', marginTop: 2 }}>
            {value.courseTee} tees · Par {value.coursePar} · {value.holePars.length} holes
          </div>
        </div>
        <button onClick={onClear} style={{
          background: 'rgba(255,255,255,0.6)', border: '1px solid var(--tm-border)',
          borderRadius: 8, padding: '6px 10px',
          color: 'var(--tm-text-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          flexShrink: 0,
        }}>Change</button>
      </div>
    )
  }

  // ─── Tee selection ───────────────────────────────────────────────────
  if (openCourse) {
    const allTees = [...(openCourse.tees?.male || []), ...(openCourse.tees?.female || [])]
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--tm-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {openCourse.club_name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--tm-text-3)' }}>Choose a tee</div>
          </div>
          <button onClick={() => setOpenCourse(null)} style={{
            background: 'none', border: 'none', color: 'var(--tm-text-3)',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>← Back</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
          {allTees.length === 0 && (
            <div style={{ color: 'var(--tm-text-3)', fontSize: 13, padding: 10 }}>
              No tee data — try another course or type the name manually.
            </div>
          )}
          {allTees.map((t, i) => (
            <button key={`${t.tee_name}-${i}`} onClick={() => selectTee(t)} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px', borderRadius: 'var(--tm-radius)',
              border: '1px solid var(--tm-border)', background: 'var(--tm-surface-2)',
              cursor: 'pointer', textAlign: 'left',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 13 }}>{t.tee_name}</div>
                <div style={{ fontSize: 11, color: 'var(--tm-text-3)' }}>
                  Par {t.par_total} · {t.total_yards} yds
                  {t.course_rating ? ` · ${t.course_rating}/${t.slope_rating}` : ''}
                </div>
              </div>
              <span style={{ color: 'var(--tm-green-text)', fontWeight: 800, fontSize: 13 }}>Pick →</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ─── Search state ────────────────────────────────────────────────────
  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={e => { setQuery(e.target.value); onTypedName?.(e.target.value) }}
        placeholder={coords ? 'Type a course (closest first)' : 'Type a course'}
        style={{
          width: '100%', background: 'var(--tm-surface-2)',
          border: '1px solid var(--tm-border-2)', borderRadius: 'var(--tm-radius)',
          color: 'var(--tm-text)', fontSize: 16, padding: '12px 14px',
          outline: 'none', boxSizing: 'border-box',
        }}
      />
      {(searching || loadingCourse || results.length > 0) && (
        <div style={{
          marginTop: 8, maxHeight: 220, overflowY: 'auto',
          border: '1px solid var(--tm-border)', borderRadius: 'var(--tm-radius)',
          background: 'var(--tm-surface-2)',
        }}>
          {(searching || loadingCourse) && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--tm-text-3)' }}>
              {loadingCourse ? 'Loading course…' : 'Searching…'}
            </div>
          )}
          {results.map(c => (
            <button key={c.id} onClick={() => selectCourse(c)} style={{
              width: '100%', textAlign: 'left', cursor: 'pointer',
              padding: '10px 14px', border: 'none', background: 'transparent',
              borderBottom: '1px solid var(--tm-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.club_name || c.course_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--tm-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[c.city, c.state, c.country].filter(Boolean).join(', ')}
                </div>
              </div>
              {c.distance_km != null && (
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-green-text)', flexShrink: 0 }}>
                  {c.distance_km < 1 ? `${Math.round(c.distance_km * 1000)}m` :
                    c.distance_km < 100 ? `${c.distance_km.toFixed(1)}km` :
                    `${Math.round(c.distance_km)}km`}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 8 }}>
        Can't find it? Just leave the name typed — we'll use your course name without the per-hole pars.
      </div>
    </div>
  )
}

function CreateWizard({ user, onClose, onCreated, pendingPlayers = [] }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    name: '',
    courseName: '',
    format: 'stroke',
    team: 'individual',
    holes: 18,
    // Real course data captured by the picker; null when host opts out
    courseId: null,
    courseTee: null,
    holePars: null,
    holeYardages: null,
    holeHandicaps: null,
    coursePar: null,    // computed from picked tee's par_total when set
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleCreate() {
    setLoading(true); setError('')
    try {
      // If user picked a real course, slice hole_pars to the chosen hole count;
      // if they only typed a name (or skipped), fall back to the legacy default.
      const slice = (arr) => Array.isArray(arr) ? arr.slice(0, form.holes) : null
      const slicedPars     = slice(form.holePars)
      const computedPar    = slicedPars ? slicedPars.reduce((a, b) => a + (b || 0), 0) : null

      const data = await post('/api/outings', {
        name: form.name || `${user.name}'s Match`,
        courseName: form.courseName || 'TBD',
        scoringFormats: [form.format],
        teamFormat: form.team,
        coursePar: computedPar || form.coursePar || (form.holes === 9 ? 36 : 72),
        // Real per-hole data — server stores nulls when not provided
        courseId:      form.courseId,
        courseTee:     form.courseTee,
        holePars:      slicedPars,
        holeYardages:  slice(form.holeYardages),
        holeHandicaps: slice(form.holeHandicaps),
      })
      // Auto-add all pre-filled players — they're already committed, skip the join-code step
      if (pendingPlayers.length > 0) {
        try {
          await post(`/api/outings/${data.outing.code}/bulk-join`, {
            user_ids: pendingPlayers.map(p => p.id),
          })
        } catch (e) { warn('[bulk-join]', e) }
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
        <CoursePicker
          value={form.courseId ? form : null}
          onPick={picked => setForm(f => ({
            ...f,
            courseId:      picked.courseId,
            courseName:    picked.courseName,
            courseTee:     picked.courseTee,
            holePars:      picked.holePars,
            holeYardages:  picked.holeYardages,
            holeHandicaps: picked.holeHandicaps,
            coursePar:     picked.coursePar,
          }))}
          onClear={() => setForm(f => ({
            ...f,
            courseId:      null,
            courseTee:     null,
            holePars:      null,
            holeYardages:  null,
            holeHandicaps: null,
            coursePar:     null,
          }))}
          onTypedName={text => set('courseName', text)}
        />
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

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
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
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 8 }}>
                These players will be auto-added when you create the outing.
              </div>
            </div>
          )}
          {steps[step]}
        </div>
        {error && <div style={{ color: 'var(--tm-danger)', fontSize: 13, padding: '8px 20px', textAlign: 'center' }}>{error}</div>}
        <div style={{ padding: '16px 20px', display: 'flex', gap: 12, flexShrink: 0 }}>
          {step > 0 && <button onClick={() => setStep(s => s-1)} style={{ flex: 1, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text-2)', fontWeight: 700 }}>Back</button>}
          {step < 2
            ? <button onClick={() => setStep(s => s+1)} style={{ flex: 2, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))', color: '#fff', fontWeight: 800, fontSize: 15, border: 'none' }}>Next →</button>
            : <button onClick={handleCreate} disabled={loading} style={{ flex: 2, padding: '14px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))', color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 15, border: 'none' }}>{loading ? 'Creating…' : 'Create Match'}</button>
          }
        </div>
      </div>
    </div>,
    document.body
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
// Augusta-style cell: cream tile, red numerals for under-par, ink for
// over-par. Birdie = single red circle, eagle = double red circle, bogey
// = single black square, double = double black square. Subtotals (OUT/IN)
// render as deeper teal cells with white block text.
function cellBg(score, par, isSubtotal) {
  // Body subtotal cells (LAVIN's OUT total, filler row OUT cells) now use
  // AUGUSTA_GREEN_DEEP — same color as the OUT/IN/35/36 header cells — so
  // the rightmost column reads as one continuous dark-green strip top to
  // bottom. (2026-04-30 PM round 6 — user wanted these same color as the
  // box 36 and IN are in.)
  if (isSubtotal) return AUGUSTA_GREEN_DEEP
  // Every score cell — filled or empty — uses the same solid cream so the
  // board reads as a uniform grid of score slots. The presence/absence of
  // a numeral is the only difference.
  return AUGUSTA_TILE
}
function cellColor(score, par, isSubtotal) {
  if (isSubtotal) return '#fff'
  if (!score || !par) return AUGUSTA_INK
  return score - par < 0 ? AUGUSTA_RED : AUGUSTA_INK
}

// Border helper used by ScoreModal's quick-pick chips. The Augusta cells
// don't really need this anymore (they share borders), but ScoreModal still
// references it to color-code the picked chip. (2026-04-30 PM round 7
// regression fix — was removed in round 5 but ScoreModal still called it.)
function cellBorder(score, par) {
  if (!score || !par) return '1px solid rgba(0,0,0,0.20)'
  const d = score - par
  if (d <= -1) return `1.5px solid ${AUGUSTA_RED}`
  if (d >= 1)  return `1.5px solid ${AUGUSTA_INK}`
  return '1px solid rgba(0,0,0,0.30)'
}

// Single scorecard cell — tappable by host for any player, or by self.
// Borders use only `borderLeft` so adjacent cells share a single 1px line
// (matches the header rows' borderLeft scheme; otherwise body cells stacked
// 2px between them and looked misaligned with headers when scrolled).
// (2026-04-30 PM border-cleanup)
function ScorecardCell({ score, par, canEdit, onTap, isSubtotal, overrideBg, overrideBorder, overrideColor, w = 32, h = 36 }) {
  // Subtotal cells used to be `w + 4` for visual emphasis, but that made
  // the body OUT/IN column 4px wider than the header OUT/IN column —
  // so the body subtotal cells (LAVIN's 12, filler rows) stuck out past
  // the header's OUT and the BACK-9 IN/36 cells. Now unified at w so
  // the column lines up. (2026-04-30 PM round 5)
  const bg     = overrideBg     ?? cellBg(score, par, isSubtotal)
  const color  = overrideColor  ?? cellColor(score, par, isSubtotal)
  const diff   = (!isSubtotal && score && par) ? score - par : null
  // Border treatment — only the LEFT edge so adjacent cells share a divider.
  // Subtotal cells (OUT/IN) used to get a heavier 2px borderLeft, which made
  // the hole-9→OUT boundary visibly step and made the horizontal HOLE→PAR
  // divider appear to "break off" at hole 8/9. Now uses the same 1px
  // dark-alpha as other cells; visual distinction comes from bg color
  // (cream tile vs dark green strip). (2026-04-30 PM)
  const borderLeft = overrideBorder ?? '1px solid rgba(0,0,0,0.20)'
  return (
    <div
      onClick={canEdit && !isSubtotal ? onTap : undefined}
      style={{
        minWidth: w, width: w, height: h,
        background: bg,
        borderLeft,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: isSubtotal ? 14 : 15, fontWeight: 900,
        fontFamily: '"Arial Black", "Arial Bold", Arial, sans-serif',
        color, cursor: canEdit && !isSubtotal ? 'pointer' : 'default',
        flexShrink: 0, userSelect: 'none',
        position: 'relative',
        // Subtle inset shadow at the TOP of each tile (so it reads as
        // slotted into the board). Removed the previous bottom highlight
        // — it created a 1px white line at the bottom of cream cells that
        // didn't exist on subtotal cells, making them appear visually
        // misaligned with the OUT/IN box next to them. (2026-04-30 PM
        // round 6 — user: "make them line up perfectly")
        boxShadow: isSubtotal
          ? 'inset 0 1px 2px rgba(0,0,0,0.50)'
          : 'inset 0 1px 2px rgba(0,0,0,0.18)',
      }}
    >
      {/* Birdie / Eagle: red circle (or two for eagle) */}
      {diff === -1 && <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', border: '1.6px solid ' + AUGUSTA_RED, pointerEvents: 'none' }} />}
      {diff != null && diff <= -2 && <>
        <div style={{ position: 'absolute', inset: 2, borderRadius: '50%', border: '1.6px solid ' + AUGUSTA_RED, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: '1.6px solid ' + AUGUSTA_RED, pointerEvents: 'none' }} />
      </>}
      {/* Bogey / Double: black square (or two for double) */}
      {diff === 1 && <div style={{ position: 'absolute', inset: 3, border: '1.6px solid ' + AUGUSTA_INK, pointerEvents: 'none' }} />}
      {diff != null && diff >= 2 && <>
        <div style={{ position: 'absolute', inset: 2, border: '1.6px solid ' + AUGUSTA_INK, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 6, border: '1.6px solid ' + AUGUSTA_INK, pointerEvents: 'none' }} />
      </>}
      {/* Score numeral — keyed by score so React remounts it when the
          score changes, which retriggers the tm-score-reveal animation
          (a small scale-up flip mimicking the Masters card-flip). */}
      {(score || isSubtotal) ? (
        <span
          key={`s${score ?? ''}-p${par ?? ''}`}
          className="tm-score-reveal"
          style={{ display: 'inline-block', position: 'relative' }}
        >
          {score || ''}
        </span>
      ) : null}
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

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
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
    </div>,
    document.body
  )
}

// ─── Add Guest Modal ──────────────────────────────────────────────────────────
// Add Player Modal — search-as-you-type for app users, fallback to manual guest.
//   - Type 2+ chars → calls /api/friends/search?q=… (debounced 250ms)
//   - Click a matching user → bulk-joins them as a real participant
//   - Click "Add as guest" → manual scorecard slot via the original /guests path
// (2026-04-30 Path A: replaces the old guest-only sheet)
function GuestModal({ code, onAdd, onAppUserAdded, onClose }) {
  const [name, setName]         = useState('')
  const [results, setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving]     = useState(false)

  // Debounced user search — fires when input length ≥ 2
  useEffect(() => {
    const q = name.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await api(`/api/friends/search?q=${encodeURIComponent(q)}`)
        setResults(Array.isArray(res) ? res : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [name])

  async function addAppUser(u) {
    if (saving) return
    setSaving(true)
    try {
      await post(`/api/outings/${code}/bulk-join`, { user_ids: [u.id] })
      onAppUserAdded?.()
    } catch (e) { warn('[bulk-join]', e?.message) }
    finally { setSaving(false) }
  }

  async function addAsGuest() {
    if (!name.trim() || saving) return
    setSaving(true)
    try { await onAdd(name.trim()) }
    finally { setSaving(false) }
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--tm-text)', marginBottom: 6 }}>Add Player</div>
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginBottom: 16 }}>
          Type a name — if they're on The Match, they'll show up below. Otherwise add them as a guest.
        </div>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && results.length === 0 && addAsGuest()}
          placeholder="Player name or email"
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 'var(--tm-radius)',
            background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
            color: 'var(--tm-text)', fontSize: 16, outline: 'none', boxSizing: 'border-box',
            marginBottom: 8,
          }}
        />

        {/* Search results — appear as user types */}
        {(searching || results.length > 0) && (
          <div style={{
            maxHeight: 220, overflowY: 'auto',
            border: '1px solid var(--tm-border)', borderRadius: 'var(--tm-radius)',
            background: 'var(--tm-surface-2)',
            marginBottom: 12,
          }}>
            {searching && results.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--tm-text-3)' }}>Searching…</div>
            )}
            {results.map(u => (
              <button key={u.id} onClick={() => addAppUser(u)} disabled={saving}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '10px 14px', border: 'none', background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderBottom: '1px solid var(--tm-border)',
                }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--tm-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email}{u.handicap != null ? ` · HCP ${u.handicap}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--tm-green-text)', fontWeight: 800, flexShrink: 0, marginLeft: 8 }}>
                  + Add
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Fallback — add as manual guest */}
        <button
          onClick={addAsGuest}
          disabled={!name.trim() || saving}
          style={{
            width: '100%', padding: 14, borderRadius: 'var(--tm-radius-lg)',
            background: name.trim() ? 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))' : 'var(--tm-surface-3)',
            color: name.trim() ? 'var(--tm-text-inv)' : 'var(--tm-text-3)',
            fontWeight: 800, fontSize: 15, border: 'none', cursor: name.trim() ? 'pointer' : 'default',
          }}
        >{saving ? 'Adding…' : results.length > 0 ? `Add "${name}" as guest instead` : 'Add as Guest Player'}</button>

        {/* Help text */}
        <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 10, textAlign: 'center' }}>
          Guests don't have accounts — the host enters their scores manually.
        </div>
      </div>
    </div>,
    document.body
  )
}

// Compute leaderboard positions for an already-sorted player array.
// Returns an array of strings parallel to `sorted`: "1", "T2", "3", or "—"
// for players with no scores yet. (2026-04-30 PM round 8 — rank badges)
function computePositions(sorted, getScores, holePars) {
  const stps = sorted.map(p => {
    const sc = getScores(p)
    const played = sc.filter(s => s > 0)
    if (played.length === 0) return null
    const stp = sc.reduce((sum, s, i) => s > 0 ? sum + (s - holePars[i]) : sum, 0)
    return stp
  })
  const positions = []
  let prev = null
  let pos = 0
  stps.forEach((stp, idx) => {
    if (stp == null) { positions.push('—'); return }
    if (stp !== prev) { pos = idx + 1; prev = stp }
    positions.push(pos)
  })
  // Add T-prefix for ties
  const counts = {}
  positions.forEach(p => { if (p !== '—') counts[p] = (counts[p] || 0) + 1 })
  return positions.map(p => p === '—' ? p : counts[p] > 1 ? `T${p}` : `${p}`)
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
  // Most recent score event — pops a broadcast banner at the top of the
  // board for ~4s when a score is entered. (2026-04-30 PM round 10)
  const [recentEvent, setRecentEvent] = useState(null)

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
  // Auto-clear the recent-event banner ~4s after it pops
  useEffect(() => {
    if (!recentEvent) return
    const t = setTimeout(() => setRecentEvent(null), 4000)
    return () => clearTimeout(t)
  }, [recentEvent])
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
      // Pop the recent-event banner — broadcast feel when a score lands.
      // Looks up the par from current outing state, and the player name.
      const targetPlayer = (outing?.state?.participants || []).find(p => String(p.user_id) === String(targetUserId))
      const parsForLookup = estimateHolePars(outing?.course_par ?? 72, outing?.state?.holes ?? 18)
      const parForHole = (Array.isArray(outing?.hole_pars) && outing.hole_pars[hole])
        ? outing.hole_pars[hole]
        : parsForLookup[hole] || 4
      if (targetPlayer && score > 0) {
        setRecentEvent({ name: targetPlayer.name, hole, score, par: parForHole, ts: Date.now() })
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
  // Prefer real per-hole pars from the picked course; fall back to the
  // synthetic distribution for legacy matches that have no course_id.
  // (2026-04-30 — migration 006 added the column)
  const realHolePars = Array.isArray(outing.hole_pars) ? outing.hole_pars : null
  const holePars     = realHolePars && realHolePars.length >= holeCount
    ? realHolePars.slice(0, holeCount)
    : estimateHolePars(coursePar, holeCount)
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

  // Column width constants. The leftmost area of each row is now split into
  // THREE cells: RANK_COL (position badge), AVATAR_COL (square photo box),
  // NAME_COL (surname caps + THRU subtitle). PLAYER_COL is the sum and is
  // still used for header spans over the whole left side.
  const RANK_COL   = 30        // position badge — "1", "T2", etc
  const AVATAR_COL = 60        // square; matches rowH visually w/o forcing it
  const NAME_COL   = 92        // surname caps + THRU subtitle
  const PLAYER_COL = RANK_COL + AVATAR_COL + NAME_COL  // 182 — header span
  const HOLE_COL   = 32
  const SUB_COL    = 40

  // Compute leaderboard positions ("1", "T2", "3"…) based on score-to-par.
  // Players with no scores yet get "—". Ties get a "T" prefix.
  const positions = computePositions(sorted, getScores, holePars)

  // Active hole — next hole to be played. = max(holes_played) + 1, capped
  // at the last hole. Used to show a green flag pin under the hole number
  // in the HOLE row. (2026-04-30 PM round 9 — Tier 2)
  const maxPlayed = Math.max(0, ...participants.map(p => getScores(p).filter(s => s > 0).length))
  const activeHole = maxPlayed >= holeCount ? null : maxPlayed   // 0-indexed

  // Row sizing: minimum 4 rows fill the screen. Each row is ~80-90px; if
  // fewer than 4 players, we render empty placeholder rows below them
  // (instead of stretching the real rows huge, which read weirdly).
  // Past 4 players, rows shrink to a 56px minimum and scroll vertically.
  const MIN_ROWS = 4
  const ROW_H = participants.length <= MIN_ROWS ? 80 : 56
  const fillerRows = Math.max(0, MIN_ROWS - participants.length)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'linear-gradient(180deg, #0a2410 0%, #0F3D1E 100%)',
    }}>
      {/* Header — dark green strip with white title, gold code chip.
          calc(safe-top + 14px) clears the iOS notch / Android status bar
          on phones; on desktop / non-notch devices --safe-top = 0px so the
          header gets just the 14px breathing room. (2026-04-30) */}
      <div style={{
        padding: 'calc(var(--safe-top) + 14px) 16px 10px',
        background: AUGUSTA_GREEN_DEEP,
        borderBottom: '2px solid ' + AUGUSTA_WOOD,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, padding: '0 4px', cursor: 'pointer' }}>←</button>
          <div style={{ textAlign: 'center', flex: 1, padding: '0 8px' }}>
            <div style={{ fontWeight: 900, color: '#fff', fontSize: 15, lineHeight: 1.2, fontFamily: '"Georgia", serif', fontStyle: 'italic', letterSpacing: '0.03em' }}>{outing.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>{outing.course_name}{coursePar ? ` · Par ${coursePar}` : ''}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ background: '#FFD700', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 900, color: AUGUSTA_GREEN, letterSpacing: 2, fontFamily: '"Arial Black", Arial, sans-serif' }}>{code}</div>
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

      </div>

      {/* Match Play status banner — promoted to a broadcast-style banner
          ABOVE the wood frame when match-play is active. Big bold gold
          status text, dark green gradient pulled toward the rest of the
          board, italic THRU N to the right. (2026-04-30 PM round 9) */}
      {isMatchPlay && matchPlayData && matchPlayData.played > 0 && (
        <div style={{
          margin: '8px 12px 0',
          padding: '10px 16px',
          borderRadius: 6,
          background: `linear-gradient(135deg, ${AUGUSTA_GREEN_DEEP} 0%, ${AUGUSTA_GREEN} 100%)`,
          border: `1px solid ${AUGUSTA_GOLD_DIM}`,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 18, fontWeight: 900,
            color: matchPlayData.p1HolesUp === 0
              ? '#fff'
              : matchPlayData.p1HolesUp > 0 ? AUGUSTA_GOLD : '#FFB4B4',
            fontFamily: '"Arial Black", Arial, sans-serif',
            letterSpacing: '0.06em',
            textShadow: '0 1px 2px rgba(0,0,0,0.45)',
          }}>
            {matchPlayData.p1HolesUp === 0
              ? 'ALL SQUARE'
              : matchPlayData.dormie
              ? `${(matchPlayData.p1HolesUp > 0 ? sorted[0].name : sorted[1].name)?.split(' ').slice(-1)[0]?.toUpperCase()} DORMY ${Math.abs(matchPlayData.p1HolesUp)}`
              : `${(matchPlayData.p1HolesUp > 0 ? sorted[0].name : sorted[1].name)?.split(' ').slice(-1)[0]?.toUpperCase()} ${Math.abs(matchPlayData.p1HolesUp)} UP`
            }
          </span>
          <span style={{
            fontSize: 13, fontWeight: 700,
            color: 'rgba(255,255,255,0.65)',
            fontFamily: '"Georgia", serif', fontStyle: 'italic',
            letterSpacing: '0.08em',
          }}>
            THRU {matchPlayData.played}
          </span>
        </div>
      )}

      {/* Recent score event banner — pops down from above the board for ~4s
          when any score is entered. Broadcast lower-third feel.
          (2026-04-30 PM round 10) */}
      {recentEvent && (() => {
        const lastName = (recentEvent.name || '').trim().split(/\s+/).slice(-1)[0]?.toUpperCase() || '—'
        const label = scoreLabel(recentEvent.score, recentEvent.par)
        const isUnder = recentEvent.score < recentEvent.par
        return (
          <div
            key={recentEvent.ts}
            className="tm-event-pop"
            style={{
              position: 'absolute', top: 100, left: '50%',
              transform: 'translateX(-50%)',
              background: isUnder
                ? `linear-gradient(135deg, ${AUGUSTA_GOLD} 0%, #C8A33C 100%)`
                : `linear-gradient(135deg, ${AUGUSTA_GREEN_DEEP} 0%, ${AUGUSTA_GREEN} 100%)`,
              color: isUnder ? AUGUSTA_GREEN_DEEP : '#fff',
              border: `1px solid ${AUGUSTA_GOLD_DIM}`,
              padding: '8px 18px',
              borderRadius: 24,
              fontSize: 13, fontWeight: 900,
              fontFamily: '"Arial Black", Arial, sans-serif',
              letterSpacing: '0.08em',
              boxShadow: '0 6px 20px rgba(0,0,0,0.40)',
              zIndex: 5,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}>
            {lastName} · {label} · HOLE {recentEvent.hole + 1}
          </div>
        )
      })()}

      {/* Tournament board frame — outer wood wrapper has a real wood-grain
          texture (repeating vertical-line gradient over a brown gradient),
          inner div is the board panel. The gold pinstripe + dark inset
          rings live on the inner div so they sit just inside the wood.
          (2026-04-30 PM round 9 — Tier 2 polish, real wood look) */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        margin: '12px 12px',
        padding: 4,
        borderRadius: 7,
        backgroundColor: AUGUSTA_WOOD,
        backgroundImage: [
          // Vertical wood-grain lines — narrow dark lines + slight light highlights
          'repeating-linear-gradient(90deg, transparent 0px, transparent 3px, rgba(0,0,0,0.18) 3px, rgba(0,0,0,0.18) 3.6px, transparent 3.6px, transparent 7px, rgba(255,255,255,0.05) 7px, rgba(255,255,255,0.05) 7.4px, transparent 7.4px, transparent 13px)',
          // Subtle horizontal warmth/shadow
          'linear-gradient(180deg, #6b4519 0%, #5a3a16 50%, #4a2f0e 100%)',
        ].join(', '),
        boxShadow: '0 16px 50px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          borderRadius: 4,
          overflow: 'hidden',
          background: AUGUSTA_PANEL,
          // Gold pinstripe + dark inner ring INSIDE the wood for that
          // broadcast-quality finish.
          boxShadow: `inset 0 0 0 1px ${AUGUSTA_GOLD_DIM}, inset 0 0 0 2px rgba(0,0,0,0.45)`,
        }}>
        {/* LEADERS plaque — embossed cream banner with gold rules above & below */}
        <div style={{
          background: `linear-gradient(180deg, ${AUGUSTA_CREAM} 0%, #DDD2A8 100%)`,
          borderBottom: '1px solid ' + AUGUSTA_GREEN,
          textAlign: 'center', padding: '10px 0 8px',
          flexShrink: 0, position: 'relative',
          boxShadow: 'inset 0 -1px 2px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.6)',
        }}>
          {/* Top gold rule */}
          <div style={{
            position: 'absolute', top: 0, left: '12%', right: '12%',
            height: 1, background: AUGUSTA_GOLD_DIM, opacity: 0.7,
          }} />
          <div style={{
            fontSize: 36, fontWeight: 900, lineHeight: 1, color: AUGUSTA_GREEN,
            letterSpacing: '0.20em',
            fontFamily: '"Georgia", "Times New Roman", serif',
            textShadow: '0 1px 0 rgba(255,255,255,0.7), 0 -1px 0 rgba(0,0,0,0.20)',
          }}>LEADERS</div>
          {/* Bottom gold rule */}
          <div style={{
            position: 'absolute', bottom: 4, left: '20%', right: '20%',
            height: 1, background: AUGUSTA_GOLD_DIM, opacity: 0.55,
          }} />
        </div>

        {/* Scorecard tables — scroll horizontally if needed, vertically as one body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {participants.length === 0 ? (
            <div style={{
              padding: 40, textAlign: 'center', fontSize: 14,
              color: AUGUSTA_INK, fontFamily: '"Georgia", serif', fontStyle: 'italic',
            }}>
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
                RANK_COL={RANK_COL}
                AVATAR_COL={AVATAR_COL}
                NAME_COL={NAME_COL}
                HOLE_COL={HOLE_COL}
                SUB_COL={SUB_COL}
                positions={positions}
                activeHole={activeHole}
                rowH={ROW_H}
                fillerRows={fillerRows}
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
                  rowH={ROW_H}
                  fillerRows={fillerRows}
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
                RANK_COL={RANK_COL}
                AVATAR_COL={AVATAR_COL}
                NAME_COL={NAME_COL}
                HOLE_COL={HOLE_COL}
                SUB_COL={SUB_COL}
                positions={positions}
                activeHole={activeHole}
              />
            </div>
          )}
        </div>

        {/* Augusta plaque footer */}
        <div style={{
          background: AUGUSTA_GREEN,
          padding: '8px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
          borderTop: '2px solid ' + AUGUSTA_WOOD,
          flexShrink: 0,
        }}>
          <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: '50%', background: '#FFD700',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 900, color: AUGUSTA_GREEN, fontFamily: '"Georgia", serif',
          }}>M</span>
          <div style={{
            fontFamily: '"Georgia", "Times New Roman", serif',
            fontSize: 14, color: '#fff', fontStyle: 'italic', letterSpacing: '0.10em',
          }}>Augusta National Club Golf</div>
          <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: '50%', background: '#FFD700',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 900, color: AUGUSTA_GREEN, fontFamily: '"Georgia", serif',
          }}>M</span>
        </div>
        </div>
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

      {/* Add Player sheet — search-as-you-type for app users + manual guest fallback */}
      {showGuestModal && (
        <GuestModal
          code={code}
          onAdd={addGuest}
          onAppUserAdded={async () => {
            await loadOuting()
            setShowGuestModal(false)
          }}
          onClose={() => setShowGuestModal(false)}
        />
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
function ScorecardTable({ label, holes, holePars, subtotalPar, participants, getScores, isHost, userId, isMarkerFor, playerTeam, onCellTap, matchPlayData, isP1, PLAYER_COL, RANK_COL = 30, AVATAR_COL = 60, NAME_COL = 92, HOLE_COL, SUB_COL, rowH = 56, fillerRows = 0, positions = [], activeHole = null }) {
  // Tournament-board look: deep forest green panels with white block letters,
  // gold PAR numerals, dark green OUT/IN strip with white. Subtle gradient
  // gives the panels light-from-above weight. (2026-04-30 PM revision)
  const panelGradient = `linear-gradient(180deg, ${AUGUSTA_PANEL_HI} 0%, ${AUGUSTA_PANEL} 100%)`
  // Divider color uses neutral black-alpha (not AUGUSTA_GREEN_DEEP) so the
  // horizontal line is visible across BOTH the gradient panel AND the dark
  // green OUT/IN strip — fixes the "line breaks off at hole 8/9" bug
  // where the divider visually disappeared at the OUT cell because its bg
  // was the same color as the divider. (2026-04-30 PM)
  const dividerColor = 'rgba(0,0,0,0.50)'
  const headerRow = {
    display: 'flex', alignItems: 'center',
    borderBottom: '1px solid ' + dividerColor,
    background: panelGradient,
    // Row sizes to its content so the borderBottom spans the full width of
    // all cells (avatar + name + 9 hole cells + OUT subtotal). Without this
    // the row only expands to the scroll container's width and the
    // borderBottom cuts off mid-row when scrolled. (2026-04-30 PM round 4 —
    // user noticed the cut-off after the AVATAR_COL split widened rows
    // beyond the viewport.)
    width: 'max-content',
    minWidth: '100%',
  }
  const headerNameCol = {
    minWidth: PLAYER_COL, width: PLAYER_COL, padding: '8px 10px',
    fontSize: 12, fontWeight: 900, color: '#fff',
    fontFamily: '"Arial Black", Arial, sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0,
    textShadow: '0 1px 1px rgba(0,0,0,0.40)',
  }
  const headerHoleCell = {
    minWidth: HOLE_COL, width: HOLE_COL, height: 34,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 900, color: '#fff',
    fontFamily: '"Arial Black", Arial, sans-serif',
    flexShrink: 0,
    // Match body cells' borderLeft color so vertical dividers run continuously
    // from header through every body row when scrolled (2026-04-30 PM fix).
    borderLeft: '1px solid rgba(0,0,0,0.20)',
    textShadow: '0 1px 1px rgba(0,0,0,0.40)',
  }
  // Subtotal header cell (OUT / IN): same 1px borderLeft as hole cells so the
  // hole-9 → OUT boundary doesn't have a visible "step" that makes the
  // horizontal HOLE→PAR divider look like it breaks off. (2026-04-30 PM)
  const subtotalHeaderCell = {
    minWidth: SUB_COL, width: SUB_COL, height: 34,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 900, color: AUGUSTA_GOLD,
    fontFamily: '"Arial Black", Arial, sans-serif',
    background: AUGUSTA_GREEN_DEEP, letterSpacing: '0.06em', flexShrink: 0,
    textShadow: '0 1px 1px rgba(0,0,0,0.50)',
    borderLeft: '1px solid rgba(0,0,0,0.50)',
  }

  return (
    <div style={{ marginBottom: 0 }}>
      {/* HOLE row — green panel with white numerals + gold OUT/IN.
          Active hole gets a small green flag pin on top of the numeral. */}
      <div style={headerRow}>
        <div style={headerNameCol}>{label}</div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          {holes.map(h => (
            <div key={h} style={{ ...headerHoleCell, position: 'relative' }}>
              {h + 1}
              {activeHole === h && (
                <span style={{
                  position: 'absolute', top: -6, right: 2,
                  width: 9, height: 12,
                  pointerEvents: 'none',
                }} aria-label="Active hole">
                  <svg width="9" height="12" viewBox="0 0 9 12" fill="none">
                    <line x1="1" y1="0" x2="1" y2="12" stroke="#fff" strokeWidth="1" />
                    <path d="M1 1 L8 3 L1 5 Z" fill={AUGUSTA_GOLD} stroke="#000" strokeWidth="0.5" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </div>
          ))}
          <div style={subtotalHeaderCell}>{label === 'BACK 9' ? 'IN' : 'OUT'}</div>
        </div>
      </div>

      {/* PAR row — gold numerals on green (the iconic Augusta detail) */}
      <div style={{ ...headerRow, borderBottom: '2px solid ' + dividerColor }}>
        <div style={{ ...headerNameCol, color: AUGUSTA_GOLD }}>PAR</div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          {holes.map(h => (
            <div key={h} style={{ ...headerHoleCell, color: AUGUSTA_GOLD }}>{holePars[h]}</div>
          ))}
          <div style={{ ...subtotalHeaderCell, color: AUGUSTA_GOLD }}>{subtotalPar}</div>
        </div>
      </div>

      {/* Player rows — teal panel for name, cream tiles for scores */}
      {participants.map((p, idx) => {
        const sc       = getScores(p)
        const isMe     = String(p.user_id) === String(userId)
        const team     = playerTeam(p.user_id)
        const canEdit  = isHost || (isMarkerFor ? isMarkerFor(String(userId), String(p.user_id)) : false)
        const subtotal = holes.reduce((sum, h) => sum + (sc[h] || 0), 0)
        const p1       = matchPlayData ? isP1?.(p) : false
        // Surname in caps, fallback to first if single-word
        const parts    = (p.name || '').trim().split(/\s+/)
        const display  = (parts.length > 1 ? parts[parts.length - 1] : parts[0] || '').toUpperCase().slice(0, 12)
        // Position + leader detection
        const position = positions[idx] || '—'
        const holesPlayed = sc.filter(s => s > 0).length
        const isLeader    = holesPlayed > 0 && (position === '1' || position === 'T1')
        // THRU indicator: hole count played, or "F" if all holes done
        const thruText    = holesPlayed === 0 ? null
                          : holesPlayed >= 18 ? 'F'
                          : `THRU ${holesPlayed}`

        return (
          <div key={p.user_id} style={{
            display: 'flex', alignItems: 'center',
            borderBottom: '1px solid ' + AUGUSTA_GREEN_DEEP,
            background: isMe ? AUGUSTA_PANEL_HOVER : panelGradient,
            borderLeft: isMe ? `4px solid ${AUGUSTA_GOLD}` : 'none',
            minHeight: rowH,
            width: 'max-content', minWidth: '100%',
          }}>
            {/* Rank badge — shows position (1, T2, …) — leader gets gold bg */}
            <div style={{
              minWidth: RANK_COL - (isMe ? 4 : 0), width: RANK_COL - (isMe ? 4 : 0),
              height: rowH, flexShrink: 0,
              borderRight: '1px solid rgba(0,0,0,0.30)',
              background: isLeader
                ? `linear-gradient(180deg, ${AUGUSTA_GOLD} 0%, #C8A33C 100%)`
                : AUGUSTA_GREEN_DEEP,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: position.length > 2 ? 13 : 16, fontWeight: 900,
              color: isLeader ? AUGUSTA_GREEN_DEEP : '#fff',
              fontFamily: '"Arial Black", Arial, sans-serif',
              letterSpacing: '0.02em',
              textShadow: isLeader ? '0 1px 0 rgba(255,255,255,0.30)' : '0 1px 1px rgba(0,0,0,0.45)',
              boxShadow: isLeader ? 'inset 0 0 0 1px rgba(255,255,255,0.30), inset 0 -2px 0 rgba(0,0,0,0.18)' : 'none',
            }}>
              {position}
            </div>
            {/* Avatar cell — photo fills edge-to-edge, square box */}
            <div style={{
              minWidth: AVATAR_COL, width: AVATAR_COL,
              height: rowH, flexShrink: 0,
              borderRight: '1px solid rgba(0,0,0,0.30)',
              background: AUGUSTA_GREEN_DEEP,
              overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
            }}>
              {p.avatar ? (
                <img
                  src={p.avatar}
                  alt={p.name}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover', objectPosition: 'top center',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: avatarBg(p.name),
                  color: '#fff',
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  fontSize: Math.round(rowH * 0.36), fontWeight: 900,
                  letterSpacing: '0.02em',
                }}>{initials(p.name)}</div>
              )}
            </div>
            {/* Name cell — surname caps on green panel; leader gets gold */}
            <div style={{
              minWidth: NAME_COL, width: NAME_COL, height: rowH,
              padding: '0 10px', flexShrink: 0, overflow: 'hidden',
              display: 'flex', alignItems: 'center',
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 14, fontWeight: 900,
                  color: isLeader ? AUGUSTA_GOLD : '#fff',
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  letterSpacing: '0.05em',
                  textShadow: isLeader
                    ? '0 1px 0 rgba(0,0,0,0.45), 0 0 6px rgba(232,192,90,0.35)'
                    : '0 1px 1px rgba(0,0,0,0.45)',
                }}>
                  {display}
                </div>
                {/* THRU indicator if scores exist; team name otherwise */}
                {thruText && (
                  <div style={{
                    fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: 700,
                    letterSpacing: '0.08em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    marginTop: 2,
                  }}>
                    {thruText}
                  </div>
                )}
                {!thruText && team && (
                  <div style={{
                    fontSize: 10, color: 'rgba(255,255,255,0.70)', fontWeight: 700,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    marginTop: 2,
                  }}>
                    {team.name}
                  </div>
                )}
              </div>
            </div>
            {/* Score cells */}
            <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
              {holes.map(h => {
                // Match play cell override — gold if won, red if lost, neutral if halved
                let mpBg, mpBorder, mpColor
                if (matchPlayData) {
                  const res = matchPlayData.holeResults[h]
                  if (res !== null && res !== undefined) {
                    const won = p1 ? res === 'p1' : res === 'p2'
                    const halved = res === 'half'
                    if (won) { mpBg = '#FFE39A'; mpBorder = '1.5px solid ' + AUGUSTA_GREEN; mpColor = AUGUSTA_GREEN }
                    else if (!halved) { mpBg = '#FFD3D3'; mpBorder = '1.5px solid ' + AUGUSTA_RED; mpColor = AUGUSTA_RED }
                    else { mpBg = AUGUSTA_TILE; mpBorder = '1px dashed rgba(0,0,0,0.45)'; mpColor = 'rgba(0,0,0,0.55)' }
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
                    w={HOLE_COL}
                    h={rowH}
                    overrideBg={mpBg}
                    overrideBorder={mpBorder}
                    overrideColor={mpColor}
                  />
                )
              })}
              {/* Subtotal — dark green strip */}
              <ScorecardCell
                score={subtotal || null} par={null} canEdit={false} isSubtotal={true}
                w={SUB_COL} h={rowH}
              />
            </div>
          </div>
        )
      })}

      {/* Filler placeholder rows so the board always shows ≥4 rows
          when the match has fewer players. (2026-04-30 Path A) */}
      {Array(fillerRows).fill(0).map((_, i) => (
        <div key={`filler-${i}`} style={{
          display: 'flex', alignItems: 'center',
          borderBottom: '1px solid ' + AUGUSTA_GREEN_DEEP,
          background: panelGradient,
          minHeight: rowH,
          width: 'max-content', minWidth: '100%',
        }}>
          {/* Empty rank cell — keeps column geometry matching live rows */}
          <div style={{
            minWidth: RANK_COL, width: RANK_COL, height: rowH,
            background: AUGUSTA_GREEN_DEEP,
            borderRight: '1px solid rgba(0,0,0,0.30)',
            flexShrink: 0,
          }} />
          {/* Empty avatar cell — deep green, hint of an empty slot */}
          <div style={{
            minWidth: AVATAR_COL, width: AVATAR_COL, height: rowH,
            background: AUGUSTA_GREEN_DEEP,
            borderRight: '1px solid rgba(0,0,0,0.30)',
            flexShrink: 0,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)',
          }} />
          {/* Empty name cell */}
          <div style={{
            minWidth: NAME_COL, width: NAME_COL, height: rowH,
            padding: '0 10px', flexShrink: 0,
          }} />
          <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
            {holes.map(h => (
              <div key={h} style={{
                minWidth: HOLE_COL, width: HOLE_COL, height: rowH,
                background: AUGUSTA_TILE,
                borderLeft: '1px solid rgba(0,0,0,0.20)',
                flexShrink: 0,
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.18)',
              }} />
            ))}
            <div style={{
              minWidth: SUB_COL, width: SUB_COL, height: rowH,
              background: AUGUSTA_GREEN_DEEP,
              borderLeft: '1px solid rgba(0,0,0,0.20)',
              flexShrink: 0,
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.50)',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Totals row ───────────────────────────────────────────────────────────────
function TotalsRow({ participants, holePars, holeCount, coursePar, getScores, diffStr, diffColor, playerTeam, netMode, netTotal, isMatchPlay, matchPlayData, isP1, PLAYER_COL, RANK_COL = 30, AVATAR_COL = 60, NAME_COL = 92, HOLE_COL, SUB_COL, positions = [] }) {
  // Augusta-style: dark green strip with white block-letter "TOTALS" + numbers
  return (
    <div style={{ background: AUGUSTA_GREEN, borderTop: '2px solid ' + AUGUSTA_WOOD }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid ' + AUGUSTA_GREEN_DEEP,
        background: AUGUSTA_GREEN_DEEP,
        width: 'max-content', minWidth: '100%',
      }}>
        <div style={{
          minWidth: PLAYER_COL, width: PLAYER_COL, padding: '8px 10px',
          fontSize: 11, fontWeight: 900, color: '#fff',
          fontFamily: '"Arial Black", Arial, sans-serif',
          letterSpacing: '0.06em', flexShrink: 0,
        }}>TOTALS</div>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <div style={{ minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center', fontSize: 11, fontWeight: 900, color: '#fff', letterSpacing: '0.05em', flexShrink: 0 }}>
            {netMode ? 'NET' : isMatchPlay ? 'HOLES' : 'TOT'}
          </div>
          <div style={{ minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center', fontSize: 11, fontWeight: 900, color: '#fff', letterSpacing: '0.05em', flexShrink: 0 }}>
            {isMatchPlay ? 'STATUS' : '+/−'}
          </div>
          <div style={{ minWidth: 52, textAlign: 'center', fontSize: 11, fontWeight: 900, color: '#fff', letterSpacing: '0.05em', flexShrink: 0 }}>THRU</div>
        </div>
      </div>
      {participants.map((p, idx) => {
        const sc          = getScores(p)
        const team        = playerTeam(p.user_id)
        const gross       = sc.reduce((s, v) => s + (v || 0), 0)
        const displayTot  = netMode ? (netTotal?.(p) ?? gross) : gross
        const holesPlayed = sc.filter(v => v > 0).length
        const dStr        = diffStr(p)
        const parts       = (p.name || '').trim().split(/\s+/)
        const display     = (parts.length > 1 ? parts[parts.length - 1] : parts[0] || '').toUpperCase().slice(0, 12)
        const position    = positions[idx] || '—'
        const isLeader    = holesPlayed > 0 && (position === '1' || position === 'T1')

        // Match play status for this player
        let mpStatus = null
        if (isMatchPlay && matchPlayData) {
          const p1 = isP1?.(p)
          const up = p1 ? matchPlayData.p1HolesUp : -matchPlayData.p1HolesUp
          mpStatus = up === 0 ? 'AS' : up > 0 ? `${up} UP` : `${Math.abs(up)} DN`
        }
        const mpStatusColor = isMatchPlay && matchPlayData
          ? (isP1?.(p)
            ? (matchPlayData.p1HolesUp > 0 ? '#FFD700' : matchPlayData.p1HolesUp < 0 ? '#FFB4B4' : '#fff')
            : (matchPlayData.p1HolesUp < 0 ? '#FFD700' : matchPlayData.p1HolesUp > 0 ? '#FFB4B4' : '#fff'))
          : '#fff'

        const mpHolesWon = isMatchPlay && matchPlayData
          ? matchPlayData.holeResults.filter(r => r !== null && (isP1?.(p) ? r === 'p1' : r === 'p2')).length
          : null

        // Score-to-par "+/-" color: gold when under, red-ish over
        const dParsed = parseInt(dStr.replace(/[^\d-]/g, '')) || 0
        const dColor  = !holesPlayed ? 'rgba(255,255,255,0.55)'
                      : dStr === 'E' ? '#fff'
                      : dParsed < 0 ? '#FFD700'
                      : '#FFB4B4'

        const totalsRowH = 56
        return (
          <div key={p.user_id} style={{
            display: 'flex', alignItems: 'center',
            borderBottom: '1px solid ' + AUGUSTA_GREEN_DEEP,
            background: AUGUSTA_GREEN,
            width: 'max-content', minWidth: '100%',
          }}>
            {/* Rank cell — leader gets gold tile */}
            <div style={{
              minWidth: RANK_COL, width: RANK_COL, height: totalsRowH,
              flexShrink: 0,
              borderRight: '1px solid ' + AUGUSTA_GREEN_DEEP,
              background: isLeader
                ? `linear-gradient(180deg, ${AUGUSTA_GOLD} 0%, #C8A33C 100%)`
                : AUGUSTA_GREEN_DEEP,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: position.length > 2 ? 13 : 16, fontWeight: 900,
              color: isLeader ? AUGUSTA_GREEN_DEEP : '#fff',
              fontFamily: '"Arial Black", Arial, sans-serif',
              textShadow: isLeader ? '0 1px 0 rgba(255,255,255,0.30)' : '0 1px 1px rgba(0,0,0,0.45)',
              boxShadow: isLeader ? 'inset 0 0 0 1px rgba(255,255,255,0.30)' : 'none',
            }}>
              {position}
            </div>
            {/* Avatar cell — photo fills edge-to-edge on the dark green strip */}
            <div style={{
              minWidth: AVATAR_COL, width: AVATAR_COL, height: totalsRowH,
              flexShrink: 0,
              borderRight: '1px solid ' + AUGUSTA_GREEN_DEEP,
              background: AUGUSTA_GREEN_DEEP,
              overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {p.avatar ? (
                <img
                  src={p.avatar}
                  alt={p.name}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover', objectPosition: 'top center',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: avatarBg(p.name),
                  color: '#fff',
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  fontSize: Math.round(totalsRowH * 0.36), fontWeight: 900,
                }}>{initials(p.name)}</div>
              )}
            </div>
            {/* Name cell */}
            <div style={{
              minWidth: NAME_COL, width: NAME_COL, height: totalsRowH,
              padding: '0 10px', flexShrink: 0,
              display: 'flex', alignItems: 'center',
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 14, fontWeight: 900, color: '#fff',
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  letterSpacing: '0.04em',
                }}>{display}</div>
                {team && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: 700, marginTop: 2 }}>{team.name}</div>}
                {netMode && p.handicap != null && !p.is_guest && (
                  <div style={{ fontSize: 9, color: '#FFD700', fontWeight: 700, marginTop: 1 }}>HCP {p.handicap}</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{
                minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center',
                fontSize: 18, fontWeight: 900, color: '#fff', flexShrink: 0,
                fontFamily: '"Arial Black", Arial, sans-serif',
              }}>
                {isMatchPlay ? (mpHolesWon ?? '—') : (displayTot || '—')}
              </div>
              <div style={{
                minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center',
                fontSize: isMatchPlay ? 13 : 16, fontWeight: 900,
                color: isMatchPlay ? mpStatusColor : dColor,
                fontFamily: '"Arial Black", Arial, sans-serif', flexShrink: 0,
              }}>
                {isMatchPlay ? (matchPlayData?.played > 0 ? mpStatus : '—') : (holesPlayed ? dStr : '—')}
              </div>
              <div style={{
                minWidth: 52, textAlign: 'center', fontSize: 14, fontWeight: 800,
                color: 'rgba(255,255,255,0.85)', flexShrink: 0,
              }}>
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
const TEAM_PALETTE = ['#C9A040', '#E8C05A', '#60A5FA', '#F87171', '#A78BFA', '#FB923C', '#34D399', '#FBBF24']

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

  const CHIP_COLORS = ['#C9A040', '#93C5FD', '#F5D78A', '#F87171', '#C4B5FD', '#FD8A4B']

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
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
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--tm-border)', flexShrink: 0 }}>
          <button onClick={save} disabled={saving} style={{
            width: '100%', padding: '16px', borderRadius: 14, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
            color: '#fff', fontWeight: 800, fontSize: 16,
            opacity: saving ? 0.6 : 1,
          }}>{saving ? 'Saving…' : 'Save Groups'}</button>
        </div>
      </div>
    </div>,
    document.body
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

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
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
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 20 }}>
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
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{members.length} players</span>
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
            borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 13,
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
    </div>,
    document.body
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
  const [view, setView]           = useState('hub')   // 'hub' | 'live' | 'code-share' | 'end' | 'rivalry' | 'solo'
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

  if (view === 'solo')  return <ActiveRound  user={user} onBack={() => setView('hub')} />

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
        onSoloRound={() => setView('solo')}
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
