import { useState } from 'react'
import { del, clearToken } from '../lib/api.js'

/**
 * SettingsModal — fullscreen overlay opened from the gear icon in Home's top bar.
 *
 * Provides the previously-missing session management surface (audit-2026-05-07
 * bug #1: no logout/sign-out anywhere in the app):
 *   - Sign Out — clears the JWT and reloads to the auth screen
 *   - Privacy Policy — opens the static privacy page in a new tab
 *   - Delete Account — typed-confirm modal → DELETE /api/auth/me → reload
 *
 * Self-contained: instead of prop-drilling onSignOut callbacks up to App.jsx,
 * we just clearToken() and window.location.reload(). The reload re-runs the
 * /api/auth/me bootstrap which fails (no token) and renders <Login>.
 *
 * Props:
 *   user      — the current user object (for display)
 *   onClose   — callback to dismiss the modal
 */
export default function SettingsModal({ user, onClose }) {
  const [confirmText, setConfirmText] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const signOut = () => {
    clearToken()
    window.location.reload()
  }

  const deleteAccount = async () => {
    setError('')
    setDeleting(true)
    try {
      await del('/api/auth/me', { confirm: 'DELETE' })
      clearToken()
      window.location.reload()
    } catch (e) {
      setError(e.message || 'Account deletion failed.')
      setDeleting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(7,12,9,0.92)',
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '24px 20px 80px',
    }}>
      {/* Header bar */}
      <div style={{
        width: '100%', maxWidth: 480, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24,
      }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, color: '#C9A040', fontWeight: 700 }}>
          Settings
        </div>
        <button
          onClick={onClose}
          aria-label="Close settings"
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 10, color: 'rgba(255,255,255,0.85)', fontSize: 14,
            padding: '6px 12px', cursor: 'pointer',
          }}
        >Done</button>
      </div>

      {/* Account summary */}
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12, padding: '14px 16px', marginBottom: 16,
      }}>
        <div style={{ fontSize: 11, letterSpacing: 1.2, color: 'rgba(255,255,255,0.55)', marginBottom: 6 }}>
          SIGNED IN AS
        </div>
        <div style={{ fontSize: 17, color: 'white', fontWeight: 600, marginBottom: 2 }}>
          {user?.name || 'Unknown'}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
          {user?.email || ''} · @{user?.handle || ''}
        </div>
      </div>

      {/* Privacy + Sign Out group */}
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12, marginBottom: 16, overflow: 'hidden',
      }}>
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', textDecoration: 'none', color: 'white',
            borderBottom: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <span>Privacy Policy</span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>↗</span>
        </a>
        <button
          onClick={signOut}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', background: 'transparent', border: 'none',
            color: 'white', fontSize: 16, cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span>Sign Out</span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>→</span>
        </button>
      </div>

      {/* Danger zone */}
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(220,53,53,0.06)', border: '1px solid rgba(220,53,53,0.30)',
        borderRadius: 12, padding: '14px 16px',
      }}>
        <div style={{ fontSize: 11, letterSpacing: 1.2, color: 'rgba(255,180,180,0.85)', marginBottom: 6, fontWeight: 600 }}>
          DANGER ZONE
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)', marginBottom: 12, lineHeight: 1.4 }}>
          Permanently delete your account and all associated data. Rounds, matches you hosted, and
          posted scores remain in the historical record but are anonymized. This cannot be undone.
        </div>
        <button
          onClick={() => { setDeleteOpen(true); setConfirmText('') }}
          style={{
            width: '100%', padding: '12px 14px',
            background: 'rgba(220,53,53,0.12)', color: '#FF8585',
            border: '1px solid rgba(220,53,53,0.50)',
            borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Delete my account
        </button>
      </div>

      {/* Build/version footer */}
      <div style={{
        marginTop: 24, fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center',
      }}>
        The Match · post-launch build · {new Date().getFullYear()}
      </div>

      {/* Delete confirmation modal */}
      {deleteOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1100,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            width: '100%', maxWidth: 420,
            background: '#101814', border: '1px solid rgba(220,53,53,0.50)',
            borderRadius: 14, padding: '20px',
          }}>
            <div style={{ fontSize: 18, color: '#FF8585', fontWeight: 700, marginBottom: 10 }}>
              Delete your account?
            </div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.80)', marginBottom: 16, lineHeight: 1.45 }}>
              This will permanently remove your profile, friends, achievements, and scores.
              Hosted matches will be preserved as historical records but the host link will be
              anonymized. <strong style={{ color: '#FFB5B5' }}>This cannot be undone.</strong>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginBottom: 6 }}>
              Type <strong style={{ color: 'white' }}>DELETE</strong> to confirm:
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoFocus
              style={{
                width: '100%', padding: '10px 12px',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.20)',
                borderRadius: 8, color: 'white', fontSize: 16, marginBottom: 14,
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            {error && (
              <div style={{ color: '#FF8585', fontSize: 13, marginBottom: 10 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setDeleteOpen(false); setError(''); setConfirmText('') }}
                disabled={deleting}
                style={{
                  flex: 1, padding: '11px 14px',
                  background: 'rgba(255,255,255,0.06)', color: 'white',
                  border: '1px solid rgba(255,255,255,0.20)', borderRadius: 8,
                  fontSize: 14, fontWeight: 600, cursor: deleting ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={deleteAccount}
                disabled={confirmText !== 'DELETE' || deleting}
                style={{
                  flex: 1, padding: '11px 14px',
                  background: (confirmText === 'DELETE' && !deleting) ? '#DC3535' : 'rgba(220,53,53,0.30)',
                  color: 'white', border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 700,
                  cursor: (confirmText === 'DELETE' && !deleting) ? 'pointer' : 'not-allowed',
                  opacity: (confirmText === 'DELETE' && !deleting) ? 1 : 0.55,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
