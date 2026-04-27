import { TABS } from '../../constants.js'
import { IconHome, IconTrophy, IconTarget, IconFlag, IconBarChart } from '../primitives/Icons.jsx'

const NAV_ITEMS = [
  { tab: TABS.HOME,   Icon: IconHome,      label: 'Home'      },
  { tab: TABS.OUTING, Icon: IconTrophy,    label: 'Match'    },
  { tab: TABS.EYE,    Icon: IconTarget,    label: 'Eagle Eye', center: true },
  { tab: TABS.ROUND,  Icon: IconFlag,      label: 'Round'     },
  { tab: TABS.STATS,  Icon: IconBarChart,  label: 'Stats'     },
]

export default function BottomNav({ active, onChange }) {
  return (
    <nav style={{
      height: 'calc(68px + env(safe-area-inset-bottom, 0px))',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      background: 'rgba(7, 12, 9, 0.92)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-around',
      paddingTop: 10,
      position: 'relative',
      zIndex: 100,
    }}>
      {NAV_ITEMS.map(item => (
        <NavItem key={item.tab} item={item} active={active === item.tab} onPress={() => onChange(item.tab)} />
      ))}
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
        marginTop: -22, background: 'transparent',
        WebkitTapHighlightColor: 'transparent',
      }}>
        <div style={{
          width: 58, height: 58, borderRadius: '50%',
          background: active
            ? 'linear-gradient(145deg, #E8C05A 0%, #C9A040 60%, #8A6B28 100%)'
            : 'linear-gradient(145deg, #35A046 0%, #2A7A38 60%, #1A4A24 100%)',
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
          color: active ? '#E8C05A' : 'rgba(255,255,255,0.35)',
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
      padding: '4px 14px', background: 'transparent',
      WebkitTapHighlightColor: 'transparent', minWidth: 60,
      position: 'relative',
    }}>
      {/* Active indicator bar */}
      <div style={{
        position: 'absolute', top: -10, left: '50%',
        transform: 'translateX(-50%)',
        width: active ? 24 : 0, height: 2, borderRadius: 1,
        background: 'linear-gradient(90deg, #35A046, #5ED47A)',
        boxShadow: active ? '0 0 8px rgba(94,212,122,0.8)' : 'none',
        transition: 'width 250ms cubic-bezier(0.34,1.56,0.64,1)',
      }} />

      <div style={{
        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 8,
        background: active ? 'rgba(94,212,122,0.1)' : 'transparent',
        transition: 'background 220ms ease',
      }}>
        <Icon
          size={20}
          color={active ? '#5ED47A' : 'rgba(255,255,255,0.32)'}
          strokeWidth={active ? 2 : 1.5}
        />
      </div>

      <span style={{
        fontSize: 10, fontWeight: active ? 600 : 400,
        color: active ? '#5ED47A' : 'rgba(255,255,255,0.32)',
        letterSpacing: '0.03em',
        transition: 'color 220ms ease, font-weight 0ms',
      }}>
        {label}
      </span>
    </button>
  )
}
