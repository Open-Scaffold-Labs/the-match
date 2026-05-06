import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// ─── AchievementToast ──────────────────────────────────────────────────────
// Pops down from the top center when a score write returns a freshly-earned
// achievement. Holds for ~4.5s then fades away. Tap-anywhere on the card
// dismisses early. If multiple achievements arrive in the same response (rare
// — happens if a sub_80 round also crosses the streak_week threshold), they
// queue up and play one at a time.
//
// Visual: cream pill with a gold trophy badge, gold gradient ribbon, and
// the achievement title + subtitle. Same celebrate-pop animation as the
// HighlightShareModal so the brand feels consistent across all "you did
// something special" moments.
//
// Mount once near the App root. The component listens for a global
// `tm:achievement-earned` CustomEvent; any code path that writes a
// score (LiveOuting, ActiveRound, future paths) can dispatch:
//
//   window.dispatchEvent(new CustomEvent('tm:achievement-earned', {
//     detail: { achievements: res.achievements }
//   }))
//
// The toast then queues + plays them. Doing this via a window event
// (rather than passing a `queue` prop) is essential for ActiveRound,
// which calls onBack() after save — its component tree unmounts before
// the toast could play if the queue lived in its state.
//
// (2026-05-06 — polish task #5)

// Three tiny inline icons matching the achievement TYPEs declared in
// server/src/lib/achievements.js. Anything unknown falls back to 'badge'.
function IconForType({ type, size = 26 }) {
  const stroke = '#7A5800'
  const fill   = '#F5D78A'
  switch (type) {
    case 'first_eagle':
      // Eagle — stylized profile bird silhouette (paint the body in fill,
      // beak/wing line in stroke for definition).
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M3 14c2-1 4-1 6-1 1-2 3-3 5-3 2 0 3 1 4 2l2-1-1 3c-1 1-2 2-4 2-1 0-2 0-3-1-2 1-4 2-7 2-1 0-2-1-2-3z"
            fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="17.5" cy="11" r="0.8" fill={stroke} />
        </svg>
      )
    case 'sub_80':
      // Flame.
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-5 0-8z"
            fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
    case 'streak_week':
      // Lightning bolt.
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M13 3 L5 13 H11 L9 21 L19 11 H13 Z"
            fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
    default:
      // Generic ribbon badge.
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="10" r="6" fill={fill} stroke={stroke} strokeWidth="1.6" />
          <path d="M9 14 L7 21 L12 19 L17 21 L15 14"
            fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
  }
}

export default function AchievementToast() {
  const [queue, setQueue] = useState([])
  const [closing, setClosing] = useState(false)
  const current = queue[0] || null

  // Listen for the global emit. Earlier mounts of LiveOuting / ActiveRound
  // dispatch achievements through `tm:achievement-earned` so the toast
  // survives any concurrent screen transitions (especially the post-
  // save navigation in ActiveRound). De-dupe by `id` so a double-fire
  // (e.g. retried writes) doesn't queue the same award twice.
  useEffect(() => {
    function handle(e) {
      const list = Array.isArray(e?.detail?.achievements) ? e.detail.achievements : []
      if (!list.length) return
      setQueue(q => {
        const seen = new Set(q.map(a => a.id))
        const fresh = list.filter(a => a && !seen.has(a.id))
        return fresh.length ? [...q, ...fresh] : q
      })
    }
    window.addEventListener('tm:achievement-earned', handle)
    return () => window.removeEventListener('tm:achievement-earned', handle)
  }, [])

  function popCurrent() {
    setQueue(q => q.slice(1))
  }

  // Auto-dismiss timer.
  useEffect(() => {
    if (!current) return
    setClosing(false)
    const fadeAt = setTimeout(() => setClosing(true), 4000)
    const doneAt = setTimeout(() => popCurrent(), 4600)
    return () => { clearTimeout(fadeAt); clearTimeout(doneAt) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  if (!current) return null

  return createPortal(
    <div
      onClick={() => popCurrent()}
      style={{
        position: 'fixed',
        top: 'calc(var(--safe-top) + 12px)',
        left: 0, right: 0,
        zIndex: 10002,
        display: 'flex', justifyContent: 'center',
        pointerEvents: 'auto',
        padding: '0 16px',
        opacity: closing ? 0 : 1,
        transform: closing ? 'translateY(-8px)' : 'translateY(0)',
        transition: 'opacity 380ms ease, transform 380ms ease',
      }}>
      <div style={{
        maxWidth: 380, width: '100%',
        background: 'linear-gradient(180deg, #FFFDF8 0%, #FBF3DC 100%)',
        border: '1px solid rgba(201,160,64,0.55)',
        borderRadius: 18, padding: '12px 14px',
        boxShadow: '0 16px 40px rgba(0,0,0,0.28), 0 2px 6px rgba(122,88,0,0.14)',
        display: 'flex', alignItems: 'center', gap: 12,
        animation: 'tm-celebrate-pop 360ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        cursor: 'pointer',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'radial-gradient(circle at 30% 30%, #FFE9A8 0%, #C9A040 75%)',
          border: '1.5px solid rgba(122,88,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 2px 8px rgba(201,160,64,0.40), inset 0 1px 0 rgba(255,255,255,0.45)',
        }}>
          <IconForType type={current.type} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.16em',
            textTransform: 'uppercase', color: '#7A5800',
          }}>Achievement unlocked</div>
          <div style={{
            fontSize: 15, fontWeight: 800, color: '#0D1F12', lineHeight: 1.2,
            marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{current.title || current.type}</div>
          <div style={{
            fontSize: 12, color: 'rgba(13,31,18,0.62)', lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            marginTop: 1,
          }}>{current.subtitle || ''}</div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Small named export so callers can render an inline badge for a single
// achievement (used by the Profile badge row).
export function AchievementBadge({ achievement, size = 36 }) {
  if (!achievement) return null
  return (
    <div title={`${achievement.title} — ${achievement.subtitle}`} style={{
      width: size, height: size, borderRadius: '50%',
      background: 'radial-gradient(circle at 30% 30%, #FFE9A8 0%, #C9A040 75%)',
      border: '1.5px solid rgba(122,88,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: '0 2px 6px rgba(201,160,64,0.30), inset 0 1px 0 rgba(255,255,255,0.45)',
    }}>
      <IconForType type={achievement.type} size={Math.round(size * 0.6)} />
    </div>
  )
}
