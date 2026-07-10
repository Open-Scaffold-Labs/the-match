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
import { CoursePicker } from '../components/CoursePicker.jsx'
import { saveEyeHole } from '../lib/eye-hole.js'
import { readSession, writeSession, clearSession } from '../lib/active-round-session.js'
import QuickScoreSheet from '../components/scorecard/QuickScoreSheet.jsx'
// S4 (2026-07-06): shared scorecard surface now lives in components/scorecard/ —
// solo imports from there, not from the multi page.
import { SavedChip, ScorecardTable, TotalsRow, MatchScoreboard, LeadersPlaque, AugustaPlaqueFooter, computePositions, findTapHint } from '../components/scorecard/index.jsx'
import HighlightShareModal, { shouldCelebrate } from './Outing/HighlightShare.jsx'
import { SOLO_ROUND_STORAGE_KEY as SOLO_KEY_LIB } from '../lib/solo-round.js'
import PuttChips from '../components/scorecard/PuttChips.jsx'
import { ShotSheet } from '../components/scorecard/ShotSheet.jsx'

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
// onCourseTeeSelected + gender added 2026-07-10 (Phase 1 / S2): solo course
// picks now seed the App-level sharedCourse (so Eagle Eye auto-loads the solo
// course with no manual re-pick) and the tee list dedupes gender-correctly —
// the two halves of the long-standing "solo never seeds sharedCourse" seam.
function SetupSheet({ onStart, onBack, onCourseTeeSelected, gender }) {
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
    let courseRating = null, slopeRating = null, holeHandicaps = null
    if (courseSelection?.holePars?.length) {
      // Picked tee: use its real pars. Slice if user picked 9 holes
      // against an 18-hole course; pad with DEFAULT_PARS if (rare)
      // the picked tee is shorter than the requested hole count.
      const apiPars = courseSelection.holePars
      pars = apiPars.length >= holes
        ? apiPars.slice(0, holes)
        : [...apiPars, ...DEFAULT_PARS.slice(apiPars.length, holes)]
      courseName = courseSelection.courseName
      // Carry the picked tee's USGA ratings + per-hole Stroke Index so a SOLO
      // round is handicapped EXACTLY like an outing round: USGA Score
      // Differential (not the par-only fallback) and net-double-bogey on the
      // REAL Stroke Index (not a synthetic 1..18). The CoursePicker already
      // hands these back — they were simply being dropped here.
      // (2026-06-26 — Matt: "solo rounds need to function exactly the same as
      // any other round".) Stroke Index sliced to the hole count like pars.
      courseRating = courseSelection.courseRating ?? null
      slopeRating  = courseSelection.slopeRating ?? null
      const sIdx = Array.isArray(courseSelection.holeHandicaps) ? courseSelection.holeHandicaps : null
      holeHandicaps = sIdx && sIdx.length >= holes ? sIdx.slice(0, holes) : sIdx
    } else {
      // Free-form / unpicked: standard rotation of pars. No ratings/SI to carry.
      pars = DEFAULT_PARS.slice(0, holes)
      courseName = typedName.trim() || 'Course'
    }
    // courseId/courseTee carried since 2026-07-10 (Phase 1 / S2) so the
    // course's identity survives in the solo blob (extra keys are ignored
    // by the restore validator; null when free-form/unpicked).
    onStart({
      courseName, pars, courseRating, slopeRating, holeHandicaps,
      courseId:  courseSelection?.courseId ?? null,
      courseTee: courseSelection?.courseTee ?? null,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top padding clears the iOS notch / dynamic island via --safe-top
          (env(safe-area-inset-top, 0px)) — same pattern OutingHub /
          EagleEye / Leagues use. Without this the "Start Round" title
          sits behind the notch on a phone. (2026-05-07 PM — Matt: 'top
          of page is too high'.) */}
      <div style={{ padding: 'calc(var(--safe-top) + 20px) 20px 0', flexShrink: 0 }}>
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
            onCourseTeeSelected={onCourseTeeSelected}
            gender={gender}
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
// SoloScoreCell + SoloScorecardTable DELETED 2026-07-06 (solo/multi scorecard
// unification spec): solo now renders the SAME ScorecardTable/TotalsRow as
// LiveOuting with a one-participant list — the May fork is healed; one grid,
// two consumers, zero drift.

// ─── Solo Score Modal — stepper + quick picks for one hole ─────────────────
// Pulled from LiveOuting's ScoreModal pattern but stripped to the solo
// case (no playerName, no Save & Eagle Eye, no marker concerns). Includes
// the suspicious-score guard so a 12-on-a-par-3 mis-tap still asks before
// committing. Shot log lives below the picks so the existing per-hole
// shots data path keeps working — tapping "+ Log Shot" pops the existing
// ClubSheet, same as the old HoleScorer. (2026-05-07 PM)
function SoloScoreModal({ hole, par, currentScore, holeCount, shots = [], currentPutts = null, currentFirstPutt = null, onSave, onAddShot, onClose }) {
  const [val, setVal] = useState(currentScore || par || 4)
  const [showClubs, setShowClubs] = useState(false)
  // SG putt facts (migration 039, docs/SG-DESIGN.md) — optional two-tap
  // capture. null = not recorded (SG simply skips the hole; no fake data).
  const [puttVal, setPuttVal]     = useState(currentPutts ?? null)
  const [firstPutt, setFirstPutt] = useState(currentFirstPutt ?? null)

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
    // Putt facts ride along with the score. A putt count above the hole
    // score is impossible — drop the facts rather than block the save.
    const cleanPutts = (puttVal != null && puttVal <= val) ? puttVal : null
    onSave(val, { putts: cleanPutts, firstPutt: cleanPutts != null ? firstPutt : null })
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

        {/* Putt facts — optional two-tap capture that feeds Strokes Gained
            (docs/SG-DESIGN.md). Shared PuttChips component (2026-07-06) so
            solo + live-outing capture can never drift. Skipping is always fine. */}
        <PuttChips puttVal={puttVal} setPuttVal={setPuttVal} firstPutt={firstPutt} setFirstPutt={setFirstPutt} />

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
                    {s.lie && (
                      <span style={{ color: 'var(--tm-text-3)', fontSize: 10, marginLeft: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {s.lie === 'recovery' ? 'trouble' : s.lie}
                      </span>
                    )}
                  </span>
                  <span style={{ color: 'var(--tm-text-3)' }}>
                    {s.toPin ? `${s.toPin}yd to pin` : s.dist ? `${s.dist}yd` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showClubs && (
        <ShotSheet
          isFirstShot={shots.length === 0}
          onAdd={shot => { onAddShot(shot); setShowClubs(false) }}
          onClose={() => setShowClubs(false)}
        />
      )}
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
// SoloBoardView DELETED 2026-07-06 (unification S3): solo board = the same
// MatchScoreboard multiplayer renders, one participant. Fork fully healed.

// ─── Solo Board View — Tour-leaderboard look, single row ──────────────────
// Mirrors LiveOuting's MatchScoreboard visually (translucent glass card,
// POS / avatar / PLAYER / TOT / THRU columns, gold leader tint, red/
// green/gold score-to-par color story) but for one player. Even at a
// field of 1, you're 1st — useful for the user who wants to "see their
// score on a board". Tapping the row switches back to SCORECARD mode
// (the only place you can actually enter scores). (2026-05-07 PM —
// Matt: 'allow solo round to view score in board view as well'.)
function SoloBoardView({ user, config, scores, onTapRow }) {
  const holeCount  = config.pars.length
  const totalScore = scores.reduce((s, x) => s + (Number(x) || 0), 0)
  const playedPar  = scores.reduce((s, x, i) => x > 0 ? s + (config.pars[i] || 4) : s, 0)
  const holesPlayed = scores.filter(s => s > 0).length
  const numericDiff = totalScore > 0 ? totalScore - playedPar : null
  const diffStr = numericDiff == null ? '—'
                : numericDiff === 0   ? 'E'
                : numericDiff > 0     ? `+${numericDiff}`
                :                       `${numericDiff}`
  const diffColor = numericDiff == null ? 'rgba(27,94,59,0.50)'
                  : numericDiff < 0     ? '#1A6B28'
                  : numericDiff === 0   ? 'rgba(27,94,59,0.75)'
                  :                       '#B91C1C'
  const thru = holesPlayed === 0 ? '—'
             : holesPlayed >= holeCount ? 'F'
             : String(holesPlayed)
  const display = user?.name || 'You'
  const avatarSrc = user?.avatar
  const initialsStr = (display.split(/\s+/).map(s => s[0]).filter(Boolean).slice(0,2).join('') || '·').toUpperCase()

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 24px' }}>
      <div style={{
        background: 'rgba(255,255,255,0.22)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.45)',
        borderRadius: 16,
        padding: '12px 12px 4px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        {/* Column headers — matches MatchScoreboard's stroke-format
            grid template (no TODAY column for non-match-play). */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '28px 44px 1fr 50px 36px',
          gap: 4, padding: '0 4px 6px',
          borderBottom: '1px solid rgba(27,94,59,0.18)',
          marginBottom: 6,
        }}>
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>POS</div>
          <div />
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em' }}>PLAYER</div>
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>TOT</div>
          <div style={{ color: 'rgba(27,94,59,0.55)', fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textAlign: 'center' }}>THRU</div>
        </div>

        {/* The lone player row. Always position 1 (it's just you); leader
            gold tint applies, plus the gold left-border self-accent. */}
        <button
          onClick={onTapRow}
          style={{
            width: '100%',
            display: 'grid',
            gridTemplateColumns: '28px 44px 1fr 50px 36px',
            gap: 4, alignItems: 'center',
            padding: '7px 4px',
            borderBottom: '1px solid rgba(27,94,59,0.10)',
            background: 'rgba(201,160,64,0.20)',
            borderRadius: 8,
            borderLeft: '3px solid var(--tm-gold)',
            cursor: 'pointer',
            textAlign: 'left', font: 'inherit',
          }}
          aria-label="Switch to scorecard view"
        >
          <div style={{
            textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--tm-gold)',
          }}>1</div>
          <div style={{
            width: 38, height: 38, borderRadius: 10, overflow: 'hidden',
            background: 'rgba(27,94,59,0.08)',
            border: '1px solid rgba(27,94,59,0.12)',
            position: 'relative',
          }}>
            {avatarSrc ? (
              <img src={avatarSrc} alt={display} style={{
                width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center',
              }} />
            ) : (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: '#fff',
                background: avatarBg(display),
              }}>{initialsStr}</div>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: 'var(--tm-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{display}</div>
            <div style={{
              fontSize: 9, color: 'rgba(27,94,59,0.45)', fontWeight: 500,
              letterSpacing: '0.02em', marginTop: 1,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {totalScore > 0 ? `${totalScore} strokes · par ${playedPar}` : 'Solo round'}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={{
              fontSize: 13, fontWeight: 800, color: diffColor,
            }}>{diffStr}</span>
          </div>
          <div style={{
            textAlign: 'center', fontSize: 11,
            color: thru === 'F' ? 'rgba(27,94,59,0.55)' : 'rgba(27,94,59,0.45)',
            fontWeight: thru === 'F' ? 700 : 400,
          }}>{thru}</div>
        </button>

        <div style={{ padding: '12px 4px 4px', color: 'rgba(27,94,59,0.50)', fontSize: 10, textAlign: 'center' }}>
          Tap your row to enter scores
        </div>
      </div>
    </div>
  )
}

function SoloScoreboard({ user, config, scores, shots, putts = [], firstPutts = [], hole, gps, onScoreHole, onSavePutts, onAddShot, onSetActiveHole, onFinish, onBack, onGoToEagleEye }) {
  const [editingHole, setEditingHole] = useState(null)
  // 2026-05-07 PM — savedAt timestamp drives the gold "Saved" chip that
  // pops in the bottom-right after every score commit. Same SavedChip
  // component LiveOuting uses, exported from there so the visual
  // language matches multi-player matches. Matt: 'why is there no
  // saved pop up after a score is entered like in multiplayer matches'.
  const [savedAt, setSavedAt] = useState(0)
  // 2026-05-07 PM — toggle between the Augusta hole-by-hole grid
  // ('scorecard', default) and the Tour-leaderboard single-row view
  // ('board'). Same SCORECARD/BOARD toggle multi-player matches use.
  // Matt: 'allow solo round to view score in board view as well'.
  const [viewMode, setViewMode] = useState('scorecard')
  // 2026-05-07 PM — celebration share-card modal for sub-par + HIO
  // scores. Same HighlightShareModal LiveOuting fires for multi-player
  // birdies/eagles/holes-in-one. Solo had nothing here, so a hole-in-one
  // saved silently with just the SavedChip — felt undersold. Matt:
  // 'solo rounds should also receive the same pop ups for hole in ones,
  // eagles, birdies etc that multi player matches have'. Held in this
  // component instead of bubbled up so the modal only renders during
  // active scoring (not during setup or summary phases).
  const [celebrate, setCelebrate] = useState(null)
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

  // Unified-scorecard adapters (2026-07-06 spec): ONE participant list feeds
  // the SAME ScorecardTable/TotalsRow/MatchScoreboard multiplayer uses. Shared
  // by both the scorecard and board views.
  const soloParticipants = [{ user_id: user?.id ?? 'me', name: user?.name || 'You', avatar: user?.avatar ?? null }]
  const getSoloScores = () => scores
  const isSelfMarker = () => false
  const positions = computePositions(soloParticipants, getSoloScores, config.pars)
  const tapHint = findTapHint({ sorted: soloParticipants, getScores: getSoloScores, isHost: true, isMarkerFor: isSelfMarker, userId: user?.id })

  const frontHoles = Array.from({ length: Math.min(9, holeCount) }, (_, i) => i)
  const backHoles  = holeCount > 9 ? Array.from({ length: holeCount - 9 }, (_, i) => i + 9) : []

  function openScoreModal(idx) {
    onSetActiveHole(idx)
    setEditingHole(idx)
  }

  function handleSaveScore(val, puttFacts) {
    if (editingHole == null) return
    const par = config.pars[editingHole] || 4
    const holeNumberDisplay = editingHole + 1
    onScoreHole(editingHole, val)
    // SG putt facts ride along with the score save (docs/SG-DESIGN.md).
    if (onSavePutts && puttFacts) onSavePutts(editingHole, puttFacts)
    setEditingHole(null)
    // Fire the gold "Saved" chip — same UX as LiveOuting. Score is
    // committed locally + persisted to localStorage immediately by
    // ActiveRound's autosave effect, so the user-facing confirmation
    // can fire right away (no waiting on a server roundtrip — solo
    // rounds only POST when the user finishes, not per hole).
    setSavedAt(Date.now())
    // Birdie / eagle / HIO celebration — same shouldCelebrate gate
    // multi-player uses. Solo fires the modal client-side immediately
    // (no server roundtrip per hole), keying off the saved score +
    // the hole's par. (2026-05-07 PM — Matt: 'solo rounds should also
    // receive the same pop ups for hole in ones, eagles, birdies etc'.)
    if (shouldCelebrate(Number(val), Number(par))) {
      setCelebrate({
        score: Number(val),
        par: Number(par),
        holeNumber: holeNumberDisplay,
      })
    }
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
        // Top padding clears the iOS notch via --safe-top — same pattern
        // OutingHub / Leagues use. (2026-05-07 PM — Matt: 'top of page
        // is too high'.)
        padding: 'calc(var(--safe-top) + 14px) 16px 12px',
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
            </div>
          )}
        </div>
      </div>

      {/* SCORECARD / BOARD toggle — same gold-pill toggle multi-player
          matches use (LiveOuting). Default 'scorecard' since you need
          it to enter scores; tap BOARD to see the Tour-leaderboard
          look. Tapping the row in BOARD switches back to SCORECARD. */}
      <div style={{
        display: 'flex', justifyContent: 'center',
        padding: '10px 16px 0', flexShrink: 0,
      }}>
        <div style={{
          display: 'inline-flex',
          background: '#1A4A24',
          border: '1px solid rgba(232,192,90,0.45)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
          borderRadius: 999, padding: 4, gap: 2,
        }}>
          <button onClick={() => setViewMode('scorecard')} style={{
            background: viewMode === 'scorecard' ? 'linear-gradient(135deg, #F5D78A, var(--tm-gold))' : 'transparent',
            border: 'none', cursor: 'pointer',
            padding: '7px 20px', borderRadius: 999,
            fontSize: 12, fontWeight: 800, letterSpacing: '0.10em',
            color: viewMode === 'scorecard' ? 'var(--tm-text)' : '#FBF3DC',
            fontFamily: 'inherit',
            boxShadow: viewMode === 'scorecard'
              ? '0 2px 6px rgba(201,160,64,0.35), inset 0 1px 0 rgba(255,255,255,0.30)'
              : 'none',
            transition: 'background 140ms ease, color 140ms ease, box-shadow 140ms ease',
          }}>SCORECARD</button>
          <button onClick={() => setViewMode('board')} style={{
            background: viewMode === 'board' ? 'linear-gradient(135deg, #F5D78A, var(--tm-gold))' : 'transparent',
            border: 'none', cursor: 'pointer',
            padding: '7px 20px', borderRadius: 999,
            fontSize: 12, fontWeight: 800, letterSpacing: '0.10em',
            color: viewMode === 'board' ? 'var(--tm-text)' : '#FBF3DC',
            fontFamily: 'inherit',
            boxShadow: viewMode === 'board'
              ? '0 2px 6px rgba(201,160,64,0.35), inset 0 1px 0 rgba(255,255,255,0.30)'
              : 'none',
            transition: 'background 140ms ease, color 140ms ease, box-shadow 140ms ease',
          }}>BOARD</button>
        </div>
      </div>

      {/* Body — one of the two views, driven by viewMode. Scorecard is
          the Augusta hole-by-hole grid (where you tap cells to enter
          scores). Board is the Tour-leaderboard single-row view (read
          only; tap the row to flip back to scorecard). */}
      {viewMode === 'scorecard' ? (
        /* Unified scorecard (2026-07-06, solo/multi-scorecard-unification spec):
           solo renders the SAME ScorecardTable + TotalsRow LiveOuting uses,
           with a one-participant list — a solo round IS a 1-player outing
           visually. Same columns (rank/avatar/name), same cells, same 4-row
           fill (3 empty filler rows, exactly what a 1-player outing shows).
           The old SoloScorecardTable/SoloScoreCell fork is deleted. */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {(() => {
            // Column + row constants mirror LiveOuting's exactly.
            const RANK_COL = 30, AVATAR_COL = 60, NAME_COL = 92
            const PLAYER_COL = RANK_COL + AVATAR_COL + NAME_COL
            const HOLE_COL = 32, SUB_COL = 40, ROW_H = 80
            const fillerRows = 0 // multi's filler rows are seats for players yet to join — solo has none (Matt, 2026-07-06)
            const frontPar = frontHoles.reduce((s, h) => s + (config.pars[h] || 4), 0)
            const backPar = backHoles.reduce((s, h) => s + (config.pars[h] || 4), 0)
            const shared = {
              holePars: config.pars,
              participants: soloParticipants,
              getScores: getSoloScores,
              isHost: true,
              userId: user?.id,
              isMarkerFor: isSelfMarker,
              playerTeam: () => null, // ScorecardTable calls playerTeam(p.user_id) unconditionally
              onCellTap: (_p, h) => openScoreModal(h),
              onHoleHeaderTap: null,
              matchPlayData: null,
              isP1: () => false,
              PLAYER_COL, RANK_COL, AVATAR_COL, NAME_COL, HOLE_COL, SUB_COL,
              positions,
              activeHole: hole,
              tapHint,
              rowH: ROW_H,
              fillerRows,
              skinsOutcomes: null,
            }
            return (
              /* Tournament-board frame, same structure as multi: plaque pinned
                 full-width on top, grid scrolls BETWEEN the chrome, footer pinned
                 full-width below. Chrome never rides the horizontal scroller —
                 that clipped it mid-screen (Matt's design-audit catch). */
              <>
                <LeadersPlaque />
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <ScorecardTable label="FRONT 9" holes={frontHoles} subtotalPar={frontPar} {...shared} />
                {backHoles.length > 0 && (
                  <ScorecardTable label="BACK 9" holes={backHoles} subtotalPar={backPar} {...shared} />
                )}
                <TotalsRow
                  participants={soloParticipants}
                  holePars={config.pars}
                  holeCount={holeCount}
                  coursePar={totalPar}
                  getScores={getSoloScores}
                  diffStr={() => diffStr}   /* TotalsRow calls diffStr(p)/diffColor(p) per player */
                  diffColor={() => diffColor}
                  playerTeam={() => null}
                  netMode={false}
                  netTotal={null}
                  isMatchPlay={false}
                  matchPlayData={null}
                  isP1={() => false}
                  PLAYER_COL={PLAYER_COL} RANK_COL={RANK_COL} AVATAR_COL={AVATAR_COL} NAME_COL={NAME_COL}
                  HOLE_COL={HOLE_COL} SUB_COL={SUB_COL}
                  positions={positions}
                  activeHole={hole}
                  tapHint={tapHint}
                />
                  </div>
                </div>
                <AugustaPlaqueFooter />
              </>
            )
          })()}
        </div>
      ) : (
        /* Unified board (2026-07-06 spec S3): the SAME MatchScoreboard
           multiplayer renders, with the one-participant list. */
        <MatchScoreboard
          participants={soloParticipants}
          positions={positions}
          getScores={getSoloScores}
          holePars={config.pars}
          holeCount={holeCount}
          netMode={false}
          hcpAllowance={100}
          outingMeta={{ coursePar: totalPar }}
          isMatchPlay={false}
          matchPlayData={null}
          diffStr={() => diffStr}
          netDiffStr={() => diffStr}
          user={user}
          onPlayerTap={() => setViewMode('scorecard')}
          isSkinsFormat={false}
          skinsByPlayer={{}} /* indexed unguarded — never null */
        />
      )}

      {/* Footer — Finish Round button on the left, GET DISTANCES pill on
          the right. Both flexShrink:0 so they stay visible while the
          body scrolls (satisfies "floats with scroll"). Earlier
          implementation had GET DISTANCES position:absolute at
          bottom:80, which overlapped the BACK 9 score row's right
          cells. (2026-05-07 PM — Matt: 'shouldnt be blocking cells in
          the scoreboard so move it down a tiny bit'.) */}
      <div style={{ padding: '12px 16px', flexShrink: 0, display: 'flex', alignItems: 'stretch', gap: 8 }}>
        <button onClick={() => { tmHaptic(15); onFinish() }}
          style={{
            flex: 1, padding: '14px',
            borderRadius: 'var(--tm-radius-lg)',
            background: allDone
              ? 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))'
              : 'var(--tm-surface)',
            border: allDone ? 'none' : '1px solid var(--tm-border)',
            color: allDone ? 'var(--tm-text-inv)' : 'var(--tm-text-2)',
            fontWeight: 800, fontSize: 15, cursor: 'pointer',
          }}>
          {allDone ? 'Finish Round' : `Finish · ${holesPlayed}/${holeCount}`}
        </button>
        {/* GET DISTANCES pill — same gold gradient + chevron LiveOuting
            uses (~line 3489). Flex-aligned to the Finish button's
            height so they read as one footer row. Hidden when the
            round is complete (no need for distances) or no parent
            handler. (2026-05-07 PM — moved into footer to stop
            blocking BACK 9 cells.) */}
        {onGoToEagleEye && !allDone && (
          <button
            onClick={() => onGoToEagleEye(hole + 1)}
            style={{
              flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(232,192,90,0.95), rgba(201,160,64,0.95))',
              border: '1px solid rgba(245,215,138,0.6)',
              borderRadius: 'var(--tm-radius-lg)',
              padding: '14px 16px',
              color: 'var(--tm-text)',
              fontSize: 12, fontWeight: 800, letterSpacing: '0.06em',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.30), 0 0 0 1px rgba(245,215,138,0.15)',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: 'inherit',
            }}
          >
            DISTANCES
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--tm-text)' }}><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        )}
      </div>

      {editingHole != null && (
        <SoloScoreModal
          hole={editingHole}
          par={config.pars[editingHole] || 4}
          currentScore={scores[editingHole] || 0}
          holeCount={holeCount}
          shots={shots[editingHole] || []}
          currentPutts={putts[editingHole] ?? null}
          currentFirstPutt={firstPutts[editingHole] ?? null}
          onSave={handleSaveScore}
          onAddShot={handleAddShot}
          onClose={() => setEditingHole(null)}
        />
      )}

      {/* "Saved" confirmation chip — same gold flash that LiveOuting
          shows for multi-player score commits. Portals itself to
          document.body so positioning is viewport-relative. */}
      <SavedChip savedAt={savedAt} />

      {/* Celebration share-card modal — same one LiveOuting fires for
          multi-player birdies/eagles/HIO. shouldCelebrate gates entry;
          modal handles its own portal + animation. (2026-05-07 PM) */}
      {celebrate && (
        <HighlightShareModal
          playerName={user?.name || 'You'}
          avatarUrl={user?.avatar}
          score={celebrate.score}
          par={celebrate.par}
          holeNumber={celebrate.holeNumber}
          courseName={config.courseName}
          onClose={() => setCelebrate(null)}
        />
      )}
    </div>
  )
}

// ─── Shot Sheet — club + SG phase-2 facts (lie, distance to pin) ─────────────
// Two steps: pick the club (same grid as the old ClubSheet), then optionally
// tag the lie + distance-to-pin. "Skip details" logs club-only exactly like
// before — the SG categorizer simply skips holes whose chains are incomplete
// (no fake numbers). First shot of a hole pre-selects the Tee lie. Lie keys
// MUST match server/src/lib/sg/baselines LIES (docs/SG-DESIGN.md).


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
      {/* Top padding clears the iOS notch — same pattern as the rest of
          the solo views. (2026-05-07 PM.) */}
      <div style={{ padding: 'calc(var(--safe-top) + 24px) 20px 0', flexShrink: 0 }}>
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
// background-tab eviction). Hoisted to lib/solo-round.js 2026-05-07 so
// Outing.jsx and OutingHub.jsx can share the same source of truth — the
// previous in-file definition meant only ActiveRound knew about saved
// rounds, which broke the resume pipeline after a full page reload (see
// lib/solo-round.js for the full bug narrative).
const SOLO_ROUND_STORAGE_KEY = SOLO_KEY_LIB

export default function ActiveRound({ user, onBack, onGoToEagleEye, onCourseSelected, quickSheet = null, onQuickSheetChange, onRequestMatchTab }) {
  const [phase, setPhase] = useState('setup') // 'setup' | 'scoring' | 'summary'
  const [config, setConfig] = useState(null)  // { courseName, pars[], courseRating, slopeRating, holeHandicaps[] }
  const [hole, setHole]     = useState(0)     // 0-indexed
  const [scores, setScores] = useState([])    // per-hole strokes
  const [shots, setShots]   = useState([])    // per-hole shot logs: [[{club,dist,gps}...]]
  const [putts, setPutts]           = useState([])  // SG putt facts: putt count per hole (null = not recorded)
  const [firstPutts, setFirstPutts] = useState([])  // SG putt facts: first-putt bucket per hole
  const [gps, setGps]       = useState(null)
  const [saving, setSaving] = useState(false)
  // P2-E — saved-cue timestamp for the QuickScoreSheet (solo has no server
  // round-trip; the autosave effect persists on the state change).
  const [soloSheetSavedAt, setSoloSheetSavedAt] = useState(0)
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
        // P2-A W4 — self-heal: a restored round from a pre-session blob gets
        // its session index written so the Play surface knows about it.
        if (!readSession(user?.id)) {
          writeSession(user?.id, {
            kind: 'solo',
            courseId: saved.config.courseId ?? null,
            courseName: saved.config.courseName ?? null,
            courseTee: saved.config.courseTee ?? null,
            holeCount: saved.config.pars.length,
          })
        }
        setPhase('scoring')
        setConfig(saved.config)
        setHole(Number.isFinite(saved.hole) ? saved.hole : 0)
        setScores(Array.isArray(saved.scores) ? saved.scores : new Array(saved.config.pars.length).fill(0))
        setShots(Array.isArray(saved.shots) ? saved.shots : new Array(saved.config.pars.length).fill(null).map(() => []))
        setPutts(Array.isArray(saved.putts) ? saved.putts : new Array(saved.config.pars.length).fill(null))
        setFirstPutts(Array.isArray(saved.firstPutts) ? saved.firstPutts : new Array(saved.config.pars.length).fill(null))
      }
    } catch { /* corrupt or disabled — ignore, user starts fresh */ }
  }, [STORAGE_KEY])

  // Persist on every meaningful state change while scoring. Setup and
  // summary phases don't need autosave — only mid-round resume matters.
  useEffect(() => {
    if (phase !== 'scoring' || !config) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        phase, config, hole, scores, shots, putts, firstPutts,
      }))
    } catch { /* quota / disabled — best-effort, don't crash */ }
  }, [STORAGE_KEY, phase, config, hole, scores, shots, putts, firstPutts])

  // 2026-07-08 — Eagle Eye can log shots for this solo round while ActiveRound
  // stays mounted on another app-tab. It writes them into the SAME round blob
  // (via lib/solo-round writeSoloShots) and fires 'tm-solo-shots'. Re-hydrate
  // our shots from the blob on that signal so the autosave above (which writes
  // the whole blob) can't clobber an Eagle-Eye capture with stale local state.
  useEffect(() => {
    const onExternalShots = () => {
      if (phase !== 'scoring') return
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const saved = JSON.parse(raw)
        if (Array.isArray(saved?.shots)) setShots(saved.shots)
      } catch { /* ignore */ }
    }
    window.addEventListener('tm-solo-shots', onExternalShots)
    return () => window.removeEventListener('tm-solo-shots', onExternalShots)
  }, [STORAGE_KEY, phase])

  function clearSavedRound() {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    // P2-A C4 — the solo round is saved or abandoned; drop its session index
    // (only if the session IS a solo one — never touch a newer match session).
    const s = readSession(user?.id)
    if (s?.kind === 'solo') clearSession(user?.id)
  }

  // 2026-07-10 (Matt) — Eagle Eye's back-prompt "End round" ends a SOLO round
  // directly too: EE dispatches this event + switches to the Match tab; we
  // jump to the summary phase (the same place the Finish button lands), where
  // the user reviews and saves. Nothing is recorded without their save tap.
  useEffect(() => {
    const onRequestEnd = () => {
      if (phase === 'scoring') setPhase('summary')
    }
    window.addEventListener('tm-request-end-round', onRequestEnd)
    return () => window.removeEventListener('tm-request-end-round', onRequestEnd)
  }, [phase])

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

  function handleStart({ courseName, pars, courseRating = null, slopeRating = null, holeHandicaps = null, courseId = null, courseTee = null }) {
    // P2-A W3 — SetupSheet-started solo round registers the session index.
    writeSession(user?.id, { kind: 'solo', courseId, courseName, courseTee, holeCount: pars.length })
    setConfig({ courseName, pars, courseRating, slopeRating, holeHandicaps, courseId, courseTee })
    setScores(new Array(pars.length).fill(0))
    setShots(new Array(pars.length).fill(null).map(() => []))
    setPutts(new Array(pars.length).fill(null))
    setFirstPutts(new Array(pars.length).fill(null))
    setHole(0)
    setPhase('scoring')
  }

  function setScore(idx, val) {
    setScores(s => { const n = [...s]; n[idx] = val; return n })
  }

  // SG putt facts from the score modal (docs/SG-DESIGN.md — facts only,
  // SG computed at read time server-side).
  function setPuttFacts(idx, { putts: p, firstPutt } = {}) {
    setPutts(arr => { const n = [...arr]; n[idx] = (p == null ? null : Number(p)); return n })
    setFirstPutts(arr => { const n = [...arr]; n[idx] = firstPutt ?? null; return n })
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
        // 2026-06-26 — carry the picked tee's USGA ratings (were hardcoded
        // null, forcing the par-only differential fallback). With these a solo
        // round computes the same USGA Score Differential as an outing round.
        // Null when the user typed a free-form course (no rating available).
        courseRating: config.courseRating ?? null,
        slopeRating:  config.slopeRating ?? null,
        gameType:     'stroke',
        scores:       scores,
        // 2026-05-07 PM — include per-hole pars so the server can
        // detect per-hole achievements (first_birdie, first_eagle,
        // first_par, hole_in_one) on solo rounds. Previously only
        // round-level achievements (sub_80, streak_week) fired for
        // solo. Matt: 'players can receive achievements on solo rounds
        // as well'.
        holePars:     config.pars,
        // 2026-06-26 — per-hole Stroke Index from the picked tee so the handicap
        // engine applies net-double-bogey on the REAL SI, not a synthetic 1..18.
        // Outing rounds already had this; solo rounds were missing it. Null for
        // free-form courses. (Matt: solo must work exactly like any round.)
        holeHandicaps: config.holeHandicaps ?? null,
        shots:        shots,
        // 2026-07-02 — SG putt facts (migration 039, docs/SG-DESIGN.md).
        // Parallel arrays; null entries = holes without putt data (SG skips
        // them). Only sent when at least one hole has data.
        putts:        putts.some(p => p != null) ? putts : null,
        firstPutts:   putts.some(p => p != null) ? firstPutts : null,
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
      setPutts([])
      setFirstPutts([])
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
      <SetupSheet
        onStart={handleStart}
        onBack={onBack}
        onCourseTeeSelected={sel => {
          // Phase 1 / S2 (2026-07-10): a solo course pick seeds the App-level
          // sharedCourse so Eagle Eye auto-loads it. Reset the per-course hole
          // memory to 1 FIRST — this is a NEW round, and without the reset
          // Eagle Eye's sync effect would resume the course's last-viewed hole.
          if (sel?.course?.id) saveEyeHole(sel.course.id, 1)
          onCourseSelected?.(sel)
        }}
        gender={user?.gender}
      />
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
        putts={putts}
        firstPutts={firstPutts}
        hole={hole}
        gps={gps}
        onScoreHole={(idx, val) => setScore(idx, val)}
        onSavePutts={(idx, facts) => setPuttFacts(idx, facts)}
        onAddShot={(idx, shot) => addShot(idx, shot)}
        onSetActiveHole={(idx) => setHole(idx)}
        onFinish={() => setPhase('summary')}
        onBack={onBack}
        onGoToEagleEye={onGoToEagleEye}
      />
      {/* P2-E (2026-07-10) — QuickScoreSheet for SOLO rounds: scored from the
          Play map; Save routes into this component's own state + autosave blob
          (the single solo write path). Sheet hole is 1-indexed; this
          component's state is 0-indexed — converted here exactly once. */}
      {quickSheet?.open && config
        && quickSheet.hole >= 1 && quickSheet.hole <= config.pars.length && (
        <QuickScoreSheet
          open
          hole={quickSheet.hole}
          par={config.pars[quickSheet.hole - 1] ?? 4}
          currentScore={scores[quickSheet.hole - 1] || 0}
          contextLabel={config.courseName || 'Solo round'}
          saving={false}
          savedAt={soloSheetSavedAt}
          onSave={(score, puttFacts) => {
            const idx = quickSheet.hole - 1
            setScore(idx, score)
            setPuttFacts(idx, puttFacts)
            setSoloSheetSavedAt(Date.now())
          }}
          onClose={() => onQuickSheetChange?.({ ...quickSheet, open: false })}
          onFullScorecard={() => {
            onQuickSheetChange?.({ ...quickSheet, open: false })
            onRequestMatchTab?.()
          }}
        />
      )}
    </NoPullWrap>
  )
}
