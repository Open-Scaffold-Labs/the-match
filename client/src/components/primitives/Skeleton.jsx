// Skeleton — a shimmer-animated placeholder block. Shown in place of
// real content while data loads, so the page maintains its layout
// rhythm instead of collapsing to a generic "Loading…" message and
// then re-flowing once data arrives. Replaces 'Loading…' text in
// every place a fixed-shape thing is loading.
//
// Usage:
//   <Skeleton width="60%" height={14} />
//   <Skeleton width={48} height={48} radius="50%" />     // avatar
//   <Skeleton style={{ marginBottom: 8 }} />              // single line
//
// Compose multiples to mirror the layout of the real content. The
// goal is for the skeleton's shape to predict what the user is about
// to see — so when the data arrives, the page doesn't "jump."
//
// (2026-05-06 — Matt: replace generic Loading… with skeletons.)

export default function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  style = {},
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        width, height, borderRadius: radius,
        background: 'rgba(13,31,18,0.07)',
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        ...style,
      }}>
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,253,248,0.55) 50%, transparent 100%)',
          animation: 'tm-shimmer 1.4s ease-in-out infinite',
        }}
      />
    </div>
  )
}

// Pre-built compositions for common layouts. Encourages consistent
// skeleton shapes across screens rather than each consumer rolling
// their own. (2026-05-06)

// A row that mirrors a list-item with avatar + 2 lines of text. Used
// by FollowList, FriendsLiveCard list, recent-rounds list, etc.
export function SkeletonRow({ avatarSize = 36, lines = 2 }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 14px',
      background: 'rgba(255,253,248,0.55)',
      border: '1px solid rgba(46,158,69,0.18)',
      borderRadius: 12,
      marginBottom: 8,
    }}>
      <Skeleton width={avatarSize} height={avatarSize} radius="50%" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width="55%" height={13} />
        {lines > 1 && <Skeleton width="78%" height={11} />}
      </div>
    </div>
  )
}

// A card that mirrors a stat tile (LiveMatchCard / FriendsLiveCard).
// Used in OutingHub's Live Now strip during initial load.
export function SkeletonCard({ height = 78 }) {
  return (
    <div style={{
      width: '100%', height,
      background: 'rgba(255,253,248,0.55)',
      border: '1px solid rgba(46,158,69,0.20)',
      borderRadius: 12,
      padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
      marginBottom: 8,
    }}>
      <Skeleton width={36} height={36} radius="50%" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="80%" height={11} />
      </div>
      <Skeleton width={48} height={28} radius={8} />
    </div>
  )
}
