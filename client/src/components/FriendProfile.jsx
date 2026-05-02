import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../lib/api.js'
import { HcpBadge, StatTile } from '../pages/Stats.jsx'
import FollowPills from './FollowPills.jsx'
import RoundScorecard from './RoundScorecard.jsx'
import RoundHistory from './RoundHistory.jsx'
import RivalryHistory from './RivalryHistory.jsx'
import RivalryDetail from './RivalryDetail.jsx'
import { AvailabilityCalendar } from '../pages/Home.jsx'

// ── Nearby Course Picker ──────────────────────────────────────────────────────
function CoursePicker({ value, onChange }) {
  const [query, setQuery]       = useState(value || '')
  const [courses, setCourses]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [open, setOpen]         = useState(false)
  const [locErr, setLocErr]     = useState(null)
  const inputRef                = useRef(null)
  const fetched                 = useRef(false)

  const fetchCourses = useCallback(async () => {
    if (fetched.current) { setOpen(true); return }
    setLoading(true); setLocErr(null)
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
      )
      const { latitude: lat, longitude: lon } = pos.coords
      // Overpass API — golf courses within 40 km
      const overpassQ = `[out:json][timeout:12];(node["leisure"="golf_course"](around:40000,${lat},${lon});way["leisure"="golf_course"](around:40000,${lat},${lon});relation["leisure"="golf_course"](around:40000,${lat},${lon}););out center 40;`
      const resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: overpassQ,
      })
      const data = await resp.json()
      const seen = new Set()
      const list = data.elements
        .map(el => {
          const name = el.tags?.name || el.tags?.['name:en']
          const clat  = el.lat ?? el.center?.lat
          const clon  = el.lon ?? el.center?.lon
          if (!name || seen.has(name)) return null
          seen.add(name)
          const dist = clat && clon
            ? Math.round(Math.sqrt((clat-lat)**2 + (clon-lon)**2) * 111) // rough km
            : null
          return { name, dist }
        })
        .filter(Boolean)
        .sort((a, b) => (a.dist ?? 999) - (b.dist ?? 999))
      setCourses(list)
      fetched.current = true
      setOpen(true)
    } catch (e) {
      setLocErr(e.code === 1 ? 'Location access denied' : 'Could not fetch courses')
    }
    setLoading(false)
  }, [])

  const filtered = courses.filter(c =>
    !query || c.name.toLowerCase().includes(query.toLowerCase())
  )

  function select(name) {
    setQuery(name); onChange(name); setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={fetchCourses}
        placeholder={loading ? 'Finding courses near you…' : 'Which course?'}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: open && filtered.length ? '10px 10px 0 0' : 10,
          color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
        }}
      />
      {loading && (
        <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
          </svg>
        </div>
      )}
      {locErr && (
        <div style={{ color: '#F87171', fontSize: 11, marginTop: 4 }}>{locErr} — type a course name manually</div>
      )}
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, zIndex: 99,
          background: '#0E1F13', border: '1px solid rgba(255,255,255,0.1)',
          borderTop: 'none', borderRadius: '0 0 10px 10px',
          maxHeight: 200, overflowY: 'auto',
        }}>
          {filtered.slice(0, 12).map((c, i) => (
            <div
              key={c.name}
              onMouseDown={() => select(c.name)}
              style={{
                padding: '10px 14px', cursor: 'pointer',
                borderBottom: i < filtered.slice(0,12).length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: '#fff', fontSize: 13 }}>{c.name}</span>
              {c.dist != null && (
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, flexShrink: 0, marginLeft: 8 }}>
                  ~{c.dist} km
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function toYMD(date) { return date.toISOString().slice(0, 10) }
function todayYMD() { return toYMD(new Date()) }

// ── H2H Bar ───────────────────────────────────────────────────────────────────
function H2HBar({ h2h, myName, theirName }) {
  const total = h2h.my_wins + h2h.their_wins + h2h.ties
  const myPct   = total ? Math.round((h2h.my_wins   / total) * 100) : 0
  const tiePct  = total ? Math.round((h2h.ties       / total) * 100) : 0
  const theirPct = total ? 100 - myPct - tiePct : 0

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 14, padding: '14px 16px', marginBottom: 12,
    }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 12 }}>
        HEAD TO HEAD
      </div>

      {total === 0 ? (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: 13, padding: '8px 0' }}>
          No matchups yet — get out there
        </div>
      ) : (
        <>
          {/* Score row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: '#4ADE80', lineHeight: 1 }}>{h2h.my_wins}</div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 3 }}>YOU</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.3)', lineHeight: 1 }}>{h2h.ties}</div>
              <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, marginTop: 3 }}>TIES</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: '#F87171', lineHeight: 1 }}>{h2h.their_wins}</div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 3 }}>{theirName?.split(' ')[0]?.toUpperCase()}</div>
            </div>
          </div>

          {/* Bar */}
          <div style={{ display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
            {myPct > 0 && <div style={{ flex: myPct, background: '#4ADE80', borderRadius: '99px 0 0 99px' }} />}
            {tiePct > 0 && <div style={{ flex: tiePct, background: 'rgba(255,255,255,0.2)' }} />}
            {theirPct > 0 && <div style={{ flex: theirPct, background: '#F87171', borderRadius: '0 99px 99px 0' }} />}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ color: '#4ADE80', fontSize: 10, fontWeight: 600 }}>{myPct}%</span>
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>{total} match{total !== 1 ? 'es' : ''}</span>
            <span style={{ color: '#F87171', fontSize: 10, fontWeight: 600 }}>{theirPct}%</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Friend Season Card ────────────────────────────────────────────────────────
function FriendSeasonCard({ friend, season, avg3 }) {
  const hcp = friend?.handicap != null
    ? (friend.handicap > 0 ? `+${friend.handicap}` : String(friend.handicap))
    : '—'

  return (
    <div style={{
      borderRadius: 18,
      background: 'linear-gradient(155deg, #0F2814 0%, #0A1D0F 40%, #060E08 100%)',
      border: '1px solid rgba(197,160,64,0.18)',
      boxShadow: '0 0 30px rgba(197,160,64,0.05)',
      position: 'relative', overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Top shimmer */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1, pointerEvents: 'none',
        background: 'linear-gradient(90deg, transparent, rgba(197,160,64,0.5), transparent)',
      }} />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(197,160,64,0.1) 0%, transparent 70%)',
      }} />

      <div style={{ padding: '16px 16px 14px', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.1em', marginBottom: 3 }}>
              SEASON {season?.year}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {friend?.name}
            </div>
            {(friend?.handle || data?.friend?.handle) && (
              <div style={{ color: 'rgba(245,215,138,0.65)', fontSize: 11, fontWeight: 600, marginTop: 2, letterSpacing: '0.01em' }}>
                @{friend?.handle || data?.friend?.handle}
              </div>
            )}
            {friend?.home_course && (
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                {friend.home_course}
              </div>
            )}
          </div>
          <div style={{
            textAlign: 'center', flexShrink: 0,
            background: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: '8px 14px',
            border: '1px solid rgba(197,160,64,0.2)',
          }}>
            <div style={{
              fontSize: friend?.handicap != null ? 36 : 24, fontWeight: 900, lineHeight: 1,
              background: 'linear-gradient(135deg, #F5D78A, #E8C05A, #C9A040)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>{hcp}</div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, letterSpacing: '0.1em', marginTop: 3 }}>HCP</div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          {[
            { label: 'WINS',     value: season?.wins ?? 0,               color: '#4ADE80' },
            { label: 'LOSSES',   value: season?.losses ?? 0,             color: '#F87171' },
            { label: 'TIES',     value: season?.ties ?? 0,               color: 'rgba(255,255,255,0.4)' },
            { label: '3-RND AVG', value: avg3 != null ? avg3 : '—',       color: '#F5D78A' },
          ].map(({ label, value, color }, i) => (
            <div key={label} style={{
              flex: 1, textAlign: 'center',
              borderRight: i < 3 ? '1px solid rgba(255,255,255,0.07)' : 'none',
            }}>
              <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.09em', marginTop: 4, fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Availability Strip ────────────────────────────────────────────────────────
function AvailabilityStrip({ availability, friendName, onRequestTeeTime }) {
  const days = []
  for (let i = 0; i < 14; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    days.push(toYMD(d))
  }
  const freeSet = new Set(availability.map(a => a.date?.slice(0, 10)))

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 14, padding: '14px 16px', marginBottom: 12,
    }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 10 }}>
        {friendName?.split(' ')[0]?.toUpperCase()}'S AVAILABILITY — NEXT 2 WEEKS
      </div>

      {/* Day strip */}
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 4 }}>
        {days.map(ymd => {
          const isFree = freeSet.has(ymd)
          const d = new Date(ymd + 'T12:00:00')
          const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1)
          const dateNum  = d.getDate()
          return (
            <button
              key={ymd}
              onClick={() => isFree && onRequestTeeTime(ymd)}
              style={{
                flexShrink: 0, width: 40, padding: '8px 0',
                borderRadius: 10, border: 'none', cursor: isFree ? 'pointer' : 'default',
                background: isFree
                  ? 'linear-gradient(135deg, rgba(74,222,128,0.2), rgba(74,222,128,0.1))'
                  : 'rgba(255,255,255,0.03)',
                outline: isFree ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,255,255,0.05)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              }}
            >
              <span style={{ fontSize: 9, color: isFree ? '#4ADE80' : 'rgba(255,255,255,0.2)', fontWeight: 600, letterSpacing: '0.05em' }}>{dayLabel}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: isFree ? '#4ADE80' : 'rgba(255,255,255,0.2)', lineHeight: 1 }}>{dateNum}</span>
              {isFree && (
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#4ADE80', opacity: 0.8 }} />
              )}
            </button>
          )
        })}
      </div>

      {freeSet.size === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
          No availability posted yet
        </div>
      )}

      {freeSet.size > 0 && (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 8 }}>
          Tap a green day to send a tee time request
        </div>
      )}
    </div>
  )
}

// ── Tee Time Request Sheet ────────────────────────────────────────────────────
function TeeRequestSheet({ friend, date, onSend, onClose }) {
  const [course, setCourse]   = useState('')
  const [link, setLink]       = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)

  async function handleSend() {
    setSending(true)
    try {
      const msg = [message.trim(), link.trim() ? `GolfNow: ${link.trim()}` : ''].filter(Boolean).join('\n')
      await post('/api/availability/tee-request', {
        to_user_id: friend.id,
        date,
        course_name: course.trim() || null,
        message: msg || null,
      })
      setSent(true)
      setTimeout(() => { onSend(); onClose() }, 1200)
    } catch { setSending(false) }
  }

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <div style={{ padding: '20px 0 0' }}>
      {sent ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div style={{ color: '#4ADE80', fontSize: 16, fontWeight: 700 }}>Request sent!</div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 4 }}>
            Waiting on {friend.name?.split(' ')[0]}
          </div>
        </div>
      ) : (
        <>
          <div style={{ color: '#F5D78A', fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{dateLabel}</div>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 18 }}>
            {friend.name} marked this day as available
          </div>

          {/* Course picker with location autocomplete */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>COURSE (OPTIONAL)</div>
            <CoursePicker value={course} onChange={setCourse} />
          </div>

          {/* GolfNow link */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>GOLFNOW LINK (OPTIONAL)</div>
            <input
              value={link} onChange={e => setLink(e.target.value)}
              placeholder="Paste booking link…" type="url"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
              }}
            />
          </div>

          {/* Message */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>MESSAGE (OPTIONAL)</div>
            <input
              value={message} onChange={e => setMessage(e.target.value)}
              placeholder="e.g. 8am, you in?"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, color: '#fff', padding: '11px 14px', fontSize: 14, outline: 'none',
              }}
            />
          </div>

          <button onClick={handleSend} disabled={sending} style={{
            width: '100%', padding: 14, marginTop: 4,
            background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
            color: '#070C09', border: 'none', borderRadius: 12,
            fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}>
            {sending ? 'Sending…' : `Send Request to ${friend.name?.split(' ')[0]}`}
          </button>
        </>
      )}
    </div>
  )
}

// ── Main FriendProfile (full-page portal) ────────────────────────────────────
//
// Mirrors ProfileView's layout for visual continuity — tap a friend in
// the FollowList / Friends panel / Rivalries card and you see the same
// top bar + dark identity header + stats sections you'd see on your own
// profile, just populated with their data. Friend-specific bits
// (head-to-head bar, availability strip, request-match CTA) appended at
// the bottom. (2026-05-01 — Matt: "appear the same way my profile looks")
export default function FriendProfile({ friend: friendSummary, confirmedGames = [], onClose, onOpenFriend }) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [teeDate, setTeeDate]   = useState(null) // date string when tee-request sheet is open
  const [selectedRoundId, setSelectedRoundId] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [rivalriesOpen, setRivalriesOpen] = useState(false)
  const [selectedRivalry, setSelectedRivalry] = useState(null)

  // Accept either `friend_id` (FollowList convention) or `id` (rivalry
  // popup hand-off). Without this fall-back the rivalry-tap nav would
  // sit forever on a "loading" page since the effect bails before
  // setLoading(false) runs.
  const friendId = friendSummary?.friend_id ?? friendSummary?.id ?? null
  useEffect(() => {
    if (!friendId) {
      setLoading(false)
      return
    }
    setLoading(true)
    api(`/api/friends/${friendId}/profile`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [friendId])

  // Compute the friend's handicap-display string with the same convention
  // used elsewhere: high cap → "17.0", plus cap → "+3.5".
  const friend     = data?.friend
  const hcpNum     = friend?.handicap == null ? null : Number(friend.handicap)
  const hcpDisplay = !Number.isFinite(hcpNum) ? '—'
    : hcpNum >= 0 ? hcpNum.toFixed(1)
    : `+${Math.abs(hcpNum).toFixed(1)}`

  // Friend's first name for the H2H "THEM" label and the Request-Match CTA.
  const firstName  = friend?.name?.split(' ')[0] || 'Player'

  // Limited preview state — server returns this when the viewer is
  // NOT yet friends with this user (search → tap-result flow). The
  // header still shows but the rest of the friendship-gated sections
  // are hidden. Banner up top has the right CTA based on friendship
  // state. (2026-05-01 — Matt: search shouldn't dead-end on
  // 'couldn't load'.)
  const isLimited       = !!data?.limited
  const limitedStatus   = data?.friendStatus  // 'none' | 'pending_outgoing' | 'pending_incoming' | 'declined'
  const [requestState, setRequestState] = useState('idle')  // idle | sending | sent | error
  async function sendFriendRequest() {
    if (!friend) return
    setRequestState('sending')
    try {
      // /api/friends/request accepts user_id OR email — pass user_id
      // since we have it from the limited profile load.
      await post('/api/friends/request', { user_id: friend.id })
      setRequestState('sent')
    } catch {
      setRequestState('error')
    }
  }

  // Shared-games list (upcoming tee times the viewer has on the books with
  // this friend) — kept from the original FriendProfile.
  const sharedGames = confirmedGames.filter(g =>
    (g.participants || []).some(p => String(p.user_id) === String(friend?.id))
  )

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      // Page-level wrapper. Top bar stays in the page's light theme
      // (matching ProfileView), body adopts the dark friend-card palette.
      background: '#0E1F13',  // dark fallback during initial paint
      display: 'flex', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      <div style={{
        width: '100%', maxWidth: 430, height: '100%',
        background: 'transparent',
        position: 'relative',
        overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      }}>
        {teeDate ? (
          // Tee-request sheet takes over the whole panel until done.
          <div style={{
            background: 'linear-gradient(180deg, #0E1F13, #070C09)',
            minHeight: '100dvh', padding: '20px 16px 32px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <button onClick={() => setTeeDate(null)} style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 10, color: 'rgba(255,255,255,0.85)', fontSize: 18, fontWeight: 700,
                padding: '4px 12px', cursor: 'pointer', lineHeight: 1, height: 32,
                display: 'inline-flex', alignItems: 'center',
              }}>←</button>
              <div style={{ color: '#fff', fontSize: 16, fontWeight: 800, flex: 1, textAlign: 'center' }}>
                Request a Match
              </div>
              <div style={{ width: 32 }} />
            </div>
            <TeeRequestSheet
              friend={data.friend}
              date={teeDate}
              onSend={() => {}}
              onClose={() => setTeeDate(null)}
            />
          </div>
        ) : (
        <>
        {/* Top bar — light theme, same as ProfileView. Back arrow on the
            left, gold "The Match" title, follow placeholder on the right. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '56px 20px 16px', gap: 12,
          background: 'rgba(255,255,253,0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}>
          <button onClick={onClose} aria-label="Back" style={{
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
          {/* Spacer to mirror the Edit button's width on My Profile so the
              gold title is centered the same way visually. */}
          <div style={{ width: 64 }} />
        </div>

        {/* Body — dark gradient matching ProfileView. */}
        <div style={{
          padding: '16px 16px 100px',
          background: 'linear-gradient(180deg, #0E1F13 0%, #070C09 100%)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          minHeight: 'calc(100dvh - 88px)',
        }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              Loading…
            </div>
          ) : !friend ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#F87171', fontSize: 13 }}>
              Couldn't load this profile.
            </div>
          ) : (
          <>
          {/* Expanded identity card — same dark gradient as ProfileView. */}
          <div style={{
            borderRadius: 18,
            overflow: 'hidden',
            background: 'linear-gradient(155deg, #0F2814 0%, #0A1D0F 40%, #060E08 100%)',
            border: '1px solid rgba(197,160,64,0.18)',
            boxShadow: '0 0 30px rgba(197,160,64,0.05)',
            position: 'relative',
            marginBottom: 12,
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 3, pointerEvents: 'none',
              background: 'linear-gradient(90deg, transparent, rgba(201,160,64,0.7), rgba(232,192,90,1.0), rgba(201,160,64,0.7), transparent)',
            }} />
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: 'radial-gradient(ellipse 70% 60% at 50% -10%, rgba(201,160,64,0.10) 0%, transparent 70%)',
            }} />

            <div style={{ padding: '20px 18px 18px', position: 'relative' }}>
              {/* Limited preview banner — only when the viewer isn't
                  yet friends with this user. Replaces the SEASON
                  label since season stats aren't loaded for non-
                  friends. (2026-05-01) */}
              {isLimited ? (
                <div style={{
                  marginBottom: 14, padding: '10px 14px', borderRadius: 12,
                  background: limitedStatus === 'pending_outgoing'
                    ? 'rgba(245,215,138,0.10)'
                    : limitedStatus === 'pending_incoming'
                      ? 'rgba(94,212,122,0.10)'
                      : 'rgba(255,255,255,0.04)',
                  border: '1px solid', borderColor: limitedStatus === 'pending_incoming'
                    ? 'rgba(94,212,122,0.30)' : 'rgba(245,215,138,0.30)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(245,215,138,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M12 22s-8-4.5-8-11.5a8 8 0 0 1 16 0c0 7-8 11.5-8 11.5z" opacity="0"/>
                    <circle cx="12" cy="12" r="9"/>
                    <path d="M12 7v5l3 2"/>
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: 'rgba(245,215,138,0.85)', letterSpacing: '0.06em' }}>
                      {limitedStatus === 'pending_outgoing'  ? 'REQUEST PENDING'
                       : limitedStatus === 'pending_incoming' ? 'WANTS TO BE FRIENDS'
                       : limitedStatus === 'declined'          ? 'NOT FRIENDS'
                                                                : 'NOT FRIENDS YET'}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                      {limitedStatus === 'pending_outgoing'  ? "You've already sent a request — waiting on " + firstName + "."
                       : limitedStatus === 'pending_incoming' ? `Accept ${firstName}'s request from your inbox to unlock the full profile.`
                       : limitedStatus === 'declined'          ? `Send a new request to start over.`
                                                                : 'Add as a friend to see rounds, stats, and play together.'}
                    </div>
                  </div>
                  {(limitedStatus === 'none' || limitedStatus === 'declined') && requestState !== 'sent' && (
                    <button
                      onClick={sendFriendRequest}
                      disabled={requestState === 'sending'}
                      style={{
                        padding: '7px 12px', borderRadius: 999, border: 'none',
                        background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
                        color: '#070C09', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                        fontFamily: 'inherit', flexShrink: 0,
                        opacity: requestState === 'sending' ? 0.6 : 1,
                      }}>
                      {requestState === 'sending' ? 'Sending…' : 'Add Friend'}
                    </button>
                  )}
                  {requestState === 'sent' && (
                    <span style={{
                      padding: '5px 10px', borderRadius: 999,
                      background: 'rgba(94,212,122,0.16)', border: '1px solid rgba(94,212,122,0.35)',
                      color: '#5ED47A', fontSize: 11, fontWeight: 800, flexShrink: 0,
                    }}>Sent ✓</span>
                  )}
                </div>
              ) : (
                <div style={{ color: 'rgba(245,215,138,0.75)', fontSize: 10, letterSpacing: '0.14em', fontWeight: 700, marginBottom: 12 }}>
                  SEASON {data?.season?.year}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
                {/* Big player card */}
                <div style={{
                  flexShrink: 0, width: 100, height: 140, borderRadius: 14, overflow: 'hidden',
                  border: friend.avatar ? '1px solid rgba(201,160,64,0.45)' : '1px dashed rgba(255,255,255,0.15)',
                  background: friend.avatar ? 'transparent' : 'rgba(255,255,255,0.03)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: friend.avatar ? '0 4px 18px rgba(0,0,0,0.30)' : 'none',
                }}>
                  {friend.avatar ? (
                    <img src={friend.avatar} alt={friend.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 15%' }} />
                  ) : (
                    <span style={{ fontSize: 26, fontWeight: 900, color: '#F5D78A', letterSpacing: '0.04em' }}>
                      {firstName?.[0]?.toUpperCase() || '·'}
                    </span>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{
                    fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em',
                    lineHeight: 1.1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    background: 'linear-gradient(135deg, #A07828, #C9A040, #E8C05A)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  }}>{friend.name}</div>

                  {friend.home_course && (
                    <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {friend.home_course}
                    </div>
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
                    }}>{hcpDisplay}</div>
                    <div style={{ color: 'rgba(245,215,138,0.55)', fontSize: 9, letterSpacing: '0.12em', fontWeight: 700 }}>HCP INDEX</div>
                  </div>
                </div>
              </div>

              {/* Friend's own follow counts + Season W-L-T-AVG3 —
                  friendship-gated. Hidden together in limited preview;
                  fragment wrapper keeps the conditional valid JSX. */}
              {!isLimited && (<>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
                marginBottom: 12, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)',
              }}>
                {[
                  { key: 'following', label: 'Following', value: data?.followCounts?.following ?? 0 },
                  { key: 'followers', label: 'Followers', value: data?.followCounts?.followers ?? 0 },
                  { key: 'mutuals',   label: 'Mutuals',   value: data?.followCounts?.mutuals   ?? 0 },
                ].map(p => (
                  <div key={p.key} style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 12, padding: '10px 8px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '-0.02em' }}>{p.value}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase' }}>{p.label}</div>
                  </div>
                ))}
              </div>

              {/* Season W-L-T-AVG3 — same friendship gate as follow counts above */}
              <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 14 }}>
                {[
                  { label: 'WINS',     value: data?.season?.wins   ?? 0,   color: '#4ADE80' },
                  { label: 'LOSSES',   value: data?.season?.losses ?? 0,   color: '#F87171' },
                  { label: 'TIES',     value: data?.season?.ties   ?? 0,   color: 'rgba(255,255,255,0.45)' },
                  { label: '3-RND AVG', value: data?.avg3 != null ? data.avg3 : '—', color: '#F5D78A' },
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
              </>)}
            </div>
          </div>

          {/* HcpBadge with embedded trend chart — friend's data.
              Hidden in limited preview because no rounds load. */}
          {!isLimited && (
          <HcpBadge
            hcp={data?.stats?.handicap ?? friend?.handicap ?? null}
            roundCount={data?.stats?.roundCount}
            rounds={data?.recentRounds}
          />
          )}

          {/* Avg / Best stat tiles (friend's stats) */}
          {data?.stats && (() => {
            const avgNum  = Number(data.stats.avgScore)
            const bestNum = Number(data.stats.bestScore)
            const avgDisplay  = Number.isFinite(avgNum)  ? avgNum.toFixed(1) : '—'
            const bestDisplay = Number.isFinite(bestNum) ? bestNum            : '—'
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <StatTile theme="dark" label="Avg Score" value={avgDisplay}
                  sub={`Par ${data.recentRounds?.[0]?.course_par ?? 72}`} />
                <StatTile theme="dark" label="Best Round" value={bestDisplay}
                  sub="All time" accent="#4ADE80" />
              </div>
            )
          })()}

          {/* Friend's top rivalries — same card, but "Avg N · Opp N" labels
              instead of "You / Them" since the viewer is a third party. */}
          {(() => {
            const top = (data?.rivalries || []).slice(0, 3)
            if (top.length === 0) return null
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
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', letterSpacing: '0.06em' }}>TOP {top.length}</div>
                </div>
                {top.map((r, i) => {
                  const myWins   = Number(r.my_wins  ?? 0)
                  const oppWins  = Number(r.opp_wins ?? 0)
                  const ties     = Number(r.ties     ?? 0)
                  const myAvg    = r.my_avg  != null ? Number(r.my_avg)  : null
                  const oppAvg   = r.opp_avg != null ? Number(r.opp_avg) : null
                  const myAvgStr  = Number.isFinite(myAvg)  ? myAvg.toFixed(1)  : '—'
                  const oppAvgStr = Number.isFinite(oppAvg) ? oppAvg.toFixed(1) : '—'
                  const initials = (r.opponent_name || '·').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
                  const recordStr = ties > 0 ? `${myWins}-${oppWins}-${ties}` : `${myWins}-${oppWins}`
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
                        cursor: 'pointer', fontFamily: 'inherit',
                        transition: 'background 120ms ease',
                      }}
                      onMouseDown={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                      onMouseUp={e => { e.currentTarget.style.background = 'transparent' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <div style={{
                        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                        background: r.opponent_avatar ? 'transparent' : 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {r.opponent_avatar ? (
                          <img src={r.opponent_avatar} alt={r.opponent_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 800, color: '#F5D78A' }}>{initials}</span>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.opponent_name || 'Player'}
                        </div>
                        <div style={{
                          fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2,
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                          <span>{firstName} <strong style={{ color: '#fff' }}>{myAvgStr}</strong></span>
                          <span style={{ color: 'rgba(255,255,255,0.20)' }}>·</span>
                          <span>Opp <strong style={{ color: '#fff' }}>{oppAvgStr}</strong></span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{
                            fontSize: 18, fontWeight: 900, color: recordColor, lineHeight: 1,
                            fontFamily: '"Arial Black", Arial, sans-serif',
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

                {/* See all rivalries → opens RivalryHistory */}
                {(data?.rivalries?.length ?? 0) > top.length && (
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
                    See all {data.rivalries.length} {data.rivalries.length === 1 ? 'rival' : 'rivals'}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </button>
                )}
              </div>
            )
          })()}

          {/* Friend's distances */}
          {data?.stats?.topClubs?.length > 0 && (
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
              }}>{firstName}'s Distances</div>
              {data.stats.topClubs.map((c, i) => (
                <div key={i} style={{
                  padding: '12px 16px',
                  borderBottom: i < data.stats.topClubs.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <span style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{c.club}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginLeft: 8 }}>{c.shots} shots</span>
                  </div>
                  <div style={{ fontWeight: 800, color: '#F5D78A', fontSize: 15 }}>
                    {c.avgYards}<span style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)', marginLeft: 3 }}>y</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Friend's Recent Rounds — tappable to open scorecards */}
          {data?.recentRounds?.length > 0 && (
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
              }}>Recent Rounds</div>
              {data.recentRounds.slice(0, 3).map((r, i) => {
                const sc  = Number(r.score ?? r.total)
                const par = Number(r.course_par)
                const hasDiff = Number.isFinite(sc) && Number.isFinite(par)
                const diff = hasDiff ? sc - par : null
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
                      <div style={{ fontWeight: 600, color: '#fff', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.course_name ?? 'Round'}
                      </div>
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
                          {Number.isFinite(sc) ? `${sc} strokes` : '—'}
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

              {/* See all rounds → opens RoundHistory bottom sheet for the
                  friend's full round history. (2026-05-01) */}
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
                See all {data.recentRounds.length} round{data.recentRounds.length === 1 ? '' : 's'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          )}

          {/* ── Friend-specific sections below ── */}

          {/* H2H bar (viewer ↔ friend) */}
          <H2HBar
            h2h={data?.h2h ?? { my_wins: 0, their_wins: 0, ties: 0 }}
            myName={undefined}
            theirName={friend?.name}
          />

          {/* Upcoming tee times together (from confirmedGames passed in by Home) */}
          {sharedGames.length > 0 && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(74,222,128,0.07), rgba(74,222,128,0.03))',
              border: '1px solid rgba(74,222,128,0.2)',
              borderRadius: 14, padding: '14px 16px', marginBottom: 12,
            }}>
              <div style={{ color: 'rgba(74,222,128,0.8)', fontSize: 10, letterSpacing: '0.12em', fontWeight: 700, marginBottom: 10 }}>
                UPCOMING TEE TIMES TOGETHER
              </div>
              {sharedGames.map((g, i) => {
                const dateLabel = new Date(g.date + 'T12:00:00').toLocaleDateString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric',
                })
                const isMatch = g.request_type === 'availability_match'
                return (
                  <div key={g.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    paddingBottom: i < sharedGames.length - 1 ? 10 : 0,
                    marginBottom: i < sharedGames.length - 1 ? 10 : 0,
                    borderBottom: i < sharedGames.length - 1 ? '1px solid rgba(74,222,128,0.1)' : 'none',
                  }}>
                    <div>
                      <div style={{ color: '#4ADE80', fontSize: 13, fontWeight: 600 }}>{dateLabel}</div>
                      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>
                        {g.course_name || 'No course set'}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                      color: isMatch ? 'rgba(74,222,128,0.7)' : 'rgba(245,215,138,0.6)',
                      background: isMatch ? 'rgba(74,222,128,0.1)' : 'rgba(245,215,138,0.08)',
                      borderRadius: 5, padding: '2px 8px',
                    }}>{isMatch ? 'CALENDAR' : 'TEE TIME'}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Availability — full calendar in read-only friend-view mode.
              Tapping a day opens the existing TeeRequestSheet with that
              date pre-filled. Dark theme matches the friend body.
              (2026-05-01 — replaces the 14-day AvailabilityStrip.) */}
          <div style={{ marginTop: 8, marginBottom: 12 }}>
            <AvailabilityCalendar
              viewUserId={friend?.id}
              viewUserName={firstName}
              onDayTap={(ymd) => setTeeDate(ymd)}
              theme="dark"
            />
          </div>

          {/* Request a Match CTA */}
          <button
            onClick={() => {
              const nextFree = data?.availability?.[0]?.date?.slice(0, 10)
              setTeeDate(nextFree || todayYMD())
            }}
            style={{
              width: '100%', padding: '14px',
              background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
              color: '#070C09', border: 'none', borderRadius: 14,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              marginTop: 4,
            }}
          >
            Request a Match with {firstName}
          </button>
          </>
          )}
        </div>
        </>
        )}
      </div>

      {/* RoundScorecard modal stacks on top of the FriendProfile when a
          row in their Recent Rounds list is tapped. */}
      {selectedRoundId != null && (
        <RoundScorecard
          roundId={selectedRoundId}
          onClose={() => setSelectedRoundId(null)}
        />
      )}

      {/* Full round history — opened by tapping "See all N rounds" beneath
          the truncated 3-row preview. */}
      {historyOpen && (
        <RoundHistory
          rounds={data?.recentRounds ?? []}
          title={`${friend?.name?.split(' ')[0] || 'Player'}'s Rounds`}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* Full rivalries list — opened by tapping "See all N rivals".
          Subject is the friend (their profile, their rivalries), so the
          face-off detail uses the friend as the "you" side. */}
      {rivalriesOpen && (
        <RivalryHistory
          rivalries={data?.rivalries ?? []}
          title={`${firstName}'s Rivalries`}
          subjectName={friend?.name}
          subjectAvatar={friend?.avatar}
          subjectHandicap={friend?.handicap}
          selfLabel={firstName}
          oppLabel="Opp"
          onSelectOpponent={onOpenFriend}
          onClose={() => setRivalriesOpen(false)}
        />
      )}

      {/* RivalryDetail when tapped from the inline top-3 list */}
      {selectedRivalry && (
        <RivalryDetail
          rivalry={selectedRivalry}
          myName={friend?.name}
          myAvatar={friend?.avatar}
          myHandicap={friend?.handicap}
          onSelectOpponent={onOpenFriend ? (opp) => {
            setSelectedRivalry(null)
            onOpenFriend(opp)
          } : undefined}
          onClose={() => setSelectedRivalry(null)}
        />
      )}
    </div>,
    document.body
  )
}
