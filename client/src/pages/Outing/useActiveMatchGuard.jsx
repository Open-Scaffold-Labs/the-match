import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../../lib/api.js'
import { warn } from '../../lib/logger.js'

// ─── One-active-match guard ──────────────────────────────────────────────────
// Enforces "you can only be in ONE active match at a time." Used by the create
// and join flows: before starting/joining a match, call ensureSingleActive().
// It checks /api/outings/recent (already participant-scoped — covers matches
// you host AND ones you only joined) for another active match. If found, it
// shows an in-app confirm sheet (no window.confirm) and resolves to:
//   true  → caller should proceed (the old match was ended/left)
//   false → caller should abort (user cancelled)
//
// Resolving the old match depends on the user's role in it:
//   host        → POST /:code/cancel    (DISCARDS it — no results saved)
//   participant → POST /:code/withdraw  (self-withdraw — they only joined it)
//
// (2026-07-09, Matt) host branch was POST /:code/end — the heavy close-ceremony
// (match-history writes, handicap recompute, round emits). On a Vercel timeout
// that ceremony could fail AFTER we'd already decided to proceed, leaving the
// old match 'active' → TWO live matches at once. Switched to /cancel, which is a
// single lightweight status='cancelled' UPDATE (the match is discarded, not
// closed-with-results), and we now REFUSE to proceed if the discard fails so a
// second active match can never be created.
export function useActiveMatchGuard(user) {
  const [conflict, setConflict] = useState(null) // { outing, isHost } | null
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)
  const resolverRef = useRef(null)

  // Returns Promise<boolean>. excludeCode skips a match by code (the one being
  // joined, which isn't a conflict with itself).
  async function ensureSingleActive(excludeCode) {
    try {
      const r = await api('/api/outings/recent')
      const other = (r?.outings || []).find(o =>
        o && o.status === 'active' &&
        String(o.code).toUpperCase() !== String(excludeCode || '').toUpperCase()
      )
      if (!other) return true
      const isHost = String(other.host_id) === String(user?.id)
      return await new Promise(resolve => {
        resolverRef.current = resolve
        setConflict({ outing: other, isHost })
      })
    } catch (e) {
      warn('[active-match-guard] check failed', e?.message)
      return true // don't block on a network hiccup
    }
  }

  function finish(result) {
    const resolve = resolverRef.current
    resolverRef.current = null
    setConflict(null)
    setBusy(false)
    setError(null)
    resolve?.(result)
  }

  async function onConfirm() {
    if (!conflict || busy) return
    const { outing, isHost } = conflict
    setBusy(true)
    setError(null)
    try {
      if (isHost) {
        // DISCARD the old match (lightweight, reliable) — see header note.
        await post(`/api/outings/${outing.code}/cancel`, { reason: 'Discarded to start a new match' })
      } else {
        await post(`/api/outings/${outing.code}/withdraw`, { user_id: user?.id, withdrawn: true })
      }
    } catch (e) {
      // Do NOT proceed on failure — proceeding is exactly what allowed a second
      // active match to be created. Surface the error and let the user retry.
      warn('[active-match-guard] could not resolve old match', e?.message)
      setBusy(false)
      setError(isHost
        ? 'Could not discard your current match. Check your connection and try again.'
        : 'Could not leave your current match. Check your connection and try again.')
      return
    }
    finish(true)
  }

  function onCancel() {
    if (busy) return
    finish(false)
  }

  const modalEl = conflict
    ? <ActiveMatchModal outing={conflict.outing} isHost={conflict.isHost} busy={busy} error={error} onConfirm={onConfirm} onCancel={onCancel} />
    : null

  return { ensureSingleActive, modalEl }
}

// Confirm sheet — bottom-sheet, matches GuestModal styling.
function ActiveMatchModal({ outing, isHost, busy, error, onConfirm, onCancel }) {
  const where = outing.course_name ? ` at ${outing.course_name}` : ''
  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end',
    }} onClick={busy ? undefined : onCancel}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--tm-text)', marginBottom: 6 }}>
          You're already in an active match
        </div>
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginBottom: 20, lineHeight: 1.5 }}>
          {isHost
            ? <><strong style={{ color: 'var(--tm-text)' }}>{outing.name}</strong> ({outing.code}){where} is still going. You can only be in one match at a time — continuing will <strong style={{ color: 'var(--tm-text)' }}>discard it (no results are saved)</strong>.</>
            : <>You're in <strong style={{ color: 'var(--tm-text)' }}>{outing.name}</strong> ({outing.code}){where}. You can only be in one match at a time — continuing will <strong style={{ color: 'var(--tm-text)' }}>remove you from it</strong>.</>}
        </div>
        {error && (
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#E5484D', marginBottom: 14, lineHeight: 1.4 }}>
            {error}
          </div>
        )}
        <button
          onClick={onConfirm}
          disabled={busy}
          style={{
            width: '100%', padding: 14, borderRadius: 'var(--tm-radius-lg)',
            background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
            color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 15,
            border: 'none', cursor: busy ? 'default' : 'pointer', marginBottom: 10,
            opacity: busy ? 0.7 : 1,
          }}
        >{busy ? 'Working…' : isHost ? 'Discard it & continue' : 'Leave it & continue'}</button>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            width: '100%', padding: 14, borderRadius: 'var(--tm-radius-lg)',
            background: 'transparent', color: 'var(--tm-text-3)',
            fontWeight: 700, fontSize: 14, border: '1px solid var(--tm-border)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >Keep my current match</button>
      </div>
    </div>,
    document.body
  )
}
