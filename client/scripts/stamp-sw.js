// Stamp the built service worker with a unique per-deploy id so its bytes
// change every deploy. Vite copies public/sw.js → dist/sw.js verbatim; this
// postbuild step rewrites the `__SW_BUILD__` token in the DIST copy (never the
// source, to avoid git churn) with the Vercel commit SHA, or a timestamp
// locally. A changed sw.js is what makes the browser register a new SW, run
// its activate handler (cache sweep + reload broadcast), and pull the fresh
// bundle — fixing installed PWAs that were stuck on a stale build.
// Best-effort: never fail the build over this.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const swPath = new URL('../dist/sw.js', import.meta.url)
const id = process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now())

try {
  if (!existsSync(swPath)) {
    console.warn('[stamp-sw] dist/sw.js not found — skipping (build still OK)')
    process.exit(0)
  }
  const src = readFileSync(swPath, 'utf8')
  const token = "self.SW_BUILD = '__SW_BUILD__'"
  if (!src.includes(token)) {
    console.warn('[stamp-sw] SW_BUILD token not found in dist/sw.js — skipping')
    process.exit(0)
  }
  writeFileSync(swPath, src.replace(token, `self.SW_BUILD = '${id}'`))
  console.log('[stamp-sw] sw.js build id =', id)
} catch (e) {
  console.warn('[stamp-sw] non-fatal:', e?.message)
  process.exit(0)
}
