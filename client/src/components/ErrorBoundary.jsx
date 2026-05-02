import { Component } from 'react'

// Top-level error boundary. Without this, any uncaught component error blanks
// out the whole app. Now we show a friendly fallback with a Reload button +
// the error message (so users can screenshot it for support). Wired in
// main.jsx around <App />. Audit finding B11 / 2026-04-29.
export default class ErrorBoundary extends Component {
  state = { hasError: false, message: '' }

  static getDerivedStateFromError(err) {
    return { hasError: true, message: err?.message || 'Unknown error' }
  }

  componentDidCatch(err, info) {
    // Future: ship to monitoring (Sentry, Vercel logs). For now, log locally.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', err, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '0 32px',
        background: '#070C09', color: '#E8C05A', textAlign: 'center', gap: 16,
      }}>
        {/* Bespoke pin-flag glyph — high-quality replacement for ⛳.
            Hand-drawn at 64px so it reads like an icon, not an emoji. */}
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="#E8C05A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="8" x2="22" y2="54"/>
          <path d="M22 10 L52 17 L22 24 Z" fill="#E8C05A" stroke="#E8C05A"/>
          <ellipse cx="22" cy="56" rx="6" ry="2" fill="#E8C05A" stroke="none" opacity="0.4"/>
        </svg>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Hooked left.</div>
        <div style={{ color: 'rgba(232,192,90,0.7)', fontSize: 14, lineHeight: 1.5, maxWidth: 320 }}>
          Something broke. Try reloading the page. If it keeps happening, jot down the error below and shoot it our way.
        </div>
        <div style={{
          marginTop: 8, padding: '10px 14px', borderRadius: 8,
          background: 'rgba(255,255,255,0.06)',
          color: 'rgba(255,255,255,0.55)',
          fontSize: 11, fontFamily: 'ui-monospace, monospace',
          maxWidth: 320, wordBreak: 'break-word',
        }}>
          {this.state.message}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8, background: '#C9A040', color: '#0D1F12',
            border: 'none', padding: '10px 28px', borderRadius: 10,
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    )
  }
}
