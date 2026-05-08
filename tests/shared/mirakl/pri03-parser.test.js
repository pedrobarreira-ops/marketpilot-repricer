// tests/shared/mirakl/pri03-parser.test.js
// Epic 6 Test Plan — Story 6.3 scaffold (epic-start-test-design 2026-05-08)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage:
//   AC#1 — fetchAndParseErrorReport: correct endpoint, CSV parsing, line→shopSku mapping, PT localization
//   AC#2 — scheduleRebuildForFailedSkus: full-SKU rebuild, last_set_price invariant, failure counter,
//           3-strike escalation (freeze + Atenção event + critical alert)
//   AC#3 — Unit tests cover mixed success/failure report; golden-fixture match; failure counter 3-cycle sequence
//   AC#4 — Freeze representation design choice: documented + dispatcher predicate updated + RLS extended

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');
const fixturesDir = join(repoRoot, 'tests/fixtures/pri01-csv');

// ---------------------------------------------------------------------------
// Import the module under test (will be provided by Amelia in ATDD step)
// ---------------------------------------------------------------------------
// import { fetchAndParseErrorReport, scheduleRebuildForFailedSkus } from '../../../shared/mirakl/pri03-parser.js';

// ---------------------------------------------------------------------------
// AC#1 — fetchAndParseErrorReport
// ---------------------------------------------------------------------------

describe('fetchAndParseErrorReport', () => {
  it('fetch_and_parse_error_report_calls_correct_endpoint', () => {
    // TODO (Amelia): mock fetch; call fetchAndParseErrorReport(baseUrl, apiKey, importId);
    //   assert URL = '<baseUrl>/api/offers/pricing/imports/<importId>/error_report'
    //   and method = 'GET'
    assert.ok(true, 'scaffold');
  });

  it('fetch_and_parse_error_report_parses_failed_skus_from_csv_response', () => {
    // TODO (Amelia): mock fetch returning a CSV response with line_number + error_reason columns;
    //   assert return value = { failedSkus: [{shopSku, errorCode, errorMessage}, ...], successfulSkus: [...] }
    //   Both failedSkus and successfulSkus arrays must be present
    assert.ok(true, 'scaffold');
  });

  it('fetch_and_parse_error_report_maps_line_numbers_to_shop_skus', () => {
    // TODO (Amelia): the parser must receive the lineMap produced by buildPri01Csv (Story 6.1 AC#1);
    //   assert that line 2 in the error report maps back to the correct shopSku in the original CSV
    //   (line 1 = header; line 2 = first body row)
    assert.ok(true, 'scaffold');
  });

  it('fetch_and_parse_error_report_pt_localizes_error_messages', () => {
    // TODO (Amelia): mock fetch returning error_reason = 'SKU not found in catalog';
    //   assert errorMessage in return value is PT-localized via getSafeErrorMessage pattern (Story 3.1)
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#2 — scheduleRebuildForFailedSkus
// ---------------------------------------------------------------------------

describe('scheduleRebuildForFailedSkus', () => {
  // Helper: mock tx that records all .query() calls
  function makeMockTx() {
    const calls = [];
    return {
      calls,
      query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; },
    };
  }

  it('schedule_rebuild_for_failed_skus_inserts_fresh_pri01_staging_rows', () => {
    // TODO (Amelia): call scheduleRebuildForFailedSkus({ tx, customerMarketplaceId, failedSkus, cycleId });
    //   for each failed SKU, assert tx.query called with INSERT INTO pri01_staging ...
    //   with the SKU's current state (full SKU rebuild — both channels if 2-channel SKU)
    assert.ok(true, 'scaffold');
  });

  it('schedule_rebuild_does_not_use_failed_line_only_uses_full_sku', () => {
    // TODO (Amelia): 2-channel SKU where only PT line failed; assert rebuild inserts BOTH PT and ES channels
    //   (per-SKU resubmit semantic from AD7 — NOT just the failed line)
    assert.ok(true, 'scaffold');
  });

  it('schedule_rebuild_does_not_modify_last_set_price_cents', () => {
    // TODO (Amelia): FAILED import means prices were never applied;
    //   assert NO UPDATE sku_channels SET last_set_price_cents in tx.calls
    //   (last_set_price_cents stays at pre-failure value — critical price-state correctness invariant)
    assert.ok(true, 'scaffold');
  });

  it('schedule_rebuild_increments_pri01_consecutive_failures_counter', () => {
    // TODO (Amelia): assert tx.query includes UPDATE sku_channels SET pri01_consecutive_failures = pri01_consecutive_failures + 1
    //   WHERE sku_id = ... (or equivalent parameterized form)
    assert.ok(true, 'scaffold');
  });

  it('schedule_rebuild_resets_failure_counter_on_pri02_complete', () => {
    // TODO (Amelia): simulate COMPLETE path in pri02-poller (or test via a shared helper);
    //   assert pri01_consecutive_failures reset to 0 on COMPLETE
    //   (can be tested here with a mock clearPendingImport call, or cross-reference pri02-poller.test.js)
    assert.ok(true, 'scaffold');
  });

  it('schedule_rebuild_operates_in_single_transaction', () => {
    // TODO (Amelia): assert ALL writes (staging INSERT + failure counter UPDATE) use same mock tx
    assert.ok(true, 'scaffold');
  });

  it('schedule_rebuild_three_strikes_escalation_freezes_sku', () => {
    // TODO (Amelia): mock failure counter at 2; call scheduleRebuildForFailedSkus (increment to 3);
    //   assert tx.query includes UPDATE sku_channels SET <frozen_column> = true/value
    //   where <frozen_column> is the chosen freeze representation (option a or b from AC#4)
    //   The specific column name is determined by Bob during Story 6.3 sharding
    assert.ok(true, 'scaffold');
  });

  it('schedule_rebuild_three_strikes_emits_pri01_fail_persistent_event', () => {
    // TODO (Amelia): mock writeAuditEvent (from shared/audit/writer.js);
    //   at 3-strike escalation, assert writeAuditEvent called with eventType = 'pri01-fail-persistent'
    //   and Atenção priority
    assert.ok(true, 'scaffold');
  });

  it('schedule_rebuild_three_strikes_sends_critical_alert', () => {
    // TODO (Amelia): mock sendCriticalAlert (from shared/resend/client.js);
    //   at 3-strike escalation, assert sendCriticalAlert called for the affected customer
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#3 — Mixed success/failure fixture + golden-file + failure counter sequence
// ---------------------------------------------------------------------------

describe('PRI03 parser integration scenarios', () => {
  it('pri03_parser_unit_tests_cover_mixed_success_failure_report', () => {
    // TODO (Amelia): create a mock error-report CSV with 3 lines: 2 failed, 1 success;
    //   call fetchAndParseErrorReport with mock fetch returning this CSV;
    //   assert failedSkus.length = 2, successfulSkus.length = 1
    assert.ok(true, 'scaffold');
  });

  it('pri03_parser_matches_pri03_recovery_resubmit_golden_fixture', () => {
    // TODO (Amelia): call scheduleRebuildForFailedSkus for the failing SKU from the mixed report;
    //   then call buildPri01Csv (Story 6.1) to produce the resubmit CSV;
    //   assert output === readFileSync(join(fixturesDir, 'pri03-recovery-resubmit.csv'), 'utf-8') byte-exact
    assert.ok(true, 'scaffold');
  });

  it('pri03_parser_failure_counter_increments_correctly_across_cycles', () => {
    // TODO (Amelia): simulate 3 FAILED cycles for same SKU:
    //   Cycle 1: counter 0 → assert 1 after rebuild
    //   Cycle 2: counter 1 → assert 2 after rebuild
    //   Cycle 3: counter 2 → assert 3 after rebuild, assert freeze triggered, assert Atenção emitted
    //   Uses mock tx in each iteration; counter state carried via the mock's returned row
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Freeze representation design choice (AD12)
// ---------------------------------------------------------------------------

describe('Freeze representation design choice (AD12)', () => {
  it('frozen_reason_discriminator_chosen_and_documented', () => {
    // TODO (Amelia): assert that the Story 6.3 migration file (supabase/migrations/) contains EITHER:
    //   (a) a 'frozen_reason' column definition (option a: enum discriminator), OR
    //   (b) a 'frozen_for_pri01_persistent' column definition (option b: parallel boolean)
    //   AND that the column does NOT simply reuse 'frozen_for_anomaly_review' (silent overload forbidden)
    //
    // Implementation note: grep supabase/migrations/<story-6-3-migration-file>.sql for one of the two
    // expected column names. If neither is found, the test fails — forcing Bob's design choice to be
    // materialized in code.
    assert.ok(true, 'scaffold');
  });

  it('dispatcher_predicate_updated_for_chosen_freeze_representation', () => {
    // TODO (Amelia): read worker/src/dispatcher.js (Story 5.1 SSoT);
    //   assert the dispatcher SQL WHERE clause includes a predicate for the new freeze column
    //   chosen in Story 6.3 (either 'frozen_reason IS NULL' for option a, or
    //   'frozen_for_pri01_persistent = false' for option b)
    assert.ok(true, 'scaffold');
  });

  it('rls_regression_suite_extended_with_new_freeze_column', () => {
    // TODO (Amelia): read scripts/rls-regression-suite.js;
    //   assert CUSTOMER_SCOPED_TABLES or equivalent registry includes coverage for the new
    //   sku_channels column added by Story 6.3's migration
    assert.ok(true, 'scaffold');
  });
});
