import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['public/lang.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['*.config.{js,ts}', 'tests/**/*.ts', 'build/**/*.ts', 'scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
  },
);
