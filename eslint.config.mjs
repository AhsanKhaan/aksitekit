import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import regexp from 'eslint-plugin-regexp';

// Security rules every project keeps (docs/TODO-step-c.md §1).
// eslint-config-next sets browser and Node globals for every file, scripts included.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  noUnsanitized.configs.recommended, // innerHTML, insertAdjacentHTML, document.write
  regexp.configs['flat/recommended'], // unsafe or inefficient regular expressions
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'react/no-danger': 'error', // dangerouslySetInnerHTML only in components/JsonLd.tsx (below)
      'react/jsx-no-script-url': 'error',
      'react/jsx-no-target-blank': ['error', { allowReferrer: false }],
      'no-console': ['warn', { allow: ['error'] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^(pushState|replaceState)$/]',
          message: 'No history changes on input (back-button hijacking).',
        },
      ],
    },
  },
  {
    files: ['components/tools/**', 'lib/tools/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Tools compute in the browser and make no network calls.' },
        { name: 'XMLHttpRequest', message: 'Tools compute in the browser and make no network calls.' },
      ],
    },
  },
  {
    files: ['components/JsonLd.tsx'], // the one allowed exception: serializeJsonLd() escapes "<"
    rules: { 'react/no-danger': 'off' },
  },
  {
    // Node scripts: the gates, the workflow helpers (.github/README.md: ESLint covers .github/scripts) and the hooks.
    // Config files by script extension only: ESLint 10 lints every file a `files` pattern names, factory.config.json too.
    files: ['scripts/**/*.mjs', '.github/scripts/**/*.mjs', '.claude/**/*.mjs', '*.config.{js,mjs,cjs,ts,mts,cts}'],
    rules: { 'no-console': 'off' },
  },
  // .claude/worktrees/ holds other sessions' git worktrees (full copies of the repo); vendor/skills/ holds reviewed
  // third-party files that are never edited (npm run check:skills).
  globalIgnores(['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts', 'test-results/**', 'playwright-report/**', '.lighthouseci/**', 'coverage/**', 'docs/**', '.claude/worktrees/**', 'vendor/skills/**', 'public/**']),
]);
