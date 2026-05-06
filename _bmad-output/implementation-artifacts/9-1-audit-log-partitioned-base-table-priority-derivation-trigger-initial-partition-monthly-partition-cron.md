# Story 9.1: `audit_log` Partitioned Base Table + Priority-Derivation Trigger + Initial Partition + Monthly Partition Cron

**Sprint-status key:** `9-1-audit-log-partitioned-base-table-priority-derivation-trigger-initial-partition-monthly-partition-cron`
**Status:** review
**Size:** L
**Calendar position:** CALENDAR-EARLY — Story 1.x sibling; ships BEFORE Epic 3. Order: Story 9.0 → **Story 9.1** → all event-emitting stories (Epics 4–12).

---

## Narrative

**As a** BAD subagent implementing any story that emits audit events (Stories 4.1, 5.1, 6.x, 7.x, 10.x, 11.x, 12.x),
**I want** a partitioned `audit_log` table with a priority-derivation trigger, pre-seeded monthly partitions, and an automated monthly partition-creation cron,
**So that** `writeAuditEvent` (from Story 9.0) has a table to write to, audit events land in the correct month's partition with trigger-derived priority automatically, RLS enforces per-customer isolation, and partition management is automated — all before any feature story emits a single event.

---

## Trace

- **Architecture decisions:** AD19 (monthly partitioning + compound indexes + precomputed aggregates), AD20 (priority-derivation trigger consuming `audit_log_event_types` lookup from Story 9.0)
- **Amendments:** F8 (NO FK on `sku_id` / `sku_channel_id`), F5 (migration ordering: this migration MUST run after Story 9.0's `20260430120730_create_audit_log_event_types.sql`)
- **Functional requirements:** FR37 partial (storage layer for all audit events)
- **Non-functional requirements:** NFR-S6 (append-only at app layer), NFR-P8 (≤2s on 90-day window — partitioning + indexes make this feasible)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/06-epics-9-10-audit-deletion.md`, Story 9.1
- **Architecture schema DDL:** `_bmad-output/planning-artifacts/architecture-distillate/06-database-schema.md` — `audit_log` section

---

## SSoT Module Introduced

**`worker/src/jobs/monthly-partition-create.js`** — runs on the 28th of each month at 02:00 Lisbon time, creates the partition for the FOLLOWING month (`IF NOT EXISTS`). This cron is cross-customer by design — it creates partitions for the shared table, not per-customer rows. The `worker-must-filter-by-customer` ESLint rule (Story 5.1) is satisfied via a `// safe: cross-customer cron` pragma comment. This pragma must be in place from day 1 of this story; Story 5.1's BAD subagent is documented to retrofit it, but preempting it here is correct and required.

---

## Dependencies

- **Story 9.0** (DONE): `audit_log_event_types` lookup table + `audit_log_priority` enum must exist FIRST. The FK `audit_log.event_type → audit_log_event_types(event_type)` and the priority-derivation trigger both depend on it. Migration ordering: this story's `202604301208_create_audit_log_partitioned.sql` MUST run after `20260430120730_create_audit_log_event_types.sql` (F5 amendment — filename sort puts `20260430120730` before `202604301208` at position 11 `'7' < '8'`).
- **Story 1.1** (DONE): worker service scaffold exists; `worker/src/jobs/` directory, `node-cron` in package.json, `eslint.config.js` all present.
- **Story 2.1** (DONE): `shared/db/service-role-client.js` (`getServiceRoleClient`, `closeServiceRolePool`), `shared/db/rls-aware-client.js` (`getRlsAwareClient`), and `shared/db/tx.js` — the cron job uses the service-role pg Pool.

**Enables (blocked until this story is done):**
- `shared/audit/writer.js` (Story 9.0, already shipped) has a table to INSERT into — until this migration runs, all `writeAuditEvent` calls fail at runtime.
- Every event-emitting story across Epics 4–12 that calls `writeAuditEvent`.
- Story 9.2 (`daily_kpi_snapshots` + `cycle_summaries`) which aggregates from `audit_log`.
- RLS regression suite extension (AC5) that adds `audit_log` to the `CUSTOMER_SCOPED_TABLES` registry.

---

## Critical Constraints (Do Not Violate)

1. **F8 amendment — NO FK on `sku_id` or `sku_channel_id`**: these two columns are intentionally left without FK constraints. An inline schema comment MUST document the F8 rationale. Future devs must not reflexively add the FK "for cleanliness".

2. **Priority is NEVER set by the application** — the `audit_log_set_priority` BEFORE INSERT trigger derives it from `audit_log_event_types`. `writeAuditEvent` does not pass `priority`. If the trigger receives an unknown `event_type`, it RAISES EXCEPTION (the DB-level guard).

3. **`monthly-partition-create.js` is cross-customer by design** — it creates partitions on the shared table. The `// safe: cross-customer cron` ESLint opt-out comment is MANDATORY from day 1 (Story 5.1's `worker-must-filter-by-customer` rule will flag it otherwise when that rule lands).

4. **Migration ordering (F5 invariant)**: `202604301208_create_audit_log_partitioned.sql` must appear after `20260430120730_create_audit_log_event_types.sql` in lexicographic filename order. The existing filenames already satisfy this (`'7' < '8'` at position 11); do NOT rename either migration file.

5. **`node-cron` TZ setting** — the cron schedule `0 2 28 * *` must be qualified with the Europe/Lisbon timezone. Verify the worker's cron setup pattern from Story 1.1 (`worker/src/jobs/heartbeat.js`).

6. **Bob seeds 12 months ahead** — the initial migration creates partitions from the current month (2026-05) through 12 months forward (through 2027-04), not just one partition. Subsequent months are handled by the cron. See AC2.

7. **RLS append-only invariant (NFR-S6)**: customer-scoped RLS SELECT policy uses `customer_marketplace_id`; INSERT/UPDATE/DELETE for customers is DENIED. Only service-role (worker) can INSERT. No UPDATE or DELETE is ever legitimate at the app layer.

---

## File-Touch List

### New files

| File | Purpose |
|------|---------|
| `supabase/migrations/202604301208_create_audit_log_partitioned.sql` | Partitioned `audit_log` base table + 12 initial monthly partitions (2026-05 through 2027-04) + 4 compound indexes + `audit_log_set_priority` trigger function + trigger registration + RLS policies |
| `worker/src/jobs/monthly-partition-create.js` | SSoT cron: 28th of each month at 02:00 Lisbon — creates NEXT month's partition `IF NOT EXISTS`; `// safe: cross-customer cron` pragma |

### Modified files

| File | Change |
|------|--------|
| `worker/src/index.js` | Register `monthly-partition-create.js` cron with `node-cron` (same pattern as `heartbeat.js`) |
| `tests/integration/rls-regression.test.js` | Extend `CUSTOMER_SCOPED_TABLES` registry to include `audit_log` — required per AC5; `audit_log` IS customer-scoped (reads gated by `customer_marketplace_id`) |

**NOTE:** `tests/integration/audit-log-partition.test.js` already exists (shipped as a skeleton by Story 9.0 ATDD); the Story 9.1 assertions in it will activate once the migration runs. Do NOT create a new integration test file — extend the existing one if any assertion is missing (reference the file for Story 9.1 AC coverage already there).

---

## Acceptance Criteria

### AC1 — Migration: `audit_log` partitioned base table

**Given** the migration `202604301208_create_audit_log_partitioned.sql`
**When** I apply it
**Then** the `audit_log` base table exists with exactly this schema:

```sql
CREATE TABLE audit_log (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL,
  -- F8: sku_id and sku_channel_id intentionally carry NO FK constraint —
  -- preserves audit history if a SKU or sku_channel is later removed from
  -- catalog (e.g., seller delists). Audit log is immutable per NFR-S6;
  -- referential integrity to ephemeral catalog rows would compromise that.
  sku_id                   uuid,
  sku_channel_id           uuid,
  cycle_id                 uuid,
  event_type               text NOT NULL REFERENCES audit_log_event_types(event_type),
  priority                 audit_log_priority NOT NULL,
  payload                  jsonb NOT NULL,
  resolved_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

**And** `sku_id` and `sku_channel_id` have NO FK constraints (F8 amendment — inline SQL comment required explaining this rationale)
**And** `event_type` DOES have FK to `audit_log_event_types(event_type)` (this FK is intentional — event_types is a versioned schema, not ephemeral catalog data)
**And** `PRIMARY KEY (id, created_at)` is composite for partitioning compatibility

---

### AC2 — Initial monthly partitions (12 months ahead)

**Given** the MVP launch month is 2026-05
**When** the migration runs
**Then** the following 12 partitions are created within the same migration (one per month, from launch month through 12 months ahead):

```sql
CREATE TABLE audit_log_2026_05 PARTITION OF audit_log FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_log_2026_06 PARTITION OF audit_log FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_log_2026_07 PARTITION OF audit_log FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_log_2026_08 PARTITION OF audit_log FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_log_2026_09 PARTITION OF audit_log FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_log_2026_10 PARTITION OF audit_log FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_log_2026_11 PARTITION OF audit_log FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_log_2026_12 PARTITION OF audit_log FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_log_2027_01 PARTITION OF audit_log FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE audit_log_2027_02 PARTITION OF audit_log FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE audit_log_2027_03 PARTITION OF audit_log FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE audit_log_2027_04 PARTITION OF audit_log FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
```

**And** the integration test `at least one audit_log partition exists (initial partition from migration)` in `tests/integration/audit-log-partition.test.js` passes (it already exists and checks `pg_inherits` for at least 1 partition)

---

### AC3 — Priority-derivation trigger

**Given** the priority trigger function and registration in the migration
**When** any `INSERT INTO audit_log` runs
**Then** the `audit_log_set_priority` BEFORE INSERT trigger fires with this exact logic:

```sql
CREATE OR REPLACE FUNCTION audit_log_set_priority () RETURNS trigger AS $$
BEGIN
  SELECT priority INTO NEW.priority
    FROM audit_log_event_types
   WHERE event_type = NEW.event_type;
  IF NEW.priority IS NULL THEN
    RAISE EXCEPTION 'Unknown audit_log event_type: %', NEW.event_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_set_priority
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_set_priority();
```

**And** inserting `event_type = 'cycle-start'` produces `priority = 'rotina'` (derived from lookup table)
**And** inserting `event_type = 'anomaly-freeze'` produces `priority = 'atencao'`
**And** inserting an unknown `event_type = 'not-a-real-event'` raises an EXCEPTION matching `/unknown audit_log event_type/i`
**And** the caller (`writeAuditEvent`) does NOT pass `priority` in the INSERT statement — the trigger sets it

---

### AC4 — Compound indexes (AD19 spec)

**Given** the migration creates the partitioned table
**When** I inspect the schema via `pg_indexes`
**Then** all four compound indexes exist on the base table (Postgres propagates them to all partitions):

| Index name | Definition |
|---|---|
| `idx_audit_log_customer_created` | `ON audit_log(customer_marketplace_id, created_at DESC)` — primary query path |
| `idx_audit_log_customer_sku_created` | `ON audit_log(customer_marketplace_id, sku_id, created_at DESC) WHERE sku_id IS NOT NULL` — search-by-SKU surface (Story 9.4) |
| `idx_audit_log_customer_eventtype_created` | `ON audit_log(customer_marketplace_id, event_type, created_at DESC)` — feed filtering (Story 9.3) |
| `idx_audit_log_customer_cycle` | `ON audit_log(customer_marketplace_id, cycle_id, sku_id) WHERE cycle_id IS NOT NULL` — firehose drill-down (Story 9.5) |

**And** the integration tests `idx_audit_log_customer_created index exists`, `idx_audit_log_customer_sku_created index exists`, `idx_audit_log_customer_eventtype_created index exists`, `idx_audit_log_customer_cycle index exists` in `tests/integration/audit-log-partition.test.js` all pass

---

### AC5 — RLS policies + regression suite extension

**Given** RLS policies on the `audit_log` partitioned table
**When** customer A queries `audit_log` via the RLS-aware client (JWT-scoped)
**Then** customer A sees ONLY rows where `customer_marketplace_id` matches their marketplace
**And** INSERT / UPDATE / DELETE by customers are FORBIDDEN (NFR-S6 append-only at app layer — only worker via service-role inserts)
**And** `tests/integration/rls-regression.test.js` has `audit_log` added to the `CUSTOMER_SCOPED_TABLES` registry

**RLS policy SQL (include in migration):**
```sql
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Customer read-only: own rows via customer_marketplace_id chain
CREATE POLICY audit_log_select_own ON audit_log
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces
      WHERE customer_id = auth.uid()
    )
  );

-- INSERT / UPDATE / DELETE: denied for customers (service-role only)
-- (no permissive policies for these operations = denied by default under RLS)
```

**Note on RLS + partitioning:** Postgres applies RLS on the parent table; policies propagate to partitions automatically. No per-partition RLS setup needed.

---

### AC6 — `worker/src/jobs/monthly-partition-create.js` cron

**Given** `worker/src/jobs/monthly-partition-create.js` registered with `node-cron` in `worker/src/index.js`
**When** the cron tick fires on the 28th of each month at 02:00 Lisbon time (`0 2 28 * *` with `Europe/Lisbon` TZ)
**Then** the job:
1. Computes the FOLLOWING month's name (e.g., on May 28th → creates partition for July if running 2 months ahead, OR the spec says "FOLLOWING month" = the month after the next one; re-reading the epics spec carefully: "creates the partition for the FOLLOWING month (e.g., on May 28th 02:00 → creates `audit_log_2026_07` for July if not exists; the buffer ensures partitions exist before they're needed)"). The cron creates 2 months ahead — the initial migration covers the first 12, after which the cron covers month 13+.
2. Executes `CREATE TABLE IF NOT EXISTS audit_log_<YYYY>_<MM> PARTITION OF audit_log FOR VALUES FROM ('<YYYY-MM-01>') TO ('<next-month-01>')` via the service-role pg Pool
3. Logs at `info` level via pino with the new partition's date range (e.g., `{ msg: 'monthly-partition-create: partition created', partition: 'audit_log_2027_05', from: '2027-05-01', to: '2027-06-01' }`)
4. If the CREATE fails for any reason other than "already exists", logs at `error` level via pino (the `IF NOT EXISTS` means pre-existing partitions are not an error)

**And** the cron has the `// safe: cross-customer cron` pragma comment at the top of the file (Story 5.1's `worker-must-filter-by-customer` ESLint rule will flag cross-customer cron jobs without this comment)

**And** the cron IS idempotent — re-running it multiple times produces no errors or duplicate partitions

**Cron pattern to follow:** See `worker/src/jobs/heartbeat.js` for the existing node-cron registration pattern; follow the same structure.

**TZ handling:** node-cron supports `{ timezone: 'Europe/Lisbon' }` option in the schedule call. Use it explicitly.

---

### AC7 — Integration test coverage

**Given** `tests/integration/audit-log-partition.test.js` already exists (shipped by Story 9.0 ATDD)
**When** the Story 9.1 migration is applied and integration tests run
**Then** ALL Story 9.1 assertions in that file activate (they skip gracefully when `audit_log` table is absent — designed for the Story 9.0 → 9.1 window):

- `audit_log table exists and is partitioned by range on created_at` — passes
- `audit_log has no FK constraint on sku_id (F8 amendment)` — passes
- `audit_log has no FK constraint on sku_channel_id (F8 amendment)` — passes
- `audit_log has FK on event_type referencing audit_log_event_types` — passes
- `audit_log has required columns: id, customer_marketplace_id, event_type, priority, payload, created_at` — passes
- `INSERT into audit_log with known event_type derives priority automatically` — passes (requires `customer_marketplaces` table — will skip gracefully if Epic 4 not yet run)
- `INSERT into audit_log with unknown event_type raises EXCEPTION` — passes (same Epic 4 dependency)
- All 4 index existence tests — pass
- `RLS: customer A JWT returns 0 audit_log rows owned by customer B` — passes (same Epic 4 dependency)
- `at least one audit_log partition exists` — passes
- `rls-regression.test.js registry includes audit_log` — passes (requires the `CUSTOMER_SCOPED_TABLES` modification in AC5)

**Do NOT create a new integration test file.** The existing `tests/integration/audit-log-partition.test.js` covers all assertions.

---

## Implementation Notes

### Migration file structure

The migration `202604301208_create_audit_log_partitioned.sql` should follow this order:
1. `CREATE TABLE audit_log (...) PARTITION BY RANGE (created_at)` — base table with F8 inline comment
2. `CREATE TABLE audit_log_2026_05 PARTITION OF audit_log FOR VALUES FROM...` × 12 — initial partitions
3. `CREATE INDEX idx_audit_log_customer_created ON audit_log(...)` × 4 — compound indexes
4. `CREATE OR REPLACE FUNCTION audit_log_set_priority() ...` — trigger function
5. `CREATE TRIGGER trg_audit_log_set_priority ...` — trigger registration
6. `ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ...` — RLS

### node-cron registration in worker/src/index.js

Add to `worker/src/index.js` — import the cron job and schedule it with `node-cron`:

```js
import cron from 'node-cron';
import { runMonthlyPartitionCreate } from './jobs/monthly-partition-create.js';
// ... (add after startHeartbeat(logger) at the bottom)
cron.schedule('0 2 28 * *', () => runMonthlyPartitionCreate(logger), { timezone: 'Europe/Lisbon' });
```

The logger is the worker-level pino logger created at boot (`createWorkerLogger()`) — pass it through to the cron function as a parameter, following the same pattern as `startHeartbeat(logger)`. Do NOT call `createWorkerLogger()` again inside the cron job; use the one from `index.js`.

### monthly-partition-create.js structure

The function accepts a `logger` parameter (passed from `worker/src/index.js`). The logger is the pino instance from `createWorkerLogger()` — do NOT import or create a new logger inside this file.

```js
// worker/src/jobs/monthly-partition-create.js
// safe: cross-customer cron — creates audit_log partitions for the shared table,
// not per-customer rows. Not subject to worker-must-filter-by-customer rule.

import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';

/**
 * Creates the audit_log partition for 2 months from now (IF NOT EXISTS).
 * Runs on the 28th of each month at 02:00 Lisbon — safe buffer before month boundary.
 *
 * @param {import('pino').Logger} logger - Worker-level pino logger from index.js
 */
export async function runMonthlyPartitionCreate (logger) {
  // Compute the partition 2 months from now (28th fires next month is already
  // covered by the migration; the "buffer" month is the one after next).
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');
  const nextMonth = new Date(target.getFullYear(), target.getMonth() + 1, 1);
  const nextYear = nextMonth.getFullYear();
  const nextMonthStr = String(nextMonth.getMonth() + 1).padStart(2, '0');

  const partitionName = `audit_log_${year}_${month}`;
  const fromVal = `${year}-${month}-01`;
  const toVal = `${nextYear}-${nextMonthStr}-01`;

  const db = getServiceRoleClient();
  try {
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF audit_log
       FOR VALUES FROM ('${fromVal}') TO ('${toVal}')`
    );
    logger.info({ partition: partitionName, from: fromVal, to: toVal }, 'monthly-partition-create: partition ready');
  } catch (err) {
    logger.error({ partition: partitionName, err: err.message }, 'monthly-partition-create: failed to create partition');
  }
}
```

**Note on the "FOLLOWING month" semantics from the epics spec AC6:** The epics spec says "on May 28th 02:00 → creates `audit_log_2026_07` for July". This means the cron creates a partition 2 calendar months ahead of the trigger date (May 28 → July partition). The logic above (`month + 2`) implements this correctly. The initial migration's 12 partitions (May 2026–Apr 2027) cover the first year; the cron takes over from month 13 onward.

### `integration_test_required` assessment

Story 9.1 introduces:
- A SQL migration with a trigger, RLS, and indexes → qualifies as "pg / Postgres schema migration with business logic" (the trigger IS business logic)
- An integration test file that exercises the migration via live Supabase

**Decision: `integration_test_required: true`** — the trigger-derived priority, RLS isolation, and index existence all require a live Supabase local instance. Bob must add this entry to `sprint-status.yaml` after committing the story spec.

### Interaction with Story 9.0's `writeAuditEvent`

Story 9.0 shipped `shared/audit/writer.js` which does the INSERT, but `audit_log` didn't exist yet. Once this story's migration lands, `writeAuditEvent` becomes fully operational. No code change needed in `writer.js`.

The existing `tests/integration/audit-log-partition.test.js` already contains the dependency-gate logic (`skipIfNo91()`) that cleanly skips Story 9.1-dependent assertions when the table is absent. This is battle-tested — do not modify the skip logic.

### ESLint `// safe: cross-customer cron` pragma

This pragma must appear at the **top of the file** (before the function declaration) so that the `worker-must-filter-by-customer` ESLint rule (shipped by Story 5.1) can detect it. The rule does a file-level comment scan. Placing it only in a comment inside the function body is insufficient.

Story 5.1's sprint-status note explicitly says: "BAD subagent must retrofit `// safe: cross-customer cron` to Story 9.1's `worker/src/jobs/monthly-partition-create.js`". Since we're building this story NOW, we preempt the retrofit by including it from the start — correct and required.

### Resolved_at column

The `resolved_at timestamptz` column is for Atenção events resolved by the customer (Stories 7.4 anomaly-review and 7.6 circuit-breaker manual unblock will UPDATE this column via service-role after the customer confirms/rejects). No special handling needed at Story 9.1 — it's nullable and defaults NULL.

---

## Out of Scope for This Story

The following are explicitly deferred to later stories:
- `daily_kpi_snapshots` and `cycle_summaries` tables → **Story 9.2**
- `shared/audit/readers.js` (query helpers for the 5 audit surfaces) → **Story 9.3**
- Audit log archive job (detach old partitions >90 days) → **Story 9.6**
- Any UI surface for audit events → **Stories 9.3–9.5**
- Story 12.1's `cycle-fail-sustained` (27th event_type) → **Story 12.1** (adds a new migration row)
- Story 12.3's `platform-features-changed` (28th event_type) → **Story 12.3** (adds a new migration row)
- `audit_log_atencao_archive` table (long-term Atenção archive for Story 9.6's archive job) → **Story 9.6**

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented `supabase/migrations/202604301208_create_audit_log_partitioned.sql`: base partitioned table with F8 inline no-FK comment on sku_id and sku_channel_id, 12 monthly partitions (2026-05 through 2027-04), 4 compound indexes (AD19), `audit_log_set_priority` BEFORE INSERT trigger function + trigger registration, RLS with `audit_log_select_own` SELECT policy and deny-by-default for INSERT/UPDATE/DELETE (NFR-S6). Migration lexicographic order verified: `20260430120730` < `202604301208` (F5 satisfied).
- Implemented `worker/src/jobs/monthly-partition-create.js`: `// safe: cross-customer cron` pragma at top of file (preempting Story 5.1 retrofit), `runMonthlyPartitionCreate(logger)` computes 2 months ahead, creates partition IF NOT EXISTS via service-role pool, logs info/error via caller-provided pino logger (no new logger creation inside the function).
- Updated `worker/src/index.js`: imported `node-cron` and `runMonthlyPartitionCreate`; registered cron schedule `0 2 28 * *` with `{ timezone: 'Europe/Lisbon' }` after `startHeartbeat(logger)`.
- Updated `tests/integration/rls-regression.test.js`: added `audit_log` entry to `CUSTOMER_SCOPED_TABLES` registry (deferred: true — requires Epic 4 `customer_marketplaces` FK target for row-level seeding). Also updated the `negative_assertion_no_migration_missing_rls_policy` regex to skip `PARTITION OF` child tables (they inherit RLS from parent; the fix prevents false positives from the 12 audit_log partition child tables).
- Updated `scripts/rls-regression-suite.js`: added matching `audit_log` entry to CUSTOMER_SCOPED_TABLES (deferred, no-op query builders) to keep registries in sync per `convention_script_and_test_registries_match` test.
- All Story 9.1 integration test assertions in `tests/integration/audit-log-partition.test.js` will activate once the migration is applied. Tests that require Epic 4 `customer_marketplaces` skip gracefully via existing `t.skip()` guards.
- ESLint clean on all new/modified source files; pre-existing lint errors in `.claude/skills/continuous-learning/scripts/` are unrelated to this story.

### File List

- `supabase/migrations/202604301208_create_audit_log_partitioned.sql` (new)
- `worker/src/jobs/monthly-partition-create.js` (new)
- `worker/src/index.js` (modified)
- `tests/integration/rls-regression.test.js` (modified)
- `scripts/rls-regression-suite.js` (modified)
- `_bmad-output/implementation-artifacts/9-1-audit-log-partitioned-base-table-priority-derivation-trigger-initial-partition-monthly-partition-cron.md` (modified — status, completion notes, file list)

### Change Log

- 2026-05-06: Story 9.1 implementation complete. Added `audit_log` partitioned base table migration, monthly partition cron job, worker registration, and RLS registry extensions. Status → review.
