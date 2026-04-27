export default function Card({ children, style, onClick, glow }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--tm-surface)',
        border: '1px solid var(--tm-border)',
        borderRadius: 'var(--tm-radius-lg)',
        padding: '16px',
        boxShadow: glow === 'gold' ? 'var(--tm-glow-gold)' :
                   glow === 'green' ? 'var(--tm-glow-green)' :
                   'var(--tm-shadow)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform var(--tm-duration-fast) var(--tm-ease), opacity var(--tm-duration-fast) var(--tm-ease)',
        ...(onClick ? { WebkitTapHighlightColor: 'transparent' } : {}),
        ...style,
      }}
      className={onClick ? 'touch-press' : ''}
    >
      {children}
    </div>
  )
}

export function CardRow({ label, value, valueStyle }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
      <span style={{ color: 'var(--tm-text-3)', fontSize: 14 }}>{label}</span>
      <span style={{ color: 'var(--tm-text)', fontWeight: 600, fontSize: 14, ...valueStyle }}>{value}</span>
    </div>
  )
}
