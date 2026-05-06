// ─── lib/side-bets.js ───────────────────────────────────────────────────────
// Pure compute functions for the live side-bet standings:
//   • Nassau (heads-up, front-9 / back-9 / total 18, plus presses)
//   • Skins (carryover, multi-player)
//
// All input shapes are read from the outing's existing per-hole scores
// (state.participants[i].scores[]). Nothing here mutates anything; the
// caller renders the returned standings.
//
// (2026-05-06 — polish task #7)

// Find a participant's score array from the outing state. Returns []
// when the participant isn't found (caller treats unscored holes as 0).
function scoresFor(state, userId) {
  const p = (state?.participants || []).find(x => String(x.user_id) === String(userId))
  return Array.isArray(p?.scores) ? p.scores : []
}

// Lookup a participant's display name. Falls back to a short id stub.
function nameFor(state, userId) {
  const p = (state?.participants || []).find(x => String(x.user_id) === String(userId))
  return p?.name || `Player ${String(userId).slice(0, 4)}`
}

// ─── Nassau ─────────────────────────────────────────────────────────────────
//
// Compute the standings of a heads-up Nassau between two players.
// Returns:
//   {
//     stakes: number,
//     a: { id, name }, b: { id, name },
//     front9:  { holesPlayed, deltaPerHole[9], cumDelta, leaderId|null, settled },
//     back9:   { ...same shape, holes 10-18 },
//     total18: { ...same, holes 1-18 },
//     totalDollars: { aId: number, bId: number },
//     presses: [{ startHole, betweenIds, holesPlayed, cumDelta, leaderId, settled }],
//   }
//
// "Settled" = all 9 (or 18) holes have a score for both players. Until
// settled, the side-bet card surfaces "thru N" instead of a winner.
//
// `cumDelta` is signed from A's perspective. Positive = A leads; negative
// = B leads.
export function computeNassau(state, config) {
  const stakes = Number(config?.stakes) || 0
  const [aId, bId] = (config?.participant_ids || []).map(String)
  if (!aId || !bId) return null

  const aScores = scoresFor(state, aId)
  const bScores = scoresFor(state, bId)
  const totalHoles = state?.holes ?? 18

  function range(startInclusive, endExclusive) {
    let cum = 0
    let played = 0
    const deltas = []
    for (let i = startInclusive; i < endExclusive; i++) {
      const a = Number(aScores[i] || 0)
      const b = Number(bScores[i] || 0)
      if (a > 0 && b > 0) {
        const sign = a < b ? 1 : a > b ? -1 : 0
        cum += sign
        deltas.push(sign)
        played++
      } else {
        deltas.push(null)
      }
    }
    const settled = played === (endExclusive - startInclusive)
    const leaderId = cum > 0 ? aId : cum < 0 ? bId : null
    return { holesPlayed: played, deltaPerHole: deltas, cumDelta: cum, leaderId, settled }
  }

  const front9  = range(0, Math.min(9, totalHoles))
  const back9   = range(Math.min(9, totalHoles), totalHoles)
  const total18 = range(0, totalHoles)

  // Presses — each is a new match-play bet from startHole to end.
  const presses = (config?.presses || []).map(pr => {
    const startHole = Number(pr.start_hole) || 0
    const seg = range(startHole, totalHoles)
    return { startHole, betweenIds: pr.between_ids || [aId, bId], ...seg }
  })

  // Dollar standing — only count settled segments (mid-round numbers
  // are noisy and not "owed" until the segment is over).
  //
  // 9-hole-outing fix (2026-05-06 hardening): when the outing only has
  // 9 holes, F9 and T18 cover the same range — settling both would
  // double-count the same match's winner. Same for B9 which has zero
  // holes in that case. So for ≤9-hole outings, only F9 counts.
  let aDollars = 0, bDollars = 0
  function settle(seg) {
    if (!seg.settled) return
    if (seg.leaderId === aId) { aDollars += stakes; bDollars -= stakes }
    else if (seg.leaderId === bId) { aDollars -= stakes; bDollars += stakes }
  }
  if (totalHoles <= 9) {
    settle(front9)
  } else {
    settle(front9)
    settle(back9)
    settle(total18)
  }
  presses.forEach(settle)

  return {
    stakes,
    a: { id: aId, name: nameFor(state, aId) },
    b: { id: bId, name: nameFor(state, bId) },
    front9, back9, total18,
    totalDollars: { [aId]: aDollars, [bId]: bDollars },
    presses,
  }
}

// ─── Skins ──────────────────────────────────────────────────────────────────
//
// Each hole's "skin" is worth `stakes` dollars + any carryover from
// preceding tied holes. A hole is "won" only when one player has the
// strictly-lowest score (no ties at the lowest). Ties roll the skin
// forward.
//
// Returns:
//   {
//     stakes: number,
//     players: [{ id, name }],
//     perHole: [{ winnerId|null, value, scoresById:{}, settled }],
//     totals:  { [id]: { skinsWon: number, dollars: number } },
//     pendingValue: number, // unwon carryover currently riding
//   }
export function computeSkins(state, config) {
  const stakes = Number(config?.stakes) || 0
  const ids = (config?.participant_ids || []).map(String)
  if (ids.length < 2) return null

  const totalHoles = state?.holes ?? 18
  const totals = Object.fromEntries(ids.map(id => [id, { skinsWon: 0, dollars: 0 }]))
  const perHole = []
  let carry = 0

  for (let i = 0; i < totalHoles; i++) {
    // Pull each player's score for hole i.
    const entries = ids.map(id => ({ id, score: Number(scoresFor(state, id)[i] || 0) }))
    const allScored = entries.every(e => e.score > 0)
    if (!allScored) {
      // Hole not yet fully scored — surface as unsettled, but DON'T
      // accumulate carry. (Carry only accrues from settled-and-tied
      // holes so an unscored hole can't poison the rest.)
      perHole.push({ winnerId: null, value: stakes, scoresById: Object.fromEntries(entries.map(e => [e.id, e.score])), settled: false })
      continue
    }
    const min = Math.min(...entries.map(e => e.score))
    const winners = entries.filter(e => e.score === min)
    const value = stakes + carry
    if (winners.length === 1) {
      const w = winners[0].id
      totals[w].skinsWon += 1
      totals[w].dollars += value
      perHole.push({ winnerId: w, value, scoresById: Object.fromEntries(entries.map(e => [e.id, e.score])), settled: true })
      carry = 0
    } else {
      perHole.push({ winnerId: null, value, scoresById: Object.fromEntries(entries.map(e => [e.id, e.score])), settled: true })
      carry += stakes
    }
  }

  return {
    stakes,
    players: ids.map(id => ({ id, name: nameFor(state, id) })),
    perHole,
    totals,
    pendingValue: carry,
  }
}

// Convenience — pick the right computer based on type.
export function computeBet(bet, state) {
  if (!bet) return null
  if (bet.type === 'nassau') return computeNassau(state, bet.config)
  if (bet.type === 'skins')  return computeSkins(state, bet.config)
  return null
}
