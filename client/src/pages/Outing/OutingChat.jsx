import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../../lib/api.js'
import { tmHaptic, PlayerAvatar, relDate } from './shared.jsx'

// ─── Unread-badge helpers ──────────────────────────────────────────────────
// Stored as `tm-chat-seen-<code>` in localStorage. The LiveOuting header
// renders the unread count via useChatUnreadCount(code); the chat sheet
// updates the high-water mark whenever it loads a new message.

function chatSeenKey(code) { return `tm-chat-seen-${(code || '').toUpperCase()}` }

export function markChatSeen(code, messageId) {
  if (!code || messageId == null) return
  try { localStorage.setItem(chatSeenKey(code), String(messageId)) } catch { /* ignore */ }
}

export function getChatSeen(code) {
  if (!code) return 0
  try {
    const v = localStorage.getItem(chatSeenKey(code))
    return v ? Number(v) || 0 : 0
  } catch { return 0 }
}

// useChatUnreadCount(code, opts) — polls /api/outings/:code/messages?since=<seen>&limit=1
// every 30s and returns the count of new messages above the stored
// high-water mark. Returns 0 when the user has nothing new. Stops
// polling when `enabled` is false (e.g. the chat sheet is open and
// unread is conceptually 0).
export function useChatUnreadCount(code, { enabled = true, intervalMs = 30000 } = {}) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!code || !enabled) { setCount(0); return }
    let alive = true
    async function poll() {
      const seen = getChatSeen(code)
      try {
        const r = await api(`/api/outings/${code}/messages?since=${seen}&limit=200`)
        if (!alive) return
        setCount((r?.messages || []).length)
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, intervalMs)
    // Re-check when tab becomes visible — Matt's "visibility-aware
    // polling" convention from the Hub repo. Saves background requests
    // on phones without missing the flag refresh on focus.
    function onVis() { if (document.visibilityState === 'visible') poll() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [code, enabled, intervalMs])
  return count
}

// ─── Outing/OutingChat.jsx ──────────────────────────────────────────────────
// Group chat for everyone in an outing. Polls /api/outings/:code/messages
// every 5s while open, immediately on every send, and once on mount. Stops
// polling when closed. Tap-outside dismisses; tap-the-handle dismisses.
//
// MVP scope (2026-05-06 — polish task #8):
//   • Plain-text body, 500-char cap
//   • Renders avatar + name + relative-date + body
//   • One scroll container, autoscrolls to bottom on new messages
//   • Send button disabled while empty / sending
//   • No @mentions, no read receipts (deferred to v2)

export default function OutingChat({ outing, userId, onClose }) {
  const code = outing?.code
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const lastSeenIdRef = useRef(0)
  const listRef = useRef(null)
  const pollRef = useRef(null)

  // Initial fetch — pulls the most-recent 100, then keeps polling.
  // Also writes the high-water-mark message id to localStorage so the
  // unread-badge on the Chat button (LiveOuting → useOutingChatBadge)
  // knows everything up to that id has been seen. (Hardening pass —
  // closes the gap where new messages had no surface visibility outside
  // an open chat sheet.)
  async function loadInitial() {
    setLoading(true)
    try {
      const r = await api(`/api/outings/${code}/messages?limit=100`)
      const list = Array.isArray(r?.messages) ? r.messages : []
      setMessages(list)
      if (list.length) {
        const top = list[list.length - 1].id
        lastSeenIdRef.current = top
        markChatSeen(code, top)
      }
    } catch (e) {
      setErr('Could not load messages.')
    }
    setLoading(false)
  }

  // Incremental — only fetches new since lastSeenId. Cheap.
  async function pollNew() {
    try {
      const r = await api(`/api/outings/${code}/messages?since=${lastSeenIdRef.current}&limit=100`)
      const list = Array.isArray(r?.messages) ? r.messages : []
      if (list.length) {
        setMessages(prev => [...prev, ...list])
        const top = list[list.length - 1].id
        lastSeenIdRef.current = top
        markChatSeen(code, top)  // open chat counts as "read"
      }
    } catch { /* ignore polling failures — next tick will retry */ }
  }

  useEffect(() => {
    if (!code) return
    loadInitial()
    pollRef.current = setInterval(pollNew, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // Autoscroll to the latest message on every change.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages.length])

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setErr(null)
    try {
      const r = await post(`/api/outings/${code}/messages`, { body })
      const newMsg = r?.message
      if (newMsg) {
        // Optimistic-ish: server returned the row, append directly.
        // Hydrate user_name/avatar from outing.state since the server
        // didn't join them on POST.
        const me = (outing?.state?.participants || []).find(p => String(p.user_id) === String(userId))
        setMessages(prev => [...prev, {
          ...newMsg,
          user_name:   me?.name || 'You',
          user_avatar: me?.avatar || null,
        }])
        lastSeenIdRef.current = newMsg.id
        markChatSeen(code, newMsg.id)
      }
      setDraft('')
      tmHaptic(10)
    } catch (e) {
      setErr(e?.payload?.error === 'too_long'
        ? 'Message is too long (max 500).'
        : 'Could not send. Try again.')
    } finally {
      setSending(false)
    }
  }

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430,
        height: '85vh',
        background: '#FFFDF8',
        borderRadius: '20px 20px 0 0',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 -8px 30px rgba(0,0,0,0.30)',
      }}>
        {/* Header */}
        <div style={{
          padding: 'calc(var(--safe-top) + 12px) 18px 12px',
          borderBottom: '1px solid rgba(27,94,59,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--tm-text)' }}>
              {outing?.name || 'Match'} chat
            </div>
            <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.45)', marginTop: 2 }}>
              {(outing?.state?.participants || []).length} players · live
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.12)',
            borderRadius: 10, color: 'var(--tm-green)', fontSize: 16, padding: '4px 12px',
            cursor: 'pointer',
          }}>✕</button>
        </div>

        {/* Messages */}
        <div ref={listRef} style={{
          flex: 1, overflowY: 'auto',
          padding: '12px 16px',
          background: 'linear-gradient(180deg, #FFFDF8 0%, #FBF7EB 100%)',
        }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(13,31,18,0.45)', fontSize: 12 }}>
              Loading messages…
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '40px 12px', color: 'rgba(13,31,18,0.55)',
              fontSize: 13, lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 800, color: 'var(--tm-text)', marginBottom: 4 }}>
                Quiet on the course.
              </div>
              Be the first to chirp at the field.
            </div>
          )}
          {!loading && messages.map(m => {
            const isMe = String(m.user_id) === String(userId)
            return (
              <Bubble key={m.id} m={m} isMe={isMe} />
            )
          })}
        </div>

        {/* Composer */}
        <div style={{
          padding: '10px 14px calc(var(--safe-bottom) + 12px)',
          borderTop: '1px solid rgba(27,94,59,0.10)',
          background: '#FFFDF8',
          display: 'flex', gap: 8, alignItems: 'flex-end',
        }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 500))}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            placeholder="Talk to the foursome…"
            rows={1}
            style={{
              flex: 1, minHeight: 38, maxHeight: 120,
              padding: '10px 12px', borderRadius: 18,
              border: '1px solid var(--tm-border)',
              background: 'var(--tm-surface-2)',
              fontSize: 14, lineHeight: 1.4,
              fontFamily: 'inherit',
              color: 'var(--tm-text)',
              resize: 'none',
            }}
          />
          <button
            onClick={send}
            disabled={!draft.trim() || sending}
            style={{
              padding: '10px 16px', borderRadius: 18, border: 'none',
              background: draft.trim() && !sending
                ? 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))'
                : 'var(--tm-surface-2)',
              color: draft.trim() && !sending ? '#fff' : 'var(--tm-text-3)',
              fontWeight: 800, fontSize: 13,
              cursor: draft.trim() && !sending ? 'pointer' : 'default',
              flexShrink: 0,
            }}
          >{sending ? '…' : 'Send'}</button>
        </div>
        {err && (
          <div style={{
            padding: '6px 16px 10px',
            color: 'var(--tm-danger)', fontSize: 11, fontWeight: 700, textAlign: 'center',
          }}>
            {err}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function Bubble({ m, isMe }) {
  return (
    <div style={{
      display: 'flex', gap: 8,
      flexDirection: isMe ? 'row-reverse' : 'row',
      marginBottom: 12, alignItems: 'flex-end',
    }}>
      <PlayerAvatar name={m.user_name || 'Player'} avatar={m.user_avatar || null} size={28} />
      <div style={{ maxWidth: '72%' }}>
        <div style={{
          fontSize: 10, color: 'rgba(13,31,18,0.45)', fontWeight: 700,
          letterSpacing: '0.04em',
          textAlign: isMe ? 'right' : 'left', marginBottom: 2,
        }}>
          {isMe ? 'You' : (m.user_name || 'Player')} · {relDate(m.created_at)}
        </div>
        <div style={{
          background: isMe ? 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))' : 'var(--tm-surface-2)',
          color: isMe ? '#fff' : 'var(--tm-text)',
          padding: '8px 12px', borderRadius: 14,
          fontSize: 14, lineHeight: 1.4,
          border: isMe ? 'none' : '1px solid var(--tm-border)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {m.body}
        </div>
      </div>
    </div>
  )
}
