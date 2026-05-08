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
