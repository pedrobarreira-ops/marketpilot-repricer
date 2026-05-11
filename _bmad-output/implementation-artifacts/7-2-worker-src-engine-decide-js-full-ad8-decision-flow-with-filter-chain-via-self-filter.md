# Story 7.2: `worker/src/engine/decide.js` — Full AD8 Decision Flow with Filter Chain via Self-Filter

> Endpoints verified against Mirakl MCP and architecture-distillate empirical facts (2026-05-11).

**Sprint-status key:** `7-2-worker-src-engine-decide-js-full-ad8-decision-flow-with-filter-chain-via-self-filter`
**Status:** ready-for-dev
**Size:** L
**Epic:** 7 — Engine Decision & Safety
**Atomicity:** Bundle C (2/4) — AD8 engine half; gate at Story 7.8

---

## Narrative

**As a** BAD subagent implementing the MarketPilot repricing engine,
**I want** a single `worker/src/engine/decide.js` module exporting `decideForSkuChannel` that implements AD8's full 6-step decision table — preconditions, filter chain, cooperative-absorption stub, floor/ceiling math, UNDERCUT/CEILING_RAISE/HOLD branching, per-SKU circuit-breaker stub, and staging write —
**So that** the dispatcher can call one function per (SKU, channel) each cycle, get a deterministic action, and stage the write for the PRI01 writer flush; with all 12 Story-7.2 P11 fixtures passing, engine never reads raw offers directly, and all money math flows through `shared/money/index.js`.

---

## Trace

- **Architecture decisions:** AD8 (full decision table), AD13 (self-filter + collision detection), AD14 (mandatory filter chain), AD7 (pending_import_id precondition), AD9 (cooperative-absorption STEP 2 stub), AD11 (per-SKU circuit-breaker STEP 5 stub)
- **Functional requirements:** FR20 (P11 ranking), FR21 (floor/ceiling math), FR24 (decision-table cases), FR25 (per-channel repricing)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md`, Story 7.2
- **Architecture implementation patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` — "Structural — 11 SSoT Modules", "Format — Money", "17 P11 Fixtures"
- **Architecture decisions detail:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` — AD8 engine decision table (full), AD13, AD14

---

## SSoT Module Introduced

**`worker/src/engine/decide.js`** — single source of truth for per-(SKU, channel) repricing decision. Exports:
- `decideForSkuChannel({ skuChannel, customerMarketplace, ownShopName, p11RawOffers, tx })` — full AD8 6-step decision, returns `{ action, newPriceCents, auditEvents, reason }`

**No new ESLint rule** ships with this story. The existing `no-float-price` rule (Story 7.1) will flag any violations in this file automatically at CI.

---

## Bundle C Context

This is the 2nd of 4 Bundle C stories (6.1 → 7.2 → 7.3 → 7.6 → gate at 7.8). The worktree forks from `story-6.3-pri03-parser-per-sku-rebuild` (stacked dispatch exception — Story 7.2 builds on top of the full Bundle C writer + poller + parser chain, all in-review). The atomicity gate at Story 7.8 fires only after all four bundle stories land.

**Key constraint from Story 6.1 (already landed upstream):** `pri01-writer.js` exports `buildPri01Csv`, `submitPriceImport`, `markStagingPending`. The engine's STEP 6 writes to `pri01_staging` (via `cycle-assembly.js` Story 5.2), NOT directly to the writer. The writer is flushed by cycle-assembly after all per-SKU decisions are done and the per-cycle circuit breaker (Story 7.6) passes.

---

## Critical Note: Money Module Availability

Story 7.1 (`shared/money/index.js`) merged to `main` (PR #86, commit `0f7b9a0`). However, this worktree forks from `story-6.3-pri03-parser-per-sku-rebuild` which predates that merge. The `shared/money/` directory in this worktree contains only a `.gitkeep`.

**Dev agent must:** Before implementing `decide.js`, cherry-pick or copy `shared/money/index.js` and `eslint-rules/no-float-price.js` from `main`. The simplest approach:
```bash
git show main:shared/money/index.js > shared/money/index.js
git show main:eslint-rules/no-float-price.js > eslint-rules/no-float-price.js
```
Then verify `eslint.config.js` already has the `no-float-price` registration (it should — check `main:eslint.config.js` and apply any diff). These files must be committed to the worktree branch before the story spec file.

**Dev Note:** Do NOT merge or rebase onto main — the worktree is intentionally stacked on `story-6.3-pri03-parser-per-sku-rebuild` to inherit the Bundle C chain. Cherry-pick only the money-module files.

---

## Dependencies (All Done / In-Review)

| Story | Status | What this story uses from it |
|-------|--------|------------------------------|
| 1.1 | done | `eslint.config.js` + `eslint-rules/` directory |
| 2.1 | done | `shared/db/tx.js` transaction helper; `shared/db/service-role-client.js` |
| 3.2 | done | `shared/mirakl/p11.js` (`getProductOffersByEan`), `shared/mirakl/self-filter.js` (`filterCompetitorOffers`) |
| 4.2 | done | `sku_channels` schema (tier, tier_cadence_minutes, pending_import_id, frozen_for_anomaly_review, excluded_at, list_price_cents, current_price_cents, last_set_price_cents, min_shipping_price_cents) |
| 5.2 | done | `worker/src/cycle-assembly.js` (`assembleCycle`) — engine stub resolved by dynamic import of `./engine/decide.js` |
| 6.1 | review | `pri01_staging` table; `pending_import_id` contract — engine SKIPS on non-null pending_import_id |
| 6.3 | review | `frozen_for_pri01_persistent` boolean column on `sku_channels` (Story 6.3 picked Option b) |
| 7.1 | done | `shared/money/index.js` (`roundFloorCents`, `roundCeilingCents`, `toCents`, `fromCents`) |
| 9.0 | done | `shared/audit/writer.js` (`writeAuditEvent`); `shared/audit/event-types.js` (event_type constants) |

**Enables (blocked on this story):** Story 7.3 (wires into STEP 2 stub), Story 7.4 (anomaly-freeze endpoint consumers), Story 7.5 (tier-classify called after position determined), Story 7.6 (STEP 5 stub replaced), Story 7.8 (integration gate runs decide.js against all 17 fixtures).

---

## Story 6.3 Freeze Decision (locked — affects this story)

Story 6.3 picked **Option (b)**: parallel `frozen_for_pri01_persistent boolean NOT NULL DEFAULT false` column. This means the engine's STEP 1 preconditions must check BOTH:
- `sku_channel.frozen_for_anomaly_review === false`
- `sku_channel.frozen_for_pri01_persistent === false`

Either true → SKIP. This is an additive check over the schema from Story 4.2 + Story 6.3.

---

## Previous Story Intelligence (Story 7.1)

Key learnings from Story 7.1 (`shared/money/index.js`):

1. **ESLint 10 flat config + Windows worktree paths**: The `no-float-price` rule uses `context.filename` with `.replace(/\\/g, '/')` for cross-platform path normalization. If ESLint is configured with `files` restriction to `['app/**/*.js', 'worker/**/*.js', 'shared/**/*.js']`, it may throw "outside of base path" on Windows with different drives. Story 7.1 resolved by removing the `files` restriction from the `no-float-price` rule registration — the module-level allowlist enforces scope. Follow the same pattern.

2. **Pre-existing violations in `worker/src/jobs/onboarding-scan.js` and `worker/src/lib/tier-classify.js`**: Story 7.1 completion notes confirm these files have float-price violations that the rule correctly detects. This story's implementation must NOT introduce new violations — use `roundFloorCents`/`roundCeilingCents` from `shared/money/index.js` for all floor/ceiling arithmetic.

3. **`fromCents` manual PT locale build**: `'€' + (cents/100).toFixed(2).replace('.', ',')` — use this pattern if you need display formatting (though decide.js should NOT format for display; leave that to eta templates).

4. **Test temp files**: If tests need to lint code strings, write temp files inside `join(repoRoot, 'tmp', ...)` not `os.tmpdir()`. (Less relevant for this story's unit tests, but note for AC5 negative-assertion tests.)

---

## Recent Git Context (Base Branch: story-6.3-pri03-parser-per-sku-rebuild)

The base branch HEAD (`8f2a764`) is a Step 5 code-review commit for Story 6.3. Key additions in the stacked chain that this story builds on:

- `shared/mirakl/pri03-parser.js` — exports `parseErrorReport`; AC#5 wire-up: `scheduleRebuildForFailedSkus` is now live (not dead code — course-correction fixed this)
- `shared/mirakl/pri02-poller.js` — exports `pollImportStatus`; counter ownership = poller
- `shared/mirakl/pri01-writer.js` — exports `buildPri01Csv`, `submitPriceImport`, `markStagingPending`; `csv_line_number` migration applied
- `sku_channels.frozen_for_pri01_persistent` column added via migration in Story 6.3

The `worker/src/engine/` directory contains only a `.gitkeep` — decide.js does not exist yet.

---

## P11 Endpoint — Mirakl MCP Verification

**Endpoint:** `GET /api/products/offers`

MCP confirms (2026-05-11):
- `product_references` format: `EAN|<ean>` (comma-separated for batch) — matches spec
- `channel_codes` param: comma-separated channel codes filter
- `pricing_channel_code` param: picks prices for specific channel — matches spec
- `all_offers=false` (default): returns only active offers — engine still applies `o.active === true` filter as safety net
- Response: `products[].offers[]` array with `active` (boolean), `total_price` (number), `shop_name` (string), `shop_id` (null for competitor offers — empirically confirmed)
- **No drift vs. architecture-distillate empirical facts.** Engine accesses P11 exclusively via `shared/mirakl/p11.js` (`getProductOffersByEan`) — never raw fetch.

Cross-reference with "Cross-Cutting Empirically-Verified Mirakl Facts":
- `shop_id` is null in P11 competitor offers — CONFIRMED (ad13 self-filter uses `shop_name` only)
- `total_price = 0` placeholder offers returned in production (Strawberrynet) — CONFIRMED (AD14 filter catches)
- Channel bucketing by `pricing_channel_code` call parameter — CONFIRMED

---

## AD8 Decision Table (Complete Spec for Implementation)

### Inputs to `decideForSkuChannel`

```js
{
  skuChannel: {
    id, sku_id, customer_marketplace_id, channel_code,
    // pricing state:
    list_price_cents,       // engine anchor (integer cents)
    last_set_price_cents,   // last PRI02-confirmed price
    current_price_cents,    // last P11-observed price
    pending_set_price_cents,
    pending_import_id,      // null = no in-flight import
    // engine state:
    tier, tier_cadence_minutes, last_won_at, last_checked_at,
    // freeze:
    frozen_for_anomaly_review,   // boolean
    frozen_for_pri01_persistent, // boolean (Story 6.3 Option b)
    frozen_at, frozen_deviation_pct,
    // shipping:
    min_shipping_price_cents,
    // Epic 2 reservation:
    excluded_at,             // null at MVP
    channel_active_for_offer,
  },
  customerMarketplace: {
    id, cron_state,
    max_discount_pct,        // e.g. 0.0150
    max_increase_pct,        // e.g. 0.0500
    edge_step_cents,         // integer, default 1
    anomaly_threshold_pct,   // null = use 0.40 default
    offer_prices_decimals,   // from PC01 — for future use; cents discipline makes this advisory
    shop_name,               // from A01 (e.g. 'Easy - Store')
  },
  ownShopName: string,        // === customerMarketplace.shop_name (passed separately for clarity)
  p11RawOffers: object[],     // raw P11 offers array for this (EAN, channel)
  tx: object,                 // transaction-capable DB client
}
```

### Return shape

```js
{
  action: 'UNDERCUT' | 'CEILING_RAISE' | 'HOLD' | 'SKIP',
  newPriceCents: number | null,   // null for HOLD/SKIP
  auditEvents: string[],          // array of event_type slugs (may be empty for SKIP-no-audit)
  reason: string,                 // short debug string for pino logging
}
```

**CRITICAL:** `decideForSkuChannel` returns `auditEvents` as a **string array** of event_type slugs. The CALLER (cycle-assembly) handles `writeAuditEvent` calls using this array. `decide.js` does NOT call `writeAuditEvent` directly — it only returns which events should be emitted. This matches the cycle-assembly.js pattern at lines 94-106 where it iterates `auditEvents` and calls `writeAuditEvent` per event.

### Step-by-step (AD8)

#### PRECONDITIONS (any false → return SKIP)

1. `customerMarketplace.cron_state === 'ACTIVE'`
2. `skuChannel.frozen_for_anomaly_review === false`
3. `skuChannel.frozen_for_pri01_persistent === false`   ← Story 6.3 Option b addition
4. `skuChannel.pending_import_id === null`
5. `skuChannel.excluded_at === null`

If any precondition fails: `return { action: 'SKIP', newPriceCents: null, auditEvents: [], reason: '<which precondition>' }`

#### STEP 1 — Filter chain + collision check + Tier 3 path

```js
const { filteredOffers, collisionDetected } = filterCompetitorOffers(p11RawOffers, ownShopName);
```

`filterCompetitorOffers` from `shared/mirakl/self-filter.js` applies in order:
1. `o.active === true`
2. `Number.isFinite(o.total_price) && o.total_price > 0`
3. `o.shop_name !== ownShopName`
4. `.sort((a, b) => a.total_price - b.total_price)`

**Collision:** `collisionDetected === true` → return `{ action: 'SKIP', newPriceCents: null, auditEvents: [EVENT_TYPES.SHOP_NAME_COLLISION_DETECTED], reason: 'collision' }`. Cycle-assembly emits the audit event.

**No competitors after filtering:** `filteredOffers.length === 0` → return `{ action: 'HOLD', newPriceCents: null, auditEvents: [EVENT_TYPES.TIER_TRANSITION], reason: 'no-competitors' }`. (Tier 3 classification is Story 7.5's domain; engine records the outcome here via the audit event, Story 7.5 updates the DB columns.)

**Engine law:** After STEP 1, ALL ranking/math uses `filteredOffers` ONLY. No code in decide.js reads `p11RawOffers` after the filter call.

#### STEP 2 — Cooperative-absorption stub

STEP 2 is a stub for this story. When Story 7.3 ships, it replaces the stub via dynamic import. For now:

```js
let cooperativeAbsorbResult = { absorbed: false, frozen: false, skipped: false };
try {
  const { absorbExternalChange } = await import('../../shared/engine/cooperative-absorb.js');
  cooperativeAbsorbResult = await absorbExternalChange({ tx, skuChannel, customerMarketplace });
} catch {
  // Story 7.3 not yet shipped — pass through
}
if (cooperativeAbsorbResult.skipped || cooperativeAbsorbResult.frozen) {
  return { action: 'SKIP', newPriceCents: null, auditEvents: [], reason: 'cooperative-absorb-skip' };
}
```

**Note:** The import path above is a placeholder — Story 7.3 may ship as `worker/src/engine/cooperative-absorb.js`. The cycle-assembly fallback pattern (try dynamic import, catch to stub) is the same pattern as `cycle-assembly.js` uses for decide.js itself. Keep this consistent.

#### STEP 3 — Floor / ceiling computation

```js
import { roundFloorCents, roundCeilingCents } from '../../../shared/money/index.js';

const floorPriceCents = roundFloorCents(
  skuChannel.list_price_cents * (1 - customerMarketplace.max_discount_pct)
);
const ceilingPriceCents = roundCeilingCents(
  skuChannel.list_price_cents * (1 + customerMarketplace.max_increase_pct)
);
```

**CRITICAL rounding directions:**
- `roundFloorCents` → `Math.ceil` — floor never sinks below raw (protects margin)
- `roundCeilingCents` → `Math.floor` — ceiling never exceeds raw (prevents over-pricing)
- Getting these backwards is a financial bug

**CRITICAL units:** `edge_step_cents` is an integer (cents), e.g. `1` = €0.01. Use it directly in integer-cents arithmetic — do NOT divide by 100.

#### STEP 4 — Position branching

```js
const competitorLowestCents = toCents(filteredOffers[0].total_price);
const competitor2ndCents = filteredOffers[1] != null ? toCents(filteredOffers[1].total_price) : null;

// Determine own position: compare own total (current_price_cents + min_shipping_price_cents)
// to competitor_lowest. Own position === 1 if we're at or below the lowest competitor.
const ownTotalCents = skuChannel.current_price_cents + (skuChannel.min_shipping_price_cents ?? 0);
const ownPosition = ownTotalCents <= competitorLowestCents ? 1 : 2; // simplified: 1 or >1
```

**CASE A — position > 1 (contested):**
```js
const targetUndercutCents = competitorLowestCents - customerMarketplace.edge_step_cents;
const candidateCents = Math.max(targetUndercutCents, floorPriceCents);
if (candidateCents < competitorLowestCents) {
  // UNDERCUT
  // return { action: 'UNDERCUT', newPriceCents: candidateCents, auditEvents: [EVENT_TYPES.UNDERCUT_DECISION], reason: 'undercut' }
} else {
  // HOLD (cannot undercut profitably — at floor; tie also lands here per pre-locked decision)
  // return { action: 'HOLD', newPriceCents: null, auditEvents: [EVENT_TYPES.HOLD_FLOOR_BOUND], reason: 'floor-bound' }
}
```

**Tie handling (pre-locked decision):** When `candidateCents === competitorLowestCents` (CASE A), action = HOLD with `hold-floor-bound` event. Coin-flip with margin sacrifice is strictly worse; HOLD is the correct response.

**CASE B — position == 1 (winning):**
```js
if (competitor2ndCents === null) {
  // HOLD — no 2nd-place target
  // return { action: 'HOLD', newPriceCents: null, auditEvents: [EVENT_TYPES.HOLD_ALREADY_IN_1ST], reason: 'no-2nd' }
} else {
  const targetCeilingCents = competitor2ndCents - customerMarketplace.edge_step_cents;
  const newCeilingCents = Math.min(targetCeilingCents, ceilingPriceCents);
  if (newCeilingCents > skuChannel.current_price_cents) {
    // CEILING_RAISE
    // return { action: 'CEILING_RAISE', newPriceCents: newCeilingCents, auditEvents: [EVENT_TYPES.CEILING_RAISE_DECISION], reason: 'ceiling-raise' }
  } else {
    // HOLD
    // return { action: 'HOLD', newPriceCents: null, auditEvents: [EVENT_TYPES.HOLD_ALREADY_IN_1ST], reason: 'already-best' }
  }
}
```

**Audit events for STEP 4** — returned in the `auditEvents` array using EVENT_TYPES constants (import from `shared/audit/event-types.js`):
- `EVENT_TYPES.UNDERCUT_DECISION` → `'undercut-decision'` (Rotina)
- `EVENT_TYPES.CEILING_RAISE_DECISION` → `'ceiling-raise-decision'` (Rotina)
- `EVENT_TYPES.HOLD_FLOOR_BOUND` → `'hold-floor-bound'` (Rotina)
- `EVENT_TYPES.HOLD_ALREADY_IN_1ST` → `'hold-already-in-1st'` (Rotina)
- `EVENT_TYPES.TIER_TRANSITION` → `'tier-transition'` (Rotina) — for Tier 3 / no-competitors path
- `EVENT_TYPES.SHOP_NAME_COLLISION_DETECTED` → `'shop-name-collision-detected'` (Atenção) — for collision SKIP

**decide.js does NOT call `writeAuditEvent` directly.** It returns the `auditEvents` array; cycle-assembly.js calls `writeAuditEvent` per event (lines 94-106 of cycle-assembly.js). Import `{ EVENT_TYPES }` from `'../../../shared/audit/event-types.js'` for type-safe slug references.

#### STEP 5 — Per-SKU circuit-breaker stub

STEP 5 is a stub for this story. When Story 7.6 ships, it replaces the stub. For now:

```js
let cbResult = { tripped: false };
try {
  const { checkPerSkuCircuitBreaker } = await import('../safety/circuit-breaker.js');
  cbResult = checkPerSkuCircuitBreaker({ skuChannel, newPriceCents: candidateCents, currentPriceCents: skuChannel.current_price_cents });
} catch {
  // Story 7.6 not yet shipped — pass through
}
if (cbResult.tripped) {
  // Story 7.6 emits the circuit-breaker-per-sku-trip event itself; decide.js returns empty auditEvents
  return { action: 'HOLD', newPriceCents: null, auditEvents: [], reason: 'circuit-breaker' };
}
```

#### STEP 6 — Emit to cycle-assembly staging

If `action ∈ { UNDERCUT, CEILING_RAISE }`:
- The caller (cycle-assembly.js, Story 5.2) handles the INSERT into `pri01_staging`. The `decideForSkuChannel` function returns the action and `newPriceCents`; it does NOT directly write to staging.
- This is the correct division: cycle-assembly aggregates per-SKU decisions and writes staging; decide.js is a pure-ish decision function.

---

## File-Touch List

### New files

| File | Purpose |
|------|---------|
| `worker/src/engine/decide.js` | SSoT engine decision: `decideForSkuChannel` — AD8 full 6-step implementation |
| `tests/worker/engine/decide.test.js` | Unit tests: 12 P11 fixtures + edge cases per AC4 |
| `tests/fixtures/p11/p11-tier1-undercut-succeeds.json` | P11 fixture — see fixture spec below |
| `tests/fixtures/p11/p11-tier1-floor-bound-hold.json` | P11 fixture |
| `tests/fixtures/p11/p11-tier1-tie-with-competitor-hold.json` | P11 fixture |
| `tests/fixtures/p11/p11-tier2b-ceiling-raise-headroom.json` | P11 fixture |
| `tests/fixtures/p11/p11-all-competitors-below-floor.json` | P11 fixture |
| `tests/fixtures/p11/p11-all-competitors-above-ceiling.json` | P11 fixture |
| `tests/fixtures/p11/p11-self-active-in-p11.json` | P11 fixture |
| `tests/fixtures/p11/p11-self-marked-inactive-but-returned.json` | P11 fixture |
| `tests/fixtures/p11/p11-single-competitor-is-self.json` | P11 fixture |
| `tests/fixtures/p11/p11-zero-price-placeholder-mixed-in.json` | P11 fixture |
| `tests/fixtures/p11/p11-shop-name-collision.json` | P11 fixture |
| `tests/fixtures/p11/p11-pri01-pending-skip.json` | P11 fixture |

**Note:** Two verification fixtures already exist in `tests/fixtures/p11/`:
- `worten-ean-8809606851663-pt-2026-04-30.json` — live verification capture; forms the basis for `p11-tier1-undercut-succeeds.json` scenario
- `worten-ean-8809606851663-es-2026-04-30.json` — ES channel companion

### Modified files

| File | Change |
|------|--------|
| `shared/money/index.js` | Cherry-picked from main (Story 7.1) — already exists in main, must be brought into this worktree |
| `eslint-rules/no-float-price.js` | Cherry-picked from main (Story 7.1) |
| `eslint.config.js` | Verify `no-float-price` registration exists (from Story 7.1 on main); apply if missing |
| `worker/src/cycle-assembly.js` | **CRITICAL**: Updated to load full skuChannel row, customerMarketplace row, fetch P11 offers via `getProductOffersByEan`, and call `decideForSkuChannel` with full named-param signature |
| `worker/src/engine/.gitkeep` | Delete after decide.js is created |

---

## P11 Fixture Specifications

All fixtures follow the shape confirmed by Mirakl MCP: `{ products: [{ product_references: [...], offers: [...] }] }`.

Each fixture must include a `_note` comment field documenting what scenario it represents and what the expected engine output is.

### Fixture 1: `p11-tier1-undercut-succeeds.json`
Already partially defined in `worten-ean-8809606851663-pt-2026-04-30.json`. Extend with proper `_expected` annotation.
- Scenario: We're at position 2; floor allows undercut; candidate = competitor_lowest - edge_step
- Expected: `action=UNDERCUT`, `newPriceCents = competitor_lowest_cents - 1`
- Own shop: `Easy - Store`, active=true at €31.99; competitors at €28.50 (rank 1) and €32.00 (rank 2); Strawberrynet at €0 (filtered)

```json
{
  "_note": "Tier 1 contested: own offer at €31.99+shipping; lowest competitor €28.50. Floor allows undercut (floor = list*0.985 approx). Expected: action=UNDERCUT, newPriceCents=2849.",
  "_expected": { "action": "UNDERCUT", "newPriceCents": 2849 },
  "products": [{
    "product_references": [{ "reference_type": "EAN", "reference": "8809606851663" }],
    "offers": [
      { "shop_name": "Competitor A",  "active": true,  "total_price": 28.50, "shop_id": null },
      { "shop_name": "Competitor B",  "active": true,  "total_price": 32.00, "shop_id": null },
      { "shop_name": "Easy - Store",  "active": true,  "total_price": 31.99, "shop_id": null },
      { "shop_name": "Strawberrynet", "active": true,  "total_price": 0,     "shop_id": null }
    ]
  }]
}
```

### Fixture 2: `p11-tier1-floor-bound-hold.json`
- Scenario: We're at position 2; floor is ABOVE target undercut price; candidate = floor = competitor_lowest → HOLD
- Competitors at €21.00; our list_price high, floor = €22.00 (above competitor at €21.00)
- Expected: `action=HOLD`, event=`hold-floor-bound`

### Fixture 3: `p11-tier1-tie-with-competitor-hold.json`
- Scenario: target undercut = competitor_lowest - 1 cent = our floor (candidate === competitor_lowest after MAX)
- The `candidateCents === competitorLowestCents` tie case → HOLD per pre-locked decision
- Expected: `action=HOLD`, event=`hold-floor-bound`

### Fixture 4: `p11-tier2b-ceiling-raise-headroom.json`
- Scenario: We're at position 1 (cheapest); 2nd place competitor is higher than current_price+edge_step; ceiling allows raise
- Competitor 2nd at €35.00; current_price €28.49; ceiling at €30.00; target_ceiling = 3500-1 = 3499, new_ceiling = min(3499, 3000) = 3000 > 2849
- Expected: `action=CEILING_RAISE`, `newPriceCents=3000`

### Fixture 5: `p11-all-competitors-below-floor.json`
- Scenario: All competitors below our floor; we're at position 2; target_undercut below floor; candidate=floor; candidate >= competitor_lowest → HOLD
- Expected: `action=HOLD`, event=`hold-floor-bound`

### Fixture 6: `p11-all-competitors-above-ceiling.json`
- Scenario: All competitors above our ceiling; we're at position 1; ceiling raise candidate within ceiling but competitor_2nd - edge_step > ceiling → cap at ceiling → still > current_price → CEILING_RAISE or HOLD
- Expected: `action=CEILING_RAISE` (capped at ceiling) or `HOLD` (if ceiling <= current_price) — fixture should be designed such that a small raise is possible

### Fixture 7: `p11-self-active-in-p11.json`
- Scenario: Own offer appears in P11 as active; self-filter removes it; ranking proceeds correctly with competitor data
- Our offer at €28.49 active; competitor at €29.50; after self-filter we're NOT in the ranked list; position = 2 (not in filtered list); UNDERCUT or HOLD depending on floor
- Expected: `action=UNDERCUT` (own offer correctly filtered, competitor ranking used)

### Fixture 8: `p11-self-marked-inactive-but-returned.json`
- Scenario: Our offer returned with `active=false`; AD14 `active===true` filter catches it; self-filter also catches it
- Expected: own offer filtered by active===true check BEFORE shop_name check; result same as self-active scenario

### Fixture 9: `p11-single-competitor-is-self.json`
- Scenario: Only one offer in P11 response, and it's our own shop; after self-filter, filteredOffers.length===0 → Tier 3 path
- Expected: `action=HOLD`, reason=`no-competitors`, event=`tier-transition` Rotina

### Fixture 10: `p11-zero-price-placeholder-mixed-in.json`
- Scenario: Strawberrynet-style placeholder with `total_price=0` mixed in; AD14 `total_price>0` filter removes it; remaining competitors valid
- Expected: `action=UNDERCUT` or `HOLD` based on position without the zero-price offer

### Fixture 11: `p11-shop-name-collision.json`
- Scenario: Two offers in P11 response have `shop_name === 'Easy - Store'`; AD13 collision detection fires
- Expected: `action=SKIP`, event=`shop-name-collision-detected` Atenção

### Fixture 12: `p11-pri01-pending-skip.json`
- Scenario: `skuChannel.pending_import_id` is set (non-null); precondition #4 fails
- Expected: `action=SKIP`, reason=`pending-import`, no audit event emitted

---

## Acceptance Criteria

### AC1 — `decideForSkuChannel` signature and AD8 6-step flow

**Given** `decideForSkuChannel({ skuChannel, customerMarketplace, ownShopName, p11RawOffers, tx })` exported from `worker/src/engine/decide.js`
**When** the orchestrator (cycle-assembly) calls it
**Then** it implements AD8's 6 steps in order:

**Preconditions** (any false → return `{ action: 'SKIP', newPriceCents: null, auditEvents: [], reason: '<which>' }`):
- `customerMarketplace.cron_state === 'ACTIVE'`
- `skuChannel.frozen_for_anomaly_review === false`
- `skuChannel.frozen_for_pri01_persistent === false`
- `skuChannel.pending_import_id === null`
- `skuChannel.excluded_at === null`

**STEP 1**: `filterCompetitorOffers(p11RawOffers, ownShopName)` from `shared/mirakl/self-filter.js`; if `collisionDetected` → return `{ action: 'SKIP', newPriceCents: null, auditEvents: [EVENT_TYPES.SHOP_NAME_COLLISION_DETECTED], reason: 'collision' }`; if `filteredOffers.length === 0` → return `{ action: 'HOLD', newPriceCents: null, auditEvents: [EVENT_TYPES.TIER_TRANSITION], reason: 'no-competitors' }`

**STEP 2**: stub call to cooperative-absorb (dynamic import with try/catch fallback); if result.skipped or result.frozen → return SKIP (no audit events from decide.js — absorb module emits its own events)

**STEP 3**: `floorPriceCents = roundFloorCents(list_price_cents * (1 - max_discount_pct))` and `ceilingPriceCents = roundCeilingCents(list_price_cents * (1 + max_increase_pct))` via `shared/money/index.js`

**STEP 4**: CASE A (position > 1): `targetUndercut = competitorLowest - edge_step_cents`; `candidate = Math.max(targetUndercut, floor)`; if `candidate < competitorLowest` → UNDERCUT + `undercut-decision` Rotina; else → HOLD + `hold-floor-bound` Rotina. CASE B (position == 1): if no competitor 2nd → HOLD + `hold-already-in-1st`; else `targetCeiling = competitor2nd - edge_step_cents`; `newCeiling = Math.min(targetCeiling, ceiling)`; if `newCeiling > current_price_cents` → CEILING_RAISE + `ceiling-raise-decision` Rotina; else → HOLD + `hold-already-in-1st` Rotina

**STEP 5**: stub call to per-SKU circuit-breaker (dynamic import with try/catch fallback); if tripped → HOLD + `circuit-breaker-per-sku-trip` (emitted by CB stub when it ships)

**STEP 6**: return `{ action, newPriceCents, auditEventType, reason }` — caller (cycle-assembly) handles staging write for UNDERCUT/CEILING_RAISE

### AC2 — Filter chain is mandatory and post-filter only

**Given** the filter chain is mandatory
**When** the engine runs against any P11 response
**Then** EVERY ranking computation uses `filteredOffers` ONLY (no code reads `p11RawOffers` directly after the self-filter call)
**And** the filter chain order is exactly: `active === true` → `total_price > 0 && isFinite` → `shop_name !== ownShopName` → `sort ascending by total_price`

A grep of decide.js for `p11RawOffers` after the `filterCompetitorOffers` call line must return zero matches (only the call site itself uses it).

### AC3 — Tie handling (pre-locked decision)

**Given** tie-handling per Pedro's pre-locked decision
**When** in CASE A `candidateCents === competitorLowestCents` (MAX pushes candidate up to floor which equals competitor price)
**Then** `action = HOLD` with `hold-floor-bound` Rotina event (NOT an undercut — pushing into the tie is a coin-flip with margin sacrifice)

### AC4 — All 12 Story-7.2 fixtures pass

**Given** the 12 fixtures in `tests/fixtures/p11/` listed above
**When** I run `tests/worker/engine/decide.test.js`
**Then** for each fixture, the test:
1. Constructs `skuChannel` + `customerMarketplace` mocks matching the fixture's scenario
2. Calls `decideForSkuChannel({ skuChannel, customerMarketplace, ownShopName: 'Easy - Store', p11RawOffers: fixture.products[0].offers, tx: mockTx })`
3. Asserts the expected action and audit event type per the `_expected` annotation in each fixture

Expected per fixture:
- `p11-tier1-undercut-succeeds.json` → `action='UNDERCUT'`, `newPriceCents = competitorLowestCents - 1`, `auditEvents` includes `'undercut-decision'`
- `p11-tier1-floor-bound-hold.json` → `action='HOLD'`, `auditEvents` includes `'hold-floor-bound'`
- `p11-tier1-tie-with-competitor-hold.json` → `action='HOLD'`, `auditEvents` includes `'hold-floor-bound'`
- `p11-tier2b-ceiling-raise-headroom.json` → `action='CEILING_RAISE'`, `auditEvents` includes `'ceiling-raise-decision'`
- `p11-all-competitors-below-floor.json` → `action='HOLD'`, `auditEvents` includes `'hold-floor-bound'`
- `p11-all-competitors-above-ceiling.json` → `action='CEILING_RAISE'` or `'HOLD'` within ceiling
- `p11-self-active-in-p11.json` → own offer filtered; `action='UNDERCUT'` (competitor ranking used correctly)
- `p11-self-marked-inactive-but-returned.json` → active filter catches inactive own offer; ranking proceeds without own offer
- `p11-single-competitor-is-self.json` → `filteredOffers.length===0`; `action='HOLD'`, `auditEvents` includes `'tier-transition'`
- `p11-zero-price-placeholder-mixed-in.json` → zero-price filtered; remaining competitor used for ranking
- `p11-shop-name-collision.json` → `action='SKIP'`, `auditEvents` includes `'shop-name-collision-detected'`
- `p11-pri01-pending-skip.json` → precondition fails; `action='SKIP'`, `auditEvents: []` (no audit event)

### AC5 — Negative-assertion: no raw P11 reads, no float math, no raw cron_state updates

**Given** the negative-assertion check per Architectural Constraints
**When** I grep `worker/src/engine/decide.js`
**Then:**
- Zero matches for `p11RawOffers` used after the `filterCompetitorOffers(p11RawOffers, ...)` call line (only the call site passes raw offers to the filter)
- Zero matches for `.toFixed(2)`, `parseFloat(`, `* 100`, `/ 100` on price-like identifiers (ESLint `no-float-price` would catch these; belt-and-suspenders grep confirms)
- Zero matches for `UPDATE customer_marketplaces SET cron_state` (raw state update forbidden — use `transitionCronState`)
- Zero matches for `INSERT INTO audit_log` (raw audit insert forbidden — use `writeAuditEvent`)
- Zero matches for `console.log` (pino only)

### AC6 — cycle-assembly updated to use real engine with full context

**Given** `cycle-assembly.js` is updated (this story's obligation — see File-Touch List)
**When** the updated `assembleCycle` runs with a real customer's SKU-channel batch
**Then** for each dispatcher row, it:
1. Loads the full `sku_channels` row from DB
2. Loads the `customer_marketplace` row
3. Fetches P11 offers via `getProductOffersByEan` for `(sku.ean, skuChannel.channel_code)`
4. Calls `decideForSkuChannel({ skuChannel, customerMarketplace, ownShopName: customerMarketplace.shop_name, p11RawOffers, tx })`
5. Iterates `result.auditEvents` and calls `writeAuditEvent` for each event type

**And** the existing `tests/worker/cycle-assembly.test.js` passes after the update
**And** `node --check worker/src/cycle-assembly.js` passes (import path validation)

---

## Implementation Notes

### Module structure for `worker/src/engine/decide.js`

```js
// worker/src/engine/decide.js
// AD8 — Full engine decision table: per-(SKU, channel) repricing decision.
// Architecture: AD8 (decision table), AD13 (collision detection), AD14 (filter chain),
//               AD7 (pending_import_id precondition), AD9 (coop-absorb STEP 2 stub), AD11 (CB STEP 5 stub).
//
// SINGLE SOURCE OF TRUTH for per-(SKU, channel) decisions.
// Never bypass: engine→decide.js→filterCompetitorOffers→roundFloorCents/roundCeilingCents.
// No raw P11 offer reads after self-filter call.
// No float-price math (no-float-price ESLint rule enforced).

import { filterCompetitorOffers } from '../../../shared/mirakl/self-filter.js';
import { roundFloorCents, roundCeilingCents, toCents } from '../../../shared/money/index.js';
import { EVENT_TYPES } from '../../../shared/audit/event-types.js';
import { createWorkerLogger } from '../../../shared/logger.js';

// NOTE: decide.js does NOT import writeAuditEvent.
// Audit events are returned in the auditEvents[] array and emitted by the caller (cycle-assembly.js).

const logger = createWorkerLogger();

/**
 * @typedef {Object} DecisionResult
 * @property {'UNDERCUT'|'CEILING_RAISE'|'HOLD'|'SKIP'} action
 * @property {number|null} newPriceCents - null for HOLD/SKIP
 * @property {string[]} auditEvents - array of EVENT_TYPES slugs; empty for SKIP-without-audit
 * @property {string} reason - short diagnostic string for pino logging
 */

/**
 * Apply the AD8 full decision table for a single (SKU, channel) pair.
 *
 * @param {object} params
 * @param {object} params.skuChannel - sku_channels row
 * @param {object} params.customerMarketplace - customer_marketplaces row
 * @param {string} params.ownShopName - customer_marketplace.shop_name from A01
 * @param {object[]} params.p11RawOffers - raw offer list from P11 for this (EAN, channel)
 * @param {object} params.tx - transaction-capable DB client
 * @returns {Promise<DecisionResult>}
 */
export async function decideForSkuChannel ({ skuChannel, customerMarketplace, ownShopName, p11RawOffers, tx }) {
  // PRECONDITIONS
  // ...

  // STEP 1 — filter chain + collision check
  // ...

  // STEP 2 — cooperative-absorption stub
  // ...

  // STEP 3 — floor / ceiling math
  // ...

  // STEP 4 — position branching
  // ...

  // STEP 5 — per-SKU circuit-breaker stub
  // ...

  // STEP 6 — return decision (caller handles staging write)
  // ...
}
```

### Import path conventions

From `worker/src/engine/decide.js`, the relative paths are:
- `shared/mirakl/self-filter.js` → `'../../../shared/mirakl/self-filter.js'`
- `shared/money/index.js` → `'../../../shared/money/index.js'`
- `shared/audit/writer.js` → `'../../../shared/audit/writer.js'`
- `shared/logger.js` → `'../../../shared/logger.js'`
- `worker/src/safety/circuit-breaker.js` (stub) → `'../safety/circuit-breaker.js'`
- `worker/src/engine/cooperative-absorb.js` (stub) → `'./cooperative-absorb.js'`

### `toCents` boundary conversion

P11 returns prices as JSON floats (e.g., `28.50`). Convert at the boundary:
```js
const competitorLowestCents = toCents(filteredOffers[0].total_price); // 2850
```
Do NOT multiply raw floats by 100 directly — use `toCents` from `shared/money/index.js` (which handles rounding edge cases).

### Dynamic import stubs pattern

```js
// STEP 2 cooperative-absorb stub (replaced when Story 7.3 ships)
let absorb = { absorbed: false, frozen: false, skipped: false };
try {
  const mod = await import('./cooperative-absorb.js');
  absorb = await mod.absorbExternalChange({ tx, skuChannel, customerMarketplace });
} catch {
  // Story 7.3 not yet available — continue with pass-through defaults
  logger.debug({ skuChannelId: skuChannel.id }, 'engine: cooperative-absorb stub (7.3 not shipped)');
}
if (absorb.skipped || absorb.frozen) {
  return { action: 'SKIP', newPriceCents: null, auditEventType: null, reason: 'cooperative-absorb-skip' };
}
```

### CRITICAL: cycle-assembly.js must be updated (file-touch obligation)

The existing `cycle-assembly.js` stub (Story 5.2) calls `engine.decideForSkuChannel(skuChannel, { customerMarketplaceId, cycleId })` with a **minimal row** from the dispatcher SELECT and a 2-argument positional call. The real `decideForSkuChannel` requires the full named-param shape: `{ skuChannel, customerMarketplace, ownShopName, p11RawOffers, tx }`.

**This story MUST update `worker/src/cycle-assembly.js`** to:
1. Fetch the full `sku_channels` row for each dispatcher row (the dispatcher SELECT only returns `cm.id, sc.id, sc.sku_id, sc.channel_code`)
2. Load the `customer_marketplace` row (including `shop_name`, `edge_step_cents`, `max_discount_pct`, `max_increase_pct`, `cron_state`)
3. Call `getProductOffersByEan(baseUrl, apiKey, { ean: sku.ean, channel: skuChannel.channel_code, pricingChannelCode: skuChannel.channel_code })` to fetch P11 offers — see `shared/mirakl/p11.js` for the API
4. Call `decideForSkuChannel({ skuChannel, customerMarketplace, ownShopName: customerMarketplace.shop_name, p11RawOffers, tx })` with the full named-param shape
5. The returned `{ action, newPriceCents, auditEvents }` is consumed as before by cycle-assembly's staging write + audit event emission loop

**`cycle-assembly.js` is in the File-Touch List as a modified file.** The `assembleCycle` function signature stays the same; the internals are updated to load full context before calling the engine.

**Note about P11 calls in cycle-assembly:** The `apiKey` (decrypted Mirakl API key) and `baseUrl` must be passed to `assembleCycle` (or loaded from the DB inside it). Check how the dispatcher currently passes these — if not yet plumbed, add them to `assembleCycle`'s opts parameter. The dispatcher already has access to the decrypted key from the worker context.

### Audit event emission

decide.js does NOT call `writeAuditEvent` directly — it returns `auditEvents: string[]`. cycle-assembly.js already handles the write at lines 94-106:

```js
for (const eventType of auditEvents) {
  await writeAuditEvent({
    tx,
    customerMarketplaceId,
    skuId: skuChannel.sku_id,
    skuChannelId: skuChannel.id,
    cycleId,
    eventType,
    payload: { action, newPriceCents },  // ← cycle-assembly passes simplified payload
  });
}
```

The payload above from cycle-assembly is a stub. With the real engine, the payload should match the `@typedef PayloadFor<EventType>` in `shared/audit/event-types.js`. Two options:
- Option A: decide.js returns `auditEvents` as `[{ eventType, payload }]` objects (richer, but changes cycle-assembly contract)
- Option B: cycle-assembly always passes `{ action, newPriceCents }` payload (current stub behavior, acceptable at this stage — Story 7.8 review can refine)

**Use Option B** to minimize blast radius on cycle-assembly. The audit events at this stage carry enough payload for the Story 7.8 integration gate. Story 9.x audit surface stories can refine payloads later.

**Payload shapes (for reference — cycle-assembly passes simplified payload):**
- `undercut-decision`: `{ competitorLowestCents, newPriceCents, floorPriceCents }` per `PayloadForUndercutDecision`
- `ceiling-raise-decision`: `{ competitor2ndCents, newPriceCents, ceilingPriceCents }` per `PayloadForCeilingRaiseDecision`
- `hold-floor-bound`: `{ ourPriceCents, floorPriceCents, competitorPriceCents }` per `PayloadForHoldFloorBound`
- `hold-already-in-1st`: `{ ourPriceCents }` per `PayloadForHoldAlreadyIn1st`
- `shop-name-collision-detected`: `{ skuId, collidingShopName, cycleId }` per `PayloadForShopNameCollisionDetected`
- `tier-transition`: `{ fromTier, reason: 'no-competitors' }` (freeform — TIER_TRANSITION has no dedicated typedef yet)

### Test structure for `tests/worker/engine/decide.test.js`

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideForSkuChannel } from '../../../worker/src/engine/decide.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../fixtures/p11');

function loadFixture (name) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));
}

// Mock skuChannel and customerMarketplace builders
function makeSkuChannel (overrides = {}) {
  return {
    id: 'sc-test-uuid',
    sku_id: 'sku-test-uuid',
    customer_marketplace_id: 'cm-test-uuid',
    channel_code: 'WRT_PT_ONLINE',
    list_price_cents: 3000,        // €30.00
    last_set_price_cents: 3199,    // €31.99
    current_price_cents: 3199,     // €31.99 — position 2 by default
    pending_set_price_cents: null,
    pending_import_id: null,       // no in-flight import
    tier: '1',
    tier_cadence_minutes: 15,
    last_won_at: null,
    last_checked_at: new Date().toISOString(),
    frozen_for_anomaly_review: false,
    frozen_for_pri01_persistent: false,
    frozen_at: null,
    frozen_deviation_pct: null,
    min_shipping_price_cents: 0,
    excluded_at: null,
    channel_active_for_offer: true,
    ...overrides,
  };
}

function makeMarketplace (overrides = {}) {
  return {
    id: 'cm-test-uuid',
    cron_state: 'ACTIVE',
    max_discount_pct: 0.05,        // 5% floor
    max_increase_pct: 0.10,        // 10% ceiling
    edge_step_cents: 1,            // €0.01
    anomaly_threshold_pct: null,   // use default 0.40
    offer_prices_decimals: 2,
    shop_name: 'Easy - Store',
    ...overrides,
  };
}

// Mock tx: captures writeAuditEvent calls
function makeMockTx () {
  const events = [];
  return {
    tx: { /* mock DB client */ },
    capturedEvents: events,
  };
}
```

### Testing the HOLD-on-tie case (AC3)

For `p11-tier1-tie-with-competitor-hold.json`, construct:
- `list_price_cents = 2850` (floor after 0% discount = 2850)
- `max_discount_pct = 0.0`  (no discount allowed → floor === list_price)
- competitorLowest in fixture = 2850 (€28.50)
- `edge_step_cents = 1`
- `targetUndercut = 2850 - 1 = 2849`; `candidate = Math.max(2849, 2850) = 2850`; `candidate === competitorLowest → HOLD`

This validates the tie-handling decision.

### ESLint — no-float-price pre-check

Before implementing, run ESLint on the new file:
```bash
node --experimental-vm-modules node_modules/.bin/eslint worker/src/engine/decide.js
```
Any `no-float-price` violation must be fixed before commit.

Also run `node --check worker/src/engine/decide.js` for syntax validation (catches import path errors without running tests — catches the "import path bug that survived code review" pattern noted in MEMORY.md).

---

## Out of Scope for This Story

- Cooperative-absorption logic → **Story 7.3** (STEP 2 stub replaced)
- Anomaly-freeze logic → **Story 7.4** (freezeSkuForReview called from Story 7.3)
- Tier-classification DB writes → **Story 7.5** (STEP 4 determines position; Story 7.5 writes tier columns)
- Per-SKU circuit-breaker logic → **Story 7.6** (STEP 5 stub replaced)
- Per-cycle 20% circuit-breaker → **Story 7.6** (dispatcher level, not engine level)
- Integration gate → **Story 7.8** (all 17 fixtures including Story 7.3–7.5 fixtures)
- Any DB migration — no schema changes in this story (all columns already exist from Stories 4.2 + 6.3)
- Direct PRI01 submission — Story 6.1 writer; decide.js returns decision, cycle-assembly handles staging

---

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Completion Notes List

(to be filled by dev agent)

### File List

(to be filled by dev agent)

### Change Log

- 2026-05-11: Story 7.2 spec created by Bob (bmad-create-story). Worktree forked from story-6.3-pri03-parser-per-sku-rebuild (Bundle C stacked dispatch). Endpoints verified against Mirakl MCP.
