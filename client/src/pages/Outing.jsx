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
// Standalone AugustaBoard route was removed 2026-04-30 (Path A) — every
// match now renders the Augusta scorecard directly via LiveOuting.

// 2026-05-06 — Stage 1 of the Outing.jsx refactor: theme constants +
// PlayerAvatar + small helpers moved to ./Outing/shared.jsx so each
// child component (CodeShare, JoinSheet, LiveOuting, etc.) can import
// them directly without a circular dep back to this file.
import {
  AUGUSTA_GREEN, AUGUSTA_GREEN_DEEP, AUGUSTA_PANEL, AUGUSTA_PANEL_HI,
  AUGUSTA_PANEL_HOVER, AUGUSTA_TEXT, AUGUSTA_GOLD, AUGUSTA_GOLD_DIM,
  AUGUSTA_CREAM, AUGUSTA_TILE, AUGUSTA_RED, AUGUSTA_INK, AUGUSTA_WOOD,
  AUGUSTA_TEAL, AUGUSTA_TEAL_HOVER,
  scoreColor, initials, avatarBg, PlayerAvatar, wlLabel, scoreLabel,
  relDate, fmtOpponents, copyCode,
} from './Outing/shared.jsx'

// 2026-05-06 — Stage 2 of the refactor: leaf components moved to their
// own files so this entry point is no longer the dumping ground.
import SpectateView from './Outing/SpectateView.jsx'
import CodeShare from './Outing/CodeShare.jsx'
import EndMatchScreen from './Outing/EndMatchScreen.jsx'
import JoinSheet from './Outing/JoinSheet.jsx'
import GuestModal from './Outing/GuestModal.jsx'
import CreateWizard from './Outing/CreateWizard.jsx'
import LiveOuting, { TEAM_PALETTE } from './Outing/LiveOuting.jsx'

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

// EndMatchScreen + JoinSheet extracted to ./Outing/{EndMatchScreen,JoinSheet}.jsx (Stage 2 refactor 2026-05-06).

// CoursePicker + CreateWizard + FORMATS/TEAMS/TEAM_BREAKDOWNS extracted to ./Outing/CreateWizard.jsx (Stage 3 refactor 2026-05-06).


// ─── Helpers for scorecard ────────────────────────────────────────────────────
// LiveOuting + scorecard infra extracted to ./Outing/LiveOuting.jsx (Stage 4 refactor 2026-05-06).

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

// ─── Main Outing Component ────────────────────────────────────────────────────
export default function Outing({ user, pendingPlayers = [], onClearPending, pendingLeagueId = null, onClearPendingLeague, pendingJoinCode = null, onClearPendingJoinCode, onGoToEagleEye, sharedCourse = null, onCourseSelected }) {
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

  // 2026-05-05 — QR-scan auto-join. App.jsx parses ?join=ABCD off the
  // URL (or pulls a stash from localStorage post-onboarding) and
  // forwards it here. We POST to /:code/join and switch to the live
  // view. Errors are surfaced via a one-shot state slot the hub renders
  // as a toast so the user knows why nothing happened (404 = bad code,
  // 400 = closed match, etc.).
  const [joinError, setJoinError] = useState(null)
  useEffect(() => {
    if (!pendingJoinCode) return
    let cancelled = false
    ;(async () => {
      try {
        await post(`/api/outings/${encodeURIComponent(pendingJoinCode)}/join`, {})
        if (cancelled) return
        setActiveCode(pendingJoinCode)
        setView('live')
      } catch (err) {
        if (cancelled) return
        const msg = err?.status === 404 ? 'That match code doesn\'t exist anymore.'
                  : err?.status === 400 ? 'That match has been closed.'
                  : 'Could not join that match. Try entering the code manually.'
        setJoinError(msg)
        setTimeout(() => setJoinError(null), 5000)
      } finally {
        if (!cancelled) onClearPendingJoinCode?.()
      }
    })()
    return () => { cancelled = true }
  }, [pendingJoinCode])

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
      {/* 2026-05-05 — auto-join error toast. Shown briefly when a
          QR-scan or stashed pendingJoinCode failed (bad code / closed
          match). Self-dismisses after 5s. */}
      {joinError && (
        <div style={{
          position: 'fixed', top: 'calc(var(--safe-top) + 16px)',
          left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999,
          background: '#B22222', color: '#fff',
          fontSize: 13, fontWeight: 700,
          padding: '10px 16px', borderRadius: 999,
          boxShadow: '0 4px 16px rgba(178,34,34,0.40)',
          maxWidth: 360, textAlign: 'center',
        }}>
          {joinError}
        </div>
      )}
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
