import { useState, useEffect } from 'react'
import { api } from '../lib/api.js'
import { TABS } from '../constants.js'
import { TMEmblem, IconTarget, IconTrophy, IconFlag, IconChevronRight } from '../components/primitives/Icons.jsx'

export default function Home({ user, onNavigate }) {
  const [stats, setStats]   = useState(null)
  const [rounds, setRounds] = useState([])
  const [showStart, setShowStart] = useState(false)

  useEffect(() => {
    api.get('/api/stats/summary').then(setStats).catch(() => {})
    api.get('/api/rounds?limit=3').then(d => setRounds(d?.rounds ?? [])).catch(() => {})
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'
  const firstName = user.name?.split(' ')[0] ?? 'Golfer'

  return (
    <div className="page-scroll" style={{ padding: '0 0 8px' }}>

      {/* ── Top bar ── */}
      <div style={{ padding: '4px 20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.05em', fontWeight: 500 }}>
            {greeting}, {firstName}
          </div>
          <div style={{
            fontSize: 30, fontWeight: 900, letterSpacing: '-1.5px', lineHeight: 1.05,
            background: 'linear-gradient(135deg, #F0D060 0%, #E8C05A 40%, #C9A040 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            The Match
          </div>
        </div>
        <TMEmblem size={46} gold />
      </div>

      {/* ── Handicap Hero Card ── */}
      <div style={{ margin: '0 16px 16px', position: 'relative' }}>
        {/* Background layers */}
        <div style={{
          borderRadius: 24, overflow: 'hidden', position: 'relative',
          background: 'linear-gradient(140deg, #0A1F10 0%, #0D2615 35%, #071209 100%)',
          border: '1px solid rgba(94,212,122,0.15)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
          padding: '24px 22px 20px',
        }}>
          {/* Decorative radial glow */}
          <div style={{
            position: 'absolute', right: -30, top: -30,
            width: 200, height: 200, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(42,122,56,0.18) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          {/* Subtle grid pattern overlay */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 24, opacity: 0.03,
            backgroundImage: 'repeating-linear-gradient(0deg, #fff 0px, #fff 1px, transparent 1px, transparent 24px), repeating-linear-gradient(90deg, #fff 0px, #fff 1px, transparent 1px, transparent 24px)',
            pointerEvents: 'none',
          }} />

          {/* Content */}
          <div style={{ position: 'relative' }}>
            {/* Label + trend row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: 'rgba(232,192,90,0.7)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Handicap Index
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <StatPill label="Rounds" value={stats?.roundCount ?? '—'} />
                <StatPill label="Avg" value={stats?.avgScore ?? '—'} />
              </div>
            </div>

            {/* Big number */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 20 }}>
              <div style={{
                fontSize: 72, fontWeight: 900, lineHeight: 0.9,
                letterSpacing: '-3px',
                background: 'linear-gradient(180deg, #F5E070 0%, #E8C05A 50%, #C9A040 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                filter: 'drop-shadow(0 0 12px rgba(232,192,90,0.25))',
              }}>
                {stats?.handicap != null ? stats.handicap.toFixed(1) : '—'}
              </div>
              {stats?.handicapTrend != null && (
                <div style={{
                  marginBottom: 10, fontSize: 14, fontWeight: 700,
                  color: stats.handicapTrend < 0 ? '#5ED47A' : '#E07A5A',
                }}>
                  {stats.handicapTrend < 0 ? '▼' : '▲'} {Math.abs(stats.handicapTrend).toFixed(1)}
                </div>
              )}
            </div>

            {/* Start Round CTA */}
            <button onClick={() => setShowStart(true)} style={{
              width: '100%', padding: '15px', borderRadius: 14,
              background: 'linear-gradient(135deg, #2A7A38 0%, #35A046 50%, #2A7A38 100%)',
              border: '1px solid rgba(94,212,122,0.3)',
              color: '#fff', fontWeight: 800, fontSize: 16, letterSpacing: '-0.2px',
              boxShadow: '0 4px 16px rgba(42,122,56,0.4), inset 0 1px 0 rgba(255,255,255,0.12)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'transform 120ms ease, box-shadow 120ms ease',
              WebkitTapHighlightColor: 'transparent',
            }}
              onTouchStart={e => e.currentTarget.style.transform = 'scale(0.97)'}
              onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <IconFlag size={18} color="#fff" strokeWidth={2.2} />
              Start a Round
            </button>
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '0 16px 20px' }}>
        <QuickAction
          icon={<IconTarget size={28} color="#E8C05A" strokeWidth={1.8} />}
          label="Eagle Eye"
          sub="AI Rangefinder"
          accent="#E8C05A"
          glowColor="rgba(201,160,64,0.2)"
          onClick={() => onNavigate(TABS.EYE)}
        />
        <QuickAction
          icon={<IconTrophy size={28} color="#5ED47A" strokeWidth={1.8} />}
          label="Outing"
          sub="Live tournament"
          accent="#5ED47A"
          glowColor="rgba(94,212,122,0.15)"
          onClick={() => onNavigate(TABS.OUTING)}
        />
      </div>

      {/* ── Recent Rounds ── */}
      {rounds.length > 0 && (
        <section style={{ margin: '0 16px 20px' }}>
          <SectionHeader label="Recent Rounds" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rounds.map(r => <RoundRow key={r.id} round={r} />)}
          </div>
        </section>
      )}

      {/* ── Club Profile ── */}
      {stats?.topClubs?.length > 0 && (
        <section style={{ margin: '0 16px 20px' }}>
          <SectionHeader label="Club Profile" />
          <div style={{
            background: 'rgba(14,22,16,0.8)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16,
            overflow: 'hidden',
            backdropFilter: 'blur(12px)',
          }}>
            {stats.topClubs.map((c, i) => (
              <div key={c.club} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px',
                borderBottom: i < stats.topClubs.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              }}>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: 500 }}>{c.club}</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                  <span style={{ color: '#E8C05A', fontWeight: 800, fontSize: 17 }}>{c.avg}</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>yds</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Empty state ── */}
      {!stats && rounds.length === 0 && (
        <div style={{ padding: '32px 24px', textAlign: 'center' }}>
          <TMEmblem size={64} gold />
          <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.8)', marginTop: 20, marginBottom: 8 }}>
            Welcome to The Match
          </div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', marginBottom: 28, lineHeight: 1.6 }}>
            Start your first round to build your handicap,<br />track your rivals, and own the course.
          </div>
          <button onClick={() => setShowStart(true)} style={{
            padding: '14px 32px', borderRadius: 50,
            background: 'linear-gradient(135deg, #C9A040, #E8C05A)',
            color: '#0A0600', fontWeight: 800, fontSize: 15, border: 'none',
            boxShadow: '0 4px 20px rgba(201,160,64,0.4)', cursor: 'pointer',
          }}>
            Start Your First Round
          </button>
        </div>
      )}

      {showStart && <StartRoundSheet onClose={() => setShowStart(false)} onNavigate={onNavigate} />}
    </div>
  )
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

function StatPill({ label, value }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'rgba(255,255,255,0.7)' }}>{value}</div>
    </div>
  )
}

function QuickAction({ icon, label, sub, accent, glowColor, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: `linear-gradient(140deg, rgba(14,22,16,0.95) 0%, rgba(14,22,16,0.7) 100%)`,
      border: `1px solid ${accent}22`,
      borderRadius: 18, padding: '18px 16px',
      textAlign: 'left', cursor: 'pointer', width: '100%',
      backdropFilter: 'blur(12px)',
      boxShadow: `0 4px 24px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.04)`,
      WebkitTapHighlightColor: 'transparent',
      transition: 'transform 120ms ease',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}
      onTouchStart={e => e.currentTarget.style.transform = 'scale(0.97)'}
      onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
    >
      {/* Icon container */}
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: `${accent}18`,
        border: `1px solid ${accent}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{label}</div>
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>{sub}</div>
      </div>
    </button>
  )
}

function SectionHeader({ label }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {label}
      </span>
    </div>
  )
}

function RoundRow({ round }) {
  const date = new Date(round.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const toPar = round.total - (round.coursePar || 72)
  const color = toPar < -1 ? '#4A9EDB' : toPar === -1 ? '#4A9EDB' : toPar === 0 ? '#98B89E' : toPar <= 2 ? '#E07A5A' : '#E05252'
  const label = toPar > 0 ? `+${toPar}` : toPar === 0 ? 'E' : `${toPar}`

  return (
    <div style={{
      background: 'rgba(14,22,16,0.7)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 14, padding: '14px 16px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      backdropFilter: 'blur(8px)',
    }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'rgba(255,255,255,0.85)', marginBottom: 2 }}>{round.courseName}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{date}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{round.total}</div>
          <div style={{ fontSize: 11, color, fontWeight: 700 }}>{label}</div>
        </div>
        {/* Score pill */}
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${color}18`, border: `1px solid ${color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 800, color,
        }}>
          {label}
        </div>
      </div>
    </div>
  )
}

function StartRoundSheet({ onClose, onNavigate }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'linear-gradient(180deg, #0E1A12 0%, #0A1209 100%)',
          borderRadius: '28px 28px 0 0',
          border: '1px solid rgba(255,255,255,0.07)',
          borderBottom: 'none',
          padding: '8px 20px',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', margin: '12px auto 24px' }} />

        <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 20 }}>Start a Round</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SheetButton
            label="Solo Round"
            sub="Track your score alone"
            icon={<IconFlag size={20} color="#5ED47A" strokeWidth={2} />}
            onClick={() => { onNavigate(TABS.ROUND); onClose() }}
            variant="green"
          />
          <SheetButton
            label="Join / Create Outing"
            sub="Play against your rivals"
            icon={<IconTrophy size={20} color="#E8C05A" strokeWidth={2} />}
            onClick={() => { onNavigate(TABS.OUTING); onClose() }}
            variant="gold"
          />
          <button onClick={onClose} style={{
            padding: '14px', borderRadius: 14, background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)',
            fontWeight: 600, fontSize: 15, cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function SheetButton({ label, sub, icon, onClick, variant }) {
  const isGold = variant === 'gold'
  return (
    <button onClick={onClick} style={{
      padding: '16px 18px', borderRadius: 14, cursor: 'pointer',
      background: isGold ? 'rgba(201,160,64,0.1)' : 'rgba(42,122,56,0.15)',
      border: `1px solid ${isGold ? 'rgba(232,192,90,0.25)' : 'rgba(94,212,122,0.2)'}`,
      display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
      WebkitTapHighlightColor: 'transparent',
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: 11, flexShrink: 0,
        background: isGold ? 'rgba(201,160,64,0.15)' : 'rgba(42,122,56,0.2)',
        border: `1px solid ${isGold ? 'rgba(232,192,90,0.2)' : 'rgba(94,212,122,0.15)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontWeight: 700, color: '#fff', fontSize: 15, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{sub}</div>
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <IconChevronRight size={18} color="rgba(255,255,255,0.2)" />
      </div>
    </button>
  )
}
