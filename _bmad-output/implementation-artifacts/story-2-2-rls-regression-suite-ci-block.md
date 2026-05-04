# Story 2.2: RLS Regression Suite + CI Block

Status: review

<!-- integration_test_required: true -->

## Story

As the MarketPilot system,
I want a parameterized RLS regression suite (`scripts/rls-regression-suite.js` + `tests/integration/rls-regression.test.js`) backed by a two-customer seed file (`db/seed/test/two-customers.sql`) and wired to `npm run test:rls`,
so that every customer-scoped table is verified to enforce Postgres RLS isolation on every deploy — blocking any PR or deploy where a customer can read, insert, update, or delete another customer's rows.

## Acceptance Criteria

1. **Given** the seed file `db/seed/test/two-customers.sql` **When** I apply it to a fresh test Postgres **Then** two distinct customers exist with their own `customer_profiles` rows AND `shop_api_key_vault` rows (shop_api_key_vault seeded only after `customer_marketplaces` ships in Epic 4; see Dev Notes).

2. **Given** the regression suite `scripts/rls-regression-suite.js` **When** I run it **Then**:
   - For every customer-scoped table, the suite (a) authenticates as customer A via JWT, attempts SELECT/INSERT/UPDATE/DELETE on a row owned by customer B identified by ID, asserts 0 rows returned or operation rejected; (b) repeats with customer B's JWT against customer A's rows.
   - The suite covers (at this story's baseline): `customers`, `customer_profiles`, `shop_api_key_vault`.
   - The suite is parameterized via a `CUSTOMER_SCOPED_TABLES` registry array in `tests/integration/rls-regression.test.js` so that subsequent stories add their tables to a single config array — adding a table = one line change.

3. **Given** an `npm run test:rls` script **When** I run it **Then** the regression suite executes and reports per-table pass/fail **And** any failure exits with non-zero code.

4. **Given** a CI configuration (GitHub Actions or Coolify pre-deploy hook) **When** a PR runs CI or a deploy is triggered **Then** `npm run test:rls` runs and blocks on failure **And** the README documents the convention: every new customer-scoped table migration MUST extend the seed AND the suite in the same PR.

5. **Given** the convention **When** a developer (or BAD subagent) attempts to ship a customer-scoped table without extending the suite **Then** the test `convention_every_seed_table_is_in_regression_config` fails with a clear "table <name> present in seed but missing from CUSTOMER_SCOPED_TABLES registry" message.

## Tasks / Subtasks

- [x] **Task 1: Create `db/seed/test/two-customers.sql`** (AC: #1)
  - [x] Write SQL that signs up two distinct customers via Supabase Auth admin API calls (service-role-only pattern) OR inserts directly into `auth.users` + relies on `handle_new_auth_user` trigger to populate `customers` + `customer_profiles`.
  - [x] Seed two rows with distinct emails, first_name, last_name, company_name (all NOT NULL per trigger contract). Use a consistent email format like `customer-a@test.marketpilot.pt` / `customer-b@test.marketpilot.pt`.
  - [x] Verify that the trigger fires and both `customers` + `customer_profiles` rows are created for each auth user.
  - [x] Leave `shop_api_key_vault` seed as a TODO comment with clear instructions: "Epic 4 extends this file — insert a `customer_marketplaces` row first, then a `shop_api_key_vault` row per customer" (see Dev Notes for FK chain).
  - [x] Document the seed file's expected idempotency behavior (re-running should be safe or explicitly state it is not).

- [x] **Task 2: Create `scripts/rls-regression-suite.js`** (AC: #2, #3)
  - [x] Standalone Node.js script executable by `npm run test:rls`.
  - [x] Import `getServiceRoleClient` from `shared/db/service-role-client.js` for seeding rows and asserting cross-customer access.
  - [x] Import `getRlsAwareClient` from `shared/db/rls-aware-client.js` for JWT-scoped queries.
  - [x] Import JWT acquisition helper (Supabase `createClient(url, anonKey).auth.signInWithPassword({email, password})`).
  - [x] For each table in `CUSTOMER_SCOPED_TABLES` config array, run: SELECT A's row via JWT-B (expect 0 rows); INSERT with A's owner col via JWT-B (expect 0 rows or pg RLS rejection); UPDATE A's row via JWT-B (expect rowCount 0); DELETE A's row via JWT-B (expect rowCount 0). Repeat B→A.
  - [x] Exit with code 0 on all-pass; exit code 1 on any failure. Print per-table pass/fail to stdout.
  - [x] MUST use `buildPgPoolConfig` conditional SSL helper from `shared/db/service-role-client.js` — never hardcode `ssl: { ca: caCert }` directly (Library Empirical Contract #9 from Story 2.1).

- [x] **Task 3: Implement `tests/integration/rls-regression.test.js`** (AC: #2, #4, #5)
  - [x] The scaffold file is already committed at Epic-Start. Amelia fills in all `TODO (Story 2.2 ATDD)` placeholders.
  - [x] Wire `CUSTOMER_SCOPED_TABLES` registry with complete `seedHelper` + `cleanHelper` implementations for `customers`, `customer_profiles`, and `shop_api_key_vault` (shop_api_key_vault deferred — see Task 1 Dev Note).
  - [x] Implement `two_customers_seed_creates_two_distinct_customers`: apply `db/seed/test/two-customers.sql` via service-role pool; SELECT COUNT from `customers` WHERE email IN (...); assert count === 2.
  - [x] Implement parameterized isolation tests using `for ... of CUSTOMER_SCOPED_TABLES` loop generating sub-tests per table per operation.
  - [x] Implement `convention_every_seed_table_is_in_regression_config`: read `db/seed/test/two-customers.sql`; parse all `INSERT INTO <table>` (excluding `auth.users`); assert each appears in `CUSTOMER_SCOPED_TABLES`.
  - [x] Implement `test_rls_script_exits_nonzero_on_failure`: read `package.json`, assert `scripts['test:rls']` invokes `rls-regression-suite` AND does NOT contain `|| true` or `2>/dev/null`.
  - [x] Implement `negative_assertion_no_migration_missing_rls_policy`: read all SQL files in `supabase/migrations/` (the actual migrations directory — NOT `db/migrations/`); for each file containing `CREATE TABLE` for a customer-scoped table, assert a `CREATE POLICY` targeting that table exists in the same file (system-only tables exempt: `worker_heartbeats`, `founder_admins`). Note: `shop_api_key_vault` migration is currently `202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` (not yet applied) — the convention check must skip `.deferred-*` files.
  - [x] Use `node:test` + `node:assert/strict` (consistent with Epic 1 + Story 2.1 pattern — NO Jest/Vitest).
  - [x] Test teardown: `await closeServiceRolePool()` in `t.after`. `t.beforeEach`: `await resetAuthAndCustomers()`.

- [x] **Task 4: Add `npm run test:rls` to `package.json` + CI block** (AC: #3, #4)
  - [x] Verify `test:rls` already exists in `package.json` scripts (it was scaffolded: `"test:rls": "node --test tests/integration/rls-regression.test.js"`). Update if needed to also invoke `scripts/rls-regression-suite.js`.
  - [x] Update `test:rls` to use `--env-file=.env.test` so RLS tests run against local Supabase: `"test:rls": "node --env-file=.env.test --test tests/integration/rls-regression.test.js"`.
  - [x] Create or extend `.github/workflows/ci.yml` to run `npm run test:rls` on push/PR. If GitHub Actions not yet set up, document the Coolify pre-deploy hook approach instead.
  - [x] Update `test:integration` script to also include `rls-regression.test.js` for the full suite run.
  - [x] Add convention reminder to README: "Every new customer-scoped table migration MUST extend `db/seed/test/two-customers.sql` AND `tests/integration/rls-regression.test.js`'s `CUSTOMER_SCOPED_TABLES` array in the same PR."

- [x] **Task 5: Extend `shop_api_key_vault` RLS regression (Story 1.2 back-ported comment)** (AC: #1, #2)
  - [x] The `shop_api_key_vault` migration exists at `supabase/migrations/202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` (deferred — not yet applied to Supabase). Since the migration is deferred and not yet applied, update the migration file in-place. Current USING clause: `USING (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`. Change to: `USING (auth.uid() IS NOT NULL AND customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`. This is safe to do now since the migration hasn't been applied yet. The `shop_api_key_vault` RLS policy has a deferred comment from Story 1.2 review: "Add `auth.uid() IS NOT NULL AND ...` defensive clause when Story 2.2's RLS regression suite lands".
  - [x] The `shop_api_key_vault` table RLS seed + test MUST remain as a TODO until `customer_marketplaces` migration exists (Epic 4). Add the TODO comment with the FK chain clearly documented (see Dev Notes).
  - [x] Add `rls_isolation_shop_api_key_vault_deferred_awaiting_epic4` scaffold test that asserts the table exists in the DB and its RLS policy is active (check `pg_policies` system view) — even though the row-level isolation test itself is deferred.

## Dev Notes

### Architecture: AD30 — RLS Regression Suite Contract

From `architecture-distillate/03-decisions-E-J.md` (AD30):
- `scripts/rls-regression-suite.js` runs in CI
- Spins up test Postgres with seed data for 2 customers
- Attempts every mutation/query as customer A using customer B's IDs
- Asserts every attempt returns 0 rows or denied
- Blocks deploy on any test failure
- Coverage: every customer-scoped table (`customer_marketplace`, `sku_channel`, `audit_log`, `baseline_snapshot`, `customer_profile`, `shop_api_key_vault`, `moloni_invoices`, etc.)
- Each new customer-scoped-table story adds its row to the suite

### Extensibility Convention (Architecture AD30 + Epic 2 Test Plan)

The `CUSTOMER_SCOPED_TABLES` registry in `tests/integration/rls-regression.test.js` is the single extension point. Per the epic-2-test-plan.md, each new customer-scoped table story (Epics 4-11) MUST:
1. Include its RLS POLICY in the migration file.
2. Add a seed row for both test customers to `db/seed/test/two-customers.sql`.
3. Add one entry object to `CUSTOMER_SCOPED_TABLES` in `rls-regression.test.js`.

Failing step 3 causes `convention_every_seed_table_is_in_regression_config` to fail loudly.

### `shop_api_key_vault` FK Chain — Epic 4 Deferred Seed

`shop_api_key_vault.customer_marketplace_id` is a FK to `customer_marketplaces(id)` ON DELETE CASCADE. Since `customer_marketplaces` does NOT exist at Epic 2 baseline (it ships in Story 4.2), the `shop_api_key_vault` row-level RLS isolation tests are deferred. The pattern when Epic 4 ships:

```sql
-- db/seed/test/two-customers.sql (Epic 4 extension, to be added by Story 4.2)
INSERT INTO customer_marketplaces (id, customer_id, operator, marketplace_instance_url, cron_state, max_discount_pct)
VALUES
  ('<uuid-A>', '<customer-A-id>', 'WORTEN', 'https://marketplace.worten.pt', 'PROVISIONING', 0.015),
  ('<uuid-B>', '<customer-B-id>', 'WORTEN', 'https://marketplace.worten.pt', 'PROVISIONING', 0.015);

INSERT INTO shop_api_key_vault (customer_marketplace_id, ciphertext, nonce, auth_tag, master_key_version)
VALUES
  ('<uuid-A>', '\\xdeadbeef', '\\xdeadbeef', '\\xdeadbeef', 1),
  ('<uuid-B>', '\\xdeadbeef', '\\xdeadbeef', '\\xdeadbeef', 1);
```

### RLS Policy Pattern for Customer-Scoped Tables

From `architecture-distillate/06-database-schema.md` (RLS Policy Summary):
- Direct FK to `customers.id` tables: `USING (customer_id = auth.uid())`
- FK to `customer_marketplaces` tables: `USING (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`
- Two policies per table: `<table>_select_own` (SELECT) + `<table>_modify_own` (INSERT/UPDATE/DELETE where customer-write allowed)
- Read-only tables (SELECT policy only; no INSERT/UPDATE/DELETE by customers): `audit_log`, `cycle_summaries`, `daily_kpi_snapshots`

### SSoT Imports from Story 2.1 (REQUIRED — do NOT reinvent)

All DB client access MUST use the Story 2.1 SSoT modules:

```js
import { getServiceRoleClient, closeServiceRolePool, buildPgPoolConfig } from '../../shared/db/service-role-client.js';
import { getRlsAwareClient } from '../../shared/db/rls-aware-client.js';
```

**NEVER** create a new `pg.Pool` in test code or the regression suite. Use `getServiceRoleClient()` for service-role operations (seeding, cleanup, pg_policies check). Use `getRlsAwareClient(jwt)` for customer-scoped operations (RLS isolation assertions).

**Critical**: `getRlsAwareClient` returns a `pg.PoolClient` that MUST be released. Pattern:
```js
const client = await getRlsAwareClient(jwt);
try {
  const { rows } = await client.query('SELECT * FROM customers WHERE id = $1', [otherCustomerId]);
  assert.strictEqual(rows.length, 0, 'RLS must return 0 rows for cross-customer SELECT');
} finally {
  client.release();
}
```

### JWT Acquisition for Tests

Use `@supabase/supabase-js` `createClient(url, anonKey).auth.signInWithPassword({email, password})` — confirmed working pattern from Story 2.1's `clients.test.js`. The anon key is the Supabase project's `anon` public key (NOT the service-role key). Required env vars (from `.env.test`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

From Story 2.1 implementation note: pass decoded JWT claims JSON (not raw JWT string) to `set_config('request.jwt.claims', ...)`. The `getRlsAwareClient(jwt)` function in `shared/db/rls-aware-client.js` already handles this internally — just pass the raw `access_token` string to `getRlsAwareClient`.

### Two-Customer Seed: Trigger Contract

The `handle_new_auth_user` trigger on `auth.users` AFTER INSERT (`SECURITY DEFINER`) automatically creates `customers` + `customer_profiles` rows. The trigger requires `raw_user_meta_data` to contain `first_name`, `last_name`, `company_name` (all non-empty strings). The seed file must provide these via one of:
- Supabase admin API: `POST /auth/v1/admin/users` with `user_metadata: { first_name, last_name, company_name }`
- Direct SQL to `auth.users` with `raw_user_meta_data` JSONB populated (test-only pattern)

**PREFERRED APPROACH for the seed**: Do NOT use a `.sql` seed file for auth users — the `auth.users` schema is Supabase-internal and column layout changes between versions. Instead, implement the two-customer seeding in the test JS code via Supabase JS client admin calls. The `db/seed/test/two-customers.sql` file should contain ONLY the non-auth seed data (nothing if auth users are seeded in JS).

**Recommended seed implementation in the test file itself:**
```js
// tests/integration/rls-regression.test.js
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function seedTwoCustomers() {
  // Create customer A via admin API (triggers handle_new_auth_user)
  const { data: userA } = await supabaseAdmin.auth.admin.createUser({
    email: 'customer-a@test.marketpilot.pt',
    password: 'test-password-A-123',
    user_metadata: { first_name: 'TestA', last_name: 'CustomerA', company_name: 'Alpha Corp' },
    email_confirm: true,
  });
  // Create customer B via admin API
  const { data: userB } = await supabaseAdmin.auth.admin.createUser({
    email: 'customer-b@test.marketpilot.pt',
    password: 'test-password-B-123',
    user_metadata: { first_name: 'TestB', last_name: 'CustomerB', company_name: 'Beta Corp' },
    email_confirm: true,
  });
  return { userA, userB };
}
```

Then acquire JWTs via `signInWithPassword` with the anon client. Required env vars: `SUPABASE_SERVICE_ROLE_KEY` (for admin API) AND `SUPABASE_ANON_KEY` (for `signInWithPassword`).

**The `db/seed/test/two-customers.sql` file** should still be created (per AC#1 + the CUSTOMER_SCOPED_TABLES convention test that reads it) but it should be a SQL file that seeds only `public.*` tables (not auth). It can be a minimal placeholder that documents the intent — auth users are seeded programmatically in JS. OR if Pedro prefers a pure-SQL approach, insert into `auth.users` directly using the `SUPABASE_SERVICE_ROLE_DATABASE_URL` connection.

Reference Story 2.1's `tests/integration/_helpers/reset-auth-tables.js` for the auth schema column patterns used by `resetAuthAndCustomers()`. NOTE: `reset-auth-tables.js` has its OWN `pg.Pool` (pre-Story 2.1, predates the SSoT rule). This is acceptable — the ESLint `no-direct-pg-in-app` rule only covers `app/src/**/*.js`. The helper also has a SAFETY GUARD that refuses to operate on non-local Postgres (contains `localhost`/`127.0.0.1` check). Do NOT bypass this guard in test code.

### `node --test` Patterns (from Story 2.1 Empirical Contracts)

Use `node:test` (built-in). NO Jest, NO Vitest. Pattern from Story 2.1:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pool teardown
test('suite', { concurrency: 1 }, async (t) => {
  t.after(async () => { await closeServiceRolePool(); });
  t.beforeEach(async () => { await resetAuthAndCustomers(); });
  // ...
});
```

**CRITICAL — test concurrency**: From Story 1.5 review finding: "Cross-file test isolation: `node --test` runs files in parallel by default; two suites' `resetAuthAndCustomers()` calls race on shared `auth.users` rows." The `test:integration` script ALREADY uses `--test-concurrency=1`. Make sure `test:rls` also uses `--test-concurrency=1` if it invokes multiple files, OR run the RLS test file standalone.

### `buildPgPoolConfig` — Conditional SSL (Library Empirical Contract #9)

From Story 2.1 Dev Notes: ALWAYS use `buildPgPoolConfig` from `shared/db/service-role-client.js` when configuring any pg Pool. Never hardcode `ssl: { ca: caCert }` — this breaks local Supabase docker which does NOT support SSL. The `getServiceRoleClient()` singleton already handles this; simply use the singleton and do NOT create additional Pool instances.

### ESLint `no-direct-pg-in-app` (Story 2.1 ESLint Rule)

The custom rule fires on `import { Pool } from 'pg'` or `new Pool(` in `app/src/**/*.js`. It does NOT fire in `tests/` or `scripts/` — so `scripts/rls-regression-suite.js` is exempt. However, still prefer `getServiceRoleClient()` from the SSoT module to avoid SSL drift bugs.

### Existing Scaffold Status

The following files are already committed at Epic-Start and contain full scaffold + `TODO (Story 2.2 ATDD)` placeholders that Amelia must fill in:
- `tests/integration/rls-regression.test.js` — FULL scaffold with `CUSTOMER_SCOPED_TABLES` registry and all test stubs
- `db/seed/test/two-customers.sql` — EMPTY (only `.gitkeep` exists; Amelia creates from scratch)
- `scripts/rls-regression-suite.js` — DOES NOT EXIST yet (Amelia creates from scratch)

The `package.json` already has `"test:rls": "node --test tests/integration/rls-regression.test.js"` — update to add `--env-file=.env.test`.

### GitHub Actions CI Block

Architecture AD30 + NFR-I3 require CI to block deploys on RLS regression failure. Since no `.github/workflows/` directory exists yet, create `ci.yml`. Minimal approach:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  rls-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm run test:rls
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_DATABASE_URL: ${{ secrets.SUPABASE_SERVICE_ROLE_DATABASE_URL }}
          MASTER_KEY_BASE64: ${{ secrets.MASTER_KEY_BASE64 }}
```

**NOTE**: Running against Supabase Cloud in CI requires either (a) a CI-specific Supabase project or (b) a local Supabase docker service in the GitHub Actions job. For MVP, Pedro can configure CI to run against a dedicated test Supabase project (free tier). Alternatively, Coolify pre-deploy hook can run `npm run test:rls` against local Supabase before deploying. Document the chosen approach in the story Change Log.

### Deferred Finding from Story 1.2 Review — Apply Now

From `deferred-work.md` (code review of Story 1.2):
> **RLS policy silent-fail on `auth.uid()` NULL** — `supabase/migrations/202604301204_create_shop_api_key_vault.sql:42-44` returns 0 rows for anon (correct, but by SQL NULL semantics, not explicit). Add `auth.uid() IS NOT NULL AND ...` defensive clause when Story 2.2's RLS regression suite lands.

Apply this fix as part of Task 5. Since the migration exists at `supabase/migrations/202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` and is NOT YET APPLIED to any environment, update it in-place. Add `auth.uid() IS NOT NULL AND` before the existing predicate in the USING clause of the `shop_api_key_vault_select_own` policy. Do NOT create a separate patch migration — this is a pre-application fix to a deferred migration.

### Architecture Constraints Relevant to This Story

| Constraint | Source | Enforcement |
|---|---|---|
| No Jest/Vitest | Architecture cross-cutting constraint | `node --test` only |
| No direct `pg` in `app/src/` | ESLint `no-direct-pg-in-app` (Story 2.1) | N/A for scripts/ and tests/ |
| Named exports only | ESLint no-default-export (Story 1.1) | `export function ...` |
| No `console.log` (in production code) | ESLint no-console (Story 1.1) | Use pino logger; scripts/ may use console |
| Parameterized suite | AD30 spec | `CUSTOMER_SCOPED_TABLES` array |
| Service-role key not in app routes | AD2 | N/A for scripts/; used via `getServiceRoleClient()` |
| `buildPgPoolConfig` for SSL | Library Empirical Contract #9 (Story 2.1) | Use `getServiceRoleClient()` singleton |

### Token Budget Note

Story 2.2 has no UI surface and no Mirakl API calls. Pattern A/B/C does not apply. No Mirakl MCP verification required. This story is entirely database/auth testing infrastructure.

### Project Structure Notes

Files this story creates or modifies:
- `scripts/rls-regression-suite.js` — **CREATE** (does not exist)
- `tests/integration/rls-regression.test.js` — **MODIFY** (scaffold exists; fill in TODOs)
- `db/seed/test/two-customers.sql` — **CREATE** (only .gitkeep exists)
- `package.json` — **MODIFY** (update `test:rls` script, add `--env-file=.env.test`)
- `supabase/migrations/202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` — **MODIFY IN PLACE** (add `auth.uid() IS NOT NULL AND` to RLS USING clause; safe because migration is not yet applied)
- `.github/workflows/ci.yml` — **CREATE** (GitHub Actions CI block)

**CRITICAL PATH CORRECTION**: The actual migrations directory is `supabase/migrations/` (NOT `db/migrations/`). The directory tree in `architecture-distillate/05-directory-tree.md` shows `db/migrations/` but the real codebase uses `supabase/migrations/`. All test and script code reading migration files MUST use `supabase/migrations/`.

Also: `db/seed/test/` is the correct seed location (confirmed by checking the actual repo — `db/seed/test/.gitkeep` exists).

### References

- Story 2.2 AC spec: `_bmad-output/planning-artifacts/epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md` §Story 2.2
- AD30: `_bmad-output/planning-artifacts/architecture-distillate/03-decisions-E-J.md` §AD30
- DB schema + RLS policies: `_bmad-output/planning-artifacts/architecture-distillate/06-database-schema.md`
- Epic 2 Test Plan: `_bmad-output/implementation-artifacts/epic-2-test-plan.md`
- Story 2.1 SSoT modules (DEPEND ON): `shared/db/service-role-client.js`, `shared/db/rls-aware-client.js`, `shared/db/tx.js`, `app/src/middleware/rls-context.js`
- Deferred `auth.uid() IS NOT NULL` fix: `_bmad-output/implementation-artifacts/deferred-work.md` (Story 1.2 review section)
- Directory tree: `_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md`
- Integration test patterns: `tests/integration/admin-middleware.test.js`, `tests/shared/db/clients.test.js`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

All implementation delivered in ATDD commit `53c9f17` (2026-05-04). No debug cycles required — all files followed the Dev Notes patterns exactly (SSoT imports, node:test, no direct pg.Pool).

### Completion Notes List

- **Task 1 (db/seed/test/two-customers.sql):** Created. Auth users seeded via JS admin API (not SQL), so the seed file is a documentation placeholder + Epic 4 extension template. Valid SQL (SELECT 1 dummy statement for convention parser). Idempotency note: not idempotent on its own — resetAuthAndCustomers() must run before each test.
- **Task 2 (scripts/rls-regression-suite.js):** Created 306-line standalone Node.js ESM runner. Uses getServiceRoleClient() + getRlsAwareClient() SSoT modules. CUSTOMER_SCOPED_TABLES registry mirrors test file. Exits 0/1. shop_api_key_vault deferred (marked deferred:true). console.log allowed in scripts/ per architecture constraint table.
- **Task 3 (tests/integration/rls-regression.test.js):** Filled all TODO placeholders from scaffold. Implemented: two_customers_seed_creates_two_distinct_customers, parameterized isolation suite (SELECT/INSERT/UPDATE/DELETE A→B per table), convention_every_seed_table_is_in_regression_config, test_rls_script_exits_nonzero_on_failure, negative_assertion_no_migration_missing_rls_policy, rls_isolation_shop_api_key_vault_deferred_awaiting_epic4. node:test + node:assert/strict throughout. closeServiceRolePool() + endResetAuthPool() in t.after.
- **Task 4 (package.json + CI):** test:rls updated to --env-file=.env.test --test-concurrency=1 + also invokes rls-regression-suite.js. test:integration updated to include rls-regression.test.js. .github/workflows/ci.yml created with RLS regression + lint jobs (push/PR trigger). README convention note added.
- **Task 5 (shop_api_key_vault deferred fix):** Added auth.uid() IS NOT NULL defensive guard to shop_api_key_vault_select_own USING clause in deferred migration file (safe — migration not yet applied). Row-level isolation deferred; policy existence check runs in rls_isolation_shop_api_key_vault_deferred_awaiting_epic4 test.

### File List

- `.github/workflows/ci.yml` — CREATED (GitHub Actions CI block, RLS regression + lint jobs)
- `db/seed/test/two-customers.sql` — CREATED (seed documentation + Epic 4 extension template)
- `package.json` — MODIFIED (test:rls updated with --env-file=.env.test + rls-regression-suite.js invocation; test:integration extended)
- `scripts/rls-regression-suite.js` — CREATED (standalone RLS runner, exits 0/1)
- `supabase/migrations/202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` — MODIFIED (auth.uid() IS NOT NULL defensive guard added to select policy USING clause)
- `tests/integration/rls-regression.test.js` — MODIFIED (all TODO placeholders filled; full implementation)
- `README.md` — MODIFIED (RLS regression suite convention section added)

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-05-04 | Story sharded. Status: ready-for-dev. Context loaded from: epics-distillate 01, architecture-distillate _index + 03-decisions-E-J + 06-database-schema + 05-directory-tree + 04-implementation-patterns, epic-2-test-plan.md, Story 2.1 story file (previous story intelligence), deferred-work.md. Scaffold files located: rls-regression.test.js (full scaffold with TODOs), db/seed/test/ (empty), scripts/rls-regression-suite.js (does not exist). Key Dev Notes: SSoT import contract from Story 2.1, buildPgPoolConfig conditional SSL (Library Empirical Contract #9), auth.uid() IS NOT NULL deferred finding from Story 1.2 review, shop_api_key_vault Epic 4 deferral, JWT acquisition pattern, node --test concurrency. | Bob (bmad-create-story) |
| 2026-05-04 | Implementation complete (ATDD commit 53c9f17). All 5 tasks implemented: seed file, regression suite script, integration test (all TODOs filled), package.json + CI, shop_api_key_vault deferred fix. README convention note added. Status → review. | Amelia (bmad-dev-story) |
