# Epic 5 Test Plan — Cron Dispatcher & State Machine

**Generated:** 2026-05-08
**Epic:** Epic 5 — Cron Dispatcher & State Machine (Stories 5.1–5.2)
**Runner:** `node --test` (built-in; no Jest/Vitest per architecture constraint)
**Integration gate:** `npm run test:integration` (Story 5.1 is `integration_test_required: true`)

---

## Overview

Epic 5 delivers the background-work backbone: the master cron dispatcher (Story 5.1) and the
`pri01_staging` schema + cycle-assembly skeleton (Story 5.2). Together they form the foundation
of Atomicity Bundle C — the full engine + writer chain whose gate fires at Story 7.8.

Story 5.1 introduces two SSoT modules (`worker/src/dispatcher.js`, `worker/src/advisory-lock.js`,
`worker/src/jobs/master-cron.js`) and the `worker-must-filter-by-customer` ESLint rule. It also
has a mandatory retrofit obligation: Story 9.1's `monthly-partition-create.js` must receive a
`// safe: cross-customer cron` comment annotation when the ESLint rule lands.

Story 5.2 creates the `pri01_staging` table and the `cycle-assembly.js` skeleton that bridges
the dispatcher and the engine (which ships in Epic 7).

### Stories

| Story | Title | Size | `integration_test_required` |
|-------|-------|------|-----------------------------|
| 5.1 | Master cron + dispatcher SQL + advisory locks + `worker-must-filter-by-customer` ESLint rule | L | yes |
| 5.2 | `pri01_staging` schema + cycle-assembly skeleton | M | no |

### Atomicity Bundle C Context

Stories 5.1 and 5.2 are the first two of eight stories in Atomicity Bundle C. The bundle's
integration-test gate fires at Story 7.8. Epic 5 stories ship with unit tests only; the full
cycle test (engine + writer + PRI02 + absorption on all 17 P11 fixtures) lives at Story 7.8.

Key Bundle C invariant (relevant to Epic 5):
- Every `sku_channel` row participating in a PRI01 batch must have `pending_import_id IS NULL`
  before the dispatcher selects it. The dispatcher's WHERE clause enforces this; the cycle-assembly
  skeleton must honour it in stub form.

---

## Story 5.1: Master cron + dispatcher SQL + advisory locks + `worker-must-filter-by-customer` ESLint rule

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Dispatcher | `worker/src/dispatcher.js` |
| Advisory lock helpers | `worker/src/advisory-lock.js` |
| Cron entry | `worker/src/jobs/master-cron.js` |
| ESLint rule | `eslint-rules/worker-must-filter-by-customer.js` |

### Test Files

- `tests/worker/dispatcher.test.js` — unit tests for dispatcher + advisory-lock (scaffold committed at Epic-Start)
- `tests/integration/dispatcher.test.js` — integration tests (scaffold committed at Epic-Start)

### Behavioral Tests

#### Unit Tests (`tests/worker/dispatcher.test.js`)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `dispatcher_calls_dispatch_cycle_on_cron_tick` | dispatchCycle export callable; logs cycle-start at info level with cycle_id UUID |
| AC#1 | `dispatcher_skips_new_tick_while_previous_still_running` | node-cron concurrency guard: only one cycle-start log per overlapping tick window |
| AC#2 | `dispatcher_selection_sql_matches_ad17_verbatim` | Query text emitted to mock client matches AD17 SQL exactly (columns, WHERE clauses, ORDER BY, parameterized LIMIT $1) |
| AC#2 | `dispatcher_batch_size_configurable_via_env` | BATCH_SIZE env var sets the $1 parameter; unset uses the default (1000 or configured default) |
| AC#3 | `advisory_lock_try_acquire_calls_pg_try_advisory_lock` | tryAcquireCustomerLock issues `SELECT pg_try_advisory_lock($1)` with correct bigint |
| AC#3 | `advisory_lock_release_calls_pg_advisory_unlock` | releaseCustomerLock issues `SELECT pg_advisory_unlock($1)` with same bigint |
| AC#3 | `advisory_lock_returns_false_when_lock_already_held` | Mock returns false → tryAcquireCustomerLock returns false; customer batch skipped |
| AC#3 | `advisory_lock_bigint_derivation_is_deterministic` | Same UUID always maps to same bigint across multiple calls |
| AC#3 | `advisory_lock_different_uuids_map_to_different_bigints` | Two distinct UUIDs produce distinct bigints (collision resistance for test fixtures) |
| AC#5 | `dispatcher_logs_cycle_end_with_stats` | cycle-end log contains customers_processed, skus_evaluated, decisions_emitted, duration_ms |
| AC#5 | `cycle_start_and_end_audit_events_emitted` | writeAuditEvent called twice per cycle (cycle-start + cycle-end) with correct event_types |
| AC#6 | `no_worker_locks_table_in_codebase` | Grep: no `worker_locks` table reference in any .js/.sql file |
| AC#4 | `eslint_worker_must_filter_by_customer_fires_on_violation` | ESLint rule reports error when query on sku_channels lacks customer_marketplace_id filter |
| AC#4 | `eslint_rule_suppressed_by_safe_cross_customer_cron_comment` | Query annotated with `// safe: cross-customer cron` suppresses the lint error |
| AC#4 | `eslint_rule_covers_all_customer_scoped_tables` | Rule fires on each of the 9 customer-scoped tables (sku_channels, audit_log, baseline_snapshots, pri01_staging, cycle_summaries, daily_kpi_snapshots, scan_jobs, customer_marketplaces, customer_profiles) |
| AC#4 | `monthly_partition_cron_has_safe_cross_customer_pragma` | Grep: `worker/src/jobs/monthly-partition-create.js` contains `// safe: cross-customer cron` (retrofit obligation from Story 9.1) |

#### Integration Tests (`tests/integration/dispatcher.test.js`)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#2 | `dispatcher_index_hit_on_seeded_catalog_explain_analyze` | EXPLAIN ANALYZE on dispatcher SELECT with 100-row seeded catalog shows `idx_sku_channels_dispatch` in plan |
| AC#3 | `advisory_lock_real_pg_try_advisory_lock_succeeds_for_free_key` | Real DB: tryAcquireCustomerLock returns true for a bigint not held |
| AC#3 | `advisory_lock_real_pg_try_advisory_lock_returns_false_for_held_key` | Real DB: second connection acquires lock; first gets false |
| AC#3 | `advisory_lock_auto_released_on_session_close` | Real DB: lock held by connection A; A closes; connection B acquires same lock |
| AC#5 | `cycle_summaries_stub_helper_callable_without_error` | cycle-assembly placeholder helper invocable even before Epic 9 cycle_summaries table ships |
| AC#1 | `master_cron_file_registered_with_node_cron_at_worker_boot` | worker/src/index.js imports master-cron.js and calls schedule()/init within the startup path |

### Fixtures / Seed

Integration tests require:
- At least one `customer_marketplace` row in ACTIVE state with `operator_csv_delimiter` and
  `offer_prices_decimals` populated (PC01 columns from Epic 4 onboarding).
- At least 10 `sku_channels` rows in that marketplace with `tier_cadence_minutes = 5` and
  `last_checked_at` set to > 5 minutes ago (so they qualify in the dispatcher WHERE clause).
- Existing `db/seed/test/two-customers.sql` can be extended with these rows for integration tests.

### Integration Test Gate

Story 5.1 is tagged `integration_test_required: true`. Phase 4.5 halts before PR merge
until Pedro runs `npm run test:integration` locally and confirms pass.

---

## Story 5.2: `pri01_staging` schema + cycle-assembly skeleton

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Cycle-assembly skeleton | `worker/src/cycle-assembly.js` |
| Migration | `supabase/migrations/202604301214_create_pri01_staging.sql` |

### Test File

`tests/worker/cycle-assembly.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `migration_creates_pri01_staging_table_with_full_schema` | Table exists with all required columns: id, customer_marketplace_id FK CASCADE, sku_id FK CASCADE, channel_code, new_price_cents (integer NOT NULL), cycle_id (uuid NOT NULL), staged_at, flushed_at (nullable), import_id (text nullable) |
| AC#1 | `migration_creates_idx_pri01_staging_cycle_index` | Index `idx_pri01_staging_cycle ON pri01_staging(cycle_id)` present |
| AC#1 | `migration_creates_idx_pri01_staging_sku_unflushed_index` | Partial index `idx_pri01_staging_sku_unflushed ON pri01_staging(sku_id) WHERE flushed_at IS NULL` present |
| AC#1 | `rls_policy_prevents_cross_customer_staging_read` | RLS: customer A JWT cannot SELECT customer B's pri01_staging rows |
| AC#1 | `rls_regression_suite_extended_with_pri01_staging` | scripts/rls-regression-suite.js CUSTOMER_SCOPED_TABLES includes pri01_staging |
| AC#2 | `cycle_assembly_exports_assemble_cycle_function` | `assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId)` is exported from cycle-assembly.js |
| AC#2 | `cycle_assembly_inserts_staging_row_for_undercut_decision` | When engine stub returns {action: 'UNDERCUT', newPriceCents: 1799}, assembleCycle inserts one pri01_staging row |
| AC#2 | `cycle_assembly_inserts_staging_row_for_ceiling_raise_decision` | When engine stub returns {action: 'CEILING_RAISE', newPriceCents: 2099}, assembleCycle inserts one pri01_staging row |
| AC#2 | `cycle_assembly_does_not_insert_staging_row_for_hold_decision` | When engine stub returns {action: 'HOLD'}, no pri01_staging row inserted |
| AC#2 | `cycle_assembly_propagates_cycle_id_to_staging_row` | Inserted staging row has cycle_id matching the cycleId parameter |
| AC#2 | `cycle_assembly_emits_audit_event_for_each_decision` | writeAuditEvent called once per SKU-channel decision regardless of action type |
| AC#2 | `cycle_assembly_calls_circuit_breaker_stub_at_batch_end` | At end of batch, logs staged count (circuit-breaker placeholder; Story 7.6 fills this in) |
| AC#3 | `unit_tests_use_mock_engine_not_real_decide_js` | Mock engine returning predetermined decisions; no actual engine logic exercised |
| AC#3 | `cycle_assembly_test_covers_mixed_decisions` | Test with 3 SKUs: UNDERCUT + HOLD + CEILING_RAISE; asserts 2 staging rows inserted |

### Fixtures

Unit tests in `tests/worker/cycle-assembly.test.js` use:
- Mock transaction object (matches the `tx` helper from Story 2.1 interface)
- Mock engine stub: `{ decideForSkuChannel: async () => ({action: 'HOLD', auditEvents: ['hold-already-in-1st']}) }`
- A minimal `sku_channels` array (3 rows with different tiers/prices for the mixed decision test)

---

## Cross-Cutting Concerns

### ESLint Rule: `worker-must-filter-by-customer`

The `worker-must-filter-by-customer` rule ships with Story 5.1 and applies to all code in
`worker/src/`. Key design constraints:

- Rule must cover both raw SQL patterns (`.query('SELECT ... FROM sku_channels')`) and any
  Supabase client patterns (`.from('sku_channels')...`).
- The `// safe: cross-customer cron` escape-hatch comment must suppress the rule for the
  specific query it annotates (NOT globally for the file).
- The rule must be registered in the project's `eslint.config.js` under the `local-cron/`
  namespace (following the same pattern as `local-cron/no-raw-cron-state-update` from Story 4.1).

### Story 9.1 Retrofit Obligation

When Story 5.1 ships the ESLint rule, the BAD subagent MUST retrofit
`worker/src/jobs/monthly-partition-create.js` (shipped in Story 9.1) with a
`// safe: cross-customer cron` pragma comment above the cross-customer partition query.
Without this, `npm run lint` will fail on a previously-clean file.

Test `monthly_partition_cron_has_safe_cross_customer_pragma` in `tests/worker/dispatcher.test.js`
enforces this obligation by grepping for the comment in the Story 9.1 file.

### Negative Assertions

| Assertion | Test name | File |
|-----------|-----------|------|
| No `worker_locks` table anywhere in codebase | `no_worker_locks_table_in_codebase` | dispatcher.test.js |
| No `advisory_lock` row-based pseudo-mutex | `no_worker_locks_table_in_codebase` | dispatcher.test.js (same test, grepping for both) |

### Bundle C Invariant (partial)

At this stage of Bundle C, the invariant is structural: the dispatcher's WHERE clause includes
`sc.pending_import_id IS NULL`, ensuring no in-flight SKU is re-selected. This is asserted in
AC#2's SQL verbatim match test. The full atomicity proof (every participating row has non-NULL
`pending_import_id` after PRI01 submit) ships at Story 7.8.

---

## AC Coverage Map

| Story | AC | Test File | Test Name | Status |
|-------|----|-----------|-----------|--------|
| 5.1 | AC#1 | dispatcher.test.js | `dispatcher_calls_dispatch_cycle_on_cron_tick` | scaffold |
| 5.1 | AC#1 | dispatcher.test.js | `dispatcher_skips_new_tick_while_previous_still_running` | scaffold |
| 5.1 | AC#2 | dispatcher.test.js | `dispatcher_selection_sql_matches_ad17_verbatim` | scaffold |
| 5.1 | AC#2 | dispatcher.test.js | `dispatcher_batch_size_configurable_via_env` | scaffold |
| 5.1 | AC#2 | integration/dispatcher.test.js | `dispatcher_index_hit_on_seeded_catalog_explain_analyze` | scaffold |
| 5.1 | AC#3 | dispatcher.test.js | `advisory_lock_try_acquire_calls_pg_try_advisory_lock` | scaffold |
| 5.1 | AC#3 | dispatcher.test.js | `advisory_lock_release_calls_pg_advisory_unlock` | scaffold |
| 5.1 | AC#3 | dispatcher.test.js | `advisory_lock_returns_false_when_lock_already_held` | scaffold |
| 5.1 | AC#3 | dispatcher.test.js | `advisory_lock_bigint_derivation_is_deterministic` | scaffold |
| 5.1 | AC#3 | integration/dispatcher.test.js | `advisory_lock_real_pg_try_advisory_lock_succeeds_for_free_key` | scaffold |
| 5.1 | AC#3 | integration/dispatcher.test.js | `advisory_lock_real_pg_try_advisory_lock_returns_false_for_held_key` | scaffold |
| 5.1 | AC#3 | integration/dispatcher.test.js | `advisory_lock_auto_released_on_session_close` | scaffold |
| 5.1 | AC#4 | dispatcher.test.js | `eslint_worker_must_filter_by_customer_fires_on_violation` | scaffold |
| 5.1 | AC#4 | dispatcher.test.js | `eslint_rule_suppressed_by_safe_cross_customer_cron_comment` | scaffold |
| 5.1 | AC#4 | dispatcher.test.js | `eslint_rule_covers_all_customer_scoped_tables` | scaffold |
| 5.1 | AC#4 | dispatcher.test.js | `monthly_partition_cron_has_safe_cross_customer_pragma` | scaffold |
| 5.1 | AC#5 | dispatcher.test.js | `dispatcher_logs_cycle_end_with_stats` | scaffold |
| 5.1 | AC#5 | dispatcher.test.js | `cycle_start_and_end_audit_events_emitted` | scaffold |
| 5.1 | AC#6 | dispatcher.test.js | `no_worker_locks_table_in_codebase` | scaffold |
| 5.1 | AC#1 | integration/dispatcher.test.js | `master_cron_file_registered_with_node_cron_at_worker_boot` | scaffold |
| 5.2 | AC#1 | cycle-assembly.test.js | `migration_creates_pri01_staging_table_with_full_schema` | scaffold |
| 5.2 | AC#1 | cycle-assembly.test.js | `migration_creates_idx_pri01_staging_cycle_index` | scaffold |
| 5.2 | AC#1 | cycle-assembly.test.js | `migration_creates_idx_pri01_staging_sku_unflushed_index` | scaffold |
| 5.2 | AC#1 | cycle-assembly.test.js | `rls_policy_prevents_cross_customer_staging_read` | scaffold |
| 5.2 | AC#1 | cycle-assembly.test.js | `rls_regression_suite_extended_with_pri01_staging` | scaffold |
| 5.2 | AC#2 | cycle-assembly.test.js | `cycle_assembly_exports_assemble_cycle_function` | scaffold |
| 5.2 | AC#2 | cycle-assembly.test.js | `cycle_assembly_inserts_staging_row_for_undercut_decision` | scaffold |
| 5.2 | AC#2 | cycle-assembly.test.js | `cycle_assembly_inserts_staging_row_for_ceiling_raise_decision` | scaffold |
| 5.2 | AC#2 | cycle-assembly.test.js | `cycle_assembly_does_not_insert_staging_row_for_hold_decision` | scaffold |
| 5.2 | AC#2 | cycle-assembly.test.js | `cycle_assembly_propagates_cycle_id_to_staging_row` | scaffold |
| 5.2 | AC#2 | cycle-assembly.test.js | `cycle_assembly_emits_audit_event_for_each_decision` | scaffold |
| 5.2 | AC#2 | cycle-assembly.test.js | `cycle_assembly_test_covers_mixed_decisions` | scaffold |
| 5.2 | AC#3 | cycle-assembly.test.js | `unit_tests_use_mock_engine_not_real_decide_js` | scaffold |

**Total test cases at scaffold:** ~34 (20 unit + 6 integration for Story 5.1; 13 unit for Story 5.2)

---

## Notes for Amelia (ATDD Step 2)

1. **Dispatcher SQL verbatim match**: AC#2's `dispatcher_selection_sql_matches_ad17_verbatim` test
   intercepts the `.query()` call on a mock `pg.Client`. Normalize whitespace before comparing
   (collapse multiple spaces + newlines to single space), but preserve all WHERE clause predicates
   and the ORDER BY exactly. The verbatim SQL from AD17 is:
   ```sql
   SELECT cm.id, sc.id AS sku_channel_id, sc.sku_id, sc.channel_code
     FROM customer_marketplaces cm
     JOIN sku_channels sc ON sc.customer_marketplace_id = cm.id
    WHERE cm.cron_state = 'ACTIVE'
      AND sc.frozen_for_anomaly_review = false
      AND sc.pending_import_id IS NULL
      AND sc.excluded_at IS NULL
      AND sc.last_checked_at + (sc.tier_cadence_minutes * INTERVAL '1 minute') < NOW()
    ORDER BY cm.id, sc.last_checked_at ASC
    LIMIT $1;
   ```

2. **Advisory lock bigint derivation**: The spec says "hash the UUID's first 8 bytes as bigint".
   Node.js can do this with `Buffer.from(uuid.replace(/-/g, ''), 'hex').readBigInt64BE(0)`. The
   determinism test should call the helper 3 times with the same UUID and assert all three results
   are strictly equal.

3. **node-cron concurrency guard**: AC#1 requires testing that a 6-minute synthetic delay causes
   the overlapping tick to be skipped. In unit tests, avoid actually sleeping 6 minutes — instead
   mock `node-cron`'s scheduler and inject a "currently running" flag into the dispatcher's closure.
   The test sets the flag to true, fires a second "tick", and asserts cycle-start is NOT logged a
   second time.

4. **ESLint programmatic API pattern**: Follow the same pattern established in Story 4.1's
   `eslint_no_raw_cron_state_update_fires_on_violation` test (write a temp fixture under
   `worker/src/`, use `new ESLint({ cwd: repoRoot })`, assert `ruleId ===
   'local-cron/worker-must-filter-by-customer'`). Clean up the fixture in `t.after()`.

5. **`cycle_assembly_emits_audit_event_for_each_decision`**: `writeAuditEvent` is imported from
   `shared/audit/writer.js`. Unit tests MUST mock this module to capture calls without needing a
   live DB. Use Node.js test runner's `mock.module()` API or a manual injection via the module's
   export interface.

6. **RLS test for pri01_staging**: The RLS policy chains through
   `sku_channels.customer_marketplace_id → customer_marketplaces.customer_id`. The integration
   test should verify this chain: customer A's JWT cannot SELECT customer B's pri01_staging rows
   even when querying by a known staging row ID. Use the same `getRlsAwareClient` + `resetAllCustomers`
   pattern from `tests/shared/state/cron-state.test.js`.

7. **`master_cron_file_registered_with_node_cron_at_worker_boot`**: This integration test reads
   `worker/src/index.js` source and asserts it contains `master-cron` in its import path, OR
   spawns the worker process briefly and checks for the `[master-cron]` startup log within 2s.
   The static-grep approach is simpler and sufficient for the scaffold.

8. **Story 5.2 migration tests**: These are integration-tier tests (require `SUPABASE_SERVICE_ROLE_DATABASE_URL`).
   Gate them with `if (process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL)` exactly as the cron-state
   integration tests do. Mark the test file header clearly: "Unit tests run without DB; migration
   + RLS tests are integration-only."
