import { useState, useEffect } from 'react'
import BottomNav from './components/shell/BottomNav.jsx'
import { TABS } from './constants.js'
import Home from './pages/Home.jsx'

import EagleEye from './pages/EagleEye.jsx'
import Outing from './pages/Outing.jsx'
import MyBag from './pages/MyBag.jsx'
import PGAScores from './pages/PGAScores.jsx'
import Login from './pages/Login.jsx'
import { getToken } from './lib/api.js'


export default function App() {
  const [tab, setTab] = useState(TABS.HOME)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingOutingPlayers, setPendingOutingPlayers] = useState([])
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

  // Mark each visited tab as mounted on first activation. Once mounted, a
  // tab stays mounted for the rest of the session.
  useEffect(() => {
    setMountedTabs(prev => prev.has(tab) ? prev : new Set([...prev, tab]))
  }, [tab])

  if (loading) return <Splash />
  if (!user)   return <Login onLogin={setUser} />

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
        background: 'transparent',
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
        {mountedTabs.has(TABS.TOUR) && (
          <TabPanel active={tab === TABS.TOUR}>
            <PGAScores />
          </TabPanel>
        )}

        {/* Fixed nav pinned to bottom of screen */}
        <BottomNav active={tab} onChange={setTab} />
      </div>
    </div>
  )
}

// Lazy-keep-alive tab panel. Renders into the same scrollable region as
// before, but each tab gets its own panel so they don't fight over a single
// scrollTop. Hidden tabs use display:none — React keeps the subtree
// mounted, useState/useEffect/intervals all keep running.
function TabPanel({ active, children }) {
  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: '56px',
      overflowY: 'auto', overflowX: 'hidden',
      WebkitOverflowScrolling: 'touch',
      display: active ? 'block' : 'none',
    }}>
      {children}
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
