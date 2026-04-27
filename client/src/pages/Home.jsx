import { useState, useEffect, useCallback, useRef } from 'react'
import { api, post, put } from '../lib/api.js'
import { TMEmblem, IconTarget, IconTrophy, IconFlag, IconChevronRight, IconPlus } from '../components/primitives/Icons.jsx'
import FriendProfile from '../components/FriendProfile.jsx'

// ─── Season helpers ───────────────────────────────────────────────────────────
function currentSeasonYear() {
  const now = new Date()
  return now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
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

function ProfileHeroCard({ user, season, avg3, streak, onStartSeason, onEditProfile }) {
  const seasonBanner = season && !season.seasonStarted && season.year === currentSeasonYear()
  const [banner] = useState(randomBanner)

  const handicapDisplay = user?.handicap != null
    ? (user.handicap > 0 ? `+${user.handicap}` : String(user.handicap))
    : '—'

  return (
    <div style={{
      borderRadius: 22,
      overflow: 'hidden',
      background: 'linear-gradient(155deg, #0F2814 0%, #0A1D0F 40%, #060E08 100%)',
      border: '1px solid rgba(197,160,64,0.18)',
      boxShadow: '0 0 40px rgba(197,160,64,0.06), inset 0 1px 0 rgba(255,255,255,0.05)',
      position: 'relative',
      marginBottom: 16,
    }}>
      {/* Top gold shimmer line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1, pointerEvents: 'none',
        background: 'linear-gradient(90deg, transparent, rgba(197,160,64,0.6), rgba(245,215,138,0.8), rgba(197,160,64,0.6), transparent)',
      }} />
      {/* Grid texture overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.02) 1px,transparent 1px)',
        backgroundSize: '28px 28px',
      }} />
      {/* Radial glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(197,160,64,0.14) 0%, transparent 70%)',
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
            <div style={{ color: '#F5D78A', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              SEASON {season.year} IS HERE
            </div>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, lineHeight: 1.4 }}>{banner}</div>
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
          {/* Left: name + course */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: '0.1em', marginBottom: 4 }}>
              SEASON {season?.year ?? currentSeasonYear()}
            </div>
            <div style={{
              fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em',
              lineHeight: 1.1, marginBottom: 4,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{user?.name ?? '—'}</div>
            {user?.home_course ? (
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                {user.home_course}
              </div>
            ) : (
              <button onClick={onEditProfile} style={{
                background: 'none', border: 'none', color: 'rgba(245,215,138,0.6)',
                fontSize: 12, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span>+ Add home course</span>
              </button>
            )}
          </div>

          {/* Right: handicap badge */}
          <div style={{
            textAlign: 'center', flexShrink: 0,
            background: 'rgba(0,0,0,0.3)', borderRadius: 14, padding: '10px 16px',
            border: '1px solid rgba(197,160,64,0.2)',
          }}>
            <div style={{
              fontSize: user?.handicap != null ? 44 : 28, fontWeight: 900, lineHeight: 1,
              background: 'linear-gradient(135deg, #F5D78A, #E8C05A, #C9A040)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 16px rgba(232,192,90,0.3))',
              minWidth: 56, display: 'block',
            }}>{handicapDisplay}</div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, letterSpacing: '0.12em', marginTop: 4 }}>HCP INDEX</div>
          </div>
        </div>

        {/* Season stats row */}
        <div style={{ display: 'flex', marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14 }}>
          {[
            { label: 'WINS', value: season?.wins ?? 0, color: '#4ADE80' },
            { label: 'LOSSES', value: season?.losses ?? 0, color: '#F87171' },
            { label: 'TIES', value: season?.ties ?? 0, color: 'rgba(255,255,255,0.45)' },
            { label: '3-RND AVG', value: avg3 != null ? avg3 : '—', color: '#F5D78A' },
          ].map(({ label, value, color }, i) => (
            <div key={label} style={{
              flex: 1, textAlign: 'center',
              borderRight: i < 3 ? '1px solid rgba(255,255,255,0.07)' : 'none',
              padding: '0 4px',
            }}>
              <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.09em', marginTop: 5, fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Streak */}
        {streak > 0 && (
          <div style={{
            marginTop: 10, display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(197,160,64,0.08)', border: '1px solid rgba(197,160,64,0.15)', borderRadius: 10, padding: '8px 14px',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(245,215,138,0.9)" stroke="none"><path d="M12 2c0 0-5 5.5-5 10a5 5 0 0 0 10 0c0-4.5-5-10-5-10zm0 13a2 2 0 0 1-2-2c0-2 2-5 2-5s2 3 2 5a2 2 0 0 1-2 2z"/></svg>
            <span style={{ color: '#F5D78A', fontSize: 12, fontWeight: 600 }}>
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
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: '0.1em', fontWeight: 600 }}>PLAYING PARTNERS</div>
        <button onClick={() => onAddFriend ? onAddFriend() : setShowAdd(v => !v)} style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
          color: '#F5D78A', fontSize: 11, padding: '5px 10px', cursor: 'pointer',
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
                flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, color: '#fff', padding: '10px 14px', fontSize: 13,
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
            <div style={{ marginTop: 6, fontSize: 12, color: addState === 'ok' ? '#4ADE80' : '#F87171' }}>{addMsg}</div>
          )}
        </form>
      )}

      {/* Pending incoming requests */}
      {incoming.map(req => (
        <div key={req.id} style={{
          background: 'rgba(197,160,64,0.06)', border: '1px solid rgba(197,160,64,0.15)',
          borderRadius: 12, padding: '10px 14px', marginBottom: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{req.requester_name}</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>wants to be your playing partner</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => onRespond(req.id, 'accepted')} style={{
              background: '#4ADE80', color: '#070C09', border: 'none', borderRadius: 8,
              padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>Accept</button>
            <button onClick={() => onRespond(req.id, 'declined')} style={{
              background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)',
              border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer',
            }}>✕</button>
          </div>
        </div>
      ))}

      {/* Outgoing pending friend requests */}
      {outgoing && outgoing.length > 0 && outgoing.map(req => (
        <div key={req.id} style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12, padding: '10px 14px', marginBottom: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 600 }}>{req.requestee_name}</div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>Request sent</div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
            color: 'rgba(245,215,138,0.6)',
            background: 'rgba(245,215,138,0.08)', borderRadius: 6, padding: '3px 8px',
          }}>PENDING</span>
        </div>
      ))}

      {/* Friends list with activity */}
      {friends.length === 0 && incoming.length === 0 && (!outgoing || outgoing.length === 0) && (
        <div style={{
          textAlign: 'center', padding: '24px 20px',
          background: 'rgba(255,255,255,0.03)', borderRadius: 14,
          border: '1px dashed rgba(255,255,255,0.08)',
        }}>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>No playing partners yet</div>
          <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 4 }}>Add a friend to see their rounds and availability</div>
        </div>
      )}

      {friends.map(f => {
        const act = activity.find(a => String(a.user_id) === String(f.friend_id))
        const diff = act ? act.total - (act.course_par || 72) : null
        const diffStr = diff == null ? null : diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff)
        const diffColor = diff == null ? null : diff < 0 ? '#4ADE80' : diff > 0 ? '#F87171' : '#F5D78A'
        const hcp = f.friend_handicap != null ? (f.friend_handicap > 0 ? `+${f.friend_handicap}` : String(f.friend_handicap)) : null
        return (
          <div key={f.id} onClick={() => onSelectFriend?.(f)} style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 12, padding: '12px 14px', marginBottom: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            cursor: 'pointer', transition: 'background 0.15s',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{f.friend_name}</span>
                {hcp && <span style={{ color: '#F5D78A', fontSize: 11, fontWeight: 600 }}>HCP {hcp}</span>}
              </div>
              {act ? (
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>
                  Last round: {act.course_name} · {new Date(act.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                </div>
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, marginTop: 2 }}>No rounds yet</div>
              )}
              {f.friend_home_course && (
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  {f.friend_home_course}
                </div>
              )}
            </div>
            {act && diffStr && (
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: diffColor }}>{diffStr}</div>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>last round</div>
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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #0D1F12, #070C09)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: '22px 22px 0 0',
        padding: '20px 20px 48px',
      }} onClick={e => e.stopPropagation()}>

        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', margin: '0 auto 18px' }} />

        {/* Date */}
        <div style={{ color: '#fff', fontSize: 17, fontWeight: 700, marginBottom: 16 }}>{label}</div>

        {/* Your status */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: isMine ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${isMine ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.07)'}`,
          borderRadius: 12, padding: '12px 14px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isMine ? '#4ADE80' : 'rgba(255,255,255,0.2)',
            }} />
            <span style={{ color: isMine ? '#4ADE80' : 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: 600 }}>
              {isMine ? "You're free this day" : "You haven't marked this day"}
            </span>
          </div>
          <button
            onClick={() => onToggleFree(ymd)}
            disabled={toggling === ymd}
            style={{
              background: isMine ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.15)',
              border: `1px solid ${isMine ? 'rgba(248,113,113,0.25)' : 'rgba(74,222,128,0.3)'}`,
              borderRadius: 8, color: isMine ? '#F87171' : '#4ADE80',
              fontSize: 11, fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
            }}
          >{toggling === ymd ? '…' : isMine ? 'Mark busy' : 'Mark free'}</button>
        </div>

        {/* Friends available */}
        {friends.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
            No friends free this day yet
          </div>
        ) : (
          <>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 10 }}>
              FRIENDS AVAILABLE
            </div>
            {friends.map(f => {
              const uid = f.user_id
              const state = sent[uid]
              return (
                <div key={uid} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', gap: 10,
                }}>
                  <div>
                    <div style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{f.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ADE80' }} />
                      <span style={{ color: 'rgba(74,222,128,0.7)', fontSize: 11 }}>Free this day</span>
                    </div>
                  </div>
                  {state === 'sent' ? (
                    <span style={{
                      color: '#4ADE80', fontSize: 11, fontWeight: 600,
                      background: 'rgba(74,222,128,0.1)', borderRadius: 8, padding: '6px 12px',
                    }}>Sent</span>
                  ) : state === 'error' ? (
                    <span style={{ color: '#F87171', fontSize: 11 }}>Failed</span>
                  ) : (
                    <button onClick={() => requestPlay(f)} disabled={state === 'sending'} style={{
                      background: 'linear-gradient(135deg, rgba(74,222,128,0.2), rgba(74,222,128,0.1))',
                      border: '1px solid rgba(74,222,128,0.3)',
                      borderRadius: 9, color: '#4ADE80',
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
          background: 'linear-gradient(135deg, rgba(197,160,64,0.15), rgba(197,160,64,0.08))',
          border: '1px solid rgba(197,160,64,0.3)',
          borderRadius: 12, color: '#F5D78A', fontSize: 13, fontWeight: 700,
          cursor: 'pointer', letterSpacing: '0.03em',
        }}>Schedule a Group Match</button>
      </div>
    </div>
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
      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: '0.1em', fontWeight: 600, marginBottom: 10 }}>
        AVAILABILITY CALENDAR
      </div>

      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16, overflow: 'hidden',
      }}>
        {/* Month navigation */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>‹</button>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{monthName}</span>
          <button onClick={nextMonth} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>›</button>
        </div>

        {/* Day labels */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '8px 8px 0' }}>
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={i} style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 10, paddingBottom: 4 }}>{d}</div>
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
                    ? 'linear-gradient(135deg, rgba(74,222,128,0.25), rgba(74,222,128,0.12))'
                    : hasFriend
                      ? 'rgba(245,215,138,0.08)'
                      : 'transparent',
                  outline: isToday ? '2px solid rgba(245,215,138,0.5)' : 'none',
                  color: isPast ? 'rgba(255,255,255,0.2)' : isMine ? '#4ADE80' : '#fff',
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
                    background: isMine ? '#4ADE80' : '#F5D78A',
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
          borderTop: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(74,222,128,0.3)' }} />
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>You're free</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#F5D78A' }} />
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>Friends available</span>
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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #0D1F12, #070C09)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: '22px 22px 0 0', padding: '20px 20px 48px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', margin: '0 auto 20px' }} />

        {/* Game summary */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
              color: isMatch ? '#4ADE80' : '#F5D78A',
              background: isMatch ? 'rgba(74,222,128,0.1)' : 'rgba(245,215,138,0.1)',
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
    </div>
  )
}

function UpcomingTeeTimes({ games, onPlan, onRefresh, onCreateMatch, onSelectFriend, userId }) {
  const [broadcasting, setBroadcasting] = useState({}) // { [gameId]: 'sending'|'sent' }
  if (!games || games.length === 0) return null

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
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: '0.1em', fontWeight: 600 }}>
          UPCOMING TEE TIMES
        </div>
        <span style={{
          background: '#4ADE80', color: '#070C09',
          borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px',
        }}>{games.length}</span>
      </div>

      {games.map(g => {
        const dateLabel = new Date(g.date + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
        })
        const isMatch    = g.request_type === 'availability_match'
        const accepted   = (g.participants || []).filter(p => p.status === 'accepted')
        const pending    = (g.participants || []).filter(p => p.status === 'pending')
        const spotsOpen  = Math.max(0, 4 - accepted.length)
        const bState     = broadcasting[g.id]
        const alreadyBroadcast = g.broadcast

        return (
          <div key={g.id} style={{
            background: 'linear-gradient(135deg, rgba(74,222,128,0.07), rgba(74,222,128,0.03))',
            border: '1px solid rgba(74,222,128,0.2)',
            borderRadius: 14, padding: '14px 16px', marginBottom: 8,
          }}>
            {/* Top row: date + badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ color: '#4ADE80', fontSize: 13, fontWeight: 700 }}>{dateLabel}</div>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                color: isMatch ? 'rgba(74,222,128,0.7)' : 'rgba(245,215,138,0.6)',
                background: isMatch ? 'rgba(74,222,128,0.1)' : 'rgba(245,215,138,0.08)',
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
                    background: 'rgba(74,222,128,0.1)', borderRadius: 20, padding: '4px 10px',
                    cursor: String(p.user_id) !== String(userId) ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ADE80' }} />
                  <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>{p.name}</span>
                  {p.handicap != null && (
                    <span style={{ color: 'rgba(245,215,138,0.7)', fontSize: 10 }}>
                      {p.handicap > 0 ? `+${p.handicap}` : p.handicap}
                    </span>
                  )}
                </div>
              ))}
              {pending.map(p => (
                <div key={p.user_id} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: '4px 10px',
                  border: '1px dashed rgba(255,255,255,0.12)',
                }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{p.name}</span>
                  <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>pending</span>
                </div>
              ))}
              {/* Empty spot slots */}
              {spotsOpen > 0 && Array.from({ length: spotsOpen }).map((_, i) => (
                <div key={`open-${i}`} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'rgba(197,160,64,0.06)', borderRadius: 20, padding: '4px 10px',
                  border: '1px dashed rgba(197,160,64,0.25)',
                }}>
                  <span style={{ color: 'rgba(197,160,64,0.5)', fontSize: 12 }}>Open spot</span>
                </div>
              ))}
            </div>

            {/* Course + action row */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              paddingTop: 10, borderTop: '1px solid rgba(74,222,128,0.1)', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                <span style={{ color: g.course_name ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)', fontSize: 12 }}>
                  {g.course_name || 'No course set'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {/* Need X button — only show if spots open */}
                {spotsOpen > 0 && (
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
                        background: 'linear-gradient(135deg, rgba(197,160,64,0.2), rgba(197,160,64,0.1))',
                        border: '1px solid rgba(197,160,64,0.4)',
                        borderRadius: 8, color: '#F5D78A',
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
                      background: 'linear-gradient(135deg, rgba(197,160,64,0.25), rgba(197,160,64,0.12))',
                      border: '1px solid rgba(197,160,64,0.5)',
                      borderRadius: 8, color: '#F5D78A',
                      fontSize: 11, fontWeight: 700, padding: '5px 12px', cursor: 'pointer',
                    }}
                  >Create Match</button>
                )}
                <button onClick={() => onPlan(g)} style={{
                  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, color: '#F5D78A', fontSize: 11, fontWeight: 600,
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

// ─── Tee Time Inbox ───────────────────────────────────────────────────────────
function GameInbox({ games, onRespond }) {
  const { incoming } = games
  if (!incoming || incoming.length === 0) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, letterSpacing: '0.1em', fontWeight: 600, marginBottom: 10 }}>
        INVITES
        <span style={{
          marginLeft: 8, background: '#F5D78A', color: '#070C09',
          borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px',
        }}>{incoming.length}</span>
      </div>

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
            background: isBroadcast
              ? 'rgba(197,160,64,0.06)'
              : isMatch ? 'rgba(74,222,128,0.05)' : 'rgba(245,215,138,0.05)',
            border: `1px solid ${isBroadcast ? 'rgba(197,160,64,0.25)' : isMatch ? 'rgba(74,222,128,0.18)' : 'rgba(245,215,138,0.15)'}`,
            borderRadius: 14, padding: '14px 16px', marginBottom: 8,
          }}>
            {/* Header: badge + date */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                color: isBroadcast ? '#F5D78A' : isMatch ? '#4ADE80' : '#F5D78A',
                background: isBroadcast ? 'rgba(197,160,64,0.15)' : isMatch ? 'rgba(74,222,128,0.1)' : 'rgba(245,215,138,0.1)',
                borderRadius: 5, padding: '2px 7px',
              }}>
                {isBroadcast ? `OPEN SPOT · NEED ${spotsOpen}` : isMatch ? 'CALENDAR MATCH' : 'TEE TIME REQUEST'}
              </span>
              <span style={{ color: isBroadcast ? '#F5D78A' : isMatch ? 'rgba(74,222,128,0.8)' : '#F5D78A', fontSize: 12, fontWeight: 600 }}>
                {dateLabel}
              </span>
            </div>

            {/* Organizer line */}
            <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              {g.organizer_name}
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: 400 }}>
                {isBroadcast ? ` is looking for ${spotsOpen} more` : ' invited you'}
              </span>
            </div>

            {/* Players */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
              {accepted.map(p => (
                <span key={p.user_id} style={{
                  background: 'rgba(74,222,128,0.1)', borderRadius: 20, padding: '3px 9px',
                  color: '#4ADE80', fontSize: 11, fontWeight: 600,
                }}>{p.name}</span>
              ))}
              {isBroadcast && spotsOpen > 0 && Array.from({ length: spotsOpen }).map((_, i) => (
                <span key={`open-${i}`} style={{
                  background: 'rgba(197,160,64,0.08)', borderRadius: 20, padding: '3px 9px',
                  color: 'rgba(197,160,64,0.5)', fontSize: 11,
                  border: '1px dashed rgba(197,160,64,0.2)',
                }}>Open</span>
              ))}
            </div>

            {/* Course */}
            {g.course_name && (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 10 }}>
                {g.course_name}
              </div>
            )}
            {g.message && !isBroadcast && (
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, fontStyle: 'italic', marginBottom: 10 }}>
                "{g.message}"
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onRespond(g.id, 'accepted')} style={{
                flex: 1,
                background: isBroadcast
                  ? 'linear-gradient(135deg, #F5D78A, #C9A040)'
                  : '#4ADE80',
                color: '#070C09', border: 'none',
                borderRadius: 10, padding: '9px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>{isBroadcast ? "I'm In!" : 'Accept'}</button>
              <button onClick={() => onRespond(g.id, 'declined')} style={{
                background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(255,255,255,0.1)',
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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #0E1F13, #070C09)',
        border: '1px solid rgba(255,255,255,0.1)',
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
                  <span style={{ color: '#4ADE80', fontSize: 11, fontWeight: 600 }}>Friends</span>
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
    </div>
  )
}

// ─── Create Game Modal ────────────────────────────────────────────────────────
function CreateGameModal({ initialDate, onClose, onCreated, onCreateOuting }) {
  const [date, setDate]         = useState(initialDate || new Date().toISOString().slice(0, 10))
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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #0D1F12, #070C09)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: '22px 22px 0 0', padding: '20px 20px 48px',
        maxHeight: '90dvh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', margin: '0 auto 20px' }} />
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, marginBottom: 20 }}>Schedule a Match</div>

        {/* Date */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>DATE</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
            colorScheme: 'dark',
          }} />
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
                  background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.25)',
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
                      <span style={{ color: '#4ADE80', fontSize: 12, fontWeight: 600 }}>+ Add</span>
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
    </div>
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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'linear-gradient(180deg, #0E1F13, #070C09)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '20px 20px 0 0', padding: '24px 24px 40px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>Edit Profile</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>
        {/* Handicap row */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>HANDICAP INDEX</div>
          <input
            value={hcp}
            onChange={e => setHcp(e.target.value)}
            placeholder="e.g. 8.4 or +2.1"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
            }}
          />
        </div>
        {[
          { label: 'Home Course', value: course, set: setCourse, placeholder: 'e.g. Augusta National' },
          { label: 'Bio', value: bio, set: setBio, placeholder: 'Short tagline…' },
        ].map(({ label, value, set, placeholder }) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: '0.08em', marginBottom: 6 }}>{label.toUpperCase()}</div>
            <input value={value} onChange={e => set(e.target.value)} placeholder={placeholder} style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
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
    </div>
  )
}

// ─── Main Home Page ───────────────────────────────────────────────────────────
export default function Home({ onNavigateToOuting }) {
  const [profile, setProfile] = useState(null)
  const [friends, setFriends] = useState({ friends: [], incoming: [], activity: [] })
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [addFriendOpen, setAddFriendOpen] = useState(false)
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [games, setGames]         = useState({ incoming: [], confirmed: [] })
  const [planGame, setPlanGame]   = useState(null)
  const [createGameOpen, setCreateGameOpen] = useState(false)
  const [createGameDate, setCreateGameDate] = useState(null)

  async function loadAll() {
    setLoading(true)
    try {
      const [p, f, g] = await Promise.all([
        api('/api/profile'),
        api('/api/friends'),
        api('/api/games'),
      ])
      setProfile(p)
      setFriends(f)
      setGames(g ?? { incoming: [], confirmed: [] })
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
      <div style={{ minHeight: '100dvh', background: 'var(--tm-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <TMEmblem size={40} />
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 12 }}>Loading…</div>
        </div>
      </div>
    )
  }

  const { user, season, avg3, streak } = profile ?? {}

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--tm-bg)', paddingBottom: 100 }}>
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
        <button onClick={() => setEditOpen(true)} style={{
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 12,
          padding: '7px 12px', cursor: 'pointer',
        }}>Edit Profile</button>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Profile hero */}
        <ProfileHeroCard
          user={user} season={season} avg3={avg3} streak={streak}
          onStartSeason={handleStartSeason}
          onEditProfile={() => setEditOpen(true)}
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
            background: 'linear-gradient(135deg, #0D2010 0%, #0A1A0C 100%)',
            border: '1px solid rgba(74,222,128,0.2)',
            boxShadow: '0 0 24px rgba(74,222,128,0.05)',
            padding: '14px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'relative', overflow: 'hidden',
          }}>
            {/* Subtle glow */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none',
              background: 'radial-gradient(ellipse 80% 60% at 0% 50%, rgba(74,222,128,0.06) 0%, transparent 70%)',
            }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Calendar icon */}
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div>
                <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>Book a Tee Time</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                  <div style={{
                    background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.25)',
                    borderRadius: 4, padding: '1px 6px',
                    color: '#4ADE80', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                  }}>GOLFNOW</div>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>Integration coming soon</span>
                </div>
              </div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </a>

        {/* Upcoming confirmed games */}
        <UpcomingTeeTimes
          games={games.confirmed}
          onPlan={setPlanGame}
          userId={profile?.id}
          onCreateMatch={players => onNavigateToOuting?.(players)}
          onSelectFriend={setSelectedFriend}
          onRefresh={async () => {
            const g = await api('/api/games')
            setGames(g ?? { incoming: [], confirmed: [] })
          }}
        />

        {/* Pending game invites */}
        <GameInbox
          games={games}
          onRespond={async (id, status) => {
            await handleGameRespond(id, status)
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
    </div>
  )
}
