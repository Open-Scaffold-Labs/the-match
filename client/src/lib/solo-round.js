// solo-round.js — shared helpers for the solo-round resume pipeline.
//
// localStorage holds an in-progress solo round so a page reload (real
// reload, accidental pull-to-refresh, background-tab eviction) can
// restore the user to where they left off. The storage key is scoped
// per-user so two accounts on the same device don't collide.
//
// Owners:
//   - ActiveRound.jsx — writes/reads on every meaningful state change
//     while phase === 'scoring'; clears on save/finish.
//   - Outing.jsx — reads on mount; if a scoring round exists, sets
//     view='solo' so ActiveRound mounts and resumes.
//   - OutingHub.jsx — reads to render the "Resume Solo Round" card in
//     the Live Now strip when the user is at the hub.
//
// The previous implementation kept this logic in ActiveRound only,
// which broke after pull-to-refresh: a full page reload remounts
// Outing with view='hub', so ActiveRound never mounts and never reads
// localStorage. Hoisting the read up to Outing/OutingHub fixes both
// the resume-on-refresh and the "doesn't show up in live rounds" bugs.
// (2026-05-07 PM)

export const SOLO_ROUND_STORAGE_KEY = uid => `tm-active-round-v1-${uid || 'anon'}`

// Read the saved round, validating shape. Returns null when nothing is
// saved, when the JSON is corrupted, when localStorage is disabled, or
// when the saved phase isn't 'scoring' (setup/summary phases are
// short-lived and don't need resume semantics — a saved 'setup' phase
// is effectively a no-op for restore).
export function readSavedSoloRound(uid) {
  try {
    const raw = localStorage.getItem(SOLO_ROUND_STORAGE_KEY(uid))
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (
      saved &&
      saved.phase === 'scoring' &&
      saved.config &&
      Array.isArray(saved.config.pars) &&
      saved.config.pars.length > 0
    ) {
      return saved
    }
    return null
  } catch {
    return null
  }
}

// Quick boolean form for components that just want to know whether a
// resume card should appear, without unpacking the data.
export function hasSavedSoloRound(uid) {
  return readSavedSoloRound(uid) != null
}

// ── Start a solo round from OUTSIDE ActiveRound (2026-07-10, Play funnel S3) ──
// Writes a fresh 'scoring'-phase blob in EXACTLY the shape ActiveRound's
// autosave writes and its restore validator accepts (phase 'scoring',
// config.pars array, zeroed scores, per-hole [] shots, null putt facts).
// Refuses when a scoring round already exists (never clobber an in-progress
// round — the caller should offer Resume instead). Fires 'tm-solo-started'
// so an already-mounted Outing can flip to the solo view (its auto-resume
// check is one-shot per mount and would otherwise miss this).
// config: { courseName, pars, courseRating, slopeRating, holeHandicaps,
//           courseId, courseTee } — the same keys SetupSheet's onStart carries.
export function startSoloRound(uid, config) {
  if (!config || !Array.isArray(config.pars) || config.pars.length === 0) return false
  if (readSavedSoloRound(uid)) return false
  const n = config.pars.length
  try {
    localStorage.setItem(SOLO_ROUND_STORAGE_KEY(uid), JSON.stringify({
      phase: 'scoring',
      config,
      hole: 0, // 0-indexed (ActiveRound convention)
      scores: new Array(n).fill(0),
      shots: new Array(n).fill(null).map(() => []),
      putts: new Array(n).fill(null),
      firstPutts: new Array(n).fill(null),
    }))
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('tm-solo-started'))
    }
    return true
  } catch {
    return false
  }
}

// ── Solo shot façade (2026-07-07, Slice 0) ──────────────────────────────
// The walk-and-confirm buffer (lib/shot-capture.js) routes its `solo` scope
// through THESE two helpers so solo has exactly ONE physical store — the
// same round blob ActiveRound owns — never a second copy that could race
// with ActiveRound's autosave. They read-modify-write only the blob's
// `shots[]`, preserving every other key. Reading the raw blob directly
// (not readSavedSoloRound) so a shots read/write doesn't depend on the
// phase gate. (EE→solo live writes + focus reconciliation are Slice 2.)
function readRawSolo(uid) {
  try {
    const raw = localStorage.getItem(SOLO_ROUND_STORAGE_KEY(uid))
    if (!raw) return null
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : null
  } catch {
    return null
  }
}

// One hole's solo shots → array ([] on miss / no round / corrupt / disabled).
export function readSoloShots(uid, holeIdx) {
  const h = Number(holeIdx)
  if (!Number.isInteger(h) || h < 0) return []
  const o = readRawSolo(uid)
  const shots = o && Array.isArray(o.shots) ? o.shots : null
  const cell = shots ? shots[h] : null
  return Array.isArray(cell) ? cell : []
}

// Replace one hole's solo shots inside the existing blob. No-op (returns the
// array) when there's no in-progress solo round to attach to, or when
// localStorage is unavailable — capture degrades to "not logged", never a throw.
export function writeSoloShots(uid, holeIdx, arr) {
  const h = Number(holeIdx)
  const next = Array.isArray(arr) ? arr : []
  if (!Number.isInteger(h) || h < 0) return next
  try {
    const o = readRawSolo(uid)
    if (!o) return next
    const shots = Array.isArray(o.shots) ? o.shots.slice() : []
    while (shots.length <= h) shots.push([])
    shots[h] = next
    localStorage.setItem(SOLO_ROUND_STORAGE_KEY(uid), JSON.stringify({ ...o, shots }))
    // Notify a mounted ActiveRound (same document, a different app-tab) to
    // re-hydrate its shots so an Eagle-Eye capture isn't clobbered by
    // ActiveRound's whole-blob autosave. Guarded for the Node test env.
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event('tm-solo-shots'))
    }
    return next
  } catch {
    return next
  }
}
