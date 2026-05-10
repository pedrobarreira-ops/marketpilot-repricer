# Epic 7 Test Plan — Engine Decision & Safety

**Generated:** 2026-05-10
**Epic:** Epic 7 — Engine Decision & Safety (Stories 7.1–7.8)
**Runner:** `node --test` (built-in; no Jest/Vitest per architecture constraint)
**Integration gate:** Stories 7.2, 7.3, 7.6, and 7.4 are Bundle C participants. The Bundle C
integration gate fires at Story 7.8 (`tests/integration/full-cycle.test.js`).

---

## Overview

Epic 7 delivers the repricing engine and safety net: the money math primitives (Story 7.1),
the full AD8 decision flow (Story 7.2), cooperative-ERP absorption (Story 7.3), anomaly
freeze (Story 7.4), tier classification with F1 atomic T2a→T2b write (Story 7.5), dual
circuit-breakers (Story 7.6), nightly Tier-3 reconciliation (Story 7.7), and the Bundle C
atomicity integration gate (Story 7.8).

The integration gate at Story 7.8 exercises all 17 P11 fixtures against the Mirakl mock server,
verifying the full cycle: engine → pri01_staging → PRI01 flush → pending_import_id invariant →
PRI02 COMPLETE.

### Stories

| Story | Title | Size | `integration_test_required` |
|-------|-------|------|-----------------------------|
| 7.1 | `shared/money/index.js` + `no-float-price` ESLint rule | S | no |
| 7.2 | `worker/src/engine/decide.js` — full AD8 decision flow | L | no (unit) |
| 7.3 | `worker/src/engine/cooperative-absorb.js` | M | no (unit) |
| 7.4 | `worker/src/safety/anomaly-freeze.js` + anomaly routes | M | yes — RLS |
| 7.5 | `worker/src/engine/tier-classify.js` — F1 atomic T2a→T2b | M | no (unit) |
| 7.6 | `worker/src/safety/circuit-breaker.js` — per-SKU 15% + per-cycle 20% | M | no (unit) |
| 7.7 | `worker/src/safety/reconciliation.js` — Tier 3 daily pass | S | no (unit) |
| 7.8 | END-TO-END INTEGRATION GATE — all 17 P11 fixtures | L | **GATE** |

### Atomicity Bundle C Context

Stories 7.2, 7.3, 7.6 are Bundle C participants (AD8, AD9, AD11), plus Stories 5.1, 5.2, 6.1,
6.2, 6.3 from prior epics. All are merge-block-protected in sprint-status.yaml — none may merge
to `main` until Story 7.8 (the integration gate) reaches `done`.

Key Bundle C invariants:
- **pending_import_id atomicity:** After PRI01 flush, ALL participating sku_channel rows have
  `pending_import_id` set in the same transaction.
- **Skip-on-pending:** While `pending_import_id IS NOT NULL`: engine STEP 1 skips + cooperative-
  absorption skips. The row is in flight.
- **Per-cycle 20% cap (F6):** Denominator = active SKUs (`excluded_at IS NULL`), NOT total SKUs.
- **F1 atomic T2a→T2b:** Tier write + audit event happen in ONE transaction, or dispatcher
  predicate stays stuck at 15-min cadence forever.
- **Resolved_at pattern:** Atenção events (anomaly-freeze, circuit-breaker-trip) get a
  `resolved_at` timestamp on resolution — no new event_type emitted.

---

## Story 7.1: `shared/money/index.js` + `no-float-price` ESLint rule

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Money utilities | `shared/money/index.js` |
| ESLint rule | `eslint-rules/no-float-price.js` |

### Test File

`tests/shared/money/index.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `to_cents_converts_17_99_to_1799` | toCents(17.99) === 1799 |
| AC#1 | `to_cents_converts_zero_to_zero` | toCents(0) === 0 |
| AC#1 | `to_cents_rounds_to_nearest_cent_on_excess_decimals` | toCents(17.999) rounds correctly |
| AC#1 | `to_cents_throws_on_nan` | throws on NaN |
| AC#1 | `to_cents_throws_on_undefined` | throws on undefined |
| AC#1 | `to_cents_throws_on_negative` | throws on negative input |
| AC#2 | `from_cents_1799_returns_euro_17_99_pt_locale` | '€17,99' (comma decimal, € prefix) |
| AC#2 | `from_cents_0_returns_euro_0_00` | '€0,00' |
| AC#2 | `from_cents_1_returns_euro_0_01` | '€0,01' |
| AC#2 | `from_cents_uses_comma_not_period_as_decimal_separator` | comma check |
| AC#2 | `from_cents_uses_euro_prefix_not_suffix` | startsWith('€') |
| AC#3 | `round_floor_cents_1798_7_returns_1799` | Math.ceil(1798.7) = 1799 |
| AC#3 | `round_floor_cents_exact_integer_returns_unchanged` | 1799 → 1799 |
| AC#3 | `round_floor_cents_1798_5_returns_1799` | edge case: Math.ceil(1798.5) = 1799 |
| AC#3 | `round_floor_cents_protects_margin_never_sinks_below_raw` | invariant: result >= input |
| AC#4 | `round_ceiling_cents_1801_3_returns_1801` | Math.floor(1801.3) = 1801 |
| AC#4 | `round_ceiling_cents_exact_integer_returns_unchanged` | 1801 → 1801 |
| AC#4 | `round_ceiling_cents_1801_5_returns_1801` | edge case: Math.floor(1801.5) = 1801 |
| AC#4 | `round_ceiling_cents_prevents_over_pricing_never_exceeds_raw` | invariant: result <= input |
| AC#5 | `format_eur_produces_same_output_as_from_cents` | alias consistency |
| AC#5 | `format_eur_registered_as_eta_view_helper_renders_correctly` | function signature |
| AC#6 | `eslint_no_float_price_fires_on_to_fixed_price_identifier` | .toFixed(2) on price → fires |
| AC#6 | `eslint_no_float_price_fires_on_parse_float_to_price_identifier` | parseFloat → fires |
| AC#6 | `eslint_no_float_price_fires_on_multiply_100_pattern` | * 100 → fires |
| AC#6 | `eslint_no_float_price_fires_on_math_round_ad_hoc_cents_pattern` | Math.round/100 → fires |
| AC#6 | `eslint_no_float_price_does_not_fire_inside_shared_money_index_js` | allowlist exemption |
| AC#6 | `eslint_no_float_price_error_message_includes_ssot_path` | message includes 'shared/money/index.js' |
| AC#7 | `round_trip_to_cents_then_from_cents_preserves_value` | no drift |
| AC#7 | `round_floor_conservative_rounding_edge_case_1798_5` | Math.ceil |
| AC#7 | `round_ceiling_conservative_rounding_edge_case_1801_5` | Math.floor |
| AC#7 | `from_cents_locale_uses_comma_decimal_separator` | '€10,50' |
| AC#7 | `to_cents_throws_on_string_input` | throws on '17.99' |
| AC#7 | `to_cents_throws_on_null_input` | throws on null |

---

## Story 7.2: `worker/src/engine/decide.js` — Full AD8 decision flow

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Engine decision | `worker/src/engine/decide.js` (`decideForSkuChannel`) |

### Test File

`tests/worker/src/engine/decide.test.js` (scaffold committed at Epic-Start)

### P11 Fixtures Consumed (12 of 17)

All 12 stored in `tests/fixtures/p11/engine/`:

| Fixture | Expected action | Key scenario |
|---------|-----------------|--------------|
| `p11-tier1-undercut-succeeds.json` | UNDERCUT | Happy path |
| `p11-tier1-floor-bound-hold.json` | HOLD (hold-floor-bound) | Floor protection |
| `p11-tier1-tie-with-competitor-hold.json` | HOLD (hold-floor-bound) | Tie → no push |
| `p11-tier2b-ceiling-raise-headroom.json` | CEILING_RAISE | 2nd competitor headroom |
| `p11-all-competitors-below-floor.json` | HOLD | Floor protects all |
| `p11-all-competitors-above-ceiling.json` | CEILING_RAISE or HOLD | Ceiling respected |
| `p11-self-active-in-p11.json` | UNDERCUT/HOLD | Self filtered (AD13/14) |
| `p11-self-marked-inactive-but-returned.json` | UNDERCUT/HOLD | active=false filter |
| `p11-single-competitor-is-self.json` | HOLD | Post-filter empty → T3 |
| `p11-zero-price-placeholder-mixed-in.json` | UNDERCUT/HOLD | total_price>0 filter |
| `p11-shop-name-collision.json` | SKIP | AD13 collision + Atenção |
| `p11-pri01-pending-skip.json` | SKIP | Bundle C skip-on-pending |

### Key Behavioral Tests (excerpt)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `decide_skips_when_cron_state_not_active` | precondition: cron_state |
| AC#1 | `decide_skips_when_frozen_for_anomaly_review` | precondition: freeze |
| AC#1 | `decide_skips_when_pending_import_id_set` | Bundle C invariant |
| AC#1 | `decide_skips_when_excluded_at_set` | precondition: excluded |
| AC#1 | `decide_step1_collision_returns_skip_with_atencao_event` | AD13 collision |
| AC#1 | `decide_step1_empty_post_filter_gives_tier3_hold` | empty filteredOffers |
| AC#3 | `decide_tie_with_competitor_holds_not_pushes` | tie-handling |
| AC#4 | `p11_tier1_undercut_succeeds` | 12 fixture assertions |
| AC#5 | `decide_js_has_no_direct_p11_raw_offer_math` | negative assertion |
| AC#5 | `decide_js_has_no_direct_float_price_math` | no-float-price compliance |
| AC#5 | `decide_js_has_no_direct_cron_state_update` | SSoT discipline |

---

## Story 7.3: `worker/src/engine/cooperative-absorb.js`

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Cooperative absorption | `worker/src/engine/cooperative-absorb.js` (`absorbExternalChange`) |

### Test File

`tests/worker/src/engine/cooperative-absorb.test.js` (scaffold committed at Epic-Start)

### P11 Fixtures Consumed (1 of 17)

| Fixture | Expected | Key scenario |
|---------|----------|--------------|
| `p11-cooperative-absorption-within-threshold.json` | absorbed=true, Notável emitted | Within 40% threshold |

### Key Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `absorb_detects_external_change_when_current_differs_from_last_set` | change detection |
| AC#1 | `absorb_computes_deviation_pct_against_list_price` | deviation math |
| AC#1 | `absorb_updates_list_price_to_current_when_within_threshold` | list_price update |
| AC#1 | `absorb_emits_external_change_absorbed_notavel_event` | Notável event |
| AC#1 | `absorb_calls_freeze_when_deviation_exceeds_threshold` | freeze dispatch |
| AC#2 | `absorb_skips_entirely_when_pending_import_id_not_null` | skip-on-pending |
| AC#3 | `absorb_returns_no_op_when_current_equals_last_set` | no change → no-op |

---

## Story 7.4: `worker/src/safety/anomaly-freeze.js` + routes

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Freeze logic | `worker/src/safety/anomaly-freeze.js` |
| Anomaly review routes | `app/src/routes/audit/anomaly-review.js` |

### Test File

`tests/worker/src/safety/anomaly-freeze.test.js` (scaffold committed at Epic-Start)

**`integration_test_required: true`** — RLS isolation on accept/reject endpoints.

### P11 Fixtures Consumed (1 of 17)

| Fixture | Expected | Key scenario |
|---------|----------|--------------|
| `p11-cooperative-absorption-anomaly-freeze.json` | SKIP + frozen=true + Atenção + critical alert | >40% deviation |

### Key Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `freeze_sets_frozen_for_anomaly_review_true_in_transaction` | freeze write |
| AC#1 | `freeze_emits_anomaly_freeze_atencao_audit_event` | Atenção emission |
| AC#1 | `freeze_sends_critical_alert_via_resend` | NFR-P9 |
| AC#1 | `freeze_all_writes_in_single_transaction` | atomicity |
| AC#2 | `accept_sets_list_price_to_current_price` | accept semantics |
| AC#2 | `accept_marks_original_anomaly_freeze_audit_row_resolved` | resolved_at pattern |
| AC#2 | `accept_emits_no_new_audit_event` | no anomaly-resolved event type |
| AC#3 | `reject_preserves_list_price_unchanged` | reject semantics |
| AC#4 | `accept_endpoint_returns_404_for_cross_customer_sku_channel` | RLS: 404 not 403 |

---

## Story 7.5: `worker/src/engine/tier-classify.js` — F1 atomic T2a→T2b

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Tier classification | `worker/src/engine/tier-classify.js` (`applyTierClassification`) |

### Test File

`tests/worker/src/engine/tier-classify.test.js` (scaffold committed at Epic-Start)

### P11 Fixtures Consumed (3 of 17)

| Fixture | Expected | Key scenario |
|---------|----------|--------------|
| `p11-tier2a-recently-won-stays-watched.json` | stays T2a, no transition | last_won_at < 4h |
| `p11-tier3-no-competitors.json` | stays T3, no event | steady state |
| `p11-tier3-then-new-competitor.json` | T3→T1 or T2a, tier-transition | new competitor |

### Key Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `t1_to_t2a_on_winning_first_place` | T1→T2a transition |
| AC#1 | `t2a_to_t2b_when_last_won_at_over_4h_ago_still_in_first` | T2a→T2b (F1) |
| AC#1 | `t2a_to_t2b_f1_atomic_write_tier_and_cadence_in_same_tx` | F1 invariant |
| AC#1 | `t2a_stays_when_last_won_at_under_4h_ago` | no premature T2b |
| AC#1 | `t2a_to_t1_on_losing_first_place` | regression to T1 |
| AC#1 | `t2_to_t1_preserves_last_won_at` | analytics signal |
| AC#2 | `f1_t2a_to_t2b_dispatcher_skips_row_at_45min_cadence` | F1 effect on dispatcher |

---

## Story 7.6: `worker/src/safety/circuit-breaker.js` — per-SKU 15% + per-cycle 20%

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Circuit breaker | `worker/src/safety/circuit-breaker.js` |

### Test File

`tests/worker/src/safety/circuit-breaker.test.js` (scaffold committed at Epic-Start)

### Key Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `per_sku_cb_does_not_trip_at_14_pct_delta` | below 15% no-trip |
| AC#1 | `per_sku_cb_does_not_trip_at_exactly_15_pct_delta` | boundary: strict > |
| AC#1 | `per_sku_cb_trips_at_16_pct_delta` | 16% trips |
| AC#1 | `per_sku_cb_trip_emits_circuit_breaker_per_sku_trip_atencao` | Atenção emission |
| AC#2 | `per_cycle_cb_does_not_trip_at_exactly_20_pct` | boundary: strict > |
| AC#2 | `per_cycle_cb_trips_at_21_pct` | 21% trips |
| AC#2 | `per_cycle_cb_denominator_is_active_skus_not_total` | F6 amendment |
| AC#2 | `per_cycle_cb_trip_transitions_cron_state_to_paused_by_circuit_breaker` | state transition |
| AC#3 | `manual_unblock_marks_original_circuit_breaker_trip_row_resolved` | resolved_at pattern |
| AC#3 | `manual_unblock_does_not_emit_new_audit_event` | no CB-resolved event type |

---

## Story 7.7: `worker/src/safety/reconciliation.js` — Tier 3 daily pass

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Reconciliation | `worker/src/safety/reconciliation.js` (`runReconciliationPass`) |
| Reconciliation cron | `worker/src/jobs/reconciliation.js` |

### Test File

`tests/worker/src/safety/reconciliation.test.js` (scaffold committed at Epic-Start)

### Key Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `reconciliation_cron_registered_daily_at_midnight_lisbon` | cron '0 0 * * *' + Lisbon TZ |
| AC#1 | `reconciliation_t3_no_competitors_silent_steady_state` | last_checked_at update only |
| AC#1 | `reconciliation_t3_new_competitor_emits_tier_transition_event` | tier-transition Rotina |
| AC#1 | `reconciliation_t3_new_competitor_emits_new_competitor_entered_notavel` | Notável event |
| AC#2 | `reconciliation_detects_stale_last_checked_at_beyond_double_cadence` | pino warn |
| AC#2 | `reconciliation_forces_check_on_stale_sku_channel` | recovery |

---

## Story 7.8: END-TO-END INTEGRATION GATE (Bundle C gate)

### SSoT Introduced

| Test file | Purpose |
|-----------|---------|
| `tests/integration/full-cycle.test.js` | All 17 P11 fixtures — full cycle gate |
| `tests/integration/circuit-breaker-trip.test.js` | 21% scenario — per-cycle CB |
| `tests/integration/pending-import-id-invariant.test.js` | pending_import_id lifecycle |

All three files scaffold committed at Epic-Start. The gate fires on every PR via CI.

### All 17 P11 Fixtures

| Fixture | Story | Expected |
|---------|-------|----------|
| `p11-tier1-undercut-succeeds.json` | 7.2 | UNDERCUT |
| `p11-tier1-floor-bound-hold.json` | 7.2 | HOLD (hold-floor-bound) |
| `p11-tier1-tie-with-competitor-hold.json` | 7.2 | HOLD (hold-floor-bound, tie) |
| `p11-tier2b-ceiling-raise-headroom.json` | 7.2 | CEILING_RAISE |
| `p11-all-competitors-below-floor.json` | 7.2 | HOLD |
| `p11-all-competitors-above-ceiling.json` | 7.2 | CEILING_RAISE or HOLD (ceiling respected) |
| `p11-self-active-in-p11.json` | 7.2 | normal ranking after self-filter |
| `p11-self-marked-inactive-but-returned.json` | 7.2 | normal ranking after active filter |
| `p11-single-competitor-is-self.json` | 7.2 | HOLD (post-filter empty → T3) |
| `p11-zero-price-placeholder-mixed-in.json` | 7.2 | normal ranking after price filter |
| `p11-shop-name-collision.json` | 7.2 | SKIP + shop-name-collision-detected Atenção |
| `p11-pri01-pending-skip.json` | 7.2 | SKIP (Bundle C invariant) |
| `p11-cooperative-absorption-within-threshold.json` | 7.3 | absorbed + Notável |
| `p11-cooperative-absorption-anomaly-freeze.json` | 7.4 | SKIP + anomaly-freeze Atenção |
| `p11-tier2a-recently-won-stays-watched.json` | 7.5 | stays T2a (no transition) |
| `p11-tier3-no-competitors.json` | 7.5 | HOLD (T3, no event) |
| `p11-tier3-then-new-competitor.json` | 7.5 | T3→T1 or T2a + tier-transition |

### Bundle C Ship Condition

When Story 7.8 gate passes:
- Story 5.1 (`worker/src/dispatcher.js`) — safe to merge
- Story 5.2 (`worker/src/cycle-assembly.js`) — safe to merge
- Story 6.1 (`shared/mirakl/pri01-writer.js`) — safe to merge (ONLY after this gate)
- Story 6.2 (`shared/mirakl/pri02-poller.js`) — safe to merge
- Story 6.3 (`shared/mirakl/pri03-parser.js`) — safe to merge
- Story 7.2 (`worker/src/engine/decide.js`) — safe to merge
- Story 7.3 (`worker/src/engine/cooperative-absorb.js`) — safe to merge
- Story 7.6 (`worker/src/safety/circuit-breaker.js`) — safe to merge

---

## Cross-Cutting Concerns

### ESLint Rule: `no-float-price`

Ships with Story 7.1. Applies to all code EXCEPT `shared/money/index.js`.
- Fires on: `.toFixed(2)` with price identifier, `parseFloat()` to price, `* 100`, `* 0.01`,
  `Math.round(x * 100) / 100`
- Rule namespace: `local-money/no-float-price` (follow `local-cron/` pattern)
- Error message must include `shared/money/index.js` + function names

### Resolved_at Pattern (Atenção events)

Both anomaly-freeze (Story 7.4) and circuit-breaker-trip (Story 7.6) use the same resolved_at
pattern:
- Original Atenção event row gets `resolved_at = NOW()` on resolution
- NO new event_type emitted (no `anomaly-resolved`, no `circuit-breaker-resolved` in AD20)
- Epic 9 audit log surface renders resolved Atenção rows with "resolvido às HH:MM" annotation

### pending_import_id Invariant (Bundle C)

Critical correctness invariant spanning Stories 6.1, 7.2, 7.3:
1. After flush: ALL cycle rows have `pending_import_id` set (zero tolerance for partial state)
2. While set: engine STEP 1 SKIP + cooperative-absorption SKIP
3. On PRI02 COMPLETE: atomic clear across ALL rows in one transaction
4. On PRI02 FAILED: clear + PRI03 dispatch + rebuild scheduling (Story 6.3 AC#5 wire-up)

### F1 Amendment: T2a→T2b Atomic Write

Without F1: T2a rows with `last_won_at >= 4h` keep the 15-min cadence forever
(dispatcher predicate reads `tier_cadence_minutes`, which never changed).
With F1: `tier = '2b'` AND `tier_cadence_minutes = 45` in the SAME transaction as the
`tier-transition` audit event. Test must verify the cadence column persists (45-min cadence
then skips the row in next 30-min dispatcher run).

---

## AC Coverage Map

| Story | AC | Test File | Test Name | Status |
|-------|----|-----------|-----------|--------|
| 7.1 | AC#1 | money/index.test.js | `to_cents_converts_17_99_to_1799` | scaffold |
| 7.1 | AC#1 | money/index.test.js | `to_cents_throws_on_nan` | scaffold |
| 7.1 | AC#2 | money/index.test.js | `from_cents_1799_returns_euro_17_99_pt_locale` | scaffold |
| 7.1 | AC#3 | money/index.test.js | `round_floor_cents_1798_7_returns_1799` | scaffold |
| 7.1 | AC#4 | money/index.test.js | `round_ceiling_cents_1801_3_returns_1801` | scaffold |
| 7.1 | AC#5 | money/index.test.js | `format_eur_produces_same_output_as_from_cents` | scaffold |
| 7.1 | AC#6 | money/index.test.js | `eslint_no_float_price_fires_on_to_fixed_price_identifier` | scaffold |
| 7.1 | AC#7 | money/index.test.js | `round_trip_to_cents_then_from_cents_preserves_value` | scaffold |
| 7.2 | AC#1 | engine/decide.test.js | `decide_skips_when_cron_state_not_active` | scaffold |
| 7.2 | AC#1 | engine/decide.test.js | `decide_step1_collision_returns_skip_with_atencao_event` | scaffold |
| 7.2 | AC#2 | engine/decide.test.js | `decide_js_has_no_direct_p11_raw_offer_math` | scaffold |
| 7.2 | AC#3 | engine/decide.test.js | `decide_tie_with_competitor_holds_not_pushes` | scaffold |
| 7.2 | AC#4 | engine/decide.test.js | 12 fixture assertions | scaffold |
| 7.3 | AC#1 | engine/cooperative-absorb.test.js | `absorb_updates_list_price_to_current_when_within_threshold` | scaffold |
| 7.3 | AC#2 | engine/cooperative-absorb.test.js | `absorb_skips_entirely_when_pending_import_id_not_null` | scaffold |
| 7.3 | AC#3 | engine/cooperative-absorb.test.js | `absorb_returns_no_op_when_current_equals_last_set` | scaffold |
| 7.4 | AC#1 | safety/anomaly-freeze.test.js | `freeze_emits_anomaly_freeze_atencao_audit_event` | scaffold |
| 7.4 | AC#2 | safety/anomaly-freeze.test.js | `accept_marks_original_anomaly_freeze_audit_row_resolved` | scaffold |
| 7.4 | AC#3 | safety/anomaly-freeze.test.js | `reject_preserves_list_price_unchanged` | scaffold |
| 7.4 | AC#4 | safety/anomaly-freeze.test.js | `accept_endpoint_returns_404_for_cross_customer_sku_channel` | scaffold |
| 7.5 | AC#1 | engine/tier-classify.test.js | `t2a_to_t2b_f1_atomic_write_tier_and_cadence_in_same_tx` | scaffold |
| 7.5 | AC#2 | engine/tier-classify.test.js | `f1_t2a_to_t2b_dispatcher_skips_row_at_45min_cadence` | scaffold |
| 7.6 | AC#1 | safety/circuit-breaker.test.js | `per_sku_cb_trips_at_16_pct_delta` | scaffold |
| 7.6 | AC#2 | safety/circuit-breaker.test.js | `per_cycle_cb_denominator_is_active_skus_not_total` | scaffold |
| 7.6 | AC#3 | safety/circuit-breaker.test.js | `manual_unblock_marks_original_circuit_breaker_trip_row_resolved` | scaffold |
| 7.7 | AC#1 | safety/reconciliation.test.js | `reconciliation_t3_no_competitors_silent_steady_state` | scaffold |
| 7.7 | AC#2 | safety/reconciliation.test.js | `reconciliation_detects_stale_last_checked_at_beyond_double_cadence` | scaffold |
| 7.8 | AC#1 | integration/full-cycle.test.js | 17 fixture parametrized assertions | scaffold |
| 7.8 | AC#3 | integration/pending-import-id-invariant.test.js | `all_participating_rows_have_pending_import_id_set_post_flush` | scaffold |
| 7.8 | AC#4 | integration/circuit-breaker-trip.test.js | `cb_trip_halts_before_pri01_flush` | scaffold |

**Total test cases at scaffold:** ~120
(32 money + 26 decide + 15 absorb + 18 freeze + 17 tier-classify + 17 circuit-breaker + 12 reconciliation + integration gates)

---

## Notes for Amelia (ATDD Step 2)

1. **Money module locale (AC#2 Story 7.1):** PT locale uses comma as decimal separator and
   € prefix with NO space (`€17,99` not `€ 17.99`). Use `Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })` or equivalent — verify output matches spec exactly.

2. **ESLint `no-float-price` namespace (AC#6 Story 7.1):** Follow the `local-cron/` prefix
   pattern from prior rules. Use `local-money/no-float-price`. Register in `eslint.config.js`
   under the `local-money` plugin namespace.

3. **P11 fixture preconditions (Story 7.2):** Each fixture JSON has a `_preconditions` block
   with the skuChannel state required for the test. Amelia must seed the test DB row to match
   these preconditions before calling `decideForSkuChannel`. The fixture's P11 response goes
   into the mock server; the `_preconditions.skuChannel` goes into the test DB.

4. **`decideForSkuChannel` stub calls (Story 7.2 AC#1):** STEP 2 (cooperative-absorb) and
   STEP 5 (circuit-breaker) are stub calls that pass through if Story 7.3/7.6 have not shipped.
   The test should mock these stubs with pass-through returns to isolate the engine logic.

5. **Tier-classify integration with engine (Story 7.5):** `applyTierClassification` is called
   from within `decideForSkuChannel` STEP 4 after position is determined. Tests for tier-classify
   can mock the engine or call it directly with a synthetic position result.

6. **F1 atomic write verification (AC#2 Story 7.5):** To verify the F1 invariant, the test
   must: (1) simulate a T2a row with `last_won_at = 5h ago`; (2) run engine; (3) assert the row
   has `tier = '2b'` AND `tier_cadence_minutes = 45` in the DB after the transaction commits;
   (4) assert that a dispatcher call at t+30min (< 45min elapsed) does NOT select this row.

7. **Circuit-breaker denominator query (AC#2 Story 7.6):** The F6 amendment specifies that the
   denominator is `SELECT COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $cm AND excluded_at IS NULL`. Use mock tx to capture this query and assert `excluded_at IS NULL` is present.

8. **Reconciliation cron timezone (AC#1 Story 7.7):** Lisbon is `Europe/Lisbon` (UTC+1 in winter,
   UTC+2 in summer WEST). The cron expression `0 0 * * *` should be paired with
   `{ timezone: 'Europe/Lisbon' }` in node-cron. Test by reading the file source.

9. **Story 7.8 full-cycle test setup:** The integration gate requires a real Postgres with
   the full schema (migrations up to and including Story 7.6). Seed script must create:
   - 1 customer + customer_profile
   - 1 customer_marketplace (cron_state='ACTIVE', own_shop_name='EasyStore')
   - 17 sku_channels (one per fixture, each with matching preconditions from the fixture JSON)
   Amelia may use the existing `tests/integration/_helpers/reset-auth-tables.js` pattern.

10. **`integration_test_required: true` for Story 7.4:** The accept/reject endpoints test RLS
    isolation (cross-customer 404). This requires a live Supabase with two seeded customers.
    Gate with `if (!process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL) { skip() }` pattern.
