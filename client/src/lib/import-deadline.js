// Bounded dynamic import.
//
// WHY THIS EXISTS (2026-08-08): in the Capacitor iOS shell, assets are served
// by a WKURLSchemeHandler at `capacitor://localhost`. When that handler cannot
// satisfy a request it is NOT obliged to fail it — it can simply never call
// back. A dynamic `import()` for such a chunk then never settles in EITHER
// direction: no module, no error, forever.
//
// This defeats every guard people naturally write around lazy imports:
//
//   try { mod = await import('x') } catch { fallback() }      // catch never runs
//   for (let i = 0; i < 4; i++) { try { ... } catch { retry } } // loop never advances
//
// Both patterns shipped in this codebase and both were silently dead:
//   • lib/geolocation.js  — import('@capacitor/geolocation') hung, so GPS never
//     started and no error surfaced (four OTA bundles chasing it; the real
//     symptom was a promise chain that never began). Fixed by importing that
//     plugin statically — it's tiny.
//   • pages/HoleMapGL.jsx — importMaplibre() wrapped `await import('maplibre-gl')`
//     in a 4-try retry loop, so a hang meant the retries never ran, onInitError()
//     was never called, and the Leaflet fallback never engaged. The hole map sat
//     as an empty green rectangle. maplibre-gl is ~1MB, so it must STAY lazy —
//     hence this helper rather than another static import.
//
// A hang is now indistinguishable from a rejection to the caller, which is what
// every one of those fallback paths was already written to handle correctly.
//
// RULE: never `await import(...)` directly in this app. Route it through here.

export class ImportTimeoutError extends Error {
  constructor(label, ms) {
    super(`dynamic import of ${label} did not settle in ${ms}ms`)
    this.name = 'ImportTimeoutError'
    this.importTimeout = true
  }
}

// `load` is a thunk returning the import promise, e.g. () => import('maplibre-gl').
// Rejects with ImportTimeoutError if it hasn't settled inside `ms`.
export function importWithDeadline(load, ms, label) {
  return new Promise((resolve, reject) => {
    let settled = false
    const t = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new ImportTimeoutError(label, ms))
    }, ms)
    let p
    try { p = load() } catch (e) { clearTimeout(t); settled = true; reject(e); return }
    Promise.resolve(p).then(
      v => { if (settled) return; settled = true; clearTimeout(t); resolve(v) },
      e => { if (settled) return; settled = true; clearTimeout(t); reject(e) },
    )
  })
}
