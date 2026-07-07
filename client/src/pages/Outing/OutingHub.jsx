import { useState, useEffect, useRef } from 'react'
import { api, del } from '../../lib/api.js'
import {
  PlayerAvatar, initials, copyCode, wlLabel, relDate, fmtOpponents,
} from './shared.jsx'
import { SkeletonCard } from '../../components/primitives/Skeleton.jsx'
import { readSavedSoloRound, SOLO_ROUND_STORAGE_KEY } from '../../lib/solo-round.js'

// ─── Outing/OutingHub.jsx ─────────────────────────────────────────────────
// The Scorecard tab's main landing page (formerly the "Match" tab).
// Live Now strip + primary CTAs + Friends Playing Now feed + Solo
// Round shortcut. Plus the row-level card components that render
// inside it: LiveMatchCard, RecentMatchCard, FriendsLiveCard,
// RivalryCard, EmptyRivalries, plus the RivalryDetail drill-in.
//
// Extracted from the original 7600-line Outing.jsx as part of the
// 2026-05-06 refactor (Stage 6/6 — final stage). Pure mechanical
// move; no behavior change.

export default function OutingHub({ user, onJoin, onCreate, onOpenOuting, onOpenRivalry, onSoloRound, onSpectate }) {
  const [rivalries, setRivalries] = useState([])
  const [recentOutings, setRecentOutings] = useState([])
  const [loading, setLoading] = useState(true)
  const [rivalrySearch, setRivalrySearch] = useState('')
  const [copiedCode, setCopiedCode] = useState(null)
  // 2026-05-04 — Friends playing now: light-payload feed of friends'
  // active matches. Polled every 30s, visibility-aware (pauses when tab
  // is hidden, refetches immediately on focus). Tap a card → onSpectate.
  const [friendsLive, setFriendsLive] = useState([])
  // 2026-05-07 PM — saved solo round (from localStorage). When present
  // the Live Now strip renders a Resume Solo Round card alongside the
  // multi-player matches. Refreshed on mount + visibilitychange so a
  // round saved/cleared in another tab is reflected when the user
  // returns. Matt: 'doesnt show up in live rounds'.
  const [savedSolo, setSavedSolo] = useState(() => readSavedSoloRound(user?.id))

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
      // Re-read the saved solo round on every visibility resume too,
      // so a round started/finished in another tab is reflected here.
      if (!cancelled) setSavedSolo(readSavedSoloRound(user?.id))
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
    // Re-read savedSolo on mount + whenever user.id changes (e.g.,
    // initial cold-load race where Outing mounts before /api/profile
    // resolves, then user.id flips from null to a real id). Without
    // this the initial useState initializer reads with anon-uid key
    // and never refreshes — the resume card stays hidden even though
    // a saved round exists.
    setSavedSolo(readSavedSoloRound(user?.id))
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [user?.id])

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
    // Match the Leagues list page's look: same warm cream gradient base
    // (Leagues `hubBase`) instead of the flat parchment, so the Matches page
    // and the Leagues page read as the same surface. (2026-06-23 — Matt)
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'linear-gradient(180deg, #FFFDF8 0%, #F1E7C8 100%)' }}>
      {/* 2026-05-04 — header padding-top accounts for the iOS notch /
          Android status bar via --safe-top. Without it, the "Matches"
          title sits ~20px from viewport top and on a notched phone is
          mostly hidden behind the dynamic island / status area. Mirrors
          the same pattern used in Leagues.jsx and EagleEye.jsx. */}
      <div style={{ padding: 'calc(var(--safe-top) + 20px) 20px 0', flexShrink: 0 }}>
        <div style={{
          fontSize: 28, fontWeight: 900, letterSpacing: '-1px',
          background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold-bright))',
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
        {/* 2026-05-06 — Loading skeletons. While the initial Promise.all
            for recent / rivalries / friends-live is in flight, show
            shimmer cards so the page maintains its rhythm instead of
            collapsing to a blank scroll area and then re-flowing once
            data lands. */}
        {loading && (
          <div>
            <div style={{
              fontSize: 12, fontWeight: 800, color: 'rgba(26,107,40,0.55)',
              textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10,
              background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: 'rgba(46,158,69,0.30)',
              }} />
              Loading
            </div>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* ─── Live Now strip ─────────────────────────────────────────── */}
        {/* Renders when EITHER a multi-player match is active OR the user
            has an in-progress solo round saved in localStorage. The solo
            card sits at the top of the strip — it's the user's own round,
            so it takes precedence over their other multi-player matches. */}
        {!loading && (savedSolo || liveMatches.length > 0) && (
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
            {savedSolo && (
              <SoloRoundLiveCard
                saved={savedSolo}
                onResume={onSoloRound}
                onDiscard={() => {
                  // Only nuke after explicit confirm — losing a 12-hole
                  // card to a misclick would be infuriating. Refresh
                  // local state from the source after delete.
                  if (!window.confirm('Discard this solo round? Scores entered will be lost.')) return
                  try {
                    localStorage.removeItem(SOLO_ROUND_STORAGE_KEY(user?.id))
                  } catch { /* localStorage disabled — no-op */ }
                  setSavedSolo(null)
                }}
              />
            )}
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
          color: 'var(--tm-gold-text)', fontWeight: 700, fontSize: 13,
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
        borderRadius: 14,
        // Same cream-gradient + gold-border surface as the board cards, kept
        // compact (no gold header strip) so it reads as secondary. (2026-06-23)
        background: 'linear-gradient(180deg, #FFFCF3 0%, #F4E9C4 100%)',
        border: '1px solid rgba(201,160,64,0.40)',
        boxShadow: '0 4px 14px rgba(13,31,18,0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
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
        ringColor="rgba(201,160,64,0.45)"
      />
      {/* Center: title + course/hole */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 800, color: 'var(--tm-text)',
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

// ─── Solo Round Live Card ────────────────────────────────────────────────────
// Renders inside the Live Now strip when the user has an in-progress
// solo round saved in localStorage. Tapping the card resumes the round
// (callback comes from the parent's onSoloRound, which sets view='solo'
// in Outing.jsx so ActiveRound mounts and reads localStorage). Small
// "Discard" link nukes the saved round after a confirm — guards against
// the situation where a user finished a round IRL but never saved
// in-app, and now an old card is permanently in their Live Now strip.
// (2026-05-07 PM — Matt: 'doesnt show up in live rounds'.)
function SoloRoundLiveCard({ saved, onResume, onDiscard }) {
  const config = saved?.config || {}
  const scores = Array.isArray(saved?.scores) ? saved.scores : []
  const pars   = Array.isArray(config.pars) ? config.pars : []
  const holesPlayed = scores.filter(s => s > 0).length
  const totalScore  = scores.reduce((s, x) => s + (Number(x) || 0), 0)
  const playedPar   = scores.reduce((s, x, i) => x > 0 ? s + (pars[i] || 4) : s, 0)
  const diff        = totalScore > 0 ? totalScore - playedPar : null
  const diffStr     = diff == null ? '—'
                    : diff === 0   ? 'E'
                    : diff > 0     ? `+${diff}`
                    : `${diff}`
  const diffColor   = diff == null ? 'rgba(13,31,18,0.45)'
                    : diff < 0     ? '#1A6B28'
                    : diff === 0   ? 'rgba(13,31,18,0.75)'
                    :                '#B91C1C'
  const courseName  = config.courseName || 'Solo Round'

  return (
    <div style={{
      position: 'relative',
      background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(248,242,222,0.92) 100%)',
      border: '1px solid rgba(232,192,90,0.35)',
      borderRadius: 14,
      padding: '14px 16px',
      marginBottom: 10,
      boxShadow: '0 4px 14px rgba(0,0,0,0.10)',
    }}>
      <button
        onClick={onResume}
        style={{
          appearance: 'none', background: 'transparent', border: 'none', padding: 0,
          width: '100%', textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 12,
          font: 'inherit', color: 'inherit',
        }}
        aria-label="Resume solo round"
      >
        {/* Solo badge — small Augusta-gold pill so the card reads as
            distinct from multi-player Live cards at a glance. */}
        <div style={{
          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
          background: 'linear-gradient(135deg, var(--tm-gold-bright), var(--tm-gold))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--tm-text)', fontWeight: 900, fontSize: 11,
          letterSpacing: '0.06em',
          fontFamily: '"Arial Black", Arial, sans-serif',
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.40), inset 0 -1px 2px rgba(0,0,0,0.20)',
        }}>SOLO</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 800, color: 'var(--tm-text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{courseName}</div>
          <div style={{
            fontSize: 12, color: 'rgba(13,31,18,0.55)', marginTop: 2,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {holesPlayed > 0
              ? <span>thru {holesPlayed} of {pars.length}</span>
              : <span>Not started yet</span>}
            {totalScore > 0 && (
              <>
                <span style={{ color: 'rgba(13,31,18,0.30)' }}>·</span>
                <span style={{ color: 'var(--tm-text)', fontWeight: 700 }}>{totalScore}</span>
                <span style={{ color: diffColor, fontWeight: 800 }}>{diffStr}</span>
              </>
            )}
          </div>
        </div>
        <div style={{
          fontSize: 13, fontWeight: 800, color: '#1A6B28',
          letterSpacing: '0.04em', flexShrink: 0,
        }}>Resume →</div>
      </button>
      {/* Discard — bottom-right small link. Doesn't compete with Resume. */}
      <button
        onClick={onDiscard}
        style={{
          appearance: 'none', background: 'transparent', border: 'none',
          padding: '4px 0 0 56px', marginTop: 4,
          fontSize: 11, fontWeight: 600, color: 'rgba(13,31,18,0.45)',
          cursor: 'pointer', textDecoration: 'underline',
        }}
      >Discard saved round</button>
    </div>
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
      {/* Tournament-board treatment — matches the Leagues league card:
          cream-gradient card + gold border, a gold accent strip up top
          (LIVE + join code), serif title, course/subtitle meta.
          (2026-06-23 — Matt: bring the Matches cards in line with Leagues.) */}
      <div
        onClick={handleCardClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          cursor: 'pointer',
          background: 'linear-gradient(180deg, #FFFCF3 0%, #F4E9C4 100%)',
          border: '1px solid rgba(201,160,64,0.40)',
          borderRadius: 16, padding: 0, overflow: 'hidden', position: 'relative',
          boxShadow: '0 4px 14px rgba(13,31,18,0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
          transform: `translateX(${swipeX}px)`,
          transition: startXRef.current == null ? 'transform 200ms ease' : 'none',
          touchAction: canDelete ? 'pan-y' : 'auto',
        }}
      >
        {/* Gold accent strip — LIVE (left) + join code badge (right). */}
        <div style={{
          height: 32,
          background: 'linear-gradient(90deg, var(--tm-gold) 0%, var(--tm-gold-bright) 50%, var(--tm-gold) 100%)',
          padding: '0 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(13,31,18,0.18)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="tm-live-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: '#0E3B23' }} />
            <span style={{
              fontSize: 9, fontWeight: 900, letterSpacing: '0.18em', color: '#0E3B23',
              textTransform: 'uppercase', fontFamily: '"Arial Black", Arial, sans-serif',
              textShadow: '0 1px 0 rgba(255,255,255,0.30)',
            }}>LIVE · {o.player_count}P</span>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onCopyCode?.(e) }} style={{
            border: '1px solid rgba(14,59,35,0.30)', cursor: 'pointer',
            background: copied ? 'rgba(14,59,35,0.22)' : 'rgba(14,59,35,0.12)',
            color: '#0E3B23', fontWeight: 900, fontSize: 9, letterSpacing: '0.16em',
            padding: '3px 10px', borderRadius: 999,
            fontFamily: '"Arial Black", Arial, sans-serif',
          }}>{copied ? '✓ COPIED' : o.code}</button>
        </div>
        {/* Body */}
        <div style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 18, fontWeight: 900, color: '#0E3B23',
              fontFamily: '"Georgia", serif', letterSpacing: '-0.01em', lineHeight: 1.15,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {title}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.55)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {subtitle && (
                <span style={{ color: 'var(--tm-gold-text)', fontWeight: 700 }}>{subtitle}</span>
              )}
              {o.course_name && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(13,31,18,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  {o.course_name}
                </span>
              )}
            </div>
          </div>
          <div style={{ color: '#1A6B28', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
            Resume →
          </div>
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
      // Same cream-gradient + gold-border surface as the rest of the Matches
      // cards; muted (it's a finished match). (2026-06-23)
      background: 'linear-gradient(180deg, #FFFCF3 0%, #F4E9C4 100%)',
      border: '1px solid rgba(201,160,64,0.30)',
      borderRadius: 14, padding: '14px 16px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 8,
      boxShadow: '0 4px 14px rgba(13,31,18,0.07), inset 0 1px 0 rgba(255,255,255,0.55)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            color: copied ? '#1A6B28' : 'var(--tm-gold-text)',
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
            <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 15 }}>{r.opponent_name}</div>
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
            <div style={{ width: `${(myWins/total)*100}%`, background: 'linear-gradient(90deg, var(--tm-green), #2E9E45)', borderRadius: '99px 0 0 99px', transition: 'width 400ms ease' }} />
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
export function RivalryDetail({ rivalry, userId, onBack }) {
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
  const lColor  = lead === 'up' ? 'var(--tm-gold)' : lead === 'down' ? '#F87171' : 'rgba(255,255,255,0.5)'

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
              <div style={{ width: `${(myWins/total)*100}%`, background: 'linear-gradient(90deg, var(--tm-green-bright), var(--tm-gold))', borderRadius: '99px 0 0 99px', transition: 'width 400ms ease' }} />
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
                  color: m.is_tie ? '#93C5FD' : won ? 'var(--tm-gold)' : '#F87171',
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
                      color: m.is_tie ? '#93C5FD' : won ? 'var(--tm-gold)' : '#F87171',
                    }}>{m.is_tie ? 'TIE' : won ? 'WIN' : 'LOSS'}</div>
                    <div style={{ fontSize: 12, color: 'var(--tm-text-3)' }}>
                      {m.my_score} – {m.opp_score}
                      {!m.is_tie && <span style={{ color: won ? 'var(--tm-gold)' : '#F87171', fontWeight: 700, marginLeft: 4 }}>({diff > 0 ? '+' : ''}{diff})</span>}
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

// EndMatchScreen + JoinSheet extracted to ./Outing/{EndMatchScreen,JoinSheet}.jsx (Stage 2 refactor 2026-05-06).

// CoursePicker + CreateWizard + FORMATS/TEAMS/TEAM_BREAKDOWNS extracted to ./Outing/CreateWizard.jsx (Stage 3 refactor 2026-05-06).


// ─── Helpers for scorecard ────────────────────────────────────────────────────
// LiveOuting + scorecard infra extracted to ./Outing/LiveOuting.jsx (Stage 4 refactor 2026-05-06).

// CommsTab + StablefordEditor + CommissionerPanel + GroupSetup + TeamSetup
// extracted to ./Outing/Commissioner.jsx (Stage 5 refactor 2026-05-06).


