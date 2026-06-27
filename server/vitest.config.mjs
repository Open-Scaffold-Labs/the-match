import { defineConfig } from 'vitest/config'

// Track F.4 / F.12 (audit N8/N11): scope vitest to the real suites only.
// The `*.test.cjs` / `*.test.mjs` files in this repo are hand-rolled
// bare-assert scripts (no describe/it) designed to run directly via
// `node --test` (and that's how CI runs them). Vitest errors on those with
// "No test suite found", so we restrict vitest's include to the proper
// vitest suites (currently server/test/user-shape.test.js). When a new file
// is written as a real vitest suite, name it `*.test.js` and it's picked up.
export default defineConfig({
  test: {
    include: ['**/*.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
