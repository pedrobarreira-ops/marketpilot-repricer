# Story 6.2: `shared/mirakl/pri02-poller.js` + `worker/src/jobs/pri02-poll.js` cron entry + COMPLETE/FAILED handling

> Endpoints verified against Mirakl MCP and architecture-distillate empirical facts (2026-05-08).
> PRI02: `GET /api/offers/pricing/imports` with `import_id` query param. Status enum: `WAITING | RUNNING | COMPLETE | FAILED`. Response: `data[]` array with `data.import_id`, `data.status`, `data.has_error_report`, `data.lines_in_error`, `data.lines_in_success`, `data.offers_in_error`, `data.offers_updated`, `data.date_created`. Call frequency: recommended every 5 min after PRI01; max once per minute. Auth: raw `Authorization: <apiKey>` (no Bearer prefix). MCP confirms seller endpoint matches architecture spec exactly.

**Sprint-status key:** `6-2-shared-mirakl-pri02-poller-js-worker-src-jobs-pri02-poll-js-cron-entry-complete-failed-handling`
**Status:** ready-for-dev
**Size:** M
**Epic:** Epic 6 — PRI01 Writer Plumbing (architecture S-I phase 6)
**Atomicity:** Bundle C — pending_import_id chain closure; gate at Story 7.8. This story is a Bundle C participant (merge blocked until Story 7.8 lands per sprint-status `merge_blocks`).
**Depends on:** Story 3.1 (api-client: `mirAklGet`, `MiraklApiError`), Story 6.1 (`pending_import_id` set by writer; `pri01_staging.flushed_at` timestamp for stuck-WAITING detection), Story 9.0 + Story 9.1 (audit foundation: `writeAuditEvent`, event types; calendar-early per Option A — both already `done`)
**Enables:** Story 6.3 (PRI03 parser invoked on FAILED), Story 7.3 (cooperative-absorption observes cleared `pending_import_id`)
**Worktree base branch:** `story-6.1-pri01-writer-aggregation-multipart-submit` — fork from this branch (atomicity-bundle stacked dispatch exception; Story 6.2 builds on Story 6.1's unmerged PR #83 code)

---

## Narrative

**As a** background worker process,
**I want** a PRI02 polling module that resolves in-flight PRI01 imports (COMPLETE → clear `pending_import_id` + update `last_set_price_cents`; FAILED → clear state + invoke PRI03 parser; WAITING/RUNNING → leave unchanged; stuck >30min → critical alert),
**So that** the Bundle C `pending_import_id` lifecycle is fully closed — rows cleared by PRI02 become eligible for the next dispatcher cycle, and cooperative-absorption's skip-on-pending predicate always reflects accurate in-flight state.

---

## Trace

- **Architecture decisions:** AD7 (poller half — PRI02 COMPLETE/FAILED handling), AD5 (HTTP client patterns), AD9 (cooperative-absorption skip-on-pending predicate depends on `pending_import_id` being cleared), Bundle C gate at Story 7.8
- **FRs:** FR23 (PRI02 polling); NFR-P5 (PRI01→PRI02 ≤30min resolution)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/03-epics-5-6-cron-pri01.md`, Story 6.2
- **Architecture decisions A-D:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` — AD7 (PRI01 9-point semantic + PRI02 COMPLETE/FAILED spec), AD5 (HTTP client)
- **Architecture index:** `_bmad-output/planning-artifacts/architecture-distillate/_index.md` — Bundle C spec, empirically-verified Mirakl facts, SSoT module index
- **Directory tree:** `_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md` — exact file paths
- **Previous story (6.1) spec:** `_bmad-output/implementation-artifacts/6-1-shared-mirakl-pri01-writer-js-per-sku-aggregation-multipart-submit-pending-import-id-atomicity-no-raw-csv-building-eslint-rule.md` — established patterns for: retry helpers duplication, `mirAklGet` re-use, ESLint compliance, `worker-must-filter-by-customer` annotation

---

## Pre-Existing Test Scaffolds — Do NOT Recreate

The test scaffold for Story 6.2 is **already committed** in the worktree:

- `tests/shared/mirakl/pri02-poller.test.js` — scaffold committed at Epic-Start (21 test stubs for AC#1–AC#5)

**Do NOT create** `tests/shared/mirakl/pri02-poller.test.js` — it already exists. Read it before implementing to understand the expected function signatures and injection patterns. Uncomment imports and fill in `TODO (Amelia)` stubs.

Test names that must pass (from `epic-6-test-plan.md`):
- `pri02_poll_cron_is_registered_at_worker_boot`
- `pri02_poll_queries_distinct_pending_import_ids_cross_customer`
- `poll_import_status_complete_clears_pending_import_id_for_all_rows`
- `poll_import_status_complete_sets_last_set_price_cents`
- `poll_import_status_complete_sets_last_set_at`
- `poll_import_status_complete_clears_pending_set_price_cents`
- `poll_import_status_complete_emits_pri02_complete_audit_event`
- `poll_import_status_complete_operates_in_single_transaction`
- `poll_import_status_complete_rows_eligible_for_next_dispatcher_cycle`
- `poll_import_status_failed_clears_pending_import_id`
- `poll_import_status_failed_clears_pending_set_price_cents`
- `poll_import_status_failed_invokes_pri03_parser`
- `poll_import_status_failed_clears_in_single_transaction`
- `poll_import_status_failed_emits_pri02_failed_transient_event`
- `poll_import_status_failed_three_consecutive_failures_emits_atencao`
- `poll_import_status_waiting_leaves_pending_import_id_set`
- `poll_import_status_running_leaves_pending_import_id_set`
- `poll_import_status_stuck_waiting_30min_triggers_critical_alert`
- `pri02_poller_unit_test_file_covers_complete_path`
- `pending_import_id_invariant_between_set_and_clear`

---

## Files to Create

| File | Action | Description |
|---|---|---|
| `shared/mirakl/pri02-poller.js` | CREATE | Two exports: `pollImportStatus`, `clearPendingImport` |
| `worker/src/jobs/pri02-poll.js` | CREATE | `node-cron` job: every 5 min → query pending imports → call poller |

**Update (minor):**
- `worker/src/index.js` — register `pri02-poll.js` at worker boot (same pattern as `master-cron.js`)

**Do NOT create:**
- Any migration files (no schema changes in this story — `sku_channels` already has `pending_import_id`, `pending_set_price_cents`, `last_set_price_cents`, `last_set_at` from prior stories)
- `shared/mirakl/pri03-parser.js` (Story 6.3)
- Any engine files, route files, or app files
- Any new test file (scaffold already committed)

**No sprint-status.yaml modifications** — the BAD coordinator owns all sprint-status flips on main. Do NOT touch `_bmad-output/implementation-artifacts/sprint-status.yaml` in the worktree.

---

## Acceptance Criteria

### AC#1 — `worker/src/jobs/pri02-poll.js` cron job queries and dispatches pending imports

**Given** `worker/src/jobs/pri02-poll.js` is registered with `node-cron` at worker boot (imported and started in `worker/src/index.js`):

**When** the cron tick fires (every 5 minutes — `*/5 * * * *` — independent schedule from `master-cron.js`):

**Then:**

1. **Cross-customer query (annotated):** Queries `sku_channels` for all distinct pending import IDs across all customers:
   ```sql
   -- safe: cross-customer cron
   SELECT DISTINCT sc.pending_import_id, sc.customer_marketplace_id
     FROM sku_channels sc
    WHERE sc.pending_import_id IS NOT NULL
   ```
   The `// safe: cross-customer cron` comment on the line above this query suppresses the `worker-must-filter-by-customer` ESLint rule (this is a legitimate cross-customer poll).

2. **Per-import dispatch:** For each `(pending_import_id, customer_marketplace_id)` pair returned:
   - Fetches the customer's encrypted `shop_api_key` from `shop_api_key_vault` and decrypts via `shared/crypto/envelope.js`
   - Fetches `baseUrl` from `customer_marketplaces` (the Mirakl shop URL)
   - Calls `pollImportStatus(baseUrl, apiKey, importId, customerMarketplaceId)`

3. **Cron registration pattern:** Follows the same pattern as `worker/src/jobs/master-cron.js` — uses `node-cron`'s `.schedule()` with `scheduled: false` option, then `.start()`. The job is registered in `worker/src/index.js` alongside `master-cron.js`.

4. **ESLint compliance:** All queries on customer-scoped tables that are NOT cross-customer annotated MUST include `customer_marketplace_id` filter. The cross-customer query above is the ONLY cross-customer query; all subsequent per-import queries pass `customerMarketplaceId` explicitly.

5. **Concurrency guard (note):** `node-cron`'s built-in concurrency guard is NOT used here (unlike `master-cron.js`). PRI02 polling is fast (one HTTP GET per import) and each import is independent. If the cron fires while a previous tick is still running, both can proceed safely — there is no shared mutable state per import.

### AC#2 — `pollImportStatus` handles COMPLETE: atomic clear + last_set_price update

**Given** `pollImportStatus(baseUrl, apiKey, importId, customerMarketplaceId)` calls PRI02 (`GET /api/offers/pricing/imports?import_id=<importId>`) and receives status `COMPLETE`:

**When** the status is `COMPLETE`:

**Then**, in ONE transaction (`shared/db/tx.js` pattern):

1. **`sku_channels` update — all affected rows atomically:**
   ```sql
   UPDATE sku_channels
      SET last_set_price_cents = pending_set_price_cents,
          last_set_at = NOW(),
          pending_set_price_cents = NULL,
          pending_import_id = NULL,
          updated_at = NOW()
    WHERE pending_import_id = $1
      AND customer_marketplace_id = $2
   ```
   Both `pending_import_id` and `pending_set_price_cents` are set to NULL. `last_set_price_cents` is set to `pending_set_price_cents` (the price that was successfully applied). `last_set_at` records when the price was confirmed applied.

2. **Post-COMPLETE invariant:** Zero rows for this `importId` should remain with `pending_import_id IS NOT NULL`. The test `poll_import_status_complete_rows_eligible_for_next_dispatcher_cycle` asserts this.

3. **Audit event:** Emits `pri02-complete` Rotina event via `writeAuditEvent` (Story 9.0 SSoT). One event per affected `sku_channel` row for trace fidelity (per epics spec default). The event payload includes `importId`, `skuChannelId`, `customerMarketplaceId`.

4. **`pri01_consecutive_failures` reset:** For every affected `sku_channel` row, also set `pri01_consecutive_failures = 0` (Story 6.3 adds this column via migration; call `UPDATE sku_channels SET pri01_consecutive_failures = 0 WHERE pending_import_id = $1 AND customer_marketplace_id = $2` in the same transaction). This is the "reset on COMPLETE" for the 3-strike escalation logic.

   **Note on column availability:** `pri01_consecutive_failures` is added by Story 6.3's migration (`202604301215_add_pri01_consecutive_failures_to_sku_channels.sql`). Since Story 6.2's worktree is stacked on Story 6.1 (not Story 6.3), this column does NOT yet exist in the worktree. Write the SQL to reset it but wrap in a try-catch that silently swallows `column "pri01_consecutive_failures" does not exist` errors. Story 6.3's migration will make it work when deployed together. Add a code comment explaining this forward-dependency.

5. **apiKey safety:** The decrypted `apiKey` must NEVER appear in any log, error message, or thrown object.

### AC#3 — `pollImportStatus` handles FAILED: clear state + invoke PRI03 parser

**Given** `pollImportStatus(...)` calls PRI02 and receives status `FAILED`:

**When** the status is `FAILED`:

**Then**, in ONE transaction:

1. **`sku_channels` update — clear pending state:**
   ```sql
   UPDATE sku_channels
      SET pending_import_id = NULL,
          pending_set_price_cents = NULL,
          updated_at = NOW()
    WHERE pending_import_id = $1
      AND customer_marketplace_id = $2
   ```
   `last_set_price_cents` is NOT updated — the import FAILED, so prices were never applied; last confirmed price is unchanged.

2. **Invoke PRI03 parser (only when `has_error_report: true`):** The PRI02 response includes `data[0].has_error_report` (boolean). Only invoke PRI03 if `has_error_report === true` — a FAILED import with no error report is valid (e.g., all rows rejected before processing). Calls `fetchAndParseErrorReport` from `shared/mirakl/pri03-parser.js` (Story 6.3 SSoT). At this story's implementation time, Story 6.3 may not be shipped — use a forward-stub pattern:
   ```js
   // Forward dependency on Story 6.3 — stub until pri03-parser.js ships
   let fetchAndParseErrorReport;
   try {
     ({ fetchAndParseErrorReport } = await import('../../../shared/mirakl/pri03-parser.js'));
   } catch {
     fetchAndParseErrorReport = null; // Story 6.3 not yet deployed
   }
   if (fetchAndParseErrorReport) {
     await fetchAndParseErrorReport(baseUrl, apiKey, importId, tx);
   }
   ```
   This allows Story 6.2 to be tested and deployed independently of Story 6.3 while wiring up the invocation contract correctly.

3. **Audit events:**
   - `pri02-failed-transient` Rotina event per affected `sku_channel` row (or one aggregate per import if volume is too high — default: per row for trace fidelity)
   - Check `sku_channels.pri01_consecutive_failures` for each row: if incremented counter reaches 3, ALSO emit `pri01-fail-persistent` Atenção event and send Resend critical alert via `shared/resend/client.js` (Story 4.6 SSoT). The counter increment itself is Story 6.3's responsibility; this story only reads the counter value to decide whether to emit the Atenção event. If `pri03-parser.js` is not yet deployed (forward-stub case), skip the Atenção check.

4. **`pri01_consecutive_failures` increment:** Increment `pri01_consecutive_failures` for each affected `sku_channel` row:
   ```sql
   UPDATE sku_channels
      SET pri01_consecutive_failures = pri01_consecutive_failures + 1
    WHERE pending_import_id = $1
      AND customer_marketplace_id = $2
   ```
   Same forward-dependency caveat as AC#2 — wrap in try-catch for missing column.

### AC#4 — `pollImportStatus` handles WAITING/RUNNING: no-op + stuck-WAITING detection

**Given** `pollImportStatus(...)` calls PRI02 and receives status `WAITING` or `RUNNING`:

**When** the status is `WAITING` or `RUNNING`:

**Then:**

1. **No writes:** Leave `pending_import_id` set on all affected rows. No DB updates. No audit events. Log at `debug` level: `{ importId, status, customerMarketplaceId }`.

2. **Stuck-WAITING detection (NFR-P5):** Check `pri01_staging.flushed_at` for the import:
   ```sql
   SELECT flushed_at FROM pri01_staging
    WHERE import_id = $1
      AND customer_marketplace_id = $2
    LIMIT 1
   ```
   If `flushed_at IS NOT NULL` AND `Date.now() - flushed_at.getTime() > 30 * 60 * 1000` (30 minutes):
   - Emit `cycle-fail-sustained` Atenção event via `writeAuditEvent`
   - Send Resend critical alert via `shared/resend/client.js` with message indicating stuck import and `importId`
   - Log at `warn` level: `{ importId, status: 'STUCK_WAITING', flushedAt, customerMarketplaceId }`
   - Do NOT clear `pending_import_id` — leave it set so the stuck state is visible; the alert prompts manual intervention

3. **Timing test pattern:** The ATDD test for stuck-WAITING must NOT sleep 30 minutes. It should inject a mocked `flushedAt` value of `new Date(Date.now() - 31 * 60 * 1000)` into the staging row mock, then assert the alert fires. The `pollImportStatus` function must accept `flushedAt` as an injectable timestamp (or read from a mock-injectable clock) so tests can exercise the threshold without real sleep.

   **Implementation pattern:** Extract the stuck-WAITING threshold check into a helper `isStuckWaiting(flushedAt, nowMs = Date.now())` that takes an optional `nowMs` parameter. Tests pass a fixed `nowMs`. This avoids `Date.now()` test brittleness.

### AC#5 — Unit tests cover all paths; Bundle C invariant tested

**Given** `tests/shared/mirakl/pri02-poller.test.js` (scaffold already committed):

**When** the dev agent implements `pri02-poller.js` and `pri02-poll.js`:

**Then** all 21 scaffold tests pass:

1. **COMPLETE path:** COMPLETE clears ALL affected rows atomically (zero rows with `pending_import_id IS NOT NULL` after); `last_set_price_cents` updated; `last_set_at` set; `pending_set_price_cents` NULL; `pri02-complete` Rotina event emitted; single transaction.

2. **FAILED path:** FAILED clears `pending_import_id` + `pending_set_price_cents` without touching `last_set_price_cents`; PRI03 invoked (or stubbed gracefully); `pri02-failed-transient` event emitted; single transaction.

3. **WAITING/RUNNING no-op:** No writes; `pending_import_id` unchanged.

4. **Stuck-WAITING alert:** Injected `flushedAt` 31 minutes ago triggers Resend alert + `cycle-fail-sustained` Atenção event.

5. **Bundle C invariant:** `pending_import_id_invariant_between_set_and_clear` — while poller hasn't run COMPLETE, rows remain ineligible for dispatcher (`pending_import_id IS NOT NULL` blocks the dispatcher's `WHERE pending_import_id IS NULL` precondition and the cooperative-absorption skip-on-pending check).

---

## Dev Notes — Critical Implementation Details

### 1. PRI02 API — MCP-Verified Exact Shape (2026-05-08)

**Endpoint:** `GET /api/offers/pricing/imports`
**Auth header:** raw `Authorization: <apiKey>` — NO `Bearer` prefix (same as all Mirakl calls)
**Query parameter:** `import_id` — this is an **array** parameter per MCP spec. Pass as: `?import_id=<uuid>` (single value). The endpoint supports batch polling of multiple imports by passing multiple `import_id` values — the implementation polls one at a time (per-import dispatch from the cron job).
**Response shape:**
```json
{
  "data": [
    {
      "import_id": "string",
      "status": "WAITING | RUNNING | COMPLETE | FAILED",
      "has_error_report": true,
      "lines_in_error": 0,
      "lines_in_success": 2,
      "offers_in_error": 0,
      "offers_updated": 2,
      "date_created": "ISO string",
      "reason_status": "string",
      "shop_id": 19706,
      "origin": "API"
    }
  ],
  "next_page_token": null,
  "previous_page_token": null
}
```
- `data` is an array (pagination supported). For a single `import_id` query, expect `data.length === 1`.
- Read `data[0].status` for the import's current state.
- `data[0].has_error_report` → true when `FAILED` and an error report is available for PRI03.
- Call frequency per MCP: recommended every 5 min; max once per minute.

### 2. `pollImportStatus` uses `mirAklGet` (NOT custom `fetch`)

Unlike `submitPriceImport` (Story 6.1, which needed a multipart POST), PRI02 is a plain GET. Use `mirAklGet` from `shared/mirakl/api-client.js`:

```js
import { mirAklGet, MiraklApiError } from './api-client.js';

export async function pollImportStatus(baseUrl, apiKey, importId, customerMarketplaceId) {
  const response = await mirAklGet(
    `${baseUrl}/api/offers/pricing/imports`,
    apiKey,
    { import_id: importId }  // query params; mirAklGet handles URLSearchParams
  );
  const entry = response.data?.[0];
  if (!entry) {
    throw new MiraklApiError(`PRI02: no data returned for import_id ${importId}`, 200);
  }
  // entry.status is 'WAITING' | 'RUNNING' | 'COMPLETE' | 'FAILED'
  return entry;
}
```

Check the actual `mirAklGet` signature in `shared/mirakl/api-client.js` before implementing — it was built in Story 3.1. The query params may be passed differently (as a URL object or as a record). Read the file to confirm.

### 3. Retry logic — already in `mirAklGet` (do NOT duplicate for GET calls)

`mirAklGet` already implements the 5-retry exponential backoff `[1s, 2s, 4s, 8s, 16s]`. Do NOT duplicate retry logic in `pri02-poller.js` for GET calls. The duplication pattern from Story 6.1 was only needed because `submitPriceImport` used raw `fetch` (multipart POST). PRI02 is a GET and goes through `mirAklGet`.

### 4. Transaction pattern — use `shared/db/tx.js`

Use the same transaction pattern established across all prior worker stories:

```js
import { withTransaction } from '../../../shared/db/tx.js';
import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';

// In COMPLETE handler:
const client = getServiceRoleClient();
await withTransaction(client, async (tx) => {
  // All sku_channels + audit event writes in single tx
});
```

Read `shared/db/tx.js` to confirm the exact API — it was built in Story 2.1.

### 5. `worker-must-filter-by-customer` ESLint compliance

ALL queries on customer-scoped tables MUST include `customer_marketplace_id` in the WHERE clause OR be annotated with `// safe: cross-customer cron`. In this story:

- Cross-customer query in `pri02-poll.js` (AC#1): annotate with `// safe: cross-customer cron`
- All other queries in `pri02-poller.js` pass `customerMarketplaceId` as a parameter and include it in WHERE clauses

The rule scans for `customer_marketplace_id` in the query string. Ensure the column name appears in every query literal.

### 6. Named exports only — no default exports

```js
// CORRECT:
export async function pollImportStatus(...) { ... }
export async function clearPendingImport(...) { ... }

// WRONG:
export default { pollImportStatus, clearPendingImport };
```

### 7. `writeAuditEvent` pattern — use the Story 9.0 SSoT

```js
import { writeAuditEvent } from '../../../shared/audit/writer.js';

// In COMPLETE handler (per sku_channel row):
await writeAuditEvent({
  tx,
  customerMarketplaceId,
  eventType: 'pri02-complete',
  skuChannelId: row.id,
  payload: { importId, offersUpdated: entry.offers_updated }
});
```

Check `shared/audit/event-types.js` for the exact `eventType` string values and required payload shape. `pri02-complete` and `pri02-failed-transient` are in the AD20 taxonomy (26 base event types + 2 from Epic 12). If the event type is not yet seeded in the DB (because Story 9.0 ships calendar-early and should already be done), confirm by checking `shared/audit/event-types.js`.

### 8. `sendCriticalAlert` pattern — use Story 4.6 SSoT

```js
import { sendCriticalAlert } from '../../../shared/resend/client.js';

await sendCriticalAlert({
  subject: `[MarketPilot] PRI01 import stuck WAITING — ${importId}`,
  bodyPt: `Importação PRI01 (${importId}) está bloqueada há mais de 30 minutos. Verificar estado Mirakl.`,
  customerMarketplaceId,
});
```

Read `shared/resend/client.js` to confirm the exact function signature — it was built in Story 4.6.

### 9. No `console.log` — pino logger only

```js
import { createWorkerLogger } from '../../../shared/logger.js';
const logger = createWorkerLogger({ name: 'pri02-poller' });
```

Use `logger.debug`, `logger.info`, `logger.warn`, `logger.error`. Never `console.log`.

### 10. `pri02-poll.js` cron registration — follow `master-cron.js` pattern

```js
// worker/src/jobs/pri02-poll.js
import cron from 'node-cron';
import { createWorkerLogger } from '../../../shared/logger.js';

const logger = createWorkerLogger({ name: 'pri02-poll' });

let task;

export function startPri02PollCron() {
  task = cron.schedule('*/5 * * * *', async () => {
    logger.info('pri02-poll: tick starting');
    // ... query pending imports and dispatch
  }, { scheduled: false });
  task.start();
  logger.info('pri02-poll: cron registered');
}
```

In `worker/src/index.js`:
```js
import { startPri02PollCron } from './jobs/pri02-poll.js';
// ... existing master-cron start
startPri02PollCron();
```

Read `worker/src/index.js` and `worker/src/jobs/master-cron.js` first to match the exact startup convention.

### 11. `clearPendingImport` — separate export for testability

Export `clearPendingImport({ tx, importId, customerMarketplaceId, outcome })` as a separate named export. This encapsulates the DB state transition (COMPLETE or FAILED clearing) and is the primary testable unit. `pollImportStatus` calls `clearPendingImport` after receiving the status from Mirakl.

```js
// Signatures:
export async function pollImportStatus(baseUrl, apiKey, importId, customerMarketplaceId)
// Returns: { status, entry } — status is 'COMPLETE' | 'FAILED' | 'WAITING' | 'RUNNING'

export async function clearPendingImport({ tx, importId, customerMarketplaceId, outcome })
// outcome: 'COMPLETE' | 'FAILED'
// COMPLETE path: updates last_set_price_cents, clears pending_*, emits audit event
// FAILED path: clears pending_*, invokes PRI03 stub, emits audit events
```

This matches the epics spec SSoT definition: `shared/mirakl/pri02-poller.js` exports `pollImportStatus` + `clearPendingImport`.

### 12. Stuck-WAITING timestamp source

The 30-minute stuck-WAITING threshold uses `pri01_staging.flushed_at` as the "import submitted at" timestamp (set by Story 6.1's `markStagingPending`). This is more reliable than `sku_channels.updated_at` because it records the exact moment the PRI01 batch was submitted.

Query pattern:
```sql
SELECT flushed_at
  FROM pri01_staging
 WHERE import_id = $1
   AND customer_marketplace_id = $2
 LIMIT 1
```

The `isStuckWaiting(flushedAt, nowMs = Date.now())` helper extracts the threshold:
```js
function isStuckWaiting(flushedAt, nowMs = Date.now()) {
  if (!flushedAt) return false;
  return nowMs - new Date(flushedAt).getTime() > 30 * 60 * 1000;
}
```

### 13. No `.then()` chains — async/await only (ESLint enforces)

### 14. Git intelligence — Story 6.1 patterns to reuse

From Story 6.1's `Dev Agent Record` (completion notes):
- Retry helpers (`RETRY_DELAYS_MS`, `isRetryable`, `backoffDelay`) were duplicated from `api-client.js` — NOT needed for this story (we use `mirAklGet` for GETs)
- Logger pattern: `import { createWorkerLogger } from '../../shared/logger.js'` (adjust path depth for worker vs shared context)
- `markStagingPending` SQL used `customer_marketplace_id` in all WHERE clauses for ESLint compliance — same discipline applies here
- All 34 tests passed cleanly; ESLint 0 violations — match this quality bar

---

## Architecture Constraints — Negative Assertions

From `architecture-distillate/_index.md` (27 items), items relevant to Story 6.2:

- **No OF24 for price updates** (constraint #6) — PRI02 is a polling-only GET; no write endpoint is called in this story. This constraint is satisfied by design.
- **No direct `fetch` outside `shared/mirakl/`** (constraint #19) — `pri02-poller.js` IS in `shared/mirakl/`. However, since we use `mirAklGet` (not raw `fetch`), this constraint is doubly satisfied.
- **No raw `INSERT INTO audit_log` outside `shared/audit/writer.js`** (constraint #21) — all audit events via `writeAuditEvent`.
- **No worker query missing `customer_marketplace_id` filter** (constraint #24) — all queries pass `customerMarketplaceId`; cross-customer query annotated with `// safe: cross-customer cron`.
- **No `console.log`** (constraint #18) — pino logger only.
- **No default exports** — named exports only.
- **No `.then()` chains** — async/await only.
- **No float price math** — prices remain as integer cents throughout; no arithmetic performed in this story (prices are passed through from `pending_set_price_cents` to `last_set_price_cents`).

---

## Testing Instructions

### Run Story 6.2 unit tests
```bash
node --test tests/shared/mirakl/pri02-poller.test.js
```
All 21 scaffold tests must pass.

### Run ESLint on the new files
```bash
npx eslint shared/mirakl/pri02-poller.js worker/src/jobs/pri02-poll.js
```
Must produce 0 violations.

### Run full unit suite (no regressions)
```bash
npm run test:unit
```
Verify no pre-existing test failures are introduced. Note: there may be pre-existing failures on this branch from Story 6.1's forward-dependency (Story 5.2 review findings) — confirm pre-existing, not caused by Story 6.2 work.

### No integration tests required
Story 6.2 is NOT tagged `integration_test_required: true`. Integration gate is Story 7.8. Unit tests suffice.

---

## Bundle C Invariant (this story's portion)

This story is the fourth Bundle C participant (after Story 5.1 dispatcher, Story 5.2 staging table, Story 6.1 writer). The invariant this story closes:

**After `clearPendingImport({ outcome: 'COMPLETE' })` returns:**
- ZERO `sku_channel` rows for the import have `pending_import_id IS NOT NULL`
- `last_set_price_cents` = what was in `pending_set_price_cents` for all affected rows
- Rows are now eligible for the next dispatcher cycle (`WHERE pending_import_id IS NULL` passes)
- Cooperative-absorption (Story 7.3) can now read `last_set_price_cents` as the last confirmed price

**The full Bundle C gate (Story 7.8)** exercises this end-to-end across all 17 P11 fixtures.

---

## Story Completion Checklist

- [ ] `shared/mirakl/pri02-poller.js` created with two exports: `pollImportStatus`, `clearPendingImport`
- [ ] `worker/src/jobs/pri02-poll.js` created with `startPri02PollCron()` export
- [ ] `worker/src/index.js` updated to import and start `pri02-poll.js`
- [ ] `pollImportStatus` uses `mirAklGet` (NOT raw `fetch`) for the PRI02 GET
- [ ] `pollImportStatus` reads `data[0].status` from PRI02 response array
- [ ] Auth header is raw `Authorization: <apiKey>` (via `mirAklGet` — NO Bearer prefix)
- [ ] COMPLETE path: `last_set_price_cents = pending_set_price_cents`, `last_set_at = NOW()`, both pending fields set to NULL — in ONE transaction
- [ ] COMPLETE path: zero rows with `pending_import_id IS NOT NULL` after transaction
- [ ] COMPLETE path: `pri02-complete` Rotina audit event emitted via `writeAuditEvent`
- [ ] COMPLETE path: `pri01_consecutive_failures = 0` reset (with forward-dep try-catch for missing column)
- [ ] FAILED path: `pending_import_id = NULL`, `pending_set_price_cents = NULL` — in ONE transaction; `last_set_price_cents` NOT modified
- [ ] FAILED path: `fetchAndParseErrorReport` invoked only when `data[0].has_error_report === true`; forward-stub pattern (graceful if pri03-parser.js absent)
- [ ] FAILED path: `pri02-failed-transient` Rotina event emitted
- [ ] FAILED path: `pri01_consecutive_failures` incremented (with forward-dep try-catch)
- [ ] WAITING/RUNNING: no writes, no audit events; stuck >30min triggers critical alert
- [ ] Stuck-WAITING: uses `pri01_staging.flushed_at` as timestamp; `isStuckWaiting(flushedAt, nowMs)` helper with injectable `nowMs`
- [ ] Cross-customer query in `pri02-poll.js` annotated with `// safe: cross-customer cron`
- [ ] All other queries include `customer_marketplace_id` in WHERE clause
- [ ] Named exports only — no default export
- [ ] pino logger used, not `console.log`
- [ ] No `.then()` chains — async/await only
- [ ] All 21 unit tests pass: `node --test tests/shared/mirakl/pri02-poller.test.js`
- [ ] ESLint passes: `npx eslint shared/mirakl/pri02-poller.js worker/src/jobs/pri02-poll.js`
- [ ] `npm run test:unit` passes (full unit suite, no new regressions)

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
