import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// External URLs in source are how "phone home" code starts. Only XML namespace
// identifiers and loopback/IPC origins may appear; anything else needs review.
const EXTERNAL_URL = String.raw`/(https?|wss?):\/\/(?!www\.w3\.org\/|127\.0\.0\.1|(ipc|asset|tauri)\.localhost)/`;

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/sheet-dist/**',
      '**/demo-dist/**',
      '**/target/**',
      '**/gen/**',
      'test-results/**',
      'playwright-report/**',
      'packages/brand/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${EXTERNAL_URL}]`,
          message: 'External URL in source: EVACTIS 3DWORKFLOW must not contact the network.',
        },
        {
          selector: `TemplateElement[value.raw=${EXTERNAL_URL}]`,
          message: 'External URL in source: EVACTIS 3DWORKFLOW must not contact the network.',
        },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
    },
  },
  {
    // Tests deliberately use external URLs to prove they are refused.
    files: ['e2e/**', '**/test/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
