import { useState, useEffect } from 'react'
import BottomNav from './components/shell/BottomNav.jsx'
import { TABS } from './constants.js'
import Home from './pages/Home.jsx'

import EagleEye from './pages/EagleEye.jsx'
import Outing from './pages/Outing.jsx'
import Stats from './pages/Stats.jsx'
import PGAScores from './pages/PGAScores.jsx'
import Login from './pages/Login.jsx'
import { getToken } from './lib/api.js'


export default function App() {
  const [tab, setTab] = useState(TABS.HOME)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingOutingPlayers, setPendingOutingPlayers] = useState([])

  useEffect(() => {
    // Check for token in URL fragment (post-auth bounce)
    const hash = window.location.hash
    if (hash.startsWith('#token=')) {
      const token = hash.slice(7)
      localStorage.setItem('tm_token', token)
      window.history.replaceState(null, '', window.location.pathname)
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

  if (loading) return <Splash />
  if (!user)   return <Login onLogin={setUser} />

  const pages = {
    [TABS.HOME]:   <Home   user={user} onNavigate={setTab} onNavigateToOuting={players => { setPendingOutingPlayers(players); setTab(TABS.OUTING) }} />,
    [TABS.EYE]:    <EagleEye user={user} />,
    [TABS.OUTING]: <Outing user={user} pendingPlayers={pendingOutingPlayers} onClearPending={() => setPendingOutingPlayers([])} />,
    [TABS.STATS]:  <Stats  user={user} />,
    [TABS.TOUR]:   <PGAScores />,
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
        height: '100dvh', display: 'flex', flexDirection: 'column',
        background: 'transparent',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          position: 'relative',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',
        }}>
          {pages[tab]}
        </div>
        <BottomNav active={tab} onChange={setTab} />
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
