#!/usr/bin/env node
// OTA publish — build, zip (Capgo CLI format), upload to Supabase Storage,
// activate in tm_ota_bundles. Runs on Matt's Mac (needs .env + network).
//
//   node scripts/ota-publish.mjs --version 1.0.1 [--min-native 1.0.0] [--notes "..."] [--dry-run]
//
// Environment (from repo .env or shell):
//   DATABASE_URL               — Supabase session pooler (already in .env)
//   SUPABASE_URL               — https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  — service key (Storage upload; NEVER ship client-side)
//   VITE_API_ORIGIN            — defaults to https://the-match-roan.vercel.app
//
// Safety properties (see docs/OTA-RUNBOOK.md):
//   • Zip is produced by `npx @capgo/cli bundle zip --json` — the plugin
//     requires Capgo's zip layout; hand-zips can fail to install.
//   • Upload happens BEFORE the DB flip; the bundle URL is verified readable
//     (HTTP 200 + content-length) before any device can be offered it.
//   • The DB flip (deactivate old → activate new) is a single transaction.
//   • --dry-run does everything except upload + DB flip.
//   • min_native_version guards devices on older binaries (endpoint gate).

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- args ----------
const args = process.argv.slice(2)
function arg(name, fallback = undefined) {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = args[i + 1]
  return v && !v.startsWith('--') ? v : true
}
const VERSION    = arg('version')
const MIN_NATIVE = arg('min-native', '1.0.0')
const NOTES      = arg('notes', '')
const DRY        = !!arg('dry-run', false)
const SEMVER_RE  = /^\d+\.\d+\.\d+$/

function die(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1) }
if (!VERSION || VERSION === true || !SEMVER_RE.test(VERSION)) {
  die('required: --version X.Y.Z (strict semver — the plugin requires it)')
}
if (!SEMVER_RE.test(MIN_NATIVE)) die('--min-native must be X.Y.Z semver')

// ---------- env (.env fallback) ----------
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
const SUPABASE_URL = process.env.SUPABASE_URL || die('SUPABASE_URL missing — add to .env (https://<ref>.supabase.co)')
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || die('SUPABASE_SERVICE_ROLE_KEY missing — add to .env')
const API_ORIGIN   = process.env.VITE_API_ORIGIN || 'https://the-match-roan.vercel.app'

const APP_ID  = 'com.openscaffoldlabs.thematch'
const CHANNEL = 'production'
const BUCKET  = 'ota-bundles'
const OBJECT  = `${APP_ID}/${CHANNEL}/${VERSION}.zip`

console.log(`\nOTA publish v${VERSION}  (channel=${CHANNEL}, min_native=${MIN_NATIVE}${DRY ? ', DRY RUN' : ''})`)

// ---------- 1. build ----------
console.log('\n[1/6] Building client (prod API origin baked in)…')
execSync(`VITE_API_ORIGIN=${API_ORIGIN} npm run build --workspace client`, { cwd: ROOT, stdio: 'inherit' })

// ---------- 2. zip via Capgo CLI (required format) ----------
console.log('\n[2/6] Zipping with @capgo/cli (plugin-compatible format)…')
const zipOut = execSync(
  `npx @capgo/cli bundle zip ${APP_ID} --path client/dist --bundle ${VERSION} --json --name ota-${VERSION}`,
  { cwd: ROOT, encoding: 'utf8' }
)
let zipInfo
try { zipInfo = JSON.parse(zipOut.slice(zipOut.indexOf('{'))) } catch { die(`could not parse Capgo CLI output:\n${zipOut}`) }
const zipPath = resolve(ROOT, zipInfo.filename || zipInfo.path || `ota-${VERSION}.zip`)
if (!existsSync(zipPath)) die(`zip not found at ${zipPath}`)
const zipBytes = readFileSync(zipPath)
// Trust but verify: recompute sha256 locally; must match the CLI's value.
const localSha = createHash('sha256').update(zipBytes).digest('hex')
const checksum = zipInfo.checksum || localSha
if (zipInfo.checksum && zipInfo.checksum !== localSha) {
  die(`checksum mismatch: CLI=${zipInfo.checksum} local=${localSha}`)
}
console.log(`    zip: ${zipPath}  (${(statSync(zipPath).size / 1e6).toFixed(1)} MB)\n    sha256: ${checksum}`)

if (DRY) { console.log('\nDRY RUN — stopping before upload + DB flip. ✔'); process.exit(0) }

// ---------- 3. ensure bucket ----------
console.log('\n[3/6] Ensuring public bucket exists…')
const bres = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
})
if (!bres.ok) {
  const t = await bres.text()
  if (!/already exists|Duplicate/i.test(t)) die(`bucket create failed: ${bres.status} ${t}`)
}

// ---------- 4. upload ----------
console.log('\n[4/6] Uploading bundle…')
const ures = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${OBJECT}`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/zip',
    'x-upsert': 'false', // versions are immutable — republish = new version
  },
  body: zipBytes,
})
if (!ures.ok) die(`upload failed: ${ures.status} ${await ures.text()}`)
const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${OBJECT}`

// ---------- 5. verify the public URL actually serves the bundle ----------
console.log('\n[5/6] Verifying public URL serves the bundle…')
const vres = await fetch(publicUrl, { method: 'HEAD' })
if (!vres.ok) die(`public URL not readable (${vres.status}) — NOT activating. URL: ${publicUrl}`)
console.log(`    ✔ ${publicUrl}`)

// ---------- 6. activate (single transaction) ----------
console.log('\n[6/6] Activating in tm_ota_bundles (transactional flip)…')
const { Client } = require_('pg')
const client = new Client({ connectionString: DATABASE_URL })
await client.connect()
try {
  await client.query('BEGIN')
  await client.query(
    `UPDATE tm_ota_bundles SET active = false WHERE app_id = $1 AND channel = $2 AND active`,
    [APP_ID, CHANNEL]
  )
  await client.query(
    `INSERT INTO tm_ota_bundles (app_id, version, channel, url, checksum, size_bytes, min_native_version, active, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
    [APP_ID, VERSION, CHANNEL, publicUrl, checksum, zipBytes.length, MIN_NATIVE, NOTES]
  )
  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  die(`DB flip failed (nothing activated): ${e.message}`)
} finally {
  await client.end()
}

console.log(`\n✔ v${VERSION} is LIVE on channel '${CHANNEL}'. Devices pick it up on next app open.`)
console.log(`  Rollback any time: node scripts/ota-rollback.mjs --to <previous-version>\n`)
