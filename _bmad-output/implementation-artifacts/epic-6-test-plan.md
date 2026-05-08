# Epic 6 Test Plan — PRI01 Writer Plumbing

**Generated:** 2026-05-08
**Epic:** Epic 6 — PRI01 Writer Plumbing (Stories 6.1–6.3)
**Runner:** `node --test` (built-in; no Jest/Vitest per architecture constraint)
**Integration gate:** None of the Epic 6 stories are currently tagged `integration_test_required: true` (all three are pure module-level units; integration gate lives at Story 7.8).

---

## Overview

Epic 6 delivers the PRI01 write chain for Mirakl price imports: the CSV writer SSoT (Story 6.1),
the PRI02 import-status poller (Story 6.2), and the PRI03 error-report parser with per-SKU rebuild
semantics (Story 6.3). Together they complete the Bundle C writer half — the full atomicity gate
(engine + writer + cooperative-absorption + circuit-breaker on all 17 P11 fixtures) fires at
Story 7.8.

All three stories ship **unit tests only** at this stage. The integration-test gate at Story 7.8
will exercise the full cycle (engine STEP 1 → STEP 6 → writer → PRI02 COMPLETE) against the 17
P11 fixture scenarios.

### Stories

| Story | Title | Size | `integration_test_required` |
|-------|-------|------|-----------------------------|
| 6.1 | `shared/mirakl/pri01-writer.js` — CSV builder + multipart submit + `pending_import_id` atomicity + `no-raw-CSV-building` ESLint rule | L | no |
| 6.2 | `shared/mirakl/pri02-poller.js` + `worker/src/jobs/pri02-poll.js` cron entry + COMPLETE/FAILED handling | M | no |
| 6.3 | `shared/mirakl/pri03-parser.js` + per-SKU rebuild semantics | M | no |

### Atomicity Bundle C Context

Stories 6.1, 6.2, and 6.3 are three of eight stories in Atomicity Bundle C. All three are
`merge_block`-protected in `sprint-status.yaml` — none may merge to `main` until Story 7.8
(the integration-test gate) reaches `done`.

Key Bundle C invariants relevant to Epic 6:
- **Pending-import atomicity:** After a PRI01 batch is submitted, EVERY `sku_channel` row
  participating in the batch (including passthroughs) must have `pending_import_id` set to the
  same `import_uuid` in a single transaction. Zero-tolerance for partial-set state.
- **Skip-on-pending:** While `pending_import_id IS NOT NULL`, the dispatcher's WHERE clause and
  cooperative-absorption (Epic 7, AD9) both skip the row. This predicate is the correctness
  invariant that makes concurrent repricing safe.
- **PRI01 delete-and-replace:** Any `sku_channel` price that is NOT included in the submitted CSV
  is deleted by Mirakl. Therefore the writer MUST include passthrough lines for all channels of
  a SKU, even those whose price isn't changing.

---

## Story 6.1: `shared/mirakl/pri01-writer.js` — CSV builder + multipart submit + atomicity + `no-raw-CSV-building` ESLint rule

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| PRI01 writer | `shared/mirakl/pri01-writer.js` |
| ESLint rule | `eslint-rules/no-raw-CSV-building.js` |
| CSV fixture — single channel undercut | `tests/fixtures/pri01-csv/single-channel-undercut.csv` |
| CSV fixture — multi-channel passthrough | `tests/fixtures/pri01-csv/multi-channel-passthrough.csv` |
| CSV fixture — PRI03 recovery resubmit | `tests/fixtures/pri01-csv/pri03-recovery-resubmit.csv` |

### Test File

`tests/shared/mirakl/pri01-writer.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `build_pri01_csv_produces_correct_header_row` | CSV output begins with `offer-sku<DELIM>price<DELIM>channels` header row |
| AC#1 | `build_pri01_csv_uses_semicolon_delimiter_from_parameter` | `operatorCsvDelimiter = 'SEMICOLON'` → delimiter is `;` between columns |
| AC#1 | `build_pri01_csv_uses_comma_delimiter_from_parameter` | `operatorCsvDelimiter = 'COMMA'` → delimiter is `,` between columns |
| AC#1 | `build_pri01_csv_throws_on_null_delimiter` | Calling with `operatorCsvDelimiter = null` throws clear error (no silent fallback) |
| AC#1 | `build_pri01_csv_throws_on_undefined_delimiter` | Calling with `operatorCsvDelimiter = undefined` throws clear error |
| AC#1 | `build_pri01_csv_formats_price_with_offer_prices_decimals` | `offerPricesDecimals = 2`, price 1799 cents → `17.99` in output with ASCII period |
| AC#1 | `build_pri01_csv_throws_on_null_offer_prices_decimals` | Calling with `offerPricesDecimals = null` throws clear error |
| AC#1 | `build_pri01_csv_uses_shop_sku_not_product_sku` | `offer-sku` column value is `shop_sku` field (e.g., `EZ8809606851663`), NOT `product_sku` |
| AC#1 | `build_pri01_csv_includes_passthrough_lines_for_unchanged_channels` | 2-channel SKU where only PT changes: ES channel appears as passthrough at `last_set_price_cents` |
| AC#1 | `build_pri01_csv_channels_column_is_pipe_separated` | `channels` column uses pipe separator (e.g., `WRT_PT_ONLINE`) for Worten SINGLE mode |
| AC#1 | `build_pri01_csv_matches_single_channel_undercut_golden_fixture` | Byte-exact match against `tests/fixtures/pri01-csv/single-channel-undercut.csv` |
| AC#1 | `build_pri01_csv_matches_multi_channel_passthrough_golden_fixture` | Byte-exact match against `tests/fixtures/pri01-csv/multi-channel-passthrough.csv` |
| AC#1 | `build_pri01_csv_matches_pri03_recovery_resubmit_golden_fixture` | Byte-exact match against `tests/fixtures/pri01-csv/pri03-recovery-resubmit.csv` |
| AC#2 | `submit_price_import_posts_to_correct_endpoint` | Issues multipart POST to `<baseUrl>/api/offers/pricing/imports` |
| AC#2 | `submit_price_import_uses_raw_authorization_header_no_bearer` | `Authorization: <apiKey>` header sent — NO `Bearer` prefix |
| AC#2 | `submit_price_import_returns_import_id_on_success` | Returns `{importId: <uuid>}` on successful response |
| AC#2 | `submit_price_import_throws_mirakl_api_error_on_failure` | Throws `MiraklApiError` with `safeMessagePt` + `code` on non-2xx response |
| AC#2 | `submit_price_import_does_not_leak_api_key_in_error` | Error thrown does NOT include raw `apiKey` value in message, stack, or payload |
| AC#2 | `submit_price_import_retries_on_429` | Mock 429 response triggers retry; successful on retry 2 |
| AC#2 | `submit_price_import_retries_on_5xx` | Mock 500 response triggers retry with exponential backoff |
| AC#2 | `submit_price_import_does_not_retry_on_4xx` | Mock 400 response throws immediately without retry |
| AC#3 | `mark_staging_pending_sets_pending_import_id_on_all_channel_rows` | After call, ALL `sku_channel` rows for the cycle (changing + passthrough) have `pending_import_id` set |
| AC#3 | `mark_staging_pending_sets_pending_set_price_cents_on_changing_rows` | Changing-price rows: `pending_set_price_cents = staging.new_price_cents` |
| AC#3 | `mark_staging_pending_sets_last_set_price_for_passthrough_rows` | Passthrough rows: `pending_set_price_cents = last_set_price_cents` (no change in price value) |
| AC#3 | `mark_staging_pending_marks_flushed_at_on_staging_rows` | `pri01_staging.flushed_at = NOW()` set for all participating rows |
| AC#3 | `mark_staging_pending_sets_import_id_on_staging_rows` | `pri01_staging.import_id = importId` set for all participating rows |
| AC#3 | `mark_staging_pending_operates_in_single_transaction` | All writes (sku_channels + pri01_staging) use the same `tx` object (no partial-state risk) |
| AC#3 | `mark_staging_pending_no_cycle_row_left_without_pending_import_id` | After call, zero cycle rows have `pending_import_id IS NULL` (Bundle C invariant) |
| AC#4 | `eslint_no_raw_csv_building_fires_on_csv_stringify_usage` | ESLint rule reports error when `csv-stringify` is used outside `pri01-writer.js` |
| AC#4 | `eslint_no_raw_csv_building_fires_on_manual_csv_concatenation` | Rule fires on template-literal pattern with `;` + `\n` used for CSV-building |
| AC#4 | `eslint_no_raw_csv_building_does_not_fire_in_pri01_writer_js` | `shared/mirakl/pri01-writer.js` is in rule's allowlist — no false positive |
| AC#4 | `eslint_no_raw_csv_building_does_not_fire_on_csv_reading` | Reading `.csv` fixture files with `fs.readFileSync` does NOT trigger the rule |
| AC#5 | `build_pri01_csv_throws_on_null_operator_csv_delimiter_with_customer_id_in_message` | Error message includes `customer_marketplace <id>` reference and instructions to re-run PC01 |
| AC#5 | `build_pri01_csv_throws_on_null_offer_prices_decimals_with_customer_id_in_message` | Error message includes `customer_marketplace <id>` reference and instructions to re-run PC01 |

### Fixtures

- `tests/fixtures/pri01-csv/single-channel-undercut.csv` — Worten PT-only SKU, 1 channel, UNDERCUT decision, semicolon delimiter, 2 decimals, `shop_sku = "EZ8809606851663"`, price 17.99
- `tests/fixtures/pri01-csv/multi-channel-passthrough.csv` — Worten 2-channel SKU (PT + ES), PT channel undercut to 17.99, ES channel passthrough at 20.00; semicolon delimiter; 2 rows + header
- `tests/fixtures/pri01-csv/pri03-recovery-resubmit.csv` — Full SKU rebuild after PRI03 partial failure: both channels present, corrected prices; used in AC#1 golden-file test and by Story 6.3's rebuild tests

---

## Story 6.2: `shared/mirakl/pri02-poller.js` + `worker/src/jobs/pri02-poll.js` cron entry + COMPLETE/FAILED handling

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| PRI02 poller | `shared/mirakl/pri02-poller.js` |
| PRI02 cron entry | `worker/src/jobs/pri02-poll.js` |

### Test File

`tests/shared/mirakl/pri02-poller.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `pri02_poll_cron_is_registered_at_worker_boot` | `worker/src/index.js` imports `pri02-poll.js` and calls schedule/init within startup path |
| AC#1 | `pri02_poll_queries_distinct_pending_import_ids_cross_customer` | Poll job issues `SELECT DISTINCT pending_import_id, customer_marketplace_id FROM sku_channels WHERE pending_import_id IS NOT NULL` with `// safe: cross-customer cron` annotation |
| AC#2 | `poll_import_status_complete_clears_pending_import_id_for_all_rows` | On COMPLETE: `pending_import_id = NULL` for all `sku_channel` rows sharing that `import_id` |
| AC#2 | `poll_import_status_complete_sets_last_set_price_cents` | On COMPLETE: `last_set_price_cents = pending_set_price_cents` for all affected rows |
| AC#2 | `poll_import_status_complete_sets_last_set_at` | On COMPLETE: `last_set_at = NOW()` for all affected rows |
| AC#2 | `poll_import_status_complete_clears_pending_set_price_cents` | On COMPLETE: `pending_set_price_cents = NULL` for all affected rows |
| AC#2 | `poll_import_status_complete_emits_pri02_complete_audit_event` | On COMPLETE: `writeAuditEvent` called with `eventType = 'pri02-complete'` Rotina event |
| AC#2 | `poll_import_status_complete_operates_in_single_transaction` | All writes (last_set_price, pending_import_id=null) use same `tx` — Bundle C invariant |
| AC#2 | `poll_import_status_complete_rows_eligible_for_next_dispatcher_cycle` | After COMPLETE, zero rows for that import have `pending_import_id IS NOT NULL` |
| AC#3 | `poll_import_status_failed_clears_pending_import_id` | On FAILED: `pending_import_id = NULL` cleared for affected rows |
| AC#3 | `poll_import_status_failed_clears_pending_set_price_cents` | On FAILED: `pending_set_price_cents = NULL` cleared for affected rows |
| AC#3 | `poll_import_status_failed_invokes_pri03_parser` | On FAILED: `fetchAndParseErrorReport` (Story 6.3) called with `importId` |
| AC#3 | `poll_import_status_failed_clears_in_single_transaction` | `pending_import_id` clear + PRI03 invocation happen in same `tx` |
| AC#3 | `poll_import_status_failed_emits_pri02_failed_transient_event` | On FAILED: `writeAuditEvent` called with `eventType = 'pri02-failed-transient'` Rotina event |
| AC#3 | `poll_import_status_failed_three_consecutive_failures_emits_atencao` | After 3 consecutive failures for same SKU: `'pri01-fail-persistent'` Atenção event emitted |
| AC#4 | `poll_import_status_waiting_leaves_pending_import_id_set` | On WAITING: no writes; `pending_import_id` unchanged |
| AC#4 | `poll_import_status_running_leaves_pending_import_id_set` | On RUNNING: no writes; `pending_import_id` unchanged |
| AC#4 | `poll_import_status_stuck_waiting_30min_triggers_critical_alert` | Import pending > 30 minutes: Resend critical alert fired per FR46 + NFR-P5 |
| AC#5 | `pri02_poller_unit_test_file_covers_complete_path` | Test file contains at minimum: COMPLETE path, FAILED path, WAITING no-op, stuck-WAITING alert |
| AC#5 | `pending_import_id_invariant_between_set_and_clear` | While poller hasn't run COMPLETE: rows remain ineligible for dispatcher (pending_import_id IS NOT NULL) |

---

## Story 6.3: `shared/mirakl/pri03-parser.js` + per-SKU rebuild semantics

### SSoT Modules Introduced

| Module | Location |
|--------|----------|
| PRI03 error-report parser | `shared/mirakl/pri03-parser.js` |

### Test File

`tests/shared/mirakl/pri03-parser.test.js` (scaffold committed at Epic-Start)

### Behavioral Tests

| AC | Test name | Assertion |
|----|-----------|-----------|
| AC#1 | `fetch_and_parse_error_report_calls_correct_endpoint` | Fetches `GET <baseUrl>/api/offers/pricing/imports/<importId>/error_report` |
| AC#1 | `fetch_and_parse_error_report_parses_failed_skus_from_csv_response` | Returns `{failedSkus: [{shopSku, errorCode, errorMessage}, ...], successfulSkus: [...]}` |
| AC#1 | `fetch_and_parse_error_report_maps_line_numbers_to_shop_skus` | Line numbers in error CSV map back to the original PRI01 CSV's `offer-sku` rows via writer's line tracking |
| AC#1 | `fetch_and_parse_error_report_pt_localizes_error_messages` | Error messages from Mirakl are PT-localized via `getSafeErrorMessage` pattern (Story 3.1) |
| AC#2 | `schedule_rebuild_for_failed_skus_inserts_fresh_pri01_staging_rows` | For each failed SKU, inserts a new `pri01_staging` row with current SKU state (full rebuild, not just failed line) |
| AC#2 | `schedule_rebuild_does_not_use_failed_line_only_uses_full_sku` | Rebuild is per-SKU: ALL channels included in new staging row, not just failed line |
| AC#2 | `schedule_rebuild_does_not_modify_last_set_price_cents` | Failed import → price never applied → `last_set_price_cents` stays at pre-failure value |
| AC#2 | `schedule_rebuild_increments_pri01_consecutive_failures_counter` | `sku_channels.pri01_consecutive_failures` incremented by 1 for each failed rebuild |
| AC#2 | `schedule_rebuild_resets_failure_counter_on_pri02_complete` | When PRI02 returns COMPLETE, `pri01_consecutive_failures` reset to 0 |
| AC#2 | `schedule_rebuild_operates_in_single_transaction` | All writes (staging insert + counter increment) use same `tx` |
| AC#2 | `schedule_rebuild_three_strikes_escalation_freezes_sku` | After 3 consecutive failures: SKU frozen (per chosen freeze representation — option a or b from AC#4 design choice) |
| AC#2 | `schedule_rebuild_three_strikes_emits_pri01_fail_persistent_event` | After 3 consecutive failures: `writeAuditEvent` called with `eventType = 'pri01-fail-persistent'` Atenção |
| AC#2 | `schedule_rebuild_three_strikes_sends_critical_alert` | After 3 consecutive failures: Resend critical alert sent via `shared/resend/client.js` |
| AC#3 | `pri03_parser_unit_tests_cover_mixed_success_failure_report` | Test fixture includes both passing and failing SKUs in same error report; parser separates them correctly |
| AC#3 | `pri03_parser_matches_pri03_recovery_resubmit_golden_fixture` | Rebuild CSV output for a per-SKU rebuild matches `tests/fixtures/pri01-csv/pri03-recovery-resubmit.csv` byte-exact |
| AC#3 | `pri03_parser_failure_counter_increments_correctly_across_cycles` | Simulated 3-cycle failure sequence: counter 0→1→2→3; at 3, freeze + Atenção triggered |
| AC#4 | `frozen_reason_discriminator_chosen_and_documented` | Bob's Story 6.3 sharding doc explicitly picks option (a) discriminator column OR option (b) parallel boolean — no silent overload of existing `frozen_for_anomaly_review` column |
| AC#4 | `dispatcher_predicate_updated_for_chosen_freeze_representation` | Story 5.1's dispatcher SQL predicate updated to account for chosen freeze column(s) in this story's migration |
| AC#4 | `rls_regression_suite_extended_with_new_freeze_column` | `scripts/rls-regression-suite.js` extended for any new `sku_channels` column added by this migration |

---

## Cross-Cutting Concerns

### ESLint Rule: `no-raw-CSV-building`

The `no-raw-CSV-building` rule ships with Story 6.1 and applies to all code EXCEPT `shared/mirakl/pri01-writer.js`.
Key design constraints:

- Rule targets **CSV-writing patterns**, not CSV-reading (reading `.csv` fixture files must NOT be flagged).
- Heuristic detectors: template literals with `;\n` patterns; calls to `csv-stringify`, `papaparse`, or similar known CSV libs.
- Explicit allowlist entry for `shared/mirakl/pri01-writer.js`.
- Rule registered under `local-cron/` namespace in `eslint.config.js` (following `no-direct-fetch`, `no-raw-cron-state-update`, `worker-must-filter-by-customer` pattern).

### PRI01 Delete-and-Replace Semantic (Critical)

Every test that exercises `buildPri01Csv` with a multi-channel SKU MUST verify that untouched
channels appear as passthrough lines. Missing passthrough lines would cause Mirakl to delete the
channel's price on the next import — a data-loss scenario invisible to unit tests that only check
the "changed" rows.

Golden fixture `multi-channel-passthrough.csv` enforces this invariant at the byte level.

### Pending-import Atomicity (Bundle C Partial Invariant)

At Epic 6 stage, the Bundle C atomicity invariant is asserted at unit-test level:
- `mark_staging_pending_no_cycle_row_left_without_pending_import_id` in `pri01-writer.test.js`
- `pending_import_id_invariant_between_set_and_clear` in `pri02-poller.test.js`

The full integration-level atomicity assertion (real DB, all 17 P11 fixtures, engine + writer +
cooperative-absorption chain) lives at Story 7.8.

### Story 6.3 Design Choice: Freeze Representation (AD12)

Story 6.3 introduces a second per-SKU freeze reason (3-consecutive PRI01 failures). Bob must
explicitly choose during sharding:
- **Option (a):** Add `frozen_reason text` discriminator column, deprecate `frozen_for_anomaly_review` boolean.
- **Option (b):** Add `frozen_for_pri01_persistent boolean NOT NULL DEFAULT false` as a parallel column.

This choice must be documented in the story's PR description and reflected in:
- The Story 6.3 migration
- Dispatcher predicate (Story 5.1's SQL — update the WHERE clause)
- `scripts/rls-regression-suite.js` — new column(s) added to `CUSTOMER_SCOPED_TABLES`
- Architecture distillate `02-decisions-A-D.md` AD12 trailing note (update TBD block to chosen option)

Test `frozen_reason_discriminator_chosen_and_documented` enforces the design choice is documented
in the PR body (not just implemented).

### Negative Assertions

| Assertion | Test name | File |
|-----------|-----------|------|
| No hardcoded `;` as CSV delimiter — always reads from parameter | `build_pri01_csv_throws_on_null_delimiter` | pri01-writer.test.js |
| No `Bearer` prefix on Mirakl auth header | `submit_price_import_uses_raw_authorization_header_no_bearer` | pri01-writer.test.js |
| No raw `api_key` value in thrown errors | `submit_price_import_does_not_leak_api_key_in_error` | pri01-writer.test.js |
| No modification to `last_set_price_cents` on PRI01 failure | `schedule_rebuild_does_not_modify_last_set_price_cents` | pri03-parser.test.js |

### Integration Test Gate (Story 7.8)

Epic 6 stories do NOT carry `integration_test_required: true`. The full integration assertion
lives at Story 7.8 which exercises:
- Engine decisions → pri01_staging rows → PRI01 CSV writer → multipart POST → importId returned
- PRI02 poll: COMPLETE → last_set_price cleared → rows eligible for next cycle
- Cooperative-absorption: while `pending_import_id IS NOT NULL`, engine STEP 1 skips the row
- All 17 P11 fixtures from `tests/fixtures/p11/` (full scenario matrix)

---

## AC Coverage Map

| Story | AC | Test File | Test Name | Status |
|-------|----|-----------|-----------|--------|
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_produces_correct_header_row` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_uses_semicolon_delimiter_from_parameter` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_uses_comma_delimiter_from_parameter` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_throws_on_null_delimiter` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_throws_on_undefined_delimiter` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_formats_price_with_offer_prices_decimals` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_throws_on_null_offer_prices_decimals` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_uses_shop_sku_not_product_sku` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_includes_passthrough_lines_for_unchanged_channels` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_channels_column_is_pipe_separated` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_matches_single_channel_undercut_golden_fixture` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_matches_multi_channel_passthrough_golden_fixture` | scaffold |
| 6.1 | AC#1 | pri01-writer.test.js | `build_pri01_csv_matches_pri03_recovery_resubmit_golden_fixture` | scaffold |
| 6.1 | AC#2 | pri01-writer.test.js | `submit_price_import_posts_to_correct_endpoint` | scaffold |
| 6.1 | AC#2 | pri01-writer.test.js | `submit_price_import_uses_raw_authorization_header_no_bearer` | scaffold |
| 6.1 | AC#2 | pri01-writer.test.js | `submit_price_import_returns_import_id_on_success` | scaffold |
| 6.1 | AC#2 | pri01-writer.test.js | `submit_price_import_throws_mirakl_api_error_on_failure` | scaffold |
| 6.1 | AC#2 | pri01-writer.test.js | `submit_price_import_does_not_leak_api_key_in_error` | scaffold |
| 6.1 | AC#2 | pri01-writer.test.js | `submit_price_import_retries_on_429` | scaffold |
| 6.1 | AC#2 | pri01-writer.test.js | `submit_price_import_retries_on_5xx` | scaffold |
| 6.1 | AC#2 | pri01-writer.test.js | `submit_price_import_does_not_retry_on_4xx` | scaffold |
| 6.1 | AC#3 | pri01-writer.test.js | `mark_staging_pending_sets_pending_import_id_on_all_channel_rows` | scaffold |
| 6.1 | AC#3 | pri01-writer.test.js | `mark_staging_pending_sets_pending_set_price_cents_on_changing_rows` | scaffold |
| 6.1 | AC#3 | pri01-writer.test.js | `mark_staging_pending_sets_last_set_price_for_passthrough_rows` | scaffold |
| 6.1 | AC#3 | pri01-writer.test.js | `mark_staging_pending_marks_flushed_at_on_staging_rows` | scaffold |
| 6.1 | AC#3 | pri01-writer.test.js | `mark_staging_pending_sets_import_id_on_staging_rows` | scaffold |
| 6.1 | AC#3 | pri01-writer.test.js | `mark_staging_pending_operates_in_single_transaction` | scaffold |
| 6.1 | AC#3 | pri01-writer.test.js | `mark_staging_pending_no_cycle_row_left_without_pending_import_id` | scaffold |
| 6.1 | AC#4 | pri01-writer.test.js | `eslint_no_raw_csv_building_fires_on_csv_stringify_usage` | scaffold |
| 6.1 | AC#4 | pri01-writer.test.js | `eslint_no_raw_csv_building_fires_on_manual_csv_concatenation` | scaffold |
| 6.1 | AC#4 | pri01-writer.test.js | `eslint_no_raw_csv_building_does_not_fire_in_pri01_writer_js` | scaffold |
| 6.1 | AC#4 | pri01-writer.test.js | `eslint_no_raw_csv_building_does_not_fire_on_csv_reading` | scaffold |
| 6.1 | AC#5 | pri01-writer.test.js | `build_pri01_csv_throws_on_null_operator_csv_delimiter_with_customer_id_in_message` | scaffold |
| 6.1 | AC#5 | pri01-writer.test.js | `build_pri01_csv_throws_on_null_offer_prices_decimals_with_customer_id_in_message` | scaffold |
| 6.2 | AC#1 | pri02-poller.test.js | `pri02_poll_cron_is_registered_at_worker_boot` | scaffold |
| 6.2 | AC#1 | pri02-poller.test.js | `pri02_poll_queries_distinct_pending_import_ids_cross_customer` | scaffold |
| 6.2 | AC#2 | pri02-poller.test.js | `poll_import_status_complete_clears_pending_import_id_for_all_rows` | scaffold |
| 6.2 | AC#2 | pri02-poller.test.js | `poll_import_status_complete_sets_last_set_price_cents` | scaffold |
| 6.2 | AC#2 | pri02-poller.test.js | `poll_import_status_complete_sets_last_set_at` | scaffold |
| 6.2 | AC#2 | pri02-poller.test.js | `poll_import_status_complete_clears_pending_set_price_cents` | scaffold |
| 6.2 | AC#2 | pri02-poller.test.js | `poll_import_status_complete_emits_pri02_complete_audit_event` | scaffold |
| 6.2 | AC#2 | pri02-poller.test.js | `poll_import_status_complete_operates_in_single_transaction` | scaffold |
| 6.2 | AC#2 | pri02-poller.test.js | `poll_import_status_complete_rows_eligible_for_next_dispatcher_cycle` | scaffold |
| 6.2 | AC#3 | pri02-poller.test.js | `poll_import_status_failed_clears_pending_import_id` | scaffold |
| 6.2 | AC#3 | pri02-poller.test.js | `poll_import_status_failed_clears_pending_set_price_cents` | scaffold |
| 6.2 | AC#3 | pri02-poller.test.js | `poll_import_status_failed_invokes_pri03_parser` | scaffold |
| 6.2 | AC#3 | pri02-poller.test.js | `poll_import_status_failed_clears_in_single_transaction` | scaffold |
| 6.2 | AC#3 | pri02-poller.test.js | `poll_import_status_failed_emits_pri02_failed_transient_event` | scaffold |
| 6.2 | AC#3 | pri02-poller.test.js | `poll_import_status_failed_three_consecutive_failures_emits_atencao` | scaffold |
| 6.2 | AC#4 | pri02-poller.test.js | `poll_import_status_waiting_leaves_pending_import_id_set` | scaffold |
| 6.2 | AC#4 | pri02-poller.test.js | `poll_import_status_running_leaves_pending_import_id_set` | scaffold |
| 6.2 | AC#4 | pri02-poller.test.js | `poll_import_status_stuck_waiting_30min_triggers_critical_alert` | scaffold |
| 6.2 | AC#5 | pri02-poller.test.js | `pri02_poller_unit_test_file_covers_complete_path` | scaffold |
| 6.2 | AC#5 | pri02-poller.test.js | `pending_import_id_invariant_between_set_and_clear` | scaffold |
| 6.3 | AC#1 | pri03-parser.test.js | `fetch_and_parse_error_report_calls_correct_endpoint` | scaffold |
| 6.3 | AC#1 | pri03-parser.test.js | `fetch_and_parse_error_report_parses_failed_skus_from_csv_response` | scaffold |
| 6.3 | AC#1 | pri03-parser.test.js | `fetch_and_parse_error_report_maps_line_numbers_to_shop_skus` | scaffold |
| 6.3 | AC#1 | pri03-parser.test.js | `fetch_and_parse_error_report_pt_localizes_error_messages` | scaffold |
| 6.3 | AC#2 | pri03-parser.test.js | `schedule_rebuild_for_failed_skus_inserts_fresh_pri01_staging_rows` | scaffold |
| 6.3 | AC#2 | pri03-parser.test.js | `schedule_rebuild_does_not_use_failed_line_only_uses_full_sku` | scaffold |
| 6.3 | AC#2 | pri03-parser.test.js | `schedule_rebuild_does_not_modify_last_set_price_cents` | scaffold |
| 6.3 | AC#2 | pri03-parser.test.js | `schedule_rebuild_increments_pri01_consecutive_failures_counter` | scaffold |
| 6.3 | AC#2 | pri03-parser.test.js | `schedule_rebuild_resets_failure_counter_on_pri02_complete` | scaffold |
| 6.3 | AC#2 | pri03-parser.test.js | `schedule_rebuild_operates_in_single_transaction` | scaffold |
| 6.3 | AC#2 | pri03-parser.test.js | `schedule_rebuild_three_strikes_escalation_freezes_sku` | scaffold |
| 6.3 | AC#2 | pri03-parser.test.js | `schedule_rebuild_three_strikes_emits_pri01_fail_persistent_event` | scaffold |
| 6.3 | AC#2 | pri03-parser.test.js | `schedule_rebuild_three_strikes_sends_critical_alert` | scaffold |
| 6.3 | AC#3 | pri03-parser.test.js | `pri03_parser_unit_tests_cover_mixed_success_failure_report` | scaffold |
| 6.3 | AC#3 | pri03-parser.test.js | `pri03_parser_matches_pri03_recovery_resubmit_golden_fixture` | scaffold |
| 6.3 | AC#3 | pri03-parser.test.js | `pri03_parser_failure_counter_increments_correctly_across_cycles` | scaffold |
| 6.3 | AC#4 | pri03-parser.test.js | `frozen_reason_discriminator_chosen_and_documented` | scaffold |
| 6.3 | AC#4 | pri03-parser.test.js | `dispatcher_predicate_updated_for_chosen_freeze_representation` | scaffold |
| 6.3 | AC#4 | pri03-parser.test.js | `rls_regression_suite_extended_with_new_freeze_column` | scaffold |

**Total test cases at scaffold:** ~73 (35 unit for Story 6.1; 21 unit for Story 6.2; 17 unit for Story 6.3)

---

## Notes for Amelia (ATDD Step 2)

1. **Golden-file CSV fixtures (AC#1 Story 6.1)**: Create the three fixture files in
   `tests/fixtures/pri01-csv/` at ATDD time. Byte-exact content must reflect:
   - Semicolon delimiter (Worten empirical)
   - ASCII period decimal separator (provisional — `offer_prices_decimals = 2`)
   - Header row: `offer-sku;price;channels`
   - `single-channel-undercut.csv`: one body line, `EZ8809606851663;17.99;WRT_PT_ONLINE`
   - `multi-channel-passthrough.csv`: two body lines — PT updated at 17.99, ES passthrough at 20.00
   - `pri03-recovery-resubmit.csv`: two body lines (full SKU rebuild, both channels at corrected prices)

2. **ESLint programmatic API pattern (AC#4 Story 6.1)**: Follow the same pattern established
   in Story 5.1's `eslint_worker_must_filter_by_customer_fires_on_violation` test (write a temp
   fixture, use `new ESLint({ cwd: repoRoot })`, assert `ruleId === 'local-cron/no-raw-CSV-building'`).
   Clean up the fixture in `t.after()`.

3. **Mocking `fetch` for `submitPriceImport` (AC#2 Story 6.1)**: Use Node.js test runner's
   `mock.module()` or intercept at the `FormData` / `fetch` boundary. The function uses
   `fetch` directly (allowed in `shared/mirakl/` per the `no-direct-fetch` allowlist). Mock
   should capture the `Authorization` header to verify the no-Bearer-prefix assertion.

4. **`mark_staging_pending` mock tx (AC#3 Story 6.1)**: Use a mock `tx` object that records
   all `.query()` calls. Assert that both `sku_channels` and `pri01_staging` updates are issued
   against the same mock, not two separate clients (proves single-transaction semantics).

5. **PRI02 cron registration check (AC#1 Story 6.2)**: Same pattern as Story 5.1's
   `master_cron_file_registered_with_node_cron_at_worker_boot` — grep `worker/src/index.js`
   for `pri02-poll` import path, OR spawn worker briefly and check startup log.

6. **Mocking `writeAuditEvent` in poller tests (AC#2/AC#3 Story 6.2)**: The module is imported
   from `shared/audit/writer.js`. Use `mock.module()` to capture invocations without a live DB.
   Assert `eventType` and `priority` fields match the Rotina/Atenção taxonomy.

7. **`stuck-WAITING` timing test (AC#4 Story 6.2)**: Do NOT sleep 30 minutes. Instead, inject a
   `flushedAt` timestamp (mocked to `Date.now() - 31 * 60 * 1000`) into the staging row mock, and
   assert the alert is triggered when the poller compares it to `Date.now()`.

8. **PRI03 line-number-to-shopSku mapping (AC#1 Story 6.3)**: The writer must track which CSV
   line number corresponds to which `shop_sku` during `buildPri01Csv`. This means `buildPri01Csv`
   should return `{ csvBody: string, lineMap: {[lineNumber]: shopSku} }`. The ATDD tests for
   Story 6.1 should verify that `lineMap` is included in the return value (needed by Story 6.3's
   parser to look up which SKU failed on each error line).

9. **Failure counter column (AC#2 Story 6.3)**: Story 6.3 adds
   `pri01_consecutive_failures smallint NOT NULL DEFAULT 0` to `sku_channels` via its migration.
   The ATDD tests can verify this column exists via `information_schema.columns` if needed, or
   simply rely on the mock tx capturing the `UPDATE sku_channels SET pri01_consecutive_failures`
   query. If using the integration DB, gate with `if (process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL)`.

10. **Freeze representation design choice (AC#4 Story 6.3)**: Test
    `frozen_reason_discriminator_chosen_and_documented` is unusual — it's a process assertion,
    not a functional one. Implement it as a grep test on `git log --oneline -1 --format="%b"` for
    the story's PR body, OR as a simple grep on the story file for the string "frozen_reason" OR
    "frozen_for_pri01_persistent" (whichever option Bob chose). The goal is to prevent silent
    overloading of `frozen_for_anomaly_review`.
