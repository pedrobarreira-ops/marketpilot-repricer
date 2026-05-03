# Story 2.1: RLS-aware app DB client + service-role worker DB client + transaction helper

Status: ready-for-dev

<!-- Carried requirements from Epic 1 retro Item 3 incorporated. integration_test_required: true -->

## Story

As the MarketPilot system,
I want all Postgres access to flow through three SSoT modules — `shared/db/rls-aware-client.js` (JWT-scoped RLS pool), `shared/db/service-role-client.js` (service-role pool centralizing conditional-SSL logic), and `shared/db/tx.js` (transaction helper) — bound to request scope by `app/src/middleware/rls-context.js`,
so that every customer-scoped query automatically enforces Postgres RLS, pool lifecycle + SIGTERM teardown is owned in one place, and the three ad-hoc inline `pg.Pool` instances from Stories 1.1/1.3/1.5 are absorbed into a single conditional-SSL helper that prevents SSL drift across future epics.

## Acceptance Criteria

1. **Given** `shared/db/rls-aware-client.js` exports `getRlsAwareClient(jwt)` **When** the app server receives a request with a valid Supabase Auth session **Then**:
    - The middleware `app/src/middleware/rls-context.js` reads `request.user.access_token` (set by `app/src/middleware/auth.js` in Story 1.5 — **NEVER re-reads the `mp_session` cookie**; the cookie contract is producer-Story-1.4 / reader-Story-1.5 — see Dev Notes) and calls `getRlsAwareClient(access_token)`.
    - The returned client is bound to `request.db` (NOT `request.pgClient`, NOT `request.pool`).
    - Every query through `request.db` executes in the JWT subject's Postgres role — RLS policies fire automatically, scoping results to `auth.uid()`.
    - The service-role key is NEVER reachable from this code path. Verified via grep: no `SUPABASE_SERVICE_ROLE_DATABASE_URL` import or usage in `app/src/routes/` or `app/src/middleware/rls-context.js`.
    - `rls-context.js` is wired as a `preHandler` hook on all authenticated route groups (same pattern as `auth.js` + `founder-admin-only.js` composition from Story 1.5). Runs AFTER `authMiddleware` (requires `request.user`).
    - Negative assertion: `shared/db/rls-aware-client.js` must NOT be imported in `worker/src/` (RLS-aware clients are app-layer only; worker uses service-role).

2. **Given** `shared/db/service-role-client.js` exports `getServiceRoleClient()` **When** the worker process boots (or `founder-admin-only.js` / `health.js` route first accesses the pool) **Then**:
    - The module exposes a single lazy-initialized `pg.Pool` via the `buildPgPoolConfig(connectionString, caCert)` helper described in Dev Notes (Library Empirical Contract #9 centralized here — NOT inline per-file).
    - Pool config: `max: 5`, `statement_timeout: 5000`. All callers (worker, health route, admin middleware) share this single pool singleton. The `max: 2` noted in earlier Stories 1.1/1.5 inline pools is superseded by `max: 5` here; five connections is appropriate for a single-worker MVP process that also serves the app's ops endpoints.
    - The worker can issue `pg_try_advisory_lock($1::bigint)` calls via this pool.
    - **Absorption**: the three existing inline `pg.Pool` instances are replaced with this module:
        - `app/src/routes/health.js` inline Pool → import `getServiceRoleClient()` from `shared/db/service-role-client.js`
        - `worker/src/jobs/heartbeat.js` inline Pool → import `getServiceRoleClient()` from `shared/db/service-role-client.js`
        - `app/src/middleware/founder-admin-only.js` inline Pool → import `getServiceRoleClient()` from `shared/db/service-role-client.js` (the `getFounderAdminPool` + `endFounderAdminPool` exports in `founder-admin-only.js` are refactored: `getFounderAdminPool` now delegates to `getServiceRoleClient`, `endFounderAdminPool` delegates to `closeServiceRolePool` — both sibling exports of `service-role-client.js`; see Dev Notes for the exact exported API).
    - **SIGTERM / shutdown hook**: `service-role-client.js` exports `closeServiceRolePool()` which calls `pool.end()`. `worker/src/index.js` registers `process.on('SIGTERM', ...)` + `process.on('SIGINT', ...)` handlers that call `closeServiceRolePool()`. `app/src/server.js` registers a Fastify `'closing'` lifecycle hook that calls `closeServiceRolePool()`. Both were deferred in Stories 1.1/1.5 (deferred-work.md); this story delivers them.
    - `shared/db/service-role-client.js` must NOT be imported in customer-scoped `app/src/routes/_public/` or `app/src/routes/_authenticated/` handlers (service-role key must not flow into customer-facing route handlers). Permitted callers: `app/src/routes/health.js` (ops endpoint, not customer-scoped), `app/src/middleware/founder-admin-only.js` (admin middleware, service-role lookup by design), and `shared/db/rls-aware-client.js` (borrows the connection pool to arm the JWT). The ESLint rule `no-direct-pg-in-app` catches direct `pg` imports; the service-role import restriction is enforced by code review + the negative-assertion test.

3. **Given** a service-role client and a callback **When** I call `tx(client, async (txClient) => { ... })` from `shared/db/tx.js` **Then**:
    - The helper issues `BEGIN`, runs the callback passing a transaction-bound `txClient`, issues `COMMIT` on success, issues `ROLLBACK` on any throw, and re-throws the original error after rollback.
    - **Nesting decision** (Bob's recommendation): Amelia picks ONE of:
        - (a) **Reject with error**: if `txClient` is a Pool/Client already inside an active transaction, throw `new TransactionNestingError('tx() does not support nested transactions — use savepoints explicitly')`. This is the simple/safe choice.
        - (b) **Savepoint support**: detect active transaction and emit `SAVEPOINT`, `RELEASE SAVEPOINT` / `ROLLBACK TO SAVEPOINT` semantics.
        - The chosen behaviour is documented in a JSDoc `@throws` note AND verified by the integration test case `tx_helper_nesting_behaviour_documented`.
    - The helper is exported as named `export async function tx(client, callback)`.
    - Advisory-lock compatibility: callers can pass a connection-level `pg.Client` (checked out from the pool) OR a pool directly; the helper must handle both (if pool passed, check out a client before `BEGIN`; release on COMMIT/ROLLBACK).

4. **Given** an integration test **When** I run `node --test tests/shared/db/clients.test.js` (scaffold already committed via Epic-Start) **Then** all the following test cases pass:
    - `rls_aware_client_scopes_to_jwt_subject` — SELECT via JWT-A returns only customer-A rows; SELECT via JWT-B returns only customer-B rows.
    - `rls_context_middleware_binds_request_db` — middleware extracts `request.user.access_token`, calls `getRlsAwareClient`, attaches result as `request.db`; verified via in-process Fastify `inject` with a fixture route that returns `typeof request.db !== 'undefined'`.
    - `service_role_client_bypasses_rls` — SELECT via `getServiceRoleClient()` pool returns rows from ALL customers; `pool.options.max <= 5`.
    - `service_role_client_supports_advisory_locks` — `SELECT pg_try_advisory_lock(99999999::bigint)` returns without error via `getServiceRoleClient()`.
    - `tx_helper_commits_on_success` — row is visible in DB after successful callback.
    - `tx_helper_rolls_back_on_throw` — row is NOT visible in DB after callback throws.
    - `tx_helper_nesting_behaviour_documented` — either ConcurrentTransactionError OR savepoint RELEASE/ROLLBACK path — one test case asserting the documented path; nesting behaviour must match the JSDoc `@throws`/`@note` in `shared/db/tx.js`.
    - `eslint_no_direct_pg_in_app_rule_fires_on_violation` — run ESLint programmatically (`new Linter()` from `eslint`) on a fixture file that contains `import { Pool } from 'pg'`; assert at least one reported message matching the rule ID `no-direct-pg-in-app`.
    - `negative_assertion_no_direct_pg_pool_in_app_routes` — code-grep (via `fs.readdirSync` recursive read): no raw `from 'pg'` import in `app/src/routes/` or `app/src/middleware/rls-context.js` after absorption.
    - `negative_assertion_service_role_client_not_importable_in_app_src_authenticated_routes` — code-grep: no `service-role-client` import in `app/src/routes/_public/**/*.js` or `app/src/routes/_authenticated/**/*.js` (permitted exceptions: `app/src/routes/health.js`).
    - `negative_assertion_rls_aware_client_not_importable_in_worker_src` — code-grep: no `rls-aware-client` import in `worker/src/**/*.js`.
    - **Integration test gate**: Story 2.1 is tagged `integration_test_required: true`. Phase 4.5 (Pedro runs `npm run test:integration` locally against local Supabase) fires before bad-review. Two test users required; test setup MUST call `resetAuthAndCustomers()` (Story 1.4 helper) before seeding.

5. **Given** the ESLint configuration **When** I write `import { Pool } from 'pg'` directly inside `app/src/` (outside `shared/db/`) **Then**:
    - A new custom ESLint rule `eslint-rules/no-direct-pg-in-app.js` flags it with message: *"Direct `pg` Pool/Client instantiation forbidden in app/src/. Use `getRlsAwareClient(jwt)` for customer queries (shared/db/rls-aware-client.js) or `getServiceRoleClient()` for ops queries (shared/db/service-role-client.js)."*
    - The rule fires on: `import pg from 'pg'`, `import { Pool } from 'pg'`, `import { Client } from 'pg'`, `new Pool(` (in any `app/src/` file), `new Client(` (in any `app/src/` file).
    - The absorbed files (`health.js`, `founder-admin-only.js`) must pass the rule after refactoring (they no longer contain direct `pg` import).
    - The rule does NOT fire in `shared/db/` (the SSoT modules own raw pg access), `worker/src/` (separate worker-level convention), or `tests/` (test helpers may use service-role pool directly).
    - `eslint.config.js` is updated to load `no-direct-pg-in-app` rule with `error` severity scoped to `app/src/**/*.js`.
    - Verified by the integration test case `eslint_no_direct_pg_in_app_rule_fires_on_violation` (run ESLint programmatically on a fixture file containing `import { Pool } from 'pg'`).

## Tasks / Subtasks

- [ ] **Task 1: Create `shared/db/service-role-client.js` with `buildPgPoolConfig` + absorption of 3 pools** (AC: #2, #5)
    - [ ] Create `shared/db/service-role-client.js`.
    - [ ] Implement `buildPgPoolConfig(connectionString, caCert, opts = {})` — Library Empirical Contract #9 canonical helper. Local-vs-Cloud SSL logic: `const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1'); return isLocal ? { connectionString, ...opts } : { connectionString, ssl: { ca: caCert }, ...opts };`
    - [ ] Lazy-init pool using `buildPgPoolConfig`: read `supabase/prod-ca-2021.crt` once at module level (via `fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8')`), create pool on first `getServiceRoleClient()` call.
    - [ ] Pool config: `connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL`, `max: 5`, `statement_timeout: 5000`.
    - [ ] Export: `getServiceRoleClient()`, `closeServiceRolePool()`, `buildPgPoolConfig` (for `rls-aware-client.js` to reuse).
    - [ ] ESM-safe `pg` import: `import pg from 'pg'; const { Pool } = pg;` (Library Empirical Contract #8).
    - [ ] JSDoc on all three exports.
    - [ ] Refactor `app/src/routes/health.js` — remove inline Pool; import `getServiceRoleClient` from `shared/db/service-role-client.js`. Pool access via `getServiceRoleClient().query(...)`.
    - [ ] Refactor `worker/src/jobs/heartbeat.js` — remove inline Pool; import `getServiceRoleClient` from `shared/db/service-role-client.js`. Remove inline `caCert` read + SSL config (now in SSoT helper).
    - [ ] Refactor `app/src/middleware/founder-admin-only.js` — remove inline Pool + `getPool()` + `caCert` read; import `getServiceRoleClient` from `shared/db/service-role-client.js`. Update `getFounderAdminPool()` to return `getServiceRoleClient()` (pool reference unchanged for tests that call `pool.end()`). Update `endFounderAdminPool()` to call `closeServiceRolePool()`.
    - [ ] Wire SIGTERM handlers: `worker/src/index.js` — add `process.on('SIGTERM', async () => { await closeServiceRolePool(); process.exit(0); })` (deferred-work.md Story 1.1 item "pg Pools never `.end()`ed"). `app/src/server.js` — add `fastify.addHook('onClose', async () => { await closeServiceRolePool(); })`.

- [ ] **Task 2: Create `shared/db/rls-aware-client.js`** (AC: #1)
    - [ ] Create `shared/db/rls-aware-client.js`.
    - [ ] `getRlsAwareClient(jwt)` — does NOT instantiate a long-lived pool per JWT (would leak). Instead: creates a short-lived `pg.Client` (NOT Pool), connects, sets `SET LOCAL role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '<user_id>';` via Supabase's `set_config('request.jwt.claims', ...)` pattern, returns a wrapper that closes the client automatically after use OR returns the client that caller must close after the request lifecycle. See Dev Notes for the exact pattern (Supabase uses `set_config('request.jwt', jwt, true)` + `SET ROLE authenticated`).
    - [ ] **Important**: the Supabase RLS pattern requires issuing `select set_config('request.jwt.claims', $1, true)` with the raw JWT string before each query batch. Use a pg Client checked out from the service-role pool, then run the set_config call, then the actual queries in the same connection, then release. This is the standard pattern — do NOT try to set a `role` per-session via `search_path` tricks.
    - [ ] Export `getRlsAwareClient(jwt)` as named export.
    - [ ] JSDoc on the export.
    - [ ] Must NOT import or re-export the service-role key.

- [ ] **Task 3: Create `app/src/middleware/rls-context.js`** (AC: #1)
    - [ ] Create `app/src/middleware/rls-context.js`.
    - [ ] Reads `request.user.access_token` (set by `auth.js` Story 1.5 — NEVER re-reads `mp_session` cookie).
    - [ ] Calls `await getRlsAwareClient(access_token)` and binds result to `request.db`.
    - [ ] If `request.user` is missing (middleware wired without `authMiddleware` as prerequisite): throw `new Error('rls-context requires auth.js as a prior preHandler hook on this route')` (fail-loud pattern from `founder-admin-only.js`).
    - [ ] Export `rlsContext` as named async preHandler function AND export a companion `releaseRlsClient` (or equivalent `onResponse` hook) for pool lifecycle cleanup.
    - [ ] Wire `onResponse` cleanup so the pool client is released after every request — pool leak prevention is IN SCOPE (see Dev Notes).
    - [ ] Forward-dependency comment: `// Story 4.x route handlers read request.db for customer-scoped queries. Do not remove from preHandler chain.`

- [ ] **Task 4: Create `shared/db/tx.js`** (AC: #3)
    - [ ] Create `shared/db/tx.js`.
    - [ ] Implement `tx(client, callback)` — BEGIN/COMMIT/ROLLBACK helper.
    - [ ] Choose nesting behaviour (ConcurrentTransactionError OR savepoints) and document via JSDoc.
    - [ ] Export `tx` as named export. Export the nesting-error class (if chosen) as `TransactionNestingError`.
    - [ ] JSDoc on `tx` with `@param`, `@returns`, `@throws`.

- [ ] **Task 5: Write / extend `tests/shared/db/clients.test.js`** (AC: #4)
    - [ ] Test file scaffold was committed at Epic-Start. Amelia fills in the implementation at ATDD step.
    - [ ] Uses `node:test` + `node:assert/strict` pattern (consistent with Stories 1.4 / 1.5).
    - [ ] Test setup: `resetAuthAndCustomers()` (Story 1.4 helper), then sign up two test customers via `POST /signup` OR directly via service-role pool + Supabase `auth.admin.createUser` (whichever is more stable — document choice).
    - [ ] JWT acquisition for `rls_aware_client_*` tests: `createClient(url, anonKey).auth.signInWithPassword({ email, password })` to get `access_token` for each test user.
    - [ ] Pool teardown in `t.after`: `await closeServiceRolePool()`.
    - [ ] `t.beforeEach`: `await resetAuthAndCustomers()`.
    - [ ] Run command: `node --env-file=.env.test --test tests/shared/db/clients.test.js`.

- [ ] **Task 6: Create `eslint-rules/no-direct-pg-in-app.js` + update `eslint.config.js`** (AC: #5)
    - [ ] Implement the custom ESLint rule (AST: flag `ImportDeclaration` with `source.value === 'pg'` in files matching `app/src/**/*.js` outside `app/src/lib/supabase-clients.js` and outside any file that is in `shared/`). Also flag `new Pool(` and `new Client(` nodes in the same scope.
    - [ ] Update `eslint.config.js` to load and apply the rule.
    - [ ] Verify `npm run lint` passes with 0 errors after all absorptions in Task 1.

- [ ] **Task 7: Verify scaffold smoke test passes after pool absorption** (AC: #2, regression)
    - [ ] After Task 1's absorption of `heartbeat.js` pool via `buildPgPoolConfig` (conditional SSL), run `npm run test:smoke` against local Supabase.
    - [ ] This was the known-failing test in deferred-work.md Item 0 verification: "scaffold-smoke fails locally with 'The server does not support SSL connections' — SSL drift bug at heartbeat.js". The `buildPgPoolConfig` helper (which omits SSL for localhost) is the fix.
    - [ ] Expected outcome: scaffold-smoke passes 22/22 (was red until this story ships).
    - [ ] Document outcome in Change Log.

- [ ] **Task 8: Update `deferred-work.md` + JSDoc negative assertions** (housekeeping)
    - [ ] Mark the deferred-work.md Story 2.1 absorption items as resolved: `health.js` Pool, `heartbeat.js` Pool, `founder-admin-only.js` Pool, SIGTERM handler, conditional SSL helper, pool error-event handler (add `pool.on('error', ...)` in `service-role-client.js` to log but not crash).
    - [ ] Add pool error-event handler to `service-role-client.js`: `pool.on('error', (err) => { log.error({ err }, 'service-role pool idle client error'); });` per Node `pg` best practice (prevents uncaught exception on idle client drop).

## Dev Notes

### CRITICAL: `mp_session` Cookie Empirical Contract (Library Empirical Contract #2)

`app/src/middleware/rls-context.js` MUST NOT re-read the `mp_session` cookie.

- **Producer**: Story 1.4 `app/src/routes/_public/login.js` writes `mp_session` signed cookie containing `{access_token, refresh_token}`.
- **Consumer 1**: Story 1.5 `app/src/middleware/auth.js` reads the cookie, validates JWT via `supabase.auth.getUser(access_token)`, decorates `request.user = { id, email, access_token, refresh_token }`.
- **Consumer 2 (this story)**: `app/src/middleware/rls-context.js` reads `request.user.access_token` — NOT the cookie. The JWT is already validated and extracted by `auth.js`. Re-reading the cookie a second time would be redundant and violates the producer/consumer contract.

If `request.user` is absent (middleware wired without `authMiddleware`): fail-loud with a runtime Error (same pattern as `founder-admin-only.js` Story 1.5 AC#3 guard).

### CRITICAL: Pools Being Absorbed (Retro Item 3 — all 3 must be enumerated)

Story 2.1 absorbs these three inline `pg.Pool` instances:

| File | Absorbed by | SSL behavior before | SSL behavior after |
|------|-------------|--------------------|--------------------|
| `app/src/routes/health.js` | `getServiceRoleClient()` | Hard-coded `ssl: { ca: caCert }` — broke local tests | `buildPgPoolConfig` — localhost omits SSL |
| `worker/src/jobs/heartbeat.js` | `getServiceRoleClient()` | Hard-coded `ssl: { ca: caCert }` — broke local tests (root cause of scaffold-smoke failure) | `buildPgPoolConfig` — localhost omits SSL |
| `app/src/middleware/founder-admin-only.js` | `getServiceRoleClient()` + `getFounderAdminPool()` delegation | Conditional per-pool (Story 1.5 deviation) | `buildPgPoolConfig` — centralized |

The `getFounderAdminPool` / `endFounderAdminPool` NAMED exports on `founder-admin-only.js` MUST SURVIVE as they are used by the integration test `tests/integration/admin-middleware.test.js` for pool teardown. After refactoring:

```js
// app/src/middleware/founder-admin-only.js (after Story 2.1 absorption)
import { getServiceRoleClient, closeServiceRolePool } from 'shared/db/service-role-client.js';

/** @deprecated - delegates to shared/db/service-role-client.js; preserved for admin-middleware.test.js teardown */
export function getFounderAdminPool () { return getServiceRoleClient(); }
/** @deprecated - delegates to shared/db/service-role-client.js; preserved for admin-middleware.test.js teardown */
export async function endFounderAdminPool () { return closeServiceRolePool(); }
```

### `buildPgPoolConfig` — Conditional SSL Helper (Library Empirical Contract #9 Centralization)

This is the SSL drift root cause fix from retro Item 3. The helper centralizes the localhost detection that was copy-pasted across three files:

```js
// shared/db/service-role-client.js
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const { Pool } = pg;

const caCert = fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8');

/**
 * Build a pg Pool config with environment-appropriate SSL settings.
 * Local Postgres (localhost/127.0.0.1) does not support SSL.
 * Supabase Cloud requires SSL with CA pinning.
 *
 * @param {string} connectionString - postgres:// connection URL
 * @param {string} caCert - PEM-encoded CA certificate (ignored for localhost)
 * @param {object} [opts={}] - Additional pool config (max, statement_timeout, etc.)
 * @returns {object} pg Pool constructor config
 */
export function buildPgPoolConfig (connectionString, caCertStr, opts = {}) {
  const isLocal =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1');
  return isLocal
    ? { connectionString, ...opts }
    : { connectionString, ssl: { ca: caCertStr }, ...opts };
}

let _pool = null;

export function getServiceRoleClient () {
  if (_pool === null) {
    _pool = new Pool(buildPgPoolConfig(
      process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
      caCert,
      { max: 5, statement_timeout: 5000 }
    ));
    _pool.on('error', (err) => {
      // Library best practice: handle idle client errors to prevent uncaught exception crash.
      // Do NOT exit process here — log and let the next query surface the issue.
      // Note: shared/logger.js cannot be imported here at module-scope without a circular dep
      // risk; use process.stderr directly (this is an emergency path, not a normal log line).
      // ESLint no-console exception: pool error handler is an uncaught-exception safety net.
      // eslint-disable-next-line no-console
      console.error('[service-role-client] pool idle client error — unreleased client or network drop:', err.message);
    });
  }
  return _pool;
}

export async function closeServiceRolePool () {
  if (_pool !== null) {
    await _pool.end();
    _pool = null;
  }
}
```

**Failure mode if `buildPgPoolConfig` is NOT used** (Library Empirical Contract #9 violation): scaffold-smoke test times out locally because `heartbeat.js` writes to `worker_heartbeats` fail with `Error: The server does not support SSL connections`. `/health` returns 503 forever in local dev. This is the exact failure documented in `deferred-work.md` (Item 0 verification). This story is the fix.

### `getRlsAwareClient` — RLS Set-Config Pattern

Supabase uses `set_config('request.jwt.claims', jwt_string, true)` + `SET ROLE authenticated` to arm RLS for a connection. The canonical pattern for a per-request client:

```js
// shared/db/rls-aware-client.js
import { getServiceRoleClient } from './service-role-client.js';

/**
 * Returns a pg client with RLS armed for the given JWT subject.
 * The caller MUST call client.release() after the request lifecycle.
 * Or use via rls-context.js middleware which handles lifecycle.
 *
 * NEVER imports service-role key or exposes it.
 *
 * @param {string} jwt - Supabase Auth access_token (raw JWT string)
 * @returns {Promise<import('pg').PoolClient>} armed pg PoolClient
 */
export async function getRlsAwareClient (jwt) {
  const pool = getServiceRoleClient(); // uses service-role conn but overrides role + jwt
  const client = await pool.connect();
  try {
    // Arm RLS: set the JWT claims so auth.uid() returns the correct user
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
      [jwt]
    );
    // Also explicitly set the role (belt-and-suspenders)
    await client.query(`SET LOCAL ROLE authenticated`);
  } catch (err) {
    client.release(err); // release with error to flag client as unusable
    throw err;
  }
  return client;
}
```

**Note to Amelia**: Verify via the integration test `rls_aware_client_scopes_to_jwt_subject` that this pattern actually scopes rows to the JWT subject. Supabase's RLS uses `auth.uid()` which reads from the `request.jwt.claims.sub` config value. If the above pattern does not produce correct RLS scoping, check:
1. Whether Supabase requires the full JWT string passed to `set_config` or just the `sub` claim
2. Whether `SET ROLE authenticated` is needed in addition to `set_config`

The empirical test is authoritative; adjust the implementation to match RLS scoping. Document the final pattern in the Change Log as a Library Empirical Contract candidate (if it deviates from the above).

### `rls-context.js` — Middleware Pattern

```js
// app/src/middleware/rls-context.js
import { getRlsAwareClient } from 'shared/db/rls-aware-client.js';

export async function rlsContext (request, reply) {
  // Fail-loud: requires auth.js as a prior preHandler hook
  if (!request.user || typeof request.user.access_token !== 'string') {
    throw new Error('rls-context requires auth.js as a prior preHandler hook on this route');
  }
  // DO NOT re-read mp_session cookie — auth.js already extracted and validated the JWT
  // Story 1.5 forward-dependency note: request.user.access_token is set by auth.js
  request.db = await getRlsAwareClient(request.user.access_token);
  // request.db is a pg.PoolClient; must be released after request completes.
  // onResponse hook below handles this. Do NOT forget to wire it (see below).
}
```

**Pool leak prevention (IN SCOPE for Story 2.1)**: `request.db` is a `pg.PoolClient` that must be `client.release()`d after the request. This is mandatory — not optional. Wire an `onResponse` hook in `rls-context.js` itself (exported as part of the preHandler registration):

```js
// app/src/middleware/rls-context.js — include the onResponse cleanup
// Option A: export both and wire together in server.js route group
export async function releaseRlsClient (request) {
  if (request.db) {
    request.db.release();
    request.db = null;
  }
}

// In the route group that uses rlsContext (app/src/server.js or plugin):
// instance.addHook('preHandler', rlsContext);
// instance.addHook('onResponse', releaseRlsClient);
```

Amelia chooses the specific wiring approach (exported pair, or a single function that registers both hooks) and documents it in the Change Log. The `rls_context_middleware_binds_request_db` integration test must verify that after a request completes, the pool client has been released (assert `pool.totalCount === pool.idleCount` OR verify no pool-exhaustion after N requests).

### `tx.js` — Transaction Helper

```js
// shared/db/tx.js

/**
 * Wraps a callback in a Postgres transaction.
 * Commits on success; rolls back and re-throws on any Error.
 *
 * Nesting: [Amelia fills in chosen behaviour here].
 *
 * @param {import('pg').PoolClient | import('pg').Pool} client - pg client or pool
 * @param {function(import('pg').PoolClient): Promise<*>} callback - work to run inside transaction
 * @returns {Promise<*>} - result of callback
 * @throws {Error} - re-throws callback error after rollback
 */
export async function tx (client, callback) {
  // If pool passed, check out a client first
  let txClient = client;
  let mustRelease = false;
  if (typeof client.connect === 'function') {
    // It's a pool; check out a client
    txClient = await client.connect();
    mustRelease = true;
  }
  try {
    await txClient.query('BEGIN');
    const result = await callback(txClient);
    await txClient.query('COMMIT');
    return result;
  } catch (err) {
    await txClient.query('ROLLBACK');
    throw err;
  } finally {
    if (mustRelease) txClient.release();
  }
}
```

### SIGTERM / Shutdown Discipline

These are the deferred-work.md items from Story 1.1 and Story 1.5:

**Worker (`worker/src/index.js`):**
```js
import { closeServiceRolePool } from 'shared/db/service-role-client.js';

async function shutdown (signal) {
  log.info({ signal }, 'worker shutting down');
  await closeServiceRolePool();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

**App (`app/src/server.js`):**
```js
import { closeServiceRolePool } from 'shared/db/service-role-client.js';

fastify.addHook('onClose', async () => {
  await closeServiceRolePool();
});
```

### ESLint Rule `no-direct-pg-in-app`

The rule targets `app/src/**/*.js` files (NOT `shared/db/`, NOT `worker/src/`, NOT `tests/`). It must fire on:
- `import pg from 'pg'` — any pg import in app/src
- `import { Pool } from 'pg'` — same
- `import { Client } from 'pg'` — same
- `new Pool(` — instantiation
- `new Client(` — instantiation

The rule does NOT apply to `shared/db/` (which legitimately owns all raw pg access).

Pattern from Story 3.1 (`no-direct-fetch`) — use the same structural approach: check `ImportDeclaration.source.value === 'pg'` + `NewExpression.callee.name` for Pool/Client.

### `pg` ESM Import (Library Empirical Contract #8)

ALWAYS: `import pg from 'pg'; const { Pool } = pg;`
NEVER: `import { Pool } from 'pg';` — fails at ESM module resolution.

This applies in `shared/db/service-role-client.js` and any other file that needs `pg` internals.

### Token Budget Note

Story 2.1 has no UI surface and no Mirakl API calls. Pattern A/B/C does not apply. No Mirakl MCP verification required (per task instructions — this is a DB client layer story).

### Architecture Constraints Relevant to This Story

| Constraint | Enforcement |
|---|---|
| No direct `pg` import in `app/src/` | ESLint `no-direct-pg-in-app` (ships here) |
| Service-role key not reachable from app routes | Code-grep + integration test negative assertion |
| RLS-aware client not used in worker | Code-grep + integration test negative assertion |
| Named exports only (no default export) | ESLint `no-default-export` (Story 1.1) |
| No `console.log` | ESLint `no-console` (Story 1.1) |
| No async `.then()` chains | ESLint rule (Story 1.1) |
| SIGTERM graceful shutdown | New in this story — verified by test + PR |

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-03 | Story sharded. Status: ready-for-dev. Carried Epic 1 retro Item 3 requirements: integration_test_required, SSL helper centralization, pool enumeration, mp_session contract, Library Empirical Contracts #2/#3/#5/#9. | Bob (bmad-create-story) |
