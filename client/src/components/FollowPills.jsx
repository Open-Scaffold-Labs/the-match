// FollowPills — three live-count pills (Following / Followers / Mutuals)
// shown in the Profile view header and on the Home dashboard's
// ProfileHeroCard. Tapping a pill opens the FollowList overlay
// for that bucket. Counts come from /api/follows/counts and are
// passed in by the parent (so multiple consumers share one fetch).
//
// `size` controls scale:
//   'sm' — used inline on the Home dashboard (compact)
//   'lg' — used on the dedicated Profile view (larger)
//
// (2026-05-01 — follow Phase 1)

import { useState } from 'react'
import FollowList from './FollowList.jsx'

export default function FollowPills({ counts, size = 'lg', onCountsChange }) {
  // Which list overlay is open (if any). null = closed.
  const [openType, setOpenType] = useState(null)

  const isLg = size === 'lg'
  const pills = [
    { key: 'following', label: 'Following', value: counts?.following ?? 0 },
    { key: 'followers', label: 'Followers', value: counts?.followers ?? 0 },
    { key: 'mutuals',   label: 'Mutuals',   value: counts?.mutuals   ?? 0 },
  ]

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: isLg ? 8 : 6,
      }}>
        {pills.map(p => (
          <button
            key={p.key}
            onClick={() => setOpenType(p.key)}
            style={{
              background: 'rgba(255,255,255,0.55)',
              border: '1px solid rgba(27,94,59,0.18)',
              borderRadius: 12,
              padding: isLg ? '10px 8px' : '7px 6px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              transition: 'background 120ms ease, transform 120ms ease',
            }}
            onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)' }}
            onMouseUp={e => { e.currentTarget.style.transform = '' }}
            onMouseLeave={e => { e.currentTarget.style.transform = '' }}
          >
            <div style={{
              fontSize: isLg ? 22 : 18,
              fontWeight: 900,
              color: '#0D1F12',
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}>{p.value}</div>
            <div style={{
              fontSize: isLg ? 9 : 8,
              color: 'rgba(13,31,18,0.50)',
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
            }}>{p.label}</div>
          </button>
        ))}
      </div>

      {openType && (
        <FollowList
          type={openType}
          onClose={() => setOpenType(null)}
          // Bubble count changes back up so headers stay live when the
          // user follows / unfollows from inside the list.
          onCountsChange={onCountsChange}
        />
      )}
    </>
  )
}
