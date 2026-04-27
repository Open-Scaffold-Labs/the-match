export default function Button({ children, onClick, variant = 'primary', size = 'md', disabled, full, style }) {
  const base = {
    border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, fontWeight: 600, letterSpacing: '0.01em',
    borderRadius: 'var(--tm-radius)',
    WebkitTapHighlightColor: 'transparent',
    width: full ? '100%' : undefined,
    opacity: disabled ? 0.5 : 1,
    transition: 'transform 120ms ease, opacity 120ms ease',
    ...style,
  }

  const sizes = {
    sm: { fontSize: 13, padding: '8px 16px', height: 36 },
    md: { fontSize: 15, padding: '12px 24px', height: 48 },
    lg: { fontSize: 17, padding: '14px 28px', height: 56 },
  }

  const variants = {
    primary: {
      background: 'linear-gradient(135deg, var(--tm-green-bright), var(--tm-green))',
      color: 'var(--tm-text)',
      boxShadow: 'var(--tm-glow-green)',
    },
    gold: {
      background: 'linear-gradient(135deg, var(--tm-gold-bright), var(--tm-gold))',
      color: 'var(--tm-text-inv)',
      boxShadow: 'var(--tm-glow-gold)',
    },
    ghost: {
      background: 'var(--tm-surface-2)',
      color: 'var(--tm-text-2)',
      border: '1px solid var(--tm-border-2)',
      boxShadow: 'none',
    },
    danger: {
      background: 'linear-gradient(135deg, #E05252, #B03A3A)',
      color: '#fff',
      boxShadow: '0 0 16px rgba(224,82,82,0.3)',
    },
  }

  return (
    <button
      onClick={disabled ? undefined : onClick}
      className="touch-press"
      style={{ ...base, ...sizes[size], ...variants[variant] }}
    >
      {children}
    </button>
  )
}
