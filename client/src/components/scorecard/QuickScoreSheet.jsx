// QuickScoreSheet — score the current hole WITHOUT leaving the Play map
// (Phase 2 / P2-D+E, wiki/synthesis/play-oncourse-phase2-build-spec-2026-07-10.md).
//
// Presentational bottom sheet, portaled to <body> so it renders over the
// Play tab even though its OWNER lives in a hidden tab — the owner is
// LiveOuting (match) or ActiveRound (solo), which is the whole point:
// the Save button routes into the owner's EXISTING write path (saveScore
// with offline queue + idempotency + OCC for matches; setScore + autosave
// blob for solo). Zero forked scoring logic lives here.
//
// v1 scope (spec §3 decisions): self-score only; collapsed quick-entry only —
// "Full scorecard →" jumps to the Match tab (the expanded in-sheet grid is a
// logged follow-up). No auto-advance on save (the S4 GPS nudge + the map's
// hole arrows own hole movement; the sheet FOLLOWS EE's current hole).
//
// z-index 8900: above all map HUD (≤1000), below the modals (9999) and EE's
// leave prompt (10000) so conflict chips / celebrations stack correctly.
//
// `hole` is 1-INDEXED (EE convention). Owners convert to their own indexing
// at their boundary — exactly once.

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import PuttChips from './PuttChips.jsx'
import { cellBg, cellColor, cellBorder } from './index.jsx'

export default function QuickScoreSheet({
  open,
  hole,               // 1-indexed
  par = 4,
  currentScore = 0,   // existing score for this hole (0/null = unscored)
  contextLabel = null, // e.g. "MATCH 8EG6" / course name
  saving = false,
  savedAt = null,
  onSave,             // (score, { putts, firstPutt }) => void|Promise
  onClose,
  onFullScorecard,    // optional "Full scorecard →"
}) {
  const [val, setVal]             = useState(currentScore || par || 4)
  const [puttVal, setPuttVal]     = useState(null)
  const [firstPutt, setFirstPutt] = useState(null)
  const [justSaved, setJustSaved] = useState(false)

  // Re-seed when the hole changes (the sheet follows EE's current hole) or
  // the sheet re-opens. Putt facts reset per hole — no prefill, so a re-save
  // can never wipe an earlier entry (same rule as ScoreModal).
  useEffect(() => {
    setVal(currentScore || par || 4)
    setPuttVal(null)
    setFirstPutt(null)
    setJustSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole, open])

  // Brief saved cue driven by the owner's savedAt bump.
  useEffect(() => {
    if (!savedAt || !open) return
    setJustSaved(true)
    const t = setTimeout(() => setJustSaved(false), 2200)
    return () => clearTimeout(t)
  }, [savedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

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
    if (saving) return
    // Same typo guard as ScoreModal (Round 4 audit).
    const overBy = val - (par || 4)
    if (overBy >= 5 || val > (par || 4) * 2) {
      const ok = window.confirm(`${val} on a par-${par || 4}? That's ${overBy} over par. Tap Cancel to fix it, OK to save anyway.`)
      if (!ok) return
    }
    const clean = (puttVal != null && puttVal <= val) ? puttVal : null
    onSave?.(val, { putts: clean, firstPutt: clean != null && clean > 0 ? firstPutt : null })
  }

  return createPortal(
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 8900,
      display: 'flex', justifyContent: 'center', pointerEvents: 'none',
    }}>
      <div style={{
        width: '100%', maxWidth: 430, pointerEvents: 'auto',
        background: 'var(--tm-surface)', borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.45)',
        padding: '14px 20px calc(env(safe-area-inset-bottom, 0px) + 18px)',
      }}>
        {/* Header row: hole context + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--tm-text)' }}>
            Hole {hole}{par ? ` · Par ${par}` : ''}
            {contextLabel && <span style={{ fontWeight: 600, color: 'var(--tm-text-3)' }}> · {contextLabel}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {justSaved && (
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--tm-green-text)' }}>Saved ✓</span>
            )}
            {onFullScorecard && (
              <button onClick={onFullScorecard} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, color: 'var(--tm-text-3)', textDecoration: 'underline',
              }}>Full scorecard →</button>
            )}
            <button onClick={onClose} aria-label="Close" style={{
              background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)',
              borderRadius: 999, width: 26, height: 26, cursor: 'pointer',
              color: 'var(--tm-text-3)', fontSize: 13, lineHeight: 1,
            }}>✕</button>
          </div>
        </div>

        {/* Stepper — compact version of ScoreModal's */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, marginBottom: 12 }}>
          <button onClick={() => setVal(v => Math.max(1, v - 1))}
            style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontSize: 24, fontWeight: 300, cursor: 'pointer' }}>−</button>
          <div style={{ fontSize: 44, fontWeight: 900, color: cellColor(val, par), minWidth: 56, textAlign: 'center', lineHeight: 1 }}>{val}</div>
          <button onClick={() => setVal(v => v + 1)}
            style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--tm-surface-2)', border: '1px solid var(--tm-border)', color: 'var(--tm-text)', fontSize: 24, fontWeight: 300, cursor: 'pointer' }}>+</button>
        </div>

        {/* Quick picks */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          {quickPicks.map(q => (
            <button key={q.label} onClick={() => setVal(q.score)}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: val === q.score ? cellBg(q.score, par) || 'var(--tm-surface-3)' : 'var(--tm-surface-2)',
                border: val === q.score ? cellBorder(q.score, par) : '1px solid var(--tm-border)',
                color: val === q.score ? cellColor(q.score, par) : 'var(--tm-text-3)',
              }}>{q.label} ({q.score})</button>
          ))}
        </div>

        {/* Putt facts — optional-always, same shared chips as everywhere. */}
        <PuttChips puttVal={puttVal} setPuttVal={setPuttVal} firstPutt={firstPutt} setFirstPutt={setFirstPutt} />

        <button onClick={handleSave} disabled={saving} style={{
          width: '100%', padding: 13, borderRadius: 'var(--tm-radius-lg)',
          background: 'linear-gradient(135deg, var(--tm-green), var(--tm-green-bright))',
          color: '#fff', fontWeight: 800, fontSize: 15, border: 'none',
          cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1,
        }}>{saving ? 'Saving…' : `Save Hole ${hole}`}</button>
      </div>
    </div>,
    document.body
  )
}
