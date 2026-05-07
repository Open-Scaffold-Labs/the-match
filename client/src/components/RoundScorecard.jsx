// RoundScorecard — bottom-sheet modal that shows a finished round's
// hole-by-hole scores. Opened from the Profile view's "Recent Rounds"
// list. Reads from GET /api/rounds/:id, which returns the round row
// plus per-hole pars from the linked outing (when set).
//
// Visual: matches the wider app's gold-on-dark theme. Front 9 and
// Back 9 stacked grids; each row is HOLE / PAR / SCORE. Score cells
// are color-coded:
//   eagle (-2 or better) — gold tile, double red circle
//   birdie  (-1)         — red numeral, single red circle
//   par      (0)         — neutral
//   bogey   (+1)         — single black square outline
//   double+ (+2 or worse)— double black square outline
//
// (2026-05-01)

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api.js'

// Synthetic par distribution — used as a fallback when the round has no
// hole_pars (e.g., legacy free-form round with no linked outing).
function estimateHolePars(coursePar = 72, holeCount = 18) {
  const target = coursePar
  const pars = Array(holeCount).fill(4)
  // Standard rule of thumb: 4 par-3s, 4 par-5s, rest par-4s for a 72.
  // Scale roughly to the user's coursePar.
  const par3s = Math.max(0, Math.round((4 * holeCount) / 18))
  const par5s = Math.max(0, Math.round((4 * holeCount) / 18))
  // Distribute par-3s on holes 3, 7, 12, 16 (default) and par-5s on 5, 9, 13, 18
  const par3Holes = [2, 6, 11, 15].slice(0, par3s)
  const par5Holes = [4, 8, 12, 17].slice(0, par5s)
  par3Holes.forEach(i => { if (i < holeCount) pars[i] = 3 })
  par5Holes.forEach(i => { if (i < holeCount) pars[i] = 5 })
  // Adjust the last few to hit target par
  let sum = pars.reduce((a, b) => a + b, 0)
  let i = 0
  while (sum !== target && i < holeCount * 2) {
    const idx = i % holeCount
    if (sum < target && pars[idx] < 5) { pars[idx]++; sum++ }
    else if (sum > target && pars[idx] > 3) { pars[idx]--; sum-- }
    i++
  }
  return pars
}

function scoreCellStyle(score, par) {
  const diff = Number(score) - Number(par)
  // Tile background, numeral color, marker SVG (eagle = double-circle, birdie = circle, etc.)
  if (!Number.isFinite(diff) || score == null || score <= 0) {
    return { bg: 'rgba(255,255,255,0.55)', color: 'rgba(13,31,18,0.30)', marker: null }
  }
  if (diff <= -2) return { bg: '#F5E070', color: '#B22222', marker: 'eagle'  }   // eagle/albatross — bright gold + double red
  if (diff === -1) return { bg: '#F2EBD3', color: '#B22222', marker: 'birdie' }  // birdie — cream + red circle
  if (diff === 0)  return { bg: '#F2EBD3', color: '#0F0F0F', marker: null     }  // par — cream
  if (diff === 1)  return { bg: '#F2EBD3', color: '#0F0F0F', marker: 'bogey'  }  // bogey — cream + black square
  return { bg: '#F2EBD3', color: '#0F0F0F', marker: 'double' }                    // double bogey or worse
}

function ScoreCell({ score, par, w = 32, h = 36 }) {
  const { bg, color, marker } = scoreCellStyle(score, par)
  const display = score != null && Number(score) > 0 ? score : '—'
  return (
    <div style={{
      width: w, height: h, position: 'relative', flexShrink: 0,
      borderRight: '1px solid rgba(0,0,0,0.45)',
      background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Arial Black", Arial, sans-serif',
      fontSize: 16, fontWeight: 900, color,
    }}>
      {marker === 'eagle' && (
        <>
          <svg width="28" height="28" style={{ position: 'absolute', inset: 4 }} viewBox="0 0 28 28">
            <circle cx="14" cy="14" r="11" fill="none" stroke="#B22222" strokeWidth="1.5" />
            <circle cx="14" cy="14" r="8.5" fill="none" stroke="#B22222" strokeWidth="1.5" />
          </svg>
        </>
      )}
      {marker === 'birdie' && (
        <svg width="28" height="28" style={{ position: 'absolute', inset: 4 }} viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="10" fill="none" stroke="#B22222" strokeWidth="1.5" />
        </svg>
      )}
      {marker === 'bogey' && (
        <svg width="28" height="28" style={{ position: 'absolute', inset: 4 }} viewBox="0 0 28 28">
          <rect x="3" y="3" width="22" height="22" fill="none" stroke="#0F0F0F" strokeWidth="1.5" />
        </svg>
      )}
      {marker === 'double' && (
        <svg width="28" height="28" style={{ position: 'absolute', inset: 4 }} viewBox="0 0 28 28">
          <rect x="3"   y="3"   width="22" height="22" fill="none" stroke="#0F0F0F" strokeWidth="1.5" />
          <rect x="6.5" y="6.5" width="15" height="15" fill="none" stroke="#0F0F0F" strokeWidth="1.5" />
        </svg>
      )}
      <span style={{ position: 'relative', zIndex: 1 }}>{display}</span>
    </div>
  )
}

// PlayerScorecardBlock — one player's section inside the scorecard popup.
// Used for both the focal player (the round's owner) and every co-participant.
// Header on the left has avatar (image or initials fallback), name + handle,
// and a "Guest" chip when applicable. Right side shows total + diff vs par
// in the same style for everyone. Below: Front 9 + Back 9 grids reusing the
// existing NineHoleGrid + color-coded ScoreCells.
//
// Account-user blocks are tappable when onTap is provided — closes the
// scorecard and opens that user's FriendProfile via the parent's
// onOpenFriend chain. Guest blocks (and the focal player if no tap is
// wanted) are non-interactive.
//
// Visual emphasis: the focal player's block gets a slightly stronger
// border so the round's "owner" reads as primary even though every
// player uses the same template. (Subtle — Matt asked for visual
// consistency, this just preserves a faint hierarchy.)
//
// (2026-05-07 PM3 — extracted to share layout between focal + partners.)
function PlayerScorecardBlock({
  name, handle, avatar, isGuest, isFocal,
  scores, total, holes, holePars, holeCount, coursePar,
  frontHoles, backHoles, onTap,
}) {
  const playerScores = (() => {
    if (!scores) return []
    return Array.isArray(scores) ? scores : (() => { try { return JSON.parse(scores) } catch { return [] } })()
  })()
  const totalNum = Number(total ?? playerScores.reduce((s, x) => s + (Number(x) || 0), 0))
  const diff = Number.isFinite(totalNum) && totalNum > 0 ? totalNum - coursePar : null
  const diffStr  = diff == null ? '—' : diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`
  const diffColor = diff == null ? 'rgba(255,255,255,0.40)' : diff < 0 ? '#F5E070' : diff === 0 ? '#fff' : '#F87171'
  const initials = (name || '·').split(' ').map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
  const canTap = typeof onTap === 'function'

  return (
    <div style={{
      marginBottom: 14,
      background: isFocal ? 'rgba(232,192,90,0.04)' : 'rgba(255,255,255,0.025)',
      border: isFocal ? '1px solid rgba(232,192,90,0.22)' : '1px solid rgba(232,192,90,0.12)',
      borderRadius: 12, padding: '10px 10px 4px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: '2px 4px 10px',
      }}>
        <button
          onClick={canTap ? onTap : undefined}
          disabled={!canTap}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            flex: 1, minWidth: 0,
            background: 'transparent', border: 'none',
            padding: 0, textAlign: 'left',
            cursor: canTap ? 'pointer' : 'default',
            color: 'inherit', fontFamily: 'inherit',
          }}
          aria-label={canTap ? `Open ${name}'s profile` : undefined}
        >
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            background: avatar ? `center/cover no-repeat url("${avatar}")` : 'rgba(232,192,90,0.18)',
            border: '1px solid rgba(232,192,90,0.30)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800, color: 'rgba(232,192,90,0.85)',
            letterSpacing: '0.04em',
          }}>
            {!avatar && initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#fff',
              lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {name}
              {isGuest && (
                <span style={{
                  fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.55)',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 6, padding: '1px 6px', marginLeft: 8,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  verticalAlign: 'middle',
                }}>Guest</span>
              )}
            </div>
            {handle && (
              <div style={{
                fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.2,
                marginTop: 1,
              }}>@{handle}</div>
            )}
          </div>
        </button>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontSize: 18, fontWeight: 900, color: '#fff',
            fontFamily: '"Arial Black", Arial, sans-serif', lineHeight: 1,
          }}>{totalNum > 0 ? totalNum : '—'}</div>
          <div style={{
            fontSize: 11, fontWeight: 800, color: diffColor,
            letterSpacing: '0.04em', marginTop: 2,
          }}>{diffStr}</div>
        </div>
      </div>
      <NineHoleGrid label="Front 9" holes={frontHoles} holePars={holePars} scores={playerScores} holeCount={holeCount} />
      {backHoles.length > 0 && (
        <NineHoleGrid label="Back 9" holes={backHoles} holePars={holePars} scores={playerScores} holeCount={holeCount} />
      )}
    </div>
  )
}

function NineHoleGrid({ label, holes, holePars, scores, holeCount }) {
  // holes is an array of zero-indexed hole indices (e.g., 0..8 for front)
  const subtotalPar = holes.reduce((s, h) => s + (holePars[h] || 4), 0)
  const subtotalScore = holes.reduce((s, h) => s + (Number(scores[h]) || 0), 0)
  const HOLE_W = 32

  return (
    <div style={{
      borderRadius: 8, overflow: 'hidden',
      background: '#1A5230',
      border: '1px solid rgba(232,192,90,0.40)',
      boxShadow: '0 4px 14px rgba(0,0,0,0.40)',
      marginBottom: 12,
    }}>
      {/* Section label */}
      <div style={{
        background: '#0F3D1E',
        color: '#F5E070', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em',
        textAlign: 'center', padding: '5px 0', textTransform: 'uppercase',
        borderBottom: '1px solid rgba(232,192,90,0.35)',
      }}>{label}</div>

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: holes.length * HOLE_W + 60, display: 'flex', flexDirection: 'column' }}>
          {/* HOLE row */}
          <div style={{ display: 'flex', height: 28, background: '#1A5230', borderBottom: '1px solid rgba(0,0,0,0.5)' }}>
            <div style={{
              width: 60, fontSize: 9, fontWeight: 800, color: '#F5E070',
              letterSpacing: '0.08em',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRight: '1px solid rgba(0,0,0,0.5)',
            }}>HOLE</div>
            {holes.map(h => (
              <div key={h} style={{
                width: HOLE_W, fontSize: 13, fontWeight: 900, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRight: '1px solid rgba(0,0,0,0.45)',
                fontFamily: '"Arial Black", Arial, sans-serif',
              }}>{h + 1}</div>
            ))}
            <div style={{
              width: 38, fontSize: 11, fontWeight: 800, color: '#F5E070',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>TOT</div>
          </div>

          {/* PAR row */}
          <div style={{ display: 'flex', height: 28, background: '#1A5230', borderBottom: '1px solid rgba(0,0,0,0.5)' }}>
            <div style={{
              width: 60, fontSize: 9, fontWeight: 800, color: '#F5E070',
              letterSpacing: '0.08em',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRight: '1px solid rgba(0,0,0,0.5)',
            }}>PAR</div>
            {holes.map(h => (
              <div key={h} style={{
                width: HOLE_W, fontSize: 13, fontWeight: 900, color: '#F5E070',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRight: '1px solid rgba(0,0,0,0.45)',
                fontFamily: '"Arial Black", Arial, sans-serif',
              }}>{holePars[h] || 4}</div>
            ))}
            <div style={{
              width: 38, fontSize: 13, fontWeight: 900, color: '#F5E070',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: '"Arial Black", Arial, sans-serif',
            }}>{subtotalPar}</div>
          </div>

          {/* SCORE row */}
          <div style={{ display: 'flex', height: 36 }}>
            <div style={{
              width: 60, fontSize: 9, fontWeight: 800, color: '#fff',
              letterSpacing: '0.08em',
              background: '#0F3D1E',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRight: '1px solid rgba(0,0,0,0.5)',
            }}>SCORE</div>
            {holes.map(h => (
              <ScoreCell key={h} score={scores[h]} par={holePars[h] || 4} w={HOLE_W} h={36} />
            ))}
            <div style={{
              width: 38, fontSize: 14, fontWeight: 900, color: '#F5E070',
              background: '#0F3D1E',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: '"Arial Black", Arial, sans-serif',
            }}>{subtotalScore || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RoundScorecard({ roundId, onClose, onOpenFriend }) {
  const [round, setRound] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api(`/api/rounds/${roundId}`)
      .then(r => { if (!cancelled) { setRound(r); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e?.message || 'Failed to load round'); setLoading(false) } })
    return () => { cancelled = true }
  }, [roundId])

  // Parse scores + hole pars, with a sensible synthetic fallback when
  // hole_pars wasn't stored on the linked outing.
  const scores = (() => {
    if (!round?.scores) return []
    return Array.isArray(round.scores) ? round.scores : (() => { try { return JSON.parse(round.scores) } catch { return [] } })()
  })()
  const holeCount = scores.length || 18
  const holePars = (() => {
    if (round?.hole_pars) {
      const arr = Array.isArray(round.hole_pars) ? round.hole_pars : (() => { try { return JSON.parse(round.hole_pars) } catch { return null } })()
      if (Array.isArray(arr) && arr.length >= holeCount) return arr.slice(0, holeCount)
    }
    return estimateHolePars(round?.course_par ?? 72, holeCount)
  })()

  // Highlights — count of each scoring category for the summary row
  const highlights = (() => {
    let eagles = 0, birdies = 0, pars = 0, bogeys = 0, doubles = 0
    scores.forEach((s, i) => {
      const sc = Number(s); const par = holePars[i] || 4
      if (!Number.isFinite(sc) || sc <= 0) return
      const d = sc - par
      if (d <= -2)      eagles++
      else if (d === -1) birdies++
      else if (d === 0)  pars++
      else if (d === 1)  bogeys++
      else               doubles++
    })
    return { eagles, birdies, pars, bogeys, doubles }
  })()

  const total    = Number(round?.total ?? 0)
  const coursePar = Number(round?.course_par ?? 72)
  const diff     = Number.isFinite(total) && total > 0 ? total - coursePar : null
  const diffStr  = diff == null ? '—' : diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`
  const diffColor = diff == null ? 'rgba(255,255,255,0.40)' : diff < 0 ? '#F5E070' : diff === 0 ? '#fff' : '#F87171'

  const frontHoles = Array.from({ length: Math.min(9, holeCount) }, (_, i) => i)
  const backHoles  = holeCount > 9 ? Array.from({ length: holeCount - 9 }, (_, i) => i + 9) : []

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end',
      justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430,
        background: 'linear-gradient(180deg, #0A1F10 0%, #0D2615 60%, #071209 100%)',
        borderRadius: '20px 20px 0 0',
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        border: '1px solid rgba(232,192,90,0.18)',
      }}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(232,192,90,0.30)', margin: '12px auto 8px' }} />

        {/* Header */}
        <div style={{ padding: '4px 20px 14px', borderBottom: '1px solid rgba(232,192,90,0.18)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: 'rgba(232,192,90,0.65)',
                letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 4,
              }}>Round Scorecard</div>
              <div style={{
                fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1.2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{round?.outing_course_name ?? round?.course_name ?? '—'}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                {round?.date ? new Date(round.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''}
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 8, color: 'rgba(255,255,255,0.7)', fontSize: 18,
              cursor: 'pointer', padding: '4px 10px', lineHeight: 1, height: 32,
            }}>✕</button>
          </div>

          {/* Course par hint stays in the outer header — the per-player
              total + diff moved into the player-card blocks below so the
              focal player's row matches the playing-partners' row style.
              (2026-05-07 PM3 — Matt: 'my scorecard should look the same
              as the playing partners do with the profile picture, name,
              and round score to the top right just as theirs appear'.) */}
          <div style={{
            marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.40)',
            letterSpacing: '0.10em', textTransform: 'uppercase',
          }}>
            Par {coursePar}
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 14, flex: 1 }}>
          {loading && (
            <div style={{ padding: 32, textAlign: 'center', color: 'rgba(255,255,255,0.40)', fontSize: 13 }}>
              Loading scorecard…
            </div>
          )}
          {error && (
            <div style={{ padding: 28, textAlign: 'center', color: '#F87171', fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && (
            <>
              {/* Focal player — the round's owner. Same card template as
                  partners; isFocal=true gives a subtle stronger border.
                  Not tappable (it's the user whose profile we're already
                  on; tapping their pic to "go to themselves" is a no-op
                  by design — the parent handles that case if needed). */}
              <PlayerScorecardBlock
                name={round?.owner_name || 'You'}
                handle={round?.owner_handle}
                avatar={round?.owner_avatar}
                isGuest={false}
                isFocal={true}
                scores={scores}
                total={total}
                holes={frontHoles}
                holePars={holePars}
                holeCount={holeCount}
                coursePar={coursePar}
                frontHoles={frontHoles}
                backHoles={backHoles}
                onTap={undefined}
              />

              {/* Playing partners — every other player in the same outing.
                  Same card template as the focal player. Account-user
                  avatars + names are tap targets that open that user's
                  FriendProfile via onOpenFriend. Guests are non-tappable.
                  Added 2026-05-07 PM3; refactored to share the
                  PlayerScorecardBlock template same day. */}
              {Array.isArray(round?.co_participants) && round.co_participants.length > 0 && (
                <div style={{ marginTop: 14, marginBottom: 4 }}>
                  <div style={{
                    fontSize: 10, fontWeight: 800, color: 'rgba(232,192,90,0.65)',
                    letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10,
                    paddingLeft: 2,
                  }}>
                    Playing partners
                  </div>
                  {round.co_participants.map((p, idx) => {
                    const canNavigate = !p.is_guest && p.user_id && typeof onOpenFriend === 'function'
                    const onTap = canNavigate
                      ? () => onOpenFriend({ id: p.user_id, name: p.name, handle: p.handle, avatar: p.avatar })
                      : undefined
                    return (
                      <PlayerScorecardBlock
                        key={p.user_id ?? `guest-${idx}`}
                        name={p.name}
                        handle={p.handle}
                        avatar={p.avatar}
                        isGuest={!!p.is_guest}
                        isFocal={false}
                        scores={p.scores}
                        total={p.total}
                        holes={frontHoles}
                        holePars={holePars}
                        holeCount={holeCount}
                        coursePar={coursePar}
                        frontHoles={frontHoles}
                        backHoles={backHoles}
                        onTap={onTap}
                      />
                    )
                  })}
                </div>
              )}

              {/* Highlights row */}
              {(highlights.eagles + highlights.birdies + highlights.pars + highlights.bogeys + highlights.doubles) > 0 && (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6,
                  marginTop: 6, marginBottom: 12,
                }}>
                  {[
                    { label: 'EAGLE',  value: highlights.eagles,  accent: '#F5E070' },
                    { label: 'BIRDIE', value: highlights.birdies, accent: '#F5E070' },
                    { label: 'PAR',    value: highlights.pars,    accent: '#fff'    },
                    { label: 'BOGEY',  value: highlights.bogeys,  accent: 'rgba(255,255,255,0.65)' },
                    { label: 'DBL+',   value: highlights.doubles, accent: '#F87171' },
                  ].map(h => (
                    <div key={h.label} style={{
                      borderRadius: 10, padding: '8px 4px', textAlign: 'center',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(232,192,90,0.16)',
                    }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: h.accent, lineHeight: 1 }}>{h.value}</div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.40)', letterSpacing: '0.08em', marginTop: 4 }}>{h.label}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
