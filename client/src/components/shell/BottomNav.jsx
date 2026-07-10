import { TABS } from '../../constants.js'
import { IconHome, IconUser, IconTarget, IconScorecard, IconTour } from '../primitives/Icons.jsx'

// 2026-07-09 — Phase 0 nav restructure (start-match-unified-flow plan):
// Home · Match · ▶Play · Profile · Tour.
//   - OUTING relabeled 'Scorecard' → 'Match' (it hosts the whole matches
//     hub, not just a scorecard).
//   - LEAGUES tab removed — Leagues lives inside the Match tab behind a
//     `Matches | Leagues` segmented toggle (see Outing.jsx). IconTrophy
//     no longer imported here.
//   - PROFILE promoted from a Home sub-view to its own tab.
//   - EYE tab relabeled 'Eagle Eye' → 'Play' (the functional start/on-
//     course action); 'Eagle Eye' stays as the in-screen brand name.
const NAV_ITEMS = [
  { tab: TABS.HOME,    Icon: IconHome,       label: 'Home'    },
  { tab: TABS.OUTING,  Icon: IconScorecard,  label: 'Match'   },
  { tab: TABS.EYE,     Icon: IconTarget,     label: 'Play', center: true },
  { tab: TABS.PROFILE, Icon: IconUser,       label: 'Profile' },
  { tab: TABS.TOUR,    Icon: IconTour,       label: 'Tour'    },
]

export default function BottomNav({ active, onChange }) {
  return (
    <nav style={{
      position: 'fixed',
      bottom: 0,
      // Full-bleed background: span the entire viewport edge to edge.
      // The old `maxWidth: 430` cap left dead strips of page background
      // on both sides of the bar on viewports wider than 430 CSS px —
      // Matt flagged it 2026-07-10 ("gaps on both sides... fill the
      // dead space"). The 430 frame now applies only to the icon ROW
      // (inner div below) so item spacing doesn't stretch on wide
      // screens; the cream background + border always reach the edges.
      left: 0,
      right: 0,
      width: '100%',
      // 56px bar + the home-indicator inset. paddingBottom pushes the
      // icons up into the top 56px while the cream background fills all
      // the way to the physical bottom edge — so no cream "safe-area
      // strip" shows below the bar on any page. env(..., 0px) → 0 where
      // there's no indicator. (2026-06-27 — Matt: full-screen.)
      height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      background: 'rgba(255, 253, 248, 0.96)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderTop: '1px solid rgba(27,94,59,0.14)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 200,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 430,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
      }}>
        {NAV_ITEMS.map(item => (
          <NavItem key={item.tab} item={item} active={active === item.tab} onPress={() => onChange(item.tab)} />
        ))}
      </div>
    </nav>
  )
}

function NavItem({ item, active, onPress }) {
  const { Icon, label, center, tab } = item

  if (center) {
    return (
      <button onClick={onPress} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 4, border: 'none', cursor: 'pointer', padding: '0 8px',
        marginTop: -16, background: 'transparent',
        WebkitTapHighlightColor: 'transparent',
      }}>
        <div style={{
          width: 50, height: 50, borderRadius: '50%',
          background: active
            ? 'linear-gradient(145deg, var(--tm-gold-bright) 0%, var(--tm-gold) 60%, #8A6B28 100%)'
            : 'linear-gradient(145deg, #35A046 0%, var(--tm-green-bright) 60%, #1A4A24 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: active
            ? '0 0 0 1px rgba(232,192,90,0.5), 0 4px 24px rgba(201,160,64,0.5), 0 0 0 8px rgba(201,160,64,0.08)'
            : '0 0 0 1px rgba(53,160,70,0.4), 0 4px 20px rgba(42,122,56,0.5), 0 0 0 8px rgba(42,122,56,0.08)',
          transition: 'all 220ms cubic-bezier(0.25,0.46,0.45,0.94)',
        }}>
          <Icon size={26} color={active ? '#1A1000' : '#fff'} strokeWidth={2} />
        </div>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.03em',
          color: active ? 'var(--tm-gold)' : 'rgba(27,94,59,0.40)',
          transition: 'color 220ms ease',
        }}>
          {label}
        </span>
      </button>
    )
  }

  return (
    <button onClick={onPress} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 4, border: 'none', cursor: 'pointer',
      padding: '2px 14px', background: 'transparent',
      WebkitTapHighlightColor: 'transparent', minWidth: 60,
      position: 'relative',
    }}>
      {/* Active indicator bar */}
      <div style={{
        position: 'absolute', top: -10, left: '50%',
        transform: 'translateX(-50%)',
        width: active ? 24 : 0, height: 2, borderRadius: 1,
        background: 'linear-gradient(90deg, var(--tm-green), var(--tm-green-bright))',
        boxShadow: active ? '0 0 8px rgba(27,94,59,0.5)' : 'none',
        transition: 'width 250ms cubic-bezier(0.34,1.56,0.64,1)',
      }} />

      <div style={{
        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8,
        background: active ? 'rgba(27,94,59,0.10)' : 'transparent',
        transition: 'background 220ms ease',
      }}>
        <Icon
          size={20}
          color={active ? 'var(--tm-green)' : 'rgba(27,94,59,0.38)'}
          strokeWidth={active ? 2 : 1.5}
        />
      </div>

      <span style={{
        fontSize: 10, fontWeight: active ? 600 : 400,
        color: active ? 'var(--tm-green)' : 'rgba(27,94,59,0.38)',
        letterSpacing: '0.03em',
        transition: 'color 220ms ease, font-weight 0ms',
      }}>
        {label}
      </span>
    </button>
  )
}
