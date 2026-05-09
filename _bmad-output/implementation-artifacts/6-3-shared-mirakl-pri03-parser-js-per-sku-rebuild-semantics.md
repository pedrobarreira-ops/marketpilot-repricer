# Story 6.3: `shared/mirakl/pri03-parser.js` + per-SKU rebuild semantics

> Endpoints verified against Mirakl MCP and architecture-distillate empirical facts (2026-05-08).
> PRI03: `GET /api/offers/pricing/imports/{import_id}/error_report` — returns CSV where column 1 = line_number in error, column 2 = error_reason. Only failed lines appear; absent lines = success. Path parameter `import_id` (string, required). Optional `shop_id` query param. Auth: raw `Authorization: <apiKey>` (no Bearer prefix). MCP-confirmed seller endpoint. Call frequency: recommended every 5 min after PRI02; max once per minute.

**Sprint-status key:** `6-3-shared-mirakl-pri03-parser-js-per-sku-rebuild-semantics`
**Status:** ready-for-dev
**Size:** M
**Epic:** Epic 6 — PRI01 Writer Plumbing (architecture S-I phase 6)
**Atomicity:** Bundle C — completes the writer chain; gate at Story 7.8. This story is a Bundle C participant (merge blocked until Story 7.8 lands per sprint-status `merge_blocks`).
**Depends on:** Story 6.2 (poller invokes parser on FAILED; `clearPendingImport` already stubs dynamic import of this module), Story 6.1 (`buildPri01Csv` returns `{ csvBody, lineMap }` needed by parser; `pri03-recovery-resubmit.csv` golden fixture created by Story 6.1 ATDD), Story 9.0 + Story 9.1 (audit foundation: `writeAuditEvent`, `EVENT_TYPES`; calendar-early — both already `done`)
**Enables:** Story 7.6 (per-SKU circuit-breaker observes `pri01_consecutive_failures` for 3-cycle escalation rule)
**Worktree base branch:** `story-6.2-pri02-poller-cron-handler` — forked from this branch (atomicity-bundle stacked dispatch exception; Story 6.3 builds on Story 6.2's unmerged code).

---

## AD12 Freeze Representation Design Choice — **Option (b) chosen**

**Decision:** Add `frozen_for_pri01_persistent boolean NOT NULL DEFAULT false` as a parallel column alongside `frozen_for_anomaly_review`. Engine dispatcher predicate adds `AND frozen_for_pri01_persistent = false` to the existing WHERE clause.

**Rationale:**
- Zero migration on the existing `frozen_for_anomaly_review` column (no rename, no data migration, no `ALTER TYPE`)
- Predicate change is purely additive — existing code reading `frozen_for_anomaly_review` is unaffected
- Review modal can branch on `frozen_for_pri01_persistent IS TRUE` for PRI01-specific copy without touching anomaly-review flow
- Both columns remain orthogonal to `cron_state` per AD12 invariant

**Architecture-doc obligation:** This story's PR description MUST document the choice as Option (b). The story spec makes the commitment; the PR body is the audit trail. The `dispatcher.js` WHERE clause MUST be updated in this story to add `AND sc.frozen_for_pri01_persistent = false`. The RLS regression suite MUST be extended for the new column.

---

## ⚠ COURSE CORRECTION (2026-05-09) — READ BEFORE IMPLEMENTING

This spec was **updated post-merge-review** (PR #85) by `/bmad-correct-course`. The original ship passed all 7 BAD steps but `/bad-review` caught a **production wire-up gap** and a latent **counter double-count** bug. **AC#5, AC#6, AC#7** below are NEW requirements. Story status was rolled `review → atdd-done` so BAD re-dispatches Step 3 (Develop) onto this branch.

**Three new acceptance criteria added (full text in Acceptance Criteria section):**
- **AC#5** — Production wire-up of `pri02-poller → pri03-parser → scheduleRebuildForFailedSkus`
- **AC#6** — `csv_line_number` persistence in `pri01_staging` (new migration `202605091000`)
- **AC#7** — Counter ownership: **poller owns** `pri01_consecutive_failures`; parser drops its increment

**Counter ownership decision is LOCKED** — see new Dev Note 15 below for rationale. **Do not re-litigate.**

**Cross-story files modified in this PR (Bundle C stacked-branch composition):**
- `shared/mirakl/pri01-writer.js` (Story 6.1's file) — persist `csv_line_number` per row at flush
- `shared/mirakl/pri02-poller.js` (Story 6.2's file) — query `lineMap`, pass to parser, invoke rebuild, own counter increment
- `supabase/migrations/202605091000_add_csv_line_number_to_pri01_staging.sql` — NEW migration
- `shared/mirakl/pri03-parser.js` — drop counter increment

PR #85 stays **merge-blocked until Story 7.8** (no change to Bundle C gate). PR #85 stays open as a stacked branch on PR #84. Course-correction commits land on the existing branch as additive commits — **no reset, no force-push**.

Full audit trail and supersession map: see **Course-Correction Notes (2026-05-09)** at the top of `## Dev Agent Record`.

---

## Narrative

**As a** background worker process,
**I want** a PRI03 error-report parser that fetches Mirakl's per-line error CSV for a FAILED import, maps error lines back to `shop_sku` values via Story 6.1's `lineMap`, schedules full per-SKU rebuilds, tracks consecutive failure counts, and escalates to freeze + Atenção alert after 3 strikes,
**So that** partial PRI01 failures trigger automatic per-SKU correction without losing price-state correctness, and persistent failures are surfaced to Pedro for manual intervention before they silently corrupt pricing.

---

## Trace

- **Architecture decisions:** AD7 point 9 (PRI03 partial-success → per-SKU resubmit), AD12 (per-SKU freeze, option b chosen here), AD24 partial (3-consecutive-failure escalation)
- **FRs:** FR23 (partial-success handling)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/03-epics-5-6-cron-pri01.md`, Story 6.3
- **Architecture decisions A-D:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` — AD7 (9-point semantic), AD12 (freeze representation TBD → now Option b)
- **Architecture index:** `_bmad-output/planning-artifacts/architecture-distillate/_index.md` — Bundle C spec, empirically-verified Mirakl facts, SSoT module index
- **Database schema:** `_bmad-output/planning-artifacts/architecture-distillate/06-database-schema.md` — `sku_channels` DDL (note `frozen_for_anomaly_review` existing column; `pri01_consecutive_failures` column also added in this story's migration)
- **Directory tree:** `_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md` — exact file paths
- **Epic 6 test plan:** `_bmad-output/implementation-artifacts/epic-6-test-plan.md` — 17 test stubs, golden fixture refs, ATDD notes 8–10
- **Previous story (6.2) spec:** `_bmad-output/implementation-artifacts/6-2-shared-mirakl-pri02-poller-js-worker-src-jobs-pri02-poll-js-cron-entry-complete-failed-handling.md` — established patterns; critical: Story 6.2 already stubs `fetchAndParseErrorReport` via dynamic import (see AC#3 note in that story)

---

## Pre-Existing Test Scaffolds — Do NOT Recreate

The test scaffold for Story 6.3 is **already committed** in the worktree:

- `tests/shared/mirakl/pri03-parser.test.js` — scaffold committed at Epic-Start (17 test stubs for AC#1–AC#4)

**Do NOT create** `tests/shared/mirakl/pri03-parser.test.js` — it already exists. Read it before implementing to understand the expected function signatures and injection patterns. Uncomment the import line and fill in all `TODO (Amelia)` stubs.

Test names that must pass (from `epic-6-test-plan.md`):
- `fetch_and_parse_error_report_calls_correct_endpoint`
- `fetch_and_parse_error_report_parses_failed_skus_from_csv_response`
- `fetch_and_parse_error_report_maps_line_numbers_to_shop_skus`
- `fetch_and_parse_error_report_pt_localizes_error_messages`
- `schedule_rebuild_for_failed_skus_inserts_fresh_pri01_staging_rows`
- `schedule_rebuild_does_not_use_failed_line_only_uses_full_sku`
- `schedule_rebuild_does_not_modify_last_set_price_cents`
- `schedule_rebuild_increments_pri01_consecutive_failures_counter`
- `schedule_rebuild_resets_failure_counter_on_pri02_complete`
- `schedule_rebuild_operates_in_single_transaction`
- `schedule_rebuild_three_strikes_escalation_freezes_sku`
- `schedule_rebuild_three_strikes_emits_pri01_fail_persistent_event`
- `schedule_rebuild_three_strikes_sends_critical_alert`
- `pri03_parser_unit_tests_cover_mixed_success_failure_report`
- `pri03_parser_matches_pri03_recovery_resubmit_golden_fixture`
- `pri03_parser_failure_counter_increments_correctly_across_cycles`
- `frozen_reason_discriminator_chosen_and_documented`
- `dispatcher_predicate_updated_for_chosen_freeze_representation`
- `rls_regression_suite_extended_with_new_freeze_column`

---

## Files to Create

| File | Action | Description |
|---|---|---|
| `shared/mirakl/pri03-parser.js` | CREATE | Two exports: `fetchAndParseErrorReport`, `scheduleRebuildForFailedSkus`. **Course correction:** drop the `pri01_consecutive_failures` increment query (now owned by the poller — see AC#7 + Dev Note 15). |
| `supabase/migrations/202604301215_add_pri01_consecutive_failures_to_sku_channels.sql` | CREATE | Adds `pri01_consecutive_failures smallint NOT NULL DEFAULT 0` AND `frozen_for_pri01_persistent boolean NOT NULL DEFAULT false` to `sku_channels` |
| `supabase/migrations/202605091000_add_csv_line_number_to_pri01_staging.sql` | **CREATE (course correction 2026-05-09)** | Adds `csv_line_number INTEGER` (nullable) to `pri01_staging` per AC#6. Does NOT modify the existing `202604301214_create_pri01_staging.sql` migration. |

**Update (minor):**
- `worker/src/dispatcher.js` — add `AND sc.frozen_for_pri01_persistent = false` to the `DISPATCH_SQL` WHERE clause (after the `AND sc.frozen_for_anomaly_review = false` line — keep both)
- `scripts/rls-regression-suite.js` — extend `CUSTOMER_SCOPED_TABLES` (or equivalent) to cover the new `sku_channels` columns; the suite must assert `frozen_for_pri01_persistent` cannot be read cross-tenant

**Update (course correction 2026-05-09 — Bundle C cross-story files; PR #85 stacked diff naturally absorbs them):**
- `shared/mirakl/pri01-writer.js` (Story 6.1's file) — at PRI01 flush, persist `csv_line_number` per `pri01_staging` row inside the same `tx` as the `import_id` update. Reuse the writer's existing `skuChannels` mapping to resolve `shopSku` → staging row `id`. See AC#6.
- `shared/mirakl/pri02-poller.js` (Story 6.2's file) — in the FAILED path of `clearPendingImport`: query the `lineMap` and `cycleId` from `pri01_staging` JOIN `skus`, pass the `lineMap` (NOT `tx`) as the 4th arg to `fetchAndParseErrorReport`, and invoke `scheduleRebuildForFailedSkus({tx, customerMarketplaceId, failedSkus, cycleId})` when `failedSkus.length > 0`. Keep the existing `pri01_consecutive_failures` increment in this file (per AC#7 + Dev Note 15). See AC#5.

**Do NOT create:**
- Any cron job files (no new cron in this story)
- Any route or app files
- Any new test file (scaffold already committed)
- `shared/state/sku-freeze.js` — this file doesn't exist yet (Story 7.3 creates it); DO NOT create it here; perform the freeze update directly via `tx.query(UPDATE sku_channels SET frozen_for_pri01_persistent = true ...)` in `scheduleRebuildForFailedSkus`

**No sprint-status.yaml modifications** — the BAD coordinator owns all sprint-status flips on main. Do NOT touch `_bmad-output/implementation-artifacts/sprint-status.yaml` in the worktree.

---

## Acceptance Criteria

### AC#1 — `fetchAndParseErrorReport` fetches and parses the PRI03 error CSV

**Given** `fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap)` is called for a FAILED import that has `has_error_report: true`:

**When** it fetches the error report:

**Then:**

1. **Correct endpoint:** Fetches `GET <baseUrl>/api/offers/pricing/imports/<importId>/error_report`.
   - Uses `mirAklGet` from `shared/mirakl/api-client.js` (NOT raw `fetch`) — the path-parameter-based URL means the endpoint path changes per import; pass the full path to `mirAklGet`.
   - Auth header: raw `Authorization: <apiKey>` via `mirAklGet` — NO `Bearer` prefix.

2. **CSV parsing:** The response body is a CSV string. Two columns: `line_number` (integer) and `error_reason` (string). Only lines with errors appear. Parse with Node's built-in string manipulation (split on `\n`, split each line on delimiter). **Do NOT use `csv-stringify` or `papaparse`** — `no-raw-CSV-building` ESLint rule fires on CSV libs; use plain string parsing for reading (rule only catches writing patterns, not reading).

3. **Line-to-shopSku mapping:** The `lineMap` parameter is the `{ [lineNumber]: shopSku }` map returned by `buildPri01Csv` (Story 6.1). Line numbers in the PRI03 error CSV are 1-based body rows (line 1 = first data row after header). Use `lineMap[lineNumber]` to resolve each error line to its `shopSku`. If a line number is not in `lineMap`, log a warning and skip — it means Mirakl returned a line that wasn't in the original submission.

4. **Return shape:**
   ```js
   {
     failedSkus: [{ shopSku: string, errorCode: string, errorMessage: string }, ...],
     successfulSkus: [{ shopSku: string }, ...]   // lines in lineMap NOT in error report
   }
   ```
   `errorCode` — use the raw `error_reason` value as a code key (it's already opaque from Mirakl). `errorMessage` — PT-localized via `getSafeErrorMessage` patterns from `shared/mirakl/safe-error.js` (Story 3.1 SSoT). If `getSafeErrorMessage` cannot map the raw reason, use a Portuguese fallback: `"Erro ao processar preço para este artigo."`.

5. **Function signature:**
   ```js
   export async function fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap)
   // Returns: { failedSkus, successfulSkus }
   ```
   Note: Story 6.2's stub calls `fetchAndParseErrorReport(baseUrl, apiKey, importId, tx)` — the `tx` parameter is not used by the parser. Accept it as a fourth argument but ignore it; callers can pass either `tx` or `lineMap`. For correct line mapping, callers that have `lineMap` available should pass it. Story 6.2's stub passes `tx` as a placeholder — that stub was a forward-wiring contract; Story 6.3 adds the `lineMap` parameter. When `lineMap` is missing (legacy call from poller stub), return all error lines as `failedSkus` with `shopSku: null` (graceful degradation, no crash).

### AC#2 — `scheduleRebuildForFailedSkus` inserts per-SKU staging rows and manages failure counter

**Given** `scheduleRebuildForFailedSkus({ tx, customerMarketplaceId, failedSkus, cycleId })` is called after `fetchAndParseErrorReport` returns:

**When** called for a set of failed `shopSku` values:

**Then**, in ONE transaction (the `tx` injected by the caller — same tx as `clearPendingImport` in Story 6.2):

1. **Full per-SKU rebuild (NOT just failed line):** For each failed `shopSku`, load ALL `sku_channel` rows for that SKU from DB:
   ```sql
   SELECT sc.id, sc.sku_id, sc.channel_code, sc.list_price_cents, sc.last_set_price_cents,
          sc.pri01_consecutive_failures
     FROM sku_channels sc
     JOIN skus s ON s.id = sc.sku_id
    WHERE s.shop_sku = $1
      AND sc.customer_marketplace_id = $2
   ```
   Then INSERT a `pri01_staging` row for EACH channel of that SKU (full SKU rebuild per AD7 point 9). Use `last_set_price_cents` as `new_price_cents` in the staging row (the failed prices were never applied — rebuild from last confirmed price, NOT from the failed submission's price).

   ```sql
   INSERT INTO pri01_staging
     (customer_marketplace_id, sku_id, channel_code, new_price_cents, cycle_id)
   VALUES ($1, $2, $3, $4, $5)
   ```

2. **`last_set_price_cents` invariant:** Do NOT issue any `UPDATE sku_channels SET last_set_price_cents` in this function. The import FAILED — the prices were never applied by Mirakl. `last_set_price_cents` stays at the pre-failure value. The test `schedule_rebuild_does_not_modify_last_set_price_cents` asserts NO `last_set_price_cents` update appears in `tx.calls`.

3. **Failure counter increment:** After staging the rebuild rows, increment `pri01_consecutive_failures` for each affected `sku_channel`:
   ```sql
   UPDATE sku_channels
      SET pri01_consecutive_failures = pri01_consecutive_failures + 1,
          updated_at = NOW()
    WHERE id = $1
      AND customer_marketplace_id = $2
   ```
   One UPDATE per `sku_channel` row ID (scoped to affected rows). Use the `id` values from the SELECT query above — use id-based targeting, not `shop_sku` predicate, for precision.

4. **3-strike escalation (threshold: counter AFTER increment = 3):**
   When `pri01_consecutive_failures + 1 >= 3` for any `sku_channel`:
   - **Freeze the SKU:** `UPDATE sku_channels SET frozen_for_pri01_persistent = true, frozen_at = NOW(), updated_at = NOW() WHERE id = $1 AND customer_marketplace_id = $2`
   - **Emit `pri01-fail-persistent` Atenção event** via `writeAuditEvent`:
     ```js
     await writeAuditEvent({
       tx,
       customerMarketplaceId,
       eventType: EVENT_TYPES.PRI01_FAIL_PERSISTENT,
       skuChannelId: skuChannelRow.id,
       payload: {
         shopSku,
         failureCount: pri01_consecutive_failures + 1,
         errorCode: failedSku.errorCode,
         errorMessage: failedSku.errorMessage,
       },
     });
     ```
   - **Send Resend critical alert** via lazy dynamic import of `sendCriticalAlert` from `shared/resend/client.js` (same lazy-import pattern as `pri02-poller.js` to avoid module-load crash in tests without `RESEND_API_KEY`):
     ```js
     const sendCriticalAlert = await getSendCriticalAlert();
     await sendCriticalAlert({
       subject: `[MarketPilot] PRI01 falha persistente — SKU ${shopSku}`,
       html: `<p>SKU <code>${shopSku}</code> falhou em 3 ciclos consecutivos.<br>
              Importação: <code>${importId}</code>.<br>Marketplace: ${customerMarketplaceId}.</p>`,
     });
     ```
   - **Frozen SKU is now ineligible for dispatcher:** `frozen_for_pri01_persistent = true` blocks the dispatcher's `WHERE sc.frozen_for_pri01_persistent = false` predicate. The SKU will not be scheduled for repricing until Pedro reviews and unfreezes it (Epic 8 story — manual unfreeze via audit-log review modal).

5. **Function signature:**
   ```js
   export async function scheduleRebuildForFailedSkus({
     tx,
     customerMarketplaceId,
     failedSkus,    // [{ shopSku, errorCode, errorMessage }, ...]
     cycleId,
   })
   // Returns: void
   ```

### AC#3 — Unit tests cover all paths; golden-fixture match

**Given** `tests/shared/mirakl/pri03-parser.test.js` (scaffold already committed):

**When** the dev agent implements `pri03-parser.js`:

**Then** all 17 test stubs pass:

1. **Mixed success/failure parse:** Error report CSV with 3 lines (2 failed, 1 success). `failedSkus.length === 2`, `successfulSkus.length === 1`. SKUs from `lineMap` not appearing in error CSV land in `successfulSkus`.

2. **Golden-fixture match:** After calling `scheduleRebuildForFailedSkus` for the failing SKU and then calling `buildPri01Csv` (Story 6.1 SSoT) with the rebuilt staging rows' data, the output CSV matches `tests/fixtures/pri01-csv/pri03-recovery-resubmit.csv` byte-exact. This fixture was created at Story 6.1 ATDD time.

3. **3-cycle failure counter sequence:** Simulate 3 FAILED cycles for the same SKU using a mock `tx` that tracks UPDATE calls. After cycle 3, assert: freeze triggered (`frozen_for_pri01_persistent = true`), `pri01-fail-persistent` Atenção emitted, `sendCriticalAlert` called.

### AC#4 — Freeze representation documented and dispatcher + RLS updated

**Given** Story 6.3 adds `frozen_for_pri01_persistent` (Option b chosen above):

**When** the story ships:

**Then:**

1. **Migration file exists and is correct:** `supabase/migrations/202604301215_add_pri01_consecutive_failures_to_sku_channels.sql` contains both:
   - `ALTER TABLE sku_channels ADD COLUMN pri01_consecutive_failures smallint NOT NULL DEFAULT 0;`
   - `ALTER TABLE sku_channels ADD COLUMN frozen_for_pri01_persistent boolean NOT NULL DEFAULT false;`
   - No modification to `frozen_for_anomaly_review` column (zero overlap per Option b)

2. **Dispatcher predicate updated:** `worker/src/dispatcher.js` `DISPATCH_SQL` includes `AND sc.frozen_for_pri01_persistent = false` after the existing `AND sc.frozen_for_anomaly_review = false` line.

3. **RLS regression suite extended:** `scripts/rls-regression-suite.js` asserts `frozen_for_pri01_persistent` is customer-scoped (or the `sku_channels` table coverage implicitly includes all columns — verify the suite covers new columns added to existing tables).

4. **Test `frozen_reason_discriminator_chosen_and_documented`:** Implemented as a grep on the migration file for `frozen_for_pri01_persistent` — if the column name is present, the design choice has been materialized.

5. **Test `dispatcher_predicate_updated_for_chosen_freeze_representation`:** Reads `worker/src/dispatcher.js` source and asserts the string `frozen_for_pri01_persistent = false` appears in the `DISPATCH_SQL` constant.

### AC#5 — Production wire-up of `pri02-poller` → `pri03-parser` → `scheduleRebuildForFailedSkus` *(NEW — course correction 2026-05-09)*

**Given** the original PR #85 ship left `scheduleRebuildForFailedSkus` as **dead code** (parser early-exited on undefined `lineMap` because Story 6.2 passed `tx` as the 4th arg instead of `lineMap`):

**When** a PRI02 poll observes `import_status = FAILED` with `has_error_report = true`:

**Then** in `clearPendingImport`'s FAILED path inside `shared/mirakl/pri02-poller.js`, the poller MUST:

1. **Query `lineMap` and `cycleId` from `pri01_staging`** before calling the parser:
   ```sql
   SELECT ps.csv_line_number, s.shop_sku, ps.cycle_id
     FROM pri01_staging ps
     JOIN skus s ON s.id = ps.sku_id
    WHERE ps.import_id = $1
      AND ps.customer_marketplace_id = $2
      AND ps.csv_line_number IS NOT NULL
   ```
   `customer_marketplace_id` predicate is mandatory for `worker-must-filter-by-customer` ESLint compliance.

2. **Build the `lineMap` object** from query results: `{ [csv_line_number]: shop_sku }`. All rows for one import share the same `cycle_id` — capture it from any returned row (e.g., the first).

3. **Invoke the parser with the real `lineMap` as the 4th argument** (NOT `tx`):
   ```js
   const { failedSkus } = await fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap);
   ```

4. **Invoke the rebuild scheduler** when `failedSkus.length > 0`:
   ```js
   if (failedSkus && failedSkus.length > 0) {
     const { scheduleRebuildForFailedSkus } = await import('./pri03-parser.js');
     await scheduleRebuildForFailedSkus({
       tx,
       customerMarketplaceId,
       failedSkus,
       cycleId,    // queried above from pri01_staging
     });
   }
   ```
   All work runs inside the SAME `tx` opened by `clearPendingImport`.

5. **Behavioral test (`pri02-poller.test.js`)** — extend or add `pri02_failed_invokes_parser_and_rebuild_with_real_lineMap`:
   - Assert the `lineMap` SELECT against `pri01_staging` JOIN `skus` is issued (with both `import_id` and `customer_marketplace_id` predicates).
   - Assert `fetchAndParseErrorReport` is called with the **queried `lineMap` object** (NOT `tx`) as the 4th argument.
   - Assert `scheduleRebuildForFailedSkus` is called with `{ tx, customerMarketplaceId, failedSkus, cycleId }` where `failedSkus` matches the parser's return value and `cycleId` matches the queried row's `cycle_id`.

**Supersedes:** Dev Note 4's `randomUUID()`-based `cycleId` synthesis (the queried `cycle_id` from `pri01_staging` is the source of truth).

### AC#6 — `csv_line_number` persistence in `pri01_staging` *(NEW — course correction 2026-05-09)*

**Given** `pri01_staging` rows are written by Story 5.2's writer pre-flush (no line number known yet) and the CSV `lineMap` is generated transiently by `buildPri01Csv` inside `shared/mirakl/pri01-writer.js` and discarded after the multipart POST:

**When** PRI01 flush succeeds and the writer updates `import_id` per row in the same transaction:

**Then:**

1. **New migration file:** `supabase/migrations/202605091000_add_csv_line_number_to_pri01_staging.sql`:
   ```sql
   ALTER TABLE pri01_staging
     ADD COLUMN csv_line_number INTEGER;
   COMMENT ON COLUMN pri01_staging.csv_line_number IS
     'CSV body row number (1-based) assigned at PRI01 flush. NULL pre-flush. Set by shared/mirakl/pri01-writer.js inside the same transaction as the import_id update. Used by pri02-poller.js FAILED path to reconstruct lineMap for pri03-parser.';
   ```
   - Column is **nullable** (pre-flush rows have no line number).
   - Filename uses 12-digit numeric version `202605091000` per CLAUDE.md Contract #15 (Supabase CLI requirement).
   - **Do NOT modify the existing `202604301214_create_pri01_staging.sql` migration** — migrations are immutable; the new column ships in a NEW file only.

2. **Writer change:** `shared/mirakl/pri01-writer.js` — when `buildPri01Csv` returns `{ csvBody, lineMap }`, persist `csv_line_number` for each entry inside the **same transaction** as the existing `import_id` update:
   ```js
   for (const [lineNumber, shopSku] of Object.entries(lineMap)) {
     const stagingRowId = skuIdByShopSku[shopSku];   // already in writer's scope via skuChannels
     await tx.query(
       'UPDATE pri01_staging SET csv_line_number = $1 WHERE id = $2',
       [parseInt(lineNumber, 10), stagingRowId]
     );
   }
   ```
   The writer already maps `shopSku` → `sku_id` in its `skuChannels` data structure; reuse that mapping to resolve each `lineNumber` → `pri01_staging.id`.

3. **Behavioral test (`pri01-writer.test.js`)** — add `csv_line_number_persisted_after_flush`:
   - Assert exactly one `UPDATE pri01_staging SET csv_line_number = $1 WHERE id = $2` is issued per `lineMap` entry, in the same `tx` as the `import_id` update.
   - Assert the persisted column values match the `lineMap` integer keys.

### AC#7 — Counter ownership: poller owns, parser drops *(NEW — course correction 2026-05-09)*

**Given** today both `pri02-poller.js` (lines 225-246) AND `pri03-parser.js` (lines 361-370) increment `pri01_consecutive_failures` in the same FAILED transaction (the parser increment is currently dead because `lineMap` is undefined; once AC#5 lands the lineMap, both fire and the counter double-counts):

**When** a FAILED PRI02 cycle is observed:

**Then:**

1. **`shared/mirakl/pri03-parser.js`** — `scheduleRebuildForFailedSkus` MUST NOT issue any `UPDATE sku_channels SET pri01_consecutive_failures = ... + 1` query. The increment block at lines 361-370 is removed. The 3-strike escalation (freeze + Atenção emit + critical alert) **stays in the parser** and reads the counter value the poller already incremented (the read happens after the poller's UPDATE flushes inside the shared `tx`).

2. **Comment block in `pri03-parser.js`** explains the ownership split:
   ```js
   // Counter ownership (course correction 2026-05-09):
   //   pri02-poller.js owns the pri01_consecutive_failures increment.
   //   It observes the FAILED status before the parser fetches the error
   //   report; transport errors during the parser's PRI03 fetch must NOT
   //   cause the failure count to skip — those are still failed imports.
   //   The parser reads the counter value to drive 3-strike escalation
   //   but does NOT increment. See Story 6.3 AC#7 + Dev Note 15.
   ```

3. **`shared/mirakl/pri02-poller.js`** — keep the existing `pri01_consecutive_failures` increment in the FAILED path (lines 225-246). This is the SOLE site of the increment.

4. **Behavioral test (`pri03-parser.test.js`)** — add `parser_does_not_increment_counter`:
   - Mock `tx.query` and assert NO query containing `UPDATE sku_channels SET pri01_consecutive_failures` is issued from any code path inside `scheduleRebuildForFailedSkus`.
   - **Modify** the existing `schedule_rebuild_increments_pri01_consecutive_failures_counter` test (currently in the scaffold) — invert it to assert the parser does NOT issue the increment. The poller-side test in `pri02-poller.test.js` continues to assert the increment fires there. Do not delete the test — repurpose it.

**Supersedes:**
- AC#2 point 3 ("Failure counter increment") — strike the entire UPDATE block from the parser implementation. The behavior moves to AC#5 / poller.
- Story Completion Checklist line "[ ] `scheduleRebuildForFailedSkus` increments `pri01_consecutive_failures` per affected row" — replaced by the new course-correction checklist below.
- Test name `schedule_rebuild_increments_pri01_consecutive_failures_counter` → repurpose as `parser_does_not_increment_counter` (negative assertion).

---

## Dev Notes — Critical Implementation Details

### 1. PRI03 endpoint — MCP-verified (2026-05-08)

```
GET /api/offers/pricing/imports/{import_id}/error_report
```

- Path parameter (NOT query param): `import_id` goes in the URL path, not as `?import_id=`.
- Response: `text/csv` body (NOT JSON). Content-Type will be CSV.
- CSV format: two columns. First column: line number (integer, 1-based body row). Second column: error reason (string). No header row in the MCP description — assume no header; if parsing reveals a header, skip it by checking if first column is numeric.
- Only failed lines appear. Lines NOT in the response were successfully imported (used to build `successfulSkus` by comparing against `lineMap` keys).

**`mirAklGet` usage for path-parameterized URL:**
```js
import { mirAklGet } from './api-client.js';

const response = await mirAklGet(
  baseUrl,
  `/api/offers/pricing/imports/${importId}/error_report`,
  {},    // no query params
  apiKey
);
// response is the raw response body — may be text/csv, not JSON
// mirAklGet returns parsed JSON by default; check if it handles non-JSON.
// If mirAklGet only parses JSON, use the raw fetch pattern (allowed in shared/mirakl/).
```

**Important:** Check `shared/mirakl/api-client.js` to see if `mirAklGet` handles non-JSON responses. If it calls `res.json()` internally, it will throw on CSV response. In that case, use raw `fetch` directly (allowed in `shared/mirakl/` per `no-direct-fetch` allowlist) and apply the retry pattern manually — or add a `responseType: 'text'` option if `mirAklGet` supports it. Read the actual `api-client.js` before deciding.

If `mirAklGet` cannot handle CSV, use the retry helper pattern from `pri01-writer.js` (the `RETRY_DELAYS_MS` + `isRetryable` helpers are duplicated there; same duplication is acceptable here pending a `shared/mirakl/retry.js` extraction). Include the same 5-retry exponential backoff `[1s, 2s, 4s, 8s, 16s]`.

### 2. CSV parsing — no external library

Parse the PRI03 error CSV with plain string operations:
```js
const lines = responseText.trim().split('\n').filter(Boolean);
for (const line of lines) {
  const commaIdx = line.indexOf(',');
  const lineNumber = parseInt(line.slice(0, commaIdx), 10);
  const errorReason = line.slice(commaIdx + 1).trim();
  // ...
}
```
The delimiter for the ERROR REPORT is comma (CSV standard), NOT the operator `operator_csv_delimiter` semicolon. The error report is Mirakl's own format; the semicolon only applies to the PRI01 submission CSV.

### 3. Invocation contract from Story 6.2

Story 6.2's `clearPendingImport` (FAILED path) stubs the call as:
```js
await fetchAndParseErrorReport(baseUrl, apiKey, importId, tx);
```
The `tx` is passed as the fourth argument. Story 6.3's function accepts `(baseUrl, apiKey, importId, lineMap)` — when called from Story 6.2 with `tx` as the fourth arg, `lineMap` will be a `PoolClient` object. Handle gracefully: `if (!lineMap || typeof lineMap !== 'object' || !('query' in lineMap) === false)` — actually just check `if (lineMap && typeof lineMap.query === 'function') lineMap = undefined;` to detect a tx passed instead of lineMap.

**Better approach:** Accept a fifth optional param `tx` for the rebuild: `fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap, tx)`. The Story 6.2 caller passes `tx` as fourth arg — detect the type and rearrange:
```js
export async function fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMapOrTx, txOrUndefined) {
  // If fourth arg is a tx (has .query method), treat it as legacy call
  const lineMap = (lineMapOrTx && typeof lineMapOrTx.query === 'function') ? null : lineMapOrTx;
  const tx = (lineMapOrTx && typeof lineMapOrTx.query === 'function') ? lineMapOrTx : txOrUndefined;
  // ... rest of function
}
```
This ensures Story 6.2's existing stub works without modification AND Story 6.3 tests can pass a proper `lineMap`.

### 4. `scheduleRebuildForFailedSkus` is called separately from `fetchAndParseErrorReport`

The parser parses; the rebuild scheduler acts. Two separate exports. Story 6.2's stub only invokes `fetchAndParseErrorReport` — `scheduleRebuildForFailedSkus` must be called by the poller after parsing. Update Story 6.2's FAILED path in `clearPendingImport` to also call `scheduleRebuildForFailedSkus` after parsing:

```js
// In clearPendingImport FAILED path (pri02-poller.js update):
if (fetchAndParseErrorReport) {
  const { failedSkus } = await fetchAndParseErrorReport(baseUrl, apiKey, importId, tx);
  if (failedSkus && failedSkus.length > 0) {
    const { scheduleRebuildForFailedSkus } = await import('./pri03-parser.js');
    await scheduleRebuildForFailedSkus({ tx, customerMarketplaceId, failedSkus, cycleId: null });
  }
}
```
Wait — `cycleId` is not available in `clearPendingImport`. Use `null` or generate a new `randomUUID()` for the rebuild cycle. Generating a new UUID is cleaner — each rebuild is conceptually a new submission cycle:
```js
import { randomUUID } from 'node:crypto';
const rebuildCycleId = randomUUID();
await scheduleRebuildForFailedSkus({ tx, customerMarketplaceId, failedSkus, cycleId: rebuildCycleId });
```

**This means Story 6.3 requires a small update to `pri02-poller.js`** — the existing forward-stub `fetchAndParseErrorReport(baseUrl, apiKey, importId, tx)` call must be expanded to also invoke `scheduleRebuildForFailedSkus`. This is expected: Story 6.3 completes the wiring that Story 6.2 left as a stub.

### 5. Transaction scope — `scheduleRebuildForFailedSkus` uses the caller's `tx`

`scheduleRebuildForFailedSkus` operates inside Story 6.2's existing transaction. It does NOT open its own transaction. The `tx` from `clearPendingImport` flows through:

```
clearPendingImport (FAILED path)
  └─ withTransaction (tx)
       ├─ UPDATE sku_channels SET pending_import_id = NULL ...  (Story 6.2)
       ├─ writeAuditEvent(pri02-failed-transient) per row      (Story 6.2)
       ├─ fetchAndParseErrorReport(...)                         (Story 6.3 parser)
       └─ scheduleRebuildForFailedSkus({ tx, ... })            (Story 6.3 rebuild)
            ├─ SELECT sku_channels WHERE shop_sku = ...
            ├─ INSERT INTO pri01_staging ...
            ├─ UPDATE sku_channels SET pri01_consecutive_failures + 1 ...
            └─ (if 3 strikes) UPDATE frozen_for_pri01_persistent = true
                              writeAuditEvent(pri01-fail-persistent)
                              sendCriticalAlert (best-effort, outside tx)
```

All DB writes in one transaction. `sendCriticalAlert` is best-effort and called OUTSIDE the transaction (send → commit; if commit fails, alert was already sent — acceptable; if send fails, commit still happens — no rollback on alert failure).

### 6. `mirAklGet` signature confirmed from Story 6.2 notes

Story 6.2's dev agent confirmed: `mirAklGet(baseUrl, path, params, apiKey)` — NOT `mirAklGet(url, apiKey, params)`. The base URL and path are separate arguments.

### 7. Named exports only — no default exports

```js
export async function fetchAndParseErrorReport(...) { ... }
export async function scheduleRebuildForFailedSkus(...) { ... }
```

### 8. `writeAuditEvent` pattern — use Story 9.0 SSoT

```js
import { writeAuditEvent } from '../audit/writer.js';
import { EVENT_TYPES } from '../audit/event-types.js';
```

Check `shared/audit/event-types.js` for `EVENT_TYPES.PRI01_FAIL_PERSISTENT` — this is `'pri01-fail-persistent'` from AD20 Atenção taxonomy. If the constant uses a different casing key (e.g., `EVENT_TYPES.PRI01_FAIL_PERSISTENT` vs `EVENT_TYPES['pri01-fail-persistent']`), read the file first to confirm the key name.

### 9. `sendCriticalAlert` — lazy import pattern from Story 6.2

```js
async function getSendCriticalAlert() {
  const { sendCriticalAlert } = await import('../resend/client.js');
  return sendCriticalAlert;
}
```
This prevents module-load crash in test environments without `RESEND_API_KEY`. Call with best-effort semantics — wrap in try-catch, log on failure, never re-throw.

### 10. Migration file naming — Contract #15 (CLAUDE.md)

The migration filename must be exactly **12 numeric digits**: `202604301215`. This is `supabase/migrations/202604301215_add_pri01_consecutive_failures_to_sku_channels.sql`. The directory tree pre-names this file — use that exact name.

### 11. No `console.log` — pino logger only

```js
import { createWorkerLogger } from '../logger.js';
const logger = createWorkerLogger({ name: 'pri03-parser' });
```

### 12. No `.then()` chains — async/await only

### 13. `worker-must-filter-by-customer` ESLint compliance

The SELECT in `scheduleRebuildForFailedSkus` queries `sku_channels` and MUST include `customer_marketplace_id` in the WHERE clause. The SELECT joins through `skus.shop_sku` but also includes `AND sc.customer_marketplace_id = $2` to satisfy the ESLint rule.

### 14. Dispatcher update — add `frozen_for_pri01_persistent = false`

In `worker/src/dispatcher.js`, the `DISPATCH_SQL` constant currently reads:
```sql
WHERE cm.cron_state = 'ACTIVE'
   AND sc.frozen_for_anomaly_review = false
   AND sc.pending_import_id IS NULL
   AND sc.excluded_at IS NULL
```

Update to add the new predicate after `frozen_for_anomaly_review`:
```sql
WHERE cm.cron_state = 'ACTIVE'
   AND sc.frozen_for_anomaly_review = false
   AND sc.frozen_for_pri01_persistent = false
   AND sc.pending_import_id IS NULL
   AND sc.excluded_at IS NULL
```

Also update the index `idx_sku_channels_dispatch` WHERE clause in the migration file to include the new column:
```sql
-- In the migration, also update the partial index (or leave existing index intact and create a replacement)
-- The existing index was created in Story 4.2. Update it:
DROP INDEX IF EXISTS idx_sku_channels_dispatch;
CREATE INDEX idx_sku_channels_dispatch
  ON sku_channels(customer_marketplace_id, last_checked_at, tier_cadence_minutes)
  WHERE pending_import_id IS NULL
    AND frozen_for_anomaly_review = false
    AND frozen_for_pri01_persistent = false;
```

### 15. Counter ownership decision — poller owns (LOCKED, do not re-litigate)

*(Course correction 2026-05-09 — supersedes AC#2 point 3.)*

**Decision:** `shared/mirakl/pri02-poller.js` owns the `pri01_consecutive_failures` increment exclusively. `shared/mirakl/pri03-parser.js`'s `scheduleRebuildForFailedSkus` does NOT issue any `UPDATE sku_channels SET pri01_consecutive_failures = ... + 1` query.

**Rationale:** The poller observes the `FAILED` status from PRI02 *before* attempting to fetch and parse the error report. Transport errors during the parser's PRI03 fetch (network failure, 5xx, timeout, malformed CSV) must NOT cause a failed import to skip the counter — those are still failed imports for circuit-breaker purposes. Putting the increment in the poller guarantees every observed `FAILED` gets counted regardless of whether the downstream parser/rebuild succeeds. Putting it in the parser would silently undercount under intermittent PRI03 failure modes — exactly the regime the 3-strike escalation is designed to detect.

**3-strike escalation stays in the parser.** The parser reads the counter value (post-poller-increment, same `tx`) to decide whether to freeze + emit Atenção + send critical alert. Read, don't write. The freeze UPDATE (`frozen_for_pri01_persistent = true`), the `pri01-fail-persistent` audit event, and the Resend critical alert all stay where AC#2 point 4 placed them.

**Status:** LOCKED. Pedro made this decision; do not re-open it. If a future story needs to revisit ownership (e.g., to support a non-PRI02-driven failure path), open a new story — do not amend this one.

---

## Architecture Constraints — Negative Assertions

From `architecture-distillate/_index.md`:

- **No OF24 for price updates** — not applicable; no write endpoint called for prices in this story.
- **No raw `fetch(` outside `shared/mirakl/`** — `pri03-parser.js` IS in `shared/mirakl/`; raw `fetch` is allowed here if `mirAklGet` cannot handle CSV responses.
- **No raw `INSERT INTO audit_log` outside `shared/audit/writer.js`** — all audit via `writeAuditEvent`.
- **No worker query missing `customer_marketplace_id` filter** — all `sku_channels` and `skus` queries include `customer_marketplace_id` in WHERE.
- **No `console.log`** — pino only.
- **No default exports** — named exports only.
- **No `.then()` chains** — async/await only.
- **No float price math** — prices are integer cents; division/multiplication for display only (never stored as float).
- **No silent overload of `frozen_for_anomaly_review`** — the new `frozen_for_pri01_persistent` is a separate column per Option b.
- **No `pri01_staging` row with `last_set_price_cents` update** — rebuild staging uses `last_set_price_cents` AS `new_price_cents` (read, not write), preserving the source column intact.

---

## Testing Instructions

### Run Story 6.3 unit tests
```bash
node --test tests/shared/mirakl/pri03-parser.test.js
```
All 19 test stubs (17 in scaffold + potentially 2 from ATDD additions) must pass.

### Run ESLint on the new file
```bash
npx eslint shared/mirakl/pri03-parser.js
```
Must produce 0 violations.

### Run full unit suite (no regressions)
```bash
npm run test:unit
```
Verify no pre-existing test failures are introduced. Note: 22 pre-existing failures from Story 6.1 forward-dependency (dry-run-minimal, margin) may still be present — confirm they are pre-existing, not introduced by Story 6.3.

### No integration tests required
Story 6.3 is NOT tagged `integration_test_required: true`. Integration gate is Story 7.8.

---

## Bundle C Invariant (this story's portion)

This story completes the Bundle C writer chain (Stories 5.1 → 5.2 → 6.1 → 6.2 → 6.3). The invariant this story closes:

**After `scheduleRebuildForFailedSkus` returns for a FAILED import:**
- The failed SKU's channels have fresh `pri01_staging` rows ready for the next dispatcher cycle
- `last_set_price_cents` is unchanged (import FAILED — no confirmed price change)
- `pri01_consecutive_failures` is incremented; at 3, the SKU is frozen and Pedro is alerted
- If frozen: `frozen_for_pri01_persistent = true` → dispatcher WHERE predicate excludes the row → no further repricing attempts until manual unfreeze

**The full Bundle C gate (Story 7.8)** exercises the end-to-end including PRI03 partial-failure recovery across all 17 P11 fixtures.

---

## Story Completion Checklist

- [ ] `shared/mirakl/pri03-parser.js` created with two named exports: `fetchAndParseErrorReport`, `scheduleRebuildForFailedSkus`
- [ ] `fetchAndParseErrorReport` fetches `GET <baseUrl>/api/offers/pricing/imports/<importId>/error_report` (path param, not query param)
- [ ] `fetchAndParseErrorReport` parses CSV response with plain string ops (no CSV lib)
- [ ] `fetchAndParseErrorReport` maps line numbers to `shopSku` via `lineMap` parameter
- [ ] `fetchAndParseErrorReport` PT-localizes error messages via `getSafeErrorMessage`
- [ ] `fetchAndParseErrorReport` handles legacy Story 6.2 call (tx as fourth arg) gracefully
- [ ] `scheduleRebuildForFailedSkus` loads ALL channels of each failed SKU (full per-SKU rebuild)
- [ ] `scheduleRebuildForFailedSkus` uses `last_set_price_cents` as `new_price_cents` in staging rows
- [ ] `scheduleRebuildForFailedSkus` does NOT update `last_set_price_cents`
- [ ] `scheduleRebuildForFailedSkus` increments `pri01_consecutive_failures` per affected row
- [ ] `scheduleRebuildForFailedSkus` triggers 3-strike escalation at `pri01_consecutive_failures + 1 >= 3`
- [ ] 3-strike: sets `frozen_for_pri01_persistent = true` (Option b — NOT `frozen_for_anomaly_review`)
- [ ] 3-strike: emits `pri01-fail-persistent` Atenção via `writeAuditEvent`
- [ ] 3-strike: sends Resend critical alert via lazy `getSendCriticalAlert()` dynamic import
- [ ] All writes (staging INSERT + counter UPDATE + freeze UPDATE + audit event) use injected `tx`
- [ ] `sendCriticalAlert` called OUTSIDE transaction boundary (best-effort)
- [ ] `supabase/migrations/202604301215_add_pri01_consecutive_failures_to_sku_channels.sql` created with both new columns + index update
- [ ] `worker/src/dispatcher.js` `DISPATCH_SQL` updated with `AND sc.frozen_for_pri01_persistent = false`
- [ ] `scripts/rls-regression-suite.js` extended for new `sku_channels` columns
- [ ] `pri02-poller.js` FAILED path updated to call `scheduleRebuildForFailedSkus` after parsing
- [ ] Named exports only — no default export
- [ ] pino logger used, not `console.log`
- [ ] No `.then()` chains — async/await only
- [ ] All 17 scaffold tests pass: `node --test tests/shared/mirakl/pri03-parser.test.js`
- [ ] ESLint passes: `npx eslint shared/mirakl/pri03-parser.js`
- [ ] `npm run test:unit` passes (full unit suite, no new regressions)

### Course-Correction Tasks (2026-05-09) — Additive to original checklist

**Migration (AC#6):**
- [ ] `supabase/migrations/202605091000_add_csv_line_number_to_pri01_staging.sql` created with `ALTER TABLE pri01_staging ADD COLUMN csv_line_number INTEGER;` + descriptive `COMMENT ON COLUMN`
- [ ] Existing migration `202604301214_create_pri01_staging.sql` is NOT modified (immutability invariant)

**Writer wiring (AC#6) — `shared/mirakl/pri01-writer.js`:**
- [ ] At flush, `csv_line_number` is persisted for each `lineMap` entry via per-row `UPDATE pri01_staging SET csv_line_number = $1 WHERE id = $2` inside the same `tx` as the `import_id` update
- [ ] New test in `tests/shared/mirakl/pri01-writer.test.js`: `csv_line_number_persisted_after_flush` — passes

**Poller wiring (AC#5) — `shared/mirakl/pri02-poller.js`:**
- [ ] FAILED path queries `lineMap` from `pri01_staging` JOIN `skus` with both `import_id` AND `customer_marketplace_id` predicates
- [ ] FAILED path captures `cycleId` from any returned row
- [ ] FAILED path calls `fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap)` — `lineMap` (NOT `tx`) as the 4th argument
- [ ] FAILED path calls `scheduleRebuildForFailedSkus({tx, customerMarketplaceId, failedSkus, cycleId})` when `failedSkus.length > 0`, inside the same `tx`
- [ ] FAILED path retains the existing `pri01_consecutive_failures` increment (counter ownership = poller per AC#7)
- [ ] New behavioral test in `tests/shared/mirakl/pri02-poller.test.js`: `pri02_failed_invokes_parser_and_rebuild_with_real_lineMap` — passes

**Parser change (AC#7) — `shared/mirakl/pri03-parser.js`:**
- [ ] `scheduleRebuildForFailedSkus` issues NO `UPDATE sku_channels SET pri01_consecutive_failures` query — the increment block is removed
- [ ] Counter-ownership comment block (per AC#7 point 2 verbatim) is present in `pri03-parser.js`
- [ ] 3-strike escalation (freeze + Atenção + critical alert) STAYS in the parser and reads the counter value the poller incremented
- [ ] Repurposed test in `tests/shared/mirakl/pri03-parser.test.js`: `parser_does_not_increment_counter` — asserts negative; replaces `schedule_rebuild_increments_pri01_consecutive_failures_counter`

**Branch hygiene:**
- [ ] No reset, no force-push — course-correction commits are additive on top of `5653abe` (existing PR #85 HEAD)
- [ ] PR #85 stays open and merge-blocked (`merge_blocks: 6-3 → until_story: 7-8` is unchanged)

---

## Dev Agent Record

### Course-Correction Notes (2026-05-09)

**What was missed in the original ship of PR #85:**

PR #85 passed all 7 BAD steps (atdd → dev → ATDD review → Test review → Code review → PR-body review → PR review) and `/bad-review` issued no Phase-2 verdict blockers. However, the spec-grounded audit caught:

1. **`scheduleRebuildForFailedSkus` is dead code in production.** Story 6.3 spec Dev Note 4 explicitly required this PR to update `shared/mirakl/pri02-poller.js` (Story 6.2's file) so the FAILED path of `clearPendingImport` invokes `scheduleRebuildForFailedSkus` after parsing the error report. The original PR did not modify `pri02-poller.js`; the poller still calls `fetchAndParseErrorReport(baseUrl, apiKey, importId, tx)` — passing `tx` as the 4th argument. The parser's signature is `(baseUrl, apiKey, importId, lineMap)` so `lineMap[lineNumber]` evaluates against `tx` (a `PoolClient` with no numeric keys), the parser's loop returns `failedSkus: []`, and `scheduleRebuildForFailedSkus` is never invoked. Net effect: the per-SKU rebuild semantics implemented and unit-tested in this PR have **never run in production**.

2. **Counter double-count latent bug.** Both `pri02-poller.js:225-246` AND `pri03-parser.js:361-370` increment `pri01_consecutive_failures` in the same FAILED `tx`. Today only the poller fires (parser early-exits on undefined `lineMap`). Fixing the wire-up without addressing the counter would cause the failure counter to double per cycle, which would falsely trigger the 3-strike freeze on cycle 2 instead of cycle 3 — silent corruption of the circuit-breaker semantics.

3. **Structural fix, not hotfix.** The `lineMap` is generated transiently by `buildPri01Csv` at PRI01 submission time and discarded after the multipart POST. The `pri01_staging` schema has no `csv_line_number` column, and the writer builds the CSV via `SELECT DISTINCT ... FROM pri01_staging` with no `ORDER BY` (Postgres row order is non-deterministic). The poller therefore cannot reconstruct `lineMap` at PRI02 poll time without persisted state. The fix requires schema work (new migration) + writer change + poller change + parser change + 3 new tests.

**What's being added in the course correction:**

- **AC#5** — Production wire-up of `pri02-poller → pri03-parser → scheduleRebuildForFailedSkus`. Poller queries `lineMap` from `pri01_staging`, passes it correctly, invokes the rebuild scheduler.
- **AC#6** — `csv_line_number` persistence in `pri01_staging` via new migration `202605091000_add_csv_line_number_to_pri01_staging.sql` + writer change to populate it at flush time.
- **AC#7** — Counter ownership: poller owns `pri01_consecutive_failures`; parser drops its increment to eliminate the double-count latent bug. Decision is LOCKED — see Dev Note 15.

**Supersession map:**

| Original spec element | Status after course correction |
|---|---|
| AC#2 point 3 (parser increments counter) | **Superseded by AC#7** — parser does NOT increment; poller owns. |
| Dev Note 4 (`cycleId = randomUUID()` in poller) | **Superseded by AC#5** — `cycleId` is queried from `pri01_staging.cycle_id`, not synthesized. |
| Test `schedule_rebuild_increments_pri01_consecutive_failures_counter` | **Repurposed** as `parser_does_not_increment_counter` (negative assertion). |
| Story Completion Checklist line "increments `pri01_consecutive_failures`" | Replaced by Course-Correction Tasks subsection above. |

**Branch state at course-correction time:**

- Branch: `story-6.3-pri03-parser-per-sku-rebuild`
- HEAD: `5653abe` (BAD Step 7 commit)
- PR #85: open, Bundle C member, merge-blocked until Story 7.8 lands (`merge_blocks` entry unchanged)
- Worktree: `.worktrees/story-6.3-pri03-parser-per-sku-rebuild/`
- Status flip on `main`'s `sprint-status.yaml`: `review` → `atdd-done` (Phase 0's bundle-stacked exception will pick it up; `/bad` will dispatch Step 3 onto the existing branch as additive commits — no reset, no force-push).

### Agent Model Used

(to be filled by dev agent)

### Debug Log References

(none)

### Completion Notes List

(to be filled)

### File List

(to be filled)
