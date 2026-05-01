// RivalryDetail — animated head-to-head face-off modal.
//
// Opened from the Rivalries card on a profile (own or friend's) by
// tapping a rivalry row. Shows both players' photos + names side-by-
// side with a glowing "VS" between them, the W-L-T record below, and
// their head-to-head avg scores.
//
// Entrance is staggered for impact:
//   • Backdrop fades in (220ms)
//   • Card pops in with overshoot scale (0.85 → 1.04 → 1.0)
//   • Inside the card: avatars fade-up (220ms), names fade in (320ms),
//     VS letterforms clash zoom (440ms), W-L-T record + avg scores
//     fade-up (560-700ms).
// Exit is a faster reverse (150ms scale-out + opacity).
//
// (2026-05-01 — Matt: pop-up animation for rivalry detail)

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function avatarBg(name = '') {
  // Deterministic palette — same trick PlayerAvatar uses elsewhere
  const palette = ['#1B5E3B', '#0D47A1', '#6A1B9A', '#B71C1C', '#37474F', '#5D4037']
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

function initials(name = '') {
  return name.split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

function dateLabel(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}

export default function RivalryDetail({
  rivalry,             // { opponent_id, opponent_name, opponent_avatar, opponent_handicap, my_wins, opp_wins, ties, my_avg, opp_avg, last_played }
  myName,
  myAvatar,
  myHandicap,
  // Optional: when provided, the opponent avatar becomes tappable. Fires
  // with { id, name, avatar } so the parent can route to that user's
  // profile. Subject ("me") side is intentionally non-tappable since you
  // are already viewing that profile. (2026-05-01 — Matt: tap a face in
  // the H2H popup to open that player's profile.)
  onSelectOpponent,
  onClose,
}) {
  // Drive a "closing" state so we can reverse the animation before
  // unmounting — gives the exit a satisfying fade-out instead of a
  // hard removal.
  const [closing, setClosing] = useState(false)
  function handleClose() {
    setClosing(true)
    setTimeout(onClose, 180)
  }
  function handleOpponentTap() {
    if (!onSelectOpponent) return
    // Close the modal first so the route change feels clean — the parent
    // gets the callback after the exit animation flushes.
    setClosing(true)
    setTimeout(() => {
      onSelectOpponent({
        id:     rivalry.opponent_id,
        name:   rivalry.opponent_name,
        avatar: rivalry.opponent_avatar,
      })
      onClose?.()
    }, 180)
  }

  // Close on Escape for desktop / hardware keyboards
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!rivalry) return null

  const myWins   = Number(rivalry.my_wins  ?? 0)
  const oppWins  = Number(rivalry.opp_wins ?? 0)
  const tieCount = Number(rivalry.ties     ?? 0)
  const total    = myWins + oppWins + tieCount

  const myAvg    = rivalry.my_avg  != null ? Number(rivalry.my_avg)  : null
  const oppAvg   = rivalry.opp_avg != null ? Number(rivalry.opp_avg) : null

  // Color the leader's side. Tie or no record → neutral on both.
  const meLeading  = total > 0 && myWins  > oppWins
  const oppLeading = total > 0 && oppWins > myWins
  const meColor    = meLeading  ? '#4ADE80' : oppLeading ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)'
  const oppColor   = oppLeading ? '#4ADE80' : meLeading  ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)'

  // Avg score winner (lower is better in golf)
  const avgWinner  = (myAvg != null && oppAvg != null)
    ? (myAvg < oppAvg ? 'me' : oppAvg < myAvg ? 'opp' : 'tie')
    : null

  return createPortal(
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: closing ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.78)',
        backdropFilter: closing ? 'blur(0px)' : 'blur(8px)',
        WebkitBackdropFilter: closing ? 'blur(0px)' : 'blur(8px)',
        transition: 'background 180ms ease, backdrop-filter 180ms ease',
        padding: 16,
      }}
    >
      {/* Inline keyframes — keeps the component self-contained. */}
      <style>{`
        @keyframes rd-pop-in {
          0%   { opacity: 0; transform: scale(0.85); }
          60%  { opacity: 1; transform: scale(1.04); }
          100% { opacity: 1; transform: scale(1.00); }
        }
        @keyframes rd-pop-out {
          0%   { opacity: 1; transform: scale(1.00); }
          100% { opacity: 0; transform: scale(0.92); }
        }
        @keyframes rd-fade-up {
          0%   { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes rd-vs-clash {
          0%   { opacity: 0; transform: scale(2.4); letter-spacing: 0.4em; filter: drop-shadow(0 0 0 transparent); }
          55%  { opacity: 1; transform: scale(0.92); letter-spacing: 0.04em; filter: drop-shadow(0 0 14px rgba(245,215,138,0.85)); }
          100% { opacity: 1; transform: scale(1.0); letter-spacing: 0.06em; filter: drop-shadow(0 0 8px rgba(245,215,138,0.55)); }
        }
        @keyframes rd-vs-pulse {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(245,215,138,0.55)); }
          50%      { filter: drop-shadow(0 0 14px rgba(245,215,138,0.95)); }
        }
        .rd-card        { animation: ${closing ? 'rd-pop-out 180ms ease forwards' : 'rd-pop-in 360ms cubic-bezier(0.34,1.56,0.64,1) both'}; }
        .rd-stagger-1   { animation: rd-fade-up 320ms ease both; animation-delay: 180ms; }
        .rd-stagger-2   { animation: rd-fade-up 320ms ease both; animation-delay: 280ms; }
        .rd-stagger-vs  { animation: rd-vs-clash 540ms cubic-bezier(0.34,1.56,0.64,1) both, rd-vs-pulse 2200ms ease 540ms infinite; }
        .rd-stagger-3   { animation: rd-fade-up 320ms ease both; animation-delay: 480ms; }
        .rd-stagger-4   { animation: rd-fade-up 320ms ease both; animation-delay: 580ms; }
        .rd-stagger-5   { animation: rd-fade-up 320ms ease both; animation-delay: 700ms; }
      `}</style>

      <div
        className="rd-card"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380,
          borderRadius: 22,
          background: 'linear-gradient(160deg, #0F2814 0%, #0A1D0F 50%, #060E08 100%)',
          border: '1px solid rgba(245,215,138,0.25)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.55), 0 0 60px rgba(197,160,64,0.10), inset 0 1px 0 rgba(245,215,138,0.10)',
          padding: '22px 22px 24px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Top gold rule */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent, rgba(245,215,138,0.65), transparent)',
        }} />

        {/* Close ✕ */}
        <button
          onClick={handleClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 10, right: 10,
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.65)',
            fontSize: 14, lineHeight: 1, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit',
          }}
        >✕</button>

        {/* "RIVALRY" label */}
        <div className="rd-stagger-1" style={{
          textAlign: 'center',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.30em',
          color: 'rgba(245,215,138,0.65)',
          marginBottom: 18,
        }}>RIVALRY</div>

        {/* Two faces + VS */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center', gap: 12,
          marginBottom: 18,
        }}>
          {/* Me */}
          <div className="rd-stagger-1" style={{ textAlign: 'center' }}>
            <PlayerAvatarBig name={myName} avatar={myAvatar} ring={meLeading ? '#4ADE80' : 'rgba(245,215,138,0.45)'} />
            <div className="rd-stagger-2" style={{
              marginTop: 10, fontSize: 13, fontWeight: 800, color: '#fff',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{myName?.split(' ')[0] || 'You'}</div>
            {myHandicap != null && (
              <div className="rd-stagger-2" style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>
                {Number(myHandicap) >= 0 ? Number(myHandicap).toFixed(1) : `+${Math.abs(Number(myHandicap)).toFixed(1)}`} hcp
              </div>
            )}
          </div>

          {/* VS */}
          <div className="rd-stagger-vs" style={{
            fontSize: 28, fontWeight: 900,
            background: 'linear-gradient(180deg, #F5E070, #C9A040)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            fontFamily: '"Arial Black", Arial, sans-serif',
            letterSpacing: '0.06em',
          }}>VS</div>

          {/* Opponent — tappable when onSelectOpponent is wired so the
              user can jump straight to that player's profile. */}
          <button
            type="button"
            onClick={onSelectOpponent ? handleOpponentTap : undefined}
            disabled={!onSelectOpponent}
            className="rd-stagger-1"
            aria-label={onSelectOpponent ? `Open ${rivalry.opponent_name || 'player'}'s profile` : undefined}
            style={{
              textAlign: 'center',
              background: 'transparent', border: 'none', padding: 0,
              cursor: onSelectOpponent ? 'pointer' : 'default',
              fontFamily: 'inherit',
              borderRadius: 12,
              transition: 'transform 120ms ease',
            }}
            onMouseDown={e => { if (onSelectOpponent) e.currentTarget.style.transform = 'scale(0.96)' }}
            onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
            onTouchStart={e => { if (onSelectOpponent) e.currentTarget.style.transform = 'scale(0.96)' }}
            onTouchEnd={e => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            <PlayerAvatarBig name={rivalry.opponent_name} avatar={rivalry.opponent_avatar} ring={oppLeading ? '#4ADE80' : 'rgba(245,215,138,0.45)'} />
            <div className="rd-stagger-2" style={{
              marginTop: 10, fontSize: 13, fontWeight: 800, color: '#fff',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{rivalry.opponent_name?.split(' ')[0] || 'Opp'}</div>
            {rivalry.opponent_handicap != null && (
              <div className="rd-stagger-2" style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>
                {Number(rivalry.opponent_handicap) >= 0
                  ? Number(rivalry.opponent_handicap).toFixed(1)
                  : `+${Math.abs(Number(rivalry.opponent_handicap)).toFixed(1)}`} hcp
              </div>
            )}
            {onSelectOpponent && (
              <div className="rd-stagger-2" style={{
                marginTop: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
                color: 'rgba(245,215,138,0.55)',
              }}>VIEW PROFILE ›</div>
            )}
          </button>
        </div>

        {/* W-L-T record — big numbers, color-coded by lead */}
        <div className="rd-stagger-3" style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8, marginBottom: 14,
          padding: '14px 8px', borderRadius: 14,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}>
          <RecordCell label="WINS"   value={myWins}  color={meColor} />
          <RecordCell label="TIES"   value={tieCount} color="rgba(255,255,255,0.55)" />
          <RecordCell label="LOSSES" value={oppWins} color={oppColor} />
        </div>

        {/* Avg scores side-by-side */}
        <div className="rd-stagger-4" style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
          marginBottom: 14,
        }}>
          <AvgCell label={`${myName?.split(' ')[0] || 'You'} avg`} value={myAvg}
            highlight={avgWinner === 'me'} />
          <AvgCell label={`${rivalry.opponent_name?.split(' ')[0] || 'Opp'} avg`} value={oppAvg}
            highlight={avgWinner === 'opp'} />
        </div>

        {/* Last played + total */}
        <div className="rd-stagger-5" style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: 11, color: 'rgba(255,255,255,0.40)',
          paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span>{total === 0 ? 'No matches yet' : `${total} match${total === 1 ? '' : 'es'} played`}</span>
          <span>{rivalry.last_played ? `Last · ${dateLabel(rivalry.last_played)}` : ''}</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

function PlayerAvatarBig({ name, avatar, ring }) {
  return (
    <div style={{
      width: 80, height: 80, margin: '0 auto', borderRadius: '50%',
      background: avatar ? 'transparent' : avatarBg(name || ''),
      border: `2px solid ${ring}`,
      boxShadow: `0 0 24px ${ring === '#4ADE80' ? 'rgba(74,222,128,0.30)' : 'rgba(245,215,138,0.20)'}`,
      overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {avatar ? (
        <img src={avatar} alt={name || ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 18%' }} />
      ) : (
        <span style={{
          fontSize: 26, fontWeight: 900, color: '#fff',
          fontFamily: '"Arial Black", Arial, sans-serif',
          letterSpacing: 0,
        }}>{initials(name || '') || '·'}</span>
      )}
    </div>
  )
}

function RecordCell({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: 26, fontWeight: 900, color, lineHeight: 1,
        fontFamily: '"Arial Black", Arial, sans-serif', letterSpacing: '-0.02em',
      }}>{value}</div>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
        color: 'rgba(255,255,255,0.40)', marginTop: 5,
      }}>{label}</div>
    </div>
  )
}

function AvgCell({ label, value, highlight }) {
  const display = (value == null || !Number.isFinite(Number(value)))
    ? '—'
    : Number(value).toFixed(1)
  return (
    <div style={{
      textAlign: 'center', padding: '12px 8px',
      borderRadius: 10,
      background: highlight ? 'rgba(245,215,138,0.10)' : 'rgba(255,255,255,0.03)',
      border: highlight ? '1px solid rgba(245,215,138,0.40)' : '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{
        fontSize: 22, fontWeight: 900, lineHeight: 1,
        color: highlight ? '#F5E070' : '#fff',
        fontFamily: '"Arial Black", Arial, sans-serif', letterSpacing: '-0.02em',
      }}>{display}</div>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
        color: 'rgba(255,255,255,0.45)', marginTop: 5,
      }}>{label.toUpperCase()}</div>
    </div>
  )
}
