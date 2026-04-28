// Premium SVG icon library for The Match
// All icons are 24x24 viewBox, stroke-based, clean geometric

export function IconHome({ size = 24, color = 'currentColor', strokeWidth = 1.6 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12L12 3l9 9" />
      <path d="M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
    </svg>
  )
}

export function IconTrophy({ size = 24, color = 'currentColor', strokeWidth = 1.6 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4H4a1 1 0 00-1 1v2a4 4 0 004 4h1" />
      <path d="M17 4h3a1 1 0 011 1v2a4 4 0 01-4 4h-1" />
      <path d="M7 4h10v7a5 5 0 01-10 0V4z" />
    </svg>
  )
}

export function IconEye({ size = 24, color = 'currentColor', strokeWidth = 1.6 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
    </svg>
  )
}

export function IconFlag({ size = 24, color = 'currentColor', strokeWidth = 1.6 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="22" x2="4" y2="2" />
      <path d="M4 15s2-2 6-2 6 2 10 2V4S18 2 14 2 10 4 4 4v11z" />
    </svg>
  )
}

export function IconBarChart({ size = 24, color = 'currentColor', strokeWidth = 1.6 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="6" y1="20" x2="6" y2="4" />
      <line x1="18" y1="20" x2="18" y2="14" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  )
}

export function IconPlus({ size = 24, color = 'currentColor', strokeWidth = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function IconChevronRight({ size = 20, color = 'currentColor', strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export function IconTarget({ size = 24, color = 'currentColor', strokeWidth = 1.6 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  )
}

export function IconTour({ size = 24, color = 'currentColor', strokeWidth = 1.6 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="10" x2="14" y2="10" />
      <line x1="4" y1="14" x2="16" y2="14" />
      <line x1="4" y1="18" x2="11" y2="18" />
      <circle cx="19" cy="16" r="3" />
      <line x1="21.5" y1="18.5" x2="23" y2="20" />
    </svg>
  )
}

// The Match emblem — TM monogram in a circle
export function TMEmblem({ size = 48, gold = false }) {
  const accent = gold ? '#E8C05A' : '#5ED47A'
  const ring   = gold ? 'rgba(232,192,90,0.25)' : 'rgba(94,212,122,0.2)'
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22" stroke={accent} strokeWidth="1.5" opacity="0.6" />
      <circle cx="24" cy="24" r="18" stroke={ring} strokeWidth="8" fill="none" />
      {/* Flag on green */}
      <line x1="20" y1="34" x2="20" y2="16" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 16 L32 20 L20 24 Z" fill={accent} opacity="0.9" />
      <ellipse cx="24" cy="34" rx="8" ry="2" fill={accent} opacity="0.15" />
    </svg>
  )
}
