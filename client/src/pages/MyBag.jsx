// My Bag — placeholder page for the new bottom-nav slot that replaced
// Stats. Stats content moved to the Profile view inside Home (accessible
// via the top-bar "My Profile" button). Real My Bag content (club
// inventory, distance tracking, fitting notes) will come in a follow-up
// session. For now this is a styled "Coming soon" so the nav slot is
// occupied and the navigation is testable. (2026-05-01)

import { IconBag } from '../components/primitives/Icons.jsx'

export default function MyBag() {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      paddingBottom: 100,
    }}>
      {/* Header */}
      <div style={{
        padding: '56px 20px 16px',
      }}>
        <div style={{
          fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em',
          background: 'linear-gradient(135deg, #F5D78A 0%, #E8C05A 50%, #C9A040 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>My Bag</div>
        <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.45)', marginTop: 2 }}>
          Track your clubs and distances
        </div>
      </div>

      {/* Coming-soon card */}
      <div style={{ padding: '0 16px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{
          background: 'rgba(255,255,255,0.22)',
          border: '1px solid rgba(255,255,255,0.45)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRadius: 22,
          padding: '40px 28px',
          textAlign: 'center',
          maxWidth: 360, width: '100%',
          boxShadow: '0 6px 24px rgba(0,0,0,0.10)',
        }}>
          {/* Top gold accent */}
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(232,192,90,0.22), rgba(201,160,64,0.14))',
            border: '1px solid rgba(201,160,64,0.32)',
            margin: '0 auto 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <IconBag size={26} color="#C9A040" strokeWidth={1.8} />
          </div>

          <div style={{
            fontSize: 18, fontWeight: 800, color: '#0D1F12',
            letterSpacing: '-0.01em', marginBottom: 6,
          }}>Coming soon</div>

          <div style={{
            fontSize: 13, color: 'rgba(13,31,18,0.55)', lineHeight: 1.55,
            marginBottom: 16,
          }}>
            Your bag will track every club, your average distances, and
            how each club performs across rounds. We'll wire this up
            after the profile rebuild ships.
          </div>

          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8,
            background: 'rgba(27,94,59,0.06)',
            border: '1px solid rgba(27,94,59,0.10)',
            borderRadius: 12, padding: '12px 14px',
            textAlign: 'left',
          }}>
            <div style={{ fontSize: 11, color: 'rgba(27,94,59,0.65)', fontWeight: 700, letterSpacing: '0.06em' }}>WHAT'S COMING</div>
            <div style={{ fontSize: 12, color: 'rgba(13,31,18,0.65)', lineHeight: 1.5 }}>
              • 14-club inventory (driver, woods, irons, wedges, putter)<br/>
              • Average carry + total per club from round data<br/>
              • Last-shot history (course, hole, distance)<br/>
              • Notes per club (loft, shaft, lie)
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
