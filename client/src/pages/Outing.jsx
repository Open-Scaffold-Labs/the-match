import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api, post, put, del } from '../lib/api.js'
import { runWithQueue, subscribeQueue, subscribeQueueDrops } from '../lib/offline-queue.js'
import CoachMark from '../components/CoachMark.jsx'
import { warn } from '../lib/logger.js'
// Renamed on import to avoid shadowing the existing local scoreColor(strokes, par)
// helper used by the Augusta scorecard for per-cell tile colors. The lib helper
// takes a score-to-par integer (e.g. -2, 0, +1) and returns gold/green/red.
import { scoreColor as scoreToParColor } from '../lib/scoreColors.js'
import ActiveRound from './ActiveRound.jsx'
import PublicLeaderboard from './PublicLeaderboard.jsx'
// Standalone AugustaBoard route was removed 2026-04-30 (Path A) — every
// match now renders the Augusta scorecard directly via LiveOuting.

// ─── Augusta theme palette ───────────────────────────────────────────────────
// TRANSLUCENT MODE (round 13b): every surface translucent so the page
// fairway grass shows through clearly. Solid colors only on numerals,
// gold accents, and red under-par for readability.
const AUGUSTA_GREEN       = 'rgba(255,255,255,0.55)'   // frame stripe panels
const AUGUSTA_GREEN_DEEP  = 'rgba(232,232,232,0.55)'   // deepest panel (OUT/IN strip + headers)
const AUGUSTA_PANEL       = 'rgba(255,255,255,0.55)'   // main board panel
const AUGUSTA_PANEL_HI    = 'rgba(255,255,255,0.62)'   // gradient top
const AUGUSTA_PANEL_HOVER = 'rgba(240,240,240,0.62)'   // me-row tint
const AUGUSTA_TEXT        = '#1A6B28'   // green text — stays solid for legibility
const AUGUSTA_GOLD        = '#E8C05A'   // PAR + leader accents — solid
const AUGUSTA_GOLD_DIM    = '#A8862E'   // pinstripe — solid
const AUGUSTA_CREAM       = 'rgba(234,224,191,0.55)'   // LEADERS banner cream — translucent
const AUGUSTA_TILE        = 'rgba(242,235,211,0.65)'   // score tile cream — translucent
const AUGUSTA_RED         = '#B22222'   // under-par red — solid
const AUGUSTA_INK         = '#0F0F0F'   // over-par ink — solid
const AUGUSTA_WOOD        = 'rgba(90,58,22,0.85)'      // wood frame — slight translucency

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
function OutingHub({ user, onJoin, onCreate, onOpenOuting, onOpenRivalry, onSoloRound, onSpectate }) {
  const [rivalries, setRivalries] = useState([])
  const [recentOutings, setRecentOutings] = useState([])
  const [loading, setLoading] = useState(true)
  const [rivalrySearch, setRivalrySearch] = useState('')
  const [copiedCode, setCopiedCode] = useState(null)
  // 2026-05-04 — Friends playing now: light-payload feed of friends'
  // active matches. Polled every 30s, visibility-aware (pauses when tab
  // is hidden, refetches immediately on focus). Tap a card → onSpectate.
  const [friendsLive, setFriendsLive] = useState([])

  useEffect(() => {
    Promise.all([
      api('/api/outings/my-rivalries').catch(() => ({ rivalries: [] })),
      api('/api/outings/recent').catch(() => ({ outings: [] })),
      api('/api/outings/friends-live').catch(() => ({ outings: [] })),
    ]).then(([rv, ro, fl]) => {
      setRivalries(rv.rivalries || [])
      setRecentOutings(ro.outings || [])
      setFriendsLive(fl.outings || [])
      setLoading(false)
    })
  }, [])

  // Visibility-aware 30s polling for friends-live. Same cadence pattern
  // used elsewhere (Today's MyDay card on the Hub). Stops when the tab
  // is hidden so we don't burn requests for friends scrolling Slack.
  useEffect(() => {
    let cancelled = false
    let interval = null
    async function refresh() {
      try {
        const fl = await api('/api/outings/friends-live')
        if (!cancelled) setFriendsLive(fl.outings || [])
      } catch { /* swallow — next tick will retry */ }
    }
    function start() {
      if (interval) return
      interval = setInterval(refresh, 30000)
    }
    function stop() {
      if (interval) { clearInterval(interval); interval = null }
    }
    function onVis() {
      if (document.visibilityState === 'visible') {
        refresh()
        start()
      } else {
        stop()
      }
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
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
      {/* 2026-05-04 — header padding-top accounts for the iOS notch /
          Android status bar via --safe-top. Without it, the "Matches"
          title sits ~20px from viewport top and on a notched phone is
          mostly hidden behind the dynamic island / status area. Mirrors
          the same pattern used in Leagues.jsx and EagleEye.jsx. */}
      <div style={{ padding: 'calc(var(--safe-top) + 20px) 20px 0', flexShrink: 0 }}>
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
                userId={user?.id}
                onResume={() => onOpenOuting(o.code)}
                onCopyCode={(e) => onCopyCode(o.code, e)}
                copied={copiedCode === o.code}
                onDelete={async () => {
                  try {
                    await del(`/api/outings/${o.code}`)
                    setRecentOutings(prev => prev.filter(x => x.id !== o.id))
                  } catch (e) {
                    alert(e?.message || 'Could not delete this match.')
                  }
                }}
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

        {/* ─── Friends playing now ──────────────────────────────────────
            2026-05-04 — friends-only (graph), always-show. Tap a card
            to open the spectator view. Hidden when empty so the section
            doesn't add dead vertical space on the most common case
            (no friends in active rounds). */}
        {friendsLive.length > 0 && (
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
              Friends playing now
            </div>
            {friendsLive.map(o => (
              <FriendsLiveCard
                key={o.code}
                o={o}
                onTap={() => onSpectate?.(o.code)}
              />
            ))}
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

        {/* Rivalries + Recent Matches sections removed 2026-05-02 —
            Matt: redundant with the per-user profile pages. The data
            still loads (rivalries / finishedMatches state) since the
            same fetch covers Live Matches above. */}
      </div>
    </div>
  )
}

// ─── Spectate View (in-app wrapper around PublicLeaderboard) ──────────────
// Renders the same spectator board as the public ?live=CODE URL, but
// inside the Match tab's nav shell with a back chevron. Reused by the
// Friends-playing-now feed so signed-in users stay in the app instead
// of being kicked to the public-URL surface.
// (2026-05-04 — Matt: live-scores feed for friends.)
function SpectateView({ code, onBack }) {
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <button
        onClick={onBack}
        aria-label="Back"
        style={{
          position: 'absolute', top: 12, left: 12, zIndex: 10,
          width: 36, height: 36, borderRadius: 18,
          background: 'rgba(255,253,248,0.92)',
          border: '1px solid rgba(46,158,69,0.30)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="#1A6B28" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <PublicLeaderboard code={code} />
    </div>
  )
}

// ─── Friends Live Card (read-only spectator entry) ─────────────────────────
// Compact card for a friend's in-progress match. Light payload from
// /api/outings/friends-live. Tapping opens the full spectator view.
// Visual treatment is similar to LiveMatchCard but without the swipe/copy
// affordances — you can't act on a friend's match, only watch.
// (2026-05-04 — Matt: live-scores feed for friends.)
function FriendsLiveCard({ o, onTap }) {
  // Format leader-diff as the standard golf shorthand. null = nobody has
  // entered a score yet ("Starting" state).
  function fmtDiff(d) {
    if (d == null) return null
    if (d === 0) return 'E'
    if (d > 0)   return `+${d}`
    return String(d)
  }
  const diffStr = fmtDiff(o.leader_diff)
  // "Hole 7 of 18" once any score has been entered; "Starting" otherwise.
  const holeLabel = o.current_hole > 0
    ? `Hole ${o.current_hole}${o.total_holes ? ` of ${o.total_holes}` : ''}`
    : 'Starting'
  // Score color: under-par = red (Augusta convention), over = ink, even = par green.
  const diffColor = o.leader_diff == null ? '#1A6B28'
                  : o.leader_diff < 0 ? '#B22222'
                  : o.leader_diff > 0 ? '#1A1A1A'
                  : '#1A6B28'

  return (
    <button
      onClick={onTap}
      style={{
        width: '100%',
        marginBottom: 8,
        padding: '12px 14px',
        borderRadius: 12,
        background: 'rgba(255,253,248,0.85)',
        border: '1px solid rgba(46,158,69,0.30)',
        boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        textAlign: 'left',
        WebkitTapHighlightColor: 'transparent',
      }}>
      {/* Host avatar (or initials) */}
      <PlayerAvatar
        name={o.host_name || 'Player'}
        avatar={o.host_avatar}
        size={36}
        ringColor="rgba(46,158,69,0.40)"
      />
      {/* Center: title + course/hole */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 800, color: '#0D1F12',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {o.host_name || 'Player'}{o.players_count > 1 ? ` + ${o.players_count - 1}` : ''}
        </div>
        <div style={{
          fontSize: 12, color: 'rgba(13,31,18,0.62)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {(o.course_name || 'TBD')} · {holeLabel}
        </div>
      </div>
      {/* Right: leader score-to-par + chevron. Hidden when nobody has scored. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {diffStr && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.1,
          }}>
            <div style={{
              fontSize: 16, fontWeight: 900, color: diffColor,
              fontFamily: '"Arial Black", Arial, sans-serif',
            }}>{diffStr}</div>
            <div style={{
              fontSize: 9, color: 'rgba(13,31,18,0.50)',
              textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700,
            }}>
              {(o.leader_name || '').slice(0, 12)}
            </div>
          </div>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="rgba(13,31,18,0.40)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </button>
  )
}

// ─── Live Match Card (top-of-page strip) ─────────────────────────────────────
// Big tappable card for in-progress matches. Pulsing dot, prominent
// "Resume →" label, opponent line, course line, copy-code chip.
function LiveMatchCard({ o, userId, onResume, onCopyCode, copied, onDelete }) {
  const opp = fmtOpponents(o.opponent_names)
  // When no opponents have joined yet, the auto-generated match name like
  // "Matt Lavin's Match" reads better as the title with "Waiting for players"
  // than the awkward "You vs Matt Lavin's Match".
  const title = opp ? `You vs ${opp}` : (o.name || 'New match')
  // If the host set an expected player count, show how many slots are
  // still empty. Falls back to the generic "Waiting for players" copy
  // when expected_players wasn't recorded on this match.
  const remaining = Number.isFinite(Number(o.expected_players)) && Number(o.expected_players) > 0
    ? Math.max(0, Number(o.expected_players) - Number(o.player_count || 0))
    : null
  const subtitle = opp
    ? (remaining > 0 ? `Waiting for ${remaining} more` : null)
    : (remaining > 0 ? `Waiting for ${remaining} more` : 'Waiting for players')

  // 2026-05-01 — Matt: swipe-left to delete uncompleted matches the
  // user created. Only the host (creator) can delete, and only while
  // the match is still active. Non-hosts get the regular tap-to-resume
  // behavior with no swipe affordance.
  const canDelete = !!onDelete && userId != null && String(o.host_id) === String(userId)
  const REVEAL_PX = 88   // how far the card slides left to expose Delete
  const TRIGGER_PX = 50  // pull threshold to snap to the open state

  const [swipeX, setSwipeX] = useState(0)        // current horizontal offset (negative for left)
  const [opened, setOpened] = useState(false)    // snapped-open state
  const [confirming, setConfirming] = useState(false)
  const startXRef = useRef(null)
  const startYRef = useRef(null)
  const movedRef  = useRef(false)

  function onTouchStart(e) {
    if (!canDelete) return
    const t = e.touches[0]
    startXRef.current = t.clientX
    startYRef.current = t.clientY
    movedRef.current = false
  }
  function onTouchMove(e) {
    if (!canDelete || startXRef.current == null) return
    const t = e.touches[0]
    const dx = t.clientX - startXRef.current
    const dy = t.clientY - startYRef.current
    // Only treat as horizontal swipe if dominant axis is X — otherwise
    // let the page scroll vertically.
    if (Math.abs(dy) > Math.abs(dx) && !movedRef.current) return
    movedRef.current = true
    // Clamp: only allow leftward swipe; cap at -REVEAL_PX
    const next = Math.max(-REVEAL_PX, Math.min(0, opened ? dx - REVEAL_PX : dx))
    setSwipeX(next)
  }
  function onTouchEnd() {
    if (!canDelete) return
    if (swipeX <= -TRIGGER_PX) {
      setSwipeX(-REVEAL_PX)
      setOpened(true)
    } else {
      setSwipeX(0)
      setOpened(false)
    }
    startXRef.current = null
    startYRef.current = null
  }
  function handleCardClick(e) {
    // Suppress the resume tap if this was the end of a swipe gesture
    // or if the card is currently open (the open state's primary
    // action is the Delete button on the right).
    if (movedRef.current || opened) {
      e.preventDefault()
      e.stopPropagation()
      if (opened) { setSwipeX(0); setOpened(false) }
      movedRef.current = false
      return
    }
    onResume?.()
  }

  return (
    <div style={{ position: 'relative', marginBottom: 8, overflow: 'hidden', borderRadius: 16 }}>
      {/* Red delete affordance behind the card. */}
      {canDelete && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: REVEAL_PX,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #B91C1C, #7F1D1D)',
        }}>
          <button
            onClick={async (e) => {
              e.stopPropagation()
              if (confirming) {
                setConfirming(false)
                await onDelete?.()
              } else {
                setConfirming(true)
                setTimeout(() => setConfirming(false), 3000) // auto-cancel after 3s
              }
            }}
            style={{
              background: 'transparent', border: 'none',
              color: '#fff', fontWeight: 800, fontSize: 12,
              letterSpacing: '0.06em',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
            </svg>
            {confirming ? 'CONFIRM' : 'DELETE'}
          </button>
        </div>
      )}

      {/* Card foreground — translates left when swiped. */}
      <div
        onClick={handleCardClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          cursor: 'pointer',
          background: 'linear-gradient(135deg, rgba(46,158,69,0.18), rgba(255,255,255,0.85))',
          border: '1.5px solid rgba(46,158,69,0.45)',
          borderRadius: 16, padding: '14px 16px',
          boxShadow: '0 4px 20px rgba(46,158,69,0.18), inset 0 1px 0 rgba(255,255,255,0.5)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', gap: 12,
          transform: `translateX(${swipeX}px)`,
          transition: startXRef.current == null ? 'transform 200ms ease' : 'none',
          touchAction: canDelete ? 'pan-y' : 'auto',
        }}
      >
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
            <button onClick={(e) => { e.stopPropagation(); onCopyCode?.(e) }} style={{
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
  const { code, name, winner, podium = [], highlights, course, course_par, format } = summary
  const [shared, setShared] = useState(false)
  const [linkShared, setLinkShared] = useState(false)

  async function share() {
    const lines = [`${winner?.name} wins ${winner?.name ? '"' + (course || 'The Match') + '"' : ''}!`]
    podium.forEach((p, i) => {
      const sign = p.diff >= 0 ? `+${p.diff}` : `${p.diff}`
      lines.push(`${i + 1}. ${p.name}  ${p.total}  (${sign})`)
    })
    if (highlights?.most_eagles)  lines.push(`${highlights.most_eagles.name} — ${highlights.most_eagles.count} eagle${highlights.most_eagles.count !== 1 ? 's' : ''}`)
    if (highlights?.most_birdies) lines.push(`Most birdies: ${highlights.most_birdies.name} (${highlights.most_birdies.count})`)
    if (code) lines.push(`Live board: ${window.location.origin}/?live=${code}`)
    lines.push('Tracked on The Match')
    const text = lines.join('\n')
    if (navigator.share) {
      try { await navigator.share({ text }) } catch {}
    } else {
      await navigator.clipboard.writeText(text)
      setShared(true); setTimeout(() => setShared(false), 2500)
    }
  }

  // Share the public final-results URL — same /?live=CODE link
  // used during play, but the public board now reads 'FINAL RESULTS'
  // for ended outings. (Round 8 audit.)
  async function shareLink() {
    if (!code) return
    const url = `${window.location.origin}/?live=${code}`
    if (navigator.share) {
      try { await navigator.share({ title: name || 'The Match', url, text: `${name || 'Match'} — final leaderboard` }) } catch {}
    } else {
      await navigator.clipboard.writeText(url)
      setLinkShared(true); setTimeout(() => setLinkShared(false), 2500)
    }
  }

  const podiumColors = ['#E8C05A', 'rgba(255,255,255,0.5)', '#CD7F32']

  return (
    <div data-no-pull-refresh="true" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent', overflowY: 'auto' }}>
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
        {/* Live link share — sends the public final-results URL.
            Lets the commissioner drop a clickable link in the group
            chat that opens a beautiful FINAL leaderboard for anyone,
            no app required. (Round 8 audit.) */}
        {code && (
          <button onClick={shareLink} style={{
            width: '100%', padding: '14px', borderRadius: 14, cursor: 'pointer',
            background: 'rgba(94,212,122,0.10)', border: '1px solid rgba(94,212,122,0.35)',
            color: '#5ED47A', fontWeight: 800, fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            {linkShared ? 'Link copied!' : 'Share live link'}
          </button>
        )}
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
  { id: 'best_ball', label: 'Best Ball',      desc: 'Best of each team per hole — pairs or foursomes' },
]
const TEAMS = [
  { id: 'individual', label: 'Individual',     desc: 'Everyone scores for themselves — head-to-head records tracked' },
  { id: 'teams',      label: '2 Teams',        desc: 'Split your group into two teams — you assign players after' },
  { id: 'big_team',   label: 'Multiple Teams', desc: 'Create 3 or more teams — ideal for larger groups' },
]

// For outings > 4 players. Replaces the "Competition Structure" step
// (TEAMS) with a simpler 3-button question: how is the field split
// into competitive units within each foursome? Maps directly to the
// team_breakdown column on tm_outings (migration 013).
const TEAM_BREAKDOWNS = [
  { id: 'singles',   label: 'Singles',   desc: 'No teams — everyone plays for themselves across all foursomes' },
  { id: 'doubles',   label: 'Doubles',   desc: '2-vs-2 within each foursome — paired by join order' },
  { id: 'foursomes', label: 'Foursomes', desc: 'Each foursome is one team — group-vs-group competition' },
]

// CoursePicker — search-as-you-type for real courses (GolfCourseAPI via
// /api/courses/search). When the host picks a course, it loads the full
// course detail and lets them choose a tee; the resulting hole_pars[] flows
// up to the wizard via onPick. Includes a "type your own" fallback for
// courses that aren't in the API. (2026-04-30)
function CoursePicker({ value, onPick, onClear, onTypedName, onCourseTeeSelected }) {
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
      // Tee rating + slope from GolfCourseAPI. Captured here so the
      // match-end handler can write a USGA-method differential into
      // the tm_rounds row. Falls back to par-based differential when
      // these are absent (free tier / unrated course).
      // (2026-05-01)
      courseRating: tee.course_rating ?? null,
      slopeRating:  tee.slope_rating ?? null,
    })
    // Parallel emission of the full {course, tee} pair so the App-level
    // sharedCourse can be updated for cross-tab sync with EagleEye.
    // (2026-05-01)
    onCourseTeeSelected?.({ course: openCourse, tee })
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

// Derive the slim form-friendly course shape from the App-level
// sharedCourse {course, tee} pair. Used by CreateWizard's initial state
// when the user navigates here with a course already selected from
// EagleEye or a previous match. (2026-05-01)
function deriveSlimFromSharedCourse(sc) {
  if (!sc?.course || !sc?.tee) return null
  const holes = sc.tee.holes || []
  return {
    courseId:      sc.course.id,
    courseName:    sc.course.club_name || sc.course.course_name,
    courseTee:     sc.tee.tee_name,
    holePars:      holes.map(h => h.par),
    holeYardages:  holes.map(h => h.yardage),
    holeHandicaps: holes.map(h => h.handicap),
    coursePar:     sc.tee.par_total,
  }
}

function CreateWizard({ user, onClose, onCreated, pendingPlayers = [], pendingLeagueId = null, sharedCourse = null, onCourseSelected }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState(() => {
    // Pre-fill from sharedCourse so the wizard opens with a course
    // already selected when the user got here via EagleEye -> Scorecard.
    const slim = deriveSlimFromSharedCourse(sharedCourse)
    return {
      name: '',
      courseName: slim?.courseName || '',
      format: 'stroke',
      team: 'individual',
      holes: 18,
      // Expected total golfers in the match. Defaults to 1 + any
      // pre-filled players (e.g. when this wizard was opened from a
      // schedule modal that already knows the group size). Capped
      // at 150 — large outings split into foursomes.
      players: Math.max(2, Math.min(150, 1 + (pendingPlayers?.length || 0))),
      // For outings > 4, the host picks how the field is divided into
      // competitive units within each foursome. See migration 013.
      // Null for small outings — the legacy team_format field handles
      // their 1v1 / 2v2 setup.
      teamBreakdown: null,
      // Handicap allowance percentage. 100 = full handicap; common
      // alternatives are 80/85/90/95 for various tournament formats.
      // (B4a)
      handicapAllowance: 100,
      // Stableford preset: 'standard' (USGA traditional 1-2-3-4),
      // 'modified' (PGA Tour Reno-Tahoe -3/-1/0/2/5), or 'custom' so
      // the league can author its own point map. Only meaningful when
      // format='stableford'. (B4b · 6.5)
      stablefordPreset: 'standard',
      // 6.5 — Custom Stableford point map. Used only when
      // stablefordPreset === 'custom'. Initialized to the standard
      // map so partial edits yield a sensible scoreboard.
      customStablefordPoints: { double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1 },
      // No-show policy default. Item 6 + Round 4 audit fix: was
      // previously undefined in form init, which worked only because
      // server defaults to 'dns'. Initializing here makes the wizard's
      // own state reads consistent.
      noShowPolicy: 'dns',
      // Real course data captured by the picker; null when host opts out
      courseId:      slim?.courseId ?? null,
      courseTee:     slim?.courseTee ?? null,
      holePars:      slim?.holePars ?? null,
      holeYardages:  slim?.holeYardages ?? null,
      holeHandicaps: slim?.holeHandicaps ?? null,
      coursePar:     slim?.coursePar ?? null,    // computed from picked tee's par_total when set
      // Rating + slope (captured by CoursePicker when the tee carries them)
      courseRating: null,
      slopeRating:  null,
    }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 2026-05-02 — When opened from a league, fetch league.config and
  // seed the form with its default rules. This is what bridges the
  // per-event tooling (handicap allowance, Stableford map, no-show
  // policy) DOWN from the league level so commissioners only set
  // those rules once. Form fields stay editable — host can override
  // for a particular event without affecting the league default.
  const [linkedLeague, setLinkedLeague] = useState(null)
  // Round 14 audit fix — user-touched flag. Without it, a user who
  // starts editing the wizard form BEFORE the league pre-fill fetch
  // completes (~500ms) gets their edits clobbered when the response
  // lands. The flag flips true the first time `set()` is called and
  // gates the pre-fill setForm.
  const userTouchedRef = useRef(false)
  useEffect(() => {
    if (!pendingLeagueId) { setLinkedLeague(null); return }
    let cancelled = false
    api(`/api/leagues/${pendingLeagueId}`)
      .then(d => {
        if (cancelled || !d?.league) return
        setLinkedLeague(d.league)
        if (userTouchedRef.current) {
          // User started editing before fetch landed — respect their
          // choices. They can still see the linked-league banner and
          // edit any field they want.
          return
        }
        const l = d.league
        const cfg = (l.config && typeof l.config === 'object') ? l.config : {}
        setForm(f => ({
          ...f,
          // Default scoring format flows down. Host can change it.
          format: l.scoring_format || f.format,
          // Handicap allowance, no-show policy from config.
          handicapAllowance: Number.isFinite(Number(cfg.handicap_allowance))
            ? Number(cfg.handicap_allowance) : f.handicapAllowance,
          // Stableford map: the league may store either a preset name
          // ('standard'/'modified') or a full custom point map. Both
          // get translated into the wizard's two pieces of state.
          stablefordPreset: cfg.stableford_preset || f.stablefordPreset,
          customStablefordPoints: (cfg.stableford_points && typeof cfg.stableford_points === 'object')
            ? cfg.stableford_points
            : f.customStablefordPoints,
          // No-show policy threads through state on the outing itself
          // (see outings.js create handler). Stored separately so the
          // POST body can carry it.
          noShowPolicy: cfg.no_show_policy || f.noShowPolicy,
          // Default expected players if league sets a target field count.
          ...(Number.isFinite(Number(cfg.expected_players))
            ? { players: Math.max(2, Math.min(150, Math.round(Number(cfg.expected_players)))) }
            : {}),
        }))
      })
      .catch(() => { /* silently fall through to wizard defaults */ })
    return () => { cancelled = true }
  }, [pendingLeagueId])

  function set(k, v) {
    userTouchedRef.current = true   // round 14 — gate the league pre-fill
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleCreate() {
    setLoading(true); setError('')
    try {
      // Validation: best_ball requires team membership. Players are
      // assigned a team_id either through the small-outing TEAMS
      // setup (team_format='teams') OR the >4 team_breakdown
      // ('doubles' / 'foursomes'). Without one of those there's no
      // grouping for the per-team math, so block creation rather
      // than ship a confusing leaderboard. (Iteration fix B4d-2.)
      if (form.format === 'best_ball') {
        const hasSmallTeams = form.players <= 4 && form.team !== 'individual'
        const hasLargeTeams = form.players > 4 && (form.teamBreakdown === 'doubles' || form.teamBreakdown === 'foursomes')
        if (!hasSmallTeams && !hasLargeTeams) {
          setLoading(false)
          setError(form.players <= 4
            ? 'Best Ball needs teams. Pick "2 Teams" or "Multiple Teams" on the next step.'
            : 'Best Ball needs teams. Pick "Doubles" or "Foursomes" on the next step.')
          return
        }
      }

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
        // Tee rating + slope (paid-tier USGA handicap inputs). Server
        // stores nulls when the picked tee didn't carry them.
        courseRating:  form.courseRating ?? null,
        slopeRating:   form.slopeRating  ?? null,
        // Expected total golfers in the match (host + opponents). Used
        // by the Match page Live Now card to show "waiting for N more"
        // until the slots fill in.
        expectedPlayers: form.players,
        // Only meaningful for > 4. Server ignores when count ≤ 4.
        teamBreakdown: form.players > 4 ? form.teamBreakdown : null,
        // Handicap allowance % for net scoring. (B4a)
        handicapAllowance: form.handicapAllowance,
        // Stableford preset (only used when format=stableford). (B4b)
        stablefordPreset: form.format === 'stableford' ? form.stablefordPreset : null,
        // 6.5 — when the host picked Custom, ship the point map.
        // Server validates each bucket and falls back to standard if
        // anything's malformed.
        customStablefordPoints: form.format === 'stableford' && form.stablefordPreset === 'custom'
          ? form.customStablefordPoints
          : null,
        // 2026-05-02 — when the wizard was opened from inside a league,
        // attach the new event to that league. Server validates that
        // the caller is a league member or commissioner before honoring.
        leagueId: pendingLeagueId || null,
        // No-show policy default flows from the league or wizard form.
        // Server normalizes / falls back to 'dns' if missing. (Item 6.)
        noShowPolicy: form.noShowPolicy || null,
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
      {/* Linked-to-league hint banner — surfaces when wizard was opened
          from inside a league. Tells the host the new event will
          inherit league rules + auto-attach. (2026-05-02) */}
      {linkedLeague && (
        <div style={{
          padding: '10px 12px', borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(245,215,138,0.18), rgba(201,160,64,0.10))',
          border: '1px solid rgba(245,215,138,0.45)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: 'rgba(201,160,64,0.20)',
            border: '1px solid rgba(201,160,64,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* Round 27 audit — emoji 🏆 replaced with bespoke SVG to
                match the rest of the app's Augusta iconography. */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C9A040" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/>
              <path d="M8 6H6a2 2 0 0 0 2 2"/>
              <path d="M16 6h2a2 2 0 0 1-2 2"/>
              <line x1="12" y1="12" x2="12" y2="16"/>
              <line x1="9" y1="20" x2="15" y2="20"/>
              <line x1="10" y1="16" x2="14" y2="16"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#7A5800', textTransform: 'uppercase' }}>
              Event for league
            </div>
            <div style={{
              fontSize: 14, fontWeight: 800, color: 'var(--tm-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{linkedLeague.name}</div>
            <div style={{ fontSize: 10, color: 'rgba(13,31,18,0.55)', marginTop: 1 }}>
              Format + handicap rules + Stableford map prefilled from the league. Edit any field to override for this event only.
            </div>
          </div>
        </div>
      )}
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
            courseRating:  picked.courseRating ?? null,
            slopeRating:   picked.slopeRating  ?? null,
          }))}
          onClear={() => setForm(f => ({
            ...f,
            courseId:      null,
            courseTee:     null,
            holePars:      null,
            holeYardages:  null,
            holeHandicaps: null,
            coursePar:     null,
            courseRating:  null,
            slopeRating:   null,
          }))}
          onTypedName={text => set('courseName', text)}
          onCourseTeeSelected={onCourseSelected}
        />
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Holes</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[9,18].map(h => <button key={h} onClick={() => set('holes', h)} style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--tm-radius)', border: '1px solid', borderColor: form.holes === h ? 'var(--tm-green)' : 'var(--tm-border)', background: form.holes === h ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)', color: form.holes === h ? 'var(--tm-green-text)' : 'var(--tm-text-2)', fontWeight: 700 }}>{h} Holes</button>)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Golfers</div>
        {/* Stepper +/- around a numeric value, plus quick-pick chips
            for common sizes. Supports 2-150; large outings (>4)
            unlock a Team Breakdown step. (2026-05-01) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button
            onClick={() => set('players', Math.max(2, Number(form.players) - 1))}
            disabled={Number(form.players) <= 2}
            style={{
              width: 44, height: 44, borderRadius: 'var(--tm-radius)',
              border: '1px solid var(--tm-border)',
              background: 'var(--tm-surface-2)',
              color: Number(form.players) <= 2 ? 'var(--tm-text-3)' : 'var(--tm-text)',
              fontSize: 22, fontWeight: 800, cursor: Number(form.players) <= 2 ? 'default' : 'pointer',
            }}
          >−</button>
          <input
            type="number" inputMode="numeric" min={2} max={150}
            value={form.players}
            onChange={e => {
              const n = Math.max(2, Math.min(150, Math.round(Number(e.target.value) || 2)))
              set('players', n)
            }}
            style={{
              flex: 1, textAlign: 'center', fontSize: 22, fontWeight: 800,
              background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border-2)',
              borderRadius: 'var(--tm-radius)', color: 'var(--tm-text)',
              padding: '10px 0', outline: 'none',
            }}
          />
          <button
            onClick={() => set('players', Math.min(150, Number(form.players) + 1))}
            disabled={Number(form.players) >= 150}
            style={{
              width: 44, height: 44, borderRadius: 'var(--tm-radius)',
              border: '1px solid var(--tm-border)',
              background: 'var(--tm-surface-2)',
              color: Number(form.players) >= 150 ? 'var(--tm-text-3)' : 'var(--tm-text)',
              fontSize: 22, fontWeight: 800, cursor: Number(form.players) >= 150 ? 'default' : 'pointer',
            }}
          >+</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[4,8,12,16,24,32,48,72,100,144].map(n => (
            <button key={n} onClick={() => set('players', n)} style={{
              padding: '6px 12px',
              borderRadius: 999, border: '1px solid',
              borderColor: Number(form.players) === n ? 'var(--tm-green)' : 'var(--tm-border)',
              background:  Number(form.players) === n ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)',
              color:       Number(form.players) === n ? 'var(--tm-green-text)' : 'var(--tm-text-2)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{n}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 8 }}>
          Including you. {Number(form.players) > 4
            ? `Splits into ${Math.ceil(Number(form.players) / 4)} foursomes — you'll pick a team breakdown next.`
            : 'Used to show "waiting for N more" on the Live card.'}
        </div>
      </div>
    </div>,

    // Step 1: Format + handicap allowance %
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

      {/* Stableford preset (only when format=stableford). Standard =
          1/2/3/4 (USGA traditional); Modified = -3/-1/0/2/5 (PGA Tour
          Reno-Tahoe variant). Custom = league-authored point map (6.5). */}
      {form.format === 'stableford' && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Stableford Preset
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { id: 'standard', label: 'Standard', desc: 'Bogey 1 · Par 2 · Birdie 3 · Eagle 4' },
              { id: 'modified', label: 'Modified', desc: 'Bogey −1 · Par 0 · Birdie 2 · Eagle 5 · Double −3' },
              { id: 'custom',   label: 'Custom',   desc: 'Set your league’s own point map below' },
            ].map(opt => (
              <button key={opt.id} onClick={() => set('stablefordPreset', opt.id)} style={{
                flex: '1 1 30%', minWidth: 110, padding: '10px 12px', borderRadius: 'var(--tm-radius)',
                border: '1px solid', borderColor: form.stablefordPreset === opt.id ? 'var(--tm-green)' : 'var(--tm-border)',
                background: form.stablefordPreset === opt.id ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)',
                color: 'var(--tm-text)', textAlign: 'left', cursor: 'pointer',
              }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{opt.label}</div>
                <div style={{ fontSize: 10, color: 'var(--tm-text-3)', marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
          {/* 6.5 — Custom point map editor. Renders inline when 'custom'
              is selected. 7 buckets, each 0-20 (or down to -10 for
              penalty schemes like the modified variant). */}
          {form.stablefordPreset === 'custom' && (
            <div style={{
              marginTop: 10, padding: '12px',
              background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
              borderRadius: 'var(--tm-radius)',
            }}>
              <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginBottom: 8, lineHeight: 1.4 }}>
                Points awarded for each score relative to par. Range −10 to 20. The leaderboard recomputes live as players score.
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8,
              }}>
                {[
                  { key: 'double_eagle', label: 'Double Eagle (−3)' },
                  { key: 'eagle',        label: 'Eagle (−2)' },
                  { key: 'birdie',       label: 'Birdie (−1)' },
                  { key: 'par',          label: 'Par' },
                  { key: 'bogey',        label: 'Bogey (+1)' },
                  { key: 'double',       label: 'Double (+2)' },
                  { key: 'worse',        label: 'Triple+ (+3 or worse)' },
                ].map(b => {
                  const v = form.customStablefordPoints?.[b.key]
                  return (
                    <label key={b.key} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 8, padding: '6px 8px',
                      background: 'var(--tm-surface)', border: '1px solid var(--tm-border)',
                      borderRadius: 8,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-text-2)' }}>{b.label}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        step="1"
                        min="-10"
                        max="20"
                        value={v == null ? '' : v}
                        onChange={e => {
                          const raw = e.target.value
                          set('customStablefordPoints', {
                            ...(form.customStablefordPoints || {}),
                            [b.key]: raw === '' ? 0 : Number(raw),
                          })
                        }}
                        style={{
                          width: 56, height: 30, textAlign: 'center',
                          fontSize: 14, fontWeight: 800, color: 'var(--tm-text)',
                          background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
                          borderRadius: 6,
                        }}
                      />
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Handicap allowance — 100% means full hcp, lower percentages
          are common in tournament settings (member-guest 80%, 4ball
          stroke 85%, singles match 90%, stroke tournaments 95%).
          Only relevant when scoring is net; no harm if gross. (B4a) */}
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Handicap Allowance
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[100, 95, 90, 85, 80, 75].map(pct => (
            <button key={pct} onClick={() => set('handicapAllowance', pct)} style={{
              padding: '6px 12px', borderRadius: 999, border: '1px solid',
              borderColor: form.handicapAllowance === pct ? 'var(--tm-green)' : 'var(--tm-border)',
              background:  form.handicapAllowance === pct ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)',
              color:       form.handicapAllowance === pct ? 'var(--tm-green-text)' : 'var(--tm-text-2)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{pct}%</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 6 }}>
          {form.handicapAllowance === 100 ? 'Full handicap.'
           : form.handicapAllowance >= 95 ? 'Stroke-play tournament standard.'
           : form.handicapAllowance >= 90 ? 'Singles match-play standard.'
           : form.handicapAllowance >= 85 ? '4-ball stroke / better-ball.'
           : form.handicapAllowance >= 80 ? 'Member-guest / scramble standard.'
           : 'Scramble.'}
        </div>
      </div>
    </div>,

    // Step 2: Competition Structure — content forks on player count.
    // ≤4 players → existing TEAMS picker (individual / 2 teams / multi).
    // >4 players  → TEAM_BREAKDOWNS picker (singles / doubles / foursomes).
    Number(form.players) > 4 ? (
      <div key="2-large" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginBottom: 4 }}>
          {Math.ceil(Number(form.players) / 4)} foursomes · {form.players} golfers
        </div>
        {TEAM_BREAKDOWNS.map(t => (
          <button key={t.id} onClick={() => set('teamBreakdown', t.id)}
            style={{ padding: '16px', borderRadius: 'var(--tm-radius-lg)', border: '2px solid', borderColor: form.teamBreakdown === t.id ? 'var(--tm-gold)' : 'var(--tm-border)', background: form.teamBreakdown === t.id ? 'var(--tm-gold-muted)' : 'var(--tm-surface)', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15 }}>{t.label}</div>
              <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginTop: 2 }}>{t.desc}</div>
            </div>
            {form.teamBreakdown === t.id && <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--tm-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--tm-text-inv)', fontSize: 11, fontWeight: 800 }}>✓</div>}
          </button>
        ))}
      </div>
    ) : (
      <div key="2-small" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
      </div>
    ),
  ]

  // Step 2's title shifts when the outing is large — same step number,
  // different question.
  const stepTitles = [
    'Set the Stage',
    'Scoring Format',
    Number(form.players) > 4 ? 'Team Breakdown' : 'Competition Structure',
  ]

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
function ScorecardCell({ score, par, canEdit, onTap, isSubtotal, isHint, overrideBg, overrideBorder, overrideColor, w = 32, h = 36, skinsBadge = null }) {
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
      className={isHint ? 'tm-tap-hint' : undefined}
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
        // When isHint is active, skip inline shadow so the tm-tap-hint
        // keyframe (which animates box-shadow) takes over without being
        // overridden by an inline style.
        boxShadow: isHint
          ? undefined
          : isSubtotal
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
      {/* Skins badge — overlaid in top-right when the player won this
          hole's skin (W) or the hole rolled forward (↻). 'W' is gold;
          carry mark uses cream + a small stack indicator showing how
          many skins are riding. (B4c polish — final pass.) */}
      {skinsBadge && skinsBadge.kind === 'win' && (
        <div title={`Won this skin${skinsBadge.value > 1 ? ` (${skinsBadge.value} skins)` : ''}`} style={{
          position: 'absolute', top: 1, right: 1,
          background: '#C9A040', color: '#070C09',
          fontSize: 7, fontWeight: 900, lineHeight: 1, letterSpacing: 0,
          padding: '1px 3px', borderRadius: 2,
          pointerEvents: 'none',
        }}>{skinsBadge.value > 1 ? `W${skinsBadge.value}` : 'W'}</div>
      )}
      {skinsBadge && skinsBadge.kind === 'carry' && (
        <div title={`Carrying ${skinsBadge.value} skin${skinsBadge.value !== 1 ? 's' : ''} forward`} style={{
          position: 'absolute', top: 1, right: 1,
          background: 'rgba(0,0,0,0.55)', color: AUGUSTA_CREAM,
          fontSize: 8, fontWeight: 800, lineHeight: 1,
          padding: '1px 3px', borderRadius: 2,
          pointerEvents: 'none',
        }}>↻{skinsBadge.value}</div>
      )}
    </div>
  )
}

// Score entry modal — stepper + quick picks
function ScoreModal({ playerName, hole, par, currentScore, holeCount, onSave, onSaveAndEagleEye, onClose }) {
  const [val, setVal] = useState(currentScore || par || 4)

  const quickPicks = [
    { label: 'Eagle',  diff: -2 },
    { label: 'Birdie', diff: -1 },
    { label: 'Par',    diff:  0 },
    { label: 'Bogey',  diff: +1 },
    { label: 'Double', diff: +2 },
  ].map(q => ({ ...q, score: (par || 4) + q.diff })).filter(q => q.score >= 1)

  // The "Save & Eagle Eye →" second action is enabled only when the parent
  // wired it (i.e., user is scoring their own hole AND there's a next hole
  // to advance to). The next hole label is hole+2 in 1-indexed display
  // since `hole` is 0-indexed. (2026-05-01)
  const nextHoleDisplay = hole + 2  // 1-indexed; safe — parent already capped

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

        <button onClick={() => {
          // Typo guard — most "11 on a par-3" entries are mis-taps.
          // Warn when score is more than +5 over par (or 2× par,
          // whichever is higher). Round 4 audit.
          const overBy = val - (par || 4)
          const isUnusual = overBy >= 5 || val > (par || 4) * 2
          if (isUnusual) {
            const ok = window.confirm(
              `${val} on a par-${par || 4}? That's ${overBy} over par. ` +
              `Tap Cancel to fix it, OK to save anyway.`
            )
            if (!ok) return
          }
          onSave(val)
        }} style={{
          width: '100%', padding: 16, borderRadius: 'var(--tm-radius-lg)',
          background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
          color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 16, border: 'none', cursor: 'pointer',
        }}>Save Score</button>

        {/* Save & Eagle Eye → second action. Saves the score AND jumps to
            Eagle Eye on the next hole — tightest one-tap loop for
            "play hole, score it, look at next hole's strategy." Only
            renders when parent supplied the callback (user scoring own
            hole + next hole exists). (2026-05-01) */}
        {onSaveAndEagleEye && (
          <button onClick={() => onSaveAndEagleEye(val)} style={{
            width: '100%', padding: 14, marginTop: 10, borderRadius: 'var(--tm-radius-lg)',
            // Solid green gradient + white text — matches the primary green
            // button pattern used elsewhere in the app (CreateWizard "Next →",
            // CodeShare "Open Match", etc.) for consistency and high contrast.
            // (2026-05-01 — Matt feedback: gold-on-faint-white was hard to see)
            background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))',
            border: 'none',
            color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            Save &amp; Eagle Eye · Hole {nextHoleDisplay}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── Bulk Score Modal (6.2) ──────────────────────────────────────────────────
// Host-only bulk entry for an entire foursome on a single hole. Opens when
// the host taps a hole numeral on the scorecard header. Shows one row per
// player in the active group, pre-filled with their existing score (or
// blank). The "Save all" button writes them in sequence via the parent's
// onSaveAll(entries) — empty rows are dropped, only changed rows actually
// hit the server. Designed for a commissioner collecting a paper card from
// a foursome at the turn or after the round. (2026-05-02)
function BulkScoreModal({ hole, par, participants, getScores, holeCount, onClose, onSaveAll }) {
  // Local edit state per participant — keyed by user_id. Empty string = blank
  // row (skipped on save). Numbers stored as strings to allow trailing
  // edits; coerced to int on save.
  const [vals, setVals] = useState(() => {
    const m = {}
    for (const p of participants) {
      const sc = getScores(p) || []
      m[p.user_id] = sc[hole] > 0 ? String(sc[hole]) : ''
    }
    return m
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // First blank input gets focus on open — so the host can start typing
  // immediately without an extra tap. (UX)
  const firstInputRef = useRef(null)
  useEffect(() => {
    if (firstInputRef.current) firstInputRef.current.focus()
  }, [])

  function setVal(uid, raw) {
    // Allow only digits, max 2 chars (covers up to 99 — way more than any
    // real golf score). Empty string is fine for "skip this row."
    const cleaned = String(raw).replace(/[^\d]/g, '').slice(0, 2)
    setVals(prev => ({ ...prev, [uid]: cleaned }))
  }

  function bumpVal(uid, delta) {
    setVals(prev => {
      const cur = parseInt(prev[uid], 10)
      const base = Number.isFinite(cur) ? cur : (par || 4)
      const next = Math.max(1, Math.min(99, base + delta))
      return { ...prev, [uid]: String(next) }
    })
  }

  // Count rows with a real score so we can label the button. Empty inputs
  // are intentionally skipped — the host can leave the field blank if a
  // player picked up or didn't post.
  const filledEntries = participants
    .map(p => ({ userId: p.user_id, name: p.name, raw: vals[p.user_id] }))
    .filter(e => e.raw !== '' && e.raw != null)
    .map(e => ({ userId: e.userId, name: e.name, score: parseInt(e.raw, 10) }))
    .filter(e => Number.isFinite(e.score) && e.score >= 1)

  // Detect which rows actually changed vs. their pre-existing score so we
  // don't generate "no-op" PUTs that flood the audit log. (B2 audit row
  // creation is gated on a real value change, but it's cleaner to skip
  // unchanged rows up here too.)
  const changedEntries = filledEntries.filter(e => {
    const p = participants.find(pp => String(pp.user_id) === String(e.userId))
    const sc = p ? (getScores(p) || []) : []
    return Number(sc[hole]) !== e.score
  })

  // Suspicious-score guard — same heuristic as the per-player ScoreModal.
  // If ANY row is more than +5 over par or 2× par, prompt once instead of
  // surprising the host after they tap save.
  function findSuspicious() {
    return changedEntries.find(e => {
      const overBy = e.score - (par || 4)
      return overBy >= 5 || e.score > (par || 4) * 2
    })
  }

  async function handleSave() {
    if (saving) return
    setError(null)
    if (changedEntries.length === 0) {
      // Nothing to save — just close. Better UX than disabling the button
      // silently when the host opened the modal "just to look."
      onClose()
      return
    }
    const sus = findSuspicious()
    if (sus) {
      const ok = window.confirm(
        `${sus.name}: ${sus.score} on a par-${par || 4}? That's ${sus.score - (par || 4)} over. ` +
        `Tap Cancel to fix it, OK to save the batch.`
      )
      if (!ok) return
    }
    setSaving(true)
    try {
      await onSaveAll(changedEntries)
    } catch (err) {
      // Caller throws on first failure so subsequent rows don't pile on.
      // Show a banner here so the host can decide whether to retry. They
      // can dismiss the modal — already-saved rows stay saved (they
      // committed to the server before the failing row).
      setError(err?.message || 'Save failed. Already-saved rows are kept; tap Save to retry the rest.')
      setSaving(false)
    }
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end',
    }} onClick={saving ? undefined : onClose}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
        maxHeight: '85vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 14px' }} />
        {/* Title row — hole + par + helper. Subtitle adapts to the
            actual group size so a doubles match doesn't say "Foursome".
            (Round 13 edge-case audit.) */}
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--tm-gold)', textTransform: 'uppercase' }}>
            Bulk entry · {participants.length === 4 ? 'Foursome'
              : participants.length === 3 ? 'Threesome'
              : participants.length === 2 ? 'Pair'
              : `${participants.length} players`}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--tm-text)', marginTop: 4 }}>
            Hole {hole + 1}{par ? ` · Par ${par}` : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginTop: 4 }}>
            Leave blank to skip a player
          </div>
        </div>

        {/* Row per player */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {participants.map((p, idx) => {
            const raw    = vals[p.user_id] ?? ''
            const num    = parseInt(raw, 10)
            const valid  = Number.isFinite(num) && num >= 1
            const diff   = valid ? num - (par || 4) : 0
            const colorBg = valid ? cellBg(num, par) : null
            const color   = valid ? cellColor(num, par) : 'var(--tm-text-3)'
            const diffLabel = valid
              ? (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`)
              : ''
            return (
              <div key={p.user_id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                background: 'var(--tm-surface-2)',
                borderRadius: 12,
                border: '1px solid var(--tm-border)',
              }}>
                {/* Avatar / initials */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  flexShrink: 0, overflow: 'hidden',
                  background: avatarBg(p.name),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 900, fontSize: 13,
                  fontFamily: '"Arial Black", Arial, sans-serif',
                }}>
                  {p.avatar ? (
                    <img src={p.avatar} alt={p.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : initials(p.name)}
                </div>
                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 700, color: 'var(--tm-text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{p.name}</div>
                  {valid && (
                    <div style={{ fontSize: 11, fontWeight: 800, color, marginTop: 2 }}>
                      {diffLabel}
                    </div>
                  )}
                </div>
                {/* −/+ stepper hugging the input */}
                <button type="button"
                  onClick={() => bumpVal(p.user_id, -1)}
                  aria-label={`Decrement ${p.name} score`}
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: 'var(--tm-surface-3)', border: '1px solid var(--tm-border)',
                    color: 'var(--tm-text)', fontSize: 18, fontWeight: 300, cursor: 'pointer',
                  }}>−</button>
                <input
                  ref={idx === 0 ? firstInputRef : null}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={raw}
                  onChange={e => setVal(p.user_id, e.target.value)}
                  placeholder={String(par || 4)}
                  aria-label={`${p.name} score for hole ${hole + 1}`}
                  style={{
                    width: 56, height: 40, textAlign: 'center',
                    fontSize: 22, fontWeight: 900,
                    color: valid ? color : 'var(--tm-text)',
                    background: colorBg || 'var(--tm-surface)',
                    border: '1px solid var(--tm-border)',
                    borderRadius: 10,
                    fontFamily: '"Arial Black", Arial, sans-serif',
                  }}
                />
                <button type="button"
                  onClick={() => bumpVal(p.user_id, +1)}
                  aria-label={`Increment ${p.name} score`}
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: 'var(--tm-surface-3)', border: '1px solid var(--tm-border)',
                    color: 'var(--tm-text)', fontSize: 18, fontWeight: 300, cursor: 'pointer',
                  }}>+</button>
              </div>
            )
          })}
        </div>

        {error && (
          <div style={{
            background: 'rgba(220, 70, 70, 0.12)', border: '1px solid rgba(220, 70, 70, 0.40)',
            color: '#F0B0B0', padding: '10px 12px', borderRadius: 10, marginBottom: 12,
            fontSize: 12,
          }}>{error}</div>
        )}

        {/* Action row */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={saving} style={{
            flex: 1, padding: 14, borderRadius: 'var(--tm-radius-lg)',
            background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
            color: 'var(--tm-text)', fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, padding: 14, borderRadius: 'var(--tm-radius-lg)',
            background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
            color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 15, border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
          }}>
            {saving
              ? 'Saving…'
              : changedEntries.length === 0
                ? 'Nothing to save'
                : `Save ${changedEntries.length} score${changedEntries.length === 1 ? '' : 's'}`}
          </button>
        </div>
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

// Find the first cell the current user can tap to enter a score — used
// to render a pulsing gold tap-hint on it. Walks sorted players in order;
// for each player the user can edit, picks the first unscored hole.
// Returns { userId, hole } or null when nothing's tappable. Skips the hint
// once any score has been entered (the empty-board prompt only). (2026-04-30 PM round 11)
function findTapHint({ sorted, getScores, isHost, isMarkerFor, userId }) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null
  // If any score exists anywhere, no hint — the user already knows.
  const anyScored = sorted.some(p => (getScores(p) || []).some(s => s > 0))
  if (anyScored) return null
  for (const p of sorted) {
    const isMe   = String(p.user_id) === String(userId)
    const canEdit = isHost
      || (isMarkerFor ? isMarkerFor(String(userId), String(p.user_id)) : false)
      || isMe
    if (!canEdit) continue
    const sc = getScores(p) || []
    for (let h = 0; h < Math.max(18, sc.length); h++) {
      if (!sc[h]) return { userId: p.user_id, hole: h }
    }
  }
  return null
}

// Compute leaderboard positions for an already-sorted player array.
// Returns an array of strings parallel to `sorted`: "1", "T2", "3", or "—"
// for players with no scores yet. (2026-04-30 PM round 8 — rank badges)
// Tiebreak label for a player who beat the next-tied player on
// card-back. Returns 'b9' / 'l6' / 'l3' / 'lh' or null. Used by
// the scoreboard to annotate "won on back-9" so users understand
// why two equal totals got different ranks. (Iteration 3 polish for B1.)
function tiebreakReason(a, b, holePars) {
  if (!a || !b) return null
  const holeCount = holePars.length
  const lastIdx   = holeCount - 1
  function strokesToParRange(p, getScores, startIdx, endIdx) {
    const sc = (getScores ? getScores(p) : p.scores) || []
    let total = 0
    for (let i = startIdx; i <= endIdx; i++) {
      const s = sc[i] || 0
      if (s > 0) total += s - (holePars[i] || 4)
    }
    return total
  }
  const ranges = [
    ...(holeCount >= 18 ? [{ key: 'b9', s: 9, e: 17 }] : []),
    { key: 'l6', s: Math.max(0, lastIdx - 5), e: lastIdx },
    { key: 'l3', s: Math.max(0, lastIdx - 2), e: lastIdx },
    { key: 'lh', s: lastIdx, e: lastIdx },
  ]
  // Use whatever's on each participant directly; the function may be
  // called from anywhere with .scores already set on the player obj.
  const get = p => p.scores
  for (const r of ranges) {
    const ra = strokesToParRange(a, get, r.s, r.e)
    const rb = strokesToParRange(b, get, r.s, r.e)
    if (ra !== rb) return ra < rb ? r.key : null
  }
  return null
}

// Compute display rank labels (1, T2, T2, 4, ...) for a sorted-by-
// leaderboardSort participants array. Two adjacent entries are
// considered tied (sharing position) ONLY when their full multi-key
// comparison comes out equal — i.e. same total AND same card-back
// AND same last-6/3/last-hole. If any tiebreaker separated them, the
// earlier one gets the cleaner rank. (2026-05-01 — league must-have B1.)
function computePositions(sorted, getScores, holePars) {
  const holeCount = holePars.length
  const lastIdx   = holeCount - 1
  // All four tiebreaker key ranges, computed once per call.
  const tieRanges = []
  if (holeCount >= 18) tieRanges.push([9, 17])
  tieRanges.push([Math.max(0, lastIdx - 5), lastIdx])
  tieRanges.push([Math.max(0, lastIdx - 2), lastIdx])
  tieRanges.push([lastIdx, lastIdx])

  function strokesToParRange(p, startIdx, endIdx) {
    const sc = getScores(p)
    let total = 0
    for (let i = startIdx; i <= endIdx; i++) {
      const s = sc[i] || 0
      if (s > 0) total += s - (holePars[i] || 4)
    }
    return total
  }
  function totalStp(p) {
    const sc = getScores(p)
    const played = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    if (!played.length) return null
    return played.reduce((sum, x) => sum + (x.s - (holePars[x.i] || 4)), 0)
  }

  // Returns true if two players are tied through ALL tiebreaker keys.
  function fullyTied(a, b) {
    const da = totalStp(a), db = totalStp(b)
    if (da == null || db == null) return da === db
    if (da !== db) return false
    for (const [s, e] of tieRanges) {
      if (strokesToParRange(a, s, e) !== strokesToParRange(b, s, e)) return false
    }
    return true
  }

  // First pass: assign raw rank. New rank only when not tied with the
  // immediately preceding entry. Players with no scores get '—'.
  const rawRanks = []
  for (let i = 0; i < sorted.length; i++) {
    if (totalStp(sorted[i]) == null) { rawRanks.push('—'); continue }
    if (i === 0) { rawRanks.push(1); continue }
    const prevRank = rawRanks[i - 1]
    if (prevRank === '—') { rawRanks.push(i + 1); continue }
    rawRanks.push(fullyTied(sorted[i - 1], sorted[i]) ? prevRank : i + 1)
  }
  // Second pass: T-prefix any rank that appears more than once.
  const counts = {}
  rawRanks.forEach(r => { if (r !== '—') counts[r] = (counts[r] || 0) + 1 })
  return rawRanks.map(r => r === '—' ? r : counts[r] > 1 ? `T${r}` : `${r}`)
}

// ─── Display name helpers ─────────────────────────────────────────────────────
// Build a map of user_id → display name that disambiguates collisions.
// "Matt Lavin" + "Matt Smith" → "Matt L." + "Matt S." rather than
// two indistinguishable "Matt"s on the leaderboard. If two players
// share BOTH first and last initial, fall back to the full name for
// the colliding pair only. (Round 4 audit — same-name disambiguation.)
function buildDisplayNames(participants) {
  const out = {}
  // First pass: take everyone's first-name token.
  const firsts = participants.map(p => {
    const tokens = String(p.name || '').trim().split(/\s+/).filter(Boolean)
    return { id: p.user_id, full: p.name || '', first: tokens[0] || (p.name || 'Player'), tokens }
  })
  // Bucket by first name (case-insensitive). Collisions get last initials.
  const byFirst = new Map()
  for (const e of firsts) {
    const key = e.first.toLowerCase()
    if (!byFirst.has(key)) byFirst.set(key, [])
    byFirst.get(key).push(e)
  }
  for (const [, group] of byFirst) {
    if (group.length === 1) {
      out[group[0].id] = group[0].first
      continue
    }
    // Collision — try first + last initial.
    const withLi = group.map(e => {
      const last = e.tokens.length > 1 ? e.tokens[e.tokens.length - 1] : ''
      const li = last ? `${last[0].toUpperCase()}.` : ''
      return { ...e, attempt: li ? `${e.first} ${li}` : e.first }
    })
    // If the attempted names collide too, fall back to full name for those.
    const counts = {}
    for (const e of withLi) counts[e.attempt] = (counts[e.attempt] || 0) + 1
    for (const e of withLi) {
      out[e.id] = counts[e.attempt] > 1 ? (e.full || e.first) : e.attempt
    }
  }
  return out
}

// ─── Best Ball helpers ────────────────────────────────────────────────────────
// Best Ball / 4-ball: each player plays their own ball; per hole the
// team's score = the lowest member's score. The team with the lowest
// cumulative best-ball total wins.
//
// For 2-person teams (doubles team_breakdown, or small outings with
// team_format='teams' and 2 players per team), this is straightforward:
// min of two scores per hole.
//
// For 4-person teams (foursomes team_breakdown), we take min of four
// per hole. We don't currently support "two best balls of 4" (sum of
// two lowest per hole, member-guest variant) — that's a v2 add via a
// separate format option.
//
// Returns:
//   teams:           [{ id, members[], holes[], total, holesPlayed }]
//   playerTeamTotal: { user_id: team total }    so the per-player
//                    leaderboard can show each player's team standing
//
// (2026-05-01 — league must-have B4d.)
// Pre-compute the hole indexes a player gets a stroke on, based on
// course's hole_handicaps (1 = hardest, 18 = easiest). Returns a
// Set<holeIndex>. The first N strokes go to holes ranked 1..N. If
// the player gets >N strokes (rare — handicap >18), each ranked hole
// gets a SECOND stroke first before extending. For courses with no
// hole_handicaps data we fall back to flat distribution.
function strokeHolesForPlayer(player, holePars, holeHandicaps, totalStrokes) {
  if (totalStrokes <= 0) return new Map()
  const holeCount = holePars.length
  const out = new Map()

  // Decide which hole gets a stroke first, in order. With a real
  // hole_handicaps stroke index, that's the hardest-rank hole. Without
  // one, we fall back to the holes' positional order (1, 2, 3, ...)
  // — arbitrary but deterministic and stable across re-renders.
  let order
  if (Array.isArray(holeHandicaps) && holeHandicaps.length >= holeCount) {
    order = holeHandicaps
      .slice(0, holeCount)
      .map((rank, idx) => ({ idx, rank: Number(rank) || 18 }))
      .sort((a, b) => a.rank - b.rank)
      .map(x => x.idx)
  } else {
    order = Array.from({ length: holeCount }, (_, i) => i)
  }

  // Allocate INTEGER strokes by walking the order. After the first
  // pass, if more strokes remain (handicap > 18), walk again giving
  // a second stroke to each hole in the same order. (Iteration 2 fix:
  // previously the no-stroke-index path returned fractional strokes
  // which produced fractional net scores — wrong.)
  let remaining = Math.floor(totalStrokes)
  let layer = 0
  while (remaining > 0) {
    for (const idx of order) {
      if (remaining <= 0) break
      out.set(idx, (out.get(idx) || 0) + 1)
      remaining -= 1
    }
    layer += 1
    if (layer > 4) break  // sanity — handicap > 72 strokes won't happen
  }
  return out
}

function computeBestBall(participants, holePars, getScores, netStrokes, holeHandicaps) {
  // Group participants by their team_id. Players with no team_id go
  // into a synthetic 'solo:user_id' bucket so the math doesn't crash;
  // they'll just be a one-player team with their own scores.
  const teamMap = new Map()
  for (const p of participants) {
    const key = p.team_id != null ? `T:${p.team_id}` : `solo:${p.user_id}`
    if (!teamMap.has(key)) teamMap.set(key, { id: key, label: p.team_id ?? 'Solo', members: [] })
    teamMap.get(key).members.push(p)
  }

  // Pre-compute each member's per-hole stroke allocation using
  // hole_handicaps stroke index when available. This is the USGA-
  // correct way to apply net strokes in best-ball / 4-ball: hardest
  // hole first, then second-hardest, etc. (Iteration fix B4d-1.)
  const memberStrokeMap = new Map()
  for (const p of participants) {
    memberStrokeMap.set(p.user_id, strokeHolesForPlayer(p, holePars, holeHandicaps, netStrokes(p) || 0))
  }

  const teams = []
  const playerTeamTotal = {}
  for (const team of teamMap.values()) {
    let total = 0
    let holesPlayed = 0
    const holes = []
    for (let h = 0; h < holePars.length; h++) {
      const memberHoleScores = team.members.map(m => {
        const raw = (getScores(m) || [])[h] || 0
        if (raw <= 0) return null
        const stroke = memberStrokeMap.get(m.user_id)?.get(h) || 0
        return raw - stroke
      }).filter(s => s != null)
      if (memberHoleScores.length === 0) {
        holes.push(null)
        continue
      }
      const best = Math.min(...memberHoleScores)
      holes.push(best)
      total += best
      holesPlayed += 1
    }
    teams.push({ id: team.id, label: team.label, members: team.members, holes, total, holesPlayed })
    for (const m of team.members) playerTeamTotal[m.user_id] = total
  }
  teams.sort((a, b) => a.total - b.total)
  return { teams, playerTeamTotal }
}

// ─── Stableford helpers ───────────────────────────────────────────────────────
// Stableford rewards aggressive play with a points system. Many
// variants exist; we ship two well-known presets and accept a custom
// point map per outing. Keys are score-relative-to-par buckets:
//   double_eagle: -3 (albatross)
//   eagle:        -2
//   birdie:       -1
//   par:           0
//   bogey:        +1
//   double:       +2
//   worse:        +3 or worse  (treated as one bucket — collapsing
//                 the long tail keeps the math + UI simple)
//
// Two presets (USGA traditional + PGA Tour Modified):
//
//                 STANDARD   MODIFIED
//   double-eagle   8          8
//   eagle          4          5
//   birdie         3          2
//   par            2          0
//   bogey          1         -1
//   double         0         -3
//   worse         -1         -3
//
// (2026-05-01 — league must-have B4b.)
const STABLEFORD_PRESETS = {
  standard: { double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1 },
  modified: { double_eagle: 8, eagle: 5, birdie: 2, par: 0, bogey: -1, double: -3, worse: -3 },
}

// Returns { pointsByPlayer: {user_id: number} } for the active outing.
// Uses the outing's saved point map if present, else the Standard
// preset. Skips holes with no score entered.
function computeStableford(participants, holePars, getScores, pointMap) {
  const pts = pointMap || STABLEFORD_PRESETS.standard
  const out = {}
  for (const p of participants) {
    let total = 0
    const scores = getScores(p) || []
    for (let h = 0; h < holePars.length; h++) {
      const s = scores[h] || 0
      if (s <= 0) continue
      const diff = s - (holePars[h] || 4)
      let bucket
      if (diff <= -3)      bucket = 'double_eagle'
      else if (diff === -2) bucket = 'eagle'
      else if (diff === -1) bucket = 'birdie'
      else if (diff === 0)  bucket = 'par'
      else if (diff === 1)  bucket = 'bogey'
      else if (diff === 2)  bucket = 'double'
      else                  bucket = 'worse'
      total += (pts[bucket] ?? 0)
    }
    out[p.user_id] = total
  }
  return { pointsByPlayer: out }
}

// ─── Skins helpers ────────────────────────────────────────────────────────────
// Skins with carryover: each hole has a "pot" of (1 + carryover) skins.
// If exactly one player has the lowest score on the hole, they win
// the entire pot. If two or more tie, the pot carries over to the
// next hole. After the round, players are ranked by total skins won.
//
// Holes with NO scores entered yet (everyone is at 0) don't resolve —
// they sit on hold and get re-evaluated each render. This means the
// leaderboard updates live as scores come in.
//
// Returns:
//   skinsByPlayer:  { [user_id]: count }   total skins won
//   outcomes:       array of length holeCount with one of:
//                     { winner: user_id, value }   outright
//                     { tied: true, value }        carried forward
//                     { pending: true }            not enough scores
//   pendingPot:     skins still on the table (unresolved at end)
//
// (2026-05-01 — league must-have B4c.)
function computeSkins(participants, holePars, getScores) {
  const holeCount = holePars.length
  const outcomes  = new Array(holeCount).fill(null)
  const skinsByPlayer = {}
  let carry = 0
  for (let h = 0; h < holeCount; h++) {
    // Collect this hole's scores from every participant. Treat 0 as
    // "not yet scored" so the carry sits until at least 2 players have
    // posted (less than 2 = trivially "no one wins yet").
    const entries = participants
      .map(p => ({ id: p.user_id, s: (getScores(p) || [])[h] || 0 }))
      .filter(x => x.s > 0)
    if (entries.length < 2) {
      outcomes[h] = { pending: true, carry }
      continue
    }
    let low = Infinity
    let lowCount = 0
    let lowId    = null
    for (const e of entries) {
      if (e.s < low)        { low = e.s; lowCount = 1; lowId = e.id }
      else if (e.s === low) { lowCount += 1 }
    }
    if (lowCount === 1) {
      const value = 1 + carry
      outcomes[h] = { winner: lowId, value, carry }
      skinsByPlayer[lowId] = (skinsByPlayer[lowId] || 0) + value
      carry = 0
    } else {
      outcomes[h] = { tied: true, value: 1 + carry, carry }
      carry += 1  // current hole's skin rolls forward
    }
  }
  return { skinsByPlayer, outcomes, pendingPot: carry }
}

// ─── Match Play helpers ───────────────────────────────────────────────────────
// Only meaningful for exactly 2 players. When `netMode` is on AND
// the players have different handicaps, the per-hole comparison is
// the NET score (gross minus strokes-on-this-hole) rather than the
// gross. Standard USGA singles match play with handicaps.
//
// `holeStrokes` is a Map<userId, Map<holeIdx, strokes>> built from
// strokeHolesForPlayer using the LOWER handicap as the baseline —
// the higher-handicap player gets the strokes between them on the
// hardest holes per the course's stroke index.
//
// (Round 1 fix.)
function computeMatchPlay(p1, p2, getScores, holePars, holeStrokes = null) {
  const s1 = getScores(p1), s2 = getScores(p2)
  // Per-hole stroke allocation for handicap match play. holeStrokes
  // is keyed { p1: Map, p2: Map } when the caller wants net match
  // play; null/missing → gross comparison (legacy behavior).
  const k1 = holeStrokes?.p1 || null
  const k2 = holeStrokes?.p2 || null
  let p1HolesUp = 0
  const holeResults = holePars.map((par, h) => {
    const a = s1[h] || 0, b = s2[h] || 0
    if (!a || !b) return null // not yet played
    // Subtract any strokes received on this hole. For singles match
    // play the lower-handicap player's allocation is empty; the
    // higher-handicap player gets `diff` strokes on the hardest
    // `diff` holes.
    const aAdj = a - (k1 ? (k1.get(h) || 0) : 0)
    const bAdj = b - (k2 ? (k2.get(h) || 0) : 0)
    if (aAdj < bAdj) return 'p1'
    if (bAdj < aAdj) return 'p2'
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

// ─── Match Scoreboard (Tour-page-style leaderboard view) ─────────────────────
//
// The "BOARD" alternative to the Augusta scorecard. Mirrors PGAScores.jsx
// visually so the user's match scoreboard reads like the live PGA Tour
// leaderboard — same translucent glass card, same column grid (POS, photo,
// name, TOT, [TODAY for match-play], THRU), same score colors via the
// shared scoreColors lib. (2026-05-01 — match-page completion plan, Thread 1)
//
// Read-only. Tapping a row asks the parent to switch back to the SCORECARD
// view focused on that player (handled by the parent via onPlayerTap).
function MatchScoreboard({
  participants,            // already-sorted by leaderboardSort
  positions,               // computed by computePositions()
  getScores,
  holePars,
  holeCount,
  netMode,
  hcpAllowance = 100,      // % of raw handicap to apply (B4a)
  isMatchPlay,
  matchPlayData,
  diffStr,                 // gross score-to-par for holes played
  netDiffStr,              // net score-to-par for holes played
  user,
  onPlayerTap,             // (userId) => void — jump to scorecard focused on player
  isSkinsFormat = false,   // when true, render per-row 'N SK' badge (B4c polish)
  skinsByPlayer = {},      // { user_id: skinsWonCount }
}) {
  // Tiebreak hints — for each row that's tied on total with the row
  // below it, surface a tiny pill ('B9' / 'L6' / 'L3' / 'LH') so
  // players understand why the cleaner rank went to one over the
  // other. (Iteration 3 polish for B1.)
  function tiebreakHint(i) {
    if (isMatchPlay || isSkinsFormat) return null  // those use different sort keys
    const a = participants[i]
    const b = participants[i + 1]
    if (!a || !b) return null
    // Only hint when the two are tied on TOTAL strokes-to-par.
    const totalSTP = (p) => {
      const sc = getScores(p) || []
      let stp = 0
      for (let h = 0; h < holePars.length; h++) {
        const s = sc[h] || 0
        if (s > 0) stp += s - (holePars[h] || 4)
      }
      return sc.some(x => x > 0) ? stp : null
    }
    const ta = totalSTP(a), tb = totalSTP(b)
    if (ta == null || tb == null || ta !== tb) return null
    const aWithScores = { ...a, scores: getScores(a) }
    const bWithScores = { ...b, scores: getScores(b) }
    return tiebreakReason(aWithScores, bWithScores, holePars)
  }
  const TIEBREAK_LABELS = { b9: 'B9', l6: 'L6', l3: 'L3', lh: 'LH' }
  // Match-play TOT for the current row. Only meaningful when isMatchPlay
  // (2 players + 'match' format). Returns "3UP" / "AS" / "3DN" or null.
  function matchPlayLabel(p, idx) {
    if (!isMatchPlay || !matchPlayData) return null
    const { p1HolesUp, played, remaining } = matchPlayData
    if (played === 0) return 'AS'
    // matchPlayData computed against participants[0] vs [1] in original
    // sort order; positions[idx] is the leaderboard rank from sorted[]
    // which is the same order used by computeMatchPlay's caller. So
    // p1HolesUp > 0 means participants[0] is up. We need to know if THIS
    // row is participant 0 or 1 in that match.
    const isFirst = String(p.user_id) === String(participants[0].user_id)
    const myUp = isFirst ? p1HolesUp : -p1HolesUp
    if (myUp === 0) return 'AS'
    if (Math.abs(myUp) > remaining && remaining >= 0) {
      // Match is decided
      return myUp > 0 ? `${myUp}&${remaining}` : `${-myUp}DN`
    }
    return myUp > 0 ? `${myUp}UP` : `${-myUp}DN`
  }

  // THRU label — number of holes scored, "F" when complete
  function thruLabel(p) {
    const played = getScores(p).filter(s => s > 0).length
    if (played === 0) return '—'
    if (played >= holeCount) return 'F'
    return String(played)
  }

  // Score-to-par numeric (for color lookup) — null when no holes played yet
  function diffNumeric(p) {
    const sc = getScores(p)
    const holesPlayed = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    if (!holesPlayed.length) return null
    const parSoFar   = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
    // Handicap (sign-preserving for plus-handicap players). Mirror of
    // netStrokes() in LiveOuting — kept inline here so the scoreboard
    // doesn't have to import. Round 1 fix.
    const rawH = netMode ? (parseFloat(p.handicap) || 0) : 0
    const hcp  = rawH === 0
      ? 0
      : (rawH > 0
        ? Math.floor(rawH * hcpAllowance / 100)
        : -Math.ceil(Math.abs(rawH) * hcpAllowance / 100))
    return totalSoFar - hcp - parSoFar
  }

  // For match-play matches, TOT shows match-play state and TODAY shows
  // score-to-par. For everything else, drop the TODAY column entirely so
  // the player name has more room.
  const gridTemplate = isMatchPlay
    ? '28px 44px 1fr 50px 50px 36px'
    : '28px 44px 1fr 50px 36px'

  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding: '12px 16px 24px',
    }}>
      {/* Translucent glass card wrapping the whole leaderboard. Same
          treatment as the Tour page's leaderboard so the visual
          language stays identical between watching the pros and
          watching your own match. */}
      <div style={{
        background: 'rgba(255,255,255,0.22)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.45)',
        borderRadius: 16,
        padding: '12px 12px 4px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        {/* Column headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          gap: 4, padding: '0 4px 6px',
          borderBottom: '1px solid rgba(27,94,59,0.18)',
          marginBottom: 6,
        }}>
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>POS</div>
          <div />
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em' }}>PLAYER</div>
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>{isMatchPlay ? 'MATCH' : 'TOT'}</div>
          {isMatchPlay && (
            <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>TODAY</div>
          )}
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>THRU</div>
        </div>

        {/* Player rows */}
        {participants.map((p, idx) => {
          const pos     = positions[idx] || '—'
          const isMe    = String(p.user_id) === String(user?.id)
          const numeric = diffNumeric(p)
          const skinsCount = isSkinsFormat ? (skinsByPlayer[p.user_id] || 0) : 0
          // For skins format, the headline TOT becomes 'N SK' so the
          // leaderboard reads at a glance — STP becomes the secondary
          // signal. (Iteration 2 polish for B4c.)
          const totDisplay = isMatchPlay
            ? (matchPlayLabel(p, idx) || '—')
            : isSkinsFormat
              ? `${skinsCount} SK`
              : (netMode ? netDiffStr(p) : diffStr(p))
          const todayDisplay = isMatchPlay
            ? (netMode ? netDiffStr(p) : diffStr(p))
            : isSkinsFormat
              ? (netMode ? netDiffStr(p) : diffStr(p))  // show STP under skins as secondary
              : null

          return (
            <button
              key={p.user_id}
              onClick={() => onPlayerTap?.(p.user_id)}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: gridTemplate,
                gap: 4, alignItems: 'center',
                padding: '7px 4px',
                borderBottom: '1px solid rgba(27,94,59,0.10)',
                // Leader gold-tint matches Tour page; current user gets
                // a subtle additional accent (gold-tinted left border).
                background: idx === 0
                  ? 'rgba(201,160,64,0.20)'
                  : 'transparent',
                borderRadius: idx === 0 ? 8 : 0,
                borderLeft: isMe ? '3px solid #C9A040' : '3px solid transparent',
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
              }}
            >
              {/* Position */}
              <div style={{
                textAlign: 'center',
                fontSize: pos.length > 3 ? 9 : 11,
                fontWeight: 700,
                color: idx < 3 ? '#C9A040' : 'rgba(27,94,59,0.50)',
              }}>
                {pos}
              </div>

              {/* Avatar — 38px square, mirrors PGAScores.jsx PlayerPhoto.
                  We reuse PlayerAvatar (which already handles avatar URL +
                  initials fallback) but force a square box via a wrapping div
                  so the look matches the Tour page. */}
              <div style={{
                width: 38, height: 38, borderRadius: 10, overflow: 'hidden',
                background: 'rgba(27,94,59,0.08)',
                border: '1px solid rgba(27,94,59,0.12)',
                position: 'relative',
              }}>
                {p.avatar ? (
                  <img
                    src={p.avatar}
                    alt={p.name || ''}
                    style={{
                      width: '100%', height: '100%',
                      objectFit: 'cover', objectPosition: 'top center',
                    }}
                  />
                ) : (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 800, color: '#fff',
                    background: avatarBg(p.name || ''),
                  }}>{initials(p.name || '') || '·'}</div>
                )}
              </div>

              {/* Name + subline (guest tag / handicap) */}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: idx < 5 ? 700 : 500,
                  color: '#0D1F12',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{p.name}</div>
                {(p.is_guest || (p.handicap != null && !p.is_guest)) && (
                  <div style={{
                    fontSize: 9, color: 'rgba(27,94,59,0.45)', fontWeight: 500,
                    letterSpacing: '0.02em', marginTop: 1,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {p.is_guest ? 'Guest' : `${parseFloat(p.handicap).toFixed(1)} hcp`}
                  </div>
                )}
              </div>

              {/* TOT (or MATCH label for match-play) */}
              <div style={{ textAlign: 'center' }}>
                <span style={{
                  fontSize: 13, fontWeight: 800,
                  color: isMatchPlay
                    ? (totDisplay === 'AS' ? '#1B5E3B' : totDisplay.endsWith('DN') ? '#DC2626' : '#C9A040')
                    : scoreToParColor(numeric),
                }}>
                  {totDisplay}
                </span>
                {/* Card-back tiebreak hint — small pill when this player
                    beat the next-tied player on a back-9 / last-N
                    tiebreak. Helps explain "we tied at 78 — why am I
                    2nd?" without forcing the host to. (B1 polish.) */}
                {(() => {
                  const hint = tiebreakHint(idx)
                  if (!hint) return null
                  return (
                    <div title={`Won on ${hint === 'b9' ? 'back 9' : hint === 'l6' ? 'last 6 holes' : hint === 'l3' ? 'last 3 holes' : 'last hole'}`} style={{
                      display: 'inline-block', marginTop: 2, padding: '0 5px',
                      borderRadius: 4, fontSize: 8, fontWeight: 800, letterSpacing: '0.08em',
                      background: 'rgba(201,160,64,0.18)', color: '#7A5800',
                      border: '1px solid rgba(201,160,64,0.35)',
                    }}>{TIEBREAK_LABELS[hint]}</div>
                  )
                })()}
              </div>

              {/* TODAY (only for match-play matches) */}
              {isMatchPlay && (
                <div style={{ textAlign: 'center' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: scoreToParColor(numeric),
                  }}>
                    {todayDisplay}
                  </span>
                </div>
              )}

              {/* THRU */}
              <div style={{
                textAlign: 'center', fontSize: 11,
                color: thruLabel(p) === 'F' ? 'rgba(27,94,59,0.55)' : 'rgba(27,94,59,0.45)',
                fontWeight: thruLabel(p) === 'F' ? 700 : 400,
              }}>
                {thruLabel(p)}
              </div>
            </button>
          )
        })}

        {/* Footer */}
        <div style={{ padding: '12px 4px 4px', color: 'rgba(27,94,59,0.50)', fontSize: 10, textAlign: 'center' }}>
          Tap a row to score{netMode ? ' · NET' : ''}
        </div>
      </div>
    </div>
  )
}

// ─── Live Outing Scorer ───────────────────────────────────────────────────────
function LiveOuting({ code, user, onBack, onMatchEnd, onGoToEagleEye, sharedCourse = null, onCourseSelected }) {
  const [outing, setOuting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showTeams, setShowTeams] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  // Commissioner correction panel — host-only modal with withdraw
  // toggles + audit log readout. (B3, 2026-05-01)
  const [showManage, setShowManage] = useState(false)
  // Score-conflict dialog — when /scores/host returns 409 with a
  // different existing score, surface a styled prompt rather than
  // window.confirm. resolveConflict carries the resolver fn so the
  // saveScore promise can await the user's decision. (Final pass.)
  const [conflictPrompt, setConflictPrompt] = useState(null)
  // { hole, existing, incoming, resolve }
  // Live-share modal — QR + URL + tee-box print page. Opens from
  // the host action row's '📡 Share live' button. (Round 3 audit.)
  const [showLiveShare, setShowLiveShare] = useState(false)
  // Offline queue size — surfaces a small pill when scores are
  // pending sync (cell signal dropped on the course). (B5)
  const [queuedCount, setQueuedCount] = useState(0)
  // Banner shown when a queued mutation is permanently dropped (server
  // refused, permission revoked, etc.) — explains to the user that
  // their optimistic local update will be reconciled with the server.
  // (Iteration 3 fix.)
  const [droppedNotice, setDroppedNotice] = useState(null)

  // loadOuting must be declared BEFORE any useEffect that lists it as
  // a dependency. The dep array is evaluated synchronously during
  // render — listing a const before it's initialized is a TDZ trip
  // that production minifiers surface as 'Cannot access ge before
  // initialization.' (Hot-fix 2026-05-02 round 2.)
  const loadOuting = useCallback(async () => {
    try {
      const data = await api(`/api/outings/${code}`)
      setOuting(data.outing)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [code])

  useEffect(() => subscribeQueue(setQueuedCount), [])
  useEffect(() => subscribeQueueDrops((item, reason) => {
    setDroppedNotice({ item, reason, at: Date.now() })
    // Immediately re-fetch the outing so local state realigns with
    // the server — the optimistic update needs to be reconciled.
    loadOuting()
  }), [loadOuting])
  // Auto-dismiss the dropped-notice banner after 7 seconds.
  useEffect(() => {
    if (!droppedNotice) return
    const t = setTimeout(() => setDroppedNotice(null), 7000)
    return () => clearTimeout(t)
  }, [droppedNotice])
  const [scoreModal, setScoreModal] = useState(null) // { userId, userName, hole }
  // Bulk-foursome score entry (6.2). When the host taps a hole number on the
  // scorecard header, this is set to that hole index and a modal pops with
  // one numeric input per player in the active group — pre-filled with the
  // current score (or blank). Saves all rows in sequence, with one final
  // loadOuting() after the batch instead of per-row, so a foursome's hole
  // can be entered in one round-trip-ish flow.
  const [bulkEntryHole, setBulkEntryHole] = useState(null) // 0-indexed hole or null
  const [showGuestModal, setShowGuestModal] = useState(false)
  const [netMode, setNetMode] = useState(false)
  const [ending, setEnding] = useState(false)
  const [saving, setSaving] = useState(false)
  // Most recent score event — pops a broadcast banner at the top of the
  // board for ~4s when a score is entered. (2026-04-30 PM round 10)
  const [recentEvent, setRecentEvent] = useState(null)
  // SCORECARD <-> BOARD view toggle (2026-05-01 — match-page completion plan,
  // Thread 1). null = use auto default (BOARD for 4+ players, else SCORECARD).
  // Set explicitly when the user taps the toggle.
  const [viewMode, setViewMode] = useState(null)
  // For large outings (>4 players, split into foursomes). Tracks which
  // group the user is currently viewing in scorecard mode. Defaults to
  // their own group; host can switch to any group via the chip selector.
  // Null means "all groups" (small outing or fallback). (2026-05-01)
  const [activeGroupId, setActiveGroupId] = useState(null)
  // Auto-end suggestion dismissal — must be declared up here, BEFORE
  // the if-loading/if-not-outing early returns. Otherwise the hook
  // count differs between the two render passes and React fires
  // error #310. (Hot-fix round 3.)
  const [autoEndDismissed, setAutoEndDismissed] = useState(false)

  // (loadOuting is declared earlier, above the useEffects that
  // depend on it — see the TDZ-fix note up top. Don't redeclare here.)
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

  // First-load course sync to App.jsx's sharedCourse. Fires once per
  // outing.id (the ref guards against the 5s polling re-firing). Fetches
  // the full course detail, matches the saved tee by name, and pushes the
  // {course, tee} pair up so EagleEye can auto-load it. Skipped when the
  // outing has no course_id (legacy match created without a real course)
  // or when sharedCourse already matches (avoids redundant fetches).
  // (2026-05-01)
  const courseSyncedForOutingRef = useRef(null)
  useEffect(() => {
    if (!outing?.id) return
    if (!outing.course_id) return                   // no real course on this match
    if (!onCourseSelected) return                   // parent didn't wire the callback
    if (courseSyncedForOutingRef.current === outing.id) return  // already synced this outing
    if (sharedCourse?.course?.id === outing.course_id
        && sharedCourse?.tee?.tee_name === outing.course_tee) {
      // App already has the right course. Mark synced so polling doesn't
      // retry, and skip the fetch.
      courseSyncedForOutingRef.current = outing.id
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const detail = await api(`/api/courses/${outing.course_id}`)
        if (cancelled) return
        // Find the saved tee in the male/female arrays. The CoursePicker
        // stores the chosen tee by tee_name only (not gender), so search
        // both. Fallback to the first male tee if nothing matches.
        const allTees = [...(detail.tees?.male || []), ...(detail.tees?.female || [])]
        const tee = allTees.find(t => t.tee_name === outing.course_tee) || allTees[0] || null
        if (!tee) return
        onCourseSelected({ course: detail, tee })
        courseSyncedForOutingRef.current = outing.id
      } catch (e) {
        warn('[course-sync]', e?.message)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outing?.id, outing?.course_id, outing?.course_tee])

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

  // Returns true on success (including conflict-resolved force-write
  // and queued-while-offline), false on user-cancelled conflict, and
  // false on any unrecoverable failure. The bulk-foursome modal (6.2)
  // checks this return value to decide whether to keep iterating —
  // catching errors INSIDE saveScore (so the per-row banner still
  // pops) is fine, but a bulk caller still needs to know not to keep
  // saving when the previous row blew up. (Round 12 edge-case audit.)
  async function saveScore(hole, score, targetUserId) {
    setSaving(true)
    try {
      // Host endpoint also handles same-foursome marker writes per
      // the 2026-05-01 widening — call it whenever the writer isn't
      // the player themselves. The server gates permissions.
      // All writes route through runWithQueue so a flaky cell signal
      // doesn't lose the score — it's queued in localStorage and
      // replayed when connectivity returns. (B5)
      const isSelfEdit = String(targetUserId) === String(user?.id)
      const targetUrl = isSelfEdit && String(outing?.host_id) !== String(user?.id) && !isMarkerFor(String(user?.id), String(targetUserId))
        ? `/api/outings/${code}/scores`
        : `/api/outings/${code}/scores/host`
      const baseBody = isSelfEdit && targetUrl.endsWith('/scores')
        ? { hole, score }
        : { hole, score, user_id: targetUserId }

      try {
        await runWithQueue({ url: targetUrl, method: 'PUT', body: baseBody })
      } catch (err) {
        // Score-conflict handshake (B2). Server returns 409 with the
        // existing different score; surface a styled prompt rather
        // than window.confirm. (Final pass polish.)
        if (err?.status === 409 && err?.payload?.error === 'score_conflict') {
          const existing = err.payload.existing_score
          const ok = await new Promise(resolve => {
            setConflictPrompt({ hole: Number(hole), existing, incoming: Number(score), resolve })
          })
          setConflictPrompt(null)
          if (!ok) { setSaving(false); return false }   // user said "keep existing" — bulk should stop
          await runWithQueue({ url: targetUrl, method: 'PUT', body: { ...baseBody, force: true } })
        } else {
          throw err
        }
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
      return true
    } catch (e) {
      // Surface the failure to the user instead of silently
      // swallowing. Auth-expired, withdrawn-player rejection, and
      // unexpected server errors all land here; the user needs a
      // signal so they can react. (Round 6 audit.)
      console.error('[saveScore]', e)
      const msg = e?.payload?.error === 'player_withdrawn'
        ? (e.payload.message || 'Player has been withdrawn.')
        : e?.status === 401
          ? 'Your session expired. Please sign in again.'
          : (e?.message || 'Could not save score. Try again.')
      // Lightweight banner via the existing recent-event slot —
      // hijack ts to make it auto-dismiss; payload distinguishes
      // 'event' vs 'error' below.
      setRecentEvent({ kind: 'error', message: msg, ts: Date.now() })
      return false
    }
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

  // All participants in state, including withdrawn. Used by the
  // commissioner panel which needs to see everyone. (B3)
  const allParticipantsRaw = outing.state?.participants ?? []
  // Same-name disambiguation: 'Matt Lavin' + 'Matt Smith' →
  // 'Matt L.' + 'Matt S.' Override the .name field on each
  // participant so every render path gets the disambiguated label
  // for free (leaderboard, scorecard, score modal, audit, etc.).
  // (Round 4 audit — same-name disambiguation.)
  const namesMap = buildDisplayNames(allParticipantsRaw)
  const allParticipants = allParticipantsRaw.map(p => ({
    ...p,
    display_name: namesMap[p.user_id] || p.name,
    name: namesMap[p.user_id] || p.name,
  }))
  // Hole config has to come BEFORE the no-show policy block — the
  // max_plus_2 synthesis reads holeCount + holePars when applying
  // per-player score fills. Order-of-declaration matters because of
  // the .map(applyNoShowPolicy) call below — in production builds
  // a TDZ violation here showed up as "Cannot access 'ge' before
  // initialization." (Hot-fix 2026-05-02.)
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

  // Active leaderboard pool — withdrawn players are excluded from
  // ranking, scoring, and leaderboard rendering.
  //
  // No-show handling (item 6): per outing.state.no_show_policy:
  //   - 'dns'        → exclude no-shows from the active pool; render
  //                    a separate "Did Not Start" section below.
  //   - 'max_plus_2' → synthesize unscored holes as (par + 2) so they
  //                    rank with a punitive total. Original p.scores
  //                    untouched (audit log shows real entries).
  //   - 'manual'     → leave no-shows in pool with whatever scores
  //                    the commissioner has entered (or none).
  const noShowPolicy = outing.state?.no_show_policy || 'dns'
  function applyNoShowPolicy(p) {
    if (!p.no_show) return p
    if (noShowPolicy === 'dns') return p          // caller filters
    if (noShowPolicy === 'manual') return p
    if (noShowPolicy === 'max_plus_2') {
      // Synthesize a max+2 score for any hole that's currently 0/empty.
      const sc = Array.isArray(p.scores) ? [...p.scores] : new Array(holeCount).fill(0)
      while (sc.length < holeCount) sc.push(0)
      for (let h = 0; h < holeCount; h++) {
        if (!sc[h] || sc[h] <= 0) sc[h] = (holePars[h] || 4) + 2
      }
      const total = sc.reduce((s, v) => s + (v || 0), 0)
      return { ...p, scores: sc, total, holes_played: holeCount, _synthetic: true }
    }
    return p
  }
  const participants = allParticipants
    .filter(p => !p.withdrawn)
    .filter(p => !(p.no_show && noShowPolicy === 'dns'))
    .map(applyNoShowPolicy)
  // DNS section roster — players excluded from ranking but still on
  // the roster. Empty when policy isn't DNS.
  const noShowList = noShowPolicy === 'dns'
    ? allParticipants.filter(p => !p.withdrawn && p.no_show)
    : []
  const isHost       = String(outing.host_id) === String(user?.id)
  const isTeamFormat = outing.team_format && outing.team_format !== 'individual'

  // Returns true if userId is an assigned marker responsible for
  // targetId's scores OR (in a large outing) they're in the same
  // foursome. The same-group rule lets any group member enter scores
  // for anyone else in their foursome — needed for >4 outings where
  // explicit marker assignments aren't done up front. Host already
  // gets blanket access via the `isHost` check at every call site.
  // (2026-05-01 — Matt: any player can enter scores for the foursome
  // they're grouped with, only the creator can enter for ALL.)
  function isMarkerFor(userId, targetId) {
    if (markers.some(m =>
      String(m.marker_id) === String(userId) &&
      m.member_ids.map(String).includes(String(targetId))
    )) return true
    // Same-foursome fallback for large outings.
    const u = participants.find(p => String(p.user_id) === String(userId))
    const t = participants.find(p => String(p.user_id) === String(targetId))
    if (u?.group_id != null && t?.group_id != null && u.group_id === t.group_id) {
      return true
    }
    return false
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

  // ── Sort leaderboard with USGA-standard card-back tiebreaker ──
  // Primary key: total strokes-to-par (lower = better, no scores = 999)
  // Tiebreakers (USGA Section 5.2 — applied automatically when totals tie):
  //   (a) lowest back-9 score (skipped on 9-hole rounds)
  //   (b) lowest last 6 holes
  //   (c) lowest last 3 holes
  //   (d) lowest 18th hole (or last hole played, for partial cards)
  // After all four, if still tied, players share the position. Sudden
  // death isn't supported here — that's a live-tournament action.
  // (2026-05-01 — league must-have B1.)

  // Compute strokes-to-par over a slice of holes for the player. Holes
  // that haven't been played (score = 0) contribute 0 — they're "even
  // par for unplayed" by USGA convention for card-back purposes.
  function strokesToParRange(p, startIdx, endIdx) {
    const sc = getScores(p)
    let total = 0
    for (let i = startIdx; i <= endIdx; i++) {
      const s = sc[i] || 0
      if (s > 0) total += s - (holePars[i] || 4)
    }
    return total
  }

  function totalStrokesToPar(p) {
    const sc = getScores(p)
    const played = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    if (!played.length) return 999
    const parSum   = played.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const strokes  = played.reduce((sum, x) => sum + x.s, 0)
    return strokes - parSum
  }

  function leaderboardSort(a, b) {
    // Primary
    const da = totalStrokesToPar(a)
    const db = totalStrokesToPar(b)
    if (da !== db) return da - db
    // Hole-count slice depends on actual holes played in the round.
    const lastIdx = holeCount - 1                    // 17 for 18-hole, 8 for 9-hole
    const tieRanges = []
    if (holeCount >= 18) tieRanges.push([9, 17])     // back-9 (only meaningful on 18-hole)
    tieRanges.push([Math.max(0, lastIdx - 5), lastIdx])  // last 6
    tieRanges.push([Math.max(0, lastIdx - 2), lastIdx])  // last 3
    tieRanges.push([lastIdx, lastIdx])               // last hole
    for (const [s, e] of tieRanges) {
      const ra = strokesToParRange(a, s, e)
      const rb = strokesToParRange(b, s, e)
      if (ra !== rb) return ra - rb
    }
    return 0  // still tied — share position
  }

  // ── Skins format: compute per-hole outcomes + per-player skin counts.
  const isSkinsFormat = (outing.scoring_formats || []).includes('skins')
  const skinsData     = isSkinsFormat ? computeSkins(participants, holePars, getScores) : null
  const skinsByPlayer = skinsData?.skinsByPlayer || {}

  // ── Stableford format: compute per-player point totals using the
  // outing's saved point map (or the Standard preset). Higher = better.
  // (B4b)
  const isStablefordFormat = (outing.scoring_formats || []).includes('stableford')
  const stablefordPointMap = outing.state?.stableford_points || STABLEFORD_PRESETS.standard
  const stablefordData     = isStablefordFormat
    ? computeStableford(participants, holePars, getScores, stablefordPointMap)
    : null
  const stablefordByPlayer = stablefordData?.pointsByPlayer || {}

  // ── Best Ball: compute per-team totals (lowest of each team's
  // members per hole, summed). Players with the same team_id share
  // a team total; lowest team total wins. (B4d)
  const isBestBallFormat = (outing.scoring_formats || []).includes('best_ball')
  const courseHoleHandicaps = Array.isArray(outing.hole_handicaps) ? outing.hole_handicaps : null
  const bestBallData     = isBestBallFormat
    ? computeBestBall(participants, holePars, getScores, netStrokes, courseHoleHandicaps)
    : null
  const bestBallByPlayer = bestBallData?.playerTeamTotal || {}
  // Sorted teams (low-to-high) for the standings card. Each entry has
  // { id, label, members, total, holesPlayed }.
  const bestBallTeams    = bestBallData?.teams || []

  // Leaderboard order:
  //   Skins      → primary: skins won desc, tiebreak: card-back STP
  //   Stableford → primary: points desc,    tiebreak: card-back STP
  //   Best Ball  → primary: team total asc, tiebreak: card-back STP
  //   Else       → standard leaderboardSort (card-back chain)
  const sorted = isSkinsFormat
    ? [...participants].sort((a, b) => {
        const sa = skinsByPlayer[a.user_id] || 0
        const sb = skinsByPlayer[b.user_id] || 0
        if (sa !== sb) return sb - sa
        return leaderboardSort(a, b)
      })
    : isStablefordFormat
    ? [...participants].sort((a, b) => {
        const pa = stablefordByPlayer[a.user_id] || 0
        const pb = stablefordByPlayer[b.user_id] || 0
        if (pa !== pb) return pb - pa
        return leaderboardSort(a, b)
      })
    : isBestBallFormat
    ? [...participants].sort((a, b) => {
        const ta = bestBallByPlayer[a.user_id] ?? 9999
        const tb = bestBallByPlayer[b.user_id] ?? 9999
        if (ta !== tb) return ta - tb  // lower team total wins
        return leaderboardSort(a, b)
      })
    : [...participants].sort(leaderboardSort)

  // ── Large-outing group context ─────────────────────────────────
  // For outings >4 players, participants are split into foursomes.
  // The Scoreboard view shows everyone (with a Group X badge).
  // The Scorecard view shows ONLY the active group's foursome so the
  // table fits a phone screen and players can read their own card.
  const stateGroups   = outing.state?.groups ?? []
  const isLargeOuting = stateGroups.length > 0
  const myParticipant = participants.find(p => String(p.user_id) === String(user?.id))
  const myGroupId     = myParticipant?.group_id ?? null
  // Default the active group to the user's own foursome when they
  // haven't chosen one yet. Host can switch via the chip selector.
  const effectiveGroupId = activeGroupId ?? myGroupId ?? (stateGroups[0]?.id ?? null)
  const groupName = (gid) => stateGroups.find(g => g.id === gid)?.name || `Group ${gid}`
  // What the Scorecard view actually renders. For small outings:
  // everyone. For large outings: just the active foursome.
  const scorecardParticipants = isLargeOuting && effectiveGroupId != null
    ? sorted.filter(p => p.group_id === effectiveGroupId)
    : sorted

  // Match Play: only active for 2-player matches with 'match' format
  const isMatchPlay   = (outing.scoring_formats || []).includes('match') && participants.length === 2
  // Match-play handicap: when netMode is on AND the two players have
  // different handicaps, the higher-handicap player receives strokes
  // on the hardest holes per the course's stroke index. Computed from
  // strokeHolesForPlayer using the difference (after allowance) as
  // the higher player's strokes; lower player gets none.
  // (Round 1 fix: net match play.)
  const matchPlayData = (() => {
    if (!isMatchPlay) return null
    let strokes = null
    if (netMode && sorted[0] && sorted[1]) {
      const ns0 = netStrokes(sorted[0])
      const ns1 = netStrokes(sorted[1])
      const diff = ns0 - ns1  // positive → p0 has more strokes (higher hcp)
      // Whichever player has MORE strokes available gets the diff
      // applied to the hardest holes. The other player gets zero
      // strokes (acts as the baseline).
      if (diff !== 0) {
        const giver = diff > 0 ? sorted[0] : sorted[1]
        const giverStrokes = strokeHolesForPlayer(giver, holePars, courseHoleHandicaps, Math.abs(diff))
        strokes = diff > 0
          ? { p1: giverStrokes, p2: new Map() }
          : { p1: new Map(),    p2: giverStrokes }
      }
    }
    return computeMatchPlay(sorted[0], sorted[1], getScores, holePars, strokes)
  })()

  // Current user's next-to-play hole (1-indexed). Used by the persistent
  // GET DISTANCES floating pill so tapping it lands the user on Eye for
  // their own next hole, regardless of where other players are. Returns
  // null when the user isn't a participant or the round is complete.
  // (2026-05-01)
  const meParticipant = participants.find(p => String(p.user_id) === String(user?.id))
  const myHolesPlayed = meParticipant ? getScores(meParticipant).filter(s => s > 0).length : 0
  const myNextHole    = meParticipant && myHolesPlayed < holeCount ? myHolesPlayed + 1 : null

  // Net scoring helpers
  // Handicap allowance: most leagues apply a percentage to the raw
  // handicap before stroke deduction. 100% = full handicap, common
  // alternatives are 80% (member-guest), 85% (4-ball-stroke), 90%
  // (singles match), 95% (stroke-play tournaments). Stored on the
  // outing as state.handicap_allowance; defaults to 100. Applied
  // BEFORE the floor so 12.0 hcp × 85% = 10.2 → floor → 10 strokes.
  // (2026-05-01 — league must-have B4a.)
  const hcpAllowance = (() => {
    const v = Number(outing.state?.handicap_allowance)
    return Number.isFinite(v) && v > 0 && v <= 100 ? v : 100
  })()
  // 6.4 — Per-event handicap overrides. Commissioner-set, one-outing
  // adjustments stored in outing.state.handicap_overrides keyed by
  // user_id. If a player has an override, it takes precedence over
  // their stored tm_users.handicap for THIS outing's net calc. Used
  // for league handicap rules, guest fill-ins, sandbagger flags, etc.
  const handicapOverrides = outing.state?.handicap_overrides || {}
  function effectiveHandicap(p) {
    const ov = handicapOverrides[String(p?.user_id)]
    if (ov != null && Number.isFinite(Number(ov))) return Number(ov)
    return parseFloat(p?.handicap)
  }
  // netStrokes — strokes the player gives (positive) or receives
  // (negative). Plus-handicap players (handicap < 0) ADD strokes to
  // their gross instead of subtracting; netTotal handles the sign by
  // simple subtraction. (gross - (-2) = gross + 2)
  // Allowance is applied to magnitude, sign preserved. For positive
  // handicaps we floor (round down — fewer strokes back, harder).
  // For plus handicaps we ceil the magnitude (round up — more
  // strokes added, harder), matching USGA convention.
  // (Round 1 fix.)
  function netStrokes(p) {
    const raw = effectiveHandicap(p)
    if (!Number.isFinite(raw) || raw === 0) return 0
    const mag = Math.abs(raw) * hcpAllowance / 100
    return raw >= 0 ? Math.floor(mag) : -Math.ceil(mag)
  }
  function netTotal(p) {
    const gross = getScores(p).reduce((s, v) => s + (v || 0), 0)
    return gross - netStrokes(p)
  }
  function netDiffStr(p) {
    const gross = getScores(p)
    const holesPlayed = gross.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    if (!holesPlayed.length) return 'E'
    const parSoFar = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
    const d = totalSoFar - netStrokes(p) - parSoFar
    return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`
  }
  const hasHandicaps = participants.some(p => p.handicap != null && !p.is_guest)

  // SCORECARD <-> BOARD view: explicit user choice if set, else auto-default.
  // Default to BOARD when there are 4+ players (the wide scorecard gets
  // visually busy with that many rows), SCORECARD otherwise. The user can
  // still toggle either way at any time.
  const effectiveViewMode = viewMode ?? (participants.length >= 4 ? 'board' : 'scorecard')

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

  // Auto-end suggestion — when EVERY active (non-withdrawn) player
  // has filled the full holeCount, prompt the host once to end the
  // match. Dismissible (per-session via showAutoEndPrompt state)
  // so the host can keep the board live for celebration if they
  // want. Only the host sees it. (Round 11 audit.)
  //
  // NOTE — autoEndDismissed useState was previously declared HERE
  // (after the if-loading/if-not-outing early returns), which
  // produced a hook-count mismatch between renders → React error
  // #310 in production. It now lives at the top of the LiveOuting
  // hook block alongside every other useState. (Hot-fix round 3.)
  const allFinished = participants.length > 0 && participants.every(p => {
    const sc = getScores(p) || []
    return sc.filter(s => s > 0).length >= holeCount
  })
  const showAutoEndPrompt = isHost && allFinished && !autoEndDismissed && outing.status !== 'ended'

  // Active hole — next hole to be played. = max(holes_played) + 1, capped
  // at the last hole. Used to show a green flag pin under the hole number
  // in the HOLE row. (2026-04-30 PM round 9 — Tier 2)
  const maxPlayed = Math.max(0, ...participants.map(p => getScores(p).filter(s => s > 0).length))
  const activeHole = maxPlayed >= holeCount ? null : maxPlayed   // 0-indexed

  // Tap hint — the first empty cell the user can edit, on a fresh board.
  // Pulses gold so first-time users know where to start. (2026-04-30 PM round 11)
  const tapHint = findTapHint({ sorted, getScores, isHost, isMarkerFor, userId: user?.id })

  // Row sizing: minimum 4 rows fill the screen. Each row is ~80-90px; if
  // fewer than 4 players, we render empty placeholder rows below them
  // (instead of stretching the real rows huge, which read weirdly).
  // Past 4 players, rows shrink to a 56px minimum and scroll vertically.
  const MIN_ROWS = 4
  const ROW_H = participants.length <= MIN_ROWS ? 80 : 56
  const fillerRows = Math.max(0, MIN_ROWS - participants.length)

  return (
    <div
      data-no-pull-refresh="true"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        // Translucent panels over the page-level fairway grass image —
        // matches the rest of the app's glass cards. (2026-04-30 PM round 13)
        background: 'transparent',
      }}>
      {/* 2026-05-05 — data-no-pull-refresh disarms the TabPanel's
          pull-to-refresh gesture for the entire LiveOuting screen.
          Reasoning matches the Solo Round fix: a downward finger
          drift while entering scores must NOT trigger a page reload,
          regardless of whether the latest score has hit the offline
          queue yet. Score writes go through runWithQueue + offline
          queue (durable across reload), but the reload itself is
          jarring mid-round. */}
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
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: AUGUSTA_TEXT, fontSize: 22, padding: '0 4px', cursor: 'pointer' }}>←</button>
          <div style={{ textAlign: 'center', flex: 1, padding: '0 8px' }}>
            <div style={{ fontWeight: 900, color: AUGUSTA_TEXT, fontSize: 15, lineHeight: 1.2, fontFamily: '"Georgia", serif', fontStyle: 'italic', letterSpacing: '0.03em' }}>{outing.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(26,107,40,0.65)', marginTop: 2 }}>{outing.course_name}{coursePar ? ` · Par ${coursePar}` : ''}</div>
            {/* Part-of-League pill (2026-05-02). Surfaces the league
                this event belongs to, so players viewing the live
                board know it's part of a season. Tap-target small
                — non-interactive pill for now; full link-back to
                the league page is on the Leagues tab. */}
            {outing.league && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                marginTop: 4, padding: '3px 9px', borderRadius: 999,
                background: 'rgba(245,215,138,0.18)',
                border: '1px solid rgba(245,215,138,0.45)',
                fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                color: '#F5D78A', textTransform: 'uppercase',
              }}>
                {/* Round 28 audit — bespoke trophy SVG instead of 🏆.
                    Augusta language consistency on the in-app pill. */}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#F5D78A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/>
                  <path d="M8 6H6a2 2 0 0 0 2 2"/>
                  <path d="M16 6h2a2 2 0 0 1-2 2"/>
                  <line x1="12" y1="12" x2="12" y2="16"/>
                  <line x1="9" y1="20" x2="15" y2="20"/>
                </svg>
                <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {outing.league.name}
                </span>
              </div>
            )}
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

        {/* Auto-end suggestion — host only, when every active player
            has filled all 18 holes. Single-tap to End, or × to dismiss
            and keep watching the leaderboard. (Round 11 audit.) */}
        {showAutoEndPrompt && (
          <div style={{
            marginTop: 8, padding: '10px 14px',
            background: 'linear-gradient(135deg, rgba(245,215,138,0.18), rgba(201,160,64,0.10))',
            border: '1px solid rgba(245,215,138,0.40)',
            borderRadius: 12,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F5D78A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M8 21h8M12 17v4M17 3H7l1 7a5 5 0 0010 0l1-7z"/>
              <path d="M7 3H4a2 2 0 000 4h3M17 3h3a2 2 0 010 4h-3"/>
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#F5D78A', letterSpacing: '0.04em' }}>
                ALL PLAYERS FINISHED
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                Wrap up the match to lock in results and update rivalries.
              </div>
            </div>
            <button onClick={endMatch} disabled={ending} style={{
              padding: '7px 12px', borderRadius: 999, border: 'none',
              background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
              color: '#070C09', fontSize: 11, fontWeight: 800, cursor: 'pointer',
              fontFamily: 'inherit', flexShrink: 0,
              opacity: ending ? 0.6 : 1,
            }}>{ending ? 'Ending…' : 'End match'}</button>
            <button onClick={() => setAutoEndDismissed(true)} aria-label="Dismiss" style={{
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.55)', fontSize: 16, cursor: 'pointer',
              padding: '0 4px',
            }}>✕</button>
          </div>
        )}

        {/* Item 7 — Latest announcement banner. Visible to EVERY
            participant (not just host). Dismissible per-session per-
            announcement-id via localStorage so the user only sees a
            given message once. New announcements pop a fresh banner. */}
        <AnnouncementBanner outing={outing} />

        {/* Offline-queue pill — visible to ALL viewers (host + every
            participant), not just the host, since their own writes
            might be queued. (Iteration fix B5-3.) */}
        {queuedCount > 0 && (
          <div style={{ marginTop: 8 }}>
            <div title="Saved locally — will sync when reconnected" style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(248,180,113,0.14)', border: '1px solid rgba(248,180,113,0.40)',
              borderRadius: 20, padding: '3px 10px',
              color: '#F8B471', fontSize: 11, fontWeight: 700,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F8B471' }} />
              {queuedCount} pending · saved locally
            </div>
          </div>
        )}

        {/* Dropped-mutation banner — fires when a queued write is
            permanently rejected by the server (permission revoked,
            withdrawn player, etc.). Local state is reconciled
            automatically by re-fetching; this just tells the user
            what happened. (Iteration 3 fix for B5.) */}
        {droppedNotice && (
          <div style={{
            marginTop: 8, padding: '8px 12px',
            background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)',
            borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div style={{ flex: 1, fontSize: 11, color: '#F87171', lineHeight: 1.3 }}>
              <strong>A pending score couldn't sync</strong> — the server rejected it ({droppedNotice.reason}). Latest scores re-loaded from the server.
            </div>
            <button onClick={() => setDroppedNotice(null)} aria-label="Dismiss" style={{
              background: 'none', border: 'none', color: 'rgba(248,113,113,0.7)', fontSize: 14, cursor: 'pointer',
            }}>✕</button>
          </div>
        )}

        {/* Host controls row */}
        {isHost && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: 'var(--tm-text-3)', flex: 1 }}>
              {/* "Tap any cell to enter scores" removed 2026-04-30 PM round 11 —
                  the pulsing gold tap-hint on the first empty cell teaches
                  the same thing without instructional copy. */}
              {markers.length > 0 ? `${markers.length} marker${markers.length !== 1 ? 's' : ''} assigned` : ''}
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
            {/* Share live leaderboard — opens a modal with the URL +
                QR code + tee-box print page. (Round 2/3 audit.) */}
            <button onClick={() => setShowLiveShare(true)} style={{
              background: 'rgba(94,212,122,0.10)', border: '1px solid rgba(94,212,122,0.40)',
              borderRadius: 20, padding: '3px 10px',
              color: '#5ED47A', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }} title="QR code, link, and printable tee-box flyer">
              📡 Share live
            </button>
            <button onClick={() => setShowManage(true)} style={{
              background: 'rgba(245,215,138,0.12)', border: '1px solid rgba(245,215,138,0.35)',
              borderRadius: 20, padding: '3px 10px',
              color: '#F5D78A', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>⚙ Manage</button>
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
              ? AUGUSTA_TEXT
              : matchPlayData.p1HolesUp > 0 ? AUGUSTA_GOLD_DIM : '#A04020',
            fontFamily: '"Arial Black", Arial, sans-serif',
            letterSpacing: '0.06em',
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
            color: 'rgba(26,107,40,0.65)',
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
      {recentEvent && recentEvent.kind === 'error' && (
        // Error variant — red banner when saveScore failed (auth
        // expired, withdrawn player, server error). Auto-dismisses
        // via the same 4-second timer that handles event banners.
        // (Round 6 audit.)
        <div
          key={recentEvent.ts}
          className="tm-event-pop"
          style={{
            position: 'absolute', top: 100, left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, #C13B3B 0%, #A02B2B 100%)',
            color: '#FFF',
            border: '1px solid #E55858',
            padding: '8px 18px',
            borderRadius: 24,
            fontSize: 12, fontWeight: 800,
            letterSpacing: '0.04em',
            boxShadow: '0 6px 20px rgba(0,0,0,0.40)',
            zIndex: 5,
            maxWidth: '85%',
            textAlign: 'center',
          }}>{recentEvent.message}</div>
      )}
      {recentEvent && recentEvent.kind !== 'error' && (() => {
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
              color: AUGUSTA_TEXT,
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

      {/* SCORECARD <-> BOARD toggle. Always visible to all participants
          (host + non-host alike) so anyone can switch from the active
          scoring surface (scorecard) to the leaderboard read of who's
          winning (Tour-style board). Default is BOARD for 4+ player
          matches (where the wide scorecard gets visually busy).
          (2026-05-01 — match-page completion plan, Thread 1) */}
      <div style={{ padding: '10px 12px 0', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <div style={{
          display: 'inline-flex',
          background: 'rgba(255,255,255,0.18)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.30)',
          borderRadius: 999,
          padding: 3, gap: 2,
        }}>
          <button onClick={() => setViewMode('scorecard')} style={{
            background: effectiveViewMode === 'scorecard' ? AUGUSTA_GREEN_DEEP : 'transparent',
            border: 'none', cursor: 'pointer',
            padding: '6px 18px', borderRadius: 999,
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            color: effectiveViewMode === 'scorecard' ? '#F5D78A' : 'rgba(255,255,255,0.72)',
            fontFamily: 'inherit',
            transition: 'background 120ms ease, color 120ms ease',
          }}>SCORECARD</button>
          <button onClick={() => setViewMode('board')} style={{
            background: effectiveViewMode === 'board' ? AUGUSTA_GREEN_DEEP : 'transparent',
            border: 'none', cursor: 'pointer',
            padding: '6px 18px', borderRadius: 999,
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            color: effectiveViewMode === 'board' ? '#F5D78A' : 'rgba(255,255,255,0.72)',
            fontFamily: 'inherit',
            transition: 'background 120ms ease, color 120ms ease',
          }}>BOARD</button>
        </div>
      </div>

      {/* Best-Ball team standings — header card above the leaderboard
          when format=best_ball. Player rows below are still ordered
          by team total. (Iteration 3 polish for B4d.) */}
      {effectiveViewMode === 'board' && isBestBallFormat && bestBallTeams.length > 0 && (
        <div style={{
          margin: '12px 12px 0', padding: '10px 14px',
          background: 'linear-gradient(180deg, rgba(245,215,138,0.10), rgba(201,160,64,0.04))',
          border: '1px solid rgba(245,215,138,0.30)',
          borderRadius: 14,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.10em',
            color: 'rgba(245,215,138,0.80)', marginBottom: 6,
          }}>TEAM STANDINGS · BEST BALL</div>
          {bestBallTeams.map((team, i) => {
            const memberNames = team.members.map(m => (m.name || '').split(' ')[0]).filter(Boolean).join(' / ')
            const isLeader = i === 0 && team.total > 0
            return (
              <div key={team.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '6px 0',
                borderTop: i > 0 ? '1px solid rgba(245,215,138,0.10)' : 'none',
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 800, color: isLeader ? '#F5D78A' : 'rgba(255,255,255,0.55)',
                  width: 22, textAlign: 'center',
                }}>{i + 1}</span>
                <span style={{
                  flex: 1, fontSize: 12, fontWeight: 700, color: '#fff',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{memberNames || `Team ${team.label}`}</span>
                <span style={{
                  fontSize: 12, fontWeight: 800, color: isLeader ? '#F5D78A' : 'rgba(255,255,255,0.85)',
                  fontVariantNumeric: 'tabular-nums',
                }}>{team.total > 0 ? team.total : '—'}</span>
                <span style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.45)',
                  width: 38, textAlign: 'right',
                }}>thru {team.holesPlayed}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* BOARD view — Tour-style leaderboard. Read-only; tapping a row
          flips back to SCORECARD so the user can enter that player's score. */}
      {effectiveViewMode === 'board' && (
        <MatchScoreboard
          participants={sorted}
          positions={positions}
          getScores={getScores}
          holePars={holePars}
          holeCount={holeCount}
          netMode={netMode}
          hcpAllowance={hcpAllowance}
          isMatchPlay={isMatchPlay}
          matchPlayData={matchPlayData}
          diffStr={diffStr}
          netDiffStr={netDiffStr}
          user={user}
          onPlayerTap={() => setViewMode('scorecard')}
          isSkinsFormat={isSkinsFormat}
          skinsByPlayer={skinsByPlayer}
        />
      )}

      {/* SCORECARD view — Augusta-style table. Tournament board frame:
          outer wood wrapper has a real wood-grain texture (repeating
          vertical-line gradient over a brown gradient), inner div is the
          board panel. The gold pinstripe + dark inset rings live on the
          inner div so they sit just inside the wood.
          (2026-04-30 PM round 9 — Tier 2 polish, real wood look) */}
      {effectiveViewMode === 'scorecard' && (
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
          // Glass-morphism: blur whatever's behind the translucent panel
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
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
              {/* Group selector chips — only for large outings. Lets
                  the user (or host) switch which foursome's scorecard
                  is on screen. For small outings these don't render. */}
              {isLargeOuting && (
                <div style={{
                  padding: '10px 12px 8px', display: 'flex', gap: 6,
                  flexWrap: 'wrap', borderBottom: '1px solid ' + AUGUSTA_GOLD_DIM,
                  background: AUGUSTA_PANEL,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: AUGUSTA_INK, letterSpacing: '0.1em', alignSelf: 'center', marginRight: 4 }}>
                    {isHost ? 'GROUPS:' : 'YOUR GROUP:'}
                  </div>
                  {(isHost ? stateGroups : stateGroups.filter(g => g.id === myGroupId)).map(g => (
                    <button key={g.id} onClick={() => setActiveGroupId(g.id)} style={{
                      padding: '4px 10px', borderRadius: 999, border: '1px solid',
                      borderColor: g.id === effectiveGroupId ? AUGUSTA_GREEN : AUGUSTA_GOLD_DIM,
                      background: g.id === effectiveGroupId ? AUGUSTA_GREEN : 'transparent',
                      color: g.id === effectiveGroupId ? '#FFF' : AUGUSTA_INK,
                      fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    }}>{g.name}</button>
                  ))}
                </div>
              )}
              {/* ── Front 9 ── */}
              <ScorecardTable
                label="FRONT 9"
                holes={frontHoles}
                holePars={holePars}
                subtotalPar={frontPar}
                participants={scorecardParticipants}
                getScores={getScores}
                isHost={isHost}
                userId={user?.id}
                isMarkerFor={isMarkerFor}
                playerTeam={playerTeam}
                onCellTap={(p, h) => setScoreModal({ userId: p.user_id, userName: p.name, hole: h })}
                // 6.2 — Host can tap a hole-number header to bulk-enter every
                // player in the foursome at once. Only enabled when there are
                // at least 2 players to enter (single-player tables don't
                // benefit). Tap is wired through ScorecardTable's
                // onHoleHeaderTap prop. (2026-05-02)
                onHoleHeaderTap={isHost && scorecardParticipants.length >= 2 ? (h) => setBulkEntryHole(h) : null}
                matchPlayData={isMatchPlay ? matchPlayData : null}
                isP1={(p) => isMatchPlay && String(p.user_id) === String(scorecardParticipants[0]?.user_id)}
                PLAYER_COL={PLAYER_COL}
                RANK_COL={RANK_COL}
                AVATAR_COL={AVATAR_COL}
                NAME_COL={NAME_COL}
                HOLE_COL={HOLE_COL}
                SUB_COL={SUB_COL}
                positions={positions}
                activeHole={activeHole}
                tapHint={tapHint}
                rowH={ROW_H}
                fillerRows={fillerRows}
                skinsOutcomes={isSkinsFormat ? skinsData?.outcomes : null}
              />
              {/* ── Back 9 (if 18 holes) ── */}
              {backHoles.length > 0 && (
                <ScorecardTable
                  label="BACK 9"
                  holes={backHoles}
                  holePars={holePars}
                  subtotalPar={backPar}
                  participants={scorecardParticipants}
                  getScores={getScores}
                  isHost={isHost}
                  userId={user?.id}
                  isMarkerFor={isMarkerFor}
                  playerTeam={playerTeam}
                  onCellTap={(p, h) => setScoreModal({ userId: p.user_id, userName: p.name, hole: h })}
                  onHoleHeaderTap={isHost && scorecardParticipants.length >= 2 ? (h) => setBulkEntryHole(h) : null}
                  matchPlayData={isMatchPlay ? matchPlayData : null}
                  isP1={(p) => isMatchPlay && String(p.user_id) === String(scorecardParticipants[0]?.user_id)}
                  PLAYER_COL={PLAYER_COL}
                  HOLE_COL={HOLE_COL}
                  SUB_COL={SUB_COL}
                  rowH={ROW_H}
                  fillerRows={fillerRows}
                  skinsOutcomes={isSkinsFormat ? skinsData?.outcomes : null}
                />
              )}
              {/* ── Totals row ── */}
              <TotalsRow
                participants={scorecardParticipants}
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
                tapHint={tapHint}
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
            fontSize: 14, color: AUGUSTA_TEXT, fontStyle: 'italic', letterSpacing: '0.10em',
          }}>Augusta National Club Golf</div>
          <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: '50%', background: '#FFD700',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 900, color: AUGUSTA_GREEN, fontFamily: '"Georgia", serif',
          }}>M</span>
        </div>
        </div>
      </div>
      )}

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
            holeCount={holeCount}
            // "Save & Eagle Eye →" only available when:
            //   1. parent supplied the cross-tab nav callback
            //   2. user is scoring their OWN hole (not host scoring someone else)
            //   3. there's actually a next hole to advance to (not the last)
            // Tightest one-tap loop: enter score, jump to Eye on next hole.
            // hole is 0-indexed in scoreModal; eyeHoleNudge is 1-indexed,
            // so "next hole" = scoreModal.hole + 2. (2026-05-01)
            onSaveAndEagleEye={
              onGoToEagleEye
              && String(scoreModal.userId) === String(user?.id)
              && scoreModal.hole + 1 < holeCount
                ? async val => {
                    const nextHole = scoreModal.hole + 2  // 1-indexed
                    setScoreModal(null)
                    await saveScore(scoreModal.hole, val, scoreModal.userId)
                    onGoToEagleEye(nextHole)
                  }
                : null
            }
            onSave={async val => {
              setScoreModal(null)
              await saveScore(scoreModal.hole, val, scoreModal.userId)
            }}
            onClose={() => setScoreModal(null)}
          />
        )
      })()}

      {/* 6.2 — Bulk-foursome score entry. Host taps a hole numeral on the
          scorecard header → modal shows one numeric input per group member,
          pre-filled with their current score for that hole. Saves all rows
          in sequence then refreshes the outing once. The biggest commissioner
          time-saver after each foursome turns in their card. (2026-05-02) */}
      {bulkEntryHole != null && (
        <BulkScoreModal
          hole={bulkEntryHole}
          par={holePars[bulkEntryHole] || 4}
          participants={scorecardParticipants}
          getScores={getScores}
          holeCount={holeCount}
          onClose={() => setBulkEntryHole(null)}
          onSaveAll={async (entries) => {
            // entries: [{ userId, name, score }, ...] only those with a
            // numeric score. Run sequentially so the offline queue
            // preserves causal order and the score-conflict dialog (B2)
            // can interrupt mid-batch. saveScore returns true/false —
            // false = stop the batch (user cancelled a conflict, or a
            // server rejection like player_withdrawn fired).
            // (Round 12 — saveScore now returns a status indicator
            // instead of throwing, so wire that here.)
            for (const e of entries) {
              const ok = await saveScore(bulkEntryHole, e.score, e.userId)
              if (!ok) {
                // Throw so the BulkScoreModal's inner try/catch surfaces
                // the partial-save banner. The user can dismiss + retry
                // the remaining rows.
                throw new Error(`Stopped at ${e.name}. Earlier rows were saved.`)
              }
            }
            setBulkEntryHole(null)
          }}
        />
      )}

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

      {/* Score-conflict prompt — replaces window.confirm with a sheet
          styled to match the rest of the app. Resolves the saveScore
          promise to true (overwrite) or false (cancel). (Final pass) */}
      {conflictPrompt && createPortal(
        <div
          onClick={() => conflictPrompt.resolve(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'linear-gradient(180deg, #11201A 0%, #0A1410 100%)',
              borderRadius: 18, padding: '20px 22px',
              maxWidth: 380, width: '100%',
              border: '1px solid rgba(245,215,138,0.30)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
            }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(245,215,138,0.16)',
                border: '1px solid rgba(245,215,138,0.40)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#F5D78A', fontSize: 18, fontWeight: 800,
              }}>!</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#fff' }}>
                Existing score on Hole {conflictPrompt.hole + 1}
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)', lineHeight: 1.5, marginBottom: 16 }}>
              Hole {conflictPrompt.hole + 1} already has a score of <strong style={{ color: '#fff' }}>{conflictPrompt.existing}</strong>. Replace it with <strong style={{ color: '#F5D78A' }}>{conflictPrompt.incoming}</strong>?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => conflictPrompt.resolve(false)} style={{
                flex: 1, padding: '11px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancel</button>
              <button onClick={() => conflictPrompt.resolve(true)} style={{
                flex: 1, padding: '11px',
                background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
                border: 'none', borderRadius: 10, color: '#070C09',
                fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              }}>Replace with {conflictPrompt.incoming}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Live-share modal — QR + URL + tee-box print. (Round 3 audit.) */}
      {showLiveShare && outing && (
        <LiveShareModal
          outing={outing}
          onClose={() => setShowLiveShare(false)}
        />
      )}

      {/* Commissioner correction panel — host-only. Withdraw / reinstate
          participants and audit the score-change history. (B3) */}
      {showManage && isHost && outing && (
        <CommissionerPanel
          outing={outing}
          onClose={() => setShowManage(false)}
          onParticipantsUpdated={(updated, extras) => {
            // 6.4 — extras may carry { handicap_overrides } from the
            // per-event override editor. Merge whatever the panel
            // passes back into outing.state without dropping any other
            // state keys (groups, teams, stableford_points, etc.)
            setOuting(prev => ({
              ...prev,
              state: {
                ...(prev.state || {}),
                participants: updated,
                ...(extras && typeof extras === 'object' ? extras : {}),
              },
            }))
          }}
        />
      )}

      {/* Floating bottom-right GET DISTANCES pill — symmetric counterpart
          to EagleEye's SCORECARD pill. Always visible during a live match
          for the current user (when they have a next hole to play and no
          modal is open). Tapping it jumps to Eye on the user's own next
          hole, regardless of where other players are. (2026-05-01) */}
      {onGoToEagleEye && myNextHole != null && !scoreModal && !showTeams && !showGroups && !showGuestModal && (
        <button onClick={() => onGoToEagleEye(myNextHole)} style={{
          position: 'absolute',
          bottom: 16, right: 16,
          background: 'linear-gradient(135deg, rgba(232,192,90,0.95), rgba(201,160,64,0.95))',
          border: '1px solid rgba(245,215,138,0.6)',
          borderRadius: 999, padding: '10px 16px',
          color: '#0D1F12',
          fontSize: 12, fontWeight: 800, letterSpacing: '0.06em',
          cursor: 'pointer',
          boxShadow: '0 6px 18px rgba(0,0,0,0.45), 0 0 0 1px rgba(245,215,138,0.15)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: 'inherit',
          zIndex: 30,
        }}>
          GET DISTANCES
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0D1F12" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      )}
    </div>
  )
}

// ─── Scorecard table (front or back 9) ───────────────────────────────────────
function ScorecardTable({ label, holes, holePars, subtotalPar, participants, getScores, isHost, userId, isMarkerFor, playerTeam, onCellTap, onHoleHeaderTap, matchPlayData, isP1, PLAYER_COL, RANK_COL = 30, AVATAR_COL = 60, NAME_COL = 92, HOLE_COL, SUB_COL, rowH = 56, fillerRows = 0, positions = [], activeHole = null, tapHint = null, skinsOutcomes = null }) {
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
    fontSize: 12, fontWeight: 900, color: AUGUSTA_TEXT,
    fontFamily: '"Arial Black", Arial, sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0,
  }
  const headerHoleCell = {
    minWidth: HOLE_COL, width: HOLE_COL, height: 34,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 900, color: AUGUSTA_TEXT,
    fontFamily: '"Arial Black", Arial, sans-serif',
    flexShrink: 0,
    // Match body cells' borderLeft color so vertical dividers run continuously
    // from header through every body row when scrolled (2026-04-30 PM fix).
    borderLeft: '1px solid rgba(0,0,0,0.20)',
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
          Active hole gets a small green flag pin on top of the numeral.
          When onHoleHeaderTap is provided (host on a multi-player group),
          each hole numeral becomes a tappable button that opens the bulk
          entry modal — see "BulkScoreModal" / setBulkEntryHole. (6.2) */}
      <div style={headerRow}>
        <div style={headerNameCol}>{label}</div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          {holes.map(h => {
            const tappable = !!onHoleHeaderTap
            const cellInner = (
              <>
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
                {tappable && (
                  <span style={{
                    position: 'absolute', bottom: -1, left: '50%',
                    transform: 'translateX(-50%)',
                    width: 14, height: 2, borderRadius: 1,
                    background: 'rgba(232,192,90,0.55)',
                    pointerEvents: 'none',
                  }} aria-hidden />
                )}
              </>
            )
            const baseStyle = { ...headerHoleCell, position: 'relative' }
            return tappable ? (
              <button
                key={h}
                type="button"
                onClick={() => onHoleHeaderTap(h)}
                aria-label={`Bulk enter scores for hole ${h + 1}`}
                style={{
                  ...baseStyle,
                  appearance: 'none',
                  border: 0,
                  borderLeft: headerHoleCell.borderLeft,
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {cellInner}
              </button>
            ) : (
              <div key={h} style={baseStyle}>
                {cellInner}
              </div>
            )
          })}
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
              color: isLeader ? AUGUSTA_TEXT : AUGUSTA_TEXT,
              fontFamily: '"Arial Black", Arial, sans-serif',
              letterSpacing: '0.02em',
              boxShadow: isLeader ? 'inset 0 0 0 1px rgba(0,0,0,0.10), inset 0 -2px 0 rgba(0,0,0,0.08)' : 'none',
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
                  color: isLeader ? AUGUSTA_GOLD : AUGUSTA_TEXT,
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  letterSpacing: '0.05em',
                  textShadow: isLeader
                    ? '0 1px 0 rgba(0,0,0,0.20), 0 0 6px rgba(232,192,90,0.45)'
                    : 'none',
                }}>
                  {display}
                </div>
                {/* THRU indicator if scores exist; team name otherwise */}
                {thruText && (
                  <div style={{
                    fontSize: 10, color: 'rgba(26,107,40,0.65)', fontWeight: 700,
                    letterSpacing: '0.08em',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    marginTop: 2,
                  }}>
                    {thruText}
                  </div>
                )}
                {!thruText && team && (
                  <div style={{
                    fontSize: 10, color: 'rgba(26,107,40,0.70)', fontWeight: 700,
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
                const isHint = tapHint
                  && String(tapHint.userId) === String(p.user_id)
                  && tapHint.hole === h
                // Skins decoration — only attached when this row's
                // player won the hole's skin (gold W badge), or when
                // the hole carried forward (cream ↻ badge). Other
                // players' rows on the same hole get nothing.
                let skinsBadge = null
                if (skinsOutcomes && skinsOutcomes[h]) {
                  const o = skinsOutcomes[h]
                  if (o.winner && String(o.winner) === String(p.user_id)) {
                    skinsBadge = { kind: 'win', value: o.value || 1 }
                  } else if (o.tied && o.value > 1) {
                    // Carry indicator only on the FIRST player's row
                    // for the hole — avoids stacking the same badge on
                    // every row of every losing player.
                    if (String(p.user_id) === String(participants[0]?.user_id)) {
                      skinsBadge = { kind: 'carry', value: o.value }
                    }
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
                    isHint={isHint}
                    w={HOLE_COL}
                    h={rowH}
                    overrideBg={mpBg}
                    overrideBorder={mpBorder}
                    overrideColor={mpColor}
                    skinsBadge={skinsBadge}
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
          fontSize: 11, fontWeight: 900, color: AUGUSTA_TEXT,
          fontFamily: '"Arial Black", Arial, sans-serif',
          letterSpacing: '0.06em', flexShrink: 0,
        }}>TOTALS</div>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <div style={{ minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center', fontSize: 11, fontWeight: 900, color: AUGUSTA_TEXT, letterSpacing: '0.05em', flexShrink: 0 }}>
            {netMode ? 'NET' : isMatchPlay ? 'HOLES' : 'TOT'}
          </div>
          <div style={{ minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center', fontSize: 11, fontWeight: 900, color: AUGUSTA_TEXT, letterSpacing: '0.05em', flexShrink: 0 }}>
            {isMatchPlay ? 'STATUS' : '+/−'}
          </div>
          <div style={{ minWidth: 52, textAlign: 'center', fontSize: 11, fontWeight: 900, color: AUGUSTA_TEXT, letterSpacing: '0.05em', flexShrink: 0 }}>THRU</div>
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
                  fontSize: 14, fontWeight: 900, color: AUGUSTA_TEXT,
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  letterSpacing: '0.04em',
                }}>{display}</div>
                {team && <div style={{ fontSize: 10, color: 'rgba(26,107,40,0.65)', fontWeight: 700, marginTop: 2 }}>{team.name}</div>}
                {netMode && p.handicap != null && !p.is_guest && (
                  <div style={{ fontSize: 9, color: AUGUSTA_GOLD_DIM, fontWeight: 700, marginTop: 1 }}>HCP {p.handicap}</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{
                minWidth: SUB_COL + 8, width: SUB_COL + 8, textAlign: 'center',
                fontSize: 18, fontWeight: 900, color: AUGUSTA_TEXT, flexShrink: 0,
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
                color: 'rgba(26,107,40,0.85)', flexShrink: 0,
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
// ─── LiveShareModal — live URL + QR + tee-box print page ─────────────────────
//
// Opened from the host action row's '📡 Share live' button. Hands
// the commissioner three things in one place:
//   1. The live URL (text + 'Copy' / native-share buttons)
//   2. A QR code rendered via api.qrserver.com (no npm dep)
//   3. A 'Print tee-box flyer' button that opens window.print() on
//      a styled flyer page — drop on the first tee for the
//      half-price-for-flyer-exposure motion.
//
// (2026-05-01 — Matt's GTM motion: half price + flyer + QR.)
function LiveShareModal({ outing, onClose }) {
  const code = outing.code
  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/?live=${code}`
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=8&data=${encodeURIComponent(url)}`
  const [copied, setCopied] = useState(false)

  function copy() {
    if (!navigator.clipboard) return
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }
  function nativeShare() {
    if (!navigator.share) { copy(); return }
    navigator.share({
      title: outing.name,
      url,
      text: `${outing.name} · live leaderboard`,
    }).catch(() => {})
  }
  // HTML-escape for the print flyer. Outing names can include
  // user-typed characters; without this, a name like
  //   "Matt's <Open> & Friends"
  // would break the markup. (Round 4 audit — XSS hardening.)
  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function openPrintFlyer() {
    // Open a new window with the flyer HTML. window.print() fires
    // automatically on load. Styled for letter / A4 with a big QR.
    const w = window.open('', '_blank')
    if (!w) { alert('Please allow popups to open the printable flyer.'); return }
    const safeName    = escHtml(outing.name || 'Match')
    const safeCourse  = escHtml(outing.course_name || '')
    const safeUrl     = escHtml(url)
    const safeCode    = escHtml(code)
    const safeQrSrc   = escHtml(qrSrc)
    const html = `<!doctype html>
<html><head><title>${safeName} — Live Leaderboard</title><style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #0E3B23; background: #F1E7C8; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .wrap { max-width: 720px; text-align: center; padding: 36px 24px; border: 4px double #C9A040; border-radius: 18px; background: #FFFAEB; }
  .kicker { font-size: 12px; letter-spacing: 0.30em; color: #C9A040; font-weight: 700; margin-bottom: 12px; }
  .title { font-size: 38px; font-weight: 900; letter-spacing: -0.01em; color: #0E3B23; margin: 0 0 8px; word-break: break-word; }
  .sub { font-size: 16px; color: rgba(14,59,35,0.65); margin-bottom: 28px; word-break: break-word; }
  .qr { display: block; margin: 0 auto 20px; max-width: 320px; height: auto; border: 8px solid #C9A040; border-radius: 12px; background: #fff; }
  .qr-fallback { display: none; padding: 60px 20px; border: 4px dashed #C9A040; border-radius: 12px; background: #fff; max-width: 320px; margin: 0 auto 20px; font-size: 12px; color: #0E3B23; }
  .scan { font-size: 14px; color: #0E3B23; font-weight: 600; margin-bottom: 4px; }
  .url { font-size: 13px; color: rgba(14,59,35,0.70); margin-bottom: 22px; word-break: break-all; }
  .powered { font-size: 10px; letter-spacing: 0.30em; color: #C9A040; font-weight: 700; margin: 12px 0 4px; }
  .brand { font-size: 24px; font-weight: 900; color: #0E3B23; }
  .code { font-size: 11px; color: rgba(14,59,35,0.50); letter-spacing: 0.10em; margin-top: 14px; }
</style></head>
<body><div class="wrap">
  <div class="kicker">LIVE LEADERBOARD</div>
  <div class="title">${safeName}</div>
  <div class="sub">${safeCourse}</div>
  <img class="qr" src="${safeQrSrc}" alt="QR code" onerror="this.style.display='none'; document.getElementById('qr-fb').style.display='block';"/>
  <div id="qr-fb" class="qr-fallback">QR couldn't load.<br/>Type the URL below into your phone's browser instead.</div>
  <div class="scan">Scan to follow scores live</div>
  <div class="url">${safeUrl}</div>
  <div class="powered">POWERED BY</div>
  <div class="brand">The Match</div>
  <div class="code">CODE · ${safeCode}</div>
</div>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));</script>
</body></html>`
    w.document.open(); w.document.write(html); w.document.close()
  }

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 380,
        background: 'linear-gradient(180deg, #11201A 0%, #0A1410 100%)',
        borderRadius: 20, padding: '22px 22px 24px',
        border: '1px solid rgba(245,215,138,0.30)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.18em', color: '#5ED47A', fontWeight: 800 }}>📡 LIVE LEADERBOARD</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', marginTop: 2 }}>Share with players + spectators</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 999, width: 30, height: 30, color: '#fff', fontSize: 16, cursor: 'pointer',
            fontFamily: 'inherit', flexShrink: 0,
          }}>✕</button>
        </div>

        {/* QR — white card so the camera scans it cleanly even on the
            dark theme. Falls back to the URL if the QR API fails to
            load. (Round 4 audit — fallback for offline / API down.) */}
        <div style={{
          background: '#fff', padding: 14, borderRadius: 14,
          marginBottom: 14, textAlign: 'center',
          border: '1px solid rgba(245,215,138,0.30)',
          minHeight: 268,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src={qrSrc} alt="QR code"
            style={{ width: '100%', maxWidth: 240, height: 'auto', display: 'block', margin: '0 auto' }}
            onError={(e) => {
              const img = e.currentTarget
              img.style.display = 'none'
              const fb = document.getElementById('tm-qr-fallback')
              if (fb) fb.style.display = 'block'
            }} />
          <div id="tm-qr-fallback" style={{
            display: 'none', color: '#0E3B23', fontSize: 12, lineHeight: 1.5,
            padding: '20px', textAlign: 'center',
          }}>
            QR generator unreachable.<br/>
            Use the URL below — it still works.
          </div>
        </div>

        {/* URL row + copy */}
        <div style={{
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 10, padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        }}>
          <div style={{
            flex: 1, minWidth: 0, fontSize: 12, color: 'rgba(255,255,255,0.85)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: 'monospace',
          }}>{url}</div>
          <button onClick={copy} style={{
            padding: '5px 10px', borderRadius: 6,
            background: copied ? 'rgba(94,212,122,0.20)' : 'rgba(245,215,138,0.16)',
            border: '1px solid', borderColor: copied ? 'rgba(94,212,122,0.40)' : 'rgba(245,215,138,0.40)',
            color: copied ? '#5ED47A' : '#F5D78A',
            fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={nativeShare} style={{
            flex: 1, padding: '12px',
            background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
            border: 'none', borderRadius: 12, color: '#070C09',
            fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}>Share</button>
          <button onClick={openPrintFlyer} style={{
            flex: 1, padding: '12px',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 12, color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
              Print flyer
            </span>
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 10, lineHeight: 1.4 }}>
          Print the flyer for the first-tee post. Anyone who scans it<br />sees this leaderboard live — no app required.
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── AnnouncementBanner (item 7) ─────────────────────────────────────────────
// Surfaces the most recent commissioner announcement at the top of the
// Outing page for every participant. Dismissible per-id via localStorage
// so a user who's already read the message doesn't keep seeing it across
// page navigations. New announcements get a fresh id → fresh banner.
// (2026-05-02)
function AnnouncementBanner({ outing }) {
  const list = Array.isArray(outing.state?.announcements) ? outing.state.announcements : []
  const latest = list[0]
  const [dismissed, setDismissed] = useState(false)
  const code = outing.code

  // Load dismissed-id from localStorage on mount + when code changes.
  useEffect(() => {
    setDismissed(false)
    if (!latest?.id) return
    try {
      const seen = localStorage.getItem(`tm_announce_seen_${code}`)
      if (seen === latest.id) setDismissed(true)
    } catch { /* ignore */ }
  }, [code, latest?.id])

  if (!latest || dismissed) return null

  function whenStr(iso) {
    if (!iso) return ''
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return ''
    const ms = Date.now() - t
    const min = Math.floor(ms / 60000)
    if (min < 1)  return 'just now'
    if (min < 60) return `${min}m ago`
    if (min < 1440) return `${Math.floor(min / 60)}h ago`
    return `${Math.floor(min / 1440)}d ago`
  }

  return (
    <div style={{
      marginTop: 8, padding: '10px 14px',
      background: 'linear-gradient(135deg, rgba(46,160,255,0.14), rgba(46,160,255,0.04))',
      border: '1px solid rgba(46,160,255,0.40)',
      borderRadius: 12,
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7CC5FF"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 1 }}>
        <path d="M3 11l18-5v12L3 13z"/>
        <path d="M11.6 16.8a3 3 0 11-5.2 3"/>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: '#7CC5FF', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
            Commissioner
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>· {whenStr(latest.posted_at)}</span>
        </div>
        <div style={{
          fontSize: 12, color: 'rgba(255,255,255,0.92)',
          lineHeight: 1.45, whiteSpace: 'pre-wrap',
        }}>{latest.text}</div>
      </div>
      <button
        onClick={() => {
          try { localStorage.setItem(`tm_announce_seen_${code}`, latest.id) } catch { /* ignore */ }
          setDismissed(true)
        }}
        aria-label="Dismiss"
        style={{
          background: 'transparent', border: 'none',
          color: 'rgba(255,255,255,0.55)', fontSize: 16, cursor: 'pointer',
          padding: '0 4px', lineHeight: 1, flexShrink: 0,
        }}>✕</button>
    </div>
  )
}

// ─── CommsTab (item 7) ───────────────────────────────────────────────────────
// Host-only announcements composer + history + cancel-outing affordance.
// Tab in CommissionerPanel. Posting an announcement fires push to every
// non-host participant. Cancel changes outing.status to 'cancelled' and
// pushes a notice to the roster — the cancel button confirms via window
// .confirm because there's no undo. (2026-05-02)
function CommsTab({ code, outing, onAnnouncementPosted, onStateMerge, onCancelled }) {
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState(null)
  const announcements = Array.isArray(outing.state?.announcements)
    ? outing.state.announcements
    : []
  const status = outing.status

  async function postAnnouncement() {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    if (trimmed.length > 600) {
      setError('Announcement is too long (600 char max).')
      return
    }
    setError(null)
    setPosting(true)
    try {
      const data = await post(`/api/outings/${code}/announcement`, { text: trimmed })
      onAnnouncementPosted?.(data?.announcements || [])
      setText('')
    } catch (err) {
      setError(err?.message || 'Failed to post announcement')
    } finally {
      setPosting(false)
    }
  }

  async function cancelOuting() {
    const reason = window.prompt(
      'Cancel this match? Every participant will get a push notification.\n\n' +
      'Optional: enter a short reason (rain-out, course closed, etc.) — leave blank to skip.',
      ''
    )
    if (reason === null) return
    setCancelling(true)
    try {
      await post(`/api/outings/${code}/cancel`, { reason: reason.trim() || null })
      onCancelled?.()
    } catch (err) {
      alert(`Failed to cancel: ${err?.message || 'Unknown error'}`)
    } finally {
      setCancelling(false)
    }
  }

  function whenStr(iso) {
    if (!iso) return ''
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return ''
    const ms = Date.now() - t
    const min = Math.floor(ms / 60000)
    if (min < 1)  return 'just now'
    if (min < 60) return `${min}m ago`
    if (min < 1440) return `${Math.floor(min / 60)}h ago`
    return `${Math.floor(min / 1440)}d ago`
  }

  return (
    <div>
      {/* Composer */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 8, lineHeight: 1.5 }}>
          Post a message to every player. They'll get a push notification AND see it pinned at the top of the match page.
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="e.g. We're shotgun-starting at 9am sharp. Check in at the pro shop 30 min early."
          rows={3}
          maxLength={600}
          style={{
            width: '100%', padding: 10, fontFamily: 'inherit', fontSize: 13,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10, color: '#fff', resize: 'vertical', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)' }}>
            {text.length} / 600
          </div>
          <button
            onClick={postAnnouncement}
            disabled={posting || text.trim().length === 0}
            style={{
              padding: '8px 16px', borderRadius: 'var(--tm-radius-lg)',
              background: text.trim().length > 0
                ? 'linear-gradient(135deg, rgba(245,215,138,0.55), rgba(201,160,64,0.85))'
                : 'rgba(255,255,255,0.06)',
              color: text.trim().length > 0 ? '#1A1A1A' : 'rgba(255,255,255,0.5)',
              fontWeight: 800, fontSize: 13, border: 'none',
              cursor: posting ? 'not-allowed' : (text.trim().length > 0 ? 'pointer' : 'default'),
              opacity: posting ? 0.7 : 1, fontFamily: 'inherit',
            }}>
            {posting ? 'Posting…' : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11l18-5v12L3 13z"/>
                  <path d="M11.6 16.8a3 3 0 1 1 -5.2 3"/>
                </svg>
                Post &amp; notify
              </span>
            )}
          </button>
        </div>
        {error && (
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 11,
            background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.40)',
            color: '#F8B4B4',
          }}>{error}</div>
        )}
      </div>

      {/* Cancel-outing — separate dangerous action, gated by confirm */}
      {status !== 'cancelled' && status !== 'closed' && (
        <div style={{
          marginBottom: 16, padding: '10px 12px', borderRadius: 10,
          background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.25)',
        }}>
          <div style={{ fontSize: 11, color: '#F8B4B4', fontWeight: 700, marginBottom: 6 }}>
            Cancel this match
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 8, lineHeight: 1.4 }}>
            Push a cancellation notice to everyone on the roster. Match stays in the DB for history but is removed from active boards. This can't be undone.
          </div>
          <button
            onClick={cancelOuting}
            disabled={cancelling}
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.50)',
              background: 'rgba(248,113,113,0.10)', color: '#F87171',
              fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              opacity: cancelling ? 0.5 : 1,
            }}>
            {cancelling ? 'Cancelling…' : 'Cancel match'}
          </button>
        </div>
      )}

      {/* Item 8 — CSV export + season tag. Lives in Comms because
          it's all "league management" tooling that doesn't fit
          Players/Edit-scores. */}
      <div style={{
        marginBottom: 16, padding: '10px 12px', borderRadius: 10,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ fontSize: 11, color: '#F5D78A', fontWeight: 800, letterSpacing: '0.06em', marginBottom: 6 }}>
          EXPORT &amp; SEASON
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 8, lineHeight: 1.4 }}>
          Download a CSV of every player's scores for your own records, and tag this match with a season string so it groups into season-over-season standings.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => {
              // Item 9 — open the print-friendly results page in a new
              // tab. Auto-triggers the system print dialog after layout
              // settles. Works regardless of host's auth state in this
              // tab (uses the public endpoint).
              const url = `${window.location.origin}/?print=${encodeURIComponent(code)}`
              window.open(url, '_blank', 'noopener')
            }}
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)',
              background: 'transparent', color: 'rgba(255,255,255,0.85)',
              fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
              Print results
            </span>
          </button>
          <a
            href={`/api/outings/${code}/export.csv`}
            download
            onClick={async (e) => {
              // Manual fetch with auth header — anchors don't carry the
              // bearer token. We trigger the download via blob URL.
              e.preventDefault()
              try {
                const res = await fetch(`/api/outings/${code}/export.csv`, {
                  headers: { Authorization: `Bearer ${localStorage.getItem('tm_token')}` },
                })
                if (!res.ok) throw new Error(`Export failed (${res.status})`)
                const blob = await res.blob()
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `match-${code}.csv`
                document.body.appendChild(a)
                a.click()
                a.remove()
                URL.revokeObjectURL(url)
              } catch (err) {
                alert(err?.message || 'Could not export')
              }
            }}
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(245,215,138,0.40)',
              background: 'rgba(245,215,138,0.10)', color: '#F5D78A',
              fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
              textDecoration: 'none',
            }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download CSV
            </span>
          </a>
          <button
            onClick={async () => {
              const cur = outing.state?.season || ''
              const v = window.prompt(
                'Season tag — group this match with others for season-long standings.\n' +
                'Leave blank to clear. Examples: "2026", "2026-spring", "Tuesday Night League".',
                cur
              )
              if (v === null) return
              try {
                await put(`/api/outings/${code}/season`, { season: v.trim() })
                onStateMerge?.({ season: v.trim() || null })
              } catch (err) {
                alert(err?.message || 'Could not save season tag')
              }
            }}
            style={{
              padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)',
              background: 'transparent', color: 'rgba(255,255,255,0.85)',
              fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Season{outing.state?.season ? ` · ${outing.state.season}` : ''}
            </span>
          </button>
        </div>
      </div>

      {/* History */}
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>
        RECENT ANNOUNCEMENTS
      </div>
      {announcements.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.40)', textAlign: 'center', padding: '24px 0', fontSize: 12, fontStyle: 'italic' }}>
          No announcements yet.
        </div>
      ) : announcements.map(a => (
        <div key={a.id} style={{
          padding: '10px 12px', borderRadius: 10, marginBottom: 6,
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#F5D78A' }}>{a.posted_by_name || 'Commissioner'}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)' }}>{whenStr(a.posted_at)}</div>
          </div>
          <div style={{ fontSize: 13, color: '#fff', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{a.text}</div>
        </div>
      ))}
    </div>
  )
}

// ─── StablefordEditor (6.5) ──────────────────────────────────────────────────
// Lives inside CommissionerPanel under the 'Points' tab. Renders the
// 7-bucket point map with one input per bucket, plus quick-load buttons
// for the two presets (Standard / Modified). Save hits PUT
// /:code/stableford-points; on success we mirror the new map into local
// outing.state so leaderboards recompute immediately.
function StablefordEditor({ code, outing, onSaved }) {
  const seedFromOuting = () => (outing.state?.stableford_points && typeof outing.state.stableford_points === 'object')
    ? { ...outing.state.stableford_points }
    : { double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1 }
  // 'baseline' is the last-saved (or initially-loaded) point map. dirty
  // is computed against THIS, not a frozen useState-initializer snapshot.
  // Without this, after a successful save the button sticks on
  // "Save points" forever because the dirty check still compares to the
  // pre-save values. (Round 14 edge-case audit.)
  const [baseline, setBaseline] = useState(seedFromOuting)
  const [pts, setPts] = useState(seedFromOuting)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  const buckets = [
    { key: 'double_eagle', label: 'Double Eagle', sub: '−3 to par' },
    { key: 'eagle',        label: 'Eagle',        sub: '−2 to par' },
    { key: 'birdie',       label: 'Birdie',       sub: '−1 to par' },
    { key: 'par',          label: 'Par',          sub: 'even' },
    { key: 'bogey',        label: 'Bogey',        sub: '+1 to par' },
    { key: 'double',       label: 'Double',       sub: '+2 to par' },
    { key: 'worse',        label: 'Triple+',      sub: '+3 or worse' },
  ]

  function setBucket(key, raw) {
    const v = raw === '' ? '' : Number(raw)
    setPts(prev => ({ ...prev, [key]: v }))
  }

  function loadPreset(name) {
    if (name === 'standard') {
      setPts({ double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1 })
    } else if (name === 'modified') {
      setPts({ double_eagle: 8, eagle: 5, birdie: 2, par: 0, bogey: -1, double: -3, worse: -3 })
    }
  }

  async function save() {
    setError(null)
    // Validate each bucket — finite number in [-10, 20].
    const sanitized = {}
    for (const b of buckets) {
      const v = Number(pts[b.key])
      if (!Number.isFinite(v) || v < -10 || v > 20) {
        setError(`${b.label} must be a number between −10 and 20.`)
        return
      }
      sanitized[b.key] = v
    }
    setSaving(true)
    try {
      const data = await put(`/api/outings/${code}/stableford-points`, { points: sanitized })
      const saved = data?.stableford_points || sanitized
      onSaved?.(saved)
      setBaseline({ ...saved })   // refresh baseline so dirty resets
      setSavedAt(Date.now())
    } catch (err) {
      setError(err?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Detect dirty (have any inputs been edited from the saved state?)
  // so the save button can disable when nothing has changed.
  const dirty = buckets.some(b => Number(pts[b.key]) !== Number(baseline[b.key] ?? 0))

  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 10, lineHeight: 1.5 }}>
        Edit the points awarded for each score relative to par. Range −10 to 20. Saving recomputes the leaderboard immediately for everyone watching.
      </div>
      {/* Preset quick-loads */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[
          { id: 'standard', label: 'Load Standard' },
          { id: 'modified', label: 'Load Modified' },
        ].map(opt => (
          <button key={opt.id} onClick={() => loadPreset(opt.id)} style={{
            flex: 1, padding: '7px 10px', borderRadius: 8,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>{opt.label}</button>
        ))}
      </div>
      {/* Bucket inputs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, marginBottom: 12 }}>
        {buckets.map(b => (
          <div key={b.key} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, padding: '8px 12px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{b.label}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.50)', marginTop: 2 }}>{b.sub}</div>
            </div>
            <input
              type="number"
              step="1"
              min="-10"
              max="20"
              value={pts[b.key] === '' ? '' : pts[b.key]}
              onChange={e => setBucket(b.key, e.target.value)}
              style={{
                width: 64, height: 36, textAlign: 'center',
                fontSize: 16, fontWeight: 900, color: '#fff',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
              }}
            />
          </div>
        ))}
      </div>
      {error && (
        <div style={{
          background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.40)',
          color: '#F8B4B4', padding: '8px 10px', borderRadius: 8, marginBottom: 10, fontSize: 11,
        }}>{error}</div>
      )}
      <button onClick={save} disabled={saving || !dirty} style={{
        width: '100%', padding: 12, borderRadius: 'var(--tm-radius-lg)',
        background: dirty
          ? 'linear-gradient(135deg, rgba(245,215,138,0.55), rgba(201,160,64,0.85))'
          : 'rgba(255,255,255,0.06)',
        color: dirty ? '#1A1A1A' : 'rgba(255,255,255,0.5)',
        fontWeight: 800, fontSize: 14, border: 'none',
        cursor: saving ? 'not-allowed' : (dirty ? 'pointer' : 'default'),
        opacity: saving ? 0.7 : 1, fontFamily: 'inherit',
      }}>
        {saving ? 'Saving…' : dirty ? 'Save points' : (savedAt ? '✓ Saved' : 'No changes')}
      </button>
    </div>
  )
}

// ─── CommissionerPanel — host-only Manage modal ──────────────────────────────
//
// Lives between GroupSetup and the rest of the page. Two tabs:
//   1. Players — full list of participants. Withdraw / reinstate any
//      one of them (state.participants[i].withdrawn = true). Withdrawn
//      players are hidden from the leaderboard but their scores
//      remain in the DB.
//   2. Audit — last 200 score changes for this outing (oldest at the
//      bottom). Hits GET /:code/audit on open + when 'Refresh' tapped.
//
// Score editing itself isn't a separate tab — the host can already
// tap any cell on the scorecard view to enter or correct a score.
// The conflict-warning + audit log from B2 cover the rest.
//
// (2026-05-01 — league must-have B3.)
function CommissionerPanel({ outing, onClose, onParticipantsUpdated }) {
  const code = outing.code
  const [tab, setTab]               = useState('players')  // 'players' | 'scores' | 'audit'
  const [busyIds, setBusyIds]       = useState({})
  const [auditEntries, setAudit]    = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)
  // 6.6 — paginated audit. Each fetch returns { entries, next_cursor }.
  // Cursor is opaque on the client. null cursor = no more pages.
  const [auditCursor, setAuditCursor]   = useState(null)
  const [auditLoadingMore, setAuditLoadingMore] = useState(false)
  const AUDIT_PAGE_SIZE = 50  // smaller than the server cap; loads fast on slow signal
  // Score-edit grid state — keyed by `${user_id}-${hole}` so cells
  // can be edited individually without clobbering each other. (B3
  // polish — host can bulk-correct without leaving the panel.)
  const [editing, setEditing]       = useState(null)        // { user_id, hole, value }
  const [scoreSaveBusy, setScoreSaveBusy] = useState(false)
  const all = outing.state?.participants ?? []
  const holeCount = outing.state?.holes ?? 18
  const holes = Array.from({ length: holeCount }, (_, i) => i)
  // Pull pars from the outing for the score-edit grid header. Falls
  // back to par-4 across the board if the course doesn't carry per-
  // hole pars (matches the convention used elsewhere in this file).
  const realHolePars = Array.isArray(outing.hole_pars) ? outing.hole_pars : null
  const gridHolePars = realHolePars && realHolePars.length >= holeCount
    ? realHolePars.slice(0, holeCount)
    : holes.map(() => 4)

  async function toggleWithdraw(userId, currentlyWithdrawn) {
    setBusyIds(b => ({ ...b, [userId]: true }))
    try {
      await post(`/api/outings/${code}/withdraw`, { user_id: userId, withdrawn: !currentlyWithdrawn })
      const next = all.map(p =>
        String(p.user_id) === String(userId) ? { ...p, withdrawn: !currentlyWithdrawn } : p
      )
      onParticipantsUpdated?.(next)
    } catch (err) {
      alert(`Failed to ${currentlyWithdrawn ? 'reinstate' : 'withdraw'} player. Try again.`)
    } finally {
      setBusyIds(b => { const n = { ...b }; delete n[userId]; return n })
    }
  }

  // Item 6 — toggle no-show flag. Mirrors toggleWithdraw shape.
  async function toggleNoShow(userId, currentlyNoShow) {
    setBusyIds(b => ({ ...b, [userId]: true }))
    try {
      await post(`/api/outings/${code}/no-show`, { user_id: userId, no_show: !currentlyNoShow })
      const next = all.map(p =>
        String(p.user_id) === String(userId) ? { ...p, no_show: !currentlyNoShow } : p
      )
      onParticipantsUpdated?.(next)
    } catch (err) {
      alert(`Failed to ${currentlyNoShow ? 'clear' : 'mark'} no-show. Try again.`)
    } finally {
      setBusyIds(b => { const n = { ...b }; delete n[userId]; return n })
    }
  }

  // Item 6 — change the outing-level no-show policy. Updates local
  // outing.state via the same onParticipantsUpdated extras channel
  // the handicap-override editor uses.
  async function setNoShowPolicy(policy) {
    try {
      const data = await put(`/api/outings/${code}/no-show-policy`, { policy })
      onParticipantsUpdated?.(all, { no_show_policy: data?.no_show_policy || policy })
    } catch (err) {
      alert(`Failed to set no-show policy: ${err?.message || 'Unknown error'}`)
    }
  }

  // 6.4 — Per-event handicap override. Sends a number (or null to clear)
  // to PUT /:code/handicap-override. Server stores it on
  // outing.state.handicap_overrides; netStrokes() prefers it over
  // tm_users.handicap for THIS outing. Local state.handicap_overrides
  // is updated optimistically so UI re-renders without a full reload.
  // Validation: number must be in [-10, 54], or null/empty to clear.
  // (2026-05-02)
  async function setHandicapOverride(userId, rawValue) {
    let body
    if (rawValue === '' || rawValue == null) {
      body = { user_id: userId, handicap: null }
    } else {
      const n = Number(rawValue)
      if (!Number.isFinite(n)) {
        alert('Handicap must be a number, like 12.4 or +2 (use -2 for plus-handicaps).')
        return false
      }
      if (n < -10 || n > 54) {
        alert('Handicap must be between -10 and 54.')
        return false
      }
      body = { user_id: userId, handicap: n }
    }
    setBusyIds(b => ({ ...b, [userId]: true }))
    try {
      const data = await put(`/api/outings/${code}/handicap-override`, body)
      // Optimistic state mutation — the parent reads
      // outing.state.handicap_overrides on next render.
      onParticipantsUpdated?.(all, { handicap_overrides: data?.handicap_overrides || {} })
      return true
    } catch (err) {
      alert(`Failed to save handicap override: ${err?.message || 'Unknown error'}`)
      return false
    } finally {
      setBusyIds(b => { const n = { ...b }; delete n[userId]; return n })
    }
  }

  // 6.6 — Initial audit page. Resets cursor + entries; subsequent
  // pages are pulled via loadMoreAudit().
  async function loadAudit() {
    setAuditLoading(true)
    try {
      const data = await api(`/api/outings/${code}/audit?limit=${AUDIT_PAGE_SIZE}`)
      setAudit(data?.entries || [])
      setAuditCursor(data?.next_cursor || null)
    } catch {
      setAudit([])
      setAuditCursor(null)
    } finally {
      setAuditLoading(false)
    }
  }

  // 6.6 — Append the next page using the cursor returned by the prior
  // load. No-op when cursor is null (we're at the end). Failures keep
  // the existing entries; the user can tap again to retry.
  async function loadMoreAudit() {
    if (!auditCursor || auditLoadingMore) return
    setAuditLoadingMore(true)
    try {
      const data = await api(
        `/api/outings/${code}/audit?limit=${AUDIT_PAGE_SIZE}&cursor=${encodeURIComponent(auditCursor)}`
      )
      const more = data?.entries || []
      setAudit(prev => Array.isArray(prev) ? [...prev, ...more] : more)
      setAuditCursor(data?.next_cursor || null)
    } catch {
      // Keep auditCursor non-null so the user can retry. Surface a
      // small banner instead of swallowing the error silently.
      alert('Could not load more history. Tap again to retry.')
    } finally {
      setAuditLoadingMore(false)
    }
  }

  // Save a single cell from the score-edit grid. Routes through
  // runWithQueue so commissioner edits at a course with poor signal
  // queue up rather than failing outright. force:true so the
  // conflict guard never fires (commissioner editing IS the conflict
  // resolution). On success or queued, mutates local participant
  // state immediately so the grid reflects the change.
  async function saveCell(userId, hole, newScore) {
    const n = Number(newScore)
    if (!Number.isFinite(n) || n < 1 || n > 20) return
    setScoreSaveBusy(true)
    try {
      await runWithQueue({
        url: `/api/outings/${code}/scores/host`,
        method: 'PUT',
        body: { hole, score: n, user_id: userId, force: true },
      })
      // Optimistic update — local grid reflects the change even when
      // the call was queued instead of completing online.
      const next = all.map(p => {
        if (String(p.user_id) !== String(userId)) return p
        const scores = Array.isArray(p.scores) ? [...p.scores] : new Array(holeCount).fill(0)
        while (scores.length < holeCount) scores.push(0)
        scores[hole] = n
        const total = scores.reduce((s, x) => s + (x || 0), 0)
        const holesPlayed = scores.filter(x => x > 0).length
        return { ...p, scores, total, holes_played: holesPlayed }
      })
      onParticipantsUpdated?.(next)
      // Auto-advance to the next hole on the same row, so bulk
      // corrections don't require tapping every cell. Stops at the
      // last hole. (Round 10 audit.)
      if (hole < holeCount - 1) {
        setEditing({ user_id: userId, hole: hole + 1, value: '' })
      } else {
        setEditing(null)
      }
    } catch (err) {
      alert(`Save failed: ${err.message || 'Unknown error'}`)
    } finally {
      setScoreSaveBusy(false)
    }
  }
  useEffect(() => {
    if (tab === 'audit' && auditEntries == null) loadAudit()
  }, [tab])  // eslint-disable-line react-hooks/exhaustive-deps

  // Map user_id → display name for the audit list. Includes withdrawn.
  const nameForId = (uid) => all.find(p => String(p.user_id) === String(uid))?.name || `#${uid}`

  function whenStr(iso) {
    if (!iso) return ''
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return ''
    const ms = Date.now() - t
    const min = Math.floor(ms / 60000)
    if (min < 1)  return 'just now'
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24)  return `${hr}h ago`
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430,
        background: 'linear-gradient(180deg, #11201A 0%, #0A1410 100%)',
        borderRadius: '24px 24px 0 0',
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 -10px 50px rgba(0,0,0,0.7)',
      }}>
        {/* Drag handle + header */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>
              Manage Outing
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.50)', marginTop: 2 }}>
              Host-only · withdrawals + audit log
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 999, width: 32, height: 32, color: '#fff', fontSize: 18, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>✕</button>
        </div>

        {/* Tab bar — Stableford tab only renders when the outing
            actually uses Stableford scoring. (6.5)
            Comms tab added for item 7 (announcements + cancel). */}
        <div style={{ display: 'flex', padding: '10px 20px 0', gap: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'players', label: `Players · ${all.length}` },
            { id: 'scores',  label: 'Edit scores' },
            { id: 'comms',   label: 'Comms' },
            ...((outing.scoring_formats || []).includes('stableford')
              ? [{ id: 'stableford', label: 'Points' }]
              : []),
            { id: 'audit',   label: 'History' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: '1 1 22%', minWidth: 80, padding: '8px 10px', borderRadius: 10,
              background: tab === t.id ? 'rgba(245,215,138,0.14)' : 'rgba(255,255,255,0.04)',
              border: '1px solid', borderColor: tab === t.id ? 'rgba(245,215,138,0.40)' : 'rgba(255,255,255,0.10)',
              color: tab === t.id ? '#F5D78A' : 'rgba(255,255,255,0.65)',
              fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 28px' }}>
          {tab === 'players' && (
            <>
              {all.length === 0 && (
                <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13, padding: '40px 0' }}>
                  No players yet.
                </div>
              )}
              {/* 6.4 — Per-event handicap override hint banner. Surfaces
                  the feature for hosts who don't know it exists. */}
              <div style={{
                fontSize: 11, color: 'rgba(255,255,255,0.55)',
                marginBottom: 10, lineHeight: 1.5,
              }}>
                Tap a player's <strong style={{ color: '#F5D78A' }}>HCP</strong> chip to override their handicap for THIS outing only — useful for league rules, sandbagger flags, or guests without a stored index.
              </div>
              {/* Item 6 — No-show policy selector. Determines how the
                  leaderboard renders no-show players league-wide for
                  this outing. */}
              {(() => {
                const policy = outing.state?.no_show_policy || 'dns'
                return (
                  <div style={{
                    padding: '10px 12px', marginBottom: 10,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.10em', color: '#F5D78A', textTransform: 'uppercase', marginBottom: 6 }}>
                      No-show policy
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 8, lineHeight: 1.45 }}>
                      How no-shows count when the match ends. Auto-applied at end-match based on zero scores; can be toggled per player below.
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[
                        { id: 'dns',         label: 'DNS',        desc: 'excluded' },
                        { id: 'max_plus_2',  label: 'Max +2',     desc: 'par+2 every hole' },
                        { id: 'manual',      label: 'Manual',     desc: 'commissioner sets' },
                      ].map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setNoShowPolicy(opt.id)}
                          style={{
                            flex: '1 1 30%', minWidth: 92, padding: '7px 8px', borderRadius: 8,
                            background: policy === opt.id ? 'rgba(245,215,138,0.14)' : 'rgba(255,255,255,0.05)',
                            border: '1px solid', borderColor: policy === opt.id ? 'rgba(245,215,138,0.50)' : 'rgba(255,255,255,0.10)',
                            color: policy === opt.id ? '#F5D78A' : 'rgba(255,255,255,0.75)',
                            fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                            textAlign: 'left',
                          }}>
                          <div>{opt.label}</div>
                          <div style={{ fontSize: 9, fontWeight: 600, marginTop: 2, opacity: 0.7 }}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}
              {all.length === 0 && (
                <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13, padding: '40px 0' }}>
                  No players yet.
                </div>
              )}
              {all.map(p => {
                const wd = !!p.withdrawn
                const ns = !!p.no_show
                const busy = busyIds[p.user_id]
                const overrides = outing.state?.handicap_overrides || {}
                const ov = overrides[String(p.user_id)]
                const hasOverride = ov != null && Number.isFinite(Number(ov))
                const effective = hasOverride ? Number(ov) : (p.handicap != null ? parseFloat(p.handicap) : null)
                const rowBg = wd ? 'rgba(248,113,113,0.06)'
                  : ns ? 'rgba(180,180,180,0.06)'
                  : 'rgba(255,255,255,0.04)'
                const rowBorder = wd ? 'rgba(248,113,113,0.25)'
                  : ns ? 'rgba(180,180,180,0.25)'
                  : 'rgba(255,255,255,0.07)'
                return (
                  <div key={p.user_id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 12px', borderRadius: 12, marginBottom: 8,
                    background: rowBg,
                    border: '1px solid', borderColor: rowBorder,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'rgba(245,215,138,0.18)', border: '1px solid rgba(245,215,138,0.40)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#F5D78A', fontSize: 14, fontWeight: 800, flexShrink: 0,
                      opacity: (wd || ns) ? 0.5 : 1,
                    }}>{(p.name || '?').slice(0,1).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 700, color: (wd || ns) ? 'rgba(255,255,255,0.5)' : '#fff',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        textDecoration: wd ? 'line-through' : 'none',
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {p.name}
                        </span>
                        {ns && !wd && (
                          <span style={{
                            fontSize: 8, fontWeight: 900, letterSpacing: '0.1em',
                            background: 'rgba(180,180,180,0.20)', color: 'rgba(255,255,255,0.85)',
                            padding: '2px 5px', borderRadius: 4, flexShrink: 0,
                          }}>NO-SHOW</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.50)', marginTop: 2 }}>
                        {wd ? 'WITHDRAWN — excluded from leaderboard'
                            : ns ? 'NO-SHOW — counted per outing policy'
                            : p.is_guest ? 'Guest · no app account'
                            : `Total: ${p.total ?? 0} · ${p.holes_played ?? 0} holes played`}
                      </div>
                    </div>
                    {/* HCP chip — single-tap to edit per-event override.
                        Gold-bordered when overridden so the host can see at a
                        glance which players are on a custom handicap. */}
                    {!wd && (
                      <button
                        onClick={() => {
                          const cur = hasOverride ? String(ov) : ''
                          const v = window.prompt(
                            `Per-event handicap for ${p.name}\n` +
                            `Stored index: ${p.handicap != null ? parseFloat(p.handicap).toFixed(1) : '—'}\n\n` +
                            `Enter a number (e.g. 12.4 or -2 for plus). ` +
                            `Leave blank to clear the override.`,
                            cur
                          )
                          if (v === null) return  // cancel
                          setHandicapOverride(p.user_id, v.trim())
                        }}
                        disabled={busy}
                        title={hasOverride ? `Override: ${ov} · stored ${p.handicap ?? '—'}` : 'Tap to set per-event handicap'}
                        style={{
                          padding: '4px 8px', borderRadius: 8, border: '1px solid',
                          borderColor: hasOverride ? 'rgba(245,215,138,0.65)' : 'rgba(255,255,255,0.18)',
                          background: hasOverride ? 'rgba(245,215,138,0.12)' : 'transparent',
                          color: hasOverride ? '#F5D78A' : 'rgba(255,255,255,0.65)',
                          fontSize: 10, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                          letterSpacing: '0.04em', opacity: busy ? 0.6 : 1,
                          minWidth: 52, textAlign: 'center',
                        }}>
                        HCP {effective != null
                          ? (Number.isInteger(effective) ? effective : effective.toFixed(1))
                          : '—'}
                        {hasOverride && (
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                            <path d="M12 2 L14.4 8.6 L21.5 9.3 L16.2 14 L17.8 21 L12 17.3 L6.2 21 L7.8 14 L2.5 9.3 L9.6 8.6 Z"/>
                          </svg>
                        )}
                      </button>
                    )}
                    {/* Item 6 — No-show toggle. Hidden when player is
                        withdrawn (mutually exclusive concepts in
                        practice). Compact label so the row still fits
                        Withdraw + HCP chip + this on a 390px viewport. */}
                    {!wd && (
                      <button
                        onClick={() => toggleNoShow(p.user_id, ns)}
                        disabled={busy}
                        title={ns ? 'Clear no-show flag' : 'Mark as no-show'}
                        style={{
                          padding: '6px 8px', borderRadius: 8, border: '1px solid',
                          borderColor: ns ? 'rgba(180,180,180,0.50)' : 'rgba(255,255,255,0.18)',
                          background: ns ? 'rgba(180,180,180,0.18)' : 'transparent',
                          color: ns ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)',
                          fontSize: 9, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                          letterSpacing: '0.06em', opacity: busy ? 0.6 : 1,
                          minWidth: 36, textAlign: 'center',
                        }}>
                        {ns ? 'NS ✓' : 'NS'}
                      </button>
                    )}
                    <button
                      onClick={() => toggleWithdraw(p.user_id, wd)}
                      disabled={busy}
                      style={{
                        padding: '6px 12px', borderRadius: 999, border: 'none',
                        background: wd ? 'rgba(94,212,122,0.16)' : 'rgba(248,113,113,0.16)',
                        color: wd ? '#5ED47A' : '#F87171',
                        fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                        opacity: busy ? 0.6 : 1,
                      }}>
                      {busy ? '…' : wd ? 'Reinstate' : 'Withdraw'}
                    </button>
                  </div>
                )
              })}
            </>
          )}

          {tab === 'scores' && (
            <>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 10 }}>
                Tap any cell to correct a score. Changes go through the audit log.
              </div>
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{
                  borderCollapse: 'separate', borderSpacing: 0,
                  fontSize: 11, color: '#fff', minWidth: holeCount * 32 + 110,
                }}>
                  <thead>
                    <tr>
                      <th style={{
                        position: 'sticky', left: 0, background: '#0E1812',
                        padding: '6px 8px', fontSize: 9, fontWeight: 800,
                        color: 'rgba(255,255,255,0.55)', letterSpacing: '0.06em',
                        textAlign: 'left', minWidth: 100, zIndex: 1,
                      }}>HOLE</th>
                      {holes.map(h => (
                        <th key={h} style={{
                          width: 32, padding: '6px 0', textAlign: 'center',
                          fontSize: 9, fontWeight: 800,
                          color: 'rgba(255,255,255,0.55)',
                        }}>{h + 1}</th>
                      ))}
                      <th style={{
                        width: 50, padding: '6px 8px', textAlign: 'center',
                        fontSize: 9, fontWeight: 800,
                        color: '#F5D78A', letterSpacing: '0.06em',
                        background: 'rgba(245,215,138,0.06)',
                      }}>TOT</th>
                    </tr>
                    {/* Par sub-header — gives at-a-glance context so
                        the host can see whether a 5 is a par (par-5)
                        or a double-bogey (par-3). */}
                    <tr>
                      <th style={{
                        position: 'sticky', left: 0, background: '#0E1812',
                        padding: '0 8px 6px', fontSize: 9, fontWeight: 700,
                        color: 'rgba(255,255,255,0.40)', letterSpacing: '0.06em',
                        textAlign: 'left', minWidth: 100, zIndex: 1,
                      }}>PAR</th>
                      {gridHolePars.map((p, idx) => (
                        <th key={idx} style={{
                          width: 32, padding: '0 0 6px', textAlign: 'center',
                          fontSize: 10, fontWeight: 700,
                          color: 'rgba(245,215,138,0.55)',
                        }}>{p}</th>
                      ))}
                      <th style={{
                        width: 50, padding: '0 8px 6px', textAlign: 'center',
                        fontSize: 10, fontWeight: 700,
                        color: 'rgba(245,215,138,0.55)',
                        background: 'rgba(245,215,138,0.06)',
                      }}>{gridHolePars.reduce((s, p) => s + (p || 0), 0)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.filter(p => !p.withdrawn).map(p => {
                      const scores = Array.isArray(p.scores) ? p.scores : []
                      // Running total + relative-to-par for the TOT
                      // column — only counts holes the player has
                      // actually scored. (Round 10 audit.)
                      let rowTotal = 0
                      let rowPar   = 0
                      let rowPlayed = 0
                      for (let h = 0; h < holeCount; h++) {
                        const s = scores[h] || 0
                        if (s > 0) {
                          rowTotal += s
                          rowPar   += gridHolePars[h] || 4
                          rowPlayed += 1
                        }
                      }
                      const rowDiff = rowPlayed > 0 ? rowTotal - rowPar : null
                      const rowDiffStr = rowDiff == null ? '—'
                        : rowDiff === 0 ? 'E'
                        : rowDiff > 0 ? `+${rowDiff}`
                        : `${rowDiff}`
                      const rowDiffColor = rowDiff == null ? 'rgba(255,255,255,0.30)'
                        : rowDiff < 0 ? '#E55858'
                        : rowDiff === 0 ? '#fff'
                        : 'rgba(255,255,255,0.65)'
                      return (
                        <tr key={p.user_id}>
                          <td style={{
                            position: 'sticky', left: 0, background: '#0E1812',
                            padding: '6px 8px', fontWeight: 700,
                            color: '#fff', minWidth: 100,
                            borderTop: '1px solid rgba(255,255,255,0.07)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            maxWidth: 100, zIndex: 1,
                          }}>{(p.name || '?').split(' ')[0]}</td>
                          {holes.map(h => {
                            const v = scores[h] || 0
                            const isEditing = editing && String(editing.user_id) === String(p.user_id) && editing.hole === h
                            return (
                              <td key={h} style={{
                                width: 32, padding: 0, textAlign: 'center',
                                borderTop: '1px solid rgba(255,255,255,0.07)',
                                background: isEditing ? 'rgba(245,215,138,0.18)' : 'transparent',
                              }}>
                                {isEditing ? (
                                  <input
                                    type="number" inputMode="numeric" min={1} max={20}
                                    autoFocus
                                    value={editing.value}
                                    onChange={e => setEditing(s => ({ ...s, value: e.target.value }))}
                                    onBlur={() => editing.value && Number(editing.value) !== v && saveCell(p.user_id, h, editing.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') saveCell(p.user_id, h, editing.value)
                                      if (e.key === 'Escape') setEditing(null)
                                    }}
                                    disabled={scoreSaveBusy}
                                    style={{
                                      width: 30, height: 26, padding: 0, textAlign: 'center',
                                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(245,215,138,0.50)',
                                      borderRadius: 4, color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                                      outline: 'none',
                                    }}
                                  />
                                ) : (
                                  <button
                                    onClick={() => setEditing({ user_id: p.user_id, hole: h, value: String(v || '') })}
                                    style={{
                                      width: '100%', height: 26, padding: 0, border: 'none',
                                      background: 'transparent', color: v > 0 ? '#fff' : 'rgba(255,255,255,0.30)',
                                      fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                                    }}
                                  >{v > 0 ? v : '·'}</button>
                                )}
                              </td>
                            )
                          })}
                          {/* TOT column — running total + STP. (Round 10) */}
                          <td style={{
                            width: 50, padding: '6px 8px', textAlign: 'center',
                            borderTop: '1px solid rgba(255,255,255,0.07)',
                            background: 'rgba(245,215,138,0.06)',
                            fontSize: 12, fontWeight: 800,
                            color: '#fff', whiteSpace: 'nowrap',
                          }}>
                            {rowPlayed > 0 ? rowTotal : '—'}
                            {rowPlayed > 0 && (
                              <div style={{ fontSize: 9, fontWeight: 700, color: rowDiffColor, marginTop: 2 }}>
                                {rowDiffStr}
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'stableford' && (
            <StablefordEditor
              code={code}
              outing={outing}
              onSaved={(points) => {
                // Mirror the post-creation map into local outing state so the
                // leaderboard recomputes immediately.
                onParticipantsUpdated?.(all, { stableford_points: points })
              }}
            />
          )}

          {tab === 'comms' && (
            <CommsTab
              code={code}
              outing={outing}
              onAnnouncementPosted={(list) => {
                onParticipantsUpdated?.(all, { announcements: list })
              }}
              onStateMerge={(extras) => {
                onParticipantsUpdated?.(all, extras)
              }}
              onCancelled={() => {
                onParticipantsUpdated?.(all, { /* no state mutation; status flip on next reload */ })
                onClose?.()
              }}
            />
          )}

          {tab === 'audit' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.50)' }}>
                  {auditEntries ? `${auditEntries.length} change${auditEntries.length !== 1 ? 's' : ''}` : ''}
                </div>
                {/* 6.6 — disable Refresh while a "Load more" is in flight,
                    so a refresh+pagination race can't interleave responses
                    and leave the entries list mismatched against the cursor.
                    (Round 16 edge-case audit.) */}
                <button onClick={loadAudit} disabled={auditLoading || auditLoadingMore} style={{
                  padding: '4px 10px', borderRadius: 999,
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
                  color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                  opacity: (auditLoading || auditLoadingMore) ? 0.6 : 1,
                }}>{auditLoading ? '…' : 'Refresh'}</button>
              </div>
              {auditLoading && auditEntries == null && (
                <div style={{ color: 'rgba(255,255,255,0.45)', textAlign: 'center', padding: '24px 0', fontSize: 12 }}>
                  Loading…
                </div>
              )}
              {auditEntries && auditEntries.length === 0 && (
                <div style={{ color: 'rgba(255,255,255,0.45)', textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
                  No score changes yet.
                </div>
              )}
              {auditEntries && auditEntries.map(e => (
                <div key={e.id} style={{
                  padding: '10px 12px', borderRadius: 12, marginBottom: 6,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 13, color: '#fff', fontWeight: 700 }}>
                      {nameForId(e.user_id)} · Hole {Number(e.hole) + 1}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>{whenStr(e.created_at)}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 3 }}>
                    {e.old_score == null ? 'set to' : `changed ${e.old_score} →`} <span style={{ color: '#F5D78A', fontWeight: 800 }}>{e.new_score}</span>
                    {e.edited_by_name ? ` · by ${e.edited_by_name}` : ''}
                  </div>
                </div>
              ))}
              {/* 6.6 — Load more button (cursor-based pagination). Hidden
                  on the last page; disabled while in flight. */}
              {auditCursor && (
                <button onClick={loadMoreAudit} disabled={auditLoadingMore} style={{
                  width: '100%', padding: 10, borderRadius: 10, marginTop: 6,
                  background: 'rgba(245,215,138,0.10)', border: '1px solid rgba(245,215,138,0.30)',
                  color: '#F5D78A', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  fontFamily: 'inherit', opacity: auditLoadingMore ? 0.6 : 1,
                }}>
                  {auditLoadingMore ? 'Loading…' : `Load more · ${AUDIT_PAGE_SIZE} older`}
                </button>
              )}
              {!auditCursor && auditEntries && auditEntries.length > 0 && (
                <div style={{
                  fontSize: 10, color: 'rgba(255,255,255,0.40)', textAlign: 'center',
                  padding: '12px 0',
                }}>End of history · {auditEntries.length} change{auditEntries.length !== 1 ? 's' : ''}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

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
                  <div style={{ fontSize: 11, color: '#F87171', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    Groups should have at most 4 players
                  </div>
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
    const msg = `Join my golf match "${name}" on The Match!\n\nOpen the app → Scorecard tab → "Enter a Code" → type: ${code}`
    if (navigator.share) {
      try { await navigator.share({ text: msg }) } catch {}
    } else {
      await navigator.clipboard.writeText(msg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  // 2026-05-05 — solid gold (was a translucent gold tint that read as
  // un-tappable on the cream page background). Matches the rest of
  // the gold-accent buttons in the app (Profile's Request a Match
  // CTA pattern). Dark text on gold for contrast.
  return (
    <button onClick={share} style={{
      width: '100%', padding: '14px', borderRadius: 14, cursor: 'pointer', border: 'none',
      background: 'linear-gradient(135deg, #F5D78A 0%, #C9A040 100%)',
      color: '#070C09', fontWeight: 800, fontSize: 15,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      boxShadow: '0 4px 16px rgba(201,160,64,0.30), inset 0 1px 0 rgba(255,255,255,0.30)',
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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
    // 2026-05-05 — kept transparent (sits over the page-level cream
    // tint). Two fixes vs the earlier version:
    //   1. Text colors: white-on-transparent was invisible on cream;
    //      switched to dark-on-cream. Gold accents preserved.
    //   2. Layout: was justifyContent:center on a fixed-height
    //      container, which caused content taller than the viewport
    //      to overflow top + bottom (Matt: "the entire bottom half is
    //      sticking through"). Now flex-start with a scrollable
    //      container, safe-area padding, and bottom padding to clear
    //      the nav so the Enter Scorecard button is always reachable.
    <div data-no-pull-refresh="true" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      padding: 'calc(var(--safe-top) + 24px) 32px calc(var(--safe-bottom) + 24px)',
      gap: 16,
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(46,158,69,0.20) 0%, rgba(46,158,69,0.04) 100%)',
        border: '1px solid rgba(46,158,69,0.35)',
        boxShadow: '0 2px 12px rgba(46,158,69,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1A6B28" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
          <line x1="4" y1="22" x2="4" y2="15"/>
        </svg>
      </div>
      <div style={{ fontWeight: 800, fontSize: 22, color: '#0D1F12', textAlign: 'center' }}>{outing.name}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1A6B28', textAlign: 'center' }}>{outing.course_name}</div>
      <div style={{
        background: 'rgba(255,253,248,0.85)',
        border: '1.5px solid rgba(201,160,64,0.55)',
        borderRadius: 20, padding: '22px 40px', textAlign: 'center',
        boxShadow: '0 4px 18px rgba(201,160,64,0.18)',
      }}>
        <div style={{ fontSize: 11, color: '#7A5800', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Join Code</div>
        <div style={{
          fontSize: 54, fontWeight: 900, letterSpacing: 10,
          background: 'linear-gradient(135deg, #C9A040, #8A6B28)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>{outing.code}</div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#0D1F12', textAlign: 'center', lineHeight: 1.45 }}>
        Share this code with your group — they open The Match app, tap the Scorecard tab, and hit "Enter a Code"
      </div>
      {/* Share button */}
      <ShareCodeButton code={outing.code} name={outing.name} />
      <button onClick={onEnter}
        style={{
          width: '100%', padding: '16px', borderRadius: 14, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
          color: '#fff', fontWeight: 800, fontSize: 16,
          boxShadow: '0 4px 16px rgba(46,158,69,0.30), inset 0 1px 0 rgba(255,255,255,0.12)',
          flexShrink: 0,
        }}>
        Enter Scorecard →
      </button>
    </div>
  )
}

// ─── Main Outing Component ────────────────────────────────────────────────────
export default function Outing({ user, pendingPlayers = [], onClearPending, pendingLeagueId = null, onClearPendingLeague, onGoToEagleEye, sharedCourse = null, onCourseSelected }) {
  const [view, setView]           = useState('hub')   // 'hub' | 'live' | 'code-share' | 'end' | 'rivalry' | 'solo' | 'spectate'
  const [showJoin, setShowJoin]   = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [activeCode, setActiveCode] = useState(null)
  const [freshOuting, setFreshOuting] = useState(null)
  const [endSummary, setEndSummary]   = useState(null)
  const [activeRivalry, setActiveRivalry] = useState(null)
  // 2026-05-04 — read-only spectator view for a friend's live match.
  // Reuses PublicLeaderboard; wrapped with a back chevron so the user
  // returns to OutingHub instead of being trapped on the public board.
  const [spectateCode, setSpectateCode] = useState(null)

  // Auto-open CreateWizard when navigated here with pre-filled players.
  // Depends on pendingPlayers so it fires both on mount AND when the
  // prop changes mid-session. With App.jsx's lazy-keep-alive (2026-05-01),
  // Outing stays mounted across tab switches — without this dep, navigating
  // Home -> Friends -> "Play with these" would not auto-open the wizard
  // the second time the user does it in a session.
  useEffect(() => {
    if (pendingPlayers.length > 0) setShowCreate(true)
  }, [pendingPlayers])

  // Auto-open CreateWizard when navigated from a League's "+ New event"
  // button. Same lazy-keep-alive considerations as pendingPlayers above.
  useEffect(() => {
    if (pendingLeagueId != null) setShowCreate(true)
  }, [pendingLeagueId])

  if (view === 'solo')  return <ActiveRound  user={user} onBack={() => setView('hub')} />

  if (view === 'live' && activeCode) return (
    <LiveOuting
      code={activeCode}
      user={user}
      onBack={() => setView('hub')}
      onMatchEnd={summary => { setEndSummary(summary); setView('end') }}
      onGoToEagleEye={onGoToEagleEye}
      sharedCourse={sharedCourse}
      onCourseSelected={onCourseSelected}
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

  if (view === 'spectate' && spectateCode) return (
    <SpectateView
      code={spectateCode}
      onBack={() => { setSpectateCode(null); setView('hub') }}
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
        onSpectate={code => { setSpectateCode(code); setView('spectate') }}
      />
      <CoachMark
        id="match"
        user={user}
        title="Create or join a match"
        body='Tap "Create" to start a new match, or "Enter a Code" if a friend shared one. Live matches you started can be deleted with a left-swipe.'
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
          pendingLeagueId={pendingLeagueId}
          sharedCourse={sharedCourse}
          onCourseSelected={onCourseSelected}
          onClose={() => { setShowCreate(false); onClearPending?.(); onClearPendingLeague?.() }}
          onCreated={o => {
            setShowCreate(false)
            setFreshOuting(o)
            setView('code-share')
            onClearPending?.()
            onClearPendingLeague?.()
          }}
        />
      )}
    </>
  )
}
