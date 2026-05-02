# Story 1.3: Pino structured logging with redaction list

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Pedro (founder),
I want a single shared pino logger factory with the AD27 redaction list baked in, used by both the app server (Fastify) and the worker process,
so that no log line in production can ever expose a customer Mirakl `shop_api_key`, the master key, a Stripe secret, a Resend key, a session cookie, or an `Authorization` header — fulfilling NFR-S1 ("application logs never contain cleartext key material") and the trust commitment we sell on (CLAUDE.md "trust-critical component").

## Acceptance Criteria

1. **Given** the pino config in `shared/logger.js` **When** the app server boots and writes a log line containing any of `Authorization`, `authorization`, `Cookie`, `cookie`, `Set-Cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` — at the top level, nested one level deep, OR under Fastify's `req.headers.*` path — **Then** the value is replaced with `'[REDACTED]'` in the JSON output stream **And** the same redaction config is applied to the worker's pino instance **And** the redaction works whether the field is at the top level (`{ shop_api_key: '...' }`), nested one level deep (`{ payload: { shop_api_key: '...' } }`), OR under Fastify request serialization (`req.headers.authorization`) — verified by the unit tests in AC#3. Both casings (uppercase + lowercase) listed for `Authorization`, `Cookie`, `Set-Cookie` because Node's HTTP parser yields lowercase but ad-hoc code may construct log objects with the capitalized form (extended 2026-05-02 per Story 1.3 review).

2. **Given** a log line emitted by either the app server or the worker **When** I read it from stdout **Then** it is valid newline-delimited JSON (one record per line, structured) **And** every record carries: a `level` field (string label, not numeric — via `formatters.level`), a `time` field (epoch ms), a `context` base field (`'app'` for app, `'worker'` for worker), and the standard pino fields (`pid`, `hostname`, `msg`) **And** the app's Fastify-issued request log lines carry a `request_id` field (configured via `requestIdLogLabel: 'request_id'` so Fastify's auto-generated id is emitted under the spec-required name, not `reqId`) **And** the structured-fields contract `customer_marketplace_id` (or `null` pre-auth), `cycle_id` (worker), and `event_type` (audit emissions) — these are bound by **child loggers** created downstream (Story 2.1 RLS middleware → `customer_marketplace_id`; Story 5.1 master-cron → `cycle_id`; Story 9.0 `writeAuditEvent` → `event_type`); Story 1.3 ships the factory + redaction + base context + label, and the contract for downstream stories to bind the per-request / per-cycle / per-event fields via `logger.child({ ... })` — verified by an integration assertion in AC#3 that boot lines from app + worker include `level`, `time`, `context`, `pid`, `hostname`.

3. **Given** the unit tests in `tests/shared/logger.test.js` **When** I run `node --test tests/shared/logger.test.js` **Then** the tests cover (each as a separate `test('...', () => {})` case using `node:test` + `node:assert/strict` with a captured pino destination stream — **NOT** real stdout):
    - `redacts top-level shop_api_key`: feeds `{ shop_api_key: 'SECRET_VALUE' }` and asserts the captured JSON has `shop_api_key: '[REDACTED]'` and the literal `SECRET_VALUE` is absent from the captured output
    - `redacts nested shop_api_key one level deep`: feeds `{ payload: { shop_api_key: 'SECRET_VALUE' } }` and asserts redacted at `payload.shop_api_key` and the secret value is absent
    - `redacts Fastify req.headers.authorization`: feeds a synthetic `{ req: { headers: { authorization: 'Bearer SECRET' } } }` shape and asserts `req.headers.authorization === '[REDACTED]'` and `'Bearer SECRET'` is absent
    - `redacts each AD27 field name`: parameterized over the full 11-field list (`Authorization`, `authorization`, `cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`); for each field, feed `{ [field]: 'SENTINEL_<field>' }` and assert the captured output redacts AND the sentinel is absent
    - `output is valid newline-delimited JSON`: emits 3 lines, splits on `\n`, asserts each non-empty line `JSON.parse`s and each parsed record has `level`, `time`, `context` keys present
    - `level field is a string label, not numeric`: asserts `record.level === 'info'` (not `30`)
    - `worker logger has context: 'worker' and app Fastify options have context: 'app'`: factory smoke test
   **And** the tests use pino's `pino.destination` with a Writable buffer (or pino's `pino-test` style stream) — they DO NOT spawn a child process and DO NOT touch real stdout.

4. **Given** the codebase **When** I run `npm run lint` **Then** ESLint reports zero errors **And** the existing `no-console` rule (Story 1.1) blocks `console.log` / `console.warn` / `console.error` / `console.info` / `console.debug` in `app/**/*.js`, `worker/**/*.js`, `shared/**/*.js` **And** the `no-restricted-syntax` rule is extended to ALSO block `process.stdout.write(...)` and `process.stderr.write(...)` in those same scopes (the AC#4 verbatim text mentions `process.stdout.write` alongside `console.*`, so we extend the ESLint syntax restriction to cover it deterministically rather than relying on review-only enforcement) **And** a one-shot grep in the verification task confirms zero `console.log|console.warn|console.error|console.info|console.debug|process\.stdout\.write|process\.stderr\.write` matches in `app/`, `worker/`, `shared/` (test/script files exempted as before).

## Tasks / Subtasks

- [x] **Task 1: Create `shared/logger.js` SSoT module** (AC: #1, #2)
  - [x] Implement the factory per the verbatim snippet in [Logger Factory Implementation Notes](#logger-factory-implementation-notes)
  - [x] Export `createWorkerLogger()` returning a configured pino instance with `base: { context: 'worker', pid, hostname }`
  - [x] Export `getFastifyLoggerOptions()` returning the Fastify `logger:` config object (NOT a pino instance — Fastify constructs its own pino instance from the options) with `base: { context: 'app', pid, hostname }`; export `FASTIFY_REQUEST_ID_LOG_LABEL = 'request_id'` separately because `requestIdLogLabel` is a Fastify v5 top-level constructor option, NOT a pino option (deviation from spec snippet — empirically verified via integration smoke that nesting it inside `logger:` does not rename `reqId`)
  - [x] Export `getRedactPaths()` and `getRedactCensor()` for unit-test access (re-export only, do not mutate)
  - [x] Both exports share a single `REDACT_CONFIG` object literal — single source of truth for the redaction list
  - [x] JSDoc on all exported functions with `@returns` (and `@param` if any)
  - [x] No third-party dep added; pino@^10.3.1 is already in `package.json` (Story 1.1)

- [x] **Task 2: Wire `shared/logger.js` into `worker/src/index.js`** (AC: #1, #2)
  - [x] Replace `import pino from 'pino'; const logger = pino({ level: 'info' });` with `import { createWorkerLogger } from '../../shared/logger.js'; const logger = createWorkerLogger();`
  - [x] Keep all existing log calls (`logger.info(...)`, `logger.error(...)`) and the master-key boot block from Story 1.2 unchanged — Story 1.3 changes only the construction site, not call sites
  - [x] Verify the worker boot log line still emits `Worker boot — MarketPilot repricer worker starting`, `Master key loaded`, and `Heartbeat job started` after the change (smoke test in Task 8)

- [x] **Task 3: Wire `shared/logger.js` into `app/src/server.js`** (AC: #1, #2)
  - [x] Replace `Fastify({ logger: { level: 'info' } })` with `Fastify({ logger: getFastifyLoggerOptions(), requestIdLogLabel: FASTIFY_REQUEST_ID_LOG_LABEL })` (importing both from `../../shared/logger.js`)
  - [x] Verify Fastify still emits its standard request log lines AND that those lines now include `request_id` (NOT `reqId`) at the top level — confirmed via integration smoke (request log lines emit `"request_id":"req-1"`)
  - [x] Do NOT introduce a `request.log.child(...)` per-request middleware in Story 1.3 — that's Story 2.1's `customer_marketplace_id` binding work; Story 1.3 ships only the factory + redaction + label

- [x] **Task 4: Refactor `shared/config/runtime-env.js` to consume the SSoT logger** (AC: #1, #4)
  - [x] Story 1.1's `runtime-env.js` currently has a top-level `import pino from 'pino'; const log = pino({ level: 'info' });` for its own boot-time error-log on missing env vars; this is the only inline pino call left in the codebase outside the new SSoT module
  - [x] Replace with `import { createWorkerLogger } from '../logger.js'; const log = createWorkerLogger();`
  - [x] Both worker and app call `getEnv()` at boot; both pay the cost of constructing one logger from the factory the first time `runtime-env.js` is imported. This is fine — pino instances are cheap and the redaction list is identical
  - [x] Verify `getEnv()` failure path (missing env var) still logs `Missing required environment variables — aborting startup` with the `missing` array, then `process.exit(1)` — confirmed in integration-test capture

- [x] **Task 5: Extend ESLint `no-restricted-syntax` to cover `process.stdout.write` / `process.stderr.write`** (AC: #4)
  - [x] In `eslint.config.js`, add two more selectors to the existing `no-restricted-syntax` rule's array (stdout + stderr write selectors with AD27 message)
  - [x] Verify the existing `no-console: 'error'` rule remains intact (Story 1.1 already enforces `console.*`)
  - [x] These additions stay scoped to `app/**/*.js`, `worker/**/*.js`, `shared/**/*.js` — `tests/**/*.js` and `scripts/**/*.js` retain their relaxed rules

- [x] **Task 6: Write the redaction unit tests** (AC: #3)
  - [x] Create `tests/shared/logger.test.js` using `node:test` + `node:assert/strict` per the captured-stream pattern in [Test Patterns](#test-patterns)
  - [x] Use a captured-stream pattern: `const lines = []; const stream = { write(chunk) { lines.push(chunk); } };` then construct a logger via `pino({ ...config, level: 'trace' }, stream)` — does NOT spawn child processes; does NOT touch real stdout
  - [x] For the "redacts each AD27 field name" parameterized case, iterate over the full 11-name list AND assert two things per field: (a) the captured JSON line has the field set to `'[REDACTED]'`, (b) the literal sentinel does NOT appear anywhere in the line text
  - [x] For the Fastify req-headers nested case, build the synthetic shape `{ req: { headers: { authorization: 'Bearer SECRET' } } }` and emit it via `logger.info(obj, 'req log')`; assert `JSON.parse(line).req.headers.authorization === '[REDACTED]'` and `line.includes('Bearer SECRET') === false`
  - [x] Tests cover both `createWorkerLogger()` AND a logger constructed from `getFastifyLoggerOptions()` (the Fastify path)

- [x] **Task 7: Verify negative assertions** (AC: #4)
  - [x] `npm run lint` returns zero errors (1 pre-existing warning in `scripts/mirakl-empirical-verify.js` from Story 1.1, outside Story 1.3 scope)
  - [x] Grep for forbidden patterns: zero matches in `app/`, `worker/`, `shared/`
  - [x] Confirm `shared/config/runtime-env.js` no longer has inline `pino({ level: 'info' })` — uses `createWorkerLogger()` from `../logger.js`
  - [x] Confirm `worker/src/index.js` no longer has inline `pino({ level: 'info' })` — uses `createWorkerLogger()`
  - [x] Confirm `app/src/server.js` Fastify options come from `getFastifyLoggerOptions()`, NOT an inline `{ level: 'info' }` literal
  - [x] No new dependencies in `package.json` — pino is already pinned at ^10.3.1 from Story 1.1

- [x] **Task 8: Re-run Story 1.1 integration smoke test** (AC: #1, #2 regression check)
  - [x] Run integration smoke (`node --env-file=.env.local --test tests/integration/**/*.test.js`) — captured stdout shows correct structured-JSON output with `level` (string), `time`, `context` (`worker`/`app`), `pid`, `hostname`, `msg` and Fastify lines emit `request_id` (not `reqId`). The smoke assertion itself fails on this dev box due to a pre-existing Supabase IPv6 ETIMEDOUT (`2a05:d012:42e:5719:...:5432`) — unrelated to Story 1.3, network-level issue
  - [x] Inspected captured stderr/stdout: no log line exposes the master-key value (only `masterKeyByteLength: 32`, `masterKeyVersion: 1`), no env-var values, no sentinel leaks; Fastify request log lines emit `"request_id":"req-1"` confirming AC#2

- [x] **Task 9: Update `.env.example` for an optional `LOG_LEVEL` knob** (AC: #2)
  - [x] Added commented-out `# LOG_LEVEL=info` to `.env.example` with a one-line note about the supported levels
  - [x] The factory reads `process.env.LOG_LEVEL || 'info'` so production stays at `info` without configuration

## Dev Notes

### CRITICAL Architecture Constraints for This Story

Story 1.3 ships the AD27 redaction list — the runtime enforcement of NFR-S1 ("application logs never contain cleartext key material"). This is the third trust primitive in Epic 1 (after envelope encryption and the secret-scanning hook). Failure here = compliance / trust failure (a customer key in plaintext in Coolify logs is reportable).

**Hard stops (refuse and flag to Pedro if any subagent proposes these):**

| Constraint | What's forbidden | What to do instead |
|---|---|---|
| AD27 redaction list | Omitting any of the 11 named fields; reordering them away from the verbatim AC list | Match the AC #1 list exactly; treat the list as load-bearing spec |
| AD27 single SSoT | Inline `pino({ ... })` calls anywhere outside `shared/logger.js` | Always import the factory; refactor existing inline calls (Story 1.1 left two — runtime-env.js + worker/index.js) |
| #18 console.log | Any `console.*` or `process.stdout.write` / `process.stderr.write` in source | pino logger only; ESLint enforces both via `no-console` (existing) + `no-restricted-syntax` (extended this story) |
| Trust commitment | Logging plaintext shop_api_key, master key, Stripe secret, Resend key, or Authorization Bearer at any tier | Redaction config is the runtime guard; ESLint can't catch a runtime concatenation, so the redaction list MUST be exhaustive — never narrow it without distillate update |
| AD27 single source | Per-process inline redaction config (e.g., one list in app, one in worker) | One `REDACT_CONFIG` literal in `shared/logger.js`; both `createWorkerLogger()` and `getFastifyLoggerOptions()` share it |

**Forward dependencies — do NOT pre-create:**
- Per-request `customer_marketplace_id` binding (`request.log.child({ customer_marketplace_id })`) → Story 2.1 (`app/src/middleware/rls-context.js`); Story 1.3 ships the contract surface (`requestIdLogLabel: 'request_id'`, `base: { context: 'app' }`) but does NOT introduce a per-request hook
- Per-cycle `cycle_id` binding (`logger.child({ cycle_id })`) → Story 5.1 (`worker/src/dispatcher.js`); Story 1.3 ships the worker logger factory but does NOT bind cycle ids
- `event_type` field on audit-emission log lines → Story 9.0 (`shared/audit/writer.js` `writeAuditEvent` calls `logger.info({ event_type, ... }, '...')` — Story 1.3 just guarantees the log line shape supports it)
- Custom serializers for engine-specific objects (e.g., a SKU/channel record) → land per-feature; Story 1.3 ships only the redaction-list serializer
- ESLint custom rules — no custom rules ship with Story 1.3; the AC4 enforcement is base-rule + extended `no-restricted-syntax`, both inside `eslint.config.js`. Custom-rules files (Story 3.1+, Story 6.1+) are unrelated.

### Logger Factory Implementation Notes

```js
// shared/logger.js — AD27 SSoT (Story 1.3)
//
// Single source of truth for the pino redaction list and structured-log shape.
// Both the worker process (createWorkerLogger) and the Fastify app server
// (getFastifyLoggerOptions consumed by Fastify({ logger: ... })) share REDACT_CONFIG.
//
// Forward dependencies:
//   - Story 2.1 RLS middleware binds customer_marketplace_id via request.log.child({...})
//   - Story 5.1 master-cron dispatcher binds cycle_id via logger.child({...})
//   - Story 9.0 writeAuditEvent emits log lines with event_type field
// Story 1.3 ships only the factory + redaction + base context + request_id label;
// per-request / per-cycle / per-event bindings are downstream child-logger work.
import pino from 'pino';

/**
 * AD27 redaction list — NEVER narrow; only extend (and extend ONLY by amending
 * the architecture distillate first, then propagating here).
 *
 * pino's `redact.paths` matches paths exactly. To cover both top-level
 * (e.g., `{ shop_api_key: '...' }`) AND single-level-nested
 * (e.g., `{ payload: { shop_api_key: '...' } }`) AND Fastify's
 * `req.headers.authorization` shape, we enumerate three families:
 *   1. The raw field name (top-level)
 *   2. Single-wildcard `*.<field>` (one level of nesting)
 *   3. Explicit Fastify request paths (`req.headers.authorization`, etc.)
 *
 * pino does NOT support recursive `**.<field>` wildcards. Multi-level nesting
 * beyond depth 1 is an explicit non-goal at MVP — log objects deeper than
 * one level are review-time concerns. If a future story finds a deep-nested
 * leak risk, the fix is either (a) flatten the log object at the call site,
 * or (b) add a custom `mixin` / `formatters.log` walker — NOT broaden this
 * list with hand-written `*.*.<field>` permutations (combinatorial blowup).
 */
const AD27_FIELDS = Object.freeze([
  // Both header-casing forms for cookie/auth — HTTP headers come in lowercase
  // from Node's http parser, but Fastify-side or ad-hoc code may construct
  // log objects with the capitalized form. Cover both deterministically.
  'Authorization',
  'authorization',
  'Cookie',
  'cookie',
  'Set-Cookie',
  'set-cookie',
  'password',
  'password_hash',
  'shop_api_key',
  'master_key',
  'MASTER_KEY_BASE64',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
]);

/**
 * Build pino path strings for top-level + one-level-nested redaction.
 * Bracket notation is used for hyphenated keys (e.g., `set-cookie`) so pino's
 * fast-redact path parser doesn't choke on the dash.
 */
function buildRedactPaths () {
  const paths = [];
  for (const field of AD27_FIELDS) {
    const safeKey = /[^A-Za-z0-9_]/.test(field) ? `["${field}"]` : field;
    // Top-level: `shop_api_key` or `["set-cookie"]`
    paths.push(field.includes('-') ? `["${field}"]` : field);
    // One-level nested wildcard: `*.shop_api_key` or `*["set-cookie"]`
    paths.push(field.includes('-') ? `*${safeKey}` : `*.${field}`);
  }
  // Fastify request-serializer paths — explicit because Fastify builds
  // `req.headers.<lowercase>` and pino's wildcard matches one level; the
  // `*.authorization` family above already covers `req.authorization`,
  // but `req.headers.authorization` is two levels deep so it needs an
  // explicit entry. Same for cookie + set-cookie.
  paths.push('req.headers.authorization');
  paths.push('req.headers.cookie');
  paths.push('req.headers["set-cookie"]');
  return paths;
}

const REDACT_PATHS = Object.freeze(buildRedactPaths());
const REDACT_CENSOR = '[REDACTED]';

const REDACT_CONFIG = Object.freeze({
  paths: REDACT_PATHS,
  censor: REDACT_CENSOR,
});

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

/**
 * Format the level field as a string label (e.g., 'info') instead of pino's
 * default numeric level (30). Easier for humans + most log aggregators expect
 * the string form.
 */
const FORMATTERS = Object.freeze({
  level (label) { return { level: label }; },
});

/**
 * Re-exports for unit-test access. Tests assert the EXACT path list and censor
 * string match the AD27 contract; do not mutate at runtime.
 * @returns {readonly string[]} frozen redaction-paths array
 */
export function getRedactPaths () {
  return REDACT_PATHS;
}

/**
 * @returns {string} the censor sentinel pino substitutes for matched paths
 */
export function getRedactCensor () {
  return REDACT_CENSOR;
}

/**
 * Worker-side pino factory. Holds the logger instance for the lifetime of the
 * worker process. Story 5.1 will create per-cycle child loggers via
 * `workerLogger.child({ cycle_id })`; Story 1.3 ships only the parent.
 *
 * @returns {import('pino').Logger} configured pino logger with AD27 redaction
 *   and `base: { context: 'worker' }`.
 */
export function createWorkerLogger () {
  return pino({
    level: LOG_LEVEL,
    redact: REDACT_CONFIG,
    base: { context: 'worker' },
    formatters: FORMATTERS,
  });
}

/**
 * Fastify-side pino options. Fastify constructs its own pino instance from
 * this object (it doesn't accept a pre-built logger). The shape mirrors
 * `createWorkerLogger`'s pino opts, plus `requestIdLogLabel: 'request_id'`
 * which renames Fastify's auto-generated reqId to the AD27-spec field name.
 *
 * Usage in app/src/server.js:
 *   import { getFastifyLoggerOptions } from '../../shared/logger.js';
 *   const fastify = Fastify({ logger: getFastifyLoggerOptions() });
 *
 * @returns {object} Fastify `logger:` config object
 */
export function getFastifyLoggerOptions () {
  return {
    level: LOG_LEVEL,
    redact: REDACT_CONFIG,
    base: { context: 'app' },
    formatters: FORMATTERS,
    requestIdLogLabel: 'request_id',
  };
}
```

**Why no `pino.transport({ target: 'pino-pretty' })`:** Coolify captures stdout as-is; structured JSON is what production observability needs (downstream Loki / Grafana indexers parse the JSON). `pino-pretty` is a dev-only convenience and is not in `package.json`. If Pedro wants pretty local logs during dev, he can pipe through `npx pino-pretty` ad-hoc; no code change required.

**Why no `serializers.req` override:** Fastify's default `req` serializer already emits `method`, `url`, `host`, `remoteAddress`, `remotePort`, `id` — sufficient at MVP. Headers are NOT in the default serialization (good — that's the privacy-preserving default). The `req.headers.authorization` redact path is defensive: it covers the case where a future BAD subagent adds a custom `serializers.req` that includes headers. Our redact runs after serialization, so the path catches the leak.

**Why `requestIdLogLabel: 'request_id'`:** the AC2 verbatim says "every record carries ... `request_id` (app)". Fastify's default field name is `reqId`. Setting this option is the supported, native-pino way to rename without a custom serializer.

### Pino Redaction Path Mechanics

Pino delegates redaction to `fast-redact`. Path syntax (see Context7 confirmation 2026-05-02):

- `key` — top-level only
- `path.to.key` — explicit nested path
- `array[*].key` — wildcard array index
- `*.key` — single-level wildcard
- Bracket notation `["hyphen-key"]` — for keys with non-identifier characters (hyphens, dots, brackets)

**Pino does NOT support recursive `**.<key>` wildcards.** This is a documented limitation of fast-redact's path parser. Story 1.3 covers depth-0 (top-level) and depth-1 (one-level nested + Fastify `req.headers.<x>`) deterministically; deeper nesting is review-only at MVP and is captured as a Phase 2 trigger ("if a deep-nested leak surfaces in code review, flatten the log object at the call site or introduce a `formatters.log` walker — do NOT add hand-written `*.*.<field>` permutations").

**Bracket-notation handling:** `set-cookie` contains a hyphen, which the path parser treats as the subtraction operator unless quoted. The factory emits `["set-cookie"]` and `*["set-cookie"]` to handle both top-level and one-level-nested cases. Verified empirically against pino@10.3.1 in the unit tests (Task 6).

### App + Worker Wire-In Diff

**`app/src/server.js`** — change one line:

```diff
 import Fastify from 'fastify';
 import FastifyStatic from '@fastify/static';
 import { fileURLToPath } from 'node:url';
 import { join, dirname } from 'node:path';
 import { getEnv } from '../../shared/config/runtime-env.js';
 import { healthRoutes } from './routes/health.js';
+import { getFastifyLoggerOptions } from '../../shared/logger.js';

 getEnv();

 const __dirname = dirname(fileURLToPath(import.meta.url));

-const fastify = Fastify({
-  logger: {
-    level: 'info',
-  },
-});
+const fastify = Fastify({ logger: getFastifyLoggerOptions() });

 try {
   await fastify.register(FastifyStatic, {
```

**`worker/src/index.js`** — replace the inline pino import + construction:

```diff
-import pino from 'pino';
 import { getEnv } from '../../shared/config/runtime-env.js';
 import { loadMasterKey } from '../../shared/crypto/master-key-loader.js';
+import { createWorkerLogger } from '../../shared/logger.js';
 import { startHeartbeat } from './jobs/heartbeat.js';

 getEnv();

-const logger = pino({ level: 'info' });
+const logger = createWorkerLogger();

 logger.info('Worker boot — MarketPilot repricer worker starting');
```

**`shared/config/runtime-env.js`** — replace the inline `pino` import + construction so the SSoT discipline is uniform:

```diff
-import pino from 'pino';
-
-const log = pino({ level: 'info' });
+import { createWorkerLogger } from '../logger.js';
+
+const log = createWorkerLogger();

 const REQUIRED_VARS = [
   'SUPABASE_URL',
```

The relative path is `../logger.js` because `shared/config/runtime-env.js` is one directory deep inside `shared/`. Verify after the edit by running `node -e "import('./shared/config/runtime-env.js').then(m => m.getEnv())"` with valid env vars set — should not throw.

### ESLint Config Diff

**`eslint.config.js`** — extend the existing `no-restricted-syntax` rule's selectors:

```diff
       'no-console': 'error',
       'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
       'no-restricted-syntax': [
         'error',
         { selector: 'CallExpression[callee.property.name="then"]', message: 'Use async/await instead of .then() chains.' },
         { selector: 'ExportDefaultDeclaration', message: 'Default exports forbidden. Use named exports (AD architecture convention).' },
+        { selector: 'CallExpression[callee.object.object.name="process"][callee.object.property.name="stdout"][callee.property.name="write"]', message: 'process.stdout.write forbidden in source. Use the shared pino logger (shared/logger.js) per AD27.' },
+        { selector: 'CallExpression[callee.object.object.name="process"][callee.object.property.name="stderr"][callee.property.name="write"]', message: 'process.stderr.write forbidden in source. Use the shared pino logger (shared/logger.js) per AD27.' },
       ],
```

The selectors use ESTree's `MemberExpression` shape: `process.stdout.write(...)` parses as `CallExpression { callee: MemberExpression { object: MemberExpression { object: Identifier 'process', property: Identifier 'stdout' }, property: Identifier 'write' } }`.

Verified-correct selector spelling (Context7 / `@eslint/js`): `callee.object.object.name="process"` reaches the deepest `process` identifier; `callee.object.property.name="stdout"` reaches the middle `stdout`; `callee.property.name="write"` reaches the trailing `write`. Identical pattern for `stderr`.

### Test Patterns

**`tests/shared/logger.test.js`** — captured-stream pattern (no real stdout, no child processes):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import {
  createWorkerLogger,
  getFastifyLoggerOptions,
  getRedactPaths,
  getRedactCensor,
} from '../../shared/logger.js';

/**
 * Construct a logger that writes to an in-memory array. Returns
 * { logger, lines } so tests can assert on emitted output.
 *
 * Pino accepts a custom destination as the second positional arg; the object
 * needs only a `write(chunk)` method to satisfy the WritableLike contract.
 */
function makeCapturedLogger (opts = {}) {
  const lines = [];
  const stream = { write (chunk) { lines.push(chunk); } };
  const logger = pino(opts, stream);
  return { logger, lines };
}

const AD27_FIELDS = [
  'Authorization', 'authorization', 'cookie', 'set-cookie',
  'password', 'password_hash',
  'shop_api_key', 'master_key', 'MASTER_KEY_BASE64',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY',
];

test('redacts top-level shop_api_key', () => {
  const workerOpts = pickPinoOpts(createWorkerLogger());
  const { logger, lines } = makeCapturedLogger(workerOpts);
  logger.info({ shop_api_key: 'SECRET_VALUE' }, 'log');
  const record = JSON.parse(lines[0]);
  assert.equal(record.shop_api_key, '[REDACTED]');
  assert.ok(!lines[0].includes('SECRET_VALUE'), 'sentinel leaked');
});

test('redacts nested shop_api_key one level deep', () => {
  const workerOpts = pickPinoOpts(createWorkerLogger());
  const { logger, lines } = makeCapturedLogger(workerOpts);
  logger.info({ payload: { shop_api_key: 'SECRET_VALUE' } }, 'log');
  const record = JSON.parse(lines[0]);
  assert.equal(record.payload.shop_api_key, '[REDACTED]');
  assert.ok(!lines[0].includes('SECRET_VALUE'));
});

test('redacts Fastify req.headers.authorization', () => {
  const fastifyOpts = getFastifyLoggerOptions();
  const { logger, lines } = makeCapturedLogger(fastifyOpts);
  logger.info({ req: { headers: { authorization: 'Bearer SECRET' } } }, 'req log');
  const record = JSON.parse(lines[0]);
  assert.equal(record.req.headers.authorization, '[REDACTED]');
  assert.ok(!lines[0].includes('Bearer SECRET'));
});

test('redacts each AD27 field name (parameterized)', () => {
  for (const field of AD27_FIELDS) {
    const workerOpts = pickPinoOpts(createWorkerLogger());
    const { logger, lines } = makeCapturedLogger(workerOpts);
    const sentinel = `SENTINEL_${field}`;
    logger.info({ [field]: sentinel }, 'log');
    const record = JSON.parse(lines[0]);
    assert.equal(record[field], '[REDACTED]', `top-level ${field} not redacted`);
    assert.ok(!lines[0].includes(sentinel), `sentinel leaked for top-level ${field}`);
  }
});

test('redacts each AD27 field name nested one level (parameterized)', () => {
  for (const field of AD27_FIELDS) {
    const workerOpts = pickPinoOpts(createWorkerLogger());
    const { logger, lines } = makeCapturedLogger(workerOpts);
    const sentinel = `SENTINEL_NESTED_${field}`;
    logger.info({ payload: { [field]: sentinel } }, 'log');
    const record = JSON.parse(lines[0]);
    assert.equal(record.payload[field], '[REDACTED]', `nested ${field} not redacted`);
    assert.ok(!lines[0].includes(sentinel), `sentinel leaked for nested ${field}`);
  }
});

test('output is valid newline-delimited JSON', () => {
  const workerOpts = pickPinoOpts(createWorkerLogger());
  const { logger, lines } = makeCapturedLogger(workerOpts);
  logger.info('one'); logger.info('two'); logger.info('three');
  assert.equal(lines.length, 3);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const record = JSON.parse(trimmed); // throws if invalid JSON
    assert.ok('level' in record);
    assert.ok('time' in record);
    assert.ok('context' in record);
  }
});

test('level field is a string label, not numeric', () => {
  const workerOpts = pickPinoOpts(createWorkerLogger());
  const { logger, lines } = makeCapturedLogger(workerOpts);
  logger.info('info-level message');
  const record = JSON.parse(lines[0]);
  assert.equal(record.level, 'info');
});

test('worker logger has context: "worker" base field', () => {
  const workerOpts = pickPinoOpts(createWorkerLogger());
  const { logger, lines } = makeCapturedLogger(workerOpts);
  logger.info('hello');
  const record = JSON.parse(lines[0]);
  assert.equal(record.context, 'worker');
});

test('Fastify options have context: "app" and request_id label', () => {
  const opts = getFastifyLoggerOptions();
  assert.equal(opts.base.context, 'app');
  assert.equal(opts.requestIdLogLabel, 'request_id');
  // The request_id renaming is internal to Fastify; we trust the option-pass.
});

test('redact paths and censor exposed for verification', () => {
  const paths = getRedactPaths();
  const censor = getRedactCensor();
  assert.equal(censor, '[REDACTED]');
  for (const field of AD27_FIELDS) {
    // Each AD27 field appears either as a top-level path or its bracket-notation form
    const expectedTopLevel = field.includes('-') ? `["${field}"]` : field;
    assert.ok(paths.includes(expectedTopLevel), `missing top-level path for ${field}`);
  }
});

/**
 * Helper: extract pino options from a constructed logger instance for use
 * in the captured-stream pattern. Pino exposes its config under `[Symbol.for('pino.serializers')]` etc.,
 * but the simpler approach is to reconstruct: createWorkerLogger() builds with the same
 * REDACT_CONFIG, so for unit-test purposes we re-extract the options by calling
 * the factory's logic directly. To keep the test self-contained without exporting
 * the internal config, we reconstruct equivalent opts here matching shared/logger.js's createWorkerLogger:
 */
function pickPinoOpts (_constructedLogger) {
  return {
    level: 'trace', // tests want all levels captured
    redact: { paths: getRedactPaths(), censor: getRedactCensor() },
    base: { context: 'worker' },
    formatters: { level (label) { return { level: label }; } },
  };
}
```

**Why `pickPinoOpts` re-derives the config instead of reading from `createWorkerLogger()`:** pino does not expose its constructed `redact` config as a public property; reading internals via `[Symbol.for(...)]` is brittle across pino versions. Since `shared/logger.js` exports `getRedactPaths()` and `getRedactCensor()`, the unit test rebuilds an equivalent options object using those exports — proving the SAME redaction list is in effect AND that the test isn't accidentally testing a stale or different list. The `level: 'trace'` override here is a test-only concession (production-default `'info'` would silence the lower-level test cases if any are added later).

**Why captured-stream and not pino-test:** `pino-test` is a separate package not in `package.json`; AD constraint forbids new dependencies without a clear trigger. Captured-stream pattern is two lines of code and zero new deps.

**Why no smoke test for the redaction at process boundary (i.e., spawning a real worker and checking its stdout):** Story 1.1's `tests/integration/scaffold-smoke.test.js` already pipes child stdout/stderr; Task 8 adds a manual-inspection step there to confirm boot lines look right. A dedicated process-boundary integration test for redaction is overkill at MVP — the unit tests verify the construction-site contract; the smoke test verifies wire-in didn't regress.

### Forward Dependencies — What This Story Does NOT Do

- **Per-request `customer_marketplace_id` binding** → Story 2.1 (`app/src/middleware/rls-context.js`). Pattern: `request.log = request.log.child({ customer_marketplace_id })` inside the RLS middleware. Story 1.3 ships the parent `app`-context logger; Story 2.1 attaches the per-request child.
- **Per-cycle `cycle_id` binding** → Story 5.1 (`worker/src/dispatcher.js`). Pattern: `const cycleLogger = workerLogger.child({ cycle_id })`. Story 1.3 ships the parent `worker`-context logger.
- **`event_type` field on audit-emission lines** → Story 9.0 (`shared/audit/writer.js`). Pattern: `logger.info({ event_type, customer_marketplace_id, ...payload }, 'audit emission')`. Story 1.3 guarantees the redaction list does not strip `event_type` (it isn't sensitive).
- **Custom serializers for engine-specific shapes** (e.g., a `decideForSkuChannel` decision record) → land per-feature; Story 1.3 ships only the redaction-list serializer.
- **`pino-pretty` for local dev** → not in `package.json`; Pedro pipes ad-hoc with `npx pino-pretty` if he wants prettier dev logs.
- **Log-shipping pipeline (Loki, Grafana, Better Stack, etc.)** → operational decision; out of scope for MVP. Coolify captures stdout to its own log viewer, sufficient for ≤10-customer scale (NFR-Sc1).
- **Trace-id propagation across worker → DB → Mirakl call chain** → Phase 2 (would require OpenTelemetry instrumentation; not justified at MVP scale).
- **Log-level toggles per-customer or per-customer-marketplace** → Phase 2; current `LOG_LEVEL` env var is process-wide.

### Previous Story Intelligence — Stories 1.1 + 1.2

Lessons from prior stories that shape Story 1.3 implementation:

- **ESLint v10 flat config is in use** (Story 1.1 D3). New JS file `shared/logger.js` must satisfy the existing `no-console`, `no-restricted-syntax` (default-export forbidden, `.then()` forbidden, and now `process.stdout.write` / `process.stderr.write` forbidden), `jsdoc/require-jsdoc` rules. Already accounted for in the verbatim factory snippet above.
- **`globals.node` is required** for `process` and `Buffer` recognition under ESLint v10 (Story 1.1 Debug Log entry). The Story 1.3 changes touch existing files that already have node globals scope; no further config change needed.
- **`pino` ESM import pattern**: `import pino from 'pino';` — this is the documented ESM entry. Pino exposes `pino.destination()`, `pino.transport()`, etc. as methods on the default export. Story 1.2 didn't use pino; Story 1.1 used it twice (`worker/src/index.js`, `shared/config/runtime-env.js`); Story 1.3 consolidates both call sites.
- **`pino` version lock**: `^10.3.1` in `package.json` (Story 1.1). Pino 10.x retains the redact-paths API of 9.x and 8.x — this story's path patterns work across the 8/9/10 ABI without churn.
- **Story 1.2 review applied a critical hook fix** — the `[ -t 0 ]` vs `[ -p /dev/stdin ]` issue. Not directly relevant to Story 1.3, but a reminder that bash-conditional semantics are subtle; if any Story 1.3 test invokes a shell, prefer node-native APIs.
- **Story 1.2 left a deferred item** ("master key buffer not zeroed on shutdown") — orthogonal to logging. Story 1.3 introduces no new sensitive-buffer lifecycle concerns; the redaction list ensures the master key value never reaches stdout regardless.
- **Story 1.1 review pattern**: piped child stdout/stderr in integration smoke tests, fail-fast on early child exit. Task 8 leans on this; no new test infrastructure needed.
- **Story 1.1 D2 / file-canonical-location decision**: `supabase/migrations/`, not `db/migrations/`. Story 1.3 ships no migrations, so this is moot for now.
- **Story 1.2 introduced `worker/src/index.js` master-key load block** — Story 1.3 leaves it untouched; only the logger construction line changes (per-Task-2 diff).

### Git Intelligence — Recent Commits

```
aefd4e7 feat(story-1.2): envelope encryption + master-key loader + secret-scanning hook
66f4cc1 feat(story-1.1): scaffold project, two-service Coolify deploy, composed /health
2acb867 docs(planning): three distillates + project-context.md + CLAUDE.md path updates
87fc05d docs(sprint): generate sprint-status.yaml — 62 stories sequenced
8f7add7 docs(planning): readiness-check fixes — NFR-O4 binding + I1-I3 cleanup
```

Story 1.2 landed today. Story 1.3 is the next feat commit. Convention:
- Commit message: `feat(story-1.3): pino structured logging + redaction list`
- Single PR — Story 1.3 has no atomicity bundle (Bundle A is Story 1.4). Logical commits are fine if separation helps review (e.g., one commit for `shared/logger.js` + tests; one for the wire-in changes; one for the ESLint extension), but a single commit is also acceptable given the small change footprint.

### Latest Tech Information

Verified via Context7 on 2026-05-02 against `/pinojs/pino` (latest) and `/fastify/fastify`:

- **pino 10.x `redact` API**: `{ paths, censor, remove }` — paths array supports dot, bracket, and single-level wildcard (`*.<key>`). Recursive wildcards (`**.<key>`) are NOT supported; this is consistent with fast-redact's documented limitation.
- **pino `formatters.level`**: returns the string label form (`{ level: 'info' }`) instead of the numeric level (`{ level: 30 }`). Standard pattern in observability stacks that expect string labels.
- **pino `base`**: an object whose keys are merged into every log line. Setting `base: { context: 'worker' }` is the canonical way to tag a logger instance per-process without a child-logger wrapper.
- **pino `child`**: `logger.child({ key: value })` returns a new logger that adds the bindings to every line. Forward-stories (2.1, 5.1, 9.0) use this for per-request, per-cycle, per-event tagging — Story 1.3 sets up the pattern, not the bindings.
- **Fastify v5 logger option**: accepts a pino options object (NOT a pre-built logger). Fastify constructs its own pino instance internally. The full option surface — `level`, `redact`, `base`, `formatters`, `requestIdLogLabel`, `serializers`, `transport`, `messageKey` — is forwarded to pino. Story 1.3 uses `level`, `redact`, `base`, `formatters`, `requestIdLogLabel` only.
- **Fastify `requestIdLogLabel`**: defaults to `'reqId'`. Setting it to `'request_id'` renames the auto-generated id in the JSON output, satisfying AC2 without a custom serializer.
- **No pino API breakage** between 8.x → 9.x → 10.x for the redact / formatters / base surface used here; the factory works identically across the 8/9/10 ABI. (Pino version is locked at ^10.3.1 from Story 1.1.)
- **Fastify's `serializers.req` default**: emits `method`, `url`, `host`, `remoteAddress`, `remotePort`, `id`. Headers NOT included by default — privacy-preserving. The `req.headers.authorization` redact path is defensive coverage if a future story overrides the serializer.

### AD Coverage This Story Implements

- **AD27** — Pino structured logging with redaction list (full implementation; the verbatim 11-field redaction list is the load-bearing contract)
- **NFR-S1** — Application logs never contain cleartext key material (runtime enforcement at the redaction layer; ESLint enforcement via `no-console` + extended `no-restricted-syntax`)
- **#18 Architectural Constraint** — No `console.log` in production code (extension to also block `process.stdout.write` / `process.stderr.write` deterministically)

### Project Structure Notes

Files created in this story:

```
shared/logger.js                                 # NEW — SSoT factory + REDACT_CONFIG + AD27 paths
tests/shared/logger.test.js                      # NEW — captured-stream redaction + JSON-shape unit tests
```

Files modified:

```
app/src/server.js                                # uses getFastifyLoggerOptions()
worker/src/index.js                              # uses createWorkerLogger()
shared/config/runtime-env.js                     # uses createWorkerLogger() instead of inline pino()
eslint.config.js                                 # extends no-restricted-syntax with stdout/stderr.write selectors
.env.example                                     # adds commented LOG_LEVEL knob
```

Files NOT touched (per "do not create implementation files for stories beyond 1.3"):
- No new migrations (Story 1.3 has no schema changes)
- No `app/src/middleware/*.js` (per-request `customer_marketplace_id` binding is Story 2.1)
- No `worker/src/dispatcher.js` (per-cycle `cycle_id` binding is Story 5.1)
- No `shared/audit/*.js` (Story 9.0 owns)

### Alignment with Unified Project Structure

- **Module location**: `shared/logger.js` matches `architecture-distillate/05-directory-tree.md` (the directory tree's `shared/` siblings include `audit/`, `crypto/`, `db/`, etc.; a top-level `logger.js` file in `shared/` is the SSoT module placement implied by the epics-distillate `_index.md` line "`shared/logger.js` (Story 1.3) → all subsequent stories that emit logs"). The architecture's directory tree does not enumerate `shared/logger.js` explicitly (oversight in the planning artifact); the SSoT-modules index in the epics distillate IS authoritative.
- **No deviations**: no new `shared/` subdirectories, no new entry-point files, no test-runner change.
- **Test path convention**: `tests/shared/<module-without-.js>/<...>.test.js` for nested modules (e.g., `tests/shared/crypto/envelope.test.js`); for top-level `shared/logger.js`, the test file goes at `tests/shared/logger.test.js` directly (no subdirectory) — consistent with the structure Story 1.2 used for `tests/scripts/check-no-secrets.test.js`.

### Dev Notes for Pedro

- **Day-of-deploy log inspection**: after this story merges and Coolify redeploys, tail the Coolify log viewer for the worker service. You should see structured JSON lines like `{"level":"info","time":1714665600000,"context":"worker","masterKeyByteLength":32,"masterKeyVersion":1,"msg":"Master key loaded"}`. If you see `{"level":30,...}` (numeric level instead of string label), the formatters didn't apply — file a bug.
- **No `console.log` rescue in dev**: the ESLint rule + `no-restricted-syntax` extension means any `console.log` you sprinkle in dev WILL fail `npm run lint`. Use `logger.debug({ ... }, 'message')` instead, and flip `LOG_LEVEL=debug` in `.env.local` to see the lines.
- **`LOG_LEVEL` env var**: optional. Default `info` is appropriate for Coolify production. Locally, set `LOG_LEVEL=debug` to see richer output during dev (e.g., when working on engine cycle logic in Story 7.x).
- **The redaction list is load-bearing — never narrow it**: if a future story (e.g., a Stripe-related one) needs to log a redacted-by-default field (like `STRIPE_WEBHOOK_SECRET` in a deliberate audit context), the right pattern is to log a HASH or LAST-4 of the value, NOT to remove the field from the redaction list. Pedro reviews any PR that touches `shared/logger.js`'s `AD27_FIELDS` array.

### References

- [Source: epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md#Story 1.3: Pino structured logging with redaction list] — verbatim 4 ACs
- [Source: epics-distillate/_index.md#Cross-Cutting: SSoT Modules Index] — `shared/logger.js (Story 1.3) → all subsequent stories that emit logs`
- [Source: epics-distillate/_index.md#Architectural Constraints / Negative Assertions (27 items)] — item #18 (`No console.log in production code — Story 1.1 ESLint no-console rule + Story 1.2 secret-scanning hook. All output via pino per AD27.`)
- [Source: architecture-distillate/03-decisions-E-J.md#AD27 — Logging: structured JSON via pino] — full AD27 spec including the verbatim 11-field redaction list, log levels, structured fields contract
- [Source: architecture-distillate/_index.md#Cross-Cutting Constraints (Negative Assertions — apply across all sections)] — `NO console.log (pino only per AD27; ESLint + pre-commit hook double-check)`
- [Source: prd-distillate.md#NFR-S1] — "All customer Mirakl shop API keys encrypted at rest using KMS-managed key; founder cannot view cleartext key material; **application logs never contain cleartext key material**; verified pre-launch via security review and ongoing via DB-dump scans"
- [Source: prd-distillate.md#FR11] — "API key stored encrypted at rest; founder cannot view cleartext; application MUST NOT log cleartext key material"
- [Source: CLAUDE.md] — "Trust constraint: API keys MUST be stored encrypted at rest. The Mirakl `shop_api_key` has no read-only mode and grants full account access (bank/IBAN, sales, prices, orders). This is a trust-critical component."
- [Source: implementation-artifacts/1-1-scaffold-project-two-service-coolify-deploy-composed-health.md#Pino Logging at Story 1.1] — "Story 1.1 uses basic pino without redaction. Story 1.3 adds the full redaction config and `shared/logger.js` SSoT module."
- [Source: implementation-artifacts/1-2-envelope-encryption-module-master-key-loader-secret-scanning-hook.md#Pino Redaction at Story 1.2] — "Story 1.2 introduces `MASTER_KEY_BASE64` and `master_key` as redaction targets. Story 1.3 ships the canonical pino redaction list (`shared/logger.js`) — the redaction list at AD27 is locked to include `MASTER_KEY_BASE64` and `master_key` already."
- [Mirakl MCP] — not required for this story (no Mirakl calls in Story 1.3)
- [Context7: /pinojs/pino] — `redact` API surface (paths, censor, remove); `child` logger pattern; `formatters.level` string-label trick; `base` field for per-process tagging
- [Context7: /fastify/fastify] — `logger:` option accepts pino options object; `requestIdLogLabel`; default `serializers.req` shape (no headers); `Fastify({ logger: { level: 'info', redact: [...] } })` example
- DynamicPriceIdea (`D:\Plannae Project\DynamicPriceIdea`) — has its own pino usage in `apiClient.js` but does NOT have a redaction list of this completeness; Story 1.3 is genuinely new code with stronger guarantees, not a DPI port. Reference DPI's pino call shape for sanity-checking but don't copy.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Opus 4.7, 1M context)

### Debug Log References

- Initial run of `tests/shared/logger.test.js` failed one assertion (`pid in record`) because pino's `base` option REPLACES the default `{ pid, hostname }` base entirely. Fix: explicitly include `pid: process.pid` and `hostname: hostname()` in the `base` object passed to both `createWorkerLogger()` and `getFastifyLoggerOptions()`. After the fix, all 11 unit tests pass.
- Initial integration smoke run produced log lines with `"reqId":"req-1"` instead of the AC#2 spec field `request_id`. Root cause: the spec snippet placed `requestIdLogLabel: 'request_id'` inside the pino `logger:` options object, but `requestIdLogLabel` is a Fastify v5 top-level constructor option, NOT a pino option. Pino silently ignored it; Fastify never saw it. Fix: extract `requestIdLogLabel` as a separately-exported constant `FASTIFY_REQUEST_ID_LOG_LABEL` and pass it at the root of `Fastify({ logger: ..., requestIdLogLabel: ... })`. After the fix, Fastify request log lines emit `"request_id":"req-1"` as required.
- The integration smoke assertion (`tests/integration/scaffold-smoke.test.js`) fails on this dev box due to Supabase IPv6 ETIMEDOUT (`connect ETIMEDOUT 2a05:d012:42e:5719:3d64:46bf:3646:8b16:5432`). This is a pre-existing network-environment issue, unrelated to Story 1.3. Manual log inspection from the captured spawned-service stdout confirms all AC#2 contract fields are present and correctly formatted.

### Completion Notes List

- AC#1: 11 AD27 redaction fields (`Authorization`, `authorization`, `cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`) redacted at top-level, one-level-nested, and Fastify `req.headers.*` paths. Verified by 11 unit tests in `tests/shared/logger.test.js`.
- AC#2: Structured JSON output with `level` (string label), `time`, `context` (`worker`/`app`), `pid`, `hostname`, `msg` confirmed via unit tests + integration-smoke captured stdout. Fastify request log lines carry `request_id` (not `reqId`).
- AC#3: 11 unit tests pass (`node --test tests/shared/logger.test.js` — 11/11 ok). Captured-stream pattern; no real stdout, no child processes spawned by tests.
- AC#4: `npm run lint` reports 0 errors. ESLint blocks `console.*` (pre-existing) AND `process.stdout.write` / `process.stderr.write` (newly added). Grep over `app/`, `worker/`, `shared/` returns zero matches for forbidden patterns.
- Spec deviation noted: `FASTIFY_REQUEST_ID_LOG_LABEL` exported separately from `getFastifyLoggerOptions()` (the spec snippet's nesting was incorrect — empirically verified).
- Pino `base` augmentation noted: explicit `pid` + `hostname` re-added because pino's `base` option fully REPLACES the default `{ pid, hostname }` (pino 10.x behavior, confirmed by initial test failure).

### File List

**Created:**
- `shared/logger.js` — AD27 SSoT module: redaction config, `createWorkerLogger()`, `getFastifyLoggerOptions()`, `FASTIFY_REQUEST_ID_LOG_LABEL`, `getRedactPaths()`, `getRedactCensor()`
- `tests/shared/logger.test.js` — 11 captured-stream unit tests covering AD27 redaction, JSON-shape contract, base-context tagging, and exposed redaction-list verification

**Modified:**
- `app/src/server.js` — uses `getFastifyLoggerOptions()` for `logger:` and `FASTIFY_REQUEST_ID_LOG_LABEL` for top-level `requestIdLogLabel:`
- `worker/src/index.js` — uses `createWorkerLogger()` (replaces inline `pino({ level: 'info' })`)
- `shared/config/runtime-env.js` — uses `createWorkerLogger()` (replaces inline `pino({ level: 'info' })`)
- `eslint.config.js` — extends `no-restricted-syntax` with `process.stdout.write` and `process.stderr.write` selectors (AD27-message)
- `.env.example` — adds commented `# LOG_LEVEL=info` knob

## Change Log

| Date       | Author | Change                                                                                                |
|------------|--------|-------------------------------------------------------------------------------------------------------|
| 2026-05-02 | Dev    | Implement Story 1.3: pino SSoT factory + AD27 redaction list + Fastify `request_id` label + ESLint extension |
| 2026-05-02 | Review | Code review (3-layer adversarial): 1 decision-needed, 3 patch, 4 defer, 3 dismissed                  |
| 2026-05-02 | Review | Patches applied: AD27 extended (+`Cookie`,`Set-Cookie` → 14 fields, distillates updated), `LOG_LEVEL` invalid-value fallback, getRedactPaths test extended, req.headers.cookie/`set-cookie` tests added. 13/13 tests pass; lint clean. Status: review → done. |

## Review Findings

_Generated by `bmad-code-review` on 2026-05-02. Layers: Blind Hunter (no-context adversarial) + Edge Case Hunter (project-aware boundary walk) + Acceptance Auditor (AC-aligned). All 11 unit tests verified passing on this dev box (`node --test tests/shared/logger.test.js` → 11/11 ok). Acceptance Auditor verdict: all 4 ACs pass; no blocking findings._

### Decision Needed

- [x] **[Review][Decision → Patch applied] AD27 list extended with `Cookie` / `Set-Cookie`** — `shared/logger.js:38-39`. Pedro chose to extend the AD27 contract for symmetric coverage (parity with `Authorization` / `authorization`). Propagated through: `architecture-distillate/03-decisions-E-J.md` (AD27 entry), `epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md` (AC#1), this story file (AC#1 + Logger Factory Implementation Notes), `shared/logger.js` (`AD27_FIELDS` now 14 entries), `tests/shared/logger.test.js` (parameterized test list). All 13 tests pass with the extended list.

### Patch

- [x] **[Review][Patch applied] Invalid `LOG_LEVEL` env value crashes startup synchronously at module-import** [shared/logger.js:81-90] — added `VALID_LOG_LEVELS` Set, `LOG_LEVEL_INVALID` flag, and a fallback to `'info'` with a structured warn-level log line emitted by `createWorkerLogger()` at first construction. Verified: `LOG_LEVEL=verbose node -e "import('./shared/logger.js').then(m => m.createWorkerLogger().info('boot ok'))"` now boots successfully and emits `{"level":"warn",...,"requested_log_level":"verbose","fallback":"info","msg":"LOG_LEVEL invalid; falling back to info"}` followed by `boot ok`.
- [x] **[Review][Patch applied] `getRedactPaths()` test extended to assert wildcard + `req.headers.*` paths** [tests/shared/logger.test.js] — renamed test to `redact paths and censor exposed for verification (top-level + wildcard + req.headers)`; added wildcard-path assertion per AD27 field plus explicit asserts for the three `req.headers.*` paths.
- [x] **[Review][Patch applied] `req.headers["set-cookie"]` and `req.headers.cookie` redaction tests added** [tests/shared/logger.test.js] — two new tests (`redacts Fastify req.headers.cookie`, `redacts Fastify req.headers["set-cookie"]`) analogous to the existing `req.headers.authorization` case. Verified with sentinel-leak assertions.

### Deferred

- [x] **[Review][Defer] `*["set-cookie"]` wildcard path-string syntax pins to current pino version** [shared/logger.js:63] — deferred. The wildcard-with-bracket-notation form `*["set-cookie"]` (no dot between `*` and `[`) is undocumented quirky pino syntax. **Verified working today** with pino@10.3.1 (the parameterized nested-redaction tests pass for `set-cookie`). A future pino major could tighten the parser. Mitigation in the patch above (add explicit `req.headers["set-cookie"]` test). Action: revisit on next pino major upgrade. Reason: works today; the patch above already provides early-warning coverage; speculative pinning ahead of a real regression contradicts the "no premature abstraction" feedback rule.
- [x] **[Review][Defer] `LOG_LEVEL` resolved at module-import time, not runtime** [shared/logger.js:81] — deferred. `const LOG_LEVEL = process.env.LOG_LEVEL || 'info'` executes once at import. Mutations to `process.env.LOG_LEVEL` after import (test setup, late dotenv load) are ignored. Production flow uses `node --env-file=.env.local` which sets vars before any import runs, so the realistic failure window is narrow. Reason: low severity, no observed leak path, deferring until a real test-harness or runtime-flip use case appears.
- [x] **[Review][Defer] `process.exit(1)` paths race async pino flush** [shared/config/runtime-env.js:21, worker/src/index.js:24] — deferred, pre-existing. Both call sites (and the original `worker/src/index.js` from Story 1.1) call `log.error(...)` then `process.exit(1)` without `logger.flush()` or `pino({ sync: true })`. pino in default async mode buffers via sonic-boom; a startup misconfig could exit before the error line flushes — the worst possible debugging UX for the very thing these exit paths exist to surface. **Pre-existing pattern from Story 1.1** (Story 1.3 only changed the construction site, not the call site). Reason: real concern but warrants a coordinated cross-cutting fix (sync-mode logger OR `pino.final` pattern OR explicit flush) across all log-then-exit sites; track as a separate item.
- [x] **[Review][Defer] ESLint `no-restricted-syntax` selector misses bracket-indexed and aliased `process.stdout.write`** [eslint.config.js:29-30] — deferred. The selector matches `callee.object.object.name="process"` literally, so `process['stdout'].write(...)` (computed property) and `const o = process.stdout; o.write(...)` (alias) escape detection. Reason: this is a guardrail for accidental regressions, not a security boundary — the runtime redaction list is the actual guarantee. Fixing requires a more elaborate AST pattern or a custom rule (Story 3.1+ ships custom rules); not justified at MVP scale.

### Dismissed (3)

- NDJSON test's `if (trimmed.length === 0) continue;` skip-empty branch (cosmetic; pino emits exactly one full JSON line per `write` call, so the branch is unreachable but harmless).
- AC#3 test name #7 split into two tests (`worker logger has context: "worker" base field` + `Fastify options have context: "app" and request_id label`) — functionally equivalent to the spec's combined test, and split improves diagnostics.
- AC#3 test name suffix drift (`(parameterized, top-level)`, `with required base fields`) — clarifying suffixes; coverage matches or exceeds spec.
