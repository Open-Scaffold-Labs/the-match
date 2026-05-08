import { useState, useEffect } from 'react'
import { api, del, clearToken } from '../lib/api.js'

/**
 * SettingsModal — fullscreen overlay opened from the kebab (⋯) icon in
 * Home's top bar.
 *
 * 2026-05-07 PM3 redesign per Matt:
 *   - Mobile sizing: container is box-sized so 100% width fits a 390px
 *     iPhone viewport without horizontal scroll. Inner card max-width
 *     stays 480 for tablets/desktop.
 *   - Location on/off toggle (reflects navigator.permissions state).
 *     Tapping when "prompt" triggers the OS permission prompt; tapping
 *     when "granted" or "denied" surfaces a one-line note explaining
 *     the permission can only be changed in the device's OS settings
 *     (browsers don't let apps revoke).
 *   - "Upgrade to Elite" button — visual only for now, no hookup until
 *     the billing wiring lands. POST-LAUNCH-TODO #18 tracks the actual
 *     payment integration.
 *   - Delete-account moved out of the main Settings view into an
 *     "Account Status" sub-view (state flag, back-arrow). Adds an extra
 *     tap before the typed-DELETE modal so accidental presses are
 *     less likely.
 *
 * Props:
 *   user      — the current user object (for display + tier badge)
 *   onClose   — callback to dismiss the modal
 */
export default function SettingsModal({ user, onClose }) {
  // 'main' shows the standard settings rows. 'account' is the
  // Account Status sub-view with the delete-account flow.
  const [view, setView] = useState('main')

  // Delete-account modal state (only relevant in the 'account' sub-view).
  const [confirmText, setConfirmText] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  // Location permission state. Possible values from the Permissions API:
  //   'granted' | 'denied' | 'prompt' | 'unsupported' (legacy browsers).
  // We mirror it into the toggle and surface a contextual hint when the
  // user can't change it from the app.
  const [locPerm, setLocPerm] = useState('prompt')
  const [locHint, setLocHint] = useState('')
  useEffect(() => {
    let cancelled = false
    if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) {
      setLocPerm('unsupported')
      return
    }
    navigator.permissions.query({ name: 'geolocation' })
      .then(status => {
        if (cancelled) return
        setLocPerm(status.state)
        // Watch for changes from outside the app (user grants/revokes
        // via OS settings while the app is open).
        status.onchange = () => { if (!cancelled) setLocPerm(status.state) }
      })
      .catch(() => { if (!cancelled) setLocPerm('unsupported') })
    return () => { cancelled = true }
  }, [])

  function toggleLocation() {
    setLocHint('')
    if (locPerm === 'granted') {
      setLocHint("Location is on. To turn it off, change it in your device's location settings.")
      return
    }
    if (locPerm === 'denied') {
      setLocHint("Location was denied. To enable it, change the permission in your device's location settings, then refresh.")
      return
    }
    if (locPerm === 'unsupported') {
      setLocHint('Your browser does not expose location permission state.')
      return
    }
    // 'prompt' — fire the actual prompt by requesting position.
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocHint('Geolocation is not available in this browser.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      () => setLocPerm('granted'),
      (err) => {
        // PERMISSION_DENIED, POSITION_UNAVAILABLE, TIMEOUT
        if (err.code === err.PERMISSION_DENIED) setLocPerm('denied')
        else setLocHint(err.message || 'Could not enable location.')
      },
      { timeout: 10000 }
    )
  }

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

  const tierLabel = user?.tier ? user.tier.toUpperCase() : 'FREE'
  const isElite = user?.tier === 'elite'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(7,12,9,0.92)',
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      // Bottom padding now uses safe-area inset so the content clears the
      // home indicator on iOS without leaving a giant dead zone on
      // shorter screens. Horizontal padding shrinks slightly so the
      // 480-max-width inner card still has breathing room on tablets
      // but data fills the 390px iPhone width comfortably.
      padding: '20px 16px calc(40px + env(safe-area-inset-bottom)) 16px',
      boxSizing: 'border-box',
    }}>
      {/* Header bar — same in both sub-views. The "Done" button always
          closes the modal entirely; the back-arrow inside Account Status
          returns to the main view. */}
      <div style={{
        width: '100%', maxWidth: 480, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {view !== 'main' && (
            <button
              onClick={() => { setView('main'); setError(''); setConfirmText('') }}
              aria-label="Back"
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 10, color: 'rgba(255,255,255,0.85)', fontSize: 16,
                padding: '4px 10px', cursor: 'pointer', lineHeight: 1, flexShrink: 0,
              }}
            >←</button>
          )}
          <div style={{
            fontFamily: 'Georgia, serif', fontSize: 22, color: '#C9A040', fontWeight: 700,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {view === 'main' ? 'Settings' : 'Account Status'}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close settings"
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 10, color: 'rgba(255,255,255,0.85)', fontSize: 14,
            padding: '6px 12px', cursor: 'pointer', flexShrink: 0,
          }}
        >Done</button>
      </div>

      {view === 'main' && (
        <MainView
          user={user}
          tierLabel={tierLabel}
          isElite={isElite}
          locPerm={locPerm}
          locHint={locHint}
          onToggleLocation={toggleLocation}
          onSignOut={signOut}
          onOpenAccount={() => setView('account')}
        />
      )}

      {view === 'account' && (
        <AccountStatusView
          user={user}
          tierLabel={tierLabel}
          onOpenDeleteModal={() => { setDeleteOpen(true); setConfirmText('') }}
        />
      )}

      {/* Build/version footer — stays at the bottom of either sub-view. */}
      <div style={{
        width: '100%', maxWidth: 480, marginTop: 24,
        fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center',
      }}>
        The Match · post-launch build · {new Date().getFullYear()}
      </div>

      {/* Delete-account confirmation modal. Only reachable from the
          Account Status sub-view → Delete button, so it sits behind the
          extra tap-to-enter-account-status step. */}
      {deleteOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1100,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px',
          boxSizing: 'border-box',
        }}>
          <div style={{
            width: '100%', maxWidth: 420,
            background: '#101814', border: '1px solid rgba(220,53,53,0.50)',
            borderRadius: 14, padding: '20px',
            boxSizing: 'border-box',
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

// ─── Main Settings view ─────────────────────────────────────────────────────
function MainView({
  user, tierLabel, isElite,
  locPerm, locHint,
  onToggleLocation, onSignOut, onOpenAccount,
}) {
  return (
    <>
      {/* Account summary */}
      <Card>
        <SectionLabel>SIGNED IN AS</SectionLabel>
        <div style={{ fontSize: 17, color: 'white', fontWeight: 600, marginBottom: 2 }}>
          {user?.name || 'Unknown'}
        </div>
        <div style={{
          fontSize: 13, color: 'rgba(255,255,255,0.65)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {user?.email || ''} · @{user?.handle || ''}
        </div>
      </Card>

      {/* Tier — pill + Upgrade CTA when not elite. The upgrade button is
          a visual stub for now (POST-LAUNCH-TODO #18 tracks the actual
          billing hookup). When elite, we just show the badge. */}
      <Card>
        <Row>
          <span>Tier</span>
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: '0.10em',
            padding: '4px 10px', borderRadius: 999,
            color: isElite ? '#3A2A05' : 'rgba(255,255,255,0.85)',
            background: isElite
              ? 'linear-gradient(135deg, #F5D78A, #E8C05A, #C9A040)'
              : 'rgba(255,255,255,0.08)',
            border: isElite ? '1px solid rgba(155,120,24,0.55)' : '1px solid rgba(255,255,255,0.16)',
          }}>{tierLabel}</span>
        </Row>
        {!isElite && (
          <button
            onClick={() => { /* TODO POST-LAUNCH-TODO #18: wire billing */ alert('Coming soon — Elite billing is on the post-launch roadmap.') }}
            style={{
              width: '100%', marginTop: 12,
              padding: '12px 14px',
              background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 45%, #C9971E 100%)',
              color: '#3A2A05', border: '1px solid rgba(155,120,24,0.55)',
              borderRadius: 10, fontSize: 14, fontWeight: 800,
              letterSpacing: '0.04em', cursor: 'pointer',
              fontFamily: 'Georgia, serif',
              boxShadow: '0 4px 14px rgba(201,160,64,0.25), inset 0 1px 0 rgba(255,253,248,0.50)',
            }}
          >
            ★ Upgrade to Elite
          </button>
        )}
      </Card>

      {/* Referral / invite-link card. Sits between Tier and Location
          so users see "earn free Elite" right after the tier badge. */}
      <ReferralCard />

      {/* Location toggle */}
      <Card>
        <Row>
          <div>
            <div style={{ color: 'white', fontSize: 16, marginBottom: 2 }}>Location</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.50)' }}>
              {locPerm === 'granted' && 'On — Eagle Eye uses GPS during rounds.'}
              {locPerm === 'prompt' && 'Off — turn on for live yardages.'}
              {locPerm === 'denied' && 'Off — denied at the OS level.'}
              {locPerm === 'unsupported' && 'Browser does not report state.'}
            </div>
          </div>
          <Toggle on={locPerm === 'granted'} onClick={onToggleLocation} />
        </Row>
        {locHint && (
          <div style={{
            marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.65)',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 8, padding: '8px 10px', lineHeight: 1.45,
          }}>
            {locHint}
          </div>
        )}
      </Card>

      {/* Privacy / Account Status / Sign Out group */}
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12, marginBottom: 16, overflow: 'hidden',
        boxSizing: 'border-box',
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
          onClick={onOpenAccount}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', background: 'transparent', border: 'none',
            color: 'white', fontSize: 16, cursor: 'pointer', textAlign: 'left',
            borderBottom: '1px solid rgba(255,255,255,0.10)',
            fontFamily: 'inherit',
          }}
        >
          <span>Account Status</span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>›</span>
        </button>
        <button
          onClick={onSignOut}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', background: 'transparent', border: 'none',
            color: 'white', fontSize: 16, cursor: 'pointer', textAlign: 'left',
            fontFamily: 'inherit',
          }}
        >
          <span>Sign Out</span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>→</span>
        </button>
      </div>
    </>
  )
}

// ─── Account Status sub-view ────────────────────────────────────────────────
function AccountStatusView({ user, tierLabel, onOpenDeleteModal }) {
  return (
    <>
      <Card>
        <SectionLabel>ACCOUNT</SectionLabel>
        <Row>
          <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>Tier</span>
          <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>{tierLabel}</span>
        </Row>
        <Row>
          <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>Email</span>
          <span style={{
            color: 'white', fontSize: 13,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '60%',
          }}>{user?.email || '—'}</span>
        </Row>
        <Row>
          <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>Handle</span>
          <span style={{ color: 'white', fontSize: 13 }}>@{user?.handle || '—'}</span>
        </Row>
      </Card>

      {/* Danger zone — same content as before, just gated behind the
          Account Status entry so a casual tap can't get here. */}
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'rgba(220,53,53,0.06)', border: '1px solid rgba(220,53,53,0.30)',
        borderRadius: 12, padding: '14px 16px', marginBottom: 16,
        boxSizing: 'border-box',
      }}>
        <div style={{
          fontSize: 11, letterSpacing: 1.2,
          color: 'rgba(255,180,180,0.85)', marginBottom: 6, fontWeight: 600,
        }}>
          DANGER ZONE
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)', marginBottom: 12, lineHeight: 1.45 }}>
          Permanently delete your account and all associated data. Rounds,
          matches you hosted, and posted scores remain in the historical
          record but are anonymized. <strong style={{ color: '#FFB5B5' }}>This cannot be undone.</strong>
        </div>
        <button
          onClick={onOpenDeleteModal}
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
    </>
  )
}

// ─── Shared primitives ──────────────────────────────────────────────────────

function Card({ children }) {
  return (
    <div style={{
      width: '100%', maxWidth: 480,
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 12, padding: '14px 16px', marginBottom: 12,
      boxSizing: 'border-box',
    }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, letterSpacing: 1.2,
      color: 'rgba(255,255,255,0.55)', marginBottom: 6,
    }}>
      {children}
    </div>
  )
}

function Row({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '6px 0',
    }}>
      {children}
    </div>
  )
}

// ─── Referral card ──────────────────────────────────────────────────────────
// Pulls /api/referrals/me on mount. Shows the user's link with a copy
// button (writes to clipboard with visual ✓ confirmation), a Share
// button that opens the native share sheet on mobile (navigator.share
// falls back to copy on desktop), the milestone progress, and the list
// of awarded rewards as small chips.
function ReferralCard() {
  const [data, setData]   = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    api('/api/referrals/me')
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setError(e?.message || 'Could not load referral info') })
    return () => { alive = false }
  }, [])

  async function copyLink() {
    if (!data?.url) return
    try {
      await navigator.clipboard.writeText(data.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Older browsers — manual fallback would go here. For now, the
      // input is selectable so the user can copy by hand.
    }
  }

  async function share() {
    if (!data?.url) return
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Join me on The Match',
          text: 'Sign up with my link and we both get free Elite.',
          url: data.url,
        })
      } catch {
        // User canceled the share sheet — silent.
      }
    } else {
      // Desktop / no share API — fall back to copy.
      await copyLink()
    }
  }

  if (error) {
    return (
      <Card>
        <SectionLabel>INVITE FRIENDS</SectionLabel>
        <div style={{ fontSize: 12, color: 'rgba(255,140,140,0.85)' }}>{error}</div>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <SectionLabel>INVITE FRIENDS</SectionLabel>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>Loading…</div>
      </Card>
    )
  }

  const { url, qualifyingCount, nextMilestone, awarded, milestones } = data
  // Progress bar fills from 0 to the NEXT milestone's count. If
  // nextMilestone is null (max tier already earned), bar is full and
  // we just show "max tier earned".
  const progressMax = nextMilestone ? nextMilestone.target : (milestones[milestones.length - 1]?.count || 50)
  const progressPct = Math.min(100, (qualifyingCount / progressMax) * 100)

  return (
    <Card>
      <SectionLabel>INVITE FRIENDS · EARN FREE ELITE</SectionLabel>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.70)', lineHeight: 1.45, marginBottom: 12 }}>
        Share your link. When friends sign up + play a round, you earn free Elite —{' '}
        <strong style={{ color: 'rgba(255,255,255,0.92)' }}>5 = 1 week, 10 = 1 month, 50 = 1 year.</strong>
      </div>

      {/* Link + copy + share row */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <input
          type="text"
          value={url}
          readOnly
          onFocus={(e) => e.target.select()}
          aria-label="Your referral link"
          style={{
            flex: 1, minWidth: 0,
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 8,
            color: 'white', fontSize: 13,
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        />
        <button
          onClick={copyLink}
          aria-label="Copy referral link"
          style={{
            padding: '10px 12px',
            background: copied ? 'rgba(42,122,56,0.30)' : 'rgba(232,192,90,0.18)',
            border: '1px solid ' + (copied ? 'rgba(42,122,56,0.55)' : 'rgba(232,192,90,0.45)'),
            borderRadius: 8,
            color: copied ? '#9CE3A3' : '#F5D78A',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit', flexShrink: 0,
            transition: 'background 200ms ease',
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <button
          onClick={share}
          aria-label="Share referral link"
          style={{
            padding: '10px 12px',
            background: 'rgba(232,192,90,0.18)',
            border: '1px solid rgba(232,192,90,0.45)',
            borderRadius: 8,
            color: '#F5D78A',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit', flexShrink: 0,
          }}
        >
          ↗ Share
        </button>
      </div>

      {/* Progress bar — qualifying / next milestone */}
      <div style={{ marginBottom: 10 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: 'rgba(255,255,255,0.65)',
          marginBottom: 4, fontWeight: 700, letterSpacing: '0.04em',
        }}>
          <span>{qualifyingCount} qualifying signup{qualifyingCount === 1 ? '' : 's'}</span>
          <span>
            {nextMilestone
              ? `${nextMilestone.remaining} to ${prettyDays(nextMilestone.days)} of Elite`
              : 'Max tier earned ✓'}
          </span>
        </div>
        <div style={{
          width: '100%', height: 6, borderRadius: 999,
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${progressPct}%`, height: '100%',
            background: 'linear-gradient(90deg, #C9A040, #F5D78A)',
            transition: 'width 300ms ease',
          }} />
        </div>
      </div>

      {/* Milestone tier reference + awarded chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {milestones.map(m => {
          const earned = awarded.some(a => a.milestone === m.count)
          return (
            <div key={m.count} style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
              padding: '4px 8px', borderRadius: 999,
              background: earned ? 'rgba(232,192,90,0.20)' : 'rgba(255,255,255,0.05)',
              border: '1px solid ' + (earned ? 'rgba(232,192,90,0.55)' : 'rgba(255,255,255,0.14)'),
              color: earned ? '#F5D78A' : 'rgba(255,255,255,0.55)',
            }}>
              {earned ? '★ ' : ''}{m.count} → {prettyDays(m.days)}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function prettyDays(days) {
  if (days >= 365) return `${Math.round(days / 365)} year${days >= 730 ? 's' : ''}`
  if (days >= 30) return `${Math.round(days / 30)} month${days >= 60 ? 's' : ''}`
  if (days >= 7) return `${Math.round(days / 7)} week${days >= 14 ? 's' : ''}`
  return `${days} day${days === 1 ? '' : 's'}`
}

function Toggle({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        width: 48, height: 28, borderRadius: 999,
        background: on ? '#2A7A38' : 'rgba(255,255,255,0.18)',
        border: '1px solid ' + (on ? 'rgba(232,192,90,0.55)' : 'rgba(255,255,255,0.22)'),
        position: 'relative', cursor: 'pointer', flexShrink: 0,
        transition: 'background 200ms ease',
        padding: 0,
      }}
    >
      <div style={{
        position: 'absolute',
        top: 2, left: on ? 22 : 2,
        width: 22, height: 22, borderRadius: '50%',
        background: 'white',
        transition: 'left 200ms ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.30)',
      }} />
    </button>
  )
}
