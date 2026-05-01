// Score-to-par color helper. Used by both the Tour page leaderboard
// (PGAScores.jsx) and the live-match scoreboard view (MatchScoreboard
// inside Outing.jsx) so the visual language stays identical between
// "watching the pros" and "watching your own match."
//
// Returns:
//   under-par → gold     (#C9A040)
//   even par  → green    (#1B5E3B)
//   over par  → red      (#DC2626)
//   null      → muted    (rgba(13,31,18,0.40))
export function scoreColor(val) {
  if (val == null) return 'rgba(13,31,18,0.40)'
  if (val < 0)  return '#C9A040'   // under par — gold
  if (val === 0) return '#1B5E3B'  // even — green
  return '#DC2626'                  // over par — red
}

// Format a score-to-par integer for display.
//   null → "—"
//   0    → "E"
//   +N   → "+N"
//   -N   → "-N"
export function formatDiff(val) {
  if (val == null) return '—'
  if (val === 0) return 'E'
  if (val > 0) return `+${val}`
  return String(val)
}
