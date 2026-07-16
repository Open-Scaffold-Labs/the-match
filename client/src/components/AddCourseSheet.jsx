// AddCourseSheet — add a community course (migration 047, 2026-07-15).
//
// The fix for private clubs the course-data vendor doesn't carry (verified:
// "Augusta National" → zero vendor results). A member enters their club once
// — name, 9/18 pars (tap a hole to cycle 3→4→5→6), optional city/state and
// rating/slope — and every Match user can pick it afterward. POSTs
// /api/courses/custom; the created course comes back in the exact
// /api/courses/:id detail shape, so the caller drops it straight into the
// normal tee-selection flow. A 409 (already added) resolves to the existing
// course instead of forking data.
//
// Dark full-screen portal so it reads correctly over both picker variants.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { post } from '../lib/api.js'

const FIELD = {
  width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 12,
  fontSize: 15, background: 'rgba(255,255,255,0.06)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.14)', outline: 'none',
}
const LABEL = { fontSize: 9.5, letterSpacing: '0.22em', fontWeight: 800, color: 'var(--tm-gold, #C9A040)', textTransform: 'uppercase', margin: '14px 0 6px' }

export default function AddCourseSheet({ initialName = '', onCreated, onClose }) {
  const [name, setName] = useState(initialName)
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [holeCount, setHoleCount] = useState(18)
  const [pars, setPars] = useState(() => Array(18).fill(4))
  const [rating, setRating] = useState('')
  const [slope, setSlope] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const cyclePar = (i) => setPars(p => {
    const n = [...p]
    n[i] = n[i] >= 6 ? 3 : n[i] + 1
    return n
  })
  const activePars = pars.slice(0, holeCount)
  const parTotal = activePars.reduce((a, b) => a + b, 0)

  async function save() {
    if (!name.trim()) { setError('Give the course a name.'); return }
    setSaving(true)
    setError(null)
    try {
      const body = {
        clubName: name, city: city || undefined, state: state || undefined,
        holePars: activePars,
        courseRating: rating ? Number(rating) : undefined,
        slopeRating: slope ? Number(slope) : undefined,
      }
      const detail = await post('/api/courses/custom', body)
      onCreated?.(detail)
    } catch (e) {
      // 409 — already in The Match: the server sends the existing course;
      // our api helper surfaces the message. Resolving to the existing row
      // needs its id, so just tell the user to search for it.
      setError(String(e?.message || 'Couldn’t save — try again.'))
    } finally { setSaving(false) }
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10001,
      background: 'var(--tm-dark-0, #0D1F12)', color: '#fff',
      display: 'flex', flexDirection: 'column',
      animation: 'tm-sheet-up 280ms var(--tm-ease-out, ease-out) both',
    }}>
      <div style={{
        flexShrink: 0, padding: 'calc(var(--safe-top, 0px) + 12px) 18px 12px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <button onClick={onClose} aria-label="Back" style={{
          width: 38, height: 38, borderRadius: '50%', cursor: 'pointer',
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div>
          <div style={{ fontSize: 9, letterSpacing: '0.28em', fontWeight: 800, color: 'var(--tm-gold, #C9A040)', textTransform: 'uppercase' }}>The Match · Courses</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 1 }}>Add your course</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '14px 18px calc(var(--safe-bottom, 0px) + 28px)' }}>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', lineHeight: 1.55, marginBottom: 4 }}>
          Not in our course database? Add it once — pars are all it takes — and everyone on The Match can pick it from then on.
        </div>

        <div style={LABEL}>Course name</div>
        <input style={FIELD} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Riverside Country Club" />

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 2 }}>
            <div style={LABEL}>City (optional)</div>
            <input style={FIELD} value={city} onChange={e => setCity(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={LABEL}>State</div>
            <input style={FIELD} value={state} onChange={e => setState(e.target.value)} placeholder="CA" />
          </div>
        </div>

        <div style={LABEL}>Holes</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[9, 18].map(n => (
            <button key={n} onClick={() => setHoleCount(n)} style={{
              flex: 1, padding: '9px 0', borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 13,
              background: holeCount === n ? 'rgba(201,160,64,0.2)' : 'rgba(255,255,255,0.06)',
              border: holeCount === n ? '1.5px solid rgba(201,160,64,0.55)' : '1px solid rgba(255,255,255,0.12)',
              color: holeCount === n ? '#F5D78A' : 'rgba(255,255,255,0.7)',
            }}>{n} holes</button>
          ))}
        </div>

        <div style={LABEL}>Pars — tap a hole to change · total {parTotal}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 5 }}>
          {activePars.map((p, i) => (
            <button key={i} onClick={() => cyclePar(i)} style={{
              padding: '8px 0 6px', borderRadius: 9, cursor: 'pointer', textAlign: 'center',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            }}>
              <div style={{ fontSize: 8.5, color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>{i + 1}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: p === 4 ? '#fff' : '#F5D78A' }}>{p}</div>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={LABEL}>Rating (optional)</div>
            <input style={FIELD} inputMode="decimal" value={rating} onChange={e => setRating(e.target.value)} placeholder="71.8" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={LABEL}>Slope</div>
            <input style={FIELD} inputMode="numeric" value={slope} onChange={e => setSlope(e.target.value)} placeholder="130" />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 6, lineHeight: 1.5 }}>
          Rating and slope are on the scorecard — with them, handicaps compute exactly; without them we fall back honestly.
        </div>

        {error && <div style={{ marginTop: 12, fontSize: 12.5, color: '#E08A8A' }}>{error}</div>}

        <button onClick={save} disabled={saving} style={{
          width: '100%', marginTop: 18, padding: '14px 0', borderRadius: 13, cursor: saving ? 'default' : 'pointer',
          background: 'linear-gradient(135deg, #E8C05A, #C9A040)', border: '1px solid rgba(245,215,138,0.6)',
          color: '#0D1F12', fontSize: 14, fontWeight: 900, letterSpacing: '0.04em', opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Saving…' : 'ADD COURSE'}</button>
      </div>
    </div>,
    document.body
  )
}
