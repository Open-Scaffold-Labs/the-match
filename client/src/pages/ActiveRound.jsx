import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api, post } from '../lib/api.js'
import {
  tmHaptic,
  initials,
  avatarBg,
  AUGUSTA_TILE,
  AUGUSTA_INK,
  AUGUSTA_RED,
  AUGUSTA_GOLD,
  AUGUSTA_GREEN_DEEP,
  AUGUSTA_PANEL,
  AUGUSTA_PANEL_HI,
  AUGUSTA_PANEL_HOVER,
  AUGUSTA_TEXT,
} from './Outing/shared.jsx'
import { CoursePicker } from './Outing/CreateWizard.jsx'

const CLUBS = [
  { label: 'Dr', name: 'Driver' },
  { label: '3W', name: '3-Wood' },
  { label: '5W', name: '5-Wood' },
  { label: '3H', name: '3-Hybrid' },
  { label: '4H', name: '4-Hybrid' },
  { label: '4i', name: '4-Iron' },
  { label: '5i', name: '5-Iron' },
  { label: '6i', name: '6-Iron' },
  { label: '7i', name: '7-Iron' },
  { label: '8i', name: '8-Iron' },
  { label: '9i', name: '9-Iron' },
  { label: 'PW', name: 'Pitching Wedge' },
  { label: 'GW', name: 'Gap Wedge' },
  { label: 'SW', name: 'Sand Wedge' },
  { label: 'LW', name: 'Lob Wedge' },
  { label: 'Pt', name: 'Putter' },
]

const DEFAULT_PARS = [4,4,3,4,5,4,3,5,4, 4,4,3,4,5,4,3,5,4]

function scoreColor(strokes, par) {
  if (!strokes || !par) return 'var(--tm-text-2)'
  const d = strokes - par
  if (d <= -2) return 'var(--tm-eagle)'
  if (d === -1) return 'var(--tm-birdie)'
  if (d === 0)  return 'var(--tm-par)'
  if (d === 1)  return 'var(--tm-bogey)'
  return 'var(--tm-double)'
}
// ─── Setup Sheet ────────────────────────────────────────────────────────────
// Solo-round setup. Mirrors CreateWizard's "Set the Stage" step visually
// — same CoursePicker (real GolfCourseAPI search + tee selection), same
// Holes chip pattern, same uppercase letter-spaced section labels, same
// surface-2 input bg — but drops every multi-player concern (match name,
// golfers count, scoring format, handicap allowance, team breakdown) and
// the old manual par grid (the picker auto-populates pars from the
// chosen tee; free-form course names fall back to DEFAULT_PARS).
// (2026-05-07 PM — Matt: 'setup screen should be exactly the same as
// the other just without the multiplayer questions'.)
function SetupSheet({ onStart, onBack }) {
  // courseSelection holds the picked tee's data (courseId, courseName,
  // courseTee, holePars, coursePar, courseRating, slopeRating). Null when
  // the user hasn't picked one. typedName is the free-form fallback when
  // the API doesn't have the course (or the user chose not to pick one).
  const [courseSelection, setCourseSelection] = useState(null)
  const [typedName, setTypedName] = useState('')
  const [holes, setHoles] = useState(18)

  function handleStart() {
    let pars
    let courseName
    if (courseSelection?.holePars?.length) {
      // Picked tee: use its real pars. Slice if user picked 9 holes
      // against an 18-hole course; pad with DEFAULT_PARS if (rare)
      // the picked tee is shorter than the requested hole count.
      const apiPars = courseSelection.holePars
      pars = apiPars.length >= holes
        ? apiPars.slice(0, holes)
        : [...apiPars, ...DEFAULT_PARS.slice(apiPars.length, holes)]
      courseName = courseSelection.courseName
    } else {
      // Free-form / unpicked: standard rotation of pars.
      pars = DEFAULT_PARS.slice(0, holes)
      courseName = typedName.trim() || 'Course'
    }
    onStart({ courseName, pars })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
        {onBack && (
          <button onClick={onBack} style={{
            background: 'none', border: 'none', color: 'var(--tm-text-3)',
            fontSize: 14, fontWeight: 600, padding: '0 0 12px 0', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            ← Back
          </button>
        )}
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--tm-gold-text)', marginBottom: 4 }}>Start Round</div>
        <div style={{ fontSize: 14, color: 'var(--tm-text-3)' }}>Set up your scorecard</div>
      </div>
      {/* Body sizes to content so the "Tee It Up" footer sits right below
          the Holes chips instead of being pushed to the bottom of the
          viewport. (2026-05-07 PM — Matt: 'move the tee it up button
          further up the screen so you dont have to scroll down through
          empty space to see it'.) Was previously class="page-scroll"
          which set height:100dvh - nav-height, eating the full screen. */}
      <div style={{ padding: '20px', gap: 18, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Course — real GolfCourseAPI search + tee selection. Same
            component CreateWizard uses on its "Set the Stage" step. */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Course</div>
          <CoursePicker
            value={courseSelection?.courseId ? courseSelection : null}
            onPick={picked => setCourseSelection(picked)}
            onClear={() => setCourseSelection(null)}
            onTypedName={setTypedName}
          />
        </div>
        {/* Holes */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Holes</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[9, 18].map(h => (
              <button key={h} onClick={() => setHoles(h)}
                style={{ flex: 1, padding: '12px 0', borderRadius: 'var(--tm-radius)', border: '1px solid', borderColor: holes === h ? 'var(--tm-green)' : 'var(--tm-border)', background: holes === h ? 'var(--tm-green-muted)' : 'var(--tm-surface-2)', color: holes === h ? 'var(--tm-green-text)' : 'var(--tm-text-2)', fontWeight: 700, fontSize: 15 }}>
                {h} Holes
              </button>
            ))}
          </div>
        </div>
      </div>
      <div style={{ padding: '16px 20px', flexShrink: 0 }}>
        <button onClick={handleStart}
          style={{ width: '100%', padding: '16px', borderRadius: 'var(--tm-radius-lg)', background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))', color: '#fff', fontWeight: 800, fontSize: 17, border: 'none' }}>
          Tee It Up
        </button>
      </div>
    </div>
  )
}

// ─── Solo Score Cell — Augusta-style cream tile, single player ─────────────
// Mirrors LiveOuting's ScorecardCell but stripped of multi-player concerns
// (no skinsBadge, no match-play overrides, no isMarkerFor logic). Cream
// tile when populated/empty for hole cells; AUGUSTA_GREEN_DEEP strip for
// subtotal cells. Score numerals follow golf-tradition coloring: red for
// under par, ink for par/over. Birdie = single red circle, eagle = double
// red circle, bogey = single black square, double+ = double black square.
// Active hole gets a soft gold ring so the user can see where they are.
// (2026-05-07 PM — board-style live scoring view for solo rounds.)
function SoloScoreCell({ score, par, isSubtotal, onTap, isActive, w = 32, h = 36 }) {
  const bg = isSubtotal ? AUGUSTA_GREEN_DEEP : AUGUSTA_TILE
  const color = isSubtotal
    ? '#fff'
    : (!score || !par ? AUGUSTA_INK : (score - par < 0 ? AUGUSTA_RED : AUGUSTA_INK))
  const diff = (!isSubtotal && score && par) ? score - par : null
  const canTap = !isSubtotal && typeof onTap === 'function'
  return (
    <div
      onClick={canTap ? onTap : undefined}
      style={{
        minWidth: w, width: w, height: h,
        background: bg,
        borderLeft: '1px solid rgba(0,0,0,0.20)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: isSubtotal ? 14 : 15, fontWeight: 900,
        fontFamily: '"Arial Black", "Arial Bold", Arial, sans-serif',
        color, cursor: canTap ? 'pointer' : 'default',
        flexShrink: 0, userSelect: 'none', position: 'relative',
        boxShadow: isSubtotal
          ? 'inset 0 1px 2px rgba(0,0,0,0.50)'
          : isActive
            ? 'inset 0 0 0 2px rgba(232,192,90,0.85), inset 0 1px 2px rgba(0,0,0,0.18)'
            : 'inset 0 1px 2px rgba(0,0,0,0.18)',
      }}
    >
      {diff === -1 && <div style={{ position: 'absolute', inset: 3, borderRadius: '50%', border: '1.6px solid ' + AUGUSTA_RED, pointerEvents: 'none' }} />}
      {diff != null && diff <= -2 && <>
        <div style={{ position: 'absolute', inset: 2, borderRadius: '50%', border: '1.6px solid ' + AUGUSTA_RED, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: '1.6px solid ' + AUGUSTA_RED, pointerEvents: 'none' }} />
      </>}
      {diff === 1 && <div style={{ position: 'absolute', inset: 3, border: '1.6px solid ' + AUGUSTA_INK, pointerEvents: 'none' }} />}
      {diff != null && diff >= 2 && <>
        <div style={{ position: 'absolute', inset: 2, border: '1.6px solid ' + AUGUSTA_INK, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 6, border: '1.6px solid ' + AUGUSTA_INK, pointerEvents: 'none' }} />
      </>}
      {(score || isSubtotal) ? (
        <span style={{ display: 'inline-block', position: 'relative' }}>{score || ''}</span>
      ) : (
        !isSubtotal && <span style={{ color: 'rgba(0,0,0,0.18)', fontSize: 14 }}>·</span>
      )}
    </div>
  )
}

// ─── Solo Scorecard Table — front 9 or back 9 stacked grid ────────────────
// Three rows: HOLE numerals, gold PAR numerals, tappable SCORE cells. The
// active hole gets a small gold flag pin in the HOLE header (same SVG as
// LiveOuting's ScorecardTable). Designed for a single player so the left
// column is just a label ("HOLE" / "PAR" / "YOU"); avatar + name lives in
// the page-level header above the boards. Fits a 390px viewport with no
// horizontal scroll. (2026-05-07 PM)
function SoloScorecardTable({ label, holes, holePars, scores, activeHole, onCellTap }) {
  const subtotalPar = holes.reduce((s, h) => s + (holePars[h] || 4), 0)
  const subtotalScore = holes.reduce((s, h) => s + (Number(scores[h]) || 0), 0)
  const LABEL_W = 56
  const HOLE_W = 30
  const TOT_W = 38

  const panelGradient = `linear-gradient(180deg, ${AUGUSTA_PANEL_HI} 0%, ${AUGUSTA_PANEL} 100%)`
  const headerHoleCell = {
    minWidth: HOLE_W, width: HOLE_W, height: 32,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 900, color: AUGUSTA_TEXT,
    fontFamily: '"Arial Black", Arial, sans-serif',
    flexShrink: 0,
    borderLeft: '1px solid rgba(0,0,0,0.20)',
    position: 'relative',
  }
  const labelCell = {
    minWidth: LABEL_W, width: LABEL_W, height: 32,
    padding: '0 10px',
    display: 'flex', alignItems: 'center',
    fontSize: 11, fontWeight: 900,
    fontFamily: '"Arial Black", Arial, sans-serif',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    color: AUGUSTA_TEXT, flexShrink: 0,
  }
  const subtotalHeaderCell = {
    minWidth: TOT_W, width: TOT_W, height: 32,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 900, color: AUGUSTA_GOLD,
    fontFamily: '"Arial Black", Arial, sans-serif',
    background: AUGUSTA_GREEN_DEEP, letterSpacing: '0.06em',
    flexShrink: 0,
    textShadow: '0 1px 1px rgba(0,0,0,0.50)',
    borderLeft: '1px solid rgba(0,0,0,0.50)',
  }
  const dividerColor = 'rgba(0,0,0,0.50)'

  return (
    <div style={{ marginBottom: 0 }}>
      {/* HOLE row */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid ' + dividerColor,
        background: panelGradient,
      }}>
        <div style={labelCell}>{label}</div>
        {holes.map(h => (
          <div key={h} style={headerHoleCell}>
            {h + 1}
            {activeHole === h && (
              <span style={{
                position: 'absolute', top: -6, right: 2,
                width: 9, height: 12, pointerEvents: 'none',
              }} aria-label="Active hole">
                <svg width="9" height="12" viewBox="0 0 9 12" fill="none">
                  <line x1="1" y1="0" x2="1" y2="12" stroke="#fff" strokeWidth="1" />
                  <path d="M1 1 L8 3 L1 5 Z" fill={AUGUSTA_GOLD} stroke="#000" strokeWidth="0.5" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </div>
        ))}
        <div style={subtotalHeaderCell}>{label === 'BACK 9' ? 'IN' : 'OUT'}</div>
      </div>

      {/* PAR row */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '2px solid ' + dividerColor,
        background: panelGradient,
      }}>
        <div style={{ ...labelCell, color: AUGUSTA_GOLD }}>PAR</div>
        {holes.map(h => (
          <div key={h} style={{ ...headerHoleCell, color: AUGUSTA_GOLD }}>{holePars[h] || 4}</div>
        ))}
        <div style={{ ...subtotalHeaderCell, color: AUGUSTA_GOLD }}>{subtotalPar}</div>
      </div>

      {/* SCORE row — tappable cells */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid ' + AUGUSTA_GREEN_DEEP,
        background: AUGUSTA_PANEL_HOVER,
      }}>
        <div style={{ ...labelCell, height: 44 }}>YOU</div>
        {holes.map(h => (
          <SoloScoreCell
            key={h}
            score={scores[h] || 0}
            par={holePars[h] || 4}
            isActive={activeHole === h}
            onTap={() => onCellTap(h)}
            w={HOLE_W}
            h={44}
          />
        ))}
        <SoloScoreCell
          score={subtotalScore || null}
          par={null}
          isSubtotal={true}
          w={TOT_W}
          h={44}
        />
      </div>
    </div>
  )
}

// ─── Solo Score Modal — stepper + quick picks for one hole ─────────────────
// Pulled from LiveOuting's ScoreModal pattern but stripped to the solo
// case (no playerName, no Save & Eagle Eye, no marker concerns). Includes
// the suspicious-score guard so a 12-on-a-par-3 mis-tap still asks before
// committing. Shot log lives below the picks so the existing per-hole
// shots data path keeps working — tapping "+ Log Shot" pops the existing
// ClubSheet, same as the old HoleScorer. (2026-05-07 PM)
function SoloScoreModal({ hole, par, currentScore, holeCount, shots = [], onSave, onAddShot, onClose }) {
  const [val, setVal] = useState(currentScore || par || 4)
  const [showClubs, setShowClubs] = useState(false)

  const quickPicks = [
    { label: 'Eagle',  diff: -2 },
    { label: 'Birdie', diff: -1 },
    { label: 'Par',    diff:  0 },
    { label: 'Bogey',  diff: +1 },
    { label: 'Double', diff: +2 },
  ].map(q => {
    const score = (par || 4) + q.diff
    return { ...q, score, label: score === 1 ? 'Ace' : q.label }
  }).filter(q => q.score >= 1)

  function handleSave() {
    const overBy = val - (par || 4)
    const isUnusual = overBy >= 5 || val > (par || 4) * 2
    if (isUnusual) {
      const ok = window.confirm(
        `${val} on a par-${par || 4}? That's ${overBy} over par. ` +
        `Tap Cancel to fix it, OK to save anyway.`
      )
      if (!ok) return
    }
    tmHaptic(15)
    onSave(val)
  }

  const cellColorFor = (score, p) => !score || !p ? AUGUSTA_INK : (score - p < 0 ? AUGUSTA_RED : AUGUSTA_INK)

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
        maxHeight: '85vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', textAlign: 'center', marginBottom: 4 }}>
          Hole {hole + 1}{par ? ` · Par ${par}` : ''}
          {holeCount ? ` · of ${holeCount}` : ''}
        </div>

        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 20 }}>
          <button onClick={() => setVal(v => Math.max(1, v - 1))}
            style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontSize: 26, fontWeight: 300, cursor: 'pointer' }}>−</button>
          <div style={{ fontSize: 56, fontWeight: 900, color: cellColorFor(val, par), minWidth: 64, textAlign: 'center', lineHeight: 1 }}>{val}</div>
          <button onClick={() => setVal(v => v + 1)}
            style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontSize: 26, fontWeight: 300, cursor: 'pointer' }}>+</button>
        </div>

        {/* Quick picks */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
          {quickPicks.map(q => (
            <button key={q.label} onClick={() => setVal(q.score)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: val === q.score ? AUGUSTA_TILE : 'var(--tm-surface-2)',
                border: val === q.score ? `1.5px solid ${cellColorFor(q.score, par)}` : '1px solid var(--tm-border)',
                color: val === q.score ? cellColorFor(q.score, par) : 'var(--tm-text-3)',
              }}>{q.label} ({q.score})</button>
          ))}
        </div>

        {/* Save button */}
        <button onClick={handleSave} style={{
          width: '100%', padding: 16, borderRadius: 'var(--tm-radius-lg)',
          background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
          color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 16, border: 'none', cursor: 'pointer',
        }}>Save Score</button>

        {/* Shot log — keeps the existing per-hole shots data path. Compact
            section below the score entry so the primary affordance stays
            the score itself. */}
        <div style={{ marginTop: 18, background: 'var(--tm-surface-2)', borderRadius: 'var(--tm-radius)', border: '1px solid var(--tm-border)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: shots.length ? '1px solid var(--tm-border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-2)' }}>
              Shot Log {shots.length > 0 && <span style={{ color: 'var(--tm-text-3)', fontWeight: 500 }}>· {shots.length}</span>}
            </div>
            <button onClick={() => setShowClubs(true)}
              style={{ padding: '4px 12px', borderRadius: 'var(--tm-radius-full)', background: 'var(--tm-gold-muted)', border: '1px solid var(--tm-gold-dim)', color: 'var(--tm-gold-text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              + Log Shot
            </button>
          </div>
          {shots.length > 0 && (
            <div style={{ padding: '4px 0' }}>
              {shots.map((s, i) => (
                <div key={i} style={{ padding: '6px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                  <span style={{ color: 'var(--tm-text)' }}>
                    <span style={{ color: 'var(--tm-gold-text)', fontWeight: 700, marginRight: 8 }}>{i + 1}</span>
                    {s.club}
                  </span>
                  {s.dist && <span style={{ color: 'var(--tm-text-3)' }}>{s.dist}yd</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showClubs && <ClubSheet onSelect={club => { onAddShot({ club, dist: null }); setShowClubs(false) }} onClose={() => setShowClubs(false)} />}
    </div>,
    document.body
  )
}

// ─── Solo Scoreboard — board-style live scoring for solo rounds ────────────
// Replaces the old single-hole HoleScorer view. Mirrors LiveOuting's
// scorecard board (front 9 + back 9 stacked Augusta tables) but for a
// single player. Tapping any hole's score cell opens SoloScoreModal.
// Active hole highlight tracks the `hole` index from parent state so
// localStorage resume still puts the user back where they left off.
// (2026-05-07 PM — Matt: 'i want solo round to have the same view as the
// regular scorecard/board view as other matches have but just for one
// player'.)
function SoloScoreboard({ user, config, scores, shots, hole, gps, onScoreHole, onAddShot, onSetActiveHole, onFinish, onBack }) {
  const [editingHole, setEditingHole] = useState(null)
  const holeCount = config.pars.length
  const totalPar  = config.pars.reduce((s, p) => s + p, 0)
  const totalScore = scores.reduce((s, x) => s + (x || 0), 0)
  const holesPlayed = scores.filter(s => s > 0).length
  const allDone = holesPlayed >= holeCount
  // Score-to-par across PLAYED holes only — running diff while still
  // mid-round so the header reads honestly ("E through 7" not "+0 of 18").
  const playedPar = scores.reduce((s, x, i) => x > 0 ? s + (config.pars[i] || 4) : s, 0)
  const playedDiff = totalScore > 0 ? totalScore - playedPar : null
  const diffStr = playedDiff == null ? '—' : playedDiff === 0 ? 'E' : playedDiff > 0 ? `+${playedDiff}` : `${playedDiff}`
  const diffColor = playedDiff == null ? 'rgba(255,255,255,0.40)' : playedDiff < 0 ? 'var(--tm-birdie)' : playedDiff === 0 ? 'var(--tm-par)' : 'var(--tm-bogey)'

  const frontHoles = Array.from({ length: Math.min(9, holeCount) }, (_, i) => i)
  const backHoles  = holeCount > 9 ? Array.from({ length: holeCount - 9 }, (_, i) => i + 9) : []

  function openScoreModal(idx) {
    onSetActiveHole(idx)
    setEditingHole(idx)
  }

  function handleSaveScore(val) {
    if (editingHole == null) return
    onScoreHole(editingHole, val)
    setEditingHole(null)
    // Auto-advance the active-hole highlight to the next unfilled hole
    // so the gold flag pin tracks the user's progress without forcing
    // them to manually pick the next one. (Same UX as HoleScorer's
    // implicit "next hole" arrow.)
    const next = scores.findIndex((s, i) => i > editingHole && !s)
    if (next >= 0) onSetActiveHole(next)
  }

  function handleAddShot(shot) {
    if (editingHole == null) return
    onAddShot(editingHole, { ...shot, gps })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 12px',
        background: 'var(--tm-surface)',
        borderBottom: '1px solid var(--tm-border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <button onClick={onBack} style={{
            background: 'none', border: 'none', color: 'var(--tm-text-3)',
            fontSize: 13, fontWeight: 600, padding: 0, cursor: 'pointer',
          }}>← Back</button>
          <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 800, color: 'var(--tm-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{config.courseName}</div>
            <div style={{ fontSize: 10, color: 'var(--tm-text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 1 }}>
              Par {totalPar} · {holeCount} holes
            </div>
          </div>
          <div style={{ minWidth: 56, textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--tm-text)', lineHeight: 1, fontFamily: '"Arial Black", Arial, sans-serif' }}>
              {totalScore > 0 ? totalScore : '—'}
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: diffColor, marginTop: 2, letterSpacing: '0.04em' }}>
              {diffStr}{holesPlayed > 0 && holesPlayed < holeCount ? ` · thru ${holesPlayed}` : allDone ? ' · F' : ''}
            </div>
          </div>
        </div>

        {/* Player + GPS strip */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
            background: user?.avatar ? `center/cover no-repeat url("${user.avatar}")` : avatarBg(user?.name || ''),
            border: '1px solid rgba(232,192,90,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 11, fontWeight: 800,
            fontFamily: '"Arial Black", Arial, sans-serif',
          }}>
            {!user?.avatar && (initials(user?.name) || '·')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 700, color: 'var(--tm-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{user?.name || 'You'}</div>
          </div>
          {gps && (
            <div style={{
              padding: '4px 10px', background: 'var(--tm-surface-2)',
              borderRadius: 'var(--tm-radius-sm)',
              display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--tm-green-text)', animation: 'pulse 2s infinite' }} />
              <span style={{ fontSize: 10, color: 'var(--tm-text-2)', fontWeight: 700, letterSpacing: '0.04em' }}>GPS</span>
              {gps.accuracy && <span style={{ fontSize: 10, color: 'var(--tm-text-3)' }}>±{Math.round(gps.accuracy)}m</span>}
            </div>
          )}
        </div>
      </div>

      {/* Boards */}
      <div className="page-scroll" style={{ flex: 1, padding: '12px 8px 16px', overflowY: 'auto' }}>
        <div style={{
          borderRadius: 12, overflow: 'hidden',
          border: '1px solid rgba(0,0,0,0.30)',
          boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
          marginBottom: backHoles.length > 0 ? 12 : 0,
        }}>
          <SoloScorecardTable
            label="FRONT 9"
            holes={frontHoles}
            holePars={config.pars}
            scores={scores}
            activeHole={hole}
            onCellTap={openScoreModal}
          />
        </div>
        {backHoles.length > 0 && (
          <div style={{
            borderRadius: 12, overflow: 'hidden',
            border: '1px solid rgba(0,0,0,0.30)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
          }}>
            <SoloScorecardTable
              label="BACK 9"
              holes={backHoles}
              holePars={config.pars}
              scores={scores}
              activeHole={hole}
              onCellTap={openScoreModal}
            />
          </div>
        )}
      </div>

      {/* Footer — Finish Round button. Gold gradient when all holes are
          scored; muted-but-tappable when not (we still let the user
          finish early — the existing summary view handles partial cards
          gracefully). Subtitle hint shows progress so the user knows
          how many holes are left. */}
      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <button onClick={() => { tmHaptic(15); onFinish() }}
          style={{
            width: '100%', padding: '14px',
            borderRadius: 'var(--tm-radius-lg)',
            background: allDone
              ? 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))'
              : 'var(--tm-surface)',
            border: allDone ? 'none' : '1px solid var(--tm-border)',
            color: allDone ? 'var(--tm-text-inv)' : 'var(--tm-text-2)',
            fontWeight: 800, fontSize: 15, cursor: 'pointer',
          }}>
          {allDone ? 'Finish Round' : `Finish Early · ${holesPlayed}/${holeCount} scored`}
        </button>
      </div>

      {editingHole != null && (
        <SoloScoreModal
          hole={editingHole}
          par={config.pars[editingHole] || 4}
          currentScore={scores[editingHole] || 0}
          holeCount={holeCount}
          shots={shots[editingHole] || []}
          onSave={handleSaveScore}
          onAddShot={handleAddShot}
          onClose={() => setEditingHole(null)}
        />
      )}
    </div>
  )
}

// ─── Club Sheet ───────────────────────────────────────────────────────────────
function ClubSheet({ onSelect, onClose }) {
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'var(--tm-overlay)', zIndex: 9999, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ background: 'var(--tm-surface)', borderRadius: '24px 24px 0 0', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--tm-text)' }}>Which club?</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--tm-text-3)', fontSize: 20 }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {CLUBS.map(c => (
            <button key={c.label} onClick={() => onSelect(c.label)}
              style={{ padding: '12px 4px', borderRadius: 'var(--tm-radius)', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontWeight: 700, fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span>{c.label}</span>
              <span style={{ fontSize: 9, color: 'var(--tm-text-3)', fontWeight: 400 }}>{c.name.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Scorecard Summary ────────────────────────────────────────────────────────
function ScorecardSummary({ pars, scores, courseName, onSave, saving }) {
  const totalPar   = pars.reduce((s, p) => s + p, 0)
  const totalScore = scores.reduce((s, x) => s + (x || 0), 0)
  const diff       = totalScore - totalPar
  const diffLabel  = diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`
  const diffColor  = diff < 0 ? 'var(--tm-birdie)' : diff === 0 ? 'var(--tm-par)' : 'var(--tm-bogey)'
  const front9Par  = pars.slice(0,9).reduce((s,p)=>s+p,0)
  const back9Par   = pars.slice(9).reduce((s,p)=>s+p,0)
  const front9     = scores.slice(0,9).reduce((s,x)=>s+(x||0),0)
  const back9      = scores.slice(9).reduce((s,x)=>s+(x||0),0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '24px 20px 0', flexShrink: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', marginBottom: 4 }}>Round Complete</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--tm-text)', marginBottom: 2 }}>{courseName}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 56, fontWeight: 900, color: diffColor, lineHeight: 1 }}>{totalScore}</span>
          <span style={{ fontSize: 28, color: diffColor, fontWeight: 700 }}>{diffLabel}</span>
        </div>
      </div>

      <div className="page-scroll" style={{ padding: '16px 20px', gap: 12 }}>
        {/* Front / Back 9 split */}
        {pars.length === 18 && (
          <div style={{ display: 'flex', gap: 12 }}>
            {[['Front 9', front9, front9Par], ['Back 9', back9, back9Par]].map(([label, score, par]) => (
              <div key={label} style={{ flex: 1, background: 'var(--tm-surface)', borderRadius: 'var(--tm-radius-lg)', padding: '14px', border: '1px solid var(--tm-border)', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--tm-text-3)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: scoreColor(score, par) }}>{score}</div>
                <div style={{ fontSize: 12, color: 'var(--tm-text-3)' }}>Par {par}</div>
              </div>
            ))}
          </div>
        )}

        {/* Hole-by-hole grid */}
        <div style={{ background: 'var(--tm-surface)', borderRadius: 'var(--tm-radius-lg)', border: '1px solid var(--tm-border)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--tm-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tm-text-2)' }}>Scorecard</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 2, padding: 8 }}>
            {pars.map((par, i) => {
              const s = scores[i] || 0
              const color = scoreColor(s, par)
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 2px', borderRadius: 8, background: s ? 'var(--tm-surface-2)' : 'transparent' }}>
                  <span style={{ fontSize: 9, color: 'var(--tm-text-3)', fontWeight: 600 }}>{i+1}</span>
                  <span style={{ fontSize: 11, color: 'var(--tm-text-3)' }}>P{par}</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color }}>{s || '—'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 20px', flexShrink: 0 }}>
        <button onClick={() => { tmHaptic(15); onSave() }} disabled={saving}
          style={{ width: '100%', padding: '16px', borderRadius: 'var(--tm-radius-lg)', background: saving ? 'var(--tm-surface-2)' : 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))', color: saving ? 'var(--tm-text-3)' : 'var(--tm-text-inv)', fontWeight: 800, fontSize: 17, border: 'none' }}>
          {saving ? 'Saving…' : '💾 Save Round'}
        </button>
      </div>
    </div>
  )
}

// ─── Main ActiveRound Component ───────────────────────────────────────────────
// 2026-05-05 — localStorage key for resuming an in-progress solo round
// after a page reload (network drop, accidental refresh, pull-to-refresh,
// background-tab eviction). The bug this fixes was discovered when a
// real user (Sean) lost an in-progress round to a reload. Before this,
// all round state lived in React only and was wiped on any page reload.
// Scoped per-user so two accounts on the same device don't collide.
const SOLO_ROUND_STORAGE_KEY = uid => `tm-active-round-v1-${uid || 'anon'}`

export default function ActiveRound({ user, onBack }) {
  const [phase, setPhase] = useState('setup') // 'setup' | 'scoring' | 'summary'
  const [config, setConfig] = useState(null)  // { courseName, pars[] }
  const [hole, setHole]     = useState(0)     // 0-indexed
  const [scores, setScores] = useState([])    // per-hole strokes
  const [shots, setShots]   = useState([])    // per-hole shot logs: [[{club,dist,gps}...]]
  const [gps, setGps]       = useState(null)
  const [saving, setSaving] = useState(false)
  const watchRef = useRef(null)
  const restoredRef = useRef(false)
  const STORAGE_KEY = SOLO_ROUND_STORAGE_KEY(user?.id)

  // 2026-05-05 — restore in-progress round from localStorage on mount.
  // Only restores 'scoring' phase — setup/summary are short-lived and
  // don't need resume semantics. Wraps in try/catch because corrupted
  // JSON or a disabled storage backend should never crash the screen.
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (saved && saved.phase === 'scoring' && saved.config && Array.isArray(saved.config.pars)) {
        setPhase('scoring')
        setConfig(saved.config)
        setHole(Number.isFinite(saved.hole) ? saved.hole : 0)
        setScores(Array.isArray(saved.scores) ? saved.scores : new Array(saved.config.pars.length).fill(0))
        setShots(Array.isArray(saved.shots) ? saved.shots : new Array(saved.config.pars.length).fill(null).map(() => []))
      }
    } catch { /* corrupt or disabled — ignore, user starts fresh */ }
  }, [STORAGE_KEY])

  // Persist on every meaningful state change while scoring. Setup and
  // summary phases don't need autosave — only mid-round resume matters.
  useEffect(() => {
    if (phase !== 'scoring' || !config) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        phase, config, hole, scores, shots,
      }))
    } catch { /* quota / disabled — best-effort, don't crash */ }
  }, [STORAGE_KEY, phase, config, hole, scores, shots])

  function clearSavedRound() {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }

  // GPS watch
  useEffect(() => {
    if (!navigator.geolocation) return
    watchRef.current = navigator.geolocation.watchPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 }
    )
    return () => navigator.geolocation.clearWatch(watchRef.current)
  }, [])

  function handleStart({ courseName, pars }) {
    setConfig({ courseName, pars })
    setScores(new Array(pars.length).fill(0))
    setShots(new Array(pars.length).fill(null).map(() => []))
    setHole(0)
    setPhase('scoring')
  }

  function setScore(idx, val) {
    setScores(s => { const n = [...s]; n[idx] = val; return n })
  }

  function addShot(idx, shot) {
    setShots(sh => { const n = [...sh]; n[idx] = [...(n[idx] || []), { ...shot, ts: Date.now() }]; return n })
    // Bump stroke count with each shot if not already set
    setScores(s => { const n = [...s]; if (!n[idx]) n[idx] = 1; return n })
  }

  function nextHole() {
    if (hole < config.pars.length - 1) setHole(h => h + 1)
    else setPhase('summary')
  }

  async function saveRound() {
    if (!config) return
    setSaving(true)
    try {
      const totalPar = config.pars.reduce((s, p) => s + p, 0)
      const res = await post('/api/rounds', {
        courseName:   config.courseName,
        coursePar:    totalPar,
        courseRating: null,
        slopeRating:  null,
        gameType:     'stroke',
        scores:       scores,
        shots:        shots,
      })
      // 2026-05-06 (polish task #5) — fire the global achievement event
      // so the toast (mounted at App level) can pop after we navigate
      // away. Component-local state would unmount with us before the
      // toast got a chance to play.
      if (Array.isArray(res?.achievements) && res.achievements.length) {
        window.dispatchEvent(new CustomEvent('tm:achievement-earned', {
          detail: { achievements: res.achievements },
        }))
      }
      // Round persisted to server — clear the localStorage backup so a
      // fresh navigation back to Solo Round starts with a clean slate.
      clearSavedRound()
      // Reset and return to hub if launched from Outing tab
      setPhase('setup')
      setConfig(null)
      setHole(0)
      setScores([])
      setShots([])
      onBack?.()
    } catch (e) {
      console.error(e)
      // Don't clearSavedRound on error — the user's data is still in
      // localStorage so they can retry the save without re-entering.
    } finally {
      setSaving(false)
    }
  }

  // 2026-05-05 — wrap everything Solo-Round renders in a div with
  // data-no-pull-refresh="true". The TabPanel's pull-to-refresh handler
  // checks for this attribute via closest() on the touch target and
  // bails before arming the gesture, so a downward finger drift while
  // entering scores won't trigger a page reload (which would otherwise
  // wipe in-progress state — even though we now restore from
  // localStorage, the reload itself is jarring and unnecessary here).
  function NoPullWrap({ children }) {
    return (
      <div data-no-pull-refresh="true" style={{ height: '100%' }}>
        {children}
      </div>
    )
  }

  if (phase === 'setup') return (
    <NoPullWrap>
      <SetupSheet onStart={handleStart} onBack={onBack} />
    </NoPullWrap>
  )

  if (phase === 'summary') return (
    <NoPullWrap>
      <ScorecardSummary
        pars={config.pars}
        scores={scores}
        courseName={config.courseName}
        onSave={saveRound}
        saving={saving}
      />
    </NoPullWrap>
  )

  return (
    <NoPullWrap>
      <SoloScoreboard
        user={user}
        config={config}
        scores={scores}
        shots={shots}
        hole={hole}
        gps={gps}
        onScoreHole={(idx, val) => setScore(idx, val)}
        onAddShot={(idx, shot) => addShot(idx, shot)}
        onSetActiveHole={(idx) => setHole(idx)}
        onFinish={() => setPhase('summary')}
        onBack={onBack}
      />
    </NoPullWrap>
  )
}
