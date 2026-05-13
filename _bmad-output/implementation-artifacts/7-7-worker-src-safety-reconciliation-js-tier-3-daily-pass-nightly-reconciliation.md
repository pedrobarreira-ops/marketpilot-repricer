# Story 7.7: worker/src/safety/reconciliation.js — Tier 3 daily pass = nightly reconciliation

Status: ready-for-dev

<!-- Sharded 2026-05-13 by Bob (`bmad-create-story`) per Bundle C close-out retro §12 Session 3 ordering (LAST Epic 7 story before epic retro) + Pedro's 2026-05-13 brief (3-sighting mechanism-trace + Step 6 SOLO-PR DEFENSIVE TOUCH pre-stage + Bundle C floor 47/47 correction). -->
<!-- Source: _bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md Story 7.7 + SCP-2026-05-13 Path I autocommit ratification + deferred-work.md line 467 (3-sighting mechanism-trace) + line 472 (payload-shape gap) + line 481 (Bundle C floor 47/47 spec drift). -->
<!-- NOT a Bundle C participant — not in `bundle_dispatch_orders:` or `merge_blocks:` in sprint-status.yaml. Solo dispatch from main. Ships AFTER Story 7.5 (done via PR #95 squash 6d6313a 2026-05-13 — `applyTierClassification` is on `main`). Last Epic 7 story before `bmad-retrospective` fires. -->

## Story

As **the maintainer of the FR28 + AD10 Tier-3 nightly-reconciliation contract**,
I want **`worker/src/safety/reconciliation.js` shipped as the standalone nightly-pass SSoT — iterating every Tier 3 sku_channel across ALL customers, fetching P11 + self-filtering via the Story 3.2 wrappers, applying Story 7.5's `applyTierClassification` on real transitions, and emitting `tier-transition` + `new-competitor-entered` audit events directly via `writeAuditEvent` (Pattern A) — registered as a daily `0 0 * * *` Lisbon-TZ cron via `worker/src/jobs/reconciliation.js`**,
so that **no Tier 3 SKU is ever silently stranded if the master-5-min dispatcher backlogs the daily cadence, new competitor entries on previously-empty SKUs surface as `new-competitor-entered` Notável events with the correctly-shaped payload (closing the cycle-assembly payload-shape gap for reconciliation-emitted rows), and FR28's "Tier 3 daily pass = nightly reconciliation" promise is satisfied end-to-end.**

---

## Acceptance Criteria

> **Bundle C invariant guard** (non-negotiable across all ACs): the 3 Bundle C integration test files MUST stay green at ≥47/47 (`main` baseline per [deferred-work.md:481](_bmad-output/implementation-artifacts/deferred-work.md#L481) — Story 7.4's promised expansion to 48 did not materialise; future spec language uses 47 until a new `test()` block actually expands the count). Story 7.7 ships NEW tests in `tests/worker/safety/reconciliation.test.js` (per architecture directory-tree convention) — it does NOT modify any of the 3 Bundle C integration files:
> - [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js)
> - [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js)
> - [tests/integration/circuit-breaker-trip.test.js](tests/integration/circuit-breaker-trip.test.js)
>
> If any change in this story turns one of these red, STOP and re-shape — reconciliation is its own integration surface; Bundle C's gate is orthogonal.

### AC1 — Ship `worker/src/safety/reconciliation.js` as the FR28 + AD10 Tier-3 nightly-pass SSoT (Pattern A — direct `writeAuditEvent`)

> **Mechanism trace (cited verbatim per [deferred-work.md:467](_bmad-output/implementation-artifacts/deferred-work.md#L467) 3-sighting "spec-outcome-without-mechanism" pattern + memory `feedback_trace_proposed_fixes`):**
>
> **(a) Cron call chain (autocommit-per-statement, NOT BEGIN/COMMIT-wrapped):**
> 1. `node-cron` registers `0 0 * * *` with `{ timezone: 'Europe/Lisbon' }` via [worker/src/jobs/reconciliation.js](worker/src/jobs/reconciliation.js) → wired in [worker/src/index.js](worker/src/index.js) alongside `startMasterCron` / `startPri02PollCron` / `runMonthlyPartitionCreate` calls. Mirror the defensive `.catch()` pattern from [worker/src/index.js:78-86](worker/src/index.js#L78-L86) (monthly-partition-create.js precedent) — any rejected promise must NOT escape as `unhandledRejection`.
> 2. Cron tick fires: invokes `runReconciliationPass({ pool, logger })` (the SSoT export from `worker/src/safety/reconciliation.js`).
> 3. `runReconciliationPass` executes ONE pass: `SELECT` Tier 3 sku_channels (cross-customer; see (b) below) → `for...of` per-row iteration → for each row: P11 fetch via [shared/mirakl/p11.js](shared/mirakl/p11.js) `getProductOffersByEan` (Story 3.2 wrapper, REUSED UNCHANGED) → self-filter via [shared/mirakl/self-filter.js](shared/mirakl/self-filter.js) `filterCompetitorOffers` (Story 3.2 SSoT, REUSED UNCHANGED) → branch on `filteredOffers.length`.
> 4. **No-competitors branch** (`filteredOffers.length === 0`): call `applyTierClassification({ tx, skuChannel, currentPosition: null, hasCompetitors: false })` from [worker/src/engine/tier-classify.js](worker/src/engine/tier-classify.js) (Story 7.5 SSoT — on `main` as of squash commit `6d6313a` 2026-05-13). For a row already at `tier='3'`, this returns `{ tierTransitioned: false, reason: 'no-transition-stable' }` — no UPDATE, no audit emission. Reconciliation then issues ONE `UPDATE sku_channels SET last_checked_at = NOW() WHERE id = $1` to bump the freshness column (otherwise dispatcher predicate at [dispatcher.js:62](worker/src/dispatcher.js#L62) would never see this row's `last_checked_at` advance and the row would always look stale-due).
> 5. **Has-competitors branch** (`filteredOffers.length > 0`): determine `currentPosition` from `skuChannel.current_price_cents + (min_shipping_price_cents ?? 0)` vs `filteredOffers[0].total_price` (mirror [decide.js:167-169](worker/src/engine/decide.js#L167-L169) ownTotal computation — simplified to `1` (winning) or `2` (contested)). Call `applyTierClassification({ tx, skuChannel, currentPosition, hasCompetitors: true })`. For a row at `tier='3'` with competitors: T3→T2a (if winning) or T3→T1 (if losing) — the new-tier UPDATE autocommits inside `applyTierClassification` (Story 7.5 SSoT). If `tierTransitioned === true`, reconciliation then emits TWO audit events directly via `writeAuditEvent` (Pattern A — see (c)) inline: ONE `tier-transition` Rotina + ONE `new-competitor-entered` Notável. Then `UPDATE last_checked_at = NOW()` (last_checked_at is independent of tier — bumped on every successful P11 fetch regardless of outcome).
>
> **(b) Tx topology — standalone cron, cross-customer iteration, Path I autocommit-per-statement:**
> - Reconciliation is a STANDALONE cron job, NOT inside `cycle-assembly.js`'s per-SKU loop. There is no inherited per-customer advisory lock. The `tx` parameter passed downstream to `applyTierClassification` + `writeAuditEvent` is the dispatcher-style PoolClient checked out via `await pool.connect()` — same shape as [dispatcher.js:205](worker/src/dispatcher.js#L205) but reused across ALL T3 rows in the pass (single client, sequenced autocommits per row; no per-customer lock acquisition).
> - **Path I autocommit-per-statement ratified by [SCP-2026-05-13](_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md):** each `await tx.query(...)` and each `await writeAuditEvent(...)` autocommits at its own boundary. The Bundle B "single transaction" language does NOT apply — reconciliation inherits the Story 7.4 / Story 7.5 / Story 7.6 autocommit-equivalence precedent. If `applyTierClassification`'s UPDATE succeeds and the subsequent `tier-transition` audit INSERT fails, the tier change is committed but the audit row is missing — acceptable autocommit failure mode per SCP-2026-05-13 ratification. Statement ordering preserved by JS control flow: if the UPDATE throws, control never reaches the audit emission.
> - **Cross-customer SELECT ESLint pragma (Constraint #24 per [_index.md:359](_bmad-output/planning-artifacts/architecture-distillate/_index.md) `worker-must-filter-by-customer`):** reconciliation's `SELECT id, sku_id, customer_marketplace_id, channel_code, tier, tier_cadence_minutes, last_won_at, last_checked_at, list_price_cents, current_price_cents, min_shipping_price_cents FROM sku_channels WHERE tier = '3' AND frozen_for_anomaly_review = false AND frozen_for_pri01_persistent = false AND pending_import_id IS NULL AND excluded_at IS NULL` is DELIBERATELY cross-customer — the entire purpose of FR28 is to sweep ALL customers' Tier 3 rows nightly. Precedent: [worker/src/jobs/monthly-partition-create.js:1-3](worker/src/jobs/monthly-partition-create.js#L1-L3) — top-of-file comment `// safe: cross-customer cron — creates audit_log partitions for the shared table, not per-customer rows. Not subject to worker-must-filter-by-customer rule.`. Reconciliation MUST carry an analogous top-of-file pragma block + an inline `// safe: cross-customer cron` comment IMMEDIATELY ABOVE the SELECT statement (mirroring [dispatcher.js:189](worker/src/dispatcher.js#L189) inline-pragma convention). Failing to include either fails the `worker-must-filter-by-customer` ESLint rule at CI.
>
> **(c) Pattern A (NOT Pattern C — Story 7.5 deviation):**
> - Story 7.5's `tier-classify.js` is Pattern C — UPDATE only, no `writeAuditEvent` import — because [decide.js:16-17](worker/src/engine/decide.js#L16-L17) locks the architectural rule *"decide.js does NOT import writeAuditEvent. Audit events are returned in the auditEvents[] array and emitted by the caller (cycle-assembly.js)."* and the Bundle C `full-cycle.test.js` AC1 oracle asserts on `result.auditEvents.includes(...)`.
> - Reconciliation.js is NOT inside decide.js, NOT inside cycle-assembly's emit loop. It's a STANDALONE cron. So **Pattern A applies**: reconciliation.js imports `writeAuditEvent` directly from [shared/audit/writer.js](shared/audit/writer.js) and emits `tier-transition` Rotina + `new-competitor-entered` Notável INLINE, in the same caller-supplied `tx`. Same SSoT-module family as Story 7.5's `applyTierClassification` (both touch sku_channels.tier columns) — but a DIFFERENT call site and a DIFFERENT audit-emission rule.
> - **Payload-shape callout (load-bearing — closes the [deferred-work.md:472](_bmad-output/implementation-artifacts/deferred-work.md#L472) payload-shape gap for reconciliation's emissions):** cycle-assembly's emit loop at [cycle-assembly.js:199-211](worker/src/cycle-assembly.js#L199-L211) currently emits ALL audit events with payload `{ action, newPriceCents }` regardless of slug — wrong shape for `tier-transition` rows (typedef `PayloadForTierTransition` at [shared/audit/event-types.js:260-264](shared/audit/event-types.js#L260-L264) specifies `{ fromTier, toTier, reason }`). Reconciliation.js Pattern A emissions are NOT routed through cycle-assembly's loop — reconciliation.js calls `writeAuditEvent` directly and CAN supply the correctly-shaped payload per typedef. **This makes Story 7.7 the FIRST production module to emit `tier-transition` with the canonical `{ fromTier, toTier, reason }` payload shape AND to emit `new-competitor-entered` with the canonical `{ skuId, competitorPriceCents, cycleId }` shape ([PayloadForNewCompetitorEntered](shared/audit/event-types.js#L160-L164)).** Flag this as a pre-retro data point — Epic 7 retro can use the side-by-side comparison (reconciliation.js's correct shape vs cycle-assembly's mis-shaped emissions) to drive the Bundle B payload-shape-alignment story per [deferred-work.md:472](_bmad-output/implementation-artifacts/deferred-work.md#L472) recommendation (a) — `payloadFor(slug, context)` helper inside cycle-assembly.

**Given** [worker/src/safety/reconciliation.js](worker/src/safety/reconciliation.js) does not yet exist on `main` (verified — only `circuit-breaker.js` + `anomaly-freeze.js` ship under that directory),

**When** I create the module per the FR28 + AD10 Tier-3 contract,

**Then** the module:

- Carries a top-of-file `// safe: cross-customer cron` pragma block (mirror [monthly-partition-create.js:1-3](worker/src/jobs/monthly-partition-create.js#L1-L3)) declaring the cross-tenant iteration is intentional and SSoT-scoped to this cron only.
- Exports `runReconciliationPass({ pool, logger })` as a NAMED export (no default export — Constraint #7 / architecture convention). Returns `{ skusEvaluated: number, tierTransitions: number, newCompetitorsDetected: number, staleStateWarnings: number, durationMs: number }` (mirror dispatcher's stats-return shape per [dispatcher.js:309](worker/src/dispatcher.js#L309)).
- Imports STATICALLY (no dynamic `await import` with fallback — SCP Amendment 7 per memory `feedback_bad_skills_extract_subagent_prompts` precedent + Story 7.5 AC2 precedent): `applyTierClassification` from `../engine/tier-classify.js`, `getProductOffersByEan` from `../../../shared/mirakl/p11.js`, `filterCompetitorOffers` from `../../../shared/mirakl/self-filter.js`, `writeAuditEvent` from `../../../shared/audit/writer.js`, `EVENT_TYPES` from `../../../shared/audit/event-types.js`, `toCents` from `../../../shared/money/index.js`, `decryptShopApiKey` from `../../../shared/crypto/envelope.js`, `loadMasterKey` from `../../../shared/crypto/master-key-loader.js`, `createWorkerLogger` from `../../../shared/logger.js`.
- **Master key resolution** mirrors the cron-job precedent at [worker/src/jobs/onboarding-scan.js:48-51](worker/src/jobs/onboarding-scan.js#L48-L51) and [worker/src/jobs/pri02-poll.js:31-34](worker/src/jobs/pri02-poll.js#L31-L34) — module-level `let _cachedMasterKey;` plus a lazy `function getMasterKey() { if (!_cachedMasterKey) _cachedMasterKey = loadMasterKey(); return _cachedMasterKey; }` helper. Per-customer ciphertext is decrypted via `decryptShopApiKey({ ciphertext, nonce, authTag, masterKey: getMasterKey() })` inside the iteration — matches [pri02-poll.js:121-126](worker/src/jobs/pri02-poll.js#L121) call site verbatim. Master-key is held in worker-process memory only (AD3); never logged, never exported, never written to disk.
- Inside `runReconciliationPass`: acquires ONE PoolClient via `await pool.connect()`. In a try/finally, iterates the SELECT result row-by-row (sequenced — NOT `Promise.all`; reconciliation prioritises predictable ordering over parallelism at MVP scale of 5-10 customers × ≤50k SKUs/customer). Each row's P11 fetch is sequential. The single PoolClient is released in the finally.
- For the P11 fetch: resolves the customer's `baseUrl` (from `customer_marketplaces.base_url` or hardcoded `WORTEN_BASE_URL` — verify against Story 3.2's existing call sites in [worker/src/cycle-assembly.js](worker/src/cycle-assembly.js) for the canonical resolution path) and `apiKey` (decrypt `customer_marketplaces.shop_api_key_ciphertext` via `decryptShopApiKey`). Calls `getProductOffersByEan(baseUrl, apiKey, { ean: <sku.ean>, channel: <channel_code>, pricingChannelCode: <channel_code> })` — the EAN comes from a JOIN against `skus.ean` (extend the SELECT to include it OR a per-row lookup).
- For the self-filter: passes `getProductOffersByEan`'s return value (raw offers array) + `customer_marketplaces.shop_name` (from A01 — already persisted) into `filterCompetitorOffers(rawOffers, ownShopName)`. Receives `{ filteredOffers, collisionDetected }`. On `collisionDetected === true`: log a `warn` (per memory `project_resend_env_stub_import_pattern` discipline — reconciliation is best-effort, not a critical alert path) and SKIP the row (do NOT call `applyTierClassification`; do NOT emit audit events; DO bump `last_checked_at` so the row isn't immediately retried).
- **For the no-competitors branch** (`filteredOffers.length === 0`): call `applyTierClassification({ tx: client, skuChannel, currentPosition: null, hasCompetitors: false })`. For a T3-stays-T3 row the function returns `{ tierTransitioned: false, ... }` and issues no UPDATE — reconciliation issues ONE `UPDATE sku_channels SET last_checked_at = NOW() WHERE id = $1 AND tier = '3'` (the `AND tier = '3'` guard is the same optimistic-concurrency invariant Story 7.5 uses; if a concurrent master-cron tick already transitioned the row out of T3 between our SELECT and our UPDATE, rowCount === 0 and we quietly skip — `applyTierClassification` already executed for the OLD state which is a race-loser; the new state's transition will be picked up next cycle).
- **For the has-competitors branch** (`filteredOffers.length > 0`): compute `currentPosition` (1 if winning, 2 if contested — mirror [decide.js:167-169](worker/src/engine/decide.js#L167-L169) ownTotal-vs-competitor-lowest comparison; reconciliation does NOT need full STEP 3 floor/ceiling math because reconciliation never emits PRI01 writes). Call `applyTierClassification({ tx: client, skuChannel, currentPosition, hasCompetitors: true })`. If `tierTransitioned === true`:
  - Emit `tier-transition` Rotina inline via `writeAuditEvent({ tx: client, customerMarketplaceId: skuChannel.customer_marketplace_id, skuId: skuChannel.sku_id, skuChannelId: skuChannel.id, eventType: EVENT_TYPES.TIER_TRANSITION, payload: { fromTier: tierResult.fromTier, toTier: tierResult.toTier, reason: tierResult.reason } })` — **canonical [PayloadForTierTransition](shared/audit/event-types.js#L260-L264) shape `{ fromTier, toTier, reason }`** (Story 7.7 is the first emit site to use this shape — flag in Dev Notes).
  - Emit `new-competitor-entered` Notável inline via `writeAuditEvent({ tx: client, customerMarketplaceId, skuId: skuChannel.sku_id, skuChannelId: skuChannel.id, eventType: EVENT_TYPES.NEW_COMPETITOR_ENTERED, payload: { skuId: skuChannel.sku_id, competitorPriceCents: toCents(filteredOffers[0].total_price), cycleId: <null-or-cron-tick-uuid> } })` — **canonical [PayloadForNewCompetitorEntered](shared/audit/event-types.js#L160-L164) shape `{ skuId, competitorPriceCents, cycleId }`**. `cycleId` for reconciliation MAY be null (reconciliation is not a dispatcher cycle) OR a per-pass `randomUUID()` (mirror [dispatcher.js:173](worker/src/dispatcher.js#L173)). Dev decides; document choice in Dev Agent Record. `competitorPriceCents` is converted via `toCents()` from [shared/money/index.js](shared/money/index.js) (Constraint #22 — no float-price math).
  - Issue `UPDATE sku_channels SET last_checked_at = NOW() WHERE id = $1` (no `AND tier=...` guard here — the tier already transitioned in this same pass; the UPDATE is freshness-bookkeeping only).
- **For the optimistic-concurrency race-loser** (`applyTierClassification` returns `{ tierTransitioned: false, reason: 'concurrent-transition-detected' }`): log `warn`, skip the row's audit emissions (the winning tx already emitted them), still `UPDATE last_checked_at = NOW()` for freshness.
- Logs structured per-row outcomes via pino at `info` level for transitions, `debug` for steady-state, `warn` for collisions / race-losers / stale-state (AC3).
- The audit emission MUST use the SSoT path (`writeAuditEvent`) — Constraint #21 `no-raw-INSERT-audit-log` ESLint rule flags any raw `INSERT INTO audit_log` outside `shared/audit/writer.js`.

**Inputs (named-param shape):**
- `pool` — `pg` Pool injected by the cron entry. Reconciliation acquires ONE client via `pool.connect()` and reuses it across the entire pass.
- `logger` — pino logger from the cron caller (do NOT create a new logger at module load — mirror [monthly-partition-create.js:60](worker/src/jobs/monthly-partition-create.js#L60) signature).

**Return shape:**
```js
{
  skusEvaluated: number,            // total T3 rows iterated
  tierTransitions: number,           // count where applyTierClassification returned tierTransitioned=true
  newCompetitorsDetected: number,    // count where filteredOffers.length > 0 (subset of tierTransitions when fromTier='3')
  staleStateWarnings: number,        // count of AC3 warn-log emissions
  durationMs: number,
}
```

**ESLint constraints enforced by this module:**
- **Constraint #18** (no console.log): pino via `logger` parameter; never `console.log`.
- **Constraint #19** (no direct `fetch` outside `shared/mirakl/`): all P11 HTTP calls routed via `getProductOffersByEan`. Reconciliation makes NO direct HTTP calls.
- **Constraint #21** (no raw `INSERT INTO audit_log` outside `shared/audit/writer.js`): all 2 audit emissions go via `writeAuditEvent`.
- **Constraint #22** (no float-price math outside `shared/money/index.js`): `toCents()` converts P11's JSON-number total_price to integer cents at the boundary.
- **Constraint #24** (worker-must-filter-by-customer): cross-customer SELECT carries the `// safe: cross-customer cron` pragma comment (both file-top + inline-above-the-query — see (b) above for the dual-pragma precedent).
- **No default export**: only named exports (`runReconciliationPass`).
- **No `.then()` chains**: async/await only.

**Reference SSoT pattern:** mirror [worker/src/safety/anomaly-freeze.js](worker/src/safety/anomaly-freeze.js) (Story 7.4 Pattern A — UPDATE + writeAuditEvent inline in caller-supplied tx, named exports, JSDoc typedefs, pino logger via worker logger). Reconciliation deviates from anomaly-freeze ONLY by: (a) iterating cross-customer (vs single-row), (b) being a cron entry point (vs a function called from cooperative-absorb), (c) carrying the cross-customer pragma per Constraint #24.

**Source:** [04-epic-7-engine-safety.md Story 7.7 AC#1](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L154-L158) + FR28 + AD10 + SCP-2026-05-13 Path I + memory `feedback_trace_proposed_fixes` (3-sighting mechanism-trace) + memory `feedback_bad_skills_extract_subagent_prompts` (SCP Amendment 7 — no stub-fallbacks).

### AC2 — Ship `worker/src/jobs/reconciliation.js` cron entry + wire `worker/src/index.js`

**Given** [worker/src/jobs/reconciliation.js](worker/src/jobs/reconciliation.js) does not yet exist on `main` AND [worker/src/index.js:1-109](worker/src/index.js#L1-L109) currently wires 4 cron / poller jobs (`startHeartbeat`, `startMasterCron`, `startPri02PollCron`, `runMonthlyPartitionCreate` via inline `cron.schedule`, `processNextPendingScan` via `setInterval`),

**When** I add the reconciliation cron entry + index.js wiring,

**Then**:

- **`worker/src/jobs/reconciliation.js`** exports `startReconciliationCron(logger)` (factory pattern matching [master-cron.js:38](worker/src/jobs/master-cron.js#L38) `startMasterCron` and [monthly-partition-create.js:60](worker/src/jobs/monthly-partition-create.js#L60) `runMonthlyPartitionCreate`). The factory:
  - Imports `cron` from `'node-cron'`, `runReconciliationPass` from `'../safety/reconciliation.js'`, `getServiceRoleClient` from `'../../../shared/db/service-role-client.js'`.
  - Registers `cron.schedule('0 0 * * *', () => { ... }, { timezone: 'Europe/Lisbon' })` — daily at midnight Lisbon time. Cron expression rationale: `0 0 * * *` = minute 0, hour 0, every day, every month, every day-of-week → exactly midnight in the supplied timezone. Verify via [node-cron README](https://www.npmjs.com/package/node-cron#cron-syntax) — `tz` option is the official param name on `node-cron` ≥3.0; this codebase uses `timezone` per [worker/src/index.js:85](worker/src/index.js#L85) which matches v3+ semantics. If `node --check worker/src/jobs/reconciliation.js` surfaces a node-cron API mismatch, dev verifies the installed version via `cat package.json` and adjusts the param name if needed.
  - Wraps the cron callback in a defensive `.catch()` per the [worker/src/index.js:78-86](worker/src/index.js#L78-L86) precedent — `runReconciliationPass({ pool: getServiceRoleClient(), logger }).catch((err) => { logger.error({ err }, 'reconciliation: cron callback rejected'); })`. Mandatory — without it any rejection propagates as `unhandledRejection` and may destabilise the worker process.
  - Logs at registration: `logger.info('reconciliation: daily Tier-3 nightly-pass cron registered (midnight Lisbon)')`.
  - Returns `void` (matches `startMasterCron` shape).
- **`worker/src/index.js` wire-up**: add `import { startReconciliationCron } from './jobs/reconciliation.js';` to the imports block (line 8 area, alphabetical after `runMonthlyPartitionCreate`). After the `cron.schedule('0 2 28 * *', ...)` block at [index.js:78-86](worker/src/index.js#L78-L86), add:
  ```js
  // Story 7.7: Daily Tier-3 nightly-reconciliation cron.
  // Fires every day at midnight Lisbon time — runs runReconciliationPass to sweep
  // every Tier 3 sku_channel across ALL customers, fetch P11 + self-filter, apply
  // tier-classification on real transitions, and emit tier-transition +
  // new-competitor-entered audit events directly (Pattern A — bypasses
  // cycle-assembly's emit loop and supplies the canonical PayloadForTierTransition
  // + PayloadForNewCompetitorEntered shapes per shared/audit/event-types.js).
  // Independent schedule from master-cron.js; no in-flight guard needed
  // (reconciliation is daily; master-cron is 5-min; both share Story 7.5's
  // optimistic-concurrency guard `WHERE id=$N AND tier=$expectedFromTier` for
  // race resolution on the rare overlap window).
  startReconciliationCron(logger);
  ```
- **NO advisory lock acquisition by reconciliation.** Rationale: Story 7.5's optimistic-concurrency guard in [tier-classify.js:117](worker/src/engine/tier-classify.js#L117) (`WHERE id = $N AND tier = $expectedFromTier`) handles the master-cron-vs-reconciliation race directly. If master-cron's 5-min tick happens to pick up a T3 row in the same millisecond reconciliation is processing it, only one transition wins; the other returns `concurrent-transition-detected`. Adding `pg_try_advisory_lock` per customer would prevent THIS race but would also serialise reconciliation behind any in-flight master-cron cycle holding the customer's advisory lock — defeats the daily-pass guarantee. Document this rationale in [worker/src/jobs/reconciliation.js](worker/src/jobs/reconciliation.js) top-of-file comment.
- **Boot test (per memory `feedback_step5_import_path_boot_check`):** `node --check worker/src/jobs/reconciliation.js` + `node --check worker/src/safety/reconciliation.js` + `node --check worker/src/index.js` all pass clean. This catches import-path errors before they surface in a live worker boot.

**Out-of-scope:**
- The cron expression's seconds field — `node-cron` defaults to minute precision; `'0 0 * * *'` is 5-field (no seconds). Do NOT use a 6-field expression like `'0 0 0 * * *'` unless `node-cron` defaults to 6-field mode (it does NOT; this codebase uses 5-field per [index.js:79](worker/src/index.js#L79) `'0 2 28 * *'`).
- Cron-overlap protection (in-flight guard like master-cron's `_dispatchInFlight`). Reconciliation runs ONCE per day; the master-cron tick that fires at exactly midnight Lisbon (next 5-min tick at 00:00 + ~5min jitter) is a separate process — overlap is bounded by the optimistic-concurrency guard. If empirical issues surface during dogfood, Phase 2 can add a `_reconciliationInFlight` flag mirroring master-cron's pattern.

**Source:** [04-epic-7-engine-safety.md Story 7.7 AC#1 cron registration](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L158) + [worker/src/index.js:78-86](worker/src/index.js#L78-L86) defensive `.catch()` precedent + [worker/src/jobs/master-cron.js:38-55](worker/src/jobs/master-cron.js#L38-L55) factory-shape precedent.

### AC3 — Stale-state detection mechanism (epic AC#2) — observability via warn-log; same-iteration P11 call IS the recovery

> **Pre-AC mechanism trace (closes the epic AC#2 mechanism ambiguity Pedro flagged in the 2026-05-13 brief — "is 'force a check this cycle' a SECOND P11 call within the same reconciliation run, or a flag that gets surfaced for the next dispatcher tick to pick up?"):**
>
> The dispatcher predicate at [dispatcher.js:62](worker/src/dispatcher.js#L62) is `sc.last_checked_at + (sc.tier_cadence_minutes * INTERVAL '1 minute') < NOW()`. For T3 rows (`tier_cadence_minutes = 1440`), this fires whenever `last_checked_at + 1440 minutes < NOW()` — i.e., whenever the row has been waiting ≥24h since its last check. A "drifted" T3 row (e.g., `last_checked_at = NOW() - 50h` because the dispatcher backlogged its 1440-min slot) ALREADY satisfies this predicate; the dispatcher WILL pick it up the next cycle it has capacity for. **The dispatcher's WHERE clause already covers the recovery case — no separate "force-check" mechanism is required.**
>
> Reconciliation's job per FR28 is the BACKSTOP — guarantee no T3 SKU is silently stranded if the dispatcher's daily slot is delayed. Since reconciliation already iterates EVERY T3 row in its pass (the SELECT at AC1 has NO `last_checked_at` predicate — it grabs ALL T3 rows regardless of age), reconciliation INHERENTLY recovers drifted rows: the same iteration that detects the drift IS the recovery (the P11 fetch happens for that row in this very pass).
>
> So the stale-state mechanism for AC3 is **observability-only**: detect drift, log a warn line, proceed with the iteration's existing P11 → applyTierClassification → emit flow. No second P11 call, no flag for next dispatcher tick. The warn-log surfaces drift to operators so they can investigate dispatcher backlog (e.g., if dozens of T3 rows are drifted, the master-cron is falling behind and Phase 2 may need batch-size tuning).

**Given** the AC1 iteration loop processes every T3 sku_channel row,

**When** for any iterated row `last_checked_at + (tier_cadence_minutes * 2) * INTERVAL '1 minute' < NOW()` (drift threshold = 2× cadence — so a T3 row whose `last_checked_at` is older than 2880 minutes / 48 hours fires this branch),

**Then** reconciliation:

- Emits ONE pino `warn` log line via the supplied `logger` with structured fields: `{ skuChannelId, customerMarketplaceId, lastCheckedAt, tierCadenceMinutes, driftMinutes }` where `driftMinutes = Math.floor((Date.now() - new Date(lastCheckedAt).getTime()) / 60000)`. The message string: `'reconciliation: stale-state detected — last_checked_at older than tier_cadence_minutes * 2 (dispatcher backlog suspected; reconciliation will recover this row in current pass)'`.
- Increments the `staleStateWarnings` counter in the pass-summary stats (returned in AC1's `runReconciliationPass` return value).
- **Does NOT skip the row.** Iteration continues with the row's standard P11 → self-filter → applyTierClassification flow. The same-pass P11 call IS the recovery — `last_checked_at` is bumped to NOW() at the end of this row's iteration (per AC1).
- **Does NOT emit an audit event for stale-state.** Drift is observability, not a customer-facing event. AD20 taxonomy is locked at 28 entries; `stale-state` / `reconciliation-drift` are NOT in the taxonomy. Phase 2 can add a `cycle-fail-sustained`-style event if operational signal warrants.
- The drift threshold `tier_cadence_minutes * 2` is computed in JS (NOT in the SELECT WHERE clause — keeps the SELECT simple; the check fires per-row inside the iteration with no DB cost). Use integer arithmetic: `Date.now() - new Date(row.last_checked_at).getTime() > row.tier_cadence_minutes * 2 * 60 * 1000`.

**Scope guard:** AC3 does NOT modify the SELECT predicate. The SELECT grabs ALL T3 rows (no `last_checked_at` filter) because reconciliation's promise is exhaustive Tier-3 coverage. Adding a `last_checked_at` filter to the SELECT would defeat the daily-pass guarantee.

**Documented deviation flag (informational — defer to Epic 7 retro):** the epic AC#2 wording at [04-epic-7-engine-safety.md:159](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L159) says *"forces a check this cycle to recover"* — ambiguously suggesting an explicit second-action recovery. The mechanism trace above clarifies the dispatcher's WHERE clause already covers the recovery; the same-iteration P11 call IS the recovery for the reconciliation pass. Epic 7 retro can choose to: (a) leave the epic wording as-is (mechanism captured in story spec is sufficient), or (b) reword the epic to *"surfaces the drift in warn logs; the iteration's P11 call recovers the row's freshness"*. Do NOT attempt to edit the epic spec in this story — Bob-owned recovery via `/bmad-correct-course` if Pedro wants closure earlier (per memory `feedback_correct_course_validated_for_spec_failures`).

**Source:** [04-epic-7-engine-safety.md Story 7.7 AC#2](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L159) + dispatcher predicate at [dispatcher.js:62](worker/src/dispatcher.js#L62) + memory `feedback_trace_proposed_fixes` (mechanism trace before AC text — pre-AC trace section above).

### AC4 — Unit tests for `reconciliation.js` (synthetic constructs covering FR28 + AC3 + the 3 Story-7.5-aligned scenarios)

**Given** the new SSoT module needs its own unit-test surface (per architecture directory tree convention — [tests/worker/safety/](tests/worker/safety/) hosts `anomaly-freeze.test.js` + `circuit-breaker.test.js` + reconciliation.test.js will join them),

**When** I add unit tests under [tests/worker/safety/reconciliation.test.js](tests/worker/safety/reconciliation.test.js),

**Then** the test file covers (per SCP Amendment 4 — fixture `_expected` is the sole oracle; the 3 Story-7.5-bound fixtures cover engine-path tier transitions but reconciliation's iteration-driven path needs SYNTHETIC constructs to exercise the stale-state branch + the no-EAN-on-sku-channel path that the engine never sees):

1. **T3 with no competitors → no transition, last_checked_at bumped, no audit event** (mirror p11-tier3-no-competitors fixture's _expected.tier='3', _expected.auditEvent='tier-transition' [the fixture's auditEvent is set for the engine path's STEP 1 emission per Story 7.5 AC4 — reconciliation does NOT emit on steady-state, so this test does NOT replicate that auditEvent assertion]):
   - Synthetic skuChannel: `{ id: 'sc-1', tier: '3', tier_cadence_minutes: 1440, last_checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000), last_won_at: null, customer_marketplace_id: 'cm-1', sku_id: 'sku-1', channel_code: 'WRT_PT_ONLINE', current_price_cents: 3000, min_shipping_price_cents: 0 }` (25h old — past 1440-min cadence, NOT past 2880-min drift threshold).
   - Mock `getProductOffersByEan` returns `[]` (no competitors).
   - Mock `applyTierClassification` returns `{ tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'no-transition-stable' }`.
   - Asserts:
     - Exactly 1 `UPDATE sku_channels SET last_checked_at = NOW() WHERE id = $1 AND tier = '3'` query captured (the freshness bump).
     - **ZERO** `writeAuditEvent` calls (mock-spy on `writeAuditEvent` import — verify `callCount === 0` for this row).
     - Return-shape stats: `skusEvaluated: 1, tierTransitions: 0, newCompetitorsDetected: 0, staleStateWarnings: 0`.

2. **T3 with new competitor + winning → T3→T2a transition + 2 audit emissions (`tier-transition` + `new-competitor-entered`), both with canonical payload shapes** (mirror p11-tier3-then-new-competitor fixture's transition rationale; reconciliation emits Pattern A audit rows the engine path can't replicate):
   - Synthetic skuChannel: `{ id: 'sc-2', tier: '3', tier_cadence_minutes: 1440, last_checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000), last_won_at: null, customer_marketplace_id: 'cm-1', sku_id: 'sku-2', channel_code: 'WRT_PT_ONLINE', current_price_cents: 4500, min_shipping_price_cents: 0 }`.
   - Mock `getProductOffersByEan` returns `[{ active: true, total_price: 4999, shop_name: 'CompetitorA' }]` (1 competitor, 4999 > our 4500 → we win at position 1).
   - Mock `applyTierClassification` returns `{ tierTransitioned: true, fromTier: '3', toTier: '2a', reason: 'won-1st-place-from-tier3' }`.
   - Asserts:
     - `writeAuditEvent` called EXACTLY twice (spy captures both call args).
     - Call 1: `eventType === EVENT_TYPES.TIER_TRANSITION`, payload **shape match `{ fromTier: '3', toTier: '2a', reason: 'won-1st-place-from-tier3' }`** (deep-equal against canonical [PayloadForTierTransition](shared/audit/event-types.js#L260-L264) shape — load-bearing per AC1 (c) payload-shape callout).
     - Call 2: `eventType === EVENT_TYPES.NEW_COMPETITOR_ENTERED`, payload **shape match `{ skuId: 'sku-2', competitorPriceCents: 499900, cycleId: <string-or-null> }`** (deep-equal against canonical [PayloadForNewCompetitorEntered](shared/audit/event-types.js#L160-L164) — `competitorPriceCents` is `toCents(4999)` = `499900`).
     - Exactly 1 `UPDATE sku_channels SET last_checked_at = NOW() WHERE id = $1` query captured (no `AND tier=...` guard — tier already transitioned in same pass).
     - Return-shape stats: `tierTransitions: 1, newCompetitorsDetected: 1`.

3. **T3 with new competitor + losing → T3→T1 transition + 2 audit emissions** (currentPosition > 1 branch):
   - Synthetic skuChannel: `{ id: 'sc-3', tier: '3', tier_cadence_minutes: 1440, last_checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000), last_won_at: null, customer_marketplace_id: 'cm-1', sku_id: 'sku-3', channel_code: 'WRT_PT_ONLINE', current_price_cents: 5500, min_shipping_price_cents: 0 }`.
   - Mock `getProductOffersByEan` returns `[{ active: true, total_price: 4999, shop_name: 'CompetitorA' }]` (1 competitor, 4999 < our 5500 → we lose at position 2).
   - Mock `applyTierClassification` returns `{ tierTransitioned: true, fromTier: '3', toTier: '1', reason: 'lost-1st-place-from-tier3' }`.
   - Asserts:
     - 2 `writeAuditEvent` calls (TIER_TRANSITION with `{ fromTier: '3', toTier: '1', reason: 'lost-1st-place-from-tier3' }` + NEW_COMPETITOR_ENTERED with `{ skuId: 'sku-3', competitorPriceCents: 499900, cycleId: <...> }`).
     - last_checked_at bumped.
     - Return-shape stats: `tierTransitions: 1, newCompetitorsDetected: 1`.

4. **Stale-state detection (AC3) — drift threshold 2× cadence triggers warn-log** (synthetic — NO fixture covers this scenario; per Story 7.5 dev notes rationale "synthetic ≠ hand-coded fixture-oracle violation"):
   - Synthetic skuChannel: `{ id: 'sc-4', tier: '3', tier_cadence_minutes: 1440, last_checked_at: new Date(Date.now() - 50 * 60 * 60 * 1000), ... }` (50h old — past 2880-min drift threshold).
   - Mock `getProductOffersByEan` returns `[]` (no competitors — keeps the test focused on drift detection).
   - Spy on `logger.warn` calls.
   - Asserts:
     - `logger.warn` called at least once with a message containing the substring `'stale-state detected'` (or the canonical message text per AC3) AND structured fields `{ skuChannelId, customerMarketplaceId, lastCheckedAt, tierCadenceMinutes, driftMinutes }`. The `driftMinutes` value is `≥3000` (50h × 60 - some integer-truncation slack).
     - The row still receives its standard `UPDATE last_checked_at = NOW()` (drift detection does NOT skip the row — AC3 scope guard).
     - Return-shape stats: `staleStateWarnings: 1`.

5. **Shop-name collision (defensive) → warn-log + skip, no audit emissions, last_checked_at still bumped**:
   - Synthetic skuChannel: as in test 1.
   - Mock `getProductOffersByEan` returns `[{ active: true, total_price: 4500, shop_name: 'Easy - Store' }, { active: true, total_price: 4500, shop_name: 'Easy - Store' }]` (two offers with our own shop name — AD13 collision).
   - `customer_marketplaces.shop_name` mock returns `'Easy - Store'`.
   - Asserts:
     - `logger.warn` called with collision message.
     - **ZERO** `writeAuditEvent` calls.
     - `applyTierClassification` NOT called.
     - `UPDATE last_checked_at = NOW()` still issued (so the row isn't retried immediately).

6. **Optimistic-concurrency race-loser (applyTierClassification returns `concurrent-transition-detected`) → warn-log, NO audit emissions, last_checked_at still bumped**:
   - Synthetic skuChannel: T3 with competitors.
   - Mock `applyTierClassification` returns `{ tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'concurrent-transition-detected' }`.
   - Asserts:
     - `logger.warn` called with race-loss message.
     - **ZERO** `writeAuditEvent` calls (winning tx already emitted them; AC1 race-loser scope guard).
     - `UPDATE last_checked_at = NOW()` still issued.

7. **Cross-customer iteration covers all customers — SELECT predicate has no `customer_marketplace_id` filter**:
   - Mock pool query returns 3 rows: 2 from `cm-1`, 1 from `cm-2` — both customers' T3 rows present in the SELECT result.
   - Mock all P11 fetches to return `[]` (steady-state for both customers).
   - Asserts:
     - The captured SELECT query SQL string MUST NOT include `customer_marketplace_id = $...` or any per-customer filter. The captured SQL string MUST include `tier = '3'` AND the excluded-predicates (`frozen_for_anomaly_review = false`, `frozen_for_pri01_persistent = false`, `pending_import_id IS NULL`, `excluded_at IS NULL`).
     - The captured SELECT query is preceded by an inline `// safe: cross-customer cron` comment in the source — verified via static-source inspection (regex `/\/\/\s*safe:\s*cross-customer\s+cron\s*\n\s*(await\s+)?(?:client|tx|pool)\.query\(/i` matches in `worker/src/safety/reconciliation.js`). This is the dual-precedent pattern: file-top pragma + inline-pragma above the SELECT (mirror [dispatcher.js:189](worker/src/dispatcher.js#L189) + [monthly-partition-create.js:1-3](worker/src/jobs/monthly-partition-create.js#L1-L3)).
     - Return-shape stats: `skusEvaluated: 3`.

**Mock-tx pattern:** mirror [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js) (Story 7.4 pattern — captures `{ sql, params }` per `tx.query` call) and reuse the `RESEND_API_KEY` env-stub + `await import` pattern from memory `project_resend_env_stub_import_pattern` (NOT directly required since reconciliation.js does NOT import `shared/resend/client.js` — verify during Task 4; if Task 4 surfaces a transitive resend dependency via `shared/audit/writer.js`, apply the env-stub pattern at the top of the test file before the `await import` of reconciliation.js).

**Mock-pool pattern:** synthesize a minimal `pool` object with a single `connect()` returning a mock `PoolClient` whose `.query()` captures all `{ sql, params }` and returns configurable `{ rowCount, rows }`. Mock `release()` as a no-op. This is sufficient for unit-test coverage; the integration-test path (full DB + mock Mirakl) is OUT-OF-SCOPE for this story per epic AC#3 wording.

**Static imports for production modules (SCP Amendment 7 — no stub-fallbacks):** the test file uses spy-on / mock-injection patterns for `applyTierClassification`, `getProductOffersByEan`, `writeAuditEvent`. These are mocked at TEST level (e.g., via dependency-injection on a test-export factory OR via `node:test --import` / module-loader override). The production `reconciliation.js` source MUST static-import these — no dynamic-import-with-fallback. If the test runner can't intercept the static imports cleanly, dev introduces a thin DI wrapper at the top of `runReconciliationPass` (`{ p11Fetcher, tierClassifier, auditWriter } = deps ?? defaults`) where `defaults` static-imports the production modules. Document the chosen path in Dev Agent Record.

**Source:** [04-epic-7-engine-safety.md Story 7.7 AC#3](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L160) + SCP Amendment 4 (fixture _expected sole oracle) + Story 7.5 dev notes (synthetic ≠ hand-coded fixture-oracle violation) + memory `project_resend_env_stub_import_pattern` (env-stub + await import discipline if transitive dependency surfaces).

### AC5 — Run boot + lint + Bundle C floor + full-suite verification

**Given** Story 7.7 ships 2 NEW production files + 1 edited file + 1 NEW test file,

**When** the dev completes Tasks 1-4,

**Then** the following commands ALL pass clean:

1. **Module boot tests** (per memory `feedback_step5_import_path_boot_check`):
   - `node --check worker/src/safety/reconciliation.js` → no syntax error.
   - `node --check worker/src/jobs/reconciliation.js` → no syntax error (verifies the `import` of reconciliation.js resolves at parse time).
   - `node --check worker/src/index.js` → no syntax error (verifies the new `startReconciliationCron` import resolves at parse time).

2. **Bundle C green floor (non-negotiable — corrected from spec drift per [deferred-work.md:481](_bmad-output/implementation-artifacts/deferred-work.md#L481))**:
   - `node --test tests/integration/full-cycle.test.js tests/integration/pending-import-id-invariant.test.js tests/integration/circuit-breaker-trip.test.js` → **≥47 pass, 0 fail** (`main` baseline 47/47; Story 7.7 does NOT modify any of the 3 files and does NOT add new test cases to them — reconciliation has its own integration surface). If the spec language elsewhere reads "≥48", that's a pre-existing spec drift (Story 7.4's promised positive-assertion expansion to 48 did not materialise on `main` per the Story 7.5 review). Story 7.7 does NOT attempt to close that drift — it's a separate, deferred concern.

3. **New unit tests pass**:
   - `node --test tests/worker/safety/reconciliation.test.js` → all 7 test cases per AC4 pass.

4. **Existing unit tests do NOT regress**:
   - `node --test tests/worker/engine/decide.test.js` → all Story 7.2 + Story 7.5 wire-up tests pass (no change expected; reconciliation does not touch decide.js).
   - `node --test tests/worker/engine/tier-classify.test.js` → all 10+ Story 7.5 tests pass (reconciliation re-uses `applyTierClassification` via static import; the imported module's behavior is unchanged).
   - `node --test tests/worker/engine/cooperative-absorb.test.js` → all Story 7.3 + Story 7.4 wire-up tests pass.
   - `node --test tests/worker/safety/circuit-breaker.test.js` → all Story 7.6 tests pass.
   - `node --test tests/worker/safety/anomaly-freeze.test.js` → all Story 7.4 tests pass.

5. **Lint clean on touched files**:
   - `npm run lint` → no new lint errors on `worker/src/safety/reconciliation.js`, `worker/src/jobs/reconciliation.js`, or `worker/src/index.js`.
   - Specifically verify:
     - `no-default-export`, `no-console` pass.
     - `worker-must-filter-by-customer` does NOT flag `worker/src/safety/reconciliation.js` — the dual-pragma (file-top + inline-above-SELECT) suppresses the rule per its design.
     - `no-direct-fetch` does NOT flag `worker/src/safety/reconciliation.js` — all HTTP calls routed via `shared/mirakl/p11.js`.
     - `no-raw-INSERT-audit-log` does NOT flag `worker/src/safety/reconciliation.js` — all audit emissions via `writeAuditEvent`.
     - `no-float-price` does NOT flag the `toCents(filteredOffers[0].total_price)` call inside reconciliation.

6. **Full unit suite floor**:
   - `npm run test:unit` (or equivalent target — verify against `package.json` test scripts) → total fail count does NOT regress beyond the post-Story-7.5 baseline (~23 pre-existing unit fails per [sprint-status.yaml:170 review-findings](_bmad-output/implementation-artifacts/sprint-status.yaml#L170)). Newly-failing tests attributable to Story 7.7 are 0.

7. **No new migration**:
   - `npx supabase migration list` → no diff vs `main`. The required `sku_channels` columns (`tier`, `tier_cadence_minutes`, `last_won_at`, `last_checked_at`) all exist per [supabase/migrations/202604301206_create_sku_channels.sql:17-21](supabase/migrations/202604301206_create_sku_channels.sql#L17-L21). The `tier_value` enum is defined at [L1](supabase/migrations/202604301206_create_sku_channels.sql#L1). The `audit_log_event_types` table (Story 9.0) + `audit_log` partition table (Story 9.1) already host both `tier-transition` Rotina and `new-competitor-entered` Notável as seeded rows.

8. **Worker boot smoke (Optional — Task 5 verification step):**
   - Local-only manual smoke: with `.env.local` configured for a dev Postgres, run `npm run start:worker` and verify the log line `'reconciliation: daily Tier-3 nightly-pass cron registered (midnight Lisbon)'` appears at boot. Do NOT wait for the midnight tick — registration confirmation is sufficient.

**Source:** memory `feedback_step5_import_path_boot_check` + Bundle C close-out retro §W2 unit-test floor + [deferred-work.md:481](_bmad-output/implementation-artifacts/deferred-work.md#L481) Bundle C 47/47 baseline correction + SCP Amendment 4 fixture-oracle discipline.

---

## Tasks / Subtasks

> Tasks are grouped to match the AC numbering. Each AC owns one task; sub-tasks decompose by file.

- [ ] **Task 1 (AC1)** — Create `worker/src/safety/reconciliation.js` SSoT module
  - [ ] Create [worker/src/safety/reconciliation.js](worker/src/safety/reconciliation.js) with top-of-file `// safe: cross-customer cron` pragma block + JSDoc module-level comment block per AC1 contract.
  - [ ] Add the named export `runReconciliationPass({ pool, logger })` with JSDoc typedef documenting params + return shape; reference `PayloadForTierTransition` from [shared/audit/event-types.js:260-264](shared/audit/event-types.js#L260-L264) AND `PayloadForNewCompetitorEntered` from [shared/audit/event-types.js:160-164](shared/audit/event-types.js#L160-L164) in the module-level comment.
  - [ ] Static-import `applyTierClassification` from `../engine/tier-classify.js`, `getProductOffersByEan` from `../../../shared/mirakl/p11.js`, `filterCompetitorOffers` from `../../../shared/mirakl/self-filter.js`, `writeAuditEvent` from `../../../shared/audit/writer.js`, `EVENT_TYPES` from `../../../shared/audit/event-types.js`, `toCents` from `../../../shared/money/index.js`, `decryptShopApiKey` from `../../../shared/crypto/envelope.js`, `loadMasterKey` from `../../../shared/crypto/master-key-loader.js`, `createWorkerLogger` from `../../../shared/logger.js`. No dynamic-import fallback — SCP Amendment 7. Add module-level `let _cachedMasterKey;` + lazy `getMasterKey()` helper mirroring [worker/src/jobs/onboarding-scan.js:48-51](worker/src/jobs/onboarding-scan.js#L48-L51) + [worker/src/jobs/pri02-poll.js:31-34](worker/src/jobs/pri02-poll.js#L31-L34); decrypt per-row via `decryptShopApiKey({ ciphertext, nonce, authTag, masterKey: getMasterKey() })` (mirrors [pri02-poll.js:121-126](worker/src/jobs/pri02-poll.js#L121)).
  - [ ] Implement the SELECT (cross-customer, ALL T3 rows, NO `customer_marketplace_id` filter) — include inline `// safe: cross-customer cron` comment immediately above the `await client.query(...)` line per the [dispatcher.js:189](worker/src/dispatcher.js#L189) precedent. SELECT columns include EVERYTHING needed downstream (id, sku_id, customer_marketplace_id, channel_code, tier, tier_cadence_minutes, last_won_at, last_checked_at, list_price_cents, current_price_cents, min_shipping_price_cents) — and JOIN against `skus.ean` (so the P11 wrapper has the EAN it needs) and `customer_marketplaces.shop_name` + `customer_marketplaces.base_url` + `customer_marketplaces.shop_api_key_ciphertext` (for the P11 call). Verify exact JOIN shape against the existing schema — if multiple JOINs are awkward, dev may split into a 2-query pattern (1st: SELECT T3 sku_channels; 2nd: per-customer lookup of marketplace creds) — document choice in Dev Agent Record.
  - [ ] Acquire ONE `await pool.connect()` for the pass; release in `try/finally`.
  - [ ] Iterate sequentially (NOT `Promise.all`); for each row: drift-check (AC3), P11 fetch, self-filter, collision-guard, `applyTierClassification` call, audit emissions (Pattern A — 2 inline `writeAuditEvent` calls on real transitions), `last_checked_at` bump.
  - [ ] Audit emission payload shapes: `tier-transition` → `{ fromTier, toTier, reason }`; `new-competitor-entered` → `{ skuId, competitorPriceCents, cycleId }`. **Both shapes MUST match the canonical typedefs.**
  - [ ] Log structured per-row outcomes via pino: `info` on real transition (with transition details), `debug` on steady-state / race-loss, `warn` on collision / stale-state / race-loss.
  - [ ] Return pass-summary stats per AC1 return-shape contract.
  - [ ] Verify no `console.log`, no default export, no `.then()`, no raw `INSERT INTO audit_log`, no direct `fetch(`.
  - [ ] Run `node --check worker/src/safety/reconciliation.js` — boot test passes.

- [ ] **Task 2 (AC2)** — Create `worker/src/jobs/reconciliation.js` + wire `worker/src/index.js`
  - [ ] Create [worker/src/jobs/reconciliation.js](worker/src/jobs/reconciliation.js) with named export `startReconciliationCron(logger)`. Mirror [worker/src/jobs/master-cron.js](worker/src/jobs/master-cron.js) factory shape. Register `cron.schedule('0 0 * * *', () => { runReconciliationPass({ pool: getServiceRoleClient(), logger }).catch(...); }, { timezone: 'Europe/Lisbon' })`.
  - [ ] Add top-of-file comment block documenting: cron schedule, optimistic-concurrency rationale for NOT acquiring advisory locks per AC2 contract, defensive `.catch()` rationale.
  - [ ] Edit [worker/src/index.js](worker/src/index.js) — add `import { startReconciliationCron } from './jobs/reconciliation.js';` to the imports block (alphabetical after `runMonthlyPartitionCreate`). After the `cron.schedule('0 2 28 * *', ...)` block at lines 78-86, add `startReconciliationCron(logger);` with the JSDoc-block comment per AC2 contract.
  - [ ] Run `node --check worker/src/jobs/reconciliation.js` + `node --check worker/src/index.js` — both pass clean.

- [ ] **Task 3 (AC3)** — Implement stale-state detection
  - [ ] Inside `runReconciliationPass` iteration loop, BEFORE the P11 fetch for each row, compute `driftMs = Date.now() - new Date(row.last_checked_at).getTime()` and `thresholdMs = row.tier_cadence_minutes * 2 * 60 * 1000`. If `driftMs > thresholdMs`, emit `logger.warn(...)` with the AC3 message + structured fields, and increment `staleStateWarnings` in the pass-summary counter.
  - [ ] **Do NOT skip the row.** Iteration continues with the standard P11 → self-filter → applyTierClassification flow. The same-pass P11 call IS the recovery.
  - [ ] **Do NOT emit an audit event for stale-state.** Drift is observability, not in AD20.
  - [ ] Document the deviation flag (epic AC#2 wording vs mechanism-trace clarification) in Dev Agent Record.

- [ ] **Task 4 (AC4)** — Unit tests for `reconciliation.js`
  - [ ] Create [tests/worker/safety/reconciliation.test.js](tests/worker/safety/reconciliation.test.js) with the 7 test cases per AC4.
  - [ ] Reuse the mock-tx pattern from [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js) (capture `{ sql, params }` per `tx.query`; configurable `{ rowCount, rows }` return; spy / mock-injection for `writeAuditEvent` + `applyTierClassification` + `getProductOffersByEan`).
  - [ ] Verify `RESEND_API_KEY` env-stub is NOT required (reconciliation.js does NOT import `shared/resend/client.js` — confirm by greping the source). If a transitive dependency surfaces during Task 4, apply the env-stub + `await import` pattern at the top of the test file per memory `project_resend_env_stub_import_pattern`.
  - [ ] Test 2 (T3→T2a with new competitor) — load-bearing payload-shape assertions: deep-equal against the canonical `{ fromTier, toTier, reason }` AND `{ skuId, competitorPriceCents, cycleId }` shapes. Document the choice of `cycleId` (null vs per-pass UUID) in Dev Agent Record.
  - [ ] Test 7 (cross-customer SELECT) — verify both (a) the SELECT SQL captured by the mock-pool has NO `customer_marketplace_id = $...` filter, AND (b) the source file contains the inline `// safe: cross-customer cron` comment above the SELECT (via filesystem read + regex match in the test).
  - [ ] Run `node --test tests/worker/safety/reconciliation.test.js` — all 7 tests pass.

- [ ] **Task 5 (AC5)** — Final acceptance — boot + lint + Bundle C floor + full-suite verification
  - [ ] **Bundle C green floor (non-negotiable)**: `node --test tests/integration/full-cycle.test.js tests/integration/pending-import-id-invariant.test.js tests/integration/circuit-breaker-trip.test.js` → ≥47 pass, 0 fail. If any flips red, story is not done.
  - [ ] Run all Epic 7 unit tests (`decide`, `tier-classify`, `cooperative-absorb`, `circuit-breaker`, `anomaly-freeze`) — all pass; no regression.
  - [ ] Run `npm test` (full suite) — report total pass / total fail / list any newly-failing test files. Pre-existing pre-Go-Live fails (post-Story-7.5 baseline: ~23 unit fails) are out-of-scope but MUST NOT regress.
  - [ ] Run `npm run lint` — confirm no new lint errors on the 3 touched files. Explicitly verify `worker-must-filter-by-customer`, `no-direct-fetch`, `no-raw-INSERT-audit-log`, `no-float-price` rules pass.
  - [ ] Verify migration tree: `npx supabase migration list` shows no diff vs `main`.
  - [ ] Optional worker boot smoke (local-only): `npm run start:worker` and verify the `'reconciliation: daily Tier-3 nightly-pass cron registered (midnight Lisbon)'` log line.
  - [ ] Update File List in Dev Agent Record with every file edited.

---

## Dev Notes

### Story shape

This is a **feature story** that ships the FR28 + AD10 Tier-3 nightly-reconciliation backstop and is the LAST Epic 7 story before `bmad-retrospective` fires. Scope spans 3 production files (2 new + 1 edited) + 1 new test file + 0 fixtures touched + 0 migrations. Net new SSoT module: `worker/src/safety/reconciliation.js`. The cron entry at `worker/src/jobs/reconciliation.js` is a thin factory mirror of `master-cron.js` / `monthly-partition-create.js`. The `worker/src/index.js` wire-up is ~3 lines.

### Path I autocommit framing (SCP-2026-05-13 ratification — load-bearing)

Per [_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md](_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md): reconciliation's per-row iteration runs in autocommit-per-statement mode, NOT inside an outer BEGIN/COMMIT. Reconciliation's emissions inherit the Story 7.4 / Story 7.5 / Story 7.6 autocommit-equivalence precedent. **DO NOT** introduce BEGIN/COMMIT framing in the spec, the module, or the tests. If a future story wraps cycle-assembly's per-SKU loop in real BEGIN/COMMIT per [deferred-work.md:466](_bmad-output/implementation-artifacts/deferred-work.md#L466) option (a), this AC will be re-evaluated alongside Story 7.4 + Story 7.5 + Story 7.6 — reconciliation's standalone cron path is naturally a candidate for the same treatment, but is OUT-OF-SCOPE for Story 7.7. Until then, sequenced autocommit is the locked semantic.

### Pattern A deviation from Story 7.5 Pattern C (load-bearing)

| Property | Story 7.5 (`tier-classify.js` — Pattern C) | Story 7.7 (`reconciliation.js` — Pattern A) |
|---|---|---|
| Call site | Inside `decide.js` STEP 1 + STEP 4 (engine cycle) | Standalone cron at midnight Lisbon |
| Audit emission | NOT inside module — caller (cycle-assembly) emits via emit-loop | INSIDE module — direct `writeAuditEvent` call per emission |
| Imports `writeAuditEvent`? | NO (decide.js architectural rule at L16-17 blocks) | YES (no equivalent architectural rule for cron paths) |
| Tier-transition payload shape | `{ action, newPriceCents }` (cycle-assembly's mis-shaped loop) | `{ fromTier, toTier, reason }` (canonical PayloadForTierTransition) |
| New-competitor-entered emission | N/A — engine path doesn't emit this slug | Inline — canonical `{ skuId, competitorPriceCents, cycleId }` |
| Cross-customer iteration? | NO — engine processes one (sku_channel, customer) at a time | YES — sweeps ALL customers' T3 rows nightly |
| Worker-must-filter-by-customer pragma? | NOT needed (single-row scope) | REQUIRED (cross-customer SELECT) |

**The Pattern A choice is forced by the call-site constraints, NOT a discretionary architectural change.** Specifically:
- decide.js's architectural rule (L16-17) doesn't apply outside decide.js.
- cycle-assembly's emit-loop is NOT in reconciliation's call chain — reconciliation is a standalone cron.
- The cycle-assembly payload-shape gap per [deferred-work.md:472](_bmad-output/implementation-artifacts/deferred-work.md#L472) makes Pattern C INFERIOR for reconciliation: Pattern C would route through cycle-assembly's mis-shaped loop, regressing reconciliation's payload shape to the broken `{ action, newPriceCents }` default. Pattern A bypasses this entirely.

**Pre-retro data point:** Story 7.7 is the FIRST production module to emit `tier-transition` with the canonical `{ fromTier, toTier, reason }` payload shape. Side-by-side with the cycle-assembly emit loop's mis-shaped emissions, this gives Epic 7 retro the empirical anchor it needs to drive the Bundle B payload-shape-alignment story per [deferred-work.md:472](_bmad-output/implementation-artifacts/deferred-work.md#L472) recommendation (a) — `payloadFor(slug, context)` helper inside cycle-assembly. Surface this prominently in the retro brief.

### Pre-staged Skip-Live-Smoke marker for BAD Step 6 SOLO-PR DEFENSIVE TOUCH

> **Why this matters:** BAD Step 6's SOLO-PR DEFENSIVE TOUCH branch (commit `99d3fea` on `main`, [.claude/skills/bad/references/subagents/step6-pr-ci.md:109-149](.claude/skills/bad/references/subagents/step6-pr-ci.md#L109-L149)) WILL grep the PR's diff under `worker/src/safety/`, `worker/src/engine/`, or `shared/mirakl/` for Mirakl-API-surface tokens:
> ```
> grep -nE "fetch\(|axios\.|request\(|/products|/offers|/inventory|/orders|/listings|X-API-KEY|X-Mirakl-|\bP11\b|\bPRI0[123]\b|\bOF2[14]\b|\bA01\b|\bPC01\b"
> ```
> Story 7.7's diff adds `worker/src/safety/reconciliation.js` which WILL contain `P11` in comments (`P11 fetch`, `Story 3.2 P11 wrapper`, `\bP11\b` matches). The grep will match → Step 6 correctly HALTs to coordinator (the SOLO-PR DEFENSIVE TOUCH branch does NOT auto-inject when Mirakl tokens are detected — it asks the operator to choose).
>
> **At HALT, the operator (Pedro) decides one of:**
> 1. **Authorize the pre-staged marker (expected path)** — Story 7.7 reuses [shared/mirakl/p11.js](shared/mirakl/p11.js) unchanged (Story 3.2 SSoT). No new Mirakl endpoint paths added. Pre-staged candidate marker text (verbatim — paste into PR body or authorize Step 6 to inject):
>
>    ```
>    [Skip-Live-Smoke: reconciliation cron reuses existing shared/mirakl/p11.js wrapper unchanged (Story 3.2 SSoT). No new Mirakl endpoint paths added; reconciliation behaviour validated via tests/worker/safety/reconciliation.test.js + tests/integration coverage. Live smoke discharge: Story 3.3 npm run mirakl:verify clean 2026-05-06 (memory project_epic3_live_smoke_result); current Mirakl access pattern (P11 + self-filter) unchanged since.]
>    ```
>
> 2. **Supply real Live Smoke Evidence** — only required if dev surfaces a NEW Mirakl endpoint path during implementation (e.g., a PC01 re-pull sub-path, an OF21 staleness check, a P11 batch wrapper variant). If new endpoints are added, the pre-staged marker is INVALID and the operator MUST run `npm run mirakl:verify` and supply a real `## Live Smoke Evidence` section in the PR body with the verify output.
>
> **How dev knows whether the pre-staged marker is valid:** at the end of Task 1, grep the new reconciliation.js file for new Mirakl API paths:
> ```
> grep -nE "/api/(products|offers|account|platform/configuration|offers/pricing|orders)" worker/src/safety/reconciliation.js
> ```
> If the output contains ANY paths beyond `/api/products/offers` (the P11 endpoint already shipped in Story 3.2's p11.js), the pre-staged marker is INVALID. Surface to Pedro at Step 6 HALT.
>
> **Discipline:** dev does NOT auto-inject the marker — Step 6's SOLO-PR DEFENSIVE TOUCH branch will HALT and request operator authorization. The operator's decision becomes the marker source.

### SCP Amendment 4 — fixture `_expected` is sole oracle (informational here — no fixture binding required)

Reconciliation's unit tests use SYNTHETIC constructs (per AC4) because the 3 Story-7.5-bound fixtures (`p11-tier3-no-competitors`, `p11-tier3-then-new-competitor`, `p11-tier2a-recently-won-stays-watched`) target the engine-path code surface (`decide.js`), not reconciliation's standalone cron path. The fixtures' `_expected` blocks encode engine-path outcomes that don't map 1:1 to reconciliation's emissions (e.g., `p11-tier3-no-competitors._expected.auditEvent='tier-transition'` is the engine STEP 1 emission, NOT a reconciliation emission — reconciliation emits NOTHING on steady-state T3-stays-T3 per AC1 + AC4 test 1).

**Per Story 7.5's "synthetic ≠ hand-coded fixture-oracle violation" rationale (dev notes line 432):** reconciliation's synthetic tests do NOT parallel any fixture's `_expected` block — they exercise a different code path with different inputs/outputs. The fixtures stay sealed; reconciliation uses inline synthetic skuChannel + offer constructs.

The fixtures are referenced INFORMATIONALLY in AC4 (test 1 mirrors `p11-tier3-no-competitors`'s tier='3' steady-state shape; test 2 mirrors `p11-tier3-then-new-competitor`'s new-competitor-with-win shape) — but loading them via `JSON.parse(readFileSync(...))` and asserting against `_expected` would be a fixture-oracle violation (the engine path's `_expected.auditEvent` does NOT match reconciliation's expected emissions).

### SCP Amendment 7 — no stub-fallbacks for production modules (load-bearing)

`applyTierClassification` from [worker/src/engine/tier-classify.js](worker/src/engine/tier-classify.js) ships on `main` (Story 7.5 squash commit `6d6313a` 2026-05-13). Static-import per AC1 imports list. **NO dynamic `await import('../engine/tier-classify.js').catch(...)` pattern** — that's the Story 7.3/7.6 stub-fallback shape Story 7.4 AC2 dismantled per SCP Amendment 7. If `tier-classify.js` is somehow missing at module load, the worker should fail-fast at boot, not silently no-op.

The same discipline applies to all 7 statically-imported modules in AC1 (`p11.js`, `self-filter.js`, `writer.js`, `event-types.js`, `index.js` for `toCents`, `logger.js`, `tier-classify.js`). All ship on `main`. No fallbacks anywhere in reconciliation.js.

### Bundle C atomicity guard

Story 7.7 is NOT a Bundle C participant — NOT in `bundle_dispatch_orders:` or `merge_blocks:` in sprint-status.yaml. It dispatches solo from `main` (post-Story-7.5 baseline). The Bundle C atomicity floor MUST stay green:
- [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js) — `main` baseline 47/47 per [deferred-work.md:481](_bmad-output/implementation-artifacts/deferred-work.md#L481). Story 7.7 does NOT add new assertions; the 3 Story-7.5-bound fixtures already exist in the AC1 oracle loop and reconciliation does not touch the engine path. Goal: stay at 47/47.
- [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js) — unchanged.
- [tests/integration/circuit-breaker-trip.test.js](tests/integration/circuit-breaker-trip.test.js) — unchanged.

**Bundle C floor wording correction:** future spec language uses ≥47/47 (not ≥48). The Story 7.4 / Story 7.5 specs' "≥48" wording was forecasted-but-unshipped (the new positive `'anomaly-freeze'` assertion did not actually fire to expand the count). Spec drift documented at [deferred-work.md:481](_bmad-output/implementation-artifacts/deferred-work.md#L481); Story 7.7 spec uses ≥47/47.

### Architecture compliance (the 27 negative-assertion constraints)

This story touches the worker + adds a new internal SSoT module + a new cron entry. Relevant constraints to verify clean:

- **Constraint #5** (no TypeScript) — pure JS + JSDoc.
- **Constraint #18** (no console.log) — pino only via the `logger` parameter (passed in by the cron caller, NOT created at module load — mirrors monthly-partition-create.js).
- **Constraint #19** (no direct `fetch` outside `shared/mirakl/`) — reconciliation routes ALL HTTP via `getProductOffersByEan` from `shared/mirakl/p11.js`. Zero direct fetch calls in reconciliation.js.
- **Constraint #21** (no raw `INSERT INTO audit_log` outside `shared/audit/writer.js`) — Pattern A means 2 audit emissions per real transition, both via `writeAuditEvent`.
- **Constraint #22** (no float-price math outside `shared/money/index.js`) — `toCents(filteredOffers[0].total_price)` converts P11's JSON-number to integer cents at the boundary. The drift-check arithmetic uses pure integer math (Date.now() ms - last_checked_at ms > cadence_minutes * 2 * 60 * 1000) — no float involvement.
- **Constraint #24** (no worker query missing `customer_marketplace_id` filter) — reconciliation's SELECT is DELIBERATELY cross-customer. Dual-pragma suppression: file-top `// safe: cross-customer cron` comment block + inline `// safe: cross-customer cron` comment immediately above the SELECT (per [dispatcher.js:189](worker/src/dispatcher.js#L189) + [monthly-partition-create.js:1-3](worker/src/jobs/monthly-partition-create.js#L1-L3) precedents).

### Mirakl MCP verification (CLAUDE.md discipline)

Story 7.7 reuses [shared/mirakl/p11.js](shared/mirakl/p11.js)'s `getProductOffersByEan` wrapper UNCHANGED. Per CLAUDE.md Mirakl-MCP-first discipline:
- **P11 pagination / response shape**: confirmed unchanged from Story 3.2's implementation. The wrapper at [p11.js:20-34](shared/mirakl/p11.js#L20-L34) returns `res.products?.[0]?.offers ?? []` — single-EAN single-product call returns the offers array. Default page size 10; reconciliation needs only top 2 for tier classification (winning/losing determination).
- **P11 query param shape**: `product_references=EAN|<ean>`, `channel_codes=<channel>`, `pricing_channel_code=<channel>` (NOT `product_ids` — silent 0-products if used). This is locked at the p11.js boundary; reconciliation passes opaque `ean` + `channel` and inherits the correct shape.
- **Self-filter chain**: confirmed unchanged from Story 3.2. `filterCompetitorOffers(rawOffers, ownShopName)` returns `{ filteredOffers, collisionDetected }` — reconciliation consumes both fields (collisionDetected → defensive warn-log + skip).
- **No Mirakl webhooks (AD18 / Constraint #1)**: reconciliation is polling-only by design (Seller-side webhooks unavailable on Mirakl per [empirical Q14](_bmad-output/planning-artifacts/architecture-distillate/_index.md) verification). Polling-only architecture preserved.

If during Task 1 the dev surfaces a P11 schema-shape drift (unexpected field, missing field, etc.), HALT and run `mcp__mirakl__authenticate` + verify via MCP per CLAUDE.md mandate. **Do NOT guess** — Mirakl MCP is the SSoT for any P11 schema-shape question.

### Story 7.7 is LAST Epic 7 story — retro fires after

Per [Bundle C close-out retro 2026-05-13](_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md) §12 Session 3 ordering: **7.4 → 7.5 → 7.7** is the dispatch sequence. After Story 7.7 ships (and merges to `main`), `bmad-retrospective` fires for Epic 7 (the `epic-7-retrospective: optional` entry in sprint-status.yaml line 175 becomes the next retro target). Epic 7 retro deliverables Pedro has pre-flagged for inclusion:

- **Bundle B payload-shape-alignment story sequencing** ([deferred-work.md:472](_bmad-output/implementation-artifacts/deferred-work.md#L472)) — reconciliation.js's canonical-shape emissions vs cycle-assembly's mis-shaped emissions is the empirical anchor.
- **Bundle B real-BEGIN/COMMIT atomicity** ([deferred-work.md:466](_bmad-output/implementation-artifacts/deferred-work.md#L466)) — option (a) plumbing cost vs option (b) "downgrade Bundle B atomicity language to autocommit". Reconciliation joins the affected-stories list (Stories 5.2, 7.2, 7.4, 7.5, 7.6, 7.7).
- **Bundle C floor 47/47 vs ≥48 spec-drift reconciliation** ([deferred-work.md:481](_bmad-output/implementation-artifacts/deferred-work.md#L481)) — either ship the missing positive assertion to expand the count to 48, or amend the spec to use 47 consistently going forward.
- **3-sighting `feedback_spec_mechanism_trace` rule promotion** ([deferred-work.md:467](_bmad-output/implementation-artifacts/deferred-work.md#L467)) — Story 7.7 applies the discipline at shard time (AC1 mechanism-trace section); pattern is now 4 sightings (Story 6.3 + 7.8 + 7.4 AC1 + 7.7 AC1). Time to promote to a `feedback_spec_mechanism_trace.md` memory rule.
- **Epic-spec AC#2 wording vs reconciliation's observability-only mechanism (this story's AC3 deviation flag)** — option (a) leave epic spec as-is, or (b) `/bmad-correct-course` to amend the epic AC wording. Pedro-owned decision at retro.

### Anti-patterns to avoid

- **DO NOT** add a new migration. All required schema (`sku_channels.last_checked_at`, `tier_value` enum, `audit_log_event_types` row for `tier-transition` + `new-competitor-entered`) exists on `main`.
- **DO NOT** introduce literal BEGIN/COMMIT framing in the module or in the spec text. Path I autocommit is the locked semantic per SCP-2026-05-13.
- **DO NOT** acquire `pg_try_advisory_lock` per customer in reconciliation. The optimistic-concurrency guard at [tier-classify.js:117](worker/src/engine/tier-classify.js#L117) handles the master-cron-vs-reconciliation race. Advisory locks here would serialise reconciliation behind in-flight master-cron cycles — defeats the daily-pass guarantee.
- **DO NOT** route audit emissions through cycle-assembly's emit loop. Pattern A — direct `writeAuditEvent` calls inline. Routing through cycle-assembly would regress the payload shape to the mis-shaped `{ action, newPriceCents }` default per [deferred-work.md:472](_bmad-output/implementation-artifacts/deferred-work.md#L472).
- **DO NOT** flip any of the 3 Story-7.5-bound fixtures (`p11-tier3-no-competitors`, `p11-tier3-then-new-competitor`, `p11-tier2a-recently-won-stays-watched`). They are sealed; their `_expected` blocks target the engine path. Reconciliation's tests are synthetic.
- **DO NOT** add `last_checked_at` filter to the SELECT. Reconciliation's promise is exhaustive Tier-3 coverage — adding a filter defeats the daily-pass backstop. The drift detection (AC3) fires per-row inside the iteration with no DB cost.
- **DO NOT** emit a `stale-state` / `reconciliation-drift` audit event. AD20 taxonomy is locked at 28 entries; drift is observability, not customer-facing. Phase 2 can add a `cycle-fail-sustained`-style event if operational signal warrants.
- **DO NOT** force a SECOND P11 call for drifted rows. The same-iteration P11 call IS the recovery. The "force a check this cycle" wording in the epic AC#2 is mechanism-ambiguous; the dispatcher's WHERE clause already covers drift, and reconciliation's iteration provides the explicit backstop.
- **DO NOT** epic-spec-correct the AC#2 mechanism wording divergence inline in Story 7.7. Flag in Dev Agent Record; defer to Epic 7 retro for resolution. Bob-owned recovery via `/bmad-correct-course` if Pedro wants closure earlier (per memory `feedback_correct_course_validated_for_spec_failures`).
- **DO NOT** import `writeAuditEvent` into [worker/src/jobs/reconciliation.js](worker/src/jobs/reconciliation.js) (the cron entry file). Audit emission lives in `worker/src/safety/reconciliation.js` (the SSoT). The cron entry is a thin factory.
- **DO NOT** restructure decide.js's STEP 1 / STEP 4 tier-classify wire-up. Story 7.5 owns those call sites; Story 7.7 is the second authorized caller of `applyTierClassification` (cron-side), but the engine-side call site is untouched.
- **DO NOT** call OF24. Constraint #6 + AD7 — `pri01-writer.js` is the only price-write path. Reconciliation does NOT push prices to Mirakl; it only updates engine state (tier columns + last_checked_at) and emits audit events.
- **DO NOT** parallelize the per-row iteration with `Promise.all`. Sequential iteration is intentional at MVP scale (5-10 customers × ≤50k SKUs/customer ≈ ≤500k T3 rows worst case; with Mirakl rate limits + retry-on-429, parallel fetch would exhaust API budget faster than the daily 24h window can absorb). Phase 2 can add bounded-concurrency batching if dogfood reveals the linear pass takes >2h.

### Project Structure Notes

Files touched (anticipated):

| File | Change | AC | New? |
|---|---|---|---|
| [worker/src/safety/reconciliation.js](worker/src/safety/reconciliation.js) | New SSoT module: `runReconciliationPass` + AC3 drift-check | AC1 + AC3 | NEW |
| [worker/src/jobs/reconciliation.js](worker/src/jobs/reconciliation.js) | New cron entry: `startReconciliationCron` | AC2 | NEW |
| [worker/src/index.js](worker/src/index.js) | Add `startReconciliationCron` import + invocation alongside existing cron registrations | AC2 | Edit |
| [tests/worker/safety/reconciliation.test.js](tests/worker/safety/reconciliation.test.js) | New unit-test file: 7 synthetic test cases per AC4 | AC4 | NEW |

**SSoT-table alignment:** [_bmad-output/planning-artifacts/epics-distillate/_index.md SSoT Modules row line 91](_bmad-output/planning-artifacts/epics-distillate/_index.md) lists `worker/src/safety/reconciliation.js, worker/src/jobs/reconciliation.js (Story 7.7)` — matches the directory tree at [05-directory-tree.md:129+134](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L129). No divergence flag.

### Testing Standards

- Test runner: `node --test` (Constraint #2 — no Jest/Vitest).
- Mocking: `buildMockTx`-style pattern from [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js); spy-on / mock-injection for `writeAuditEvent` + `applyTierClassification` + `getProductOffersByEan`. No new mocking libraries.
- Synthetic skuChannel construction: inline object literals matching the schema in [supabase/migrations/202604301206_create_sku_channels.sql:3-43](supabase/migrations/202604301206_create_sku_channels.sql#L3-L43). NO `buildMockSkuChannel` reuse from `full-cycle.test.js` (that helper is for fixture-driven integration tests with `_fixture_meta` overrides — reconciliation's unit tests use simpler inline objects).
- **Mock-pool pattern (NEW for this story)**: synthesize a minimal `pool` object with `.connect()` returning a mock PoolClient. Document the helper in the test file (likely 15-30 lines); not yet a shared util — Phase 2 can extract if reused by future cron-shaped tests.
- `integration_test_required: false` for this story — no new pg/Supabase Auth/Mirakl/Stripe SDK surface. Reconciliation's UPDATEs touch `sku_channels` which Bundle C's `full-cycle.test.js` already exercises via the engine path; reconciliation's standalone path is unit-test-only at MVP.

### Library Empirical Contracts (load-bearing)

- **`node-cron` v3+ `timezone` option** — verified in current code via [worker/src/index.js:85](worker/src/index.js#L85) (`{ timezone: 'Europe/Lisbon' }`) + [master-cron.js:54](worker/src/jobs/master-cron.js#L54). Reconciliation reuses this exact param name. If `node-cron` is bumped to a future major version that renames to `tz`, both the existing cron registrations AND reconciliation's would need updating in lockstep — out-of-scope housekeeping for Story 7.7.
- **`pg` Pool client-acquisition** — `await pool.connect()` returns a PoolClient with `.query()` + `.release()`. Reconciliation acquires ONE client for the full pass (NOT per-row); release in `try/finally`. Pattern matches [dispatcher.js:205+277](worker/src/dispatcher.js#L205). At MVP scale, holding one client for the full daily pass is fine (5-10 customers, ≤500k T3 rows worst case, sequential iteration); Phase 2 can refactor to per-customer client acquisition if pool exhaustion surfaces.
- **#14 `no-direct-fetch` ESLint comment-scan** — not applicable here (reconciliation makes no direct HTTP calls; all routed via `shared/mirakl/p11.js`).
- Memory `project_resend_env_stub_import_pattern` — verify during Task 4 that reconciliation.js has NO transitive resend dependency. Trace: reconciliation.js → writer.js → ? . If `shared/audit/writer.js` does NOT transitively import `shared/resend/client.js`, the env-stub pattern is NOT required. If it does (or surfaces during Task 4), apply the env-stub + `await import` pattern at the top of `tests/worker/safety/reconciliation.test.js`.

### Previous Story Intelligence

- **Story 7.5 (`tier-classify.js`, PR #95 squash `6d6313a` 2026-05-13, done 2026-05-13)**: shipped `worker/src/engine/tier-classify.js` as the engine-cycle `applyTierClassification` SSoT. Reconciliation re-uses this module via static import — the second authorized caller per Story 7.5 anti-pattern note line 474 ("DO NOT call `applyTierClassification` outside `worker/src/engine/decide.js` in this story. Story 7.7 (reconciliation.js) will be the second authorized caller — but that's a different story."). Pattern C in Story 7.5 (engine path); Pattern A in Story 7.7 (cron path) — different rules for different call sites per Mechanism trace section above.
- **Story 7.4 (`anomaly-freeze.js`, PR #94 squash `b7ab679` 2026-05-13, done 2026-05-13)**: shipped `worker/src/safety/anomaly-freeze.js` as the Pattern A AD12 SSoT. Reconciliation mirrors this Pattern A shape: UPDATE + writeAuditEvent inline in caller-supplied tx, named exports, JSDoc typedefs, pino logger via worker logger.
- **Story 7.6 (`circuit-breaker.js`, PR #91 mega-merge `89b2378` 2026-05-13, done 2026-05-13)**: shipped per-SKU + per-cycle CB. Per-cycle CB transitions cron_state via `transitionCronState` (Bundle B atomicity). Reconciliation does NOT use cron_state — it operates on per-SKU tier columns only. No interaction with CB at MVP.
- **Story 7.2 (`decide.js`, PR #87 → PR #91 mega-merge, done 2026-05-13)**: shipped `decideForSkuChannel`. Reconciliation does NOT touch decide.js. Both share `applyTierClassification` via different call sites (engine + cron).
- **Story 3.2 (Mirakl P11 wrapper + self-filter, done earlier in Epic 3)**: shipped `shared/mirakl/p11.js` + `shared/mirakl/self-filter.js`. Reconciliation imports both UNCHANGED. The `npm run mirakl:verify` clean run on 2026-05-06 (memory `project_epic3_live_smoke_result`) discharges the live-smoke obligation for any Story-7.7 PR that does NOT add new endpoint paths — see Pre-staged Skip-Live-Smoke marker section.
- **Story 9.0 (audit writer + event-types taxonomy, done 2026-05-04)**: shipped `shared/audit/writer.js` `writeAuditEvent` SSoT + `no-raw-INSERT-audit-log` ESLint rule + `shared/audit/event-types.js` with all 26 base typedefs (including `PayloadForTierTransition` line 260-264 + `PayloadForNewCompetitorEntered` line 160-164). Reconciliation emits via the SSoT path with the canonical payload shapes.
- **Story 9.1 (`monthly-partition-create.js`, done earlier)**: shipped the audit_log partition cron. Reconciliation mirrors the cross-customer cron pragma pattern from this file (top-of-file `// safe: cross-customer cron` comment block).
- **SCP-2026-05-13 (Path I autocommit ratification, 2026-05-13)**: load-bearing input for Story 7.7's mechanism framing. See AC1 Mechanism trace + Path I autocommit framing dev-note section. Reconciliation joins Stories 7.4, 7.5, 7.6 in the autocommit-equivalence pattern.
- **Bundle C close-out retro (2026-05-13)**: §12 Session 3 ordering is 7.4 → 7.5 → 7.7. 7.7 fires AFTER 7.5 lands (already merged via PR #95). After 7.7 ships, Epic 7 retro is next (sprint-status.yaml line 175 `epic-7-retrospective: optional` becomes target). Pre-flagged retro deliverables documented in Dev Notes "Story 7.7 is LAST Epic 7 story" section.
- **3rd-sighting mechanism-trace pattern (deferred-work.md line 467)**: now 4 sightings (Story 6.3 wire-up + Story 7.8 fake-gate + Story 7.4 AC1 mechanism + Story 7.7 AC1 mechanism). Pattern is matured — Epic 7 retro should promote to a `feedback_spec_mechanism_trace` memory rule.

### Git intelligence

- Branch: dispatches solo from `main` (NOT from any bundle branch).
- Worktree fork point: `main` HEAD at session start. Recent commits relevant to context:
  - `99d3fea` fix(bad/step6): auto-inject Skip-Live-Smoke marker for solo PRs with no Mirakl API surface
  - `52e459a` chore(gitignore): exclude bad-review / BAD Step 6 scratch files
  - `5b754c3` Set story 7.5 to done in sprint-status (post-merge reconciliation)
  - `b8f6fb5` Record deferred findings from PR #95 review
  - `6d6313a` story-7.5-worker-src-engine-tier-classify-js-full-transitions-atomic-t2a-t2b-write-per-f1 (#95)
- Expected file count in PR: 4 (the 2 new worker files + 1 edited index.js + 1 new test file).
- No `bundle_dispatch_orders` constraint: this story is NOT part of any atomicity bundle and dispatches in isolation.
- Q8 Phase 1 CI gate (`node --test tests/integration/{full-cycle,pending-import-id-invariant,circuit-breaker-trip}.test.js`, narrowed scope per [.github/workflows/ci.yml](.github/workflows/ci.yml) post-1501c72) is the safety floor — Bundle C ≥47/47 must stay green on the PR.
- BAD Step 6 SOLO-PR DEFENSIVE TOUCH branch (commit `99d3fea` on `main`) WILL fire on this story because reconciliation.js adds files under `worker/src/safety/` AND contains Mirakl-API-surface tokens (P11 in comments). Step 6 will correctly HALT to coordinator at Pedro's session. Pre-staged marker text is in Dev Notes "Pre-staged Skip-Live-Smoke marker for BAD Step 6 SOLO-PR DEFENSIVE TOUCH" section.

### References

- **Retro source-of-truth (§12 Session 3 ordering + 4-sighting pattern):** [_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md](_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md) §12 Session 3
- **SCP ratifying Path I autocommit semantics:** [_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md](_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md) §1-3
- **Deferred-work entries:**
  - [_bmad-output/implementation-artifacts/deferred-work.md:466](_bmad-output/implementation-artifacts/deferred-work.md#L466) (Bundle B real-BEGIN/COMMIT — Epic 7 retro deliverable)
  - [_bmad-output/implementation-artifacts/deferred-work.md:467](_bmad-output/implementation-artifacts/deferred-work.md#L467) (3-sighting mechanism-trace pattern — now 4 sightings post-Story-7.7)
  - [_bmad-output/implementation-artifacts/deferred-work.md:472](_bmad-output/implementation-artifacts/deferred-work.md#L472) (payload-shape gap in cycle-assembly — reconciliation closes this for its own emissions; engine path still has it)
  - [_bmad-output/implementation-artifacts/deferred-work.md:481](_bmad-output/implementation-artifacts/deferred-work.md#L481) (Bundle C floor 47/47 spec drift correction)
- **Epic spec:** [_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md Story 7.7 lines 154-161](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L154-L161) (AC#1 + AC#2 + AC#3)
- **FR28 (Nightly reconciliation = Tier 3 daily) + AD10 (4-state tier system):** [_bmad-output/planning-artifacts/architecture-distillate/_index.md](_bmad-output/planning-artifacts/architecture-distillate/_index.md) FR Coverage Map FR28 → Story 7.7
- **Production modules to reference / consume:**
  - [worker/src/dispatcher.js:53-65](worker/src/dispatcher.js#L53-L65) (AD17 dispatcher SELECT — reconciliation's SELECT mirrors the cross-customer pragma shape but with `tier='3'` predicate and NO cadence filter)
  - [worker/src/jobs/monthly-partition-create.js:1-3](worker/src/jobs/monthly-partition-create.js#L1-L3) (Cross-customer cron pragma precedent — file-top comment)
  - [worker/src/jobs/master-cron.js:38-55](worker/src/jobs/master-cron.js#L38-L55) (Factory-shape precedent for `startReconciliationCron`)
  - [worker/src/safety/anomaly-freeze.js](worker/src/safety/anomaly-freeze.js) (Story 7.4 Pattern A reference — UPDATE + writeAuditEvent inline; reconciliation mirrors except for cross-customer iteration)
  - [worker/src/engine/tier-classify.js](worker/src/engine/tier-classify.js) (Story 7.5 SSoT — `applyTierClassification` second authorized caller per anti-pattern note line 474)
  - [worker/src/engine/decide.js:167-169](worker/src/engine/decide.js#L167-L169) (ownPosition computation pattern — reconciliation mirrors the ownTotal-vs-competitor-lowest comparison)
  - [shared/mirakl/p11.js:20-34](shared/mirakl/p11.js#L20-L34) (`getProductOffersByEan` SSoT — REUSED UNCHANGED)
  - [shared/mirakl/self-filter.js:31-54](shared/mirakl/self-filter.js#L31-L54) (`filterCompetitorOffers` SSoT — REUSED UNCHANGED)
  - [shared/audit/writer.js](shared/audit/writer.js) (`writeAuditEvent` SSoT — Pattern A emission target)
  - [shared/audit/event-types.js:78](shared/audit/event-types.js#L78) (`EVENT_TYPES.TIER_TRANSITION`)
  - [shared/audit/event-types.js:61](shared/audit/event-types.js#L61) (`EVENT_TYPES.NEW_COMPETITOR_ENTERED`)
  - [shared/audit/event-types.js:160-164](shared/audit/event-types.js#L160-L164) (`PayloadForNewCompetitorEntered` canonical shape)
  - [shared/audit/event-types.js:260-264](shared/audit/event-types.js#L260-L264) (`PayloadForTierTransition` canonical shape)
  - [shared/money/index.js](shared/money/index.js) (`toCents` for competitor-price conversion at the P11 boundary)
- **Migrations (existing — no new ones in this story):**
  - [supabase/migrations/202604301206_create_sku_channels.sql:17-21](supabase/migrations/202604301206_create_sku_channels.sql#L17-L21) (`tier`, `tier_cadence_minutes`, `last_won_at`, `last_checked_at` columns)
  - [supabase/migrations/202604301206_create_sku_channels.sql:1](supabase/migrations/202604301206_create_sku_channels.sql#L1) (`tier_value` enum)
  - [supabase/migrations/20260430120730_create_audit_log_event_types.sql](supabase/migrations/20260430120730_create_audit_log_event_types.sql) (seeded `tier-transition` Rotina + `new-competitor-entered` Notável rows + priority-derivation trigger)
- **Test files to create:**
  - [tests/worker/safety/reconciliation.test.js](tests/worker/safety/reconciliation.test.js) (AC4 — 7 synthetic test cases)
- **Fixtures consulted INFORMATIONALLY (sealed — not modified, not loaded for `_expected` oracle):**
  - [tests/fixtures/p11/p11-tier3-no-competitors.json](tests/fixtures/p11/p11-tier3-no-competitors.json) (shape reference for AC4 test 1)
  - [tests/fixtures/p11/p11-tier3-then-new-competitor.json](tests/fixtures/p11/p11-tier3-then-new-competitor.json) (shape reference for AC4 tests 2 + 3)
  - [tests/fixtures/p11/p11-tier2a-recently-won-stays-watched.json](tests/fixtures/p11/p11-tier2a-recently-won-stays-watched.json) (incidental — NOT applicable to reconciliation since reconciliation iterates T3 rows only; mentioned for completeness against Pedro's brief reference)
- **Distillates:**
  - [_bmad-output/planning-artifacts/architecture-distillate/_index.md](_bmad-output/planning-artifacts/architecture-distillate/_index.md) — 27 constraints, AD10, AD20, Cross-Cutting Pre-Locked Decisions C (Tier 3 cadence = 1440 min)
  - [_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md](_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md) — 11 SSoT modules, atomicity rules
  - [_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md:129+134](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L129) (target paths `worker/src/safety/reconciliation.js` + `worker/src/jobs/reconciliation.js`)
  - [_bmad-output/planning-artifacts/epics-distillate/_index.md](_bmad-output/planning-artifacts/epics-distillate/_index.md) — SSoT Modules row line 91 for Story 7.7
  - [_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md) — Story 7.7 AC#1/#2/#3
- **Project context:** [project-context.md](project-context.md) §27 Constraints (#5, #18, #19, #21, #22, #24) + §11 SSoT Modules + §AD20 28-Event Audit Taxonomy + §Library Empirical Contracts + §Mirakl MCP verification mandate
- **BAD Step 6 SOLO-PR DEFENSIVE TOUCH reference:** [.claude/skills/bad/references/subagents/step6-pr-ci.md:109-149](.claude/skills/bad/references/subagents/step6-pr-ci.md#L109-L149) (commit `99d3fea` on `main`)
- **Memory entries consulted:**
  - `feedback_trace_proposed_fixes` (4-sighting mechanism-trace pattern — load-bearing for AC1 Mechanism trace section)
  - `feedback_correct_course_validated_for_spec_failures` (Bob owns spec-mechanism recovery via /bmad-correct-course if Pedro wants epic AC#2 wording closure earlier than Epic 7 retro)
  - `feedback_bmad_sm_owns_spec_failures` (SM ownership of spec-driven recovery — informs the Anti-pattern of NOT epic-spec-correcting the AC#2 mechanism wording divergence inline)
  - `feedback_no_premature_abstraction` (keep `runReconciliationPass` narrowly scoped — no generic "cron-job runner" abstraction; the iteration logic fits in one function with one helper for the drift-check)
  - `feedback_step5_import_path_boot_check` (run `node --check` after Task 1, Task 2, and Task 5)
  - `feedback_grep_drift_widely` (after Task 2 edits, grep `startReconciliationCron` across repo — should match only in `worker/src/jobs/reconciliation.js` and `worker/src/index.js`)
  - `project_resend_env_stub_import_pattern` (verify during Task 4; apply pattern if transitive dependency surfaces)
  - `feedback_bad_subagents_handle_missing_slash_commands` (BAD dispatch tolerance — not load-bearing here)
  - `feedback_nested_subagent_dispatch_limit` (BAD Step 6 HALT requires Pedro to make the marker-vs-real-smoke decision in his top-level session — informs Pre-staged Skip-Live-Smoke marker section's operator-decision framing)
  - `project_epic3_live_smoke_result` (npm run mirakl:verify clean 2026-05-06 — discharges the live-smoke obligation for the pre-staged marker)
  - `reference_supabase_migration_push_gotchas` (NOT applicable — Story 7.7 ships no new migration)

### Out-of-scope items (explicitly NOT in this story)

- **Bundle B real-BEGIN/COMMIT wrap for reconciliation's per-row iteration** ([deferred-work.md:466](_bmad-output/implementation-artifacts/deferred-work.md#L466) option (a)) — Epic 7 retro deliverable. Reconciliation joins Stories 5.2, 7.2, 7.4, 7.5, 7.6 in the affected-stories list if option (a) is chosen.
- **Cycle-assembly payload-shape alignment story** ([deferred-work.md:472](_bmad-output/implementation-artifacts/deferred-work.md#L472) recommendation (a)) — sequenced before Epic 8 dashboard surfaces consume the audit feed. Reconciliation closes the gap for its OWN emissions; the engine-path emissions through cycle-assembly's loop still have the mis-shaped `{ action, newPriceCents }` payload. Out-of-scope here.
- **Bundle C floor expansion from 47 → 48** ([deferred-work.md:481](_bmad-output/implementation-artifacts/deferred-work.md#L481)) — either ship the missing positive `'anomaly-freeze'` assertion (Story 7.4's forecast) or amend the spec to use 47 consistently going forward. Epic 7 retro deliverable. Story 7.7 uses ≥47/47 wording.
- **Epic-spec AC#2 wording correction** ("forces a check this cycle to recover" vs reconciliation's observability-only mechanism per AC3). Flag in Dev Agent Record; defer to Epic 7 retro.
- **`stale-state` / `reconciliation-drift` audit event** — AD20 taxonomy locked at 28 entries. Drift surfaces in pino warn logs only at MVP. Phase 2 trigger if dogfood reveals operator demand.
- **`cycleId` on reconciliation's `new-competitor-entered` emissions** — dev decides null vs per-pass UUID at Task 1; document choice in Dev Agent Record. Both are valid per `PayloadForNewCompetitorEntered` typedef.
- **`pg_try_advisory_lock` per customer in reconciliation** — optimistic-concurrency guard in `applyTierClassification` is the safety net; advisory locks would defeat the daily-pass guarantee.
- **Bounded-concurrency / parallel P11 fetching** — sequential iteration at MVP scale. Phase 2 trigger if pass takes >2h.
- **Integration test (`tests/integration/reconciliation.test.js`)** — out-of-scope per epic AC#3 (which only requires unit tests in `tests/worker/safety/reconciliation.test.js`). Bundle C's full-cycle integration test already exercises the underlying primitives (P11 + self-filter + tier-classify); reconciliation's standalone path is unit-test-only at MVP.
- **`runReconciliationPass` invocation from anywhere other than the cron entry** — single authorized caller is `startReconciliationCron`. If a future story needs an ad-hoc reconciliation trigger (e.g., admin route), surface to Pedro first.
- **Worker boot-time validation that the cron is correctly registered** — `node --check` covers parse-time errors; live registration confirmation is the optional Task 5.8 smoke. Phase 2 can add a startup self-test if needed.
- **Phase 2 customer-tunable `tier_cadence_minutes_override`** — schema reservation already exists per architecture frontmatter; reconciliation reads `tier_cadence_minutes` directly from the row (the override merge happens at the schema/UI layer in Phase 2).

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Step 3 developer, 2026-05-13+)

### Debug Log References

### Completion Notes List

### File List

### Review Findings
