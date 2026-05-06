import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, post, del } from '../../lib/api.js'
import { computeBet } from '../../lib/side-bets.js'
import { tmHaptic } from './shared.jsx'

// ─── Outing/SideBets.jsx ────────────────────────────────────────────────────
// MVP side-bets surface for an outing. Two views:
//
//   <SideBetsCard outing={outing} userId={userId} />
//     A scrollable card showing every declared bet with live standings
//     (computed client-side from outing.state). Renders the host-only
//     "+ Add side bet" button when userId === outing.host_id, plus
//     a Press button for nassau bets. Mountable in CommissionerPanel
//     or as its own slide-up sheet on the scorecard.
//
//   <DeclareBetSheet outing={outing} onDone={...} onCancel={...} />
//     Bottom-sheet wizard for the host: pick type → pick stakes →
//     pick participants → confirm.
//
// All math comes from lib/side-bets.js — pure functions. The server
// stores declarations only.
//
// (2026-05-06 — polish task #7)

export default function SideBetsCard({ outing, userId, onClose }) {
  const code = outing?.code
  const isHost = String(outing?.host_id) === String(userId)
  const [bets, setBets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDeclare, setShowDeclare] = useState(false)
  const [busyId, setBusyId] = useState(null)

  async function reload() {
    setLoading(true)
    try {
      const r = await api(`/api/outings/${code}/side-bets`)
      setBets(r?.bets || [])
    } catch {
      setBets([])
    }
    setLoading(false)
  }

  useEffect(() => { if (code) reload() }, [code])

  async function handleDeclare(payload) {
    try {
      await post(`/api/outings/${code}/side-bets`, payload)
      tmHaptic(15)
      await reload()
      setShowDeclare(false)
    } catch (e) {
      alert('Could not declare side bet. ' + (e?.payload?.error || ''))
    }
  }

  async function handleDelete(betId) {
    if (!window.confirm('Remove this side bet? Standings will disappear from the card.')) return
    setBusyId(betId)
    try {
      await del(`/api/outings/${code}/side-bets/${betId}`)
      await reload()
    } catch { /* surfaced by reload empty */ }
    setBusyId(null)
  }

  async function handlePress(bet, startHole) {
    setBusyId(bet.id)
    try {
      await post(`/api/outings/${code}/side-bets/${bet.id}/press`, { start_hole: startHole })
      tmHaptic(15)
      await reload()
    } catch (e) {
      alert('Press failed. ' + (e?.payload?.error || ''))
    }
    setBusyId(null)
  }

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430,
        background: '#FFFDF8', borderRadius: '20px 20px 0 0',
        maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 -8px 30px rgba(0,0,0,0.3)',
      }}>
        <Header onClose={onClose} />
        <div style={{ padding: '6px 16px 24px' }}>
          {loading && (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(13,31,18,0.45)', fontSize: 13 }}>
              Loading side bets…
            </div>
          )}

          {!loading && bets.length === 0 && (
            <EmptyState />
          )}

          {!loading && bets.map(bet => {
            const standings = computeBet(bet, outing?.state)
            return (
              <BetCard
                key={bet.id}
                bet={bet}
                standings={standings}
                outing={outing}
                isHost={isHost}
                busy={busyId === bet.id}
                onDelete={() => handleDelete(bet.id)}
                onPress={(startHole) => handlePress(bet, startHole)}
              />
            )
          })}

          {!loading && isHost && (
            <button onClick={() => setShowDeclare(true)} style={{
              width: '100%', padding: '14px', borderRadius: 14, marginTop: 12,
              background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
              color: 'var(--tm-text-inv)',
              fontWeight: 800, fontSize: 14, border: 'none', cursor: 'pointer',
            }}>+ Add side bet</button>
          )}
        </div>
      </div>

      {showDeclare && (
        <DeclareBetSheet
          outing={outing}
          onDone={handleDeclare}
          onCancel={() => setShowDeclare(false)}
        />
      )}
    </div>,
    document.body
  )
}

function Header({ onClose }) {
  return (
    <div style={{
      padding: 'calc(var(--safe-top) + 14px) 18px 12px',
      borderBottom: '1px solid rgba(27,94,59,0.10)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--tm-text)' }}>Side Bets</div>
        <div style={{ fontSize: 11, color: 'rgba(13,31,18,0.45)', marginTop: 2 }}>
          Live standings — math runs on this device
        </div>
      </div>
      <button onClick={onClose} style={{
        background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.12)',
        borderRadius: 10, color: '#1B5E3B', fontSize: 16, padding: '4px 12px',
        cursor: 'pointer',
      }}>✕</button>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{ padding: '28px 16px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--tm-text)' }}>
        No side bets yet.
      </div>
      <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.55)', marginTop: 6, lineHeight: 1.5 }}>
        Add a Nassau (heads-up, front 9 / back 9 / total) or Skins (carryover, multi-player). Stakes are tracked but not collected — you settle at the bar.
      </div>
    </div>
  )
}

// ─── Single bet card ───────────────────────────────────────────────────────

function BetCard({ bet, standings, outing, isHost, busy, onDelete, onPress }) {
  if (!standings) {
    return (
      <Card>
        <div style={{ fontSize: 13, color: 'rgba(13,31,18,0.55)' }}>
          {bet.type === 'nassau' ? 'Nassau' : 'Skins'} — invalid config
        </div>
      </Card>
    )
  }
  if (bet.type === 'nassau') return <NassauCard {...{ bet, standings, isHost, busy, onDelete, onPress, outing }} />
  if (bet.type === 'skins')  return <SkinsCard  {...{ bet, standings, isHost, busy, onDelete }} />
  return null
}

function Card({ children }) {
  return (
    <div style={{
      background: 'var(--tm-surface-2)',
      border: '1px solid var(--tm-border)',
      borderRadius: 16, padding: '14px 16px', marginTop: 12,
    }}>
      {children}
    </div>
  )
}

function NassauCard({ bet, standings, isHost, busy, onDelete, onPress, outing }) {
  const { stakes, a, b, front9, back9, total18, totalDollars, presses } = standings
  // Current hole — derive from how many holes have been played by the
  // pair (max of either player's holes_played).
  const holesPlayed = Math.max(
    (front9.holesPlayed + back9.holesPlayed),
    1
  )
  const aDollars = totalDollars[a.id] || 0
  // 9-hole vs 18-hole shape. For 9-hole outings, only F9 is real; B9 has
  // no holes and T18 collapses to F9 — show one segment instead of three
  // ghost-y "Final" chips. (2026-05-06 hardening pass.)
  const totalHoles = Number(outing?.state?.holes ?? 18)
  const is9Hole = totalHoles <= 9

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--tm-gold-text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Nassau · ${stakes}/match{is9Hole ? ' · 9-hole' : ''}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--tm-text)', marginTop: 4 }}>
            {a.name} <span style={{ color: 'var(--tm-text-3)', fontWeight: 600 }}>vs</span> {b.name}
          </div>
        </div>
        {isHost && (
          <button onClick={onDelete} disabled={busy} style={{
            fontSize: 11, fontWeight: 700, color: 'rgba(220,38,38,0.85)',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}>Remove</button>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: is9Hole ? '1fr' : '1fr 1fr 1fr',
        gap: 8,
      }}>
        {is9Hole ? (
          <SegmentChip label="9 holes" seg={front9} a={a} b={b} />
        ) : (
          <>
            <SegmentChip label="Front 9"  seg={front9}  a={a} b={b} />
            <SegmentChip label="Back 9"   seg={back9}   a={a} b={b} />
            <SegmentChip label="Total 18" seg={total18} a={a} b={b} />
          </>
        )}
      </div>

      {presses.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tm-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Presses ({presses.length})
          </div>
          {presses.map((pr, i) => (
            <div key={i} style={{
              fontSize: 12, color: 'var(--tm-text-2)',
              display: 'flex', justifyContent: 'space-between',
              padding: '4px 0',
            }}>
              <span>From hole {pr.startHole + 1}</span>
              <span style={{
                fontWeight: 700,
                color: pr.leaderId === a.id ? 'var(--tm-green-text)' : pr.leaderId === b.id ? 'var(--tm-danger)' : 'var(--tm-text-3)',
              }}>
                {pr.cumDelta === 0 ? 'AS' : (pr.cumDelta > 0 ? `${a.name.split(' ')[0]} +${pr.cumDelta}` : `${b.name.split(' ')[0]} +${Math.abs(pr.cumDelta)}`)}
                {pr.settled ? '' : ` · thru ${pr.holesPlayed}`}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--tm-border)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)' }}>
          Settled this far
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: aDollars > 0 ? 'var(--tm-green-text)' : aDollars < 0 ? 'var(--tm-danger)' : 'var(--tm-text-3)' }}>
          {a.name.split(' ')[0]} {aDollars >= 0 ? '+' : ''}${aDollars} · {b.name.split(' ')[0]} {-aDollars >= 0 ? '+' : ''}${-aDollars}
        </div>
      </div>

      {isHost && holesPlayed < totalHoles && (
        <button onClick={() => onPress(holesPlayed)} disabled={busy} style={{
          width: '100%', padding: '8px', borderRadius: 10, marginTop: 10,
          background: 'rgba(27,94,59,0.06)', border: '1px solid rgba(27,94,59,0.18)',
          color: 'var(--tm-green-text)', fontWeight: 700, fontSize: 12,
          cursor: busy ? 'default' : 'pointer',
        }}>
          + Press from hole {holesPlayed + 1}
        </button>
      )}
    </Card>
  )
}

function SegmentChip({ label, seg, a, b }) {
  const c = seg.cumDelta
  const leader = c > 0 ? a.name.split(' ')[0]
                : c < 0 ? b.name.split(' ')[0]
                : 'AS'
  const color  = c > 0 ? 'var(--tm-green-text)'
                : c < 0 ? 'var(--tm-danger)'
                : 'var(--tm-text-3)'
  return (
    <div style={{
      background: 'var(--tm-surface)',
      border: '1px solid var(--tm-border)',
      borderRadius: 10, padding: '8px 10px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 9, color: 'var(--tm-text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color, marginTop: 2 }}>
        {leader === 'AS' ? 'AS' : `${leader} ${c > 0 ? '+' : ''}${c}`}
      </div>
      <div style={{ fontSize: 9, color: 'var(--tm-text-3)', marginTop: 1 }}>
        {seg.settled ? 'Final' : `Thru ${seg.holesPlayed}`}
      </div>
    </div>
  )
}

function SkinsCard({ bet, standings, isHost, busy, onDelete }) {
  const { stakes, players, totals, pendingValue } = standings
  const ranked = players
    .map(p => ({ ...p, ...totals[p.id] }))
    .sort((x, y) => y.dollars - x.dollars || y.skinsWon - x.skinsWon)
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--tm-gold-text)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Skins · ${stakes}/hole
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--tm-text)', marginTop: 4 }}>
            {players.length} players
          </div>
        </div>
        {isHost && (
          <button onClick={onDelete} disabled={busy} style={{
            fontSize: 11, fontWeight: 700, color: 'rgba(220,38,38,0.85)',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}>Remove</button>
        )}
      </div>

      {pendingValue > 0 && (
        <div style={{
          padding: '8px 12px', borderRadius: 10,
          background: 'rgba(232,192,90,0.10)',
          border: '1px solid rgba(232,192,90,0.32)',
          color: 'var(--tm-gold-text)',
          fontSize: 12, fontWeight: 700,
          marginBottom: 10, textAlign: 'center',
        }}>
          ${pendingValue} carryover riding on the next hole
        </div>
      )}

      {ranked.map((p, i) => (
        <div key={p.id} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 0',
          borderBottom: i < ranked.length - 1 ? '1px solid rgba(27,94,59,0.07)' : 'none',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text)' }}>
            {i + 1}. {p.name}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <div style={{ fontSize: 11, color: 'var(--tm-text-3)' }}>
              {p.skinsWon} skin{p.skinsWon === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: p.dollars > 0 ? 'var(--tm-green-text)' : 'var(--tm-text-2)' }}>
              ${p.dollars}
            </div>
          </div>
        </div>
      ))}
    </Card>
  )
}

// ─── Declare wizard ─────────────────────────────────────────────────────────

function DeclareBetSheet({ outing, onDone, onCancel }) {
  const participants = (outing?.state?.participants || []).filter(p => !p.is_guest)
  const [type, setType] = useState('nassau')
  const [stakes, setStakes] = useState(5)
  const [selectedIds, setSelectedIds] = useState([])

  function toggle(id) {
    setSelectedIds(prev => {
      const has = prev.includes(id)
      if (has) return prev.filter(x => x !== id)
      if (type === 'nassau' && prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  function canSubmit() {
    if (!Number.isFinite(Number(stakes)) || Number(stakes) < 0) return false
    if (type === 'nassau') return selectedIds.length === 2
    return selectedIds.length >= 2
  }

  function submit() {
    if (!canSubmit()) return
    onDone({ type, config: { stakes: Number(stakes), participant_ids: selectedIds } })
  }

  return createPortal(
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430,
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '20px 18px 28px',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--tm-text)', textAlign: 'center', marginBottom: 4 }}>
          New side bet
        </div>
        <div style={{ fontSize: 12, color: 'var(--tm-text-3)', textAlign: 'center', marginBottom: 16 }}>
          Stakes are tracked, not collected. Settle at the bar.
        </div>

        {/* Type picker */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[
            { v: 'nassau', label: 'Nassau', sub: 'Heads-up · F9 / B9 / 18' },
            { v: 'skins',  label: 'Skins',  sub: 'Carryover · multi' },
          ].map(o => (
            <button key={o.v} onClick={() => { setType(o.v); setSelectedIds([]) }} style={{
              flex: 1, padding: '10px 8px', borderRadius: 12,
              background: type === o.v ? 'var(--tm-gold-muted)' : 'var(--tm-surface-2)',
              border: type === o.v ? '1px solid rgba(201,160,64,0.55)' : '1px solid var(--tm-border)',
              color: type === o.v ? 'var(--tm-gold-text)' : 'var(--tm-text-2)',
              cursor: 'pointer',
            }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{o.label}</div>
              <div style={{ fontSize: 10, marginTop: 2 }}>{o.sub}</div>
            </button>
          ))}
        </div>

        {/* Stakes */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--tm-text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            Stakes ({type === 'nassau' ? 'per match' : 'per hole'})
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[1, 2, 5, 10, 20].map(s => (
              <button key={s} onClick={() => setStakes(s)} style={{
                padding: '8px 14px', borderRadius: 999,
                background: Number(stakes) === s ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)',
                border: Number(stakes) === s ? '1px solid rgba(27,94,59,0.45)' : '1px solid var(--tm-border)',
                color: Number(stakes) === s ? 'var(--tm-green-text)' : 'var(--tm-text-2)',
                fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}>${s}</button>
            ))}
            <input
              type="number" min="0" inputMode="numeric"
              value={stakes}
              onChange={e => setStakes(e.target.value)}
              style={{
                flex: 1, minWidth: 80,
                padding: '8px 10px', borderRadius: 999,
                border: '1px solid var(--tm-border)',
                background: 'var(--tm-surface-2)',
                fontSize: 13, fontWeight: 700,
                color: 'var(--tm-text)',
              }}
            />
          </div>
        </div>

        {/* Participants */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--tm-text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            {type === 'nassau' ? 'Pick 2 players' : `Players (${selectedIds.length})`}
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--tm-border)', borderRadius: 12 }}>
            {participants.length === 0 && (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--tm-text-3)', fontSize: 12 }}>
                No app users in this match.
              </div>
            )}
            {participants.map(p => {
              const sel = selectedIds.includes(p.user_id)
              return (
                <button key={p.user_id} onClick={() => toggle(p.user_id)} style={{
                  width: '100%', textAlign: 'left',
                  padding: '10px 12px', display: 'flex',
                  alignItems: 'center', justifyContent: 'space-between',
                  background: sel ? 'rgba(27,94,59,0.08)' : 'transparent',
                  border: 'none', borderBottom: '1px solid rgba(27,94,59,0.06)',
                  cursor: 'pointer',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text)' }}>{p.name}</span>
                  {sel && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1B5E3B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '14px', borderRadius: 12,
            background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
            color: 'var(--tm-text-2)', fontWeight: 700, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={submit} disabled={!canSubmit()} style={{
            flex: 2, padding: '14px', borderRadius: 12, border: 'none',
            background: canSubmit() ? 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))' : 'var(--tm-surface-2)',
            color: canSubmit() ? 'var(--tm-text-inv)' : 'var(--tm-text-3)',
            fontWeight: 800, fontSize: 14,
            cursor: canSubmit() ? 'pointer' : 'default',
          }}>Declare bet</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
