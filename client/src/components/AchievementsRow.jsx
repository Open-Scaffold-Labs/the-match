import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { AchievementBadge } from './AchievementToast.jsx'

// ─── AchievementsRow ──────────────────────────────────────────────────────
// Compact horizontal row of earned achievement badges, rendered on the
// dark Profile body. Fetches achievements once on mount — no polling
// because achievements only ever land via score writes (which surface
// them through the global toast event), so the row is correct after the
// next Profile open.
//
// Optional `userId` prop: when present, fetches that user's achievements
// (via the public per-user endpoint added 2026-05-07). When absent,
// falls back to the viewer's own. Used by FriendProfile to show
// James's badges on James's profile.
//
// Empty state has personality (per Hub conventions) — gold pin-flag
// silhouette on a faint dark card, with a one-liner.
//
// (2026-05-06 — polish task #5; 2026-05-07 — userId prop for FriendProfile.)

export default function AchievementsRow({ userId } = {}) {
  const [list, setList] = useState(null)  // null = loading, [] = empty, [...] = list

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        // Use the per-user endpoint when a userId was supplied (FriendProfile);
        // fall back to /api/profile/achievements (the viewer's own) otherwise.
        const url = userId
          ? `/api/profile/achievements/${Number(userId)}`
          : '/api/profile/achievements'
        const r = await api(url)
        if (!alive) return
        setList(Array.isArray(r?.achievements) ? r.achievements : [])
      } catch {
        if (alive) setList([])  // surface empty rather than blocking the Profile
      }
    }
    load()
    // Refresh when a new achievement is awarded mid-session — the toast
    // dispatches `tm:achievement-earned`, we listen for the same event
    // and re-pull. Cheap one-call refetch. Only refetch the SELF row;
    // friend-profile achievements are driven by their own score writes,
    // not the viewer's, so the local toast event is irrelevant there.
    function onEarned() { if (!userId) load() }
    window.addEventListener('tm:achievement-earned', onEarned)
    return () => {
      alive = false
      window.removeEventListener('tm:achievement-earned', onEarned)
    }
  }, [userId])

  // Loading — render the same shape as the loaded state so layout
  // doesn't jump.
  if (list === null) {
    return (
      <Card>
        <Header />
        <div style={{ display: 'flex', gap: 10, paddingTop: 10 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
            }} />
          ))}
        </div>
      </Card>
    )
  }

  // Empty — no achievements yet.
  if (!list.length) {
    return (
      <Card>
        <Header />
        <div style={{
          color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 1.45,
          paddingTop: 8,
        }}>
          No badges yet. Drop a birdie, post a sub-80 round, or play three rounds in a week — they unlock as you go.
        </div>
      </Card>
    )
  }

  // Earned — show all badges with title hover, plus a small caption row.
  return (
    <Card>
      <Header count={list.length} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingTop: 10 }}>
        {list.map(a => (
          <div key={a.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 64 }}>
            <AchievementBadge achievement={a} size={40} />
            <div style={{
              fontSize: 9, color: 'rgba(255,255,255,0.65)', textAlign: 'center',
              lineHeight: 1.2, fontWeight: 700, letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>{a.title}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Card({ children }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 14, padding: '14px 16px', marginBottom: 12,
    }}>
      {children}
    </div>
  )
}

function Header({ count }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'rgba(232,192,90,0.85)',
        textTransform: 'uppercase', letterSpacing: '0.10em',
      }}>Achievements</div>
      {count != null && (
        <div style={{
          fontSize: 11, color: 'rgba(255,255,255,0.45)',
        }}>{count}</div>
      )}
    </div>
  )
}
