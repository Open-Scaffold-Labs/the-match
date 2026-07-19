// SINGLE SOURCE OF TRUTH — the deployed backend origin, plus the pure rule for
// resolving which origin a given build should call.
//
// Why this file exists (2026-07-17): a native TestFlight build shipped with NO
// API origin, because the origin came only from a build-time env var
// (VITE_API_ORIGIN) that lived in one person's shell. Every backend call —
// sign-in included — resolved against capacitor://localhost and died with
// "the string does not match the expected pattern." The value was ALSO
// hardcoded separately in api.js, capacitor.config.json and ota-publish.mjs.
// One value, four copies, no guard: exactly the shape of the -71 bug (one
// number, four reader implementations). So: one value, one place.
//
// Three consumers ship this origin and cannot all import each other:
//   • client/src/lib/api.js        — runtime origin for the native shell (imports this)
//   • scripts/ota-publish.mjs      — VITE_API_ORIGIN baked into OTA bundles (imports this)
//   • client/capacitor.config.json — OTA updateUrl/statsUrl (static JSON — CANNOT import)
// The JSON is pinned instead by __tests__/backend-origin.test.mjs, so drift is
// a failing test rather than a production outage.
//
// Plain ESM only (no import.meta.env, no Vite-isms) so plain `node` can import
// it from scripts/ and from the test runner.

export const BACKEND_ORIGIN = 'https://the-match-roan.vercel.app'

/**
 * Decide which origin API calls should target. PURE — no globals, no env
 * access — so it is fully unit-testable outside a browser/Vite context.
 *
 * Rules, in order:
 *   1. An explicit build-time origin (VITE_API_ORIGIN) always wins — staging,
 *      local backends, preview deploys.
 *   2. A NATIVE build with no explicit origin falls back to BACKEND_ORIGIN.
 *      The native webview's own origin (capacitor://localhost) can never reach
 *      the API, so an empty origin there is ALWAYS a bug — never a valid state.
 *   3. A WEB build falls back to '' → same-origin relative calls, which is
 *      correct and byte-for-byte the historical behavior.
 *
 * Trailing slashes are stripped so callers can concatenate "/api/…" safely.
 *
 * @param {{ envOrigin?: string, isNative?: boolean }} opts
 * @returns {string} absolute origin, or '' for same-origin web builds
 */
export function resolveApiOrigin({ envOrigin, isNative } = {}) {
  const explicit = typeof envOrigin === 'string' ? envOrigin.trim() : ''
  const chosen = explicit || (isNative ? BACKEND_ORIGIN : '')
  return chosen.replace(/\/+$/, '')
}
