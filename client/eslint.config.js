// Minimal lint gate — its job is to catch the class of bug that shipped a
// ReferenceError ('estimateAltFromPressure' was server-only) to the beta on
// 2026-06-06: an identifier that isn't defined or imported in the module.
// A clean `vite build` does NOT catch that — only a no-undef check does.
//
// Deliberately scoped: `no-undef` is the only ERROR. Style/unused/hooks rules
// are off so this gate is about runtime-validity, not a style crusade on a
// codebase that was never linted. Run with `npm run lint` before pushing.
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
// jsx-no-undef (2026-07-07 re-land): `no-undef` does NOT flag JSX component
// references — that gap shipped the PuttChips crash on 2026-07-06 (clean
// build + clean lint, ReferenceError on device). This rule closes the JSX
// half. NOTE: the plugin declares peer eslint <=9.7 (no eslint-10 release
// exists as of 2026-07-07); the committed .npmrc's legacy-peer-deps handles
// resolution, and onnxruntime-web is pinned as a direct client dep because
// legacy mode does not auto-install peers (the exact mechanism that dropped
// it and broke Vercel builds on the first landing attempt).
import react from 'eslint-plugin-react'

export default [
  {
    files: ['src/**/*.{js,jsx,mjs}'],
    // Existing code carries `// eslint-disable-next-line react-hooks/...`
    // comments; loading the plugin makes those rules resolvable, and we don't
    // want to error on the now-unused directives either.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021, ...globals.serviceworker },
    },
    plugins: { 'react-hooks': reactHooks, react },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      // TDZ gate (2026-07-10): a useEffect dep array referencing a const
      // declared LATER in the component body is evaluated synchronously at
      // render → "Cannot access 'X' before initialization" on device, while
      // build AND the two rules above stay clean (shipped as the 'vt' crash,
      // P2-F nudge effect vs showStart; same class as the documented
      // loadOuting TDZ trip, 2026-05-02). variables-only: hoisted function
      // declarations and class refs stay legal, matching codebase style.
      'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
    },
  },
  {
    // Test files run in Node (they use process.exit), not the browser.
    files: ['src/**/*.test.mjs', 'src/**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },
]
