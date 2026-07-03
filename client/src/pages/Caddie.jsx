import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { post } from '../lib/api.js'

// The Caddie — AI chat calibrated to the player's real game (whitepaper §5.6).
//
// The server builds the system prompt from facts (bag averages, handicap,
// tendencies, the Strokes Gained block, practice focus areas) — this screen is
// deliberately thin: history in, reply out. Dark Augusta-at-night instrument
// surface; portals to <body> like Practice (the tab content lives in a
// transformed container that traps position:fixed).

const STARTERS = [
  "Where am I losing strokes right now?",
  "165 out, slight uphill, breeze into me — what club?",
  "Build me a 20-minute warm-up for tomorrow's match",
  "My driver's gone left all week. Quick fix?",
]

function ChevronLeft({ size = 20, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
}
function FlagGlyph({ size = 18, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="22" x2="5" y2="3"/><path d="M5 4h13l-3 4 3 4H5"/></svg>
}
function SendGlyph({ size = 18, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none" aria-hidden="true"><path d="M3 20.6 21.4 12 3 3.4l3.2 7.2L14 12l-7.8 1.4z"/></svg>
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '4px 2px' }} aria-label="The caddie is thinking">
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: 3, background: 'rgba(245,215,138,0.75)',
          animation: 'tmCaddieDot 1.1s ease-in-out infinite', animationDelay: `${i * 0.18}s`,
        }} />
      ))}
      <style>{`@keyframes tmCaddieDot { 0%,60%,100%{opacity:.25;transform:translateY(0)} 30%{opacity:1;transform:translateY(-3px)} }`}</style>
    </div>
  )
}

export default function Caddie({ onClose, round = null }) {
  const [messages, setMessages] = useState([])   // {role, content}
  const [input, setInput]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState(null)
  const scrollRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  async function send(text) {
    const content = (text ?? input).trim()
    if (!content || busy) return
    setError(null)
    setInput('')
    const next = [...messages, { role: 'user', content }]
    setMessages(next)
    setBusy(true)
    try {
      const r = await post('/api/caddie/chat', { messages: next, round })
      setMessages([...next, { role: 'assistant', content: r.reply }])
    } catch (e) {
      setError(e?.payload?.error ?? 'The caddie lost signal — try again.')
      // keep the user's message in the thread so a retry resends naturally
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column',
      background: 'var(--tm-dark-0, #070C09)',
      paddingTop: 'env(safe-area-inset-top)',
    }}>
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0,
      }}>
        <button onClick={onClose} className="touch-press" aria-label="Close caddie" style={{
          width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)', cursor: 'pointer',
        }}><ChevronLeft /></button>
        <div style={{
          width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(201,160,64,0.20)', border: '1px solid rgba(201,160,64,0.40)',
        }}><FlagGlyph color="#F5D78A" /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#F5D78A', letterSpacing: '-0.3px' }}>The Caddie</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>Knows your bag, your numbers, your leaks</div>
        </div>
      </div>

      {/* thread */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', WebkitOverflowScrolling: 'touch' }}>
        {messages.length === 0 && (
          <div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '6px 2px 14px' }}>
              Ask about a shot, a hole, or your game — answers use your real club
              distances and your measured strokes-gained profile.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {STARTERS.map(s => (
                <button key={s} onClick={() => send(s)} className="touch-press" style={{
                  textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                  background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.09)',
                  color: 'rgba(255,255,255,0.85)', fontSize: 13.5, lineHeight: 1.35,
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <div style={{
              maxWidth: '82%', padding: '10px 13px', borderRadius: 14, fontSize: 14, lineHeight: 1.45,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              ...(m.role === 'user'
                ? { background: 'rgba(42,122,56,0.35)', border: '1px solid rgba(42,122,56,0.55)', color: '#EDF5EF', borderBottomRightRadius: 5 }
                : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.88)', borderBottomLeftRadius: 5 }),
            }}>{m.content}</div>
          </div>
        ))}

        {busy && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
            <div style={{ padding: '10px 13px', borderRadius: 14, borderBottomLeftRadius: 5, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
              <TypingDots />
            </div>
          </div>
        )}

        {error && (
          <div style={{
            margin: '4px 0 10px', padding: '10px 13px', borderRadius: 12, fontSize: 13,
            background: 'rgba(224,82,82,0.12)', border: '1px solid rgba(224,82,82,0.35)', color: '#F0A3A3',
          }}>
            {error}{' '}
            <button onClick={() => { const last = [...messages].reverse().find(m => m.role === 'user'); if (last) { setMessages(messages.filter((_, i) => i !== messages.length - 1)); send(last.content) } }}
              style={{ background: 'none', border: 'none', color: '#F5D78A', fontWeight: 700, cursor: 'pointer', fontSize: 13, padding: 0 }}>
              Retry
            </button>
          </div>
        )}
      </div>

      {/* composer */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 14px',
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
        borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0,
        background: 'var(--tm-dark-1, #0E1610)',
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Ask your caddie…"
          enterKeyHint="send"
          style={{
            flex: 1, minWidth: 0, padding: '12px 14px', borderRadius: 12, fontSize: 15,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
            color: '#EDF5EF', outline: 'none',
          }}
        />
        <button onClick={() => send()} disabled={busy || !input.trim()} className="touch-press" aria-label="Send" style={{
          width: 46, height: 46, borderRadius: 12, flexShrink: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: input.trim() && !busy ? 'var(--tm-green, #2A7A38)' : 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.10)',
          color: input.trim() && !busy ? '#EDF5EF' : 'rgba(255,255,255,0.35)',
        }}><SendGlyph /></button>
      </div>
    </div>,
    document.body
  )
}
