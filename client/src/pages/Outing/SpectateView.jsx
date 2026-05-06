import PublicLeaderboard from '../PublicLeaderboard.jsx'

// ─── Spectate View (in-app wrapper around PublicLeaderboard) ──────────────
// Renders the same spectator board as the public ?live=CODE URL, but
// inside the Match tab's nav shell with a back chevron. Reused by the
// Friends-playing-now feed so signed-in users stay in the app instead
// of being kicked to the public-URL surface.
// (2026-05-04 — Matt: live-scores feed for friends.)
export default function SpectateView({ code, onBack }) {
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <button
        onClick={onBack}
        aria-label="Back"
        style={{
          position: 'absolute', top: 12, left: 12, zIndex: 10,
          width: 36, height: 36, borderRadius: 18,
          background: 'rgba(255,253,248,0.92)',
          border: '1px solid rgba(46,158,69,0.30)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="#1A6B28" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <PublicLeaderboard code={code} />
    </div>
  )
}
