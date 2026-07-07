// OnboardingChecklist — shown on Home for new users until they've
// finished the optional follow-on tasks. Drives entirely off
// existing data the page already loads, so no extra fetches:
//   - profile photo set?
//   - 5+ clubs in the bag?
//   - any availability marked this month?
//   - 3+ friends accepted?
//   - any matches started?
// Auto-hides when every item is checked.
//
// (2026-05-01 — Matt: friends-test prep, third leg of the
// onboarding triad alongside the mandatory wizard + coach marks.)

import { useState, useEffect } from 'react'
import { post } from '../lib/api.js'

export default function OnboardingChecklist({
  user,
  friends = [],
  clubs = [],
  availabilityCount = 0,
  matchCount = 0,
  onNavigate,
}) {
  const items = [
    {
      key: 'photo',
      label: 'Add a profile photo',
      hint: 'Open My Profile → Edit',
      done: !!user?.avatar,
      cta: 'Edit profile',
      action: () => onNavigate?.('profile'),
    },
    {
      key: 'bag',
      label: `Fill the rest of your bag (${clubs.length}/14)`,
      hint: 'Picker, distances, brand/model — used by Eagle Eye',
      done: clubs.length >= 5,
      cta: 'Open My Bag',
      action: () => onNavigate?.('bag'),
    },
    {
      key: 'avail',
      label: 'Mark a few free dates',
      hint: 'Friends use this to request matches',
      done: availabilityCount > 0,
      cta: 'Open calendar',
      action: () => onNavigate?.('profile'),
    },
    {
      key: 'friends',
      label: `Add 3 friends (${friends.length}/3)`,
      hint: 'Tap "Add Friend" in the Friends panel below',
      done: friends.length >= 3,
      cta: null,
      action: null,
    },
    {
      key: 'match',
      label: 'Start your first match',
      hint: 'Match tab → Create',
      done: matchCount > 0,
      cta: 'Create match',
      action: () => onNavigate?.('match'),
    },
  ]
  const remaining = items.filter(i => !i.done).length
  const total     = items.length

  // Local dismiss — persists in localStorage so the user can hide it
  // without finishing every item. Won't reappear on this device until
  // localStorage is cleared. Doesn't affect the mandatory wizard gate.
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('tm_onboarding_dismissed') === '1' } catch { return false }
  })
  function dismiss() {
    try { localStorage.setItem('tm_onboarding_dismissed', '1') } catch {}
    setDismissed(true)
  }

  // Auto-finalize server-side once every item is checked off, so the
  // user's "onboarding fully done" signal is accurate even when they
  // never explicitly close the card.
  const everythingDone = remaining === 0
  useEffect(() => {
    if (!everythingDone) return
    post('/api/onboarding/complete', {}).catch(() => {})
  }, [everythingDone])

  if (dismissed || remaining === 0) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          color: 'var(--tm-gold-text)', fontSize: 12, letterSpacing: '0.1em', fontWeight: 800,
          background: 'rgba(255,253,248,0.85)', padding: '4px 10px', borderRadius: 6,
          textShadow: '0 1px 1px rgba(255,255,255,0.4)',
        }}>
          GET STARTED
        </div>
        <span style={{
          background: 'var(--tm-gold)', color: '#FFFFFF',
          borderRadius: 10, fontSize: 10, fontWeight: 700, padding: '1px 7px',
        }}>{total - remaining} / {total}</span>
        <span style={{ flex: 1 }} />
        <button onClick={dismiss} style={{
          background: 'rgba(13,31,18,0.06)', border: '1px solid rgba(13,31,18,0.10)',
          borderRadius: 8, color: 'rgba(13,31,18,0.55)',
          fontSize: 11, fontWeight: 600,
          padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
        }}>Dismiss</button>
      </div>

      <div style={{
        background: 'linear-gradient(135deg, #FFFFFF 0%, var(--tm-bg) 100%)',
        border: '2px solid rgba(201,160,64,0.45)',
        borderRadius: 16,
        boxShadow: '0 2px 18px rgba(201,160,64,0.18)',
        overflow: 'hidden',
      }}>
        {items.map((item, i) => (
          <div key={item.key} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px',
            borderBottom: i < items.length - 1 ? '1px solid rgba(201,160,64,0.14)' : 'none',
            opacity: item.done ? 0.55 : 1,
          }}>
            {/* Check / circle */}
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: item.done
                ? 'linear-gradient(135deg, #4ADE80, #16A34A)'
                : 'rgba(27,94,59,0.06)',
              border: item.done ? '1px solid rgba(34,197,94,0.50)' : '1.5px solid rgba(201,160,64,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {item.done && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: 'var(--tm-text)',
                textDecoration: item.done ? 'line-through' : 'none',
              }}>{item.label}</div>
              {!item.done && item.hint && (
                <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.55)', marginTop: 2 }}>
                  {item.hint}
                </div>
              )}
            </div>

            {!item.done && item.cta && (
              <button onClick={item.action} style={{
                background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold))',
                border: 'none', borderRadius: 10,
                color: '#070C09', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em',
                padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit',
                flexShrink: 0,
              }}>{item.cta} →</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
