// Story 4.4 / AC#5 — Async catalog scan orchestration integration test.
// Atomicity Bundle B sibling of Story 4.1.
//
// Covers:
//   AC#1 — Full 9-phase scan sequence against Mirakl mock server seeded with 200-SKU fixture:
//           PENDING → RUNNING_A01 → RUNNING_PC01 → RUNNING_OF21 → RUNNING_P11 →
//           CLASSIFYING_TIERS → SNAPSHOTTING_BASELINE → COMPLETE
//           A01/PC01 columns populated; skus/sku_channels/baseline_snapshots rows created
//           Tier cadence_minutes defaults per AD10; self-filter applied to P11 responses
//           PROVISIONING → DRY_RUN transition via transitionCronState
//   AC#2 — Failure path: any step throws → FAILED + failure_reason + email + PROVISIONING stays
//           Idempotent: new scan_jobs row allowed once previous is FAILED
//   AC#3 — Status endpoint returns PT-localized phase_message per AD16 UX delta
//   AC#4 — 200-SKU scan completes within 60s test timeout (mock server, not live)
//   AC#5 — Atomicity Bundle B invariants:
//           - cleartext key never in pino output
//           - no parallel scan_jobs row possible (EXCLUDE constraint)
//           - PRI02 never called during scan (read-only operation)
//           - F4 CHECK constraint never violated during scan
//           - DRY_RUN + all A01/PC01 non-NULL after COMPLETE
//
// Local-only: requires `.env.test` pointing at a local Supabase docker.
// Mirakl mock server from tests/mocks/mirakl-server.js must be seeded with
// 200-SKU OF21 fixture + batched P11 responses.
//
// Run with: node --env-file=.env.test --test tests/integration/onboarding-scan.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const WORKER_BASE = process.env.WORKER_BASE_URL ?? 'http://localhost:3001';

test('onboarding-scan integration', async (t) => {
  // ---------------------------------------------------------------------------
  // AC#1 — Full 9-phase scan sequence
  // ---------------------------------------------------------------------------

  await t.test('scan_runs_9_phases_in_sequence_against_mock_server', async () => {
    // TODO (ATDD Step 2):
    // 1. Seed mock Mirakl server with 200-SKU OF21 fixture + P11 batch responses
    // 2. Create customer with PROVISIONING marketplace row + vault row
    // 3. Trigger onboarding-scan.js (via worker invocation or test hook)
    // 4. Poll scan_jobs.status until COMPLETE (with 60s timeout)
    // 5. Assert all 9 status transitions observed in order:
    //    PENDING → RUNNING_A01 → RUNNING_PC01 → RUNNING_OF21 → RUNNING_P11 →
    //    CLASSIFYING_TIERS → SNAPSHOTTING_BASELINE → COMPLETE
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_persists_a01_columns_to_customer_marketplaces', async () => {
    // TODO (ATDD Step 2):
    // After COMPLETE: assert customer_marketplaces has non-NULL:
    //   shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels[]
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_persists_pc01_columns_to_customer_marketplaces', async () => {
    // TODO (ATDD Step 2):
    // After COMPLETE: assert customer_marketplaces has non-NULL:
    //   channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals,
    //   platform_features_snapshot, last_pc01_pulled_at
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_aborts_on_channel_pricing_mode_disabled', async () => {
    // TODO (ATDD Step 2):
    // Seed mock PC01 response with channel_pricing_mode = DISABLED
    // Assert scan_jobs → FAILED with PT-localized failure_reason
    // Assert customer_marketplaces stays in PROVISIONING
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_populates_skus_and_sku_channels', async () => {
    // TODO (ATDD Step 2):
    // After COMPLETE: assert COUNT(skus) == 200 for this customer
    // Assert sku_channels rows exist per (sku, channel) per offer
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_populates_baseline_snapshots', async () => {
    // TODO (ATDD Step 2):
    // After COMPLETE: assert baseline_snapshots rows match sku_channels count
    // Assert captured_at is set; list_price_cents + current_price_cents non-NULL
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_applies_self_filter_to_p11_responses', async () => {
    // TODO (ATDD Step 2):
    // Seed P11 fixture with own shop_name among competitors
    // After scan: assert own shop is NOT stored as a competitor price reference
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_assigns_tier_cadence_minutes_per_ad10_defaults', async () => {
    // TODO (ATDD Step 2):
    // After COMPLETE: assert sku_channels rows have tier_cadence_minutes:
    //   tier '1' → 5, tier '2a' → 5, tier '2b' → 45, tier '3' → 1440
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_transitions_to_dry_run_on_complete', async () => {
    // TODO (ATDD Step 2):
    // After COMPLETE: assert customer_marketplaces.cron_state = 'DRY_RUN'
    // Assert all A01 + PC01 columns non-NULL (CHECK constraint passed)
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#2 — Failure paths
  // ---------------------------------------------------------------------------

  await t.test('scan_failure_persists_failed_status_and_failure_reason', async () => {
    // TODO (ATDD Step 2):
    // Seed mock to throw on RUNNING_OF21 step
    // Assert scan_jobs → FAILED; failure_reason non-NULL
    // Assert customer_marketplaces stays in PROVISIONING
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_failure_sends_email_via_resend', async () => {
    // TODO (ATDD Step 2):
    // Stub sendCriticalAlert; assert called once with expected subject + body
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_idempotent_new_scan_allowed_after_failed', async () => {
    // TODO (ATDD Step 2):
    // After FAILED scan_jobs row: INSERT new PENDING row → should succeed (EXCLUDE allows it)
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#3 — Status endpoint
  // ---------------------------------------------------------------------------

  await t.test('status_endpoint_returns_correct_phase_message_per_status', async () => {
    // TODO (ATDD Step 2):
    // Poll GET /onboarding/scan/status at each phase; assert phase_message is PT-localized
    // Expected messages per AD16 UX delta:
    //   RUNNING_A01/PC01 → "A configurar integração com Worten"
    //   RUNNING_OF21     → "A obter catálogo"
    //   RUNNING_P11      → "A snapshotar baselines"
    //   CLASSIFYING      → "A classificar tiers iniciais"
    //   COMPLETE         → "Pronto"
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#4 — Performance
  // ---------------------------------------------------------------------------

  await t.test('scan_200_skus_completes_within_60s_test_timeout', async () => {
    // TODO (ATDD Step 2):
    // Time the full scan against mock server; assert elapsed < 60000ms
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#5 — Atomicity Bundle B invariants
  // ---------------------------------------------------------------------------

  await t.test('cleartext_key_never_appears_in_pino_output', async () => {
    // TODO (ATDD Step 2):
    // Capture pino output during scan; assert raw key string not present in any log line
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('no_parallel_scan_job_can_be_created', async () => {
    // TODO (ATDD Step 2):
    // INSERT second PENDING scan_jobs row for same customer_marketplace_id while one is active
    // Expect: EXCLUDE constraint violation (Postgres error)
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('pri02_is_never_called_during_scan', async () => {
    // TODO (ATDD Step 2):
    // Instrument Mirakl mock server to record all request paths
    // After scan COMPLETE: assert no request to PRI02 endpoint pattern
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('f4_check_constraint_never_violated_during_scan', async () => {
    // TODO (ATDD Step 2):
    // Monitor for Postgres CHECK constraint errors (SQLSTATE 23514) during scan
    // Assert zero such errors occurred
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('atomicity_bundle_b_check_constraint_validates_after_scan', async () => {
    // TODO (ATDD Step 2):
    // After COMPLETE: SELECT customer_marketplaces; assert cron_state = 'DRY_RUN'
    // Assert all A01 + PC01 + last_pc01_pulled_at columns non-NULL
    // (Verifies F4 CHECK constraint semantics: DRY_RUN only reachable with full A01/PC01)
    assert.fail('ATDD stub — implement at Step 2');
  });
});
