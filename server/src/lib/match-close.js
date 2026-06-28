// Pure helpers for closing an outing (Track F.6 / audit N4).
//
// The /end handler used to write 1v1 match history with a nested loop doing
// ONE awaited INSERT per pair — N-choose-2 sequential round-trips. A 150-player
// individual outing = ~11,175 round-trips, which blows past the Vercel function
// timeout and half-closes the event. These helpers compute the same rows the
// loop did, as plain arrays, so the route can write them in a SINGLE batched
// `unnest` INSERT (and a single batched result UPDATE) instead.
//
// Kept PURE (no DB, no I/O) so the pairing + result logic — which had a real
// production bug history (2026-05-07 missed non-leader pairs; 2026-06-23 tie
// NOT NULL crash) — is unit-tested in isolation. See match-close.test.js.

// Build the 1v1 pair rows for individual play.
// `participants` MUST be pre-sorted by total ASC (NULLS LAST), exactly as the
// route queries them, so for each pair a (lower/equal total) is the "winner"
// slot and b the "loser" slot. `is_tie` disambiguates an actual win from a tie;
// every reader checks is_tie before treating winner_id as a winner.
// Returns column-parallel arrays for a single `unnest(...)` INSERT.
function buildPairRows(participants) {
  const winnerIds = []
  const loserIds = []
  const isTies = []
  const winnerScores = []
  const loserScores = []
  for (let i = 0; i < participants.length; i++) {
    for (let j = i + 1; j < participants.length; j++) {
      const a = participants[i]
      const b = participants[j]
      winnerIds.push(a.user_id)
      loserIds.push(b.user_id)
      isTies.push(a.total === b.total)
      winnerScores.push(a.total)
      loserScores.push(b.total)
    }
  }
  return { winnerIds, loserIds, isTies, winnerScores, loserScores }
}

// Compute each participant's result label ('win' | 'tie' | 'loss').
// `participants` sorted by total ASC. The best (lowest) total wins; if more
// than one shares the best total it's a tie for all of them. Mirrors the prior
// per-row logic exactly. Returns parallel arrays for a single batched UPDATE.
function computeResults(participants) {
  if (!participants.length) return { ids: [], results: [] }
  const best = participants[0].total
  const winnersAtBest = participants.filter(x => x.total === best).length
  const ids = []
  const results = []
  for (const p of participants) {
    const result = p.total === best
      ? (winnersAtBest > 1 ? 'tie' : 'win')
      : 'loss'
    ids.push(p.id)
    results.push(result)
  }
  return { ids, results }
}

module.exports = { buildPairRows, computeResults }
