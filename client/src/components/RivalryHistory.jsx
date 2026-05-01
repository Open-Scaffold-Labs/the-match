// RivalryHistory — bottom-sheet modal listing every rivalry the
// "subject" user has on their head-to-head record. Reached from the
// "See all N rivalries" button beneath the inline top-3 preview on the
// Profile / FriendProfile screens.
//
// Each row uses the same dark row styling as the inline list and is
// tappable to open the animated RivalryDetail face-off modal on top.
// The detail stacks via its own document.body portal, so closing it
// returns here.
//
// "Subject" is the user whose rivalries these are:
//   • On My Profile → Matt himself.
//   • On a friend's profile → the friend.
// The detail modal uses the subject as one side of the face-off and
// the rivalry's opponent as the other.
//
// (2026-05-01 — mirrors RoundHistory pattern)

import { useState } from 'react'
import { createPortal } from 'react-dom'
import RivalryDetail from './RivalryDetail.jsx'

export default function RivalryHistory({
  rivalries = [],
  title = 'Rivalries',
  // The user whose rivalries these are (used as the "you" side of the
  // RivalryDetail face-off when the user taps a row).
  subjectName,
  subjectAvatar,
  subjectHandicap,
  // Label for the subject's avg in each row (e.g. "You" on My Profile,
  // first name on a friend profile).
  selfLabel = 'You',
  oppLabel  = 'Them',
  onClose,
}) {
  const [selected, setSelected] = useState(null)

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 430,
          maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(180deg, #0E1F13 0%, #070C09 100%)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: '20px 20px 0 0',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)', margin: '12px auto 8px' }} />

        {/* Header */}
        <div style={{
          padding: '4px 18px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>
              {title}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>
              {rivalries.length} {rivalries.length === 1 ? 'rival' : 'rivals'}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8, color: 'rgba(255,255,255,0.65)', fontSize: 18,
            cursor: 'pointer', padding: '4px 10px', lineHeight: 1, height: 32,
            fontFamily: 'inherit',
          }}>✕</button>
        </div>

        {/* Body — scrollable list */}
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', flex: 1 }}>
          {rivalries.length === 0 && (
            <div style={{ padding: '32px 24px', textAlign: 'center', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
              No rivalries yet. Play a match against a friend and the
              head-to-head record will start showing up here.
            </div>
          )}
          {rivalries.map((r, i) => {
            const myWins   = Number(r.my_wins  ?? 0)
            const oppWins  = Number(r.opp_wins ?? 0)
            const ties     = Number(r.ties     ?? 0)
            const myAvg    = r.my_avg  != null ? Number(r.my_avg)  : null
            const oppAvg   = r.opp_avg != null ? Number(r.opp_avg) : null
            const myAvgStr  = Number.isFinite(myAvg)  ? myAvg.toFixed(1)  : '—'
            const oppAvgStr = Number.isFinite(oppAvg) ? oppAvg.toFixed(1) : '—'
            const initials = (r.opponent_name || '·').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
            const recordStr = ties > 0 ? `${myWins}-${oppWins}-${ties}` : `${myWins}-${oppWins}`
            const recordColor = myWins > oppWins ? '#4ADE80'
              : oppWins > myWins ? '#F87171'
              : 'rgba(255,255,255,0.50)'
            return (
              <button
                key={r.opponent_id ?? i}
                onClick={() => setSelected(r)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 18px',
                  borderBottom: i < rivalries.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  background: 'transparent', border: 'none', textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background 120ms ease',
                }}
                onMouseDown={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseUp={e => { e.currentTarget.style.background = 'transparent' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                  background: r.opponent_avatar ? 'transparent' : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {r.opponent_avatar ? (
                    <img src={r.opponent_avatar} alt={r.opponent_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#F5D78A' }}>{initials}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.opponent_name || 'Player'}
                  </div>
                  <div style={{
                    fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span>{selfLabel} <strong style={{ color: '#fff' }}>{myAvgStr}</strong></span>
                    <span style={{ color: 'rgba(255,255,255,0.20)' }}>·</span>
                    <span>{oppLabel} <strong style={{ color: '#fff' }}>{oppAvgStr}</strong></span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: 18, fontWeight: 900, color: recordColor, lineHeight: 1,
                      fontFamily: '"Arial Black", Arial, sans-serif',
                    }}>{recordStr}</div>
                    <div style={{
                      fontSize: 9, color: 'rgba(255,255,255,0.30)',
                      letterSpacing: '0.10em', marginTop: 4, fontWeight: 700,
                    }}>{ties > 0 ? 'W-L-T' : 'W-L'}</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* RivalryDetail stacks on top via its own document.body portal. */}
      {selected && (
        <RivalryDetail
          rivalry={selected}
          myName={subjectName}
          myAvatar={subjectAvatar}
          myHandicap={subjectHandicap}
          onClose={() => setSelected(null)}
        />
      )}
    </div>,
    document.body
  )
}
