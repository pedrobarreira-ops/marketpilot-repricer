# Story 6.1: `shared/mirakl/pri01-writer.js` — Per-SKU Aggregation + Multipart Submit + `pending_import_id` Atomicity + `no-raw-CSV-building` ESLint Rule

> Endpoints verified against architecture-distillate empirical facts (2026-05-08). PRI01 endpoint `POST /api/offers/pricing/imports` is empirically confirmed via AD7 + architecture Cross-Cutting Empirically-Verified Mirakl Facts. Mirakl MCP OAuth flow was initiated but browser authentication is required — all critical endpoint details are covered by the existing empirical verification (2026-04-30).

**Sprint-status key:** `6-1-shared-mirakl-pri01-writer-js-per-sku-aggregation-multipart-submit-pending-import-id-atomicity-no-raw-csv-building-eslint-rule`
**Status:** review
**Size:** L
**Epic:** Epic 6 — PRI01 Writer Plumbing (architecture S-I phase 6)
**Atomicity:** Bundle C — AD7 ships in this story; the integration-test gate sits at Story 7.8. This story is a Bundle C participant (merge blocked until Story 7.8 lands per sprint-status `merge_blocks`).
**Depends on:** Story 3.1 (api-client patterns + `MiraklApiError` + ESLint scope), Story 4.1 (`customer_marketplaces.operator_csv_delimiter` + `offer_prices_decimals`), Story 4.2 (`sku_channels.pending_import_id`), Story 5.2 (`pri01_staging` table + `cycle-assembly.js` cycle loop), Story 9.0 + Story 9.1 (audit foundation — `writeAuditEvent`, event types; calendar-early per Option A — both already `done`)
**Enables:** Story 6.2 (PRI02 poller — clears `pending_import_id` set by this story), Story 7.x (engine writes decisions to staging which this writer flushes), Story 7.8 (atomicity-bundle integration gate)
**Worktree base branch:** `story-5.2-pri01-staging-schema-cycle-assembly-skeleton` — fork from this branch, not `main`

---

## Narrative

**As a** background worker process,
**I want** a PRI01 CSV writer module that aggregates per-SKU decisions from `pri01_staging`, builds the correct multipart CSV, submits it to Mirakl, and atomically marks all participating `sku_channel` rows with `pending_import_id`,
**So that** price changes are durably dispatched to Mirakl with zero risk of partial-pending state, satisfying the Bundle C atomicity invariant required by cooperative-absorption and PRI02 polling.

---

## Trace

- **Architecture decisions:** AD7 (PRI01 writer 9-point semantic — full spec), AD5 (HTTP client patterns: retry schedule, auth header, `MiraklApiError`), AD9 (cooperative-absorption skip-on-pending predicate depends on atomicity), Bundle C gate at Story 7.8
- **FRs:** FR23 (PRI01-only writes; no OF24), NFR-P5 (PRI01→PRI02 ≤30min resolution)
- **ESLint rule shipped here:** `no-raw-CSV-building` (ships with this story's SSoT module per the deferred-rule sequencing pattern)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/03-epics-5-6-cron-pri01.md`, Story 6.1
- **Architecture patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` — naming conventions, SSoT modules, test patterns, CSV format rules
- **Architecture decisions A-D:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` — AD7 (PRI01 9-point semantic), AD5 (HTTP client)
- **Database schema:** `_bmad-output/planning-artifacts/architecture-distillate/06-database-schema.md` — `sku_channels` table, `pri01_staging` table, `customer_marketplaces` PC01 columns
- **Bundle C context:** `_bmad-output/planning-artifacts/epics-distillate/_index.md` (Cross-Cutting: Atomicity Bundles, Bundle C)
- **Empirical Mirakl facts:** `_bmad-output/planning-artifacts/architecture-distillate/_index.md` (Cross-Cutting Empirically-Verified Mirakl Facts table)

---

## Pre-Existing Test Scaffolds — Do NOT Recreate

The test scaffold for Story 6.1 is **already committed** in the worktree (merged from main):

- `tests/shared/mirakl/pri01-writer.test.js` — covers AC#1–AC#5 (buildPri01Csv, submitPriceImport, markStagingPending, ESLint rule, PC01 completeness guard)

The fixture directory `tests/fixtures/pri01-csv/` exists with a `.gitkeep` placeholder — the three golden CSV files are NOT yet committed. The ATDD step (Step 2) creates them. Do NOT create the test scaffold file — it already exists. Read it before implementing to understand the expected function signatures and injection patterns.

**Golden fixture files (created in ATDD Step 2, before implementation):**
- `tests/fixtures/pri01-csv/single-channel-undercut.csv`
- `tests/fixtures/pri01-csv/multi-channel-passthrough.csv`
- `tests/fixtures/pri01-csv/pri03-recovery-resubmit.csv`

---

## Files to Create

| File | Action | Description |
|---|---|---|
| `shared/mirakl/pri01-writer.js` | CREATE | Three exports: `buildPri01Csv`, `submitPriceImport`, `markStagingPending` |
| `eslint-rules/no-raw-CSV-building.js` | CREATE | ESLint rule: blocks CSV building outside `shared/mirakl/pri01-writer.js` |

**Update (minor):**
- `eslint.config.js` — register `no-raw-CSV-building` rule under `local-cron/` namespace (same pattern as `worker-must-filter-by-customer`, `no-direct-fetch`)

**Do NOT create:**
- Any migration files (no schema changes in this story — `pri01_staging` already created by Story 5.2 migration `202604301214_create_pri01_staging.sql`; `sku_channels` already has `pending_import_id` from Story 4.2)
- Any engine files in `worker/src/engine/` (Epic 7)
- Any cron jobs in `worker/src/jobs/` (PRI02 cron = Story 6.2)
- `shared/mirakl/pri02-poller.js` or `pri03-parser.js` (Stories 6.2 and 6.3)
- Any route files or app files

**No sprint-status.yaml modifications** — the BAD coordinator owns all sprint-status flips on main. Do NOT touch `_bmad-output/implementation-artifacts/sprint-status.yaml` in the worktree.

---

## Acceptance Criteria

### AC#1 — `buildPri01Csv` builds correct CSV per AD7 9-point semantic

**Given** `buildPri01Csv({ skuChannels, operatorCsvDelimiter, offerPricesDecimals, customerMarketplaceId })`:
- `skuChannels` — array of sku_channel-like objects for ONE SKU (ALL channels; some with `newPriceCents` from staging, some passthrough at `lastSetPriceCents`)
- `operatorCsvDelimiter` — `'SEMICOLON'` or `'COMMA'` (from `customer_marketplaces.operator_csv_delimiter`)
- `offerPricesDecimals` — integer e.g., `2` (from `customer_marketplaces.offer_prices_decimals`)
- `customerMarketplaceId` — UUID (for error messages)

**When** called:

**Then:**

1. **Return shape:** Returns `{ csvBody: string, lineMap: { [lineNumber: number]: string } }` where `lineMap` maps CSV body line numbers (1-based, NOT counting header) to `shopSku` values. The `lineMap` is required by Story 6.3's PRI03 parser to correlate error-report line numbers back to failed SKUs.

2. **Header row (exact):** First line of `csvBody` is `offer-sku<DELIM>price<DELIM>channels` (the `<DELIM>` is the resolved delimiter character).

3. **Delimiter resolution:**
   - `'SEMICOLON'` → `;`
   - `'COMMA'` → `,`
   - `null` or `undefined` → throws immediately with error: `"PC01 capture incomplete for customer_marketplace <customerMarketplaceId>: operator_csv_delimiter or offer_prices_decimals is NULL. Re-run onboarding scan or PC01 monthly re-pull (Story 12.4) to populate."` — NEVER falls back to a hardcoded default.

4. **`offer_prices_decimals` guard:** If `null` or `undefined`, throws the same PC01-capture-incomplete error. NEVER falls back silently.

5. **Price formatting:** `newPriceCents / 100` formatted to `offerPricesDecimals` decimal places with ASCII period (`.`) decimal separator. Example: 1799 cents, decimals=2 → `"17.99"`. Use `(cents / 100).toFixed(decimals)` which always produces ASCII period.

6. **`offer-sku` column value:** `skuChannel.shopSku` — the seller-provided SKU (e.g., `EZ8809606851663`). NEVER use `product_sku` (Mirakl's internal UUID). [Empirical: OF21 returned `shop_sku: "EZ8809606851663"`, `offer_sku: null`, `product_sku` is Mirakl's internal UUID — use `shop_sku`.]

7. **Channels column:** Pipe-separated channel codes (e.g., `WRT_PT_ONLINE`) for Worten SINGLE mode. For MVP, each sku_channel row maps to one line with its own `channelCode` as the channels value.

8. **Passthrough lines:** For channels whose price isn't changing this cycle (no staging row; uses `lastSetPriceCents`), the function must STILL emit a line with `lastSetPriceCents` as the price. PRI01 uses delete-and-replace semantics — any channel NOT in the submitted CSV gets its price deleted by Mirakl. This is a data-loss footgun if omitted.

9. **Golden-file tests (byte-exact):**
   - `tests/fixtures/pri01-csv/single-channel-undercut.csv` — one body line, semicolon delimiter, `EZ8809606851663;17.99;WRT_PT_ONLINE`, LF line endings
   - `tests/fixtures/pri01-csv/multi-channel-passthrough.csv` — two body lines; PT changed to 17.99, ES passthrough at 20.00; semicolon delimiter
   - `tests/fixtures/pri01-csv/pri03-recovery-resubmit.csv` — two body lines (full SKU rebuild after PRI03 failure; both channels at corrected prices)

   Golden files use LF line endings (`\n`). No BOM.

### AC#2 — `submitPriceImport` issues a correct multipart POST

**Given** `submitPriceImport(baseUrl, apiKey, csvBody)`:

**When** called:

**Then:**

1. **Endpoint:** `POST <baseUrl>/api/offers/pricing/imports` (no trailing slash). [Empirically confirmed via AD7; MCP Q10 resolved.]

2. **Auth header:** `Authorization: <apiKey>` — raw key, NO `Bearer` prefix. [Empirical: all 6 Worten calls confirmed raw key pattern; Bearer prefix causes 401.]

3. **Multipart POST body:** CSV sent as a `multipart/form-data` POST with the CSV as a file part. Use Node.js built-in `FormData` + `fetch` (available in Node >=22; no external HTTP library needed):
   ```js
   const form = new FormData();
   form.append('file', new Blob([csvBody], { type: 'text/csv' }), 'prices.csv');
   const response = await fetch(`${baseUrl}/api/offers/pricing/imports`, {
     method: 'POST',
     headers: { Authorization: apiKey },  // NO Bearer prefix
     body: form,
   });
   ```
   Note: `fetch` is used directly here — this is allowed in `shared/mirakl/` per the `no-direct-fetch` ESLint allowlist (rule targets `fetch` outside `shared/mirakl/`).

4. **Retry/backoff:** Match `mirAklGet`'s retry schedule exactly: 5 retries, exponential backoff `[1s, 2s, 4s, 8s, 16s]`, retryable on 429 + 5xx + transport errors (status 0), non-retryable on 4xx (except 429). Max delay cap: 30s. Use the same `isRetryable` + `backoffDelay` internal helpers pattern from `api-client.js`. Do NOT import from `api-client.js` — duplicate the helpers in `pri01-writer.js` (they are small; shared would create circular module dep risk).

5. **Success return:** `{ importId: '<uuid-from-response>' }`. Parse from response JSON body — expected response field name is `import_id` (snake_case per Mirakl convention; map to camelCase in return).

6. **Error handling:**
   - Non-2xx: throw `MiraklApiError` (import from `./api-client.js`) with a safe message. The `apiKey` must NEVER appear in error message, stack, or pino log output.
   - Transport error (fetch throws): catch, wrap in `MiraklApiError` with status `0`.

7. **apiKey safety:** Never include `apiKey` in any thrown error, log statement, or error payload. Use the pattern established in `api-client.js` — only log `{ status, code }`, never log the key value.

### AC#3 — `markStagingPending` atomically sets `pending_import_id` on all participating rows

**Given** `markStagingPending({ tx, cycleId, importId, customerMarketplaceId })` — atomicity helper:

**When** called within a transaction after `submitPriceImport` returns the `importId`:

**Then:**

1. **`sku_channels` update:** For every `sku_channel` row participating in the cycle batch for this customer:
   - Set `pending_import_id = importId`
   - Set `pending_set_price_cents = staging.new_price_cents` (for rows with a staging decision)
   - For passthrough rows (channel in CSV but no new decision), set `pending_set_price_cents = last_set_price_cents` (price didn't change, but the import_id must be set because the row IS included in the PRI01 batch)
   - Strategy: query `pri01_staging` for all rows with `cycle_id = cycleId AND customer_marketplace_id = customerMarketplaceId`; get their `sku_id` values; for each SKU, load ALL `sku_channel` rows for that SKU under this `customer_marketplace_id` (including channels not in staging = passthroughs); update ALL of them.

2. **`pri01_staging` update:** For all rows in the batch: set `flushed_at = NOW()` and `import_id = importId`.

3. **Single transaction:** ALL writes happen against the same `tx` parameter. No separate client connections. This is the Bundle C atomicity invariant — no partial-pending state can exist after this function returns.

4. **Bundle C invariant assertion (test-level):** After `markStagingPending` returns, a query on `sku_channels WHERE cycle_id participates...` must show ZERO rows with `pending_import_id IS NULL` for the affected customer+cycle. This is the test named `mark_staging_pending_no_cycle_row_left_without_pending_import_id`.

5. **SQL patterns (must satisfy `worker-must-filter-by-customer` ESLint rule):**
   ```sql
   -- Fetch staging rows for cycle
   SELECT DISTINCT s.sku_id, s.new_price_cents
     FROM pri01_staging s
    WHERE s.cycle_id = $1
      AND s.customer_marketplace_id = $2

   -- Load ALL sku_channel rows for each SKU in the batch
   SELECT sc.id, sc.channel_code, sc.last_set_price_cents
     FROM sku_channels sc
    WHERE sc.customer_marketplace_id = $1
      AND sc.sku_id = ANY($2)  -- array of sku_ids from staging

   -- Update sku_channels
   UPDATE sku_channels
      SET pending_import_id = $1,
          pending_set_price_cents = $2,
          updated_at = NOW()
    WHERE id = $3

   -- Update pri01_staging
   UPDATE pri01_staging
      SET flushed_at = NOW(),
          import_id = $1
    WHERE cycle_id = $2
      AND customer_marketplace_id = $3
   ```

### AC#4 — `no-raw-CSV-building` ESLint rule

**Given** `eslint-rules/no-raw-CSV-building.js` registered in `eslint.config.js` as `local-cron/no-raw-CSV-building`:

**When** ESLint runs:

**Then:**

1. **Rule fires** on: usage of `csv-stringify`, `papaparse` (any import of these packages); template literals containing `;` or `,` followed by `\n` in the same expression (CSV-building heuristic); any string with `;\n` or `,\n` adjacent pattern that resembles multi-row CSV construction — OUTSIDE `shared/mirakl/pri01-writer.js`.

2. **Rule does NOT fire** in `shared/mirakl/pri01-writer.js` (the allowlist entry).

3. **Rule does NOT fire** on `fs.readFileSync` calls that read `.csv` files — rule targets WRITING patterns, not reading.

4. **Error message:** `"Raw CSV building forbidden. Use shared/mirakl/pri01-writer.js for all PRI01 emission."`

5. **Rule ID:** `local-cron/no-raw-CSV-building` (follows existing namespace for custom rules per `eslint.config.js`)

6. **ESLint test pattern (AC#4 tests use programmatic ESLint API):** Follow the pattern from Story 5.1's `worker-must-filter-by-customer` ESLint tests: write a temp fixture file using `writeFileSync` to `tmpdir()`, run `new ESLint({ cwd: repoRoot })`, assert `ruleId === 'local-cron/no-raw-CSV-building'`. Clean up in `t.after()`.

### AC#5 — PC01 capture completeness guard

**Given** `buildPri01Csv` is called when `customer_marketplaces.operator_csv_delimiter` or `offer_prices_decimals` is NULL (PC01 capture incomplete):

**When** either parameter is `null` or `undefined`:

**Then** `buildPri01Csv` throws a clear error before producing any output:

```
"PC01 capture incomplete for customer_marketplace <customerMarketplaceId>: operator_csv_delimiter or offer_prices_decimals is NULL. Re-run onboarding scan or PC01 monthly re-pull (Story 12.4) to populate."
```

The dispatcher (Story 5.1/5.2) catches this error and emits a `cycle-fail-sustained` Atenção event after 3 consecutive cycles fail this way for the same customer (per AD24 — that escalation logic lives in Story 12.1, not in this story's scope). This story only throws the error — does not implement the 3-cycle escalation.

---

## Dev Notes — Critical Implementation Details

### 1. Worktree base branch context

This story's worktree forks from `story-5.2-pri01-staging-schema-cycle-assembly-skeleton`. The merge with `main` brings in the Epic-Start test design scaffolds (merged at worktree creation). Available SSoT modules from prior stories:

- `shared/mirakl/api-client.js` — `mirAklGet`, `MiraklApiError` (Story 3.1)
- `shared/mirakl/safe-error.js` — `getSafeErrorMessage` (Story 3.1)
- `shared/audit/writer.js` — `writeAuditEvent` (Story 9.0, calendar-early)
- `worker/src/cycle-assembly.js` — the caller that reads from `pri01_staging` (Story 5.2)
- `supabase/migrations/202604301214_create_pri01_staging.sql` — `pri01_staging` table (Story 5.2)
- `eslint-rules/worker-must-filter-by-customer.js` — existing ESLint rule (Story 5.1)
- `eslint-rules/no-direct-fetch.js` — existing ESLint rule (Story 3.1)

### 2. `buildPri01Csv` return shape includes `lineMap`

The function must return `{ csvBody: string, lineMap: { [lineNumber: number]: string } }` — this is required by Story 6.3 (PRI03 parser) to map CSV error-report line numbers back to `shopSku` values.

Line numbering is 1-based and counts body rows only (excluding header). So for a 2-row CSV (header + 2 body lines), the lineMap is `{ 1: 'EZ123', 2: 'EZ456' }`.

The test scaffold at line 379 in `epic-6-test-plan.md` (Notes for Amelia #8) specifies this:
> "the writer must track which CSV line number corresponds to which `shop_sku` during `buildPri01Csv`. This means `buildPri01Csv` should return `{ csvBody: string, lineMap: {[lineNumber]: shopSku} }`"

### 3. `submitPriceImport` uses `fetch` directly (NOT `mirAklGet`)

`mirAklGet` is GET-only. PRI01 requires a multipart POST — there is no `mirAklPost` helper. `submitPriceImport` uses `fetch` directly with `FormData`. This is allowed in `shared/mirakl/` per the `no-direct-fetch` ESLint rule's allowlist (the rule only fires OUTSIDE `shared/mirakl/`). Do NOT route this through `mirAklGet`.

### 4. Retry logic — duplicate from `api-client.js` (do not import)

Copy the `RETRY_DELAYS_MS`, `isRetryable`, `backoffDelay` helpers from `api-client.js` into `pri01-writer.js`. A shared retry utility would require a separate shared module that doesn't exist yet. At MVP scale this duplication is acceptable — refactor to `shared/mirakl/retry.js` if a third Mirakl module needs the same pattern.

### 5. ESLint rule registration pattern

Follow the existing pattern in `eslint.config.js` for adding custom rules:
```js
import noRawCsvBuilding from './eslint-rules/no-raw-CSV-building.js';

// In the plugins section:
plugins: {
  'local-cron': {
    rules: {
      'no-raw-CSV-building': noRawCsvBuilding,
      // ... existing rules
    }
  }
}

// In the rules section:
rules: {
  'local-cron/no-raw-CSV-building': 'error',
  // ... existing rules
}
```

### 6. Named exports only — no default exports (ESLint enforces)

```js
// CORRECT:
export async function buildPri01Csv (...) { ... }
export async function submitPriceImport (...) { ... }
export async function markStagingPending (...) { ... }

// WRONG:
export default { buildPri01Csv, submitPriceImport, markStagingPending };
```

### 7. `worker-must-filter-by-customer` ESLint compliance

Every SQL query in `markStagingPending` that touches customer-scoped tables MUST include `customer_marketplace_id` in the WHERE clause. The function signature includes `customerMarketplaceId` and all queries pass it as a parameter. The ESLint rule scans for `customer_marketplace_id` in query strings.

### 8. Empirically-verified Mirakl facts (do NOT re-question)

From `architecture-distillate/_index.md` — Cross-Cutting Empirically-Verified Mirakl Facts:
- **Worten `operator_csv_delimiter` = `SEMICOLON`** — captured via PC01, stored in `customer_marketplaces.operator_csv_delimiter`; NEVER hardcode `;`
- **Worten `offer_prices_decimals` = `2`** — captured via PC01, stored in `customer_marketplaces.offer_prices_decimals`
- **Decimal separator = ASCII period (`.`)** — UNVERIFIED for Worten during dogfood (PC01 did not exercise PRI01); `toFixed()` always produces ASCII period regardless of locale; correct for now, calibrate during dogfood
- **Auth header = raw `Authorization: <key>`** — NO Bearer prefix (all 6 Worten calls confirmed)
- **`shop_sku` is the offer-sku column value** — `OF21` returns `shop_sku: "EZ8809606851663"` (seller-provided); `offer_sku: null`; `product_sku` is Mirakl's internal UUID — use `shop_sku` ONLY
- **PRI01 delete-and-replace** — any channel price NOT in the submitted CSV is DELETED by Mirakl; passthrough lines are mandatory for every channel of the SKU
- **CSV column set (Worten MVP):** `offer-sku;price;channels` ONLY — no discount-start-date, no end-date, no price-ranges (PC01 confirmed `discount_period_required: false`, `scheduled_pricing: false`, `volume_pricing: false`)

### 9. OF24 is FORBIDDEN (negative assertion — architecture constraint #6)

NEVER use `POST /api/offers` (OF24) for price updates. OF24 resets ALL unspecified offer fields (quantity, description, leadtime) to defaults — a footgun confirmed at architecture level. PRI01 (`POST /api/offers/pricing/imports`) is the ONLY permitted price-write path.

### 10. No `.then()` chains — async/await only (ESLint enforces)

### 11. No `console.log` — pino only

```js
import { createWorkerLogger } from '../../shared/logger.js';
const logger = createWorkerLogger();
```

However, `pri01-writer.js` lives in `shared/mirakl/` (used by both app and worker). Use a conditional import or make logging optional via injected pino instance. The simplest approach: import `createWorkerLogger` at module level (it exists and is importable from shared). If this causes issues in app context (shouldn't, since app never calls PRI01 writer), inject logger as a parameter.

### 12. `markStagingPending` passthrough logic detail

When building the list of SKU IDs from staging, you get rows that have a `new_price_cents`. But you also need to mark ALL `sku_channel` rows for those SKUs (even channels that don't have a staging row = passthrough channels). The passthrough channels' `pending_set_price_cents` should be set to their current `last_set_price_cents` (the price that's being included as a passthrough line in the CSV).

Pseudo-code:
```
stagedRows = SELECT sku_id, new_price_cents FROM pri01_staging WHERE cycle_id=X AND customer_marketplace_id=Y
stagedBySkuId = group stagedRows by sku_id  // {sku_id: new_price_cents}
allSkuIds = unique sku_ids from stagedRows

allChannelRows = SELECT id, sku_id, channel_code, last_set_price_cents FROM sku_channels
                  WHERE customer_marketplace_id=Y AND sku_id = ANY(allSkuIds)

for each channelRow:
  stagedPrice = stagedBySkuId.get(channelRow.sku_id)  // may be undefined if only other channel staged
  pendingSetPrice = stagedPrice ?? channelRow.last_set_price_cents
  UPDATE sku_channels SET pending_import_id=importId, pending_set_price_cents=pendingSetPrice WHERE id=channelRow.id
```

Note: The above iterates per row. For efficiency, batch the UPDATE with `WHERE id = ANY($array)` in two groups (staged vs passthrough). Both approaches are acceptable at MVP scale.

### 13. CSV line endings and encoding

- Line endings: `\n` (LF only, not CRLF). Build the CSV with `rows.join('\n')` followed by a trailing `\n`.
- Encoding: UTF-8 without BOM (pending Worten dogfood calibration — BOM can cause Mirakl parse failures).
- Header row is included in the CSV body, counts as line 0 for lineMap purposes (lineMap is 1-based for body rows only).

### 14. Test file already committed — do not recreate

`tests/shared/mirakl/pri01-writer.test.js` is in the worktree (merged from main). Read it before implementing — the scaffold defines exact test names and the expected import path:
```js
// import { buildPri01Csv, submitPriceImport, markStagingPending } from '../../../shared/mirakl/pri01-writer.js';
```
Uncomment and implement to make all `TODO (Amelia)` stubs pass.

---

## Bundle C Invariant (this story's portion)

This story is the third Bundle C participant (after Story 5.1 dispatcher and Story 5.2 staging table). The invariant this story establishes:

**After `markStagingPending` returns:**
- EVERY `sku_channel` row for every SKU in the cycle batch has `pending_import_id = importId` (non-NULL)
- ZERO rows in the batch have `pending_import_id IS NULL`
- This blocks the dispatcher's `WHERE pending_import_id IS NULL` precondition for those rows
- This makes cooperative-absorption (Story 7.3) correctly skip-on-pending

The full Bundle C gate (Story 7.8) exercises this invariant end-to-end across all 17 P11 fixtures. Story 6.1's unit test `mark_staging_pending_no_cycle_row_left_without_pending_import_id` provides partial-invariant assurance.

---

## Architecture Constraints — Negative Assertions

From `architecture-distillate/_index.md` (27 items), items relevant to Story 6.1:

- **No OF24 for price updates** (constraint #6) — `POST /api/offers` is FORBIDDEN; PRI01 (`POST /api/offers/pricing/imports`) only
- **No raw CSV building outside `shared/mirakl/pri01-writer.js`** (constraint #20) — `no-raw-CSV-building` ESLint rule ships in this story
- **No direct `fetch` outside `shared/mirakl/`** (constraint #19) — `submitPriceImport` is IN `shared/mirakl/` so `fetch` is allowed
- **No raw `INSERT INTO audit_log` outside `shared/audit/writer.js`** (constraint #21) — if any audit events are needed in this story's scope, use `writeAuditEvent`
- **No worker query missing `customer_marketplace_id` filter** (constraint #24) — `markStagingPending` SQL includes `customer_marketplace_id` in all queries
- **No `console.log`** (constraint #18) — pino logger only
- **No default exports** — named exports only
- **No `.then()` chains** — async/await only
- **No float price math** — prices in integer cents throughout; only format to decimal at CSV serialization time (`cents / 100).toFixed(decimals)`)

---

## Testing Instructions

### Run Story 6.1 unit tests
```bash
node --test tests/shared/mirakl/pri01-writer.test.js
```
All tests must pass (scaffold stubs replaced with real implementations by ATDD step).

### Run ESLint on the new files
```bash
npx eslint shared/mirakl/pri01-writer.js eslint-rules/no-raw-CSV-building.js
```
Must produce 0 violations.

### Run full unit suite (no regressions)
```bash
npm run test:unit
```
Verify no pre-existing test failures are introduced by this story's changes. Note: there are pre-existing failures on this branch (from Story 5.2 review finding) — confirmed pre-existing, not caused by Story 6.1 work.

### No integration tests required
Story 6.1 is NOT tagged `integration_test_required: true` in sprint-status. The full integration gate is Story 7.8. Unit tests suffice for this story.

---

## Story Completion Checklist

- [x] `shared/mirakl/pri01-writer.js` created with three exports: `buildPri01Csv`, `submitPriceImport`, `markStagingPending`
- [x] `buildPri01Csv` returns `{ csvBody, lineMap }` (not just `csvBody`)
- [x] `buildPri01Csv` throws on null `operatorCsvDelimiter` or `offerPricesDecimals` with clear error including `customerMarketplaceId`
- [x] `buildPri01Csv` includes passthrough lines for all channels (PRI01 delete-and-replace safety)
- [x] `submitPriceImport` uses raw `Authorization: <apiKey>` header (NO Bearer prefix)
- [x] `submitPriceImport` uses multipart POST to `<baseUrl>/api/offers/pricing/imports`
- [x] `submitPriceImport` implements 5-retry exponential backoff matching `mirAklGet` schedule
- [x] `submitPriceImport` never leaks apiKey in errors or logs
- [x] `markStagingPending` sets `pending_import_id` on ALL participating `sku_channel` rows (including passthroughs)
- [x] `markStagingPending` sets `flushed_at` and `import_id` on `pri01_staging` rows
- [x] All SQL in `markStagingPending` includes `customer_marketplace_id` filter (ESLint compliance)
- [x] `eslint-rules/no-raw-CSV-building.js` created and registered in `eslint.config.js`
- [x] Golden CSV fixtures created in `tests/fixtures/pri01-csv/` (3 files, LF endings, no BOM)
- [x] All unit tests pass: `node --test tests/shared/mirakl/pri01-writer.test.js`
- [x] ESLint passes: `npx eslint shared/mirakl/pri01-writer.js`
- [x] `npm run test:unit` passes (full unit suite, no new regressions introduced)
- [x] No OF24 calls anywhere in the codebase (grep verify: `POST /api/offers` must not appear)
- [x] No hardcoded delimiter (`;` never hardcoded as CSV delimiter default)
- [x] Named exports only — no default export
- [x] pino logger used, not `console.log`
- [x] No `.then()` chains — async/await only

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — implementation proceeded cleanly.

### Completion Notes List

- Implemented `shared/mirakl/pri01-writer.js` with three named exports: `buildPri01Csv`, `submitPriceImport`, `markStagingPending`.
- `buildPri01Csv` returns `{ csvBody, lineMap }` with 1-based line map for PRI03 parser correlation. Throws clear PC01-capture-incomplete error on null/undefined `operatorCsvDelimiter` or `offerPricesDecimals`. Passthrough channels (no staging row for their specific sku+channel) included via `lastSetPriceCents` (delete-and-replace safety).
- `submitPriceImport` uses Node 22 `FormData` + `fetch` directly (allowed in `shared/mirakl/` per `no-direct-fetch` allowlist). Raw `Authorization: <apiKey>` header — NO Bearer prefix. 5-retry exponential backoff [1s,2s,4s,8s,16s] matching `mirAklGet`. Returns `{ importId }` mapped from snake_case `import_id`. API key never appears in errors or logs.
- `markStagingPending` uses per-channel staging lookup (`sku_id:channel_code` composite key) — staging is per channel, not per SKU. Passthrough channels (sku_id in batch, but no staging row for their channel_code) get `pending_set_price_cents = last_set_price_cents`. All queries include `customer_marketplace_id` (ESLint worker-must-filter-by-customer compliance).
- `eslint-rules/no-raw-CSV-building.js` created: fires on `csv-stringify`/`papaparse` imports and template literals with `;\\n` or `,\\n` CSV-building patterns. Allowlisted for `shared/mirakl/pri01-writer.js`. Does NOT fire on `readFileSync` calls. Registered under `local-cron/no-raw-CSV-building` in `eslint.config.js`.
- Retry helpers (`RETRY_DELAYS_MS`, `isRetryable`, `backoffDelay`) duplicated from `api-client.js` — shared utility deferred to a future `shared/mirakl/retry.js` if a 3rd module needs them.
- All 34 unit tests pass (5 suites: buildPri01Csv ×13, submitPriceImport ×8, markStagingPending ×7, ESLint ×4, PC01 guard ×2). 22 pre-existing failures in `test:unit` unrelated to Story 6.1 (dry-run-minimal + margin route tests need DB state).
- ESLint: 0 violations on `shared/mirakl/pri01-writer.js` and `eslint-rules/no-raw-CSV-building.js`.

### File List

- `shared/mirakl/pri01-writer.js` — CREATED (AD7 SSoT: buildPri01Csv, submitPriceImport, markStagingPending)
- `eslint-rules/no-raw-CSV-building.js` — CREATED (no-raw-CSV-building ESLint rule; ships with SSoT per deferred-rule pattern)
- `eslint.config.js` — MODIFIED (registered `no-raw-CSV-building` under `local-cron` plugin namespace)
- `tests/shared/mirakl/pri01-writer.test.js` — MODIFIED (scaffold stubs replaced with full test implementations; import uncommented)

### Review Findings

Step 5 code review — 2026-05-08. Three review layers run inline (subagent dispatch unavailable from nested skill context): Blind Hunter (diff-only structural), Edge Case Hunter (diff + project read), Acceptance Auditor (diff vs spec). All 36 unit tests pass; ESLint 0 violations on the two new files; module boots cleanly; spec ACs #1–#5 satisfied. No `decision-needed`, no `patch` items, no Critical/Major findings. Three `defer` items (all align with explicit MVP-scope acknowledgements in the spec):

- [x] [Review][Defer] No request timeout on `fetch` in `submitPriceImport` [`shared/mirakl/pri01-writer.js:159`] — deferred, pre-existing pattern (same gap exists in `shared/mirakl/api-client.js`'s `mirAklGet`); resolve when 3rd Mirakl module needs the same retry+timeout helper, per Dev Notes Note #4
- [x] [Review][Defer] Per-row `UPDATE sku_channels` loop — N round-trips per cycle [`shared/mirakl/pri01-writer.js:259-274`] — deferred, Dev Notes Note #12 explicitly accepts this for MVP scale; batch with `WHERE id = ANY($array)` is a follow-up if cycle latency becomes a measurable concern
- [x] [Review][Defer] `no-raw-CSV-building` rule could false-positive on legitimate error-message strings containing `;\n` or `,\n` [`eslint-rules/no-raw-CSV-building.js:158-184`] — deferred, low-impact (developers can switch to string concatenation if hit); tests confirm CSV-reading patterns are not flagged

Findings dismissed as non-issues (recorded for traceability):

- (Blind) `shopSku` / `channelCode` not CSV-escaped — Mirakl SKUs empirically alphanumeric; PRI03 surfaces any malformed line; no observed evidence of dangerous values
- (EdgeCase) `await res.json()` on a 200 with non-JSON body would throw — Mirakl spec contract guarantees `import_id` JSON; not in defensive scope
- (EdgeCase) Orphan staging rows (sku exists, no `sku_channel`) — pathological; FK + Story 5.2 cycle-assembly precludes; not reachable in practice
- (Blind) `stagedBySkuChannel.set` could overwrite duplicates — `SELECT DISTINCT` + Story 5.2 invariant precludes duplicate (sku_id, channel_code, new_price_cents) triples
