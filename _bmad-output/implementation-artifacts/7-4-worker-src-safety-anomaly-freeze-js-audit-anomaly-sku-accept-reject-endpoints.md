# Story 7.4: worker/src/safety/anomaly-freeze.js + /audit/anomaly/:sku/{accept|reject} endpoints

Status: ready-for-dev

<!-- Sharded 2026-05-13 by Bob (`bmad-create-story`) per Bundle C close-out retro §12 Session 3 + W6 decision -->
<!-- Source: _bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md Story 7.4 + bundle-c-close-out-retro-2026-05-13.md §W6 + deferred-work.md lines 416-417 (PR #91 Findings 1+2) -->
<!-- NOT a Bundle C participant — not in bundle_dispatch_orders or merge_blocks. Solo dispatch from main. Ships BEFORE Stories 7.5 + 7.7 per retro §12 Session 3 ordering. -->

## Story

As **the maintainer of the AD12 per-SKU anomaly-freeze contract**,
I want **`worker/src/safety/anomaly-freeze.js` shipped as the real freeze SSoT (replacing the no-op stub-fallback in cooperative-absorb.js), plus the customer accept/reject endpoints at `/audit/anomaly/:skuChannelId/{accept|reject}`, plus the fixture oracle flipped from `null` to `'anomaly-freeze'`**,
so that **anomaly events emit real Atenção audit rows + real critical alerts, customers can resolve frozen SKUs from the dashboard, and the Bundle C atomicity gate positively verifies the freeze-event emission instead of silently passing on a no-op stub.**

---

## Acceptance Criteria

> **Bundle C invariant guard** (non-negotiable across all ACs): the 3 Bundle C integration test files MUST remain green after this story lands. Count expands from 47 → ≥48 (one new positive assertion on `anomaly-freeze` emission in `full-cycle.test.js` per AC4).
> - [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js)
> - [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js)
> - [tests/integration/circuit-breaker-trip.test.js](tests/integration/circuit-breaker-trip.test.js)
>
> If any change in this story turns one of these red, STOP and re-shape — the freeze cut-over is not allowed to widen the Bundle C regression surface.

### AC1 — Ship `worker/src/safety/anomaly-freeze.js` as the AD12 SSoT module

**Given** `worker/src/safety/anomaly-freeze.js` does not yet exist on `main` (verified — only `worker/src/safety/circuit-breaker.js` is present),

**When** I create the module with three exported functions per epic Story 7.4 AC#1/#2/#3 contract,

**Then** the module exports:

- `freezeSkuForReview({ tx, skuChannelId, skuId, customerMarketplaceId, deviationPct, currentPriceCents, listPriceCents, customerEmail })`
  - In ONE transaction (caller-supplied `tx`): `UPDATE sku_channels SET frozen_for_anomaly_review = true, frozen_at = NOW(), frozen_deviation_pct = $deviationPct WHERE id = $skuChannelId`.
  - Emits `EVENT_TYPES.ANOMALY_FREEZE` Atenção audit event via `writeAuditEvent({ tx, customerMarketplaceId, skuId, skuChannelId, eventType, payload })` (SSoT path — never `INSERT INTO audit_log` directly, enforced by `no-raw-INSERT-audit-log` ESLint rule).
  - Payload shape MUST match `PayloadForAnomalyFreeze` @typedef in [shared/audit/event-types.js:91-96](shared/audit/event-types.js#L91-L96): `{ previousListPriceCents: listPriceCents, suspectedListPriceCents: currentPriceCents, deviationPct, skuId }`. Any deviation from this shape throws `NullAuditPayloadError` or fails the audit-writer guard.
  - The audit row's `resolved_at` is NULL on emission (it is later set by `unfreezeSkuAfter{Accept,Reject}` per AD12 + AC5/AC6).
  - AFTER the transaction commits (NOT inside `tx`), calls `sendCriticalAlert({ to: customerEmail, subject, html })` from [shared/resend/client.js:59](shared/resend/client.js#L59). Resend errors are caught + logged by `sendCriticalAlert` itself (best-effort per AD25); freeze success is not gated on email delivery. Critical alert delivery target ≤5 min per NFR-P9.
  - Returns `{ frozen: true, auditId }`.

- `unfreezeSkuAfterAccept({ tx, skuChannelId })`
  - In ONE transaction: `UPDATE sku_channels SET list_price_cents = current_price_cents, frozen_for_anomaly_review = false, frozen_at = NULL, frozen_deviation_pct = NULL WHERE id = $skuChannelId AND frozen_for_anomaly_review = true RETURNING customer_marketplace_id, sku_id`.
  - If `rowCount === 0` (already-unfrozen / wrong tenant / non-existent) → throws `SkuChannelNotFrozenError` (a custom Error subclass exported from the module). Route maps this to 404.
  - Marks the original `anomaly-freeze` audit_log row's `resolved_at = NOW()`: `UPDATE audit_log SET resolved_at = NOW() WHERE sku_channel_id = $skuChannelId AND event_type = 'anomaly-freeze' AND resolved_at IS NULL` (idempotent — if multiple historical freezes exist, all open ones close). **No new audit event is emitted** — `anomaly-resolved` is not in AD20's locked 26-row taxonomy.
  - Returns `{ unfrozenAt: <iso>, action: 'accept' }`.

- `unfreezeSkuAfterReject({ tx, skuChannelId })`
  - In ONE transaction: `UPDATE sku_channels SET frozen_for_anomaly_review = false, frozen_at = NULL, frozen_deviation_pct = NULL WHERE id = $skuChannelId AND frozen_for_anomaly_review = true` — **does NOT touch `list_price_cents`** (preserves old list_price per epic AC#3).
  - Same `rowCount === 0` → `SkuChannelNotFrozenError` contract.
  - Same `resolved_at = NOW()` audit-row patch as accept; no new audit event emitted.
  - Returns `{ unfrozenAt: <iso>, action: 'reject' }`.

**ESLint constraints enforced by this module:**
- `no-raw-INSERT-audit-log` (Constraint #21): all audit emission goes through `writeAuditEvent`.
- `no-direct-fetch` (Constraint #19): not applicable — module makes no HTTP calls (Resend send is via the wrapped client).
- `no-default-export`: only named exports (`freezeSkuForReview`, `unfreezeSkuAfterAccept`, `unfreezeSkuAfterReject`, `SkuChannelNotFrozenError`).
- `no-console` (Constraint #18): pino via `createWorkerLogger()`; never `console.log`.

**Reference SSoT pattern:** mirror [shared/state/cron-state.js](shared/state/cron-state.js) — atomic mutation + audit emission inside caller-supplied `tx`, custom-error subclass for guard-failures, JSDoc typedefs.

**Source:** epic-7-engine-safety.md Story 7.4 AC#1/AC#2/AC#3 + AD12 + AD20 taxonomy.

### AC2 — Remove stub-fallback from `cooperative-absorb.js` (closes PR #91 deferred Finding 1)

**Given** [worker/src/engine/cooperative-absorb.js:104-120](worker/src/engine/cooperative-absorb.js#L104-L120) currently dynamic-imports `../safety/anomaly-freeze.js` with a narrowed `ERR_MODULE_NOT_FOUND` catch that falls back to a no-op stub:

```js
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
```

**When** I replace the dynamic-import + stub-fallback with a hard top-of-file static import (Story 7.4 ships the module — the cross-story bridge is no longer load-bearing) and extend the freeze call signature to pass `skuId` + `customerEmail` (required by AC1 payload + critical-alert target),

**Then** the production-code shape becomes:

```js
import { freezeSkuForReview } from '../safety/anomaly-freeze.js';
// ...
const doFreeze = freezeFn ?? freezeSkuForReview;

await doFreeze({
  tx,
  skuChannelId,
  skuId,                          // NEW — passed to writeAuditEvent payload.skuId
  customerMarketplaceId,
  deviationPct,
  currentPriceCents,
  listPriceCents,
  customerEmail,                  // NEW — sourced from customerMarketplace (see below)
});
```

**Source-of-`customerEmail` contract:** Story 7.4 dev MUST decide one of:

- **Path A (recommended) — caller resolves email**: extend `absorbExternalChange` parameters to accept `customerEmail` (or resolve it inside `absorbExternalChange` via a small SELECT on `customers.email` joined through `customer_marketplaces.customer_id`). This keeps `freezeSkuForReview` pure (no extra DB SELECT for email).
- **Path B — module-internal resolution**: `freezeSkuForReview` does the email lookup itself before sending the alert. Adds one SELECT per freeze; acceptable since freezes are rare (>40% deviation events are exceptional).

Document the chosen path + 1-sentence rationale in **Dev Agent Record**. Either is acceptable; Path A is preferred for explicit data-flow.

**Discipline guards (load-bearing — SCP Amendment 7):**
- The `freezeFn` injection point (parameter on `absorbExternalChange`) is PRESERVED for unit tests — tests inject a mock; production code uses the static-imported real module.
- **NO production-code `try { await import(...) } catch (err) { /* fallback */ }`** anywhere in `cooperative-absorb.js` after this AC lands. Grep guard: `grep -n "await import" worker/src/engine/cooperative-absorb.js` returns zero matches.
- **NO no-op stub function definitions** anywhere in `cooperative-absorb.js`. The phrase `anomaly-freeze stub` MUST be deleted from the source (currently at [line 111](worker/src/engine/cooperative-absorb.js#L111)).
- Comment at [worker/src/engine/cooperative-absorb.js:104-108](worker/src/engine/cooperative-absorb.js#L104-L108) (the "Resolve freezeSkuForReview" block) is rewritten to reflect the new shape (static import + optional `freezeFn` injection for tests).

**Scope guard for `decide.js`:** [worker/src/engine/decide.js:117-128](worker/src/engine/decide.js#L117-L128) (STEP 2 cooperative-absorb dynamic import) and [worker/src/engine/decide.js:217-232](worker/src/engine/decide.js#L217-L232) (STEP 5 circuit-breaker dynamic import) — these narrowed-catch patterns STAY. Story 7.4 only removes the inner stub-fallback in `cooperative-absorb.js` → `anomaly-freeze.js`; the `decide.js` → `cooperative-absorb.js` / `decide.js` → `circuit-breaker.js` bridges are unchanged (those modules ARE on `main`). AC8 regression test in Story 7.9 covers the `decide.js` narrowed-catch invariant.

**Source:** deferred-work.md line 416 (PR #91 Finding 1, Subagent C BLOCKING → coordinator deferred → W6 close-out retro decision (a) "tighten Story 7.4 spec to disallow production-code stub-fallbacks") + SCP Amendment 7 + close-out retro §W6 + `feedback_bmad_sm_owns_spec_failures`.

### AC3 — Flip fixture `_expected` oracle (closes PR #91 deferred Finding 2)

**Given** [tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json](tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json) currently encodes the SCP-2026-05-11 Amendment 8 Path C deferral:

```json
"_expected": {
  "action": "SKIP",
  "newPriceCents": null,
  "absorbed": false,
  "frozen": true,
  "auditEvent": null,
  "priority": null
}
```

— the `null` values are structural truth ONLY while Story 7.4 has not shipped (no-op stub fires, no audit event emitted, no priority derived). Story 7.4 ships the real freeze path, so these MUST flip.

**When** I edit the fixture in this story (SCP Amendment 4 — `fixture._expected` is the sole oracle; no hand-coded expectation tables in unit or integration tests),

**Then** the `_expected` block becomes:

```json
"_expected": {
  "action": "SKIP",
  "newPriceCents": null,
  "absorbed": false,
  "frozen": true,
  "auditEvent": "anomaly-freeze",
  "priority": "atencao"
}
```

**Scope guards (fixture immutability discipline):**
- The `_note` field MUST be updated to remove the SCP-2026-05-11 Amendment 8 Path C deferral paragraph and replace it with a 1-2 sentence note: *"Cooperative absorption anomaly freeze: current_price=1000 vs last_set_price=2500 (deviation=60% > 40%). Real `absorbExternalChange` (Story 7.3) fires `freezeSkuForReview` (Story 7.4) before any per-SKU CB check. Engine returns SKIP, `anomaly-freeze` Atenção emitted (priority=atencao via DB trigger), critical alert sent via mock Resend. Fixture flipped 2026-05-13 by Story 7.4."*
- The `_fixture_meta` block MUST NOT change — fixture preconditions (`current_price_cents: 1000`, `last_set_price_cents: 2500`, `list_price_cents: 2500`, `tier: '1'`) remain identical. Only the `_expected` oracle and `_note` text are touched.
- The P11 `products[].offers[]` block MUST NOT change — fixture P11 payload is locked.
- **The other 16 fixtures in [tests/fixtures/p11/](tests/fixtures/p11/) are out-of-scope.** This story flips ONE fixture only.

**Source:** deferred-work.md line 417 (PR #91 Finding 2) + SCP Amendment 4 + close-out retro §W6 coupling.

### AC4 — Positive `anomaly-freeze` assertion in `full-cycle.test.js` (closes PR #91 deferred Finding 2 oracle weakness)

**Given** [tests/integration/full-cycle.test.js:266-271](tests/integration/full-cycle.test.js#L266-L271) currently uses a **weak** oracle that SKIPs the auditEvent assertion when `_expected.auditEvent === null`:

```js
if (expected.auditEvent !== undefined && expected.auditEvent !== null) {
  assert.ok(
    result.auditEvents.includes(expected.auditEvent),
    `[${fixtureName}] expected auditEvent '${expected.auditEvent}' in auditEvents, got ${JSON.stringify(result.auditEvents)}`,
  );
}
```

— this means after AC3 flips the fixture to `_expected.auditEvent: 'anomaly-freeze'`, the assertion becomes positive (non-null branch fires) **for the anomaly-freeze fixture**. The weak `!== null` guard is INTENTIONAL for fixtures where no audit event is expected (e.g., HOLD fixtures without explicit events) — DO NOT remove it; the asymmetric oracle pattern is correct.

**When** I verify the post-AC3 state under the existing AC1 oracle loop,

**Then** the existing AC1 assertion at [lines 266-271](tests/integration/full-cycle.test.js#L266-L271) MUST positively assert `result.auditEvents.includes('anomaly-freeze')` for the `p11-cooperative-absorption-anomaly-freeze` fixture row — verifying:

- Real `absorbExternalChange` was called (Story 7.3 production code).
- Real `freezeSkuForReview` was called (Story 7.4 production code — new in this story).
- Real `writeAuditEvent({ eventType: EVENT_TYPES.ANOMALY_FREEZE })` fired and the event slug appeared in `result.auditEvents`.

**Implementation expectation:** `decideForSkuChannel` returns `auditEvents` as an array (it already does for `external-change-absorbed`, `undercut-decision`, etc.). The freeze emission must surface in this array — either by `freezeSkuForReview` returning the event slug and `absorbExternalChange` accumulating it into the engine's `auditEvents`, OR by `decideForSkuChannel` aggregating events from cycle-side state (verify whichever pattern matches the current return-shape contract). The dev MUST trace the `auditEvents` accumulation path before this AC will pass and document the trace in Dev Agent Record.

**Bundle C invariant**: the existing 47/47 stays 47/47 minimum, and the `'anomaly-freeze'` positive assertion is one of those 47 (no longer SKIPped by the null guard for this fixture).

**Source:** deferred-work.md line 417 ("test will continue passing with the no-op stub even after Story 7.4 lands if no one updates the fixture") + epic AC#5.

### AC5 — `POST /audit/anomaly/:skuChannelId/accept` route

**Given** [app/src/routes/audit/anomaly-review.js](app/src/routes/audit/anomaly-review.js) does not yet exist on `main` (verified — only sibling routes `index.js`, `search.js`, `firehose.js` may exist),

**When** I add the route per architecture directory tree [05-directory-tree.md:60](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L60) (FR29),

**Then** the route file:

- Registers `POST /audit/anomaly/:skuChannelId/accept` on the app Fastify server (route prefix follows the existing `/audit/*` registration pattern — verify against existing `audit/index.js` how the prefix is composed).
- Reads `skuChannelId` from `request.params`.
- Reads `customer_id` from the signed `mp_session` cookie via the RLS-aware client pattern (per Library Empirical Contract #2 + Story 2.1 mp_session contract).
- Calls `unfreezeSkuAfterAccept({ tx, skuChannelId })` inside `await dbClient.tx(async tx => { ... })` (RLS-aware client transaction — Story 2.1 helper).
- On success → returns 200 with JSON body `{ ok: true, action: 'accept', unfrozenAt: <iso> }`.
- On `SkuChannelNotFrozenError` → returns **404** (NOT 403 — don't leak existence per epic AC#4).
- On any other error → standard error handler returns 500 with safe PT message; the original error is logged via pino at `error` level with `skuChannelId` + correlation id.

**JSON Schema validation (Fastify built-in, per Constraint #2):**
- `params: { type: 'object', required: ['skuChannelId'], properties: { skuChannelId: { type: 'string', format: 'uuid' } } }`.
- Invalid UUID → 400 with PT-localized error.

**CSRF protection**: route MUST be CSRF-protected via the existing `@fastify/csrf-protection` middleware wiring (Story 1.x baseline). Dashboard's anomaly-review modal (Epic 8 / Story 8.7) supplies the CSRF token; this story does not ship the modal.

**RLS guarantee:** the RLS-aware client scopes the `UPDATE sku_channels` to the customer's own rows. Cross-customer attempt → `rowCount === 0` → `SkuChannelNotFrozenError` → 404.

**Source:** epic-7 Story 7.4 AC#2 + architecture directory tree [05-directory-tree.md:60](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L60) + Library Empirical Contract #2.

### AC6 — `POST /audit/anomaly/:skuChannelId/reject` route

**Given** the same route file from AC5,

**When** I add the `POST /audit/anomaly/:skuChannelId/reject` handler,

**Then** behavior mirrors AC5 with one delta:

- Calls `unfreezeSkuAfterReject({ tx, skuChannelId })` (does NOT touch `list_price_cents` — preserves old list_price per epic AC#3).
- On success → returns 200 with JSON body `{ ok: true, action: 'reject', unfrozenAt: <iso> }`.
- Same 404 / 400 / 500 contract; same RLS guarantee; same CSRF protection.

**Documented follow-up behavior (NOT in this story's scope):** per epic AC#3, after `reject`, the next dispatcher cycle picks up the unfrozen sku_channel; cooperative-absorption (Story 7.3) will detect `current_price ≠ last_set_price` again. The customer must use whole-tool pause (Story 8.5) if they want to permanently override the absorption. **This story does NOT add re-freeze suppression for recently-rejected SKUs** — that would be a Phase 2 design discussion.

**Source:** epic-7 Story 7.4 AC#3.

### AC7 — RLS regression suite extension for anomaly-review endpoints

**Given** [tests/integration/rls-regression.test.js](tests/integration/rls-regression.test.js) currently covers customer-scoped tables (`skus`, `sku_channels`, `baseline_snapshots`, `scan_jobs`, `pri01_staging`, etc.) but does NOT exercise the anomaly-review HTTP endpoints,

**When** I extend the suite with two new test cases asserting cross-tenant blocking,

**Then** the additions:

- New test: *"POST /audit/anomaly/:skuChannelId/accept — customer A attempting to accept customer B's frozen sku_channel returns 404"*.
- New test: *"POST /audit/anomaly/:skuChannelId/reject — customer A attempting to reject customer B's frozen sku_channel returns 404"*.
- Each test:
  1. Seeds two customers (uses existing `db/seed/test/two-customers.sql` infrastructure — Story 2.2).
  2. Creates a frozen sku_channel under customer B (`UPDATE sku_channels SET frozen_for_anomaly_review = true, frozen_at = NOW(), frozen_deviation_pct = 0.6 WHERE id = <customer_b_sku_channel>`).
  3. Authenticates as customer A (uses existing auth-helper pattern — Story 2.2).
  4. Issues `POST /audit/anomaly/<customer_b_sku_channel_id>/accept` (or `/reject`).
  5. Asserts **HTTP 404** (not 403, not 200 — leak-free response per epic AC#4).
  6. Asserts the row's `frozen_for_anomaly_review` is **still `true`** (no cross-tenant mutation occurred).

**No new entries in CUSTOMER_SCOPED_TABLES registry** — this story does not add any new table; anomaly-review reuses `sku_channels` (already registered in Story 4.2). The new tests are at the endpoint-routing level, not the table-RLS level.

**Source:** epic-7 Story 7.4 AC#4 + Story 2.2 RLS regression pattern.

### AC8 — Unit tests for `anomaly-freeze.js`

**Given** the new SSoT module needs its own unit-test surface (mirroring `tests/worker/safety/circuit-breaker.test.js` for Story 7.6 + `tests/worker/engine/cooperative-absorb.test.js` for Story 7.3),

**When** I add unit tests under [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js),

**Then** the test file covers:

1. **`freezeSkuForReview` happy path** — supplies a mock `tx` (via `buildMockTx` pattern) + valid params; asserts:
   - Captured `UPDATE sku_channels SET frozen_for_anomaly_review = true, frozen_at = ..., frozen_deviation_pct = $deviationPct WHERE id = $skuChannelId`.
   - Captured `INSERT INTO audit_log` (via mock-tx query capture or via stubbing `writeAuditEvent` — whichever matches the existing test convention).
   - Payload shape matches `PayloadForAnomalyFreeze`: `{ previousListPriceCents, suspectedListPriceCents, deviationPct, skuId }`.
   - Mock `sendCriticalAlert` was invoked AFTER the tx commits (verify via call-order capture or by asserting `sendCriticalAlert` is not called when `tx.commit()` is mocked to throw).
   - Return value: `{ frozen: true, auditId: <some-uuid> }`.

2. **`freezeSkuForReview` Resend best-effort** — supplies a mock `sendCriticalAlert` that throws; asserts the freeze succeeds (returns normally; the UPDATE + audit emission occurred before the alert).

3. **`unfreezeSkuAfterAccept` happy path** — supplies a frozen row; asserts:
   - Captured `UPDATE sku_channels SET list_price_cents = current_price_cents, frozen_for_anomaly_review = false, frozen_at = NULL, frozen_deviation_pct = NULL WHERE id = $skuChannelId AND frozen_for_anomaly_review = true`.
   - Captured `UPDATE audit_log SET resolved_at = NOW() WHERE sku_channel_id = $skuChannelId AND event_type = 'anomaly-freeze' AND resolved_at IS NULL`.
   - **NO `INSERT INTO audit_log`** — no new event emitted on resolution (no `anomaly-resolved` in AD20 taxonomy).
   - Return value: `{ unfrozenAt: <iso>, action: 'accept' }`.

4. **`unfreezeSkuAfterAccept` not-frozen guard** — supplies a row that is already unfrozen (rowCount === 0); asserts:
   - Throws `SkuChannelNotFrozenError` with a useful message.
   - **NO `UPDATE audit_log`** issued (guard fires before resolved_at patch).

5. **`unfreezeSkuAfterReject` happy path** — same as test 3 but:
   - The UPDATE **does NOT include `list_price_cents = current_price_cents`** — list_price is preserved.
   - Same resolved_at patch.
   - Return value: `{ unfrozenAt: <iso>, action: 'reject' }`.

6. **`unfreezeSkuAfterReject` not-frozen guard** — same as test 4 but for reject path.

7. **Cross-module integration sanity** — `tests/worker/engine/cooperative-absorb.test.js` (existing) MUST continue to pass after AC2 wires the static import. The `freezeFn` mock-injection pattern in `cooperative-absorb.test.js` should still work — verify the test suite doesn't break on the import-shape change.

**RESEND_API_KEY env-stub pattern** (per memory `project_resend_env_stub_import_pattern`):

```js
// tests/worker/safety/anomaly-freeze.test.js — top of file
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY ?? 'test-stub-key';

// MUST use `await import` (not plain `import`) because anomaly-freeze.js
// transitively imports shared/resend/client.js which throws at module load
// if RESEND_API_KEY is missing.
const { freezeSkuForReview, unfreezeSkuAfterAccept, unfreezeSkuAfterReject, SkuChannelNotFrozenError } =
  await import('../../../worker/src/safety/anomaly-freeze.js');
```

**Source:** epic-7 Story 7.4 AC#1 + project-context.md §Library Empirical Contracts #1 + memory `project_resend_env_stub_import_pattern`.

---

## Tasks / Subtasks

> Tasks are grouped to match the AC numbering. Each AC owns one task; sub-tasks decompose by file.

- [ ] **Task 1 (AC1)** — Create `worker/src/safety/anomaly-freeze.js` SSoT module
  - [ ] Create [worker/src/safety/anomaly-freeze.js](worker/src/safety/anomaly-freeze.js) with three exported functions + `SkuChannelNotFrozenError` class.
  - [ ] Add JSDoc typedefs documenting params + return shapes; reference `PayloadForAnomalyFreeze` from [shared/audit/event-types.js:91-96](shared/audit/event-types.js#L91-L96).
  - [ ] Verify `no-raw-INSERT-audit-log` ESLint rule does NOT flag this file (all audit emission via `writeAuditEvent`).
  - [ ] Run `node --check worker/src/safety/anomaly-freeze.js` — boot test passes (per BAD Step 5/7 boot-check pattern, memory `feedback_step5_import_path_boot_check`).
  - [ ] Verify Path A vs Path B decision for `customerEmail` resolution; document choice in Dev Agent Record.

- [ ] **Task 2 (AC2)** — Cut over `cooperative-absorb.js` from dynamic-import stub to static import
  - [ ] Edit [worker/src/engine/cooperative-absorb.js:1-25](worker/src/engine/cooperative-absorb.js#L1-L25) — add `import { freezeSkuForReview } from '../safety/anomaly-freeze.js'` at top.
  - [ ] Edit [worker/src/engine/cooperative-absorb.js:104-120](worker/src/engine/cooperative-absorb.js#L104-L120) — replace dynamic-import + stub-fallback block with `const doFreeze = freezeFn ?? freezeSkuForReview;`.
  - [ ] Extend the `doFreeze({...})` call at [worker/src/engine/cooperative-absorb.js:122-129](worker/src/engine/cooperative-absorb.js#L122-L129) to pass `skuId` + `customerEmail` (sourced per chosen Path A or Path B).
  - [ ] Update the comment block at [worker/src/engine/cooperative-absorb.js:96-108](worker/src/engine/cooperative-absorb.js#L96-L108) to reflect the new shape (static import + `freezeFn` injection retained for tests).
  - [ ] Delete the phrase `anomaly-freeze stub` and any reference to "7.4 not shipped" / "ERR_MODULE_NOT_FOUND" from the file.
  - [ ] **Grep guards**: `grep -n "await import" worker/src/engine/cooperative-absorb.js` → 0 matches; `grep -n "anomaly-freeze stub" worker/src/engine/cooperative-absorb.js` → 0 matches.
  - [ ] Run `node --check worker/src/engine/cooperative-absorb.js` — boot test passes.

- [ ] **Task 3 (AC3)** — Flip fixture `_expected` oracle
  - [ ] Edit [tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json](tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json):
    - `_expected.auditEvent`: `null` → `"anomaly-freeze"`.
    - `_expected.priority`: `null` → `"atencao"`.
    - Rewrite `_note` per AC3 wording (drop SCP-2026-05-11 Amendment 8 Path C deferral paragraph).
  - [ ] Verify NO other fields in `_fixture_meta` or `products` change (diff scope is `_expected.auditEvent` + `_expected.priority` + `_note` only).
  - [ ] Validate JSON parses cleanly: `node -e "JSON.parse(require('fs').readFileSync('tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json', 'utf8'))"`.

- [ ] **Task 4 (AC4)** — Verify positive `anomaly-freeze` assertion fires in `full-cycle.test.js`
  - [ ] Trace `auditEvents` accumulation: walk from `freezeSkuForReview` → `writeAuditEvent` → engine's return-shape, documenting the path in Dev Agent Record.
  - [ ] If the engine's `auditEvents` array does NOT currently accumulate the freeze event (because Story 7.3's `absorbExternalChange` returns `{ frozen: true }` without propagating an event slug), patch the propagation path so the slug reaches `result.auditEvents` for the anomaly-freeze fixture. Options:
    - Have `freezeSkuForReview` return `{ frozen: true, auditId, eventType: 'anomaly-freeze' }`; `absorbExternalChange` adds it to its return; `decideForSkuChannel` accumulates into `auditEvents`.
    - OR query `audit_log` after the cycle and aggregate event_types (less direct — prefer the first option for explicit data-flow).
  - [ ] Run `node --test tests/integration/full-cycle.test.js` — confirm:
    - The AC1 oracle loop now positively asserts `'anomaly-freeze'` ∈ `result.auditEvents` for the anomaly-freeze fixture (no longer skipped by the null guard).
    - All other 16 fixtures still pass with their existing oracle.
    - Test count goes from current 47 to ≥48 (the new positive assertion is now active; depending on test-runner behavior, this may be the same logical AC1 test or a new sub-test — verify).

- [ ] **Task 5 (AC5)** — `POST /audit/anomaly/:skuChannelId/accept` route
  - [ ] Create [app/src/routes/audit/anomaly-review.js](app/src/routes/audit/anomaly-review.js) with both accept + reject handlers (AC5 + AC6 share the file).
  - [ ] Verify route prefix composition against existing `audit/index.js` registration pattern.
  - [ ] Wire JSON Schema validation for `params.skuChannelId` (uuid format).
  - [ ] Wire RLS-aware client `dbClient.tx(async tx => { ... })` per Story 2.1 contract.
  - [ ] Map `SkuChannelNotFrozenError` → HTTP 404 (NOT 403); other errors → 500.
  - [ ] CSRF: confirm `@fastify/csrf-protection` is registered and applies to this route (or explicit `{ config: { csrf: true } }` if per-route opt-in is the project convention).
  - [ ] Manual smoke: start app locally, seed a frozen sku_channel via psql, issue `POST /audit/anomaly/<id>/accept` via `curl` with cookie + CSRF token, assert 200 + DB state matches.

- [ ] **Task 6 (AC6)** — `POST /audit/anomaly/:skuChannelId/reject` route
  - [ ] Add reject handler to the same `anomaly-review.js` file.
  - [ ] Mirror Task 5 acceptance + smoke.

- [ ] **Task 7 (AC7)** — RLS regression suite extension
  - [ ] Edit [tests/integration/rls-regression.test.js](tests/integration/rls-regression.test.js): add two test cases per AC7.
  - [ ] Reuse existing two-customers seed (`db/seed/test/two-customers.sql`) + auth-helper from Story 2.2.
  - [ ] Verify CSRF flow (or test-bypass per `NODE_ENV=test` per memory `project_phase55a_migration_miss_fixed` + Story 4.x bypass-wrapper pattern).
  - [ ] Run `npm run test:rls` (or equivalent target — verify against package.json) — both new tests pass; existing RLS tests still pass.

- [ ] **Task 8 (AC8)** — Unit tests for `anomaly-freeze.js`
  - [ ] Create [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js) with 6 test cases per AC8.
  - [ ] Apply `RESEND_API_KEY` env-stub + `await import` pattern at top of file.
  - [ ] Reuse `buildMockTx` / `makeMockTx` pattern from existing Bundle C tests (`tests/integration/full-cycle.test.js` or sibling unit tests).
  - [ ] Run `node --test tests/worker/safety/anomaly-freeze.test.js` — all 6 tests pass.
  - [ ] Run `node --test tests/worker/engine/cooperative-absorb.test.js` — existing Story 7.3 unit tests still pass after the AC2 static-import cut-over (the `freezeFn` mock-injection pattern is preserved).

- [ ] **Final acceptance** — Bundle C green-floor + full-suite verification
  - [ ] **Bundle C atomicity gate (non-negotiable)**: `node --test tests/integration/full-cycle.test.js tests/integration/pending-import-id-invariant.test.js tests/integration/circuit-breaker-trip.test.js` → ≥47 pass (post-Story-7.9 expanded count), 0 fail, with the new positive `'anomaly-freeze'` assertion firing. If any of these three flips red, the story is not done.
  - [ ] Run `npm test` (full suite) — report total pass / total fail / list any newly-failing test files. Pre-existing pre-Go-Live fails (post-Story-7.9 baseline: ~23 unit fails) are out-of-scope but should NOT regress.
  - [ ] Run `npm run lint` (or equivalent ESLint command) — confirm no new lint errors on touched files. Specifically verify `no-raw-INSERT-audit-log` does not flag `anomaly-freeze.js` (correct usage via `writeAuditEvent`).
  - [ ] Verify migration tree: NO new migrations should ship from this story. `npx supabase migration list` shows no diff vs `main`.
  - [ ] Update File List in Dev Agent Record with every file edited.

---

## Dev Notes

### Story shape

This is a **feature story** that completes the AD12 anomaly-freeze contract and closes two PR #91 deferred findings. Scope spans 4 production files + 3 test files + 1 fixture + 0 migrations. Net new SSoT module: `worker/src/safety/anomaly-freeze.js`. The cut-over removes a documented cross-story bridge (no-op stub-fallback in `cooperative-absorb.js`) — this is the W6 retro decision (a) "tighten Story 7.4 spec to disallow production-code stub-fallbacks".

### Architecture compliance (the 27 negative-assertion constraints)

This story touches `audit_log` (via `writeAuditEvent`) and adds a new HTTP route. Relevant constraints to verify clean:

- **Constraint #2** (no external validator library) — JSON Schema validation uses Fastify built-in. Verify `package.json` does NOT add `zod`, `yup`, `joi`, or `ajv`.
- **Constraint #5** (no TypeScript) — pure JS + JSDoc.
- **Constraint #7** (no customer-facing API at MVP) — the `/audit/anomaly/:sku/{accept|reject}` endpoints are session-scoped HTML-form POSTs from the dashboard, NOT a JSON public API surface. They consume the existing `mp_session` cookie + CSRF token; not part of `/api/v1/...`. Verify route file does NOT live under `app/src/routes/api/`.
- **Constraint #18** (no console.log) — pino only.
- **Constraint #19** (no direct `fetch` outside `shared/mirakl/`) — anomaly-freeze.js makes zero HTTP calls (Resend is via `shared/resend/client.js` wrapper).
- **Constraint #21** (no raw `INSERT INTO audit_log` outside `shared/audit/writer.js`) — anomaly-freeze.js MUST emit via `writeAuditEvent`. ESLint `no-raw-INSERT-audit-log` rule (Story 9.0) enforces this.
- **Constraint #24** (no worker query missing `customer_marketplace_id` filter) — anomaly-freeze.js runs in worker context (called from `cooperative-absorb.js` → `decide.js` → master cron). Verify the `UPDATE sku_channels` filter uses `WHERE id = $skuChannelId` AND that `sku_channels.id` is unique per-customer (via the schema's natural FK chain). Cooperative-absorb.js's caller pre-scopes the row to one tenant, so the `WHERE id` predicate is implicitly customer-scoped.

### Bundle C atomicity guard

Story 7.4 is NOT a Bundle C participant — it is NOT in `bundle_dispatch_orders:` and NOT in `merge_blocks:`. It dispatches normally from `main`. However, Story 7.4 MUST NOT regress the 47-test Bundle C atomicity gate:

- [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js) — should expand to ≥48 tests (new positive `'anomaly-freeze'` assertion fires).
- [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js) — should remain unchanged.
- [tests/integration/circuit-breaker-trip.test.js](tests/integration/circuit-breaker-trip.test.js) — should remain unchanged.

The "Final acceptance" task verifies all three remain green.

### SCP Amendment 4 — fixture `_expected` is sole oracle

Bundle C close-out retro re-affirmed SCP Amendment 4 (Story 7.8 spec): **fixture `_expected` is the single source of truth for behavioral expectations; hand-coded expectation tables in unit or integration tests are forbidden.** AC3 + AC4 of this story enforce that pattern — the fixture flips, the test's existing oracle loop reads the new value, and no inline `expected.action === 'SKIP' && expectedEvent === 'anomaly-freeze'` block is added anywhere. The asymmetric `expected.auditEvent !== null` guard at [full-cycle.test.js:266](tests/integration/full-cycle.test.js#L266) is intentional and stays — it correctly skips assertion for fixtures with no expected event (e.g., HOLD fixtures).

### SCP Amendment 7 — no stub-fallbacks for Story 7.4 production modules

Per close-out retro §W6 decision (a), this story tightens the stub-fallback discipline:

- **Pre-7.4**: cooperative-absorb.js dynamically imported `../safety/anomaly-freeze.js` with `ERR_MODULE_NOT_FOUND` catch falling back to a no-op stub. This was justified as a Bundle-C-cleanup cross-story bridge.
- **Post-7.4**: the bridge is dismantled. `anomaly-freeze.js` ships on `main`; cooperative-absorb.js statically imports it; production code never falls back to a no-op stub. The `freezeFn` parameter injection point on `absorbExternalChange` is preserved ONLY for unit-test mocking — never for production fallback.

This is the discipline Pedro flagged in the retro and locked as SCP Amendment 7. Future stories that introduce new cross-story bridges MUST cite the dismantling-story explicitly (e.g., "stub-fallback in module X is dismantled by Story Y") — no open-ended deferral.

### Anti-patterns to avoid

- **DO NOT** add a new migration. The freeze columns (`frozen_for_anomaly_review`, `frozen_at`, `frozen_deviation_pct`) already exist in [supabase/migrations/202604301206_create_sku_channels.sql](supabase/migrations/202604301206_create_sku_channels.sql) (Story 4.2). The `audit_log.resolved_at` column already exists in Story 9.1's migration.
- **DO NOT** add a new audit event_type `anomaly-resolved` or similar. The AD20 taxonomy is locked at 26 base + 2 Epic-12-additions = 28 max. Resolution is signaled via `resolved_at` column patch on the existing `anomaly-freeze` row.
- **DO NOT** use Supabase MCP `apply_migration` for any DDL. None should be needed; if you find yourself reaching for one, surface to Pedro first.
- **DO NOT** weaken the asymmetric `expected.auditEvent !== null` oracle guard at [full-cycle.test.js:266](tests/integration/full-cycle.test.js#L266). It correctly skips assertion for HOLD fixtures.
- **DO NOT** add a re-freeze suppression for recently-rejected SKUs (epic AC#3 explicitly leaves this to whole-tool pause). Phase 2 design.
- **DO NOT** touch the other 16 P11 fixtures. AC3 flips ONE fixture only.
- **DO NOT** restructure `cooperative-absorb.js` beyond the AC2 static-import + extended call signature. The Story 7.3 absorption logic (within-threshold absorption + skip-on-pending + no-op-on-no-change) is stable and shipped.
- **DO NOT** restructure `decide.js` STEP 2 / STEP 5 narrowed-catch patterns. Those bridges remain (different modules; `cooperative-absorb.js` and `circuit-breaker.js` ARE on main; the catch is defensive against future-refactor failures, not against missing-module fallbacks).
- **DO NOT** use OF24 for any price-related update. AD7 + Constraint #6 — `pri01-writer.js` is the only price-write path; anomaly-freeze does NOT push prices to Mirakl.
- **DO NOT** call `freezeSkuForReview` outside `cooperative-absorb.js`. This is the only authorized caller (and unit tests). If a future story needs to invoke it from elsewhere (e.g., admin manual-freeze), surface to Pedro first.

### Project Structure Notes

Files touched (anticipated):

| File | Change | AC | New? |
|---|---|---|---|
| [worker/src/safety/anomaly-freeze.js](worker/src/safety/anomaly-freeze.js) | New SSoT module: `freezeSkuForReview`, `unfreezeSkuAfterAccept`, `unfreezeSkuAfterReject`, `SkuChannelNotFrozenError` | AC1 | NEW |
| [worker/src/engine/cooperative-absorb.js](worker/src/engine/cooperative-absorb.js) | Static import; remove no-op stub; extend call signature with `skuId` + `customerEmail` | AC2 | Edit |
| [tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json](tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json) | `_expected.auditEvent: null → 'anomaly-freeze'`; `_expected.priority: null → 'atencao'`; rewrite `_note` | AC3 | Edit |
| [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js) | Verify positive assertion fires; if needed, patch `auditEvents` accumulation path | AC4 | Maybe edit |
| [app/src/routes/audit/anomaly-review.js](app/src/routes/audit/anomaly-review.js) | New route file with two POST handlers | AC5, AC6 | NEW |
| [tests/integration/rls-regression.test.js](tests/integration/rls-regression.test.js) | Add 2 cross-tenant 404 test cases | AC7 | Edit |
| [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js) | New unit-test file: 6 test cases | AC8 | NEW |
| [worker/src/engine/decide.js](worker/src/engine/decide.js) | (optional) propagate freeze event slug into `auditEvents` return if not already wired | AC4 | Maybe edit |

**SSoT-table divergence flag (surface to Pedro at PR time, do NOT fix in this story):** [project-context.md:140](project-context.md#L140) lists `shared/state/sku-freeze.js` as the SSoT module for `freezeSkuForReview` / `unfreezeSku`, but the architecture distillate ([05-directory-tree.md:128](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L128)) places it at `worker/src/safety/anomaly-freeze.js`, AND the existing `cooperative-absorb.js` code imports from `../safety/anomaly-freeze.js`. Per CLAUDE.md "Conflict rule: distillate wins" — this story ships `worker/src/safety/anomaly-freeze.js`. project-context.md row 7 of the SSoT table is divergent and should be reconciled in a follow-up housekeeping pass (NOT this story).

### Testing Standards

- Test runner: `node --test` (Constraint #2 — no Jest/Vitest).
- Mocking: `buildMockTx` / `makeMockTx` pattern from Bundle C tests; no new mocking libraries.
- Fixture loading: `readFileSync` on `tests/fixtures/p11/*.json`; no abstraction layer.
- RESEND_API_KEY env-stub + `await import` pattern at top of any test file touching `anomaly-freeze.js` or `shared/resend/client.js` transitively. Per memory `project_resend_env_stub_import_pattern`.
- `integration_test_required: false` for this story — there is no new pg/Supabase Auth/Mirakl/Stripe SDK surface, and the RLS surface added (HTTP routes) is already covered by `tests/integration/rls-regression.test.js` (Story 2.2). The new endpoint tests in AC7 exercise the live RLS-aware client via Fastify request injection — that's the integration-level surface; no Phase 4.5 gate needed.

### Library Empirical Contracts (load-bearing)

- **#1 GoTrue HINT-code stripping** — not applicable here (no signup flow).
- **#2 `@fastify/cookie` v11+ signed-cookie unwrap** — applies to AC5 + AC6 routes if they read `mp_session` directly. Use `request.unsignCookie(raw)` pattern.
- **#3 pg Pool CA pinning** — applies if anomaly-freeze.js needs a direct `pg.Pool` (it doesn't — it uses caller-supplied `tx`).
- **#9 Conditional SSL** — same.
- **#10 `@fastify/formbody`** — applies to AC5 + AC6 if the dashboard modal POSTs as `application/x-www-form-urlencoded` (Story 8.7 Epic 8 — out-of-scope here). If the route accepts JSON only at MVP, document the content-type in the route.
- **#14 `no-direct-fetch` ESLint comment-scan** — not applicable (anomaly-freeze.js makes no HTTP calls; no `fetch(` substring in comments needed).
- **Memory `project_resend_env_stub_import_pattern`** — REQUIRED for AC8 test file structure.

### Previous Story Intelligence

- **Story 7.3 (cooperative-absorb.js, PR #88 → PR #91 mega-merge, done 2026-05-13)**: shipped the absorption + skip-on-pending logic with the no-op stub-fallback for `freezeSkuForReview` (justified as Bundle-C-cleanup bridge per Story 7.8 spec line 165 + SCP-2026-05-11 Amendment 8 Path C). This story dismantles that bridge.
- **Story 7.6 (circuit-breaker.js, PR #89 → PR #91 mega-merge, done 2026-05-13)**: shipped `worker/src/safety/circuit-breaker.js` with the SSoT pattern this story mirrors for `anomaly-freeze.js` (atomic state mutation + audit emission via `writeAuditEvent` + critical alert via `sendCriticalAlert`). Use that file as the reference template.
- **Story 7.8 (Bundle C gate, PR #91 mega-merge 89b2378, done 2026-05-13)**: shipped 45 integration tests; deferred-work entries lines 416-417 (the two findings this story closes) are documented in [_bmad-output/implementation-artifacts/deferred-work.md](_bmad-output/implementation-artifacts/deferred-work.md).
- **Story 7.9 (Bundle C cleanup chore, PR #93, done 2026-05-13)**: expanded Bundle C from 45 → 47 tests via AC2 (5 module-presence imports) + AC4 (N>1 batch sub-test). This story expects to start from the 47-test floor and end at ≥48 (new positive `'anomaly-freeze'` assertion fires).
- **Bundle C close-out retro (2026-05-13)**: this story = retro §12 Session 3. Retro §W6 decision (a) "tighten Story 7.4 spec to disallow production-code stub-fallbacks" is the load-bearing input. Pedro will dispatch via `/bad` in a fresh session.
- **Story 4.6 (Resend client, done 2026-05-07)**: shipped `shared/resend/client.js` with `sendCriticalAlert({ to, subject, html })`. AC1's critical-alert path consumes this directly.
- **Story 9.0 (audit writer, done 2026-05-04)**: shipped `shared/audit/writer.js` with `writeAuditEvent` SSoT + `no-raw-INSERT-audit-log` ESLint rule. AC1 + AC8 consume this.
- **Story 9.1 (audit_log partitioned, done 2026-05-06)**: shipped the partitioned `audit_log` table + `audit_log_set_priority` BEFORE-INSERT trigger. AC3's `priority: 'atencao'` flip is the runtime-derived value from this trigger.

### Git intelligence

- Branch: dispatches normally from `main` (NOT from any bundle branch).
- Worktree fork point: `main` HEAD at session start (currently `9b4a074` per recent commits).
- Expected file count in PR: 5-7 (the 4 production/route/test files + 1 fixture + optionally 2 if `decide.js` propagation patch is needed).
- No `bundle_dispatch_orders` constraint: this story is NOT part of any atomicity bundle and dispatches in isolation.
- Q8 Phase 1 CI gate (`node --test tests/integration/{full-cycle,pending-import-id-invariant,circuit-breaker-trip}.test.js`, narrowed scope per [.github/workflows/ci.yml](.github/workflows/ci.yml) post-1501c72) is the safety floor — Bundle C ≥47/47 must stay green on the PR.

### References

- **Retro source-of-truth (W6 + §12 Session 3):** [_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md](_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md) §W6 + §12 Session 3 (lines 345-349, 501-503)
- **Deferred-work entries closed by this story:** [_bmad-output/implementation-artifacts/deferred-work.md:416](_bmad-output/implementation-artifacts/deferred-work.md#L416) (Finding 1 — production stub-fallback) + [line 417](_bmad-output/implementation-artifacts/deferred-work.md#L417) (Finding 2 — fixture oracle weakness)
- **Epic spec:** [_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L110-L118](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L110-L118) Story 7.4 (AC#1-AC#5)
- **AD12 (per-SKU freeze, orthogonal to cron_state):** project-context.md §3 Atomicity Bundles (Bundle B pattern for state-mutation + audit atomicity — same shape applies here)
- **AD20 (28-event audit taxonomy):** [project-context.md:215-256](project-context.md#L215-L256) — `anomaly-freeze` is row 1 of Atenção (9-event group)
- **Production modules to reference / consume:**
  - [worker/src/engine/cooperative-absorb.js](worker/src/engine/cooperative-absorb.js) (current state with stub-fallback to remove)
  - [worker/src/safety/circuit-breaker.js](worker/src/safety/circuit-breaker.js) (Story 7.6 SSoT template — mirror its shape)
  - [shared/audit/writer.js](shared/audit/writer.js) (`writeAuditEvent` SSoT)
  - [shared/audit/event-types.js:47-79](shared/audit/event-types.js#L47-L79) (`EVENT_TYPES.ANOMALY_FREEZE`) + [lines 91-96](shared/audit/event-types.js#L91-L96) (`PayloadForAnomalyFreeze` typedef)
  - [shared/resend/client.js:59](shared/resend/client.js#L59) (`sendCriticalAlert({ to, subject, html })`)
  - [shared/state/cron-state.js](shared/state/cron-state.js) (Bundle B pattern reference for atomic state + audit)
- **Migrations (existing — no new ones in this story):**
  - [supabase/migrations/202604301206_create_sku_channels.sql:22-26](supabase/migrations/202604301206_create_sku_channels.sql#L22-L26) (freeze columns)
  - Story 9.1 audit_log partitioned table + `resolved_at` column
- **Test files to extend:**
  - [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js) (AC4)
  - [tests/integration/rls-regression.test.js](tests/integration/rls-regression.test.js) (AC7)
- **Test files to create:**
  - [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js) (AC8)
- **Fixture to edit:**
  - [tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json](tests/fixtures/p11/p11-cooperative-absorption-anomaly-freeze.json) (AC3)
- **Distillates:**
  - [_bmad-output/planning-artifacts/architecture-distillate/_index.md](_bmad-output/planning-artifacts/architecture-distillate/_index.md) — 27 constraints, AD12, AD20
  - [_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md](_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md) — AD12 + AD20 detail
  - [_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md:128](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L128) (target path `worker/src/safety/anomaly-freeze.js`) + [line 60](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L60) (route path `app/src/routes/audit/anomaly-review.js`)
- **Project context:** [project-context.md](project-context.md) §27 Constraints (#2, #5, #7, #18, #19, #21, #24) + §11 SSoT Modules (row 7 — flagged divergent; distillate wins) + §AD20 28-Event Audit Taxonomy + §Library Empirical Contracts #2, #9, #10
- **Memory entries consulted:**
  - `feedback_bmad_sm_owns_spec_failures` (retro §W6 owner-by-Bob trace)
  - `feedback_correct_course_validated_for_spec_failures` (NOT applicable here — this is a forward-looking story, not a corrective-action; standard `bmad-create-story` flow)
  - `project_resend_env_stub_import_pattern` (AC8 test-file structure)
  - `feedback_step5_import_path_boot_check` (run `node --check` after Task 1 + Task 2 edits)
  - `feedback_no_premature_abstraction` (do not propose generic "freeze SDK"; keep `anomaly-freeze.js` narrowly scoped to AD12)
  - `feedback_grep_drift_widely` (after AC2 edits, grep `await import.*anomaly-freeze` + `anomaly-freeze stub` across repo — should return 0 matches)

### Out-of-scope items (explicitly NOT in this story)

- Story 7.5 tier-classify + Story 7.7 reconciliation (retro §12 Session 3 follow-ons — ship AFTER 7.4 lands).
- Dashboard anomaly-review modal UI (Epic 8 / Story 8.7 — consumes the AC5 + AC6 endpoints).
- Re-freeze suppression for recently-rejected SKUs (Phase 2 design discussion).
- AC7 partial migration to `_fixture_meta` / `_expected` oracle for the other 10 Story 7.2 fixtures (deferred-work line 448 — separate Story 7.4 prologue OR Epic 7 retro cleanup).
- Q8 Phase 2 CI gate (full `npm test` in CI — separate; requires isolating the hanging integration tests first per deferred-work line 450).
- `bundle-c-integrated` branch + 8 prior worktree cleanup (operational; SCP-2026-05-11 §6).
- project-context.md SSoT-table row 7 reconciliation (`shared/state/sku-freeze.js` vs `worker/src/safety/anomaly-freeze.js`) — flag at PR-time, not in scope.
- New event types (`anomaly-resolved` etc.) — AD20 taxonomy is locked at 28 entries.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Step 3 developer, 2026-05-13)

### Debug Log References

### Completion Notes List

### File List
