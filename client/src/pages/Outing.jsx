// ─── Outing.jsx — the Scorecard tab entry point ──────────────────────────────
// 2026-05-06 — refactored from a 7600-line megafile into this thin
// router. Every sub-view lives in client/src/pages/Outing/*.jsx:
//
//   shared.jsx        — theme constants, PlayerAvatar, helpers
//   OutingHub.jsx     — landing page + match cards + RivalryDetail
//   LiveOuting.jsx    — active match scorecard + score modals + math
//   Commissioner.jsx  — host-only Manage panel + tabs
//   CreateWizard.jsx  — 3-step match creation form + course picker
//   EndMatchScreen.jsx — winner ceremony + podium + share
//   CodeShare.jsx     — post-creation share + QR
//   JoinSheet.jsx     — bottom-sheet code entry
//   GuestModal.jsx    — search-as-you-type add player
//   SpectateView.jsx  — in-app wrapper around PublicLeaderboard
//
// This file's only job is to own the top-level view state machine
// ('hub' | 'live' | 'code-share' | 'end' | 'rivalry' | 'solo' |
// 'spectate') and route to the right sub-view. Cross-cutting handoffs
// (pending players, pending league, pending join code from QR scan)
// flow through here too.
import { useState, useEffect, useRef } from 'react'
import { post } from '../lib/api.js'
import CoachMark from '../components/CoachMark.jsx'
import ActiveRound from './ActiveRound.jsx'
import OutingHub, { RivalryDetail } from './Outing/OutingHub.jsx'
import Leagues from './Leagues.jsx'
import { readSavedSoloRound } from '../lib/solo-round.js'
import LiveOuting from './Outing/LiveOuting.jsx'
import EndMatchScreen from './Outing/EndMatchScreen.jsx'
import CodeShare from './Outing/CodeShare.jsx'
import JoinSheet from './Outing/JoinSheet.jsx'
import CreateWizard from './Outing/CreateWizard.jsx'
import SpectateView from './Outing/SpectateView.jsx'

// ─── Main Outing Component ────────────────────────────────────────────────────
// 2026-07-09 — Phase 0 nav restructure: the segment the Match tab's hub is
// showing ('matches' hub vs the Leagues surface, which lost its own bottom-nav
// tab). Persisted so pull-to-refresh doesn't dump a league browser back onto
// Matches; validated so a stale value falls back to 'matches'.
const SEG_STORAGE_KEY = 'tm-match-seg'
function readPersistedSeg() {
  try {
    const v = localStorage.getItem(SEG_STORAGE_KEY)
    if (v === 'matches' || v === 'leagues') return v
  } catch { /* ignore — Safari private mode etc. */ }
  return 'matches'
}

export default function Outing({ user, pendingPlayers = [], onClearPending, pendingLeagueId = null, onClearPendingLeague, pendingJoinCode = null, onClearPendingJoinCode, onGoToEagleEye, sharedCourse = null, onCourseSelected, onActiveScoringChange, onCreateEventInLeague, tabPressedAt }) {
  const [view, setView]           = useState('hub')   // 'hub' | 'live' | 'code-share' | 'end' | 'rivalry' | 'solo' | 'spectate'
  // 'matches' | 'leagues' — which surface the hub view shows. Leagues moved
  // into this tab behind a segmented toggle (Phase 0 nav restructure,
  // 2026-07-09); the round/live/solo views are untouched by the segment.
  const [seg, setSeg] = useState(readPersistedSeg)
  useEffect(() => {
    try { localStorage.setItem(SEG_STORAGE_KEY, seg) } catch { /* ignore */ }
  }, [seg])
  // Reset to the Matches segment whenever the user taps a bottom-nav tab —
  // same "tab icon → that tab's home page" convention Home used for its old
  // profile sub-view (2026-05-07 PM3). Also the escape hatch if the Leagues
  // segment is showing the full-screen paywall (which has no back control).
  // Ref-guard skips the initial mount so a restored 'leagues' segment isn't
  // clobbered on first render.
  const initialTabPressedAtRef = useRef(tabPressedAt)
  useEffect(() => {
    if (tabPressedAt === initialTabPressedAtRef.current) return
    setSeg('matches')
  }, [tabPressedAt])
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

  // Slice 1 (2026-07-07): publish the active-scoring context UP to App so Eagle
  // Eye can offer walk-and-confirm shot capture for the live outing. Only while
  // actually scoring a live match; cleared when we leave (end/hub) or unmount.
  useEffect(() => {
    onActiveScoringChange?.(
      view === 'live' && activeCode
        ? { kind: 'outing', code: String(activeCode).toUpperCase() }
        : null
    )
  }, [view, activeCode, onActiveScoringChange])
  useEffect(() => () => onActiveScoringChange?.(null), [onActiveScoringChange])

  // 2026-05-07 PM — auto-resume an in-progress solo round on first
  // mount. Bug we're closing: pull-to-refresh during a solo round
  // reloads the page, Outing.jsx remounts with view='hub' (default),
  // ActiveRound never mounts, so its localStorage restore (which was
  // the only path for resuming a saved round) never runs — user
  // is silently kicked out of the round even though their data is
  // safely saved. Reading localStorage HERE means any reload puts
  // the user right back where they were. Gated by soloResumeCheckedRef
  // so the effect only fires once per Outing mount; subsequent navs
  // (back arrow → hub, then back to Outing tab) won't re-route the
  // user against their will. Matt: 'pulling to refresh backs u out
  // of your solo round'.
  const soloResumeCheckedRef = useRef(false)
  useEffect(() => {
    if (soloResumeCheckedRef.current) return
    if (!user?.id) return
    // 2026-07-06 — a pending ?join= code is an EXPLICIT intent (QR scan /
    // shared link) and outranks the silent solo auto-resume. Without this
    // guard the resume wins the mount race; the join then flips the view to
    // 'live' late (jank), and if the join FAILS the error toast renders in
    // the hub view that ActiveRound's early-return makes unreachable — the
    // user lands in their solo round with zero feedback about the code they
    // scanned. Seen on the S4 walkthrough (outing 7EAX, first load). We mark
    // the resume as consumed so a failed join lands on the hub, where the
    // toast is visible AND the resume-solo card offers the way back into
    // the saved round.
    if (pendingJoinCode) {
      soloResumeCheckedRef.current = true
      return
    }
    soloResumeCheckedRef.current = true
    if (readSavedSoloRound(user.id)) {
      setView('solo')
    }
  }, [user?.id, pendingJoinCode])

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

  if (view === 'solo')  return <ActiveRound  user={user} onBack={() => setView('hub')} onGoToEagleEye={onGoToEagleEye} />

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
      user={user}
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

  // Matches | Leagues segmented toggle — rendered inside whichever hub
  // header is active so each surface keeps its own safe-top handling.
  const segToggle = <MatchSegToggle seg={seg} onChange={setSeg} />

  return (
    <>
      {seg === 'leagues' ? (
        <Leagues
          user={user}
          headerAccessory={segToggle}
          onCreateEventInLeague={onCreateEventInLeague}
        />
      ) : (
        <OutingHub
          user={user}
          headerAccessory={segToggle}
          onJoin={() => setShowJoin(true)}
          onCreate={() => setShowCreate(true)}
          onOpenOuting={code => { setActiveCode(code); setView('live') }}
          onOpenRivalry={r => { setActiveRivalry(r); setView('rivalry') }}
          onSoloRound={() => setView('solo')}
          onSpectate={code => { setSpectateCode(code); setView('spectate') }}
        />
      )}
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
          user={user}
          onClose={() => setShowJoin(false)}
          onJoined={o => { setShowJoin(false); setActiveCode(o.code); setView('live') }}
        />
      )}
      {/* CreateWizard renders over EITHER segment — a league's "+ New event"
          opens it while the Leagues surface is showing. */}
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

// ─── Matches | Leagues segmented toggle ──────────────────────────────────
// Compact pill control rendered in the hub headers (OutingHub + LeaguesHub
// via their headerAccessory prop). Active segment = primary green fill,
// inactive = quiet green text — same palette as the app's other pills.
// (Phase 0 nav restructure, 2026-07-09.)
function MatchSegToggle({ seg, onChange }) {
  const opts = [['matches', 'Matches'], ['leagues', 'Leagues']]
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      background: 'rgba(255,253,248,0.85)',
      border: '1px solid rgba(27,94,59,0.18)',
      borderRadius: 999, padding: 3, gap: 2,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      flexShrink: 0,
    }}>
      {opts.map(([key, label]) => {
        const active = seg === key
        return (
          <button key={key} onClick={() => onChange(key)} style={{
            border: 'none', cursor: 'pointer',
            borderRadius: 999, padding: '6px 12px',
            fontSize: 12, fontWeight: 800, letterSpacing: '0.02em',
            background: active ? 'linear-gradient(135deg, #1A6B28, #2E9E45)' : 'transparent',
            color: active ? '#fff' : 'rgba(27,94,59,0.60)',
            boxShadow: active ? '0 2px 8px rgba(46,158,69,0.30)' : 'none',
            transition: 'background 180ms ease, color 180ms ease',
            WebkitTapHighlightColor: 'transparent',
          }}>{label}</button>
        )
      })}
    </div>
  )
}
