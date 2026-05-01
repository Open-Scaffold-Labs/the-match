// OnboardingWizard — first-run mandatory wizard. Blocks app access
// until the user finishes the four mandatory steps:
//   1. Welcome (display name confirmation)
//   2. Handicap (range pick)
//   3. Home course (search-as-you-type)
//   4. First club (driver brand + model + avg distance)
// Step 5 (add a friend) is optional; the wizard finalizes after
// step 4 with a "you're set" screen and optional friend search.
//
// Each step PUTs /api/onboarding/step on advance so progress
// persists across reloads. The blocking-step set is enforced
// server-side too; this UI just gates the next button.
//
// (2026-05-01 — Matt: friends-test prep)

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, put, post } from '../lib/api.js'
// Profile saves go through POST /api/profile/update (not PUT /api/profile);
// renamed locally for readability inside this wizard.
const saveProfile = (body) => post('/api/profile/update', body)
import { brandsForSlot, modelsForSlot } from '../lib/clubCatalog.js'

const HANDICAP_RANGES = [
  { key: 'low_single',  label: '0–5',         midpoint: 3 },
  { key: 'mid_single',  label: '6–10',        midpoint: 8 },
  { key: 'low_double',  label: '11–15',       midpoint: 13 },
  { key: 'mid_double',  label: '16–20',       midpoint: 18 },
  { key: 'high_double', label: '21+',         midpoint: 24 },
  { key: 'unknown',     label: "I don't know yet", midpoint: null },
]

export default function OnboardingWizard({ user, onUserUpdate, onComplete }) {
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Step 1 state — name (pre-filled from signup)
  const [name, setName] = useState(user?.name || '')

  // Step 2 — handicap range
  const [hcpRange, setHcpRange] = useState(null)

  // Step 3 — home course
  const [homeCourse, setHomeCourse] = useState('')
  const [courseSuggestions, setCourseSuggestions] = useState([])
  const [coords, setCoords] = useState(null)
  const [coursePicked, setCoursePicked] = useState(false)

  // Step 4 — first club (Driver default)
  const driverBrands = brandsForSlot('driver')
  const [driverBrand, setDriverBrand] = useState('')
  const [driverModel, setDriverModel] = useState('')
  const [driverYards, setDriverYards] = useState('')
  const [customDriver, setCustomDriver] = useState(false)

  // Step 5 — friend (optional)
  const [friendQuery, setFriendQuery] = useState('')
  const [friendResults, setFriendResults] = useState([])
  const [friendSearching, setFriendSearching] = useState(false)

  // Geolocation for course suggestions
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60 * 1000 }
    )
  }, [])

  // Course typeahead
  useEffect(() => {
    if (step !== 2 || coursePicked) return
    const q = homeCourse.trim()
    if (q.length < 2) { setCourseSuggestions([]); return }
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q })
        if (coords) { params.set('lat', String(coords.lat)); params.set('lng', String(coords.lng)) }
        const res = await api(`/api/courses/search?${params.toString()}`)
        setCourseSuggestions(Array.isArray(res?.courses) ? res.courses.slice(0, 6) : [])
      } catch { setCourseSuggestions([]) }
    }, 250)
    return () => clearTimeout(t)
  }, [homeCourse, coords, step, coursePicked])

  // Friend typeahead
  useEffect(() => {
    if (step !== 4) return
    const q = friendQuery.trim()
    if (q.length < 2) { setFriendResults([]); return }
    setFriendSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await api(`/api/friends/search?q=${encodeURIComponent(q)}`)
        setFriendResults(Array.isArray(r?.users) ? r.users.slice(0, 6) : [])
      } catch { setFriendResults([]) }
      finally { setFriendSearching(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [friendQuery, step])

  async function markStep(name) {
    try { await put('/api/onboarding/step', { step: name }) } catch {}
  }

  async function next() {
    setError(''); setBusy(true)
    try {
      if (step === 0) {
        // Welcome — save name if changed
        const trimmed = name.trim()
        if (!trimmed) { setError('Pick a display name'); setBusy(false); return }
        if (trimmed !== user?.name) {
          await saveProfile({ name: trimmed })
        }
        await markStep('welcome')
        onUserUpdate?.({ ...user, name: trimmed })
        setStep(1)
      } else if (step === 1) {
        if (!hcpRange) { setError('Pick a range'); setBusy(false); return }
        const meta = HANDICAP_RANGES.find(r => r.key === hcpRange)
        // Only persist a numeric handicap when the user picked a real range.
        // 'unknown' just records the step; handicap stays null.
        if (meta?.midpoint != null) {
          await saveProfile({ handicap: meta.midpoint })
        }
        await markStep('handicap')
        setStep(2)
      } else if (step === 2) {
        if (!homeCourse.trim()) { setError('Pick a course or type a name'); setBusy(false); return }
        await saveProfile({ home_course: homeCourse.trim() })
        await markStep('home_course')
        setStep(3)
      } else if (step === 3) {
        if (!driverBrand.trim() || !driverModel.trim()) {
          setError('Brand and model required'); setBusy(false); return
        }
        const yardsNum = Number(driverYards)
        if (!Number.isFinite(yardsNum) || yardsNum <= 0) {
          setError('Enter your average driver distance in yards'); setBusy(false); return
        }
        await put('/api/clubs/bag/driver', {
          brand: driverBrand.trim(),
          model: driverModel.trim(),
          avg_yards: Math.round(yardsNum),
        })
        await markStep('first_club')
        // Step 4 is the optional friend screen — wizard becomes
        // dismissable from here forward (block check passes).
        setStep(4)
      } else if (step === 4) {
        // Friend step is opt-in — finalize regardless of whether they picked.
        await markStep('friend')
        await post('/api/onboarding/complete', {})
        onComplete?.()
      }
    } catch (e) {
      setError(e?.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function skipFriend() {
    setBusy(true)
    try {
      await post('/api/onboarding/complete', {})
      onComplete?.()
    } finally { setBusy(false) }
  }

  function pickCourseSuggestion(c) {
    const display = c.club_name || c.course_name || ''
    setHomeCourse(display)
    setCourseSuggestions([])
    setCoursePicked(true)
  }

  async function sendFriendRequest(u) {
    try {
      await post('/api/friends/request', { friend_id: u.id })
      // Mark them as sent in the local list so the button updates
      setFriendResults(prev => prev.map(r => r.id === u.id ? { ...r, _sent: true } : r))
    } catch {}
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'linear-gradient(180deg, #0E1F13 0%, #070C09 100%)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '56px 20px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{
          fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em',
          background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9A040 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          flex: 1, textAlign: 'center',
        }}>The Match</div>
      </div>

      {/* Step pills */}
      <div style={{
        display: 'flex', gap: 6, padding: '0 20px 20px',
      }}>
        {[0,1,2,3,4].map(i => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i <= step ? 'linear-gradient(135deg, #F5D78A, #C9A040)' : 'rgba(255,255,255,0.08)',
          }} />
        ))}
      </div>

      {/* Body */}
      <div style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        padding: '0 20px 24px',
        color: '#fff',
      }}>
        {step === 0 && (
          <Step
            badge="WELCOME"
            title={`Hey, ${user?.name?.split(' ')[0] || 'there'}.`}
            sub="Confirm what your friends will see in matches and on the leaderboard."
          >
            <Label>Display Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Matt Lavin" autoFocus />
          </Step>
        )}

        {step === 1 && (
          <Step
            badge="STEP 2 OF 4"
            title="What's your handicap?"
            sub="Pick the range you usually shoot in. We'll dial it in once you've logged a few rounds."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {HANDICAP_RANGES.map(r => (
                <button key={r.key} onClick={() => setHcpRange(r.key)} style={{
                  padding: '14px', borderRadius: 12,
                  background: hcpRange === r.key ? 'rgba(245,215,138,0.10)' : 'rgba(255,255,255,0.04)',
                  border: hcpRange === r.key ? '1px solid rgba(245,215,138,0.55)' : '1px solid rgba(255,255,255,0.10)',
                  color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <span>{r.label}</span>
                  {hcpRange === r.key && <span style={{ color: '#F5D78A', fontSize: 16 }}>✓</span>}
                </button>
              ))}
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step
            badge="STEP 3 OF 4"
            title="Where do you usually play?"
            sub="Your home course shows up on your profile and pre-fills when you create a match."
          >
            <Label>Home Course</Label>
            <div style={{ position: 'relative' }}>
              <Input
                value={homeCourse}
                onChange={e => { setHomeCourse(e.target.value); setCoursePicked(false) }}
                placeholder="Search nearby courses…"
                autoFocus
              />
              {!coursePicked && courseSuggestions.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                  background: 'rgba(7,12,9,0.95)',
                  border: '1px solid rgba(245,215,138,0.30)',
                  borderRadius: 12, overflow: 'hidden',
                  maxHeight: 280, overflowY: 'auto', zIndex: 5,
                }}>
                  {courseSuggestions.map((c, i) => {
                    const where = [c.city, c.state].filter(Boolean).join(', ')
                    const dist = Number.isFinite(c.distance_km)
                      ? `${(c.distance_km * 0.621371).toFixed(c.distance_km < 16 ? 1 : 0)} mi`
                      : null
                    return (
                      <button key={c.id ?? i} onClick={() => pickCourseSuggestion(c)} style={{
                        width: '100%', padding: '10px 14px',
                        background: 'transparent', border: 'none',
                        borderBottom: i < courseSuggestions.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                        color: '#fff', fontFamily: 'inherit', textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.club_name || c.course_name}
                          </div>
                          {where && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.50)', marginTop: 2 }}>{where}</div>}
                        </div>
                        {dist && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#F5D78A', flexShrink: 0 }}>{dist}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </Step>
        )}

        {step === 3 && (
          <Step
            badge="STEP 4 OF 4"
            title="Add your driver."
            sub="We use this distance to power Eagle Eye's club picker on the course. You can fill the rest of your bag later."
          >
            <Label>Brand</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {driverBrands.map(b => {
                const active = !customDriver && b === driverBrand
                return (
                  <button key={b} onClick={() => { setCustomDriver(false); setDriverBrand(b); if (!modelsForSlot('driver', b).includes(driverModel)) setDriverModel('') }} style={{
                    background: active ? 'linear-gradient(135deg, #F5D78A, #C9A040)' : 'rgba(255,255,255,0.05)',
                    border: active ? '1px solid rgba(245,215,138,0.85)' : '1px solid rgba(255,255,255,0.10)',
                    color: active ? '#070C09' : '#F5D78A',
                    padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>{b}</button>
                )
              })}
              <button onClick={() => { setCustomDriver(true); setDriverBrand(''); setDriverModel('') }} style={{
                background: customDriver ? 'linear-gradient(135deg, #F5D78A, #C9A040)' : 'rgba(255,255,255,0.05)',
                border: customDriver ? '1px solid rgba(245,215,138,0.85)' : '1px dashed rgba(255,255,255,0.30)',
                color: customDriver ? '#070C09' : '#F5D78A',
                padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>+ Other</button>
            </div>

            {customDriver && (
              <>
                <Label>Brand (custom)</Label>
                <Input value={driverBrand} onChange={e => setDriverBrand(e.target.value)} placeholder="e.g. Tour Edge" />
                <Label style={{ marginTop: 10 }}>Model (custom)</Label>
                <Input value={driverModel} onChange={e => setDriverModel(e.target.value)} placeholder="e.g. Hot Launch C524" />
              </>
            )}
            {!customDriver && driverBrand && (
              <>
                <Label>Model</Label>
                <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 6 }}>
                  {modelsForSlot('driver', driverBrand).map(m => {
                    const active = m === driverModel
                    return (
                      <button key={m} onClick={() => setDriverModel(m)} style={{
                        width: '100%',
                        background: active ? 'rgba(245,215,138,0.10)' : 'transparent',
                        border: active ? '1px solid rgba(245,215,138,0.55)' : '1px solid rgba(255,255,255,0.06)',
                        color: '#fff', padding: '10px 14px', borderRadius: 10, marginBottom: 4,
                        textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
                        fontSize: 14, fontWeight: 700,
                      }}>{m}</button>
                    )
                  })}
                </div>
              </>
            )}

            {(driverBrand && driverModel) && (
              <>
                <Label style={{ marginTop: 10 }}>Average Distance (yards)</Label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Input
                    type="number" inputMode="numeric" min="0" max="400"
                    value={driverYards}
                    onChange={e => setDriverYards(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="e.g. 245"
                    style={{ flex: 1 }}
                  />
                  <span style={{
                    background: 'rgba(245,215,138,0.10)', color: '#F5D78A',
                    padding: '8px 14px', borderRadius: 999,
                    fontSize: 14, fontWeight: 700,
                  }}>yds</span>
                </div>
              </>
            )}
          </Step>
        )}

        {step === 4 && (
          <Step
            badge="LAST STEP"
            title="Add a friend (optional)."
            sub="Friends can request matches with you and see your availability. You can skip this and add them anytime."
          >
            <Label>Search by name or email</Label>
            <Input value={friendQuery} onChange={e => setFriendQuery(e.target.value)} placeholder="Type to search…" />
            <div style={{ marginTop: 10 }}>
              {friendSearching && friendResults.length === 0 && (
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, padding: '12px 0' }}>Searching…</div>
              )}
              {friendResults.map(u => (
                <div key={u.id} style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12, padding: '10px 14px', marginBottom: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{u.name}</div>
                    {u.email && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{u.email}</div>}
                  </div>
                  {u._sent ? (
                    <span style={{ color: '#4ADE80', fontSize: 12, fontWeight: 700 }}>✓ Sent</span>
                  ) : (
                    <button onClick={() => sendFriendRequest(u)} style={{
                      background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
                      border: 'none', borderRadius: 999,
                      color: '#070C09', fontSize: 12, fontWeight: 800,
                      padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit',
                    }}>+ Request</button>
                  )}
                </div>
              ))}
            </div>
          </Step>
        )}

        {error && (
          <div style={{
            color: '#FCA5A5', fontSize: 13, marginTop: 12,
            background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)',
            borderRadius: 8, padding: '8px 12px',
          }}>{error}</div>
        )}
      </div>

      {/* Footer CTAs */}
      <div style={{
        padding: '14px 20px calc(14px + env(safe-area-inset-bottom)) 20px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', gap: 10,
      }}>
        {step > 0 && step < 4 && (
          <button onClick={() => setStep(s => s - 1)} disabled={busy} style={{
            flex: 1, padding: '14px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 12, color: 'rgba(255,255,255,0.75)',
            fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>Back</button>
        )}
        {step === 4 && (
          <button onClick={skipFriend} disabled={busy} style={{
            flex: 1, padding: '14px',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 12, color: 'rgba(255,255,255,0.75)',
            fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>Skip for now</button>
        )}
        <button onClick={next} disabled={busy} style={{
          flex: 2, padding: '14px',
          background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
          border: 'none', borderRadius: 12,
          color: '#070C09', fontSize: 15, fontWeight: 800,
          cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
          opacity: busy ? 0.6 : 1,
        }}>
          {busy ? '…' : (step === 4 ? "I'm set" : step === 3 ? 'Add to Bag' : 'Continue')}
        </button>
      </div>
    </div>,
    document.body
  )
}

// ─── Layout primitives ───────────────────────────────────────────────────────
function Step({ badge, title, sub, children }) {
  return (
    <>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'rgba(245,215,138,0.65)',
        letterSpacing: '0.20em', marginBottom: 8,
      }}>{badge}</div>
      <div style={{
        fontSize: 26, fontWeight: 900, color: '#fff',
        letterSpacing: '-0.02em', lineHeight: 1.15, marginBottom: 8,
      }}>{title}</div>
      {sub && (
        <div style={{
          fontSize: 14, color: 'rgba(255,255,255,0.55)',
          lineHeight: 1.55, marginBottom: 22,
        }}>{sub}</div>
      )}
      {children}
    </>
  )
}

function Label({ children, style }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'rgba(245,215,138,0.65)',
      letterSpacing: '0.10em', marginBottom: 8, ...style,
    }}>{children}</div>
  )
}

function Input({ style, ...rest }) {
  return (
    <input
      {...rest}
      style={{
        width: '100%', boxSizing: 'border-box',
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12, color: '#fff', padding: '13px 16px',
        fontSize: 15, fontFamily: 'inherit', outline: 'none',
        ...style,
      }}
    />
  )
}
