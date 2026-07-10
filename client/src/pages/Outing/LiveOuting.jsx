import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api, post, put } from '../../lib/api.js'
import { runWithQueue, subscribeQueue, subscribeQueueDrops } from '../../lib/offline-queue.js'
import PuttChips from '../../components/scorecard/PuttChips.jsx'
import { ShotSheet } from '../../components/scorecard/ShotSheet.jsx'
import { readHoleBuffer, appendShot } from '../../lib/shot-capture.js'
import { warn } from '../../lib/logger.js'
import { courseHandicap, playerTeeRatings } from '../../lib/handicapClient.js'
import GuestModal from './GuestModal.jsx'
// 2026-05-06 Stage 5 — commissioner overlay components moved to their
// own file. LiveOuting renders them as portals from inside the live
// scorecard, so they import here, not in Outing.jsx.
import { CommissionerPanel, GroupSetup, TeamSetup } from './Commissioner.jsx'
// 2026-05-06 — celebratory share-card modal for birdie/eagle/HIO. Fired
// from saveScore on every successful sub-par write where the writer is
// the user themselves (don't celebrate someone else's score).
import HighlightShareModal, { shouldCelebrate } from './HighlightShare.jsx'
import SideBetsCard from './SideBets.jsx'
import OutingChat, { useChatUnreadCount } from './OutingChat.jsx'
import {
  AUGUSTA_GREEN, AUGUSTA_GREEN_DEEP, AUGUSTA_PANEL, AUGUSTA_PANEL_HI,
  AUGUSTA_PANEL_HOVER, AUGUSTA_TEXT, AUGUSTA_GOLD, AUGUSTA_GOLD_DIM,
  AUGUSTA_INK, AUGUSTA_WOOD,
  PlayerAvatar, initials, avatarBg, scoreLabel, tmHaptic,
} from './shared.jsx'
// S4 (2026-07-06): shared scorecard surface moved to components/scorecard/ —
// LiveOuting is now a CONSUMER of these, same as ActiveRound.
import {
  LeadersPlaque, AugustaPlaqueFooter, SavedChip, ScorecardTable, TotalsRow,
  MatchScoreboard, computePositions, findTapHint, cellBg, cellColor, cellBorder,
} from '../../components/scorecard/index.jsx'

// ─── Outing/LiveOuting.jsx ────────────────────────────────────────────────
// Extracted from the original 7600-line Outing.jsx as part of the
// 2026-05-06 refactor (Stage 4/6). Contains every component and helper
// that owns the LIVE-SCORING experience: the scorecard cells, score
// modals, score-math (positions, best-ball, stableford, skins, match
// play), the main LiveOuting orchestrator, and the live-share modal.
// Pure mechanical move; no behavior change.

// GROSS / NET explainer popover. Tiny modal triggered by the (?) icon
// next to the GROSS/NET chip on the host control row. Auto-shows once
// per user via localStorage (handled in LiveOuting). Plain-language —
// some users don't know what handicaps are, and the chip shouldn't
// require golf-club-membership-level knowledge to understand.
// (2026-05-06 — Matt feedback.)
function HcpHelpPopover({ onClose }) {
  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
      animation: 'tm-celebrate-pop 280ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 340,
        background: '#FFFDF8',
        borderRadius: 18, padding: '20px 22px 18px',
        boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
        border: '1px solid rgba(201,160,64,0.45)',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--tm-gold-text)', marginBottom: 6,
        }}>Scoring · Handicaps</div>
        <div style={{
          fontSize: 17, fontWeight: 800, color: 'var(--tm-text)', lineHeight: 1.25, marginBottom: 12,
        }}>What does GROSS / NET mean?</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <div style={{
            background: 'var(--tm-surface-2)',
            border: '1px solid var(--tm-border)',
            borderRadius: 12, padding: '10px 12px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--tm-text)', marginBottom: 4 }}>
              GROSS <span style={{ color: 'var(--tm-text-3)', fontWeight: 600 }}>· raw strokes</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--tm-text-2)', lineHeight: 1.4 }}>
              The number of times you hit the ball. No adjustments. If you took 92 strokes, you shot 92.
            </div>
          </div>
          <div style={{
            background: 'rgba(232,192,90,0.10)',
            border: '1px solid rgba(232,192,90,0.45)',
            borderRadius: 12, padding: '10px 12px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--tm-gold-text)', marginBottom: 4 }}>
              NET <span style={{ color: 'var(--tm-text-3)', fontWeight: 600 }}>· with handicap</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--tm-text-2)', lineHeight: 1.4 }}>
              Your gross minus the strokes your handicap gives you. Lets unequal players compete fairly — a 20 handicap can beat a 5 handicap on net even after a worse raw score.
            </div>
          </div>
        </div>

        <div style={{
          fontSize: 11, color: 'rgba(13,31,18,0.55)', lineHeight: 1.45, marginBottom: 14,
          padding: '8px 10px', borderRadius: 8,
          background: 'rgba(27,94,59,0.05)',
        }}>
          Tap the chip to switch the leaderboard between gross and net at any time. Default is GROSS — handicaps only apply when you opt in.
        </div>

        <button onClick={onClose} style={{
          width: '100%', padding: '12px', borderRadius: 12, border: 'none',
          background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold))',
          color: '#070C09', fontWeight: 800, fontSize: 14, cursor: 'pointer',
        }}>Got it</button>
      </div>
    </div>,
    document.body
  )
}

// 2026-05-06 — "✓ Saved" confidence chip. Renders bottom-right above
// the bottom nav for ~1500ms whenever LiveOuting's savedAt timestamp
// updates (set inside saveScore on every successful runWithQueue
// resolution). Visually quiet — small Augusta-green pill with a white
// check — so it confirms data persistence without competing with the
// celebratory recent-event banner above the scorecard. Self-dismisses
// via state-tick driven by setTimeout; no user interaction required.
// 2026-05-06 — initial-load skeleton for LiveOuting. Replaces the old
// "Loading scorecard…" centered text. The shape mirrors what the user
// is about to see: the dark-green header band with a back chevron and
// a course-title placeholder, followed by 4 row-shaped placeholders
// for the leaderboard. Reduces "page jump" feel when data lands.

function ScorecardSkeleton({ onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'transparent' }}>
      {/* Header band — same dark-green strip as the real header. */}
      <div style={{
        padding: 'calc(var(--safe-top) + 14px) 16px 10px',
        background: 'rgba(232,232,232,0.55)',
        borderBottom: '2px solid rgba(90,58,22,0.85)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} aria-label="Back" style={{
            background: 'none', border: 'none', color: '#1A6B28',
            fontSize: 22, padding: '0 4px', cursor: 'pointer',
          }}>←</button>
          <div style={{ flex: 1, padding: '0 12px' }}>
            <div style={{
              height: 16, width: '60%',
              background: 'rgba(13,31,18,0.10)', borderRadius: 6,
              position: 'relative', overflow: 'hidden', margin: '0 auto',
            }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255,253,248,0.55), transparent)',
                animation: 'tm-shimmer 1.4s ease-in-out infinite',
              }} />
            </div>
          </div>
          <div style={{ width: 24 }} />
        </div>
      </div>
      {/* Body — 4 player-row skeletons */}
      <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px',
            background: 'rgba(255,253,248,0.55)',
            border: '1px solid rgba(46,158,69,0.18)',
            borderRadius: 12,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(13,31,18,0.10)',
              position: 'relative', overflow: 'hidden', flexShrink: 0,
            }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255,253,248,0.55), transparent)',
                animation: 'tm-shimmer 1.4s ease-in-out infinite',
              }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ height: 14, width: '55%', background: 'rgba(13,31,18,0.10)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,253,248,0.55), transparent)', animation: 'tm-shimmer 1.4s ease-in-out infinite' }} />
              </div>
              <div style={{ height: 11, width: '78%', background: 'rgba(13,31,18,0.10)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,253,248,0.55), transparent)', animation: 'tm-shimmer 1.4s ease-in-out infinite' }} />
              </div>
            </div>
            <div style={{ width: 48, height: 28, borderRadius: 8, background: 'rgba(13,31,18,0.08)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,253,248,0.55), transparent)', animation: 'tm-shimmer 1.4s ease-in-out infinite' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


function estimateHolePars(coursePar, holes) {
  // Distribute par fairly: base each hole at floor(coursePar/holes),
  // then add 1 to the first `remainder` holes to reach total.
  const base = Math.floor(coursePar / holes)
  const extra = coursePar - base * holes
  return Array.from({ length: holes }, (_, i) => (i < extra ? base + 1 : base))
}


// Score entry modal — stepper + quick picks
function ScoreModal({ playerName, hole, par, currentScore, holeCount, isSelf = false, code = null, uid = null, onSave, onSaveAndEagleEye, onClose }) {
  const [val, setVal] = useState(currentScore || par || 4)
  // Live putt capture (2026-07-06 spec): SELF-scoring only — the shared
  // PuttChips render solely when this modal targets the signed-in user.
  // Optional-always; a putt count above the hole score is dropped, never
  // blocks the save (same rule as the solo scorer + server lib/puttFacts).
  const [puttVal, setPuttVal]     = useState(null)
  const [firstPutt, setFirstPutt] = useState(null)
  const puttFactsFor = (score) => {
    if (!isSelf) return null
    const clean = (puttVal != null && puttVal <= score) ? puttVal : null
    return { putts: clean, firstPutt: clean != null && clean > 0 ? firstPutt : null }
  }
  // Live shot capture (2026-07-07): SELF-scoring only, opt-in, add-only — the
  // same ShotSheet the solo round uses. Rides the save ONLY when a shot was
  // logged (no prefill, so a plain score re-save can never wipe an earlier log,
  // exactly like putts). Powers OTT/APP/ARG once the outing syncs to the round.
  // Slice 0 (2026-07-07): hydrate the per-hole shot log from the shared durable
  // buffer so it survives a modal re-open / app-kill and (Slice 1) picks up
  // shots Eagle Eye logged for this hole. Self-only; keyed by outing code +
  // 0-based hole. Every append rides back through the buffer (single source).
  const shotDescriptor = { scope: `outing:${code}`, uid, holeIdx: hole }
  const [holeShots, setHoleShots]       = useState(() => (isSelf ? readHoleBuffer(shotDescriptor) : []))
  const [showShotSheet, setShowShotSheet] = useState(false)
  const shotFactsFor = () => (isSelf && holeShots.length > 0 ? holeShots : null)

  // 2026-05-06 — score=1 is a HOLE-IN-ONE regardless of par (a 1 on a
  // par-3 was previously labeled 'Eagle' since diff = -2, which is
  // technically true by score-to-par but reads wrong to anyone who
  // golfs — a 1 is universally called an ace). Override the label to
  // 'Ace' when the resolved score is 1, matching the recent-event
  // banner's HOLE-IN-ONE branch and the celebration modal's badge.
  // 'Ace' (3 letters) keeps the chip compact on small phones; the
  // big-screen version uses 'HOLE-IN-ONE'.
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

  // The "Save & Eagle Eye →" second action is enabled only when the parent
  // wired it (i.e., user is scoring their own hole AND there's a next hole
  // to advance to). The next hole label is hole+2 in 1-indexed display
  // since `hole` is 0-indexed. (2026-05-01)
  const nextHoleDisplay = hole + 2  // 1-indexed; safe — parent already capped

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
      }} onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 20px' }} />
        <div style={{ fontSize: 13, color: 'var(--tm-text-3)', textAlign: 'center', marginBottom: 4 }}>
          {playerName} — Hole {hole + 1}{par ? ` (Par ${par})` : ''}
        </div>

        {/* Stepper */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 20 }}>
          <button onClick={() => setVal(v => Math.max(1, v - 1))}
            style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontSize: 26, fontWeight: 300, cursor: 'pointer' }}>−</button>
          <div style={{ fontSize: 56, fontWeight: 900, color: cellColor(val, par), minWidth: 64, textAlign: 'center', lineHeight: 1 }}>{val}</div>
          <button onClick={() => setVal(v => v + 1)}
            style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontSize: 26, fontWeight: 300, cursor: 'pointer' }}>+</button>
        </div>

        {/* Quick picks */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          {quickPicks.map(q => (
            <button key={q.label} onClick={() => setVal(q.score)}
              style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: val === q.score ? cellBg(q.score, par) || 'var(--tm-surface-3)' : 'var(--tm-surface-2)',
                border: val === q.score ? cellBorder(q.score, par) : '1px solid var(--tm-border)',
                color: val === q.score ? cellColor(q.score, par) : 'var(--tm-text-3)',
              }}>{q.label} ({q.score})</button>
          ))}
        </div>

        {/* Putt facts — self-scoring only (shared component with the solo
            scorer; live-putt-capture spec 2026-07-06). Optional-always. */}
        {isSelf && (
          <PuttChips puttVal={puttVal} setPuttVal={setPuttVal} firstPutt={firstPutt} setFirstPutt={setFirstPutt} />
        )}

        <button onClick={() => {
          // Typo guard — most "11 on a par-3" entries are mis-taps.
          // Warn when score is more than +5 over par (or 2× par,
          // whichever is higher). Round 4 audit.
          const overBy = val - (par || 4)
          const isUnusual = overBy >= 5 || val > (par || 4) * 2
          if (isUnusual) {
            const ok = window.confirm(
              `${val} on a par-${par || 4}? That's ${overBy} over par. ` +
              `Tap Cancel to fix it, OK to save anyway.`
            )
            if (!ok) return
          }
          // Tactile confirmation that the score is committed. Fires AFTER
          // the unusual-score confirm so a mis-tap that gets cancelled
          // doesn't lie to the user. (2026-05-06 — polish task #1)
          tmHaptic(15)
          onSave(val, puttFactsFor(val), shotFactsFor())
        }} style={{
          width: '100%', padding: 16, borderRadius: 'var(--tm-radius-lg)',
          background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
          color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 16, border: 'none', cursor: 'pointer',
        }}>Save Score</button>

        {/* Save & Eagle Eye → second action. Saves the score AND jumps to
            Eagle Eye on the next hole — tightest one-tap loop for
            "play hole, score it, look at next hole's strategy." Only
            renders when parent supplied the callback (user scoring own
            hole + next hole exists). (2026-05-01) */}
        {onSaveAndEagleEye && (
          <button onClick={() => { tmHaptic(15); onSaveAndEagleEye(val, puttFactsFor(val), shotFactsFor()) }} style={{
            width: '100%', padding: 14, marginTop: 10, borderRadius: 'var(--tm-radius-lg)',
            // Solid green gradient + white text — matches the primary green
            // button pattern used elsewhere in the app (CreateWizard "Next →",
            // CodeShare "Open Match", etc.) for consistency and high contrast.
            // (2026-05-01 — Matt feedback: gold-on-faint-white was hard to see)
            background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))',
            border: 'none',
            color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            Save &amp; Eagle Eye · Hole {nextHoleDisplay}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        )}

        {/* Shot log — SELF-scoring only, optional. Powers OTT/APP/ARG Strokes
            Gained once the outing syncs into your round; never gates the save.
            Add-only + no prefill (like putts) so a plain re-save can't wipe it. */}
        {isSelf && (
          <div style={{ marginTop: 14, background: 'var(--tm-surface-2)', borderRadius: 'var(--tm-radius)', border: '1px solid var(--tm-border)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: holeShots.length ? '1px solid var(--tm-border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-text-2)' }}>
                Shot Log {holeShots.length > 0 && <span style={{ color: 'var(--tm-text-3)', fontWeight: 500 }}>· {holeShots.length}</span>}
              </div>
              <button onClick={() => setShowShotSheet(true)}
                style={{ padding: '4px 12px', borderRadius: 'var(--tm-radius-full)', background: 'var(--tm-gold-muted)', border: '1px solid var(--tm-gold-dim)', color: 'var(--tm-gold-text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                + Log Shot
              </button>
            </div>
            {holeShots.length > 0 && (
              <div style={{ padding: '4px 0' }}>
                {holeShots.map((s, i) => (
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
                    <span style={{ color: 'var(--tm-text-3)' }}>{s.toPin ? `${s.toPin}yd to pin` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Completeness hint + "forgot to log" backfill net (Slice 1, Risk R3):
            SG counts a hole only when shots + putts === score. When shots are
            MISSING, offer a one-tap add — the #1 reason manual trackers fail.
            Never blocks the save; never fabricates (the user adds the real shot). */}
        {isSelf && holeShots.length > 0 && (holeShots.length + (puttVal || 0)) !== val && (
          <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 'var(--tm-radius)', background: 'var(--tm-surface-2)', border: '1px dashed var(--tm-border)', fontSize: 11, color: 'var(--tm-text-3)', lineHeight: 1.4 }}>
            {holeShots.length} shot{holeShots.length === 1 ? '' : 's'} + {puttVal || 0} putt{(puttVal || 0) === 1 ? '' : 's'} = {holeShots.length + (puttVal || 0)}, but you entered {val}. Strokes Gained needs every shot logged to count this hole.
            {(val - (holeShots.length + (puttVal || 0))) > 0 && (
              <button onClick={() => setShowShotSheet(true)} style={{ display: 'block', marginTop: 8, padding: '6px 12px', borderRadius: 'var(--tm-radius-full)', background: 'var(--tm-gold-muted)', border: '1px solid var(--tm-gold-dim)', color: 'var(--tm-gold-text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                + Add the missing shot{(val - (holeShots.length + (puttVal || 0))) > 1 ? `s (${val - (holeShots.length + (puttVal || 0))})` : ''}
              </button>
            )}
          </div>
        )}

        {isSelf && showShotSheet && (
          <ShotSheet
            isFirstShot={holeShots.length === 0}
            onAdd={shot => { setHoleShots(appendShot(shotDescriptor, shot)); setShowShotSheet(false) }}
            onClose={() => setShowShotSheet(false)}
          />
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── Bulk Score Modal (6.2) ──────────────────────────────────────────────────
// Host-only bulk entry for an entire foursome on a single hole. Opens when
// the host taps a hole numeral on the scorecard header. Shows one row per
// player in the active group, pre-filled with their existing score (or
// blank). The "Save all" button writes them in sequence via the parent's
// onSaveAll(entries) — empty rows are dropped, only changed rows actually
// hit the server. Designed for a commissioner collecting a paper card from
// a foursome at the turn or after the round. (2026-05-02)
function BulkScoreModal({ hole, par, participants, getScores, holeCount, onClose, onSaveAll }) {
  // Local edit state per participant — keyed by user_id. Empty string = blank
  // row (skipped on save). Numbers stored as strings to allow trailing
  // edits; coerced to int on save.
  const [vals, setVals] = useState(() => {
    const m = {}
    for (const p of participants) {
      const sc = getScores(p) || []
      m[p.user_id] = sc[hole] > 0 ? String(sc[hole]) : ''
    }
    return m
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // First blank input gets focus on open — so the host can start typing
  // immediately without an extra tap. (UX)
  const firstInputRef = useRef(null)
  useEffect(() => {
    if (firstInputRef.current) firstInputRef.current.focus()
  }, [])

  function setVal(uid, raw) {
    // Allow only digits, max 2 chars (covers up to 99 — way more than any
    // real golf score). Empty string is fine for "skip this row."
    const cleaned = String(raw).replace(/[^\d]/g, '').slice(0, 2)
    setVals(prev => ({ ...prev, [uid]: cleaned }))
  }

  function bumpVal(uid, delta) {
    setVals(prev => {
      const cur = parseInt(prev[uid], 10)
      const base = Number.isFinite(cur) ? cur : (par || 4)
      const next = Math.max(1, Math.min(99, base + delta))
      return { ...prev, [uid]: String(next) }
    })
  }

  // Count rows with a real score so we can label the button. Empty inputs
  // are intentionally skipped — the host can leave the field blank if a
  // player picked up or didn't post.
  const filledEntries = participants
    .map(p => ({ userId: p.user_id, name: p.name, raw: vals[p.user_id] }))
    .filter(e => e.raw !== '' && e.raw != null)
    .map(e => ({ userId: e.userId, name: e.name, score: parseInt(e.raw, 10) }))
    .filter(e => Number.isFinite(e.score) && e.score >= 1)

  // Detect which rows actually changed vs. their pre-existing score so we
  // don't generate "no-op" PUTs that flood the audit log. (B2 audit row
  // creation is gated on a real value change, but it's cleaner to skip
  // unchanged rows up here too.)
  const changedEntries = filledEntries.filter(e => {
    const p = participants.find(pp => String(pp.user_id) === String(e.userId))
    const sc = p ? (getScores(p) || []) : []
    return Number(sc[hole]) !== e.score
  })

  // Suspicious-score guard — same heuristic as the per-player ScoreModal.
  // If ANY row is more than +5 over par or 2× par, prompt once instead of
  // surprising the host after they tap save.
  function findSuspicious() {
    return changedEntries.find(e => {
      const overBy = e.score - (par || 4)
      return overBy >= 5 || e.score > (par || 4) * 2
    })
  }

  async function handleSave() {
    if (saving) return
    setError(null)
    if (changedEntries.length === 0) {
      // Nothing to save — just close. Better UX than disabling the button
      // silently when the host opened the modal "just to look."
      onClose()
      return
    }
    const sus = findSuspicious()
    if (sus) {
      const ok = window.confirm(
        `${sus.name}: ${sus.score} on a par-${par || 4}? That's ${sus.score - (par || 4)} over. ` +
        `Tap Cancel to fix it, OK to save the batch.`
      )
      if (!ok) return
    }
    // Tactile confirmation on the bulk-save commit. One pulse for the
    // batch, not one per row — matches per-player save UX.
    // (2026-05-06 — polish task #1)
    tmHaptic(15)
    setSaving(true)
    try {
      await onSaveAll(changedEntries)
    } catch (err) {
      // Caller throws on first failure so subsequent rows don't pile on.
      // Show a banner here so the host can decide whether to retry. They
      // can dismiss the modal — already-saved rows stay saved (they
      // committed to the server before the failing row).
      setError(err?.message || 'Save failed. Already-saved rows are kept; tap Save to retry the rest.')
      setSaving(false)
    }
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end',
    }} onClick={saving ? undefined : onClose}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 36px',
        maxHeight: '85vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--tm-border-2)', margin: '0 auto 14px' }} />
        {/* Title row — hole + par + helper. Subtitle adapts to the
            actual group size so a doubles match doesn't say "Foursome".
            (Round 13 edge-case audit.) */}
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.10em', color: 'var(--tm-gold)', textTransform: 'uppercase' }}>
            Bulk entry · {participants.length === 4 ? 'Foursome'
              : participants.length === 3 ? 'Threesome'
              : participants.length === 2 ? 'Pair'
              : `${participants.length} players`}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--tm-text)', marginTop: 4 }}>
            Hole {hole + 1}{par ? ` · Par ${par}` : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--tm-text-3)', marginTop: 4 }}>
            Leave blank to skip a player
          </div>
        </div>

        {/* Row per player */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {participants.map((p, idx) => {
            const raw    = vals[p.user_id] ?? ''
            const num    = parseInt(raw, 10)
            const valid  = Number.isFinite(num) && num >= 1
            const diff   = valid ? num - (par || 4) : 0
            const colorBg = valid ? cellBg(num, par) : null
            const color   = valid ? cellColor(num, par) : 'var(--tm-text-3)'
            const diffLabel = valid
              ? (diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`)
              : ''
            return (
              <div key={p.user_id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px',
                background: 'var(--tm-surface-2)',
                borderRadius: 12,
                border: '1px solid var(--tm-border)',
              }}>
                {/* Avatar / initials */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  flexShrink: 0, overflow: 'hidden',
                  background: avatarBg(p.name),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 900, fontSize: 13,
                  fontFamily: '"Arial Black", Arial, sans-serif',
                }}>
                  {p.avatar ? (
                    <img src={p.avatar} alt={p.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : initials(p.name)}
                </div>
                {/* Name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 700, color: 'var(--tm-text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{p.name}</div>
                  {valid && (
                    <div style={{ fontSize: 11, fontWeight: 800, color, marginTop: 2 }}>
                      {diffLabel}
                    </div>
                  )}
                </div>
                {/* −/+ stepper hugging the input */}
                <button type="button"
                  onClick={() => bumpVal(p.user_id, -1)}
                  aria-label={`Decrement ${p.name} score`}
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: 'var(--tm-surface-3)', border: '1px solid var(--tm-border)',
                    color: 'var(--tm-text)', fontSize: 18, fontWeight: 300, cursor: 'pointer',
                  }}>−</button>
                <input
                  ref={idx === 0 ? firstInputRef : null}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={raw}
                  onChange={e => setVal(p.user_id, e.target.value)}
                  placeholder={String(par || 4)}
                  aria-label={`${p.name} score for hole ${hole + 1}`}
                  style={{
                    width: 56, height: 40, textAlign: 'center',
                    fontSize: 22, fontWeight: 900,
                    color: valid ? color : 'var(--tm-text)',
                    background: colorBg || 'var(--tm-surface)',
                    border: '1px solid var(--tm-border)',
                    borderRadius: 10,
                    fontFamily: '"Arial Black", Arial, sans-serif',
                  }}
                />
                <button type="button"
                  onClick={() => bumpVal(p.user_id, +1)}
                  aria-label={`Increment ${p.name} score`}
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: 'var(--tm-surface-3)', border: '1px solid var(--tm-border)',
                    color: 'var(--tm-text)', fontSize: 18, fontWeight: 300, cursor: 'pointer',
                  }}>+</button>
              </div>
            )
          })}
        </div>

        {error && (
          <div style={{
            background: 'rgba(220, 70, 70, 0.12)', border: '1px solid rgba(220, 70, 70, 0.40)',
            color: '#F0B0B0', padding: '10px 12px', borderRadius: 10, marginBottom: 12,
            fontSize: 12,
          }}>{error}</div>
        )}

        {/* Action row */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={saving} style={{
            flex: 1, padding: 14, borderRadius: 'var(--tm-radius-lg)',
            background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
            color: 'var(--tm-text)', fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, padding: 14, borderRadius: 'var(--tm-radius-lg)',
            background: 'linear-gradient(135deg, var(--tm-gold-dim), var(--tm-gold))',
            color: 'var(--tm-text-inv)', fontWeight: 800, fontSize: 15, border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
          }}>
            {saving
              ? 'Saving…'
              : changedEntries.length === 0
                ? 'Nothing to save'
                : `Save ${changedEntries.length} score${changedEntries.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// GuestModal extracted to ./Outing/GuestModal.jsx (Stage 2 refactor 2026-05-06).


// ─── Display name helpers ─────────────────────────────────────────────────────
// Build a map of user_id → display name that disambiguates collisions.
// "Matt Lavin" + "Matt Smith" → "Matt L." + "Matt S." rather than
// two indistinguishable "Matt"s on the leaderboard. If two players
// share BOTH first and last initial, fall back to the full name for
// the colliding pair only. (Round 4 audit — same-name disambiguation.)
function buildDisplayNames(participants) {
  const out = {}
  // First pass: take everyone's first-name token.
  const firsts = participants.map(p => {
    const tokens = String(p.name || '').trim().split(/\s+/).filter(Boolean)
    return { id: p.user_id, full: p.name || '', first: tokens[0] || (p.name || 'Player'), tokens }
  })
  // Bucket by first name (case-insensitive). Collisions get last initials.
  const byFirst = new Map()
  for (const e of firsts) {
    const key = e.first.toLowerCase()
    if (!byFirst.has(key)) byFirst.set(key, [])
    byFirst.get(key).push(e)
  }
  for (const [, group] of byFirst) {
    if (group.length === 1) {
      out[group[0].id] = group[0].first
      continue
    }
    // Collision — try first + last initial.
    const withLi = group.map(e => {
      const last = e.tokens.length > 1 ? e.tokens[e.tokens.length - 1] : ''
      const li = last ? `${last[0].toUpperCase()}.` : ''
      return { ...e, attempt: li ? `${e.first} ${li}` : e.first }
    })
    // If the attempted names collide too, fall back to full name for those.
    const counts = {}
    for (const e of withLi) counts[e.attempt] = (counts[e.attempt] || 0) + 1
    for (const e of withLi) {
      out[e.id] = counts[e.attempt] > 1 ? (e.full || e.first) : e.attempt
    }
  }
  return out
}

// ─── Best Ball helpers ────────────────────────────────────────────────────────
// Best Ball / 4-ball: each player plays their own ball; per hole the
// team's score = the lowest member's score. The team with the lowest
// cumulative best-ball total wins.
//
// For 2-person teams (doubles team_breakdown, or small outings with
// team_format='teams' and 2 players per team), this is straightforward:
// min of two scores per hole.
//
// For 4-person teams (foursomes team_breakdown), we take min of four
// per hole. We don't currently support "two best balls of 4" (sum of
// two lowest per hole, member-guest variant) — that's a v2 add via a
// separate format option.
//
// Returns:
//   teams:           [{ id, members[], holes[], total, holesPlayed }]
//   playerTeamTotal: { user_id: team total }    so the per-player
//                    leaderboard can show each player's team standing
//
// (2026-05-01 — league must-have B4d.)
// Pre-compute the hole indexes a player gets a stroke on, based on
// course's hole_handicaps (1 = hardest, 18 = easiest). Returns a
// Set<holeIndex>. The first N strokes go to holes ranked 1..N. If
// the player gets >N strokes (rare — handicap >18), each ranked hole
// gets a SECOND stroke first before extending. For courses with no
// hole_handicaps data we fall back to flat distribution.
function strokeHolesForPlayer(player, holePars, holeHandicaps, totalStrokes) {
  if (totalStrokes <= 0) return new Map()
  const holeCount = holePars.length
  const out = new Map()

  // Decide which hole gets a stroke first, in order. With a real
  // hole_handicaps stroke index, that's the hardest-rank hole. Without
  // one, we fall back to the holes' positional order (1, 2, 3, ...)
  // — arbitrary but deterministic and stable across re-renders.
  let order
  if (Array.isArray(holeHandicaps) && holeHandicaps.length >= holeCount) {
    order = holeHandicaps
      .slice(0, holeCount)
      .map((rank, idx) => ({ idx, rank: Number(rank) || 18 }))
      .sort((a, b) => a.rank - b.rank)
      .map(x => x.idx)
  } else {
    order = Array.from({ length: holeCount }, (_, i) => i)
  }

  // Allocate INTEGER strokes by walking the order. After the first
  // pass, if more strokes remain (handicap > 18), walk again giving
  // a second stroke to each hole in the same order. (Iteration 2 fix:
  // previously the no-stroke-index path returned fractional strokes
  // which produced fractional net scores — wrong.)
  let remaining = Math.floor(totalStrokes)
  let layer = 0
  while (remaining > 0) {
    for (const idx of order) {
      if (remaining <= 0) break
      out.set(idx, (out.get(idx) || 0) + 1)
      remaining -= 1
    }
    layer += 1
    if (layer > 4) break  // sanity — handicap > 72 strokes won't happen
  }
  return out
}

// True when an outing is team-based and the host needs the Set Teams
// surface. team_format only covers small outings (≤4); large outings
// (>4) signal teams via state.team_breakdown, and best_ball is always
// a team format regardless of size. Any saved teams also qualify.
// Before this, both the "Set Teams" button and the auto-open effect
// keyed off team_format alone, so a 6-player best-ball match (whose
// team_format stays 'individual') showed no team UI at all. (Matt's
// 3-teams-of-2 match.)
function outingUsesTeams(outing) {
  if (!outing) return false
  if (outing.team_format && outing.team_format !== 'individual') return true
  if ((outing.scoring_formats || []).includes('best_ball')) return true
  if (outing.state?.team_breakdown) return true
  if ((outing.state?.teams ?? []).length > 0) return true
  return false
}

function computeBestBall(participants, holePars, getScores, netStrokes, holeHandicaps) {
  // Group participants by their team_id. Players with no team_id go
  // into a synthetic 'solo:user_id' bucket so the math doesn't crash;
  // they'll just be a one-player team with their own scores.
  const teamMap = new Map()
  for (const p of participants) {
    const key = p.team_id != null ? `T:${p.team_id}` : `solo:${p.user_id}`
    if (!teamMap.has(key)) teamMap.set(key, { id: key, label: p.team_id ?? 'Solo', members: [] })
    teamMap.get(key).members.push(p)
  }

  // Pre-compute each member's per-hole stroke allocation using
  // hole_handicaps stroke index when available. This is the USGA-
  // correct way to apply net strokes in best-ball / 4-ball: hardest
  // hole first, then second-hardest, etc. (Iteration fix B4d-1.)
  const memberStrokeMap = new Map()
  for (const p of participants) {
    memberStrokeMap.set(p.user_id, strokeHolesForPlayer(p, holePars, holeHandicaps, netStrokes(p) || 0))
  }

  const teams = []
  const playerTeamTotal = {}
  for (const team of teamMap.values()) {
    let total = 0
    let holesPlayed = 0
    const holes = []
    for (let h = 0; h < holePars.length; h++) {
      const memberHoleScores = team.members.map(m => {
        const raw = (getScores(m) || [])[h] || 0
        if (raw <= 0) return null
        const stroke = memberStrokeMap.get(m.user_id)?.get(h) || 0
        return raw - stroke
      }).filter(s => s != null)
      if (memberHoleScores.length === 0) {
        holes.push(null)
        continue
      }
      const best = Math.min(...memberHoleScores)
      holes.push(best)
      total += best
      holesPlayed += 1
    }
    teams.push({ id: team.id, label: team.label, members: team.members, holes, total, holesPlayed })
    for (const m of team.members) playerTeamTotal[m.user_id] = total
  }
  teams.sort((a, b) => a.total - b.total)
  return { teams, playerTeamTotal }
}

// ─── Stableford helpers ───────────────────────────────────────────────────────
// Stableford rewards aggressive play with a points system. Many
// variants exist; we ship two well-known presets and accept a custom
// point map per outing. Keys are score-relative-to-par buckets:
//   double_eagle: -3 (albatross)
//   eagle:        -2
//   birdie:       -1
//   par:           0
//   bogey:        +1
//   double:       +2
//   worse:        +3 or worse  (treated as one bucket — collapsing
//                 the long tail keeps the math + UI simple)
//
// Two presets (USGA traditional + PGA Tour Modified):
//
//                 STANDARD   MODIFIED
//   double-eagle   8          8
//   eagle          4          5
//   birdie         3          2
//   par            2          0
//   bogey          1         -1
//   double         0         -3
//   worse         -1         -3
//
// (2026-05-01 — league must-have B4b.)
const STABLEFORD_PRESETS = {
  standard: { double_eagle: 8, eagle: 4, birdie: 3, par: 2, bogey: 1, double: 0, worse: -1 },
  modified: { double_eagle: 8, eagle: 5, birdie: 2, par: 0, bogey: -1, double: -3, worse: -3 },
}

// Returns { pointsByPlayer: {user_id: number} } for the active outing.
// Uses the outing's saved point map if present, else the Standard
// preset. Skips holes with no score entered.
function computeStableford(participants, holePars, getScores, pointMap) {
  const pts = pointMap || STABLEFORD_PRESETS.standard
  const out = {}
  for (const p of participants) {
    let total = 0
    const scores = getScores(p) || []
    for (let h = 0; h < holePars.length; h++) {
      const s = scores[h] || 0
      if (s <= 0) continue
      const diff = s - (holePars[h] || 4)
      let bucket
      if (diff <= -3)      bucket = 'double_eagle'
      else if (diff === -2) bucket = 'eagle'
      else if (diff === -1) bucket = 'birdie'
      else if (diff === 0)  bucket = 'par'
      else if (diff === 1)  bucket = 'bogey'
      else if (diff === 2)  bucket = 'double'
      else                  bucket = 'worse'
      total += (pts[bucket] ?? 0)
    }
    out[p.user_id] = total
  }
  return { pointsByPlayer: out }
}

// ─── Skins helpers ────────────────────────────────────────────────────────────
// Skins with carryover: each hole has a "pot" of (1 + carryover) skins.
// If exactly one player has the lowest score on the hole, they win
// the entire pot. If two or more tie, the pot carries over to the
// next hole. After the round, players are ranked by total skins won.
//
// Holes with NO scores entered yet (everyone is at 0) don't resolve —
// they sit on hold and get re-evaluated each render. This means the
// leaderboard updates live as scores come in.
//
// Returns:
//   skinsByPlayer:  { [user_id]: count }   total skins won
//   outcomes:       array of length holeCount with one of:
//                     { winner: user_id, value }   outright
//                     { tied: true, value }        carried forward
//                     { pending: true }            not enough scores
//   pendingPot:     skins still on the table (unresolved at end)
//
// (2026-05-01 — league must-have B4c.)
function computeSkins(participants, holePars, getScores) {
  const holeCount = holePars.length
  const outcomes  = new Array(holeCount).fill(null)
  const skinsByPlayer = {}
  let carry = 0
  for (let h = 0; h < holeCount; h++) {
    // Collect this hole's scores from every participant. Treat 0 as
    // "not yet scored" so the carry sits until at least 2 players have
    // posted (less than 2 = trivially "no one wins yet").
    const entries = participants
      .map(p => ({ id: p.user_id, s: (getScores(p) || [])[h] || 0 }))
      .filter(x => x.s > 0)
    if (entries.length < 2) {
      outcomes[h] = { pending: true, carry }
      continue
    }
    let low = Infinity
    let lowCount = 0
    let lowId    = null
    for (const e of entries) {
      if (e.s < low)        { low = e.s; lowCount = 1; lowId = e.id }
      else if (e.s === low) { lowCount += 1 }
    }
    if (lowCount === 1) {
      const value = 1 + carry
      outcomes[h] = { winner: lowId, value, carry }
      skinsByPlayer[lowId] = (skinsByPlayer[lowId] || 0) + value
      carry = 0
    } else {
      outcomes[h] = { tied: true, value: 1 + carry, carry }
      carry += 1  // current hole's skin rolls forward
    }
  }
  return { skinsByPlayer, outcomes, pendingPot: carry }
}

// ─── Match Play helpers ───────────────────────────────────────────────────────
// Only meaningful for exactly 2 players. When `netMode` is on AND
// the players have different handicaps, the per-hole comparison is
// the NET score (gross minus strokes-on-this-hole) rather than the
// gross. Standard USGA singles match play with handicaps.
//
// `holeStrokes` is a Map<userId, Map<holeIdx, strokes>> built from
// strokeHolesForPlayer using the LOWER handicap as the baseline —
// the higher-handicap player gets the strokes between them on the
// hardest holes per the course's stroke index.
//
// (Round 1 fix.)
function computeMatchPlay(p1, p2, getScores, holePars, holeStrokes = null) {
  const s1 = getScores(p1), s2 = getScores(p2)
  // Per-hole stroke allocation for handicap match play. holeStrokes
  // is keyed { p1: Map, p2: Map } when the caller wants net match
  // play; null/missing → gross comparison (legacy behavior).
  const k1 = holeStrokes?.p1 || null
  const k2 = holeStrokes?.p2 || null
  let p1HolesUp = 0
  const holeResults = holePars.map((par, h) => {
    const a = s1[h] || 0, b = s2[h] || 0
    if (!a || !b) return null // not yet played
    // Subtract any strokes received on this hole. For singles match
    // play the lower-handicap player's allocation is empty; the
    // higher-handicap player gets `diff` strokes on the hardest
    // `diff` holes.
    const aAdj = a - (k1 ? (k1.get(h) || 0) : 0)
    const bAdj = b - (k2 ? (k2.get(h) || 0) : 0)
    if (aAdj < bAdj) return 'p1'
    if (bAdj < aAdj) return 'p2'
    return 'half'
  })
  holeResults.forEach(r => {
    if (r === 'p1') p1HolesUp++
    else if (r === 'p2') p1HolesUp--
  })
  const played = holeResults.filter(r => r !== null).length
  const remaining = holePars.length - played
  const dormie = played > 0 && Math.abs(p1HolesUp) > remaining
  return { holeResults, p1HolesUp, played, remaining, dormie }
}


// ─── Header control system (2026-07-09 design pass) ───────────────────────────
// All match controls live in one dropdown (MatchMenu, below) instead of a
// scattered rainbow of emoji pills. Thin line icon — 13px, currentColor,
// matches the app's stroke-SVG family.
const HdrIcon = ({ d, size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {d}
  </svg>
)
const HDR_ICONS = {
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  userPlus: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></>,
  share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></>,
  coins: <><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="M16.71 13.88l.7.71-2.82 2.82"/></>,
  chat: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>,
  sliders: <><line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/></>,
  clipboard: <><path d="M9 2h6a1 1 0 0 1 1 1v1H8V3a1 1 0 0 1 1-1z"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/></>,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></>,
  help: <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
}

// One menu row inside the MatchMenu dropdown.
function MatchMenuRow({ icon, label, value, badge = 0, danger, disabled, onClick }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'flex', alignItems: 'center', gap: 11, width: '100%',
      padding: '11px 14px', background: 'transparent', border: 'none',
      cursor: disabled ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'inherit',
      color: danger ? '#B22A2A' : '#1A6B28', fontSize: 13.5, fontWeight: 700,
      opacity: disabled ? 0.5 : 1, WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{ display: 'inline-flex', width: 16, justifyContent: 'center', flexShrink: 0 }}>
        {icon ? <HdrIcon d={icon} size={16} /> : null}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {value != null && <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,107,40,0.55)' }}>{value}</span>}
      {badge > 0 && (
        <span style={{ background: '#B22A2A', color: '#fff', fontSize: 10, fontWeight: 900, borderRadius: 999, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

// Single dropdown that houses ALL the match controls (2026-07-09 design pass) —
// replaces the scattered pill rows. Premium dark-green trigger (matches the
// board's SCORECARD/BOARD toggle + gold code chip), tap-outside to close,
// grouped sections. Chat unread surfaces as a dot on the collapsed trigger.
function MatchMenu({ sections, triggerBadge = 0, align = 'right' }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Match menu" style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 15px',
        borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 800,
        letterSpacing: '0.08em', color: '#F5D78A', position: 'relative',
        background: 'linear-gradient(135deg, #14512E 0%, #0E3B23 100%)',
        border: '1px solid rgba(168,134,46,0.55)',
        boxShadow: '0 3px 10px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.12)',
        WebkitTapHighlightColor: 'transparent',
      }}>
        <HdrIcon d={HDR_ICONS.sliders} size={14} />
        MENU
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}><polyline points="6 9 12 15 18 9"/></svg>
        {!open && triggerBadge > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -3, background: '#B22A2A', color: '#fff', fontSize: 9, fontWeight: 900, borderRadius: 999, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', border: '1.5px solid rgba(252,251,246,0.95)' }}>
            {triggerBadge > 99 ? '99+' : triggerBadge}
          </span>
        )}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div role="menu" style={{
            position: 'absolute', top: 'calc(100% + 8px)', [align]: 0, zIndex: 41,
            minWidth: 236, maxWidth: '82vw',
            background: 'rgba(252,251,246,0.98)',
            border: '1px solid rgba(14,59,35,0.14)', borderRadius: 14,
            boxShadow: '0 18px 44px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.7)',
            overflow: 'hidden', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          }}>
            {sections.map((sec, si) => (
              <div key={si} style={si > 0 ? { borderTop: '1px solid rgba(14,59,35,0.10)' } : undefined}>
                {sec.label && <div style={{ padding: '9px 14px 3px', fontSize: 9, fontWeight: 800, letterSpacing: '0.13em', color: 'rgba(26,107,40,0.5)' }}>{sec.label}</div>}
                {sec.items.map((it, ii) => (
                  <MatchMenuRow key={ii} {...it} onClick={it.onClick ? () => { setOpen(false); it.onClick() } : undefined} disabled={!it.onClick} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Live Outing Scorer ───────────────────────────────────────────────────────
export default function LiveOuting({ code, user, onBack, onMatchEnd, onGoToEagleEye, sharedCourse = null, onCourseSelected }) {
  const [outing, setOuting] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showTeams, setShowTeams] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  // Commissioner correction panel — host-only modal with withdraw
  // toggles + audit log readout. (B3, 2026-05-01)
  const [showManage, setShowManage] = useState(false)
  // 2026-05-06 (polish task #7) — host-triggered side-bet sheet.
  const [showSideBets, setShowSideBets] = useState(false)
  // 2026-05-06 (polish task #8) — outing chat sheet.
  const [showChat, setShowChat] = useState(false)
  // 2026-05-06 hardening — unread-message count for the Chat button
  // badge. Stops polling while the chat sheet is open since reads
  // happen there. Persists "seen" via localStorage so the badge
  // doesn't re-show on refresh.
  const chatUnread = useChatUnreadCount(code, { enabled: !showChat })
  // Score-conflict dialog — when /scores/host returns 409 with a
  // different existing score, surface a styled prompt rather than
  // window.confirm. resolveConflict carries the resolver fn so the
  // saveScore promise can await the user's decision. (Final pass.)
  const [conflictPrompt, setConflictPrompt] = useState(null)
  // { hole, existing, incoming, resolve }
  // Live-share modal — QR + URL + tee-box print page. Opens from
  // the host action row's '📡 Share live' button. (Round 3 audit.)
  const [showLiveShare, setShowLiveShare] = useState(false)
  // Offline queue size — surfaces a small pill when scores are
  // pending sync (cell signal dropped on the course). (B5)
  const [queuedCount, setQueuedCount] = useState(0)
  // Banner shown when a queued mutation is permanently dropped (server
  // refused, permission revoked, etc.) — explains to the user that
  // their optimistic local update will be reconciled with the server.
  // (Iteration 3 fix.)
  const [droppedNotice, setDroppedNotice] = useState(null)

  // loadOuting must be declared BEFORE any useEffect that lists it as
  // a dependency. The dep array is evaluated synchronously during
  // render — listing a const before it's initialized is a TDZ trip
  // that production minifiers surface as 'Cannot access ge before
  // initialization.' (Hot-fix 2026-05-02 round 2.)
  const loadOuting = useCallback(async () => {
    try {
      const data = await api(`/api/outings/${code}`)
      setOuting(data.outing)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [code])

  useEffect(() => subscribeQueue(setQueuedCount), [])
  useEffect(() => subscribeQueueDrops((item, reason) => {
    setDroppedNotice({ item, reason, at: Date.now() })
    // Immediately re-fetch the outing so local state realigns with
    // the server — the optimistic update needs to be reconciled.
    loadOuting()
  }), [loadOuting])
  // Auto-dismiss the dropped-notice banner after 7 seconds.
  useEffect(() => {
    if (!droppedNotice) return
    const t = setTimeout(() => setDroppedNotice(null), 7000)
    return () => clearTimeout(t)
  }, [droppedNotice])
  const [scoreModal, setScoreModal] = useState(null) // { userId, userName, hole }
  // Bulk-foursome score entry (6.2). When the host taps a hole number on the
  // scorecard header, this is set to that hole index and a modal pops with
  // one numeric input per player in the active group — pre-filled with the
  // current score (or blank). Saves all rows in sequence, with one final
  // loadOuting() after the batch instead of per-row, so a foursome's hole
  // can be entered in one round-trip-ish flow.
  const [bulkEntryHole, setBulkEntryHole] = useState(null) // 0-indexed hole or null
  const [showGuestModal, setShowGuestModal] = useState(false)
  const [netMode, setNetMode] = useState(false)
  // 2026-05-06 — GROSS/NET explainer popover. Casual players who don't
  // know what handicaps are can tap the `?` next to the chip for a
  // quick definition. We also auto-show it ONCE per user the first
  // time they see the chip (gated by hasHandicaps), then never again
  // unless they tap the `?` themselves. (Matt feedback.)
  const [showHcpHelp, setShowHcpHelp] = useState(false)
  const [ending, setEnding] = useState(false)
  const [saving, setSaving] = useState(false)
  // Most recent score event — pops a broadcast banner at the top of the
  // board for ~4s when a score is entered. (2026-04-30 PM round 10)
  const [recentEvent, setRecentEvent] = useState(null)
  // 2026-05-06 — "✓ Saved" confidence cue. Set to Date.now() after every
  // successful score write; the bottom-right SavedChip renders when
  // savedAt is within the last 1500ms. After Sean's lost round we
  // wanted users to have an explicit signal that their score reached
  // the server (or is queued offline and will sync). See SavedChip
  // below for the render path.
  const [savedAt, setSavedAt] = useState(0)
  // 2026-05-06 — Highlight share-card. Set to a payload object after
  // a SELF-written sub-par score so the user can share a branded
  // image of their birdie/eagle/HIO. Cleared on modal close. Only
  // fires for the writer's own score — we don't celebrate someone
  // else's birdie when YOU are the one entering it.
  const [highlight, setHighlight] = useState(null)
  // SCORECARD <-> BOARD view toggle (2026-05-01 — match-page completion plan,
  // Thread 1). null = use auto default (BOARD for 4+ players, else SCORECARD).
  // Set explicitly when the user taps the toggle.
  const [viewMode, setViewMode] = useState(null)
  // For large outings (>4 players, split into foursomes). Tracks which
  // group the user is currently viewing in scorecard mode. Defaults to
  // their own group; host can switch to any group via the chip selector.
  // Null means "all groups" (small outing or fallback). (2026-05-01)
  const [activeGroupId, setActiveGroupId] = useState(null)
  // Auto-end suggestion dismissal — must be declared up here, BEFORE
  // the if-loading/if-not-outing early returns. Otherwise the hook
  // count differs between the two render passes and React fires
  // error #310. (Hot-fix round 3.)
  const [autoEndDismissed, setAutoEndDismissed] = useState(false)

  // (loadOuting is declared earlier, above the useEffects that
  // depend on it — see the TDZ-fix note up top. Don't redeclare here.)
  useEffect(() => { loadOuting() }, [loadOuting])
  // Poll every 5s for live scores
  useEffect(() => {
    const t = setInterval(loadOuting, 5000)
    return () => clearInterval(t)
  }, [loadOuting])
  // Auto-pop the GROSS/NET help ONCE per user the first time they
  // open a match where any non-guest participant has a handicap. Must
  // live up here with the other useEffects — putting it down by the
  // hasHandicaps computation puts it AFTER the early-return paths
  // (`if (loading) return`, `if (!outing) return`) which changes hook
  // count between renders and trips React error #310. We compute
  // hasHandicaps INSIDE the effect from outing.state directly so we
  // don't need the mid-render `participants` array.
  // (2026-05-06 — initial place was wrong; hotfix moves it here.)
  useEffect(() => {
    if (!outing) return
    const ps = outing.state?.participants || []
    const hasH = ps.some(p => p?.handicap != null && !p?.is_guest)
    if (!hasH) return
    let seen = '0'
    try { seen = localStorage.getItem('tm-gross-net-help-seen') || '0' } catch {}
    if (seen !== '1') {
      setShowHcpHelp(true)
      try { localStorage.setItem('tm-gross-net-help-seen', '1') } catch {}
    }
  }, [outing])
  // Auto-clear the recent-event banner ~4s after it pops
  useEffect(() => {
    if (!recentEvent) return
    const t = setTimeout(() => setRecentEvent(null), 4000)
    return () => clearTimeout(t)
  }, [recentEvent])
  // Auto-open team setup for host when outing has a team format but no teams yet
  useEffect(() => {
    if (!outing) return
    const isHost      = String(outing.host_id) === String(user?.id)
    const isTeamFmt   = outingUsesTeams(outing)
    const hasTeams    = (outing.state?.teams ?? []).length > 0
    if (isHost && isTeamFmt && !hasTeams) {
      setShowTeams(true)
    }
  }, [outing?.id])

  // First-load course sync to App.jsx's sharedCourse. Fires once per
  // outing.id (the ref guards against the 5s polling re-firing). Fetches
  // the full course detail, matches the saved tee by name, and pushes the
  // {course, tee} pair up so EagleEye can auto-load it. Skipped when the
  // outing has no course_id (legacy match created without a real course)
  // or when sharedCourse already matches (avoids redundant fetches).
  // (2026-05-01)
  const courseSyncedForOutingRef = useRef(null)
  useEffect(() => {
    if (!outing?.id) return
    if (!outing.course_id) return                   // no real course on this match
    if (!onCourseSelected) return                   // parent didn't wire the callback
    if (courseSyncedForOutingRef.current === outing.id) return  // already synced this outing
    if (sharedCourse?.course?.id === outing.course_id
        && sharedCourse?.tee?.tee_name === outing.course_tee) {
      // App already has the right course. Mark synced so polling doesn't
      // retry, and skip the fetch.
      courseSyncedForOutingRef.current = outing.id
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const detail = await api(`/api/courses/${outing.course_id}`)
        if (cancelled) return
        // Find the saved tee in the male/female arrays. The CoursePicker
        // stores the chosen tee by tee_name only (not gender), so search
        // both. Fallback to the first male tee if nothing matches.
        const allTees = [...(detail.tees?.male || []), ...(detail.tees?.female || [])]
        const tee = allTees.find(t => t.tee_name === outing.course_tee) || allTees[0] || null
        if (!tee) return
        onCourseSelected({ course: detail, tee })
        courseSyncedForOutingRef.current = outing.id
      } catch (e) {
        warn('[course-sync]', e?.message)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outing?.id, outing?.course_id, outing?.course_tee])

  async function addGuest(name) {
    try {
      await post(`/api/outings/${code}/guests`, { name })
      await loadOuting()
      setShowGuestModal(false)
    } catch (e) { console.error(e) }
  }

  // F.5 S6 — host flips scoring mode (open ⇄ designated). In designated mode
  // only the host + assigned scorers (markers) enter others' scores; assign /
  // hand off the scorer via the Groups setup (the markers UI).
  async function changeScoringMode(mode) {
    try {
      await put(`/api/outings/${code}/scoring-mode`, { mode })
      await loadOuting()
    } catch (e) { console.error(e) }
  }

  async function endMatch() {
    if (!window.confirm('End this match? Scores will be finalized and rivalries updated.')) return
    setEnding(true)
    try {
      const data = await post(`/api/outings/${code}/end`, {})
      onMatchEnd?.(data.summary)
    } catch (e) { console.error(e); setEnding(false) }
  }

  // Returns true on success (including conflict-resolved force-write
  // and queued-while-offline), false on user-cancelled conflict, and
  // false on any unrecoverable failure. The bulk-foursome modal (6.2)
  // checks this return value to decide whether to keep iterating —
  // catching errors INSIDE saveScore (so the per-row banner still
  // pops) is fine, but a bulk caller still needs to know not to keep
  // saving when the previous row blew up. (Round 12 edge-case audit.)
  async function saveScore(hole, score, targetUserId, puttFacts = null, shots = null) {
    setSaving(true)
    // 2026-05-06 — capture the OLD score from local state before the
    // write, so we can detect no-op re-taps. The highlight modal
    // (birdie/eagle/HIO celebration) should only fire when the score
    // actually changed — re-tapping "3" on a hole that was already a
    // birdie shouldn't pop the modal again.
    const oldScoreForCompare = (() => {
      const p = (outing?.state?.participants || []).find(x => String(x.user_id) === String(targetUserId))
      const s = p?.scores?.[hole]
      return Number.isFinite(s) ? s : 0
    })()
    try {
      // Host endpoint also handles same-foursome marker writes per
      // the 2026-05-01 widening — call it whenever the writer isn't
      // the player themselves. The server gates permissions.
      // All writes route through runWithQueue so a flaky cell signal
      // doesn't lose the score — it's queued in localStorage and
      // replayed when connectivity returns. (B5)
      const isSelfEdit = String(targetUserId) === String(user?.id)
      const targetUrl = isSelfEdit && String(outing?.host_id) !== String(user?.id) && !isMarkerFor(String(user?.id), String(targetUserId))
        ? `/api/outings/${code}/scores`
        : `/api/outings/${code}/scores/host`
      // Live putt capture (2026-07-06 spec): putt fields ride the body ONLY
      // when the writer IS the target (chips only render for self, but guard
      // here too). Present on BOTH endpoints — a host/marker scoring
      // themselves routes through /scores/host, where the server applies
      // putts only for writer===target. Fields inside the idempotency-keyed
      // body ⇒ offline replays are automatically putt-consistent.
      // Ride ONLY when a count was actually picked — the modal has no putt
      // prefill, so sending putts:null on a later score re-save would wipe an
      // earlier entry (audit catch). Explicit clears live in the post-hoc editor.
      const puttRide = (isSelfEdit && puttFacts && puttFacts.putts != null)
        ? { putts: puttFacts.putts, firstPutt: puttFacts.firstPutt } : null
      // Live shot capture (2026-07-07): the self-entered per-hole shot log rides
      // ONLY when the writer IS the target AND a shot was logged (no prefill ⇒ a
      // plain re-save never wipes it). The server applies shots self-only too.
      const shotRide = (isSelfEdit && Array.isArray(shots) && shots.length > 0)
        ? { shots } : null
      const baseBody = isSelfEdit && targetUrl.endsWith('/scores')
        ? { hole, score, ...(puttRide || {}), ...(shotRide || {}) }
        : { hole, score, user_id: targetUserId, ...(puttRide || {}), ...(shotRide || {}) }

      // F.5 S3 — idempotency key generated ONCE here, at the moment of the
      // user's action, and carried by both the immediate attempt and (if the
      // network drops) the queued replay. This is what makes "set hole 7 to 5"
      // apply exactly once even if the ack is lost and the write is replayed on
      // reconnect or app restart. A new tap gets a new key; the force-retry
      // below is a DIFFERENT action (different body) and gets its own key.
      const idemKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`

      let writeResult = null
      try {
        writeResult = await runWithQueue({ url: targetUrl, method: 'PUT', body: baseBody, idempotencyKey: idemKey })
      } catch (err) {
        // Score-conflict handshake (B2). Server returns 409 with the
        // existing different score; surface a styled prompt rather
        // than window.confirm. (Final pass polish.)
        if (err?.status === 409 && err?.payload?.error === 'score_conflict') {
          const existing = err.payload.existing_score
          // F.5 S2 — value-aware reconcile. If the server's current value
          // already equals what we're entering, there's no real conflict
          // (someone else typed the same number): converge silently, no
          // prompt. Only a genuine DIFFERENT value surfaces the inline chip,
          // which names who entered it (last_written_by, when the OCC flag
          // is on) so the scorer can decide in one tap.
          if (Number(existing) === Number(score)) {
            writeResult = { ok: true, converged: true }
          } else {
            const ok = await new Promise(resolve => {
              setConflictPrompt({
                hole: Number(hole), existing, incoming: Number(score),
                by: err.payload.last_written_by || null,
                resolve,
              })
            })
            setConflictPrompt(null)
            if (!ok) { setSaving(false); return false }   // "keep theirs" — bulk should stop
            // Force-overwrite is a new, user-confirmed action with a different
            // body, so it gets a FRESH idempotency key (reusing idemKey would
            // correctly 422 on the body-hash mismatch).
            const forceKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`
            writeResult = await runWithQueue({ url: targetUrl, method: 'PUT', body: { ...baseBody, force: true }, idempotencyKey: forceKey })
          }
        } else {
          throw err
        }
      }
      // Pop the recent-event banner — broadcast feel when a score lands.
      // Looks up the par from current outing state, and the player name.
      const targetPlayer = (outing?.state?.participants || []).find(p => String(p.user_id) === String(targetUserId))
      const parsForLookup = estimateHolePars(outing?.course_par ?? 72, outing?.state?.holes ?? 18)
      const parForHole = (Array.isArray(outing?.hole_pars) && outing.hole_pars[hole])
        ? outing.hole_pars[hole]
        : parsForLookup[hole] || 4
      if (targetPlayer && score > 0) {
        setRecentEvent({ name: targetPlayer.name, hole, score, par: parForHole, ts: Date.now() })
      }
      // 2026-05-06 — confidence cue for every save (including erasures
      // where score === 0 and the recent-event banner doesn't fire).
      setSavedAt(Date.now())
      // 2026-05-06 — Highlight share-card for the writer's own birdie /
      // eagle / albatross / hole-in-one. Suppression rules:
      //   - Self-edit only — celebrating someone else's birdie when YOU
      //     tapped it (as host / marker) would feel wrong.
      //   - Score actually changed — re-tapping "3" when hole was
      //     already a 3 shouldn't re-fire the modal.
      //   - shouldCelebrate gates score-vs-par + hole-in-one rules.
      if (
        isSelfEdit &&
        Number(score) !== Number(oldScoreForCompare) &&
        shouldCelebrate(Number(score), Number(parForHole)) &&
        targetPlayer
      ) {
        setHighlight({
          playerName: targetPlayer.name || user?.name || 'Player',
          avatarUrl:  targetPlayer.avatar || user?.avatar || null,
          score:      Number(score),
          par:        Number(parForHole),
          // hole is 0-indexed in saveScore; users see 1-indexed numbers.
          holeNumber: Number(hole) + 1,
          courseName: outing?.course_name || '',
        })
      }
      // 2026-05-06 (polish task #5) — surface freshly-earned
      // achievements via the global toast event. Gated on isSelfEdit
      // so a host writing on behalf of someone else doesn't see
      // someone else's first-eagle pop on their own screen.
      if (isSelfEdit && Array.isArray(writeResult?.achievements) && writeResult.achievements.length) {
        window.dispatchEvent(new CustomEvent('tm:achievement-earned', {
          detail: { achievements: writeResult.achievements },
        }))
      }
      await loadOuting()
      return true
    } catch (e) {
      // Surface the failure to the user instead of silently
      // swallowing. Auth-expired, withdrawn-player rejection, and
      // unexpected server errors all land here; the user needs a
      // signal so they can react. (Round 6 audit.)
      console.error('[saveScore]', e)
      const msg = e?.payload?.error === 'player_withdrawn'
        ? (e.payload.message || 'Player has been withdrawn.')
        : e?.status === 401
          ? 'Your session expired. Please sign in again.'
          : (e?.message || 'Could not save score. Try again.')
      // Lightweight banner via the existing recent-event slot —
      // hijack ts to make it auto-dismiss; payload distinguishes
      // 'event' vs 'error' below.
      setRecentEvent({ kind: 'error', message: msg, ts: Date.now() })
      return false
    }
    finally { setSaving(false) }
  }

  if (loading) return <ScorecardSkeleton onBack={onBack} />
  if (!outing) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, padding: 20 }}>
      <div style={{ color: 'var(--tm-text)', fontWeight: 700, fontSize: 16 }}>Match not found</div>
      <button onClick={onBack} style={{ color: 'var(--tm-green-text)', background: 'none', border: 'none', fontWeight: 700 }}>← Back</button>
    </div>
  )

  // All participants in state, including withdrawn. Used by the
  // commissioner panel which needs to see everyone. (B3)
  const allParticipantsRaw = outing.state?.participants ?? []
  // Same-name disambiguation: 'Matt Lavin' + 'Matt Smith' →
  // 'Matt L.' + 'Matt S.' Override the .name field on each
  // participant so every render path gets the disambiguated label
  // for free (leaderboard, scorecard, score modal, audit, etc.).
  // (Round 4 audit — same-name disambiguation.)
  const namesMap = buildDisplayNames(allParticipantsRaw)
  const allParticipants = allParticipantsRaw.map(p => ({
    ...p,
    display_name: namesMap[p.user_id] || p.name,
    name: namesMap[p.user_id] || p.name,
  }))
  // Hole config has to come BEFORE the no-show policy block — the
  // max_plus_2 synthesis reads holeCount + holePars when applying
  // per-player score fills. Order-of-declaration matters because of
  // the .map(applyNoShowPolicy) call below — in production builds
  // a TDZ violation here showed up as "Cannot access 'ge' before
  // initialization." (Hot-fix 2026-05-02.)
  const teams        = outing.state?.teams ?? []
  const markers      = outing.state?.markers ?? []  // [{ marker_id, member_ids[] }]
  // F.5 S6 — scoring mode. 'designated' = only host + assigned scorer enter
  // others' scores (players still self-score their own card). Default 'open'.
  const scoringMode  = outing.state?.scoring_mode || 'open'
  const holeCount    = outing.state?.holes ?? 18
  const coursePar    = outing.course_par ?? 72
  // Prefer real per-hole pars from the picked course; fall back to the
  // synthetic distribution for legacy matches that have no course_id.
  // (2026-04-30 — migration 006 added the column)
  const realHolePars = Array.isArray(outing.hole_pars) ? outing.hole_pars : null
  const holePars     = realHolePars && realHolePars.length >= holeCount
    ? realHolePars.slice(0, holeCount)
    : estimateHolePars(coursePar, holeCount)

  // Active leaderboard pool — withdrawn players are excluded from
  // ranking, scoring, and leaderboard rendering.
  //
  // No-show handling (item 6): per outing.state.no_show_policy:
  //   - 'dns'        → exclude no-shows from the active pool; render
  //                    a separate "Did Not Start" section below.
  //   - 'max_plus_2' → synthesize unscored holes as (par + 2) so they
  //                    rank with a punitive total. Original p.scores
  //                    untouched (audit log shows real entries).
  //   - 'manual'     → leave no-shows in pool with whatever scores
  //                    the commissioner has entered (or none).
  const noShowPolicy = outing.state?.no_show_policy || 'dns'
  function applyNoShowPolicy(p) {
    if (!p.no_show) return p
    if (noShowPolicy === 'dns') return p          // caller filters
    if (noShowPolicy === 'manual') return p
    if (noShowPolicy === 'max_plus_2') {
      // Synthesize a max+2 score for any hole that's currently 0/empty.
      const sc = Array.isArray(p.scores) ? [...p.scores] : new Array(holeCount).fill(0)
      while (sc.length < holeCount) sc.push(0)
      for (let h = 0; h < holeCount; h++) {
        if (!sc[h] || sc[h] <= 0) sc[h] = (holePars[h] || 4) + 2
      }
      const total = sc.reduce((s, v) => s + (v || 0), 0)
      return { ...p, scores: sc, total, holes_played: holeCount, _synthetic: true }
    }
    return p
  }
  // 2026-05-06 hotfix — hydrate team_id from state.teams[].member_ids.
  // Best Ball / team scoring formats key off `p.team_id`, but the saved
  // shape only has the team mapping at the OUTING level (state.teams)
  // not on each participant row. Without this, computeBestBall treats
  // every player as their own solo team and the leaderboard renders as
  // singles instead of teams. (Matt's PLSL match.)
  const teamIdByUserId = (() => {
    const m = new Map()
    for (const t of (outing.state?.teams || [])) {
      for (const uid of (t.member_ids || [])) m.set(String(uid), t.id)
    }
    return m
  })()
  const participants = allParticipants
    .filter(p => !p.withdrawn)
    .filter(p => !(p.no_show && noShowPolicy === 'dns'))
    .map(applyNoShowPolicy)
    .map(p => {
      // Explicit Set Teams membership is authoritative: when the host
      // has assigned this player to a team, it overrides any stale
      // auto join-order team_id. Only fall back to the auto team_id
      // when state.teams says nothing about this player. (Before, the
      // `p.team_id ?? tid` coalescing let a stale auto pairing shadow
      // a manual reassignment, and hand-added players with no team_id
      // and no membership rendered as solo teams.)
      const tid = teamIdByUserId.get(String(p.user_id))
      return tid != null ? { ...p, team_id: tid } : p
    })
  // DNS section roster — players excluded from ranking but still on
  // the roster. Empty when policy isn't DNS.
  const noShowList = noShowPolicy === 'dns'
    ? allParticipants.filter(p => !p.withdrawn && p.no_show)
    : []
  const isHost       = String(outing.host_id) === String(user?.id)
  const isTeamFormat = outingUsesTeams(outing)

  // Returns true if userId is an assigned marker responsible for
  // targetId's scores OR (in a large outing) they're in the same
  // foursome. The same-group rule lets any group member enter scores
  // for anyone else in their foursome — needed for >4 outings where
  // explicit marker assignments aren't done up front. Host already
  // gets blanket access via the `isHost` check at every call site.
  // (2026-05-01 — Matt: any player can enter scores for the foursome
  // they're grouped with, only the creator can enter for ALL.)
  function isMarkerFor(userId, targetId) {
    if (markers.some(m =>
      String(m.marker_id) === String(userId) &&
      m.member_ids.map(String).includes(String(targetId))
    )) return true
    // Same-foursome fallback for large outings.
    const u = participants.find(p => String(p.user_id) === String(userId))
    const t = participants.find(p => String(p.user_id) === String(targetId))
    if (u?.group_id != null && t?.group_id != null && u.group_id === t.group_id) {
      return true
    }
    return false
  }
  // Returns true if userId is any marker in this match
  const isMarker = markers.some(m => String(m.marker_id) === String(user?.id))

  // Build hole index arrays: front 9 = 0..8, back 9 = 9..17
  const frontHoles = Array.from({ length: Math.min(9, holeCount) }, (_, i) => i)
  const backHoles  = holeCount > 9 ? Array.from({ length: holeCount - 9 }, (_, i) => i + 9) : []
  const frontPar   = frontHoles.reduce((s, h) => s + holePars[h], 0)
  const backPar    = backHoles.reduce((s, h) => s + holePars[h], 0)

  function playerTeam(userId) {
    return teams.find(t => t.member_ids?.map(String).includes(String(userId)))
  }

  // For each participant, build a scores array indexed by hole (0-based)
  function getScores(p) {
    const arr = p.scores || []
    if (Array.isArray(arr)) return arr
    return []
  }

  // +/- vs par for holes actually played
  function diffStr(p) {
    const sc = getScores(p)
    const played = sc.filter(s => s > 0)
    if (!played.length) return 'E'
    const holesPlayed = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    const parSoFar = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
    const d = totalSoFar - parSoFar
    return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`
  }
  function diffColor(p) {
    const sc = getScores(p)
    const holesPlayed = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    const parSoFar = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
    const d = totalSoFar - parSoFar
    return cellColor(totalSoFar || 0, parSoFar || 1)
  }

  // ── Sort leaderboard with USGA-standard card-back tiebreaker ──
  // Primary key: total strokes-to-par (lower = better, no scores = 999)
  // Tiebreakers (USGA Section 5.2 — applied automatically when totals tie):
  //   (a) lowest back-9 score (skipped on 9-hole rounds)
  //   (b) lowest last 6 holes
  //   (c) lowest last 3 holes
  //   (d) lowest 18th hole (or last hole played, for partial cards)
  // After all four, if still tied, players share the position. Sudden
  // death isn't supported here — that's a live-tournament action.
  // (2026-05-01 — league must-have B1.)

  // Compute strokes-to-par over a slice of holes for the player. Holes
  // that haven't been played (score = 0) contribute 0 — they're "even
  // par for unplayed" by USGA convention for card-back purposes.
  function strokesToParRange(p, startIdx, endIdx) {
    const sc = getScores(p)
    let total = 0
    for (let i = startIdx; i <= endIdx; i++) {
      const s = sc[i] || 0
      if (s > 0) total += s - (holePars[i] || 4)
    }
    return total
  }

  function totalStrokesToPar(p) {
    const sc = getScores(p)
    const played = sc.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    if (!played.length) return 999
    const parSum   = played.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const strokes  = played.reduce((sum, x) => sum + x.s, 0)
    return strokes - parSum
  }

  function leaderboardSort(a, b) {
    // Primary
    const da = totalStrokesToPar(a)
    const db = totalStrokesToPar(b)
    if (da !== db) return da - db
    // Hole-count slice depends on actual holes played in the round.
    const lastIdx = holeCount - 1                    // 17 for 18-hole, 8 for 9-hole
    const tieRanges = []
    if (holeCount >= 18) tieRanges.push([9, 17])     // back-9 (only meaningful on 18-hole)
    tieRanges.push([Math.max(0, lastIdx - 5), lastIdx])  // last 6
    tieRanges.push([Math.max(0, lastIdx - 2), lastIdx])  // last 3
    tieRanges.push([lastIdx, lastIdx])               // last hole
    for (const [s, e] of tieRanges) {
      const ra = strokesToParRange(a, s, e)
      const rb = strokesToParRange(b, s, e)
      if (ra !== rb) return ra - rb
    }
    return 0  // still tied — share position
  }

  // ── Skins format: compute per-hole outcomes + per-player skin counts.
  const isSkinsFormat = (outing.scoring_formats || []).includes('skins')
  const skinsData     = isSkinsFormat ? computeSkins(participants, holePars, getScores) : null
  const skinsByPlayer = skinsData?.skinsByPlayer || {}

  // ── Stableford format: compute per-player point totals using the
  // outing's saved point map (or the Standard preset). Higher = better.
  // (B4b)
  const isStablefordFormat = (outing.scoring_formats || []).includes('stableford')
  const stablefordPointMap = outing.state?.stableford_points || STABLEFORD_PRESETS.standard
  const stablefordData     = isStablefordFormat
    ? computeStableford(participants, holePars, getScores, stablefordPointMap)
    : null
  const stablefordByPlayer = stablefordData?.pointsByPlayer || {}

  // 2026-05-06 hotfix — hoisted from later in the body so they're
  // initialized BEFORE computeBestBall (which calls netStrokes
  // through a captured reference). Previously these lived ~100
  // lines below; for any outing with `best_ball` in scoring_formats
  // the call below would reach into `handicapOverrides` while it was
  // still in TDZ, throwing "Cannot access 'ci' before initialization"
  // at the Hooked-Left ErrorBoundary. Same definitions as before,
  // just earlier in source order.
  //
  // Handicap allowance: most leagues apply a percentage to the raw
  // handicap before stroke deduction. 100% = full handicap, common
  // alternatives are 80% (member-guest), 85% (4-ball-stroke), 90%
  // (singles match), 95% (stroke-play tournaments). Stored on the
  // outing as state.handicap_allowance; defaults to 100. Applied
  // BEFORE the floor so 12.0 hcp × 85% = 10.2 → floor → 10 strokes.
  // (2026-05-01 — league must-have B4a.)
  const hcpAllowance = (() => {
    const v = Number(outing.state?.handicap_allowance)
    return Number.isFinite(v) && v > 0 && v <= 100 ? v : 100
  })()
  // Tee ratings for slope-based Course Handicap net strokes (2026-06-25). Net
  // strokes are now allocated off Course Handicap = Index×Slope/113+(CR−Par),
  // not the raw index — slope-adjusted, and (since the captured ratings are
  // gender-correct) gender flows through. Falls back to the raw index when the
  // outing has no ratings (free/unrated), so those matches are unchanged.
  const outingMeta = { teeRatings: outing.tee_ratings, courseRating: outing.course_rating, slopeRating: outing.slope_rating, coursePar: outing.course_par }
  // 6.4 — Per-event handicap overrides. Commissioner-set, one-outing
  // adjustments stored in outing.state.handicap_overrides keyed by
  // user_id. If a player has an override, it takes precedence over
  // their stored tm_users.handicap for THIS outing's net calc.
  const handicapOverrides = outing.state?.handicap_overrides || {}
  function effectiveHandicap(p) {
    const ov = handicapOverrides[String(p?.user_id)]
    if (ov != null && Number.isFinite(Number(ov))) return Number(ov)
    return parseFloat(p?.handicap)
  }
  // netStrokes — strokes the player gives (positive) or receives
  // (negative). Plus-handicap players (handicap < 0) ADD strokes to
  // their gross instead of subtracting; netTotal handles the sign by
  // simple subtraction. (gross - (-2) = gross + 2)
  // Allowance is applied to magnitude, sign preserved. For positive
  // handicaps we floor (round down — fewer strokes back, harder).
  // For plus handicaps we ceil the magnitude (round up — more
  // strokes added, harder), matching USGA convention.
  function netStrokes(p) {
    // Convert the index to a slope-based Course Handicap first (gender flows
    // through via the gender-correct captured ratings); fall back to the raw
    // index when the outing is unrated. (2026-06-25)
    const raw = courseHandicap(effectiveHandicap(p), playerTeeRatings(p?.gender, outingMeta))
    if (!Number.isFinite(raw) || raw === 0) return 0
    // WHS Playing Handicap = round(Course Handicap × allowance) — ROUND to
    // nearest, not floor. (handicap audit 2026-06-25)
    const strokes = Math.round(Math.abs(raw) * hcpAllowance / 100)
    return raw >= 0 ? strokes : -strokes
  }
  function netTotal(p) {
    const gross = getScores(p).reduce((s, v) => s + (v || 0), 0)
    return gross - netStrokes(p)
  }

  // ── Best Ball: compute per-team totals (lowest of each team's
  // members per hole, summed). Players with the same team_id share
  // a team total; lowest team total wins. (B4d)
  //
  // 2026-05-06 — handicaps opt-in. Earlier this passed `netStrokes`
  // unconditionally so best-ball totals were always net-adjusted,
  // even when the user had GROSS selected on the leaderboard toggle.
  // Matt's call: handicaps shouldn't apply automatically — the user
  // has to explicitly flip the GROSS/NET button to opt in. So when
  // netMode is OFF, we pass a stroke function that always returns 0,
  // making computeBestBall run pure gross. When netMode is ON, we
  // pass the real netStrokes and the math runs USGA-correct net.
  const isBestBallFormat = (outing.scoring_formats || []).includes('best_ball')
  const courseHoleHandicaps = Array.isArray(outing.hole_handicaps) ? outing.hole_handicaps : null
  const zeroStrokes = () => 0
  // 2026-05-06 — also compute team data for "match + teams" (Four-Ball
  // Match Play). User picked match-play with 2 teams of 2 expecting
  // team scores to render; without this, best-ball math only ran when
  // scoring_formats included 'best_ball' literally, and the team
  // standings card was hidden. Matt: "i selected match play and 2
  // teams of 2... its not showing the teams scores". Fires for any
  // outing where state.teams has at least one team with 2+ members.
  const stateTeams       = outing.state?.teams || []
  const hasRealTeams     = stateTeams.some(t => (t.member_ids || []).length >= 2)
  const isMatchFormat    = (outing.scoring_formats || []).includes('match')
  const useTeamMath      = isBestBallFormat || hasRealTeams
  const bestBallData     = useTeamMath
    ? computeBestBall(participants, holePars, getScores, netMode ? netStrokes : zeroStrokes, courseHoleHandicaps)
    : null
  const bestBallByPlayer = bestBallData?.playerTeamTotal || {}
  // Sorted teams (low-to-high) for the standings card. Each entry has
  // { id, label, members, total, holesPlayed, holes }.
  const bestBallTeams    = bestBallData?.teams || []
  // Team match play — when format is `match` AND we have exactly 2
  // teams with members on each side, run match-play math against the
  // two teams' best-ball-per-hole arrays. Result feeds a small "Team
  // Match" header that reads e.g. "Team 1 · 1 UP thru 4".
  const teamMatchData = (() => {
    if (!isMatchFormat || bestBallTeams.length !== 2) return null
    const a = bestBallTeams[0], b = bestBallTeams[1]
    if (!Array.isArray(a.holes) || !Array.isArray(b.holes)) return null
    let aHolesUp = 0
    let played = 0
    for (let h = 0; h < holePars.length; h++) {
      const sa = a.holes[h], sb = b.holes[h]
      if (sa == null || sb == null) continue
      played++
      if (sa < sb) aHolesUp++
      else if (sb < sa) aHolesUp--
    }
    const remaining = holePars.length - played
    const dormie = played > 0 && Math.abs(aHolesUp) > remaining
    return { a, b, aHolesUp, played, remaining, dormie }
  })()

  // Leaderboard order:
  //   Skins      → primary: skins won desc, tiebreak: card-back STP
  //   Stableford → primary: points desc,    tiebreak: card-back STP
  //   Best Ball  → primary: team total asc, tiebreak: card-back STP
  //   Else       → standard leaderboardSort (card-back chain)
  const sorted = isSkinsFormat
    ? [...participants].sort((a, b) => {
        const sa = skinsByPlayer[a.user_id] || 0
        const sb = skinsByPlayer[b.user_id] || 0
        if (sa !== sb) return sb - sa
        return leaderboardSort(a, b)
      })
    : isStablefordFormat
    ? [...participants].sort((a, b) => {
        const pa = stablefordByPlayer[a.user_id] || 0
        const pb = stablefordByPlayer[b.user_id] || 0
        if (pa !== pb) return pb - pa
        return leaderboardSort(a, b)
      })
    : isBestBallFormat
    ? [...participants].sort((a, b) => {
        const ta = bestBallByPlayer[a.user_id] ?? 9999
        const tb = bestBallByPlayer[b.user_id] ?? 9999
        if (ta !== tb) return ta - tb  // lower team total wins
        return leaderboardSort(a, b)
      })
    : [...participants].sort(leaderboardSort)

  // ── Large-outing group context ─────────────────────────────────
  // For outings >4 players, participants are split into foursomes.
  // The Scoreboard view shows everyone (with a Group X badge).
  // The Scorecard view shows ONLY the active group's foursome so the
  // table fits a phone screen and players can read their own card.
  const stateGroups   = outing.state?.groups ?? []
  const isLargeOuting = stateGroups.length > 0
  const myParticipant = participants.find(p => String(p.user_id) === String(user?.id))
  const myGroupId     = myParticipant?.group_id ?? null
  // Default the active group to the user's own foursome when they
  // haven't chosen one yet. Host can switch via the chip selector.
  const effectiveGroupId = activeGroupId ?? myGroupId ?? (stateGroups[0]?.id ?? null)
  const groupName = (gid) => stateGroups.find(g => g.id === gid)?.name || `Group ${gid}`
  // What the Scorecard view actually renders. For small outings:
  // everyone. For large outings: just the active foursome.
  const scorecardParticipants = isLargeOuting && effectiveGroupId != null
    ? sorted.filter(p => p.group_id === effectiveGroupId)
    : sorted

  // Match Play: only active for 2-player matches with 'match' format
  const isMatchPlay   = (outing.scoring_formats || []).includes('match') && participants.length === 2
  // Match-play handicap: when netMode is on AND the two players have
  // different handicaps, the higher-handicap player receives strokes
  // on the hardest holes per the course's stroke index. Computed from
  // strokeHolesForPlayer using the difference (after allowance) as
  // the higher player's strokes; lower player gets none.
  // (Round 1 fix: net match play.)
  const matchPlayData = (() => {
    if (!isMatchPlay) return null
    let strokes = null
    if (netMode && sorted[0] && sorted[1]) {
      const ns0 = netStrokes(sorted[0])
      const ns1 = netStrokes(sorted[1])
      const diff = ns0 - ns1  // positive → p0 has more strokes (higher hcp)
      // Whichever player has MORE strokes available gets the diff
      // applied to the hardest holes. The other player gets zero
      // strokes (acts as the baseline).
      if (diff !== 0) {
        const giver = diff > 0 ? sorted[0] : sorted[1]
        const giverStrokes = strokeHolesForPlayer(giver, holePars, courseHoleHandicaps, Math.abs(diff))
        strokes = diff > 0
          ? { p1: giverStrokes, p2: new Map() }
          : { p1: new Map(),    p2: giverStrokes }
      }
    }
    return computeMatchPlay(sorted[0], sorted[1], getScores, holePars, strokes)
  })()

  // Current user's next-to-play hole (1-indexed). Used by the persistent
  // GET DISTANCES floating pill so tapping it lands the user on Eye for
  // their own next hole, regardless of where other players are. Returns
  // null when the user isn't a participant or the round is complete.
  // (2026-05-01)
  const meParticipant = participants.find(p => String(p.user_id) === String(user?.id))
  const myHolesPlayed = meParticipant ? getScores(meParticipant).filter(s => s > 0).length : 0
  const myNextHole    = meParticipant && myHolesPlayed < holeCount ? myHolesPlayed + 1 : null

  // Net scoring helpers
  // (hcpAllowance / handicapOverrides / effectiveHandicap / netStrokes /
  // netTotal hoisted above the bestBallData block — see 2026-05-06 hotfix
  // comment there. netDiffStr stays here since it isn't reached during
  // the early bestBallData computation.)
  function netDiffStr(p) {
    const gross = getScores(p)
    const holesPlayed = gross.map((s, i) => ({ s, i })).filter(x => x.s > 0)
    if (!holesPlayed.length) return 'E'
    const parSoFar = holesPlayed.reduce((sum, x) => sum + (holePars[x.i] || 4), 0)
    const totalSoFar = holesPlayed.reduce((sum, x) => sum + x.s, 0)
    const d = totalSoFar - netStrokes(p) - parSoFar
    return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`
  }
  const hasHandicaps = participants.some(p => p.handicap != null && !p.is_guest)
  // Auto-pop logic for the GROSS/NET help moved to a useEffect at the
  // TOP of the component (alongside the other useEffects), so it
  // can't be skipped by the early `if (loading) return` /
  // `if (!outing) return` paths. Putting a hook AFTER an early return
  // changes hook count between renders → React error #310.
  // (2026-05-06 hotfix.)

  // SCORECARD <-> BOARD view: explicit user choice if set, else auto-default.
  // Default to BOARD when there are 4+ players (the wide scorecard gets
  // visually busy with that many rows), SCORECARD otherwise. The user can
  // still toggle either way at any time.
  const effectiveViewMode = viewMode ?? (participants.length >= 4 ? 'board' : 'scorecard')

  // Column width constants. The leftmost area of each row is now split into
  // THREE cells: RANK_COL (position badge), AVATAR_COL (square photo box),
  // NAME_COL (surname caps + THRU subtitle). PLAYER_COL is the sum and is
  // still used for header spans over the whole left side.
  const RANK_COL   = 30        // position badge — "1", "T2", etc
  const AVATAR_COL = 60        // square; matches rowH visually w/o forcing it
  const NAME_COL   = 92        // surname caps + THRU subtitle
  const PLAYER_COL = RANK_COL + AVATAR_COL + NAME_COL  // 182 — header span
  const HOLE_COL   = 32
  const SUB_COL    = 40

  // Compute leaderboard positions ("1", "T2", "3"…) based on score-to-par.
  // Players with no scores yet get "—". Ties get a "T" prefix.
  const positions = computePositions(sorted, getScores, holePars)

  // Auto-end suggestion — when EVERY active (non-withdrawn) player
  // has filled the full holeCount, prompt the host once to end the
  // match. Dismissible (per-session via showAutoEndPrompt state)
  // so the host can keep the board live for celebration if they
  // want. Only the host sees it. (Round 11 audit.)
  //
  // NOTE — autoEndDismissed useState was previously declared HERE
  // (after the if-loading/if-not-outing early returns), which
  // produced a hook-count mismatch between renders → React error
  // #310 in production. It now lives at the top of the LiveOuting
  // hook block alongside every other useState. (Hot-fix round 3.)
  const allFinished = participants.length > 0 && participants.every(p => {
    const sc = getScores(p) || []
    return sc.filter(s => s > 0).length >= holeCount
  })
  const showAutoEndPrompt = isHost && allFinished && !autoEndDismissed && outing.status !== 'ended'

  // Active hole — next hole to be played. = max(holes_played) + 1, capped
  // at the last hole. Used to show a green flag pin under the hole number
  // in the HOLE row. (2026-04-30 PM round 9 — Tier 2)
  const maxPlayed = Math.max(0, ...participants.map(p => getScores(p).filter(s => s > 0).length))
  const activeHole = maxPlayed >= holeCount ? null : maxPlayed   // 0-indexed

  // Tap hint — the first empty cell the user can edit, on a fresh board.
  // Pulses gold so first-time users know where to start. (2026-04-30 PM round 11)
  const tapHint = findTapHint({ sorted, getScores, isHost, isMarkerFor, userId: user?.id })

  // Row sizing: minimum 4 rows fill the screen. Each row is ~80-90px; if
  // fewer than 4 players, we render empty placeholder rows below them
  // (instead of stretching the real rows huge, which read weirdly).
  // Past 4 players, rows shrink to a 56px minimum and scroll vertically.
  const MIN_ROWS = 4
  const ROW_H = participants.length <= MIN_ROWS ? 80 : 56
  const fillerRows = Math.max(0, MIN_ROWS - participants.length)

  return (
    <div
      data-no-pull-refresh="true"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        // Translucent panels over the page-level fairway grass image —
        // matches the rest of the app's glass cards. (2026-04-30 PM round 13)
        background: 'transparent',
      }}>
      {/* 2026-05-06 — Saved-confidence chip. Renders bottom-right above
          the bottom nav whenever savedAt was set in the last 1500ms.
          Quiet, brand-consistent (Augusta green pill with white check),
          self-dismisses without user interaction. Coexists with the
          recent-event banner — that one celebrates birdies/eagles, this
          one quietly confirms the bytes hit the server. */}
      <SavedChip savedAt={savedAt} />

      {/* 2026-05-06 — Birdie / eagle / hole-in-one celebration modal.
          Renders when the user enters a sub-par score for themselves.
          Generates a branded 1080x1080 share-card image via Canvas
          and offers a Share / Skip choice. */}
      {highlight && (
        <HighlightShareModal
          {...highlight}
          onClose={() => setHighlight(null)}
        />
      )}

      {/* 2026-05-05 — data-no-pull-refresh disarms the TabPanel's
          pull-to-refresh gesture for the entire LiveOuting screen.
          Reasoning matches the Solo Round fix: a downward finger
          drift while entering scores must NOT trigger a page reload,
          regardless of whether the latest score has hit the offline
          queue yet. Score writes go through runWithQueue + offline
          queue (durable across reload), but the reload itself is
          jarring mid-round. */}
      {/* Header — dark green strip with white title, gold code chip.
          calc(safe-top + 14px) clears the iOS notch / Android status bar
          on phones; on desktop / non-notch devices --safe-top = 0px so the
          header gets just the 14px breathing room. (2026-04-30) */}
      <div style={{
        padding: 'calc(var(--safe-top) + 14px) 16px 10px',
        background: AUGUSTA_GREEN_DEEP,
        borderBottom: '2px solid ' + AUGUSTA_WOOD,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: AUGUSTA_TEXT, fontSize: 22, padding: '0 4px', cursor: 'pointer' }}>←</button>
          <div style={{ textAlign: 'center', flex: 1, padding: '0 8px' }}>
            <div style={{ fontWeight: 900, color: AUGUSTA_TEXT, fontSize: 15, lineHeight: 1.2, fontFamily: '"Georgia", serif', fontStyle: 'italic', letterSpacing: '0.03em' }}>{outing.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(26,107,40,0.65)', marginTop: 2 }}>{outing.course_name}{coursePar ? ` · Par ${coursePar}` : ''}</div>
            {/* Part-of-League pill (2026-05-02). Surfaces the league
                this event belongs to, so players viewing the live
                board know it's part of a season. Tap-target small
                — non-interactive pill for now; full link-back to
                the league page is on the Leagues tab. */}
            {outing.league && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                marginTop: 4, padding: '3px 9px', borderRadius: 999,
                background: 'rgba(245,215,138,0.18)',
                border: '1px solid rgba(245,215,138,0.45)',
                fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                color: '#F5D78A', textTransform: 'uppercase',
              }}>
                {/* Round 28 audit — bespoke trophy SVG instead of 🏆.
                    Augusta language consistency on the in-app pill. */}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#F5D78A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/>
                  <path d="M8 6H6a2 2 0 0 0 2 2"/>
                  <path d="M16 6h2a2 2 0 0 1-2 2"/>
                  <line x1="12" y1="12" x2="12" y2="16"/>
                  <line x1="9" y1="20" x2="15" y2="20"/>
                </svg>
                <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {outing.league.name}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ background: '#FFD700', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 900, color: AUGUSTA_GREEN, letterSpacing: 2, fontFamily: '"Arial Black", Arial, sans-serif' }}>{code}</div>
            {isHost && isTeamFormat && (
              <button onClick={() => setShowTeams(true)} style={{
                background: teams.length > 0 ? 'rgba(232,192,90,0.15)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${teams.length > 0 ? 'rgba(232,192,90,0.4)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 20, padding: '2px 8px',
                color: teams.length > 0 ? '#F5D78A' : 'rgba(255,255,255,0.5)',
                fontSize: 10, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em',
              }}>{teams.length > 0 ? 'Edit Teams' : 'Set Teams'}</button>
            )}
          </div>
        </div>

        {/* Auto-end suggestion — host only, when every active player
            has filled all 18 holes. Single-tap to End, or × to dismiss
            and keep watching the leaderboard. (Round 11 audit.) */}
        {showAutoEndPrompt && (
          <div style={{
            marginTop: 8, padding: '10px 14px',
            background: 'linear-gradient(135deg, rgba(245,215,138,0.18), rgba(201,160,64,0.10))',
            border: '1px solid rgba(245,215,138,0.40)',
            borderRadius: 12,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F5D78A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M8 21h8M12 17v4M17 3H7l1 7a5 5 0 0010 0l1-7z"/>
              <path d="M7 3H4a2 2 0 000 4h3M17 3h3a2 2 0 010 4h-3"/>
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#F5D78A', letterSpacing: '0.04em' }}>
                ALL PLAYERS FINISHED
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                Wrap up the match to lock in results and update rivalries.
              </div>
            </div>
            <button onClick={endMatch} disabled={ending} style={{
              padding: '7px 12px', borderRadius: 999, border: 'none',
              background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold))',
              color: '#070C09', fontSize: 11, fontWeight: 800, cursor: 'pointer',
              fontFamily: 'inherit', flexShrink: 0,
              opacity: ending ? 0.6 : 1,
            }}>{ending ? 'Ending…' : 'End match'}</button>
            <button onClick={() => setAutoEndDismissed(true)} aria-label="Dismiss" style={{
              background: 'transparent', border: 'none',
              color: 'rgba(255,255,255,0.55)', fontSize: 16, cursor: 'pointer',
              padding: '0 4px',
            }}>✕</button>
          </div>
        )}

        {/* Item 7 — Latest announcement banner. Visible to EVERY
            participant (not just host). Dismissible per-session per-
            announcement-id via localStorage so the user only sees a
            given message once. New announcements pop a fresh banner. */}
        <AnnouncementBanner outing={outing} />

        {/* Offline-queue pill — visible to ALL viewers (host + every
            participant), not just the host, since their own writes
            might be queued. (Iteration fix B5-3.) */}
        {queuedCount > 0 && (
          <div style={{ marginTop: 8 }}>
            <div title="Saved locally — will sync when reconnected" style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(248,180,113,0.14)', border: '1px solid rgba(248,180,113,0.40)',
              borderRadius: 20, padding: '3px 10px',
              color: '#F8B471', fontSize: 11, fontWeight: 700,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F8B471' }} />
              {queuedCount} pending · saved locally
            </div>
          </div>
        )}

        {/* Dropped-mutation banner — fires when a queued write is
            permanently rejected by the server (permission revoked,
            withdrawn player, etc.). Local state is reconciled
            automatically by re-fetching; this just tells the user
            what happened. (Iteration 3 fix for B5.) */}
        {droppedNotice && (
          <div style={{
            marginTop: 8, padding: '8px 12px',
            background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.35)',
            borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div style={{ flex: 1, fontSize: 11, color: '#F87171', lineHeight: 1.3 }}>
              <strong>A pending score couldn't sync</strong> — the server rejected it ({droppedNotice.reason}). Latest scores re-loaded from the server.
            </div>
            <button onClick={() => setDroppedNotice(null)} aria-label="Dismiss" style={{
              background: 'none', border: 'none', color: 'rgba(248,113,113,0.7)', fontSize: 14, cursor: 'pointer',
            }}>✕</button>
          </div>
        )}

        {/* Host controls row */}
        {isHost && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 11, flex: 1, color: (scoringMode === 'designated' && markers.length === 0) ? 'var(--tm-gold-bright)' : 'var(--tm-text-3)', fontWeight: (scoringMode === 'designated' && markers.length === 0) ? 700 : 400 }}>
              {/* "Tap any cell to enter scores" removed 2026-04-30 PM round 11 —
                  the pulsing gold tap-hint on the first empty cell teaches
                  the same thing without instructional copy. F.5 S6 nudge: in
                  designated mode with no scorer assigned, only the host can
                  score — prompt them to assign one via Edit Groups. */}
              {scoringMode === 'designated' && markers.length === 0
                ? '⚠ Assign a group scorer →'
                : markers.length > 0 ? `${markers.length} scorer${markers.length !== 1 ? 's' : ''} assigned` : ''}
            </div>
            {/* All host controls consolidated into one dropdown (2026-07-09). */}
            <MatchMenu
              triggerBadge={chatUnread}
              sections={[
                { label: 'SETTINGS', items: [
                  { icon: HDR_ICONS.users, label: markers.length > 0 ? 'Edit Groups' : 'Set Groups', value: markers.length > 0 ? String(markers.length) : undefined, onClick: () => setShowGroups(true) },
                  { icon: HDR_ICONS.clipboard, label: 'Scoring', value: scoringMode === 'designated' ? 'Designated' : 'Open', onClick: () => changeScoringMode(scoringMode === 'designated' ? 'open' : 'designated') },
                  ...(hasHandicaps ? [
                    { icon: HDR_ICONS.flag, label: 'Leaderboard', value: netMode ? 'Net' : 'Gross', onClick: () => setNetMode(m => !m) },
                    { icon: HDR_ICONS.help, label: 'What’s Gross vs Net?', onClick: () => setShowHcpHelp(true) },
                  ] : []),
                ] },
                { label: 'PEOPLE', items: [
                  { icon: HDR_ICONS.userPlus, label: 'Add Guest', onClick: () => setShowGuestModal(true) },
                  { icon: HDR_ICONS.share, label: 'Share Live', onClick: () => setShowLiveShare(true) },
                ] },
                { label: 'PLAY', items: [
                  { icon: HDR_ICONS.coins, label: 'Side Bets', onClick: () => setShowSideBets(true) },
                  { icon: HDR_ICONS.chat, label: 'Chat', badge: chatUnread, onClick: () => setShowChat(true) },
                ] },
                { items: [
                  { icon: HDR_ICONS.sliders, label: 'Manage Match', onClick: () => setShowManage(true) },
                  { icon: HDR_ICONS.flag, label: ending ? 'Ending…' : 'End Match', danger: true, onClick: ending ? undefined : endMatch },
                ] },
              ]}
            />
          </div>
        )}
        {/* Marker hint — shown to assigned markers who aren't host. In
            designated-scorer mode this becomes a prominent "you're the scorer"
            banner (the visible indicator no incumbent ships). F.5 S6. */}
        {!isHost && isMarker && (
          scoringMode === 'designated' ? (
            <div style={{
              marginTop: 8, padding: '8px 12px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(201,160,64,0.18), rgba(201,160,64,0.06))',
              border: '1px solid rgba(201,160,64,0.45)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 15 }} aria-hidden="true">✎</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--tm-gold-bright)' }}>You're the scorer for this group</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>— tap any cell in your group to enter</span>
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 11, color: '#93C5FD', fontWeight: 600 }}>
              ✎ You're a marker — tap any cell in your group to enter scores
            </div>
          )
        )}
        {/* F.5 S6 — non-scorer indicator in designated mode: tell players WHO
            their scorer is (the research's #1 "who's scoring?" gap), so a tap
            on a teammate's cell that does nothing has an explanation. */}
        {!isHost && !isMarker && scoringMode === 'designated' && (() => {
          const myScorerId = markers.find(m => (m.member_ids || []).map(String).includes(String(user?.id)))?.marker_id
          const myScorer   = (outing.state?.participants || []).find(p => String(p.user_id) === String(myScorerId))
          return (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--tm-text-2)', fontWeight: 600 }}>
              {myScorer
                ? <>✎ {myScorer.name} is scoring this group — enter your own scores any time</>
                : <>✎ Designated scoring is on — enter your own scores; ask the host to assign a group scorer</>}
            </div>
          )
        })()}
        {/* 2026-05-06 (polish task #7+8) — non-host quick-actions row.
            Side bets viewing + chat are useful to all participants, not
            just the host. The host already has the same buttons in their
            controls row above; this gives non-hosts the same entry. */}
        {!isHost && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <MatchMenu
              triggerBadge={chatUnread}
              sections={[
                { label: 'PLAY', items: [
                  { icon: HDR_ICONS.coins, label: 'Side Bets', onClick: () => setShowSideBets(true) },
                  { icon: HDR_ICONS.chat, label: 'Chat', badge: chatUnread, onClick: () => setShowChat(true) },
                ] },
              ]}
            />
          </div>
        )}

      </div>

      {/* Match Play status banner — promoted to a broadcast-style banner
          ABOVE the wood frame when match-play is active. Big bold gold
          status text, dark green gradient pulled toward the rest of the
          board, italic THRU N to the right. (2026-04-30 PM round 9) */}
      {isMatchPlay && matchPlayData && matchPlayData.played > 0 && (
        <div style={{
          margin: '8px 12px 0',
          padding: '10px 16px',
          borderRadius: 6,
          background: `linear-gradient(135deg, ${AUGUSTA_GREEN_DEEP} 0%, ${AUGUSTA_GREEN} 100%)`,
          border: `1px solid ${AUGUSTA_GOLD_DIM}`,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 18, fontWeight: 900,
            color: matchPlayData.p1HolesUp === 0
              ? AUGUSTA_TEXT
              : matchPlayData.p1HolesUp > 0 ? AUGUSTA_GOLD_DIM : '#A04020',
            fontFamily: '"Arial Black", Arial, sans-serif',
            letterSpacing: '0.06em',
          }}>
            {matchPlayData.p1HolesUp === 0
              ? 'ALL SQUARE'
              : matchPlayData.dormie
              ? `${(matchPlayData.p1HolesUp > 0 ? sorted[0].name : sorted[1].name)?.split(' ').slice(-1)[0]?.toUpperCase()} DORMY ${Math.abs(matchPlayData.p1HolesUp)}`
              : `${(matchPlayData.p1HolesUp > 0 ? sorted[0].name : sorted[1].name)?.split(' ').slice(-1)[0]?.toUpperCase()} ${Math.abs(matchPlayData.p1HolesUp)} UP`
            }
          </span>
          <span style={{
            fontSize: 13, fontWeight: 700,
            color: 'rgba(26,107,40,0.65)',
            fontFamily: '"Georgia", serif', fontStyle: 'italic',
            letterSpacing: '0.08em',
          }}>
            THRU {matchPlayData.played}
          </span>
        </div>
      )}

      {/* Recent score event banner — pops down from above the board for ~4s
          when any score is entered. Broadcast lower-third feel.
          (2026-04-30 PM round 10) */}
      {recentEvent && recentEvent.kind === 'error' && (
        // Error variant — red banner when saveScore failed (auth
        // expired, withdrawn player, server error). Auto-dismisses
        // via the same 4-second timer that handles event banners.
        // (Round 6 audit.)
        <div
          key={recentEvent.ts}
          className="tm-event-pop"
          style={{
            position: 'absolute', top: 100, left: '50%',
            transform: 'translateX(-50%)',
            background: 'linear-gradient(135deg, #C13B3B 0%, #A02B2B 100%)',
            color: '#FFF',
            border: '1px solid #E55858',
            padding: '8px 18px',
            borderRadius: 24,
            fontSize: 12, fontWeight: 800,
            letterSpacing: '0.04em',
            boxShadow: '0 6px 20px rgba(0,0,0,0.40)',
            zIndex: 5,
            maxWidth: '85%',
            textAlign: 'center',
          }}>{recentEvent.message}</div>
      )}
      {recentEvent && recentEvent.kind !== 'error' && (() => {
        const lastName = (recentEvent.name || '').trim().split(/\s+/).slice(-1)[0]?.toUpperCase() || '—'
        const label = scoreLabel(recentEvent.score, recentEvent.par)
        const isUnder = recentEvent.score < recentEvent.par
        return (
          <div
            key={recentEvent.ts}
            className="tm-event-pop"
            style={{
              position: 'absolute', top: 100, left: '50%',
              transform: 'translateX(-50%)',
              background: isUnder
                ? `linear-gradient(135deg, ${AUGUSTA_GOLD} 0%, #C8A33C 100%)`
                : `linear-gradient(135deg, ${AUGUSTA_GREEN_DEEP} 0%, ${AUGUSTA_GREEN} 100%)`,
              color: AUGUSTA_TEXT,
              border: `1px solid ${AUGUSTA_GOLD_DIM}`,
              padding: '8px 18px',
              borderRadius: 24,
              fontSize: 13, fontWeight: 900,
              fontFamily: '"Arial Black", Arial, sans-serif',
              letterSpacing: '0.08em',
              boxShadow: '0 6px 20px rgba(0,0,0,0.40)',
              zIndex: 5,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}>
            {lastName} · {label} · HOLE {recentEvent.hole + 1}
          </div>
        )
      })()}

      {/* SCORECARD <-> BOARD toggle. Always visible to all participants
          (host + non-host alike) so anyone can switch from the active
          scoring surface (scorecard) to the leaderboard read of who's
          winning (Tour-style board). Default is BOARD for 4+ player
          matches (where the wide scorecard gets visually busy).
          (2026-05-01 — match-page completion plan, Thread 1) */}
      {/* 2026-05-06 — toggle redesigned for visibility. Earlier the
          chip used translucent white over the cream/light Augusta page
          background, which made both the active state (light gold on
          light gray) and inactive label (white-on-cream) basically
          invisible. New treatment: solid Augusta forest-green pill
          with a clear active state (trophy-gold capsule with dark
          ink text) and a high-contrast inactive label (cream on
          green). Matches the visibility bar of the GROSS/NET chip
          and the +Add Player button. */}
      <div style={{ padding: '10px 12px 0', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <div style={{
          display: 'inline-flex',
          background: '#1A4A24',
          border: '1px solid rgba(232,192,90,0.45)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
          borderRadius: 999,
          padding: 4, gap: 2,
        }}>
          <button onClick={() => setViewMode('scorecard')} style={{
            background: effectiveViewMode === 'scorecard'
              ? 'linear-gradient(135deg, #F5D78A, var(--tm-gold))'
              : 'transparent',
            border: 'none', cursor: 'pointer',
            padding: '7px 20px', borderRadius: 999,
            fontSize: 12, fontWeight: 800, letterSpacing: '0.10em',
            color: effectiveViewMode === 'scorecard' ? 'var(--tm-text)' : '#FBF3DC',
            fontFamily: 'inherit',
            boxShadow: effectiveViewMode === 'scorecard'
              ? '0 2px 6px rgba(201,160,64,0.35), inset 0 1px 0 rgba(255,255,255,0.30)'
              : 'none',
            transition: 'background 140ms ease, color 140ms ease, box-shadow 140ms ease',
          }}>SCORECARD</button>
          <button onClick={() => setViewMode('board')} style={{
            background: effectiveViewMode === 'board'
              ? 'linear-gradient(135deg, #F5D78A, var(--tm-gold))'
              : 'transparent',
            border: 'none', cursor: 'pointer',
            padding: '7px 20px', borderRadius: 999,
            fontSize: 12, fontWeight: 800, letterSpacing: '0.10em',
            color: effectiveViewMode === 'board' ? 'var(--tm-text)' : '#FBF3DC',
            fontFamily: 'inherit',
            boxShadow: effectiveViewMode === 'board'
              ? '0 2px 6px rgba(201,160,64,0.35), inset 0 1px 0 rgba(255,255,255,0.30)'
              : 'none',
            transition: 'background 140ms ease, color 140ms ease, box-shadow 140ms ease',
          }}>BOARD</button>
        </div>
      </div>

      {/* 2026-05-06 — Active-formats strip. When the host picks
          multiple scoring formats (e.g. Stroke + Match + Best Ball =
          four-ball match play with stroke-totals tracking), the
          leaderboard sections below correspond to each format — but
          the user couldn't easily tell which was which. Tiny chip
          row labels every active format so the rest of the page
          reads in context. (Matt: "scoreboard is only showing team
          standings for best ball but doesnt specify stroke, match,
          or both"). */}
      {(outing.scoring_formats || []).length > 0 && (
        <div style={{
          padding: '8px 12px 0',
          display: 'flex', justifyContent: 'center',
          flexWrap: 'wrap', gap: 6,
          flexShrink: 0,
        }}>
          {[
            { id: 'stroke',     label: 'STROKE' },
            { id: 'match',      label: 'MATCH' },
            { id: 'stableford', label: 'STABLEFORD' },
            { id: 'skins',      label: 'SKINS' },
            { id: 'best_ball',  label: 'BEST BALL' },
          ].filter(o => (outing.scoring_formats || []).includes(o.id)).map(o => (
            <span key={o.id} style={{
              padding: '3px 9px',
              fontSize: 9, fontWeight: 800, letterSpacing: '0.10em',
              color: '#F5D78A',
              background: 'rgba(232,192,90,0.14)',
              border: '1px solid rgba(232,192,90,0.40)',
              borderRadius: 999,
            }}>{o.label}</span>
          ))}
        </div>
      )}

      {/* Best-Ball team standings — header card above the leaderboard
          when format=best_ball. Player rows below are still ordered
          by team total. (Iteration 3 polish for B4d.) */}
      {/* 2026-05-06 — team standings card. Renders in BOTH board AND
          scorecard views (Matt: "in scorecard too not just board")
          whenever the outing has at least one team with members. The
          headline label adapts: for `match` format with 2 teams, it
          reads the match-play state ("Team 1 · 1 UP thru 1"); for
          everything else it reads "TEAM STANDINGS · BEST BALL". */}
      {bestBallTeams.length > 0 && (
        <div style={{
          margin: '12px 16px 0', padding: '12px 12px 8px',
          // 2026-05-06 — restyled to match MatchScoreboard: translucent
          // white-glass over the page bg, dark text, gold accents. The
          // earlier solid-green chrome stood out too much next to the
          // individual leaderboard below it. Matt: 'make the team
          // board identical to the individual board below in terms of
          // looks'.
          background: 'rgba(255,255,255,0.22)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.45)',
          borderRadius: 16,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}>
          {/* 2026-05-06 — Match Play sub-section. Shown when format
              includes 'match' AND we have 2 teams. Renders the live
              match-play state ("Matt/L 1 UP · thru 1"). */}
          {teamMatchData && teamMatchData.played > 0 && (() => {
            const { a, b, aHolesUp, played, remaining, dormie } = teamMatchData
            const aLabel = a.members.map(m => (m.name || '').split(' ')[0]).filter(Boolean).join(' / ')
              || `Team ${a.label}`
            const bLabel = b.members.map(m => (m.name || '').split(' ')[0]).filter(Boolean).join(' / ')
              || `Team ${b.label}`
            const upBy = Math.abs(aHolesUp)
            const leaderName = aHolesUp > 0 ? aLabel : aHolesUp < 0 ? bLabel : null
            const isClosed = played > 0 && upBy > remaining
            const stateText = aHolesUp === 0
              ? `ALL SQUARE · thru ${played}`
              : isClosed
                ? `${leaderName} WINS ${upBy}&${remaining}`
                : dormie
                  ? `${leaderName} DORMIE ${upBy}`
                  : `${leaderName} ${upBy} UP · thru ${played}`
            return (
              <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid rgba(27,94,59,0.18)' }}>
                <div style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
                  color: 'rgba(27,94,59,0.55)', marginBottom: 3, textAlign: 'center',
                }}>MATCH PLAY</div>
                <div style={{
                  fontSize: 14, fontWeight: 800, letterSpacing: '0.04em',
                  color: 'var(--tm-gold-text)', textAlign: 'center',
                }}>{stateText}</div>
              </div>
            )
          })()}
          {/* Best-ball / team-totals sub-header. */}
          <div style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
            color: 'rgba(27,94,59,0.55)',
            marginBottom: 6,
            textAlign: 'center',
          }}>{isBestBallFormat ? 'BEST BALL · TEAM TOTALS' : 'TEAM TOTALS'}</div>

          {/* Team rows — same translucent-glass card chrome as the
              individual board below. Side-by-side member avatars
              (38px squares, same as MatchScoreboard's PlayerPhoto)
              show who's on each team at a glance. (Matt: "profile
              pictures side by side for each team member in the team") */}
          {bestBallTeams.map((team, i) => {
            const memberNames = team.members.map(m => (m.name || '').split(' ')[0]).filter(Boolean).join(' / ')
            const isLeader = i === 0 && team.total > 0
            return (
              <div key={team.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 4px',
                borderBottom: i < bestBallTeams.length - 1 ? '1px solid rgba(27,94,59,0.10)' : 'none',
                background: isLeader ? 'rgba(201,160,64,0.20)' : 'transparent',
                borderRadius: isLeader ? 8 : 0,
              }}>
                <span style={{
                  width: 22, textAlign: 'center',
                  fontSize: 11, fontWeight: 800,
                  color: isLeader ? 'var(--tm-gold)' : 'rgba(27,94,59,0.50)',
                  flexShrink: 0,
                }}>{i + 1}</span>

                {/* Side-by-side member avatars. 38px boxes, same shape
                    as the individual board's PlayerPhoto. Up to 4
                    members per team (foursomes); we cap visible avatars
                    at 3 with a "+N" overflow chip if more. */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {team.members.slice(0, 3).map(m => (
                    <div key={m.user_id} style={{
                      width: 38, height: 38, borderRadius: 10, overflow: 'hidden',
                      background: 'rgba(27,94,59,0.08)',
                      border: '1px solid rgba(27,94,59,0.12)',
                      position: 'relative', flexShrink: 0,
                    }}>
                      {m.avatar ? (
                        <img src={m.avatar} alt={m.name || ''}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
                      ) : (
                        <div style={{
                          position: 'absolute', inset: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 800, color: '#fff',
                          background: avatarBg(m.name || ''),
                        }}>{initials(m.name || '') || '·'}</div>
                      )}
                    </div>
                  ))}
                  {team.members.length > 3 && (
                    <div style={{
                      width: 38, height: 38, borderRadius: 10,
                      background: 'rgba(27,94,59,0.10)',
                      border: '1px solid rgba(27,94,59,0.18)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800, color: 'rgba(27,94,59,0.65)',
                      flexShrink: 0,
                    }}>+{team.members.length - 3}</div>
                  )}
                </div>

                {/* Team name (member first names joined). */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700,
                    color: 'var(--tm-text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{memberNames || `Team ${team.label}`}</div>
                  <div style={{
                    fontSize: 9, color: 'rgba(27,94,59,0.45)',
                    fontWeight: 500, letterSpacing: '0.02em', marginTop: 1,
                  }}>{team.members.length} {team.members.length === 1 ? 'player' : 'players'}</div>
                </div>

                {/* Total + thru, mirroring MatchScoreboard right-side. */}
                <div style={{ textAlign: 'center', flexShrink: 0, minWidth: 50 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 800,
                    color: isLeader ? 'var(--tm-gold)' : 'var(--tm-text)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{team.total > 0 ? team.total : '—'}</div>
                </div>
                <div style={{
                  fontSize: 10, color: 'rgba(27,94,59,0.45)',
                  textAlign: 'center', width: 36, flexShrink: 0,
                }}>{team.holesPlayed}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* 2026-05-06 — Section header above the per-player leaderboard,
          telling the user which scoring format these rows represent.
          When the user picked multiple formats, this is the section
          for whichever is the *primary* per-player ranking — Skins
          (sorted by skins won), Stableford (points), or Stroke
          (gross/net to par). Hidden when only the team-card readouts
          apply (e.g. pure best-ball with no per-player rank to show). */}
      {effectiveViewMode === 'board' && (() => {
        const label = isSkinsFormat ? 'SKINS · INDIVIDUAL'
          : isStablefordFormat ? 'STABLEFORD · INDIVIDUAL'
          : isMatchFormat && !isBestBallFormat && participants.length === 2 ? 'MATCH PLAY · HEAD TO HEAD'
          : 'STROKE PLAY · INDIVIDUAL'
        return (
          <div style={{
            margin: '12px 16px 4px',
            fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
            color: 'rgba(245,215,138,0.65)',
            textAlign: 'center',
          }}>{label}</div>
        )
      })()}

      {/* BOARD view — Tour-style leaderboard. Read-only; tapping a row
          flips back to SCORECARD so the user can enter that player's score. */}
      {effectiveViewMode === 'board' && (
        <MatchScoreboard
          participants={sorted}
          positions={positions}
          getScores={getScores}
          holePars={holePars}
          holeCount={holeCount}
          netMode={netMode}
          hcpAllowance={hcpAllowance}
          outingMeta={outingMeta}
          isMatchPlay={isMatchPlay}
          matchPlayData={matchPlayData}
          diffStr={diffStr}
          netDiffStr={netDiffStr}
          user={user}
          onPlayerTap={() => setViewMode('scorecard')}
          isSkinsFormat={isSkinsFormat}
          skinsByPlayer={skinsByPlayer}
        />
      )}

      {/* SCORECARD view — Augusta-style table. Tournament board frame:
          outer wood wrapper has a real wood-grain texture (repeating
          vertical-line gradient over a brown gradient), inner div is the
          board panel. The gold pinstripe + dark inset rings live on the
          inner div so they sit just inside the wood.
          (2026-04-30 PM round 9 — Tier 2 polish, real wood look) */}
      {/* GET DISTANCES — right-aligned, directly above the Leaders plaque / board
          frame (scorecard view only). Sits in the non-scrolling top region so it
          stays in view while the score table scrolls beneath. Plaque + frame
          untouched. (2026-07-09, Matt) */}
      {effectiveViewMode === 'scorecard' && onGoToEagleEye && myNextHole != null && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 12px', marginTop: 8 }}>
          <button onClick={() => onGoToEagleEye(myNextHole)} style={{
            background: 'linear-gradient(135deg, rgba(232,192,90,0.95), rgba(201,160,64,0.95))',
            border: '1px solid rgba(245,215,138,0.6)',
            borderRadius: 999, padding: '9px 15px',
            color: 'var(--tm-text)',
            fontSize: 12, fontWeight: 800, letterSpacing: '0.06em',
            cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(0,0,0,0.45), 0 0 0 1px rgba(245,215,138,0.15)',
            display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
          }}>
            GET DISTANCES
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--tm-text)' }}><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      )}

      {effectiveViewMode === 'scorecard' && (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        margin: '4px 12px 12px',
        padding: 4,
        borderRadius: 7,
        backgroundColor: AUGUSTA_WOOD,
        backgroundImage: [
          // Vertical wood-grain lines — narrow dark lines + slight light highlights
          'repeating-linear-gradient(90deg, transparent 0px, transparent 3px, rgba(0,0,0,0.18) 3px, rgba(0,0,0,0.18) 3.6px, transparent 3.6px, transparent 7px, rgba(255,255,255,0.05) 7px, rgba(255,255,255,0.05) 7.4px, transparent 7.4px, transparent 13px)',
          // Subtle horizontal warmth/shadow
          'linear-gradient(180deg, #6b4519 0%, #5a3a16 50%, #4a2f0e 100%)',
        ].join(', '),
        boxShadow: '0 16px 50px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          borderRadius: 4,
          overflow: 'hidden',
          background: AUGUSTA_PANEL,
          // Gold pinstripe + dark inner ring INSIDE the wood for that
          // broadcast-quality finish.
          boxShadow: `inset 0 0 0 1px ${AUGUSTA_GOLD_DIM}, inset 0 0 0 2px rgba(0,0,0,0.45)`,
          // Glass-morphism: blur whatever's behind the translucent panel
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}>
        <LeadersPlaque />

        {/* Scorecard tables — scroll horizontally if needed, vertically as one body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {participants.length === 0 ? (
            <div style={{
              padding: 40, textAlign: 'center', fontSize: 14,
              color: AUGUSTA_INK, fontFamily: '"Georgia", serif', fontStyle: 'italic',
            }}>
              Waiting for players to join…
            </div>
          ) : (
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              {/* Group selector chips — only for large outings. Lets
                  the user (or host) switch which foursome's scorecard
                  is on screen. For small outings these don't render. */}
              {isLargeOuting && (
                <div style={{
                  padding: '10px 12px 8px', display: 'flex', gap: 6,
                  flexWrap: 'wrap', borderBottom: '1px solid ' + AUGUSTA_GOLD_DIM,
                  background: AUGUSTA_PANEL,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: AUGUSTA_INK, letterSpacing: '0.1em', alignSelf: 'center', marginRight: 4 }}>
                    {isHost ? 'GROUPS:' : 'YOUR GROUP:'}
                  </div>
                  {(isHost ? stateGroups : stateGroups.filter(g => g.id === myGroupId)).map(g => (
                    <button key={g.id} onClick={() => setActiveGroupId(g.id)} style={{
                      padding: '4px 10px', borderRadius: 999, border: '1px solid',
                      borderColor: g.id === effectiveGroupId ? AUGUSTA_GREEN : AUGUSTA_GOLD_DIM,
                      background: g.id === effectiveGroupId ? AUGUSTA_GREEN : 'transparent',
                      color: g.id === effectiveGroupId ? '#FFF' : AUGUSTA_INK,
                      fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    }}>{g.name}</button>
                  ))}
                </div>
              )}
              {/* ── Front 9 ── */}
              <ScorecardTable
                label="FRONT 9"
                holes={frontHoles}
                holePars={holePars}
                subtotalPar={frontPar}
                participants={scorecardParticipants}
                getScores={getScores}
                isHost={isHost}
                userId={user?.id}
                isMarkerFor={isMarkerFor}
                playerTeam={playerTeam}
                onCellTap={(p, h) => setScoreModal({ userId: p.user_id, userName: p.name, hole: h })}
                // 6.2 — Host can tap a hole-number header to bulk-enter every
                // player in the foursome at once. Only enabled when there are
                // at least 2 players to enter (single-player tables don't
                // benefit). Tap is wired through ScorecardTable's
                // onHoleHeaderTap prop. (2026-05-02)
                onHoleHeaderTap={isHost && scorecardParticipants.length >= 2 ? (h) => setBulkEntryHole(h) : null}
                matchPlayData={isMatchPlay ? matchPlayData : null}
                isP1={(p) => isMatchPlay && String(p.user_id) === String(scorecardParticipants[0]?.user_id)}
                PLAYER_COL={PLAYER_COL}
                RANK_COL={RANK_COL}
                AVATAR_COL={AVATAR_COL}
                NAME_COL={NAME_COL}
                HOLE_COL={HOLE_COL}
                SUB_COL={SUB_COL}
                positions={positions}
                activeHole={activeHole}
                tapHint={tapHint}
                rowH={ROW_H}
                fillerRows={fillerRows}
                skinsOutcomes={isSkinsFormat ? skinsData?.outcomes : null}
              />
              {/* ── Back 9 (if 18 holes) ── */}
              {backHoles.length > 0 && (
                <ScorecardTable
                  label="BACK 9"
                  holes={backHoles}
                  holePars={holePars}
                  subtotalPar={backPar}
                  participants={scorecardParticipants}
                  getScores={getScores}
                  isHost={isHost}
                  userId={user?.id}
                  isMarkerFor={isMarkerFor}
                  playerTeam={playerTeam}
                  onCellTap={(p, h) => setScoreModal({ userId: p.user_id, userName: p.name, hole: h })}
                  onHoleHeaderTap={isHost && scorecardParticipants.length >= 2 ? (h) => setBulkEntryHole(h) : null}
                  matchPlayData={isMatchPlay ? matchPlayData : null}
                  isP1={(p) => isMatchPlay && String(p.user_id) === String(scorecardParticipants[0]?.user_id)}
                  PLAYER_COL={PLAYER_COL}
                  HOLE_COL={HOLE_COL}
                  SUB_COL={SUB_COL}
                  rowH={ROW_H}
                  fillerRows={fillerRows}
                  skinsOutcomes={isSkinsFormat ? skinsData?.outcomes : null}
                />
              )}
              {/* ── Totals row ── */}
              <TotalsRow
                participants={scorecardParticipants}
                holePars={holePars}
                holeCount={holeCount}
                coursePar={coursePar}
                getScores={getScores}
                diffStr={netMode ? netDiffStr : diffStr}
                diffColor={diffColor}
                playerTeam={playerTeam}
                netMode={netMode}
                netTotal={netTotal}
                isMatchPlay={isMatchPlay}
                matchPlayData={matchPlayData}
                isP1={(p) => isMatchPlay && String(p.user_id) === String(sorted[0]?.user_id)}
                PLAYER_COL={PLAYER_COL}
                RANK_COL={RANK_COL}
                AVATAR_COL={AVATAR_COL}
                NAME_COL={NAME_COL}
                HOLE_COL={HOLE_COL}
                SUB_COL={SUB_COL}
                positions={positions}
                activeHole={activeHole}
                tapHint={tapHint}
              />
            </div>
          )}
        </div>

        <AugustaPlaqueFooter />
        </div>
      </div>
      )}

      {/* Score entry modal */}
      {scoreModal && (() => {
        const p = participants.find(x => String(x.user_id) === String(scoreModal.userId))
        const sc = getScores(p || {})
        const current = sc[scoreModal.hole] || 0
        const par = holePars[scoreModal.hole] || 4
        return (
          <ScoreModal
            playerName={scoreModal.userName}
            hole={scoreModal.hole}
            par={par}
            currentScore={current}
            holeCount={holeCount}
            isSelf={String(scoreModal.userId) === String(user?.id)}
            code={code}
            uid={user?.id}
            // "Save & Eagle Eye →" only available when:
            //   1. parent supplied the cross-tab nav callback
            //   2. user is scoring their OWN hole (not host scoring someone else)
            //   3. there's actually a next hole to advance to (not the last)
            // Tightest one-tap loop: enter score, jump to Eye on next hole.
            // hole is 0-indexed in scoreModal; eyeHoleNudge is 1-indexed,
            // so "next hole" = scoreModal.hole + 2. (2026-05-01)
            onSaveAndEagleEye={
              onGoToEagleEye
              && String(scoreModal.userId) === String(user?.id)
              && scoreModal.hole + 1 < holeCount
                ? async (val, puttFacts, shots) => {
                    const nextHole = scoreModal.hole + 2  // 1-indexed
                    setScoreModal(null)
                    await saveScore(scoreModal.hole, val, scoreModal.userId, puttFacts, shots)
                    onGoToEagleEye(nextHole)
                  }
                : null
            }
            onSave={async (val, puttFacts, shots) => {
              setScoreModal(null)
              await saveScore(scoreModal.hole, val, scoreModal.userId, puttFacts, shots)
            }}
            onClose={() => setScoreModal(null)}
          />
        )
      })()}

      {/* 6.2 — Bulk-foursome score entry. Host taps a hole numeral on the
          scorecard header → modal shows one numeric input per group member,
          pre-filled with their current score for that hole. Saves all rows
          in sequence then refreshes the outing once. The biggest commissioner
          time-saver after each foursome turns in their card. (2026-05-02) */}
      {bulkEntryHole != null && (
        <BulkScoreModal
          hole={bulkEntryHole}
          par={holePars[bulkEntryHole] || 4}
          participants={scorecardParticipants}
          getScores={getScores}
          holeCount={holeCount}
          onClose={() => setBulkEntryHole(null)}
          onSaveAll={async (entries) => {
            // entries: [{ userId, name, score }, ...] only those with a
            // numeric score. Run sequentially so the offline queue
            // preserves causal order and the score-conflict dialog (B2)
            // can interrupt mid-batch. saveScore returns true/false —
            // false = stop the batch (user cancelled a conflict, or a
            // server rejection like player_withdrawn fired).
            // (Round 12 — saveScore now returns a status indicator
            // instead of throwing, so wire that here.)
            for (const e of entries) {
              const ok = await saveScore(bulkEntryHole, e.score, e.userId)
              if (!ok) {
                // Throw so the BulkScoreModal's inner try/catch surfaces
                // the partial-save banner. The user can dismiss + retry
                // the remaining rows.
                throw new Error(`Stopped at ${e.name}. Earlier rows were saved.`)
              }
            }
            setBulkEntryHole(null)
          }}
        />
      )}

      {/* Add Player sheet — search-as-you-type for app users + manual guest fallback */}
      {showGuestModal && (
        <GuestModal
          code={code}
          onAdd={addGuest}
          onAppUserAdded={async () => {
            await loadOuting()
            setShowGuestModal(false)
          }}
          onClose={() => setShowGuestModal(false)}
        />
      )}

      {/* GROSS / NET explainer — pops once per user on first match
          with handicaps, or on demand via the (?) icon. Plain-language
          definition; doesn't bother experienced golfers more than
          once. (2026-05-06 — Matt feedback.) */}
      {showHcpHelp && (
        <HcpHelpPopover onClose={() => setShowHcpHelp(false)} />
      )}

      {/* Team Setup sheet */}
      {showTeams && outing && (
        <TeamSetup
          outing={outing}
          onClose={() => setShowTeams(false)}
          onSaved={savedTeams => {
            setOuting(prev => ({ ...prev, state: { ...(prev.state || {}), teams: savedTeams } }))
            setShowTeams(false)
          }}
          // 2026-05-06 — when host adds a player from inside the
          // TeamSetup sheet (via "+ Add Player"), it needs to refresh
          // the outing so the new participant shows up in the
          // unassigned list. loadOuting() refetches + setOuting()s.
          onRefreshOuting={loadOuting}
        />
      )}

      {/* Group / Marker Setup sheet */}
      {showGroups && outing && (
        <GroupSetup
          outing={outing}
          onClose={() => setShowGroups(false)}
          onSaved={savedMarkers => {
            setOuting(prev => ({ ...prev, state: { ...(prev.state || {}), markers: savedMarkers } }))
            setShowGroups(false)
          }}
        />
      )}

      {/* Score-conflict prompt — replaces window.confirm with a sheet
          styled to match the rest of the app. Resolves the saveScore
          promise to true (overwrite) or false (cancel). (Final pass) */}
      {conflictPrompt && createPortal(
        <>
          {/* Transparent click-catcher: tapping away keeps the existing
              score (resolve false). No screen dimming — the chip is
              inline and non-blocking so it doesn't break scoring flow. */}
          <div
            onClick={() => conflictPrompt.resolve(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'transparent' }}
          />
          {/* F.5 S2 — inline conflict chip. Names who entered the
              conflicting score (when the OCC flag surfaces last_written_by)
              so the scorer decides in one tap. Keep mine = force overwrite
              with my value; Keep theirs = leave the existing value. */}
          <div role="alertdialog" aria-label={`Score conflict on hole ${conflictPrompt.hole + 1}`}
            style={{
              position: 'fixed', left: '50%',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
              transform: 'translateX(-50%)', zIndex: 9999,
              width: 'min(440px, calc(100vw - 24px))',
              background: 'linear-gradient(180deg, #11201A 0%, #0A1410 100%)',
              borderRadius: 14, border: '1px solid rgba(245,215,138,0.30)',
              boxShadow: '0 14px 40px rgba(0,0,0,0.6)',
              padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
            }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginBottom: 2 }}>
                Hole {conflictPrompt.hole + 1} conflict
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', lineHeight: 1.4 }}>
                {conflictPrompt.by
                  ? <>{conflictPrompt.by} entered <strong style={{ color: '#fff' }}>{conflictPrompt.existing}</strong> just now. </>
                  : <>Already has <strong style={{ color: '#fff' }}>{conflictPrompt.existing}</strong>. </>}
                Use yours (<strong style={{ color: '#F5D78A' }}>{conflictPrompt.incoming}</strong>)?
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => conflictPrompt.resolve(false)} style={{
                padding: '9px 11px', background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9,
                color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}>Keep theirs</button>
              <button onClick={() => conflictPrompt.resolve(true)} style={{
                padding: '9px 11px', background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold))',
                border: 'none', borderRadius: 9, color: '#070C09', fontSize: 12,
                fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}>Keep mine</button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Live-share modal — QR + URL + tee-box print. (Round 3 audit.) */}
      {showLiveShare && outing && (
        <LiveShareModal
          outing={outing}
          onClose={() => setShowLiveShare(false)}
        />
      )}

      {/* 2026-05-06 (polish task #7) — Side bets sheet. Available to
          host AND every participant — declares are host-only at the
          server, but reading standings is open to anyone in the match. */}
      {showSideBets && outing && (
        <SideBetsCard
          outing={outing}
          userId={user?.id}
          onClose={() => setShowSideBets(false)}
        />
      )}

      {/* 2026-05-06 (polish task #8) — Outing chat. Polling-based group
          chat scoped to this match's participants. Mount lives at the
          LiveOuting level so it survives sub-component re-renders. */}
      {showChat && outing && (
        <OutingChat
          outing={outing}
          userId={user?.id}
          onClose={() => setShowChat(false)}
        />
      )}

      {/* Commissioner correction panel — host-only. Withdraw / reinstate
          participants and audit the score-change history. (B3) */}
      {showManage && isHost && outing && (
        <CommissionerPanel
          outing={outing}
          onClose={() => setShowManage(false)}
          onParticipantsUpdated={(updated, extras) => {
            // 6.4 — extras may carry { handicap_overrides } from the
            // per-event override editor. Merge whatever the panel
            // passes back into outing.state without dropping any other
            // state keys (groups, teams, stableford_points, etc.)
            setOuting(prev => ({
              ...prev,
              state: {
                ...(prev.state || {}),
                participants: updated,
                ...(extras && typeof extras === 'object' ? extras : {}),
              },
            }))
          }}
        />
      )}

      {/* GET DISTANCES pill relocated 2026-07-09 (Matt) — now a right-aligned
          button directly above the Leaders plaque in the scorecard view (see
          above), replacing the old floating bottom-right pill. */}
    </div>
  )
}



// ─── Team Setup Sheet ─────────────────────────────────────────────────────────
export const TEAM_PALETTE = ['var(--tm-gold)', 'var(--tm-gold-bright)', '#60A5FA', '#F87171', '#A78BFA', '#FB923C', '#34D399', '#FBBF24']

// ─── Group / Marker Setup ─────────────────────────────────────────────────────
// Host divides players into groups of ≤4 and designates one marker per group.
// Marker can enter scores for everyone in their group.
// ─── LiveShareModal — live URL + QR + tee-box print page ─────────────────────
//
// Opened from the host action row's '📡 Share live' button. Hands
// the commissioner three things in one place:
//   1. The live URL (text + 'Copy' / native-share buttons)
//   2. A QR code rendered via api.qrserver.com (no npm dep)
//   3. A 'Print tee-box flyer' button that opens window.print() on
//      a styled flyer page — drop on the first tee for the
//      half-price-for-flyer-exposure motion.
//
// (2026-05-01 — Matt's GTM motion: half price + flyer + QR.)
function LiveShareModal({ outing, onClose }) {
  const code = outing.code
  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/?live=${code}`
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=8&data=${encodeURIComponent(url)}`
  const [copied, setCopied] = useState(false)

  function copy() {
    if (!navigator.clipboard) return
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }
  function nativeShare() {
    if (!navigator.share) { copy(); return }
    navigator.share({
      title: outing.name,
      url,
      text: `${outing.name} · live leaderboard`,
    }).catch(() => {})
  }
  // HTML-escape for the print flyer. Outing names can include
  // user-typed characters; without this, a name like
  //   "Matt's <Open> & Friends"
  // would break the markup. (Round 4 audit — XSS hardening.)
  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  function openPrintFlyer() {
    // Open a new window with the flyer HTML. window.print() fires
    // automatically on load. Styled for letter / A4 with a big QR.
    const w = window.open('', '_blank')
    if (!w) { alert('Please allow popups to open the printable flyer.'); return }
    const safeName    = escHtml(outing.name || 'Match')
    const safeCourse  = escHtml(outing.course_name || '')
    const safeUrl     = escHtml(url)
    const safeCode    = escHtml(code)
    const safeQrSrc   = escHtml(qrSrc)
    const html = `<!doctype html>
<html><head><title>${safeName} — Live Leaderboard</title><style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #0E3B23; background: #F1E7C8; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .wrap { max-width: 720px; text-align: center; padding: 36px 24px; border: 4px double #C9A040; border-radius: 18px; background: #FFFAEB; }
  .kicker { font-size: 12px; letter-spacing: 0.30em; color: #C9A040; font-weight: 700; margin-bottom: 12px; }
  .title { font-size: 38px; font-weight: 900; letter-spacing: -0.01em; color: #0E3B23; margin: 0 0 8px; word-break: break-word; }
  .sub { font-size: 16px; color: rgba(14,59,35,0.65); margin-bottom: 28px; word-break: break-word; }
  .qr { display: block; margin: 0 auto 20px; max-width: 320px; height: auto; border: 8px solid #C9A040; border-radius: 12px; background: #fff; }
  .qr-fallback { display: none; padding: 60px 20px; border: 4px dashed #C9A040; border-radius: 12px; background: #fff; max-width: 320px; margin: 0 auto 20px; font-size: 12px; color: #0E3B23; }
  .scan { font-size: 14px; color: #0E3B23; font-weight: 600; margin-bottom: 4px; }
  .url { font-size: 13px; color: rgba(14,59,35,0.70); margin-bottom: 22px; word-break: break-all; }
  .powered { font-size: 10px; letter-spacing: 0.30em; color: #C9A040; font-weight: 700; margin: 12px 0 4px; }
  .brand { font-size: 24px; font-weight: 900; color: #0E3B23; }
  .code { font-size: 11px; color: rgba(14,59,35,0.50); letter-spacing: 0.10em; margin-top: 14px; }
</style></head>
<body><div class="wrap">
  <div class="kicker">LIVE LEADERBOARD</div>
  <div class="title">${safeName}</div>
  <div class="sub">${safeCourse}</div>
  <img class="qr" src="${safeQrSrc}" alt="QR code" onerror="this.style.display='none'; document.getElementById('qr-fb').style.display='block';"/>
  <div id="qr-fb" class="qr-fallback">QR couldn't load.<br/>Type the URL below into your phone's browser instead.</div>
  <div class="scan">Scan to follow scores live</div>
  <div class="url">${safeUrl}</div>
  <div class="powered">POWERED BY</div>
  <div class="brand">The Match</div>
  <div class="code">CODE · ${safeCode}</div>
</div>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 400));</script>
</body></html>`
    w.document.open(); w.document.write(html); w.document.close()
  }

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 380,
        background: 'linear-gradient(180deg, #11201A 0%, #0A1410 100%)',
        borderRadius: 20, padding: '22px 22px 24px',
        border: '1px solid rgba(245,215,138,0.30)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.18em', color: '#5ED47A', fontWeight: 800 }}>📡 LIVE LEADERBOARD</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#fff', marginTop: 2 }}>Share with players + spectators</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 999, width: 30, height: 30, color: '#fff', fontSize: 16, cursor: 'pointer',
            fontFamily: 'inherit', flexShrink: 0,
          }}>✕</button>
        </div>

        {/* QR — white card so the camera scans it cleanly even on the
            dark theme. Falls back to the URL if the QR API fails to
            load. (Round 4 audit — fallback for offline / API down.) */}
        <div style={{
          background: '#fff', padding: 14, borderRadius: 14,
          marginBottom: 14, textAlign: 'center',
          border: '1px solid rgba(245,215,138,0.30)',
          minHeight: 268,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src={qrSrc} alt="QR code"
            style={{ width: '100%', maxWidth: 240, height: 'auto', display: 'block', margin: '0 auto' }}
            onError={(e) => {
              const img = e.currentTarget
              img.style.display = 'none'
              const fb = document.getElementById('tm-qr-fallback')
              if (fb) fb.style.display = 'block'
            }} />
          <div id="tm-qr-fallback" style={{
            display: 'none', color: '#0E3B23', fontSize: 12, lineHeight: 1.5,
            padding: '20px', textAlign: 'center',
          }}>
            QR generator unreachable.<br/>
            Use the URL below — it still works.
          </div>
        </div>

        {/* URL row + copy */}
        <div style={{
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 10, padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        }}>
          <div style={{
            flex: 1, minWidth: 0, fontSize: 12, color: 'rgba(255,255,255,0.85)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: 'monospace',
          }}>{url}</div>
          <button onClick={copy} style={{
            padding: '5px 10px', borderRadius: 6,
            background: copied ? 'rgba(94,212,122,0.20)' : 'rgba(245,215,138,0.16)',
            border: '1px solid', borderColor: copied ? 'rgba(94,212,122,0.40)' : 'rgba(245,215,138,0.40)',
            color: copied ? '#5ED47A' : '#F5D78A',
            fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={nativeShare} style={{
            flex: 1, padding: '12px',
            background: 'linear-gradient(135deg, #F5D78A, var(--tm-gold))',
            border: 'none', borderRadius: 12, color: '#070C09',
            fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
          }}>Share</button>
          <button onClick={openPrintFlyer} style={{
            flex: 1, padding: '12px',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 12, color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
              Print flyer
            </span>
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginTop: 10, lineHeight: 1.4 }}>
          Print the flyer for the first-tee post. Anyone who scans it<br />sees this leaderboard live — no app required.
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── AnnouncementBanner (item 7) ─────────────────────────────────────────────
// Surfaces the most recent commissioner announcement at the top of the
// Outing page for every participant. Dismissible per-id via localStorage
// so a user who's already read the message doesn't keep seeing it across
// page navigations. New announcements get a fresh id → fresh banner.
// (2026-05-02)
function AnnouncementBanner({ outing }) {
  const list = Array.isArray(outing.state?.announcements) ? outing.state.announcements : []
  const latest = list[0]
  const [dismissed, setDismissed] = useState(false)
  const code = outing.code

  // Load dismissed-id from localStorage on mount + when code changes.
  useEffect(() => {
    setDismissed(false)
    if (!latest?.id) return
    try {
      const seen = localStorage.getItem(`tm_announce_seen_${code}`)
      if (seen === latest.id) setDismissed(true)
    } catch { /* ignore */ }
  }, [code, latest?.id])

  if (!latest || dismissed) return null

  function whenStr(iso) {
    if (!iso) return ''
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return ''
    const ms = Date.now() - t
    const min = Math.floor(ms / 60000)
    if (min < 1)  return 'just now'
    if (min < 60) return `${min}m ago`
    if (min < 1440) return `${Math.floor(min / 60)}h ago`
    return `${Math.floor(min / 1440)}d ago`
  }

  return (
    <div style={{
      marginTop: 8, padding: '10px 14px',
      background: 'linear-gradient(135deg, rgba(46,160,255,0.14), rgba(46,160,255,0.04))',
      border: '1px solid rgba(46,160,255,0.40)',
      borderRadius: 12,
      display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7CC5FF"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 1 }}>
        <path d="M3 11l18-5v12L3 13z"/>
        <path d="M11.6 16.8a3 3 0 11-5.2 3"/>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: '#7CC5FF', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
            Commissioner
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>· {whenStr(latest.posted_at)}</span>
        </div>
        <div style={{
          fontSize: 12, color: 'rgba(255,255,255,0.92)',
          lineHeight: 1.45, whiteSpace: 'pre-wrap',
        }}>{latest.text}</div>
      </div>
      <button
        onClick={() => {
          try { localStorage.setItem(`tm_announce_seen_${code}`, latest.id) } catch { /* ignore */ }
          setDismissed(true)
        }}
        aria-label="Dismiss"
        style={{
          background: 'transparent', border: 'none',
          color: 'rgba(255,255,255,0.55)', fontSize: 16, cursor: 'pointer',
          padding: '0 4px', lineHeight: 1, flexShrink: 0,
        }}>✕</button>
    </div>
  )
}

// ─── CommsTab (item 7) ───────────────────────────────────────────────────────
// Host-only announcements composer + history + cancel-outing affordance.
// Tab in CommissionerPanel. Posting an announcement fires push to every
// non-host participant. Cancel changes outing.status to 'cancelled' and
// pushes a notice to the roster — the cancel button confirms via window
// .confirm because there's no undo. (2026-05-02)
