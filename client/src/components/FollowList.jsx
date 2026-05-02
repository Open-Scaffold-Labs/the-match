// FollowList — bottom-sheet overlay showing a list of users in one of
// the three follow categories: 'following', 'followers', or 'mutuals'.
//
// Each row shows avatar + name + handicap (when set) + a per-row action:
//   following  → 'Unfollow' button (instantly drops the row + bumps counts)
//   followers  → 'Follow back' button if not already following them, else
//                'Mutual ✓' badge (read-only)
//   mutuals    → 'Mutual ✓' badge (read-only)
//
// Counts in the parent surface (Profile / Home pills) re-fetch via
// onCountsChange after any mutation so the headers stay live.
//
// (2026-05-01 — follow Phase 1)

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { api, post, del } from '../lib/api.js'
import FriendProfile from './FriendProfile.jsx'

const TITLES = {
  following: 'Following',
  followers: 'Followers',
  mutuals:   'Mutuals',
}

const EMPTY_COPY = {
  following: "You're not following anyone yet. Find someone on a leaderboard or in a match and tap their name to follow.",
  followers: "Nobody's followed you yet. Share your profile to start building a following.",
  mutuals:   "No mutuals yet. Mutuals are people who follow you and you follow them — the warm circle of golfers you actually play with.",
}

export default function FollowList({ type, onClose, onCountsChange }) {
  const [users, setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [busyIds, setBusyIds] = useState(() => new Set())
  // Tapping a row opens the user's FriendProfile on top of this sheet.
  // Closing the FriendProfile returns to the FollowList; closing the
  // FollowList from there returns to the Profile / Home view that
  // launched it. Modal stacking via separate document.body portals.
  const [selectedFriend, setSelectedFriend] = useState(null)

  async function loadList() {
    setLoading(true)
    try {
      const res = await api(`/api/follows/list?type=${type}`)
      setUsers(res?.users ?? [])
    } catch (e) {
      console.error('[FollowList.load]', e)
      setUsers([])
    }
    setLoading(false)
  }

  useEffect(() => { loadList() }, [type])

  async function handleFollow(userId) {
    if (busyIds.has(userId)) return
    setBusyIds(prev => new Set(prev).add(userId))
    try {
      // Follow-back goes through the request flow now — the recipient
      // has to accept before mutual-status is real. (2026-05-02 —
      // Matt: "in order for it to be mutual they would then have to
      // follow back.")
      await post('/api/friends/request', { user_id: userId })
      // Optimistic local update — flip has_pending_request true so
      // the button morphs to "Pending". Counts don't change yet —
      // they update when the request is accepted on the other side.
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, has_pending_request: true } : u))
    } catch (e) {
      console.error('[FollowList.followBack]', e)
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(userId); return n })
    }
  }

  async function handleUnfollow(userId) {
    if (busyIds.has(userId)) return
    setBusyIds(prev => new Set(prev).add(userId))
    try {
      await del(`/api/follows/${userId}`)
      // For the 'following' tab, drop the row entirely. For 'followers' /
      // 'mutuals', flip is_following to false (still a row, just demoted).
      if (type === 'following') {
        setUsers(prev => prev.filter(u => u.id !== userId))
      } else {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_following: false } : u))
      }
      onCountsChange?.()
    } catch (e) {
      console.error('[FollowList.unfollow]', e)
    } finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(userId); return n })
    }
  }

  function renderAction(u) {
    const busy = busyIds.has(u.id)
    if (type === 'mutuals') {
      return <MutualBadge />
    }
    if (type === 'following') {
      return (
        <button onClick={() => handleUnfollow(u.id)} disabled={busy} style={ghostBtn}>
          {busy ? '…' : 'Unfollow'}
        </button>
      )
    }
    // followers
    if (u.is_following) {
      // I follow them and they follow me — mutual
      return <MutualBadge />
    }
    if (u.has_pending_request) {
      // I've already sent a follow-back request, waiting for them to accept
      return <PendingBadge />
    }
    return (
      <button onClick={() => handleFollow(u.id)} disabled={busy} style={primaryBtn}>
        {busy ? '…' : 'Follow back'}
      </button>
    )
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end',
      justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430,
        background: 'var(--tm-surface)',
        borderRadius: '20px 20px 0 0',
        maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '12px auto 8px' }} />

        {/* Header */}
        <div style={{
          padding: '4px 20px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(27,94,59,0.10)',
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0D1F12' }}>
            {TITLES[type]}
            <span style={{ fontSize: 13, color: 'rgba(13,31,18,0.45)', marginLeft: 8, fontWeight: 600 }}>
              {users.length}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'rgba(13,31,18,0.55)',
            fontSize: 20, cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {loading && (
            <div style={{ padding: 32, textAlign: 'center', color: 'rgba(13,31,18,0.40)', fontSize: 13 }}>
              Loading…
            </div>
          )}

          {!loading && users.length === 0 && (
            <div style={{ padding: '32px 24px', textAlign: 'center', color: 'rgba(13,31,18,0.55)', fontSize: 13, lineHeight: 1.55 }}>
              {EMPTY_COPY[type]}
            </div>
          )}

          {!loading && users.map(u => (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 20px',
              borderBottom: '1px solid rgba(27,94,59,0.07)',
            }}>
              {/* Tappable area — avatar + name. Opens the user's
                  FriendProfile on top of this sheet. The Action
                  cell to the right captures its own clicks via
                  stopPropagation so Follow / Unfollow doesn't
                  also open the profile. */}
              <button
                onClick={() => setSelectedFriend({ friend_id: u.id, friend_name: u.name })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  flex: 1, minWidth: 0,
                  background: 'transparent', border: 'none',
                  padding: 0, margin: 0, cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: u.avatar ? 'transparent' : 'rgba(27,94,59,0.12)',
                  border: '1px solid rgba(27,94,59,0.15)',
                  overflow: 'hidden', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {u.avatar ? (
                    <img src={u.avatar} alt={u.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#1B5E3B' }}>
                      {u.name?.split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '·'}
                    </span>
                  )}
                </div>

                {/* Name + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0D1F12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.45)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.handicap != null ? `${Number(u.handicap) >= 0 ? '+' : ''}${Number(u.handicap).toFixed(1)} hcp` : ''}
                    {u.home_course ? `${u.handicap != null ? ' · ' : ''}${u.home_course}` : ''}
                  </div>
                </div>
              </button>

              {/* Action — wrapped so its onClick doesn't bubble to the
                  row tap and double-trigger as "open profile + follow." */}
              <div
                style={{ flexShrink: 0 }}
                onClick={e => e.stopPropagation()}
              >
                {renderAction(u)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FriendProfile modal — stacks on top of this sheet via its own
          document.body portal. Closing returns to the FollowList. */}
      {selectedFriend && (
        <FriendProfile
          friend={selectedFriend}
          onClose={() => setSelectedFriend(null)}
        />
      )}
    </div>,
    document.body
  )
}

function MutualBadge() {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: '#1B5E3B',
      background: 'rgba(42,122,56,0.10)', border: '1px solid rgba(42,122,56,0.22)',
      borderRadius: 999, padding: '5px 10px', whiteSpace: 'nowrap',
    }}>Mutual ✓</span>
  )
}

function PendingBadge() {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: '#7A5800',
      background: 'rgba(201,160,64,0.12)', border: '1px solid rgba(201,160,64,0.30)',
      borderRadius: 999, padding: '5px 10px', whiteSpace: 'nowrap',
    }}>Pending</span>
  )
}

const primaryBtn = {
  background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))',
  color: '#fff', border: 'none', borderRadius: 999,
  padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

const ghostBtn = {
  background: 'rgba(13,31,18,0.04)',
  color: 'rgba(13,31,18,0.65)',
  border: '1px solid rgba(13,31,18,0.14)',
  borderRadius: 999,
  padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}
