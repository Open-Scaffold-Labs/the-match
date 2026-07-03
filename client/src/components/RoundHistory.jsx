// RoundHistory — bottom-sheet modal listing every round in the user's
// (or friend's) history. Reached from the Profile / FriendProfile
// "See all N rounds" button below the truncated 3-row preview.
//
// Each row uses the same dark-theme styling as the inline list and is
// tappable to open the RoundScorecard modal on top. The scorecard
// stacks via its own document.body portal so closing it returns here.
//
// (2026-05-01 — Matt: cap inline list to 3, full history behind a tap)

import { useState } from 'react'
import { createPortal } from 'react-dom'
import RoundScorecard from './RoundScorecard.jsx'
import EmptyState from './primitives/EmptyState.jsx'

export default function RoundHistory({ rounds = [], title = 'Recent Rounds', onClose, onOpenFriend, canEditPutts = false }) {
  const [selectedRoundId, setSelectedRoundId] = useState(null)

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
              {rounds.length} round{rounds.length === 1 ? '' : 's'}
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
          {rounds.length === 0 && (
            <EmptyState
              icon="scorecard"
              tone="dark"
              title="Your scorecard's blank."
              subtitle="Tee it up — log a solo round or join a match and your history starts here."
            />
          )}
          {rounds.map((r, i) => {
            const sc  = Number(r.score ?? r.total)
            const par = Number(r.course_par)
            const hasDiff = Number.isFinite(sc) && Number.isFinite(par)
            const diff = hasDiff ? sc - par : null
            const diffColor = diff == null ? '#fff'
              : diff < 0 ? '#F5D78A'
              : diff === 0 ? '#4ADE80'
              : '#F87171'
            return (
              <button
                key={r.id ?? i}
                onClick={() => r.id != null && setSelectedRoundId(r.id)}
                disabled={r.id == null}
                style={{
                  width: '100%',
                  background: 'transparent', border: 'none', textAlign: 'left',
                  cursor: r.id != null ? 'pointer' : 'default',
                  padding: '14px 18px',
                  borderBottom: i < rounds.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  fontFamily: 'inherit',
                  transition: 'background 120ms ease',
                }}
                onMouseDown={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                onMouseUp={e => { e.currentTarget.style.background = 'transparent' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontWeight: 600, color: '#fff', fontSize: 14,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{r.course_name ?? 'Round'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {r.played_at ? new Date(r.played_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                    {r.holes ? ` · ${r.holes} holes` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    {diff != null && (
                      <div style={{ fontSize: 22, fontWeight: 900, color: diffColor, lineHeight: 1 }}>
                        {diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', marginTop: 3 }}>
                      {Number.isFinite(sc) ? `${sc} strokes` : '—'}
                    </div>
                  </div>
                  {r.id != null && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* RoundScorecard stacks on top via its own document.body portal. */}
      {selectedRoundId != null && (
        <RoundScorecard
          roundId={selectedRoundId}
          canEditPutts={canEditPutts}
          onClose={() => setSelectedRoundId(null)}
          // Tap a co-participant inside the scorecard → close the
          // scorecard, then bubble up so the parent (Home / FriendProfile)
          // can navigate to that user's profile. (2026-05-07 PM3.)
          onOpenFriend={onOpenFriend ? (opp) => {
            setSelectedRoundId(null)
            onOpenFriend(opp)
          } : undefined}
        />
      )}
    </div>,
    document.body
  )
}
