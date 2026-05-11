# Story 7.6: `worker/src/safety/circuit-breaker.js` — Per-SKU 15% + Per-Cycle 20%

> No Mirakl API endpoints are called by this story. All work is pure computation + DB queries + audit emission. No MCP verification required.

**Sprint-status key:** `7-6-worker-src-safety-circuit-breaker-js-per-sku-15-per-cycle-20`
**Status:** review
**Size:** M
**Epic:** 7 — Engine Decision & Safety
**Atomicity:** Bundle C (4/4) — AD11 circuit-breaker half; gate at Story 7.8

---

## Narrative

**As a** BAD subagent implementing the MarketPilot outbound circuit-breaker safety layer,
**I want** a `worker/src/safety/circuit-breaker.js` module exporting `checkPerSkuCircuitBreaker` (synchronous, called from engine STEP 5) and `checkPerCycleCircuitBreaker` (async, called from cycle-assembly after all per-SKU decisions) —
**So that** no single SKU can move more than 15% in one cycle (per-SKU cap), no single cycle can write more than 20% of the catalog (per-cycle cap), tripped cases pause the customer's marketplace via `transitionCronState`, the original Atenção event gets a `resolved_at` timestamp on manual unblock, and Story 7.8's integration gate can validate both caps end-to-end.

---

## Trace

- **Architecture decisions:** AD11 (with F6 amendment: per-cycle 20% denominator = marketplace's full active-SKU count), AD15 (cron_state machine), AD20 (audit event taxonomy)
- **Functional requirements:** FR26 (per-SKU 15% + per-cycle 20% circuit breakers), FR27 (circuit-breaker freeze + manual unblock)
- **F-amendments:** F6 — per-cycle 20% denominator is `sku_channels WHERE customer_marketplace_id = $id AND excluded_at IS NULL` (full active catalog), NOT the cycle's scheduled-SKU count
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md`, Story 7.6
- **Architecture patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` — "Structural — 11 SSoT Modules", "Structural — Atomicity Bundles"
- **Architecture decisions detail:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` — AD11 (full spec), AD15 (cron_state)

---

## SSoT Module Introduced

**`worker/src/safety/circuit-breaker.js`** — single source of truth for outbound circuit-breaker logic. Exports:
- `checkPerSkuCircuitBreaker({ skuChannel, newPriceCents, currentPriceCents })` — **synchronous**, returns `{ tripped: boolean, deltaPct: number }`
- `checkPerCycleCircuitBreaker({ tx, customerMarketplaceId, cycleId, writeAuditEventFn, sendAlertFn, transitionCronStateFn })` — **async**, returns `{ tripped: boolean }`

**No new ESLint rule** ships with this story.

---

## Bundle C Context

This is the 4th and final Bundle C story (6.1 → 7.2 → 7.3 → 7.6 → gate at Story 7.8). The worktree forks from `story-7.2-engine-decide-ad8-flow` (stacked dispatch: 7.6 builds directly on 7.2's engine without needing 7.3's cooperative-absorb).

**Two stubs this story replaces:**

### Stub 1: `decide.js` STEP 5 (per-SKU, lines 215-238)

```js
// From worker/src/engine/decide.js (Story 7.2, lines 215-238)
if (decisionAction === 'UNDERCUT' || decisionAction === 'CEILING_RAISE') {
  let cbResult = { tripped: false };
  try {
    const cbMod = await import('../safety/circuit-breaker.js');
    cbResult = cbMod.checkPerSkuCircuitBreaker({
      skuChannel,
      newPriceCents: candidateCents,
      currentPriceCents: skuChannel.current_price_cents,
    });
  } catch (err) {
    if (err && err.code !== 'ERR_MODULE_NOT_FOUND') {
      throw err;
    }
    logger.debug({ skuChannelId: skuChannel.id }, 'engine: per-SKU circuit-breaker stub (7.6 not shipped)');
  }
  if (cbResult.tripped) {
    return { action: 'HOLD', newPriceCents: null, auditEvents: [], reason: 'circuit-breaker' };
  }
}
```

**CRITICAL:** `checkPerSkuCircuitBreaker` is called **WITHOUT `await`** in decide.js. The function MUST be **synchronous**. The dynamic import itself is async but the function call is sync. Do NOT make `checkPerSkuCircuitBreaker` async or add `await` to the call — that would break the calling code.

When Story 7.6 ships `circuit-breaker.js`, the stub's `ERR_MODULE_NOT_FOUND` catch becomes unreachable — `checkPerSkuCircuitBreaker` is called directly. This is correct behavior.

**IMPORTANT:** decide.js returns `{ action: 'HOLD', auditEvents: [], reason: 'circuit-breaker' }` when per-SKU CB trips — `auditEvents: []` means the caller (cycle-assembly) does NOT emit the event. `checkPerSkuCircuitBreaker` must emit the `circuit-breaker-per-sku-trip` audit event and send the Resend alert **internally** (via injected dependencies or directly). The event emission happens inside `circuit-breaker.js`, NOT in decide.js.

### Stub 2: `cycle-assembly.js` per-cycle check (lines 69-74)

```js
// From worker/src/cycle-assembly.js (Story 7.2 update, lines 69-74)
const circuitBreakerCheck = opts.circuitBreakerCheck ?? (async (stagedCount) => {
  logger.debug(
    { stagedCount, cycleId, customerMarketplaceId },
    'cycle-assembly: circuit-breaker check (stub — Story 7.6)',
  );
});
// ...called at line 172:
await circuitBreakerCheck(stagedCount);
```

This story updates `cycle-assembly.js` to wire in the real `checkPerCycleCircuitBreaker` when `opts.circuitBreakerCheck` is not injected. The `circuitBreakerCheck` function receives only `stagedCount` in the current stub — Story 7.6 will need to update the signature to also pass `customerMarketplaceId` and `cycleId` (or refactor to use closures). See the "cycle-assembly.js update" section below.

---

## Dependencies (All Done / In-Review)

| Story | Status | What this story uses from it |
|-------|--------|------------------------------|
| 2.1 | done | `shared/db/tx.js` transaction helper; `shared/db/service-role-client.js` |
| 4.1 | done | `shared/state/cron-state.js` (`transitionCronState`) — circuit breaker trips via `PAUSED_BY_CIRCUIT_BREAKER` transition |
| 4.2 | done | `sku_channels` schema: `customer_marketplace_id`, `excluded_at` columns; `pri01_staging` schema: `cycle_id`, `flushed_at` columns |
| 4.6 | done | `shared/resend/client.js` (`sendCriticalAlert`) — sends alert on per-SKU and per-cycle trips |
| 5.2 | done | `worker/src/cycle-assembly.js` — circuit-breaker stub at lines 69-74; Story 7.6 updates this |
| 7.2 | review | `worker/src/engine/decide.js` STEP 5 stub — Story 7.6 activates it |
| 9.0 | done | `shared/audit/writer.js` (`writeAuditEvent`), `shared/audit/event-types.js` (`EVENT_TYPES.CIRCUIT_BREAKER_TRIP`, `EVENT_TYPES.CIRCUIT_BREAKER_PER_SKU_TRIP`) |
| 9.1 | done | Audit log priority trigger: `circuit-breaker-trip` → `atencao`, `circuit-breaker-per-sku-trip` → `atencao` |

**Enables (blocked on this story):**
- Story 7.8 (integration gate — per-cycle CB trip scenario + per-SKU 14% vs 16% tests)
- Story 8.5 (`/resume` endpoint that calls `transitionCronState PAUSED_BY_CIRCUIT_BREAKER → ACTIVE` + sets `resolved_at` on the trip event)

---

## Story 7.2 + 7.3 Learnings (Directly Applicable)

1. **ERR_MODULE_NOT_FOUND stub hardening (Step 7 review 2026-05-11):** The stubs in `decide.js` ONLY swallow `ERR_MODULE_NOT_FOUND`. Once a module ships, real runtime errors MUST propagate. `checkPerSkuCircuitBreaker` must not catch its own errors — throw freely.

2. **Import path from `worker/src/safety/`:** From `worker/src/safety/circuit-breaker.js`:
   - `shared/state/cron-state.js` → `'../../../shared/state/cron-state.js'`
   - `shared/audit/writer.js` → `'../../../shared/audit/writer.js'`
   - `shared/audit/event-types.js` → `'../../../shared/audit/event-types.js'`
   - `shared/resend/client.js` → `'../../../shared/resend/client.js'`
   - `shared/logger.js` → `'../../../shared/logger.js'`

3. **No raw audit INSERT:** Use `writeAuditEvent` from `shared/audit/writer.js`. The `no-raw-INSERT-audit-log` ESLint rule enforces this.

4. **No raw cron_state UPDATE:** Use `transitionCronState` from `shared/state/cron-state.js`. The `no-raw-UPDATE-cron-state` ESLint rule enforces this.

5. **Synchronous function in async context:** `checkPerSkuCircuitBreaker` is synchronous but the calling code is in an async function. The CB should emit audit events via `writeAuditEvent` which is async — but the decide.js STEP 5 calls it without `await`. **Solution:** `checkPerSkuCircuitBreaker` returns `{ tripped, deltaPct }` synchronously. The decide.js caller uses `tripped` but does NOT await any side effects. Audit event emission + Resend alert for per-SKU trips must happen differently — see "Per-SKU CB Emission Pattern" below.

6. **`event-types.js` PayloadForCircuitBreakerPerSkuTrip shape** (already shipped, must match exactly):
   ```js
   /** @typedef {object} PayloadForCircuitBreakerPerSkuTrip
    * @property {string} skuId
    * @property {number} failureCount
    * @property {string} cycleId
    */
   ```
   Note: this typedef uses `failureCount` and `cycleId`, NOT `deltaPct/attemptedNewPriceCents/currentPriceCents` as the epics distillate AC1 described. The **already-shipped `event-types.js` is the SSoT**. Match it exactly.

7. **`event-types.js` PayloadForCircuitBreakerTrip shape** (already shipped):
   ```js
   /** @typedef {object} PayloadForCircuitBreakerTrip
    * @property {number} affectedPct
    * @property {number} affectedCount
    * @property {string} cycleId
    */
   ```

8. **Worker must filter by customer:** All DB queries in `worker/src/safety/` MUST include `customer_marketplace_id` filter OR carry `// safe: cross-customer cron` comment. ESLint rule `worker-must-filter-by-customer` enforces this.

9. **node --check boot validation:** After implementing, run `node --check worker/src/safety/circuit-breaker.js` to catch import path errors before running tests.

---

## Per-SKU CB Emission Pattern

Because `checkPerSkuCircuitBreaker` is called **without await** in decide.js STEP 5, it cannot perform async operations internally. The pattern to handle this:

**Option A (recommended): Return-only, emit from caller**

`checkPerSkuCircuitBreaker` is pure — returns `{ tripped, deltaPct }`. When `tripped === true`, decide.js returns `{ action: 'HOLD', auditEvents: [], reason: 'circuit-breaker' }`. The circuit-breaker audit event is then emitted by cycle-assembly after the engine call returns.

To implement this, cycle-assembly must be updated to check `result.reason === 'circuit-breaker'` and emit the per-SKU CB audit event:

```js
// In cycle-assembly.js, after calling engine.decideForSkuChannel:
const { action, newPriceCents, auditEvents, reason } = await engine.decideForSkuChannel(decideParams);

if (action === 'HOLD' && reason === 'circuit-breaker') {
  // Per-SKU CB tripped — emit the Atenção event (decide.js returns auditEvents: [])
  await writeAuditEvent({
    tx,
    customerMarketplaceId,
    skuId: skuChannel.sku_id,
    skuChannelId: skuChannel.id,
    cycleId,
    eventType: EVENT_TYPES.CIRCUIT_BREAKER_PER_SKU_TRIP,
    payload: {
      skuId: skuChannel.sku_id,
      failureCount: 1,  // per-SKU CB is always first occurrence
      cycleId,
    },
  });
  // Also send Resend critical alert
  await sendCriticalAlert({ /* ... */ });
}
```

**This is the correct implementation.** The `checkPerSkuCircuitBreaker` function in `circuit-breaker.js` is pure computation:

```js
export function checkPerSkuCircuitBreaker ({ skuChannel, newPriceCents, currentPriceCents }) {
  const deltaPct = Math.abs(newPriceCents - currentPriceCents) / currentPriceCents;
  const tripped = deltaPct > 0.15;
  return { tripped, deltaPct };
}
```

The emission and alerting happen in cycle-assembly (or the caller), NOT inside circuit-breaker.js for the per-SKU case.

**This is a deliberate design choice:** keeping `checkPerSkuCircuitBreaker` pure (synchronous, no side effects) makes it trivially unit-testable and avoids async complexity in decide.js STEP 5.

---

## Per-Cycle CB Spec (Full)

`checkPerCycleCircuitBreaker` is **async** and called after all per-SKU decisions are staged. It performs DB queries, emits audit events, sends alerts, and transitions cron_state.

### Signature

```js
/**
 * Check the per-cycle 20% circuit breaker. Called by cycle-assembly after
 * all per-SKU decisions are computed, before flushing to PRI01 writer.
 *
 * @param {object} params
 * @param {object} params.tx - transaction-capable DB client
 * @param {string} params.customerMarketplaceId - UUID
 * @param {string} params.cycleId - UUID for this cycle
 * @param {Function} [params.sendAlertFn] - injected for testability (default: sendCriticalAlert)
 * @param {Function} [params.transitionCronStateFn] - injected for testability (default: transitionCronState)
 * @returns {Promise<{ tripped: boolean, numerator: number, denominator: number, affectedPct: number }>}
 */
export async function checkPerCycleCircuitBreaker ({
  tx,
  customerMarketplaceId,
  cycleId,
  sendAlertFn,
  transitionCronStateFn,
}) { ... }
```

**Note:** `writeAuditEventFn` is NOT a parameter because `transitionCronState` (the `ACTIVE → PAUSED_BY_CIRCUIT_BREAKER` transition) internally calls `writeAuditEvent` as part of its atomic state-transition + audit-emission pattern. The `circuit-breaker-trip` Atenção event is emitted by `transitionCronState`, NOT directly by `checkPerCycleCircuitBreaker`. Do NOT add a `writeAuditEventFn` parameter — it would be unused (ESLint unused-variable error) and would mislead implementors into double-emitting the event.

### Implementation Steps

1. **Count numerator:** `SELECT COUNT(*) FROM pri01_staging WHERE cycle_id = $cycleId AND flushed_at IS NULL`
   - `flushed_at IS NULL` = staged for write this cycle but not yet flushed
   - worker-must-filter-by-customer: `pri01_staging` has `customer_marketplace_id` — include it

2. **Count denominator (F6):** `SELECT COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $customerMarketplaceId AND excluded_at IS NULL`
   - Full active-SKU count for this marketplace (NOT the cycle's scheduled set)
   - This is the F6 amendment: prevents constant triggering on small-catalog excerpts

3. **Trip predicate:** `numerator / denominator > 0.20` (strict greater-than — exactly 20% does NOT trip)

4. **If NOT tripped:** Return `{ tripped: false, numerator, denominator, affectedPct }`. Cycle-assembly proceeds to flush via writer.

5. **If tripped (in ONE transaction via `tx`):**
   a. Call `transitionCronStateFn({ tx, customerMarketplaceId, from: 'ACTIVE', to: 'PAUSED_BY_CIRCUIT_BREAKER', context: { cycleId, numerator, denominator } })`
      - `transitionCronState` (per Story 4.1) performs the optimistic-concurrency UPDATE + looks up the per-transition audit event in the transitions-matrix and emits it via `writeAuditEvent`
      - The `(ACTIVE → PAUSED_BY_CIRCUIT_BREAKER)` transition IS in `LEGAL_CRON_TRANSITIONS` AND IS in the per-transition event map → emits `circuit-breaker-trip` Atenção automatically
      - Do NOT call `writeAuditEvent` separately for `circuit-breaker-trip` — `transitionCronState` already does it
   b. Call `sendAlertFn({ customerMarketplaceId, cycleId, numerator, denominator })` — Resend critical alert

6. **Return** `{ tripped: true, numerator, denominator, affectedPct: numerator / denominator }`.

**IMPORTANT:** `transitionCronState` already emits the `circuit-breaker-trip` event (it's in the per-transition event map for `ACTIVE → PAUSED_BY_CIRCUIT_BREAKER`). Do NOT double-emit by calling `writeAuditEventFn` separately.

---

## Manual Unblock — `resolved_at` Pattern (AC6)

When the customer clicks "Retomar manualmente" (Story 8.5 ships this route), the route calls:
```js
await transitionCronState({ tx, customerMarketplaceId, from: 'PAUSED_BY_CIRCUIT_BREAKER', to: 'ACTIVE', context: { manualUnblock: true } });
```

Per the architecture and epics spec (Story 7.6 AC6), the unblock route MUST ALSO:
1. Find the original `circuit-breaker-trip` audit_log row: `SELECT id FROM audit_log WHERE customer_marketplace_id = $id AND event_type = 'circuit-breaker-trip' AND cycle_id = $cycleId AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`
2. Set `resolved_at = NOW()` on it

**This `resolved_at` update is Story 8.5's responsibility** (the route that handles "Retomar manualmente"). Story 7.6 does NOT ship the unblock route — it only ships the circuit-breaker module. However, Story 7.6 MUST document the pattern in the module's JSDoc and test the resolved_at side of the invariant is respected by Story 8.5.

**Story 7.6 scope:** Verify in tests that:
- After per-cycle CB trip, `circuit-breaker-trip` audit_log row has `resolved_at IS NULL`
- The `(PAUSED_BY_CIRCUIT_BREAKER → ACTIVE)` transition IS in `LEGAL_CRON_TRANSITIONS` (Story 4.1) but is NOT in the per-transition event map (no event emitted on manual unblock per AD20 Q2 decision)

---

## cycle-assembly.js Update Spec

`cycle-assembly.js` must be updated to:

1. **Wire in real per-cycle CB** when `opts.circuitBreakerCheck` is not injected — replace the current log-only stub with a real call to `checkPerCycleCircuitBreaker`

2. **Wire in per-SKU CB event emission** when engine returns `reason: 'circuit-breaker'` (new logic block after engine call)

3. **Updated `assembleCycle` signature** (no change to external API, only internals):

```js
// At the top of assembleCycle, resolve circuit-breaker module
let checkPerCycleCircuitBreakerFn;
const circuitBreakerCheck = opts.circuitBreakerCheck ?? (async (stagedCount) => {
  if (!checkPerCycleCircuitBreakerFn) {
    const cbMod = await import('./safety/circuit-breaker.js');
    checkPerCycleCircuitBreakerFn = cbMod.checkPerCycleCircuitBreaker;
  }
  return checkPerCycleCircuitBreakerFn({
    tx,
    customerMarketplaceId,
    cycleId,
    sendAlertFn: async ({ customerMarketplaceId: cmId, cycleId: cId }) => {
      // sendCriticalAlert from shared/resend/client.js
      const { sendCriticalAlert } = await import('../../shared/resend/client.js');
      await sendCriticalAlert({ event: 'circuit-breaker-trip', customerMarketplaceId: cmId, cycleId: cId });
    },
    transitionCronStateFn: transitionCronState,
  });
});
```

Alternatively, use dependency injection cleanly — the simplest approach is to have `checkPerCycleCircuitBreaker` accept its dependencies as optional params with sensible defaults (already in signature above). Then cycle-assembly simply calls:

```js
// Simpler: just import and call with tx + IDs; CB resolves its own deps
await checkPerCycleCircuitBreaker({ tx, customerMarketplaceId, cycleId });
```

But this requires `checkPerCycleCircuitBreaker` to import from SSoT modules directly (not injectable). **For testability, use the injected pattern.** Tests inject mock `writeAuditEventFn`, `sendAlertFn`, and `transitionCronStateFn`.

**Also add per-SKU CB event emission to cycle-assembly:**

```js
// After engine.decideForSkuChannel returns:
const { action, newPriceCents, auditEvents, reason } = await engine.decideForSkuChannel(decideParams);

// Per-SKU circuit-breaker trip — decide.js returns auditEvents:[] for CB trips;
// cycle-assembly is responsible for emitting the Atenção event.
if (action === 'HOLD' && reason === 'circuit-breaker') {
  await writeAuditEvent({
    tx,
    customerMarketplaceId,
    skuId: skuChannel.sku_id,
    skuChannelId: skuChannel.id,
    cycleId,
    eventType: EVENT_TYPES.CIRCUIT_BREAKER_PER_SKU_TRIP,
    payload: {
      skuId: skuChannel.sku_id,
      failureCount: 1,
      cycleId,
    },
  });
  // Resend critical alert for per-SKU trip
  await sendCriticalAlertForPerSkuTrip({ customerMarketplaceId, skuChannelId: skuChannel.id, cycleId });
}
```

`EVENT_TYPES` must be imported from `../../shared/audit/event-types.js` in cycle-assembly.js.

---

## File-Touch List

### New files

| File | Purpose |
|------|---------|
| `worker/src/safety/circuit-breaker.js` | SSoT circuit-breaker: `checkPerSkuCircuitBreaker` (sync) + `checkPerCycleCircuitBreaker` (async) — AD11 |
| `tests/worker/safety/circuit-breaker.test.js` | Unit + integration tests covering both caps + manual-unblock invariant |

### Modified files

| File | Change |
|------|--------|
| `worker/src/cycle-assembly.js` | Wire in real per-cycle CB (replace log-only stub); add per-SKU CB event emission when `reason === 'circuit-breaker'` |
| `worker/src/engine/decide.js` | No changes needed — STEP 5 stub already loads `circuit-breaker.js` via dynamic import with ERR_MODULE_NOT_FOUND catch. When this story ships the module, the stub auto-activates. |

Note: `worker/src/engine/decide.js` requires NO code changes. The stub at lines 215-238 already calls `checkPerSkuCircuitBreaker` correctly. When `circuit-breaker.js` exists, the `ERR_MODULE_NOT_FOUND` catch becomes unreachable.

---

## Acceptance Criteria

### AC1 — `checkPerSkuCircuitBreaker` — synchronous, pure, 15% trip

**Given** `checkPerSkuCircuitBreaker({ skuChannel, newPriceCents, currentPriceCents })` exported from `worker/src/safety/circuit-breaker.js`
**When** called (synchronously, no await) from engine STEP 5
**Then**:
- Computes `deltaPct = Math.abs(newPriceCents - currentPriceCents) / currentPriceCents`
- Returns `{ tripped: true, deltaPct }` when `deltaPct > 0.15`
- Returns `{ tripped: false, deltaPct }` when `deltaPct <= 0.15` (exactly 0.15 does NOT trip — strict `>`)
- Function is **synchronous** (no async, no await, no Promise returned)
- No side effects: no DB writes, no audit events, no Resend calls (all side effects happen in cycle-assembly)

### AC2 — `checkPerCycleCircuitBreaker` — async, DB queries, 20% trip

**Given** `checkPerCycleCircuitBreaker({ tx, customerMarketplaceId, cycleId, sendAlertFn, transitionCronStateFn })` called from cycle-assembly after all SKU decisions are staged
**When** the function executes
**Then**:

**Trip predicate (F6 amendment):**
- `numerator = SELECT COUNT(*) FROM pri01_staging WHERE cycle_id = $cycleId AND flushed_at IS NULL AND customer_marketplace_id = $customerMarketplaceId`
- `denominator = SELECT COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $customerMarketplaceId AND excluded_at IS NULL`
- Trip when `numerator / denominator > 0.20` (strict greater-than; exactly 20% = NOT tripped)

**If NOT tripped:**
- Returns `{ tripped: false, numerator, denominator, affectedPct }`
- Cycle-assembly proceeds to flush staging to writer (PRI01 submitted)

**If tripped (all steps in ONE transaction via `tx`):**
- Calls `transitionCronStateFn({ tx, customerMarketplaceId, from: 'ACTIVE', to: 'PAUSED_BY_CIRCUIT_BREAKER', context: { cycleId, numerator, denominator } })`
  - This performs the cron_state UPDATE + emits `circuit-breaker-trip` Atenção audit event automatically (per Story 4.1 per-transition map)
  - Do NOT call `writeAuditEventFn` separately — would double-emit
- Calls `sendAlertFn({ customerMarketplaceId, cycleId, numerator, denominator })` — Resend critical alert
- Returns `{ tripped: true, numerator, denominator, affectedPct: numerator / denominator }`

### AC3 — cycle-assembly updated: per-SKU CB event emission

**Given** `worker/src/cycle-assembly.js` is updated
**When** engine returns `{ action: 'HOLD', auditEvents: [], reason: 'circuit-breaker' }` (per-SKU CB tripped)
**Then** cycle-assembly emits `EVENT_TYPES.CIRCUIT_BREAKER_PER_SKU_TRIP` Atenção audit event with payload:
```js
{
  skuId: skuChannel.sku_id,
  failureCount: 1,  // per-SKU CB always fires on first occurrence
  cycleId,
}
```
**And** sends a Resend critical alert for the per-SKU trip

### AC4 — cycle-assembly updated: per-cycle CB wired

**Given** `worker/src/cycle-assembly.js` is updated with the real per-cycle CB
**When** `opts.circuitBreakerCheck` is NOT injected (production mode)
**Then** cycle-assembly calls `checkPerCycleCircuitBreaker` with the correct `tx`, `customerMarketplaceId`, `cycleId` from the current closure
**And** if CB trips, cycle-assembly does NOT proceed to flush staging (no PRI01 emitted this cycle)
**And** the existing `tests/worker/cycle-assembly.test.js` continues to pass after the update

### AC5 — Unit tests for both caps

**Given** `tests/worker/safety/circuit-breaker.test.js`
**When** I run `node --test tests/worker/safety/circuit-breaker.test.js`
**Then** tests cover:

**Per-SKU cap:**
- `deltaPct = 0.14` → NOT tripped (below threshold)
- `deltaPct = 0.15` → NOT tripped (exactly 0.15, strict `>` not met)
- `deltaPct = 0.16` → tripped
- `deltaPct = 0.151` → tripped (boundary just above 15%)
- `newPriceCents < currentPriceCents` (price DROP) → also uses `Math.abs` → same rule applies

**Per-cycle cap:**
- `numerator/denominator = 0.20` → NOT tripped
- `numerator/denominator = 0.21` → tripped → `transitionCronStateFn` called with `{ from: 'ACTIVE', to: 'PAUSED_BY_CIRCUIT_BREAKER' }` → `sendAlertFn` called
- `numerator = 0, denominator = 100` → NOT tripped (affectedPct = 0)
- `denominator = 0` (edge case: marketplace with no active SKUs) → guard against division by zero → return `{ tripped: false }` (cannot trip if no catalog)

**Manual unblock invariant:**
- After a trip, the `(PAUSED_BY_CIRCUIT_BREAKER → ACTIVE)` transition is in `LEGAL_CRON_TRANSITIONS` (verify by importing the transitions matrix)
- `(PAUSED_BY_CIRCUIT_BREAKER → ACTIVE)` is NOT in the per-transition event map (no event emitted on unblock — per AD20 Q2 decision)

### AC6 — `resolved_at` documentation

**Given** the Story 7.6 module's JSDoc on `checkPerCycleCircuitBreaker`
**When** it documents the manual-unblock path
**Then** the JSDoc includes a note: *"Manual unblock (Story 8.5): after transitionCronState PAUSED_BY_CIRCUIT_BREAKER → ACTIVE, the unblock route sets resolved_at = NOW() on the original circuit-breaker-trip audit_log row for this cycle. This mirrors the anomaly-freeze resolved_at pattern (Story 7.4)."*

### AC7 — Negative assertions

**Given** `worker/src/safety/circuit-breaker.js`
**When** I grep the file
**Then**:
- Zero matches for `INSERT INTO audit_log` (raw audit insert forbidden — ESLint `no-raw-INSERT-audit-log`)
- Zero matches for `UPDATE customer_marketplaces SET cron_state` (forbidden — ESLint rule)
- Zero matches for `console.log` (pino only)
- Zero float-price math (no `.toFixed(2)`, no `* 100`, no `/ 100` on price-like variables)
- `checkPerSkuCircuitBreaker` has NO `async` keyword and no `await`

---

## Implementation Notes

### `worker/src/safety/circuit-breaker.js` skeleton

```js
// worker/src/safety/circuit-breaker.js
// AD11 — Outbound circuit breaker: per-SKU 15% + per-cycle 20%.
// F6 amendment: per-cycle denominator = full active-SKU count, NOT cycle's scheduled set.
//
// ARCHITECTURE CONTRACTS:
//   checkPerSkuCircuitBreaker — SYNCHRONOUS (no async). Called from engine STEP 5 without await.
//   checkPerCycleCircuitBreaker — async. Called by cycle-assembly after all per-SKU decisions.
//   Side effects (audit events, Resend alerts, cron_state transitions) happen via injected deps.
//   No raw SQL state updates — use transitionCronState (shared/state/cron-state.js).
//   No raw audit inserts — use writeAuditEvent (shared/audit/writer.js).

import { transitionCronState as _transitionCronState } from '../../../shared/state/cron-state.js';
import { sendCriticalAlert as _sendCriticalAlert } from '../../../shared/resend/client.js';
import { createWorkerLogger } from '../../../shared/logger.js';

// NOTE: writeAuditEvent is NOT imported here. The circuit-breaker-trip Atenção event
// is emitted internally by transitionCronState (ACTIVE → PAUSED_BY_CIRCUIT_BREAKER).
// Importing writeAuditEvent and calling it would double-emit the event.

const logger = createWorkerLogger();

/**
 * Check the per-SKU 15% circuit breaker.
 * SYNCHRONOUS — no side effects, no async. Called from engine STEP 5 without await.
 *
 * @param {object} params
 * @param {object} params.skuChannel - sku_channels row (used for context logging)
 * @param {number} params.newPriceCents - proposed new price (integer cents)
 * @param {number} params.currentPriceCents - current price (integer cents)
 * @returns {{ tripped: boolean, deltaPct: number }}
 */
export function checkPerSkuCircuitBreaker ({ skuChannel, newPriceCents, currentPriceCents }) {
  const deltaPct = Math.abs(newPriceCents - currentPriceCents) / currentPriceCents;
  const tripped = deltaPct > 0.15;
  if (tripped) {
    logger.warn(
      { skuChannelId: skuChannel.id, deltaPct, newPriceCents, currentPriceCents },
      'circuit-breaker: per-SKU 15% tripped',
    );
  }
  return { tripped, deltaPct };
}

/**
 * Check the per-cycle 20% circuit breaker.
 * Called by cycle-assembly after all per-SKU decisions are staged, before PRI01 flush.
 *
 * F6 amendment: denominator = full active-SKU count for marketplace, NOT cycle's scheduled set.
 *
 * Manual unblock (Story 8.5): after transitionCronState PAUSED_BY_CIRCUIT_BREAKER → ACTIVE,
 * the unblock route sets resolved_at = NOW() on the original circuit-breaker-trip audit_log row
 * for this cycle. This mirrors the anomaly-freeze resolved_at pattern (Story 7.4).
 *
 * @param {object} params
 * @param {object} params.tx - transaction-capable DB client
 * @param {string} params.customerMarketplaceId - UUID
 * @param {string} params.cycleId - UUID for this cycle
 * @param {Function} [params.sendAlertFn] - injectable for testing (default: sendCriticalAlert)
 * @param {Function} [params.transitionCronStateFn] - injectable for testing (default: transitionCronState)
 * @returns {Promise<{ tripped: boolean, numerator: number, denominator: number, affectedPct: number }>}
 */
export async function checkPerCycleCircuitBreaker ({
  tx,
  customerMarketplaceId,
  cycleId,
  sendAlertFn = _sendCriticalAlert,
  transitionCronStateFn = _transitionCronState,
}) {
  // Numerator: staged rows for this cycle not yet flushed
  const { rows: numRows } = await tx.query(
    'SELECT COUNT(*)::int AS count FROM pri01_staging WHERE cycle_id = $1 AND flushed_at IS NULL AND customer_marketplace_id = $2',
    [cycleId, customerMarketplaceId],
  );
  const numerator = numRows[0].count;

  // Denominator (F6): full active-SKU count for this marketplace
  const { rows: denRows } = await tx.query(
    'SELECT COUNT(*)::int AS count FROM sku_channels WHERE customer_marketplace_id = $1 AND excluded_at IS NULL',
    [customerMarketplaceId],
  );
  const denominator = denRows[0].count;

  // Guard: no active SKUs → cannot trip (affectedPct = 0)
  if (denominator === 0) {
    logger.debug({ customerMarketplaceId, cycleId }, 'circuit-breaker: per-cycle check skipped — no active SKUs');
    return { tripped: false, numerator, denominator, affectedPct: 0 };
  }

  const affectedPct = numerator / denominator;
  const tripped = affectedPct > 0.20;

  if (!tripped) {
    logger.debug({ customerMarketplaceId, cycleId, numerator, denominator, affectedPct }, 'circuit-breaker: per-cycle OK');
    return { tripped: false, numerator, denominator, affectedPct };
  }

  // Per-cycle CB tripped — pause marketplace + send alert
  logger.warn({ customerMarketplaceId, cycleId, numerator, denominator, affectedPct }, 'circuit-breaker: per-cycle 20% tripped — pausing marketplace');

  // transitionCronState atomically: UPDATE cron_state + emits circuit-breaker-trip Atenção event
  // (ACTIVE → PAUSED_BY_CIRCUIT_BREAKER is in per-transition event map in Story 4.1)
  await transitionCronStateFn({
    tx,
    customerMarketplaceId,
    from: 'ACTIVE',
    to: 'PAUSED_BY_CIRCUIT_BREAKER',
    context: { cycleId, numerator, denominator },
  });

  await sendAlertFn({
    event: 'circuit-breaker-trip',
    customerMarketplaceId,
    cycleId,
    numerator,
    denominator,
  });

  return { tripped: true, numerator, denominator, affectedPct };
}
```

### Import path cross-check

`worker/src/safety/circuit-breaker.js` depth from repo root: `worker/src/safety/` = 3 directories deep.
- `shared/` is at repo root: `../../../shared/`
- Correct paths:
  - `shared/state/cron-state.js` → `'../../../shared/state/cron-state.js'`
  - `shared/audit/writer.js` → `'../../../shared/audit/writer.js'`
  - `shared/audit/event-types.js` → `'../../../shared/audit/event-types.js'`
  - `shared/resend/client.js` → `'../../../shared/resend/client.js'`
  - `shared/logger.js` → `'../../../shared/logger.js'`

Run `node --check worker/src/safety/circuit-breaker.js` after implementation to catch import path errors.

### Test structure for `tests/worker/safety/circuit-breaker.test.js`

```js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkPerSkuCircuitBreaker, checkPerCycleCircuitBreaker } from '../../../worker/src/safety/circuit-breaker.js';

// Mock skuChannel builder
function makeSkuChannel (overrides = {}) {
  return { id: 'sc-test-uuid', sku_id: 'sku-test-uuid', customer_marketplace_id: 'cm-test-uuid', ...overrides };
}

// Mock tx builder for per-cycle tests
function makeMockTx ({ numerator = 0, denominator = 100 } = {}) {
  return {
    query: async (sql) => {
      if (sql.includes('pri01_staging')) return { rows: [{ count: numerator }] };
      if (sql.includes('sku_channels')) return { rows: [{ count: denominator }] };
      return { rows: [] };
    },
  };
}
```

### `transitionCronState` LEGAL_CRON_TRANSITIONS check

To verify the `PAUSED_BY_CIRCUIT_BREAKER → ACTIVE` transition exists in the matrix, import it:
```js
import { LEGAL_CRON_TRANSITIONS } from '../../../shared/state/transitions-matrix.js';
// Test: assert LEGAL_CRON_TRANSITIONS['PAUSED_BY_CIRCUIT_BREAKER']?.includes('ACTIVE')
```

---

## Out of Scope for This Story

- `/resume` endpoint for manual unblock → **Story 8.5** (ships `transitionCronState PAUSED_BY_CIRCUIT_BREAKER → ACTIVE` + `resolved_at` update)
- Integration gate → **Story 7.8** (synthesizes 21% catalog scenario against full cycle stack)
- Anomaly-freeze logic → **Story 7.3** (cooperative-absorb) + **Story 7.4** (freeze/unfreeze routes)
- Per-SKU tier classification → **Story 7.5** (applyTierClassification)
- Reconciliation pass → **Story 7.7**
- Customer-facing circuit-breaker dashboard banner → **Story 8.8** (UX4 banner library)
- Anomaly review modal → **Story 8.7**
- Any DB migration — no schema changes in this story (all required columns already exist)
- DRY_RUN mode circuit-breaker behavior — engine is bypassed in DRY_RUN (cron_state ≠ ACTIVE); no CB logic needed

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Completion Notes List

- Implemented `worker/src/safety/circuit-breaker.js` with two exports:
  - `checkPerSkuCircuitBreaker` — pure synchronous function (no async, no side effects). Returns `{ tripped, deltaPct }`. Called from engine STEP 5 without await. Caller (cycle-assembly) emits the audit event and Resend alert when tripped.
  - `checkPerCycleCircuitBreaker` — async. Queries `pri01_staging` (numerator) and `sku_channels` (denominator, F6 amendment). Trips when `numerator/denominator > 0.20` (strict >). On trip: calls `transitionCronStateFn(ACTIVE → PAUSED_BY_CIRCUIT_BREAKER)` then `sendAlertFn`. Both fns are injectable for testing. Division-by-zero guard: returns `{ tripped: false }` when denominator=0.
- Updated `worker/src/cycle-assembly.js`:
  - Added `import { EVENT_TYPES }` from event-types.js
  - Updated Story 7.6 comments in file header
  - Replaced log-only `circuitBreakerCheck` stub with real `checkPerCycleCircuitBreaker` (lazy dynamic import, uses closure tx/customerMarketplaceId/cycleId)
  - Added per-SKU CB trip detection: when engine returns `{ action: 'HOLD', reason: 'circuit-breaker' }`, cycle-assembly emits `CIRCUIT_BREAKER_PER_SKU_TRIP` audit event + Resend critical alert, then `continue`s (heldCount++)
- Updated `tests/worker/cycle-assembly.test.js`:
  - `buildMockTx` enhanced: returns `{ rows: [{ count: 0 }] }` for SELECT COUNT queries, enabling the real per-cycle CB to be called in existing tests without tripping (0/0 denominator guard)
- All 23 circuit-breaker tests pass (per-SKU + per-cycle + manual-unblock invariant + negative assertions)
- All 11 cycle-assembly tests pass (no regressions)
- Pre-existing failures: Story 7.2 fixtures 4/6 (pre-existing on this branch), ESLint no-direct-fetch (pre-existing), margin/dry-run-minimal route tests (pre-existing). Zero new failures introduced.

### File List

- `worker/src/safety/circuit-breaker.js` (new)
- `tests/worker/safety/circuit-breaker.test.js` (pre-existing ATDD, unchanged — all tests pass)
- `worker/src/cycle-assembly.js` (modified — per-SKU CB event emission + per-cycle CB wiring)
- `tests/worker/cycle-assembly.test.js` (modified — buildMockTx SELECT COUNT support)

### Change Log

- 2026-05-11: Story 7.6 spec created by Bob (bmad-create-story). Worktree forked from story-7.2-engine-decide-ad8-flow (Bundle C stacked dispatch). No Mirakl endpoints. event-types.js PayloadForCircuitBreakerPerSkuTrip shape reconciled against shipped SSoT (failureCount/cycleId, not deltaPct/prices). checkPerSkuCircuitBreaker confirmed synchronous from decide.js STEP 5 call site.
- 2026-05-11: Implementation complete by dev agent (claude-sonnet-4-6). AC1–AC7 satisfied. 23/23 circuit-breaker tests pass. 11/11 cycle-assembly tests pass. No new regressions.
