// eslint.config.js  (ESM — project is "type": "module")
// NOTE: This file itself uses `export default []` — required by ESLint flat config.
// It falls outside both `files` scopes below and so is linted only by
// `js.configs.recommended`, which does not define `no-restricted-syntax`. The
// no-default-export rule is scoped to source files (app/**, worker/**, shared/**)
// — this config file is incidentally outside that scope, not explicitly excluded.
import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import noDirPgInApp from './eslint-rules/no-direct-pg-in-app.js';
import noRawInsertAuditLog from './eslint-rules/no-raw-INSERT-audit-log.js';
import noDirectFetch from './eslint-rules/no-direct-fetch.js';
import noRawCronStateUpdate from './eslint-rules/no-raw-cron-state-update.js';
import noFloatPrice from './eslint-rules/no-float-price.js';

export default [
  {
    // Exclude .claude/ tooling scripts — not part of the project's source or test
    // surface. These files have no languageOptions globals block and trip no-undef
    // for Node built-ins (console, process) when linted under js.configs.recommended.
    ignores: ['.claude/**'],
  },
  js.configs.recommended,
  {
    // Story 2.1: no-direct-pg-in-app rule — forbids direct pg Pool/Client import
    // or instantiation inside app/src/. Scoped to app/src only (NOT shared/db/,
    // worker/src/, or tests/). The SSoT modules in shared/db/ legitimately own
    // all raw pg access.
    files: ['app/src/**/*.js'],
    plugins: { 'no-direct-pg': noDirPgInApp },
    rules: {
      'no-direct-pg/no-direct-pg-in-app': 'error',
    },
  },
  {
    // Story 9.0: no-raw-INSERT-audit-log rule — forbids raw INSERT INTO audit_log
    // or Supabase .from('audit_log').insert(...) outside shared/audit/writer.js.
    // Scoped to production source code only (app/, worker/, shared/).
    // Tests are excluded: integration tests legitimately use raw SQL for fixture
    // setup and ATDD scaffolding. The allowlist (shared/audit/writer.js) is also
    // enforced inside the rule itself via context.filename.
    files: ['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js'],
    plugins: { 'no-raw-audit': noRawInsertAuditLog },
    rules: {
      'no-raw-audit/no-raw-INSERT-audit-log': 'error',
    },
  },
  {
    // Story 3.1: no-direct-fetch rule — forbids direct fetch() calls outside
    // shared/mirakl/. All Mirakl HTTP GET calls must flow through
    // shared/mirakl/api-client.js. PRI01 writes live in shared/mirakl/pri01-writer.js.
    // Scoped to app/, worker/, shared/ only — tests/ and scripts/ are excluded
    // (test files may mock fetch; scripts are operational utilities).
    //
    // eslint-rules/no-direct-fetch.js exports a plugin shape
    // (`{ rules: { 'no-direct-fetch': rule } }`) — registered the same way as
    // no-direct-pg-in-app.js (Story 2.1) and no-raw-INSERT-audit-log.js (Story 9.0).
    files: ['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js'],
    plugins: { 'no-direct-fetch': noDirectFetch },
    rules: {
      'no-direct-fetch/no-direct-fetch': 'error',
    },
  },
  {
    // Story 4.1: no-raw-cron-state-update rule — forbids raw SQL strings that mutate
    // customer_marketplaces.cron_state outside shared/state/cron-state.js SSoT.
    // All cron_state transitions MUST flow through transitionCronState() which enforces
    // validation, optimistic concurrency, and audit event emission (Bundle B atomicity).
    // Scoped to app/, worker/, shared/ production source (excludes tests/ and scripts/).
    // The SSoT module itself (shared/state/cron-state.js) is allowlisted inside the rule.
    files: ['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js'],
    plugins: { 'local-cron': noRawCronStateUpdate },
    rules: {
      'local-cron/no-raw-cron-state-update': 'error',
    },
  },
  {
    // Story 7.1: no-float-price rule — forbids float-price math patterns outside
    // shared/money/index.js (the SSoT for all price arithmetic).
    // Forbidden: .toFixed(2), parseFloat(), * 100, / 100 — use toCents/fromCents/
    // roundFloorCents/roundCeilingCents instead.
    // Architectural Constraint #22 (AD8 STEP 3).
    //
    // No `files` restriction — the rule applies globally to all .js files.
    // The SSoT allowlist (shared/money/index.js) is enforced inside the rule itself
    // via context.filename, not via ESLint glob scoping. This is intentional:
    // scoping by glob would prevent the rule from firing on temp files used by the
    // ESLint unit tests (tests/shared/money/index.test.js AC#6), which write temp
    // fixtures to os.tmpdir() — outside the app/worker/shared/ glob scope.
    plugins: { 'local-money': noFloatPrice },
    rules: {
      'local-money/no-float-price': 'error',
    },
  },
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
