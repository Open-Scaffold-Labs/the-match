// One-off recompute script — runs maybeUpdateUserHandicap against every
// user in the DB. Useful when the handicap formula changes (e.g.,
// USGA → free-tier swap) and you don't want to wait for each user to
// log a new round before their displayed handicap reflects the change.
//
// Usage (from Matt's Mac, with .env loaded):
//   cd /Users/matthewlavin/the-match
//   set -a && source .env && set +a
//   node scripts/recompute-handicaps.js
//
// Idempotent — re-running just rewrites the same value.
// (2026-05-01)

const path = require('path')
process.env.NODE_ENV = process.env.NODE_ENV || 'production'

const db = require(path.join(__dirname, '..', 'server', 'src', 'db'))
const { maybeUpdateUserHandicap } = require(path.join(__dirname, '..', 'server', 'src', 'lib', 'handicap'))

;(async () => {
  try {
    const users = await db.many(`SELECT id, name FROM tm_users ORDER BY id`)
    console.log(`[recompute] ${users.length} users`)
    for (const u of users) {
      const before = await db.one('SELECT handicap FROM tm_users WHERE id = $1', [u.id])
      const newHcp = await maybeUpdateUserHandicap(u.id)
      const after  = await db.one('SELECT handicap FROM tm_users WHERE id = $1', [u.id])
      const beforeNum = before?.handicap == null ? '—' : Number(before.handicap).toFixed(1)
      const afterNum  = after?.handicap  == null ? '—' : Number(after.handicap).toFixed(1)
      const updated   = newHcp != null
      console.log(`  ${String(u.id).padStart(3)}  ${u.name.padEnd(18)}  ${beforeNum.padStart(5)} → ${afterNum.padStart(5)}  ${updated ? '✓' : '· (skipped, <5 completed rounds)'}`)
    }
    console.log('[recompute] done')
    process.exit(0)
  } catch (e) {
    console.error('[recompute] failed:', e)
    process.exit(1)
  }
})()
