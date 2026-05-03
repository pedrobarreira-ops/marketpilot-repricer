# Epic 2 Test Plan — Multi-Tenant Isolation

**Generated:** 2026-05-03
**Epic:** Epic 2 — Multi-Tenant Isolation (Stories 2.1–2.2)
**Runner:** `node --test` (built-in; no Jest/Vitest per architecture constraint)
**Integration gate:** `npm run test:rls` (Story 2.2 AC#3) + `npm run test:integration`

---

## Overview

Epic 2 delivers the RLS layer that isolates every customer's data at the Postgres level. Two stories:

- **Story 2.1** — `shared/db/rls-aware-client.js` (JWT-scoped pool), `shared/db/service-role-client.js` (bypass pool), `shared/db/tx.js` (transaction helper), `app/src/middleware/rls-context.js` (request binding), ESLint rule blocking direct `pg` imports in `app/src/`.
- **Story 2.2** — `scripts/rls-regression-suite.js`, `tests/integration/rls-regression.test.js`, `db/seed/test/two-customers.sql`, `npm run test:rls` script, CI block.

Both stories carry `integration_test_required: true` in sprint-status.yaml (live RLS verification against Supabase).

---

## Story 2.1: RLS-Aware DB Client + Service-Role Worker DB Client + Transaction Helper

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| `getRlsAwareClient(jwt)` | `shared/db/rls-aware-client.js` |
| `getServiceRoleClient()` | `shared/db/service-role-client.js` |
| `tx(client, cb)` | `shared/db/tx.js` |
| `rlsContext` middleware | `app/src/middleware/rls-context.js` |
| ESLint rule: `no-direct-pg-in-app` | `eslint-rules/no-direct-pg-in-app.js` |

### Test File

`tests/shared/db/clients.test.js` (scaffold already committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `rls_aware_client_scopes_to_jwt_subject` | SELECT via JWT-A returns only customer-A rows |
| AC#1 | `rls_context_middleware_binds_request_db` | Middleware extracts JWT, calls `getRlsAwareClient`, attaches result as `request.db` |
| AC#2 | `service_role_client_bypasses_rls` | SELECT via service_role returns all rows; pool `max <= 5` |
| AC#2 | `service_role_client_supports_advisory_locks` | `pg_try_advisory_lock` call succeeds |
| AC#3 | `tx_helper_commits_on_success` | Row visible after successful tx callback |
| AC#3 | `tx_helper_rolls_back_on_throw` | Row NOT visible after thrown tx callback |
| AC#3 | `tx_helper_nesting_behaviour_documented` | Either ConcurrentTransactionError OR savepoint (document choice) |
| AC#5 | `eslint_no_direct_pg_in_app_rule_fires_on_violation` | ESLint rule in `eslint-rules/no-direct-pg-in-app.js` reports error on `import { Pool } from 'pg'` fixture |
| AC#5 | `negative_assertion_no_direct_pg_pool_in_app_routes` | No `pg` import in `app/src/routes/` or `app/src/middleware/` |
| AD2  | `negative_assertion_service_role_client_not_importable_in_app_src` | No `service-role-client` import in `app/src/` |
| AD2  | `negative_assertion_rls_aware_client_not_importable_in_worker` | No `rls-aware-client` import in `worker/src/` |

### Fixtures

None required at Story 2.1 level. Tests seed minimal rows via service-role pool directly.

### Integration Test Gate

Story 2.1 is tagged `integration_test_required: true` — Phase 4.5 will halt before PR merge until Pedro runs `npm run test:integration` locally and reports pass.

---

## Story 2.2: RLS Regression Suite + CI Block

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| `scripts/rls-regression-suite.js` | Standalone; invoked by `npm run test:rls` |
| `db/seed/test/two-customers.sql` | Test fixture; applied before regression suite |
| `npm run test:rls` | `package.json` scripts |

### Test File

`tests/integration/rls-regression.test.js` (scaffold already committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `two_customers_seed_creates_two_distinct_customers` | Seed produces 2 distinct customer rows |
| AC#2 | `rls_isolation_customers_customer_a_cannot_read_customer_b_rows` | SELECT via JWT-A returns 0 customer-B rows |
| AC#2 | `rls_isolation_customers_customer_b_cannot_read_customer_a_rows` | Symmetric: JWT-B returns 0 customer-A rows |
| AC#2 | `rls_isolation_customers_customer_a_cannot_insert_as_customer_b` | INSERT with B's id via JWT-A fails / returns 0 rows |
| AC#2 | `rls_isolation_customers_customer_a_cannot_update_customer_b_rows` | UPDATE rowCount === 0 |
| AC#2 | `rls_isolation_customers_customer_a_cannot_delete_customer_b_rows` | DELETE rowCount === 0 |
| AC#2 | `rls_isolation_customer_profiles_*` | Same 5 operations for customer_profiles table |
| AC#2 | `rls_isolation_shop_api_key_vault_*` | Same 5 operations (deferred until Epic 4 ships customer_marketplaces) |
| AC#3 | `test_rls_script_exits_nonzero_on_failure` | `package.json` test:rls script structure assertion |
| AC#4 | `convention_every_seed_table_is_in_regression_config` | Seed tables subset of CUSTOMER_SCOPED_TABLES registry |
| AC#5 | `negative_assertion_no_migration_missing_rls_policy` | No CREATE TABLE for customer-scoped table without companion POLICY |

### Extensibility Convention

The `CUSTOMER_SCOPED_TABLES` registry array in `tests/integration/rls-regression.test.js` is the single extension point. Each new customer-scoped table story (Epics 4-11) must:

1. Include its RLS POLICY in the migration file.
2. Add a seed row for both test customers to `db/seed/test/two-customers.sql`.
3. Add one entry object to `CUSTOMER_SCOPED_TABLES` in `rls-regression.test.js`.

Failing step 3 causes `convention_every_seed_table_is_in_regression_config` to fail loudly.

### Integration Test Gate

Story 2.2 is tagged `integration_test_required: true` — Phase 4.5 will halt before PR merge.

---

## Cross-Cutting Atomicity Requirements

Epic 2 has no atomicity bundle participation. Stories 2.1 and 2.2 ship as independent PRs. Story 2.2 depends on Story 2.1's clients (the regression suite uses `getRlsAwareClient` to run isolation checks), so Step 1 of Story 2.2 validates Story 2.1 is merged first.

---

## AC Coverage Map

| Story | AC | Test File | Test Name | Status |
|-------|----|-----------|-----------|--------|
| 2.1 | AC#1 | clients.test.js | rls_aware_client_scopes_to_jwt_subject | scaffold |
| 2.1 | AC#1 (middleware) | clients.test.js → `app/src/middleware/rls-context.js` | rls_context_middleware_binds_request_db | scaffold |
| 2.1 | AC#2 | clients.test.js | service_role_client_bypasses_rls | scaffold |
| 2.1 | AC#2 | clients.test.js | service_role_client_supports_advisory_locks | scaffold |
| 2.1 | AC#3 | clients.test.js | tx_helper_commits_on_success | scaffold |
| 2.1 | AC#3 | clients.test.js | tx_helper_rolls_back_on_throw | scaffold |
| 2.1 | AC#3 | clients.test.js | tx_helper_nesting_behaviour_documented | scaffold |
| 2.1 | AC#4 (integration) | clients.test.js | all 3 negative-assertion tests | scaffold |
| 2.1 | AC#5 (ESLint) | clients.test.js → `eslint-rules/no-direct-pg-in-app.js` | eslint_no_direct_pg_in_app_rule_fires_on_violation | scaffold |
| 2.1 | AC#5 (grep backup) | clients.test.js | negative_assertion_no_direct_pg_pool_in_app_routes | scaffold |
| 2.2 | AC#1 | rls-regression.test.js | two_customers_seed_creates_two_distinct_customers | scaffold |
| 2.2 | AC#2 | rls-regression.test.js | rls_isolation_{table}_{operation} (15 parameterized tests) | scaffold |
| 2.2 | AC#3 | rls-regression.test.js | test_rls_script_exits_nonzero_on_failure | scaffold |
| 2.2 | AC#4 | rls-regression.test.js | convention_every_seed_table_is_in_regression_config | scaffold |
| 2.2 | AC#5 | rls-regression.test.js | negative_assertion_no_migration_missing_rls_policy | scaffold |

**Total test cases at scaffold:** 22 (3 negative assertions + 8 behavioral stubs for 2.1 + 11 for 2.2)

---

## Notes for Amelia (ATDD Step 2)

1. **JWT acquisition**: Use Supabase `createClient(url, anonKey).auth.signInWithPassword()` to get JWTs for test users. Both test users must exist (signed up via the Story 1.4 route or directly via the admin endpoint — document the approach in the test helper).

2. **shop_api_key_vault isolation**: This table requires a `customer_marketplaces` row (Epic 4) as FK target for `customer_marketplace_id`. At Epic 2 baseline, seed/clean helpers are no-ops. Story 4.2 ATDD extends them when `customer_marketplaces` exists.

3. **pg_try_advisory_lock bigint**: Node 22 supports JS `BigInt` literals (`12345678n`) — pass via `$1` parameter with pg library's bigint adapter or cast in SQL: `pg_try_advisory_lock($1::bigint)` where `$1 = '12345678'`.

4. **tx nesting choice**: Amelia picks the approach (ConcurrentTransactionError or SAVEPOINT) based on implementation. Document the choice as a JSDoc comment in `shared/db/tx.js` and confirm the test matches.

5. **test:rls script**: `scripts/rls-regression-suite.js` is the standalone runner; `tests/integration/rls-regression.test.js` is the node --test runner. Both cover the same isolation checks. The `npm run test:rls` script must invoke at least one of them. Connecting both (pipe output into TAP formatter) is optional.
