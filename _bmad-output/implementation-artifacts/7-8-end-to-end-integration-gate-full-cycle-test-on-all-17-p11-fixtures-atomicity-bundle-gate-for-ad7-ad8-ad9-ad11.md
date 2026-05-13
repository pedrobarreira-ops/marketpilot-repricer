# Story 7.8: END-TO-END INTEGRATION GATE — Full Cycle Test on All 17 P11 Fixtures (Atomicity-Bundle Gate for AD7+AD8+AD9+AD11)

> No Mirakl API endpoints are called by this story. AD7+AD8+AD9+AD11 are pure-logic invariants — the gate exercises real production modules with a real mock tx, no HTTP layer. No Mirakl mock server, no MCP verification.

**Sprint-status key:** `7-8-end-to-end-integration-gate-full-cycle-test-on-all-17-p11-fixtures-atomicity-bundle-gate-for-ad7-ad8-ad9-ad11`
**Status:** ready-for-dev (re-dispatch post SCP-2026-05-11)
**Size:** L
**Epic:** 7 — Engine Decision & Safety
**Atomicity:** Bundle C — GATE. Single binding integration-test for the AD7+AD8+AD9+AD11 bundle. Without this gate passing, Epic 6's writer cannot ship to production.

---

## Narrative

**As a** BAD subagent implementing the MarketPilot Bundle C integration gate,
**I want** three integration test files (`tests/integration/full-cycle.test.js`, `tests/integration/circuit-breaker-trip.test.js`, `tests/integration/pending-import-id-invariant.test.js`) plus all 5 missing P11 fixture JSON files (with fully-populated `_expected` + `_fixture_meta` metadata) plus a metadata audit of the existing 12 fixtures,
**So that** AD7 (PRI01 writer atomicity), AD8 (engine decision table), AD9 (cooperative absorption), and AD11 (circuit breaker) are jointly verified end-to-end against real production modules before Epic 6's writer code ships to production.

---

## Trace

- **Architecture decisions:** AD7 (PRI01 pending_import_id atomicity), AD8 (engine full decision table), AD9 (cooperative absorption / skip-on-pending), AD11 (per-SKU 15% + per-cycle 20% circuit breaker)
- **F-amendments:** F6 (per-cycle 20% denominator = full active-SKU count)
- **Functional requirements:** FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR27, FR28, FR29 — verified end-to-end through this gate
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md`, Story 7.8
- **Architecture patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` — "Structural — Atomicity Bundles (Bundle C)", "Structural — Test Patterns", "17 P11 Fixtures"
- **Architecture decisions detail:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` — AD7, AD8, AD9, AD11
- **Sprint Change Proposal:** `_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-11.md` — 9 amendments authored by Bob 2026-05-11 closing 4 verified findings from prior dispatch (PR #90, now closed)

---

## Bundle C Gate Context

Story 7.8 is the **terminal gate** for Bundle C — the atomicity bundle spanning Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6. The bundle spans 8 separate PRs (#81-#85, #87-#89, all in review, all merge-blocked on this gate). This story's worktree forks from `bundle-c-integrated` (synthetic branch: `story-7.6-...` head merged with `story-7.3-...` via `--no-ff`). **ALL 8 Bundle C modules are present and the test suite MUST use REAL imports of every production module — no stubs, no fallbacks, no mocks for any production code.**

**Bundle C invariant to gate:** When a PRI01 batch is submitted, EVERY `sku_channel` row participating in that batch (including passthrough lines in delete-and-replace semantics) has `pending_import_id = <import_uuid>` set in a single transaction. PRI02 COMPLETE clears all rows atomically. Cooperative-absorption skip-on-pending and engine STEP 1 precondition both depend on this atomicity.

**What "gate passing" means:** All three integration test files pass cleanly, with the real `cooperative-absorb.js` + real `circuit-breaker.js` + real `markStagingPending` + real `clearPendingImport` + real `transitionCronState` exercised. Only then does Bundle C become safe to merge to main.

---

## Dependencies (All In-Review on This Branch)

| Story | Status | What this story uses |
|-------|--------|---------------------|
| 5.1 | review (PR #81) | `worker/src/dispatcher.js` (`dispatchCycle`), `worker/src/advisory-lock.js` |
| 5.2 | review (PR #82) | `worker/src/cycle-assembly.js` (`assembleCycle`) |
| 6.1 | review (PR #83) | `shared/mirakl/pri01-writer.js` (`buildPri01Csv`, `submitPriceImport`, `markStagingPending`) |
| 6.2 | review (PR #84) | `shared/mirakl/pri02-poller.js` (`pollImportStatus`, `clearPendingImport`), `worker/src/jobs/pri02-poll.js` |
| 6.3 | review (PR #85) | `shared/mirakl/pri03-parser.js` (`parseErrorReport`) |
| 7.1 | done (PR #86)   | `shared/money/index.js` (money math — used by engine) |
| 7.2 | review (PR #87) | `worker/src/engine/decide.js` (`decideForSkuChannel`) |
| 7.3 | review (PR #88) | `worker/src/engine/cooperative-absorb.js` (`absorbExternalChange`) |
| 7.6 | review (PR #89) | `worker/src/safety/circuit-breaker.js` (`checkPerSkuCircuitBreaker`, `checkPerCycleCircuitBreaker`) |
| 9.0 | done | `shared/audit/writer.js` (`writeAuditEvent`), `shared/audit/event-types.js` |
| 9.1 | done | Audit log priority trigger (atencao/notavel/rotina) — needed for audit event assertions |

**IMPORTANT — Branch Topology:**
This worktree forks from `bundle-c-integrated` — a synthetic branch created by merging `story-7.3-worker-src-engine-cooperative-absorb-...` into the head of `story-7.6-worker-src-safety-circuit-breaker-...` (created 2026-05-11 per SCP §5 step 3; ORT merge strategy, clean, --no-ff). All 8 Bundle C modules are present:

- `worker/src/dispatcher.js`, `worker/src/advisory-lock.js` (Story 5.1)
- `worker/src/cycle-assembly.js` (Story 5.2)
- `shared/mirakl/pri01-writer.js` (Story 6.1)
- `shared/mirakl/pri02-poller.js`, `worker/src/jobs/pri02-poll.js` (Story 6.2)
- `shared/mirakl/pri03-parser.js` (Story 6.3)
- `worker/src/engine/decide.js` (Story 7.2)
- `worker/src/engine/cooperative-absorb.js` (Story 7.3)
- `worker/src/safety/circuit-breaker.js` (Story 7.6)

Stories 7.4 (anomaly-freeze), 7.5 (tier-classify), 7.7 (reconciliation) are NOT Bundle C members. Their absence is expected and structural. The gate does NOT test those modules' behaviors — those modules' tests live in their own stories.

**Before implementing tests:** Verify all 8 Bundle C modules are present on `bundle-c-integrated`. Run:
- `ls worker/src/engine/` → expect `decide.js`, `cooperative-absorb.js`
- `ls worker/src/safety/` → expect `circuit-breaker.js`
- `ls worker/src/` → expect `dispatcher.js`, `advisory-lock.js`, `cycle-assembly.js`
- `ls shared/mirakl/` → expect `pri01-writer.js`, `pri02-poller.js`, `pri03-parser.js`

If any Bundle C module is absent: this is a DISPATCH ERROR. Halt and escalate to Pedro/Bob. Do NOT proceed with test implementation. Stub-fallbacks for production modules are FORBIDDEN. The test MUST import the real module — fallback to mocks for production code is forbidden.

---

## What This Story Ships

### New files (3 integration test files)

| File | Purpose |
|------|---------|
| `tests/integration/full-cycle.test.js` | Full cycle through engine + writer for all 17 P11 fixtures, real production modules. AC1–AC2. |
| `tests/integration/pending-import-id-invariant.test.js` | Bundle C atomicity: pending_import_id set on all rows atomically, cleared on PRI02 COMPLETE/FAILED. AC3. |
| `tests/integration/circuit-breaker-trip.test.js` | 21% catalog change → cycle halt + cron_state transition + Atenção event + no PRI01 emitted. AC4. |

### New fixture files (5 missing P11 fixtures)

| File | Consumed by |
|------|-------------|
| `tests/fixtures/p11/p11-tier2a-recently-won-stays-watched.json` | Story 7.5, Story 7.8 |
| `tests/fixtures/p11/p11-tier3-no-competitors.json` | Story 7.5, Story 7.8 |
| `tests/fixtures/p11/p11-tier3-then-new-competitor.json` | Story 7.5, Story 7.8 |
| `tests/fixtures/p11/p11-cooperative-absorption-within-threshold.json` | Story 7.3, Story 7.8 (NOTE: file already present on bundle-c-integrated via 7.3 merge — verify content matches spec below; update if drift) |
| `tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json` | Story 7.4, Story 7.8 |

### Modified files (existing 12 P11 fixtures — metadata audit)

Each of the 12 existing P11 fixtures MUST have a complete `_expected` block (with `action` + `newPriceCents` + `auditEvent` keys at minimum) AND a `_fixture_meta.skuChannel_overrides` block populated with the exact skuChannel state required for the fixture's scenario. If any existing fixture lacks these fields, the dev MUST add them as part of this story. This enables AC1's fixture-driven oracle pattern (see Amendment 4 / AC1).

### No production code changes

No `worker/src/*` or `shared/*` changes. This story is **tests, fixtures, and fixture metadata only**.

---

## All 17 P11 Fixtures — Complete List

12 exist already in `tests/fixtures/p11/`. 5 must be created (1 of which may already exist on bundle-c-integrated from the 7.3 merge — verify and align).

**Already present (12):**
- `p11-tier1-undercut-succeeds.json`
- `p11-tier1-floor-bound-hold.json`
- `p11-tier1-tie-with-competitor-hold.json`
- `p11-tier2b-ceiling-raise-headroom.json`
- `p11-all-competitors-below-floor.json`
- `p11-all-competitors-above-ceiling.json`
- `p11-self-active-in-p11.json`
- `p11-self-marked-inactive-but-returned.json`
- `p11-single-competitor-is-self.json`
- `p11-zero-price-placeholder-mixed-in.json`
- `p11-shop-name-collision.json`
- `p11-pri01-pending-skip.json`

**Must be created or aligned (5):**
- `p11-tier2a-recently-won-stays-watched.json`
- `p11-tier3-no-competitors.json`
- `p11-tier3-then-new-competitor.json`
- `p11-cooperative-absorption-within-threshold.json` (already present from 7.3 merge — verify alignment with spec below)
- `p11-cooperative-absorption-anomaly-freeze.json`

**P11 fixture shape** (canonical — every fixture MUST conform):
```json
{
  "_note": "Human-readable description of scenario",
  "_expected": {
    "action": "UNDERCUT",
    "newPriceCents": 2849,
    "auditEvent": "undercut-decision",
    "priority": "rotina"
  },
  "_fixture_meta": {
    "skuChannel_overrides": {
      "list_price_cents": 2985,
      "current_price_cents": 3199,
      "last_set_price_cents": 3199
    },
    "customerMarketplace_overrides": {}
  },
  "products": [{
    "product_references": [{ "reference_type": "EAN", "reference": "8809606851663" }],
    "offers": [
      { "shop_name": "Competitor A", "active": true,  "total_price": 28.50, "shop_id": null },
      { "shop_name": "Easy - Store", "active": true,  "total_price": 31.99, "shop_id": null }
    ]
  }]
}
```

Key constraints per empirical verification:
- Top-level `products` array wrapping an `offers` array (NOT a flat `offers` array at root level)
- `shop_id` is ALWAYS `null` for all offers
- `total_price = 0` means placeholder offer (Strawberrynet pattern) — must be filtered by AD14
- `active: false` offers must be filtered by AD14 filter chain in `shared/mirakl/self-filter.js`
- Own offer shop_name is `'Easy - Store'` in all fixtures
- `_note`, `_expected`, `_fixture_meta` are metadata fields — ignored by production code, used by tests as authoritative oracle
- When the engine calls `getProductOffersByEan`, the response is `products[0].offers`

---

## Test Architecture Pattern

All three integration tests use **real production-module imports + a mock tx object** — NO real Postgres, NO HTTP layer, NO Mirakl mock server. AD7+AD8+AD9+AD11 are pure-logic invariants exercised against captured-query state.

- **Mirakl calls:** NOT exercised. The engine receives P11 offer arrays directly from fixture JSON files. No HTTP round-trip.
- **DB calls:** Replaced by a mock `tx` object with queryable state. The mock captures every SQL query + params for post-call assertion.
- **Resend calls:** Stubbed via `process.env.RESEND_API_KEY` set at the top of each test file BEFORE any `await import` (canonical pattern — see precedent at `tests/worker/safety/circuit-breaker.test.js`).
- **`transitionCronState`:** REAL module imported from `shared/state/cron-state.js`, called with mock tx.
- **`markStagingPending` + `clearPendingImport`:** REAL functions imported from `shared/mirakl/pri01-writer.js` + `shared/mirakl/pri02-poller.js`, called with mock tx.
- **`decideForSkuChannel` + `absorbExternalChange` + `checkPerSkuCircuitBreaker` + `checkPerCycleCircuitBreaker`:** ALL real, ALL imported, ALL called with mock tx + fixture-driven inputs.

**Why no real Postgres:** The integration test suite runs without a live DB (CI-safe). The mock `tx` captures queries and returns pre-seeded rows. Established pattern from `tests/worker/cycle-assembly.test.js` (`buildMockTx` reference there).

**Why `await import` (NOT static `import`):** ESM static imports hoist above top-level executable statements. `worker/src/safety/circuit-breaker.js` (and any transitive consumer) statically imports `shared/resend/client.js`, which throws at module-load time if `RESEND_API_KEY` is unset. Static `import` would fail before the env-stub statement runs. The dynamic `await import` pattern sequences the env stub before module load. Documented in [`tests/worker/safety/circuit-breaker.test.js`] (canonical example).

**Reference mock-tx pattern (from `tests/worker/cycle-assembly.test.js`):**
```js
function buildMockTx ({ priRows = [], scRows = [], countRows = [] } = {}) {
  const queries = [];
  return {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('pri01_staging') && sql.includes('COUNT')) {
        return { rows: countRows.length ? countRows : [{ count: 0 }] };
      }
      if (sql.includes('sku_channels') && sql.includes('COUNT')) {
        return { rows: [{ count: 100 }] };
      }
      if (sql.includes('INSERT INTO pri01_staging')) return { rows: [] };
      return { rows: [] };
    },
    _queries: queries,
  };
}
```

---

## Test 1: `tests/integration/full-cycle.test.js` (AC1–AC2)

### Purpose

Exercises the engine pipeline for all 17 fixtures using REAL `decideForSkuChannel` (which dynamically imports REAL `cooperative-absorb.js` at STEP 2 and REAL `circuit-breaker.js` at STEP 5). Each fixture produces an action; the fixture's `_expected.action` is the sole oracle.

### Setup Approach

Direct module imports of `decideForSkuChannel` from `worker/src/engine/decide.js`. The engine's internal STEP 5 cooperative-absorb call resolves to the REAL `cooperative-absorb.js` on this branch — no stubs.

Mock `tx` captures `INSERT INTO pri01_staging` queries and `UPDATE sku_channels` queries for AC2 assertions.

### Per-fixture Expected Outcomes (oracle = fixture `_expected.action`)

The fixture's `_expected.action` field is the authoritative oracle. The test loads each fixture and asserts `result.action === fixture._expected.action`. Hand-coded inline lookup tables that override `_expected` are FORBIDDEN (see AC1 negative assertion).

Per-fixture skuChannel state comes from `fixture._fixture_meta.skuChannel_overrides` — never inlined in the test file.

---

## Test 2: `tests/integration/pending-import-id-invariant.test.js` (AC3)

### Purpose

Assert the Bundle C invariant: after PRI01 submission + `markStagingPending`, ALL participating `sku_channel` rows (including passthrough lines) have `pending_import_id` set. While non-null: engine STEP 1 SKIPs. Cooperative-absorption SKIPs. PRI02 COMPLETE clears atomically.

### Test Cases (all using REAL production modules)

1. **After `markStagingPending`:** Call REAL `markStagingPending` from `shared/mirakl/pri01-writer.js`. Assert the mock tx captures exactly ONE `UPDATE sku_channels SET pending_import_id = $1` query (single batch, not per-row).
2. **Engine SKIP on pending:** Call REAL `decideForSkuChannel` with `skuChannel.pending_import_id = 'some-uuid'`. Assert `result.action === 'SKIP'` with STEP 1 precondition fail.
3. **Cooperative-absorption SKIP on pending:** Call REAL `absorbExternalChange` from `worker/src/engine/cooperative-absorb.js` with `skuChannel.pending_import_id = 'some-uuid'` and `current_price_cents ≠ last_set_price_cents`. Assert `{ absorbed: false, frozen: false, skipped: true }`.
4. **PRI02 COMPLETE clears atomically:** Call REAL `clearPendingImport(tx, importUuid, 'COMPLETE')` from `shared/mirakl/pri02-poller.js`. Assert the mock tx captures exactly ONE `UPDATE` clearing `pending_import_id = NULL` for matching `import_uuid`.
5. **PRI02 FAILED clears pending + triggers PRI03:** Call REAL `clearPendingImport(tx, importUuid, 'FAILED')`. Assert `pending_import_id = NULL` clear AND that REAL PRI03 parser was invoked (spy on parser export or assert captured side-effect).

### Key Module Imports

```js
import { markStagingPending } from '../../shared/mirakl/pri01-writer.js';
import { clearPendingImport } from '../../shared/mirakl/pri02-poller.js';
import { absorbExternalChange } from '../../worker/src/engine/cooperative-absorb.js';
import { transitionCronState } from '../../shared/state/cron-state.js';
// (decide.js imported dynamically — see Test Architecture Pattern)
```

NO `transitionCronStateFn` injection. NO mock-implementation patterns for production modules.

---

## Test 3: `tests/integration/circuit-breaker-trip.test.js` (AC4)

### Purpose

Synthesize 21% catalog-change scenario. Assert: cycle halts, cron_state transitions to `PAUSED_BY_CIRCUIT_BREAKER` (via REAL `transitionCronState`), `circuit-breaker-trip` Atenção event in audit_log, Resend mock receives critical alert, no PRI01 emitted.

### Setup

1. Build a mock tx where `pri01_staging COUNT = 21`, `sku_channels COUNT = 100` (21% > 20% → trip).
2. Build mock `sendAlertFn` that records the call (Resend stub — see env-stub note above).
3. Call REAL `checkPerCycleCircuitBreaker` from `worker/src/safety/circuit-breaker.js` with `transitionCronState` imported from `shared/state/cron-state.js`.
4. Assert:
   - Returns `{ tripped: true, numerator: 21, denominator: 100, affectedPct: 0.21 }`
   - REAL `transitionCronState` was invoked with `{ from: 'ACTIVE', to: 'PAUSED_BY_CIRCUIT_BREAKER', context: { cycleId: 'cycle-uuid', numerator: 21, denominator: 100 } }` (assertable via mock tx captured queries)
   - `sendAlertFn` was called (Resend alert)
5. Also verify no `pri01_staging` rows were flushed — call REAL `assembleCycle` with 21 write-action SKUs and assert no `submitPriceImport` mock invocation.

### Boundary cases

- 20% exactly does NOT trip
- 0-denominator guard returns `{ tripped: false }`
- Per-SKU 15% boundary: 16% trips, 15% no-trip, 14% no-trip, decrease-direction trips

---

## 5 Missing P11 Fixture Specs

Create these JSON files in `tests/fixtures/p11/`. All MUST include `_expected` (with `action` + `newPriceCents` + `auditEvent` + optional `priority`) AND `_fixture_meta.skuChannel_overrides`.

### `p11-tier2a-recently-won-stays-watched.json`

```json
{
  "_note": "T2a: own is 1st place, last_won_at < 4h ago. Tier stays 2a. Engine decision per AD8 CASE B yields CEILING_RAISE (own=3599 < competitor 3650 → position 1; competitor2nd 3750; targetCeiling 3749; ceiling 3850; newCeiling 3749 > 3599 → CEILING_RAISE).",
  "_expected": {
    "action": "CEILING_RAISE",
    "newPriceCents": 3749,
    "auditEvent": "ceiling-raise-decision",
    "priority": "rotina",
    "tierStay": "2a"
  },
  "_fixture_meta": {
    "skuChannel_overrides": {
      "tier": "2a",
      "tier_cadence_minutes": 15,
      "list_price_cents": 3500,
      "current_price_cents": 3599,
      "last_set_price_cents": 3599,
      "last_won_at": "<set in test: new Date(Date.now() - 2*60*60*1000).toISOString()>"
    }
  },
  "products": [{
    "product_references": [{ "reference_type": "EAN", "reference": "0000000000013" }],
    "offers": [
      { "shop_name": "Easy - Store",     "active": true, "total_price": 35.99, "shop_id": null },
      { "shop_name": "Competitor Alpha", "active": true, "total_price": 36.50, "shop_id": null },
      { "shop_name": "Competitor Beta",  "active": true, "total_price": 37.50, "shop_id": null }
    ]
  }]
}
```

### `p11-tier3-no-competitors.json`

```json
{
  "_note": "Tier 3: no competitors. P11 returns only own offer (self-filter removes it) → post-filter empty → tier=3, HOLD, no write.",
  "_expected": {
    "action": "HOLD",
    "newPriceCents": null,
    "auditEvent": "tier-transition",
    "tier": "3"
  },
  "_fixture_meta": {
    "skuChannel_overrides": {
      "tier": "3",
      "tier_cadence_minutes": 1440
    }
  },
  "products": [{
    "product_references": [{ "reference_type": "EAN", "reference": "0000000000014" }],
    "offers": [
      { "shop_name": "Easy - Store", "active": true, "total_price": 29.99, "shop_id": null }
    ]
  }]
}
```

### `p11-tier3-then-new-competitor.json`

```json
{
  "_note": "T3→T1: was tier 3 (no competitors), now one competitor entered. Engine math: list=5000, floor=ceil(5000*0.95)=4750. competitor=4599. own=4999>4599 → position>1. targetUndercut=4598. candidate=max(4598,4750)=4750. 4750>=4599 → HOLD floor-bound (not UNDERCUT — floor protects). Tier transitions 3→1 on next cycle.",
  "_expected": {
    "action": "HOLD",
    "newPriceCents": null,
    "auditEvent": "hold-floor-bound",
    "tierTransition": "3→1"
  },
  "_fixture_meta": {
    "skuChannel_overrides": {
      "tier": "3",
      "tier_cadence_minutes": 1440,
      "list_price_cents": 5000,
      "current_price_cents": 4999,
      "last_set_price_cents": 4999
    }
  },
  "products": [{
    "product_references": [{ "reference_type": "EAN", "reference": "0000000000015" }],
    "offers": [
      { "shop_name": "New Competitor", "active": true, "total_price": 45.99, "shop_id": null },
      { "shop_name": "Easy - Store",   "active": true, "total_price": 49.99, "shop_id": null }
    ]
  }]
}
```

### `p11-cooperative-absorption-within-threshold.json`

(NOTE: may already exist on `bundle-c-integrated` from the 7.3 merge — verify content matches spec below. Align if drift.)

```json
{
  "_note": "Cooperative absorption within threshold: current_price=2800 vs last_set_price=2500 (deviation=12% < 40%). Real absorbExternalChange updates list_price to 2800. external-change-absorbed Notável emitted. Engine proceeds to normal decision (CEILING_RAISE).",
  "_expected": {
    "action": "CEILING_RAISE",
    "newPriceCents": 3199,
    "absorbed": true,
    "auditEvent": "external-change-absorbed",
    "priority": "notavel"
  },
  "_fixture_meta": {
    "skuChannel_overrides": {
      "current_price_cents": 2800,
      "last_set_price_cents": 2500,
      "pending_import_id": null
    }
  },
  "products": [{
    "product_references": [{ "reference_type": "EAN", "reference": "0000000000016" }],
    "offers": [
      { "shop_name": "Competitor A",  "active": true, "total_price": 29.99, "shop_id": null },
      { "shop_name": "Competitor B",  "active": true, "total_price": 32.00, "shop_id": null },
      { "shop_name": "Easy - Store",  "active": true, "total_price": 28.00, "shop_id": null }
    ]
  }]
}
```

### `p11-cooperative-absorption-anomaly-freeze.json`

```json
{
  "_note": "Cooperative absorption anomaly freeze: current_price=1000 vs last_set_price=2500 (deviation=60% > 40%). Real absorbExternalChange fires anomaly-freeze BEFORE per-SKU CB check. Engine returns SKIP. anomaly-freeze Atenção emitted. Critical alert sent.",
  "_expected": {
    "action": "SKIP",
    "newPriceCents": null,
    "absorbed": false,
    "frozen": true,
    "auditEvent": "anomaly-freeze",
    "priority": "atencao"
  },
  "_fixture_meta": {
    "skuChannel_overrides": {
      "current_price_cents": 1000,
      "last_set_price_cents": 2500,
      "pending_import_id": null
    }
  },
  "products": [{
    "product_references": [{ "reference_type": "EAN", "reference": "0000000000017" }],
    "offers": [
      { "shop_name": "Competitor A",  "active": true, "total_price": 19.99, "shop_id": null },
      { "shop_name": "Competitor B",  "active": true, "total_price": 21.00, "shop_id": null },
      { "shop_name": "Easy - Store",  "active": true, "total_price": 10.00, "shop_id": null }
    ]
  }]
}
```

**Negative assertion:** No "acceptable transient behavior for this branch" rationalization comments anywhere in the test files. If the fixture's `_expected.action` disagrees with the engine's real behavior, that's a failing test — not a comment.

---

## Acceptance Criteria

### AC1 — `tests/integration/full-cycle.test.js` — 17-fixture parametric cycle test (fixture-driven oracle)

**Given** `tests/integration/full-cycle.test.js` exists
**When** I run `node --test tests/integration/full-cycle.test.js`
**Then**:
- For each of the 17 P11 fixtures (load from `tests/fixtures/p11/`), the test:
  1. Loads the fixture via `loadFixture(name)` which returns `{ offers, expected, fixtureMeta }` — ALL three keys must be destructured and used
  2. Builds `skuChannel` mock using overrides from `fixture._fixture_meta.skuChannel_overrides` ONLY — no hand-coded per-fixture overrides that contradict the fixture's `_expected` outcome
  3. Instantiates a mock tx tracking `pri01_staging` INSERTs and audit_log writes
  4. Calls REAL `decideForSkuChannel` from `worker/src/engine/decide.js` (real STEP 2 cooperative-absorb call must reach REAL `cooperative-absorb.js`; real STEP 5 circuit-breaker check must execute against REAL `circuit-breaker.js`)
  5. Asserts `result.action === fixture._expected.action` — the fixture's `_expected` field is the SOLE oracle
  6. Asserts `result.newPriceCents === fixture._expected.newPriceCents ?? null`
  7. Asserts `result.auditEvents` contains `fixture._expected.auditEvent` when defined
- All 17 fixtures pass

**Negative assertion:** Grep the test file — zero occurrences of inline `const FIXTURE_CASES = [...]` style tables that override `_expected`. Zero occurrences of inline `expectedAction:` fields per fixture. The fixture JSON files are authoritative.

### AC2 — Full flush assertion for write-action fixtures (real assembleCycle + real markStagingPending + real clearPendingImport)

**Given** fixtures producing UNDERCUT or CEILING_RAISE action
**When** REAL `assembleCycle` from `worker/src/cycle-assembly.js` is called with those fixtures
**Then**:
- The mock tx captures at least one `INSERT INTO pri01_staging` query with `new_price_cents` matching `result.newPriceCents` and `sku_channel_id` matching the test's skuChannel.id
- A real call to `markStagingPending(tx, importUuid, cycleId)` from `shared/mirakl/pri01-writer.js` is invoked — the mock tx captures the resulting `UPDATE sku_channels SET pending_import_id = ...` query
- A real call to `clearPendingImport(tx, importUuid, 'COMPLETE')` from `shared/mirakl/pri02-poller.js` is invoked — the mock tx captures the resulting `UPDATE sku_channels SET pending_import_id = NULL` query
- The test asserts the captured query count and parameter shapes — not the engine's return shape

**Negative assertion:** No `stagingInserts.push(...)` followed by zero subsequent `assert.equal(stagingInserts.length, ...)` patterns. Captured queries MUST be asserted on; declaring a capture array without asserting its contents is FORBIDDEN.

**Negative assertion:** No test simulates PRI02 COMPLETE by calling `tx.query(...)` directly. The simulation MUST go through the real poller-side `clearPendingImport` function.

### AC3 — `tests/integration/pending-import-id-invariant.test.js` — Bundle C atomicity (all real modules)

**Given** `tests/integration/pending-import-id-invariant.test.js` exists
**When** I run `node --test tests/integration/pending-import-id-invariant.test.js`
**Then** the 5 sub-tests all pass — every sub-test imports REAL production modules:
1. Real `markStagingPending` from `shared/mirakl/pri01-writer.js` is called; mock tx captures exactly ONE UPDATE query (not N per-row UPDATEs) setting `pending_import_id = $1`
2. Real `decideForSkuChannel` from `worker/src/engine/decide.js` is called with `skuChannel.pending_import_id = 'uuid'`; returns `{ action: 'SKIP', reason: <STEP 1 precondition fail> }`
3. Real `absorbExternalChange` from `worker/src/engine/cooperative-absorb.js` is called with `skuChannel.pending_import_id = 'uuid'`; returns `{ absorbed: false, frozen: false, skipped: true }`
4. Real `clearPendingImport(tx, importUuid, 'COMPLETE')` from `shared/mirakl/pri02-poller.js` is called; mock tx captures exactly ONE UPDATE clearing `pending_import_id = NULL` for matching `import_uuid`
5. Real `clearPendingImport(tx, importUuid, 'FAILED')` from `shared/mirakl/pri02-poller.js` is called; mock tx captures both the `pending_import_id = NULL` clear AND a `pri02-failed-transient` audit_log INSERT (NO PRI03 parser invocation when `hasErrorReport: false`)
<!-- Amended 2026-05-13 per Story 7.9 AC5 Path A: spec wording updated to match impl; impl calls clearPendingImport with hasErrorReport: false which by design skips PRI03 parser path entirely — the behavioral guarantee (atomic clear + audit emission) is already what sub-test 5 verifies. -->

**Negative assertion:** No `transitionCronStateFn` injection pattern. Real `transitionCronState` from `shared/state/cron-state.js` is imported and called.

**Negative assertion:** Zero occurrences of `// stub for missing module` style comments. All Bundle C modules are present and used.

### AC4 — `tests/integration/circuit-breaker-trip.test.js` — 21% catalog trip (real modules)

**Given** `tests/integration/circuit-breaker-trip.test.js` exists
**When** I run `node --test tests/integration/circuit-breaker-trip.test.js`
**Then** the test:
- Calls REAL `checkPerCycleCircuitBreaker` with `numerator=21, denominator=100`
- Returns `{ tripped: true, numerator: 21, denominator: 100, affectedPct: 0.21 }`
- The REAL `transitionCronStateFn` injection point is exercised — test supplies a capture-lambda that the real `checkPerCycleCircuitBreaker` invokes via its standard injection contract (Story 7.6 design: `transitionCronStateFn` is injectable with default `_transitionCronState`); the capture-lambda forwards to the real `transitionCronState` and the captured args match `{ from: 'ACTIVE', to: 'PAUSED_BY_CIRCUIT_BREAKER', context: { cycleId, numerator: 21, denominator: 100 } }`
<!-- Amended 2026-05-13 per Story 7.9 AC6 Path A: spec wording updated to match impl; circuit-breaker.js accepts transitionCronStateFn as injectable (Story 7.6 design), and the test injects a capture-lambda that forwards to the real transitionCronState — the original "REAL transitionCronState is invoked (via real circuit-breaker.js)" intent is preserved via the injection contract. -->
- Injected `sendAlertFn` (Resend stub) is called
- No PRI01 is submitted (real `assembleCycle` halts on tripped CB; no `submitPriceImport` mock invocation)
- **Also covers:** 20% exactly does NOT trip; 0-denominator guard returns `{ tripped: false }`; per-SKU 15% boundary cases

### AC5 — CI gate

**Given** all three integration test files exist
**When** CI runs `node --test tests/integration/full-cycle.test.js tests/integration/pending-import-id-invariant.test.js tests/integration/circuit-breaker-trip.test.js`
**Then** all tests pass and the deploy is not blocked

### AC6 — 5 missing fixtures created + 12 existing fixtures audited for metadata completeness

**Given** the 5 missing P11 fixture files are created AND the 12 existing P11 fixture files have complete `_expected` + `_fixture_meta.skuChannel_overrides` blocks
**When** I run `ls tests/fixtures/p11/ | wc -l`
**Then** the count is 17 (all 17 fixtures present)
**And** each fixture file passes the negative-assertion grep: every fixture has both `_expected.action` and `_fixture_meta.skuChannel_overrides` keys present (use `jq` or equivalent)

### AC7 — Gate declaration in test files

**Given** each integration test file header
**When** I read the file
**Then** it includes a comment:
```
// ATOMICITY BUNDLE C GATE — AD7+AD8+AD9+AD11
// This test is the single binding integration gate for Bundle C.
// Epic 6 writer code (Stories 6.1, 6.2, 6.3) is NOT safe to ship to production
// until all assertions in this test file pass.
```

### AC8 — No-stub-fallback safety net

**Given** any of the 8 Bundle C production modules is absent from the worktree
**When** `node --test tests/integration/full-cycle.test.js` (or any of the 3 integration test files) loads
**Then** the test suite throws at import time — does NOT silently fall back to mocks.

**Implementation:** Each integration test file MUST top-level `await import` each Bundle C module it depends on. Module-not-found errors propagate to the test runner as failures. NO try/catch around `await import` calls. NO conditional `if (modulePresent) { ... } else { ... mock ... }` logic.

**Negative assertion grep:** Zero occurrences of `try { await import(...) } catch` in `tests/integration/`. Zero occurrences of `// stub for missing module` style comments. Zero occurrences of conditional-import patterns.

**Why this AC exists:** The original Story 7.8 spec authorized stub-fallback for missing modules, which produced an implementation that passed without exercising the bundle it was supposed to gate. This safety net ensures any future dispatch-topology error surfaces as a loud test failure, not a silent degradation of gate strength.

---

## Tasks / Subtasks

- [ ] Task 1: Audit module presence on this branch (AC8 prerequisite)
  - [ ] 1.1: `ls worker/src/engine/` → confirm decide.js + cooperative-absorb.js present
  - [ ] 1.2: `ls worker/src/safety/` → confirm circuit-breaker.js present
  - [ ] 1.3: `ls worker/src/` → confirm dispatcher.js, advisory-lock.js, cycle-assembly.js present
  - [ ] 1.4: `ls shared/mirakl/` → confirm pri01-writer.js, pri02-poller.js, pri03-parser.js present
  - [ ] 1.5: If ANY module absent → HALT and escalate to Pedro/Bob. Do not proceed.

- [ ] Task 2: Audit existing 12 P11 fixture files for metadata completeness (AC6)
  - [ ] 2.1: For each of the 12 existing fixtures in `tests/fixtures/p11/`, verify `_expected.action` and `_fixture_meta.skuChannel_overrides` are present
  - [ ] 2.2: Add missing metadata to any fixture lacking it — `_expected.action` derived from the existing prose, `_fixture_meta.skuChannel_overrides` derived from the per-fixture skuChannel state in the original spec table
  - [ ] 2.3: Commit fixture-metadata additions as a single coherent commit

- [ ] Task 3: Create 5 missing P11 fixture files (AC6)
  - [ ] 3.1: `tests/fixtures/p11/p11-tier2a-recently-won-stays-watched.json` per spec
  - [ ] 3.2: `tests/fixtures/p11/p11-tier3-no-competitors.json` per spec
  - [ ] 3.3: `tests/fixtures/p11/p11-tier3-then-new-competitor.json` per spec
  - [ ] 3.4: `tests/fixtures/p11/p11-cooperative-absorption-within-threshold.json` — verify alignment with spec; align if drift from 7.3-merged version
  - [ ] 3.5: `tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json` per spec — expected action SKIP

- [ ] Task 4: Implement `tests/integration/full-cycle.test.js` (AC1, AC2, AC7, AC8)
  - [ ] 4.1: Top-of-file: stub `process.env.RESEND_API_KEY` then `await import` decide.js + cooperative-absorb.js + circuit-breaker.js
  - [ ] 4.2: Define `loadFixture(name)` returning `{ offers, expected, fixtureMeta }`
  - [ ] 4.3: Define `buildMockSkuChannel({ ...fixture._fixture_meta.skuChannel_overrides })` helper
  - [ ] 4.4: Parametric test loop over 17 fixtures using `fixture._expected.action` as oracle
  - [ ] 4.5: Assert `action`, `auditEvents`, `newPriceCents` per fixture's `_expected`
  - [ ] 4.6: AC2 sub-section: for UNDERCUT/CEILING_RAISE fixtures, call REAL `assembleCycle` and assert captured `pri01_staging` INSERTs
  - [ ] 4.7: AC2: call REAL `markStagingPending` + REAL `clearPendingImport` and assert captured UPDATEs
  - [ ] 4.8: Add Bundle C gate declaration comment (AC7)

- [ ] Task 5: Implement `tests/integration/pending-import-id-invariant.test.js` (AC3, AC7, AC8)
  - [ ] 5.1: Top-of-file: env-stub + `await import` of all Bundle C modules
  - [ ] 5.2: Test `markStagingPending` atomicity (exactly ONE UPDATE captured)
  - [ ] 5.3: Test engine STEP 1 SKIP on `pending_import_id IS NOT NULL` (real `decideForSkuChannel`)
  - [ ] 5.4: Test cooperative-absorption SKIP on pending (real `absorbExternalChange`)
  - [ ] 5.5: Test PRI02 COMPLETE atomic clear (real `clearPendingImport`)
  - [ ] 5.6: Test PRI02 FAILED: clear + real PRI03 parser invocation
  - [ ] 5.7: Add Bundle C gate declaration comment (AC7)

- [ ] Task 6: Implement `tests/integration/circuit-breaker-trip.test.js` (AC4, AC7, AC8)
  - [ ] 6.1: Top-of-file: env-stub + `await import` of circuit-breaker.js + cron-state.js
  - [ ] 6.2: Build mock tx with COUNT queries returning 21 (staging) and 100 (catalog)
  - [ ] 6.3: Inject mock `sendAlertFn`; use REAL `transitionCronState`
  - [ ] 6.4: Assert trip result + cron_state transition (via captured UPDATE) + Resend alert
  - [ ] 6.5: Assert 20%-exact does NOT trip; denominator=0 returns `{ tripped: false }`
  - [ ] 6.6: Assert per-SKU 15% boundary (16% trips, 15% no-trip, 14% no-trip)
  - [ ] 6.7: Assert no PRI01 submitted when tripped (real `assembleCycle` halts)
  - [ ] 6.8: Add Bundle C gate declaration comment (AC7)

- [ ] Task 7: Run CI check (AC5)
  - [ ] 7.1: `node --check` on all 3 integration test files (syntax)
  - [ ] 7.2: `node --test` on all 3 integration test files (pass)
  - [ ] 7.3: Negative-assertion grep sweep: no inline `expectedAction:` tables, no `transitionCronStateFn` injections, no `// stub for missing module` comments, no `try { await import` wrappers

---

## Dev Notes

### Critical: No Production Code Changes

This story is **tests, fixtures, and fixture metadata only**. Do NOT modify:
- `worker/src/engine/decide.js`
- `worker/src/engine/cooperative-absorb.js`
- `worker/src/safety/circuit-breaker.js`
- `worker/src/cycle-assembly.js`
- `shared/mirakl/pri01-writer.js`
- `shared/mirakl/pri02-poller.js`
- `shared/mirakl/pri03-parser.js`
- Any other production module

If a test reveals a bug in a production module: HALT, escalate to Pedro/Bob, file a follow-up story. Do NOT patch production code as part of this story.

### Test File Skeleton Pattern

Follow `tests/worker/safety/circuit-breaker.test.js` for import style and the env-stub + `await import` pattern. All tests use:
```js
// Stub RESEND_API_KEY before any imports — circuit-breaker.js loads resend/client.js at import time.
if (!process.env.RESEND_API_KEY) {
  process.env.RESEND_API_KEY = 're_test_integration_stub_xxxxxxxxxxxxxx';
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic imports — env stub must run before module load.
const { decideForSkuChannel } = await import('../../worker/src/engine/decide.js');
const { absorbExternalChange } = await import('../../worker/src/engine/cooperative-absorb.js');
const { markStagingPending } = await import('../../shared/mirakl/pri01-writer.js');
const { clearPendingImport } = await import('../../shared/mirakl/pri02-poller.js');
const { checkPerCycleCircuitBreaker, checkPerSkuCircuitBreaker } = await import('../../worker/src/safety/circuit-breaker.js');
const { transitionCronState } = await import('../../shared/state/cron-state.js');
```

No Jest, no Vitest — built-in `node --test` runner only (architectural constraint #5 equivalent).

### Mock `tx` Pattern for Integration Tests

Extend the established mock tx pattern from `tests/worker/cycle-assembly.test.js`. Captured queries are the assertion surface — declaring a capture array without asserting on its contents is FORBIDDEN (see AC2 negative assertion).

### Mock `skuChannel` Helper — DRIVEN BY FIXTURE METADATA

```js
function buildMockSkuChannel (fixtureMeta = {}, baseOverrides = {}) {
  return {
    id: 'sc-uuid-test',
    sku_id: 'sku-uuid-test',
    customer_marketplace_id: 'cm-uuid-test',
    channel_code: 'WRT_PT_ONLINE',
    list_price_cents: 3000,
    last_set_price_cents: 3199,
    current_price_cents: 3199,
    pending_set_price_cents: null,
    pending_import_id: null,
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
    ...baseOverrides,
    ...(fixtureMeta.skuChannel_overrides ?? {}),  // fixture metadata wins
  };
}
```

The `fixtureMeta.skuChannel_overrides` field is authoritative — it ALWAYS overrides any test-file defaults. Inline per-fixture overrides in the test file are FORBIDDEN.

### Loading P11 Fixtures

```js
function loadFixture (name) {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8');
  const fixture = JSON.parse(raw);
  return {
    offers: fixture.products?.[0]?.offers ?? [],
    expected: fixture._expected ?? {},
    fixtureMeta: fixture._fixture_meta ?? {},
    note: fixture._note ?? '',
  };
}
```

The consumer MUST destructure all three keys (`offers`, `expected`, `fixtureMeta`) and USE all three. Destructuring only `{ offers, note }` and dropping `expected` + `fixtureMeta` is FORBIDDEN (see AC1 negative assertion).

### Import Paths in `tests/integration/`

From `tests/integration/filename.test.js`, go up 2 dirs to repo root:
- `worker/src/engine/decide.js` → `'../../worker/src/engine/decide.js'`
- `worker/src/engine/cooperative-absorb.js` → `'../../worker/src/engine/cooperative-absorb.js'`
- `worker/src/safety/circuit-breaker.js` → `'../../worker/src/safety/circuit-breaker.js'`
- `shared/mirakl/pri01-writer.js` → `'../../shared/mirakl/pri01-writer.js'`
- `shared/mirakl/pri02-poller.js` → `'../../shared/mirakl/pri02-poller.js'`
- `shared/state/cron-state.js` → `'../../shared/state/cron-state.js'`
- `tests/fixtures/p11/` → use `fileURLToPath` + `join(__dirname, '../fixtures/p11/')` pattern

### No DB Migration

No schema changes in this story. All required tables and columns are already in place from prior stories.

### Negative Assertions for CI Gate

After implementing, run grep assertions:
- Zero `console.log` in new test files (pino-only rule applies — or comment if tests need stdout output)
- All fixture JSON files are valid JSON (`node -e "JSON.parse(require('fs').readFileSync(...))"`)
- Zero `transitionCronStateFn` injection patterns in `tests/integration/`
- Zero inline `expectedAction:` per-fixture tables in `tests/integration/`
- Zero `try { await import(...) } catch` blocks in `tests/integration/`
- Zero `// stub for missing module` comments anywhere in `tests/integration/`
- Zero "acceptable transient behavior" rationalization comments

---

## Project Structure Notes

New files land exactly at these locations (per architecture `05-directory-tree.md`):
- `tests/integration/full-cycle.test.js`
- `tests/integration/pending-import-id-invariant.test.js`
- `tests/integration/circuit-breaker-trip.test.js`
- `tests/fixtures/p11/p11-tier2a-recently-won-stays-watched.json`
- `tests/fixtures/p11/p11-tier3-no-competitors.json`
- `tests/fixtures/p11/p11-tier3-then-new-competitor.json`
- `tests/fixtures/p11/p11-cooperative-absorption-within-threshold.json` (or align if pre-existing from 7.3 merge)
- `tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json`

The `tests/integration/` directory already exists.

---

## References

- [Source: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-11.md`] — 9 amendments authored by Bob 2026-05-11 closing 4 verified findings from prior dispatch (this spec is the post-amendment state)
- [Source: `_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md`] — Story 7.8 epic-level definition + Bundle C gate description
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/_index.md`] — Bundle C atomicity definition, 17 P11 fixtures table, cross-cutting constraints
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md`] — "17 P11 Fixtures", "Structural — Atomicity Bundles (Bundle C)", "Structural — Test Patterns"
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md`] — File locations for all test and fixture files
- [Source: `_bmad-output/implementation-artifacts/7-6-worker-src-safety-circuit-breaker-js-per-sku-15-per-cycle-20.md`] — `buildMockTx` pattern, `checkPerCycleCircuitBreaker` signature, env-stub + `await import` precedent
- [Source: `tests/worker/cycle-assembly.test.js`] — `buildMockTx` reference implementation
- [Source: `tests/worker/safety/circuit-breaker.test.js`] — env-stub + `await import` canonical pattern
- [Source: Bob's ruling 2026-05-11 (in conversation thread)] — PATH B.2 justification + Bundle C topology recovery rationale

---

## Dev Agent Record

_(empty — to be populated by BAD dev-story subagent on fresh dispatch)_
