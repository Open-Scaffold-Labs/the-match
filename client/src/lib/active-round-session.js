// active-round-session.js — THE single answer to "is a round active?"
// (Phase 2 / P2-A, wiki/synthesis/play-oncourse-phase2-build-spec-2026-07-10.md)
//
// DOCTRINE — read this before touching anything:
//   solo truth  = the solo round blob (lib/solo-round.js);
//   match truth = the server's outing status;
//   this session object is an INDEX for the Play surface — NEVER load-bearing.
// Readers must validate (a solo session needs a live blob; a match session is
// verified lazily against the server) and self-heal by clearing. A missed
// writer degrades to the old inferred behavior, never to a stuck UI.
//
// Why it exists: before this, Play inferred "round active" from
// activeScoring (published only while the LiveOuting screen is open) OR the
// solo blob — so a live match with the Match tab sitting at the hub read as
// "no active round" (the documented Phase-1 blind spot). This object is
// written at every round start/join and cleared at every end/cancel/discard,
// regardless of which screens are open.
//
// Shape: { kind:'solo'|'match', code?, courseId?, courseName?, courseTee?,
//          holeCount?, startedAt }
// Writes MERGE (sparse writers — e.g. a join that only knows the code — never
// erase richer fields written earlier; course-recents.js pattern). Clears are
// code-guarded so an old match's late clear can't kill a newer session.
// Every mutation fires 'tm-session-changed' for mounted listeners.

const KEY = uid => `tm-active-session-v1-${uid || 'anon'}`

function emitChange() {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('tm-session-changed'))
  }
}

export function readSession(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid))
    if (!raw) return null
    const s = JSON.parse(raw)
    if (s && (s.kind === 'solo' || s.kind === 'match')) {
      if (s.kind === 'match' && !s.code) return null // a match session without a code is useless
      return s
    }
    return null
  } catch {
    return null
  }
}

// Merge-upsert. Same kind (+ same code for matches) → merge, patch fields win
// but null/undefined patch values never erase existing ones. Different kind or
// different match code → the patch REPLACES the session (a new round always
// wins; one active round at a time is the product rule).
export function writeSession(uid, patch) {
  if (!patch || (patch.kind !== 'solo' && patch.kind !== 'match')) return
  try {
    const prev = readSession(uid)
    const sameRound = prev && prev.kind === patch.kind &&
      (patch.kind === 'solo' || String(prev.code) === String(patch.code))
    const base = sameRound ? prev : { startedAt: Date.now() }
    const next = { ...base }
    for (const [k, v] of Object.entries(patch)) {
      if (v != null) next[k] = v
    }
    if (next.code != null) next.code = String(next.code).toUpperCase()
    localStorage.setItem(KEY(uid), JSON.stringify(next))
    emitChange()
  } catch { /* storage off — the readers' self-heal covers us */ }
}

// Clear, optionally guarded by code: clearSession(uid, { code }) only clears
// when the stored session is that match — so a late "match X ended" signal
// can't wipe a session for match Y (or a solo round) started since.
export function clearSession(uid, { code } = {}) {
  try {
    if (code != null) {
      const s = readSession(uid)
      if (!s || s.kind !== 'match' || String(s.code).toUpperCase() !== String(code).toUpperCase()) return
    }
    localStorage.removeItem(KEY(uid))
    emitChange()
  } catch { /* ignore */ }
}
