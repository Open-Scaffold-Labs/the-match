// Per-shot capture sheet — club → lie (powers Strokes Gained) → distance to
// pin. Extracted from ActiveRound (2026-07-07) so the solo round AND the
// outing self-score modal share one capture UI. Self-only, opt-in, add-only.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { tmHaptic } from '../../pages/Outing/shared.jsx'

const CLUBS = [
  { label: 'Dr', name: 'Driver' },
  { label: '3W', name: '3-Wood' },
  { label: '5W', name: '5-Wood' },
  { label: '3H', name: '3-Hybrid' },
  { label: '4H', name: '4-Hybrid' },
  { label: '4i', name: '4-Iron' },
  { label: '5i', name: '5-Iron' },
  { label: '6i', name: '6-Iron' },
  { label: '7i', name: '7-Iron' },
  { label: '8i', name: '8-Iron' },
  { label: '9i', name: '9-Iron' },
  { label: 'PW', name: 'Pitching Wedge' },
  { label: 'GW', name: 'Gap Wedge' },
  { label: 'SW', name: 'Sand Wedge' },
  { label: 'LW', name: 'Lob Wedge' },
  { label: 'Pt', name: 'Putter' },
]

const SHOT_LIES = [
  { key: 'tee',      label: 'Tee' },
  { key: 'fairway',  label: 'Fairway' },
  { key: 'rough',    label: 'Rough' },
  { key: 'sand',     label: 'Sand' },
  { key: 'recovery', label: 'Trouble' },
]

export function ShotSheet({ isFirstShot, onAdd, onClose }) {
  const [club, setClub] = useState(null)
  const [lie, setLie]   = useState(isFirstShot ? 'tee' : null)
  const [toPin, setToPin] = useState('')

  function commit(withDetails) {
    const dist = parseInt(toPin, 10)
    onAdd({
      club,
      dist: null,
      ...(withDetails && lie ? { lie } : {}),
      ...(withDetails && Number.isFinite(dist) && dist > 0 ? { toPin: dist } : {}),
    })
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--tm-text)' }}>
            {club ? `${club} — where from?` : 'Which club?'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 20 }}>✕</button>
        </div>

        {!club && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {CLUBS.map(c => (
              <button key={c.label} onClick={() => setClub(c.label)}
                style={{ padding: '12px 4px', borderRadius: 'var(--tm-radius)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontWeight: 700, fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span>{c.label}</span>
                <span style={{ fontSize: 9, color: 'var(--tm-text-3)', fontWeight: 400 }}>{c.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        )}

        {club && (
          <>
            {/* Lie chips */}
            <div style={{ fontSize: 10, color: 'var(--tm-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Lie <span style={{ opacity: 0.6 }}>· powers Strokes Gained</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {SHOT_LIES.map(l => (
                <button key={l.key} onClick={() => { tmHaptic(8); setLie(k => k === l.key ? null : l.key) }}
                  style={{
                    padding: '8px 14px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    background: lie === l.key ? 'var(--tm-gold-muted)' : 'var(--tm-surface-2)',
                    border: lie === l.key ? '1.5px solid var(--tm-gold-dim)' : '1px solid var(--tm-border)',
                    color: lie === l.key ? 'var(--tm-gold-text)' : 'var(--tm-text-3)',
                  }}>{l.label}</button>
              ))}
            </div>

            {/* Distance to pin */}
            <div style={{ fontSize: 10, color: 'var(--tm-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Distance to pin (yds)
            </div>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*" value={toPin}
              onChange={e => setToPin(e.target.value.replace(/\D/g, '').slice(0, 3))}
              placeholder="e.g. 165"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginBottom: 16,
                borderRadius: 'var(--tm-radius)', background: 'var(--tm-surface-2)',
                border: '1px solid var(--tm-border)', color: 'var(--tm-text)',
                fontSize: 16, fontWeight: 700, outline: 'none',
              }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => commit(false)}
                style={{ flex: 1, padding: 13, borderRadius: 'var(--tm-radius)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text-3)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Skip details
              </button>
              <button onClick={() => commit(true)} disabled={!lie || !toPin}
                style={{
                  flex: 2, padding: 13, borderRadius: 'var(--tm-radius)', border: 'none',
                  background: (!lie || !toPin) ? 'var(--tm-surface-2)' : 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
                  color: (!lie || !toPin) ? 'var(--tm-text-3)' : 'var(--tm-text-inv)',
                  fontWeight: 800, fontSize: 14, cursor: (!lie || !toPin) ? 'default' : 'pointer',
                }}>
                Add Shot
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
