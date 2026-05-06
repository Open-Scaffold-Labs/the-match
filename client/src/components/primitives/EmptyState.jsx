// EmptyState — shared treatment for "the data set is empty" surfaces.
//
// Replaces the flat one-line "No items" strings the app shipped with.
// Each instance gets:
//   • A small Augusta-themed icon (pin-flag, scorecard, trophy) so the
//     surface has visual identity instead of just gray text on gray.
//   • A short headline (4–6 words, sentence case, can be playful — see
//     hub `claudeMd` "Empty-state copy has personality.")
//   • A subtitle that EXPLAINS what the user can do next (1–2 lines).
//   • Optional CTA button — only render where the surrounding surface
//     can actually navigate the user there (modals usually skip it
//     because their close button serves the exit).
//
// `tone` toggles between the dark-modal palette (white-on-translucent,
// used by RoundHistory + RivalryHistory which sit over a dark scrim)
// and the light-modal palette (ink-on-cream, used by FollowList which
// sits over the regular page). The subtle difference matters — the
// dark modal swallowed gray text, which is why these states felt
// invisible in the first place. (2026-05-06 — polish task #3)

// Three small Augusta-tinted SVGs we reuse across empty-state surfaces.
// Each is 48×48, sized down where called.
function PinFlagIcon({ tone }) {
  const pole = tone === 'dark' ? '#FFFDF8' : '#1B5E3B'
  const flag = tone === 'dark' ? '#F5D78A' : '#C9A040'
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <line x1="16" y1="8" x2="16" y2="42" stroke={pole} strokeWidth="2.4" strokeLinecap="round" />
      <line x1="9" y1="42" x2="23" y2="42" stroke={pole} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 8 L36 13 L16 18 Z" fill={flag} stroke={flag} strokeWidth="0.6" strokeLinejoin="round" />
    </svg>
  )
}

function ScorecardIcon({ tone }) {
  const stroke = tone === 'dark' ? '#FFFDF8' : '#1B5E3B'
  const accent = tone === 'dark' ? '#F5D78A' : '#C9A040'
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      {/* Card body */}
      <rect x="8" y="6" width="32" height="36" rx="4"
        stroke={stroke} strokeWidth="2.2" fill="none" />
      {/* Header bar */}
      <line x1="8" y1="14" x2="40" y2="14" stroke={stroke} strokeWidth="1.6" />
      {/* Three dotted score lines */}
      <line x1="13" y1="22" x2="35" y2="22" stroke={stroke} strokeWidth="1.4" strokeDasharray="2 3" opacity="0.55" />
      <line x1="13" y1="29" x2="35" y2="29" stroke={stroke} strokeWidth="1.4" strokeDasharray="2 3" opacity="0.55" />
      <line x1="13" y1="36" x2="35" y2="36" stroke={stroke} strokeWidth="1.4" strokeDasharray="2 3" opacity="0.55" />
      {/* Gold pencil cap accent */}
      <circle cx="34" cy="10" r="2" fill={accent} />
    </svg>
  )
}

function TrophyIcon({ tone }) {
  const stroke = tone === 'dark' ? '#FFFDF8' : '#1B5E3B'
  const fill   = tone === 'dark' ? '#F5D78A' : '#C9A040'
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      {/* Cup body */}
      <path d="M16 10 H32 V20 Q32 28 24 28 Q16 28 16 20 Z"
        fill={fill} stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
      {/* Handles */}
      <path d="M16 13 Q10 13 10 18 Q10 22 16 22" stroke={stroke} strokeWidth="1.8" fill="none" />
      <path d="M32 13 Q38 13 38 18 Q38 22 32 22" stroke={stroke} strokeWidth="1.8" fill="none" />
      {/* Stem + base */}
      <line x1="24" y1="28" x2="24" y2="34" stroke={stroke} strokeWidth="2" />
      <line x1="17" y1="38" x2="31" y2="38" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
      <line x1="20" y1="34" x2="28" y2="34" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

const ICONS = { 'pin-flag': PinFlagIcon, 'scorecard': ScorecardIcon, 'trophy': TrophyIcon }

export default function EmptyState({
  icon = 'pin-flag',
  title,
  subtitle,
  ctaLabel,
  onCta,
  tone = 'light',  // 'light' (light surfaces) | 'dark' (dark modals)
}) {
  const Icon = ICONS[icon] || PinFlagIcon
  const titleColor    = tone === 'dark' ? 'rgba(255,253,248,0.92)'  : 'var(--tm-text)'
  const subtitleColor = tone === 'dark' ? 'rgba(255,253,248,0.55)'  : 'rgba(13,31,18,0.55)'
  const ctaBg         = tone === 'dark' ? 'rgba(255,253,248,0.10)'  : 'var(--tm-green-muted)'
  const ctaBorder     = tone === 'dark' ? 'rgba(245,215,138,0.30)'  : 'rgba(27,94,59,0.20)'
  const ctaColor      = tone === 'dark' ? '#F5D78A'                 : 'var(--tm-green-text)'

  return (
    <div style={{
      padding: '36px 28px 32px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
      textAlign: 'center',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: tone === 'dark'
          ? 'rgba(255,253,248,0.06)'
          : 'rgba(27,94,59,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: tone === 'dark'
          ? '1px solid rgba(245,215,138,0.18)'
          : '1px solid rgba(27,94,59,0.10)',
      }}>
        <Icon tone={tone} />
      </div>
      {title && (
        <div style={{
          color: titleColor, fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em',
        }}>{title}</div>
      )}
      {subtitle && (
        <div style={{
          color: subtitleColor, fontSize: 13, lineHeight: 1.55,
          maxWidth: 280,
        }}>{subtitle}</div>
      )}
      {ctaLabel && onCta && (
        <button onClick={onCta} style={{
          marginTop: 6,
          padding: '10px 20px', borderRadius: 999,
          background: ctaBg, color: ctaColor,
          border: `1px solid ${ctaBorder}`,
          fontWeight: 700, fontSize: 13,
          cursor: 'pointer',
        }}>{ctaLabel}</button>
      )}
    </div>
  )
}
