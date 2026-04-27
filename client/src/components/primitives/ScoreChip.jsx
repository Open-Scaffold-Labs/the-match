// Renders a golf score with the correct color/shape
// toPar: number (negative = under, 0 = par, positive = over)
// label: display text (e.g. "-2", "E", "+1")
export default function ScoreChip({ toPar, label, size = 'md' }) {
  const getStyle = () => {
    if (toPar <= -2) return {
      bg: 'var(--tm-eagle)', color: '#000',
      shape: 'circle', label: label ?? toPar,
    }
    if (toPar === -1) return {
      bg: 'var(--tm-birdie)', color: '#fff',
      shape: 'circle', label: label ?? '-1',
    }
    if (toPar === 0) return {
      bg: 'var(--tm-surface-3)', color: 'var(--tm-par)',
      shape: 'square', label: label ?? 'E',
    }
    if (toPar === 1) return {
      bg: 'var(--tm-bogey)', color: '#fff',
      shape: 'square', label: label ?? '+1',
    }
    return {
      bg: 'var(--tm-double)', color: '#fff',
      shape: 'double', label: label ?? `+${toPar}`,
    }
  }

  const { bg, color, shape, label: lbl } = getStyle()
  const dim = size === 'sm' ? 28 : size === 'lg' ? 44 : 36

  return (
    <div style={{
      width: dim, height: dim,
      borderRadius: shape === 'circle' ? '50%' : shape === 'double' ? 4 : 6,
      background: bg,
      color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size === 'sm' ? 11 : size === 'lg' ? 16 : 13,
      fontWeight: 700,
      outline: shape === 'double' ? `2px solid ${bg}` : 'none',
      outlineOffset: 2,
      boxShadow: toPar <= -2
        ? '0 0 12px rgba(255,215,0,0.6)'
        : toPar === -1
        ? '0 0 10px rgba(74,158,219,0.4)'
        : 'none',
    }}>
      {lbl}
    </div>
  )
}
