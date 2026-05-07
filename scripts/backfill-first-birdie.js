#!/usr/bin/env node
/**
 * One-off backfill: award `first_birdie` to every user who has already
 * scored a birdie in their historical outings.
 *
 * Why: the achievement was added 2026-05-07 after James Ashe scored a
 * birdie in outing 67 and asked why he didn't get a badge. Going forward,
 * the live `checkAfterHoleScore` path catches every new birdie — but
 * existing rounds were played before the achievement existed.
 *
 * What this does:
 *   1. JOIN tm_outings × tm_outing_participants on outings that have
 *      hole_pars + scores both populated.
 *   2. For each participant, walk both arrays in parallel and find the
 *      earliest hole where score === par - 1 && par >= 3.
 *   3. Per user, keep only the EARLIEST such hole across all their
 *      outings (ordered by outing.created_at).
 *   4. INSERT INTO tm_achievements with type='first_birdie',
 *      earned_at = the outing's created_at, ON CONFLICT DO NOTHING so a
 *      re-run is a no-op.
 *
 * Crucially, this skips the runtime achievement helper — no push notifs
 * fired. Users see the badge when they next open the app. Sending a
 * push for a 3-week-old round would be confusing.
 *
 * Run: node scripts/backfill-first-birdie.js  (or --dry-run)
 */

const path = require('path')
const fs = require('fs')

// Load .env into process.env (no dotenv dependency added just for this).
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

  // Pull every (outing × participant) where both arrays exist + scores have
  // any non-zero entries. Order by outing date so the per-user "earliest"
  // calculation is straightforward.
  const { rows } = await pool.query(`
    SELECT
      o.id           AS outing_id,
      o.created_at   AS outing_created_at,
      o.hole_pars    AS hole_pars,
      p.user_id      AS user_id,
      p.scores       AS scores
    FROM tm_outings o
    JOIN tm_outing_participants p ON p.outing_id = o.id
    WHERE o.hole_pars IS NOT NULL
      AND p.scores IS NOT NULL
      AND p.user_id IS NOT NULL
    ORDER BY o.created_at ASC
  `)

  // Per-user earliest birdie. Map<user_id, { outing_id, hole_index, par, score, when }>
  const earliest = new Map()
  for (const r of rows) {
    const pars   = Array.isArray(r.hole_pars) ? r.hole_pars : []
    const scores = Array.isArray(r.scores)    ? r.scores    : []
    const n = Math.min(pars.length, scores.length, 18)
    for (let i = 0; i < n; i++) {
      const par   = Number(pars[i])
      const score = Number(scores[i])
      if (!Number.isFinite(par) || !Number.isFinite(score)) continue
      if (par < 3) continue
      if (score !== par - 1) continue
      const key = String(r.user_id)
      if (!earliest.has(key)) {
        earliest.set(key, {
          user_id: r.user_id,
          outing_id: r.outing_id,
          hole: i + 1,
          par,
          score,
          when: r.outing_created_at,
        })
      }
      break // earliest hole in this outing — but only matters if this user
             // didn't already have an earlier outing's birdie. The
             // ORDER BY o.created_at ASC + the !earliest.has guard ensure
             // we keep only the first one across all their outings.
    }
  }

  console.log(`scanned ${rows.length} (outing × participant) rows`)
  console.log(`found ${earliest.size} user(s) with at least one historical birdie`)
  console.log()

  if (earliest.size === 0) {
    console.log('nothing to backfill.')
    await pool.end()
    return
  }

  // Show a sample so it's auditable before any insert.
  for (const e of earliest.values()) {
    console.log(`  user ${e.user_id}: outing ${e.outing_id} (${new Date(e.when).toISOString().slice(0,10)}) · hole ${e.hole} · par ${e.par} → score ${e.score}`)
  }
  console.log()

  if (dryRun) {
    console.log('DRY-RUN — no inserts. Re-run without --dry-run to apply.')
    await pool.end()
    return
  }

  let inserted = 0
  let skipped = 0
  for (const e of earliest.values()) {
    const r = await pool.query(
      `INSERT INTO tm_achievements (user_id, type, context_outing_id, metadata, earned_at)
       VALUES ($1, 'first_birdie', $2, $3, $4)
       ON CONFLICT (user_id, type) DO NOTHING
       RETURNING id`,
      [
        Number(e.user_id),
        Number(e.outing_id),
        JSON.stringify({ hole: e.hole, par: e.par, score: e.score, backfilled: true }),
        e.when,
      ]
    )
    if (r.rows.length) inserted++
    else skipped++
  }

  console.log(`inserted: ${inserted}`)
  console.log(`skipped (already had first_birdie): ${skipped}`)
  await pool.end()
}

main().catch(err => {
  console.error('FAILED:', err)
  process.exit(1)
})
