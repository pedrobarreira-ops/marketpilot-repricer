# Epic 4 Test Plan — Customer Onboarding

**Generated:** 2026-05-06
**Epic:** Epic 4 — Customer Onboarding (Stories 4.1–4.9)
**Runner:** `node --test` (built-in; no Jest/Vitest per architecture constraint)
**Integration gate:** `npm run test:integration` (Stories 4.1, 4.3, 4.4 are `integration_test_required: true`)

---

## Overview

Epic 4 delivers the full customer onboarding funnel: API key entry with 5s inline validation,
encrypted key vault, async catalog scan (A01 → PC01 → OF21 → P11 → tier classify → baseline
snapshot), scan progress page with reconnect, scan-failed email + interception, scan-ready
interstitial, margin band picker with smart-default mapping, and the minimal dry-run dashboard
landing. Nine stories; two share an atomicity bundle (4.1 + 4.4).

### Stories

| Story | Title | Size | `integration_test_required` |
|-------|-------|------|-----------------------------|
| 4.1 | customer_marketplaces schema + cron_state machine + transitions matrix | L | yes |
| 4.2 | skus + sku_channels + baseline_snapshots + scan_jobs schemas + RLS | M | yes |
| 4.3 | Key entry form + 5s validation + encrypted persistence + guide modal | L | yes |
| 4.4 | Async catalog scan orchestration (atomicity sibling of 4.1) | L | yes |
| 4.5 | Scan progress page — closeable + reconnectable + status polling | M | no |
| 4.6 | Scan-failed email + `/scan-failed` interception | S | no |
| 4.7 | Scan-ready interstitial `/onboarding/scan-ready` | S | no |
| 4.8 | Margin question + smart-default mapping + <5% warning | M | no |
| 4.9 | Dashboard root in DRY_RUN — minimal landing only | S | no |

### Atomicity Bundle B

Stories 4.1 and 4.4 are atomicity-paired. The CHECK constraint (F4) in 4.1 blocks the
`PROVISIONING → DRY_RUN` transition until A01/PC01 columns are populated; 4.4 is the story
that populates them. Their integration test (`tests/integration/onboarding-scan.test.js`) runs
both halves against the Mirakl mock server to verify the full sequence end-to-end.

### RLS Regression Debt (from Epic 2 retro Item 6)

Story 4.1 MUST extend `db/seed/test/two-customers.sql` and the `CUSTOMER_SCOPED_TABLES`
registry in `tests/integration/rls-regression.test.js` with `customer_marketplaces`. The
placeholder test `rls_isolation_shop_api_key_vault_deferred_awaiting_epic4` in that file
must be replaced with a live row-level isolation test using real `customer_marketplaces`
FK targets.

---

## Story 4.1: customer_marketplaces schema + cron_state machine + transitions matrix

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| `transitionCronState({tx, customerMarketplaceId, from, to, context})` | `shared/state/cron-state.js` |
| `LEGAL_CRON_TRANSITIONS` | `shared/state/transitions-matrix.js` |
| Migration | `supabase/migrations/202604301203_create_customer_marketplaces.sql` |
| ESLint rule: `no-raw-cron-state-update` | `eslint-rules/no-raw-cron-state-update.js` |

### Test File

`tests/shared/state/cron-state.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `migration_creates_customer_marketplaces_table_with_full_schema` | Table exists; all columns + types per spec; cron_state enum has 8 UPPER_SNAKE_CASE values |
| AC#1 | `cron_state_enum_has_8_upper_snake_case_values` | PROVISIONING, DRY_RUN, ACTIVE, PAUSED_BY_CUSTOMER, PAUSED_BY_PAYMENT_FAILURE, PAUSED_BY_CIRCUIT_BREAKER, PAUSED_BY_KEY_REVOKED, PAUSED_BY_ACCOUNT_GRACE_PERIOD |
| AC#1 | `channel_pricing_mode_enum_has_3_values` | SINGLE, MULTI, DISABLED |
| AC#1 | `csv_delimiter_enum_has_2_values` | COMMA, SEMICOLON |
| AC#1 | `marketplace_operator_enum_has_1_value_worten` | Only 'WORTEN' at MVP |
| AC#2 | `f4_check_constraint_allows_provisioning_with_null_a01_pc01` | INSERT in PROVISIONING with all nullable columns NULL succeeds |
| AC#2 | `f4_check_constraint_blocks_dry_run_with_null_a01` | INSERT/UPDATE to DRY_RUN with any A01 column NULL fails CHECK |
| AC#2 | `f4_check_constraint_blocks_dry_run_with_null_pc01` | INSERT/UPDATE to DRY_RUN with any PC01 column NULL fails CHECK |
| AC#3 | `indexes_exist_per_spec` | idx_customer_marketplaces_customer_id, idx_customer_marketplaces_cron_state_active (partial), idx_customer_marketplaces_last_pc01_pulled_at all present |
| AC#3 | `unique_constraint_customer_id_operator_shop_id` | Duplicate (customer_id, operator, shop_id) tuple fails with 23505 |
| AC#4 | `rls_customer_a_cannot_read_customer_b_row` | SELECT via JWT-A returns 0 customer-B rows |
| AC#4 | `rls_customer_a_cannot_update_customer_b_row` | UPDATE via JWT-A updates 0 rows |
| AC#4 | `rls_customer_a_cannot_delete_customer_b_row` | DELETE via JWT-A deletes 0 rows |
| AC#4 | `rls_regression_suite_extended_with_customer_marketplaces` | CUSTOMER_SCOPED_TABLES registry includes customer_marketplaces entry |
| AC#5 | `transitions_matrix_exports_legal_cron_transitions_object` | LEGAL_CRON_TRANSITIONS is a plain JS object at module top-level |
| AC#5 | `transitions_matrix_contains_all_12_legal_pairs` | All 12 (from, to) pairs present per spec |
| AC#5 | `illegal_transition_pair_not_in_matrix` | e.g. PAUSED_BY_CIRCUIT_BREAKER → PAUSED_BY_CUSTOMER not in matrix |
| AC#6 | `transition_cron_state_issues_optimistic_update_and_succeeds` | Returns rows updated === 1; new cron_state visible in DB |
| AC#6 | `transition_cron_state_throws_concurrent_transition_error_on_stale_state` | 0 rows updated → ConcurrentTransitionError thrown |
| AC#6 | `transition_cron_state_throws_invalid_transition_error_before_db_write` | Illegal (from, to) → InvalidTransitionError; no DB write |
| AC#6 | `transition_emits_audit_event_for_mapped_transitions` | (ACTIVE, PAUSED_BY_CUSTOMER) → customer-paused event emitted in same tx |
| AC#6 | `transition_does_not_emit_audit_event_for_unmapped_transitions` | (PROVISIONING, DRY_RUN) → no audit event written |
| AC#7 | `unit_test_legal_transition_succeeds` | cron-state.test.js: mocked tx + transition succeeds |
| AC#7 | `unit_test_illegal_transition_throws_before_db` | cron-state.test.js: InvalidTransitionError, no SQL issued |
| AC#7 | `unit_test_concurrent_transition_throws` | cron-state.test.js: 0 rows → ConcurrentTransitionError |
| AC#8 | `negative_assertion_no_raw_cron_state_update_outside_ssot` | Grep: raw `UPDATE customer_marketplaces SET cron_state` only in `shared/state/cron-state.js` |
| AC#8 | `eslint_no_raw_cron_state_update_fires_on_violation` | ESLint rule reports error on fixture with raw SQL |

### Fixtures

`db/seed/test/two-customers.sql` must gain a `customer_marketplaces` row for each of the
two test customers (both in PROVISIONING with A01/PC01 NULL — satisfies F4 CHECK). This
seed row also unblocks the `shop_api_key_vault` isolation test deferred from Epic 2.

### Integration Test Gate

Stories 4.1 is tagged `integration_test_required: true`. Phase 4.5 halts before PR merge
until Pedro runs `npm run test:integration` locally and confirms pass.

---

## Story 4.2: skus + sku_channels + baseline_snapshots + scan_jobs schemas + RLS

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Migration: skus | `supabase/migrations/202604301205_create_skus.sql` |
| Migration: sku_channels | `supabase/migrations/202604301206_create_sku_channels.sql` |
| Migration: baseline_snapshots | `supabase/migrations/202604301207_create_baseline_snapshots.sql` |
| Migration: scan_jobs | `supabase/migrations/202604301211_create_scan_jobs.sql` |

### Test File

`tests/integration/rls-regression.test.js` (extended — not a new file)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `skus_table_exists_with_correct_schema` | id PK, customer_marketplace_id FK CASCADE, ean, shop_sku, product_sku, product_title, cost_cents (nullable), excluded_at (nullable), timestamps |
| AC#1 | `skus_unique_constraints` | (customer_marketplace_id, ean) + (customer_marketplace_id, shop_sku) both fail 23505 on dup |
| AC#2 | `sku_channels_table_exists_with_correct_schema` | tier_value enum ('1','2a','2b','3'); all columns per spec including pending_import_id, frozen_for_anomaly_review, last_won_at |
| AC#2 | `sku_channels_dispatcher_hot_path_index_exists` | idx_sku_channels_dispatch (partial: pending_import_id IS NULL AND frozen_for_anomaly_review = false AND excluded_at IS NULL) |
| AC#2 | `sku_channels_unique_constraint_sku_id_channel_code` | Duplicate (sku_id, channel_code) fails 23505 |
| AC#3 | `baseline_snapshots_table_exists_with_correct_schema` | id PK, sku_channel_id FK CASCADE, customer_marketplace_id FK CASCADE, list_price_cents, current_price_cents, captured_at |
| AC#4 | `scan_jobs_table_exists_with_correct_schema` | All columns + scan_job_status enum with 9 values per spec |
| AC#4 | `scan_jobs_exclude_constraint_one_active_scan_per_marketplace` | Two overlapping active scan_jobs rows for same customer_marketplace_id fail EXCLUDE constraint |
| AC#5 | `rls_isolation_skus_customer_a_cannot_read_customer_b` | 0 rows returned via JWT-A for customer-B sku rows |
| AC#5 | `rls_isolation_sku_channels_customer_a_cannot_read_customer_b` | 0 rows returned |
| AC#5 | `rls_isolation_baseline_snapshots_customer_a_cannot_read_customer_b` | 0 rows returned |
| AC#5 | `rls_isolation_scan_jobs_customer_a_cannot_read_customer_b` | 0 rows returned |
| AC#5 | `rls_regression_suite_extended_with_four_new_tables` | CUSTOMER_SCOPED_TABLES registry includes all four tables |

### Fixtures

`db/seed/test/two-customers.sql` extended with at least one row per new table per test customer.

### Integration Test Gate

Story 4.2 is tagged `integration_test_required: true`.

---

## Story 4.3: Key entry form + 5s validation + encrypted persistence + guide modal

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Route handler | `app/src/routes/onboarding/key.js` |
| Template: key form | `app/src/views/pages/onboarding-key.eta` |
| Template: guide modal | `app/src/views/modals/key-help.eta` |
| Component: trust block | `app/src/views/components/trust-block.eta` |

### Test File

`tests/integration/key-entry.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `get_onboarding_key_renders_form_for_provisioning_customer` | Authenticated customer in PROVISIONING sees key input + trust block + guide link |
| AC#2 | `trust_block_renders_pt_copy_and_lock_icon` | Trust block contains verbatim PT copy; lock icon present; "Ver as nossas garantias" link present |
| AC#3 | `valid_key_creates_vault_row_and_customer_marketplace_in_provisioning` | POST /onboarding/key/validate with valid key: vault row created (key encrypted), customer_marketplaces row in PROVISIONING, A01/PC01 columns NULL |
| AC#3 | `valid_key_redirects_to_onboarding_scan` | 302 → /onboarding/scan after successful validation |
| AC#3 | `valid_key_sets_last_validated_at_on_vault_row` | shop_api_key_vault.last_validated_at = NOW() |
| AC#3 | `invalid_key_401_returns_inline_pt_error_no_vault_row` | 401 from mock Worten: inline error rendered, no vault row created |
| AC#3 | `network_timeout_returns_inline_retry_cta` | 5s timeout: inline retry CTA visible |
| AC#3 | `cleartext_key_never_appears_in_pino_output` | pino log output does not contain the raw API key string |
| AC#3 | `no_audit_event_emitted_on_key_validated` | audit_log count unchanged after successful validation (KEY_VALIDATED not in AD20 taxonomy) |
| AC#5 | `guide_modal_renders_pt_walkthrough_content` | Modal contains 3-step walkthrough; keyboard Escape closes modal |
| AC#6 | `integration_test_valid_key_full_flow` | Full flow: vault row + customer_marketplace PROVISIONING + redirect to scan |
| AC#6 | `integration_test_invalid_key_no_side_effects` | 401 path: no vault row, no customer_marketplaces row |
| AC#6 | `integration_test_timeout_no_side_effects` | Timeout path: no vault row, no customer_marketplaces row |

### Fixtures

Requires a running Mirakl mock server (`tests/mocks/mirakl-server.js`) seeded to return 200
for the reference EAN P11 call (happy path) or 401 (invalid key path).

### Integration Test Gate

Story 4.3 is tagged `integration_test_required: true`.

---

## Story 4.4: Async catalog scan orchestration (atomicity sibling of Story 4.1)

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Scan job orchestrator | `worker/src/jobs/onboarding-scan.js` |
| Initial tier classifier | `worker/src/lib/tier-classify.js` |

### Test File

`tests/integration/onboarding-scan.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `scan_runs_9_phases_in_sequence_against_mock_server` | Mock server seeded with 200-SKU fixture; all 9 scan_jobs status transitions occur in order |
| AC#1 | `scan_persists_a01_columns_to_customer_marketplaces` | shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels[] populated |
| AC#1 | `scan_persists_pc01_columns_to_customer_marketplaces` | channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals, platform_features_snapshot populated |
| AC#1 | `scan_aborts_on_channel_pricing_mode_disabled` | DISABLED mode: scan_jobs → FAILED with PT-localized reason |
| AC#1 | `scan_populates_skus_and_sku_channels` | 200 skus rows + sku_channels per channel per SKU |
| AC#1 | `scan_populates_baseline_snapshots` | baseline_snapshots row per (SKU, channel) |
| AC#1 | `scan_applies_self_filter_to_p11_responses` | Own shop offers excluded from competitor P11 data |
| AC#1 | `scan_assigns_tier_cadence_minutes_per_ad10_defaults` | Tier 1 → 5 min, Tier 2a → 5 min, Tier 2b → 45 min, Tier 3 → (daily) |
| AC#1 | `scan_transitions_to_dry_run_on_complete` | transitionCronState(PROVISIONING → DRY_RUN) called; CHECK constraint passes because A01/PC01 populated |
| AC#2 | `scan_failure_persists_failed_status_and_failure_reason` | Any step throws: scan_jobs → FAILED, failure_reason set, customer_marketplace stays PROVISIONING |
| AC#2 | `scan_failure_sends_email_via_resend` | sendCriticalAlert called with scan-failed email content |
| AC#2 | `scan_idempotent_new_scan_allowed_after_failed` | EXCLUDE constraint allows new scan_jobs row once previous is FAILED |
| AC#3 | `status_endpoint_returns_correct_phase_message_per_status` | GET /onboarding/scan/status returns PT-localized phase_message per AD16 UX delta |
| AC#4 | `scan_200_skus_completes_within_60s_test_timeout` | Performance assertion on mock server |
| AC#5 | `cleartext_key_never_appears_in_pino_output` | Log output does not contain raw API key |
| AC#5 | `no_parallel_scan_job_can_be_created` | EXCLUDE constraint: second PENDING row for same customer_marketplace_id fails |
| AC#5 | `pri02_is_never_called_during_scan` | Mirakl mock server: zero calls to PRI02 endpoint |
| AC#5 | `f4_check_constraint_never_violated_during_scan` | No CHECK constraint violation logged at any scan phase |
| AC#5 | `atomicity_bundle_b_check_constraint_validates_after_scan` | After COMPLETE: DRY_RUN state + all A01/PC01 non-NULL verified |

### Fixtures

Mirakl mock server seeded with 200-SKU OF21 fixture + matching P11 fixtures (batched EAN
lookups). Uses `tests/mocks/mirakl-server.js` (shipped in Epic 3).

### Integration Test Gate

Story 4.4 is tagged `integration_test_required: true`.

---

## Story 4.5: Scan progress page — closeable + reconnectable + status polling

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Route handler | `app/src/routes/onboarding/scan.js` |
| Template | `app/src/views/pages/onboarding-scan.eta` |
| Client-side polling script | `public/js/scan-progress.js` |

### Test File

`tests/app/routes/onboarding/scan.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `get_scan_renders_5_phase_progress_for_in_flight_scan` | 5 phases visible in rendered HTML + shimmer bar |
| AC#1 | `status_endpoint_returns_json_with_all_fields` | {status, phase_message, skus_total, skus_processed, started_at, completed_at} |
| AC#1 | `status_endpoint_is_rls_aware_returns_only_own_scan` | Customer B cannot read customer A scan_jobs via status endpoint |
| AC#1 | `status_endpoint_rate_limited_5_req_per_sec` | 6th request within 1s returns 429 |
| AC#2 | `get_scan_reconnects_to_in_flight_scan_after_tab_close` | Re-GET /onboarding/scan with active scan: page renders showing current phase |
| AC#4 | `redirect_to_onboarding_key_if_no_key` | GET /onboarding/scan with no customer_marketplace row → 302 /onboarding/key |
| AC#4 | `redirect_to_scan_ready_if_complete` | GET /onboarding/scan with COMPLETE scan → 302 /onboarding/scan-ready |
| AC#4 | `redirect_to_scan_failed_if_failed` | GET /onboarding/scan with FAILED scan → 302 /scan-failed |
| AC#4 | `ux_dr2_forward_only_no_back_to_key_after_scan_started` | Cannot navigate back from /onboarding/scan to /onboarding/key once scan running |

---

## Story 4.6: Scan-failed email + `/scan-failed` interception

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Resend client SSoT | `shared/resend/client.js` (minimal — `sendCriticalAlert({to, subject, html})`) |
| Route handler | `app/src/routes/interceptions/scan-failed.js` |
| Template: page | `app/src/views/pages/scan-failed.eta` |
| Template: email | `app/src/views/emails/scan-failed.eta` |

### Test File

`tests/app/routes/interceptions/scan-failed.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `scan_failure_email_sent_within_5min` | sendCriticalAlert called with correct subject + PT-localized body + /onboarding/key link |
| AC#1 | `scan_failure_email_subject_is_correct_pt_string` | Subject === "A análise do teu catálogo MarketPilot não conseguiu completar" |
| AC#1 | `scan_failure_email_html_rendered_from_eta_template` | html body rendered from scan-failed.eta template |
| AC#2 | `scan_failed_page_renders_with_failure_reason_and_retry_button` | Page shows failure_reason + "Tentar novamente →" button to /onboarding/key |
| AC#2 | `scan_failed_interception_overrides_dashboard_for_failed_scan_customer` | UX-DR3: customer with FAILED scan who logs in lands on /scan-failed not / |
| AC#2 | `scan_failed_page_keyboard_accessible` | All interactive elements reachable via Tab; NFR-A2 |
| AC#3 | `healthy_scan_completion_sends_no_email` | COMPLETE transition: sendCriticalAlert NOT called |
| NFR | `resend_client_is_single_canonical_interface` | No `import ... from 'resend'` outside `shared/resend/client.js`; grep assertion |

---

## Story 4.7: Scan-ready interstitial `/onboarding/scan-ready`

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Route handler | `app/src/routes/onboarding/scan-ready.js` |
| Template | `app/src/views/pages/onboarding-scan-ready.eta` |

### Test File

`tests/app/routes/onboarding/scan-ready.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `scan_ready_renders_counts_from_db_not_placeholders` | X products, Y repricing-ready, Z Tier-3, W without-EAN — all from live queries |
| AC#1 | `scan_ready_shows_total_sku_count` | "X produtos encontrados no Worten" present |
| AC#1 | `scan_ready_shows_tier3_and_no_ean_counts` | Both Z and W counters present and correct |
| AC#2 | `por_que_disclosure_expands_with_verbatim_pt_copy` | Disclosure copy matches UX skeleton §8.3 verbatim |
| AC#3 | `continuar_button_redirects_to_onboarding_margin` | 302 → /onboarding/margin |
| AC#4 | `ux_dr2_forward_only_blocks_back_to_scan` | Customer with DRY_RUN: GET /onboarding/scan → 302 /onboarding/scan-ready |

---

## Story 4.8: Margin question + smart-default mapping + <5% warning

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Route handler | `app/src/routes/onboarding/margin.js` |
| Template | `app/src/views/pages/onboarding-margin.eta` |
| Component: thin-margin warning | `app/src/views/components/smart-default-warning-thin-margin.eta` |

### Test File

`tests/app/routes/onboarding/margin.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `margin_page_renders_4_radio_bands` | <5%, 5-10%, 10-15%, 15%+ all present; PT-localized |
| AC#2 | `selecting_under_5_pct_shows_warning_callout` | Warning callout with yellow border + 3 bulleted recommendations + "Compreendo" button |
| AC#2 | `under_5_pct_requires_acknowledge_before_submit` | Submit blocked until "Compreendo e continuo" clicked |
| AC#3 | `submit_under_5_pct_persists_0005_max_discount` | max_discount_pct = 0.005 in DB |
| AC#3 | `submit_5_10_pct_persists_001_max_discount` | max_discount_pct = 0.01 |
| AC#3 | `submit_10_15_pct_persists_002_max_discount` | max_discount_pct = 0.02 |
| AC#3 | `submit_15_plus_pct_persists_003_max_discount` | max_discount_pct = 0.03 |
| AC#3 | `submit_persists_005_max_increase_global_default` | max_increase_pct = 0.05 always |
| AC#3 | `submit_redirects_to_dashboard_root` | 302 → / |
| AC#4 | `ux_dr2_forward_only_blocks_revisit_after_margin_set` | GET /onboarding/margin with margin already set → 302 / |

---

## Story 4.9: Dashboard root in DRY_RUN — minimal landing only

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| Route handler (minimal stub) | `app/src/routes/dashboard/index.js` |
| Template | `app/src/views/pages/dashboard-dry-run-minimal.eta` |

### Test File

`tests/app/routes/dashboard/dry-run-minimal.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests (ATDD fills in at Step 2)

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `dry_run_banner_renders_with_pt_copy` | Blue banner + science icon + verbatim PT copy from UX skeleton §9.5 |
| AC#1 | `dry_run_page_has_no_go_live_button` | No "Go-Live" or equivalent CTA present (ships in Epic 8) |
| AC#1 | `dry_run_page_links_to_audit_log` | /audit link present |
| AC#2 | `provisioning_customer_redirected_to_onboarding_scan` | GET / for PROVISIONING customer → 302 /onboarding/scan |

---

## Cross-Cutting Atomicity Requirements

### Bundle B (F4 + Onboarding Scan)

Stories 4.1 and 4.4 ship as adjacent PRs (4.1 first, 4.4 second). Their shared integration
test `tests/integration/onboarding-scan.test.js` exercises the full PROVISIONING → DRY_RUN
transition after verifying the CHECK constraint accepts the transition only once all A01/PC01
columns are populated.

Key invariants asserted:
- No `customer_marketplaces` row ever reaches DRY_RUN with any A01/PC01 column NULL.
- The CHECK constraint fires correctly at DB level (not just application level).
- `scan_jobs` EXCLUDE constraint prevents parallel scans for the same marketplace.

### RLS Regression Extension (Epic 2 Retro Item 6 debt)

Story 4.1 MUST:
1. Add `customer_marketplaces` rows for both test customers to `db/seed/test/two-customers.sql`.
2. Add `customer_marketplaces` entry to `CUSTOMER_SCOPED_TABLES` in `tests/integration/rls-regression.test.js`.
3. Replace `rls_isolation_shop_api_key_vault_deferred_awaiting_epic4` placeholder with live test.

Story 4.2 MUST:
1. Extend the seed with rows for `skus`, `sku_channels`, `baseline_snapshots`, `scan_jobs`.
2. Add all four tables to `CUSTOMER_SCOPED_TABLES`.

---

## AC Coverage Map

| Story | AC | Test File | Test Name | Status |
|-------|----|-----------|-----------|--------|
| 4.1 | AC#1 | cron-state.test.js | migration_creates_customer_marketplaces_table_with_full_schema | scaffold |
| 4.1 | AC#1 | cron-state.test.js | cron_state_enum_has_8_upper_snake_case_values | scaffold |
| 4.1 | AC#1 | cron-state.test.js | channel_pricing_mode_enum_has_3_values | scaffold |
| 4.1 | AC#2 | cron-state.test.js | f4_check_constraint_allows_provisioning_with_null_a01_pc01 | scaffold |
| 4.1 | AC#2 | cron-state.test.js | f4_check_constraint_blocks_dry_run_with_null_a01 | scaffold |
| 4.1 | AC#3 | cron-state.test.js | indexes_exist_per_spec | scaffold |
| 4.1 | AC#4 | cron-state.test.js | rls_customer_a_cannot_read_customer_b_row | scaffold |
| 4.1 | AC#5 | cron-state.test.js | transitions_matrix_contains_all_12_legal_pairs | scaffold |
| 4.1 | AC#6 | cron-state.test.js | transition_cron_state_issues_optimistic_update_and_succeeds | scaffold |
| 4.1 | AC#6 | cron-state.test.js | transition_cron_state_throws_concurrent_transition_error_on_stale_state | scaffold |
| 4.1 | AC#6 | cron-state.test.js | transition_cron_state_throws_invalid_transition_error_before_db_write | scaffold |
| 4.1 | AC#6 | cron-state.test.js | transition_emits_audit_event_for_mapped_transitions | scaffold |
| 4.1 | AC#6 | cron-state.test.js | transition_does_not_emit_audit_event_for_unmapped_transitions | scaffold |
| 4.1 | AC#7 | cron-state.test.js | unit_test_legal_transition_succeeds | scaffold |
| 4.1 | AC#7 | cron-state.test.js | unit_test_illegal_transition_throws_before_db | scaffold |
| 4.1 | AC#7 | cron-state.test.js | unit_test_concurrent_transition_throws | scaffold |
| 4.1 | AC#8 | cron-state.test.js | negative_assertion_no_raw_cron_state_update_outside_ssot | scaffold |
| 4.2 | AC#1-5 | rls-regression.test.js (extended) | rls_isolation_{table}_* | scaffold |
| 4.3 | AC#1 | key-entry.test.js | get_onboarding_key_renders_form_for_provisioning_customer | scaffold |
| 4.3 | AC#2 | key-entry.test.js | trust_block_renders_pt_copy_and_lock_icon | scaffold |
| 4.3 | AC#3 | key-entry.test.js | valid_key_creates_vault_row_and_customer_marketplace_in_provisioning | scaffold |
| 4.3 | AC#3 | key-entry.test.js | invalid_key_401_returns_inline_pt_error_no_vault_row | scaffold |
| 4.3 | AC#3 | key-entry.test.js | cleartext_key_never_appears_in_pino_output | scaffold |
| 4.4 | AC#1 | onboarding-scan.test.js | scan_runs_9_phases_in_sequence_against_mock_server | scaffold |
| 4.4 | AC#1 | onboarding-scan.test.js | scan_transitions_to_dry_run_on_complete | scaffold |
| 4.4 | AC#2 | onboarding-scan.test.js | scan_failure_persists_failed_status_and_failure_reason | scaffold |
| 4.4 | AC#5 | onboarding-scan.test.js | atomicity_bundle_b_check_constraint_validates_after_scan | scaffold |
| 4.5 | AC#1 | scan.test.js | get_scan_renders_5_phase_progress_for_in_flight_scan | scaffold |
| 4.5 | AC#3 | scan.test.js | status_endpoint_rate_limited_5_req_per_sec | scaffold |
| 4.6 | AC#1 | scan-failed.test.js | scan_failure_email_subject_is_correct_pt_string | scaffold |
| 4.6 | AC#2 | scan-failed.test.js | scan_failed_interception_overrides_dashboard_for_failed_scan_customer | scaffold |
| 4.6 | AC#3 | scan-failed.test.js | healthy_scan_completion_sends_no_email | scaffold |
| 4.7 | AC#1 | scan-ready.test.js | scan_ready_renders_counts_from_db_not_placeholders | scaffold |
| 4.7 | AC#2 | scan-ready.test.js | por_que_disclosure_expands_with_verbatim_pt_copy | scaffold |
| 4.8 | AC#2 | margin.test.js | under_5_pct_requires_acknowledge_before_submit | scaffold |
| 4.8 | AC#3 | margin.test.js | submit_under_5_pct_persists_0005_max_discount | scaffold |
| 4.9 | AC#1 | dry-run-minimal.test.js | dry_run_banner_renders_with_pt_copy | scaffold |
| 4.9 | AC#2 | dry-run-minimal.test.js | provisioning_customer_redirected_to_onboarding_scan | scaffold |

**Total test cases at scaffold:** ~55 (27 for Stories 4.1 + 4.2 integration coverage, 16 for 4.3 + 4.4, 12 for 4.5–4.9)

---

## Notes for Amelia (ATDD Step 2)

1. **cron-state unit test isolation**: `transitionCronState` depends on `tx(client, cb)` from
   Story 2.1. Unit tests MUST mock the `tx` helper to avoid needing a live DB; integration
   tests use the real helper. Distinguish clearly in the test file header comments.

2. **F4 CHECK constraint test**: Insert a row in PROVISIONING with all nullable columns NULL
   (expected: success). Then UPDATE cron_state to DRY_RUN (expected: CHECK constraint
   violation `23514`). Verify the error SQLSTATE is `23514`, not caught silently.

3. **Mirakl mock server 200-SKU fixture**: Epic 3 shipped `tests/mocks/mirakl-server.js`.
   Story 4.4's integration test needs the mock seeded with a 200-SKU OF21 response + P11
   batch responses. Add a `fixtures/of21/mock-200-skus.json` and corresponding P11 fixtures,
   or generate them programmatically in the test setup.

4. **sendCriticalAlert stub**: Story 4.6 tests should stub `shared/resend/client.js`'s
   `sendCriticalAlert` to capture calls without hitting Resend API. Use Node.js test
   `mock.module()` or a test double injected via dependency injection.

5. **Resend single-interface negative assertion**: grep `tests/shared/mirakl/` and all
   `app/src/`, `worker/src/`, `shared/` for `import.*from.*resend` — should only match
   `shared/resend/client.js`. This guards the SSoT contract that no story bypasses the
   `sendCriticalAlert` interface.

6. **Rate-limit test in Story 4.5**: `@fastify/rate-limit` with 5 req/sec requires
   time-windowed requests. In Node test runner, fire 6 requests with `Promise.all` within
   a single event loop turn; assert the 6th returns 429.

7. **UX copy verbatim assertions**: UX-DR6, §8.3 (porquê? disclosure), §9.5 (DRY_RUN banner)
   all require verbatim PT copy. Encode the expected strings as constants at the top of each
   test file so they're easy to update if copy changes and easy to diff in PR review.

8. **tier_cadence_minutes defaults**: AD10 tier defaults — Tier 1: 5, Tier 2a: 5, Tier 2b: 45,
   Tier 3: 1440 (daily = 24*60). Assert each default in `scan_assigns_tier_cadence_minutes_per_ad10_defaults`.
