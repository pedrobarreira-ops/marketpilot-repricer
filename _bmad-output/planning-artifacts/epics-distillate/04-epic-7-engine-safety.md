---
type: bmad-distillate-section
sources:
  - "../epics.md"
parent: "_index.md"
part: 4
of: 8
---

This section covers Epic 7 Engine Decision & Safety (Stories 7.1–7.8) — 8 stories. Part 4 of 8 from epics.md.

## Epic 7: Engine Decision & Safety

**Goal.** The repricing engine: each cycle, for each (SKU, channel) the dispatcher selects, the engine reads competitors via P11, applies the mandatory filter chain (active=true AND total_price>0 AND shop_name≠own_shop_name), classifies tier, absorbs external changes within tolerance (skip-on-pending), computes floor/ceiling via integer-cents rounding, branches by position (UNDERCUT / CEILING_RAISE / HOLD per AD8's full decision table including tie cases), applies per-SKU 15% circuit breaker, stages writes; the dispatcher then applies the per-cycle 20% circuit-breaker check and flushes staging to the writer. Anomaly freezes (>40% external deviation) emit through audit log and require customer review. Tier 3 daily pass doubles as nightly reconciliation. **Atomicity bundle gate ships at Story 7.8.**

**Coverage:** FR17, FR19 (with F1), FR20, FR21, FR22, FR24, FR26, FR27, FR28, FR29; NFR-P1, NFR-P2; ADs AD8, AD9, AD10 (with F1), AD11 (with F6), AD12, AD13, AD14.

**Atomicity bundle gate:** AD7 (Epic 6) + AD8 + AD9 + AD11 ship through a single integration-test gate at the end of Epic 7. The gate is a single integration test (`tests/integration/pri01-pri02-cycle.test.js` or equivalent) that exercises the full cycle on all 17 P11 fixtures against the Mirakl mock server seeded with `verification-results.json`. Epic 6's writer code becomes safe to ship to production only after this gate passes.

**Constraints:**
- `shared/money/index.js` (toCents, fromCents, roundFloorCents, roundCeilingCents) ships in Epic 7 (Story 7.1) alongside its primary caller (engine math). ESLint custom rule `no-float-price` ships with this module per Pedro's refined ESLint sequencing. Epic 8's eta templates import `formatEur()` / `fromCents()` for display formatters from this module.
- All 17 P11 fixtures (architecture's enumerated list, NOT the prose's "16") used across Epic 7 stories. Each story names its applicable fixtures by filename in acceptance criteria.

**Phase 2 reservations:** Customer-tunable `anomaly_threshold_pct` reads NULL → uses 0.40 default; flips to customer-set value when Phase 2 ships UI (column already reserved Epic 4).

### 17 P11 fixtures distribution

- 12 in Story 7.2 (engine decision flow): `p11-tier1-undercut-succeeds.json`, `p11-tier1-floor-bound-hold.json`, `p11-tier1-tie-with-competitor-hold.json`, `p11-tier2b-ceiling-raise-headroom.json`, `p11-all-competitors-below-floor.json`, `p11-all-competitors-above-ceiling.json`, `p11-self-active-in-p11.json`, `p11-self-marked-inactive-but-returned.json`, `p11-single-competitor-is-self.json`, `p11-zero-price-placeholder-mixed-in.json`, `p11-shop-name-collision.json`, `p11-pri01-pending-skip.json`
- 1 in Story 7.3: `p11-cooperative-absorption-within-threshold.json`
- 1 in Story 7.4: `p11-cooperative-absorption-anomaly-freeze.json`
- 3 in Story 7.5: `p11-tier2a-recently-won-stays-watched.json`, `p11-tier3-no-competitors.json`, `p11-tier3-then-new-competitor.json`
- ALL 17 in Story 7.8 integration gate (full cycle through engine + writer + cooperative-absorption + circuit-breaker against mock Mirakl seeded with verification-results.json)

---

### Story 7.1: `shared/money/index.js` + `no-float-price` ESLint rule
- **Trace:** Implements AD8 STEP 3 dependency (math primitives), money discipline foundation; FRs FR21 (math foundation). Size S.
- **Bob-trace:** SSoT: `shared/money/index.js` (`toCents`, `fromCents`, `roundFloorCents`, `roundCeilingCents`, `formatEur`), `eslint-rules/no-float-price.js`. Depends on Story 1.1 (eslint config). Enables Story 7.2 (engine STEP 3 floor/ceiling math); Epic 8 (eta template helpers `formatEur`, `fromCents`).
- **ESLint rules:** `no-float-price`
- **Acceptance Criteria:**
  1. **Given** `shared/money/index.js` exports **When** I call `toCents(eurDecimal)` **Then** for `17.99` → returns integer `1799` (rounded to nearest cent if input has more than 2 decimals) **And** for invalid inputs (NaN, undefined, negative) throws.
  2. **Given** `fromCents(integerCents)` **When** I call it with `1799` **Then** returns the string `'€17,99'` (PT locale: comma as decimal separator, € prefix, NO space between € and digits) **And** for `0` returns `'€0,00'`; for `1` returns `'€0,01'`.
  3. **Given** `roundFloorCents(rawFloorFloat)` **When** I call it with a non-integer cents value (e.g., 1798.7) **Then** returns `Math.ceil(rawFloorFloat)` → `1799` (conservative — floor never sinks below raw, protects margin) **And** for an exact integer input, returns the input unchanged.
  4. **Given** `roundCeilingCents(rawCeilingFloat)` **When** I call it with a non-integer cents value (e.g., 1801.3) **Then** returns `Math.floor(rawCeilingFloat)` → `1801` (conservative — ceiling never exceeds raw, prevents accidental over-pricing).
  5. **Given** `formatEur(integerCents)` **When** Epic 8 eta templates call it (registered as a view helper) **Then** the template renders `'€17,99'` style display strings consistently with `fromCents` (alias or same function — pick one).
  6. **Given** `eslint-rules/no-float-price.js` **When** ESLint runs **Then** any of these patterns OUTSIDE `shared/money/index.js` triggers a lint error:
      - `<var>.toFixed(2)` where `<var>` is a price-like identifier (heuristic: name contains `price`, `floor`, `ceiling`, `cost`, `margin`)
      - `parseFloat(<expr>)` where the result is assigned to a price-like identifier
      - `<var> * 100` or `<var> * 0.01` where `<var>` is a price-like identifier
      - `Math.round(<expr> * 100) / 100` (the classic ad-hoc-cents pattern)
    **And** the rule allows these patterns inside `shared/money/index.js` (the module is the only place these are legitimate) **And** the rule's error message: *"Float-price math forbidden. Use shared/money/index.js (toCents, fromCents, roundFloorCents, roundCeilingCents) for all price arithmetic."*
  7. **Given** unit tests in `tests/shared/money/index.test.js` **When** I run them **Then** they cover: round-trip toCents → fromCents preserves value; conservative rounding directions verified with edge cases (1798.5 floor → 1799; 1801.5 ceiling → 1801); locale formatting (PT comma); error cases for invalid inputs.

---

### Story 7.2: `worker/src/engine/decide.js` — full AD8 decision flow with filter chain via self-filter
- **Trace:** Implements AD8 (full enumeration), AD13 (collision detection), AD14 (mandatory filter chain); FRs FR20, FR21, FR24 partial. Size L.
- **Atomicity:** Bundle C — engine half of the AD7+AD8+AD9+AD11 atomicity bundle; gate at Story 7.8.
- **Bob-trace:** SSoT: `worker/src/engine/decide.js` (`decideForSkuChannel`). Test fixtures (12 of 17): `p11-tier1-undercut-succeeds.json`, `p11-tier1-floor-bound-hold.json`, `p11-tier1-tie-with-competitor-hold.json`, `p11-tier2b-ceiling-raise-headroom.json`, `p11-all-competitors-below-floor.json`, `p11-all-competitors-above-ceiling.json`, `p11-self-active-in-p11.json`, `p11-self-marked-inactive-but-returned.json`, `p11-single-competitor-is-self.json`, `p11-zero-price-placeholder-mixed-in.json`, `p11-shop-name-collision.json`, `p11-pri01-pending-skip.json`. Depends on Story 3.2 (P11 wrapper + self-filter), Story 7.1 (money module), Story 5.2 (cycle-assembly + pri01_staging), Story 4.2 (sku_channels), Story 6.1 (writer's pending_import_id contract — engine SKIPs on it), Story 9.0 + Story 9.1 (audit foundation for decision events: `undercut-decision`, `ceiling-raise-decision`, `hold-floor-bound`, `hold-already-in-1st`, `shop-name-collision-detected`; calendar-early per Option A). Enables Stories 7.3, 7.4, 7.5, 7.6 (each fills in the orchestrator's stubs); Story 7.8 (atomicity-bundle integration gate).
- **Acceptance Criteria:**
  1. **Given** `decideForSkuChannel({skuChannel, customerMarketplace, ownShopName, p11RawOffers, tx})` exported from `worker/src/engine/decide.js` **When** the orchestrator runs **Then** it implements AD8's 6 steps in order:
      - **Preconditions** (any false → return `{action: 'SKIP', reason}`):
        - `customer_marketplace.cron_state === 'ACTIVE'`
        - `sku_channel.frozen_for_anomaly_review === false`
        - `sku_channel.pending_import_id === null`
        - `sku_channel.excluded_at === null`
      - **STEP 1**: filter `p11RawOffers` via `filterCompetitorOffers(p11RawOffers, ownShopName)` (Story 3.2 self-filter); if `collisionDetected === true` → emit `shop-name-collision-detected` Atenção + return `{action: 'SKIP', reason: 'collision'}`; if `filteredOffers.length === 0` → tier=3, return `{action: 'HOLD', auditEvent: 'tier-transition'}` (no write)
      - **STEP 2**: stub call to `cooperative-absorb.js` (Story 7.3) — for now passes through; if Story 7.3 has shipped, dispatches to its logic
      - **STEP 3**: compute `floor_price_cents = roundFloorCents(list_price_cents * (1 - max_discount_pct))` and `ceiling_price_cents = roundCeilingCents(list_price_cents * (1 + max_increase_pct))` via `shared/money/index.js` (Story 7.1)
      - **STEP 4**: branching by position
        - `competitor_lowest = filteredOffers[0].total_price_cents`
        - `competitor_2nd = filteredOffers[1]?.total_price_cents ?? null`
        - own position determined by comparing `current_price_cents + min_shipping_price_cents` against `filteredOffers[0]`
        - **CASE A (position > 1)**: `target_undercut = competitor_lowest - edge_step_cents`; `candidate = MAX(target_undercut, floor_price_cents)`; if `candidate < competitor_lowest` → `action = UNDERCUT`, `new_price = candidate`, emit `undercut-decision` Rotina; else `action = HOLD`, emit `hold-floor-bound` Rotina
        - **CASE B (position == 1)**: if `competitor_2nd === null` → `action = HOLD`, emit `hold-already-in-1st` Rotina; else `target_ceiling = competitor_2nd - edge_step_cents`; `new_ceiling = MIN(target_ceiling, ceiling_price_cents)`; if `new_ceiling > current_price_cents` → `action = CEILING_RAISE`, emit `ceiling-raise-decision` Rotina; else `action = HOLD`, emit `hold-already-in-1st` Rotina
      - **STEP 5**: stub call to `circuit-breaker.js` (Story 7.6) per-SKU 15% check — for now passes through; if Story 7.6 has shipped, dispatches
      - **STEP 6**: if action ∈ {UNDERCUT, CEILING_RAISE} → emit to cycle-assembly (Story 5.2) which INSERTs into `pri01_staging` with the new_price_cents.
  2. **Given** the filter chain is mandatory **When** the engine runs against any P11 response **Then** EVERY ranking computation is post-filter-chain (no engine math reads `p11RawOffers` directly — only `filteredOffers`) **And** the filter chain order is verified: active first, then total_price, then self-filter, then sort by total_price ascending.
  3. **Given** tie-handling (per Pedro's pre-locked decision) **When** `candidate_price === competitor_lowest` in CASE A **Then** action = HOLD with `hold-floor-bound` Rotina event (NOT push into the tie — coin-flip with margin sacrifice strictly worse).
  4. **Given** the 12 fixtures listed above **When** I run `tests/worker/engine/decide.test.js` **Then** for each fixture the test loads the P11 response from JSON, calls `decideForSkuChannel` with the fixture's `skuChannel` + `customerMarketplace` + `ownShopName`, and asserts:
      - `p11-tier1-undercut-succeeds.json` → action=UNDERCUT, new_price = competitor_lowest - 0.01
      - `p11-tier1-floor-bound-hold.json` → action=HOLD, event=hold-floor-bound
      - `p11-tier1-tie-with-competitor-hold.json` → action=HOLD, event=hold-floor-bound
      - `p11-tier2b-ceiling-raise-headroom.json` → action=CEILING_RAISE
      - `p11-all-competitors-below-floor.json` → action=HOLD (cannot undercut profitably)
      - `p11-all-competitors-above-ceiling.json` → action=HOLD or CEILING_RAISE within ceiling — never violates ceiling
      - `p11-self-active-in-p11.json` → self filtered out, ranking proceeds correctly
      - `p11-self-marked-inactive-but-returned.json` → AD14 active filter catches it
      - `p11-single-competitor-is-self.json` → post-filter empty → tier 3 path (action=HOLD, no write)
      - `p11-zero-price-placeholder-mixed-in.json` → AD14 total_price>0 filter catches Strawberrynet-style placeholder
      - `p11-shop-name-collision.json` → AD13 collision detected, action=SKIP, `shop-name-collision-detected` Atenção emitted
      - `p11-pri01-pending-skip.json` → precondition fails (pending_import_id set), action=SKIP
  5. **Given** the negative-assertion check **When** I grep for direct P11 access OR direct money-cents math OR direct cron_state UPDATE inside `worker/src/engine/decide.js` **Then** there are no matches (all access goes through `shared/mirakl/p11.js`, `shared/mirakl/self-filter.js`, `shared/money/index.js`, `shared/state/cron-state.js`).

---

### Story 7.3: `worker/src/engine/cooperative-absorb.js` — STEP 2 absorption + skip-on-pending
- **Trace:** Implements AD9; FRs FR22. Size M.
- **Atomicity:** Bundle C — absorption half of the AD7+AD8+AD9+AD11 bundle; gate at Story 7.8.
- **Bob-trace:** SSoT: `worker/src/engine/cooperative-absorb.js` (`absorbExternalChange`). Test fixtures: `p11-cooperative-absorption-within-threshold.json`. Depends on Story 7.2 (engine orchestrator's STEP 2 stub call wired here), Story 9.0 + Story 9.1 (audit foundation for `external-change-absorbed` Notável event, calendar-early per Option A). Enables Story 7.4 (anomaly-freeze shares the deviation detection logic).
- **Acceptance Criteria:**
  1. **Given** `absorbExternalChange({tx, skuChannel, customerMarketplace})` is called from engine STEP 2 **When** `skuChannel.current_price_cents !== skuChannel.last_set_price_cents` AND `skuChannel.pending_import_id === null` **Then** the function detects the external change **And** computes `deviation_pct = Math.abs((current_price - list_price) / list_price)` **And** if `deviation_pct > threshold` (where threshold = `customer_marketplace.anomaly_threshold_pct ?? 0.40` — null reads default, per architecture) → calls `freezeSkuForReview` (Story 7.4) and returns `{absorbed: false, frozen: true}` (engine STEP 2 returns early — no normal repricing this cycle) **And** otherwise → updates `sku_channel.list_price_cents = current_price_cents` in the same transaction, emits `external-change-absorbed` Notável audit event with payload `{previousListPriceCents, newListPriceCents, deviationPct}`, and returns `{absorbed: true, frozen: false}` (engine STEP 2 continues to STEP 3 with the new list_price).
  2. **Given** the skip-on-pending semantic **When** `skuChannel.pending_import_id IS NOT NULL` **Then** absorption is SKIPPED entirely (per AD9) — current_price is in flux and not a stable signal; engine STEP 2 returns `{absorbed: false, frozen: false, skipped: true}` and the orchestrator returns SKIP for this cycle.
  3. **Given** the case where `current_price === last_set_price` **When** absorbExternalChange is called **Then** returns `{absorbed: false, frozen: false}` immediately (no external change detected).
  4. **Given** fixture `p11-cooperative-absorption-within-threshold.json` **When** loaded as input **Then** the test asserts: deviation < 0.40 → list_price updated → `external-change-absorbed` Notável emitted with correct payload **And** the test verifies the audit_log row's `priority` column is `'notavel'` (set by trigger from Story 9 foundation).
  5. **Given** unit tests in `tests/worker/engine/cooperative-absorb.test.js` **When** I run them **Then** they cover: external change detected → absorption succeeds; pending import → skipped; no change → no-op; threshold exceeded → freeze branch (mock the freeze call to verify dispatch).

---

### Story 7.4: `worker/src/safety/anomaly-freeze.js` + `/audit/anomaly/:sku/{accept|reject}` endpoints
- **Trace:** Implements AD12; FRs FR29. Size M.
- **Bob-trace:** SSoT: `worker/src/safety/anomaly-freeze.js` (`freezeSkuForReview`, `unfreezeSkuAfterAccept`, `unfreezeSkuAfterReject`), `app/src/routes/audit/anomaly-review.js`. Test fixtures: `p11-cooperative-absorption-anomaly-freeze.json`. Depends on Story 7.3 (absorption invokes freeze when deviation > threshold), Story 4.6 (`shared/resend/client.js`), Story 9.0 + Story 9.1 (audit foundation for `anomaly-freeze` Atenção event, calendar-early per Option A). Enables Epic 8 (anomaly-review modal UI consumes the accept/reject endpoints).
- **Acceptance Criteria:**
  1. **Given** `freezeSkuForReview({tx, skuChannelId, customerMarketplaceId, deviationPct, currentPriceCents, listPriceCents})` **When** called from Story 7.3's absorption logic **Then** in ONE transaction: sets `sku_channels.frozen_for_anomaly_review = true`, `frozen_at = NOW()`, `frozen_deviation_pct = deviationPct` **And** emits `anomaly-freeze` Atenção audit event with payload `{deviationPct, currentPriceCents, listPriceCents}` — the audit_log row's `resolved_at` is NULL (set later when customer accepts/rejects) **And** sends a critical alert email via `shared/resend/client.js`'s `sendCriticalAlert` (Story 4.6) within ≤5 min (NFR-P9) **And** subsequent dispatcher cycles SKIP this sku_channel (engine STEP 1 precondition `frozen_for_anomaly_review === false` fails).
  2. **Given** `POST /audit/anomaly/:skuChannelId/accept` (signed-in customer) **When** the customer accepts the new external price as the new list_price **Then** `unfreezeSkuAfterAccept({tx, skuChannelId})` runs in ONE transaction: sets `list_price_cents = current_price_cents`, `frozen_for_anomaly_review = false`, `frozen_at = null`, `frozen_deviation_pct = null` **And** marks the original `anomaly-freeze` audit_log row's `resolved_at = NOW()` (NO new audit event emitted — `anomaly-resolved` is not in AD20 taxonomy) **And** the next dispatcher cycle picks up the unfrozen sku_channel and reprices normally.
  3. **Given** `POST /audit/anomaly/:skuChannelId/reject` **When** the customer rejects the change (preserves old list_price) **Then** `unfreezeSkuAfterReject({tx, skuChannelId})` runs in ONE transaction: leaves `list_price_cents` unchanged, sets `frozen_for_anomaly_review = false`, `frozen_at = null`, `frozen_deviation_pct = null` **And** marks the original audit_log row's `resolved_at = NOW()` **And** next dispatcher cycle picks up the unfrozen sku_channel; cooperative-absorption (Story 7.3) will detect `current_price ≠ last_set_price` again — the customer must use whole-tool pause if they want to permanently override the absorption.
  4. **Given** RLS on the routes **When** customer A attempts `POST /audit/anomaly/<customer_B_skuChannelId>/accept` **Then** the RLS-aware client (Story 2.1) returns 0 rows; route returns 404 (not 403 — don't leak existence) **And** RLS regression suite extended with anomaly-review endpoint coverage.
  5. **Given** fixture `p11-cooperative-absorption-anomaly-freeze.json` **When** loaded as input to the engine **Then** the integration test asserts: deviation > 0.40 → freeze invoked → `anomaly-freeze` Atenção emitted → critical alert sent (via mock Resend client) → sku_channel marked frozen → engine SKIPs the SKU on next cycle.

---

### Story 7.5: `worker/src/engine/tier-classify.js` — full transitions + atomic T2a→T2b write per F1
- **Trace:** Implements AD10 (with F1 amendment); FRs FR17 (tier transitions populate state), FR19. Size M.
- **Bob-trace:** SSoT: `worker/src/engine/tier-classify.js` (`applyTierClassification`). Test fixtures: `p11-tier2a-recently-won-stays-watched.json`, `p11-tier3-no-competitors.json`, `p11-tier3-then-new-competitor.json`. Depends on Story 7.2 (engine calls into tier-classify after determining position), Story 4.2 (sku_channels.tier + tier_cadence_minutes + last_won_at columns), Story 9.0 + Story 9.1 (audit foundation for `tier-transition` Rotina event, calendar-early per Option A). Enables Story 7.8 (integration gate).
- **Acceptance Criteria:**
  1. **Given** `applyTierClassification({tx, skuChannel, currentPosition, hasCompetitors})` is called from engine STEP 4 (after position is determined but before audit emission) **When** the function evaluates transitions **Then** it implements AD10 + F1 transition rules:
      - **T1 → T2a** on winning 1st place (currentPosition === 1, previously not 1st): set `tier = '2a'`, `tier_cadence_minutes = 15`, `last_won_at = NOW()`; emit `tier-transition` Rotina event
      - **T2a → T2b** when `tier === '2a'` AND `last_won_at` is ≥ 4h ago AND currentPosition still === 1: ATOMIC write of `tier = '2b'` AND `tier_cadence_minutes = 45` in the SAME transaction as the `tier-transition` audit event (F1 amendment — without this atomic write, the dispatcher predicate keeps the row at 15-min cadence forever)
      - **{T2, T2a, T2b} → T1** on losing 1st place (currentPosition > 1): set `tier = '1'`, `tier_cadence_minutes = 15`; preserve `last_won_at` (analytics signal); emit `tier-transition` Rotina event
      - **T3 → T1 or T2a** on new competitor entering (was tier 3, now hasCompetitors === true): if currentPosition === 1 AND beats new competitor → tier = '2a', last_won_at = NOW(); else tier = '1'; emit `tier-transition` Rotina event
      - **T1 ↔ T2b stable**: no transition needed if state is unchanged
  2. **Given** the per-SKU cadence_minutes column drives dispatcher selection **When** the dispatcher runs after a T2a → T2b transition **Then** the row is checked at 45-min cadence (not 15-min), confirming the F1 atomic write has effect **And** an integration test asserts: simulate a T2a row with `last_won_at = NOW() - 5h`; run the engine; verify the row's `tier` is now `'2b'` and `tier_cadence_minutes` is `45` after the transaction commits.
  3. **Given** fixture `p11-tier2a-recently-won-stays-watched.json` (last_won_at < 4h ago, position still 1) **When** loaded **Then** test asserts: tier stays at '2a', cadence stays at 15 min, no transition emitted.
  4. **Given** fixture `p11-tier3-no-competitors.json` **When** loaded **Then** test asserts: tier classified as '3', cadence = 1440 (daily), no audit event for steady-state.
  5. **Given** fixture `p11-tier3-then-new-competitor.json` (was T3, now competitor present) **When** loaded **Then** test asserts: tier transitions to '1' or '2a' depending on position, `tier-transition` event emitted.
  6. **Given** unit tests in `tests/worker/engine/tier-classify.test.js` **When** I run them **Then** they cover all 4 transition rules + the F1 atomic write verification.

---

### Story 7.6: `worker/src/safety/circuit-breaker.js` — per-SKU 15% + per-cycle 20%
- **Trace:** Implements AD11 (with F6); FRs FR26, FR27. Size M.
- **Atomicity:** Bundle C — circuit-breaker half of AD7+AD8+AD9+AD11; gate at Story 7.8.
- **Bob-trace:** SSoT: `worker/src/safety/circuit-breaker.js` (`checkPerSkuCircuitBreaker`, `checkPerCycleCircuitBreaker`). Depends on Story 7.2 (engine STEP 5 calls into per-SKU CB), Story 5.2 (cycle-assembly calls into per-cycle CB after staging, before flush), Story 9.0 + Story 9.1 (audit foundation for `circuit-breaker-trip` and `circuit-breaker-per-sku-trip` Atenção events, calendar-early per Option A). Enables Story 7.8 (integration gate exercises both caps).
- **Acceptance Criteria:**
  1. **Given** `checkPerSkuCircuitBreaker({skuChannel, newPriceCents, currentPriceCents})` called from engine STEP 5 **When** `Math.abs(newPriceCents - currentPriceCents) / currentPriceCents > 0.15` **Then** the function returns `{tripped: true, action: 'HOLD_CIRCUIT_BREAKER_PER_SKU', deltaPct}` **And** the engine emits `circuit-breaker-per-sku-trip` Atenção audit event with payload `{deltaPct, attemptedNewPriceCents, currentPriceCents}` **And** sends critical alert via `shared/resend/client.js` **And** the per-cycle 20% cap is computed independently at the dispatcher (not affected by per-SKU trips).
  2. **Given** `checkPerCycleCircuitBreaker({tx, customerMarketplaceId, cycleId})` called by cycle-assembly after staging, before flushing to writer (Story 5.2 + Story 6.1) **When** the function runs **Then** numerator = `SELECT COUNT(*) FROM pri01_staging WHERE cycle_id = $cycleId AND flushed_at IS NULL` (rows staged for write this cycle) **And** denominator = `SELECT COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $customerMarketplaceId AND excluded_at IS NULL` (active SKUs in the marketplace — F6 amendment denominator) **And** trip predicate: `numerator / denominator > 0.20` **And** if NOT tripped → returns `{tripped: false}`; cycle-assembly proceeds to flush via writer (Story 6.1) **And** if tripped → in ONE transaction: cycle-assembly halts the staging flush (no PRI01 emitted this cycle); calls `transitionCronState({from: 'ACTIVE', to: 'PAUSED_BY_CIRCUIT_BREAKER', context: {cycleId, numerator, denominator}})` — which (per Story 4.1's per-transition map) emits `circuit-breaker-trip` Atenção via `transitionCronState`'s lookup; sends critical alert via `shared/resend/client.js`.
  3. **Given** the customer reviews via the dashboard banner (Epic 8) and clicks "Retomar manualmente" **When** the dashboard sends `POST /resume` **Then** the route calls `transitionCronState({from: 'PAUSED_BY_CIRCUIT_BREAKER', to: 'ACTIVE', context: {manualUnblock: true}})` — note: `(PAUSED_BY_CIRCUIT_BREAKER, ACTIVE)` is in `LEGAL_CRON_TRANSITIONS` (Story 4.1) but NOT in the per-transition event map (Pedro's discipline — manual unblocks don't emit AD20 events) **And** the next dispatcher cycle's per-SKU decisions are recomputed from CURRENT state (no pending writes survive a circuit-breaker trip — the staging rows were never flushed).
  4. **Given** unit tests in `tests/worker/safety/circuit-breaker.test.js` **When** I run them **Then** they cover: per-SKU 14% delta does NOT trip; 16% delta DOES trip + emits Atenção; per-cycle numerator/denominator boundary at exactly 20% does NOT trip (strict `> 0.20`); 21% trips + transitions cron_state; manual unblock path works.
  5. **Given** an integration test **When** I synthesize a scenario where 21% of a customer's catalog stages for write in a single cycle **Then** the per-cycle CB trips, no PRI01 emitted, cron_state = PAUSED_BY_CIRCUIT_BREAKER, Atenção event in audit_log, Resend mock received critical alert.
  6. **Given** the manual unblock path `(PAUSED_BY_CIRCUIT_BREAKER → ACTIVE)` per Step 4 audit refinement I3 **When** the customer clicks "Retomar manualmente" and the route calls `transitionCronState` (this `(from, to)` tuple is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-transition event map per Story 4.1) **Then** the unblock route ALSO finds the original `circuit-breaker-trip` audit_log row for this customer_marketplace + cycle_id and sets `resolved_at = NOW()` (mirrors Story 7.4's anomaly-freeze pattern — the original Atenção event gets a resolution timestamp, not a new event) **And** NO new event_type is emitted on the manual unblock (no `circuit-breaker-resolved` etc. — that's not in AD20's locked taxonomy) **And** the customer's audit log surface (Epic 9) renders the original `circuit-breaker-trip` row with a "resolvido às HH:MM" annotation derived from the timestamp.

---

### Story 7.7: `worker/src/safety/reconciliation.js` — Tier 3 daily pass = nightly reconciliation
- **Trace:** Implements FR28, AD10 (Tier 3 daily). Size S.
- **Bob-trace:** SSoT: `worker/src/safety/reconciliation.js` (`runReconciliationPass`), `worker/src/jobs/reconciliation.js` (cron entry). Depends on Story 7.2 (engine), Story 7.5 (tier-classify), Story 3.2 (P11 wrapper + self-filter), Story 9.0 + Story 9.1 (audit foundation for `new-competitor-entered` Notável event, calendar-early per Option A). Enables Story 7.8.
- **Acceptance Criteria:**
  1. **Given** `worker/src/jobs/reconciliation.js` registered with `node-cron` to run daily at midnight Lisbon (`0 0 * * *` with TZ adjustment) **When** the cron tick fires **Then** it queries Tier 3 sku_channels (per the dispatcher predicate, which already covers Tier 3 at 1440-min cadence — but reconciliation runs an EXPLICIT cycle to ensure no Tier 3 SKU is missed even if dispatcher backlog is delayed) **And** for each Tier 3 sku_channel: calls P11 (Story 3.2), applies self-filter (Story 3.2), checks if `filteredOffers.length > 0` (new competitor entered) **And** if new competitor → invokes `applyTierClassification` (Story 7.5) — transitions to T1 or T2a; emits `tier-transition` and `new-competitor-entered` Notável events **And** if still no competitors → updates `last_checked_at = NOW()` only; no audit event (silent steady state).
  2. **Given** the reconciliation also self-heals stale state **When** it encounters a sku_channel where `last_checked_at` is older than `tier_cadence_minutes * 2` (drifted) **Then** logs a warning at `warn` level via pino with `customer_marketplace_id` + `sku_channel_id` + `last_checked_at` **And** forces a check this cycle to recover.
  3. **Given** unit tests in `tests/worker/safety/reconciliation.test.js` **When** I run them **Then** they cover: T3 with no competitors → no transition; T3 with new competitor → T1 or T2a transition; stale-state detection logs warning.

---

### Story 7.8: END-TO-END INTEGRATION GATE — full cycle test on all 17 P11 fixtures (atomicity-bundle gate for AD7+AD8+AD9+AD11)
- **Trace:** Implements AD7 + AD8 + AD9 + AD11 atomicity-bundle gate; FRs FR17-FR29 (engine + writer + safety integrated). Size L.
- **Atomicity:** Bundle C — GATE. Single binding integration-test for the AD7+AD8+AD9+AD11 bundle. Without this gate passing, Epic 6's writer cannot ship live (writer is functional in isolation but the engine integration is unproven).
- **Bob-trace:** Test fixtures: ALL 17 P11 fixtures: `p11-tier1-undercut-succeeds`, `p11-tier1-floor-bound-hold`, `p11-tier1-tie-with-competitor-hold`, `p11-tier2a-recently-won-stays-watched`, `p11-tier2b-ceiling-raise-headroom`, `p11-tier3-no-competitors`, `p11-tier3-then-new-competitor`, `p11-all-competitors-below-floor`, `p11-all-competitors-above-ceiling`, `p11-self-active-in-p11`, `p11-self-marked-inactive-but-returned`, `p11-single-competitor-is-self`, `p11-zero-price-placeholder-mixed-in`, `p11-shop-name-collision`, `p11-pri01-pending-skip`, `p11-cooperative-absorption-within-threshold`, `p11-cooperative-absorption-anomaly-freeze`. SSoT: `tests/integration/full-cycle.test.js`, `tests/integration/circuit-breaker-trip.test.js`, `tests/integration/pending-import-id-invariant.test.js`. Depends on ALL prior Epic 6 + Epic 7 stories (Stories 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7). Enables Epic 6 + Epic 7 atomicity bundle is verified safe to ship to production.
- **Notes:** Bundle C gate test — pending_import_id invariant test (`tests/integration/pending-import-id-invariant.test.js`) asserts: After writer.submitPriceImport + markStagingPending: ALL participating rows (including passthroughs) have `pending_import_id` set in the same transaction; while `pending_import_id` IS NOT NULL: engine STEP 1 SKIPs the row (precondition fails); while `pending_import_id` IS NOT NULL: cooperative-absorption SKIPs the row (Story 7.3 skip-on-pending); on PRI02 COMPLETE: clears atomically across ALL participating rows; on PRI02 FAILED: clears `pending_import_id`, triggers PRI03 parser (Story 6.3), schedules per-SKU rebuild.
- **Acceptance Criteria:**
  1. **Given** `tests/integration/full-cycle.test.js` is the atomicity-bundle gate **When** it runs **Then** it boots the Mirakl mock server (Story 3.2) seeded with fixture responses, instantiates a test Postgres with seed data for one customer with one customer_marketplace + 17 sku_channels (one per fixture), and for each fixture:
      1. Loads the fixture's P11 response into the mock server
      2. Triggers a single dispatcher cycle via `dispatchCycle()` (Story 5.1) for the test customer
      3. Asserts the engine produces the expected action per the fixture's documented expectation (UNDERCUT / CEILING_RAISE / HOLD / SKIP)
      4. Asserts the audit_log contains the expected event(s) with the expected `priority` (atencao/notavel/rotina derived by the trigger)
      5. For UNDERCUT/CEILING_RAISE: asserts a `pri01_staging` row was inserted with the expected `new_price_cents`
      6. Triggers `cycleAssembly.flush()` which calls into the writer (Story 6.1) → asserts CSV emitted matches a golden file (where applicable) → asserts ALL participating sku_channel rows have `pending_import_id` set (the invariant)
      7. Simulates PRI02 COMPLETE via the mock server → triggers `worker/src/jobs/pri02-poll.js` (Story 6.2) once → asserts ALL participating sku_channels have `pending_import_id = null` and `last_set_price_cents = pending_set_price_cents` (atomic clear).
  2. **Given** the per-fixture expected outcomes (each fixture file has a `_expected` sibling JSON or inline assertions) **When** the test parametrizes over the 17 fixtures **Then** all 17 pass with their expected behavior:
      - 12 from Story 7.2 (engine decision flow)
      - 1 from Story 7.3 (cooperative-absorption-within-threshold)
      - 1 from Story 7.4 (cooperative-absorption-anomaly-freeze → freeze + Atenção + critical alert)
      - 3 from Story 7.5 (tier transitions)
  3. **Given** the pending_import_id invariant test (`tests/integration/pending-import-id-invariant.test.js`) **When** it runs synthetic scenarios **Then** it asserts:
      - After writer.submitPriceImport + markStagingPending: ALL participating rows (including passthroughs) have `pending_import_id` set in the same transaction
      - While `pending_import_id` IS NOT NULL: engine STEP 1 SKIPs the row (precondition fails)
      - While `pending_import_id` IS NOT NULL: cooperative-absorption SKIPs the row (Story 7.3 skip-on-pending)
      - On PRI02 COMPLETE: clears atomically across ALL participating rows
      - On PRI02 FAILED: clears `pending_import_id`, triggers PRI03 parser (Story 6.3), schedules per-SKU rebuild
  4. **Given** the circuit-breaker integration test (`tests/integration/circuit-breaker-trip.test.js`) **When** it synthesizes a 21% catalog price-change scenario **Then** asserts: cycle halts before flushing, cron_state transitions to PAUSED_BY_CIRCUIT_BREAKER, `circuit-breaker-trip` Atenção emitted, mock Resend received critical alert, no PRI01 emitted to mock Mirakl.
  5. **Given** the gate runs on every PR via CI **When** any of the 17 fixtures fails OR the invariant test fails OR the circuit-breaker test fails **Then** the deploy is blocked **And** Epic 6's writer code is considered NOT-safe-to-ship-to-production until this gate passes.
  6. **Given** the gate is the AD7+AD8+AD9+AD11 atomicity bundle's single binding integration-test **When** all assertions pass **Then** the bundle ships together — Story 6.1 writer + Story 7.2 engine + Story 7.3 absorption + Story 7.6 per-SKU CB are jointly verified safe.
