// AdminUsersModal — admin-only roster of every account in the system.
// Triggered by the gear icon on Home (renders only when user.role ===
// 'admin'). Shows newest accounts first so Matt can see his test
// friends as they sign up. (2026-05-01)

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api.js'

export default function AdminUsersModal({ onClose }) {
  const [users, setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  async function load() {
    setLoading(true); setError('')
    try {
      const r = await api('/api/admin/users')
      setUsers(r?.users ?? [])
    } catch (e) {
      setError(e?.message || 'Could not load users')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(180deg, #0E1F13 0%, #070C09 100%)',
        border: '1px solid rgba(245,215,138,0.25)',
        borderRadius: '20px 20px 0 0', overflow: 'hidden',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(245,215,138,0.30)', margin: '12px auto 8px', flexShrink: 0 }} />
        <div style={{
          padding: '4px 18px 14px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'rgba(245,215,138,0.60)', fontWeight: 700, letterSpacing: '0.20em' }}>ADMIN</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginTop: 2 }}>
              All Users <span style={{ color: 'rgba(255,255,255,0.45)', fontWeight: 600, fontSize: 13 }}>· {users.length}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={load} title="Refresh" style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10, color: 'rgba(255,255,255,0.70)', fontSize: 14,
              cursor: 'pointer', padding: '4px 10px', height: 32, lineHeight: 1,
              fontFamily: 'inherit',
            }}>↻</button>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10, color: 'rgba(255,255,255,0.70)', fontSize: 16,
              cursor: 'pointer', padding: '4px 10px', height: 32, lineHeight: 1,
              fontFamily: 'inherit',
            }}>✕</button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 12px 16px' }}>
          {loading && (
            <div style={{ color: 'rgba(255,255,255,0.55)', textAlign: 'center', padding: 24, fontSize: 13 }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ color: '#FCA5A5', textAlign: 'center', padding: 24, fontSize: 13 }}>{error}</div>
          )}
          {!loading && users.map(u => {
            const onboarded = !!u.onboarding_completed_at
            const created = u.created_at ? new Date(u.created_at) : null
            const createdStr = created ? created.toLocaleDateString(undefined, {
              month: 'short', day: 'numeric', year: created.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
            }) : ''
            const minutesAgo = created ? Math.floor((Date.now() - created.getTime()) / 60000) : null
            const recencyLabel = minutesAgo == null ? null
              : minutesAgo < 60 ? `${Math.max(1, minutesAgo)}m ago`
              : minutesAgo < 24 * 60 ? `${Math.floor(minutesAgo / 60)}h ago`
              : null
            return (
              <div key={u.id} style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12, padding: '12px 14px', marginBottom: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.name}
                    {u.role === 'admin' && (
                      <span style={{
                        marginLeft: 8, background: 'rgba(245,215,138,0.18)', color: '#F5D78A',
                        padding: '2px 7px', borderRadius: 6,
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.10em',
                      }}>ADMIN</span>
                    )}
                  </div>
                  <span style={{
                    fontSize: 10, color: 'rgba(245,215,138,0.55)', fontWeight: 700,
                    flexShrink: 0,
                  }}>{recencyLabel || createdStr}</span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.email}
                </div>
                <div style={{
                  marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap',
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                }}>
                  <Stat label="ONBOARDING" value={onboarded ? 'DONE' : 'PENDING'}
                    color={onboarded ? '#4ADE80' : '#FCA5A5'} />
                  <Stat label="CLUBS" value={u.club_count ?? 0} />
                  <Stat label="ROUNDS" value={u.round_count ?? 0} />
                  <Stat label="MATCHES" value={u.match_count ?? 0} />
                  {u.handicap != null && <Stat label="HCP" value={Number(u.handicap).toFixed(1)} />}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body
  )
}

function Stat({ label, value, color = '#F5D78A' }) {
  return (
    <span style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 6, padding: '3px 7px',
      color: 'rgba(255,255,255,0.55)',
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      <span style={{ color: 'rgba(255,255,255,0.40)' }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </span>
  )
}
