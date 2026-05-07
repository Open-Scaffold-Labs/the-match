#!/usr/bin/env node
/**
 * One-off backfill: write the missing tm_match_history pair rows for
 * every closed individual-format outing with 3+ participants.
 *
 * Why: until 2026-05-07 PM3, /outings/:code/end only wrote pair rows
 * for (best-scoring-player, every-other-player). Non-leader pairs were
 * never recorded — so for outing 67 (Matt 82, Dan 92, James 94), the
 * (Dan, James) pair was missing and Dan↔James didn't see each other in
 * each other's rivalries. Same gap existed for every multi-player
 * individual outing in history.
 *
 * What this does:
 *   1. SELECT every closed, team_format='individual' outing with ≥3
 *      tm_outing_participants rows.
 *   2. For each, walk all N-choose-2 pairs.
 *   3. For each pair, INSERT into tm_match_history if a row for that
 *      (outing, pair) doesn't already exist. The h2h trigger on
 *      tm_match_history rolls the new rows into tm_h2h_records.
 *
 * Pair existence check: tm_match_history has no UNIQUE constraint on
 * (outing_id, winner_id, loser_id) so we have to check by hand.
 * Existing rows are kept untouched (idempotent).
 *
 * Run:
 *   node scripts/backfill-h2h-pairs.js --dry-run
 *   node scripts/backfill-h2h-pairs.js
 */

const path = require('path')
const fs = require('fs')

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)\s*=\s*(.+)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
}
loadEnv()

const { Pool } = require('pg')
const dryRun = process.argv.includes('--dry-run')

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  console.log(`mode: ${dryRun ? 'DRY-RUN (no inserts)' : 'WRITE'}`)
  console.log()

  // Find closed individual-format outings with 3+ participants.
  const { rows: outings } = await pool.query(`
    SELECT o.id, o.code, o.course_name, o.created_at
      FROM tm_outings o
      JOIN tm_outing_participants p ON p.outing_id = o.id
     WHERE o.team_format = 'individual'
       AND o.status = 'closed'
     GROUP BY o.id
    HAVING COUNT(*) >= 3
     ORDER BY o.created_at ASC
  `)
  console.log(`found ${outings.length} closed individual outing(s) with 3+ participants`)
  console.log()

  let totalPairsExpected = 0
  let totalPairsExisting = 0
  let totalPairsInserted = 0

  for (const o of outings) {
    const { rows: parts } = await pool.query(
      `SELECT user_id, total FROM tm_outing_participants
        WHERE outing_id = $1 AND user_id IS NOT NULL
        ORDER BY total ASC NULLS LAST`,
      [o.id]
    )
    if (parts.length < 3) continue  // edge case: counted with guests in HAVING

    const { rows: existing } = await pool.query(
      `SELECT winner_id, loser_id, is_tie FROM tm_match_history WHERE outing_id = $1`,
      [o.id]
    )
    const existingPairKey = (a, b) => {
      const x = String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`
      return x
    }
    const existingPairs = new Set()
    for (const e of existing) {
      if (e.is_tie) continue  // ties have null winner/loser, can't key — skip
      existingPairs.add(existingPairKey(e.winner_id, e.loser_id))
    }
    // For ties, fall back to scanning by total equality — if two
    // participants have the same total and there's any tie row in the
    // outing, assume those two are already paired. Imperfect, but good
    // enough — ties in stroke play with same total are rare.

    const pairsThisOuting = []
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]   // lower total (winner if not tie)
        const b = parts[j]
        const isTie = a.total === b.total
        const winnerId = isTie ? null : a.user_id
        const loserId  = isTie ? null : b.user_id
        const exists = isTie
          // Only count tie-row as "exists" if there's an existing tie row in this outing
          // — see comment above. Imperfect but safe (we'd over-write a tie at most).
          ? existing.some(e => e.is_tie)
          : existingPairs.has(existingPairKey(winnerId, loserId))
        pairsThisOuting.push({ a, b, isTie, winnerId, loserId, exists })
      }
    }
    const missing = pairsThisOuting.filter(p => !p.exists)
    totalPairsExpected += pairsThisOuting.length
    totalPairsExisting += pairsThisOuting.length - missing.length
    totalPairsInserted += missing.length

    if (missing.length === 0) continue
    console.log(`outing ${o.id} (${o.code}, ${new Date(o.created_at).toISOString().slice(0,10)}): ${pairsThisOuting.length} expected pairs, ${missing.length} missing`)
    for (const p of missing) {
      console.log(`  + ${p.isTie ? 'TIE' : `winner ${p.winnerId} > loser ${p.loserId}`} (${p.a.total} vs ${p.b.total})`)
      if (!dryRun) {
        await pool.query(
          `INSERT INTO tm_match_history
             (outing_id, winner_id, loser_id, is_tie, winner_score, loser_score, course_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [o.id, p.winnerId, p.loserId, p.isTie, p.a.total, p.b.total, o.course_name]
        )
      }
    }
  }

  console.log()
  console.log(`SUMMARY`)
  console.log(`  outings scanned: ${outings.length}`)
  console.log(`  pairs expected (N-choose-2 across all outings): ${totalPairsExpected}`)
  console.log(`  pairs already in tm_match_history:              ${totalPairsExisting}`)
  console.log(`  pairs inserted ${dryRun ? '(would be inserted)' : 'this run'}:           ${totalPairsInserted}`)
  if (dryRun) console.log('\nDRY-RUN — re-run without --dry-run to apply.')
  await pool.end()
}

main().catch(err => {
  console.error('FAILED:', err)
  process.exit(1)
})
