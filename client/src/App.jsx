import { useState, useEffect, useRef } from 'react'
import BottomNav from './components/shell/BottomNav.jsx'
import { TABS } from './constants.js'
import { useIsDesktop } from './lib/useViewport.js'
import Home from './pages/Home.jsx'

import EagleEye from './pages/EagleEye.jsx'
import Outing from './pages/Outing.jsx'
import MyBag from './pages/MyBag.jsx'
import Leagues from './pages/Leagues.jsx'
import PGAScores from './pages/PGAScores.jsx'
import Login from './pages/Login.jsx'
import OnboardingWizard from './components/OnboardingWizard.jsx'
import PermissionsPrompt from './components/PermissionsPrompt.jsx'
import AchievementToast from './components/AchievementToast.jsx'
import PublicLeaderboard from './pages/PublicLeaderboard.jsx'
import PrintResults from './pages/PrintResults.jsx'
import { getToken } from './lib/api.js'
import { ensurePushSubscription, pushSupported } from './lib/push.js'

// TEMP DIAGNOSTIC (2026-06-27) — measures the real safe-area + viewport
// numbers on-device so we can see whether viewport-fit=cover is actually
// bleeding (ih≈sh) or not (ih<sh by the inset), instead of guessing.
// Remove once the full-screen issue is resolved.
function SafeAreaProbe() {
  const [info, setInfo] = useState('measuring…')
  useEffect(() => {
    const measure = () => {
      const mk = (prop) => {
        const d = document.createElement('div')
        d.style.cssText = `position:fixed;left:0;bottom:0;width:1px;height:${prop};`
        document.body.appendChild(d)
        const h = Math.round(d.getBoundingClientRect().height)
        document.body.removeChild(d)
        return h
      }
      const sab = mk('env(safe-area-inset-bottom,0px)')
      const sat = mk('env(safe-area-inset-top,0px)')
      const de = document.documentElement
      const iw = window.innerWidth
      const dsw = de.scrollWidth
      const bsw = document.body.scrollWidth
      setInfo(
        `sab=${sab} sat=${sat} ih=${window.innerHeight} sh=${window.screen.height} | ` +
        `iw=${iw} dsw=${dsw} bsw=${bsw} ${dsw > iw ? '⚠OVERFLOW' : 'fit✓'}`
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 99999,
      background: 'rgba(190,0,40,0.92)', color: '#fff', fontSize: 10,
      fontFamily: 'ui-monospace, Menlo, monospace', textAlign: 'center',
      padding: '3px 4px', lineHeight: 1.3, pointerEvents: 'none',
      letterSpacing: '0.02em',
    }}>
      {info}
    </div>
  )
}


// Active-tab persistence — restores the tab the user was on across
// pull-to-refresh and any other window.location.reload() (Matt:
// "the refresh automatically lands you back on home page... you
// should remain on the page you refreshed from"). Stored as a plain
// string in localStorage; validated against TABS on read so a stale
// or corrupted value falls back to HOME instead of crashing the
// router. (2026-05-06.)
const TAB_STORAGE_KEY = 'tm-last-tab'
function readPersistedTab() {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    if (v && Object.values(TABS).includes(v)) return v
  } catch { /* ignore — Safari private mode etc. */ }
  return TABS.HOME
}

// Selected-course persistence — survives pull-to-refresh, the service
// worker's auto-reload-on-update, and any window.location.reload(). The
// active tab was already persisted (TAB_STORAGE_KEY), but sharedCourse
// was in-memory only, so a reload dumped Eagle Eye to its empty course-
// picker state and "lost everything" mid-round. Persist the {course, tee}
// pair so Eagle Eye + Match resume the exact course on reload. (2026-06-06
// — Matt: "swipe down refreshes and loses all data".)
const COURSE_STORAGE_KEY = 'tm-shared-course'
function readPersistedCourse() {
  try {
    const raw = localStorage.getItem(COURSE_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    // Validate shape so a stale/corrupted value can't crash the UI.
    if (v && v.course && v.course.id) return v
  } catch { /* ignore — bad JSON / private mode */ }
  return null
}

export default function App() {
  const [tab, setTab] = useState(readPersistedTab)
  // Remember the last non-Eagle-Eye tab so Eagle Eye's back control (the tab bar
  // is hidden there) returns the user to where they came from. (2026-06-26)
  const lastNonEyeTabRef = useRef(tab === TABS.EYE ? TABS.HOME : tab)
  useEffect(() => { if (tab !== TABS.EYE) lastNonEyeTabRef.current = tab }, [tab])
  // The <body> is cream (#FFFDF8) to hide safe-area bleed behind the cream nav.
  // Eagle Eye is a full-bleed dark map with no nav, so that cream shows as a
  // white strip in the bottom/edge safe areas. Paint html+body dark while on
  // Eagle Eye so the satellite map bleeds edge-to-edge with no white. (2026-06-26)
  useEffect(() => {
    const dark = tab === TABS.EYE
    document.documentElement.style.backgroundColor = dark ? '#070C09' : ''
    document.body.style.backgroundColor = dark ? '#070C09' : ''
    return () => { document.documentElement.style.backgroundColor = ''; document.body.style.backgroundColor = '' }
  }, [tab])
  const isDesktop = useIsDesktop()
  // Save on every tab change. Cheap localStorage write, no debounce
  // needed since taps are rare relative to other render work.
  useEffect(() => {
    try { localStorage.setItem(TAB_STORAGE_KEY, tab) } catch { /* ignore */ }
  }, [tab])
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
  // Bumps every time the user taps a bottom-nav tab (including taps on the
  // currently active tab). Children listen via useEffect to reset their
  // internal navigation state — e.g., Home resets to view='home' so the
  // profile sub-view doesn't stay sticky when the user taps Home again.
  // (2026-05-07 PM3.)
  const [tabPressedAt, setTabPressedAt] = useState(0)
  // Home's current sub-view ('home' dashboard vs 'profile'), reported up by
  // Home so the outer wrapper can drop the grass photo on My Profile — which
  // otherwise bleeds into the side borders on phones wider than the 430px
  // frame. (2026-06-23) Default 'home' so the grass hero shows on first paint.
  const [homeView, setHomeView] = useState('home')
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
  const [sharedCourse, setSharedCourse] = useState(readPersistedCourse)
  // Persist the selected course so a reload (pull-to-refresh, SW update,
  // etc.) resumes it instead of losing the round. Mirrors the tab-persist
  // pattern above. (2026-06-06)
  useEffect(() => {
    try {
      if (sharedCourse?.course?.id) localStorage.setItem(COURSE_STORAGE_KEY, JSON.stringify(sharedCourse))
      else localStorage.removeItem(COURSE_STORAGE_KEY)
    } catch { /* ignore */ }
  }, [sharedCourse])
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

  // 2026-05-06 hardening — listen for SW push messages and route the
  // achievement-tagged ones into the in-app toast event. This closes
  // the gap where a host wrote a player's eagle: the player's phone
  // gets the system notification, AND if the page is foregrounded the
  // SW also postMessages here, which we translate into the local
  // `tm:achievement-earned` event so AchievementToast pops in-app.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
    function onMessage(e) {
      const d = e?.data
      // 2026-05-07 PM — handle the "new SW activated" broadcast first.
      // Without this the user's PWA tab keeps running its old loaded
      // bundle until they manually reload — which is how Matt got
      // stuck on a 7-commits-stale build today (celebration modal,
      // SoloScoreModal, rarity tiers, all missing client-side even
      // though prod had them). location.reload() forces the browser
      // to re-fetch index.html, which references the latest hashed
      // bundle. SkipWaiting + claim mean the SW is already in control,
      // so the next load gets the fresh code immediately.
      if (d && d.kind === 'sw-activated') {
        // Tiny delay so any in-flight microtasks (analytics, save
        // confirmations) have a moment to settle before we kick the
        // user. Long enough to feel intentional, short enough they
        // shouldn't notice.
        setTimeout(() => { try { window.location.reload() } catch { /* ignore */ } }, 500)
        return
      }
      if (!d || d.kind !== 'push') return
      const tag = d?.payload?.tag || ''
      if (!tag.startsWith('achievement-')) return
      const type = tag.replace(/^achievement-/, '')
      // Re-fetch the user's achievements list to get the canonical row
      // (including id + earned_at), then dispatch the event with just
      // the new ones. This keeps a single source of truth — no risk
      // of the toast and the badge row showing different data.
      ;(async () => {
        try {
          const r = await fetch('/api/profile/achievements', {
            headers: { Authorization: `Bearer ${localStorage.getItem('tm_token') || ''}` },
          })
          if (!r.ok) return
          const j = await r.json()
          const match = (j?.achievements || []).find(a => a.type === type)
          if (match) {
            window.dispatchEvent(new CustomEvent('tm:achievement-earned', {
              detail: { achievements: [match] },
            }))
          }
        } catch { /* ignore — the system notification still landed */ }
      })()
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])

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

  // Outermost background. The grass photo is the hero ONLY on tabs that use
  // it (Home, Tour). On every other tab the outermost layer is opaque — so
  // with viewport-fit=cover, the photo can't bleed at the screen edges /
  // safe-area bands (notch, home indicator) even if an inner layer doesn't
  // perfectly tile. Eagle Eye's edges go dark to match its theme; everything
  // else uses the parchment base. (2026-06-23 — Matt: grass showing at the
  // borders because pages don't fill the screen edge-to-edge.)
  const grassTab = (tab === TABS.HOME && homeView !== 'profile') || tab === TABS.TOUR
  // Desktop breakout: only the Leagues tab widens past the phone frame, and only
  // on a real desktop viewport. Every other tab — and the entire iOS app — stays
  // at 430px. (2026-06-26)
  const desktopLeagues = isDesktop && tab === TABS.LEAGUES
  const outerBg = grassTab
    ? {
        backgroundImage: 'url("https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=1200&q=90")',
        backgroundSize: 'cover',
        backgroundPosition: 'center 40%',
        backgroundAttachment: 'fixed',
      }
    : { background: tab === TABS.EYE ? 'var(--tm-dark-0)' : 'var(--tm-bg)' }
  return (
    <div style={{
      minHeight: '100dvh',
      ...outerBg,
      display: 'flex',
      justifyContent: 'center',
    }}>
      <SafeAreaProbe />
      <div style={{
        // Eagle Eye is a full-bleed rangefinder — let it span the entire device
        // width (no 430 phone-frame cap) so the satellite map reaches both edges
        // like the leading apps. Every other tab keeps the centered phone frame.
        width: '100%', maxWidth: tab === TABS.EYE ? '100%' : (desktopLeagues ? 1180 : 430),
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
          <TabPanel active={tab === TABS.HOME} opaque={false}>
            <Home
              user={user}
              onNavigate={setTab}
              onNavigateToOuting={players => { setPendingOutingPlayers(players); setTab(TABS.OUTING) }}
              tabPressedAt={tabPressedAt}
              onHomeViewChange={setHomeView}
            />
          </TabPanel>
        )}
        {mountedTabs.has(TABS.EYE) && (
          <TabPanel active={tab === TABS.EYE} fullHeight>
            <EagleEye
              user={user}
              onGoToScorecard={() => setTab(TABS.OUTING)}
              onExit={() => setTab(lastNonEyeTabRef.current || TABS.HOME)}
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
              isDesktop={isDesktop}
              onCreateEventInLeague={(leagueId) => {
                setPendingLeagueId(leagueId)
                setTab(TABS.OUTING)
              }}
            />
          </TabPanel>
        )}
        {mountedTabs.has(TABS.TOUR) && (
          <TabPanel active={tab === TABS.TOUR} opaque={false}>
            <PGAScores user={user} />
          </TabPanel>
        )}

        {/* Fixed nav pinned to bottom of screen.
            handleTabPress fires on EVERY tap, including taps on the
            currently active tab. The tabPressedAt counter increments
            unconditionally so child tab components can listen for "the
            user tapped my tab again" and reset their internal view
            state — e.g., Home resets view='home' so users on My Profile
            who tap the Home icon land back on the home view instead of
            having to use the back button. (2026-05-07 PM3 — Matt:
            'when pressing any icon at the bottom of the page it should
            bring you to that icons home page'.) */}
        {/* Hide the tab bar on Eagle Eye — it's a full-immersion rangefinder
            screen (like the leading golf apps), so the map runs edge-to-edge to
            the very bottom and Eagle Eye provides its own back control.
            (2026-06-26 — Matt) */}
        {tab !== TABS.EYE && (
          <BottomNav active={tab} onChange={(nextTab) => {
            setTabPressedAt(Date.now())
            if (nextTab !== tab) setTab(nextTab)
          }} />
        )}
      </div>

      {/* First-signin permissions prompt. Renders outside the maxWidth
          shell so the slide-up sheet covers the full viewport. */}
      {showPermsPrompt && (
        <PermissionsPrompt
          user={user}
          onClose={() => setShowPermsPrompt(false)}
        />
      )}

      {/* 2026-05-06 (polish task #5) — global achievement-unlock toast.
          Mounted at App level so it survives any inner-page navigation
          (especially ActiveRound's post-save onBack which would unmount
          a component-local queue). Listens for the
          `tm:achievement-earned` CustomEvent and pops one card per
          achievement. */}
      <AchievementToast />
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
function TabPanel({ active, children, opaque = true, fullHeight = false }) {
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
        top: 0, left: 0, right: 0, bottom: fullHeight ? 0 : '56px',
        overflowY: 'auto', overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        display: active ? 'block' : 'none',
        // Opaque base so the App-shell grass photo doesn't bleed through
        // behind page content. Home and Tour opt out (opaque={false}) to keep
        // the photo as their hero; every other tab sits on the parchment
        // scorecard base (dark-themed pages like Leagues/EagleEye paint over
        // it). (2026-06-23 — Matt: home background showing behind other pages;
        // Tour is meant to share the home background.)
        background: opaque ? 'var(--tm-bg)' : 'transparent',
      }}>
      {/* Full-height panels (Eagle Eye) opt out of the pull-to-refresh transform
          wrapper. A `transform` ancestor becomes the containing block for any
          `position: fixed` child, which would trap Eagle Eye's fixed full-screen
          container. No transform → the fixed map covers the true physical screen,
          edge to edge. (2026-06-26) */}
      {fullHeight ? children : (
        <>
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
        </>
      )}
    </div>
  )
}

// Pull-to-refresh visual indicator. Sits absolutely positioned at the
// top of the scroll container, slides into view as the user pulls.
//
// 2026-05-06 — Augusta pin-flag instead of the generic refresh chevron
// (polish task #2). The pole + cup are drawn with stroke; the flag
// triangle's horizontal scale ramps from 0→1 with pull progress so it
// looks like the flag is unfurling on the pin as you pull. Once the
// trigger threshold is crossed, the chip flips to the green "ready to
// release" state and the flag goes solid gold. While refreshing, the
// whole SVG spins via tm-spin, same cadence as the old chevron.
function PullIndicator({ distance, triggerAt, refreshing }) {
  if (distance < 4 && !refreshing) return null
  const ready    = distance >= triggerAt || refreshing
  const progress = Math.min(distance / triggerAt, 1)
  // Pole stroke + flag fill. When ready, the pole goes white-on-green
  // (matches the existing chip's color flip); the flag is always gold
  // but ramps from dim → bright between not-ready and ready so the
  // hand-off reads cleanly.
  const poleStroke = ready ? '#FFFDF8' : '#1B5E3B'
  const flagFill   = ready ? '#F5D78A' : '#C9A040'
  // Flag unfurl — scaleX from 0.05 → 1 as progress hits 1. We don't
  // start at 0 because a fully-collapsed triangle disappears entirely
  // and the pole looks broken. Force 1 once ready/refreshing so the
  // spinning chip shows a full flag, not a sliver, even when the
  // user has released and `distance` has returned to 0.
  const flagScale  = ready ? 1 : 0.05 + 0.95 * progress
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
          width="20" height="20" viewBox="0 0 24 24" fill="none"
          style={{
            animation: refreshing ? 'tm-spin 700ms linear infinite' : 'none',
            transition: refreshing ? 'none' : 'transform 100ms ease',
          }}>
          {/* Pin pole — vertical line. */}
          <line x1="8" y1="4" x2="8" y2="21"
            stroke={poleStroke} strokeWidth="2"
            strokeLinecap="round" />
          {/* Cup at the bottom — short horizontal tick. */}
          <line x1="4" y1="21" x2="12" y2="21"
            stroke={poleStroke} strokeWidth="2"
            strokeLinecap="round" />
          {/* Flag triangle — scales out from the pole as pull progresses.
              CSS transform-origin on SVG paths works in iOS Safari 15+
              (our practical floor), and only the CSS path animates
              smoothly via `transition` — switching to the SVG transform
              attribute would have made it jump. */}
          <path d="M8 4 L18 7 L8 10 Z"
            fill={flagFill}
            stroke={flagFill}
            strokeWidth="0.6"
            strokeLinejoin="round"
            style={{
              transform: `scaleX(${flagScale})`,
              transformOrigin: '8px 7px',
              transition: refreshing ? 'none' : 'transform 100ms ease, fill 180ms ease',
            }} />
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
