// Tiny logger — gates debug output behind Vite's import.meta.env.DEV flag.
// `log` and `warn` are silent in production; `error` always surfaces (so
// future error-monitoring like Sentry can hook into it without missing
// signal). Import directly: `import { log, warn, error } from '../lib/logger'`.
//
// Replaced 50+ console.* calls across the client (mostly Eagle Eye OSM
// debug) on 2026-04-29 — see audit-2026-04-29.md entry B7.
const isDev = import.meta.env?.DEV ?? false

export const log   = isDev ? console.log.bind(console)   : () => {}
export const warn  = isDev ? console.warn.bind(console)  : () => {}
export const error = console.error.bind(console)
