// eslint.config.js  (ESM — project is "type": "module")
// NOTE: This file itself uses `export default []` — required by ESLint flat config.
// It falls outside both `files` scopes below and so is linted only by
// `js.configs.recommended`, which does not define `no-restricted-syntax`. The
// no-default-export rule is scoped to source files (app/**, worker/**, shared/**)
// — this config file is incidentally outside that scope, not explicitly excluded.
import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    // Scope to source files only — excludes eslint.config.js (root) and tests/scripts
    files: ['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js'],
    plugins: { jsdoc },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        { selector: 'CallExpression[callee.property.name="then"]', message: 'Use async/await instead of .then() chains.' },
        { selector: 'ExportDefaultDeclaration', message: 'Default exports forbidden. Use named exports (AD architecture convention).' },
        { selector: 'CallExpression[callee.object.object.name="process"][callee.object.property.name="stdout"][callee.property.name="write"]', message: 'process.stdout.write forbidden in source. Use the shared pino logger (shared/logger.js) per AD27.' },
        { selector: 'CallExpression[callee.object.object.name="process"][callee.object.property.name="stderr"][callee.property.name="write"]', message: 'process.stderr.write forbidden in source. Use the shared pino logger (shared/logger.js) per AD27.' },
      ],
      'jsdoc/require-jsdoc': ['error', { require: { FunctionDeclaration: false, ArrowFunctionExpression: false, FunctionExpression: false }, publicOnly: true }],
      'jsdoc/require-param': 'error',
      'jsdoc/require-returns': 'error',
    },
  },
  {
    // Test files and scripts — relax jsdoc + console rules
    files: ['tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'no-console': 'off',
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'no-useless-assignment': 'off',
    },
  },
  {
    // Public-facing browser scripts (Story 1.4+ — F9 defer-loaded page JS).
    // These run in the browser, not Node, so they need browser globals
    // (window, document, URLSearchParams, etc.) and don't share the
    // shared-pino-logger constraint that applies to server code.
    files: ['public/js/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'jsdoc/require-jsdoc': 'off',
      'no-console': 'off',
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
];
