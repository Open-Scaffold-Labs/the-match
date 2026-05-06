import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../../lib/api.js'
import { warn } from '../../lib/logger.js'

// ─── Add Guest Modal ──────────────────────────────────────────────────────────
// Add Player Modal — search-as-you-type for app users, fallback to manual guest.
//   - Type 2+ chars → calls /api/friends/search?q=… (debounced 250ms)
//   - Click a matching user → bulk-joins them as a real participant
//   - Click "Add as guest" → manual scorecard slot via the original /guests path
// (2026-04-30 Path A: replaces the old guest-only sheet)
export default function GuestModal({ code, onAdd, onAppUserAdded, onClose }) {
  const [name, setName]         = useState('')
  const [results, setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving]     = useState(false)

  // Debounced user search — fires when input length ≥ 2
  useEffect(() => {
    const q = name.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await api(`/api/friends/search?q=${encodeURIComponent(q)}`)
        setResults(Array.isArray(res) ? res : [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [name])

  async function addAppUser(u) {
    if (saving) return
    setSaving(true)
    try {
      await post(`/api/outings/${code}/bulk-join`, { user_ids: [u.id] })
      onAppUserAdded?.()
    } catch (e) { warn('[bulk-join]', e?.message) }
    finally { setSaving(false) }
  }

  async function addAsGuest() {
    if (!name.trim() || saving) return
    setSaving(true)
    try { await onAdd(name.trim()) }
    finally { setSaving(false) }
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--tm-text)', marginBottom: 6 }}>Add Player</div>
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginBottom: 16 }}>
          Type a name — if they're on The Match, they'll show up below. Otherwise add them as a guest.
        </div>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && results.length === 0 && addAsGuest()}
          placeholder="Player name or email"
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 'var(--tm-radius)',
            background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
            color: 'var(--tm-text)', fontSize: 16, outline: 'none', boxSizing: 'border-box',
            marginBottom: 8,
          }}
        />

        {/* Search results — appear as user types */}
        {(searching || results.length > 0) && (
          <div style={{
            maxHeight: 220, overflowY: 'auto',
            border: '1px solid var(--tm-border)', borderRadius: 'var(--tm-radius)',
            background: 'var(--tm-surface-2)',
            marginBottom: 12,
          }}>
            {searching && results.length === 0 && (
              <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--tm-text-3)' }}>Searching…</div>
            )}
            {results.map(u => (
              <button key={u.id} onClick={() => addAppUser(u)} disabled={saving}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '10px 14px', border: 'none', background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  borderBottom: '1px solid var(--tm-border)',
                }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--tm-text)', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--tm-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email}{u.handicap != null ? ` · HCP ${u.handicap}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--tm-green-text)', fontWeight: 800, flexShrink: 0, marginLeft: 8 }}>
                  + Add
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Fallback — add as manual guest */}
        <button
          onClick={addAsGuest}
          disabled={!name.trim() || saving}
          style={{
            width: '100%', padding: 14, borderRadius: 'var(--tm-radius-lg)',
            background: name.trim() ? 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))' : 'var(--tm-surface-3)',
            color: name.trim() ? 'var(--tm-text-inv)' : 'var(--tm-text-3)',
            fontWeight: 800, fontSize: 15, border: 'none', cursor: name.trim() ? 'pointer' : 'default',
          }}
        >{saving ? 'Adding…' : results.length > 0 ? `Add "${name}" as guest instead` : 'Add as Guest Player'}</button>

        {/* Help text */}
        <div style={{ fontSize: 11, color: 'var(--tm-text-3)', marginTop: 10, textAlign: 'center' }}>
          Guests don't have accounts — the host enters their scores manually.
        </div>
      </div>
    </div>,
    document.body
  )
}
