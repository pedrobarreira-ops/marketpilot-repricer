# Story 5.1: Master Cron + Dispatcher SQL + Per-Customer Advisory Locks + `worker-must-filter-by-customer` ESLint Rule

**Sprint-status key:** `5-1-master-cron-dispatcher-sql-per-customer-advisory-locks-worker-must-filter-by-customer-eslint-rule`
**Status:** ready-for-dev
**Size:** L
**Epic:** Epic 5 — Cron Dispatcher & State Machine (architecture S-I phase 5)
**Atomicity:** Bundle C (engine bundle start) — cron-state foundation for dispatcher → engine → writer chain; integration-test gate fires at Story 7.8.
**Depends on:** Story 1.1 (worker scaffold, `node-cron`), Story 2.1 (service-role-client + tx helper), Story 4.1 (cron_state enum + `customer_marketplaces` + `transitionCronState`), Story 4.2 (`sku_channels` schema + dispatcher hot-path index `idx_sku_channels_dispatch`), Story 9.0 + Story 9.1 (audit foundation — `writeAuditEvent`, `cycle-start` / `cycle-end` event types; calendar-early per Option A — both already `done`)
**Enables:** Story 5.2 (`cycle-assembly.js` imports dispatcher patterns); every subsequent worker logic story; Epic 7

---

## Narrative

**As a** background worker process,
**I want** a master 5-minute cron that dispatches repricing cycles per customer with Postgres advisory locking and strict per-customer query filtering,
**So that** every customer's SKU-channels are repriced reliably, safely, and without cross-customer data leakage — even as the system scales to multiple worker instances.

---

## Trace

- **Architecture decisions:** AD17 (dispatcher + advisory locks — primary), AD15 (cron_state = `'ACTIVE'` predicate), AD11 partial (per-cycle 20% CB gate lives at dispatcher — stub only in this story; full implementation in Story 7.6), AD18 (negative assertion: no Mirakl webhooks, polling-only)
- **FRs:** FR18 (4-state tier system + per-SKU cadence; single 5-min cron)
- **NFRs:** NFR-Sc3 (advisory locks), NFR-P1 (T1 ≤18min), NFR-P2 (T2a ≤18min)
- **ESLint rule ships here:** `worker-must-filter-by-customer` (loaded in `eslint.config.js` under `local-cron` plugin namespace — same pattern as `no-raw-cron-state-update` from Story 4.1)
- **Retrofit obligation:** Story 9.1's `worker/src/jobs/monthly-partition-create.js` already has the `// safe: cross-customer cron` opt-out comment at the top of the file (verified in repo) — Story 5.1 test AC#4 asserts it. No changes needed to that file.
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/03-epics-5-6-cron-pri01.md`, Story 5.1
- **Architecture patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md`
- **Database schema:** `_bmad-output/planning-artifacts/architecture-distillate/06-database-schema.md`
- **Decisions detail:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` (AD15, AD17)

---

## Pre-Existing Test Scaffolds — Do NOT Recreate

Two test scaffold files are **already committed**:

- `tests/worker/dispatcher.test.js` — covers AC#1–AC#6 (SQL predicate, advisory locks, ESLint rule, audit events, negative assertion)
- `tests/worker/cycle-assembly.test.js` — covers Story 5.2 AC#1–AC#3

The ESLint rule **placeholder** is also already committed at `eslint-rules/worker-must-filter-by-customer.js` (exports `{ rules: {} }` — empty until this story implements it). Do NOT recreate these files. Implement the source modules that make the tests pass.

---

## SSoT Modules to Create

This story creates exactly **three new source files** and updates **two existing files**:

| File | Action | Description |
|---|---|---|
| `worker/src/dispatcher.js` | CREATE | Master dispatch function with AD17 SQL, advisory lock iteration, cycle-end stats logging, audit events |
| `worker/src/advisory-lock.js` | CREATE | `tryAcquireCustomerLock`, `releaseCustomerLock`, `uuidToBigint` |
| `worker/src/jobs/master-cron.js` | CREATE | `node-cron` schedule at `*/5 * * * *` calling `dispatchCycle`; concurrency guard |
| `eslint-rules/worker-must-filter-by-customer.js` | UPDATE | Replace placeholder with full AST-walking rule |
| `eslint.config.js` | UPDATE | Register `worker-must-filter-by-customer` rule in `local-cron` plugin block |
| `worker/src/index.js` | UPDATE | Import and start `master-cron.js` alongside existing crons |

**Do NOT create:**
- `worker/src/cycle-assembly.js` (Story 5.2)
- Any engine files in `worker/src/engine/` (Epic 7)
- Any migration (no schema changes in this story — `sku_channels` + `customer_marketplaces` already exist from Story 4.2 / Story 4.1)

---

## Acceptance Criteria

### AC#1 — Master cron fires every 5 minutes; concurrency guard skips overlapping tick

**Given** `worker/src/jobs/master-cron.js` registered with `node-cron` at worker process boot (imported in `worker/src/index.js`)
**When** the cron tick fires every 5 minutes (`*/5 * * * *`)
**Then**:
- It calls `worker/src/dispatcher.js`'s exported `dispatchCycle()` function
- The dispatcher logs cycle-start at `info` level via pino with `cycle_id` (UUID minted via `node:crypto` `randomUUID()` at dispatch time)
- If a previous tick is still running, the new tick is skipped — implement via an `inFlight` boolean flag checked at cron callback entry
- `master-cron.js` must use `node-cron` (`import cron from 'node-cron'`) — matches the existing pattern in `worker/src/index.js`

**Concurrency guard pattern** (matches Story 4.4 scan-poller pattern in `worker/src/index.js`):
```js
let _dispatchInFlight = false;

cron.schedule('*/5 * * * *', () => {
  if (_dispatchInFlight) return; // skip overlapping tick
  _dispatchInFlight = true;
  dispatchCycle({ pool }).catch((err) => {
    logger.error({ err }, 'master-cron: dispatchCycle rejected');
  }).finally(() => {
    _dispatchInFlight = false;
  });
});
```

**Test verifies:** `dispatcher.test.js` — `dispatcher_calls_dispatch_cycle_on_cron_tick`, `dispatcher_skips_new_tick_while_previous_still_running`

---

### AC#2 — Dispatcher SELECT SQL matches AD17 verbatim; batch_size configurable via env

**Given** the dispatcher's selection SQL
**When** it queries for work
**Then** the query is exactly (AD17 verbatim, parameterized):

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

- `$1` is `DISPATCH_BATCH_SIZE` env var (default `1000`, positive integer)
- Read from `shared/config/runtime-env.js` `getEnv()` or directly via `process.env.DISPATCH_BATCH_SIZE`
- The hot-path index `idx_sku_channels_dispatch` (shipped in Story 4.2) is hit on this query — no `EXPLAIN ANALYZE` test required in unit tests; confirm once in a dogfood run

**Table name note:** Architecture AD17 uses `customer_marketplace` (singular) in prose but the actual table is `customer_marketplaces` (plural, Story 4.1 DDL). Use `customer_marketplaces`.

**Test verifies:** `dispatcher.test.js` — `dispatcher_selection_sql_matches_ad17_verbatim`, `dispatcher_batch_size_configurable_via_env`

---

### AC#3 — Advisory lock helpers; per-customer group dispatch; stale-lock handling

**Given** `worker/src/advisory-lock.js` exports:
- `tryAcquireCustomerLock(client, customerMarketplaceId: string): Promise<boolean>` — calls `SELECT pg_try_advisory_lock($1)` with the bigint derived from the UUID
- `releaseCustomerLock(client, customerMarketplaceId: string): Promise<void>` — calls `SELECT pg_advisory_unlock($1)`
- `uuidToBigint(uuid: string): BigInt` — deterministic bigint from first 8 bytes of UUID hex (strip hyphens, take first 16 hex chars, `BigInt('0x' + hex)`)

**When** the dispatcher iterates the SELECT result grouped by `customer_marketplace_id`
**Then**:
- For each group: call `tryAcquireCustomerLock(client, cm.id)`; if returns `false` → skip that customer's batch this tick (log at `debug` level)
- If returns `true` → process the customer's SKUs (call `assembleCycle` stub — or just log for now until Story 5.2 ships), then call `releaseCustomerLock`
- Wrap the entire customer batch in a try/finally to guarantee lock release even on error
- No `worker_locks` table anywhere in the codebase (negative assertion — distinguishes from Gabriel project's pattern)

**Bigint derivation (exact implementation):**
```js
export function uuidToBigint (uuid) {
  const hex = uuid.replace(/-/g, '').slice(0, 16); // first 8 bytes
  return BigInt('0x' + hex);
}
```

**Stale-lock handling:** Postgres advisory locks are session-scoped — automatically released on worker crash. No manual cleanup needed. This is a negative-assertion: there must be NO `worker_locks` table, NO row-based pseudo-mutex, and NO manual lock-cleanup code anywhere.

**Test verifies:** `dispatcher.test.js` — `advisory_lock_try_acquire_calls_pg_try_advisory_lock`, `advisory_lock_release_calls_pg_advisory_unlock`, `advisory_lock_returns_false_when_lock_already_held`, `advisory_lock_bigint_derivation_is_deterministic`, `advisory_lock_different_uuids_map_to_different_bigints`, `no_worker_locks_table_in_codebase`

---

### AC#4 — `worker-must-filter-by-customer` ESLint rule; Story 9.1 retrofit pragma

**Given** `eslint-rules/worker-must-filter-by-customer.js` (currently a placeholder — implement it)
**When** ESLint runs against `worker/src/`
**Then**:
- Any `client.query(...)` call in `worker/src/` whose SQL string literal contains a reference to a **customer-scoped table** WITHOUT a `customer_marketplace_id` filter clause triggers a lint error:
  *"Worker queries on customer-scoped tables must filter by customer_marketplace_id (RLS is bypassed in worker context). Add the filter, or annotate with `// safe: cross-customer cron` if the query is deliberately cross-customer."*
- The rule checks the SQL string argument for both patterns:
  - Raw SQL: `customer_marketplace_id = $N` or `customer_marketplace_id =` (parameterized)
  - Supabase client: `.eq('customer_marketplace_id', ...)` (call chain detection)
- A `// safe: cross-customer cron` comment on the line **immediately preceding** the `client.query(...)` call suppresses the violation
- The rule targets these 9 customer-scoped tables: `sku_channels`, `audit_log`, `baseline_snapshots`, `pri01_staging`, `cycle_summaries`, `daily_kpi_snapshots`, `scan_jobs`, `customer_marketplaces`, `customer_profiles`
- Rule is registered in `eslint.config.js` under the existing `local-cron` plugin block (same plugin namespace as `no-raw-cron-state-update`) — add `'local-cron/worker-must-filter-by-customer': 'error'` to the `files: ['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js']` rule block
- `worker/src/jobs/monthly-partition-create.js` already has `// safe: cross-customer cron` at line 1 — the test asserts this file does NOT trigger the rule
- The dispatcher's own initial SELECT (cross-customer by design) must have a `// safe: cross-customer cron` comment

**ESLint plugin registration pattern** (matches Story 4.1's `no-raw-cron-state-update` pattern):
```js
// eslint.config.js — add to existing local-cron plugin block:
import workerMustFilterByCustomer from './eslint-rules/worker-must-filter-by-customer.js';

// In the local-cron plugin block:
plugins: { 'local-cron': { rules: {
  'no-raw-cron-state-update': noRawCronStateUpdate.rules['no-raw-cron-state-update'],
  'worker-must-filter-by-customer': workerMustFilterByCustomer.rules['worker-must-filter-by-customer'],
} } },
rules: {
  'local-cron/no-raw-cron-state-update': 'error',
  'local-cron/worker-must-filter-by-customer': 'error',
},
```

**Test verifies:** `dispatcher.test.js` — `eslint_worker_must_filter_by_customer_fires_on_violation`, `eslint_rule_suppressed_by_safe_cross_customer_cron_comment`, `eslint_rule_covers_all_customer_scoped_tables`, `monthly_partition_cron_has_safe_cross_customer_pragma`

---

### AC#5 — Cycle-end logging with stats; `cycle-start` and `cycle-end` audit events

**Given** the dispatcher in operation
**When** a cycle completes
**Then**:
- Logs cycle-end at `info` level with stats object: `{ cycle_id, customers_processed, skus_evaluated, decisions_emitted, duration_ms }`
- Emits `cycle-start` Rotina audit event at cycle START via `writeAuditEvent` — use service-role pool's direct client (NOT inside a customer transaction — `cycle-start` is cross-customer)
- Emits `cycle-end` Rotina audit event at cycle END with aggregate stats in payload
- For `cycle_summaries` table (schema ships in Story 9.2): write to a **stub helper** that no-ops if the table doesn't exist yet — wrap with `try/catch` and log at `debug` if the INSERT fails (table not yet created); Story 9.2 fills this in
- `writeAuditEvent` is imported from `shared/audit/writer.js`
- `customerMarketplaceId` for cross-cycle audit events: pass `null` or omit for `cycle-start`/`cycle-end` global events; the `writeAuditEvent` signature accepts `null`

**Event types** (per AD20 Rotina taxonomy — must match exactly):
- `'cycle-start'` (Rotina)
- `'cycle-end'` (Rotina)

**Test verifies:** `dispatcher.test.js` — `dispatcher_logs_cycle_end_with_stats`, `cycle_start_and_end_audit_events_emitted`

---

### AC#6 — Stale-lock negative assertion; no `worker_locks` table in codebase

**Given** the advisory lock mechanism
**When** a worker process crashes mid-cycle while holding advisory locks
**Then**:
- Postgres auto-releases the locks on session-close — NO manual cleanup logic anywhere
- There is NO `worker_locks` table in any migration, route, or source file
- There is NO row-based pseudo-mutex pattern (no `SELECT ... FOR UPDATE SKIP LOCKED` on a "locks" or "claims" table)

**Test verifies:** `dispatcher.test.js` — `no_worker_locks_table_in_codebase`

---

## Worker Entry Point Update — `worker/src/index.js`

Import and start `master-cron.js` alongside the existing crons. Follow the same defensive `.catch()` pattern used for the partition cron and scan poller:

```js
// Story 5.1: Master 5-min repricing cron.
// dispatchCycle is called by master-cron.js on each tick.
// The in-flight guard is inside master-cron.js itself.
import { startMasterCron } from './jobs/master-cron.js';
startMasterCron(logger);
```

The `startMasterCron(logger)` factory pattern keeps `master-cron.js` testable (logger injected, not module-scope singleton).

---

## Dev Notes — Critical Implementation Details

### 1. DB client pattern for dispatcher

The dispatcher uses `getServiceRoleClient()` from `shared/db/service-role-client.js` (already imported by `worker/src/index.js`). For per-customer advisory lock operations, acquire a **dedicated client** from the pool (not `pool.query`) since advisory locks are session-scoped:

```js
const client = await pool.connect();
try {
  const locked = await tryAcquireCustomerLock(client, customerMarketplaceId);
  if (!locked) { client.release(); continue; }
  // ... process customer ...
  await releaseCustomerLock(client, customerMarketplaceId);
} finally {
  client.release();
}
```

### 2. ESLint rule implementation approach

The `worker-must-filter-by-customer` rule is an AST-walking ESLint rule. The simplest correct implementation:
- Hook `CallExpression` nodes where `callee.property.name === 'query'` (for `client.query(...)`)
- Inspect the first argument (if it's a string literal or template literal) for table name references
- If the string contains a customer-scoped table name AND does NOT contain `customer_marketplace_id`, check whether the **preceding line** in source contains `// safe: cross-customer cron`
- The rule lives in `eslint-rules/worker-must-filter-by-customer.js` and exports `{ rules: { 'worker-must-filter-by-customer': rule } }` — same shape as `no-raw-cron-state-update.js`

### 3. ESLint plugin merging in eslint.config.js

Currently `eslint.config.js` has:
```js
import noRawCronStateUpdate from './eslint-rules/no-raw-cron-state-update.js';
// ...
plugins: { 'local-cron': noRawCronStateUpdate },
rules: { 'local-cron/no-raw-cron-state-update': 'error' },
```

After this story, the `local-cron` plugin block must merge BOTH rules. The cleanest approach is to merge the plugin objects:
```js
import noRawCronStateUpdate from './eslint-rules/no-raw-cron-state-update.js';
import workerMustFilter from './eslint-rules/worker-must-filter-by-customer.js';
// ...
plugins: {
  'local-cron': {
    rules: {
      'no-raw-cron-state-update': noRawCronStateUpdate.rules['no-raw-cron-state-update'],
      'worker-must-filter-by-customer': workerMustFilter.rules['worker-must-filter-by-customer'],
    },
  },
},
rules: {
  'local-cron/no-raw-cron-state-update': 'error',
  'local-cron/worker-must-filter-by-customer': 'error',
},
```

### 4. Dispatcher cross-customer SELECT needs pragma comment

The dispatcher's own initial SELECT across all ACTIVE customers is deliberately cross-customer. Add the pragma:
```js
// safe: cross-customer cron
const { rows } = await pool.query(DISPATCH_SQL, [batchSize]);
```

### 5. `cycle_summaries` write-stub pattern

Story 9.2 ships the `cycle_summaries` table schema. For now, wrap the write in a try/catch:
```js
try {
  await pool.query(
    `INSERT INTO cycle_summaries (customer_marketplace_id, cycle_id, ...) VALUES ($1, $2, ...)`,
    [customerMarketplaceId, cycleId, ...]
  );
} catch (err) {
  logger.debug({ err }, 'cycle_summaries INSERT skipped — table not yet created (Story 9.2)');
}
```

### 6. `dispatchCycle` signature

The dispatcher exports a single function that accepts an options object for testability:
```js
/**
 * Run one full dispatch cycle: select work, acquire advisory locks per customer,
 * call assembleCycle (stub until Story 5.2), emit audit events, log stats.
 *
 * @param {{ pool?: pg.Pool }} [options] — injects a mock pool in tests; defaults to getServiceRolePool()
 * @returns {Promise<{ customersProcessed: number, skusEvaluated: number, durationMs: number }>}
 */
export async function dispatchCycle (options = {}) { ... }
```

### 7. `assembleCycle` stub until Story 5.2

When the dispatcher calls `assembleCycle`, Story 5.2 hasn't shipped yet. Use a dynamic import with a fallback:
```js
let assembleCycle;
try {
  ({ assembleCycle } = await import('./cycle-assembly.js'));
} catch {
  assembleCycle = async (_tx, _cmId, _skuChannels, _cycleId) => {
    logger.debug('assembleCycle stub — Story 5.2 not yet shipped');
  };
}
```

### 8. No new migrations in this story

Story 4.1 shipped `customer_marketplaces` + `cron_state` enum. Story 4.2 shipped `sku_channels` + `idx_sku_channels_dispatch`. No schema changes are needed for the dispatcher, advisory locks, or ESLint rule. If you find yourself writing a migration, stop — something is wrong.

---

## Existing Code Patterns to Follow

### pino logging (shared/logger.js)
```js
import { createWorkerLogger } from '../../shared/logger.js';
const logger = createWorkerLogger();
```

### Service-role pool (shared/db/service-role-client.js)
```js
import { getServiceRoleClient } from '../../shared/db/service-role-client.js';
const pool = getServiceRoleClient();
```

### node-cron pattern (worker/src/index.js existing)
```js
cron.schedule('*/5 * * * *', () => {
  // guard + async call
}, { timezone: 'Europe/Lisbon' });
```

### writeAuditEvent (shared/audit/writer.js)
```js
import { writeAuditEvent } from '../../shared/audit/writer.js';
await writeAuditEvent({ tx: pool, customerMarketplaceId: null, eventType: 'cycle-start', cycleId, payload: {} });
```

### Named exports only — no default exports (enforced by ESLint `no-restricted-syntax`)

---

## Architecture Constraints — Negative Assertions

From `_bmad-output/planning-artifacts/architecture-distillate/_index.md` (27 items), items relevant to Story 5.1:

- **No Redis / BullMQ / external queue** (constraint #8) — dispatcher uses `pri01_staging` + advisory locks only; no `redis`, `ioredis`, `bullmq` imported
- **No Mirakl webhook listener** (constraint #1) — no webhook route; polling-only per AD18
- **No worker_locks table** (AD17 note) — negative assertion tested in `dispatcher.test.js`
- **No raw `UPDATE customer_marketplaces SET cron_state`** (constraint #23) — if dispatcher ever needs to pause a customer on circuit-breaker trip, use `transitionCronState` from `shared/state/cron-state.js`
- **No `console.log`** (constraint #18) — pino only; `no-console` ESLint rule enforces
- **No default exports** — `export async function dispatchCycle ...`, `export function tryAcquireCustomerLock ...`

---

## Testing Notes

### Running unit tests
```bash
node --test tests/worker/dispatcher.test.js
```
All tests in `dispatcher.test.js` are unit tests (no live DB). Integration tests (with `SUPABASE_SERVICE_ROLE_DATABASE_URL`) are in `tests/integration/dispatcher.test.js` if that file exists — create it for the advisory lock session-scope test.

### Running ESLint to verify the rule
```bash
npx eslint worker/src/dispatcher.js
npx eslint worker/src/jobs/monthly-partition-create.js  # must produce 0 violations
```

### npm run test:unit
The existing `npm run test:unit` script runs all unit tests. Verify the new tests pass:
```bash
npm run test:unit
```

---

## Story Completion Checklist

- [ ] `worker/src/jobs/master-cron.js` created with `node-cron` schedule + in-flight guard
- [ ] `worker/src/dispatcher.js` created with `dispatchCycle()` export, AD17 SQL verbatim, per-customer advisory lock iteration, audit events, stats logging
- [ ] `worker/src/advisory-lock.js` created with `tryAcquireCustomerLock`, `releaseCustomerLock`, `uuidToBigint`
- [ ] `eslint-rules/worker-must-filter-by-customer.js` updated from placeholder to full AST-walking rule
- [ ] `eslint.config.js` updated — `local-cron` plugin block merges `no-raw-cron-state-update` + `worker-must-filter-by-customer`; `'local-cron/worker-must-filter-by-customer': 'error'` added
- [ ] `worker/src/index.js` updated — imports and starts `master-cron.js`
- [ ] All `dispatcher.test.js` unit tests pass (`node --test tests/worker/dispatcher.test.js`)
- [ ] ESLint passes (`npx eslint worker/src/ eslint-rules/ eslint.config.js`)
- [ ] `npm run test:unit` passes (full unit suite including this story's tests)
- [ ] No `worker_locks` table anywhere in codebase (verified by test)
- [ ] `monthly-partition-create.js` still has `// safe: cross-customer cron` (test verifies)
