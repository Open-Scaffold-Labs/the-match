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
import { SLOTS, SLOT_LABELS, brandsForSlot, modelsForSlot } from '../lib/clubCatalog.js'
import BagPhoto from '../components/BagPhoto.jsx'

export default function MyBag() {
  const [clubs, setClubs]       = useState([])  // [{ slot, brand, model }]
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(null) // slot key when picker is open
  const [completing, setCompleting] = useState(false) // "Bag Complete" celebratory overlay

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

      {/* Bag illustration — auto-updates as clubs are added/removed.
          Empty bag still renders the silhouette with a hint. */}
      <div style={{ padding: '4px 16px 12px' }}>
        <BagPhoto clubs={clubs} />
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

        {/* Complete My Bag — only renders once at least one club is in.
            Tapping opens a celebratory overlay with the bag summary. */}
        {!loading && filledCount > 0 && (
          <button
            onClick={() => setCompleting(true)}
            style={{
              marginTop: 8, padding: '14px',
              background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
              color: '#070C09', border: 'none', borderRadius: 14,
              fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em',
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 6px 20px rgba(201,160,64,0.30)',
            }}
          >
            Complete My Bag · {filledCount}/{SLOTS.length}
          </button>
        )}
      </div>

      {completing && (
        <BagCompleteOverlay
          clubs={clubs}
          totalSlots={SLOTS.length}
          onClose={() => setCompleting(false)}
        />
      )}

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

// ─── Bag complete overlay ────────────────────────────────────────────────────
// Celebratory confirmation when the user taps "Complete My Bag." Pop-in
// animation, gold checkmark, club count, and a Done CTA. Doesn't lock
// the bag — user can still edit afterward, this is a UX "you're set"
// signal. (2026-05-01)
function BagCompleteOverlay({ clubs, totalSlots, onClose }) {
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        padding: 20,
      }}
    >
      <style>{`
        @keyframes mb-pop-in {
          0%   { opacity: 0; transform: scale(0.7); }
          60%  { opacity: 1; transform: scale(1.06); }
          100% { opacity: 1; transform: scale(1.00); }
        }
        @keyframes mb-check-draw {
          0%   { stroke-dashoffset: 60; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes mb-glow-pulse {
          0%, 100% { box-shadow: 0 0 30px rgba(245,215,138,0.40), 0 0 60px rgba(201,160,64,0.20); }
          50%      { box-shadow: 0 0 50px rgba(245,215,138,0.65), 0 0 100px rgba(201,160,64,0.40); }
        }
        .mb-card { animation: mb-pop-in 360ms cubic-bezier(0.34,1.56,0.64,1) both; }
        .mb-glow { animation: mb-glow-pulse 2.4s ease-in-out infinite; }
        .mb-check { stroke-dasharray: 60; stroke-dashoffset: 60; animation: mb-check-draw 520ms ease 220ms forwards; }
      `}</style>

      <div
        className="mb-card"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 360,
          borderRadius: 22,
          background: 'linear-gradient(160deg, #0F2814 0%, #0A1D0F 50%, #060E08 100%)',
          border: '1px solid rgba(245,215,138,0.30)',
          padding: '28px 24px 24px',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Top gold rule */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent, rgba(245,215,138,0.7), transparent)',
        }} />

        {/* Animated check medallion */}
        <div className="mb-glow" style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'linear-gradient(135deg, #F5E070, #C9A040)',
          margin: '0 auto 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <polyline
              className="mb-check"
              points="5 12 10 17 19 8"
              stroke="#070C09" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        </div>

        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.20em',
          color: 'rgba(245,215,138,0.65)', marginBottom: 6,
        }}>BAG COMPLETE</div>

        <div style={{
          fontSize: 22, fontWeight: 900, color: '#fff',
          letterSpacing: '-0.01em', marginBottom: 8,
        }}>You're set, Matt</div>

        <div style={{
          fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5,
          marginBottom: 18,
        }}>
          {clubs.length} of {totalSlots} slots filled. Your bag is saved
          and ready — distances will populate as you log shots.
        </div>

        {/* Mini summary chips */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center',
          marginBottom: 20,
        }}>
          {clubs.slice(0, 6).map(c => (
            <span key={c.slot} style={{
              fontSize: 10, fontWeight: 700,
              background: 'rgba(245,215,138,0.10)',
              border: '1px solid rgba(245,215,138,0.25)',
              color: '#F5D78A',
              borderRadius: 999, padding: '4px 9px',
            }}>{c.brand}</span>
          ))}
          {clubs.length > 6 && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: 'rgba(255,255,255,0.40)', padding: '4px 9px',
            }}>+{clubs.length - 6} more</span>
          )}
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '13px',
            background: 'linear-gradient(135deg, #F5D78A, #C9A040)',
            color: '#070C09', border: 'none', borderRadius: 12,
            fontSize: 15, fontWeight: 800, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >Done</button>
      </div>
    </div>,
    document.body
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
  const brands   = brandsForSlot(slot)

  const [brand, setBrand] = useState(existing?.brand && brands.includes(existing.brand) ? existing.brand : '')
  const [model, setModel] = useState(existing?.model || '')
  const [saving, setSaving] = useState(false)

  const models = brand ? modelsForSlot(slot, brand) : []

  function pickBrand(b) {
    setBrand(b)
    // If switching brand, reset model unless the same model exists in
    // the new brand (rare but possible — e.g., "Apex" across years).
    if (!modelsForSlot(slot, b).includes(model)) setModel('')
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
