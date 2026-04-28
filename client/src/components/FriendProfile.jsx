import { useState, useEffect, useRef, useCallback } from 'react'
import { api, post } from '../lib/api.js'

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

// ── Main FriendProfile Modal ──────────────────────────────────────────────────
export default function FriendProfile({ friend: friendSummary, myName, confirmedGames = [], onClose }) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [teeDate, setTeeDate]   = useState(null) // date string when tee request sheet is open

  useEffect(() => {
    if (!friendSummary?.friend_id) return
    api(`/api/friends/${friendSummary.friend_id}/profile`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [friendSummary?.friend_id])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 430,
        background: 'linear-gradient(180deg, #0E1F13, #070C09)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '22px 22px 0 0',
        maxHeight: '88dvh', overflowY: 'auto',
        padding: '20px 16px 32px',
        WebkitOverflowScrolling: 'touch',
      }} onClick={e => e.stopPropagation()}>

        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.15)', margin: '0 auto 20px' }} />

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ color: '#fff', fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {friendSummary?.friend_name}
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8,
            color: 'rgba(255,255,255,0.5)', fontSize: 13, padding: '6px 12px', cursor: 'pointer',
          }}>Close</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
            Loading…
          </div>
        ) : teeDate ? (
          <TeeRequestSheet
            friend={data.friend}
            date={teeDate}
            onSend={() => {}}
            onClose={() => setTeeDate(null)}
          />
        ) : (
          <>
            {/* Season card */}
            <FriendSeasonCard friend={data?.friend} season={data?.season} avg3={data?.avg3} />

            {/* H2H */}
            <H2HBar h2h={data?.h2h ?? { my_wins: 0, their_wins: 0, ties: 0 }} myName={myName} theirName={data?.friend?.name} />

            {/* Recent rounds */}
            {data?.recentRounds?.length > 0 && (
              <div style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: 14, padding: '14px 16px', marginBottom: 12,
              }}>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.12em', fontWeight: 600, marginBottom: 10 }}>RECENT ROUNDS</div>
                {data.recentRounds.map((r, i) => {
                  const diff = r.total - (r.course_par || 72)
                  const diffStr = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff)
                  const diffColor = diff < 0 ? '#4ADE80' : diff > 0 ? '#F87171' : '#F5D78A'
                  return (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      paddingBottom: i < data.recentRounds.length - 1 ? 10 : 0,
                      marginBottom: i < data.recentRounds.length - 1 ? 10 : 0,
                      borderBottom: i < data.recentRounds.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    }}>
                      <div>
                        <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{r.course_name}</div>
                        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
                          {new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: diffColor }}>{diffStr}</div>
                        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{r.total} strokes</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Upcoming games with this friend */}
            {(() => {
              const fid = data?.friend?.id
              const sharedGames = confirmedGames.filter(g =>
                (g.participants || []).some(p => p.user_id === fid)
              )
              if (!sharedGames.length) return null
              return (
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
              )
            })()}

            {/* Availability */}
            <AvailabilityStrip
              availability={data?.availability ?? []}
              friendName={data?.friend?.name}
              onRequestTeeTime={setTeeDate}
            />

            {/* Challenge button */}
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
              Request a Match with {data?.friend?.name?.split(' ')[0]}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
