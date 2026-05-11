# Story 7.3: `worker/src/engine/cooperative-absorb.js` — STEP 2 Absorption + Skip-on-Pending

> Endpoints verified against Mirakl MCP and architecture-distillate empirical facts (2026-05-11).

**Sprint-status key:** `7-3-worker-src-engine-cooperative-absorb-js-step-2-absorption-skip-on-pending`
**Status:** review
**Size:** M
**Epic:** 7 — Engine Decision & Safety
**Atomicity:** Bundle C (3/4) — AD9 cooperative-absorption half; gate at Story 7.8

---

## Narrative

**As a** BAD subagent implementing the MarketPilot cooperative-ERP-sync safety mechanism,
**I want** a `worker/src/engine/cooperative-absorb.js` module exporting `absorbExternalChange` that detects external price changes (ERP updates from Gabriel's system or other external sources), absorbs them as a new list_price baseline when within tolerance, or freezes the SKU for customer review when the deviation exceeds the threshold —
**So that** the engine's STEP 2 stub in `decide.js` activates automatically (dynamic import with ERR_MODULE_NOT_FOUND catch), the pending_import_id invariant is preserved (skip-on-pending when in-flight), and the `p11-cooperative-absorption-within-threshold.json` fixture passes.

---

## Trace

- **Architecture decisions:** AD9 (cooperative-ERP-sync detection + absorption + anomaly threshold), AD7 (pending_import_id atomicity — skip-on-pending predicate depends on this), AD8 STEP 2 (cooperative-absorption is the second step in the engine decision table)
- **Functional requirements:** FR22 (cooperative-ERP sync absorption), FR29 (anomaly freeze on >40% deviation)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md`, Story 7.3
- **Architecture decisions detail:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` — AD9 (full cooperative-absorption spec), AD8 STEP 2

---

## SSoT Module Introduced

**`worker/src/engine/cooperative-absorb.js`** — single source of truth for cooperative-ERP-sync detection. Exports:
- `absorbExternalChange({ tx, skuChannel, customerMarketplace })` — detects external change, absorbs within tolerance or freezes, returns `{ absorbed, frozen, skipped }`

**No new ESLint rule** ships with this story.

---

## Bundle C Context

This is the 3rd of 4 Bundle C stories (6.1 → 7.2 → 7.3 → 7.6 → gate at 7.8). The worktree forks from `story-7.2-engine-decide-ad8-flow` (bundle-stacked dispatch exception). Story 7.3 replaces the cooperative-absorb dynamic-import stub that was left in `decide.js` STEP 2 at line 118 (`await import('./cooperative-absorb.js')`). Once this module is committed to the worktree branch, `decide.js` will load it automatically on the next engine run — no changes to `decide.js` are needed.

**Critical: the stub in decide.js is already wired correctly.** The stub swallows only `ERR_MODULE_NOT_FOUND` errors:

```js
// From worker/src/engine/decide.js (Story 7.2, line 118-131)
try {
  const mod = await import('./cooperative-absorb.js');
  absorb = await mod.absorbExternalChange({ tx, skuChannel, customerMarketplace });
} catch (err) {
  if (err && err.code !== 'ERR_MODULE_NOT_FOUND') {
    throw err;
  }
  // module not shipped yet — pass through
}
if (absorb.skipped || absorb.frozen) {
  return { action: 'SKIP', newPriceCents: null, auditEvents: [], reason: 'cooperative-absorb-skip' };
}
```

When `cooperative-absorb.js` exists, real runtime errors (DB failures, etc.) WILL propagate. The stub was hardened in Story 7.2 Step 7 review (2026-05-11) — do NOT soften this behavior.

**After Story 7.3 ships:** The existing `decide.js` STEP 2 absorb-result handling remains intact:
- `absorb.skipped === true` → engine returns SKIP (pending_import_id was set)
- `absorb.frozen === true` → engine returns SKIP (anomaly-freeze fired)
- `absorb.absorbed === true` or `{absorbed: false, frozen: false, skipped: false}` → engine continues to STEP 3 with the (possibly updated) `skuChannel.list_price_cents`

**IMPORTANT: list_price update visibility in decide.js.** When absorption updates `sku_channel.list_price_cents` in the DB, decide.js's in-memory `skuChannel` object is NOT automatically updated. `absorbExternalChange` MUST mutate the `skuChannel` object passed in (or return the new list_price_cents) so that STEP 3's `roundFloorCents(skuChannel.list_price_cents * ...)` uses the absorbed price. The epics spec says "engine STEP 2 continues to STEP 3 with the new list_price" — implement this by mutating `skuChannel.list_price_cents = currentPriceCents` in the absorption branch before returning `{ absorbed: true, frozen: false }`.

---

## Dependencies (All Done / In-Review)

| Story | Status | What this story uses from it |
|-------|--------|------------------------------|
| 2.1 | done | `shared/db/tx.js` transaction helper; `shared/db/service-role-client.js` |
| 4.2 | done | `sku_channels` schema: `current_price_cents`, `last_set_price_cents`, `list_price_cents`, `pending_import_id`, `frozen_for_anomaly_review` columns |
| 7.2 | review | `worker/src/engine/decide.js` — STEP 2 stub calls `absorbExternalChange` via dynamic import; this story activates that stub |
| 9.0 | done | `shared/audit/writer.js` (`writeAuditEvent`); `shared/audit/event-types.js` (`EVENT_TYPES.EXTERNAL_CHANGE_ABSORBED`, `EVENT_TYPES.ANOMALY_FREEZE`) |
| 9.1 | done | Audit log priority trigger: `EXTERNAL_CHANGE_ABSORBED` → `notavel`, `ANOMALY_FREEZE` → `atencao` |

**Enables (blocked on this story):**
- Story 7.4 (`anomaly-freeze.js`) — anomaly-freeze shares deviation-detection logic; cooperative-absorb calls `freezeSkuForReview` when threshold exceeded. Story 7.4 ships `freezeSkuForReview`; Story 7.3 must stub it identically to the Story 7.2 pattern (dynamic import with ERR_MODULE_NOT_FOUND catch) OR call it via a dependency-inversion pattern (inject `freezeSkuForReview` as a param).
- Story 7.8 integration gate — exercises `p11-cooperative-absorption-within-threshold.json` and `p11-cooperative-absorption-anomaly-freeze.json` fixtures

---

## Story 7.2 Learnings (Directly Applicable)

1. **ERR_MODULE_NOT_FOUND stub pattern:** Story 7.2's `decide.js` uses `catch (err) { if (err && err.code !== 'ERR_MODULE_NOT_FOUND') throw err; }`. Use the same pattern for `freezeSkuForReview` stub call when Story 7.4 is not yet shipped. Do NOT use a bare `catch {}` — real runtime errors must propagate.

2. **Dynamic import with stub**: The story 7.3 module must call `freezeSkuForReview` from `worker/src/safety/anomaly-freeze.js` (Story 7.4). Until Story 7.4 ships, cooperative-absorb must gracefully stub that call. Recommended: inject `freezeSkuForReview` as an optional parameter to `absorbExternalChange`, defaulting to a dynamic-import-with-ERR_MODULE_NOT_FOUND-catch stub. This allows unit tests to inject a mock directly without dynamic import complexity.

3. **No direct audit INSERT:** Use `writeAuditEvent` from `shared/audit/writer.js`. Never use raw INSERT. The `no-raw-INSERT-audit-log` ESLint rule enforces this.

4. **Import path from `worker/src/engine/`:** From `worker/src/engine/cooperative-absorb.js`:
   - `shared/audit/writer.js` → `'../../../shared/audit/writer.js'`
   - `shared/audit/event-types.js` → `'../../../shared/audit/event-types.js'`
   - `shared/logger.js` → `'../../../shared/logger.js'`
   - `worker/src/safety/anomaly-freeze.js` (dynamic stub) → `'../safety/anomaly-freeze.js'`

5. **No console.log:** pino logger only (`createWorkerLogger` from `shared/logger.js`).

6. **Named exports only:** No `default export` (ESLint enforces; `no-default-export` rule).

7. **Integer-cents discipline:** `deviation_pct` computation uses raw integer cents. `list_price_cents` and `current_price_cents` are integers. The deviation formula: `Math.abs((currentPriceCents - listPriceCents) / listPriceCents)` — both numerator and denominator are integers, producing a float deviation ratio. This is NOT float-price math (it's a ratio, not a price). The `no-float-price` rule only fires on price-shaped assignments (identifier names containing `price`, `floor`, `ceiling`, `cost`, `margin`). `deviation_pct` is not a price identifier.

8. **Mutation of skuChannel:** `absorbExternalChange` must mutate `skuChannel.list_price_cents` in the absorption branch (in-place object mutation) so that `decide.js` STEP 3 reads the updated value. This is safe because `skuChannel` is a local object constructed per-cycle by `cycle-assembly.js`.

---

## AD9 Spec (Complete for Implementation)

### Cooperative-absorption trigger condition

Absorption fires when:
1. `skuChannel.pending_import_id === null` (no in-flight PRI01 import)
2. `skuChannel.current_price_cents !== skuChannel.last_set_price_cents` (external change detected)

If condition 1 fails (pending_import_id IS NOT NULL): return `{ absorbed: false, frozen: false, skipped: true }` — current_price is in flux; not a stable signal for absorption.

If condition 2 fails (current_price equals last_set_price): return `{ absorbed: false, frozen: false }` — no external change; no-op.

### Deviation computation

```js
// Both are integer cents; division produces float deviation ratio (not a price)
const deviationPct = Math.abs((currentPriceCents - listPriceCents) / listPriceCents);
```

**Threshold:** `customerMarketplace.anomaly_threshold_pct ?? 0.40` — null reads default 0.40.

### Below-threshold branch (absorption)

When `deviationPct <= threshold`:

1. UPDATE `sku_channels SET list_price_cents = currentPriceCents WHERE id = skuChannel.id` within `tx`
2. Mutate `skuChannel.list_price_cents = currentPriceCents` (in-memory update so STEP 3 sees new baseline)
3. Call `writeAuditEvent({ tx, customerMarketplaceId, skuId, skuChannelId, eventType: EVENT_TYPES.EXTERNAL_CHANGE_ABSORBED, payload: { previousListPriceCents, newListPriceCents: currentPriceCents, deviationPct } })`
4. Return `{ absorbed: true, frozen: false }`

**Note:** `writeAuditEvent` does NOT need `cycleId` in cooperative-absorb context — the module operates within the cycle-assembly transaction but does not have access to `cycleId`. Omit `cycleId` from the `writeAuditEvent` call or pass `cycleId: null` if the signature requires it.

### Above-threshold branch (anomaly freeze)

When `deviationPct > threshold`:

1. Call `freezeSkuForReview({ tx, skuChannelId, customerMarketplaceId, deviationPct, currentPriceCents, listPriceCents })` from `worker/src/safety/anomaly-freeze.js` (Story 7.4)
2. Return `{ absorbed: false, frozen: true }`

**`freezeSkuForReview` stub (until Story 7.4 ships):**

```js
// Default stub — Story 7.4 not yet shipped
let freezeSkuForReview = async () => {
  logger.debug({ skuChannelId: skuChannel.id }, 'cooperative-absorb: anomaly-freeze stub (7.4 not shipped)');
};
try {
  const freezeMod = await import('../safety/anomaly-freeze.js');
  freezeSkuForReview = freezeMod.freezeSkuForReview;
} catch (err) {
  if (err && err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
}
```

**Preferred pattern (dependency injection for testability):**

```js
export async function absorbExternalChange ({ tx, skuChannel, customerMarketplace, freezeFn = null }) {
  // ...
  // Use injected freezeFn if provided (for unit tests), else dynamic import stub
  const doFreeze = freezeFn ?? await loadFreezeFn();
  // ...
}
```

This allows unit tests to inject `freezeFn: mockFreeze` without dealing with dynamic import mocking. The Story 7.8 integration gate uses the real `freezeSkuForReview` loaded via dynamic import. Both approaches are acceptable — pick whichever produces cleaner test code.

---

## P11 Fixture

### `p11-cooperative-absorption-within-threshold.json`

This fixture does NOT contain P11 offer data — cooperative absorption is triggered by comparing `current_price_cents` to `last_set_price_cents` on the `skuChannel` object, BEFORE P11 is consulted. The fixture is used in the Story 7.8 integration test to seed a `skuChannel` row with an external-change precondition.

The fixture shape matches the other P11 fixtures (for use in the Story 7.8 full-cycle test):

```json
{
  "_note": "Cooperative absorption scenario: current_price drifted from last_set_price by 15% (within 40% threshold). Engine STEP 2 should absorb the change, update list_price, emit external-change-absorbed Notável event, then continue to STEP 3 with updated list_price as the new anchor.",
  "_expected": {
    "absorbed": true,
    "frozen": false,
    "auditEvent": "external-change-absorbed",
    "priority": "notavel"
  },
  "_preconditions": {
    "skuChannel": {
      "list_price_cents": 3000,
      "last_set_price_cents": 3000,
      "current_price_cents": 3450,
      "pending_import_id": null,
      "frozen_for_anomaly_review": false,
      "tier": "1"
    }
  },
  "products": [{
    "product_references": [{ "reference_type": "EAN", "reference": "8809606851663" }],
    "offers": [
      { "shop_name": "Competitor A", "active": true, "total_price": 35.00, "shop_id": null },
      { "shop_name": "Easy - Store",  "active": true, "total_price": 34.50, "shop_id": null }
    ]
  }]
}
```

Deviation: `|3450 - 3000| / 3000 = 0.15` (15% — within 40% threshold). After absorption, `list_price_cents` becomes 3450. Engine continues to STEP 3 with `list_price_cents = 3450`.

---

## File-Touch List

### New files

| File | Purpose |
|------|---------|
| `worker/src/engine/cooperative-absorb.js` | SSoT absorption module: `absorbExternalChange` — AD9 implementation |
| `tests/worker/engine/cooperative-absorb.test.js` | Unit tests: 5 scenarios per AC5 (change detection, absorption, skip-on-pending, no-op, threshold-exceeded mock) |
| `tests/fixtures/p11/p11-cooperative-absorption-within-threshold.json` | P11 fixture for Story 7.3 + Story 7.8 integration gate |

### No modified files

`worker/src/engine/decide.js` — STEP 2 stub already wired correctly; activates automatically when `cooperative-absorb.js` exists. No changes needed.

`worker/src/cycle-assembly.js` — no changes. cycle-assembly calls `decide.js`; cooperative-absorb is called from within decide.js.

**Note on `worker/src/engine/.gitkeep`:** If `.gitkeep` still exists, delete it when creating `cooperative-absorb.js` — a directory with real files doesn't need the placeholder.

---

## Acceptance Criteria

### AC1 — Absorption when within threshold

**Given** `absorbExternalChange({ tx, skuChannel, customerMarketplace })` is called from engine STEP 2
**When** `skuChannel.current_price_cents !== skuChannel.last_set_price_cents` AND `skuChannel.pending_import_id === null`
**Then** the function detects the external change
**And** computes `deviationPct = Math.abs((currentPriceCents - listPriceCents) / listPriceCents)`
**And** when `deviationPct <= threshold` (where threshold = `customerMarketplace.anomaly_threshold_pct ?? 0.40`):
  - Performs `UPDATE sku_channels SET list_price_cents = currentPriceCents WHERE id = skuChannel.id` within `tx`
  - Mutates `skuChannel.list_price_cents = currentPriceCents` so STEP 3 sees the new baseline
  - Calls `writeAuditEvent` with `event_type = 'external-change-absorbed'` (Notável) with payload `{ previousListPriceCents, newListPriceCents, deviationPct }`
  - Returns `{ absorbed: true, frozen: false }`
**And** the fixture `p11-cooperative-absorption-within-threshold.json` (deviation=15%, threshold=40%) produces `absorbed=true`, Notável audit event, and `skuChannel.list_price_cents` updated to `current_price_cents`

### AC2 — Skip-on-pending (Bundle C invariant)

**Given** the skip-on-pending semantic (Bundle C AD7 atomicity)
**When** `skuChannel.pending_import_id IS NOT NULL`
**Then** absorption is SKIPPED entirely — current_price is in flux (PRI01 batch in-flight); it's not a stable signal
**And** the function returns `{ absorbed: false, frozen: false, skipped: true }` immediately (no DB writes, no audit event)
**And** `decide.js` STEP 2 sees `absorb.skipped === true` and returns `{ action: 'SKIP', reason: 'cooperative-absorb-skip' }` to cycle-assembly

### AC3 — No-op when current_price equals last_set_price

**Given** `skuChannel.current_price_cents === skuChannel.last_set_price_cents`
**When** `absorbExternalChange` is called
**Then** no external change is detected
**And** the function returns `{ absorbed: false, frozen: false }` immediately (no DB writes, no audit event)
**And** engine STEP 2 sees neither `skipped` nor `frozen` and continues to STEP 3 normally

### AC4 — Fixture test: Notável priority confirmed

**Given** fixture `p11-cooperative-absorption-within-threshold.json` loaded with `_preconditions.skuChannel`
**When** the unit test runs `absorbExternalChange` with a mock tx that captures `writeAuditEvent` calls
**Then** the test asserts:
  1. deviation < 0.40 → function returns `{ absorbed: true, frozen: false }`
  2. `writeAuditEvent` was called exactly once with `eventType: 'external-change-absorbed'`
  3. The payload includes `{ previousListPriceCents: 3000, newListPriceCents: 3450, deviationPct: 0.15 }`
  4. `skuChannel.list_price_cents` equals 3450 after the call (in-memory mutation confirmed)

**Note on `priority` column assertion:** The audit log `priority` column is set by the Story 9.1 DB trigger, not by `cooperative-absorb.js` itself. Unit tests mock `writeAuditEvent` and cannot assert the DB trigger behavior. The Story 7.8 integration test (which uses a real DB) asserts `priority = 'notavel'`. The unit test asserts the correct `eventType` slug — the trigger does the rest.

### AC5 — Unit tests: all scenarios covered

**Given** unit tests in `tests/worker/engine/cooperative-absorb.test.js`
**When** I run them with `node --test tests/worker/engine/cooperative-absorb.test.js`
**Then** they cover all 5 scenarios:

| Test name | Scenario |
|-----------|----------|
| `absorb_detects_external_change_when_current_differs_from_last_set` | change detection precondition |
| `absorb_computes_deviation_pct_against_list_price` | deviation math: `|3450-3000|/3000 = 0.15` |
| `absorb_updates_list_price_to_current_when_within_threshold` | list_price UPDATE + skuChannel mutation |
| `absorb_emits_external_change_absorbed_notavel_event` | `writeAuditEvent` call with correct eventType |
| `absorb_calls_freeze_when_deviation_exceeds_threshold` | threshold exceeded: mock freeze is called with correct params |
| `absorb_skips_entirely_when_pending_import_id_not_null` | AC2 skip-on-pending |
| `absorb_returns_no_op_when_current_equals_last_set` | AC3 no-op |

**And** all tests pass without requiring a real DB (tx is mocked)
**And** `node --check worker/src/engine/cooperative-absorb.js` passes (import path syntax validation)

---

## Implementation Notes

### Module structure for `worker/src/engine/cooperative-absorb.js`

```js
// worker/src/engine/cooperative-absorb.js
// AD9 — Cooperative-ERP-sync detection and absorption.
// Called from worker/src/engine/decide.js STEP 2 (dynamic import stub).
//
// Detects when current_price_cents !== last_set_price_cents (ERP/external system
// updated the price on the Mirakl side without going through our PRI01 pipeline).
//
// Within tolerance (deviationPct <= threshold):
//   → absorb: update list_price to current as new baseline; emit Notável event.
// Above tolerance (deviationPct > threshold):
//   → freeze: set frozen_for_anomaly_review=true; emit Atenção event; Resend alert.
// In-flight import (pending_import_id IS NOT NULL):
//   → skip: current_price is in flux; not a stable signal.

import { writeAuditEvent } from '../../../shared/audit/writer.js';
import { EVENT_TYPES } from '../../../shared/audit/event-types.js';
import { createWorkerLogger } from '../../../shared/logger.js';

const logger = createWorkerLogger();

// Default 40% anomaly threshold (per architecture pre-locked decision).
const DEFAULT_ANOMALY_THRESHOLD_PCT = 0.40;

/**
 * @typedef {Object} AbsorbResult
 * @property {boolean} absorbed - true when external change was absorbed as new baseline
 * @property {boolean} frozen - true when deviation exceeded threshold and SKU was frozen
 * @property {boolean} [skipped] - true when pending_import_id was set (in-flight — skip signal)
 */

/**
 * Detect and handle an external price change (cooperative-ERP-sync, AD9).
 * Called from worker/src/engine/decide.js STEP 2.
 *
 * IMPORTANT: Mutates skuChannel.list_price_cents on absorption so that
 * decide.js STEP 3 computes floor/ceiling from the absorbed (new) list price.
 *
 * @param {object} params
 * @param {object} params.tx - transaction-capable DB client
 * @param {object} params.skuChannel - sku_channels row (MUTATED on absorption: list_price_cents updated)
 * @param {object} params.customerMarketplace - customer_marketplaces row
 * @param {Function|null} [params.freezeFn] - optional injected freeze function (for unit tests)
 * @returns {Promise<AbsorbResult>}
 */
export async function absorbExternalChange ({ tx, skuChannel, customerMarketplace, freezeFn = null }) {
  const { id: skuChannelId, sku_id: skuId, customer_marketplace_id: customerMarketplaceId } = skuChannel;

  // ------------------------------------------------------------------
  // SKIP-ON-PENDING: in-flight PRI01 import means current_price is
  // not a stable signal — absorption must wait for PRI02 to settle.
  // ------------------------------------------------------------------
  if (skuChannel.pending_import_id !== null && skuChannel.pending_import_id !== undefined) {
    logger.debug({ skuChannelId }, 'cooperative-absorb: SKIP — pending_import_id set');
    return { absorbed: false, frozen: false, skipped: true };
  }

  // ------------------------------------------------------------------
  // NO-OP: price hasn't moved — no external change detected.
  // ------------------------------------------------------------------
  if (skuChannel.current_price_cents === skuChannel.last_set_price_cents) {
    logger.debug({ skuChannelId }, 'cooperative-absorb: no-op — current_price equals last_set_price');
    return { absorbed: false, frozen: false };
  }

  // ------------------------------------------------------------------
  // DEVIATION COMPUTATION
  // ------------------------------------------------------------------
  const currentPriceCents = skuChannel.current_price_cents;
  const listPriceCents = skuChannel.list_price_cents;
  const previousListPriceCents = listPriceCents;

  // Ratio computation — not a price value; no-float-price rule does not apply.
  const deviationPct = Math.abs((currentPriceCents - listPriceCents) / listPriceCents);
  const threshold = customerMarketplace.anomaly_threshold_pct ?? DEFAULT_ANOMALY_THRESHOLD_PCT;

  logger.debug({ skuChannelId, deviationPct, threshold }, 'cooperative-absorb: external change detected');

  // ------------------------------------------------------------------
  // ABOVE THRESHOLD — anomaly freeze (calls Story 7.4 via stub/injection)
  // ------------------------------------------------------------------
  if (deviationPct > threshold) {
    logger.warn({ skuChannelId, deviationPct, threshold }, 'cooperative-absorb: deviation exceeds threshold — freezing');

    // Resolve freezeSkuForReview: use injected fn or dynamic import with stub
    const doFreeze = freezeFn ?? await (async () => {
      let fn = async () => {
        logger.debug({ skuChannelId }, 'cooperative-absorb: anomaly-freeze stub (7.4 not shipped)');
      };
      try {
        const mod = await import('../safety/anomaly-freeze.js');
        fn = mod.freezeSkuForReview;
      } catch (err) {
        if (err && err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
      }
      return fn;
    })();

    await doFreeze({ tx, skuChannelId, customerMarketplaceId, deviationPct, currentPriceCents, listPriceCents });
    return { absorbed: false, frozen: true };
  }

  // ------------------------------------------------------------------
  // WITHIN THRESHOLD — absorb as new list_price baseline
  // ------------------------------------------------------------------
  await tx.query(
    'UPDATE sku_channels SET list_price_cents = $1 WHERE id = $2',
    [currentPriceCents, skuChannelId],
  );

  // Mutate in-memory object so decide.js STEP 3 reads the new baseline.
  skuChannel.list_price_cents = currentPriceCents;

  await writeAuditEvent({
    tx,
    customerMarketplaceId,
    skuId,
    skuChannelId,
    eventType: EVENT_TYPES.EXTERNAL_CHANGE_ABSORBED,
    payload: { previousListPriceCents, newListPriceCents: currentPriceCents, deviationPct },
  });

  logger.info({ skuChannelId, previousListPriceCents, newListPriceCents: currentPriceCents, deviationPct }, 'cooperative-absorb: absorbed external change');
  return { absorbed: true, frozen: false };
}
```

### Test structure for `tests/worker/engine/cooperative-absorb.test.js`

Tests follow the same pattern as `tests/worker/engine/decide.test.js` (node:test runner, `describe`/`test`, `assert.strict`). Tests mock `tx` as an object with a `query` method that captures calls.

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absorbExternalChange } from '../../../worker/src/engine/cooperative-absorb.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build a mock tx that captures UPDATE calls and writeAuditEvent calls.
 * writeAuditEvent is imported by cooperative-absorb.js — to test that it's
 * called correctly, tests can inject a spy by providing a real DB tx mock
 * that records SQL calls, OR mock the module directly if needed.
 *
 * Recommended approach: mock tx.query to capture UPDATE calls; verify
 * audit emission by observing side effects (e.g., checking the captured
 * query includes 'sku_channels SET list_price_cents').
 */
function makeMockTx (queryResults = {}) {
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      const key = sql.trim().split(' ')[0].toUpperCase();
      return queryResults[key] ?? { rows: [] };
    },
    calls,
  };
}

function makeSkuChannel (overrides = {}) {
  return {
    id: 'sc-test-uuid',
    sku_id: 'sku-test-uuid',
    customer_marketplace_id: 'cm-test-uuid',
    list_price_cents: 3000,
    last_set_price_cents: 3000,
    current_price_cents: 3000,     // = last_set: no change by default
    pending_import_id: null,
    frozen_for_anomaly_review: false,
    ...overrides,
  };
}

function makeMarketplace (overrides = {}) {
  return {
    id: 'cm-test-uuid',
    anomaly_threshold_pct: null,   // uses 0.40 default
    ...overrides,
  };
}
```

**Key test scenarios:**

1. **No-op (AC3):**
   ```js
   const sc = makeSkuChannel({ current_price_cents: 3000, last_set_price_cents: 3000 });
   const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: makeMp() });
   assert.deepEqual(result, { absorbed: false, frozen: false });
   // tx.query NOT called
   ```

2. **Skip-on-pending (AC2):**
   ```js
   const sc = makeSkuChannel({ current_price_cents: 3450, last_set_price_cents: 3000, pending_import_id: 'some-uuid' });
   const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: makeMp() });
   assert.deepEqual(result, { absorbed: false, frozen: false, skipped: true });
   // tx.query NOT called
   ```

3. **Within-threshold absorption (AC1, AC4):**
   ```js
   // deviation = |3450 - 3000| / 3000 = 0.15 (< 0.40)
   const sc = makeSkuChannel({ list_price_cents: 3000, current_price_cents: 3450, last_set_price_cents: 3000 });
   const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: makeMp(), freezeFn: null });
   assert.equal(result.absorbed, true);
   assert.equal(result.frozen, false);
   // skuChannel.list_price_cents mutated to 3450
   assert.equal(sc.list_price_cents, 3450);
   // tx.query called with UPDATE sku_channels SET list_price_cents = 3450
   ```

4. **Above-threshold freeze (AC1):**
   ```js
   // deviation = |5000 - 3000| / 3000 = 0.667 (> 0.40)
   const sc = makeSkuChannel({ list_price_cents: 3000, current_price_cents: 5000, last_set_price_cents: 3000 });
   let freezeCalled = false;
   let freezeArgs = null;
   const mockFreeze = async (args) => { freezeCalled = true; freezeArgs = args; };
   const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: makeMp(), freezeFn: mockFreeze });
   assert.equal(result.frozen, true);
   assert.equal(result.absorbed, false);
   assert.equal(freezeCalled, true);
   assert.equal(freezeArgs.skuChannelId, 'sc-test-uuid');
   // deviationPct passed to freeze
   assert.ok(freezeArgs.deviationPct > 0.40);
   ```

5. **Custom threshold:**
   ```js
   // threshold = 0.10; deviation = 0.15 → exceeds custom threshold
   const sc = makeSkuChannel({ list_price_cents: 3000, current_price_cents: 3450, last_set_price_cents: 3000 });
   const cm = makeMarketplace({ anomaly_threshold_pct: 0.10 });
   const mockFreeze = async () => {};
   const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm, freezeFn: mockFreeze });
   assert.equal(result.frozen, true);
   assert.equal(result.absorbed, false);
   ```

### `writeAuditEvent` testing approach

`writeAuditEvent` is imported at module scope in `cooperative-absorb.js`. Unit tests cannot easily intercept it without a module mock framework. The recommended approach:

- **Option A (preferred):** Accept that `writeAuditEvent` executes against the mock tx. Since `writeAuditEvent` calls `tx.query` internally, the mock tx captures those calls. Assert the presence of an `INSERT INTO audit_log` (or whatever `writeAuditEvent` uses internally) in `tx.calls`.
- **Option B:** Use a dependency-injection pattern — add optional `writeAuditEventFn` parameter to `absorbExternalChange` (defaulting to the SSoT import). Tests inject a spy. This is cleaner but requires changing the function signature.

**Recommended:** Use Option A for simplicity. Verify that `tx.calls` contains a query involving `audit_log` or `external-change-absorbed` after the absorption call. The exact SQL depends on `writeAuditEvent`'s implementation in Story 9.0 — check `shared/audit/writer.js` before writing the assertion.

**Alternative verification:** If the mock tx approach is insufficient for audit verification, use Option B (inject `writeAuditEventFn`) — this is also consistent with the `opts.writeAuditEvent` injection pattern used in `cycle-assembly.js`.

---

## Negative Assertions (AC5 companion)

When implementation is complete, these greps on `worker/src/engine/cooperative-absorb.js` must return zero matches:

- `INSERT INTO audit_log` — raw audit log insert forbidden; use `writeAuditEvent`
- `console.log` — pino only
- `default export` — named exports only
- `.then(` — async/await only

---

## Out of Scope for This Story

- `freezeSkuForReview` implementation → **Story 7.4** (anomaly-freeze.js)
- Accept/reject endpoints → **Story 7.4** (`app/src/routes/audit/anomaly-review.js`)
- Tier-classification DB writes → **Story 7.5** (`worker/src/engine/tier-classify.js`)
- Per-SKU circuit-breaker → **Story 7.6** (`worker/src/safety/circuit-breaker.js`)
- Integration gate with real DB → **Story 7.8** (`tests/integration/full-cycle.test.js`)
- The `p11-cooperative-absorption-anomaly-freeze.json` fixture → **Story 7.4** (uses the fixture; Story 7.4 commits it)
- Any DB schema changes — all columns already exist from Stories 4.2 + 6.3 (`list_price_cents`, `current_price_cents`, `last_set_price_cents`, `pending_import_id`, `frozen_for_anomaly_review`)

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Step 3 developer subagent)

### Completion Notes List

- Implemented `worker/src/engine/cooperative-absorb.js` — full AD9 cooperative-ERP-sync detection module.
- All 4 branches implemented: skip-on-pending (AC2), no-op (AC3), absorption within threshold (AC1), freeze above threshold (AC1).
- Dependency-injection pattern for `freezeFn` (AC5) — tests inject mock; production uses dynamic import stub for Story 7.4.
- `skuChannel.list_price_cents` mutated in-place on absorption so decide.js STEP 3 reads the new baseline.
- `writeAuditEvent` called with `EVENT_TYPES.EXTERNAL_CHANGE_ABSORBED` and payload `{ previousListPriceCents, newListPriceCents, deviationPct }`.
- ERR_MODULE_NOT_FOUND stub pattern matches Story 7.2 decide.js pattern exactly; real runtime errors propagate.
- All 18 unit tests pass (node --test tests/worker/engine/cooperative-absorb.test.js).
- Pre-existing test:unit failures (25) are unchanged — all in dry-run-minimal, margin, decide fixtures, and ESLint codebase scan (DB-dependent or pre-existing issues).
- Negative assertions: no raw INSERT audit_log, no console.log, no default export, no .then().
- `node --check worker/src/engine/cooperative-absorb.js` passes.
- Fixture `tests/fixtures/p11/p11-cooperative-absorption-within-threshold.json` was already created by ATDD step.

### File List

- `worker/src/engine/cooperative-absorb.js` — new (SSoT AD9 absorption module)
- `tests/worker/engine/cooperative-absorb.test.js` — created by ATDD step (Step 2)
- `tests/fixtures/p11/p11-cooperative-absorption-within-threshold.json` — created by ATDD step (Step 2)

### Change Log

- 2026-05-11: Story 7.3 spec created by Bob (bmad-create-story). Worktree forked from story-7.2-engine-decide-ad8-flow (Bundle C stacked dispatch). Endpoints verified against Mirakl MCP and architecture-distillate empirical facts.
- 2026-05-11: Implementation complete by Step 3 dev agent (claude-sonnet-4-6). `cooperative-absorb.js` created; all 18 unit tests pass; status set to review.
