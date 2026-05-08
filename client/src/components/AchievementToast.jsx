import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// ─── AchievementToast ──────────────────────────────────────────────────────
// Pops down from the top center when a score write returns a freshly-earned
// achievement. Holds for ~4.5s (common) or longer for higher tiers, then
// fades. Tap-anywhere on the card dismisses early. If multiple achievements
// arrive in the same response (rare — happens if a sub_80 round also
// crosses the streak_week threshold), they queue up and play one at a time.
//
// 2026-05-07 PM — rarity tiers added so harder-earned achievements feel
// special. Matt: 'make harder earned achievements look cooler too, make
// bigger achievements feel really special'. Three tiers:
//   common    — standard cream pill at top, ~4.5s hold (current treatment)
//   rare      — pill with iridescent gold/silver border + RARE tag,
//               bigger badge, glow, ~5.5s hold
//   legendary — full-screen takeover with dimmed backdrop, big centered
//               card, sparkle/burst animation, "✦ LEGENDARY ✦" tag,
//               ~7s hold. Reserved for hole-in-one and similar rare-feat
//               moments.
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
// (2026-05-06 — polish task #5; 2026-05-07 — rarity tiers)

// Inline icons — one per achievement TYPE. New icons added 2026-05-07
// for the v2 expansion (hole_in_one, first_par, breaking_100/90).
function IconForType({ type, size = 26, strokeColor, fillColor }) {
  const stroke = strokeColor || '#7A5800'
  const fill   = fillColor   || '#F5D78A'
  switch (type) {
    case 'first_birdie':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M9 14c0-3 2-5 5-5 1 0 2 0 3 1l2-1-1 2-1 1c0 2-1 4-3 5-2 0-3 0-4-1l-2 3-1-1 2-4z"
            fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="16" cy="11" r="0.7" fill={stroke} />
          <path d="M19 9l2-1" stroke={stroke} strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )
    case 'first_eagle':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M3 14c2-1 4-1 6-1 1-2 3-3 5-3 2 0 3 1 4 2l2-1-1 3c-1 1-2 2-4 2-1 0-2 0-3-1-2 1-4 2-7 2-1 0-2-1-2-3z"
            fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
          <circle cx="17.5" cy="11" r="0.8" fill={stroke} />
        </svg>
      )
    case 'hole_in_one':
      // Ace — golf cup with flag, big bold "1" rising out. The
      // legendary-tier rendering uses larger size; this icon scales.
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          {/* Cup */}
          <ellipse cx="12" cy="20" rx="6" ry="1.6" fill={stroke} opacity="0.20" />
          <path d="M7 19 C7 15 7 13 7 12 H17 C17 13 17 15 17 19" fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
          {/* Flag pole */}
          <line x1="12" y1="3" x2="12" y2="13" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
          {/* Flag */}
          <path d="M12 4 L18 5.5 L12 7.5 Z" fill={stroke} />
          {/* "1" */}
          <text x="12" y="17.5" textAnchor="middle" fontSize="6" fontWeight="900" fill={stroke} fontFamily="Arial Black, sans-serif">1</text>
        </svg>
      )
    case 'first_par':
      // Par — flag on green, simpler than ace.
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <ellipse cx="12" cy="20" rx="6" ry="1.6" fill={stroke} opacity="0.20" />
          <line x1="9" y1="4" x2="9" y2="20" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M9 5 L17 7 L9 9 Z" fill={fill} stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      )
    case 'sub_80':
    case 'breaking_90':
    case 'breaking_100':
      // Flame — same icon for all the round-tier achievements; the
      // tier color (set via fillColor) differentiates them visually.
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-5 0-8z"
            fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
    case 'streak_week':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M13 3 L5 13 H11 L9 21 L19 11 H13 Z"
            fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="10" r="6" fill={fill} stroke={stroke} strokeWidth="1.6" />
          <path d="M9 14 L7 21 L12 19 L17 21 L15 14"
            fill={fill} stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )
  }
}

// Hold time per rarity. Legendary holds longer because the user wants
// time to read it / share / screenshot.
const HOLD_MS = { common: 4000, rare: 5000, legendary: 6500 }
const FADE_MS = 600

export default function AchievementToast() {
  const [queue, setQueue] = useState([])
  const [closing, setClosing] = useState(false)
  const current = queue[0] || null
  const rarity = current?.rarity || 'common'

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

  useEffect(() => {
    if (!current) return
    setClosing(false)
    const hold = HOLD_MS[rarity] || HOLD_MS.common
    const fadeAt = setTimeout(() => setClosing(true), hold)
    const doneAt = setTimeout(() => popCurrent(), hold + FADE_MS)
    return () => { clearTimeout(fadeAt); clearTimeout(doneAt) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  if (!current) return null

  // Legendary tier — full-screen takeover. Dimmed backdrop, big centered
  // card, sparkle ring, "✦ LEGENDARY ✦" tag, scale-pop entrance.
  if (rarity === 'legendary') {
    return createPortal(
      <div
        onClick={() => popCurrent()}
        style={{
          position: 'fixed', inset: 0, zIndex: 10003,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
          background: 'rgba(0,0,0,0.78)',
          opacity: closing ? 0 : 1,
          transition: `opacity ${FADE_MS}ms ease`,
          cursor: 'pointer',
        }}>
        <div style={{
          maxWidth: 360, width: '100%',
          background: 'linear-gradient(135deg, #FFFDF8 0%, #FBE5A8 50%, #FFFDF8 100%)',
          backgroundSize: '200% 200%',
          animation: 'tm-celebrate-pop 480ms cubic-bezier(0.34, 1.56, 0.64, 1), tm-legendary-shimmer 3s ease-in-out infinite',
          border: '2px solid #C9A040',
          borderRadius: 24, padding: '24px 22px 22px',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.8) inset, 0 0 32px rgba(232,192,90,0.65), 0 24px 60px rgba(0,0,0,0.55)',
          textAlign: 'center', position: 'relative',
        }}>
          {/* Sparkle ring around the badge */}
          <div style={{
            position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: 4, fontSize: 16, color: '#C9A040',
            textShadow: '0 0 8px rgba(232,192,90,0.8)',
            letterSpacing: '0.08em',
          }}>✦</div>
          <div style={{
            fontSize: 11, fontWeight: 900, letterSpacing: '0.30em',
            color: '#7A5800', marginBottom: 12,
          }}>✦ LEGENDARY ✦</div>
          {/* Big radiant badge */}
          <div style={{
            width: 96, height: 96, borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #FFE9A8 0%, #E8C05A 50%, #C9A040 100%)',
            border: '2px solid #7A5800',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px',
            boxShadow: '0 0 0 6px rgba(232,192,90,0.20), 0 0 24px rgba(232,192,90,0.55), inset 0 2px 0 rgba(255,255,255,0.5)',
            position: 'relative',
          }}>
            <IconForType type={current.type} size={56} />
            {/* Orbiting sparkles */}
            <div style={{
              position: 'absolute', inset: -10,
              border: '1px dashed rgba(232,192,90,0.40)',
              borderRadius: '50%',
              animation: 'tm-legendary-orbit 8s linear infinite',
              pointerEvents: 'none',
            }} />
          </div>
          <div style={{
            fontSize: 22, fontWeight: 900, color: '#0D1F12', lineHeight: 1.1,
            letterSpacing: '0.02em', marginBottom: 6,
          }}>{current.title || current.type}</div>
          <div style={{
            fontSize: 13, color: 'rgba(13,31,18,0.72)', lineHeight: 1.4,
            marginBottom: 10,
          }}>{current.subtitle || ''}</div>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'rgba(122,88,0,0.70)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>Tap to dismiss</div>
        </div>
      </div>,
      document.body
    )
  }

  // Rare tier — top pill, but bigger, with iridescent gold/silver border
  // and a "RARE" tag. The badge is larger and gets a subtle glow.
  if (rarity === 'rare') {
    return createPortal(
      <div
        onClick={() => popCurrent()}
        style={{
          position: 'fixed',
          top: 'calc(var(--safe-top) + 12px)',
          left: 0, right: 0,
          zIndex: 10002,
          display: 'flex', justifyContent: 'center',
          padding: '0 12px',
          opacity: closing ? 0 : 1,
          transform: closing ? 'translateY(-8px)' : 'translateY(0)',
          transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
          cursor: 'pointer',
        }}>
        <div style={{
          maxWidth: 400, width: '100%',
          background: 'linear-gradient(180deg, #FFFDF8 0%, #FBF3DC 100%)',
          // Iridescent border via gradient. Pseudo-element trick via box-shadow.
          border: '2px solid transparent',
          backgroundImage: 'linear-gradient(180deg, #FFFDF8 0%, #FBF3DC 100%), linear-gradient(135deg, #C9A040 0%, #E8E8E8 35%, #C9A040 70%, #F5D78A 100%)',
          backgroundOrigin: 'border-box',
          backgroundClip: 'padding-box, border-box',
          borderRadius: 18, padding: '14px 16px',
          boxShadow: '0 18px 44px rgba(0,0,0,0.30), 0 4px 12px rgba(232,192,90,0.30), 0 0 0 1px rgba(245,215,138,0.40)',
          display: 'flex', alignItems: 'center', gap: 14,
          animation: 'tm-celebrate-pop 380ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #FFE9A8 0%, #E8C05A 60%, #C9A040 100%)',
            border: '2px solid rgba(122,88,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 0 4px rgba(232,192,90,0.22), 0 4px 12px rgba(201,160,64,0.50), inset 0 1px 0 rgba(255,255,255,0.55)',
          }}>
            <IconForType type={current.type} size={32} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 9, fontWeight: 900, letterSpacing: '0.20em',
              textTransform: 'uppercase', color: '#7A5800',
              background: 'linear-gradient(135deg, rgba(201,160,64,0.18), rgba(232,192,90,0.30))',
              border: '1px solid rgba(122,88,0,0.30)',
              borderRadius: 4, padding: '2px 6px',
            }}>✦ Rare</div>
            <div style={{
              fontSize: 16, fontWeight: 900, color: '#0D1F12', lineHeight: 1.15,
              marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{current.title || current.type}</div>
            <div style={{
              fontSize: 12, color: 'rgba(13,31,18,0.65)', lineHeight: 1.3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              marginTop: 2,
            }}>{current.subtitle || ''}</div>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  // Common tier — standard pill at top of screen.
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
        transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
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

// Inline badge — used by the Profile achievement row. Tier-aware so a
// hole-in-one badge in the row pops compared to a first_par. (2026-05-07)
export function AchievementBadge({ achievement, size = 36 }) {
  if (!achievement) return null
  const rarity = achievement.rarity || 'common'
  const styles = rarity === 'legendary'
    ? {
        bg: 'radial-gradient(circle at 30% 30%, #FFE9A8 0%, #E8C05A 50%, #C9A040 100%)',
        border: '2px solid #7A5800',
        shadow: '0 0 0 3px rgba(232,192,90,0.25), 0 2px 10px rgba(232,192,90,0.55), inset 0 1px 0 rgba(255,255,255,0.5)',
      }
    : rarity === 'rare'
    ? {
        bg: 'radial-gradient(circle at 30% 30%, #FFE9A8 0%, #E8C05A 60%, #C9A040 100%)',
        border: '1.8px solid rgba(122,88,0,0.55)',
        shadow: '0 0 0 2px rgba(232,192,90,0.20), 0 2px 8px rgba(201,160,64,0.45), inset 0 1px 0 rgba(255,255,255,0.50)',
      }
    : {
        bg: 'radial-gradient(circle at 30% 30%, #FFE9A8 0%, #C9A040 75%)',
        border: '1.5px solid rgba(122,88,0,0.45)',
        shadow: '0 2px 6px rgba(201,160,64,0.30), inset 0 1px 0 rgba(255,255,255,0.45)',
      }
  return (
    <div title={`${achievement.title} — ${achievement.subtitle}`} style={{
      width: size, height: size, borderRadius: '50%',
      background: styles.bg,
      border: styles.border,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: styles.shadow,
    }}>
      <IconForType type={achievement.type} size={Math.round(size * 0.6)} />
    </div>
  )
}
