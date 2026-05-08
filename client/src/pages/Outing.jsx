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
import { readSavedSoloRound } from '../lib/solo-round.js'
import LiveOuting from './Outing/LiveOuting.jsx'
import EndMatchScreen from './Outing/EndMatchScreen.jsx'
import CodeShare from './Outing/CodeShare.jsx'
import JoinSheet from './Outing/JoinSheet.jsx'
import CreateWizard from './Outing/CreateWizard.jsx'
import SpectateView from './Outing/SpectateView.jsx'

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
    soloResumeCheckedRef.current = true
    if (readSavedSoloRound(user.id)) {
      setView('solo')
    }
  }, [user?.id])

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
