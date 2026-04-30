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

function MastersFlag({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="18" fill="#FFD700" />
      <text x="18" y="24" textAnchor="middle" fontSize="14" fontWeight="bold"
        fontFamily="Georgia, serif" fill="#0F3D1E">M</text>
    </svg>
  )
}

// Front-9 / Back-9 / Total totals (real Masters board has these columns).
function frontNineTotal(scores) {
  let total = 0, any = false
  for (let i = 0; i < 9; i++) { if (scores[i] != null) { total += scores[i]; any = true } }
  return any ? total : null
}
function backNineTotal(scores) {
  let total = 0, any = false
  for (let i = 9; i < 18; i++) { if (scores[i] != null) { total += scores[i]; any = true } }
  return any ? total : null
}
function totalScore(scores) {
  const f = frontNineTotal(scores); const b = backNineTotal(scores)
  if (f == null && b == null) return null
  return (f ?? 0) + (b ?? 0)
}
function parFront(pars) { return pars.slice(0, 9).reduce((a, b) => a + b, 0) }
function parBack(pars)  { return pars.slice(9).reduce((a, b) => a + b, 0) }
function parTotal(pars) { return pars.reduce((a, b) => a + b, 0) }

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

  // ─── Layout (perfect Masters replica, 2026-04-30) ──────────────────────
  // The real Augusta board is forest-green panels with white block-letter
  // names, yellow PAR row, cream score tiles with red/black numerals, and
  // F9/B9/TOT columns at the right. We drop the photo column (real boards
  // don't have player photos) and add F9/B9/TOT.
  const CELL  = 30
  const ROW_H = 56
  const PRIOR = 56
  const NAME  = 132
  const SUM   = 36   // F9 / B9 / TOT column width

  // Real Augusta board palette (corrected 2026-04-30 from a reference photo):
  //   - Panels are pale teal-sage, NOT forest green
  //   - Text on panels is BLACK / dark, under-par scores in RED
  //   - The frame around the panels is dark green wood
  //   - The LEADERS banner at top is cream/tan with dark green text
  const MASTERS_GREEN      = '#0F3D1E'   // dark green wood frame + accents
  const MASTERS_GREEN_DEEP = '#0a2c14'   // deepest shadow line
  const MASTERS_TEAL       = '#A8C9C2'   // iconic Augusta panel color
  const MASTERS_TEAL_HOVER = '#9DC0B8'   // current-user tint
  const MASTERS_CREAM      = '#E8DFC2'   // banner cream (LEADERS arch)
  const MASTERS_TILE       = '#F2EBD3'   // score tile (slightly warmer cream)
  const MASTERS_RED        = '#B22222'   // under-par red
  const MASTERS_INK        = '#0F0F0F'   // over-par ink + names

  // Header cell (HOLE / PAR rows) — teal panel, black bold text
  const hCell = (w, extra = {}) => ({
    width: w, minWidth: w, height: 36,
    border: '1px solid rgba(0,0,0,0.30)',
    padding: 0,
    textAlign: 'center', verticalAlign: 'middle',
    fontSize: 13, fontWeight: 900, color: MASTERS_INK,
    fontFamily: '"Arial Black", "Arial Bold", Arial, sans-serif',
    background: MASTERS_TEAL, userSelect: 'none',
    letterSpacing: '0.04em',
    ...extra,
  })

  // Score cell (player rows) — cream tile with thin black border
  const sCell = (w, extra = {}) => ({
    width: w, minWidth: w, height: ROW_H,
    border: '1px solid rgba(0,0,0,0.45)',
    padding: 0,
    textAlign: 'center', verticalAlign: 'middle',
    fontSize: 17, fontWeight: 900,
    fontFamily: '"Arial Black", "Arial Bold", Arial, sans-serif',
    userSelect: 'none', cursor: 'pointer',
    background: MASTERS_TILE,
    color: MASTERS_INK,
    ...extra,
  })

  // Teal-panel cell used for PRIOR + NAME + F9/B9/TOT in player rows.
  // Names + numbers are black on the pale teal — matches the real board.
  const gCell = (w, extra = {}) => ({
    width: w, minWidth: w, height: ROW_H,
    border: '1px solid rgba(0,0,0,0.30)',
    padding: 0,
    textAlign: 'center', verticalAlign: 'middle',
    color: MASTERS_INK,
    fontSize: 15, fontWeight: 900,
    fontFamily: '"Arial Black", "Arial Bold", Arial, sans-serif',
    background: MASTERS_TEAL, userSelect: 'none',
    letterSpacing: '0.04em',
    ...extra,
  })

  // Real Masters boards show ~8-10 player slots even before any are filled.
  // We pad the rendered tbody with empty rows so the board fills the page.
  const PLACEHOLDER_ROWS = 8
  const emptyRowsNeeded = Math.max(0, PLACEHOLDER_ROWS - sorted.length)

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(180deg, #0a2410 0%, #0F3D1E 100%)',
      display: 'flex', flexDirection: 'column',
    }}>

      {/* Back bar */}
      <div style={{
        padding: '52px 20px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.10)', border: 'none', borderRadius: 20,
          color: '#fff', fontSize: 13, fontWeight: 700,
          padding: '7px 16px', cursor: 'pointer',
        }}>← Back</button>
        <div style={{ fontSize: 10, color: 'rgba(255,215,0,0.55)', letterSpacing: '0.08em', fontWeight: 700 }}>
          TAP SCORE TO EDIT · TAP PAR TO CHANGE
        </div>
      </div>

      {/* Board — wood-frame panel, fills remaining viewport height */}
      <div style={{
        margin: '12px 12px 12px',
        borderRadius: 6,
        overflow: 'hidden',
        background: MASTERS_GREEN,
        border: '3px solid #5a3a16',                     // hand-painted wood frame
        boxShadow: '0 12px 40px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.4)',
        flex: 1,
        display: 'flex', flexDirection: 'column',
      }}>

        {/* LEADERS — dark green block letters on cream banner, like the real board */}
        <div style={{
          background: MASTERS_CREAM,
          borderBottom: '3px solid ' + MASTERS_GREEN,
          textAlign: 'center', padding: '12px 0 8px',
          position: 'relative',
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: 42, fontWeight: 900, lineHeight: 1, color: MASTERS_GREEN,
            letterSpacing: '0.16em',
            fontFamily: '"Impact", "Arial Black", Arial, sans-serif',
            textShadow: '0 1px 0 rgba(255,255,255,0.5)',
          }}>LEADERS</div>
        </div>

        {/* Scrollable grid — flex:1 to fill the board panel */}
        <div style={{ overflowX: 'auto', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: MASTERS_TEAL, flex: 1 }}>
          <table style={{
            borderCollapse: 'collapse',
            minWidth: PRIOR + NAME + 18 * CELL + 3 * SUM,
            tableLayout: 'fixed',
          }}>
            <thead>
              {/* HOLE row — F9 / B9 / TOT columns added at end. Header
                  cells in dark-green panel with white text mimic the small
                  divider strips on the real board. */}
              <tr>
                <td style={hCell(PRIOR)}>PRIOR</td>
                <td style={{ ...hCell(NAME), textAlign: 'left', paddingLeft: 10 }}>HOLE</td>
                {pars.map((_, i) => <td key={i} style={hCell(CELL)}>{i + 1}</td>)}
                <td style={{ ...hCell(SUM), background: MASTERS_GREEN, color: '#fff' }}>F9</td>
                <td style={{ ...hCell(SUM), background: MASTERS_GREEN, color: '#fff' }}>B9</td>
                <td style={{ ...hCell(SUM), background: MASTERS_GREEN, color: '#fff' }}>TOT</td>
              </tr>
              {/* PAR row — black numbers on teal (matches the real board) */}
              <tr>
                <td style={hCell(PRIOR)}></td>
                <td style={{ ...hCell(NAME), textAlign: 'left', paddingLeft: 10 }}>PAR</td>
                {pars.map((p, i) => (
                  <td key={i} onClick={() => openPar(i)}
                    style={{ ...hCell(CELL), cursor: 'pointer' }}
                  >{p}</td>
                ))}
                <td style={{ ...hCell(SUM), background: MASTERS_GREEN, color: '#fff' }}>{parFront(pars)}</td>
                <td style={{ ...hCell(SUM), background: MASTERS_GREEN, color: '#fff' }}>{parBack(pars)}</td>
                <td style={{ ...hCell(SUM), background: MASTERS_GREEN, color: '#fff', fontSize: 14 }}>{parTotal(pars)}</td>
              </tr>
            </thead>

            <tbody>
              {sorted.map(player => {
                const played = getPlayed(player.scores)
                const stp = getScoreToPar(player.scores, pars)
                const stpStr = formatSTP(stp, played)
                const stpRed = played > 0 && stp < 0
                const f9 = frontNineTotal(player.scores)
                const b9 = backNineTotal(player.scores)
                const tot = totalScore(player.scores)
                const me = isMe(player.name, user?.name)
                // Show last name in caps if multi-word, else full name; cap at 12 chars
                const displayName = (() => {
                  const parts = player.name.trim().split(/\s+/)
                  const surname = parts.length > 1 ? parts[parts.length - 1] : parts[0]
                  return surname.toUpperCase().slice(0, 12)
                })()

                return (
                  <tr key={player.id}>
                    {/* PRIOR / score-to-par — red if under, ink if over */}
                    <td style={{
                      ...gCell(PRIOR),
                      color: stpRed ? MASTERS_RED : MASTERS_INK,
                      fontSize: 18,
                      cursor: 'default',
                      background: me ? MASTERS_TEAL_HOVER : MASTERS_TEAL,
                    }}>
                      {stpStr}
                    </td>

                    {/* Name — black block letters in caps on teal panel */}
                    <td style={{
                      ...gCell(NAME),
                      textAlign: 'left', paddingLeft: 12,
                      fontSize: 16,
                      cursor: 'default',
                      background: me ? MASTERS_TEAL_HOVER : MASTERS_TEAL,
                      borderLeft: me ? `4px solid ${MASTERS_GREEN}` : gCell(NAME).border,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {displayName}
                        </span>
                        <button onClick={() => removePlayer(player.id)} style={{
                          background: 'none', border: 'none', color: 'rgba(0,0,0,0.30)',
                          fontSize: 16, cursor: 'pointer', lineHeight: 1, flexShrink: 0, padding: '0 6px',
                        }}>×</button>
                      </div>
                    </td>

                    {/* Hole scores — cream tiles, red for under-par, ink for over.
                        Birdie/eagle = red circle(s); bogey/double = black square(s). */}
                    {player.scores.map((s, i) => {
                      const diff = s != null ? s - pars[i] : null
                      const ink = diff != null && diff < 0 ? MASTERS_RED : MASTERS_INK
                      return (
                        <td key={i} onClick={() => openScore(player.id, i)}
                          style={{
                            ...sCell(CELL),
                            color: ink,
                            background: s == null ? 'rgba(242,235,211,0.65)' : MASTERS_TILE,
                            position: 'relative',
                          }}
                        >
                          {s != null && (
                            <>
                              {/* Birdie / Eagle: red circle (or two for eagle) */}
                              {diff === -1 && <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', border: '1.8px solid ' + MASTERS_RED, pointerEvents: 'none' }} />}
                              {diff <= -2 && <>
                                <div style={{ position: 'absolute', inset: 2, borderRadius: '50%', border: '1.8px solid ' + MASTERS_RED, pointerEvents: 'none' }} />
                                <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: '1.8px solid ' + MASTERS_RED, pointerEvents: 'none' }} />
                              </>}
                              {/* Bogey / Double+: black square (or two for double) */}
                              {diff === 1 && <div style={{ position: 'absolute', inset: 3, border: '1.8px solid ' + MASTERS_INK, pointerEvents: 'none' }} />}
                              {diff >= 2 && <>
                                <div style={{ position: 'absolute', inset: 2, border: '1.8px solid ' + MASTERS_INK, pointerEvents: 'none' }} />
                                <div style={{ position: 'absolute', inset: 6, border: '1.8px solid ' + MASTERS_INK, pointerEvents: 'none' }} />
                              </>}
                              {s}
                            </>
                          )}
                        </td>
                      )
                    })}

                    {/* F9 / B9 / TOT — dark green panel cells with white numbers
                        (the green divider strips on the real board) */}
                    <td style={{ ...gCell(SUM), background: MASTERS_GREEN, color: '#fff', fontSize: 14, cursor: 'default' }}>
                      {f9 ?? ''}
                    </td>
                    <td style={{ ...gCell(SUM), background: MASTERS_GREEN, color: '#fff', fontSize: 14, cursor: 'default' }}>
                      {b9 ?? ''}
                    </td>
                    <td style={{ ...gCell(SUM), background: MASTERS_GREEN, color: '#fff', fontSize: 16, cursor: 'default' }}>
                      {tot ?? ''}
                    </td>
                  </tr>
                )
              })}

              {/* Empty placeholder rows — teal panels w/ cream tile slots,
                  matches the real Masters board's open spots */}
              {Array(emptyRowsNeeded).fill(0).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td style={{ ...gCell(PRIOR), cursor: 'default' }}></td>
                  <td style={{ ...gCell(NAME), cursor: 'default' }}>
                    {i === 0 && players.length === 0 && (
                      <div style={{
                        textAlign: 'center', color: 'rgba(15,15,15,0.45)',
                        fontFamily: '"Georgia", serif', fontStyle: 'italic',
                        fontSize: 13, fontWeight: 400, letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                      }}>
                        Add a player ↓
                      </div>
                    )}
                  </td>
                  {pars.map((_, j) => (
                    <td key={j} style={{
                      ...sCell(CELL),
                      background: 'rgba(242,235,211,0.55)',
                      cursor: 'default',
                    }}></td>
                  ))}
                  <td style={{ ...gCell(SUM), background: MASTERS_GREEN, cursor: 'default' }}></td>
                  <td style={{ ...gCell(SUM), background: MASTERS_GREEN, cursor: 'default' }}></td>
                  <td style={{ ...gCell(SUM), background: MASTERS_GREEN, cursor: 'default' }}></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add player — lives inside the board frame on a dark-green strip
            just above the footer. White input on green panel feels like
            the operator's clipboard area at the back of a real board. */}
        <div style={{
          padding: '12px 14px',
          background: MASTERS_GREEN,
          borderTop: '1px solid rgba(0,0,0,0.4)',
          flexShrink: 0,
        }}>
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
                  flex: 1, background: MASTERS_TILE, border: '2px solid ' + MASTERS_TEAL,
                  borderRadius: 6, color: MASTERS_INK, padding: '10px 12px',
                  fontSize: 14, fontWeight: 700, outline: 'none', minWidth: 0,
                  fontFamily: '"Arial Black", Arial, sans-serif',
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                }}
              />
              <button onClick={addPlayer} style={{
                background: MASTERS_TEAL, color: MASTERS_INK, border: 'none', borderRadius: 6,
                padding: '0 18px', fontSize: 13, fontWeight: 900, cursor: 'pointer',
                fontFamily: '"Arial Black", Arial, sans-serif', letterSpacing: '0.06em',
              }}>ADD</button>
              {players.length > 0 && (
                <button onClick={() => { setAddingPlayer(false); setNewName('') }} style={{
                  background: 'rgba(255,255,255,0.10)', border: 'none', borderRadius: 6,
                  padding: '0 12px', fontSize: 18, cursor: 'pointer', color: '#fff',
                }}>✕</button>
              )}
            </div>
          ) : (
            <button onClick={() => setAddingPlayer(true)} style={{
              width: '100%', padding: '11px',
              background: MASTERS_TEAL,
              border: '1px solid rgba(0,0,0,0.30)',
              borderRadius: 6, color: MASTERS_INK, fontSize: 13, fontWeight: 900,
              cursor: 'pointer', fontFamily: '"Arial Black", Arial, sans-serif',
              letterSpacing: '0.08em',
              boxShadow: '0 1px 4px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.30)',
            }}>+ ADD PLAYER</button>
          )}
        </div>

        {/* Augusta footer — wooden plaque under the board */}
        <div style={{
          background: MASTERS_GREEN,
          padding: '10px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18,
          borderTop: '2px solid #5a3a16',
          flexShrink: 0,
        }}>
          <MastersFlag size={22} />
          <div style={{
            fontFamily: '"Georgia", "Times New Roman", serif',
            fontSize: 16, color: '#fff', fontStyle: 'italic', letterSpacing: '0.10em',
            textShadow: '0 1px 0 rgba(0,0,0,0.5)',
          }}>Augusta National Club Golf</div>
          <MastersFlag size={22} />
        </div>
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
