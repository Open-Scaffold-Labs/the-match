import { useState, useEffect, useRef } from 'react'
import BottomNav from './components/shell/BottomNav.jsx'
import { TABS } from './constants.js'
import Home from './pages/Home.jsx'

import EagleEye from './pages/EagleEye.jsx'
import Outing from './pages/Outing.jsx'
import MyBag from './pages/MyBag.jsx'
import Leagues from './pages/Leagues.jsx'
import PGAScores from './pages/PGAScores.jsx'
import Login from './pages/Login.jsx'
import OnboardingWizard from './components/OnboardingWizard.jsx'
import PermissionsPrompt from './components/PermissionsPrompt.jsx'
import PublicLeaderboard from './pages/PublicLeaderboard.jsx'
import PrintResults from './pages/PrintResults.jsx'
import { getToken } from './lib/api.js'
import { ensurePushSubscription, pushSupported } from './lib/push.js'


export default function App() {
  const [tab, setTab] = useState(TABS.HOME)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingOutingPlayers, setPendingOutingPlayers] = useState([])
  // Cross-tab "create event for this league" handoff. Set when
  // LeagueDetail's '+ New event' button is tapped; consumed by Outing
  // (which auto-opens the CreateWizard with leagueId pre-filled).
  // Cleared when the wizard finishes or the user backs out.
  // (2026-05-02 — League-attached event creation.)
  const [pendingLeagueId, setPendingLeagueId] = useState(null)
  // 2026-05-05 — QR-scan auto-join handoff. When a user scans the QR
  // displayed by CodeShare's "Show QR Code" button, the URL is
  // ?join=ABCD. Picked up here on mount, stashed in localStorage so
  // it survives login/onboarding for new users, and passed down to
  // Outing as a prop. Outing's useEffect calls POST /:code/join and
  // switches to view='live'. Cleared via onClearPendingJoinCode after
  // the join either succeeds or definitively fails.
  const [pendingJoinCode, setPendingJoinCode] = useState(null)
  // Lazy-keep-alive: track which tabs the user has visited. Each visited
  // tab stays mounted (display: block when active, display: none otherwise)
  // so component state, polling, GPS subscriptions, and the BOARD/SCORECARD
  // toggle all persist across tab switches. The user can pop into Eagle Eye
  // mid-round for a yardage read and come back to the scorecard exactly
  // where they left off. Cost is bounded to "tabs you've actually visited."
  // (2026-05-01)
  const [mountedTabs, setMountedTabs] = useState(() => new Set([TABS.HOME]))
  // Cross-tab "next hole" nudge from the live match's score modal to Eagle
  // Eye. When set, EagleEye picks it up via useEffect, calls setCurrentHole,
  // and clears the nudge via onConsumeEyeHoleNudge. Tight loop:
  //   tap Eagle Eye on Hole N -> see distance/strategy
  //   tap "Scorecard" on Eye -> jump to scorecard
  //   enter score on hole N -> tap "Save & Eagle Eye →"
  //   land back on Eye, currentHole = N+1
  // (2026-05-01 — Match-page completion plan extension)
  const [eyeHoleNudge, setEyeHoleNudge] = useState(null)
  // Cross-tab course context. Single source of truth for "which course is
  // currently selected" across EagleEye and Match. Stored as the full
  // {course, tee} pair so both tabs can render their own UIs from it.
  // Writes from three places:
  //   1. EagleEye picker -> onCourseSelected
  //   2. CreateWizard CoursePicker -> onCourseSelected
  //   3. LiveOuting first-load with course_id -> onCourseSelected
  // The first-load-only rule on (3) means the user can pick a different
  // course on Eye for "what if" exploration mid-match without the live
  // match's polling re-snapping Eye back. (2026-05-01)
  const [sharedCourse, setSharedCourse] = useState(null)
  // Permissions prompt — shown once per device on first signed-in
  // visit after onboarding finishes. Asks for notifications + location
  // in a single sheet. Gated by localStorage flag tm-perms-asked so
  // we don't pester users who already chose. (2026-05-01)
  const [showPermsPrompt, setShowPermsPrompt] = useState(false)

  useEffect(() => {
    // Check for token in URL fragment (post-auth bounce). After parsing,
    // scrub the fragment from the URL bar so the token doesn't linger in
    // browser history or appear in document.referrer when the user follows
    // an outbound link. (Audit B3 / 2026-04-29.)
    const hash = window.location.hash
    if (hash.startsWith('#token=')) {
      const token = hash.slice(7)
      localStorage.setItem('tm_token', token)
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      if (window.location.hash) window.location.hash = ''
    }

    // 2026-05-05 — QR-scan auto-join. ?join=ABCD on the URL is the
    // join-code QR's payload. Scrub from the URL after capture so a
    // refresh doesn't re-attempt the join. If the user isn't signed
    // in yet, stash in localStorage so it survives login + onboarding.
    try {
      const sp = new URLSearchParams(window.location.search)
      const j = sp.get('join')
      if (j) {
        const code = j.toUpperCase()
        setPendingJoinCode(code)
        try { localStorage.setItem('tm_pending_join', code) } catch { /* storage off */ }
        sp.delete('join')
        const newSearch = sp.toString() ? `?${sp.toString()}` : ''
        window.history.replaceState(null, '', window.location.pathname + newSearch + window.location.hash)
      } else {
        // No URL param — check localStorage in case a prior session
        // stashed a code that was never consumed (e.g. user closed
        // the app mid-onboarding after scanning).
        const stashed = localStorage.getItem('tm_pending_join')
        if (stashed) setPendingJoinCode(stashed.toUpperCase())
      }
    } catch { /* URL parsing or storage off — no auto-join, no crash */ }

    const token = getToken()
    if (!token) { setLoading(false); return }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.user) setUser(data.user) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // 2026-05-05 — When pendingJoinCode is set AND the user is signed
  // in past onboarding, route them to the Scorecard (Outing) tab so
  // the auto-join can fire there. If they're still mid-auth, this
  // useEffect just no-ops; the next tick (after user / onboarding
  // becomes truthy) will route them.
  useEffect(() => {
    if (!pendingJoinCode) return
    if (!user || !user.onboarding_completed_at) return
    setTab(TABS.OUTING)
  }, [pendingJoinCode, user?.id, user?.onboarding_completed_at])

  // Mark each visited tab as mounted on first activation. Once mounted, a
  // tab stays mounted for the rest of the session.
  useEffect(() => {
    setMountedTabs(prev => prev.has(tab) ? prev : new Set([...prev, tab]))
  }, [tab])

  // First-run permissions trigger. Only after the user is signed in
  // AND past onboarding. Shows the prompt if:
  //   - We've never asked on this device (no tm-perms-asked flag)
  //   - AND notifications permission is still 'default' (untouched)
  //   - AND push is supported
  // If permission was already granted (e.g. they hit Allow in a
  // previous session and we just lost the subscription state), make
  // sure the SW subscription is registered server-side without showing
  // the UI.
  useEffect(() => {
    if (!user || !user.onboarding_completed_at) return
    let asked = null
    try { asked = localStorage.getItem('tm-perms-asked') } catch { /* ignore */ }
    const supported = pushSupported()
    const perm = supported ? Notification.permission : 'unsupported'

    if (perm === 'granted') {
      // Re-bind subscription quietly — no UI.
      ensurePushSubscription().catch(() => {})
      return
    }
    if (!asked && supported && perm === 'default') {
      // Tiny delay so the splash → home transition lands first.
      const t = setTimeout(() => setShowPermsPrompt(true), 600)
      return () => clearTimeout(t)
    }
  }, [user?.id, user?.onboarding_completed_at])

  // Public live leaderboard short-circuit. ?live=ABCD on the URL
  // bypasses auth + onboarding entirely so a tee-box QR code or a
  // shared link in a group chat just works for spectators who don't
  // have an account. (Round 2 audit — public live leaderboard.)
  const liveCode = (() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const c = sp.get('live')
      return c ? c.toUpperCase() : null
    } catch { return null }
  })()
  if (liveCode) return <PublicLeaderboard code={liveCode} />

  // Item 9 — Print-friendly results page. ?print=ABCD short-circuits
  // before auth so the host can pop a print-optimized view in a new
  // tab without re-logging in. PrintResults uses the same public
  // endpoint as PublicLeaderboard (read-only spectator view) — for
  // private leagues a token-gated variant could be added later.
  const printCode = (() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const c = sp.get('print')
      return c ? c.toUpperCase() : null
    } catch { return null }
  })()
  if (printCode) return <PrintResults code={printCode} />

  if (loading) return <Splash />
  if (!user)   return <Login onLogin={setUser} />

  // First-run onboarding gate. Blocks the rest of the app until the
  // user has finished the four mandatory steps (welcome / handicap /
  // home_course / first_club). Step 5 (friend) is opt-in; the wizard
  // calls onComplete after the user finishes or skips it, which sets
  // onboarding_completed_at server-side.
  if (!user.onboarding_completed_at) {
    return (
      <OnboardingWizard
        user={user}
        onUserUpdate={setUser}
        onComplete={() => setUser(u => ({ ...u, onboarding_completed_at: new Date().toISOString() }))}
      />
    )
  }

  return (
    <div style={{
      minHeight: '100dvh',
      backgroundImage: 'url("https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=1200&q=90")',
      backgroundSize: 'cover',
      backgroundPosition: 'center 40%',
      backgroundAttachment: 'fixed',
      display: 'flex',
      justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 430,
        height: '100dvh',
        // Translucent Augusta cream — same tint that was on the
        // Home wrapper, lifted up one level so it covers the entire
        // phone-frame area including iOS rubber-band overscroll past
        // the bottom of any page. Photo behind (App outer wrapper)
        // still shows through at the same opacity. (2026-05-02 —
        // Matt: tint should extend down the entire page, not cut off)
        background: 'rgba(241,231,200,0.25)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Per-tab scrollable container. Each tab gets its own absolute-
            positioned panel; only the active tab is display:block. Inactive
            tabs stay in the React tree (state preserved) but are visually
            hidden and not interactive. */}
        {mountedTabs.has(TABS.HOME) && (
          <TabPanel active={tab === TABS.HOME}>
            <Home user={user} onNavigate={setTab} onNavigateToOuting={players => { setPendingOutingPlayers(players); setTab(TABS.OUTING) }} />
          </TabPanel>
        )}
        {mountedTabs.has(TABS.EYE) && (
          <TabPanel active={tab === TABS.EYE}>
            <EagleEye
              user={user}
              onGoToScorecard={() => setTab(TABS.OUTING)}
              eyeHoleNudge={eyeHoleNudge}
              onConsumeEyeHoleNudge={() => setEyeHoleNudge(null)}
              sharedCourse={sharedCourse}
              onCourseSelected={setSharedCourse}
            />
          </TabPanel>
        )}
        {mountedTabs.has(TABS.OUTING) && (
          <TabPanel active={tab === TABS.OUTING}>
            <Outing
              user={user}
              pendingPlayers={pendingOutingPlayers}
              onClearPending={() => setPendingOutingPlayers([])}
              pendingLeagueId={pendingLeagueId}
              onClearPendingLeague={() => setPendingLeagueId(null)}
              pendingJoinCode={pendingJoinCode}
              onClearPendingJoinCode={() => {
                setPendingJoinCode(null)
                try { localStorage.removeItem('tm_pending_join') } catch { /* ignore */ }
              }}
              onGoToEagleEye={hole => { setEyeHoleNudge(hole); setTab(TABS.EYE) }}
              sharedCourse={sharedCourse}
              onCourseSelected={setSharedCourse}
            />
          </TabPanel>
        )}
        {mountedTabs.has(TABS.BAG) && (
          <TabPanel active={tab === TABS.BAG}>
            <MyBag user={user} />
          </TabPanel>
        )}
        {mountedTabs.has(TABS.LEAGUES) && (
          <TabPanel active={tab === TABS.LEAGUES}>
            <Leagues
              user={user}
              onCreateEventInLeague={(leagueId) => {
                setPendingLeagueId(leagueId)
                setTab(TABS.OUTING)
              }}
            />
          </TabPanel>
        )}
        {mountedTabs.has(TABS.TOUR) && (
          <TabPanel active={tab === TABS.TOUR}>
            <PGAScores user={user} />
          </TabPanel>
        )}

        {/* Fixed nav pinned to bottom of screen */}
        <BottomNav active={tab} onChange={setTab} />
      </div>

      {/* First-signin permissions prompt. Renders outside the maxWidth
          shell so the slide-up sheet covers the full viewport. */}
      {showPermsPrompt && (
        <PermissionsPrompt
          user={user}
          onClose={() => setShowPermsPrompt(false)}
        />
      )}
    </div>
  )
}

// Lazy-keep-alive tab panel. Renders into the same scrollable region as
// before, but each tab gets its own panel so they don't fight over a single
// scrollTop. Hidden tabs use display:none — React keeps the subtree
// mounted, useState/useEffect/intervals all keep running.
//
// 2026-05-04 — pull-to-refresh wrapper added. Native iOS pull-to-refresh
// is killed by `overscroll-behavior: none` in tokens.css (keeps rubber-band
// from leaking the photo background past the page end). We re-add the
// gesture manually here: when the user touches at scrollTop=0 and drags
// down past a threshold, reload the page. Augusta-themed indicator slides
// in from the top edge with a damped pull. Available on every tab.
function TabPanel({ active, children }) {
  const containerRef = useRef(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(null)

  const TRIGGER = 70   // pixels of pull required to trigger refresh
  const MAX     = 110  // visual cap on pull distance

  function onTouchStart(e) {
    if (refreshing) return
    const el = containerRef.current
    // Only arm the pull when we're at the very top of the scroll area.
    // A 2px slop avoids tiny scroll wobbles disabling the gesture.
    if (!el || el.scrollTop > 2) {
      startY.current = null
      return
    }
    // 2026-05-04 hotfix — React portals (FriendProfile, FollowList,
    // GuestModal, etc.) render to document.body in the DOM, but
    // SYNTHETIC events still bubble up through the React component
    // tree to this TabPanel. Without this check, a downward swipe
    // inside ANY modal would trigger pull-to-refresh on the underlying
    // tab and reload the page — wiping modal state. el.contains() uses
    // the native DOM tree, so portal children correctly return false.
    if (!el.contains(e.target)) {
      startY.current = null
      return
    }
    // 2026-05-05 hotfix — opt-out for screens where a page reload
    // would actively destroy user work. Solo Round (ActiveRound.jsx)
    // wraps its render in <div data-no-pull-refresh="true">; same can
    // be added to any other no-reload-zone (mid-scoring scorecards,
    // etc.). closest() walks up the DOM tree from the touch target so
    // any descendant of the no-pull region disarms the gesture.
    if (e.target?.closest && e.target.closest('[data-no-pull-refresh="true"]')) {
      startY.current = null
      return
    }
    startY.current = e.touches[0].clientY
  }

  function onTouchMove(e) {
    if (refreshing || startY.current == null) return
    // Same portal-isolation check as onTouchStart. Belt-and-suspenders:
    // if a touch starts on the TabPanel and ends up dragging into a
    // portal (or vice versa), we don't want to mis-track it.
    const el = containerRef.current
    if (!el || !el.contains(e.target)) {
      setPullDistance(0)
      return
    }
    // Same no-pull-refresh opt-out check as onTouchStart.
    if (e.target?.closest && e.target.closest('[data-no-pull-refresh="true"]')) {
      setPullDistance(0)
      return
    }
    const raw = e.touches[0].clientY - startY.current
    if (raw <= 0) {
      // User reversed direction — cancel the pull state. The container
      // can resume normal scrolling on the next touch.
      setPullDistance(0)
      return
    }
    // Damp the visible pull so it feels rubber-bandy and so the user
    // has to commit (~140px raw to hit 70px trigger).
    const damped = Math.min(raw * 0.5, MAX)
    setPullDistance(damped)
  }

  function onTouchEnd() {
    if (startY.current == null) return
    startY.current = null
    if (pullDistance >= TRIGGER) {
      // Lock the indicator at its visible height while we reload.
      setRefreshing(true)
      setPullDistance(60)
      // Tiny delay so the user actually sees the spinner fire before
      // the white-flash of reload — feels more like a confirmed action.
      setTimeout(() => window.location.reload(), 150)
    } else {
      setPullDistance(0)
    }
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: '56px',
        overflowY: 'auto', overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        display: active ? 'block' : 'none',
      }}>
      <PullIndicator distance={pullDistance} triggerAt={TRIGGER} refreshing={refreshing} />
      <div style={{
        transform: `translateY(${pullDistance}px)`,
        // Animate back to 0 only when the user releases (pullDistance
        // becomes 0 in onTouchEnd). During an active drag we want
        // the translate to track the finger 1:1 (no transition).
        transition: pullDistance === 0 || refreshing ? 'transform 220ms ease-out' : 'none',
        willChange: 'transform',
      }}>
        {children}
      </div>
    </div>
  )
}

// Pull-to-refresh visual indicator. Sits absolutely positioned at the
// top of the scroll container, slides into view as the user pulls. The
// chevron rotates 0→180° as the pull progresses; once the trigger
// threshold is hit, the chip flips to the "release to refresh" gold
// state and the icon fully inverts. While refreshing, the chip spins.
function PullIndicator({ distance, triggerAt, refreshing }) {
  if (distance < 4 && !refreshing) return null
  const ready    = distance >= triggerAt || refreshing
  const progress = Math.min(distance / triggerAt, 1)
  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0, right: 0,
      height: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 5,
      // Match the children's translate so the indicator rides above
      // the content as the user pulls.
      transform: `translateY(${Math.max(distance - 60, -60)}px)`,
      transition: refreshing ? 'transform 220ms ease-out' : 'none',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: ready
          ? 'linear-gradient(145deg, #35A046 0%, #2A7A38 60%, #1A4A24 100%)'
          : 'rgba(255,253,248,0.92)',
        border: ready ? '1px solid rgba(53,160,70,0.55)' : '1px solid rgba(46,158,69,0.30)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: ready
          ? '0 4px 14px rgba(42,122,56,0.40)'
          : '0 2px 8px rgba(0,0,0,0.10)',
        transition: 'background 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
      }}>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke={ready ? '#fff' : '#1B5E3B'}
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{
            transform: refreshing ? 'none' : `rotate(${progress * 180}deg)`,
            transition: refreshing ? 'none' : 'transform 100ms ease',
            animation: refreshing ? 'tm-spin 700ms linear infinite' : 'none',
          }}>
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15A9 9 0 1 1 20 9"/>
        </svg>
      </div>
    </div>
  )
}

function Splash() {
  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: 'var(--tm-bg)',
      gap: 16,
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(30,80,35,0.5) 0%, rgba(10,30,14,0.3) 100%)',
        border: '1px solid rgba(94,212,122,0.25)',
        boxShadow: '0 0 40px rgba(94,212,122,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 4,
      }}>
        <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="22" stroke="#5ED47A" strokeWidth="1.5" opacity="0.5" />
          <line x1="20" y1="34" x2="20" y2="16" stroke="#E8C05A" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M20 16 L32 20 L20 24 Z" fill="#E8C05A" opacity="0.9" />
          <ellipse cx="24" cy="34" rx="8" ry="2" fill="#E8C05A" opacity="0.12" />
        </svg>
      </div>
      <div style={{
        fontSize: 28, fontWeight: 800, letterSpacing: '-1px',
        background: 'linear-gradient(135deg, #F5D78A, #E8C05A)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
      }}>
        The Match
      </div>
      <div style={{
        width: 40, height: 3, borderRadius: 99,
        background: 'var(--tm-green)',
        animation: 'pulse 1.4s ease-in-out infinite',
      }} />
    </div>
  )
}
