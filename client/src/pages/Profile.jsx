// Profile — top-level My Profile tab (Phase 0 nav restructure, 2026-07-09).
//
// Promoted out of Home's `homeView==='profile'` sub-view per the
// start-match-unified-flow plan: the bottom bar is now
// Home · Match · ▶Play · Profile · Tour. This page owns its own data
// fetching (the sub-view used to piggyback on Home's loadAll) and renders
// the same exported ProfileView + overlays the sub-view rendered, so the
// screen itself is pixel-identical.
//
// Mounting note: ProfileView portals a full-viewport fixed overlay to
// <body>, which escapes App's display:none TabPanel hiding. App therefore
// mounts this page ONLY while the Profile tab is active (plain conditional
// render, not the lazy-keep-alive pattern) — otherwise the portal would
// cover every other tab.

import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api.js'
import { ProfileView, EditProfileModal } from './Home.jsx'
import FriendProfile from '../components/FriendProfile.jsx'
import PlayerCard from '../components/PlayerCard.jsx'
import Practice from './Practice.jsx'
import Caddie from './Caddie.jsx'
import GamePlan from './GamePlan.jsx'
import { TMEmblem } from '../components/primitives/Icons.jsx'
import { TABS } from '../constants.js'

export default function Profile({ onNavigate }) {
  const [profile, setProfile]           = useState(null)
  const [stats, setStats]               = useState(null)
  const [rounds, setRounds]             = useState([])
  const [rivalries, setRivalries]       = useState([])
  const [followCounts, setFollowCounts] = useState({ following: 0, followers: 0 })
  // Confirmed games — FriendProfile shows shared upcoming games, same as
  // the Home dashboard path does.
  const [confirmedGames, setConfirmedGames] = useState([])
  const [loading, setLoading]           = useState(true)

  const [editOpen, setEditOpen]             = useState(false)
  const [practiceOpen, setPracticeOpen]     = useState(false)
  const [caddieOpen, setCaddieOpen]         = useState(false)
  const [gamePlanOpen, setGamePlanOpen]     = useState(false)
  const [playerCardOpen, setPlayerCardOpen] = useState(false)
  const [selectedFriend, setSelectedFriend] = useState(null)

  const refreshFollowCounts = useCallback(async () => {
    try {
      const c = await api('/api/follows/counts')
      setFollowCounts(c ?? { following: 0, followers: 0 })
    } catch { /* ignore — leave stale counts */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Same endpoints the Home sub-view relied on, all fail-soft so a
        // transient error on one card doesn't blank the whole profile.
        const [p, s, r, fc, riv, g] = await Promise.all([
          api('/api/profile'),
          api('/api/stats/summary').catch(() => null),
          api('/api/rounds?limit=20').catch(() => ({ rounds: [] })),
          api('/api/follows/counts').catch(() => null),
          api('/api/outings/my-rivalries').catch(() => null),
          api('/api/games').catch(() => null),
        ])
        if (cancelled) return
        setProfile(p)
        setStats(s)
        setRounds(r?.rounds ?? [])
        setFollowCounts(fc ?? { following: 0, followers: 0 })
        setRivalries(riv?.rivalries ?? [])
        setConfirmedGames(g?.confirmed ?? [])
      } catch (err) {
        console.error('[Profile] load', err)
      }
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  function handleProfileSaved(updates) {
    setProfile(prev => ({ ...prev, user: { ...prev.user, ...updates } }))
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <TMEmblem size={40} />
          <div style={{ color: 'rgba(13,31,18,0.38)', fontSize: 12, marginTop: 12 }}>Loading…</div>
        </div>
      </div>
    )
  }

  const { user, season, avg3, streak } = profile ?? {}

  return (
    <>
      <ProfileView
        user={user} season={season} avg3={avg3} streak={streak}
        stats={stats} rounds={rounds}
        rivalries={rivalries}
        followCounts={followCounts}
        onCountsChange={refreshFollowCounts}
        // Back arrow → Home. As a top-level tab there's no sub-view to pop
        // back to; Home is the natural anchor.
        onBack={() => onNavigate?.(TABS.HOME)}
        onEditProfile={() => setEditOpen(true)}
        onOpenCard={() => setPlayerCardOpen(true)}
        onOpenPractice={() => setPracticeOpen(true)}
        onOpenCaddie={() => setCaddieOpen(true)}
        onOpenGamePlan={() => setGamePlanOpen(true)}
        // Tap an opponent face inside a rivalry popup → open that user's
        // FriendProfile on top of this view.
        onOpenFriend={setSelectedFriend}
      />
      {/* Edit profile modal — opens from the Profile view's Edit button */}
      {editOpen && (
        <EditProfileModal user={user} onSave={handleProfileSaved} onClose={() => setEditOpen(false)} />
      )}
      {/* Practice plan (data → practice loop, 3.5) — opens from the Profile
          view's Practice card. Full-screen overlay; fetches /api/practice. */}
      {practiceOpen && (
        <Practice onClose={() => setPracticeOpen(false)} />
      )}
      {/* The Caddie — AI chat (whitepaper §5.6). Full-screen overlay;
          POSTs /api/caddie/chat with the running thread. */}
      {caddieOpen && (
        <Caddie onClose={() => setCaddieOpen(false)} />
      )}
      {/* GamePlan — Game Day Strategy (Phase 0). Full-screen overlay;
          POSTs /api/gameplan, reopens the latest stored plan. */}
      {gamePlanOpen && (
        <GamePlan onClose={() => setGamePlanOpen(false)} />
      )}
      {/* Player card overlay — opens from the big avatar in the header.
          userId mirrors the Home sub-view's `profile?.id` pass-through. */}
      {playerCardOpen && (
        <PlayerCard onClose={() => setPlayerCardOpen(false)} userId={profile?.id} />
      )}
      {/* Friend profile portal — tapping an opponent face in a rivalry
          popup opens their FriendProfile without leaving this tab. */}
      {selectedFriend && (
        <FriendProfile
          friend={selectedFriend}
          myName={user?.name}
          confirmedGames={confirmedGames}
          onClose={() => setSelectedFriend(null)}
          onOpenFriend={(opp) => {
            // Tapping an opponent inside a friend's rivalry popup. If it's
            // me, close back to my own profile; otherwise swap to the new
            // friend in place.
            if (String(opp?.id) === String(user?.id)) setSelectedFriend(null)
            else setSelectedFriend(opp)
          }}
        />
      )}
    </>
  )
}
