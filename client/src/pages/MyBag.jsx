// My Bag — user's actual club inventory.
//
// Each of the 14 standard bag slots renders as a card. Empty cards show
// a "+ Add Club" CTA; filled cards show the brand + model the user
// picked from the curated catalog (clubCatalog.js). Tapping any card
// opens the ClubPicker modal: brand dropdown → model dropdown → Save.
// (2026-05-01 — Matt: replaces the "Coming soon" placeholder.)
//
// Data flow:
//   - GET    /api/clubs/bag                → user's full bag
//   - PUT    /api/clubs/bag/:slot          → upsert a slot
//   - DELETE /api/clubs/bag/:slot          → clear a slot

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, put, del } from '../lib/api.js'
import { IconBag } from '../components/primitives/Icons.jsx'
import { SLOTS, SLOT_LABELS, brandsFor, modelsFor, categoryForSlot } from '../lib/clubCatalog.js'

export default function MyBag() {
  const [clubs, setClubs]       = useState([])  // [{ slot, brand, model }]
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(null) // slot key when picker is open

  useEffect(() => {
    let alive = true
    api('/api/clubs/bag').then(d => {
      if (!alive) return
      setClubs(d?.clubs ?? [])
    }).catch(() => {}).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  const bySlot = Object.fromEntries(clubs.map(c => [c.slot, c]))
  const filledCount = clubs.length

  async function saveClub(slot, brand, model) {
    await put(`/api/clubs/bag/${slot}`, { brand, model })
    setClubs(prev => {
      const others = prev.filter(c => c.slot !== slot)
      return [...others, { slot, brand, model }]
    })
  }

  async function removeClub(slot) {
    await del(`/api/clubs/bag/${slot}`)
    setClubs(prev => prev.filter(c => c.slot !== slot))
  }

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      paddingBottom: 100,
    }}>
      {/* Header */}
      <div style={{ padding: '56px 20px 12px' }}>
        <div style={{
          fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em',
          background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9A040 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>My Bag</div>
        <div style={{
          fontSize: 13, color: 'rgba(13,31,18,0.55)', marginTop: 2,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>Track every club you carry</span>
          <span style={{
            background: 'rgba(27,94,59,0.10)', color: '#1B5E3B',
            padding: '2px 8px', borderRadius: 999,
            fontSize: 11, fontWeight: 700,
          }}>{filledCount} / {SLOTS.length}</span>
        </div>
      </div>

      {/* Slot list */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && (
          <div style={{
            background: 'rgba(255,255,255,0.55)',
            border: '1px dashed rgba(27,94,59,0.18)',
            borderRadius: 14, padding: '24px 16px',
            textAlign: 'center', color: 'rgba(27,94,59,0.50)',
            fontSize: 13,
          }}>Loading your bag…</div>
        )}

        {!loading && SLOTS.map(s => {
          const club = bySlot[s.key]
          return (
            <SlotCard
              key={s.key}
              slot={s}
              club={club}
              onEdit={() => setEditing(s.key)}
              onRemove={() => removeClub(s.key)}
            />
          )
        })}
      </div>

      {editing && (
        <ClubPicker
          slot={editing}
          existing={bySlot[editing]}
          onClose={() => setEditing(null)}
          onSave={async (brand, model) => {
            await saveClub(editing, brand, model)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Slot card ────────────────────────────────────────────────────────────────
function SlotCard({ slot, club, onEdit, onRemove }) {
  if (!club) {
    return (
      <button onClick={onEdit} style={{
        width: '100%',
        background: 'rgba(255,255,255,0.55)',
        border: '1px dashed rgba(27,94,59,0.22)',
        borderRadius: 14, padding: '14px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'rgba(27,94,59,0.06)', border: '1px dashed rgba(27,94,59,0.20)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: 'rgba(27,94,59,0.45)', fontWeight: 700,
          }}>+</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0D1F12', lineHeight: 1.2 }}>
              {slot.label}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(27,94,59,0.55)', marginTop: 2 }}>
              Add a club
            </div>
          </div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#1B5E3B',
          background: 'rgba(27,94,59,0.08)', padding: '4px 10px', borderRadius: 8,
        }}>+ Add</span>
      </button>
    )
  }

  return (
    <div style={{
      width: '100%',
      background: 'rgba(255,255,255,0.88)',
      border: '1px solid rgba(201,160,64,0.40)',
      boxShadow: '0 2px 14px rgba(201,160,64,0.10)',
      borderRadius: 14, padding: '14px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(232,192,90,0.22), rgba(201,160,64,0.14))',
          border: '1px solid rgba(201,160,64,0.40)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <IconBag size={18} color="#C9A040" strokeWidth={1.8} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 10, color: 'rgba(27,94,59,0.55)', fontWeight: 700,
            letterSpacing: '0.10em', textTransform: 'uppercase',
          }}>{slot.label}</div>
          <div style={{
            fontSize: 14, fontWeight: 800, color: '#0D1F12', lineHeight: 1.25,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {club.brand} <span style={{ color: 'rgba(13,31,18,0.62)', fontWeight: 600 }}>{club.model}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button onClick={onEdit} style={{
          background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.14)',
          borderRadius: 8, color: '#1B5E3B', fontSize: 12,
          padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit',
        }}>Edit</button>
        <button onClick={onRemove} style={{
          background: 'transparent', border: '1px solid rgba(13,31,18,0.10)',
          borderRadius: 8, color: 'rgba(13,31,18,0.45)', fontSize: 12,
          padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit',
        }}>×</button>
      </div>
    </div>
  )
}

// ─── Club picker modal ────────────────────────────────────────────────────────
function ClubPicker({ slot, existing, onClose, onSave }) {
  const slotMeta = SLOTS.find(s => s.key === slot)
  const category = categoryForSlot(slot)
  const brands   = brandsFor(category)

  const [brand, setBrand] = useState(existing?.brand && brands.includes(existing.brand) ? existing.brand : '')
  const [model, setModel] = useState(existing?.model || '')
  const [saving, setSaving] = useState(false)

  const models = brand ? modelsFor(category, brand) : []

  function pickBrand(b) {
    setBrand(b)
    // If switching brand, reset model unless the same model exists in
    // the new brand (rare but possible — e.g., "Apex" across years).
    if (!modelsFor(category, b).includes(model)) setModel('')
  }

  async function save() {
    if (!brand || !model || saving) return
    setSaving(true)
    try {
      await onSave(brand.trim(), model.trim())
    } catch {
      setSaving(false)
    }
  }

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.70)', backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480,
        maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, #FFFFFF, #F8F5EF)',
        borderRadius: '22px 22px 0 0',
        border: '1px solid rgba(27,94,59,0.12)',
        overflow: 'hidden',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(27,94,59,0.14)', margin: '12px auto 8px', flexShrink: 0 }} />

        {/* Header */}
        <div style={{
          padding: '4px 18px 14px',
          borderBottom: '1px solid rgba(27,94,59,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'rgba(27,94,59,0.55)', fontWeight: 700, letterSpacing: '0.10em' }}>
              {existing ? 'CHANGE' : 'ADD CLUB'}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#0D1F12', marginTop: 2 }}>
              {slotMeta?.label || slot}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.14)',
            borderRadius: 10, color: 'rgba(27,94,59,0.65)', fontSize: 16,
            cursor: 'pointer', padding: '4px 10px', height: 32, lineHeight: 1,
            fontFamily: 'inherit',
          }}>✕</button>
        </div>

        {/* Brand picker */}
        <div style={{ padding: '14px 18px 6px', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: 'rgba(27,94,59,0.55)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>
            BRAND
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {brands.map(b => {
              const active = b === brand
              return (
                <button key={b} onClick={() => pickBrand(b)} style={{
                  background: active ? 'linear-gradient(135deg, #F5D78A, #C9A040)' : 'rgba(27,94,59,0.06)',
                  border: active ? '1px solid rgba(201,160,64,0.65)' : '1px solid rgba(27,94,59,0.14)',
                  borderRadius: 999,
                  color: active ? '#070C09' : '#1B5E3B',
                  fontSize: 12, fontWeight: 700,
                  padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit',
                }}>{b}</button>
              )
            })}
          </div>
        </div>

        {/* Model list */}
        <div style={{ padding: '14px 18px 6px', flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ fontSize: 11, color: 'rgba(27,94,59,0.55)', fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>
            MODEL
          </div>
          {!brand && (
            <div style={{ color: 'rgba(13,31,18,0.45)', fontSize: 13, padding: '12px 0' }}>
              Pick a brand first.
            </div>
          )}
          {brand && models.length === 0 && (
            <div style={{ color: 'rgba(13,31,18,0.45)', fontSize: 13, padding: '12px 0' }}>
              No models cataloged for {brand} yet.
            </div>
          )}
          {brand && models.map(m => {
            const active = m === model
            return (
              <button key={m} onClick={() => setModel(m)} style={{
                width: '100%',
                background: active ? 'rgba(201,160,64,0.10)' : 'transparent',
                border: active ? '1px solid rgba(201,160,64,0.50)' : '1px solid rgba(27,94,59,0.10)',
                borderRadius: 10, padding: '10px 14px',
                marginBottom: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0D1F12' }}>{m}</span>
                {active && (
                  <span style={{ color: '#C9A040', fontSize: 16 }}>✓</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Save */}
        <div style={{
          padding: '12px 18px calc(12px + env(safe-area-inset-bottom)) 18px',
          borderTop: '1px solid rgba(27,94,59,0.08)',
          background: 'rgba(255,255,255,0.65)',
          flexShrink: 0,
        }}>
          <button onClick={save} disabled={!brand || !model || saving} style={{
            width: '100%', padding: '14px',
            background: (brand && model) ? 'linear-gradient(135deg, #F5D78A, #C9A040)' : 'rgba(27,94,59,0.07)',
            color: (brand && model) ? '#070C09' : 'rgba(13,31,18,0.30)',
            border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
            cursor: (brand && model) ? 'pointer' : 'default',
            transition: 'all 0.15s', fontFamily: 'inherit',
          }}>{saving ? 'Saving…' : (existing ? 'Save Change' : 'Add to Bag')}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
