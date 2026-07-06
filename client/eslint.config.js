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
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-undef': 'error',
    },
  },
  {
    // Test files run in Node (they use process.exit), not the browser.
    files: ['src/**/*.test.mjs', 'src/**/*.test.js'],
    languageOptions: { globals: { ...globals.node } },
  },
]
