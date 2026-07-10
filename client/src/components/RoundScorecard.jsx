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
import ShotEditor from '../pages/ShotEditor.jsx'

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

// Score cell palette — Option A (2026-05-07 PM3 — Matt: 'unify on dark
// green'). Background stays the same dark green as HOLE + PAR rows so
// the whole grid reads as one connected scorecard. Score-quality is
// communicated by NUMERAL color + a thin marker outline that draws on
// top of the green:
//   eagle   — bright gold numeral + double red-orange circle
//   birdie  — red numeral        + single red circle
//   par     — white numeral      + no marker
//   bogey   — white numeral      + soft white square
//   double+ — white numeral      + soft white double-square
// Empty cells (no score yet) show a faint placeholder.
function scoreCellStyle(score, par) {
  const diff = Number(score) - Number(par)
  if (!Number.isFinite(diff) || score == null || score <= 0) {
    return { bg: '#1A5230', color: 'rgba(255,255,255,0.30)', marker: null }
  }
  if (diff <= -2) return { bg: '#1A5230', color: '#F5E070', marker: 'eagle'  }
  if (diff === -1) return { bg: '#1A5230', color: '#FF6B6B', marker: 'birdie' }
  if (diff === 0)  return { bg: '#1A5230', color: '#fff',    marker: null     }
  if (diff === 1)  return { bg: '#1A5230', color: '#fff',    marker: 'bogey'  }
  return { bg: '#1A5230', color: '#fff', marker: 'double' }
}

// Default score-cell dims match the HOLE + PAR rows (32×28, fontSize 13).
// Was 32×36 + fontSize 16 before — Matt 2026-05-07 PM3: "the entered
// scores look super cheap and are not matching up with the hole and par
// cells above them when they should be same size and look". Markers
// scale down proportionally so they still pop without overflowing.
function ScoreCell({ score, par, w = 32, h = 28 }) {
  const { bg, color, marker } = scoreCellStyle(score, par)
  const display = score != null && Number(score) > 0 ? score : '—'
  // Marker SVG occupies most of the cell height; inset 2px so it doesn't
  // touch the borders. ViewBox stays 28 so existing path math still works.
  const markerSize = h - 4
  return (
    <div style={{
      width: w, height: h, position: 'relative', flexShrink: 0,
      borderRight: '1px solid rgba(0,0,0,0.45)',
      background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Arial Black", Arial, sans-serif',
      fontSize: 13, fontWeight: 900, color,
    }}>
      {/* Marker strokes adjusted for dark-green background (Option A,
          2026-05-07 PM3): eagle + birdie use the same red-orange so the
          marker matches the score-quality color story; bogey + double+
          use semi-transparent white so they read as quiet annotations
          instead of competing with the numeral. */}
      {marker === 'eagle' && (
        <svg width={markerSize} height={markerSize} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="11" fill="none" stroke="#FF6B6B" strokeWidth="1.5" />
          <circle cx="14" cy="14" r="8.5" fill="none" stroke="#FF6B6B" strokeWidth="1.5" />
        </svg>
      )}
      {marker === 'birdie' && (
        <svg width={markerSize} height={markerSize} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="10" fill="none" stroke="#FF6B6B" strokeWidth="1.5" />
        </svg>
      )}
      {marker === 'bogey' && (
        <svg width={markerSize} height={markerSize} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} viewBox="0 0 28 28">
          <rect x="3" y="3" width="22" height="22" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
        </svg>
      )}
      {marker === 'double' && (
        <svg width={markerSize} height={markerSize} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} viewBox="0 0 28 28">
          <rect x="3"   y="3"   width="22" height="22" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
          <rect x="6.5" y="6.5" width="15" height="15" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" />
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
      {/* Per-player highlights — eagle / birdie / par / bogey / dbl+ counts
          for THIS player's round only. Was previously a single global row
          at the bottom of the modal that confusingly only reflected the
          focal player's stats; moved here so each player's stats sit in
          their own card. (2026-05-07 PM3 — Matt: 'should show under each
          players card with their relevant stats'.) */}
      <PlayerHighlights scores={playerScores} holePars={holePars} />
    </div>
  )
}

// Compact 5-tile highlights row computed from a player's scores +
// the course's hole pars. Shared between PlayerScorecardBlock and any
// other place that wants a per-player highlights summary.
function PlayerHighlights({ scores, holePars }) {
  let eagles = 0, birdies = 0, pars = 0, bogeys = 0, doubles = 0
  ;(scores || []).forEach((s, i) => {
    const sc = Number(s); const par = (holePars && holePars[i]) || 4
    if (!Number.isFinite(sc) || sc <= 0) return
    const d = sc - par
    if (d <= -2)      eagles++
    else if (d === -1) birdies++
    else if (d === 0)  pars++
    else if (d === 1)  bogeys++
    else               doubles++
  })
  if (eagles + birdies + pars + bogeys + doubles === 0) return null
  const tiles = [
    { label: 'EAGLE',  value: eagles,  accent: '#F5E070' },
    { label: 'BIRDIE', value: birdies, accent: '#F5E070' },
    { label: 'PAR',    value: pars,    accent: '#fff'    },
    { label: 'BOGEY',  value: bogeys,  accent: 'rgba(255,255,255,0.65)' },
    { label: 'DBL+',   value: doubles, accent: '#F87171' },
  ]
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5,
      marginTop: 8, marginBottom: 6,
    }}>
      {tiles.map(t => (
        <div key={t.label} style={{
          borderRadius: 8, padding: '6px 4px', textAlign: 'center',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(232,192,90,0.16)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: t.accent, lineHeight: 1 }}>{t.value}</div>
          <div style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,0.40)', letterSpacing: '0.08em', marginTop: 3 }}>{t.label}</div>
        </div>
      ))}
    </div>
  )
}

function NineHoleGrid({ label, holes, holePars, scores, holeCount }) {
  // holes is an array of zero-indexed hole indices (e.g., 0..8 for front)
  const subtotalPar = holes.reduce((s, h) => s + (holePars[h] || 4), 0)
  const subtotalScore = holes.reduce((s, h) => s + (Number(scores[h]) || 0), 0)
  const HOLE_W = 32
  const LABEL_W = 60   // left-most cell ("HOLE" / "PAR" / "SCORE")
  const TOT_W = 38     // right-most cell ("TOT" / subtotal)
  // Total grid width — used as minWidth so the inner row can scroll
  // horizontally if the screen is too narrow but never compress cells
  // unevenly between rows. Bug fix 2026-05-07 PM3: prior minWidth missed
  // the TOT column, allowing rows to compress slightly so cells didn't
  // line up vertically. flexShrink:0 on every cell guarantees no row
  // compresses while siblings stay full width.
  const ROW_W = LABEL_W + holes.length * HOLE_W + TOT_W

  return (
    <div style={{
      borderRadius: 8, overflow: 'hidden',
      background: '#1A5230',
      border: '1px solid rgba(232,192,90,0.40)',
      boxShadow: '0 4px 14px rgba(0,0,0,0.40)',
      marginBottom: 12,
    }}>
      {/* Section label — "FRONT 9" / "BACK 9" centered, plus the player's
          subtotal pushed to the right edge so the 9-hole score is visible
          at a glance without scanning the grid. The label stays
          horizontally centered (absolute-positioning trick) so it doesn't
          shift when the subtotal width changes (single vs double digit).
          (2026-05-07 PM3 — Matt: 'put the players total score for the
          front nine next to front 9'.) */}
      <div style={{
        position: 'relative',
        background: '#0F3D1E',
        padding: '5px 12px', minHeight: 22,
        borderBottom: '1px solid rgba(232,192,90,0.35)',
        display: 'flex', alignItems: 'center',
      }}>
        <div style={{
          position: 'absolute', left: 0, right: 0,
          textAlign: 'center',
          color: '#F5E070', fontSize: 10, fontWeight: 800,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          pointerEvents: 'none',
        }}>{label}</div>
        <div style={{
          marginLeft: 'auto',
          color: '#fff', fontSize: 13, fontWeight: 900,
          fontFamily: '"Arial Black", Arial, sans-serif',
          lineHeight: 1,
          position: 'relative', zIndex: 1,
        }}>{subtotalScore > 0 ? subtotalScore : '—'}</div>
      </div>

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: ROW_W, display: 'flex', flexDirection: 'column' }}>
          {/* HOLE row — every cell has flexShrink:0 so it never compresses
              when sibling rows have differently-sized cells. Widths
              referenced from the LABEL_W / HOLE_W / TOT_W constants so
              all three rows are guaranteed pixel-identical. */}
          <div style={{ display: 'flex', height: 28, background: '#1A5230', borderBottom: '1px solid rgba(0,0,0,0.5)' }}>
            <div style={{
              width: LABEL_W, flexShrink: 0,
              fontSize: 9, fontWeight: 800, color: '#F5E070',
              letterSpacing: '0.08em',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRight: '1px solid rgba(0,0,0,0.5)',
            }}>HOLE</div>
            {holes.map(h => (
              <div key={h} style={{
                width: HOLE_W, flexShrink: 0,
                fontSize: 13, fontWeight: 900, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRight: '1px solid rgba(0,0,0,0.45)',
                fontFamily: '"Arial Black", Arial, sans-serif',
              }}>{h + 1}</div>
            ))}
            <div style={{
              width: TOT_W, flexShrink: 0,
              fontSize: 11, fontWeight: 800, color: '#F5E070',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>TOT</div>
          </div>

          {/* PAR row */}
          <div style={{ display: 'flex', height: 28, background: '#1A5230', borderBottom: '1px solid rgba(0,0,0,0.5)' }}>
            <div style={{
              width: LABEL_W, flexShrink: 0,
              fontSize: 9, fontWeight: 800, color: '#F5E070',
              letterSpacing: '0.08em',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRight: '1px solid rgba(0,0,0,0.5)',
            }}>PAR</div>
            {holes.map(h => (
              <div key={h} style={{
                width: HOLE_W, flexShrink: 0,
                fontSize: 13, fontWeight: 900, color: '#F5E070',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRight: '1px solid rgba(0,0,0,0.45)',
                fontFamily: '"Arial Black", Arial, sans-serif',
              }}>{holePars[h] || 4}</div>
            ))}
            <div style={{
              width: TOT_W, flexShrink: 0,
              fontSize: 13, fontWeight: 900, color: '#F5E070',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: '"Arial Black", Arial, sans-serif',
            }}>{subtotalPar}</div>
          </div>

          {/* SCORE row — same dark-green background as HOLE + PAR rows
              (Option A unification, 2026-05-07 PM3). The label + total
              cells get a slightly darker green tint to read as 'header'
              ends; the data cells in the middle use the plain row green
              with color-coded numerals + thin marker outlines drawing
              the score-quality story. */}
          <div style={{ display: 'flex', height: 28, background: '#1A5230' }}>
            <div style={{
              width: LABEL_W, flexShrink: 0,
              fontSize: 9, fontWeight: 800, color: '#fff',
              letterSpacing: '0.08em',
              background: '#0F3D1E',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRight: '1px solid rgba(0,0,0,0.5)',
            }}>SCORE</div>
            {holes.map(h => (
              <ScoreCell key={h} score={scores[h]} par={holePars[h] || 4} w={HOLE_W} h={28} />
            ))}
            <div style={{
              width: TOT_W, flexShrink: 0,
              fontSize: 13, fontWeight: 900, color: '#F5E070',
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

// ── Putt entry sheet — post-hoc SG putt facts (docs/SG-DESIGN.md) ────────────
// Hole-by-hole quick entry with auto-advance: pick the putt count, then (for
// 1+ putts) the first-putt distance; the sheet moves to the next hole on its
// own. Skip leaves a hole null — SG simply ignores it. This is how OUTING
// rounds get putt data: match close fans out per-player tm_rounds, and each
// player tags their own putts here afterwards. Works for solo rounds too.
const PUTT_SHEET_BUCKETS = [
  { key: 'in3',    label: '<3 ft' },
  { key: '3-10',   label: '3–10' },
  { key: '10-25',  label: '10–25' },
  { key: '25plus', label: '25+ ft' },
]

function PuttEntrySheet({ holeCount, initialPutts, initialFirstPutts, saving, onSave, onClose }) {
  const [putts, setPutts] = useState(() => {
    const base = new Array(holeCount).fill(null)
    if (Array.isArray(initialPutts)) initialPutts.slice(0, holeCount).forEach((p, i) => { base[i] = p ?? null })
    return base
  })
  const [firstPutts, setFirstPutts] = useState(() => {
    const base = new Array(holeCount).fill(null)
    if (Array.isArray(initialFirstPutts)) initialFirstPutts.slice(0, holeCount).forEach((b, i) => { base[i] = b ?? null })
    return base
  })
  const [idx, setIdx] = useState(() => {
    const first = putts.findIndex(p => p == null)
    return first >= 0 ? first : 0
  })
  const done = putts.filter(p => p != null).length

  function advance() { setIdx(i => Math.min(i + 1, holeCount - 1)) }

  function pickCount(n) {
    setPutts(arr => { const c = [...arr]; c[idx] = n; return c })
    if (n === 0) {
      setFirstPutts(arr => { const c = [...arr]; c[idx] = null; return c })
      advance()
    }
  }
  function pickBucket(b) {
    setFirstPutts(arr => { const c = [...arr]; c[idx] = b; return c })
    advance()
  }
  function skip() {
    setPutts(arr => { const c = [...arr]; c[idx] = null; return c })
    setFirstPutts(arr => { const c = [...arr]; c[idx] = null; return c })
    advance()
  }

  const chip = (active) => ({
    padding: '10px 0', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer',
    background: active ? 'rgba(232,192,90,0.22)' : 'rgba(255,255,255,0.06)',
    border: active ? '1.5px solid rgba(232,192,90,0.55)' : '1px solid rgba(255,255,255,0.12)',
    color: active ? '#F5E070' : 'rgba(255,255,255,0.75)',
  })

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430,
        background: 'linear-gradient(180deg, #0A1F10 0%, #0D2615 60%, #071209 100%)',
        border: '1px solid rgba(232,192,90,0.18)', borderRadius: '20px 20px 0 0',
        padding: '14px 20px calc(20px + env(safe-area-inset-bottom))',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(232,192,90,0.30)', margin: '0 auto 14px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#F5E070' }}>Putts — unlock strokes gained</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>{done}/{holeCount} holes tagged</div>
        </div>

        {/* Hole scrubber */}
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 10, marginBottom: 4 }}>
          {Array.from({ length: holeCount }, (_, i) => (
            <button key={i} onClick={() => setIdx(i)} style={{
              flexShrink: 0, width: 30, height: 30, borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer',
              background: i === idx ? 'rgba(232,192,90,0.25)' : putts[i] != null ? 'rgba(42,122,56,0.30)' : 'rgba(255,255,255,0.05)',
              border: i === idx ? '1.5px solid rgba(232,192,90,0.60)' : '1px solid rgba(255,255,255,0.10)',
              color: i === idx ? '#F5E070' : putts[i] != null ? '#8FCB9B' : 'rgba(255,255,255,0.5)',
            }}>{i + 1}</button>
          ))}
        </div>

        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', margin: '6px 0 8px' }}>
          Hole {idx + 1} — how many putts?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 12 }}>
          {[0, 1, 2, 3, 4].map(n => (
            <button key={n} onClick={() => pickCount(n)} style={chip(putts[idx] === n)}>
              {n === 4 ? '4+' : n}
            </button>
          ))}
        </div>

        {putts[idx] != null && putts[idx] > 0 && (
          <>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>First putt from…</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
              {PUTT_SHEET_BUCKETS.map(b => (
                <button key={b.key} onClick={() => pickBucket(b.key)} style={chip(firstPutts[idx] === b.key)}>
                  {b.label}
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button onClick={skip} style={{
            flex: 1, padding: 13, borderRadius: 12, cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.6)', fontWeight: 700, fontSize: 13,
          }}>Skip hole</button>
          <button disabled={saving || done === 0} onClick={() => onSave(putts, firstPutts)} style={{
            flex: 2, padding: 13, borderRadius: 12, border: 'none',
            cursor: (saving || done === 0) ? 'default' : 'pointer',
            background: (saving || done === 0) ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, rgba(232,192,90,0.95), rgba(201,160,64,0.95))',
            color: (saving || done === 0) ? 'rgba(255,255,255,0.35)' : 'var(--tm-text)',
            fontWeight: 800, fontSize: 14,
          }}>{saving ? 'Saving…' : `Save ${done} hole${done === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function RoundScorecard({ roundId, onClose, onOpenFriend, canEditPutts = false }) {
  const [round, setRound] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [puttSheetOpen, setPuttSheetOpen] = useState(false)
  const [savingPutts, setSavingPutts] = useState(false)
  const [shotEditorOpen, setShotEditorOpen] = useState(false) // Phase 3 flyover editor

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

  const total    = Number(round?.total ?? 0)
  const coursePar = Number(round?.course_par ?? 72)
  const diff     = Number.isFinite(total) && total > 0 ? total - coursePar : null
  const diffStr  = diff == null ? '—' : diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`
  const diffColor = diff == null ? 'rgba(255,255,255,0.40)' : diff < 0 ? '#F5E070' : diff === 0 ? '#fff' : '#F87171'

  // Standings — sort focal + co_participants by total ASC for the
  // header line "1. James R 81 · 2. You 82 · ...". The focal player
  // shows as "You" so it reads naturally on your own profile.
  // (2026-05-07 PM3 — Matt: 'put the standings results in the header
  // under the date'.)
  const standings = (() => {
    const focalEntry = {
      isFocal: true,
      name: 'You',
      total: Number.isFinite(total) && total > 0 ? total : null,
    }
    const partnerEntries = (round?.co_participants || []).map(p => ({
      isFocal: false,
      name: (p.name || '').split(' ')[0] || (p.is_guest ? 'Guest' : '·'),
      total: p.total != null ? Number(p.total) : null,
    }))
    return [focalEntry, ...partnerEntries]
      .filter(e => Number.isFinite(e.total))
      .sort((a, b) => a.total - b.total)
  })()

  const frontHoles = Array.from({ length: Math.min(9, holeCount) }, (_, i) => i)
  const backHoles  = holeCount > 9 ? Array.from({ length: holeCount - 9 }, (_, i) => i + 9) : []

  // Post-hoc SG putt facts (owner-only; docs/SG-DESIGN.md)
  const roundPutts = (() => {
    if (!round?.putts) return null
    const arr = Array.isArray(round.putts) ? round.putts : (() => { try { return JSON.parse(round.putts) } catch { return null } })()
    return Array.isArray(arr) ? arr : null
  })()
  const roundFirstPutts = (() => {
    if (!round?.first_putts) return null
    const arr = Array.isArray(round.first_putts) ? round.first_putts : (() => { try { return JSON.parse(round.first_putts) } catch { return null } })()
    return Array.isArray(arr) ? arr : null
  })()
  const puttHolesTagged = roundPutts ? roundPutts.filter(p => p != null).length : 0

  // Phase 3 (2026-07-10) — per-shot facts for the flyover editor button.
  const roundShots = (() => {
    if (!round?.shots) return null
    const arr = Array.isArray(round.shots) ? round.shots : (() => { try { return JSON.parse(round.shots) } catch { return null } })()
    return Array.isArray(arr) ? arr : null
  })()
  const shotHolesTagged = roundShots ? roundShots.filter(h => Array.isArray(h) && h.length > 0).length : 0

  async function savePutts(putts, firstPutts) {
    setSavingPutts(true)
    try {
      const r = await api(`/api/rounds/${roundId}/putts`, {
        method: 'PATCH',
        body: JSON.stringify({ putts, firstPutts }),
      })
      setRound(prev => ({ ...prev, putts: r.putts, first_putts: r.first_putts }))
      setPuttSheetOpen(false)
    } catch { /* keep the sheet open so nothing is lost */ } finally {
      setSavingPutts(false)
    }
  }

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

          {/* Standings — finishing order across all players in the round.
              Sorted by total ASC, so the actual winner is "1." regardless
              of the card display order below (which keeps focal player
              first by design). (2026-05-07 PM3.) */}
          {standings.length >= 2 && (
            <div style={{
              marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.65)',
              lineHeight: 1.5, fontWeight: 600,
            }}>
              {standings.map((e, i) => (
                <span key={i}>
                  <span style={{
                    color: i === 0 ? '#F5E070' : 'rgba(255,255,255,0.55)',
                    fontWeight: 800, marginRight: 4,
                  }}>{i + 1}.</span>
                  <span style={{ color: e.isFocal ? '#F5E070' : '#fff' }}>{e.name}</span>
                  <span style={{ color: 'rgba(255,255,255,0.50)', marginLeft: 5 }}>{e.total}</span>
                  {i < standings.length - 1 && (
                    <span style={{ color: 'rgba(255,255,255,0.25)', margin: '0 8px' }}>·</span>
                  )}
                </span>
              ))}
            </div>
          )}
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
              {/* Putt facts — owner-only post-hoc entry (docs/SG-DESIGN.md).
                  This is how outing rounds join the SG dataset: match close
                  fans out per-player rounds, then each player tags their own
                  putts here. */}
              {canEditPutts && scores.length > 0 && (
                <button onClick={() => setPuttSheetOpen(true)} style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  borderRadius: 12, marginBottom: 12, padding: '11px 14px',
                  background: puttHolesTagged > 0 ? 'rgba(42,122,56,0.14)' : 'rgba(232,192,90,0.10)',
                  border: puttHolesTagged > 0 ? '1px solid rgba(42,122,56,0.35)' : '1px solid rgba(232,192,90,0.30)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: puttHolesTagged > 0 ? '#8FCB9B' : '#F5E070' }}>
                    {puttHolesTagged > 0
                      ? `Putts tagged on ${puttHolesTagged}/${scores.length} holes`
                      : 'Add putts — unlock strokes gained'}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}>
                    {puttHolesTagged > 0 ? 'Edit' : '+'}
                  </span>
                </button>
              )}

              {/* Phase 3 (2026-07-10) — flyover shot editor entry, sibling of
                  the putts button (owner-only). Zero-capture rounds welcome:
                  the editor supports full post-hoc entry. */}
              {canEditPutts && scores.length > 0 && (
                <button onClick={() => setShotEditorOpen(true)} style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  borderRadius: 12, marginBottom: 12, padding: '11px 14px',
                  background: shotHolesTagged > 0 ? 'rgba(42,122,56,0.14)' : 'rgba(232,192,90,0.10)',
                  border: shotHolesTagged > 0 ? '1px solid rgba(42,122,56,0.35)' : '1px solid rgba(232,192,90,0.30)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: shotHolesTagged > 0 ? '#8FCB9B' : '#F5E070' }}>
                    {shotHolesTagged > 0
                      ? `Shots tagged on ${shotHolesTagged}/${scores.length} holes`
                      : 'Review shots — see your round on the map'}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}>
                    {shotHolesTagged > 0 ? 'Edit' : '+'}
                  </span>
                </button>
              )}
              {shotEditorOpen && (
                <ShotEditor roundId={roundId} onClose={() => {
                  setShotEditorOpen(false)
                  // refresh the card so the tagged-count + any putt edits show
                  api(`/api/rounds/${roundId}`).then(setRound).catch(() => {})
                }} />
              )}

              {/* Focal player — the round's owner. Same card template
                  as partners; isFocal=true gives a subtle stronger
                  border. Tapping your own avatar simply closes the
                  scorecard (returning to whichever profile view opened
                  it) — clicking yourself to navigate to your own profile
                  is a no-op semantically, so closing is the most useful
                  affordance. (2026-05-07 PM3.) */}
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
                onTap={onClose}
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

              {/* Old global highlights row was removed 2026-05-07 PM3 —
                  it had only the focal player's stats but read as an
                  aggregate. Highlights are now per-card via PlayerHighlights. */}
            </>
          )}
        </div>
      </div>

      {/* Putt entry — stacks above via its own portal */}
      {puttSheetOpen && (
        <PuttEntrySheet
          holeCount={scores.length || holeCount}
          initialPutts={roundPutts}
          initialFirstPutts={roundFirstPutts}
          saving={savingPutts}
          onSave={savePutts}
          onClose={() => setPuttSheetOpen(false)}
        />
      )}
    </div>,
    document.body
  )
}
