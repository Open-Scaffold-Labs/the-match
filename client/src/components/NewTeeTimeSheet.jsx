import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../lib/api.js'
import { dedupeTees } from '../lib/tees.js'
import { tmHaptic } from '../pages/Outing/shared.jsx'

// ─── NewTeeTimeSheet ────────────────────────────────────────────────────────
// "+ New Tee Time" entry triggered from the TEE TIMES section on Home.
// Lets the host roster a confirmed-by-creator tee time:
//   • Course (pulled from /api/courses/search; fall back to type-your-own)
//   • Date + start_time (defaults to tomorrow @ 8:00 AM)
//   • Up to 7 invitees from the host's Following + Followers lists
//   • Up to 7 named guests typed in manually (no account needed)
//
// Default mode is confirmed_by_creator=true: invitees go straight to
// 'accepted' status server-side. Decline is a single tap on the
// resulting card if they need to back out. (Matt: "i talked to my
// friends on the phone earlier, we agreed... i went to put in a
// confirmed tee time".)
//
// (2026-05-06.)

export default function NewTeeTimeSheet({ user, onClose, onCreated }) {
  // ── Form state ──────────────────────────────────────────────────────────
  const [courseName, setCourseName] = useState('')
  // 2026-05-06 — course autocomplete. Mirrors CreateWizard's
  // CoursePicker pattern: ask the browser for coordinates once on
  // mount, then run a 250ms-debounced GET /api/courses/search whenever
  // the user types 2+ chars. Results are surfaced in a dropdown
  // directly under the input. Tap a result → courseName fills, the
  // dropdown closes. The user can also keep typing a free-form name
  // (for courses that aren't in the API). (Matt: "should auto
  // populate with courses closest to you".)
  const [coords, setCoords] = useState(null)
  const [courseResults, setCourseResults] = useState([])
  const [courseSearching, setCourseSearching] = useState(false)
  const [coursePicked, setCoursePicked] = useState(false)
  // Ask once on mount. If geolocation is denied or unsupported, we
  // still search, just without distance ranking.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => { /* denied — silent fallback */ },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60 * 1000 }
    )
  }, [])
  // Debounced search.
  useEffect(() => {
    const q = courseName.trim()
    // After the user has explicitly tapped a result we suppress the
    // dropdown until they edit again (otherwise typing finishes →
    // tap → dropdown reopens with same query).
    if (coursePicked) return
    if (q.length < 2) {
      setCourseResults([])
      setCourseSearching(false)
      return
    }
    setCourseSearching(true)
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q })
        if (coords) {
          params.set('lat', String(coords.lat))
          params.set('lng', String(coords.lng))
        }
        const r = await api(`/api/courses/search?${params.toString()}`)
        setCourseResults(Array.isArray(r?.courses) ? r.courses : [])
      } catch {
        setCourseResults([])
      } finally {
        setCourseSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [courseName, coords, coursePicked])
  function pickCourse(c) {
    setCourseName(c.club_name || c.course_name || '')
    setCoursePicked(true)
    setCourseResults([])
  }
  // Default to tomorrow's date at 8:00 AM — most common case for a
  // tee time you're scheduling the night before.
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [time, setTime] = useState('08:00')
  const [selectedIds, setSelectedIds] = useState([])
  const [guestNames, setGuestNames] = useState([])
  const [guestInput, setGuestInput] = useState('')
  const [confirmedByCreator, setConfirmedByCreator] = useState(true)

  // ── Friend list (Following + Followers, deduped) ────────────────────────
  const [friends, setFriends] = useState(null) // null = loading, [] = none, [...] = list
  const [friendQuery, setFriendQuery] = useState('')
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [a, b] = await Promise.all([
          api('/api/follows/list?type=following').catch(() => ({ users: [] })),
          api('/api/follows/list?type=followers').catch(() => ({ users: [] })),
        ])
        if (!alive) return
        const seen = new Map()
        for (const u of [...(a?.users || []), ...(b?.users || [])]) {
          if (u && u.id != null && !seen.has(String(u.id))) seen.set(String(u.id), u)
        }
        setFriends([...seen.values()].sort((x, y) => (x.name || '').localeCompare(y.name || '')))
      } catch {
        if (alive) setFriends([])
      }
    })()
    return () => { alive = false }
  }, [])

  // Filtered friend list — case-insensitive name match.
  const filteredFriends = (() => {
    if (!Array.isArray(friends)) return []
    const q = friendQuery.trim().toLowerCase()
    if (!q) return friends
    return friends.filter(u => (u.name || '').toLowerCase().includes(q))
  })()

  function toggleFriend(id) {
    const sid = String(id)
    setSelectedIds(prev => prev.includes(sid)
      ? prev.filter(x => x !== sid)
      : prev.length >= 7 ? prev : [...prev, sid])
  }

  function addGuest() {
    const name = guestInput.trim()
    if (!name) return
    if (guestNames.length >= 7) return
    setGuestNames(prev => [...prev, name])
    setGuestInput('')
  }
  function removeGuest(idx) {
    setGuestNames(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Submit ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (saving) return
    setErr('')
    if (!date) { setErr('Pick a date.'); return }
    const total = 1 + selectedIds.length + guestNames.length
    if (total < 2) {
      setErr('Add at least one other player.')
      return
    }
    setSaving(true)
    try {
      const body = {
        date,
        start_time: time || null,
        course_name: courseName || null,
        request_type: 'tee_time',
        invitee_ids: selectedIds.map(Number).filter(Number.isFinite),
        guest_names: guestNames,
        confirmed_by_creator: !!confirmedByCreator,
      }
      const r = await post('/api/games', body)
      tmHaptic(15)
      onCreated?.(r)
      onClose?.()
    } catch (e) {
      setErr(e?.payload?.error || e?.message || 'Failed to schedule.')
    } finally {
      setSaving(false)
    }
  }

  const totalPlayers = 1 + selectedIds.length + guestNames.length
  const canSubmit = !saving && date && totalPlayers >= 2

  // ── Render ──────────────────────────────────────────────────────────────
  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430,
        background: '#FFFDF8',
        borderRadius: '20px 20px 0 0',
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 -8px 30px rgba(0,0,0,0.30)',
      }}>
        {/* Header */}
        <div style={{
          padding: 'calc(var(--safe-top) + 12px) 18px 12px',
          borderBottom: '1px solid rgba(27,94,59,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 1,
          background: '#FFFDF8',
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--tm-text)' }}>New Tee Time</div>
            <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 2 }}>
              {totalPlayers} player{totalPlayers === 1 ? '' : 's'} so far
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.12)',
            borderRadius: 10, color: '#1B5E3B', fontSize: 16, padding: '4px 12px',
            cursor: 'pointer',
          }}>✕</button>
        </div>

        <div style={{ padding: '14px 18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Course — autocomplete with closest-first ranking when
              geolocation is granted. Matches CreateWizard's
              CoursePicker behavior; query 2+ chars → debounced
              /api/courses/search with lat/lng → tap a result to
              select. Free-form typing still works for courses not
              in the API (the input value submits as-is). */}
          <Field label="Course">
            <div style={{ position: 'relative' }}>
              <input
                value={courseName}
                onChange={e => {
                  setCourseName(e.target.value)
                  // User edited after picking → re-enable the dropdown.
                  setCoursePicked(false)
                }}
                placeholder={coords ? 'Type a course (closest first)' : 'Type a course'}
                style={inputStyle()}
              />
              {!coursePicked && (courseSearching || courseResults.length > 0) && courseName.trim().length >= 2 && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  zIndex: 5,
                  background: 'var(--tm-surface)',
                  border: '1px solid var(--tm-border)',
                  borderRadius: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  maxHeight: 240, overflowY: 'auto',
                }}>
                  {courseSearching && courseResults.length === 0 && (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--tm-text-3)' }}>
                      Searching{coords ? ' near you' : ''}…
                    </div>
                  )}
                  {!courseSearching && courseResults.length === 0 && (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--tm-text-3)' }}>
                      No matches. Keep typing or use the name as-is.
                    </div>
                  )}
                  {courseResults.map(c => (
                    <button
                      key={c.id}
                      onClick={() => pickCourse(c)}
                      style={{
                        width: '100%', textAlign: 'left',
                        padding: '10px 14px',
                        background: 'transparent', border: 'none',
                        borderBottom: '1px solid rgba(27,94,59,0.06)',
                        cursor: 'pointer',
                      }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text)' }}>
                        {c.club_name || c.course_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 2 }}>
                        {[c.location_city, c.location_state].filter(Boolean).join(', ')}
                        {c.distance_miles != null && (
                          <span style={{ marginLeft: 6, color: 'var(--tm-gold-text)', fontWeight: 700 }}>
                            · {c.distance_miles.toFixed(1)} mi
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          {/* Date + time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Date">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle()} />
            </Field>
            <Field label="Tee time">
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputStyle()} />
            </Field>
          </div>

          {/* Friend picker */}
          <Field label={`From your friends (${selectedIds.length} selected)`}>
            <input
              value={friendQuery}
              onChange={e => setFriendQuery(e.target.value)}
              placeholder="Search your following + followers"
              style={inputStyle()}
            />
            <div style={{
              maxHeight: 200, overflowY: 'auto', marginTop: 6,
              border: '1px solid var(--tm-border)', borderRadius: 12,
              background: 'var(--tm-surface)',
            }}>
              {friends === null && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--tm-text-3)' }}>Loading…</div>
              )}
              {friends && filteredFriends.length === 0 && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--tm-text-3)' }}>
                  {friendQuery ? 'No matches.' : 'No friends found. Use guests below or follow some players first.'}
                </div>
              )}
              {filteredFriends.map(u => {
                const sid = String(u.id)
                const sel = selectedIds.includes(sid)
                return (
                  <button key={sid} onClick={() => toggleFriend(sid)} style={{
                    width: '100%', textAlign: 'left',
                    padding: '10px 12px',
                    background: sel ? 'rgba(27,94,59,0.08)' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(27,94,59,0.06)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--tm-text)' }}>{u.name}</span>
                    {sel && (
                      <span style={{
                        fontSize: 11, fontWeight: 800, color: 'var(--tm-green-text)',
                        background: 'rgba(27,94,59,0.12)',
                        padding: '2px 8px', borderRadius: 999,
                      }}>SELECTED</span>
                    )}
                  </button>
                )
              })}
            </div>
          </Field>

          {/* Guest names */}
          <Field label={`Guests (${guestNames.length})`}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={guestInput}
                onChange={e => setGuestInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGuest() } }}
                placeholder="Full name (e.g. Bob Smith)"
                style={{ ...inputStyle(), flex: 1 }}
              />
              <button onClick={addGuest} disabled={!guestInput.trim() || guestNames.length >= 7} style={{
                padding: '0 16px', borderRadius: 12,
                background: guestInput.trim() && guestNames.length < 7
                  ? 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))'
                  : 'var(--tm-surface-2)',
                color: guestInput.trim() && guestNames.length < 7
                  ? 'var(--tm-text-inv)' : 'var(--tm-text-3)',
                fontWeight: 800, fontSize: 14, border: 'none',
                cursor: guestInput.trim() && guestNames.length < 7 ? 'pointer' : 'default',
                flexShrink: 0,
              }}>Add</button>
            </div>
            {guestNames.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {guestNames.map((name, i) => (
                  <span key={`${name}-${i}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', borderRadius: 999,
                    background: 'rgba(232,192,90,0.16)',
                    border: '1px solid rgba(232,192,90,0.40)',
                    color: 'var(--tm-gold-text)', fontSize: 12, fontWeight: 700,
                  }}>
                    {name}
                    <button onClick={() => removeGuest(i)} aria-label={`Remove ${name}`} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--tm-gold-text)', fontSize: 14, padding: 0,
                      lineHeight: 1,
                    }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--tm-text-3)', marginTop: 6, lineHeight: 1.4 }}>
              Guests don't have accounts — they show up on everyone's roster but don't get push notifications.
            </div>
          </Field>

          {/* Confirmed-by-creator toggle */}
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 12px', borderRadius: 12,
            background: confirmedByCreator ? 'rgba(27,94,59,0.06)' : 'var(--tm-surface-2)',
            border: confirmedByCreator ? '1px solid rgba(27,94,59,0.20)' : '1px solid var(--tm-border)',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={confirmedByCreator}
              onChange={e => setConfirmedByCreator(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text)' }}>
                We've already agreed
              </div>
              <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 2, lineHeight: 1.4 }}>
                Default ON. Invitees go straight to confirmed instead of pending — they can still tap Decline on the card if anything changes.
              </div>
            </span>
          </label>

          {err && (
            <div style={{
              padding: '8px 12px', borderRadius: 8,
              background: 'rgba(220,38,38,0.10)',
              border: '1px solid rgba(220,38,38,0.32)',
              color: 'var(--tm-danger)', fontSize: 12, fontWeight: 700, textAlign: 'center',
            }}>{err}</div>
          )}

          {/* Submit */}
          <button onClick={submit} disabled={!canSubmit} style={{
            width: '100%', padding: '14px', borderRadius: 14, border: 'none',
            background: canSubmit
              ? 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))'
              : 'var(--tm-surface-2)',
            color: canSubmit ? '#fff' : 'var(--tm-text-3)',
            fontWeight: 800, fontSize: 15,
            cursor: canSubmit ? 'pointer' : 'default',
          }}>
            {saving ? 'Scheduling…' : 'Schedule Tee Time'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Tiny field wrapper for consistency ────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: '0.10em',
        color: 'var(--tm-text-3)', textTransform: 'uppercase',
        marginBottom: 6,
      }}>{label}</div>
      {children}
    </div>
  )
}

function inputStyle() {
  return {
    width: '100%', padding: '12px 14px', borderRadius: 12,
    border: '1px solid var(--tm-border)',
    background: 'var(--tm-surface-2)',
    fontSize: 14, color: 'var(--tm-text)',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  }
}
