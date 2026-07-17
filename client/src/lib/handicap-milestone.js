// Pure milestone-line computation for the HcpBadge in Stats.jsx.
// Pulled out of pages/Stats.jsx so Node can run unit tests without
// parsing JSX. The .jsx file re-exports it for import sites that
// already path to Stats.jsx. (2026-05-06 hardening pass — task #6.)
//
// Picks one signal in priority order:
//   1. Just logged a new personal best (lowest total ever).
//   2. Just crossed sub-80 for the first time.
//   3. Recent improvement vs prior 5-round avg (≥2 strokes down).
//   4. Recent slip vs prior 5-round avg (≥2 strokes up).
//   5. Steady — last 5 rounds within 2 strokes of each other.
// Returns null when nothing notable to say (caller hides the slot).

export function computeHandicapMilestone(rounds = []) {
  // Partial-rounds spec (2026-07-16 §5-14 adjacent): milestones talk about
  // REAL full-18 scores ("new personal best", "first sub-80") — a 47-thru-10
  // partial or a 9-hole 40 must never claim them. Rounds without the server's
  // partial fields (legacy cache) pass through as before.
  const list = (rounds || [])
    .filter(r => r.is_partial !== true && Number(r.holes ?? 18) !== 9)
    .map(r => ({ score: Number(r.score ?? r.total), par: Number(r.course_par || 72) }))
    .filter(r => Number.isFinite(r.score) && r.score > 0)
  if (list.length < 2) return null
  const newest = list[0]

  // 1. Personal best — newest round is the strict minimum across all.
  if (list.length >= 3) {
    const min = Math.min(...list.map(r => r.score))
    const isUniqueMin = list.filter(r => r.score === min).length === 1
    if (newest.score === min && isUniqueMin) {
      return `New personal best — ${newest.score}.`
    }
  }

  // 2. First sub-80 — newest is < 80 AND no prior round was.
  if (newest.score < 80 && list.slice(1).every(r => r.score >= 80)) {
    return `First sub-80 round in the books — ${newest.score}.`
  }

  // 3 / 4. Trend vs prior 5 (use rounds 1..5 as the comparison window;
  // need at least 5 rounds total for the prior 5 to exist).
  if (list.length >= 6) {
    const priorWindow = list.slice(1, 6)   // rounds 1..5 (the 5 before newest)
    const avgPrior = priorWindow.reduce((s, r) => s + r.score, 0) / priorWindow.length
    const delta = newest.score - avgPrior
    if (delta <= -2) {
      return `Down ${Math.abs(delta).toFixed(1)} strokes vs your prior 5.`
    }
    if (delta >= 2) {
      return `Up ${delta.toFixed(1)} strokes vs your prior 5 — practice mode?`
    }
  }

  // 5. Steady — last 5 rounds within 2 strokes max-to-min.
  if (list.length >= 5) {
    const recent5 = list.slice(0, 5).map(r => r.score)
    const spread = Math.max(...recent5) - Math.min(...recent5)
    if (spread <= 2) {
      return `Steady — last 5 rounds within ${spread} strokes.`
    }
  }

  return null
}
