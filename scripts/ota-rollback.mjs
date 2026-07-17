#!/usr/bin/env node
// OTA rollback — flip the active bundle back to a previously-published
// version. Devices that already installed the bad bundle DOWNGRADE on next
// app open? NO — the endpoint never serves an older version than the device
// runs ("up to date" when active <= current). Rollback therefore (a) stops
// NEW devices from receiving the bad bundle immediately, and (b) devices on
// the bad bundle recover when you publish a FIXED HIGHER version (the normal
// remedy: rollback to stop the bleeding, then publish vNext). The plugin's
// own notifyAppReady auto-rollback separately protects devices whose bad
// bundle fails to boot at all. Full playbook: docs/OTA-RUNBOOK.md.
//
//   node scripts/ota-rollback.mjs --to 1.0.0        # activate that version
//   node scripts/ota-rollback.mjs --off              # deactivate ALL (serve nothing)
//   node scripts/ota-rollback.mjs --list             # show recent bundles

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
function arg(name) {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return undefined
  const v = args[i + 1]
  return v && !v.startsWith('--') ? v : true
}
const TO   = arg('to')
const OFF  = !!arg('off')
const LIST = !!arg('list')
function die(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1) }
if (!TO && !OFF && !LIST) die('usage: --to <version> | --off | --list')

function loadDotEnv() {
  const p = resolve(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadDotEnv()
const DATABASE_URL = process.env.DATABASE_URL || die('DATABASE_URL missing (repo .env)')

const APP_ID  = 'com.openscaffoldlabs.thematch'
const CHANNEL = 'production'

const { Client } = require_('pg')
const client = new Client({ connectionString: DATABASE_URL })
await client.connect()
try {
  if (LIST) {
    const { rows } = await client.query(
      `SELECT version, active, min_native_version, created_at, notes
         FROM tm_ota_bundles WHERE app_id = $1 AND channel = $2
        ORDER BY created_at DESC LIMIT 15`,
      [APP_ID, CHANNEL]
    )
    console.table(rows)
  } else if (OFF) {
    await client.query('BEGIN')
    const r = await client.query(
      `UPDATE tm_ota_bundles SET active = false WHERE app_id = $1 AND channel = $2 AND active`,
      [APP_ID, CHANNEL]
    )
    await client.query('COMMIT')
    console.log(`✔ deactivated ${r.rowCount} bundle(s) — endpoint now serves 'no active bundle'.`)
  } else {
    await client.query('BEGIN')
    const target = await client.query(
      `SELECT id FROM tm_ota_bundles WHERE app_id = $1 AND channel = $2 AND version = $3`,
      [APP_ID, CHANNEL, TO]
    )
    if (!target.rows[0]) { await client.query('ROLLBACK'); die(`version ${TO} not found on ${CHANNEL}`) }
    await client.query(
      `UPDATE tm_ota_bundles SET active = false WHERE app_id = $1 AND channel = $2 AND active`,
      [APP_ID, CHANNEL]
    )
    await client.query(
      `UPDATE tm_ota_bundles SET active = true WHERE id = $1`,
      [target.rows[0].id]
    )
    await client.query('COMMIT')
    console.log(`✔ active bundle is now v${TO}. Devices on newer/bad bundles stay put until you publish a fixed higher version.`)
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  die(e.message)
} finally {
  await client.end()
}
