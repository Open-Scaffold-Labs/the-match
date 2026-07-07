// Shared putt-fact capture chips (2026-07-06 — live-putt-capture spec).
// ONE component for the solo scorer AND the live-outing self-score modal so
// the two can never drift visually (the disease the EE tokenization cured).
// Markup/styling extracted byte-for-byte from SoloScoreModal (SG v2, PR #1).
//
// Controlled: parent owns puttVal/firstPutt state; the integrity rule
// (count ≤ score) is applied by the parent at save time, and again
// server-side (lib/puttFacts). Optional-always — never gates a score.

export const PUTT_BUCKETS = [
  { key: 'in3',    label: '<3 ft' },
  { key: '3-10',   label: '3–10' },
  { key: '10-25',  label: '10–25' },
  { key: '25plus', label: '25+ ft' },
]

export default function PuttChips({ puttVal, setPuttVal, firstPutt, setFirstPutt }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--tm-text-3)', textAlign: 'center', marginBottom: 8 }}>
        PUTTS <span style={{ fontWeight: 500, letterSpacing: 0 }}>(optional — unlocks strokes gained)</span>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {[0, 1, 2, 3, 4].map(n => (
          <button key={n} onClick={() => { setPuttVal(p => p === n ? null : n); if (n === 0) setFirstPutt(null) }}
            style={{
              width: 40, height: 34, borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer',
              background: puttVal === n ? 'var(--tm-gold-muted)' : 'var(--tm-surface-2)',
              border: puttVal === n ? '1.5px solid var(--tm-gold-dim)' : '1px solid var(--tm-border)',
              color: puttVal === n ? 'var(--tm-gold-text)' : 'var(--tm-text-3)',
            }}>{n === 4 ? '4+' : n}</button>
        ))}
      </div>
      {puttVal != null && puttVal > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--tm-text-3)', textAlign: 'center', marginBottom: 6 }}>
            First putt from…
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {PUTT_BUCKETS.map(b => (
              <button key={b.key} onClick={() => setFirstPutt(f => f === b.key ? null : b.key)}
                style={{
                  padding: '7px 12px', borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: firstPutt === b.key ? 'var(--tm-gold-muted)' : 'var(--tm-surface-2)',
                  border: firstPutt === b.key ? '1.5px solid var(--tm-gold-dim)' : '1px solid var(--tm-border)',
                  color: firstPutt === b.key ? 'var(--tm-gold-text)' : 'var(--tm-text-3)',
                }}>{b.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
