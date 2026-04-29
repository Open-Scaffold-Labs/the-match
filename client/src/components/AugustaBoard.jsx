import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'

const AUGUSTA_PARS = [4, 5, 4, 3, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 5, 3, 4, 4]

function getScoreToPar(scores, pars) {
  let diff = 0
  scores.forEach((s, i) => { if (s != null) diff += s - pars[i] })
  return diff
}
function getPlayed(scores) { return scores.filter(s => s != null).length }
function formatSTP(n, played) {
  if (played === 0) return ''
  if (n === 0) return 'E'
  if (n < 0) return String(n)
  return `+${n}`
}

// Deterministic avatar color from name
function avatarBg(name) {
  const palette = ['#1B5E20', '#0D47A1', '#6A1B9A', '#B71C1C', '#006064', '#E65100']
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return palette[h % palette.length]
}

// Check if a player row belongs to the logged-in user
function isMe(playerName, userName) {
  if (!userName) return false
  const a = playerName.toUpperCase().replace(/\s+/g, ' ').trim()
  const b = userName.toUpperCase().replace(/\s+/g, ' ').trim()
  return a === b || b.startsWith(a.split(' ')[0]) || a.startsWith(b.split(' ')[0])
}

function MastersFlag() {
  return (
    <svg width="26" height="26" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="18" fill="#FFD700" />
      <text x="18" y="24" textAnchor="middle" fontSize="14" fontWeight="bold"
        fontFamily="Georgia, serif" fill="#1a5c1a">M</text>
    </svg>
  )
}

export default function AugustaBoard({ user, onBack }) {
  const [pars, setPars] = useState([...AUGUSTA_PARS])
  const [players, setPlayers] = useState([])
  const [addingPlayer, setAddingPlayer] = useState(true)
  const [newName, setNewName] = useState('')
  const [modal, setModal] = useState(null)
  const [inputVal, setInputVal] = useState('')
  const nameInputRef = useRef(null)

  function addPlayer() {
    const name = newName.trim().toUpperCase()
    if (!name) return
    setPlayers(prev => [...prev, { id: Date.now(), name, scores: Array(18).fill(null) }])
    setNewName('')
    setAddingPlayer(false)
  }

  function removePlayer(id) {
    setPlayers(prev => prev.filter(p => p.id !== id))
  }

  function openScore(playerId, holeIdx) {
    const player = players.find(p => p.id === playerId)
    setInputVal(player?.scores[holeIdx] != null ? String(player.scores[holeIdx]) : '')
    setModal({ type: 'score', playerId, holeIdx })
  }

  function openPar(holeIdx) {
    setInputVal(String(pars[holeIdx]))
    setModal({ type: 'par', holeIdx })
  }

  function saveModal() {
    const val = parseInt(inputVal)
    if (modal.type === 'score') {
      setPlayers(prev => prev.map(p => {
        if (p.id !== modal.playerId) return p
        const s = [...p.scores]
        s[modal.holeIdx] = isNaN(val) || val <= 0 ? null : Math.min(val, 20)
        return { ...p, scores: s }
      }))
    } else {
      setPars(prev => {
        const p = [...prev]
        p[modal.holeIdx] = isNaN(val) || val < 3 ? prev[modal.holeIdx] : Math.min(val, 6)
        return p
      })
    }
    setModal(null)
    setInputVal('')
  }

  const sorted = [...players].sort((a, b) => {
    const pa = getPlayed(a.scores), pb = getPlayed(b.scores)
    if (pa === 0 && pb === 0) return 0
    if (pa === 0) return 1
    if (pb === 0) return -1
    return getScoreToPar(a.scores, pars) - getScoreToPar(b.scores, pars)
  })

  // Layout
  const CELL  = 30
  const ROW_H = 82  // tall enough for body cutout
  const PRIOR = 44
  const PHOTO = 58
  const NAME  = 108

  const hCell = (w, extra = {}) => ({
    width: w, minWidth: w, height: ROW_H,
    border: '2px solid #111', padding: 0,
    textAlign: 'center', verticalAlign: 'middle',
    fontSize: 13, fontWeight: 900, color: '#111',
    fontFamily: '"Arial Black", "Arial Bold", Arial, sans-serif',
    background: '#fff', userSelect: 'none', ...extra,
  })

  const sCell = (w, extra = {}) => ({
    width: w, minWidth: w, height: ROW_H,
    border: '1.5px solid #111', padding: 0,
    textAlign: 'center', verticalAlign: 'middle',
    fontSize: 15, fontWeight: 900,
    fontFamily: '"Arial Black", "Arial Bold", Arial, sans-serif',
    userSelect: 'none', cursor: 'pointer', ...extra,
  })

  return (
    <div style={{ minHeight: '100dvh', background: '#E8E6DE', display: 'flex', flexDirection: 'column' }}>

      {/* Back bar */}
      <div style={{
        padding: '52px 20px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(0,0,0,0.09)', border: 'none', borderRadius: 20,
          color: '#333', fontSize: 13, fontWeight: 600,
          padding: '7px 16px', cursor: 'pointer',
        }}>← Back</button>
        <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.35)', letterSpacing: '0.08em', fontWeight: 600 }}>
          TAP SCORE TO EDIT · TAP PAR TO CHANGE
        </div>
      </div>

      {/* Board */}
      <div style={{ margin: '16px 14px 0', borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 36px rgba(0,0,0,0.3)' }}>

        {/* LEADERS */}
        <div style={{
          background: '#fff', borderBottom: '3px solid #111',
          textAlign: 'center', padding: '12px 0 8px',
        }}>
          <div style={{
            fontSize: 46, fontWeight: 900, lineHeight: 1, color: '#111',
            letterSpacing: '0.1em',
            fontFamily: '"Impact", "Arial Black", Arial, sans-serif',
          }}>LEADERS</div>
        </div>

        {/* Scrollable grid */}
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', background: '#fff' }}>
          <table style={{
            borderCollapse: 'collapse',
            minWidth: PRIOR + PHOTO + NAME + 18 * CELL,
            tableLayout: 'fixed',
          }}>
            <thead>
              {/* HOLE row */}
              <tr>
                <td style={hCell(PRIOR)}>PRIOR</td>
                <td style={hCell(PHOTO)}></td>
                <td style={{ ...hCell(NAME), textAlign: 'left', paddingLeft: 10 }}>HOLE</td>
                {pars.map((_, i) => <td key={i} style={hCell(CELL)}>{i + 1}</td>)}
              </tr>
              {/* PAR row */}
              <tr>
                <td style={{ ...hCell(PRIOR), borderTop: '1px solid #111' }}></td>
                <td style={{ ...hCell(PHOTO), borderTop: '1px solid #111' }}></td>
                <td style={{ ...hCell(NAME), borderTop: '1px solid #111', textAlign: 'left', paddingLeft: 10 }}>PAR</td>
                {pars.map((p, i) => (
                  <td key={i} onClick={() => openPar(i)}
                    style={{ ...hCell(CELL), borderTop: '1px solid #111', cursor: 'pointer' }}
                  >{p}</td>
                ))}
              </tr>
            </thead>

            <tbody>
              {sorted.map(player => {
                const played = getPlayed(player.scores)
                const stp = getScoreToPar(player.scores, pars)
                const stpStr = formatSTP(stp, played)
                const stpRed = played > 0 && stp < 0
                const me = isMe(player.name, user?.name)
                const cutout = me && user?.cutout ? user.cutout : null
                const initials = player.name.split(' ').map(w => w[0]).join('').slice(0, 2)

                return (
                  <tr key={player.id} style={{ background: '#fff' }}>
                    {/* Score to par */}
                    <td style={{ ...sCell(PRIOR), color: stpRed ? '#CC0000' : '#111', cursor: 'default', fontSize: 16 }}>
                      {stpStr}
                    </td>

                    {/* Photo — full body cutout on white, or initials circle */}
                    <td style={{ ...sCell(PHOTO), cursor: 'default', background: '#fff', padding: 0, verticalAlign: 'bottom' }}>
                      {cutout ? (
                        <img
                          src={cutout}
                          alt={player.name}
                          style={{
                            height: ROW_H - 2,
                            width: '100%',
                            objectFit: 'contain',
                            objectPosition: 'center bottom',
                            display: 'block',
                          }}
                        />
                      ) : (
                        <div style={{
                          width: 38, height: 38, borderRadius: '50%', margin: '0 auto 6px',
                          background: avatarBg(player.name),
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontSize: 13, fontWeight: 900,
                          fontFamily: '"Arial Black", Arial, sans-serif',
                        }}>{initials}</div>
                      )}
                    </td>

                    {/* Name */}
                    <td style={{ ...sCell(NAME), textAlign: 'left', paddingLeft: 10, color: '#111', fontSize: 13, cursor: 'default' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {player.name}
                        </span>
                        <button onClick={() => removePlayer(player.id)} style={{
                          background: 'none', border: 'none', color: 'rgba(0,0,0,0.2)',
                          fontSize: 16, cursor: 'pointer', lineHeight: 1, flexShrink: 0, padding: '0 4px',
                        }}>×</button>
                      </div>
                    </td>

                    {/* Hole scores */}
                    {player.scores.map((s, i) => {
                      const diff = s != null ? s - pars[i] : null
                      return (
                        <td key={i} onClick={() => openScore(player.id, i)}
                          style={{ ...sCell(CELL), color: '#CC0000', background: s == null ? 'rgba(0,0,0,0.015)' : '#fff', position: 'relative' }}
                        >
                          {s != null && (
                            <>
                              {diff <= -1 && <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', border: '1.5px solid #CC0000', pointerEvents: 'none' }} />}
                              {diff === 1  && <div style={{ position: 'absolute', inset: 3, border: '1.5px solid #111', pointerEvents: 'none' }} />}
                              {diff >= 2  && <>
                                <div style={{ position: 'absolute', inset: 2, border: '1.5px solid #111', pointerEvents: 'none' }} />
                                <div style={{ position: 'absolute', inset: 6, border: '1.5px solid #111', pointerEvents: 'none' }} />
                              </>}
                              {s}
                            </>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}

              {players.length === 0 && (
                <tr>
                  <td colSpan={22} style={{ height: 60, textAlign: 'center', color: 'rgba(0,0,0,0.3)', fontSize: 13, border: '1px solid #ddd', fontFamily: 'Arial, sans-serif', fontWeight: 400 }}>
                    Add players below to begin
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Augusta footer */}
        <div style={{
          background: '#1B5E20', padding: '11px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18,
        }}>
          <MastersFlag />
          <div style={{
            fontFamily: '"Georgia", "Times New Roman", serif',
            fontSize: 17, color: '#fff', fontStyle: 'italic', letterSpacing: '0.08em',
          }}>Augusta National Club Golf</div>
          <MastersFlag />
        </div>
      </div>

      {/* Add player */}
      <div style={{ padding: '16px 14px 48px' }}>
        {addingPlayer ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={nameInputRef}
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value.slice(0, 18))}
              onKeyDown={e => { if (e.key === 'Enter') addPlayer() }}
              placeholder="PLAYER NAME"
              style={{
                flex: 1, background: '#fff', border: '2px solid #111',
                borderRadius: 8, color: '#111', padding: '12px 14px',
                fontSize: 15, fontWeight: 700, outline: 'none',
                fontFamily: '"Arial Black", Arial, sans-serif',
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}
            />
            <button onClick={addPlayer} style={{
              background: '#111', color: '#fff', border: 'none', borderRadius: 8,
              padding: '0 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              fontFamily: '"Arial Black", Arial, sans-serif',
            }}>ADD</button>
            {players.length > 0 && (
              <button onClick={() => { setAddingPlayer(false); setNewName('') }} style={{
                background: 'rgba(0,0,0,0.08)', border: 'none', borderRadius: 8,
                padding: '0 12px', fontSize: 18, cursor: 'pointer',
              }}>✕</button>
            )}
          </div>
        ) : (
          <button onClick={() => setAddingPlayer(true)} style={{
            width: '100%', padding: '15px', background: '#1B5E20', border: 'none',
            borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 900,
            cursor: 'pointer', fontFamily: '"Arial Black", Arial, sans-serif',
            letterSpacing: '0.08em',
          }}>+ ADD PLAYER</button>
        )}
      </div>

      {/* Score / Par modal */}
      {modal && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => { setModal(null); setInputVal('') }}
        >
          <div
            style={{ width: '100%', maxWidth: 430, background: '#fff', borderRadius: '20px 20px 0 0', padding: '20px 20px 48px' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ marginBottom: 16 }}>
              {modal.type === 'score' ? (
                <>
                  <div style={{ fontFamily: '"Arial Black", Arial, sans-serif', fontSize: 18, fontWeight: 900, color: '#111', marginBottom: 2 }}>
                    {players.find(p => p.id === modal.playerId)?.name}
                  </div>
                  <div style={{ color: '#666', fontSize: 13 }}>Hole {modal.holeIdx + 1} · Par {pars[modal.holeIdx]}</div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: '"Arial Black", Arial, sans-serif', fontSize: 18, fontWeight: 900, color: '#111', marginBottom: 2 }}>Set Par</div>
                  <div style={{ color: '#666', fontSize: 13 }}>Hole {modal.holeIdx + 1}</div>
                </>
              )}
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: modal.type === 'par' ? 'repeat(4, 1fr)' : 'repeat(5, 1fr)',
              gap: 8, marginBottom: 14,
            }}>
              {(modal.type === 'par' ? [3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map(n => (
                <button key={n} onClick={() => setInputVal(String(n))} style={{
                  padding: '16px 0',
                  background: inputVal === String(n) ? '#CC0000' : 'rgba(0,0,0,0.06)',
                  color: inputVal === String(n) ? '#fff' : '#111',
                  border: 'none', borderRadius: 10,
                  fontSize: 20, fontWeight: 900, cursor: 'pointer',
                  fontFamily: '"Arial Black", Arial, sans-serif',
                }}>{n}</button>
              ))}
              <button onClick={() => setInputVal('')} style={{
                padding: '16px 0', background: 'rgba(0,0,0,0.06)', border: 'none', borderRadius: 10,
                color: '#666', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                gridColumn: modal.type === 'par' ? 'span 4' : 'span 5',
              }}>Clear</button>
            </div>

            <button onClick={saveModal} disabled={!inputVal} style={{
              width: '100%', padding: '15px',
              background: inputVal ? '#1B5E20' : 'rgba(0,0,0,0.08)',
              color: inputVal ? '#fff' : '#999',
              border: 'none', borderRadius: 12,
              fontSize: 16, fontWeight: 900, cursor: inputVal ? 'pointer' : 'default',
              fontFamily: '"Arial Black", Arial, sans-serif', letterSpacing: '0.06em',
            }}>SAVE</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
