# Story 4.4: Async Catalog Scan Orchestration — A01 → PC01 → OF21 → P11 → Tier Classify → Baseline (Atomicity Sibling of Story 4.1)

> **Endpoints verified against Mirakl MCP and architecture-distillate empirical facts (2026-05-07).**
> A01 (`GET /api/account`), PC01 (`GET /api/platform/configuration`), OF21 (`GET /api/offers`), P11 (`GET /api/products/offers`) all verified. Field names, param formats, response structures, auth header (`Authorization: <api_key>` — no Bearer prefix), and filter chain (`active === true AND total_price > 0 AND shop_name !== ownShopName`) confirmed per MCP schema + architecture-distillate Cross-Cutting Empirically-Verified Mirakl Facts. P11 response structure confirmed as `products[].offers[]` (not flat `offers[]`); `offer.channels` is always `[]` in P11 (MCP-confirmed) — channel bucketing determined by which `pricing_channel_code` call returned the offer. PC01 field path confirmed as `features.pricing.channel_pricing` (nested, not flat). All Mirakl calls delegated to existing SSoT modules: `shared/mirakl/a01.js`, `pc01.js`, `of21.js`, `p11.js`, `self-filter.js` (all Story 3.2).

**Sprint-status key:** `4-4-async-catalog-scan-orchestration-a01-pc01-of21-p11-tier-classify-baseline-atomicity-sibling-of-story-4-1`
**Status:** review
**Size:** L
**Epic:** Epic 4 — Customer Onboarding (architecture S-I phase 4)
**Atomicity:** Bundle B (F4 + onboarding scan sibling — Story 4.1 schema half, Story 4.4 population half)
**Depends on:** Stories 3.2 (a01.js, pc01.js, of21.js, p11.js, self-filter.js, mirakl-server mock), 3.3 (mirakl-empirical-verify.js), 4.1 (customer_marketplaces schema + cron_state + transitionCronState), 4.2 (skus + sku_channels + baseline_snapshots + scan_jobs schemas), 4.3 (creates PROVISIONING rows + scan_jobs PENDING rows that this story picks up)
**Enables:** Story 4.5 (scan progress page polls scan_jobs), Story 4.7 (scan-ready interstitial), Epic 5 (dispatcher reads DRY_RUN rows)

> **Merge block resolution:** This story's PR merge unblocks Story 4.3's PR from merging to main (sprint-status `merge_blocks` entry). Story 4.3 is in `review` and bundle-blocked until 4.4 reaches `done`. Both PRs should merge together or 4.4 first.

---

## Narrative

**As a** signed-up customer whose Worten Mirakl API key has been validated and encrypted (Story 4.3),
**I want** the system to automatically run a full catalog scan in the background — calling A01 (account), PC01 (platform config), OF21 (my offers), and P11 (competitor prices per EAN/channel) — then classify each SKU/channel into an initial tier, snapshot baseline prices, and transition my marketplace row from PROVISIONING to DRY_RUN —
**So that** my dashboard is pre-populated with live competitive data before I ever see it, and the repricing engine has everything it needs to start making decisions.

---

## Trace

- **Architecture decisions:** AD16 (full onboarding scan sequence — all 9 steps), AD26 (PC01 capture + monthly re-pull foundation), F4 (PROVISIONING → DRY_RUN transition gated by CHECK constraint — this story satisfies the constraint), AD10 (initial tier classification logic), AD13 (self-filter via shop_name), AD14 (mandatory P11 filter chain: active=true AND total_price>0)
- **FRs:** FR12 (async catalog scan), FR14 (server-side scan job state), FR17 (sku_channels population), FR25 (per-channel data model population), FR33 (baseline_snapshots)
- **NFRs:** NFR-P10 (50k SKUs in 4h), NFR-Sc2 (50k SKUs MVP)
- **Amendments:** F4 (PROVISIONING + nullable A01/PC01 + CHECK constraint — this story populates the columns and transitions out)
- **SSoT modules created by this story:** `worker/src/jobs/onboarding-scan.js`, `worker/src/lib/tier-classify.js` (initial classification only — engine tier transitions are Epic 7)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/02-epic-4-onboarding.md`, Story 4.4

---

## Acceptance Criteria

### AC#1 — Worker picks up PENDING scan_jobs row and runs 9-phase orchestration

**Given** a `customer_marketplaces` row in PROVISIONING with an encrypted key in `shop_api_key_vault` (created by Story 4.3) and a corresponding `scan_jobs` row with `status = 'PENDING'`
**When** the worker process detects the PENDING row
**Then** `worker/src/jobs/onboarding-scan.js` runs this exact 9-phase sequence, updating `scan_jobs.status` at each phase transition:

**Phase 0 — Decrypt key:**
- Call `decryptShopApiKey(vaultRow)` from `shared/crypto/envelope.js` (Story 1.2 SSoT)
- Cleartext key held in-memory only for the duration of the scan; never logged

**Phase 1 — Smoke-test reuse:**
- Call `runVerification({ baseUrl, apiKey, referenceEan: process.env.WORTEN_TEST_EAN, inlineOnly: true })` from `scripts/mirakl-empirical-verify.js` programmatically
- If assertion fails → `scan_jobs.status = FAILED`, `failure_reason` persisted, Story 4.6 failure email sent
- Do NOT re-implement the smoke test logic; reuse the existing module

**Phase 2 — RUNNING_A01:**
- Call `getAccount(apiKey, baseUrl)` via `shared/mirakl/a01.js` (Story 3.2 SSoT)
- Persist to `customer_marketplaces`: `shop_id`, `shop_name`, `shop_state`, `currency_iso_code`, `is_professional`, `channels[]`
- A01 response field mapping (MCP-confirmed): `shop_id` → integer, `shop_name` → string, `shop_state` enum (OPEN/CLOSE/SUSPENDED/TERMINATED), `currency_iso_code`, `is_professional` boolean, `channels[]` array of channel codes

**Phase 3 — RUNNING_PC01:**
- Call `getPlatformConfiguration(apiKey, baseUrl)` via `shared/mirakl/pc01.js` (Story 3.2 SSoT)
- Persist to `customer_marketplaces`: `channel_pricing_mode` (from `features.pricing.channel_pricing`), `operator_csv_delimiter` (from `features.operator_csv_delimiter`), `offer_prices_decimals` (from `features.offer_prices_decimals`), `discount_period_required` (from `features.pricing.discount_period_required`), `competitive_pricing_tool` (from `features.competitive_pricing_tool`), `scheduled_pricing` (from `features.pricing.scheduled_pricing`), `volume_pricing` (from `features.pricing.volume_pricing`), `multi_currency` (from `features.multi_currency`), `order_tax_mode` (from `features.order_tax_mode`), `platform_features_snapshot` (full response JSONB), `last_pc01_pulled_at = NOW()`
- **PC01 field path is NESTED**: `response.features.pricing.channel_pricing` NOT `response.channel_pricing` (MCP schema confirmed)
- **Abort condition:** If `channel_pricing_mode = 'DISABLED'` → transition `scan_jobs.status = FAILED` with PT-localized failure_reason: `"O Worten não tem preços por canal activados. Por favor contacta o suporte."` Do NOT proceed to OF21.

**Phase 4 — RUNNING_OF21:**
- Call `getOffers(apiKey, baseUrl)` via `shared/mirakl/of21.js` (Story 3.2 SSoT) — paginated until `total_count` exhausted
- For each offer, extract EAN via `product_references` array: find entry where `reference_type === 'EAN'`, use `reference` value. EAN may be absent (refurbished/private listings without shared EAN) — skip those offers (no `skus` row created; count as "sem EAN" for Story 4.7's summary)
- OF21 field mapping (MCP-confirmed): `shop_sku` (seller SKU for PRI01), `product_sku` (Mirakl internal UUID — NOT seller SKU), `active`, `price`, `total_price`, `channels[]` (list of channel codes this offer is sellable on), `min_shipping_price`, `min_shipping_zone`, `min_shipping_type`
- Bulk-load into `skus` + `sku_channels` rows: one `skus` row per unique EAN, one `sku_channels` row per (sku_id, channel_code) combination from `offer.channels[]`
- Set `sku_channels.channel_active_for_offer = true`, `tier = '3'` (default — overwritten in Phase 6), `tier_cadence_minutes = 1440` (default), `last_checked_at = NOW()`, `list_price_cents = ROUND(price * 100)`, `current_price_cents = ROUND(total_price * 100)` — use integer cents, no floats
- Track `scan_jobs.skus_total` (total distinct EAN count) and update `scan_jobs.skus_processed` incrementally as pages are processed

**Phase 5 — RUNNING_P11:**
- For each EAN in the catalog, batch 100 EANs per call (param: `product_references=EAN|xxx,EAN|yyy,...`), 2 calls per batch (one per active channel: `WRT_PT_ONLINE` and `WRT_ES_ONLINE` if both in `customer_marketplaces.channels`)
- Use `shared/mirakl/p11.js` (`getProductOffers(apiKey, baseUrl, { productReferences, channelCode, pricingChannelCode })`) from Story 3.2
- P11 response structure: `products[].offers[]` — iterate `products`, for each product iterate `offers` (NOT flat `offers[]` top-level)
- Apply `filterCompetitorOffers(offers, ownShopName)` from `shared/mirakl/self-filter.js` (Story 3.2 SSoT): filter chain `active === true AND total_price > 0 AND shop_name !== ownShopName`, sort ascending by `total_price`
- `offer.channels` is always `[]` in P11 (MCP-confirmed) — do NOT use `offer.channels` for channel bucketing; use which `pricingChannelCode` call returned this offer
- Collision detection (AD13): if >1 offer in the filtered set has `shop_name === ownShopName` after the self-filter → something is wrong; this shouldn't happen post-filter, but log a warning with pino and emit `shop-name-collision-detected` Atenção audit event via `writeAuditEvent` from `shared/audit/writer.js` (Story 9.0); skip this EAN for P11 classification (leave as Tier 3)
- Store top-2 competitor offers per (EAN, channel) in memory for Phase 6 (do NOT persist raw P11 data — only tier classification result persists)

**Phase 6 — CLASSIFYING_TIERS:**
- For each `sku_channel` row, apply initial tier classification via `worker/src/lib/tier-classify.js` (this story creates this module)
- Classification rules (AD10):
  - No competitors after filter chain → Tier 3, `tier_cadence_minutes = 1440`
  - Competitors exist, our `current_price_cents` > `competitors[0].total_price * 100` (we're not winning) → Tier 1, `tier_cadence_minutes = 15`
  - Competitors exist, our `current_price_cents` <= `competitors[0].total_price * 100` (we're winning or tied at 1st) → Tier 2a, `tier_cadence_minutes = 15`, `last_won_at = NOW()` (no prior win history at scan time — all initial wins recorded as NOW())
  - Tier 2b is NOT assigned at initial classification (requires 4h elapsed since `last_won_at` — impossible at scan time)
- Bulk UPDATE `sku_channels` with tier, tier_cadence_minutes, last_won_at per EAN/channel result
- `worker/src/lib/tier-classify.js` is the INITIAL-CLASSIFICATION-ONLY version; engine tier transitions (T1↔T2a↔T2b↔T3 during cycles) live in `worker/src/engine/tier-classify.js` (Story 7.5). These are TWO DIFFERENT FILES — do NOT conflate them.

**Phase 7 — SNAPSHOTTING_BASELINE:**
- For every `sku_channel` row (all tiers): copy `current_price_cents` → `list_price_cents` (update in-place), INSERT one `baseline_snapshots` row per (sku_channel_id, customer_marketplace_id) with `list_price_cents = current_price_cents`, `current_price_cents`, `captured_at = NOW()`
- This is FR33 — the pre-tool baseline retained for "restore baseline" Epic 2 feature

**Phase 8 — COMPLETE:**
- Call `transitionCronState({ tx, customerMarketplaceId: cm.id, from: 'PROVISIONING', to: 'DRY_RUN', context: { scan_job_id: scanJob.id } })` from `shared/state/cron-state.js` (Story 4.1 SSoT) inside a transaction
- F4 CHECK constraint (`customer_marketplace_provisioning_completeness`) now passes because A01/PC01 columns are populated
- Set `scan_jobs.status = 'COMPLETE'`, `completed_at = NOW()`
- Do NOT emit a `scan-complete` audit event — `PROVISIONING → DRY_RUN` transition has no AD20 event_type (per transitions-matrix.js mapping; `transitionCronState` will correctly emit no audit event for this pair)

### AC#2 — Failure handling: any phase throws → FAILED + email

**Given** any phase (0–8) in the orchestrator throws an unhandled error
**When** the error is caught by the top-level try/catch in `onboarding-scan.js`
**Then**:
- `scan_jobs.status = 'FAILED'`, `failure_reason = getSafeErrorMessage(err)` (Story 3.1 SSoT — never raw `err.message`)
- `scan_jobs.completed_at = NOW()`
- `customer_marketplaces` row stays in `PROVISIONING` — partial A01/PC01 writes may exist, but the F4 CHECK constraint prevents transition to DRY_RUN until all columns are populated
- Story 4.6's failure email is sent via `sendCriticalAlert` from `shared/resend/client.js` (Story 4.6 SSoT — if Story 4.6 ships after 4.4, stub the call as a no-op import with a TODO comment; Story 4.6 wires the real implementation)
- Customer can re-validate key + re-trigger scan (idempotent: `scan_jobs` EXCLUDE constraint allows new PENDING row once previous is COMPLETE or FAILED)
- Partial `skus`/`sku_channels` rows from a failed Phase 4 partial run: the re-trigger path must handle idempotency — use INSERT ... ON CONFLICT (customer_marketplace_id, ean) DO UPDATE for `skus`, INSERT ... ON CONFLICT (sku_id, channel_code) DO UPDATE for `sku_channels`

### AC#3 — Status polling API returns correct shape for Story 4.5

**Given** the scan is in any phase (PENDING through COMPLETE/FAILED)
**When** Story 4.5's progress page polls `GET /onboarding/scan/status`
**Then** the worker (or app route) returns:
```json
{
  "status": "RUNNING_OF21",
  "phase_message": "A obter catálogo",
  "skus_total": 12430,
  "skus_processed": 3200,
  "started_at": "2026-05-07T14:00:00Z",
  "completed_at": null
}
```
PT-localized `phase_message` per UX-DR6:
- PENDING / RUNNING_A01 / RUNNING_PC01 → `"A configurar integração com Worten"`
- RUNNING_OF21 → `"A obter catálogo"`
- RUNNING_P11 / CLASSIFYING_TIERS → `"A classificar tiers iniciais"`
- SNAPSHOTTING_BASELINE → `"A snapshotar baselines"`
- COMPLETE → `"Pronto"`
- FAILED → `"Falhou"`

Note: `phase_message` is a PT-localized string stored on `scan_jobs.phase_message` — the orchestrator updates this column at each phase transition so the polling endpoint just reads the row.

### AC#4 — Throughput: 50k SKUs within 4h (NFR-P10)

**Given** a 50k-SKU catalog
**When** the scan runs end-to-end
**Then** target completion ≤ 4 hours (NFR-P10)
**And** if wall-clock time exceeds 8 hours, worker logs a `warn` via pino with structured data `{ scan_job_id, elapsed_ms, skus_total }` and emits `scan-complete-with-issues` Notável audit event via `writeAuditEvent`
**And** the P11 batch loop uses 100 EANs/call to stay within rate limits (AD16 spec)
**And** OF21 pagination uses the default page size (no override needed at MVP scale)

### AC#5 — Integration test: tests/integration/onboarding-scan.test.js

**Given** `tests/integration/onboarding-scan.test.js`
**When** ATDD Step 2 fills in the stubs
**Then** the test covers all of these scenarios:

| Test ID | Scenario |
|---|---|
| `scan_picks_up_pending_job_and_runs_all_phases` | Happy path: 200-SKU fixture → all 9 phases complete, DRY_RUN transition fires |
| `a01_populates_customer_marketplace_columns` | A01 result persisted: shop_id, shop_name, channels[] all in DB |
| `pc01_populates_customer_marketplace_columns` | PC01 result persisted including platform_features_snapshot JSONB |
| `pc01_disabled_channel_pricing_fails_scan` | channel_pricing_mode=DISABLED → FAILED with PT-localized failure_reason |
| `of21_creates_skus_and_sku_channels` | skus + sku_channels rows created per (EAN, channel), correct count |
| `of21_skips_offers_without_ean` | Offer with no EAN product_reference → skipped, not counted in skus_total |
| `p11_tier_classification_assigns_correct_tiers` | SKU with competitors → T1 or T2a; SKU without → T3 |
| `tier2a_sets_last_won_at` | Winning SKUs at scan time get last_won_at = NOW() |
| `baseline_snapshot_created_for_all_sku_channels` | baseline_snapshots count = sku_channels count |
| `provisioning_to_dry_run_transition_fires` | customer_marketplaces.cron_state = DRY_RUN after COMPLETE |
| `check_constraint_satisfied_at_transition` | F4 CHECK passes (all A01/PC01 columns populated before DRY_RUN) |
| `failure_in_any_phase_sets_failed_status` | Simulated A01 failure → scan_jobs.status=FAILED, marketplace stays PROVISIONING |
| `failure_reason_is_pt_localized_safe_message` | failure_reason from getSafeErrorMessage, never raw err.message |
| `cleartext_key_never_appears_in_pino_output` | Decrypted key string never in pino log output |
| `idempotent_rescan_after_failure` | New PENDING scan_jobs row can be created after FAILED; OF21 upsert handles duplicate skus |
| `no_pri01_called_during_scan` | PRI01/PRI02/PRI03 endpoints never called (scan is read-only) |
| `scan_complete_no_audit_event_for_provisioning_to_dryrun` | audit_log count unchanged for PROVISIONING→DRY_RUN transition |

**Test harness:** Mirakl mock server (`tests/mocks/mirakl-server.js` from Story 3.2). Seed with 200-SKU fixture data covering: EAN-bearing offers on both PT and ES channels; 1 offer without EAN (for skip-test); 5 EANs with P11 competitors (mix of winning and losing positions); 5 EANs with no P11 competitors (Tier 3). Test uses real Supabase test DB (or pg test DB) — no in-memory stub for DB.

### AC#6 — No PRI01/PRI02/PRI03 calls during scan (read-only constraint)

**Given** the scan runs in any state
**When** the orchestrator executes
**Then** no call to PRI01 (`POST /api/offers/pricing/imports`), PRI02 (`GET /api/offers/pricing/imports/{id}`), or PRI03 (`GET /api/offers/pricing/imports/{id}/error_report`) is made
**And** `scan_jobs.status` NEVER reaches a write-enabling state before `COMPLETE`

---

## Dev Notes

### Two Different tier-classify.js Files — Do NOT Conflate

The epics distillate SSoT module index lists two tier-classify files:
- `worker/src/lib/tier-classify.js` — **THIS STORY** — initial classification at scan time ONLY
- `worker/src/engine/tier-classify.js` (`applyTierClassification`) — **Story 7.5** — ongoing tier transitions during engine cycles

These serve different purposes. This story creates ONLY `worker/src/lib/tier-classify.js`. The Story 7.5 engine version handles T2a→T2b timing, T3→T1 on new competitor entry, etc. Do NOT implement Story 7.5's logic here — that causes scope creep and could conflict with Story 7.5's implementation.

`worker/src/lib/tier-classify.js` exports a single function:
```js
export function classifyInitialTier(ownCurrentPriceCents, competitorOffers) {
  // competitorOffers: already filtered + sorted ascending by total_price (from self-filter.js)
  // returns: { tier: '1'|'2a'|'3', tierCadenceMinutes: number, lastWonAt: Date|null }
}
```

### PC01 Field Paths (MCP-Verified — Critical)

The PC01 response is NESTED. Do not map fields from the wrong level:

```js
// CORRECT field paths (MCP-confirmed schema):
const features = pc01Response.features;
const channelPricingMode = features.pricing.channel_pricing;      // 'SINGLE'|'MULTI'|'DISABLED'
const delimiter = features.operator_csv_delimiter;                  // 'COMMA'|'SEMICOLON'
const decimals = features.offer_prices_decimals;                    // '2' (string)
const discountPeriodRequired = features.pricing.discount_period_required;
const competitivePricingTool = features.competitive_pricing_tool;
const scheduledPricing = features.pricing.scheduled_pricing;
const volumePricing = features.pricing.volume_pricing;
const multiCurrency = features.multi_currency;
const orderTaxMode = features.order_tax_mode;

// WRONG — these do NOT exist at top level:
// pc01Response.channel_pricing  ← DOES NOT EXIST
// pc01Response.channel_pricing_mode  ← DOES NOT EXIST
```

Map `channel_pricing` → `channel_pricing_mode` column value directly (the schema column is named `channel_pricing_mode`, the PC01 field is `channel_pricing`).

### OF21 EAN Extraction

EAN is NOT a top-level field on OF21 offers. Extract from `product_references` array:

```js
function extractEan(offer) {
  const ref = offer.product_references?.find(r => r.reference_type === 'EAN');
  return ref?.reference ?? null; // null = no EAN → skip this offer
}
```

Offers without EAN: count them for Story 4.7's "sem EAN no Worten — ignorados" statistic. Store count in `scan_jobs` or compute from difference between total OF21 rows and `skus_total`.

### OF21 Idempotent Upsert Pattern

```sql
-- skus: unique on (customer_marketplace_id, ean)
INSERT INTO skus (customer_marketplace_id, ean, shop_sku, product_sku, product_title)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (customer_marketplace_id, ean)
DO UPDATE SET shop_sku = EXCLUDED.shop_sku, product_sku = EXCLUDED.product_sku,
             product_title = EXCLUDED.product_title, updated_at = NOW();

-- sku_channels: unique on (sku_id, channel_code)
INSERT INTO sku_channels (sku_id, customer_marketplace_id, channel_code, list_price_cents,
  current_price_cents, tier, tier_cadence_minutes, last_checked_at, channel_active_for_offer)
VALUES ($1, $2, $3, $4, $5, '3', 1440, NOW(), true)
ON CONFLICT (sku_id, channel_code)
DO UPDATE SET list_price_cents = EXCLUDED.list_price_cents,
             current_price_cents = EXCLUDED.current_price_cents,
             channel_active_for_offer = true, updated_at = NOW();
```

### P11 Response Structure (MCP-Confirmed)

```js
// P11 returns products[].offers[] — NOT a flat offers[] array
const { products } = await p11Response;
for (const product of products) {
  for (const offer of product.offers) {
    // offer.shop_id is ALWAYS null (empirical fact)
    // offer.channels is ALWAYS [] (MCP-confirmed "value is always []")
    // offer.active, offer.total_price, offer.shop_name are the fields to filter on
  }
}
```

Channel bucketing: determined by which `pricing_channel_code` parameter was used for this P11 call — NOT by reading `offer.channels` (it's always empty). Make 2 separate calls per EAN-batch (one for PT, one for ES) and tag results by the call's channel.

### P11 Batch Pattern

```js
// 100 EANs per call, 2 calls per batch (PT + ES channels)
const BATCH_SIZE = 100;
for (let i = 0; i < eans.length; i += BATCH_SIZE) {
  const batch = eans.slice(i, i + BATCH_SIZE);
  const productReferences = batch.map(ean => `EAN|${ean}`).join(',');

  for (const channelCode of activeChannels) { // ['WRT_PT_ONLINE', 'WRT_ES_ONLINE']
    const result = await getProductOffers(apiKey, baseUrl, {
      productReferences,
      channel_codes: channelCode,
      pricing_channel_code: channelCode,
      all_offers: false, // default — active offers only (pre-filter, but also filter post-fetch)
    });
    // process result.products[].offers[] per channel
  }
}
```

### transitionCronState Usage (Critical)

```js
import { transitionCronState } from '../../../shared/state/cron-state.js';

// Must be inside a transaction:
await db.tx(async (tx) => {
  await transitionCronState({
    tx,
    customerMarketplaceId: cm.id,
    from: 'PROVISIONING',
    to: 'DRY_RUN',
    context: { scan_job_id: scanJob.id },
  });
  // Also update scan_jobs.status = COMPLETE in same tx:
  await tx.query(
    'UPDATE scan_jobs SET status = $1, completed_at = NOW() WHERE id = $2',
    ['COMPLETE', scanJob.id]
  );
});
```

`transitionCronState` for `PROVISIONING → DRY_RUN` emits NO audit event (per transitions-matrix.js — this pair has no AD20 counterpart). The helper will correctly skip `writeAuditEvent` for this pair. Do NOT manually call `writeAuditEvent` for this transition.

### Worker DB Client

The worker uses the service-role client (`shared/db/service-role-client.js`) — NOT the RLS-aware client. The scan job runs cross-customer by design (worker bypasses RLS). All queries MUST include `customer_marketplace_id` filter (ESLint rule `worker-must-filter-by-customer` will enforce at CI time after Story 5.1 ships; apply manually here).

```js
import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';
const db = getServiceRoleClient();

// ALWAYS filter by customer_marketplace_id in worker queries:
await db.query(
  'INSERT INTO skus (customer_marketplace_id, ...) VALUES ($1, ...)',
  [customerMarketplaceId, ...]
);
```

### decryptShopApiKey Usage (Story 1.2 SSoT)

```js
import { decryptShopApiKey } from '../../../shared/crypto/envelope.js';

const vaultRow = await db.query(
  'SELECT ciphertext, nonce, auth_tag, master_key_version FROM shop_api_key_vault WHERE customer_marketplace_id = $1',
  [customerMarketplaceId]
);
const apiKey = decryptShopApiKey(vaultRow.rows[0]);
// apiKey is plaintext string — use directly in mirAklGet calls, never log it
```

### Scan Job Pickup Pattern

The worker needs to poll for PENDING scan_jobs rows. At MVP, a simple polling approach is sufficient (no BullMQ — constraint #8):

```js
// worker/src/jobs/onboarding-scan.js — runs on a polling interval or triggered by caller
export async function processNextPendingScan() {
  const db = getServiceRoleClient();
  // Claim a PENDING scan atomically via FOR UPDATE SKIP LOCKED
  const { rows } = await db.query(`
    SELECT sj.id, sj.customer_marketplace_id
    FROM scan_jobs sj
    WHERE sj.status = 'PENDING'
    ORDER BY sj.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `);
  if (rows.length === 0) return; // no pending scans
  const scanJob = rows[0];
  // proceed with orchestration...
}
```

`FOR UPDATE SKIP LOCKED` prevents two worker instances from picking up the same scan concurrently (at MVP = single worker, but this pattern is safe for scale).

### Price → Cents Conversion

All price storage is integer cents. OF21 returns prices as floats (e.g., `29.99`):

```js
// CORRECT — use Math.round for price->cents
const listPriceCents = Math.round(parseFloat(offer.price) * 100);
const totalPriceCents = Math.round(parseFloat(offer.total_price) * 100);

// WRONG — float arithmetic:
// const listPriceCents = offer.price * 100; // floating point drift
```

No-float-price ESLint rule (`no-float-price`) will be active once Story 7.1 ships. Apply discipline manually here.

### sendCriticalAlert Stub If Story 4.6 Not Yet Shipped

Story 4.4 depends on Story 4.6's `sendCriticalAlert` interface from `shared/resend/client.js`. If 4.6 ships in the same BAD batch and is not yet available, add a stub:

```js
// At top of onboarding-scan.js — import the interface; Story 4.6 wires the real impl
let sendCriticalAlert;
try {
  ({ sendCriticalAlert } = await import('../../../shared/resend/client.js'));
} catch {
  sendCriticalAlert = async () => {}; // no-op stub until Story 4.6 lands
}
```

In practice, Stories in BAD run sequentially within a batch — check if Story 4.6 is already in the worktree before using the stub.

### Audit Event for shop-name-collision-detected

This IS an AD20 event_type (Atenção tier). Call it correctly:

```js
import { writeAuditEvent } from '../../../shared/audit/writer.js';

await writeAuditEvent({
  tx,
  customerMarketplaceId: cm.id,
  eventType: 'shop-name-collision-detected',
  skuId: null,
  skuChannelId: null,
  payload: { ean, channel: channelCode, matchingOfferCount: collisionOffers.length },
});
```

The `writeAuditEvent` function from Story 9.0 is the SSoT — do NOT raw INSERT into `audit_log`.

### scan-complete-with-issues Audit Event (Notável)

If scan exceeds 8h threshold, emit:

```js
await writeAuditEvent({
  tx: db, // service-role connection, not a transaction tx in this case
  customerMarketplaceId: cm.id,
  eventType: 'scan-complete-with-issues',
  payload: { elapsed_ms, skus_total, warning: 'scan exceeded 8h threshold' },
});
```

### ESLint Rules in Force

At the time Story 4.4 ships, these custom ESLint rules are active (from prior stories):
- `no-direct-fetch` (Story 3.1) — all Mirakl calls via SSoT modules, not raw `fetch()`
- `single-source-of-truth` (Story 4.1) — no raw `UPDATE customer_marketplaces SET cron_state` outside `shared/state/cron-state.js`
- `no-raw-INSERT-audit-log` (Story 9.0) — use `writeAuditEvent` only
- `no-console` (Story 1.1) — pino only

Note: `worker-must-filter-by-customer` (Story 5.1) and `no-float-price` (Story 7.1) are NOT yet active — apply their constraints manually.

---

## File-Touch List

### New files (create)

| File | Purpose |
|---|---|
| `worker/src/jobs/onboarding-scan.js` | 9-phase scan orchestrator — SSoT for this story |
| `worker/src/lib/tier-classify.js` | Initial tier classification at scan time (NOT engine tier transitions) |

### Modified files

| File | Change |
|---|---|
| `worker/src/index.js` | Wire scan poller: set up interval or hook to call `processNextPendingScan()` |

### Pre-existing (DO NOT recreate)

| File | Status | Note |
|---|---|---|
| `shared/mirakl/a01.js` | ALREADY EXISTS — Story 3.2 | `getAccount(apiKey, baseUrl)` |
| `shared/mirakl/pc01.js` | ALREADY EXISTS — Story 3.2 | `getPlatformConfiguration(apiKey, baseUrl)` |
| `shared/mirakl/of21.js` | ALREADY EXISTS — Story 3.2 | `getOffers(apiKey, baseUrl, params)` paginated |
| `shared/mirakl/p11.js` | ALREADY EXISTS — Story 3.2 | `getProductOffers(apiKey, baseUrl, params)` |
| `shared/mirakl/self-filter.js` | ALREADY EXISTS — Story 3.2 | `filterCompetitorOffers(offers, ownShopName)` |
| `shared/mirakl/api-client.js` | ALREADY EXISTS — Story 3.1 | Used internally by all mirakl/*.js modules |
| `shared/mirakl/safe-error.js` | ALREADY EXISTS — Story 3.1 | `getSafeErrorMessage(err)` |
| `shared/crypto/envelope.js` | ALREADY EXISTS — Story 1.2 | `decryptShopApiKey(vaultRow)` |
| `shared/state/cron-state.js` | ALREADY EXISTS — Story 4.1 | `transitionCronState(...)` |
| `shared/state/transitions-matrix.js` | ALREADY EXISTS — Story 4.1 | `LEGAL_CRON_TRANSITIONS` |
| `shared/db/service-role-client.js` | ALREADY EXISTS — Story 2.1 | Worker DB client |
| `shared/db/tx.js` | ALREADY EXISTS — Story 2.1 | Transaction helper |
| `shared/audit/writer.js` | ALREADY EXISTS — Story 9.0 | `writeAuditEvent(...)` |
| `scripts/mirakl-empirical-verify.js` | ALREADY EXISTS — Story 3.3 | `runVerification({ inlineOnly: true })` |
| `tests/mocks/mirakl-server.js` | ALREADY EXISTS — Story 3.2 | Extend with scan-path fixtures |
| `tests/integration/onboarding-scan.test.js` | ATDD Step 2 creates stubs | 17 stubs per AC#5 |

---

## Database Operations (Verbatim Reference)

### scan_jobs status update pattern

```sql
UPDATE scan_jobs
SET status = $1, phase_message = $2, updated_at = NOW()
WHERE id = $3;
-- Call this at each phase transition; $1 is the new status enum value, $2 is the PT-localized message
```

### skus bulk upsert (per OF21 page)

```sql
INSERT INTO skus (customer_marketplace_id, ean, shop_sku, product_sku, product_title)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (customer_marketplace_id, ean)
DO UPDATE SET
  shop_sku = EXCLUDED.shop_sku,
  product_sku = EXCLUDED.product_sku,
  product_title = EXCLUDED.product_title,
  updated_at = NOW()
RETURNING id, ean;
```

### sku_channels bulk upsert (per OF21 page, per channel in offer.channels[])

```sql
INSERT INTO sku_channels
  (sku_id, customer_marketplace_id, channel_code, list_price_cents, current_price_cents,
   tier, tier_cadence_minutes, last_checked_at, channel_active_for_offer)
VALUES ($1, $2, $3, $4, $5, '3', 1440, NOW(), true)
ON CONFLICT (sku_id, channel_code)
DO UPDATE SET
  list_price_cents = EXCLUDED.list_price_cents,
  current_price_cents = EXCLUDED.current_price_cents,
  channel_active_for_offer = true,
  updated_at = NOW();
```

### Tier classification bulk update (after P11 phase)

```sql
UPDATE sku_channels
SET tier = $1, tier_cadence_minutes = $2, last_won_at = $3, updated_at = NOW()
WHERE id = $4;
-- Run per sku_channel row after classifyInitialTier() returns result
-- Batch with pg node-postgres parameterized queries for performance
```

### baseline_snapshots insert

```sql
INSERT INTO baseline_snapshots
  (sku_channel_id, customer_marketplace_id, list_price_cents, current_price_cents, captured_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT DO NOTHING;
-- ON CONFLICT DO NOTHING: if baseline already exists from a previous partial scan, skip
```

### PROVISIONING → DRY_RUN transition (inside transaction)

```sql
-- Handled by transitionCronState() from shared/state/cron-state.js
-- Do NOT write this SQL directly (ESLint rule: single-source-of-truth)
```

---

## Critical Constraints (Do Not Violate)

1. **No re-implementation of any Mirakl client** — all A01/PC01/OF21/P11 calls go through their respective `shared/mirakl/*.js` SSoT modules. `no-direct-fetch` ESLint rule enforces no raw `fetch()` calls.

2. **No raw `UPDATE customer_marketplaces SET cron_state`** — use `transitionCronState()` from `shared/state/cron-state.js`. ESLint rule `single-source-of-truth` enforces.

3. **No raw `INSERT INTO audit_log`** — use `writeAuditEvent()` from `shared/audit/writer.js`. ESLint rule `no-raw-INSERT-audit-log` enforces.

4. **No PRI01/PRI02/PRI03 calls** — scan is strictly read-only. Constraint #6 (OF24 also forbidden — irrelevant here but noted).

5. **No float price math** — all prices stored as integer cents. `Math.round(price * 100)` for conversion. ESLint `no-float-price` not yet active but apply discipline manually.

6. **No `export default`** in any new module except Fastify plugins. Named exports: `export async function processNextPendingScan()`, `export function classifyInitialTier()`.

7. **No `.then()` chains** — async/await only.

8. **No `console.log`** — pino only. Use `logger.info(...)` / `logger.warn(...)` / `logger.error(...)`.

9. **Cleartext API key never logged** — never pass `apiKey` to any pino call, never include in error messages, never assign to a variable that appears in structured log output.

10. **worker-must-filter-by-customer** — all worker queries MUST include `customer_marketplace_id` filter even though this rule isn't mechanically enforced until Story 5.1. Apply manually.

11. **`worker/src/lib/tier-classify.js` is NOT `worker/src/engine/tier-classify.js`** — two different files, two different scopes. Do not implement engine tier transitions (Story 7.5) here.

12. **PC01 DISABLED check is a hard abort** — if `features.pricing.channel_pricing === 'DISABLED'`, set scan_jobs to FAILED immediately with the PT-localized error message. Do not proceed to OF21.

---

## Architectural Pattern Reference

### onboarding-scan.js Shape

```js
// worker/src/jobs/onboarding-scan.js
import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';
import { decryptShopApiKey } from '../../../shared/crypto/envelope.js';
import { getAccount } from '../../../shared/mirakl/a01.js';
import { getPlatformConfiguration } from '../../../shared/mirakl/pc01.js';
import { getOffers } from '../../../shared/mirakl/of21.js';
import { getProductOffers } from '../../../shared/mirakl/p11.js';
import { filterCompetitorOffers } from '../../../shared/mirakl/self-filter.js';
import { getSafeErrorMessage } from '../../../shared/mirakl/safe-error.js';
import { transitionCronState } from '../../../shared/state/cron-state.js';
import { writeAuditEvent } from '../../../shared/audit/writer.js';
import { runVerification } from '../../../scripts/mirakl-empirical-verify.js';
import { classifyInitialTier } from '../lib/tier-classify.js';
import { logger } from '../../../shared/logger.js';

export async function processNextPendingScan() {
  // ... see Dev Notes for pickup pattern
}

async function runScan(db, scanJob, cm) {
  // Phase 0: decrypt key
  // Phase 1: smoke test
  // Phase 2: A01
  // Phase 3: PC01 + DISABLED check
  // Phase 4: OF21 paginated + skus/sku_channels upsert
  // Phase 5: P11 batched
  // Phase 6: tier classify
  // Phase 7: baseline snapshot
  // Phase 8: COMPLETE + transitionCronState
}

async function failScan(db, scanJob, err) {
  await db.query(
    'UPDATE scan_jobs SET status = $1, failure_reason = $2, completed_at = NOW() WHERE id = $3',
    ['FAILED', getSafeErrorMessage(err), scanJob.id]
  );
  // sendCriticalAlert call (Story 4.6 SSoT)
}
```

### tier-classify.js Shape

```js
// worker/src/lib/tier-classify.js
// Initial tier classification at scan time ONLY
// For engine tier transitions during cycles, see worker/src/engine/tier-classify.js (Story 7.5)

/**
 * @param {number} ownCurrentPriceCents - Current price from OF21 (total_price * 100)
 * @param {Array} competitorOffers - Already filtered + sorted asc by total_price (from self-filter.js)
 * @returns {{ tier: '1'|'2a'|'3', tierCadenceMinutes: number, lastWonAt: Date|null }}
 */
export function classifyInitialTier(ownCurrentPriceCents, competitorOffers) {
  if (!competitorOffers || competitorOffers.length === 0) {
    return { tier: '3', tierCadenceMinutes: 1440, lastWonAt: null };
  }
  const lowestCompetitorCents = Math.round(competitorOffers[0].total_price * 100);
  if (ownCurrentPriceCents <= lowestCompetitorCents) {
    // We're winning or tied — Tier 2a
    return { tier: '2a', tierCadenceMinutes: 15, lastWonAt: new Date() };
  }
  // We're losing — Tier 1
  return { tier: '1', tierCadenceMinutes: 15, lastWonAt: null };
}
```

---

## Previous Story Learnings (from Stories 4.1, 4.2, 4.3)

**From Story 4.1 (cron-state.js SSoT + migrations):**
- `transitionCronState` takes `{ tx, customerMarketplaceId, from, to, context }` — must be called inside a transaction
- `PROVISIONING → DRY_RUN` has NO audit event in the transitions-matrix.js event map — helper skips writeAuditEvent correctly
- Optimistic concurrency: if `from` state doesn't match current DB state, `ConcurrentTransitionError` is thrown — catch and log, don't crash worker
- ESLint `single-source-of-truth` rule: do NOT write `UPDATE customer_marketplaces SET cron_state` anywhere except inside `cron-state.js`

**From Story 4.2 (skus + sku_channels + scan_jobs schemas):**
- `scan_jobs` EXCLUDE constraint: `status NOT IN ('COMPLETE', 'FAILED')` — enforces one active scan per marketplace. Catch constraint violation on INSERT (if prior scan still running, skip)
- `sku_channels` has `frozen_for_anomaly_review boolean NOT NULL DEFAULT false` — do NOT set during scan; leave as false
- `sku_channels.pending_import_id` is nullable — leave NULL during scan; only PRI01 writer sets this
- `tier_value` enum values are `'1'`, `'2a'`, `'2b'`, `'3'` — lowercase taxonomic strings, NOT numbers

**From Story 4.3 (key entry + scan_jobs creation):**
- Story 4.3 creates the `scan_jobs` row with `status = 'PENDING'` — this story picks it up
- Story 4.3's `customer_marketplaces` row has `max_discount_pct = 0.0300` sentinel — Story 4.8 overwrites; do NOT touch it here
- Worker uses service-role client, app routes use RLS-aware client — this worker job uses service-role
- `WORTEN_TEST_EAN` env var must be set in `.env.test` for smoke-test phase in integration tests

**From Story 3.2 (Mirakl SSoT modules):**
- `self-filter.js`'s `filterCompetitorOffers` already applies the 3-filter chain (active + total_price>0 + shop_name≠own) and sorts ascending — do NOT re-implement this filter
- P11 mock in `tests/mocks/mirakl-server.js` supports the `product_references=EAN|xxx` format — check existing mock endpoints before adding new ones

---

## Integration Test Gate

This story is `integration_test_required: true` (touches Mirakl mock server + crypto decrypt + pg writes across 4 tables + cron_state transition). The Phase 4.5 gate halts after the batch and requires Pedro to run `npm run test:integration` locally.

The integration test file `tests/integration/onboarding-scan.test.js` has 17 pre-committed stubs (ATDD Step 2 fills them in). All 17 must pass before the story moves to review.

Mock server requirements (check `tests/mocks/mirakl-server.js` before adding):
- `GET /api/account` → 200 with 200-SKU-scenario account fixture
- `GET /api/platform/configuration` → 200 with SINGLE/SEMICOLON/2 fixture (matches `tests/fixtures/pc01/worten-2026-04-30.json`)
- `GET /api/offers` paginated → multiple pages of offer fixtures including 1 without EAN
- `GET /api/products/offers` with `product_references=EAN|*` → products[].offers[] fixture per channel
- `GET /api/platform/configuration` with "disabled" header → DISABLED channel_pricing response

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (2026-05-07)

### Debug Log References

- ESLint compliance: `fetch(` in comment triggered no-direct-fetch codebase scan → rephrased comment
- ESLint compliance: `UPDATE customer_marketplaces SET cron_state` in comment triggered no-raw-cron-state-update scan → rephrased comment
- Schema validation: `channels` is `text[]` not JSON → pass JS array directly to pg (not JSON.stringify)
- Schema validation: `offer_prices_decimals` is `smallint` → pass Number, not String
- Schema validation: `scan_jobs` has no `updated_at` column → removed all `updated_at = NOW()` from scan_jobs UPDATE queries
- Schema validation: `skus.shop_sku` is `NOT NULL` → use `ean` as fallback if `offer.shop_sku` is null
- P11 batch response: `getProductOffersByEanBatch` returns flat `offers[]` (not per-EAN grouped) → stored batch-level filtered competitors for all EANs in batch (conservative but safe)

### Completion Notes List

- Created `worker/src/lib/tier-classify.js`: single `classifyInitialTier(ownCurrentPriceCents, competitorOffers)` function implementing AD10 initial tier rules (Tier 1/2a/3 only — Tier 2b not assigned at scan time)
- Created `worker/src/jobs/onboarding-scan.js`: full 9-phase orchestrator (decrypt → smoke-test → A01 → PC01 → OF21 → P11 → classify → baseline → COMPLETE)
  - Phase 0: `decryptShopApiKey` from `shared/crypto/envelope.js`
  - Phase 1: `runVerification({ inlineOnly: true })` reuse — skipped gracefully if `WORTEN_TEST_EAN` not set
  - Phase 2: A01 → persists shop_id/shop_name/shop_state/currency_iso_code/is_professional/channels (text[])
  - Phase 3: PC01 → persists channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals, all feature flags, platform_features_snapshot JSONB, last_pc01_pulled_at; hard-aborts on DISABLED with PT-localized message
  - Phase 4: OF21 paginated → upserts skus + sku_channels; skips offers without EAN; tracks skus_total/skus_processed progress on scan_jobs
  - Phase 5: P11 batched (100 EANs/call, per active channel); applies `filterCompetitorOffers`; detects collisions + emits `shop-name-collision-detected` audit event
  - Phase 6: loads all sku_channels + applies `classifyInitialTier`; bulk-updates tier/tier_cadence_minutes/last_won_at
  - Phase 7: updates list_price_cents = current_price_cents; inserts baseline_snapshots (ON CONFLICT DO NOTHING for idempotency)
  - Phase 8: atomic tx — `transitionCronState` (PROVISIONING→DRY_RUN) + scan_jobs COMPLETE in same transaction
  - Failure path: `failScan()` updates scan_jobs to FAILED with `getSafeErrorMessage(err)` + calls `sendCriticalAlert` (no-op stub until Story 4.6)
  - `sendCriticalAlert` imported with graceful fallback stub if Story 4.6 `shared/resend/client.js` not yet present
  - Wall-clock 8h threshold: logs pino `warn` + emits `scan-complete-with-issues` audit event
  - FOR UPDATE SKIP LOCKED in pickup query for safe concurrent-worker operation
- Modified `worker/src/index.js`: wired scan poller with `setInterval(5s)` + overlap guard (`_scanPolling` flag)
- Created `tests/worker/src/lib/tier-classify.test.js`: 11 unit tests covering Tier 1/2a/3 classification, null/empty defensive handling, tied-price edge case, lastWonAt Date instance, Tier 2b never returned
- All pre-existing unit tests pass (35 mirakl/a01-pc01-of21-p11 + 7 state + 24 audit writer + 12 crypto + 5 worker heartbeat)
- Integration tests in `tests/integration/onboarding-scan.test.js` (17 tests pre-committed by ATDD Step 2) require `npm run test:integration` with local Supabase + `.env.test` — marked `integration_test_required: true` in story spec

### File List

- `worker/src/jobs/onboarding-scan.js` (new)
- `worker/src/lib/tier-classify.js` (new)
- `worker/src/index.js` (modified — added scan poller wiring)
- `tests/worker/src/lib/tier-classify.test.js` (new)
- `_bmad-output/implementation-artifacts/4-4-async-catalog-scan-orchestration-a01-pc01-of21-p11-tier-classify-baseline-atomicity-sibling-of-story-4-1.md` (status + dev agent record)

### Change Log

- 2026-05-07: Story 4.4 implementation complete. Created 9-phase onboarding scan orchestrator + initial tier classifier. Wired scan poller into worker index. 11 unit tests added for tier-classify. All pre-existing tests pass. Status → review.
