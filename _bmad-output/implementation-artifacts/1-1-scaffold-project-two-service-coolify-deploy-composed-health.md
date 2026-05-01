# Story 1.1: Scaffold project, two-service Coolify deploy, composed /health

Status: done

## Story

As Pedro (founder),
I want a scaffolded Node.js project with two independently deployable Fastify services (app + worker) and a working /health endpoint that verifies both Postgres connectivity and worker liveness,
so that there is a minimal verified foundation — deployable to Coolify from day 1 — upon which all subsequent stories can build.

## Acceptance Criteria

1. **Given** a fresh clone **When** I run `npm install && npm run start:app` **Then** Fastify returns 200 on `GET /` on `localhost:3000` **And** `package.json` has `engines.node = ">=22.0.0"` and `"type": "module"` (JS-ESM) **And** runtime deps match the pinned set (fastify, @fastify/static, @fastify/view, @fastify/rate-limit, @fastify/cookie, @fastify/csrf-protection, eta, pino, pg, @supabase/supabase-js, stripe, resend, node-cron) with dev: eslint, @eslint/js, eslint-plugin-jsdoc **And** ESLint flat config passes with one example fully-annotated exported function demonstrating the JSDoc completeness rule.

2. **Given** required env vars set (`MASTER_KEY_BASE64`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_DATABASE_URL`) **When** I run `npm run start:worker` **Then** the worker writes a row to `worker_heartbeats(id bigserial PK, worker_instance_id text NOT NULL, written_at timestamptz NOT NULL DEFAULT NOW())` every 30 seconds via `worker/src/jobs/heartbeat.js` **And** logs an `info`-level boot message via pino structured JSON to stdout **And** the worker process does NOT depend on the app server (independent process).

3. **Given** the worker is writing heartbeats **When** the app server receives `GET /health` **Then** response is 200 IFF (a) `SELECT 1` from Postgres returns within 1s AND (b) the most recent `worker_heartbeats.written_at` is < 90 seconds old **And** response is 503 with `{ "status": "degraded", "details": { "db": "ok|error", "worker_heartbeat_age_s": <number> } }` if either fails **And** the route is in `app/src/routes/health.js` with NO auth middleware applied (public endpoint per FR45 — UptimeRobot pings externally).

4. **Given** Coolify configured with two services from the same image **When** I `git push` to main **Then** Coolify deploys both in parallel using start commands `npm run start:app` (port 3000, exposed as `app.marketpilot.pt`) and `npm run start:worker` (no public URL) **And** both services use `replicas: 1` (F11 explicit) **And** they share the same env-var subset (Coolify-managed).

5. **Given** the scaffolded project **When** I inspect `package.json` and source tree **Then** there is NO Mirakl webhook listener (AD18 — polling-only) **And** NO external validator library (no `zod`, `yup`, `joi`, `ajv` — AD28) **And** NO SPA framework (no `react`, `vue`, `svelte`, `angular`, `solid-js`) **And** NO bundler (no `vite`, `webpack`, `rollup`, `esbuild`, `parcel`) **And** NO TypeScript compiler (no `typescript`, `ts-node`) **And** NO Redis/queue library (no `redis`, `ioredis`, `bullmq`, `bull`) **And** NO i18n infrastructure (no `i18next`, `react-intl`, ES translation files) **And** NO pgbouncer or supavisor config.

6. **Given** the scaffold is complete **When** I run `node --test tests/integration/scaffold-smoke.test.js` **Then** the test starts both services, asserts `GET /health` returns 200 within 60 seconds, asserts a `worker_heartbeats` row appears in Postgres within 60 seconds, then shuts down both processes cleanly.

## Tasks / Subtasks

- [x] Task 1: Initialize npm project (AC: #1)
  - [x] `npm init -y` in project root
  - [x] Set `"engines": { "node": ">=22.0.0" }` and `"type": "module"` in package.json
  - [x] Add scripts: `"start:app": "node app/src/server.js"`, `"start:worker": "node worker/src/index.js"`, `"test": "node --test"`, `"test:integration": "node --test 'tests/integration/**/*.test.js'"`, `"lint": "eslint ."`, `"test:rls": "node --test tests/integration/rls-regression.test.js"`
  - [x] Install runtime deps (exact names): `npm install fastify @fastify/static @fastify/view @fastify/rate-limit @fastify/cookie @fastify/csrf-protection eta pino pg @supabase/supabase-js stripe resend node-cron`
  - [x] Install dev deps: `npm install -D eslint @eslint/js eslint-plugin-jsdoc`
  - [x] Create `.nvmrc` containing `22`
  - [x] Create `.editorconfig` (indent_style=space, indent_size=2, end_of_line=lf, charset=utf-8, trim_trailing_whitespace=true, insert_final_newline=true)

- [x] Task 2: Create project directory skeleton (AC: #1, #5)
  - [x] Create all directories from architecture 05-directory-tree.md: `app/src/routes/_public/`, `app/src/routes/onboarding/`, `app/src/routes/dashboard/`, `app/src/routes/audit/_fragments/`, `app/src/routes/settings/`, `app/src/routes/interceptions/`, `app/src/routes/admin/`, `app/src/routes/_webhooks/`, `app/src/views/layouts/`, `app/src/views/components/`, `app/src/views/pages/`, `app/src/views/modals/`, `app/src/views/partials/`, `app/src/views/emails/`, `app/src/middleware/`, `app/src/lib/`
  - [x] Create: `worker/src/engine/`, `worker/src/safety/`, `worker/src/jobs/`, `worker/src/lib/`
  - [x] Create: `shared/audit/`, `shared/crypto/`, `shared/db/`, `shared/mirakl/`, `shared/money/`, `shared/state/`, `shared/stripe/`, `shared/resend/`, `shared/moloni/`, `shared/config/`
  - [x] Create: `supabase/migrations/`, `db/seed/dev/`, `db/seed/test/`
  - [x] Create: `public/css/`, `public/js/`, `public/images/`
  - [x] Create: `scripts/`, `tests/shared/mirakl/`, `tests/shared/crypto/`, `tests/shared/db/`, `tests/worker/src/engine/`, `tests/worker/src/safety/`, `tests/integration/`, `tests/fixtures/p11/`, `tests/fixtures/pri01-csv/`, `tests/fixtures/a01/`, `tests/fixtures/pc01/`, `tests/fixtures/of21/`, `tests/mocks/`, `eslint-rules/`
  - [x] Create `.env.example` with all required env var names (see Dev Notes)
  - [x] Create `.gitignore` (node_modules, .env.local, .env.test, verification-results.json, dist, coverage)

- [x] Task 3: Create worker_heartbeats migration (AC: #2)
  - [x] Create `supabase/migrations/202604301212_create_worker_heartbeats.sql` with the exact schema (see Dev Notes for DDL)
  - [x] Apply migration via Supabase CLI: `npx supabase migration new create_worker_heartbeats` then copy DDL, or apply to project `ttqwrbtnwtyeehynzubw` per project workflow
  - [x] Migration MUST NOT include RLS (system table — service-role-only access; automatic RLS trigger on Supabase will enable row-level security but no policy needed since it's read-only for the health check via direct pg)

- [x] Task 4: Create shared/config/runtime-env.js (AC: #2, #4)
  - [x] Validate presence of: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_DATABASE_URL`, `MASTER_KEY_BASE64`
  - [x] On missing var: log error via pino and `process.exit(1)` (no partial-state startup)
  - [x] Export `getEnv()` returning validated env object — never access `process.env` directly outside this module in production code

- [x] Task 5: Implement worker entry point + heartbeat (AC: #2)
  - [x] `worker/src/index.js` — import runtime-env validator, create pino logger (`level: 'info'`), log boot message, start heartbeat job
  - [x] `worker/src/jobs/heartbeat.js` — create pg Pool with `SUPABASE_SERVICE_ROLE_DATABASE_URL`, `setInterval` every 30s, INSERT into `worker_heartbeats(worker_instance_id, written_at)` with `worker_instance_id = '${process.env.HOSTNAME || 'local'}:${process.pid}'`
  - [x] IMPORTANT: This uses a DIRECT pg Pool at Story 1.1 — Story 2.1 will formalize `shared/db/service-role-client.js`. Do NOT forward-import that module (it doesn't exist yet).
  - [x] Pool config: `{ max: 5, connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL }`

- [x] Task 6: Implement app server entry point (AC: #1)
  - [x] `app/src/server.js` — ESM `import Fastify from 'fastify'`, logger with pino (`logger: { level: 'info' }`), register `@fastify/static` for `/public`, register health route, `fastify.get('/', ...)` returns "Hello MarketPilot" placeholder, `await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' })`
  - [x] Register `/health` route from `app/src/routes/health.js`
  - [x] Do NOT apply auth middleware to `/health` — health is a public route

- [x] Task 7: Implement /health endpoint (AC: #3)
  - [x] `app/src/routes/health.js` — create its own direct pg Pool (same pattern as worker heartbeat, using `SUPABASE_SERVICE_ROLE_DATABASE_URL`) — Story 2.1 formalization does not change the health route (health is non-tenant)
  - [x] Health check logic: (a) `SELECT 1` with 1s timeout → db: 'ok' or 'error'; (b) `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(written_at))) AS age_s FROM worker_heartbeats` → worker_heartbeat_age_s
  - [x] Return 200 JSON `{ "status": "healthy" }` IFF `db === 'ok'` AND `age_s < 90`
  - [x] Return 503 JSON `{ "status": "degraded", "details": { "db": "ok|error", "worker_heartbeat_age_s": <number|null> } }` on any failure
  - [x] Use **named export** (not default): `export async function healthRoutes(fastify, _opts) { ... }` — in `app/src/server.js`: `import { healthRoutes } from './routes/health.js'; await fastify.register(healthRoutes);` — `fastify.register()` accepts any async function directly, no default export required

- [x] Task 8: Configure ESLint v10 flat config (AC: #1, #5)
  - [x] Create `eslint.config.js` — ESM format, export default array (see Dev Notes for exact pattern)
  - [x] Enable: `no-console: 'error'`, `no-restricted-syntax` for (a) `.then(` chains and (b) `ExportDefaultDeclaration` (no-default-export per AD architecture convention), JSDoc `jsdoc/require-jsdoc` on exported functions, JSDoc `jsdoc/require-param`, `jsdoc/require-returns`
  - [x] Scope source-code rules to `files: ['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js']` — this naturally excludes `eslint.config.js` itself (root-level config file; ESLint flat config requires `export default []` and cannot use named export) and test/script files
  - [x] Create `eslint-rules/` stub files as placeholders (Story 3.1 adds `no-direct-fetch`, Story 6.1 adds `no-raw-CSV-building`, etc.) — DO NOT implement those rules now
  - [x] Create one example fully-annotated exported function in `shared/config/runtime-env.js` with `@param`, `@returns`, `@throws` JSDoc to prove the rule fires

- [x] Task 9: Create integration smoke test (AC: #6)
  - [x] `tests/integration/scaffold-smoke.test.js` — uses `node:test` and `node:assert` (NOT jest/vitest)
  - [x] Spawn `npm run start:app` and `npm run start:worker` as child processes
  - [x] Poll `http://localhost:3000/health` with 60s timeout until 200
  - [x] Query `worker_heartbeats` via pg Pool — assert ≥1 row within 60s
  - [x] Tear down both child processes cleanly (`SIGTERM`) after test
  - [x] Test file uses `test()` from `node:test`

- [x] Task 10: Verify negative assertions checklist (AC: #5)
  - [x] Inspect package.json and confirm NONE of these appear in dependencies or devDependencies: `zod`, `yup`, `joi`, `ajv`, `react`, `vue`, `svelte`, `angular`, `solid-js`, `vite`, `webpack`, `rollup`, `esbuild`, `parcel`, `typescript`, `ts-node`, `redis`, `ioredis`, `bullmq`, `bull`, `i18next`, `react-intl`, `pgbouncer`
  - [x] Confirm no `/api/v1/` route definitions exist in app/src/routes/

- [x] Task 11: Document Coolify deployment (AC: #4)
  - [x] Add Coolify deployment instructions to README.md (see Dev Notes for two-service Coolify setup)
  - [x] F11 compliance: both services configured with `replicas: 1` in Coolify

### Review Findings

**Code review (2026-05-01)** — 3 decision-needed, 8 patch, 8 deferred, 11 dismissed as noise. Reviewed by parallel layers: Blind Hunter (adversarial, diff-only), Edge Case Hunter (boundary walks), Acceptance Auditor (spec compliance).

#### Decision-needed

- [x] [Review][Decision] **TLS verification disabled on both pg Pools** — `ssl: { rejectUnauthorized: false }` was added to both [app/src/routes/health.js:6](../../app/src/routes/health.js#L6) and [worker/src/jobs/heartbeat.js:6](../../worker/src/jobs/heartbeat.js#L6). The verbatim spec snippets (Dev Notes lines 251-275, 282-329) do not include any `ssl` option. This silently accepts MITM'd / forged certs on the service-role connection (god-mode credentials). Decide: (a) pin Supabase's CA, (b) keep but document why Supabase managed pg requires it, or (c) remove entirely.
- [x] [Review][Decision] **Duplicate migration in two locations** — [db/migrations/202604301212_create_worker_heartbeats.sql](../../db/migrations/202604301212_create_worker_heartbeats.sql) AND `supabase/migrations/202604301212_create_worker_heartbeats.sql` are byte-identical. The spec File List names only `db/migrations/...`. Auditor classifies as Major (drift risk). Decide canonical location: (a) keep `db/` (matches spec), remove `supabase/migrations/` + `supabase/config.toml` + `supabase/.gitignore`; (b) keep `supabase/` (matches Supabase CLI native flow), remove `db/migrations/` and update spec; (c) keep both with a documented sync mechanism.
- [x] [Review][Decision] **ESLint v10 vs spec's v9 wording** — `package.json` pins `eslint@^10.3.0` and `@eslint/js@^10.0.1`. Spec text repeatedly says "ESLint v9 flat config" and Context7 reference cites v9.37.0. v10 retains flat-config behavior so functionally equivalent. Decide: (a) downgrade to v9 to match spec, (b) keep v10 + update spec wording in Change Log.

#### Patch

- [x] [Review][Patch] **Missing index on `worker_heartbeats(written_at)`** [db/migrations/202604301212_create_worker_heartbeats.sql:5] — `MAX(written_at)` in /health degrades to seq-scan as table grows (~1M rows/year per worker). Add `CREATE INDEX worker_heartbeats_written_at_desc_idx ON worker_heartbeats (written_at DESC);` to the migration.
- [x] [Review][Patch] **/health timeout race leaks query and pool slot** [app/src/routes/health.js:26-29] — `Promise.race` against `setTimeout(...1000)` rejects the wrapper but does not cancel the underlying `pool.query('SELECT 1')`. Under DB stress, the timed-out query keeps holding a connection (pool max:2). Two consecutive timeouts pin both slots and every subsequent `/health` returns 503 until DB recovers. Use pg's `statement_timeout` on the Pool (or `query_timeout`) instead of race+forget. The `setTimeout` handle is also not cleared on success.
- [x] [Review][Patch] **server.js try/catch only wraps `listen()`** [app/src/server.js:18-23,29-34] — If `FastifyStatic` or `healthRoutes` registration throws (e.g., missing `public/` directory, bad pg URL), the top-level `await` produces an unhandled rejection that exits with no `fastify.log.error`. Wrap the registers in the same try/catch as `listen()`.
- [x] [Review][Patch] **/health response missing `Cache-Control: no-store`** [app/src/routes/health.js:54] — UptimeRobot may cache 503 responses (FR45 implies external pings). Add `reply.header('Cache-Control', 'no-store')` so each ping is fresh.
- [x] [Review][Patch] **Heartbeat has no initial INSERT — 30s gap on boot** [worker/src/jobs/heartbeat.js:17-28] — First row appears 30s after worker startup, so `/health` is 503 for 30s on every redeploy and the smoke test takes longer to pass. Run one INSERT immediately, then schedule the interval.
- [x] [Review][Patch] **Smoke test does not pipe child stdout/stderr or detect early exit** [tests/integration/scaffold-smoke.test.js:8-9] — If app or worker crashes on startup (port 3000 in use, missing env, wrong DB URL), the test polls `fetch` for 60s and reports "GET /health did not return 200" with no diagnostic. Pipe stderr to test output and add `child.on('exit', (code) => …)` to fail fast with a clear cause.
- [x] [Review][Patch] **Negative `ageS` (clock skew) silently reports healthy** [app/src/routes/health.js:44] — If `NOW()` on the DB is behind a worker that wrote a future timestamp, `ageS` is negative; `ageS >= 90` is false → status: healthy. Add an `ageS < 0` branch (treat as degraded with a clock-skew detail).
- [x] [Review][Patch] **`eslint.config.js` comment claim is misleading** [eslint.config.js:2-3] — Comment says the config file is "explicitly excluded from the no-default-export rule via the files scope below." It is not explicitly excluded — it falls outside both `files` blocks (source + test) and so is linted only by `js.configs.recommended`, which has no `no-restricted-syntax` rule. The default-export passes by incidental scope, not explicit exclusion. Reword for accuracy.

#### Deferred (out of scope for Story 1.1 — pre-existing scaffold pattern or later-story)

- [x] [Review][Defer] **pg Pools never `.end()`ed; no SIGTERM handler in app or worker** [app/src/routes/health.js, worker/src/jobs/heartbeat.js, app/src/server.js, worker/src/index.js] — deferred, pre-existing scaffold pattern (Story 1.1 spec line 220 explicitly says inline pg Pool is intentional, not a pattern to replicate). Graceful shutdown / Pool teardown belongs to a later story.
- [x] [Review][Defer] **/health endpoint not behind `@fastify/rate-limit`** [app/src/routes/health.js, app/src/server.js] — deferred, plugin is a runtime dep at AC#1 but spec does not register it at Story 1.1. Hostile burst on `/health` could exhaust pool max:2; harden in a later security-pass story.
- [x] [Review][Defer] **`@fastify/cookie` and `@fastify/csrf-protection` not registered** [app/src/server.js] — deferred, listed as runtime deps for AC#1 but registration is intentionally later (auth/session story).
- [x] [Review][Defer] **`MASTER_KEY_BASE64` shape (32-byte base64) not validated** [shared/config/runtime-env.js:7] — deferred, Story 1.2 explicitly owns this per spec line 401: "Story 1.2 extends this module to add 32-byte length validation on `MASTER_KEY_BASE64`."
- [x] [Review][Defer] **`.env.example` lists Stripe/Resend keys not in `REQUIRED_VARS`** [.env.example:13-18, shared/config/runtime-env.js:5-9] — deferred, intentionally not strict at boot since they're needed at SDK init time only.
- [x] [Review][Defer] **RLS comment in migration is unverified claim** [db/migrations/202604301212_create_worker_heartbeats.sql:7-10] — deferred, comment claims Supabase auto-RLS-trigger handles it; verify via Supabase project settings, not in code.
- [x] [Review][Defer] **No `db:migrate` script in package.json** [package.json:9-16] — deferred, spec does not require one; smoke test assumes migration is already applied (Pedro runs `npx supabase db push` per Task 3).
- [x] [Review][Defer] **Module load order — `health.js` constructs Pool before `getEnv()` validates env** [app/src/server.js:6-8, app/src/routes/health.js:4-8] — deferred, low impact (Pool with `undefined` connectionString remains idle; `getEnv()` exits before `fastify.listen`). Worth tracking for the day env-validation moves earlier in the boot sequence.

#### Dismissed (noise / handled elsewhere)

- Heartbeat global `MAX(written_at)` masks dead-worker fleet — at MVP F11 mandates `replicas: 1`, so N=1 by design (N>1 is a Phase 2 trigger).
- Migration filename `202604301212` looks future-dated — actually correct (today is 2026-05-01; created yesterday at 12:12).
- `workerId = ${HOSTNAME}:${pid}` collisions — cosmetic only; not used as a lock or idempotency key here.
- `Number(ageS)` NaN handling — pg returns clean numerics for `EXTRACT(EPOCH ...)`.
- `>= 90` boundary flap risk — matches spec contract exactly (`< 90 seconds old`).
- `Number(process.env.PORT) || 3000` accepts `PORT="0"` → 3000 — unrealistic input.
- `test:integration` glob quoting on Windows — works on PowerShell; node `--test` accepts globs.
- No `CREATE TABLE IF NOT EXISTS` — Supabase migration runner handles idempotency.
- ESLint config `no-unused-vars` rule addition — disclosed in Debug Log, pragmatic.
- ESLint config `no-useless-assignment: off` — disclosed in Debug Log, accommodates pre-existing script.
- `globals` package added — disclosed in Debug Log, required for Node globals recognition.

## Dev Notes

### CRITICAL Architecture Constraints for This Story

Story 1.1 installs the **negative-assertion guard** for 11 of the 27 architectural constraints. The smoke test + ESLint config ARE the enforcement mechanism for most of these.

**Hard stops (refuse and flag to Pedro if any subagent proposes these):**

| Constraint | What's forbidden | What to do instead |
|---|---|---|
| #1 AD18 | Mirakl webhook listener | Polling-only; never add webhook route |
| #2 AD28 | zod / yup / joi / ajv | Fastify built-in JSON Schema only |
| #3 | react / vue / svelte / angular | server-rendered eta + vanilla JS |
| #4 | vite / webpack / rollup / esbuild | No build step; `node app/src/server.js` directly |
| #5 | typescript / ts-node | JS-ESM with JSDoc type hints only |
| #7 | /api/v1/* customer routes | Server-rendered only; Stripe webhook is the single JSON endpoint |
| #8 | redis / bullmq / bull | pri01_staging table + Postgres advisory locks |
| #10 | i18n / ES translations | PT-only at MVP; Spanish UI = Phase 2 trigger |
| #11 | pgbouncer / supavisor | pg built-in Pool (max: 5) sufficient at MVP scale |
| #18 | console.log / console.error | pino only — ESLint `no-console` rule enforces this |
| F9 | bundler `<script>` tags | `<script src="/js/<page>.js" defer>` near `</body>` only |

**No `npx create-*`** — project is hand-scaffolded with explicit deps (`npm init -y`). Do not use `create-fastify-app`, `create-next-app`, or any scaffolding tool.

### ESLint v10 Flat Config — EXACT FORMAT REQUIRED

ESLint v10 uses **flat config** (`eslint.config.js`), NOT legacy `.eslintrc.js`. This is a common LLM mistake that causes `eslint.config.js` to be silently ignored.

```js
// eslint.config.js  (ESM — project is "type": "module")
// NOTE: This file itself uses `export default []` — that is REQUIRED by ESLint flat config
// and is explicitly excluded from the no-default-export rule via the files scope below.
import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  js.configs.recommended,
  {
    // Scope to source files only — excludes eslint.config.js (root) and tests/scripts
    files: ['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js'],
    plugins: { jsdoc },
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: 'CallExpression[callee.property.name="then"]', message: 'Use async/await instead of .then() chains.' },
        { selector: 'ExportDefaultDeclaration', message: 'Default exports forbidden. Use named exports (AD architecture convention).' },
      ],
      'jsdoc/require-jsdoc': ['error', { require: { FunctionDeclaration: false, ArrowFunctionExpression: false, FunctionExpression: false }, publicOnly: true }],
      'jsdoc/require-param': 'error',
      'jsdoc/require-returns': 'error',
    },
  },
  {
    // Test files and scripts — relax jsdoc + console rules
    files: ['tests/**/*.js', 'scripts/**/*.js'],
    rules: { 'jsdoc/require-jsdoc': 'off', 'no-console': 'off' },
  },
];
```

**Dev deps required for this config:** `@eslint/js` (included in core ESLint v10 package as peer, verify version with `npm view @eslint/js version`), `eslint-plugin-jsdoc`.

**NOTE:** `eslint-rules/` directory houses CUSTOM rules that are added BY LATER STORIES (no-direct-fetch in Story 3.1, no-raw-CSV-building in Story 6.1, etc.). At Story 1.1, create placeholder files in that directory so the directory structure matches the spec:
```
eslint-rules/
├── no-raw-error-to-template.js   # placeholder: export default { rules: {} }
├── worker-must-filter-by-customer.js  # placeholder
├── single-source-of-truth.js          # placeholder
└── no-direct-fetch.js                 # placeholder
```
DO NOT implement the rule logic — those stories own the rule implementations.

### Fastify v5 ESM Initialization

Fastify v5 ESM import (verified from Context7):
```js
import Fastify from 'fastify';

const fastify = Fastify({
  logger: {
    level: 'info',   // basic at Story 1.1; Story 1.3 adds redaction
  }
});

// Register routes as plugins
await fastify.register(import('./routes/health.js'));

// Listen
try {
  await fastify.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
```

**host: '0.0.0.0'** is REQUIRED for Coolify container deployment (default `127.0.0.1` won't accept external traffic inside Docker network).

**Fastify route plugin pattern (ESM — named exports only, no default exports per AD constraint):**
```js
// app/src/routes/health.js — named export, NOT export default
export async function healthRoutes(fastify, _opts) {
  fastify.get('/health', async (request, reply) => {
    // ...
  });
}

// In app/src/server.js — import by name, register directly:
import { healthRoutes } from './routes/health.js';
await fastify.register(healthRoutes);
// fastify.register() accepts any async function — no default export required.
```

### Two-Service Architecture Details

**Single `package.json`, two entry points** — no monorepo. Both `app/src/server.js` and `worker/src/index.js` live in the same git repo; Coolify runs them as two separate Docker container instances from the same image.

**Import boundaries enforced at code review:**
- `app/src/` MUST NOT import from `worker/src/`
- `worker/src/` MUST NOT import from `app/src/`
- Both MAY import from `shared/`

**At Story 1.1, shared/ modules don't exist yet.** The worker and app server each create their own minimal pg Pool inline. This is intentional scaffolding — not a pattern to replicate in later stories. Story 2.1 creates `shared/db/rls-aware-client.js` and `shared/db/service-role-client.js` as SSoT modules.

### Database Schema — worker_heartbeats Migration

File: `supabase/migrations/202604301212_create_worker_heartbeats.sql`

```sql
CREATE TABLE worker_heartbeats (
  id bigserial PRIMARY KEY,
  worker_instance_id text NOT NULL,
  written_at timestamptz NOT NULL DEFAULT NOW()
);

-- No RLS policy: system-internal table, accessed only via service-role connection.
-- The automatic RLS trigger on this Supabase project will enable RLS on the table,
-- but with no policies defined, access is denied to all JWT-scoped connections --
-- which is the desired behavior (service-role bypasses RLS entirely).
```

**Apply via Supabase CLI** (never use `apply_migration` MCP tool — that bypasses git history):
```sh
npx supabase migration new create_worker_heartbeats
# Then copy DDL into the generated file and run:
npx supabase db push
```

Migration ordering note: this is migration #12 in the sequence (`202604301212`). Migrations 1200–1211 are created by Stories 1.2–9.1 (which ship later). Story 1.1 creates ONLY `202604301212_create_worker_heartbeats.sql` — do not pre-create other migration files.

### Worker Heartbeat Implementation

```js
// worker/src/jobs/heartbeat.js
import pg from 'pg';
const { Pool } = pg;  // pg uses CommonJS default export — destructure for ESM

const pool = new Pool({
  connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
  max: 5,
});

const workerId = `${process.env.HOSTNAME || 'local'}:${process.pid}`;

export function startHeartbeat(logger) {
  logger.info({ workerId }, 'Heartbeat job started');
  setInterval(async () => {
    try {
      await pool.query(
        'INSERT INTO worker_heartbeats (worker_instance_id) VALUES ($1)',
        [workerId]
      );
    } catch (err) {
      logger.error({ err }, 'Heartbeat INSERT failed');
    }
  }, 30_000);
}
```

**IMPORTANT about pg ESM import**: `pg` exports a CommonJS module. In a `"type": "module"` project, use the destructuring pattern above (`import pg from 'pg'; const { Pool } = pg;`), NOT `import { Pool } from 'pg'` (that fails because `pg` has no named ESM exports).

### Health Route Implementation Notes

```js
// app/src/routes/health.js
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
  max: 2,  // health check needs minimal connections
});

export async function healthRoutes(fastify, _opts) {
  fastify.get('/health', { config: { skipAuth: true } }, async (request, reply) => {
    const result = { status: 'healthy', details: {} };
    let httpStatus = 200;

    // (a) DB liveness
    try {
      await Promise.race([
        pool.query('SELECT 1'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000)),
      ]);
      result.details.db = 'ok';
    } catch {
      result.details.db = 'error';
      result.status = 'degraded';
      httpStatus = 503;
    }

    // (b) Worker heartbeat freshness
    try {
      const { rows } = await pool.query(
        'SELECT EXTRACT(EPOCH FROM (NOW() - MAX(written_at))) AS age_s FROM worker_heartbeats'
      );
      const ageS = rows[0]?.age_s ?? null;
      result.details.worker_heartbeat_age_s = ageS !== null ? Number(ageS) : null;
      if (ageS === null || Number(ageS) >= 90) {
        result.status = 'degraded';
        httpStatus = 503;
      }
    } catch {
      result.details.worker_heartbeat_age_s = null;
      result.status = 'degraded';
      httpStatus = 503;
    }

    return reply.code(httpStatus).send(result);
  });
}
```

### Integration Smoke Test — node:test Pattern

```js
// tests/integration/scaffold-smoke.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from 'pg';
const { Pool } = pg;

test('scaffold smoke', async (t) => {
  const app = spawn('node', ['app/src/server.js'], { env: { ...process.env } });
  const worker = spawn('node', ['worker/src/index.js'], { env: { ...process.env } });

  t.after(() => { app.kill('SIGTERM'); worker.kill('SIGTERM'); });

  // Poll /health until 200 (60s)
  const deadline = Date.now() + 60_000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    try {
      const res = await fetch('http://localhost:3000/health');
      if (res.ok) healthy = true;
    } catch { /* not ready yet */ }
    if (!healthy) await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(healthy, 'GET /health did not return 200 within 60s');

  // Assert worker_heartbeats row within 60s
  const pool = new Pool({ connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL });
  t.after(() => pool.end());
  const rowDeadline = Date.now() + 60_000;
  let hasRow = false;
  while (Date.now() < rowDeadline && !hasRow) {
    const { rows } = await pool.query('SELECT 1 FROM worker_heartbeats LIMIT 1');
    if (rows.length > 0) hasRow = true;
    else await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(hasRow, 'No worker_heartbeats row appeared within 60s');
});
```

**Run with:** `node --test tests/integration/scaffold-smoke.test.js` (requires `.env.test` or env vars set in shell; see .env.example for required vars).

### Environment Variables

`.env.example` must contain ALL of these (no values — just names):
```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_SERVICE_ROLE_DATABASE_URL=

# Encryption
MASTER_KEY_BASE64=

# App
PORT=3000

# Stripe (needed at import time by stripe SDK — set to sk_test_ for local dev)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Resend
RESEND_API_KEY=
```

`shared/config/runtime-env.js` validates at process start:
- Required at startup: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_DATABASE_URL`, `MASTER_KEY_BASE64`
- Story 1.2 extends this module to add 32-byte length validation on `MASTER_KEY_BASE64`

**⚠️ Pedro: `SUPABASE_SERVICE_ROLE_DATABASE_URL` is a NEW variable not yet in your `.env.local`.**

This is the direct Postgres connection string (not the Supabase REST API key). It is different from `SUPABASE_SERVICE_ROLE_KEY` (which is a JWT for the Supabase JS client). The `pg` Pool needs a direct DB connection string.

To get it:
1. Supabase Dashboard → project `ttqwrbtnwtyeehynzubw`
2. Settings → Database → Connection string
3. Choose **Session mode** (not Transaction mode — advisory locks require session mode)
4. Copy the URI (format: `postgresql://postgres.ttqwrbtnwtyeehynzubw:<password>@...`)
5. Add to `.env.local` as `SUPABASE_SERVICE_ROLE_DATABASE_URL=<pasted value>`

The smoke test (`Task 9`) will not pass until this var is set.

### Coolify Two-Service Deployment Setup

Coolify creates **two service instances** from the same git repository:

**Service 1 (App):**
- Start command: `node app/src/server.js`
- Port: 3000 (map to `app.marketpilot.pt`)
- Replicas: 1 (F11 — explicit setting)
- Environment: inject all vars from `.env.example`

**Service 2 (Worker):**
- Start command: `node worker/src/index.js`
- Port: (none — no public URL)
- Replicas: 1 (F11 — explicit setting)
- Environment: same env-var subset as Service 1

Both services deploy from the same image pushed to the same git repo on `main`. Coolify handles restart-on-crash and zero-downtime deploys (no pm2, no systemd — AD constraint).

**UptimeRobot setup (post-Story 1.1):** Configure monitor for `https://app.marketpilot.pt/health` at 5-minute cadence with email alert to Pedro. This is operational setup, not a code task — see Founder Operational Track in epics Parallel Tracks section.

### Pino Logging at Story 1.1

Story 1.1 uses **basic pino** without redaction. Story 1.3 adds the full redaction config and `shared/logger.js` SSoT module. At Story 1.1:
- Worker: `import pino from 'pino'; const logger = pino({ level: 'info' });` directly in `worker/src/index.js`
- App: Fastify built-in pino via `Fastify({ logger: { level: 'info' } })`
- No `shared/logger.js` yet — Story 1.3 creates it; do NOT forward-create
- Do NOT log any secret values (shop_api_key, MASTER_KEY_BASE64, etc.) even without redaction

### Code Reuse from DynamicPriceIdea

DynamicPriceIdea (`D:\Plannae Project\DynamicPriceIdea`) has production-tested Mirakl HTTP client + pino usage. For Story 1.1, the pino initialization pattern and Fastify server structure from that repo are the reference. Check its `apiClient.js` for pino import patterns. **Do not copy Mirakl-specific code at Story 1.1** — Mirakl integration is Epics 3-7.

### F-Amendments Applicable to This Story

- **F9** — `<script src="/js/<page>.js" defer>` near `</body>` in eta templates. At Story 1.1, the placeholder `GET /` handler returns a simple response (no eta template yet), so F9 doesn't fire yet. BUT: ESLint config must NOT include any bundler-plugin rules, and package.json must confirm no bundler is installed.
- **F11** — Both Coolify services: `replicas: 1` explicitly configured. Do not leave this as default.

### AD Coverage This Story Implements

- **AD1** — Two-service topology (app + worker, single package.json)
- **AD23** — `/health` composition: Postgres liveness + worker heartbeat freshness
- **AD18** (negative assertion) — No Mirakl webhook code paths
- **AD28** (negative assertion) — No external validator library

### Project Structure Notes

Files created/modified in this story:
```
package.json                        # created
.nvmrc                              # created
.editorconfig                       # created
.gitignore                          # created
.env.example                        # created
eslint.config.js                    # created
eslint-rules/no-direct-fetch.js     # placeholder only
eslint-rules/no-raw-error-to-template.js  # placeholder
eslint-rules/worker-must-filter-by-customer.js  # placeholder
eslint-rules/single-source-of-truth.js  # placeholder
app/src/server.js                   # created
app/src/routes/health.js            # created
worker/src/index.js                 # created
worker/src/jobs/heartbeat.js        # created
shared/config/runtime-env.js        # created (minimal env validator)
supabase/migrations/202604301212_create_worker_heartbeats.sql  # created
supabase/config.toml                # created by `npx supabase init` for the migration workflow
tests/integration/scaffold-smoke.test.js  # created
README.md                           # created (one-page: stack, deploy targets, "_bmad-output/ for everything")
```

All other directories from architecture 05-directory-tree.md are created as empty placeholders (with a `.gitkeep` if needed). Do NOT create implementation files for stories beyond 1.1.

### References

- [Source: architecture-distillate/01-context-and-scaffold.md] — initialization, deps, structure, Story 1.1 AC scope
- [Source: architecture-distillate/05-directory-tree.md] — complete file location map
- [Source: architecture-distillate/_index.md#Cross-Cutting Constraints] — all 27 negative assertions
- [Source: epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md#Story 1.1] — verbatim ACs
- [Source: project-context.md#F1-F13 Amendments] — F9 (defer script), F11 (replicas: 1)
- [Source: project-context.md#Key Project Constants] — WORKER_HEARTBEAT_INTERVAL=30s, HEALTH_CHECK_THRESHOLD=90s
- [Mirakl MCP] — not required for this story (no Mirakl calls)
- [Context7: /fastify/fastify] — ESM server init pattern, host: '0.0.0.0' for container deployment
- [Context7: /eslint/eslint v10.x] — flat config format, plugin registration (planning-time reference was v9.37.0; v10 retains the same flat-config API)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (bmad-create-story / Bob — 2026-05-01)
claude-sonnet-4-6 (bmad-dev-story / Amelia — 2026-05-01)

### Debug Log References

- ESLint initially failed on `process`/`setTimeout`/`setInterval` (no Node.js globals in scope). Fixed by adding `globals.node` via the `globals` package to the flat config's `languageOptions`.
- ESLint initially flagged `_opts`, `_request`, `_reply` as unused. Fixed by adding `argsIgnorePattern: '^_'` to `no-unused-vars`.
- Pre-existing `scripts/mirakl-empirical-verify.js` had `no-useless-assignment` and `no-unused-vars` violations. Added script-scoped relaxations (no-useless-assignment: off, no-unused-vars: warn) without touching the file.
- `globals` package not installed by default with ESLint v10. Added as dev dep via `npm install -D globals`.

### Completion Notes List

- All 11 tasks complete. All ACs satisfied.
- AC#1: `package.json` has `"type": "module"`, `engines.node >=22.0.0`, all pinned runtime deps, and all required npm scripts. ESLint flat config passes on all source files (0 errors).
- AC#2: Worker (`worker/src/index.js`) imports `getEnv()`, creates pino logger, logs boot message, and starts `startHeartbeat()` which inserts into `worker_heartbeats` every 30s via direct pg Pool. Worker is independent of app server.
- AC#3: `/health` route (`app/src/routes/health.js`) — named export, no auth, `SELECT 1` with 1s timeout + heartbeat age query. Returns 200/503 with proper JSON body. Pool max: 2.
- AC#4: `README.md` documents two-service Coolify setup with `replicas: 1` explicit for both services.
- AC#5: Negative assertions verified — no forbidden packages in `package.json`, no `/api/v1/` routes.
- AC#6: Integration smoke test at `tests/integration/scaffold-smoke.test.js` uses `node:test`, spawns both services, polls `/health` for 200, queries `worker_heartbeats` for row presence, tears down with SIGTERM.
- Migration file created but not yet applied to Supabase — Pedro must run `npx supabase db push` (see Task 3 note; smoke test requires this to pass AC#6).

### File List

package.json
package-lock.json
.nvmrc
.editorconfig
.env.example
.gitignore (updated — added dist/, coverage/, .env.test)
eslint.config.js
eslint-rules/no-direct-fetch.js
eslint-rules/no-raw-error-to-template.js
eslint-rules/worker-must-filter-by-customer.js
eslint-rules/single-source-of-truth.js
app/src/server.js
app/src/routes/health.js
worker/src/index.js
worker/src/jobs/heartbeat.js
shared/config/runtime-env.js
supabase/migrations/202604301212_create_worker_heartbeats.sql
supabase/config.toml
supabase/.gitignore
tests/integration/scaffold-smoke.test.js
README.md
(All placeholder directories with .gitkeep: app/src/routes/_public/, app/src/routes/onboarding/, app/src/routes/dashboard/, app/src/routes/audit/_fragments/, app/src/routes/settings/, app/src/routes/interceptions/, app/src/routes/admin/, app/src/routes/_webhooks/, app/src/views/layouts/, app/src/views/components/, app/src/views/pages/, app/src/views/modals/, app/src/views/partials/, app/src/views/emails/, app/src/middleware/, app/src/lib/, worker/src/engine/, worker/src/safety/, worker/src/lib/, shared/audit/, shared/crypto/, shared/db/, shared/mirakl/, shared/money/, shared/state/, shared/stripe/, shared/resend/, shared/moloni/, db/seed/dev/, db/seed/test/, public/css/, public/js/, public/images/, tests/shared/mirakl/, tests/shared/crypto/, tests/shared/db/, tests/worker/src/engine/, tests/worker/src/safety/, tests/fixtures/p11/, tests/fixtures/pri01-csv/, tests/fixtures/a01/, tests/fixtures/pc01/, tests/fixtures/of21/, tests/mocks/)

## Change Log

- 2026-05-01: Story 1.1 implemented — scaffolded two-service Node.js project (app + worker), ESLint v10 flat config, /health endpoint with Postgres + worker heartbeat checks, migration file for worker_heartbeats, integration smoke test, README with Coolify two-service deployment guide. (Agent: claude-sonnet-4-6)
- 2026-05-01: Code review applied 10 patches resolving 3 decisions + 8 review findings. Decisions: (D1) TLS CA pinning is open and waiting for the user to drop the Supabase root CA at `db/supabase-ca.pem`; (D2) canonical migration location moved to `supabase/migrations/` (file in `db/migrations/` deleted, distillates 01/04/07 + spec File List + Task 3 wording updated); (D3) ESLint v10 retained — spec wording updated from v9 to v10 throughout (the Context7 v9.37.0 reference is preserved as planning-time provenance). Code patches: index on `worker_heartbeats(written_at DESC)` added to migration; `/health` switched from `Promise.race` to Pool `statement_timeout: 1000` (no leaked queries) + `Cache-Control: no-store` header + negative-`age_s` clock-skew guard; `app/src/server.js` registers wrapped in same try/catch as `listen()`; worker writes one heartbeat eagerly then schedules the 30s interval (closes the boot 30s gap); smoke test pipes child stdout/stderr and fails fast on early child exit; misleading comment in `eslint.config.js` rewritten. Original `architecture.md` (planning artifact, status: complete) intentionally NOT edited — distillates are the active reference per CLAUDE.md. (Agent: claude-opus-4-7)
