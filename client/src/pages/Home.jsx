import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api, post, put } from '../lib/api.js'
import { TMEmblem, IconTarget, IconTrophy, IconFlag, IconChevronRight, IconPlus } from '../components/primitives/Icons.jsx'
import FriendProfile from '../components/FriendProfile.jsx'
import PlayerCard from '../components/PlayerCard.jsx'
import FollowPills from '../components/FollowPills.jsx'
import RoundScorecard from '../components/RoundScorecard.jsx'
import RivalryDetail from '../components/RivalryDetail.jsx'
import RoundHistory from '../components/RoundHistory.jsx'
import RivalryHistory from '../components/RivalryHistory.jsx'
// Helpers from Stats.jsx — used by the Profile view that replaced the
// Stats tab on 2026-05-01. Stats.jsx still exists as a standalone page
// but is no longer in the bottom nav; Profile is the canonical surface.
// (HcpBadge now embeds the score-trend chart directly so MiniTrendBar
// is no longer needed here.)
import { HcpBadge, StatTile } from './Stats.jsx'

// ─── Season helpers ───────────────────────────────────────────────────────────
function currentSeasonYear() {
  return new Date().getFullYear()
}

// ─── Season banner messages (funny, lighthearted) ─────────────────────────────
const SEASON_BANNERS = [
  "The fairways missed you. The rough? Less so.",
  "Winter is over. Your excuses are not.",
  "Your handicap didn't improve over winter. Shocking.",
  "The birds are back. The bogeys too, probably.",
  "New season, same swing faults. Let's go.",
  "Golf season is back. Your employer is devastated.",
  "You survived another winter. The course survived you.",
  "May 1st: the most wonderful day in sports medicine.",
]
const randomBanner = () => SEASON_BANNERS[Math.floor(Math.random() * SEASON_BANNERS.length)]

// ─── Tiny calendar helpers ────────────────────────────────────────────────────
function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function firstDayOfMonth(year, month) { return new Date(year, month, 1).getDay() }
function toYMD(date) { return date.toISOString().slice(0, 10) }
function todayYMD() { return toYMD(new Date()) }

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProfileHeroCard({ user, season, avg3, streak, followCounts, onCountsChange, onStartSeason, onEditProfile, onOpenCard }) {
  const seasonBanner = season && !season.seasonStarted && season.year === currentSeasonYear()
  const [banner] = useState(randomBanner)

  // Golf handicap display: high cap = "17.0" (no prefix); plus cap = "+3.5"
  // (sign for scratch-or-better). Coerce — NUMERIC(4,1) arrives as string.
  const hcpNum = user?.handicap == null ? null : Number(user.handicap)
  const handicapDisplay = !Number.isFinite(hcpNum)
    ? '—'
    : hcpNum >= 0
      ? hcpNum.toFixed(1)
      : `+${Math.abs(hcpNum).toFixed(1)}`

  return (
    <div style={{
      borderRadius: 22,
      overflow: 'hidden',
      background: 'rgba(255,255,255,0.22)',
      border: '1px solid rgba(255,255,255,0.45)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      position: 'relative',
      marginBottom: 16,
    }}>
      {/* Top gold accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3, pointerEvents: 'none',
        background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.7), rgba(232,192,90,1.0), rgba(201,160,64,0.7), transparent)',
      }} />
      {/* Radial gold glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(201,160,64,0.07) 0%, transparent 70%)',
      }} />

      {/* New season banner */}
      {seasonBanner && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(197,160,64,0.15), rgba(197,160,64,0.08))',
          borderBottom: '1px solid rgba(197,160,64,0.2)',
          padding: '12px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#7A5800', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              SEASON {season.year} IS HERE
            </div>
            <div style={{ color: 'rgba(13,31,18,0.55)', fontSize: 12, lineHeight: 1.4 }}>{banner}</div>
          </div>
          <button onClick={onStartSeason} style={{
            background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
            color: '#070C09', border: 'none', borderRadius: 10, padding: '8px 14px',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}>Let's Go</button>
        </div>
      )}

      {/* Main profile content */}
      <div style={{ padding: '20px 20px 16px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>

          {/* Player card thumbnail */}
          <div
            onClick={onOpenCard}
            style={{
              flexShrink: 0, width: 52, height: 72, borderRadius: 10, overflow: 'hidden',
              border: user?.avatar
                ? '1px solid rgba(201,160,64,0.45)'
                : '1px dashed rgba(27,94,59,0.25)',
              background: user?.avatar ? 'transparent' : 'rgba(27,94,59,0.04)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: user?.avatar ? '0 2px 12px rgba(0,0,0,0.15)' : 'none',
              marginTop: 2,
            }}
          >
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt="Player card"
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%' }}
              />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(27,94,59,0.30)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/>
                <circle cx="9" cy="9" r="2"/>
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
              </svg>
            )}
          </div>

          {/* Left: name + course */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#1B5E3B', fontSize: 12, letterSpacing: '0.1em', fontWeight: 800, marginBottom: 4 }}>
              SEASON {season?.year ?? currentSeasonYear()}
            </div>
            <div style={{
              fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em',
              lineHeight: 1.1, marginBottom: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              background: 'linear-gradient(135deg, #A07828, #C9A040, #E8C05A)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>{user?.name ?? '—'}</div>
            {user?.home_course ? (
              <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                {user.home_course}
              </div>
            ) : (
              <button onClick={onEditProfile} style={{
                background: 'none', border: 'none', color: 'rgba(122,88,0,0.7)',
                fontSize: 12, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span>+ Add home course</span>
              </button>
            )}
          </div>

          {/* Right: handicap badge */}
          <div style={{
            textAlign: 'center', flexShrink: 0,
            background: 'rgba(201,160,64,0.08)', borderRadius: 12, padding: '8px 12px',
            border: '1px solid rgba(201,160,64,0.25)',
          }}>
            <div style={{
              fontSize: user?.handicap != null ? 32 : 22, fontWeight: 900, lineHeight: 1,
              background: 'linear-gradient(135deg, #A07828, #C9A040, #E8C05A)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              minWidth: 44, display: 'block',
            }}>{handicapDisplay}</div>
            <div style={{ color: 'rgba(122,88,0,0.55)', fontSize: 8, letterSpacing: '0.12em', marginTop: 3 }}>HCP INDEX</div>
          </div>
        </div>

        {/* Follow pills — same Following / Followers / Mutuals as the
            Profile view, just compact (size='sm'). Tappable; opens
            FollowList overlay. (2026-05-01) */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(27,94,59,0.10)' }}>
          <FollowPills counts={followCounts} size="sm" onCountsChange={onCountsChange} />
        </div>

        {/* Season stats row */}
        <div style={{ display: 'flex', marginTop: 12, borderTop: '1px solid rgba(27,94,59,0.10)', paddingTop: 14 }}>
          {[
            { label: 'WINS', value: season?.wins ?? 0, color: '#1B5E3B' },
            { label: 'LOSSES', value: season?.losses ?? 0, color: '#DC2626' },
            { label: 'TIES', value: season?.ties ?? 0, color: 'rgba(13,31,18,0.45)' },
            { label: '3-RND AVG', value: avg3 != null ? avg3 : '—', color: '#7A5800' },
          ].map(({ label, value, color }, i) => (
            <div key={label} style={{
              flex: 1, textAlign: 'center',
              borderRight: i < 3 ? '1px solid rgba(27,94,59,0.08)' : 'none',
              padding: '0 4px',
            }}>
              <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
              <div style={{ fontSize: 9, color: 'rgba(13,31,18,0.35)', letterSpacing: '0.09em', marginTop: 5, fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Streak */}
        {streak > 0 && (
          <div style={{
            marginTop: 10, display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(201,160,64,0.08)', border: '1px solid rgba(201,160,64,0.22)', borderRadius: 10, padding: '8px 14px',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#C9A040" stroke="none"><path d="M12 2c0 0-5 5.5-5 10a5 5 0 0 0 10 0c0-4.5-5-10-5-10zm0 13a2 2 0 0 1-2-2c0-2 2-5 2-5s2 3 2 5a2 2 0 0 1-2 2z"/></svg>
            <span style={{ color: '#7A5800', fontSize: 12, fontWeight: 600 }}>
              {streak}-week streak — you're locked in
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Friends Panel ────────────────────────────────────────────────────────────
function FriendsPanel({ friends, incoming, outgoing, activity, onRespond, onAddFriend, onSelectFriend }) {
  const [addEmail, setAddEmail] = useState('')
  const [addState, setAddState] = useState('idle') // idle | loading | ok | err
  const [addMsg, setAddMsg] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  async function handleAdd(e) {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAddState('loading')
    try {
      const res = await post('/api/friends/request', { email: addEmail.trim().toLowerCase() })
      if (res.ok) { setAddState('ok'); setAddMsg(`Request sent to ${res.name}!`); setAddEmail('') }
      else { setAddState('err'); setAddMsg(res.error ?? 'Failed') }
    } catch { setAddState('err'); setAddMsg('Failed to send request') }
    setTimeout(() => { setAddState('idle'); setAddMsg('') }, 3000)
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{
          color: '#1B5E3B', fontSize: 12, letterSpacing: '0.1em', fontWeight: 800,
          background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
          textShadow: '0 1px 1px rgba(255,255,255,0.4)',
        }}>PLAYING PARTNERS</div>
        <button onClick={() => onAddFriend ? onAddFriend() : setShowAdd(v => !v)} style={{
          background: 'rgba(27,94,59,0.06)',
          border: '1px solid rgba(27,94,59,0.14)', borderRadius: 8,
          color: '#1B5E3B', fontSize: 11, padding: '5px 10px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add
        </button>
      </div>

      {/* Add friend form */}
      {showAdd && (
        <form onSubmit={handleAdd} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={addEmail} onChange={e => setAddEmail(e.target.value)}
              placeholder="Friend's email…" type="email"
              style={{
                flex: 1, background: 'rgba(27,94,59,0.04)', border: '1px solid rgba(27,94,59,0.15)',
                borderRadius: 10, color: '#0D1F12', padding: '10px 14px', fontSize: 13,
                outline: 'none',
              }}
            />
            <button type="submit" disabled={addState === 'loading'} style={{
              background: 'linear-gradient(135deg, #F5D78A, #C9A040)', color: '#070C09',
              border: 'none', borderRadius: 10, padding: '0 16px', fontSize: 13, fontWeight: 700,
              cursor: 'pointer',
            }}>{addState === 'loading' ? '…' : 'Send'}</button>
          </div>
          {addMsg && (
            <div style={{ marginTop: 6, fontSize: 12, color: addState === 'ok' ? '#C9A040' : '#F87171' }}>{addMsg}</div>
          )}
        </form>
      )}

      {/* Pending incoming requests */}
      {incoming.map(req => (
        <div key={req.id} style={{
          background: 'rgba(255,255,255,0.88)', border: '1px solid rgba(27,94,59,0.10)',
          borderRadius: 12, padding: '10px 14px', marginBottom: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div style={{ color: '#C9A040', fontSize: 13, fontWeight: 700 }}>{req.requester_name}</div>
            <div style={{ color: 'rgba(27,94,59,0.50)', fontSize: 11 }}>wants to be your playing partner</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => onRespond(req.id, 'accepted')} style={{
              background: '#1B5E3B', color: '#FFFFFF', border: 'none', borderRadius: 8,
              padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>Accept</button>
            <button onClick={() => onRespond(req.id, 'declined')} style={{
              background: 'rgba(13,31,18,0.06)', color: 'rgba(13,31,18,0.45)',
              border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
            }}>✕</button>
          </div>
        </div>
      ))}

      {/* Outgoing pending friend requests */}
      {outgoing && outgoing.length > 0 && outgoing.map(req => (
        <div key={req.id} style={{
          background: 'rgba(255,255,255,0.88)', border: '1px solid rgba(27,94,59,0.10)',
          borderRadius: 12, padding: '10px 14px', marginBottom: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div style={{ color: '#C9A040', fontSize: 13, fontWeight: 700 }}>{req.requestee_name}</div>
            <div style={{ color: 'rgba(27,94,59,0.50)', fontSize: 11 }}>Request sent</div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
            color: '#7A5800',
            background: 'rgba(201,160,64,0.12)', borderRadius: 6, padding: '3px 8px',
          }}>PENDING</span>
        </div>
      ))}

      {/* Friends list with activity */}
      {friends.length === 0 && incoming.length === 0 && (!outgoing || outgoing.length === 0) && (
        <div style={{
          textAlign: 'center', padding: '28px 20px 24px',
          background: 'rgba(255,255,255,0.88)', borderRadius: 14,
          border: '1px dashed rgba(27,94,59,0.20)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⛳</div>
          <div style={{ color: '#0D1F12', fontSize: 14, fontWeight: 700, marginBottom: 4 }}>No playing partners yet</div>
          <div style={{ color: 'rgba(13,31,18,0.55)', fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
            Add a friend to track their rounds, see their availability, and challenge them to a match.
          </div>
          <button onClick={() => onAddFriend ? onAddFriend() : setShowAdd(true)} style={{
            background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
            color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 10,
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(46,158,69,0.25)',
          }}>+ Find a friend</button>
        </div>
      )}

      {friends.map(f => {
        const act = activity.find(a => String(a.user_id) === String(f.friend_id))
        const diff = act ? act.total - (act.course_par || 72) : null
        const diffStr = diff == null ? null : diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff)
        const diffColor = diff == null ? null : diff < 0 ? '#1B5E3B' : diff > 0 ? '#DC2626' : '#7A5800'
        const hcp = f.friend_handicap != null ? (f.friend_handicap > 0 ? `+${f.friend_handicap}` : String(f.friend_handicap)) : null
        return (
          <div key={f.id} onClick={() => onSelectFriend?.(f)} style={{
            background: 'rgba(255,255,255,0.88)', border: '1px solid rgba(27,94,59,0.10)',
            borderRadius: 12, padding: '12px 14px', marginBottom: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            cursor: 'pointer', transition: 'background 0.15s',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#C9A040', fontSize: 14, fontWeight: 700 }}>{f.friend_name}</span>
                {hcp && <span style={{ color: '#7A5800', fontSize: 11, fontWeight: 600 }}>HCP {hcp}</span>}
              </div>
              {act ? (
                <div style={{ color: 'rgba(13,31,18,0.45)', fontSize: 11, marginTop: 2 }}>
                  Last round: {act.course_name} · {new Date(act.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                </div>
              ) : (
                <div style={{ color: 'rgba(13,31,18,0.30)', fontSize: 11, marginTop: 2 }}>No rounds yet</div>
              )}
              {f.friend_home_course && (
                <div style={{ color: 'rgba(13,31,18,0.38)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  {f.friend_home_course}
                </div>
              )}
            </div>
            {act && diffStr && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: diffColor }}>{diffStr}</div>
                <div style={{ color: 'rgba(13,31,18,0.35)', fontSize: 10 }}>last round</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}


// ─── Day Sheet ────────────────────────────────────────────────────────────────
function DaySheet({ ymd, isMine, friends, onClose, onToggleFree, toggling, onScheduleGroup }) {
  const [sent, setSent] = useState({})   // { [user_id]: 'sending'|'sent'|'error' }
  const label = new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  async function requestPlay(f) {
    const uid = f.user_id
    setSent(s => ({ ...s, [uid]: 'sending' }))
    try {
      await post('/api/games', {
        date: ymd,
        request_type: 'availability_match',
        invitee_ids: [uid],
      })
      setSent(s => ({ ...s, [uid]: 'sent' }))
    } catch {
      setSent(s => ({ ...s, [uid]: 'error' }))
    }
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #FFFFFF, #F8F5EF)',
        border: '1px solid rgba(27,94,59,0.12)',
        borderRadius: '22px 22px 0 0',
        padding: '20px 20px 48px',
      }} onClick={e => e.stopPropagation()}>

        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(27,94,59,0.14)', margin: '0 auto 18px' }} />

        {/* Date */}
        <div style={{ color: '#0D1F12', fontSize: 17, fontWeight: 700, marginBottom: 16 }}>{label}</div>

        {/* Your status */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: isMine ? 'rgba(27,94,59,0.08)' : 'rgba(27,94,59,0.03)',
          border: `1px solid ${isMine ? 'rgba(27,94,59,0.22)' : 'rgba(27,94,59,0.10)'}`,
          borderRadius: 12, padding: '12px 14px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isMine ? '#1B5E3B' : 'rgba(13,31,18,0.18)',
            }} />
            <span style={{ color: isMine ? '#1B5E3B' : 'rgba(13,31,18,0.45)', fontSize: 13, fontWeight: 600 }}>
              {isMine ? "You're free this day" : "You haven't marked this day"}
            </span>
          </div>
          <button
            onClick={() => onToggleFree(ymd)}
            disabled={toggling === ymd}
            style={{
              background: isMine ? 'rgba(220,38,38,0.08)' : 'rgba(27,94,59,0.12)',
              border: `1px solid ${isMine ? 'rgba(220,38,38,0.22)' : 'rgba(27,94,59,0.25)'}`,
              borderRadius: 8, color: isMine ? '#DC2626' : '#1B5E3B',
              fontSize: 11, fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
            }}
          >{toggling === ymd ? '…' : isMine ? 'Mark busy' : 'Mark free'}</button>
        </div>

        {/* Friends available */}
        {friends.length === 0 ? (
          <div style={{ color: 'rgba(13,31,18,0.32)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
            No friends free this day yet
          </div>
        ) : (
          <>
            <div style={{ color: 'rgba(13,31,18,0.45)', fontSize: 11, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>
              FRIENDS AVAILABLE
            </div>
            {friends.map(f => {
              const uid = f.user_id
              const state = sent[uid]
              return (
                <div key={uid} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 0', borderBottom: '1px solid rgba(27,94,59,0.08)', gap: 10,
                }}>
                  <div>
                    <div style={{ color: '#0D1F12', fontSize: 14, fontWeight: 600 }}>{f.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#1B5E3B' }} />
                      <span style={{ color: 'rgba(27,94,59,0.65)', fontSize: 11 }}>Free this day</span>
                    </div>
                  </div>
                  {state === 'sent' ? (
                    <span style={{
                      color: '#1B5E3B', fontSize: 11, fontWeight: 600,
                      background: 'rgba(27,94,59,0.08)', borderRadius: 8, padding: '6px 12px',
                    }}>Sent</span>
                  ) : state === 'error' ? (
                    <span style={{ color: '#DC2626', fontSize: 11 }}>Failed</span>
                  ) : (
                    <button onClick={() => requestPlay(f)} disabled={state === 'sending'} style={{
                      background: 'rgba(27,94,59,0.08)',
                      border: '1px solid rgba(27,94,59,0.25)',
                      borderRadius: 9, color: '#1B5E3B',
                      fontSize: 12, fontWeight: 600, padding: '7px 14px', cursor: 'pointer',
                      opacity: state === 'sending' ? 0.5 : 1,
                    }}>{state === 'sending' ? '…' : 'Request to Play'}</button>
                  )}
                </div>
              )
            })}
          </>
        )}

        {/* Schedule group game button */}
        <button onClick={onScheduleGroup} style={{
          width: '100%', marginTop: 16, padding: '12px',
          background: 'linear-gradient(135deg, rgba(201,160,64,0.12), rgba(201,160,64,0.06))',
          border: '1px solid rgba(201,160,64,0.28)',
          borderRadius: 12, color: '#F5D78A', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', letterSpacing: '0.03em',
        }}>Schedule a Group Match</button>
      </div>
    </div>,
    document.body
  )
}

// ─── Availability Calendar ────────────────────────────────────────────────────
function AvailabilityCalendar({ uid, onScheduleGame }) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [mine, setMine] = useState([])
  const [friendsAvail, setFriendsAvail] = useState([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)

  const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api(`/api/availability?month=${monthKey}`)
      setMine((data.mine ?? []).map(r => r.date.slice(0, 10)))
      setFriendsAvail(data.friends ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [monthKey])

  useEffect(() => { load() }, [load])

  async function toggleDate(ymd) {
    setToggling(ymd)
    try {
      await post('/api/availability', { date: ymd })
      setMine(prev => prev.includes(ymd) ? prev.filter(d => d !== ymd) : [...prev, ymd])
    } catch { /* ignore */ }
    setToggling(null)
  }

  const days = daysInMonth(viewYear, viewMonth)
  const firstDay = firstDayOfMonth(viewYear, viewMonth)
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  function friendsOnDate(ymd) {
    return friendsAvail.filter(f => f.date?.slice(0, 10) === ymd)
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        color: '#1B5E3B', fontSize: 12, letterSpacing: '0.1em', fontWeight: 800,
        marginBottom: 10,
        background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
        display: 'inline-block', textShadow: '0 1px 1px rgba(255,255,255,0.4)',
      }}>
        AVAILABILITY CALENDAR
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.88)', border: '1px solid rgba(27,94,59,0.10)',
        borderRadius: 16, overflow: 'hidden',
      }}>
        {/* Month navigation */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid rgba(27,94,59,0.10)',
        }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: 'rgba(27,94,59,0.45)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>‹</button>
          <span style={{ color: '#1B5E3B', fontSize: 13, fontWeight: 700 }}>{monthName}</span>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: 'rgba(27,94,59,0.45)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>›</button>
        </div>

        {/* Day labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '8px 8px 0' }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', color: 'rgba(27,94,59,0.40)', fontSize: 10, paddingBottom: 4 }}>{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, padding: '0 8px 10px' }}>
          {cells.map((day, i) => {
            if (!day) return <div key={`e${i}`} />
            const ymd = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const isToday = ymd === todayYMD()
            const isMine = mine.includes(ymd)
            const friends = friendsOnDate(ymd)
            const hasFriend = friends.length > 0
            const isPast = new Date(ymd) < new Date(todayYMD())

            return (
              <button key={ymd} onClick={() => !isPast && setSelectedDay(ymd)}
                disabled={isPast}
                style={{
                  position: 'relative',
                  aspectRatio: '1', border: 'none', borderRadius: 8, cursor: isPast ? 'default' : 'pointer',
                  background: isMine
                    ? 'linear-gradient(135deg, rgba(201,160,64,0.30), rgba(201,160,64,0.15))'
                    : hasFriend
                      ? 'rgba(27,94,59,0.06)'
                      : 'transparent',
                  outline: isToday ? '2px solid rgba(201,160,64,0.6)' : 'none',
                  color: isPast ? 'rgba(27,94,59,0.20)' : isMine ? '#7A5800' : '#0D1F12',
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  transition: 'background 0.15s',
                  padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: 1,
                }}
              >
                {day}
                {hasFriend && !isPast && (
                  <div style={{
                    width: 4, height: 4, borderRadius: '50%',
                    background: isMine ? '#C9A040' : '#1B5E3B',
                    position: 'absolute', bottom: 3,
                  }} />
                )}
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 14, padding: '8px 16px 12px',
          borderTop: '1px solid rgba(27,94,59,0.08)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(201,160,64,0.35)' }} />
            <span style={{ color: 'rgba(27,94,59,0.50)', fontSize: 10 }}>You're free</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#1B5E3B' }} />
            <span style={{ color: 'rgba(27,94,59,0.50)', fontSize: 10 }}>Friends available</span>
          </div>
        </div>
      </div>

      {/* Day Sheet — opens when a day is tapped */}
      {selectedDay && (
        <DaySheet
          ymd={selectedDay}
          isMine={mine.includes(selectedDay)}
          friends={friendsOnDate(selectedDay)}
          toggling={toggling}
          onClose={() => setSelectedDay(null)}
          onScheduleGroup={() => { setSelectedDay(null); onScheduleGame?.(selectedDay) }}
          onToggleFree={async (ymd) => {
            setToggling(ymd)
            try {
              await post('/api/availability', { date: ymd })
              setMine(prev => prev.includes(ymd) ? prev.filter(d => d !== ymd) : [...prev, ymd])
            } catch { /* ignore */ }
            setToggling(null)
          }}
        />
      )}
    </div>
  )
}


// ─── Upcoming Tee Times ───────────────────────────────────────────────────────
function PlanSheet({ game, onClose, onCourseSaved }) {
  const [course, setCourse] = useState(game.course_name || '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!course.trim()) return
    setSaving(true)
    try {
      await put(`/api/games/${game.id}/course`, { course_name: course.trim() })
      onCourseSaved(game.id, course.trim())
      onClose()
    } catch { /* ignore */ }
    setSaving(false)
  }

  const dateLabel = new Date(game.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
  const isMatch = game.request_type === 'availability_match'
  const others = (game.participants || []).filter(p => p.status === 'accepted')

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #FFFFFF, #F8F5EF)',
        border: '1px solid rgba(27,94,59,0.12)',
        borderRadius: '22px 22px 0 0', padding: '20px 20px 48px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(27,94,59,0.14)', margin: '0 auto 20px' }} />

        {/* Game summary */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
              color: isMatch ? '#C9A040' : '#F5D78A',
              background: isMatch ? 'rgba(201,160,64,0.1)' : 'rgba(245,215,138,0.1)',
              borderRadius: 5, padding: '2px 7px',
            }}>{isMatch ? 'CALENDAR MATCH' : 'TEE TIME'}</span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginBottom: 8 }}>{dateLabel}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {others.map(p => (
              <span key={p.user_id} style={{
                background: 'rgba(255,255,255,0.07)', borderRadius: 20,
                padding: '3px 10px', color: 'rgba(255,255,255,0.7)', fontSize: 12,
              }}>{p.name}</span>
            ))}
          </div>
        </div>

        {/* Course input */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 8 }}>
            {game.course_name ? 'CHANGE COURSE' : 'SET COURSE'}
          </div>
          <input
            autoFocus
            value={course}
            onChange={e => setCourse(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="e.g. Augusta National"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, color: '#fff', padding: '13px 16px', fontSize: 15, outline: 'none',
            }}
          />
        </div>

        <button onClick={save} disabled={saving || !course.trim()} style={{
          width: '100%', padding: '14px',
          background: course.trim() ? 'linear-gradient(135deg, #F5D78A, #C9A040)' : 'rgba(255,255,255,0.07)',
          color: course.trim() ? '#070C09' : 'rgba(255,255,255,0.3)',
          border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
          cursor: course.trim() ? 'pointer' : 'default', transition: 'all 0.15s',
        }}>{saving ? 'Saving…' : 'Lock It In'}</button>
      </div>
    </div>,
    document.body
  )
}

function UpcomingTeeTimes({ games, sentRequests = [], onPlan, onRefresh, onCreateMatch, onSelectFriend, userId }) {
  const [broadcasting, setBroadcasting] = useState({}) // { [gameId]: 'sending'|'sent' }
  if ((!games || games.length === 0) && sentRequests.length === 0) return null

  async function broadcast(g) {
    setBroadcasting(s => ({ ...s, [g.id]: 'sending' }))
    try {
      await post(`/api/games/${g.id}/broadcast`, {})
      setBroadcasting(s => ({ ...s, [g.id]: 'sent' }))
      onRefresh?.()
    } catch {
      setBroadcasting(s => ({ ...s, [g.id]: null }))
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          color: '#1B5E3B', fontSize: 12, letterSpacing: '0.1em', fontWeight: 800,
          background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
          textShadow: '0 1px 1px rgba(255,255,255,0.4)',
        }}>
          UPCOMING TEE TIMES
        </div>
        <span style={{
          background: '#1B5E3B', color: '#FFFFFF',
          borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px',
        }}>{games.length + sentRequests.length}</span>
      </div>

      {/* Per-card "#N of M" counter when multiple same-day matches lack
          start_time. Time-of-day is the primary disambiguator post-
          migration-005; this is the legacy-row fallback. (F-R6A) */}
      {games.map((g, gIdx, gArr) => {
        const dateLabel = new Date(g.date + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
        })
        // Time of day in 12-hour format with AM/PM. NULL → no suffix
        // (legacy matches predating migration 005 don't have one).
        const timeLabel = g.start_time
          ? new Date(`2000-01-01T${g.start_time}:00`).toLocaleTimeString('en-US', {
              hour: 'numeric', minute: '2-digit',
            })
          : null
        // Same-date counter — only useful when there are 2+ matches on
        // the same day AND none of them has a time set (otherwise time
        // is the disambiguator).
        const sameDayMatches = gArr.filter(x => x.date === g.date)
        const sameDayPos = sameDayMatches.findIndex(x => x.id === g.id) + 1
        const showCounter = sameDayMatches.length > 1 && !timeLabel
        const isMatch      = g.request_type === 'availability_match'
        const accepted     = (g.participants || []).filter(p => p.status === 'accepted')
        const pending      = (g.participants || []).filter(p => p.status === 'pending')
        const spotsOpen    = Math.max(0, 4 - accepted.length)
        const bState       = broadcasting[g.id]
        const alreadyBroadcast = g.broadcast
        const isOrganizer  = String(g.created_by) === String(userId)

        return (
          <div key={g.id} style={{
            background: 'rgba(255,255,255,0.88)',
            border: '1px solid rgba(27,94,59,0.10)',
            borderRadius: 14, padding: '14px 16px', marginBottom: 8,
          }}>
            {/* Top row: date + time + badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ color: '#1B5E3B', fontSize: 13, fontWeight: 700 }}>{dateLabel}</div>
                {timeLabel && (
                  <div style={{ color: '#C9A040', fontSize: 13, fontWeight: 700 }}>· {timeLabel}</div>
                )}
                {showCounter && (
                  <div style={{ color: 'rgba(13,31,18,0.45)', fontSize: 11, fontWeight: 600 }}>· #{sameDayPos} of {sameDayMatches.length}</div>
                )}
              </div>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                color: isMatch ? '#1B5E3B' : '#7A5800',
                background: isMatch ? 'rgba(27,94,59,0.08)' : 'rgba(201,160,64,0.10)',
                borderRadius: 5, padding: '2px 8px',
              }}>{isMatch ? 'CALENDAR' : 'TEE TIME'}</span>
            </div>

            {/* Players */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {accepted.map(p => (
                <div
                  key={p.user_id}
                  onClick={() => String(p.user_id) !== String(userId) && onSelectFriend?.({ ...p, friend_id: p.user_id })}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: '#FFFFFF', borderRadius: 20, padding: '4px 10px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                    cursor: String(p.user_id) !== String(userId) ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#C9A040' }} />
                  <span style={{ color: '#C9A040', fontSize: 12, fontWeight: 700 }}>{p.name}</span>
                  {p.handicap != null && (
                    <span style={{ color: 'rgba(201,160,64,0.65)', fontSize: 10 }}>
                      {p.handicap > 0 ? `+${p.handicap}` : p.handicap}
                    </span>
                  )}
                </div>
              ))}
              {pending.map(p => (
                <div key={p.user_id} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: '#FFFFFF', borderRadius: 20, padding: '4px 10px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                }}>
                  <span style={{ color: '#C9A040', fontSize: 12, fontWeight: 700 }}>{p.name}</span>
                  <span style={{ color: 'rgba(27,94,59,0.45)', fontSize: 10 }}>pending</span>
                </div>
              ))}
              {/* Empty spot slots */}
              {spotsOpen > 0 && Array.from({ length: spotsOpen }).map((_, i) => (
                <div key={`open-${i}`} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: '#FFFFFF', borderRadius: 20, padding: '4px 10px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                }}>
                  <span style={{ color: 'rgba(27,94,59,0.45)', fontSize: 12 }}>Open spot</span>
                </div>
              ))}
            </div>

            {/* Course + action row */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              paddingTop: 10, borderTop: '1px solid rgba(27,94,59,0.08)', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(27,94,59,0.45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                <span style={{ color: g.course_name ? 'rgba(13,31,18,0.60)' : 'rgba(13,31,18,0.28)', fontSize: 12 }}>
                  {g.course_name || 'No course set'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {/* Need X button — only show if organizer and spots open */}
                {isOrganizer && spotsOpen > 0 && (
                  bState === 'sent' || alreadyBroadcast ? (
                    <span style={{
                      fontSize: 11, color: 'rgba(197,160,64,0.6)',
                      background: 'rgba(197,160,64,0.08)', borderRadius: 8,
                      padding: '5px 10px', border: '1px solid rgba(197,160,64,0.15)',
                    }}>Sent to friends</span>
                  ) : (
                    <button
                      onClick={() => broadcast(g)}
                      disabled={bState === 'sending'}
                      style={{
                        background: 'rgba(201,160,64,0.10)',
                        border: '1px solid rgba(201,160,64,0.35)',
                        borderRadius: 8, color: '#7A5800',
                        fontSize: 11, fontWeight: 700, padding: '5px 12px', cursor: 'pointer',
                        opacity: bState === 'sending' ? 0.5 : 1,
                      }}
                    >
                      {bState === 'sending' ? '…' : `Need ${spotsOpen}`}
                    </button>
                  )
                )}
                {/* Create Match — only when 2+ accepted players */}
                {accepted.length >= 2 && onCreateMatch && (
                  <button
                    onClick={() => onCreateMatch(accepted.filter(p => String(p.user_id) !== String(userId)))}
                    style={{
                      background: 'rgba(201,160,64,0.10)',
                      border: '1px solid rgba(201,160,64,0.35)',
                      borderRadius: 8, color: '#7A5800',
                      fontSize: 11, fontWeight: 700, padding: '5px 12px', cursor: 'pointer',
                    }}
                  >Create Match</button>
                )}
                <button onClick={() => onPlan(g)} style={{
                  background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.16)',
                  borderRadius: 8, color: '#1B5E3B', fontSize: 11, fontWeight: 600,
                  padding: '5px 12px', cursor: 'pointer',
                }}>{g.course_name ? 'Change' : 'Set Course'}</button>
              </div>
            </div>
          </div>
        )
      })}

      {/* Sent tee time requests (outgoing, pending reply) */}
      {sentRequests.map(tr => {
        const dateLabel = new Date(tr.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        return (
          <div key={`sent-${tr.id}`} style={{
            background: 'rgba(255,255,255,0.88)',
            border: '1px dashed rgba(201,160,64,0.55)',
            borderRadius: 14, padding: '14px 16px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                color: '#7A5800', background: 'rgba(201,160,64,0.10)',
                borderRadius: 5, padding: '2px 7px',
              }}>WAITING FOR REPLY</span>
              <span style={{ color: '#7A5800', fontSize: 12, fontWeight: 600 }}>{dateLabel}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              <span style={{ color: '#C9A040' }}>{tr.to_name}</span>
              <span style={{ color: 'rgba(27,94,59,0.45)', fontSize: 12, fontWeight: 400 }}> hasn't responded yet</span>
            </div>
            {tr.course_name && <div style={{ color: 'rgba(13,31,18,0.40)', fontSize: 12 }}>{tr.course_name}</div>}
          </div>
        )
      })}
    </div>
  )
}

// ─── Tee Time Inbox ───────────────────────────────────────────────────────────
function GameInbox({ games, teeRequests = [], onRespond, onRespondTeeRequest }) {
  const { incoming } = games
  const totalCount = (incoming?.length ?? 0) + teeRequests.length
  if (totalCount === 0) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 11, letterSpacing: '0.1em', fontWeight: 600, marginBottom: 10 }}>
        INVITES
        <span style={{
          marginLeft: 8, background: '#C9A040', color: '#FFFFFF',
          borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px',
        }}>{totalCount}</span>
      </div>

      {/* Incoming tee time requests (from availability system) */}
      {teeRequests.map(tr => {
        const dateLabel = new Date(tr.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        return (
          <div key={`tr-${tr.id}`} style={{
            background: 'rgba(255,255,255,0.88)',
            border: '1px solid rgba(201,160,64,0.40)',
            borderRadius: 14, padding: '14px 16px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                color: '#7A5800', background: 'rgba(201,160,64,0.10)',
                borderRadius: 5, padding: '2px 7px',
              }}>TEE TIME REQUEST</span>
              <span style={{ color: '#7A5800', fontSize: 12, fontWeight: 600 }}>{dateLabel}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              <span style={{ color: '#C9A040' }}>{tr.from_name}</span>
              <span style={{ color: 'rgba(27,94,59,0.45)', fontSize: 12, fontWeight: 400 }}> wants to play</span>
            </div>
            {tr.course_name && <div style={{ color: 'rgba(13,31,18,0.45)', fontSize: 12, marginBottom: 6 }}>{tr.course_name}</div>}
            {tr.message && <div style={{ color: 'rgba(13,31,18,0.40)', fontSize: 12, fontStyle: 'italic', marginBottom: 8 }}>"{tr.message}"</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onRespondTeeRequest?.(tr.id, 'accepted')} style={{
                flex: 1, background: '#1B5E3B', color: '#FFFFFF', border: 'none',
                borderRadius: 10, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Accept</button>
              <button onClick={() => onRespondTeeRequest?.(tr.id, 'declined')} style={{
                background: 'rgba(13,31,18,0.05)', color: 'rgba(13,31,18,0.45)',
                border: '1px solid rgba(13,31,18,0.12)',
                borderRadius: 10, padding: '9px 16px', fontSize: 13, cursor: 'pointer',
              }}>Decline</button>
            </div>
          </div>
        )
      })}

      {incoming.map(g => {
        const isMatch = g.request_type === 'availability_match'
        const dateLabel = new Date(g.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        const others = (g.participants || []).filter(p => p.user_id !== g.created_by || g.participants.length === 1)
        const accepted = (g.participants || []).filter(p => p.status === 'accepted')
        const pending  = (g.participants || []).filter(p => p.status === 'pending')

        const isBroadcast = g.broadcast
        const spotsOpen  = Math.max(0, 4 - accepted.length)

        return (
          <div key={g.id} style={{
            background: 'rgba(255,255,255,0.88)',
            border: `1px solid ${isBroadcast ? 'rgba(201,160,64,0.40)' : 'rgba(27,94,59,0.10)'}`,
            borderRadius: 14, padding: '14px 16px', marginBottom: 8,
          }}>
            {/* Header: badge + date */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                color: isBroadcast ? '#7A5800' : isMatch ? '#1B5E3B' : '#7A5800',
                background: isBroadcast ? 'rgba(201,160,64,0.10)' : isMatch ? 'rgba(27,94,59,0.08)' : 'rgba(201,160,64,0.10)',
                borderRadius: 5, padding: '2px 7px',
              }}>
                {isBroadcast ? `OPEN SPOT · NEED ${spotsOpen}` : isMatch ? 'CALENDAR MATCH' : 'TEE TIME REQUEST'}
              </span>
              <span style={{ color: isBroadcast ? '#7A5800' : '#1B5E3B', fontSize: 12, fontWeight: 600 }}>
                {dateLabel}
              </span>
            </div>

            {/* Organizer line */}
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              <span style={{ color: '#C9A040' }}>{g.organizer_name}</span>
              <span style={{ color: 'rgba(27,94,59,0.45)', fontSize: 12, fontWeight: 400 }}>
                {isBroadcast ? ` is looking for ${spotsOpen} more` : ' invited you'}
              </span>
            </div>

            {/* Players */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
              {accepted.map(p => (
                <span key={p.user_id} style={{
                  background: '#FFFFFF', borderRadius: 20, padding: '3px 9px',
                  color: '#C9A040', fontSize: 11, fontWeight: 700,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                }}>{p.name}</span>
              ))}
              {isBroadcast && spotsOpen > 0 && Array.from({ length: spotsOpen }).map((_, i) => (
                <span key={`open-${i}`} style={{
                  background: '#FFFFFF', borderRadius: 20, padding: '3px 9px',
                  color: 'rgba(27,94,59,0.50)', fontSize: 11, fontWeight: 600,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                }}>Open</span>
              ))}
            </div>

            {/* Course */}
            {g.course_name && (
              <div style={{ color: 'rgba(13,31,18,0.45)', fontSize: 12, marginBottom: 10 }}>
                {g.course_name}
              </div>
            )}
            {g.message && !isBroadcast && (
              <div style={{ color: 'rgba(13,31,18,0.40)', fontSize: 12, fontStyle: 'italic', marginBottom: 10 }}>
                "{g.message}"
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onRespond(g.id, 'accepted')} style={{
                flex: 1,
                background: isBroadcast ? '#C9A040' : '#1B5E3B',
                color: '#FFFFFF', border: 'none',
                borderRadius: 10, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>{isBroadcast ? "I'm In!" : 'Accept'}</button>
              <button onClick={() => onRespond(g.id, 'declined')} style={{
                background: 'rgba(13,31,18,0.05)', color: 'rgba(13,31,18,0.45)',
                border: '1px solid rgba(13,31,18,0.12)',
                borderRadius: 10, padding: '9px 16px', fontSize: 13, cursor: 'pointer',
              }}>Decline</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ─── Add Friend Modal ─────────────────────────────────────────────────────────
function AddFriendModal({ onClose, onRequestSent }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [sent, setSent]       = useState({}) // { [id]: 'sending' | 'sent' | 'error' }
  const debounce              = useRef(null)

  function handleQuery(val) {
    setQuery(val)
    clearTimeout(debounce.current)
    if (val.trim().length < 2) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await api(`/api/friends/search?q=${encodeURIComponent(val.trim())}`)
        setResults(Array.isArray(r) ? r : [])
      } catch { setResults([]) }
      setSearching(false)
    }, 350)
  }

  async function sendRequest(user) {
    setSent(s => ({ ...s, [user.id]: 'sending' }))
    try {
      await post('/api/friends/request', { email: user.email })
      setSent(s => ({ ...s, [user.id]: 'sent' }))
      onRequestSent?.()
    } catch (e) {
      setSent(s => ({ ...s, [user.id]: e?.message?.includes('pending') ? 'pending' : 'error' }))
    }
  }

  const handicapStr = (hcp) => hcp != null ? (hcp > 0 ? `+${hcp}` : String(hcp)) : null

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #FFFFFF, #F8F5EF)',
        border: '1px solid rgba(27,94,59,0.12)',
        borderRadius: '20px 20px 0 0', padding: '24px 20px 48px',
        maxHeight: '75vh', display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>Add Playing Partner</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* Search input */}
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            autoFocus
            value={query}
            onChange={e => handleQuery(e.target.value)}
            placeholder="Search by name or email…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, color: '#fff', padding: '12px 14px 12px 38px',
              fontSize: 14, outline: 'none',
            }}
          />
          {searching && (
            <svg style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          )}
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {results.length === 0 && query.trim().length >= 2 && !searching && (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', paddingTop: 24 }}>
              No players found
            </div>
          )}
          {query.trim().length < 2 && (
            <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, textAlign: 'center', paddingTop: 24 }}>
              Type a name or email to search
            </div>
          )}
          {results.map(u => {
            const state = sent[u.id]
            const alreadyFriend = u.friend_status === 'accepted'
            const alreadyPending = u.friend_status === 'pending' || state === 'pending' || state === 'sent'
            const hcp = handicapStr(u.handicap)
            return (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)',
                gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{u.name}</span>
                    {hcp && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: 'rgba(245,215,138,0.7)',
                        background: 'rgba(245,215,138,0.08)', borderRadius: 5,
                        padding: '1px 6px', letterSpacing: '0.04em',
                      }}>HCP {hcp}</span>
                    )}
                  </div>
                  {u.home_course && (
                    <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {u.home_course}
                    </div>
                  )}
                </div>
                {alreadyFriend ? (
                  <span style={{ color: '#C9A040', fontSize: 11, fontWeight: 600 }}>Friends</span>
                ) : alreadyPending ? (
                  <span style={{ color: 'rgba(245,215,138,0.6)', fontSize: 11, fontWeight: 600 }}>Requested</span>
                ) : state === 'error' ? (
                  <span style={{ color: '#F87171', fontSize: 11 }}>Error</span>
                ) : (
                  <button onClick={() => sendRequest(u)} disabled={state === 'sending'} style={{
                    background: 'linear-gradient(135deg, rgba(245,215,138,0.15), rgba(197,160,64,0.1))',
                    border: '1px solid rgba(245,215,138,0.25)',
                    borderRadius: 9, color: '#F5D78A', fontSize: 12, fontWeight: 600,
                    padding: '6px 14px', cursor: 'pointer', flexShrink: 0,
                    opacity: state === 'sending' ? 0.5 : 1,
                  }}>{state === 'sending' ? '…' : '+ Add'}</button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Create Game Modal ────────────────────────────────────────────────────────
function CreateGameModal({ initialDate, onClose, onCreated, onCreateOuting }) {
  const [date, setDate]         = useState(initialDate || new Date().toISOString().slice(0, 10))
  const [startTime, setStartTime] = useState('08:00')  // sensible morning default
  const [type, setType]         = useState('tee_time')
  const [course, setCourse]     = useState('')
  const [message, setMessage]   = useState('')
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [invitees, setInvitees] = useState([])   // [{id, name, handicap}]
  const [sending, setSending]   = useState(false)
  const debounce                = useRef(null)

  function handleQuery(val) {
    setQuery(val)
    clearTimeout(debounce.current)
    if (val.trim().length < 2) { setResults([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await api(`/api/friends/search?q=${encodeURIComponent(val.trim())}`)
        setResults(Array.isArray(r) ? r.filter(u => !invitees.find(i => i.id === u.id)) : [])
      } catch { setResults([]) }
      setSearching(false)
    }, 300)
  }

  function addInvitee(u) {
    if (invitees.length >= 49) return
    setInvitees(prev => [...prev, { id: u.id, name: u.name, handicap: u.handicap }])
    setQuery(''); setResults([])
  }

  function removeInvitee(id) { setInvitees(prev => prev.filter(i => i.id !== id)) }

  async function send() {
    setSending(true)
    try {
      await post('/api/games', {
        date,
        start_time: startTime || null,
        request_type: type,
        course_name: course.trim() || null,
        message: message.trim() || null,
        invitee_ids: invitees.map(i => i.id),
      })
      onCreated?.()
      onClose()
    } catch { /* ignore */ }
    setSending(false)
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #FFFFFF, #F8F5EF)',
        border: '1px solid rgba(27,94,59,0.12)',
        borderRadius: '22px 22px 0 0', padding: '20px 20px 48px',
        maxHeight: '90dvh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(27,94,59,0.14)', margin: '0 auto 20px' }} />
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Schedule a Match</div>

        {/* Date + Time — side-by-side row so time-of-day disambiguates
            same-day matches on the Home dashboard (audit R6, 2026-04-29). */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>DATE</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
              colorScheme: 'dark',
            }} />
          </div>
          <div style={{ flex: '0 0 130px' }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>TEE TIME</div>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
              colorScheme: 'dark',
            }} />
          </div>
        </div>

        {/* Type toggle */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>TYPE</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['tee_time', 'Tee Time'], ['availability_match', 'Calendar Match']].map(([val, label]) => (
              <button key={val} onClick={() => setType(val)} style={{
                flex: 1, padding: '9px',
                background: type === val ? 'rgba(197,160,64,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${type === val ? 'rgba(197,160,64,0.4)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 10, color: type === val ? '#F5D78A' : 'rgba(255,255,255,0.4)',
                fontSize: 12, fontWeight: type === val ? 700 : 400, cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Invite friends (up to 3) */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>
            INVITE PLAYERS ({invitees.length}/49){invitees.length >= 4 ? ' · Outing mode' : ''}
          </div>
          {/* Chips */}
          {invitees.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {invitees.map(i => (
                <div key={i.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(201,160,64,0.12)', border: '1px solid rgba(201,160,64,0.25)',
                  borderRadius: 20, padding: '4px 10px 4px 12px',
                }}>
                  <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>{i.name}</span>
                  <button onClick={() => removeInvitee(i.id)} style={{
                    background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1,
                  }}>×</button>
                </div>
              ))}
            </div>
          )}
          {invitees.length < 49 && (
            <div style={{ position: 'relative' }}>
              <input
                value={query}
                onChange={e => handleQuery(e.target.value)}
                placeholder="Search friends by name or email…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
                }}
              />
              {(results.length > 0 || searching) && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                  background: '#0D1F12', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, marginTop: 4, overflow: 'hidden',
                }}>
                  {searching && <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, padding: '10px 14px' }}>Searching…</div>}
                  {results.map(u => (
                    <div key={u.id} onClick={() => addInvitee(u)} style={{
                      padding: '10px 14px', cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div>
                        <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                        {u.handicap != null && (
                          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
                            HCP {u.handicap > 0 ? `+${u.handicap}` : u.handicap}
                          </div>
                        )}
                      </div>
                      <span style={{ color: '#C9A040', fontSize: 12, fontWeight: 600 }}>+ Add</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Course */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>COURSE (OPTIONAL)</div>
          <input value={course} onChange={e => setCourse(e.target.value)} placeholder="Which course?" style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
          }} />
        </div>

        {/* Message */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>MESSAGE (OPTIONAL)</div>
          <input value={message} onChange={e => setMessage(e.target.value)} placeholder="e.g. 8am shotgun start?" style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
          }} />
        </div>

        {invitees.length >= 4 ? (
          /* ≥ 5 total players → outing territory */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => onCreateOuting?.({ invitees, date, course: course.trim() || null, message: message.trim() || null })}
              style={{
                width: '100%', padding: '15px',
                background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
                color: '#070C09', border: 'none', borderRadius: 12,
                fontSize: 15, fontWeight: 800, cursor: 'pointer', letterSpacing: '0.02em',
              }}
            >
              Create Outing  ({invitees.length + 1} Players) →
            </button>
            <button onClick={send} disabled={sending} style={{
              width: '100%', padding: '12px',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12, color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>{sending ? 'Sending…' : 'Send as Match Instead'}</button>
          </div>
        ) : (
          <button onClick={send} disabled={sending || invitees.length === 0} style={{
            width: '100%', padding: '14px',
            background: invitees.length > 0 ? 'linear-gradient(135deg, #F5D78A, #C9A040)' : 'rgba(255,255,255,0.07)',
            color: invitees.length > 0 ? '#070C09' : 'rgba(255,255,255,0.3)',
            border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
            cursor: invitees.length > 0 ? 'pointer' : 'default',
          }}>{sending ? 'Sending…' : invitees.length === 0 ? 'Add at least 1 friend' : `Send Invite${invitees.length > 1 ? 's' : ''}`}</button>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── Edit Profile Modal ───────────────────────────────────────────────────────
function EditProfileModal({ user, onSave, onClose }) {
  const [course, setCourse] = useState(user?.home_course ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [hcp, setHcp] = useState(
    user?.handicap != null
      ? (user.handicap > 0 ? `+${user.handicap}` : String(user.handicap))
      : ''
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const hcpVal = hcp.trim() ? hcp.trim() : undefined
      await post('/api/profile/update', {
        home_course: course.trim() || null,
        bio: bio.trim() || null,
        ...(hcpVal !== undefined ? { handicap: hcpVal } : {}),
      })
      const parsed = hcpVal ? parseFloat(hcpVal.replace(/^\+/, '')) : user?.handicap
      onSave({ home_course: course.trim() || null, bio: bio.trim() || null, handicap: isNaN(parsed) ? user?.handicap : parsed })
      onClose()
    } catch { /* ignore */ }
    setSaving(false)
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #FFFFFF, #F8F5EF)',
        border: '1px solid rgba(27,94,59,0.12)',
        borderRadius: '20px 20px 0 0', padding: '24px 24px 40px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ color: '#0D1F12', fontSize: 16, fontWeight: 700 }}>Edit Profile</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(13,31,18,0.40)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        {/* Handicap row */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600 }}>HANDICAP INDEX</div>
          <input
            value={hcp}
            onChange={e => setHcp(e.target.value)}
            placeholder="e.g. 8.4 or +2.1"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(27,94,59,0.04)', border: '1px solid rgba(27,94,59,0.15)',
              borderRadius: 10, color: '#0D1F12', padding: '11px 14px', fontSize: 14, outline: 'none',
            }}
          />
        </div>
        {[
          { label: 'Home Course', value: course, set: setCourse, placeholder: 'e.g. Augusta National' },
          { label: 'Bio', value: bio, set: setBio, placeholder: 'Short tagline…' },
        ].map(({ label, value, set, placeholder }) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600 }}>{label.toUpperCase()}</div>
            <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder} style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(27,94,59,0.04)', border: '1px solid rgba(27,94,59,0.15)',
              borderRadius: 10, color: '#0D1F12', padding: '11px 14px', fontSize: 14, outline: 'none',
            }} />
          </div>
        ))}
        <button onClick={handleSave} disabled={saving} style={{
          width: '100%', padding: '14px', marginTop: 8,
          background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
          color: '#070C09', border: 'none', borderRadius: 12,
          fontSize: 15, fontWeight: 700, cursor: 'pointer',
        }}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>,
    document.body
  )
}

// ─── Main Home Page ───────────────────────────────────────────────────────────
// ─── Player Card Teaser ───────────────────────────────────────────────────────
function PlayerCardTeaser({ avatar, onOpen }) {
  if (avatar) {
    return (
      <div
        onClick={onOpen}
        style={{
          marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, padding: '10px 14px 10px 10px', cursor: 'pointer',
        }}
      >
        {/* Thumbnail */}
        <div style={{
          width: 54, height: 76, borderRadius: 10, overflow: 'hidden', flexShrink: 0,
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        }}>
          <img src={avatar} alt="Player card" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} />
        </div>
        {/* Label */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, letterSpacing: '0.1em', fontWeight: 600, marginBottom: 3 }}>PLAYER CARD</div>
          <div style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>Your broadcast card</div>
          <div style={{ color: 'rgba(245,215,138,0.6)', fontSize: 12, marginTop: 2 }}>Tap to view or retake</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    )
  }

  return (
    <button
      onClick={onOpen}
      style={{
        width: '100%', marginBottom: 16, padding: '14px 18px',
        background: 'linear-gradient(135deg, rgba(197,160,64,0.08) 0%, rgba(197,160,64,0.04) 100%)',
        border: '1px dashed rgba(197,160,64,0.3)',
        borderRadius: 16, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 14,
        textAlign: 'left',
      }}
    >
      {/* Icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        background: 'rgba(197,160,64,0.1)', border: '1px solid rgba(197,160,64,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(245,215,138,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#F5D78A', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
          Create Your Player Card
        </div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 1.4 }}>
          PGA Tour–style broadcast card — just like the scoreboards on TV
        </div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(245,215,138,0.5)" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  )
}

// ─── Profile view (full-page user profile inside the Home tab) ────────────────
//
// Opened from Home's "My Profile" top-bar button. Replaces the standalone
// Stats tab — its content lives here now, below an expanded identity
// header (big avatar + name + course + handicap + season W-L-T-AVG3 +
// streak chip). Stats body: HcpBadge, Avg/Best tiles, MiniTrendBar,
// Distances card, Recent rounds. (2026-05-01)
function ProfileView({ user, season, avg3, streak, stats, rounds, rivalries = [], followCounts, onCountsChange, onBack, onEditProfile, onOpenCard }) {
  // Golf handicap display convention (matches HcpBadge):
  //   high cap (≥0)  → "17.0"  (no prefix)
  //   plus cap (<0)  → "+3.5"  (sign added because the player gives back strokes)
  // Coerce to Number — NUMERIC(4,1) arrives as a string from pg.
  const hcpNum = user?.handicap == null ? null : Number(user.handicap)
  const handicapDisplay = !Number.isFinite(hcpNum)
    ? '—'
    : hcpNum >= 0
      ? hcpNum.toFixed(1)
      : `+${Math.abs(hcpNum).toFixed(1)}`

  // Tap a recent round → open its scorecard. State scoped to this view
  // so closing returns straight to the Profile.
  const [selectedRoundId, setSelectedRoundId] = useState(null)
  // Tap a rivalry row → open the animated head-to-head face-off modal.
  const [selectedRivalry, setSelectedRivalry] = useState(null)
  // Tap "See all rounds" → open the full RoundHistory bottom-sheet.
  const [historyOpen, setHistoryOpen] = useState(false)
  // Tap "See all rivalries" → open the full RivalryHistory bottom-sheet.
  const [rivalriesOpen, setRivalriesOpen] = useState(false)

  return (
    <div style={{ minHeight: '100dvh', background: 'transparent', paddingBottom: 100 }}>
      {/* Top bar — same gold "The Match" title with a back arrow + Edit
          Profile pill. Stays in the page's light theme so it visually
          matches the Home dashboard's top bar. The dark friends-card
          theme starts BELOW this header. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '56px 20px 16px', gap: 12,
      }}>
        <button onClick={onBack} aria-label="Back" style={{
          background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.14)',
          borderRadius: 10, color: '#1B5E3B', fontSize: 18, fontWeight: 700,
          padding: '4px 12px', cursor: 'pointer', lineHeight: 1, height: 32,
          display: 'inline-flex', alignItems: 'center',
        }}>←</button>
        <div style={{
          fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em',
          background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9A040 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          flex: 1, textAlign: 'center',
        }}>The Match</div>
        <button onClick={onEditProfile} style={{
          background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.14)',
          borderRadius: 10, color: '#1B5E3B', fontSize: 12,
          padding: '7px 12px', cursor: 'pointer',
        }}>Edit</button>
      </div>

      {/* Body container — dark theme matching the FriendProfile cards.
          Top-bar above stays in the page's light theme; from here down
          we adopt the same color palette friend cards use so tapping
          "My Profile" feels visually consistent with tapping a friend.
          (2026-05-01 — Matt: "follow the same color layout the friends
          cards use") */}
      <div style={{
        padding: '16px 16px 8px',
        background: 'linear-gradient(180deg, #0E1F13 0%, #070C09 100%)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Expanded identity header — bigger avatar, larger name, the same
            season W-L-T-AVG3 row, and streak chip. Dark gradient matches
            the FriendSeasonCard. */}
        <div style={{
          borderRadius: 18,
          overflow: 'hidden',
          background: 'linear-gradient(155deg, #0F2814 0%, #0A1D0F 40%, #060E08 100%)',
          border: '1px solid rgba(197,160,64,0.18)',
          boxShadow: '0 0 30px rgba(197,160,64,0.05)',
          position: 'relative',
          marginBottom: 12,
        }}>
          {/* Top gold accent line */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 3, pointerEvents: 'none',
            background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.7), rgba(232,192,90,1.0), rgba(201,160,64,0.7), transparent)',
          }} />
          {/* Radial gold glow */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(201,160,64,0.10) 0%, transparent 70%)',
          }} />

          <div style={{ padding: '20px 18px 18px', position: 'relative' }}>
            <div style={{ color: 'rgba(245,215,138,0.75)', fontSize: 10, letterSpacing: '0.14em', fontWeight: 700, marginBottom: 12 }}>
              SEASON {season?.year ?? currentSeasonYear()}
            </div>

            {/* Top row: big avatar + name/course on the right */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
              {/* Big player card — taps open the PlayerCard overlay, same
                  behavior as the small one on the Home dashboard. */}
              <div
                onClick={onOpenCard}
                style={{
                  flexShrink: 0, width: 100, height: 140, borderRadius: 14, overflow: 'hidden',
                  border: user?.avatar
                    ? '1px solid rgba(201,160,64,0.45)'
                    : '1px dashed rgba(27,94,59,0.25)',
                  background: user?.avatar ? 'transparent' : 'rgba(27,94,59,0.04)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: user?.avatar ? '0 4px 18px rgba(0,0,0,0.20)' : 'none',
                }}
              >
                {user?.avatar ? (
                  <img src={user.avatar} alt="Player card" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%' }} />
                ) : (
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="rgba(27,94,59,0.30)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                  </svg>
                )}
              </div>

              {/* Name + course + handicap stacked */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{
                  fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em',
                  lineHeight: 1.1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  background: 'linear-gradient(135deg, #A07828, #C9A040, #E8C05A)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>{user?.name ?? '—'}</div>

                {user?.home_course ? (
                  <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {user.home_course}
                  </div>
                ) : (
                  <button onClick={onEditProfile} style={{
                    background: 'none', border: 'none', color: 'rgba(245,215,138,0.65)',
                    fontSize: 12, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4,
                    alignSelf: 'flex-start',
                  }}>
                    <span>+ Add home course</span>
                  </button>
                )}

                <div style={{
                  marginTop: 2,
                  display: 'inline-flex', alignItems: 'baseline', gap: 8,
                  background: 'rgba(0,0,0,0.30)', borderRadius: 10, padding: '6px 12px',
                  border: '1px solid rgba(197,160,64,0.35)',
                  alignSelf: 'flex-start',
                }}>
                  <div style={{
                    fontSize: 28, fontWeight: 900, lineHeight: 1,
                    background: 'linear-gradient(135deg, #F5D78A, #E8C05A, #C9A040)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  }}>{handicapDisplay}</div>
                  <div style={{ color: 'rgba(245,215,138,0.55)', fontSize: 9, letterSpacing: '0.12em', fontWeight: 700 }}>HCP INDEX</div>
                </div>
              </div>
            </div>

            {/* Follow pills — Following / Followers / Mutuals on a dark
                surface. Pass theme="dark" so the pills render with white
                values + muted-light labels instead of the cream variant. */}
            <div style={{ marginBottom: 12, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <FollowPills counts={followCounts} size="lg" theme="dark" onCountsChange={onCountsChange} />
            </div>

            {/* Season W-L-T-AVG3 — green/red/white/gold values match the
                FriendSeasonCard color tokens. */}
            <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 14 }}>
              {[
                { label: 'WINS',     value: season?.wins   ?? 0,            color: '#4ADE80' },
                { label: 'LOSSES',   value: season?.losses ?? 0,            color: '#F87171' },
                { label: 'TIES',     value: season?.ties   ?? 0,            color: 'rgba(255,255,255,0.45)' },
                { label: '3-RND AVG', value: avg3 != null ? avg3 : '—',     color: '#F5D78A' },
              ].map(({ label, value, color }, i) => (
                <div key={label} style={{
                  flex: 1, textAlign: 'center',
                  borderRight: i < 3 ? '1px solid rgba(255,255,255,0.07)' : 'none',
                  padding: '0 4px',
                }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.40)', letterSpacing: '0.09em', marginTop: 5, fontWeight: 600 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Streak chip */}
            {streak > 0 && (
              <div style={{
                marginTop: 12, display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(245,215,138,0.10)', border: '1px solid rgba(245,215,138,0.28)',
                borderRadius: 10, padding: '8px 14px',
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#F5D78A" stroke="none"><path d="M12 2c0 0-5 5.5-5 10a5 5 0 0 0 10 0c0-4.5-5-10-5-10zm0 13a2 2 0 0 1-2-2c0-2 2-5 2-5s2 3 2 5a2 2 0 0 1-2 2z"/></svg>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#F5D78A' }}>{streak}-day streak</span>
                  <span style={{ fontSize: 11, color: 'rgba(245,215,138,0.55)', marginLeft: 6 }}>· keep it alive</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats body — handicap badge (with embedded trend chart),
            tiles, distances, recent rounds. */}
        <HcpBadge
          hcp={stats?.handicap ?? user?.handicap ?? null}
          roundCount={stats?.roundCount}
          rounds={rounds}
        />

        {stats && (() => {
          // Coerce numeric fields — Postgres NUMERIC → string via pg.
          const avgNum  = Number(stats.avgScore)
          const bestNum = Number(stats.bestScore)
          const avgDisplay  = Number.isFinite(avgNum)  ? avgNum.toFixed(1) : '—'
          const bestDisplay = Number.isFinite(bestNum) ? bestNum            : '—'
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <StatTile
                theme="dark"
                label="Avg Score"
                value={avgDisplay}
                sub={`Par ${rounds[0]?.course_par ?? 72}`}
              />
              <StatTile
                theme="dark"
                label="Best Round"
                value={bestDisplay}
                sub="All time"
                accent="#4ADE80"
              />
            </div>
          )
        })()}

        {/* The standalone MiniTrendBar is removed — its content moved
            inside HcpBadge above. (2026-05-01 — Matt request) */}

        {/* Rivalries — top 3 head-to-head records vs friends you've
            played matches with. Each row: avatar + name + W-L-T +
            you/them avg score. Hidden entirely when no rivalries yet,
            with a small empty-state card so the user knows what to
            expect. (2026-05-01 — Matt request) */}
        {(() => {
          const top = (rivalries || []).slice(0, 3)
          if (top.length === 0) {
            return (
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 14, padding: '14px 16px', marginBottom: 12,
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.40)',
                  letterSpacing: '0.12em', marginBottom: 8,
                }}>RIVALRIES</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
                  Play a match against a friend and your head-to-head
                  record will start showing up here.
                </div>
              </div>
            )
          }
          return (
            <div style={{
              borderRadius: 14,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              overflow: 'hidden', marginBottom: 12,
            }}>
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.40)', letterSpacing: '0.12em' }}>RIVALRIES</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.06em' }}>
                  TOP {top.length}
                </div>
              </div>
              {top.map((r, i) => {
                const myWins   = Number(r.my_wins  ?? 0)
                const oppWins  = Number(r.opp_wins ?? 0)
                const ties     = Number(r.ties     ?? 0)
                const myAvg    = r.my_avg  != null ? Number(r.my_avg)  : null
                const oppAvg   = r.opp_avg != null ? Number(r.opp_avg) : null
                const myAvgStr  = Number.isFinite(myAvg)  ? myAvg.toFixed(1)  : '—'
                const oppAvgStr = Number.isFinite(oppAvg) ? oppAvg.toFixed(1) : '—'
                // Initials for avatar fallback
                const initials = (r.opponent_name || '·')
                  .split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
                // Record shape: "3-1-0" or "3-1" if no ties
                const recordStr = ties > 0
                  ? `${myWins}-${oppWins}-${ties}`
                  : `${myWins}-${oppWins}`
                // Color the record based on lead — green/red on dark
                const recordColor = myWins > oppWins ? '#4ADE80'
                  : oppWins > myWins ? '#F87171'
                  : 'rgba(255,255,255,0.50)'
                return (
                  <button
                    key={r.opponent_id ?? i}
                    onClick={() => setSelectedRivalry(r)}
                    style={{
                      width: '100%',
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px',
                      borderBottom: i < top.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                      background: 'transparent', border: 'none', textAlign: 'left',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'background 120ms ease',
                    }}
                    onMouseDown={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseUp={e => { e.currentTarget.style.background = 'transparent' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      flexShrink: 0,
                      background: r.opponent_avatar ? 'transparent' : 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      overflow: 'hidden',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {r.opponent_avatar ? (
                        <img src={r.opponent_avatar} alt={r.opponent_name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#F5D78A' }}>
                          {initials}
                        </span>
                      )}
                    </div>

                    {/* Name + averages */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 700, color: '#fff',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{r.opponent_name || 'Player'}</div>
                      <div style={{
                        fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2,
                        display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        <span>You <strong style={{ color: '#fff' }}>{myAvgStr}</strong></span>
                        <span style={{ color: 'rgba(255,255,255,0.20)' }}>·</span>
                        <span>Them <strong style={{ color: '#fff' }}>{oppAvgStr}</strong></span>
                      </div>
                    </div>

                    {/* W-L-T record + chevron */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: 18, fontWeight: 900, color: recordColor, lineHeight: 1,
                          fontFamily: '"Arial Black", Arial, sans-serif',
                          letterSpacing: '-0.02em',
                        }}>{recordStr}</div>
                        <div style={{
                          fontSize: 9, color: 'rgba(255,255,255,0.30)',
                          letterSpacing: '0.10em', marginTop: 4, fontWeight: 700,
                        }}>{ties > 0 ? 'W-L-T' : 'W-L'}</div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </div>
                  </button>
                )
              })}

              {/* See all rivalries → opens RivalryHistory bottom sheet
                  with the full list. Only renders when there are MORE
                  than the top-3 already shown. (2026-05-01) */}
              {rivalries.length > top.length && (
                <button
                  onClick={() => setRivalriesOpen(true)}
                  style={{
                    width: '100%',
                    background: 'transparent', border: 'none',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer', padding: '14px 16px',
                    fontFamily: 'inherit', textAlign: 'center',
                    fontSize: 12, fontWeight: 700, letterSpacing: '0.08em',
                    color: '#F5D78A', textTransform: 'uppercase',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'background 120ms ease',
                  }}
                  onMouseDown={e => { e.currentTarget.style.background = 'rgba(245,215,138,0.06)' }}
                  onMouseUp={e => { e.currentTarget.style.background = 'transparent' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  See all {rivalries.length} {rivalries.length === 1 ? 'rival' : 'rivals'}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              )}
            </div>
          )
        })()}

        {stats?.topClubs?.length > 0 && (
          <div style={{
            borderRadius: 14,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            overflow: 'hidden', marginBottom: 12,
          }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
              fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.40)',
              letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              Your Distances
            </div>
            {stats.topClubs.map((c, i) => (
              <div key={i} style={{
                padding: '12px 16px',
                borderBottom: i < stats.topClubs.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <span style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{c.club}</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginLeft: 8 }}>{c.shots} shots</span>
                </div>
                <div style={{ fontWeight: 800, color: '#F5D78A', fontSize: 15 }}>{c.avgYards}<span style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginLeft: 3 }}>y</span></div>
              </div>
            ))}
          </div>
        )}

        {rounds.length > 0 && (
          <div style={{
            borderRadius: 14,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            overflow: 'hidden', marginBottom: 12,
          }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
              fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.40)',
              letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              Recent Rounds
            </div>
            {rounds.slice(0, 3).map((r, i) => {
              // Coerce score / par from possible string NUMERICs
              const sc  = Number(r.score)
              const par = Number(r.course_par)
              const hasDiff = Number.isFinite(sc) && Number.isFinite(par)
              const diff = hasDiff ? sc - par : null
              // Diff color tokens for the dark surface — gold under-par,
              // green for E, red for over-par. Mirrors FriendProfile.
              const diffColor = diff == null ? '#fff'
                : diff < 0 ? '#F5D78A'
                : diff === 0 ? '#4ADE80'
                : '#F87171'
              return (
                <button
                  key={r.id ?? i}
                  onClick={() => r.id != null && setSelectedRoundId(r.id)}
                  disabled={r.id == null}
                  style={{
                    width: '100%',
                    background: 'transparent', border: 'none', textAlign: 'left',
                    cursor: r.id != null ? 'pointer' : 'default',
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                    fontFamily: 'inherit',
                    transition: 'background 120ms ease',
                  }}
                  onMouseDown={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                  onMouseUp={e => { e.currentTarget.style.background = 'transparent' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontWeight: 600, color: '#fff', fontSize: 13,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{r.course_name ?? 'Round'}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                      {r.played_at ? new Date(r.played_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                      {r.holes ? ` · ${r.holes} holes` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      {diff != null && (
                        <div style={{ fontSize: 20, fontWeight: 900, color: diffColor, lineHeight: 1 }}>
                          {diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', marginTop: 3 }}>
                        {Number.isFinite(sc) ? `${sc} strokes` : (r.score ?? '—')}
                      </div>
                    </div>
                    {r.id != null && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    )}
                  </div>
                </button>
              )
            })}

            {/* See all rounds → opens RoundHistory bottom sheet with the
                full list. (2026-05-01 — Matt: cap inline list to 3) */}
            <button
              onClick={() => setHistoryOpen(true)}
              style={{
                width: '100%',
                background: 'transparent', border: 'none',
                cursor: 'pointer', padding: '14px 16px',
                fontFamily: 'inherit', textAlign: 'center',
                fontSize: 12, fontWeight: 700, letterSpacing: '0.08em',
                color: '#F5D78A', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'background 120ms ease',
              }}
              onMouseDown={e => { e.currentTarget.style.background = 'rgba(245,215,138,0.06)' }}
              onMouseUp={e => { e.currentTarget.style.background = 'transparent' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              See all {rounds.length} round{rounds.length === 1 ? '' : 's'}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
        )}

        {!stats && rounds.length === 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 14, padding: 20, textAlign: 'center',
            color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 1.55,
          }}>
            No rounds yet. Log your first round and your stats, trend chart,
            and club distances will start showing up here.
          </div>
        )}
      </div>

      {/* Round scorecard modal — opened by tapping a row in the Recent
          Rounds list above. Fetches from GET /api/rounds/:id. */}
      {selectedRoundId != null && (
        <RoundScorecard
          roundId={selectedRoundId}
          onClose={() => setSelectedRoundId(null)}
        />
      )}

      {/* Rivalry head-to-head face-off — opened by tapping a row in the
          Rivalries card. Animated pop-in with both players' photos +
          W-L-T + avg scores side-by-side. */}
      {selectedRivalry && (
        <RivalryDetail
          rivalry={selectedRivalry}
          myName={user?.name}
          myAvatar={user?.avatar}
          myHandicap={user?.handicap}
          onClose={() => setSelectedRivalry(null)}
        />
      )}

      {/* Full round history — opened by tapping "See all N rounds"
          beneath the truncated 3-row preview. Each row in the modal
          taps into the same RoundScorecard. */}
      {historyOpen && (
        <RoundHistory
          rounds={rounds}
          title="Recent Rounds"
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* Full rivalries list — opened by tapping "See all N rivals"
          beneath the truncated top-3. Each row taps into the same
          animated RivalryDetail face-off modal. */}
      {rivalriesOpen && (
        <RivalryHistory
          rivalries={rivalries}
          title="Rivalries"
          subjectName={user?.name}
          subjectAvatar={user?.avatar}
          subjectHandicap={user?.handicap}
          selfLabel="You"
          oppLabel="Them"
          onClose={() => setRivalriesOpen(false)}
        />
      )}
    </div>
  )
}

export default function Home({ onNavigateToOuting }) {
  const [profile, setProfile] = useState(null)
  const [friends, setFriends] = useState({ friends: [], incoming: [], activity: [] })
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [addFriendOpen, setAddFriendOpen] = useState(false)
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [games, setGames]               = useState({ incoming: [], confirmed: [] })
  const [teeRequests, setTeeRequests]   = useState({ incoming: [], outgoing: [] })
  const [planGame, setPlanGame]         = useState(null)
  const [createGameOpen, setCreateGameOpen] = useState(false)
  const [createGameDate, setCreateGameDate] = useState(null)
  const [playerCardOpen, setPlayerCardOpen] = useState(false)
  // 'home' = dashboard, 'profile' = full profile + stats screen.
  // Profile is a sibling view inside the Home tab (not a top-level tab).
  // (2026-05-01)
  const [view, setView] = useState('home')
  // Stats data for the Profile view. Loaded alongside the dashboard data
  // so the Profile screen renders instantly when the user taps "My Profile".
  const [stats, setStats]   = useState(null)
  const [rounds, setRounds] = useState([])
  // Head-to-head rivalries for the Profile's Rivalries card (top 3).
  // Endpoint returns up to 20; the card slices to the first 3.
  const [rivalries, setRivalries] = useState([])
  // Live follow counts — driven by /api/follows/counts. Shown in pills on
  // the Profile view header AND on the Home ProfileHeroCard. Refreshed
  // every time the user follows/unfollows from inside the FollowList
  // overlay (passed down as onCountsChange). (2026-05-01 — follow Phase 1)
  const [followCounts, setFollowCounts] = useState({ following: 0, followers: 0, mutuals: 0 })

  const refreshFollowCounts = useCallback(async () => {
    try {
      const c = await api('/api/follows/counts')
      setFollowCounts(c ?? { following: 0, followers: 0, mutuals: 0 })
    } catch (e) { /* ignore — leave stale counts */ }
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [p, f, g, tr, s, r, fc, riv] = await Promise.all([
        api('/api/profile'),
        api('/api/friends'),
        api('/api/games'),
        api('/api/availability/tee-requests'),
        // Stats summary + recent rounds for the Profile view. Both .catch
        // to null/empty so the dashboard doesn't fail if the user hasn't
        // logged any rounds yet.
        api('/api/stats/summary').catch(() => null),
        api('/api/rounds?limit=20').catch(() => ({ rounds: [] })),
        // Follow counts for the header pills (Following / Followers /
        // Mutuals). Fail-soft to zeros so the rest of Home keeps loading
        // if the follows endpoint hits a transient error.
        api('/api/follows/counts').catch(() => null),
        // Rivalries (top H2H records) for the Profile's Rivalries card.
        api('/api/outings/my-rivalries').catch(() => null),
      ])
      setProfile(p)
      setFriends(f)
      setGames(g ?? { incoming: [], confirmed: [] })
      setTeeRequests(tr ?? { incoming: [], outgoing: [] })
      setStats(s)
      setRounds(r?.rounds ?? [])
      setFollowCounts(fc ?? { following: 0, followers: 0, mutuals: 0 })
      setRivalries(riv?.rivalries ?? [])
    } catch (err) {
      console.error('[Home] load', err)
    }
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  async function handleStartSeason() {
    try {
      await post('/api/profile/start-season', {})
      setProfile(prev => ({ ...prev, season: { ...prev.season, seasonStarted: true } }))
    } catch { /* ignore */ }
  }

  async function handleFriendRespond(id, status) {
    try {
      await put(`/api/friends/${id}/respond`, { status })
      const f = await api('/api/friends')
      setFriends(f)
    } catch { /* ignore */ }
  }

  async function handleGameRespond(id, status) {
    try {
      await put(`/api/games/${id}/respond`, { status })
      const g = await api('/api/games')
      setGames(g ?? { incoming: [], confirmed: [] })
    } catch (err) {
      if (err.status === 409) {
        alert(err.message) // "Sorry, all spots have been filled"
        const g = await api('/api/games')
        setGames(g ?? { incoming: [], confirmed: [] })
      }
    }
  }

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

  // Profile view — full-page user profile + stats inside the Home tab.
  if (view === 'profile') {
    return (
      <>
        <ProfileView
          user={user} season={season} avg3={avg3} streak={streak}
          stats={stats} rounds={rounds}
          rivalries={rivalries}
          followCounts={followCounts}
          onCountsChange={refreshFollowCounts}
          onBack={() => setView('home')}
          onEditProfile={() => setEditOpen(true)}
          onOpenCard={() => setPlayerCardOpen(true)}
        />
        {/* Edit profile modal — opens from the Profile view's Edit button */}
        {editOpen && (
          <EditProfileModal user={user} onSave={handleProfileSaved} onClose={() => setEditOpen(false)} />
        )}
        {/* Player card overlay — opens from the big avatar in the header */}
        {playerCardOpen && (
          <PlayerCard onClose={() => setPlayerCardOpen(false)} userId={profile?.id} />
        )}
      </>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'transparent', paddingBottom: 100 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '56px 20px 16px',
      }}>
        <div style={{
          fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em',
          background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9A040 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>The Match</div>
        <button onClick={() => setView('profile')} style={{
          background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.14)',
          borderRadius: 10, color: '#1B5E3B', fontSize: 12,
          padding: '7px 12px', cursor: 'pointer',
        }}>My Profile</button>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Profile hero */}
        <ProfileHeroCard
          user={user} season={season} avg3={avg3} streak={streak}
          followCounts={followCounts}
          onCountsChange={refreshFollowCounts}
          onStartSeason={handleStartSeason}
          onEditProfile={() => setEditOpen(true)}
          onOpenCard={() => setPlayerCardOpen(true)}
        />

        {/* GolfNow booking card */}
        <a
          href="https://www.golfnow.com/tee-times"
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: 'none', display: 'block', marginBottom: 16 }}
        >
          <div style={{
            borderRadius: 16,
            background: 'linear-gradient(135deg, #FFFFFF 0%, #F2EEE6 100%)',
            border: '2px solid rgba(201,160,64,0.70)',
            boxShadow: '0 2px 20px rgba(201,160,64,0.22)',
            padding: '14px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Calendar icon */}
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: 'rgba(27,94,59,0.14)', border: '1.5px solid rgba(27,94,59,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B5E3B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div>
                <div style={{ color: '#0D1F12', fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>Book a Tee Time</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                  <div style={{
                    background: 'rgba(27,94,59,0.14)', border: '1.5px solid rgba(27,94,59,0.35)',
                    borderRadius: 4, padding: '1px 6px',
                    color: '#1B5E3B', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                  }}>GOLFNOW</div>
                  <span style={{ color: 'rgba(13,31,18,0.55)', fontSize: 11, fontWeight: 500 }}>Search tee times in your area →</span>
                </div>
              </div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(27,94,59,0.50)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </a>

        {/* Upcoming confirmed games */}
        <UpcomingTeeTimes
          games={games.confirmed}
          sentRequests={teeRequests.outgoing}
          onPlan={setPlanGame}
          userId={profile?.id}
          onCreateMatch={players => onNavigateToOuting?.(players)}
          onSelectFriend={setSelectedFriend}
          onRefresh={async () => {
            const [g, tr] = await Promise.all([
              api('/api/games'),
              api('/api/availability/tee-requests'),
            ])
            setGames(g ?? { incoming: [], confirmed: [] })
            setTeeRequests(tr ?? { incoming: [], outgoing: [] })
          }}
        />

        {/* Pending game invites + tee time requests */}
        <GameInbox
          games={games}
          teeRequests={teeRequests.incoming}
          onRespond={async (id, status) => {
            await handleGameRespond(id, status)
          }}
          onRespondTeeRequest={async (id, status) => {
            await post(`/api/availability/tee-requests/${id}`, { status })
            const tr = await api('/api/availability/tee-requests')
            setTeeRequests(tr ?? { incoming: [], outgoing: [] })
          }}
        />

        {/* Friends */}
        <FriendsPanel
          friends={friends.friends}
          incoming={friends.incoming}
          outgoing={friends.outgoing}
          activity={friends.activity}
          onRespond={handleFriendRespond}
          onAddFriend={() => setAddFriendOpen(true)}
          onSelectFriend={setSelectedFriend}
        />

        {/* Availability calendar */}
        <AvailabilityCalendar
          uid={user?.id}
          onScheduleGame={(date) => { setCreateGameDate(date); setCreateGameOpen(true) }}
        />
      </div>

      {/* Friend profile modal */}
      {selectedFriend && (
        <FriendProfile
          friend={selectedFriend}
          myName={user?.name}
          confirmedGames={games.confirmed}
          onClose={() => setSelectedFriend(null)}
        />
      )}

      {/* Add friend modal */}
      {addFriendOpen && (
        <AddFriendModal
          onClose={() => setAddFriendOpen(false)}
          onRequestSent={async () => {
            const f = await api('/api/friends')
            setFriends(f)
          }}
        />
      )}

      {/* Create game modal */}
      {createGameOpen && (
        <CreateGameModal
          initialDate={createGameDate}
          onClose={() => { setCreateGameOpen(false); setCreateGameDate(null) }}
          onCreated={async () => {
            const g = await api('/api/games')
            setGames(g ?? { incoming: [], confirmed: [] })
          }}
          onCreateOuting={players => {
            setCreateGameOpen(false)
            setCreateGameDate(null)
            onNavigateToOuting?.(players)
          }}
        />
      )}

      {/* Edit profile modal */}
      {editOpen && (
        <EditProfileModal user={user} onSave={handleProfileSaved} onClose={() => setEditOpen(false)} />
      )}

      {/* Plan / set course sheet */}
      {planGame && (
        <PlanSheet
          game={planGame}
          onClose={() => setPlanGame(null)}
          onCourseSaved={(id, course) => {
            setGames(prev => ({
              ...prev,
              confirmed: prev.confirmed.map(g => g.id === id ? { ...g, course_name: course } : g),
            }))
            setPlanGame(null)
          }}
        />
      )}

      {/* Player Card */}
      {playerCardOpen && (
        <PlayerCard
          user={user}
          season={season}
          existingCard={user?.avatar ?? null}
          onClose={() => setPlayerCardOpen(false)}
          onSave={(avatarUrl, cutoutUrl) => {
            setProfile(prev => ({ ...prev, user: { ...prev.user, avatar: avatarUrl, cutout: cutoutUrl } }))
            setPlayerCardOpen(false)
          }}
        />
      )}
    </div>
  )
}
