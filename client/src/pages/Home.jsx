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
import AdminUsersModal from '../components/AdminUsersModal.jsx'
import OnboardingChecklist from '../components/OnboardingChecklist.jsx'
import CoachMark from '../components/CoachMark.jsx'
import RivalryHistory from '../components/RivalryHistory.jsx'
import AchievementsRow from '../components/AchievementsRow.jsx'
import YearRecapModal from './Outing/YearRecap.jsx'
import NewTeeTimeSheet from '../components/NewTeeTimeSheet.jsx'
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

// 2026-05-06 — First-match guidance card. Quiet, dismissable nudge for
// users who have finished onboarding but haven't created or joined any
// match yet. Sized + positioned to feel like a continuation of the
// OnboardingChecklist, not a competing element. Auto-disappears once
// matchCount > 0 or the user taps the dismiss X (per-user localStorage
// flag so it doesn't reappear on every visit).
function FirstMatchCard({ user, matchCount, onGoToScorecard }) {
  const dismissKey = user?.id ? `tm-first-match-dismissed-${user.id}` : null
  const [dismissed, setDismissed] = useState(() => {
    try { return dismissKey && localStorage.getItem(dismissKey) === '1' }
    catch { return false }
  })

  // Hide if: not loaded yet, already played a match, or user dismissed.
  if (!user || !user.onboarding_completed_at) return null
  if (matchCount > 0) return null
  if (dismissed) return null

  function dismiss() {
    setDismissed(true)
    try { dismissKey && localStorage.setItem(dismissKey, '1') } catch { /* ignore */ }
  }

  return (
    <div style={{
      borderRadius: 18,
      background: 'linear-gradient(135deg, rgba(245,215,138,0.18) 0%, rgba(46,158,69,0.12) 100%)',
      border: '1.5px solid rgba(232,192,90,0.55)',
      padding: '18px 18px 16px',
      marginBottom: 16,
      position: 'relative',
      boxShadow: '0 4px 18px rgba(201,160,64,0.18)',
    }}>
      <button onClick={dismiss} aria-label="Dismiss" style={{
        position: 'absolute', top: 6, right: 8,
        background: 'transparent', border: 'none',
        color: 'rgba(13,31,18,0.45)', fontSize: 20,
        cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
        WebkitTapHighlightColor: 'transparent',
      }}>×</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(201,160,64,0.30)',
        }}>
          {/* Pin-flag glyph — matches the Augusta iconography used in
              CodeShare and elsewhere. */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#070C09" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
            <line x1="4" y1="22" x2="4" y2="15"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#7A5800' }}>
            First time?
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0D1F12', lineHeight: 1.2 }}>
            Start your first match
          </div>
        </div>
      </div>

      <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.75)', marginBottom: 14, lineHeight: 1.45 }}>
        Create one for your group, or scan a friend's QR code to join theirs. Live scores show up the moment anyone enters them.
      </div>

      <button
        onClick={() => { dismiss(); onGoToScorecard?.() }}
        style={{
          width: '100%', padding: '13px 14px', borderRadius: 12, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
          color: '#fff', fontWeight: 800, fontSize: 14,
          boxShadow: '0 3px 12px rgba(46,158,69,0.30), inset 0 1px 0 rgba(255,255,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="3" rx="0.8"/>
          <path d="M9 4H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3"/>
          <line x1="8" y1="10" x2="16" y2="10"/>
          <line x1="8" y1="14" x2="16" y2="14"/>
          <line x1="8" y1="18" x2="16" y2="18"/>
        </svg>
        Open the Scorecard tab
      </button>
    </div>
  )
}

function ProfileHeroCard({ user, stats, season, avg3, streak, followCounts, onCountsChange, onStartSeason, onEditProfile, onOpenCard, notifCount = 0, onOpenNotifications, bagCount = 0, onOpenBag }) {
  const seasonBanner = season && !season.seasonStarted && season.year === currentSeasonYear()
  const [banner] = useState(randomBanner)

  // Golf handicap display: high cap = "17.0" (no prefix); plus cap = "+3.5"
  // (sign for scratch-or-better). Coerce — NUMERIC(4,1) arrives as string.
  // Prefer stats.handicap (calculated index from recent rounds) over
  // user.handicap (seeded onboarding value) so this card stays in
  // sync with the Profile view's HcpBadge — they used to disagree
  // (e.g. 18 vs 15.5) once the calculated index switched in.
  // (2026-05-01 — Matt)
  const rawHcp = stats?.handicap ?? user?.handicap
  const hcpNum = rawHcp == null ? null : Number(rawHcp)
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
              fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em',
              lineHeight: 1.1, marginBottom: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: '"Georgia", serif',
              background: 'linear-gradient(135deg, #A07828, #C9A040, #E8C05A)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>{user?.name ?? '—'}</div>
            {user?.handle && (
              <div style={{ color: 'rgba(122,88,0,0.65)', fontSize: 11, fontWeight: 600, marginBottom: 4, letterSpacing: '0.01em' }}>
                @{user.handle}
              </div>
            )}
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

        {/* Mailbox — replaces the streak chip 2026-05-01. Tap opens
            the NotificationsModal listing pending friend requests,
            match invites, and tee-time requests. Red badge shows
            total pending count; hidden when zero so the slot is
            quiet at rest. (Streak still surfaces on the Profile
            view's stats body.) */}
        <button
          onClick={onOpenNotifications}
          aria-label={`Notifications${notifCount > 0 ? ` (${notifCount} pending)` : ''}`}
          style={{
            marginTop: 10, width: '100%',
            display: 'flex', alignItems: 'center', gap: 10,
            background: notifCount > 0
              ? 'linear-gradient(135deg, rgba(201,160,64,0.16), rgba(232,192,90,0.10))'
              : 'rgba(201,160,64,0.06)',
            border: '1px solid', borderColor: notifCount > 0 ? 'rgba(201,160,64,0.45)' : 'rgba(201,160,64,0.18)',
            borderRadius: 10, padding: '10px 14px',
            cursor: 'pointer', fontFamily: 'inherit',
            position: 'relative',
          }}
        >
          {/* Envelope icon */}
          <div style={{
            position: 'relative', width: 22, height: 22,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke={notifCount > 0 ? '#7A5800' : 'rgba(122,88,0,0.6)'}
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2"/>
              <polyline points="3 7 12 13 21 7"/>
            </svg>
            {/* Red count badge */}
            {notifCount > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -8,
                minWidth: 16, height: 16, padding: '0 4px',
                background: '#E5484D', color: '#fff',
                borderRadius: 999, fontSize: 10, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1, border: '1.5px solid rgba(255,255,255,0.95)',
              }}>{notifCount > 99 ? '99+' : notifCount}</span>
            )}
          </div>
          <span style={{ color: notifCount > 0 ? '#7A5800' : 'rgba(122,88,0,0.7)', fontSize: 12, fontWeight: 700, flex: 1, textAlign: 'left' }}>
            {notifCount > 0
              ? `${notifCount} ${notifCount === 1 ? 'notification' : 'notifications'}`
              : 'No new notifications'}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="rgba(122,88,0,0.5)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>

        {/* My Bag — sibling to the mailbox button. Same chip styling
            so the two shortcuts read as a pair. Tap navigates to the
            BAG tab. (2026-05-02 — Matt: "put the my bag box into the
            hero card below notifications and with the same appearence
            notifications box in the hero has") */}
        <button
          onClick={onOpenBag}
          aria-label={`My bag${bagCount > 0 ? ` (${bagCount} clubs)` : ''}`}
          style={{
            marginTop: 8, width: '100%',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(201,160,64,0.06)',
            border: '1px solid rgba(201,160,64,0.18)',
            borderRadius: 10, padding: '10px 14px',
            cursor: 'pointer', fontFamily: 'inherit',
            position: 'relative',
          }}
        >
          {/* Golf bag icon — matches the chip's gold tone */}
          <div style={{
            position: 'relative', width: 22, height: 22,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="rgba(122,88,0,0.6)"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 7h10a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 7 7z" />
              <path d="M5.5 11l-1.5 1v4l1.5 1" />
              <line x1="6" y1="14" x2="18" y2="14" />
              <line x1="9" y1="3" x2="9" y2="7" />
              <line x1="12" y1="2" x2="12" y2="7" />
              <line x1="15" y1="3" x2="15" y2="7" />
            </svg>
          </div>
          <span style={{ color: 'rgba(122,88,0,0.7)', fontSize: 12, fontWeight: 700, flex: 1, textAlign: 'left' }}>
            {bagCount > 0
              ? `${bagCount} ${bagCount === 1 ? 'club' : 'clubs'} · tap to manage distances`
              : 'Set your clubs + distances'}
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="rgba(122,88,0,0.5)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
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
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
            <svg width="42" height="42" viewBox="0 0 64 64" fill="none" stroke="#0D1F12" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="8" x2="22" y2="54"/>
              <path d="M22 10 L52 17 L22 24 Z" fill="#0D1F12" stroke="#0D1F12"/>
              <ellipse cx="22" cy="56" rx="6" ry="2" fill="#0D1F12" stroke="none" opacity="0.25"/>
            </svg>
          </div>
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
// Three modes:
//   • default          — Home view, my availability + friends' as dots
//   • selfOnly         — My Profile, only my availability, no social layer
//   • viewUserId set   — FriendProfile, read-only view of another user's
//                        availability. Tap a day → onDayTap(ymd) so the
//                        parent can launch a tee-time request flow.
// (2026-05-01)
export function AvailabilityCalendar({
  uid, onScheduleGame, selfOnly = false,
  viewUserId = null, viewUserName = null, onDayTap = null,
  theme = 'light',
  gameDates = [],
}) {
  // viewUserId implies a read-only friend view — no toggling, no social
  // layer, fetch from the per-user endpoint.
  const friendView = !!viewUserId

  // 2026-05-01 — Matt: dark variant matches the profile body's
  // dark-card palette (Recent Rounds, Distances, etc.). Same
  // component, two themes.
  const dark = theme === 'dark'
  const C = dark ? {
    headingColor:  '#F5D78A',
    headingBg:     'rgba(0,0,0,0.30)',
    headingShadow: 'none',
    cardBg:        'rgba(255,255,255,0.03)',
    cardBorder:    '1px solid rgba(255,255,255,0.07)',
    divider:       'rgba(255,255,255,0.07)',
    monthArrow:    'rgba(255,255,255,0.40)',
    monthText:     '#fff',
    dayLabel:      'rgba(255,255,255,0.30)',
    dayText:       'rgba(255,255,255,0.85)',
    pastText:      'rgba(255,255,255,0.18)',
    freeText:      '#F5D78A',
    freeGradFrom:  'rgba(201,160,64,0.32)',
    freeGradTo:    'rgba(201,160,64,0.16)',
    friendBg:      'rgba(255,255,255,0.04)',
    todayOutline:  'rgba(245,215,138,0.65)',
    legendText:    'rgba(255,255,255,0.45)',
    legendSwatch:  'rgba(201,160,64,0.40)',
    friendDotMine: '#F5D78A',
    friendDot:     '#F5D78A',
  } : {
    // 'AVAILABILITY CALENDAR' header pill — dark gold instead of
    // green so it ties into the rest of the gold-trim vocabulary
    // on Home (gold flourish dividers, gold borders, gold accents).
    // (2026-05-02 — Matt: "make the green availability calander
    // letters gold")
    headingColor:  '#7A5800',
    headingBg:     'rgba(255,253,248,0.85)',
    headingShadow: '0 1px 1px rgba(255,255,255,0.4)',
    // Translucent glass — same family as the other Home boxes but
    // a notch more opaque (0.55 vs 0.22) because the calendar is
    // dense with small content (day numbers, labels, grid lines)
    // that needs to read clearly against the page tint behind it.
    // (2026-05-02 — Matt: "can u make the calander more visible?")
    cardBg:        'rgba(255,255,255,0.55)',
    cardBorder:    '1px solid rgba(255,255,255,0.65)',
    divider:       'rgba(27,94,59,0.10)',
    monthArrow:    'rgba(27,94,59,0.45)',
    monthText:     '#1B5E3B',
    dayLabel:      'rgba(27,94,59,0.40)',
    dayText:       '#0D1F12',
    pastText:      'rgba(27,94,59,0.20)',
    freeText:      '#7A5800',
    // Brighter availability shades — your-free gold gradient and
    // friend-free green tint bumped so the cells read clearly
    // against the new translucent calendar surface. (2026-05-02 —
    // Matt: "make the availibitly shades in the calander brighter")
    freeGradFrom:  'rgba(201,160,64,0.55)',
    freeGradTo:    'rgba(201,160,64,0.32)',
    friendBg:      'rgba(27,94,59,0.16)',
    todayOutline:  'rgba(201,160,64,0.6)',
    legendText:    'rgba(27,94,59,0.50)',
    legendSwatch:  'rgba(201,160,64,0.35)',
    friendDotMine: '#C9A040',
    friendDot:     '#1B5E3B',
  }
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [mine, setMine] = useState([])
  const [friendsAvail, setFriendsAvail] = useState([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  // Track the most-recently toggled day so we can pop a brief
  // scale animation on the cell as it flips state. Cleared after
  // the animation duration so the next toggle re-fires it.
  const [lastToggled, setLastToggled] = useState(null)

  const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (friendView) {
        const data = await api(`/api/availability/user/${viewUserId}?month=${monthKey}`)
        setMine((data.dates ?? []).map(r => r.date.slice(0, 10)))
        setFriendsAvail([])
      } else {
        const data = await api(`/api/availability?month=${monthKey}`)
        setMine((data.mine ?? []).map(r => r.date.slice(0, 10)))
        // selfOnly suppresses the social layer entirely.
        setFriendsAvail(selfOnly ? [] : (data.friends ?? []))
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [monthKey, selfOnly, friendView, viewUserId])

  useEffect(() => { load() }, [load])

  async function toggleDate(ymd) {
    setToggling(ymd)
    try {
      await post('/api/availability', { date: ymd })
      setMine(prev => prev.includes(ymd) ? prev.filter(d => d !== ymd) : [...prev, ymd])
      // Pop the cell briefly so the user sees the state change land.
      setLastToggled(ymd)
      setTimeout(() => setLastToggled(curr => curr === ymd ? null : curr), 260)
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

  // Confirmed-game lookup for tee-time flag rendering on the grid.
  // Set built once per render so the per-cell check is O(1). YMDs only.
  const gameDateSet = (() => {
    const s = new Set()
    for (const d of (gameDates || [])) {
      if (typeof d === 'string') s.add(d.slice(0, 10))
    }
    return s
  })()

  // Stats chip beside the month name. Reads from the same `mine` and
  // `friendsAvail` arrays the grid is rendering — no extra fetches.
  // "FREE" = how many days I've marked free in the viewed month.
  // "OVERLAPS" = how many of those days have at least one friend free.
  const myDaySet = new Set(mine)
  const friendDaySet = new Set(friendsAvail.map(f => f.date?.slice(0, 10)))
  const freeCount = mine.length
  const overlapCount = [...myDaySet].filter(d => friendDaySet.has(d)).length

  // Smart insight — the soonest future date where I'm free AND at
  // least one friend is also free. Powers the "NEXT MATCH OPPORTUNITY"
  // banner (item 1) so the calendar reads as an active matchmaker
  // instead of a passive grid. (2026-05-02)
  const todayY = todayYMD()
  const nextOverlap = (() => {
    const candidates = mine
      .filter(d => d >= todayY)
      .map(d => ({ ymd: d, friends: friendsOnDate(d) }))
      .filter(c => c.friends.length > 0)
      .sort((a, b) => a.ymd.localeCompare(b.ymd))
    return candidates[0] || null
  })()

  // Friendly date label — "Today", "Tomorrow", or "Sat May 9".
  function bannerDateLabel(ymd) {
    if (ymd === todayY) return 'Today'
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const tymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (ymd === tymd) return 'Tomorrow'
    return new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
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
        color: C.headingColor, fontSize: 12, letterSpacing: '0.1em', fontWeight: 800,
        marginBottom: 10,
        background: C.headingBg, padding: '4px 10px', borderRadius: 6,
        display: 'inline-block', textShadow: C.headingShadow,
      }}>
        AVAILABILITY CALENDAR
      </div>

      <div style={{
        background: C.cardBg, border: C.cardBorder,
        borderRadius: 22, overflow: 'hidden',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        position: 'relative',
      }}>
        {/* Augusta gold accent strip across the top of the card —
            same vocabulary as the ProfileHeroCard's top-of-card
            gradient. (item 4 — Augusta polish on the chrome) */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.7), rgba(232,192,90,1.0), rgba(201,160,64,0.7), transparent)',
        }} />

        {/* Month navigation — month name in Georgia gold gradient,
            stats chip beside it surfaces the intelligence the calendar
            already has (FREE · OVERLAPS) so it reads as a smart
            companion not a passive grid. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 10px', borderBottom: `1px solid ${C.divider}`,
          gap: 10,
        }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: C.monthArrow, cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}>‹</button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
            <span style={{
              fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em',
              fontFamily: '"Georgia", serif',
              background: 'linear-gradient(135deg, #A07828, #C9A040, #E8C05A)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text', lineHeight: 1.1,
            }}>{monthName}</span>
            {!friendView && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
                color: dark ? 'rgba(245,215,138,0.65)' : '#7A5800',
              }}>
                {freeCount} FREE{!selfOnly ? ` · ${overlapCount} OVERLAP${overlapCount === 1 ? '' : 'S'}` : ''}
              </span>
            )}
          </div>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: C.monthArrow, cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}>›</button>
        </div>

        {/* Smart insight banner — surfaces the soonest future overlap
            day so the calendar acts like a matchmaker. Tapping opens
            the DaySheet for that date so the user can hit "Schedule a
            Group Match" without scanning the grid. Hides when there's
            nothing actionable, in friend-view, or self-only mode.
            (item 1 — smart insight banner) */}
        {!friendView && !selfOnly && nextOverlap && (
          <button
            onClick={() => setSelectedDay(nextOverlap.ymd)}
            style={{
              width: '100%',
              background: dark
                ? 'linear-gradient(135deg, rgba(245,215,138,0.14), rgba(245,215,138,0.05))'
                : 'linear-gradient(135deg, rgba(201,160,64,0.20), rgba(201,160,64,0.08))',
              border: 'none',
              borderBottom: `1px solid ${C.divider}`,
              padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between',
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 9, letterSpacing: '0.18em', fontWeight: 800,
                color: dark ? 'rgba(245,215,138,0.85)' : '#7A5800',
                marginBottom: 3,
              }}>NEXT MATCH OPPORTUNITY</div>
              <div style={{
                fontSize: 13, fontWeight: 700,
                color: dark ? '#fff' : '#0D1F12',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {bannerDateLabel(nextOverlap.ymd)} — {nextOverlap.friends.length} {nextOverlap.friends.length === 1 ? 'friend' : 'friends'} free with you
              </div>
            </div>
            <span style={{
              background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
              color: '#070C09', borderRadius: 8, fontSize: 11, fontWeight: 800,
              padding: '7px 12px', letterSpacing: '0.04em',
              flexShrink: 0,
            }}>
              Schedule →
            </span>
          </button>
        )}

        {/* Day labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '8px 8px 0' }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', color: C.dayLabel, fontSize: 10, paddingBottom: 4 }}>{d}</div>
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
            const hasGame = gameDateSet.has(ymd)
            const justToggled = lastToggled === ymd

            // Today's gold double-ring — gold outer + cream inner gap.
            // Stacked behind the cell with a slight inset to look like
            // a proper trophy ring, not a 1-pixel outline.
            const todayShadow = isToday
              ? `0 0 0 1.5px rgba(255,253,248,0.85), 0 0 0 3px ${C.todayOutline}`
              : 'none'

            return (
              <button
                key={ymd}
                onClick={() => {
                  if (isPast) return
                  if (friendView) onDayTap?.(ymd)
                  else setSelectedDay(ymd)
                }}
                disabled={isPast}
                style={{
                  position: 'relative',
                  aspectRatio: '1', border: 'none', borderRadius: 8, cursor: isPast ? 'default' : 'pointer',
                  background: isMine
                    ? `linear-gradient(135deg, ${C.freeGradFrom}, ${C.freeGradTo})`
                    : hasFriend
                      ? C.friendBg
                      : 'transparent',
                  boxShadow: todayShadow,
                  color: isPast ? C.pastText : isMine ? C.freeText : C.dayText,
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  // Pop on toggle — scale 1.08 briefly then settle. Combined
                  // with the bg transition this gives the cell a tactile
                  // "landed" feel. (item 5 — animated dot transitions)
                  transform: justToggled ? 'scale(1.08)' : 'scale(1)',
                  transition: 'background 180ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                  padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: 1,
                }}
              >
                {/* Game flag — top-right corner when there's a confirmed
                    tee time on this date. The brand-mark golf flag in
                    miniature. (item 3 — match flags on game days) */}
                {hasGame && !isPast && (
                  <svg
                    width="9" height="9" viewBox="0 0 64 64"
                    style={{ position: 'absolute', top: 3, right: 3, pointerEvents: 'none' }}
                    fill="none" stroke={dark ? '#F5D78A' : '#1B5E3B'}
                    strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="8" x2="22" y2="54"/>
                    <path d="M22 10 L52 17 L22 24 Z" fill={dark ? '#F5D78A' : '#1B5E3B'} stroke={dark ? '#F5D78A' : '#1B5E3B'} />
                  </svg>
                )}
                {day}
                {hasFriend && !isPast && (
                  /* Stacked friend avatars — replaces the single 4px
                     dot. Up to 2 small initial-circles overlapping by
                     3px, with a "+N" tail when more friends are free.
                     Way more personal than a generic dot — you can
                     see WHO is free at a glance. (item 2 — better
                     friend visualization) */
                  <div style={{
                    position: 'absolute', bottom: 2,
                    display: 'flex', alignItems: 'center',
                    transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                    transform: justToggled ? 'scale(1.25)' : 'scale(1)',
                  }}>
                    {friends.slice(0, 2).map((f, idx) => {
                      const initial = (f.name || '?').trim().charAt(0).toUpperCase() || '?'
                      return (
                        <div key={f.user_id ?? `${f.name}-${idx}`} style={{
                          width: 11, height: 11, borderRadius: '50%',
                          background: isMine ? C.friendDotMine : C.friendDot,
                          color: dark ? '#0D1F12' : '#fff',
                          fontSize: 7, fontWeight: 800, lineHeight: 1,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          marginLeft: idx > 0 ? -3 : 0,
                          border: `1px solid ${dark ? 'rgba(13,31,18,0.55)' : 'rgba(255,253,248,0.95)'}`,
                          boxSizing: 'border-box',
                        }}>{initial}</div>
                      )
                    })}
                    {friends.length > 2 && (
                      <span style={{
                        fontSize: 7, fontWeight: 800, lineHeight: 1,
                        color: isMine ? C.friendDotMine : C.friendDot,
                        marginLeft: 2, letterSpacing: '0.02em',
                      }}>+{friends.length - 2}</span>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 14, padding: '8px 16px 12px',
          borderTop: `1px solid ${C.divider}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: C.legendSwatch }} />
            <span style={{ color: C.legendText, fontSize: 10 }}>
              {friendView ? `${viewUserName || 'They'}'re free` : "You're free"}
            </span>
          </div>
          {!selfOnly && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.friendDot }} />
              <span style={{ color: C.legendText, fontSize: 10 }}>Friends available</span>
            </div>
          )}
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
              // Pop the cell so the user sees the state change land
              // when they come back from the DaySheet. (item 5 —
              // animated dot transitions)
              setLastToggled(ymd)
              setTimeout(() => setLastToggled(curr => curr === ymd ? null : curr), 260)
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
  // Tee time as "HH:MM" — uses the native <input type="time"> picker.
  // (2026-05-01 — Matt's rule: a game stays in Awaiting until a time
  // is pinned. PlanSheet now sets both course AND time.)
  const [time, setTime]     = useState(game.start_time ? game.start_time.slice(0, 5) : '')
  const [saving, setSaving] = useState(false)

  // Course typeahead — reuses /api/courses/search (GolfCourseAPI). Sorts
  // results by distance when geolocation resolves so the closest courses
  // float to the top. (2026-05-01 — Matt: "auto-populate as you type
  // courses closest to you")
  const [coords, setCoords]           = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [searching, setSearching]     = useState(false)
  const [picked, setPicked]           = useState(!!game.course_name) // suppress dropdown right after a click

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* denied / unavailable — search still works without distance sort */ },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60 * 1000 }
    )
  }, [])

  useEffect(() => {
    if (picked) return
    const q = course.trim()
    if (q.length < 2) { setSuggestions([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q })
        if (coords) {
          params.set('lat', String(coords.lat))
          params.set('lng', String(coords.lng))
        }
        const res = await api(`/api/courses/search?${params.toString()}`)
        setSuggestions(Array.isArray(res?.courses) ? res.courses.slice(0, 6) : [])
      } catch {
        setSuggestions([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [course, coords, picked])

  function pickSuggestion(c) {
    const name = c.club_name || c.course_name || ''
    setCourse(name)
    setSuggestions([])
    setPicked(true)
  }

  async function save() {
    if (!course.trim() && !time) return
    setSaving(true)
    try {
      const trimmed = course.trim()
      const tasks = []
      if (trimmed && trimmed !== (game.course_name || '')) {
        tasks.push(put(`/api/games/${game.id}/course`, { course_name: trimmed }))
      }
      if (time && time !== (game.start_time ? game.start_time.slice(0, 5) : '')) {
        tasks.push(put(`/api/games/${game.id}/time`, { start_time: time }))
      }
      await Promise.all(tasks)
      onCourseSaved(game.id, trimmed || game.course_name, time || game.start_time)
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

        {/* Course input + typeahead dropdown */}
        <div style={{ marginBottom: 12, position: 'relative' }}>
          <div style={{ color: 'rgba(13,31,18,0.55)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 8, fontWeight: 700 }}>
            {game.course_name ? 'CHANGE COURSE' : 'SET COURSE'}
          </div>
          <input
            autoFocus
            value={course}
            onChange={e => { setCourse(e.target.value); setPicked(false) }}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="Start typing a course…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(27,94,59,0.04)', border: '1px solid rgba(27,94,59,0.18)',
              borderRadius: 12, color: '#0D1F12', padding: '13px 16px', fontSize: 15, outline: 'none',
            }}
          />
          {!picked && course.trim().length >= 2 && (suggestions.length > 0 || searching) && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5,
              marginTop: 4,
              background: '#FFFFFF',
              border: '1px solid rgba(27,94,59,0.18)',
              borderRadius: 12,
              boxShadow: '0 8px 28px rgba(0,0,0,0.16)',
              overflow: 'hidden',
              maxHeight: 240, overflowY: 'auto',
            }}>
              {searching && suggestions.length === 0 && (
                <div style={{ padding: '12px 14px', color: 'rgba(13,31,18,0.45)', fontSize: 12 }}>
                  Searching…
                </div>
              )}
              {suggestions.map((c, i) => {
                const name = c.club_name || c.course_name || ''
                const where = [c.city, c.state].filter(Boolean).join(', ')
                const distMi = Number.isFinite(c.distance_km) ? c.distance_km * 0.621371 : null
                const dist = distMi != null
                  ? `${distMi.toFixed(distMi < 10 ? 1 : 0)} mi`
                  : null
                return (
                  <button
                    key={c.id ?? i}
                    type="button"
                    onClick={() => pickSuggestion(c)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px',
                      background: i % 2 === 0 ? '#FFFFFF' : 'rgba(27,94,59,0.03)',
                      border: 'none', textAlign: 'left', cursor: 'pointer',
                      borderBottom: i < suggestions.length - 1 ? '1px solid rgba(27,94,59,0.08)' : 'none',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0D1F12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </div>
                      {where && (
                        <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.50)', marginTop: 2 }}>
                          {where}
                        </div>
                      )}
                    </div>
                    {dist && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: '#1B5E3B',
                        background: 'rgba(27,94,59,0.08)', padding: '3px 8px', borderRadius: 999,
                        flexShrink: 0,
                      }}>{dist}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Tee-time input */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'rgba(13,31,18,0.55)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 8, fontWeight: 700 }}>
            {game.start_time ? 'CHANGE TEE TIME' : 'SET TEE TIME'}
          </div>
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(27,94,59,0.04)', border: '1px solid rgba(27,94,59,0.18)',
              borderRadius: 12, color: '#0D1F12', padding: '13px 16px', fontSize: 15, outline: 'none',
            }}
          />
        </div>

        <button onClick={save} disabled={saving || (!course.trim() && !time)} style={{
          width: '100%', padding: '14px',
          background: (course.trim() || time) ? 'linear-gradient(135deg, #F5D78A, #C9A040)' : 'rgba(27,94,59,0.07)',
          color: (course.trim() || time) ? '#070C09' : 'rgba(13,31,18,0.3)',
          border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
          cursor: (course.trim() || time) ? 'pointer' : 'default', transition: 'all 0.15s',
        }}>{saving ? 'Saving…' : 'Lock It In'}</button>
      </div>
    </div>,
    document.body
  )
}

function UpcomingTeeTimes({ games, onPlan, onRefresh, onCreateMatch, onSelectFriend, userId }) {
  const [broadcasting, setBroadcasting] = useState({}) // { [gameId]: 'sending'|'sent' }
  // 2026-05-01 — Matt's rule: "upcoming tee times must be set with a
  // tee time in order to populate in upcoming." A tm_games row without
  // a start_time isn't really a confirmed booking yet, even if the
  // current user accepted. Those rows still exist (shareable plans
  // someone hasn't pinned a time on, or partially-replied invites)
  // — they should live elsewhere, not here.
  const realGames = (games || []).filter(g => !!g.start_time)
  // Outgoing tee-requests no longer render here — they have their own
  // SentRequests section. Upcoming now means actually-confirmed games.
  if (realGames.length === 0) return null

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
        }}>{realGames.length}</span>
      </div>

      {/* Per-card "#N of M" counter when multiple same-day matches lack
          start_time. Time-of-day is the primary disambiguator post-
          migration-005; this is the legacy-row fallback. (F-R6A) */}
      {realGames.map((g, gIdx, gArr) => {
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

    </div>
  )
}

// ─── Awaiting Tee Time ────────────────────────────────────────────────────────
// Matt 2026-05-01 rule: any outgoing request OR acceptance stays here
// until a tee time is pinned. Once start_time is set, the row moves to
// Upcoming Tee Times. Two card kinds:
//   • Outgoing tm_tee_time_requests (pending or accepted, not declined)
//   • tm_games rows where I'm in but no start_time has been set yet
function AwaitingTeeTime({ requests = [], games = [], userId, onPlan }) {
  // Outgoing tee-time requests: keep pending + accepted, drop declined.
  const outgoing = requests.filter(r => r.status !== 'declined')
  // Time-less games I'm part of (regardless of who created).
  const timeless = games.filter(g => !g.start_time)
  const total = outgoing.length + timeless.length
  if (total === 0) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          color: '#7A5800', fontSize: 12, letterSpacing: '0.1em', fontWeight: 800,
          background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
          textShadow: '0 1px 1px rgba(255,255,255,0.4)',
        }}>
          AWAITING TEE TIME
        </div>
        <span style={{
          background: '#C9A040', color: '#FFFFFF',
          borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px',
        }}>{total}</span>
      </div>

      {/* Time-less tm_games — actionable cards with a "Set Tee Time" CTA. */}
      {timeless.map(g => {
        const dateLabel = new Date(g.date + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
        })
        const accepted = (g.participants || []).filter(p => p.status === 'accepted')
        const pending  = (g.participants || []).filter(p => p.status === 'pending')
        const isOrganizer = String(g.created_by) === String(userId)
        const otherAccepted = accepted.filter(p => String(p.user_id) !== String(userId))
        const stateLabel = pending.length > 0
          ? `Awaiting ${pending.length} ${pending.length === 1 ? 'reply' : 'replies'}`
          : 'Everyone confirmed — set a time'
        return (
          <div key={`g-${g.id}`} style={{
            background: 'rgba(255,255,255,0.78)',
            border: '2px solid rgba(201,160,64,0.70)',
            borderRadius: 14, padding: '14px 16px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                color: '#7A5800', background: 'rgba(201,160,64,0.10)',
                borderRadius: 5, padding: '2px 7px',
              }}>{isOrganizer ? 'YOU INVITED' : 'YOU ACCEPTED'}</span>
              <span style={{ color: '#7A5800', fontSize: 12, fontWeight: 600 }}>{dateLabel}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: '#0D1F12' }}>
              {otherAccepted.length > 0
                ? otherAccepted.map(p => p.name).join(', ')
                : (g.organizer_name || 'Match')}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(27,94,59,0.55)', marginBottom: 10 }}>
              {stateLabel}{g.course_name ? ` · ${g.course_name}` : ''}
            </div>
            <button onClick={() => onPlan?.(g)} style={{
              width: '100%',
              background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
              border: 'none', borderRadius: 10, color: '#070C09',
              fontSize: 13, fontWeight: 700, padding: '9px',
              cursor: 'pointer',
            }}>Set Tee Time</button>
          </div>
        )
      })}

      {/* Outgoing tm_tee_time_requests — quieter, no inline CTA yet
          (those don't auto-create a tm_games row when accepted, so
          there's no row to set a time on). Future work to bridge. */}
      {outgoing.map(tr => {
        const dateLabel = new Date(tr.date + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
        })
        const accepted = tr.status === 'accepted'
        return (
          <div key={`tr-${tr.id}`} style={{
            background: 'rgba(255,255,255,0.78)',
            border: '2px solid rgba(201,160,64,0.70)',
            borderRadius: 14, padding: '14px 16px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                color: accepted ? '#1B5E3B' : '#7A5800',
                background: accepted ? 'rgba(27,94,59,0.10)' : 'rgba(201,160,64,0.10)',
                borderRadius: 5, padding: '2px 7px',
              }}>{accepted ? 'ACCEPTED · COORDINATE TIME' : 'WAITING FOR REPLY'}</span>
              <span style={{ color: '#7A5800', fontSize: 12, fontWeight: 600 }}>{dateLabel}</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              <span style={{ color: '#C9A040' }}>{tr.to_name}</span>
              <span style={{ color: 'rgba(27,94,59,0.45)', fontSize: 12, fontWeight: 400 }}>
                {accepted ? ' is in — agree on a tee time' : " hasn't responded yet"}
              </span>
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
  // 2026-05-01 — Matt: keep the inbox visible even when empty so users
  // know it's there. Show a quiet "No invites at this time" placeholder
  // instead of hiding the section.
  const empty = totalCount === 0

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Heading pill — matches UPCOMING / AWAITING styling so it
          stays legible against the textured page background. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          color: '#1B5E3B', fontSize: 12, letterSpacing: '0.1em', fontWeight: 800,
          background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
          textShadow: '0 1px 1px rgba(255,255,255,0.4)',
        }}>
          INVITES
        </div>
        <span style={{
          background: empty ? 'rgba(27,94,59,0.55)' : '#C9A040',
          color: '#FFFFFF',
          borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px',
        }}>{totalCount}</span>
      </div>

      {empty && (
        <div style={{
          borderRadius: 16,
          background: 'linear-gradient(135deg, #FFFFFF 0%, #F2EEE6 100%)',
          border: '2px solid rgba(201,160,64,0.70)',
          boxShadow: '0 2px 20px rgba(201,160,64,0.22)',
          padding: '14px 18px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          {/* Envelope icon — visual peer to GolfNow's calendar icon. */}
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: 'rgba(27,94,59,0.14)', border: '1.5px solid rgba(27,94,59,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1B5E3B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#0D1F12', fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>
              No invites at this time
            </div>
            <div style={{ color: 'rgba(13,31,18,0.55)', fontSize: 11, fontWeight: 500, marginTop: 3 }}>
              Match requests from friends will land here
            </div>
          </div>
        </div>
      )}

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
          <span style={{ color: '#0D1F12', fontSize: 16, fontWeight: 700 }}>Add Playing Partner</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(13,31,18,0.45)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* Search input */}
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
            width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(13,31,18,0.40)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            autoFocus
            value={query}
            onChange={e => handleQuery(e.target.value)}
            placeholder="Search by name or email…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(27,94,59,0.04)', border: '1px solid rgba(27,94,59,0.15)',
              borderRadius: 12, color: '#0D1F12', padding: '12px 14px 12px 38px',
              fontSize: 14, outline: 'none',
            }}
          />
          {searching && (
            <svg style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(13,31,18,0.45)" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          )}
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {results.length === 0 && query.trim().length >= 2 && !searching && (
            <div style={{ color: 'rgba(13,31,18,0.45)', fontSize: 13, textAlign: 'center', paddingTop: 24 }}>
              No players found
            </div>
          )}
          {query.trim().length < 2 && (
            <div style={{ color: 'rgba(13,31,18,0.40)', fontSize: 12, textAlign: 'center', paddingTop: 24 }}>
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
                padding: '12px 4px', borderBottom: '1px solid rgba(27,94,59,0.08)',
                gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ color: '#0D1F12', fontSize: 14, fontWeight: 600 }}>{u.name}</span>
                    {hcp && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: '#7A5800',
                        background: 'rgba(201,160,64,0.14)', borderRadius: 5,
                        padding: '1px 6px', letterSpacing: '0.04em',
                      }}>HCP {hcp}</span>
                    )}
                  </div>
                  {u.home_course && (
                    <div style={{ color: 'rgba(13,31,18,0.55)', fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {u.home_course}
                    </div>
                  )}
                </div>
                {alreadyFriend ? (
                  <span style={{ color: '#7A5800', fontSize: 11, fontWeight: 600 }}>Friends</span>
                ) : alreadyPending ? (
                  <span style={{ color: '#7A5800', fontSize: 11, fontWeight: 600 }}>Requested</span>
                ) : state === 'error' ? (
                  <span style={{ color: '#B91C1C', fontSize: 11 }}>Error</span>
                ) : (
                  <button onClick={() => sendRequest(u)} disabled={state === 'sending'} style={{
                    background: 'linear-gradient(135deg, #1A6B28, #2E9E45)',
                    border: 'none',
                    borderRadius: 9, color: '#fff', fontSize: 12, fontWeight: 700,
                    padding: '6px 14px', cursor: 'pointer', flexShrink: 0,
                    opacity: state === 'sending' ? 0.5 : 1,
                    boxShadow: '0 1px 6px rgba(46,158,69,0.25)',
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
function ProfileView({ user, season, avg3, streak, stats, rounds, rivalries = [], followCounts, onCountsChange, onBack, onEditProfile, onOpenCard, onOpenFriend }) {
  // Golf handicap display convention (matches HcpBadge):
  //   high cap (≥0)  → "17.0"  (no prefix)
  //   plus cap (<0)  → "+3.5"  (sign added because the player gives back strokes)
  // Coerce to Number — NUMERIC(4,1) arrives as a string from pg.
  // Prefer stats.handicap (calculated from the user's last 5+ rounds)
  // over user.handicap (seeded onboarding value) so the header here
  // matches HcpBadge below — they used to disagree (18 vs 15.5) once
  // the calculated index switched in. (2026-05-01 — Matt)
  const rawHcp = stats?.handicap ?? user?.handicap
  const hcpNum = rawHcp == null ? null : Number(rawHcp)
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
  // 2026-05-06 (polish task #10) — Year-end recap share-card modal.
  const [yearRecapOpen, setYearRecapOpen] = useState(false)

  return (
    <div style={{ minHeight: '100dvh', background: 'transparent', paddingBottom: 100 }}>
      {/* First-time coach mark on the Profile screen — explains the
          four major features the user lands on (handicap chart, follow
          counts, rivalries, availability calendar). Only shows once
          per user; persisted via /api/onboarding/coach-mark. */}
      <CoachMark
        id="profile"
        user={user}
        title="Your profile, in pieces"
        body="The big number at top is your handicap index — auto-recalculates from your last 20 rounds (5+ needed). The Following / Followers / Mutuals pills tap into a list of those users. Rivalries shows your head-to-head records vs friends with avg score comparisons. Calendar at the bottom = your availability — tap dates you're free and friends can request matches."
      />
      {/* Top bar — wordmark synced with the Home page version: 26px
          Georgia serif gold-gradient, no breathing glow, no radial
          halo. (Matt: 'make The Match at the top of my profile the
          same as the match on home page.') */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '56px 20px 6px', gap: 12,
      }}>
        <button onClick={onBack} aria-label="Back" style={{
          background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.14)',
          borderRadius: 10, color: '#1B5E3B', fontSize: 18, fontWeight: 700,
          padding: '4px 12px', cursor: 'pointer', lineHeight: 1, height: 32,
          display: 'inline-flex', alignItems: 'center',
        }}>←</button>
        <div style={{
          fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em',
          background: 'linear-gradient(180deg, #B58E33 0%, #F8DE91 32%, #E8C05A 58%, #8A6B28 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          fontFamily: '"Georgia", serif',
          flex: 1, textAlign: 'center',
        }}>The Match</div>
        <button onClick={onEditProfile} style={{
          background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.14)',
          borderRadius: 10, color: '#1B5E3B', fontSize: 12,
          padding: '7px 12px', cursor: 'pointer',
        }}>Edit</button>
      </div>

      {/* Editorial hairline divider — same gold + tiny diamond as the
          Home page. Sized to occupy exactly the 6px we shaved off the
          top bar's padding-bottom (was 12, now 6) so nothing below
          this point shifts position. (2026-05-02) */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: '0 20px',
      }}>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.45))' }} />
        <svg width="6" height="6" viewBox="0 0 6 6"><polygon points="3,0 6,3 3,6 0,3" fill="#C9A040" /></svg>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(201,160,64,0.45), transparent)' }} />
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
                  fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em',
                  lineHeight: 1.1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontFamily: '"Georgia", serif',
                  background: 'linear-gradient(135deg, #A07828, #C9A040, #E8C05A)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>{user?.name ?? '—'}</div>

                {user?.handle && (
                  <div style={{ color: 'rgba(245,215,138,0.65)', fontSize: 12, fontWeight: 600, letterSpacing: '0.01em' }}>
                    @{user.handle}
                  </div>
                )}

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
                    background: 'linear-gradient(180deg, #B58E33 0%, #F8DE91 32%, #E8C05A 58%, #8A6B28 100%)',
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

        {/* 2026-05-06 (polish task #5) — Achievements row. Renders the
            user's earned badges (first eagle, sub-80, three-round
            week). Hidden-loading + empty-with-personality + populated
            states all baked in. Listens to the global achievement
            event so a fresh unlock during this session refreshes the
            row without a page reload. */}
        <AchievementsRow />

        {/* 2026-05-06 (polish task #10) — Year-end recap entry.
            Opens a Canvas-rendered share card with the user's full-
            year stats. Defaults to the current year. */}
        <button onClick={() => setYearRecapOpen(true)} style={{
          width: '100%', padding: '12px 16px', marginBottom: 12,
          borderRadius: 14,
          background: 'linear-gradient(135deg, rgba(245,215,138,0.12) 0%, rgba(201,160,64,0.18) 100%)',
          border: '1px solid rgba(232,192,90,0.40)',
          color: '#F5D78A', fontWeight: 800, fontSize: 13,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            Your year in golf — {new Date().getFullYear()}
          </span>
          <span style={{ fontSize: 12, color: 'rgba(232,192,90,0.65)' }}>Share →</span>
        </button>

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

        {/* My Availability — selfOnly hides friends' availability so this
            stays a personal calendar. theme=dark matches the rest of
            the profile body (Recent Rounds, Distances). The Home view
            still renders the social version with friends' free days
            in the original light theme. (2026-05-01) */}
        <div style={{ marginTop: 24 }}>
          <AvailabilityCalendar uid={user?.id} selfOnly theme="dark" />
        </div>
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
          onSelectOpponent={onOpenFriend ? (opp) => {
            setSelectedRivalry(null)
            onOpenFriend(opp)
          } : undefined}
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
          onSelectOpponent={onOpenFriend}
          onClose={() => setRivalriesOpen(false)}
        />
      )}

      {/* 2026-05-06 (polish task #10) — Year-end recap modal mount. */}
      {yearRecapOpen && (
        <YearRecapModal onClose={() => setYearRecapOpen(false)} />
      )}
    </div>
  )
}

// ─── UserSearchModal — global user search by name/email/handle ───────────────
//
// Triggered by the magnifying glass next to "My Profile" in the Home
// top bar. Uses the existing /api/friends/search endpoint (which
// already searches LOWER(name) + LOWER(email) and returns
// friend_status). Tapping a result opens FriendProfile via the
// onSelectUser callback so the user can browse anyone.
// (2026-05-01 — Matt: magnifying glass next to profile.)
function UserSearchModal({ onSelectUser, onClose }) {
  const [query, setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-focus on mount so the keyboard pops on iOS without an extra tap.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 220)
    return () => clearTimeout(t)
  }, [])

  function handleQuery(val) {
    setQuery(val)
    clearTimeout(debounceRef.current)
    if (val.trim().length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await api(`/api/friends/search?q=${encodeURIComponent(val.trim())}`)
        setResults(Array.isArray(r) ? r : [])
      } catch { setResults([]) }
      setSearching(false)
    }, 300)
  }

  // Tiny status pill on the right of each row reflecting the friendship
  // state with the searcher.
  function statusPill(s) {
    if (s === 'accepted') return { label: 'Friends',  bg: 'rgba(74,222,128,0.16)', color: '#5ED47A', border: 'rgba(74,222,128,0.40)' }
    if (s === 'pending')  return { label: 'Pending',  bg: 'rgba(245,215,138,0.16)', color: '#F5D78A', border: 'rgba(245,215,138,0.40)' }
    if (s === 'declined') return { label: 'Declined', bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: 'rgba(255,255,255,0.18)' }
    return null
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end',
        animation: 'tm-fade-in 180ms ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 430, margin: '0 auto',
          background: 'linear-gradient(180deg, #11201A 0%, #0A1410 100%)',
          borderRadius: '24px 24px 0 0',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
          animation: 'tm-slide-up 280ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
        </div>
        {/* Header + search input */}
        <div style={{ padding: '4px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 19, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>
              Search Players
            </div>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 999, width: 32, height: 32, color: '#fff', fontSize: 18, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>✕</button>
          </div>
          <div style={{
            position: 'relative',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 12, padding: '10px 12px 10px 38px',
            display: 'flex', alignItems: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="rgba(255,255,255,0.45)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }}>
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={e => handleQuery(e.target.value)}
              placeholder="Name or email…"
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: '#fff', fontSize: 14, fontWeight: 500,
              }}
            />
            {query && (
              <button onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }} aria-label="Clear" style={{
                background: 'rgba(255,255,255,0.10)', border: 'none',
                borderRadius: 999, width: 20, height: 20, color: '#fff',
                fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>✕</button>
            )}
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 28px' }}>
          {query.trim().length < 2 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255,255,255,0.45)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Type to search</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Find any golfer by name or email.</div>
            </div>
          ) : searching ? (
            <div style={{ textAlign: 'center', padding: '24px', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255,255,255,0.45)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>No players found</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Try a different name or email.</div>
            </div>
          ) : (
            results.map(u => {
              const pill = statusPill(u.friend_status)
              const hcp  = u.handicap == null ? null : Number(u.handicap)
              const hcpStr = !Number.isFinite(hcp) ? null : hcp >= 0 ? `${hcp.toFixed(1)} hcp` : `+${Math.abs(hcp).toFixed(1)} hcp`
              return (
                <button
                  key={u.id}
                  onClick={() => onSelectUser?.(u)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                    padding: '12px 14px', borderRadius: 12, marginBottom: 8,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'rgba(245,215,138,0.18)',
                    border: '1px solid rgba(245,215,138,0.40)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#F5D78A', fontSize: 15, fontWeight: 800, flexShrink: 0,
                  }}>{(u.name || '?').slice(0,1).toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.name}
                      </span>
                      {u.handle && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(245,215,138,0.65)', whiteSpace: 'nowrap' }}>
                          @{u.handle}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.50)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[hcpStr, u.home_course].filter(Boolean).join(' · ') || u.email}
                    </div>
                  </div>
                  {pill && (
                    <span style={{
                      background: pill.bg, color: pill.color, border: `1px solid ${pill.border}`,
                      borderRadius: 999, padding: '3px 10px',
                      fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}>{pill.label}</span>
                  )}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="rgba(255,255,255,0.30)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── NotificationsModal — slide-up popup of all pending items ────────────────
//
// Triggered by the mailbox in the ProfileHeroCard. Aggregates three
// existing sources into one inbox surface so users have one place to
// triage everything that's waiting on them:
//   1. Pending incoming friend requests
//   2. Pending incoming match invites
//   3. Pending incoming tee-time requests
//
// Accept/Decline handlers are passed in from Home — they call the same
// /api/*/respond endpoints the per-section UIs already use, so this
// modal is purely a re-presentation layer (no new state).
// (2026-05-01 — Matt: mailbox in the header.)
function NotificationsModal({
  user,
  friendRequests = [],
  gameInvites = [],
  teeRequests = [],
  onFriendRespond,
  onGameRespond,
  onTeeRespond,
  onSelectFriend,
  onClose,
  // followBackPrompts: Set<requestId> of incoming requests the user
  // just accepted from EITHER this modal or the in-page REQUESTS box.
  // When a row's id is in this set, render Follow back? / Not now
  // instead of Accept / ✕. Mirrors the same UX from the REQUESTS box
  // so the "row sat there with stale Accept/✕ buttons forever" bug
  // doesn't reappear in the mailbox path. (2026-05-02 — `532e156`
  // fixed the state side but missed THIS render path.)
  followBackPrompts = new Set(),
  onFollowBack,
  onDismissFollowBackPrompt,
}) {
  const total = friendRequests.length + gameInvites.length + teeRequests.length

  // Helper to format a date string into a relative "2h ago" / "Apr 28"
  // — used as a small timestamp on each notification row.
  function whenStr(iso) {
    if (!iso) return ''
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return ''
    const ms = Date.now() - t
    const min = Math.floor(ms / 60000)
    if (min < 1)  return 'just now'
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24)  return `${hr}h ago`
    const d = Math.floor(hr / 24)
    if (d < 7)    return `${d}d ago`
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const sectionStyle = {
    marginBottom: 18,
  }
  const sectionHeader = (label, count, color) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginBottom: 10,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: '0.10em',
        color: 'rgba(255,255,255,0.55)',
      }}>{label.toUpperCase()}</div>
      <div style={{
        background: color, borderRadius: 10, padding: '1px 7px',
        fontSize: 10, fontWeight: 800, color: '#070C09',
      }}>{count}</div>
    </div>
  )
  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 14px', borderRadius: 12,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.07)',
    marginBottom: 8,
  }
  const acceptBtn = {
    padding: '6px 12px', borderRadius: 999, border: 'none',
    background: 'linear-gradient(135deg, #4ADE80, #22C55E)',
    color: '#062313', fontSize: 11, fontWeight: 800, cursor: 'pointer',
    fontFamily: 'inherit',
  }
  const declineBtn = {
    padding: '6px 10px', borderRadius: 999,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)',
    color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
    fontFamily: 'inherit',
  }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end',
        animation: 'tm-fade-in 180ms ease-out',
      }}
    >
      <style>{`
        @keyframes tm-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes tm-slide-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 430, margin: '0 auto',
          background: 'linear-gradient(180deg, #11201A 0%, #0A1410 100%)',
          borderRadius: '24px 24px 0 0',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
          animation: 'tm-slide-up 280ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
        </div>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>
              Notifications
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
              {total === 0 ? "You're all caught up" : `${total} pending`}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 999, width: 32, height: 32, color: '#fff', fontSize: 18, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 28px' }}>
          {total === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255,255,255,0.45)' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(255,255,255,0.04)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 12,
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2"/>
                  <polyline points="3 7 12 13 21 7"/>
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Inbox empty</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>New friend requests and match invites will land here.</div>
            </div>
          )}

          {/* Friend Requests */}
          {friendRequests.length > 0 && (
            <div style={sectionStyle}>
              {sectionHeader('Friend Requests', friendRequests.length, '#F5D78A')}
              {friendRequests.map(req => {
                // Two states per row, mirrors the in-page REQUESTS box:
                //   1. Default — Accept / ✕ buttons.
                //   2. Just-accepted — Follow back? / Not now buttons.
                // `followBackPrompts` is the same Set<requestId> the
                // REQUESTS box uses, so accepting from either surface
                // flips the row in both. (2026-05-02 — fix for the
                // mailbox-path miss in `532e156`.)
                const justAccepted = followBackPrompts.has(req.id)
                if (justAccepted) {
                  return (
                    <div key={`fr-${req.id}`} style={rowStyle}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'rgba(245,215,138,0.28)', border: '1px solid rgba(245,215,138,0.55)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#F5D78A', fontSize: 14, fontWeight: 800, flexShrink: 0,
                      }}>{(req.requester_name || '?').slice(0,1).toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {req.requester_name} <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>now follows you</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#F5D78A', marginTop: 2, fontWeight: 600 }}>
                          Follow back?
                        </div>
                      </div>
                      <button onClick={() => onFollowBack?.(req.id, req.requester_id)} style={acceptBtn}>Follow back</button>
                      <button onClick={() => onDismissFollowBackPrompt?.(req.id)} style={declineBtn}>×</button>
                    </div>
                  )
                }
                return (
                  <div key={`fr-${req.id}`} style={rowStyle}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'rgba(245,215,138,0.18)', border: '1px solid rgba(245,215,138,0.4)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#F5D78A', fontSize: 14, fontWeight: 800, flexShrink: 0,
                    }}>{(req.requester_name || '?').slice(0,1).toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {req.requester_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                        Wants to be friends · {whenStr(req.created_at)}
                      </div>
                    </div>
                    <button onClick={() => onFriendRespond?.(req.id, 'accepted')} style={acceptBtn}>Accept</button>
                    <button onClick={() => onFriendRespond?.(req.id, 'declined')} style={declineBtn}>×</button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Match Invites */}
          {gameInvites.length > 0 && (
            <div style={sectionStyle}>
              {sectionHeader('Match Invites', gameInvites.length, '#5ED47A')}
              {gameInvites.map(g => (
                <div key={`gi-${g.id}`} style={rowStyle}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'rgba(94,212,122,0.16)', border: '1px solid rgba(94,212,122,0.40)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5ED47A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.creator_name || 'Someone'} invited you
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                      {g.date ? new Date(g.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Date TBD'}
                      {g.course_name ? ` · ${g.course_name}` : ''}
                      {g.start_time ? ` · ${g.start_time}` : ''}
                    </div>
                  </div>
                  <button onClick={() => onGameRespond?.(g.id, 'accepted')} style={acceptBtn}>Accept</button>
                  <button onClick={() => onGameRespond?.(g.id, 'declined')} style={declineBtn}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Tee Time Requests */}
          {teeRequests.length > 0 && (
            <div style={sectionStyle}>
              {sectionHeader('Tee Time Requests', teeRequests.length, '#7FBFFF')}
              {teeRequests.map(tr => (
                <div key={`tr-${tr.id}`} style={rowStyle}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: 'rgba(127,191,255,0.16)', border: '1px solid rgba(127,191,255,0.40)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7FBFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tr.requester_name || 'Someone'} wants to play
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                      {tr.date ? new Date(tr.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : whenStr(tr.created_at)}
                    </div>
                  </div>
                  <button onClick={() => onTeeRespond?.(tr.id, 'accepted')} style={acceptBtn}>Accept</button>
                  <button onClick={() => onTeeRespond?.(tr.id, 'declined')} style={declineBtn}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function Home({ onNavigate, onNavigateToOuting }) {
  const [profile, setProfile] = useState(null)
  // outgoing: [] was missing here — caused the REQUESTS box to crash
  // on first render (friends.outgoing.length on undefined) before the
  // /api/friends fetch resolved. (2026-05-02)
  const [friends, setFriends] = useState({ friends: [], incoming: [], outgoing: [], activity: [] })
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [addFriendOpen, setAddFriendOpen] = useState(false)
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [games, setGames]               = useState({ incoming: [], confirmed: [] })
  const [teeRequests, setTeeRequests]   = useState({ incoming: [], outgoing: [] })
  const [planGame, setPlanGame]         = useState(null)
  const [createGameOpen, setCreateGameOpen] = useState(false)
  const [createGameDate, setCreateGameDate] = useState(null)
  // 2026-05-06 — "Schedule a Tee Time" sheet entry from the TEE TIMES
  // section. Distinct from createGameOpen (which goes through the
  // calendar-based flow) — this is the manual roster + push flow.
  const [showNewTeeTime, setShowNewTeeTime] = useState(false)
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
  const [followCounts, setFollowCounts] = useState({ following: 0, followers: 0 })
  // Admin-only Users modal — gated on user.role === 'admin'. Surfaced
  // by the gear icon in the home top bar. (2026-05-01)
  const [adminOpen, setAdminOpen] = useState(false)
  // Notifications inbox modal — opened by tapping the mailbox in the
  // ProfileHeroCard. Aggregates pending friend requests + match invites
  // + tee-time requests into one slide-up sheet. (2026-05-01)
  const [notifsOpen, setNotifsOpen] = useState(false)
  // User search modal — magnifying glass next to "My Profile" in the
  // top bar. Uses /api/friends/search to find any user by name/email
  // (and later, handle). Tapping a result opens FriendProfile.
  const [userSearchOpen, setUserSearchOpen] = useState(false)
  // Onboarding checklist inputs — driven by data the page already
  // fetches in loadAll(), populated alongside everything else.
  const [bagClubs, setBagClubs] = useState([])
  const [availabilityCount, setAvailabilityCount] = useState(0)
  const [matchCount, setMatchCount] = useState(0)

  const refreshFollowCounts = useCallback(async () => {
    try {
      const c = await api('/api/follows/counts')
      setFollowCounts(c ?? { following: 0, followers: 0 })
    } catch (e) { /* ignore — leave stale counts */ }
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const month = new Date().toISOString().slice(0, 7)
      const [p, f, g, tr, s, r, fc, riv, bag, av, mh] = await Promise.all([
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
        // Onboarding-checklist inputs — bag, this month's availability,
        // recent matches. Failing soft is fine; checklist just shows
        // unchecked boxes if anything errors.
        api('/api/clubs/bag').catch(() => null),
        api(`/api/availability?month=${month}`).catch(() => null),
        api('/api/outings/recent').catch(() => null),
      ])
      setProfile(p)
      setFriends(f)
      setGames(g ?? { incoming: [], confirmed: [] })
      setTeeRequests(tr ?? { incoming: [], outgoing: [] })
      setStats(s)
      setRounds(r?.rounds ?? [])
      setFollowCounts(fc ?? { following: 0, followers: 0 })
      setRivalries(riv?.rivalries ?? [])
      setBagClubs(bag?.clubs ?? [])
      setAvailabilityCount((av?.mine ?? []).length)
      setMatchCount((mh?.outings ?? []).length)
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

  // Set of incoming-request ids the user just accepted, so the row
  // stays visible with a "Follow back?" prompt before it disappears.
  // Keyed by tm_friends row id only — render pulls the requester's
  // name + id from friends.incoming itself, so the prompt works no
  // matter where Accept was tapped from (in-page card OR mailbox
  // modal). (2026-05-02 — first attempt keyed by passed-in info
  // missed the mailbox path entirely.)
  const [followBackPrompts, setFollowBackPrompts] = useState(() => new Set())

  async function handleFriendRespond(id, status) {
    // 2026-05-04 hotfix — when the user accepts a request from someone
    // they ALREADY follow (mutual handshake completing — they followed
    // first, the other person sent a request back), the "Follow back?"
    // prompt would show even though they already follow that person.
    // Look up the requester in friends.friends (the accepted-friends
    // list, deduped per friend_id by the server query); if found, skip
    // the prompt and just refresh.
    const reqRow = friends?.incoming?.find(r => String(r.id) === String(id))
    const alreadyFollowing = !!(
      reqRow && (friends?.friends || []).some(f => String(f.friend_id) === String(reqRow.requester_id))
    )

    if (status === 'accepted' && !alreadyFollowing) {
      // Keep the row visible with the Follow back? prompt; defer refetch
      // until the user dismisses or follows back.
      setFollowBackPrompts(prev => { const n = new Set(prev); n.add(id); return n })
    }
    try {
      await put(`/api/friends/${id}/respond`, { status })
      if (status !== 'accepted' || alreadyFollowing) {
        // Decline path OR already-following accept (mutual completed,
        // no prompt needed) → refresh the friends payload so the row
        // disappears from incoming.
        const f = await api('/api/friends')
        setFriends(f)
      }
      if (status === 'accepted') {
        // Accept inserts (requester → me) into tm_follows server-side,
        // so the user's Followers count goes up by 1 immediately.
        // Refresh the pills so the hero card reflects it without a
        // full reload. (2026-05-02 — Matt: counts have to update on
        // accept, not on the next page load.)
        refreshFollowCounts()
      }
    } catch {
      // On failure, undo the optimistic prompt so the row returns to
      // its original Accept / ✕ state.
      setFollowBackPrompts(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  async function handleFollowBack(reqId, targetUserId) {
    try {
      await post('/api/friends/request', { user_id: targetUserId })
    } catch { /* ignore — already-friends conflict is fine */ }
    setFollowBackPrompts(prev => { const n = new Set(prev); n.delete(reqId); return n })
    const f = await api('/api/friends')
    setFriends(f)
    // Following count won't change here (the request is pending until
    // they accept), but refresh anyway so any race-cleared state
    // recovers. Cheap call.
    refreshFollowCounts()
  }

  async function dismissFollowBackPrompt(reqId) {
    setFollowBackPrompts(prev => { const n = new Set(prev); n.delete(reqId); return n })
    const f = await api('/api/friends')
    setFriends(f)
    refreshFollowCounts()
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
          // Tap an opponent face inside a rivalry popup → open that
          // user's FriendProfile on top of this view.
          onOpenFriend={setSelectedFriend}
        />
        {/* Edit profile modal — opens from the Profile view's Edit button */}
        {editOpen && (
          <EditProfileModal user={user} onSave={handleProfileSaved} onClose={() => setEditOpen(false)} />
        )}
        {/* Player card overlay — opens from the big avatar in the header */}
        {playerCardOpen && (
          <PlayerCard onClose={() => setPlayerCardOpen(false)} userId={profile?.id} />
        )}
        {/* Friend profile portal — also rendered here so tapping an
            opponent face in a rivalry popup from My Profile opens their
            FriendProfile without bouncing back to the home view. */}
        {selectedFriend && (
          <FriendProfile
            friend={selectedFriend}
            myName={user?.name}
            confirmedGames={games.confirmed}
            onClose={() => setSelectedFriend(null)}
            onOpenFriend={(opp) => {
              // Tapping an opponent inside a friend's rivalry popup. If
              // it's me, close back to my own profile; otherwise swap to
              // the new friend in place.
              if (String(opp?.id) === String(user?.id)) setSelectedFriend(null)
              else setSelectedFriend(opp)
            }}
          />
        )}
      </>
    )
  }

  // Today's date — for the polished overline above the wordmark.
  // Format: 'FRIDAY · MAY 1' — uppercase + spaced caps for editorial feel.
  const todayStr = (() => {
    const d = new Date()
    const day = d.toLocaleDateString(undefined, { weekday: 'long' })
    const md  = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    return `${day} · ${md}`.toUpperCase()
  })()
  // Live-match indicator — count games with a real tee_time today/in-progress.
  const liveMatchCount = (games?.confirmed || []).filter(g => {
    if (g.status !== 'active' && g.status !== 'in_progress') return false
    return true
  }).length

  return (
    <div style={{
      minHeight: '100dvh',
      // Tint lives on the phone-frame parent in App.jsx now, so it
      // covers the rubber-band overscroll area too. Wrapper itself
      // is transparent so the tint isn't double-stacked.
      background: 'transparent',
      paddingBottom: 100,
    }}>
      {/* Polished page-top: TODAY overline → wordmark + actions →
          gold flourish hairline. Was just 'The Match' on a blank
          background — now reads as an editorial dashboard. */}
      <div style={{
        padding: '56px 20px 4px',
      }}>
        <div style={{
          fontSize: 9, letterSpacing: '0.30em', fontWeight: 800,
          color: 'rgba(122,88,0,0.65)',
          fontFamily: '"Arial Black", Arial, sans-serif',
          marginBottom: 6,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span>{todayStr}</span>
          {liveMatchCount > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '2px 8px', borderRadius: 999,
              background: 'rgba(46,158,69,0.12)',
              border: '1px solid rgba(46,158,69,0.45)',
              color: '#1A6B28', fontSize: 9, letterSpacing: '0.10em',
            }}>
              <span className="tm-live-pulse" style={{
                width: 6, height: 6, borderRadius: '50%', background: '#2E9E45',
              }} />
              LIVE · {liveMatchCount}
            </span>
          )}
        </div>
      </div>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px 12px',
      }}>
        <div style={{
          fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em',
          background: 'linear-gradient(180deg, #B58E33 0%, #F8DE91 32%, #E8C05A 58%, #8A6B28 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          fontFamily: '"Georgia", serif',
        }}>The Match</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Admin gear — only renders for users with role='admin'. Opens
              a modal listing every account in the system, newest first.
              (2026-05-01 — Matt: see test friends as they sign up.) */}
          {user?.role === 'admin' && (
            <button onClick={() => setAdminOpen(true)} aria-label="Admin" style={{
              background: 'linear-gradient(135deg, rgba(245,215,138,0.20), rgba(201,160,64,0.12))',
              border: '1px solid rgba(201,160,64,0.50)',
              borderRadius: 10, padding: '6px 8px', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              height: 32,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7A5800" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          )}
          {/* Magnifying glass — opens UserSearchModal. Reuses the
              /api/friends/search endpoint that AddFriendModal already
              uses, but the result here taps into FriendProfile so the
              user can browse anyone, not just friend-targets.
              (2026-05-01 — Matt: search users by name/handle.) */}
          <button onClick={() => setUserSearchOpen(true)} aria-label="Search users" style={{
            background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.14)',
            borderRadius: 10, padding: '6px 8px', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 32, width: 32,
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1B5E3B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
          <button onClick={() => setView('profile')} style={{
            background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.14)',
            borderRadius: 10, color: '#1B5E3B', fontSize: 12,
            padding: '7px 12px', cursor: 'pointer',
          }}>My Profile</button>
        </div>
      </div>
      {/* Editorial hairline divider under the page header — gold
          gradient with a tiny diamond flourish in the middle. Reads
          like a tournament-program section break. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: '0 20px', marginBottom: 12,
      }}>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.45))' }} />
        <svg width="6" height="6" viewBox="0 0 6 6"><polygon points="3,0 6,3 3,6 0,3" fill="#C9A040" /></svg>
        <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(201,160,64,0.45), transparent)' }} />
      </div>
      {adminOpen && <AdminUsersModal onClose={() => setAdminOpen(false)} />}

      {/* User search — magnifying glass next to "My Profile" in the
          top bar. Tapping a result opens FriendProfile via the
          existing selectedFriend portal. */}
      {userSearchOpen && (
        <UserSearchModal
          onSelectUser={(u) => {
            setUserSearchOpen(false)
            // FriendProfile expects { id, name, ... }; the search row
            // already has name + handicap + home_course shape.
            setSelectedFriend({ id: u.id, name: u.name, handicap: u.handicap, home_course: u.home_course })
          }}
          onClose={() => setUserSearchOpen(false)}
        />
      )}

      {/* Notifications inbox — opened by mailbox tap on the hero card.
          Sources read directly from already-loaded state; no new
          network calls. Accept/Decline handlers reuse the existing
          per-section flows so updates ripple through the rest of the
          page (FriendsPanel, GameInbox, etc.) too. */}
      {notifsOpen && (
        <NotificationsModal
          user={user}
          friendRequests={friends?.incoming || []}
          gameInvites={games?.incoming || []}
          teeRequests={teeRequests?.incoming || []}
          onFriendRespond={handleFriendRespond}
          followBackPrompts={followBackPrompts}
          onFollowBack={handleFollowBack}
          onDismissFollowBackPrompt={dismissFollowBackPrompt}
          onGameRespond={handleGameRespond}
          onTeeRespond={async (id, status) => {
            try {
              // Match the endpoint pattern used elsewhere in this file
              // (line ~3347): POST /api/availability/tee-requests/:id
              // with { status }, then refresh from /api/availability/tee-requests.
              await post(`/api/availability/tee-requests/${id}`, { status })
              const t = await api('/api/availability/tee-requests')
              setTeeRequests(t ?? { incoming: [], outgoing: [] })
            } catch { /* ignore */ }
          }}
          onClose={() => setNotifsOpen(false)}
        />
      )}

      <div style={{ padding: '0 16px' }}>
        {/* Profile hero */}
        <ProfileHeroCard
          user={user} stats={stats} season={season} avg3={avg3} streak={streak}
          followCounts={followCounts}
          onCountsChange={refreshFollowCounts}
          onStartSeason={handleStartSeason}
          onEditProfile={() => setEditOpen(true)}
          onOpenCard={() => setPlayerCardOpen(true)}
          notifCount={(friends?.incoming?.length || 0) + (games?.incoming?.length || 0) + (teeRequests?.incoming?.length || 0)}
          onOpenNotifications={() => setNotifsOpen(true)}
          bagCount={Array.isArray(bagClubs) ? bagClubs.length : 0}
          onOpenBag={() => onNavigate?.('bag')}
        />

        {/* Onboarding checklist — auto-hides once every item is checked
            or when the user dismisses it. Reads from data the page
            already loaded; no extra fetches. (2026-05-01) */}
        <OnboardingChecklist
          user={user}
          friends={friends.friends ?? []}
          clubs={bagClubs}
          availabilityCount={availabilityCount}
          matchCount={matchCount}
          onNavigate={dest => {
            if (dest === 'profile')      setView('profile')
            else if (dest === 'bag')     onNavigate?.('bag')
            else if (dest === 'match')   onNavigate?.('outing')
          }}
        />

        {/* 2026-05-06 — First-match guidance card. Shows when the user
            has finished onboarding but hasn't created or joined a match
            yet. Triggered Sean's lost-round scenario: he completed
            onboarding but bounced before scoring anything. The card is
            a quiet, dismissable nudge that tells new users where to go
            next. Tap either button → switch to the Scorecard tab. */}
        <FirstMatchCard
          user={user}
          matchCount={matchCount}
          onGoToScorecard={() => onNavigate?.('outing')}
        />

        {/* First-time coach mark on Home. Persists via /api/onboarding/
            coach-mark; only ever renders once per user. */}
        <CoachMark
          id="home"
          user={user}
          title="Welcome home"
          body="Match invites land here. Your live tee times and AWAITING-tee-time matches show up below the GolfNow card. Tap My Profile (top-right) to dial in your bag."
        />

        {/* TEE TIMES — grouped section. Wraps the GolfNow booking
            entry + UpcomingTeeTimes (confirmed games with pinned
            tee time) + AwaitingTeeTime (outgoing requests / games
            without a pinned time). One labeled box instead of three
            stand-alone cards. Wrapper styling matches the
            ProfileHeroCard's translucent-glass treatment so the two
            grouped sections feel like siblings. (2026-05-02 — Matt:
            "make it the same translucent box used for the hero card") */}
        <div style={{
          borderRadius: 22,
          background: 'rgba(255,255,255,0.22)',
          border: '1px solid rgba(255,255,255,0.45)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          padding: '14px 12px 4px',
          marginBottom: 16,
        }}>
          {/* Section header — gold flourish hairlines around a small
              uppercase TEE TIMES label, in the same Georgia serif as
              the wordmark. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '0 4px', marginBottom: 12,
          }}>
            <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.85))' }} />
            <div style={{
              fontSize: 13, fontWeight: 900, letterSpacing: '0.22em',
              color: '#5A4810', fontFamily: '"Georgia", serif',
              textShadow: '0 1px 0 rgba(255,253,248,0.6)',
            }}>TEE TIMES</div>
            <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, rgba(201,160,64,0.85), transparent)' }} />
          </div>

        {/* 2026-05-06 — "+ New Tee Time" entry. Manual scheduler for
            the case Matt described: friends agreed by phone or chat,
            host wants to lock in the round on the app so it shows up
            on everyone's UpcomingTeeTimes + calendar with push
            notifications. Sheet supports app users (multi-select from
            Following+Followers) and named guests (no account). */}
        <button onClick={() => setShowNewTeeTime(true)} style={{
          width: '100%', marginBottom: 12,
          padding: '14px 18px', borderRadius: 16, border: 'none',
          background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))',
          color: '#fff', fontWeight: 800, fontSize: 14,
          cursor: 'pointer',
          boxShadow: '0 2px 12px rgba(27,94,59,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5"  x2="12" y2="19"/>
            <line x1="5"  y1="12" x2="19" y2="12"/>
          </svg>
          Schedule a Tee Time
        </button>

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

        {/* Upcoming confirmed games — only games with a real tee time
            in tm_games. Outgoing pending requests live in their own
            SentRequests section below. */}
        <UpcomingTeeTimes
          games={games.confirmed}
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

        {/* Awaiting Tee Time — outgoing requests + time-less games.
            Per Matt's rule, anything stays here until a tee time is
            pinned, then it moves to Upcoming above. */}
        <AwaitingTeeTime
          requests={teeRequests.outgoing}
          games={games.confirmed}
          userId={profile?.id}
          onPlan={setPlanGame}
        />
        </div>
        {/* /TEE TIMES box */}

        {/* REQUESTS — third translucent-glass box (sibling to the
            ProfileHeroCard and the TEE TIMES box). Houses incoming
            friend requests (people who want to friend you) and
            outgoing pending requests (people you've sent to). The
            old PLAYING PARTNERS section has been removed; finding +
            adding new partners now happens via the magnifying-glass
            in the top bar. (2026-05-02 — Matt: "remove playing
            partners, make a third translucent box, same as the ones
            above and name it requests.... and divide it into
            incoming and outgoing") */}
        <div style={{
          borderRadius: 22,
          background: 'rgba(255,255,255,0.22)',
          border: '1px solid rgba(255,255,255,0.45)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          padding: '14px 12px 8px',
          marginBottom: 16,
        }}>
          {/* Section header — same flourish vocabulary as TEE TIMES */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '0 4px', marginBottom: 12,
          }}>
            <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.85))' }} />
            <div style={{
              fontSize: 13, fontWeight: 900, letterSpacing: '0.22em',
              color: '#5A4810', fontFamily: '"Georgia", serif',
              textShadow: '0 1px 0 rgba(255,253,248,0.6)',
            }}>REQUESTS</div>
            <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, rgba(201,160,64,0.85), transparent)' }} />
          </div>

          {(friends.incoming.length === 0 && friends.outgoing.length === 0) ? (
            <div style={{
              textAlign: 'center', padding: '14px 14px 18px',
              color: 'rgba(13,31,18,0.55)', fontSize: 12,
            }}>
              No incoming or outgoing requests
            </div>
          ) : (
            <>
              {/* INCOMING sub-section */}
              {friends.incoming.length > 0 && (
                <div style={{ marginBottom: friends.outgoing.length > 0 ? 14 : 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '0 4px' }}>
                    <div style={{
                      color: '#1B5E3B', fontSize: 12, letterSpacing: '0.1em', fontWeight: 800,
                      background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
                      textShadow: '0 1px 1px rgba(255,255,255,0.4)',
                    }}>INCOMING</div>
                    <span style={{
                      background: '#1B5E3B', color: '#FFFFFF',
                      borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px',
                    }}>{friends.incoming.length}</span>
                  </div>
                  {friends.incoming.map(req => {
                    // Two states per row:
                    //   1. Default — Accept / ✕ buttons.
                    //   2. Just-accepted — Follow back? / Not now buttons.
                    // The just-accepted state is held locally in
                    // followBackPrompts so the row doesn't disappear
                    // immediately after Accept fires; the user gets a
                    // chance to choose Follow back. (2026-05-02)
                    const justAccepted = followBackPrompts.has(req.id)
                    if (justAccepted) {
                      return (
                        <div key={req.id} style={{
                          background: 'rgba(255,253,248,0.95)',
                          border: '1px solid rgba(201,160,64,0.45)',
                          borderRadius: 12, padding: '10px 14px', marginBottom: 8,
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                        }}>
                          <div>
                            <div style={{ color: '#1B5E3B', fontSize: 13, fontWeight: 700 }}>
                              {req.requester_name} <span style={{ color: 'rgba(13,31,18,0.55)', fontWeight: 500 }}>now follows you</span>
                            </div>
                            <div style={{ color: 'rgba(122,88,0,0.85)', fontSize: 11, fontWeight: 600 }}>Follow back?</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleFollowBack(req.id, req.requester_id)} style={{
                              background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
                              color: '#070C09', border: 'none', borderRadius: 8,
                              padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            }}>Follow back</button>
                            <button onClick={() => dismissFollowBackPrompt(req.id)} style={{
                              background: 'rgba(13,31,18,0.06)', color: 'rgba(13,31,18,0.55)',
                              border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                            }}>Not now</button>
                          </div>
                        </div>
                      )
                    }
                    return (
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
                          <button onClick={() => handleFriendRespond(req.id, 'accepted')} style={{
                            background: '#1B5E3B', color: '#FFFFFF', border: 'none', borderRadius: 8,
                            padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          }}>Accept</button>
                          <button onClick={() => handleFriendRespond(req.id, 'declined')} style={{
                            background: 'rgba(13,31,18,0.06)', color: 'rgba(13,31,18,0.45)',
                            border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                          }}>✕</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* OUTGOING sub-section */}
              {friends.outgoing.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '0 4px' }}>
                    <div style={{
                      color: '#7A5800', fontSize: 12, letterSpacing: '0.1em', fontWeight: 800,
                      background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
                      textShadow: '0 1px 1px rgba(255,255,255,0.4)',
                    }}>OUTGOING</div>
                    <span style={{
                      background: '#C9A040', color: '#FFFFFF',
                      borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px',
                    }}>{friends.outgoing.length}</span>
                  </div>
                  {friends.outgoing.map(req => (
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
                </div>
              )}
            </>
          )}
        </div>
        {/* /REQUESTS box */}

        {/* Standalone My Bag card removed (2026-05-02) — now lives
            inside the ProfileHeroCard as a sibling to the mailbox
            chip. Tap behavior is the same. */}

        {/* Availability calendar — gameDates feeds the per-cell
            golf-flag indicator on dates with a confirmed tee time
            (item 3 — match flags on game days). */}
        <AvailabilityCalendar
          uid={user?.id}
          gameDates={(games?.confirmed || []).filter(g => g.date && g.start_time).map(g => g.date.slice(0, 10))}
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
          onOpenFriend={(opp) => {
            // From inside a FriendProfile's rivalry popup the opponent
            // could be me — bounce back to my own profile in that case;
            // otherwise swap to the new friend in place.
            if (String(opp?.id) === String(user?.id)) setSelectedFriend(null)
            else setSelectedFriend(opp)
          }}
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

      {/* 2026-05-06 — "Schedule a Tee Time" manual scheduler. After
          create, refresh games list so the new tee time pops on
          UpcomingTeeTimes immediately. */}
      {showNewTeeTime && user && (
        <NewTeeTimeSheet
          user={user}
          onClose={() => setShowNewTeeTime(false)}
          onCreated={async () => {
            try {
              const g = await api('/api/games')
              setGames({
                incoming:  Array.isArray(g?.incoming)  ? g.incoming  : [],
                confirmed: Array.isArray(g?.confirmed) ? g.confirmed : [],
              })
            } catch { /* harmless — UpcomingTeeTimes will catch it on next refresh */ }
          }}
        />
      )}

      {/* Plan / set course + time sheet */}
      {planGame && (
        <PlanSheet
          game={planGame}
          onClose={() => setPlanGame(null)}
          onCourseSaved={async (id, course, time) => {
            // Optimistic local update so the card pops to Upcoming
            // immediately…
            setGames(prev => ({
              ...prev,
              confirmed: prev.confirmed.map(g => g.id === id
                ? { ...g, course_name: course, start_time: time ?? g.start_time }
                : g),
            }))
            // …then refetch so the row's authoritative state matches
            // the server (handles concurrent participant updates etc).
            try {
              const g = await api('/api/games')
              setGames(g ?? { incoming: [], confirmed: [] })
            } catch { /* ignore */ }
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
