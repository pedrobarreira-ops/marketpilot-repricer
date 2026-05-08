# Story 5.2: pri01_staging Schema + Cycle-Assembly Skeleton

**Sprint-status key:** `5-2-pri01-staging-schema-cycle-assembly-skeleton`
**Status:** ready-for-dev
**Size:** M
**Epic:** Epic 5 — Cron Dispatcher & State Machine (architecture S-I phase 5)
**Atomicity:** Bundle C — staging table is the writer's input contract; gate at Story 7.8. This story is a Bundle C participant (merge blocked until Story 7.8 lands per sprint-status `merge_blocks`).
**Depends on:** Story 5.1 (dispatcher, advisory-lock, master-cron, `worker-must-filter-by-customer` ESLint rule), Story 9.0 + Story 9.1 (audit foundation — `writeAuditEvent`, event types; calendar-early per Option A — both already `done`)
**Enables:** Story 6.1 (PRI01 writer reads from `pri01_staging`), Story 7.2+ (engine writes decisions to staging via cycle-assembly)
**Worktree base branch:** `story-5.1-master-cron-dispatcher` — fork from this branch, not `main`

---

## Narrative

**As a** background worker process,
**I want** a `pri01_staging` table and a `cycle-assembly.js` skeleton that bridges the dispatcher and the pricing engine,
**So that** per-cycle pricing decisions are durably staged before the PRI01 writer flushes them to Mirakl, providing the atomicity contract required by Bundle C.

---

## Trace

- **Architecture decisions:** AD17 (cycle assembly + staging table flush), AD11 partial (per-cycle CB gate placeholder; Story 7.6 fills it in), AD7 partial (staging table is the writer's input)
- **FRs:** FR18 partial (4-state tier system + single cron backbone)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/03-epics-5-6-cron-pri01.md`, Story 5.2
- **Schema DDL:** `_bmad-output/planning-artifacts/architecture-distillate/06-database-schema.md` — `pri01_staging` table
- **Architecture patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md`
- **Bundle C context:** `_bmad-output/planning-artifacts/epics-distillate/_index.md` (Cross-Cutting: Atomicity Bundles, Bundle C)

---

## Pre-Existing Test Scaffolds — Do NOT Recreate

The test scaffold for Story 5.2 is **already committed** in the worktree base branch:

- `tests/worker/cycle-assembly.test.js` — covers AC#1–AC#3 (migration schema, RLS, assembleCycle behavior, mock engine)

Do NOT recreate or overwrite this file. Implement the source modules and migration that make these tests pass. Read the scaffold file before implementing to understand the expected `assembleCycle` signature and injection pattern.

---

## Files to Create

| File | Action | Description |
|---|---|---|
| `supabase/migrations/202604301214_create_pri01_staging.sql` | CREATE | pri01_staging DDL: table + 2 indexes + RLS policy |
| `worker/src/cycle-assembly.js` | CREATE | `assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, opts)` skeleton |

**Do NOT create:**
- Any engine files in `worker/src/engine/` (Epic 7)
- Any additional migrations (the single migration `202604301214_create_pri01_staging.sql` is the only schema change)
- Any route files, app files, or shared/ modules

**Update (minor):**
- `scripts/rls-regression-suite.js` — add `'pri01_staging'` to `CUSTOMER_SCOPED_TABLES` registry

---

## Acceptance Criteria

### AC#1 — Migration creates `pri01_staging` table; indexes; RLS policy

**Given** the migration `supabase/migrations/202604301214_create_pri01_staging.sql`
**When** I apply it (`supabase db push` or `npx supabase migration up`)
**Then**:

**Table DDL (exact):**
```sql
CREATE TABLE pri01_staging (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  sku_id                   uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  channel_code             text NOT NULL,
  new_price_cents          integer NOT NULL,
  cycle_id                 uuid NOT NULL,
  staged_at                timestamptz NOT NULL DEFAULT NOW(),
  flushed_at               timestamptz,           -- set when PRI01 submitted; nullable
  import_id                text                   -- set when PRI01 returns importId; nullable
);
```

**Indexes (exact names — tests assert on index names):**
```sql
CREATE INDEX idx_pri01_staging_cycle ON pri01_staging(cycle_id);
CREATE INDEX idx_pri01_staging_sku_unflushed
  ON pri01_staging(sku_id) WHERE flushed_at IS NULL;
```

**RLS policy** (follows the same chained-FK pattern used for `sku_channels`):
```sql
ALTER TABLE pri01_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY pri01_staging_select_own ON pri01_staging
  FOR SELECT USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );

CREATE POLICY pri01_staging_modify_own ON pri01_staging
  FOR ALL WITH CHECK (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );
```

**RLS regression suite update:**
- Add `'pri01_staging'` to `CUSTOMER_SCOPED_TABLES` array in `scripts/rls-regression-suite.js`

**Tests verify** (from scaffold):
- `migration_creates_pri01_staging_table_with_full_schema` — column names, types, nullability
- `migration_creates_idx_pri01_staging_cycle_index` — index name exact
- `migration_creates_idx_pri01_staging_sku_unflushed_index` — partial index name exact
- `rls_policy_prevents_cross_customer_staging_read` — customer A cannot read customer B's rows
- `rls_regression_suite_extended_with_pri01_staging` — grep confirms `'pri01_staging'` in suite file

---

### AC#2 — `cycle-assembly.js` skeleton: UNDERCUT/CEILING_RAISE → stage; HOLD → skip; audit per decision

**Given** `worker/src/cycle-assembly.js` exports `assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, opts)`
**When** the dispatcher calls it for a customer's batch of SKU-channels in a cycle
**Then**:

**Function signature (matches test scaffold exactly):**
```js
/**
 * Assemble one pricing cycle for a single customer's SKU-channels.
 * Writes UNDERCUT/CEILING_RAISE decisions to pri01_staging.
 * HOLD decisions emit an audit event but produce no staging row.
 * At batch end, calls circuitBreakerCheck (stub; Story 7.6 fills in).
 *
 * @param {object} tx — transaction-capable DB client (from Story 2.1 tx helper)
 * @param {string} customerMarketplaceId — UUID
 * @param {Array<object>} skuChannels — rows from dispatcher SELECT
 * @param {string} cycleId — UUID minted by dispatchCycle at cycle start
 * @param {object} [opts] — injectable dependencies for testing:
 *   - engine: { decideForSkuChannel(skuChannel, context): Promise<{action, newPriceCents, auditEvents}> }
 *   - writeAuditEvent: function (same contract as shared/audit/writer.js)
 *   - circuitBreakerCheck: async (stagedCount) => void (stub; Story 7.6)
 * @returns {Promise<{ stagedCount: number, heldCount: number }>}
 */
export async function assembleCycle (tx, customerMarketplaceId, skuChannels, cycleId, opts = {}) { ... }
```

**Engine stub fallback (when `opts.engine` not provided):**
The function must handle the case where `worker/src/engine/decide.js` has not yet shipped (Epic 7). Use a dynamic import with fallback:
```js
const engine = opts.engine ?? await (async () => {
  try {
    const { decideForSkuChannel } = await import('./engine/decide.js');
    return { decideForSkuChannel };
  } catch {
    return {
      decideForSkuChannel: async () => ({
        action: 'HOLD',
        newPriceCents: null,
        auditEvents: ['hold-already-in-1st'],
      }),
    };
  }
})();
```

**Core loop logic:**
1. Resolve `engine` and `writeAuditEvent` from `opts` (or defaults above)
2. Initialize `stagedCount = 0`, `heldCount = 0`
3. For each `skuChannel` in `skuChannels`:
   a. Call `engine.decideForSkuChannel(skuChannel, { customerMarketplaceId, cycleId })` → `{ action, newPriceCents, auditEvents }`
   b. If `action ∈ {'UNDERCUT', 'CEILING_RAISE'}`:
      - INSERT one row into `pri01_staging`:
        ```sql
        INSERT INTO pri01_staging
          (customer_marketplace_id, sku_id, channel_code, new_price_cents, cycle_id)
        VALUES ($1, $2, $3, $4, $5)
        ```
        params: `[customerMarketplaceId, skuChannel.sku_id, skuChannel.channel_code, newPriceCents, cycleId]`
      - Increment `stagedCount`
   c. If `action === 'HOLD'` (or any other non-write action):
      - Do NOT INSERT a staging row
      - Increment `heldCount`
   d. Emit each audit event returned by the engine:
      ```js
      for (const eventType of auditEvents) {
        await writeAuditEvent({
          tx,
          customerMarketplaceId,
          skuId: skuChannel.sku_id,
          skuChannelId: skuChannel.id,
          cycleId,
          eventType,
          payload: { action, newPriceCents },
        });
      }
      ```
4. At end of batch, call `circuitBreakerCheck` stub:
   ```js
   const circuitBreakerCheck = opts.circuitBreakerCheck ?? async (stagedCount) => {
     logger.debug({ stagedCount, cycleId, customerMarketplaceId }, 'cycle-assembly: circuit-breaker check (stub — Story 7.6)');
   };
   await circuitBreakerCheck(stagedCount);
   ```
5. Return `{ stagedCount, heldCount }`

**Tests verify** (from scaffold):
- `cycle_assembly_exports_assemble_cycle_function`
- `unit_tests_use_mock_engine_not_real_decide_js` — no hard-import of `./engine/decide.js` at module level
- `cycle_assembly_inserts_staging_row_for_undercut_decision`
- `cycle_assembly_inserts_staging_row_for_ceiling_raise_decision`
- `cycle_assembly_does_not_insert_staging_row_for_hold_decision`
- `cycle_assembly_propagates_cycle_id_to_staging_row`
- `cycle_assembly_emits_audit_event_for_each_decision`
- `cycle_assembly_calls_circuit_breaker_stub_at_batch_end`
- `cycle_assembly_test_covers_mixed_decisions` — 3 SKUs (UNDERCUT + HOLD + CEILING_RAISE) → 2 inserts + 3 audit calls

---

### AC#3 — Unit tests use mock engine, not real `decide.js`

**Given** `tests/worker/cycle-assembly.test.js`
**When** I run the tests with `node --test tests/worker/cycle-assembly.test.js`
**Then**:
- All AC#2 unit tests pass using mock engines injected via `opts.engine`
- `cycle-assembly.js` does NOT hard-import `./engine/decide.js` at module level (test verifies by reading source)
- Tests do not require `SUPABASE_SERVICE_ROLE_DATABASE_URL` (unit tests are DB-free; integration tests are gated behind `if (process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL)`)

---

## Dev Notes — Critical Implementation Details

### 1. Worktree base branch contains Story 5.1 code

This story's worktree forks from `story-5.1-master-cron-dispatcher`. All Story 5.1 SSoT modules are available:
- `worker/src/dispatcher.js` (dispatchCycle, the caller)
- `worker/src/advisory-lock.js`
- `worker/src/jobs/master-cron.js`
- `eslint-rules/worker-must-filter-by-customer.js` (active ESLint rule)

The dispatcher already calls `assembleCycle` via a dynamic import fallback stub — once this story ships `worker/src/cycle-assembly.js`, the dispatcher's dynamic import resolves to the real implementation automatically. No changes to dispatcher.js are needed.

### 2. Migration filename and Supabase CLI contract

The migration filename MUST be exactly: `202604301214_create_pri01_staging.sql`

Supabase CLI requires numeric-only, 12-digit migration versions (Contract #15 in `project-context.md`). This filename is already reserved in the architecture directory tree. The migrations in the worktree base branch stop at `202605081000_make_max_discount_pct_nullable.sql` — this migration does NOT exist yet.

### 3. `writeAuditEvent` injection pattern

In production (when `opts.writeAuditEvent` is not injected), import from `shared/audit/writer.js`:
```js
import { writeAuditEvent as _writeAuditEvent } from '../../shared/audit/writer.js';

// ...
const writeAuditEvent = opts.writeAuditEvent ?? _writeAuditEvent;
```

The module-level import is fine since `shared/audit/writer.js` already exists (shipped in Story 9.0). The injection pattern lets tests mock it without live DB.

### 4. Pino logger import pattern (matches Story 5.1)

```js
import { createWorkerLogger } from '../../shared/logger.js';
const logger = createWorkerLogger();
```

### 5. `worker-must-filter-by-customer` ESLint compliance

The `cycle-assembly.js` file executes INSERT statements on `pri01_staging` — a customer-scoped table. The INSERT includes `customer_marketplace_id` as a parameter, which satisfies the ESLint rule. Verify that the INSERT SQL string references `customer_marketplace_id` explicitly.

The INSERT SQL pattern:
```sql
INSERT INTO pri01_staging
  (customer_marketplace_id, sku_id, channel_code, new_price_cents, cycle_id)
VALUES ($1, $2, $3, $4, $5)
```
This includes `customer_marketplace_id` in the column list — the ESLint rule scans for `customer_marketplace_id` in the query string and will pass.

### 6. Named exports only — no default exports (enforced by ESLint)

```js
// CORRECT:
export async function assembleCycle (...) { ... }

// WRONG:
export default async function (...) { ... }
```

### 7. No `.then()` chains — async/await only (ESLint enforces)

### 8. RLS policy chain for `pri01_staging`

The RLS policy must chain through `customer_marketplaces`:
```sql
customer_marketplace_id IN (
  SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
)
```
This is the same pattern as `sku_channels`, `baseline_snapshots`, etc. Do NOT use a simpler `customer_id = auth.uid()` check — `pri01_staging` has no direct `customer_id` column.

### 9. No `cycle_summaries` write in this story

`cycle_summaries` table ships in Story 9.2. Cycle-assembly does NOT write to it. That write lives in the dispatcher's post-cycle stats logic (Story 5.1 already handles it with a try/catch stub). Do not add any `cycle_summaries` INSERT to `cycle-assembly.js`.

### 10. The `context` parameter to `decideForSkuChannel`

The engine's `decideForSkuChannel` receives `(skuChannel, context)`. The context object at this story is minimal:
```js
{ customerMarketplaceId, cycleId }
```
Epic 7 (decide.js) will expand this with engine config (max_discount_pct, etc.) — but the stub and the cycle-assembly skeleton only need these two fields.

---

## Bundle C Invariant (partial — for this story)

At this stage of Bundle C, the invariant enforced by this story is structural:
- Every `pri01_staging` row carries a `cycle_id` — linking it to the dispatcher cycle that produced it
- `pending_import_id IS NULL` on `sku_channels` rows is the dispatcher's precondition (AC#2 of Story 5.1 ensures this via the WHERE clause in the dispatch SQL)
- This story does NOT yet set `sku_channels.pending_import_id` (that is Story 6.1's job after PRI01 submission)

The full Bundle C atomicity proof (every participating `sku_channel` row has non-NULL `pending_import_id` after PRI01 submit) ships at Story 7.8 gate.

---

## Architecture Constraints — Negative Assertions

From `_bmad-output/planning-artifacts/architecture-distillate/_index.md` (27 items), items relevant to Story 5.2:

- **No Redis / BullMQ / external queue** (constraint #8) — staging table IS the queue; no external message broker
- **No raw `INSERT INTO audit_log` outside `shared/audit/writer.js`** (constraint #21) — audit events go via `writeAuditEvent`, never direct SQL
- **No worker query missing `customer_marketplace_id` filter** (constraint #24) — the staging INSERT always includes `customer_marketplace_id` as first column
- **No `console.log`** (constraint #18) — pino logger only
- **No default exports** — `export async function assembleCycle ...`
- **No `.then()` chains** — async/await only

---

## Existing Code Patterns to Follow

### pino logger
```js
import { createWorkerLogger } from '../../shared/logger.js';
const logger = createWorkerLogger();
```

### writeAuditEvent (shared/audit/writer.js)
```js
import { writeAuditEvent as _writeAuditEvent } from '../../shared/audit/writer.js';

// In assembleCycle:
await writeAuditEvent({
  tx,
  customerMarketplaceId,
  skuId: skuChannel.sku_id,
  skuChannelId: skuChannel.id,
  cycleId,
  eventType: 'hold-already-in-1st',  // or whatever auditEvents[] returns
  payload: { action, newPriceCents },
});
```

### RLS migration pattern (follows Story 4.1 + Story 9.1 pattern in worktree)
Look at an existing migration in `supabase/migrations/` for the exact SQL header/comment style.

---

## Testing Instructions

### Run unit tests (no DB required)
```bash
node --test tests/worker/cycle-assembly.test.js
```
This runs all unit tests (AC#2, AC#3). They must all pass without `SUPABASE_SERVICE_ROLE_DATABASE_URL`.

### Run ESLint to verify compliance
```bash
npx eslint worker/src/cycle-assembly.js
```
Must produce 0 violations (including the `worker-must-filter-by-customer` rule from Story 5.1).

### Run full unit suite
```bash
npm run test:unit
```
Verify no regressions in the full unit test suite.

### Integration tests (require local Supabase)
Integration tests in `tests/worker/cycle-assembly.test.js` (gated behind `if (process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL)`) exercise:
- Migration schema validation
- RLS cross-customer isolation
- RLS regression suite inclusion

These run as part of `npm run test:integration` — tagged `integration_test_required: false` for Story 5.2 (no entry in sprint-status `integration_test_required` block), so Phase 4.5 gate does NOT halt for this story. Integration tests are still recommended to run locally before PR.

---

## Story Completion Checklist

- [ ] `supabase/migrations/202604301214_create_pri01_staging.sql` created with exact DDL (table + 2 indexes + RLS policy)
- [ ] `worker/src/cycle-assembly.js` created with `assembleCycle` export matching scaffold's injection signature
- [ ] `scripts/rls-regression-suite.js` updated — `'pri01_staging'` added to `CUSTOMER_SCOPED_TABLES`
- [ ] All unit tests pass: `node --test tests/worker/cycle-assembly.test.js`
- [ ] ESLint passes: `npx eslint worker/src/cycle-assembly.js`
- [ ] `npm run test:unit` passes (full unit suite, no regressions)
- [ ] No `worker_locks` table or engine logic added (negative assertions hold)
- [ ] No hard-import of `./engine/decide.js` at module level in `cycle-assembly.js`
- [ ] Named exports only — no default export
- [ ] pino logger used, not `console.log`

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
