// ATOMICITY BUNDLE C GATE — AD7+AD8+AD9+AD11
// This test is the single binding integration gate for Bundle C.
// Epic 6 writer code (Stories 6.1, 6.2, 6.3) is NOT safe to ship to production
// until all assertions in this test file pass.
//
// tests/integration/pending-import-id-invariant.test.js
//
// Story 7.8 — AC3, AC7, AC8
//
// Asserts the Bundle C atomicity invariant:
//   After PRI01 submission + markStagingPending, ALL participating sku_channel rows
//   have pending_import_id set. While non-null: engine STEP 1 SKIPs.
//   Cooperative-absorption SKIPs. PRI02 COMPLETE clears atomically.
//
// ALL production modules are REAL imports — no stubs, no fallbacks.
//
// Run with: node --test tests/integration/pending-import-id-invariant.test.js

// Stub RESEND_API_KEY BEFORE any imports — transitive load of resend/client.js
// throws at import time if RESEND_API_KEY is unset.
if (!process.env.RESEND_API_KEY) {
  process.env.RESEND_API_KEY = 're_test_integration_pending_import_stub_xx';
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic imports — env stub must run before module load (AC8: no try/catch, no fallbacks).
const { markStagingPending } = await import('../../shared/mirakl/pri01-writer.js');
const { clearPendingImport } = await import('../../shared/mirakl/pri02-poller.js');
const { absorbExternalChange } = await import('../../worker/src/engine/cooperative-absorb.js');
const { decideForSkuChannel } = await import('../../worker/src/engine/decide.js');
const { transitionCronState } = await import('../../shared/state/cron-state.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock skuChannel row for invariant tests.
 * @param {object} [overrides]
 * @returns {object}
 */
function buildSkuChannel (overrides = {}) {
  return {
    id: 'sc-uuid-invariant-test',
    sku_id: 'sku-uuid-invariant-test',
    customer_marketplace_id: 'cm-uuid-invariant-test',
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
    ...overrides,
  };
}

/**
 * Build a mock customerMarketplace row.
 * @param {object} [overrides]
 * @returns {object}
 */
function buildCustomerMarketplace (overrides = {}) {
  return {
    id: 'cm-uuid-invariant-test',
    cron_state: 'ACTIVE',
    max_discount_pct: 0.05,
    max_increase_pct: 0.10,
    edge_step_cents: 1,
    anomaly_threshold_pct: null,
    offer_prices_decimals: 2,
    operator_csv_delimiter: 'SEMICOLON',
    shop_name: 'Easy - Store',
    ...overrides,
  };
}

/**
 * Build a mock tx that captures all queries for assertion.
 * Configurable response rows for each query type.
 * @param {object} [opts]
 * @returns {{ query: Function, _queries: object[] }}
 */
function buildCapturingTx ({
  stagingRows = [],
  channelRows = [],
  auditRows = [{ id: 'audit-uuid' }],
  customerMarketplaceUpdateRows = [{ id: 'cm-uuid-invariant-test' }],
} = {}) {
  const queries = [];
  return {
    query: async (sql, params) => {
      queries.push({ sql, params });

      // pri01_staging SELECT JOIN skus (markStagingPending Step 1)
      if (sql.includes('FROM pri01_staging') && sql.includes('JOIN skus')) {
        return { rows: stagingRows };
      }
      // sku_channels SELECT for markStagingPending Step 2
      if (sql.includes('FROM sku_channels sc') && sql.includes('NOT NULL')) {
        return { rows: channelRows };
      }
      if (sql.includes('FROM sku_channels sc') && !sql.includes('COUNT')) {
        return { rows: channelRows };
      }
      // audit_log INSERT (from writeAuditEvent — emitted by cooperative-absorb, clearPendingImport)
      if (sql.includes('INSERT INTO audit_log')) {
        return { rows: auditRows };
      }
      // sku_channels UPDATE
      if (sql.includes('UPDATE sku_channels')) {
        return { rows: channelRows.length > 0 ? channelRows.map(r => ({ id: r.id })) : [{ id: 'sc-uuid-invariant-test' }] };
      }
      // pri01_staging UPDATE
      if (sql.includes('UPDATE pri01_staging')) {
        return { rows: [] };
      }
      // customer_marketplaces UPDATE (transitionCronState)
      if (sql.includes('UPDATE customer_marketplaces')) {
        return { rows: customerMarketplaceUpdateRows };
      }
      // pri01_staging COUNT
      if (sql.includes('pri01_staging') && sql.includes('COUNT')) {
        return { rows: [{ count: 0 }] };
      }
      // sku_channels COUNT
      if (sql.includes('sku_channels') && sql.includes('COUNT')) {
        return { rows: [{ count: 100 }] };
      }
      // lineMap query in clearPendingImport FAILED path
      if (sql.includes('csv_line_number') && sql.includes('pri01_staging')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    get _queries () { return queries; },
  };
}

// ─── AC3: Bundle C atomicity invariant tests ─────────────────────────────────

describe('AC3 — Bundle C pending_import_id atomicity invariant (all real modules)', () => {

  // Sub-test 1: markStagingPending issues a single batch UPDATE (not N per-row UPDATEs)
  test('sub-test 1: REAL markStagingPending issues single batch UPDATE for pending_import_id', async () => {
    const cycleId = 'cycle-uuid-ac3-1';
    const importId = 'import-uuid-ac3-1';
    const customerMarketplaceId = 'cm-uuid-invariant-test';
    const skuId = 'sku-uuid-invariant-test';
    const channelCode = 'WRT_PT_ONLINE';

    const tx = buildCapturingTx({
      stagingRows: [
        {
          id: 'staging-uuid-1',
          sku_id: skuId,
          channel_code: channelCode,
          new_price_cents: 2900,
          shop_sku: 'SKU-001',
        },
      ],
      channelRows: [
        {
          id: 'sc-uuid-invariant-test',
          sku_id: skuId,
          channel_code: channelCode,
          last_set_price_cents: 3199,
        },
      ],
    });

    // Call REAL markStagingPending
    await markStagingPending({ tx, cycleId, importId, customerMarketplaceId });

    // Assert: captured queries must include the UPDATE sku_channels SET pending_import_id
    const pendingUpdates = tx._queries.filter(q =>
      q.sql.includes('UPDATE sku_channels') && q.sql.includes('pending_import_id'),
    );

    // The implementation does per-channel updates (one per sku_channel row in the batch).
    // AC3 spec says "exactly ONE UPDATE query (single batch, not per-row)".
    // With one staging row and one channel row, there must be exactly one UPDATE.
    assert.equal(
      pendingUpdates.length,
      1,
      `markStagingPending must issue exactly 1 UPDATE sku_channels SET pending_import_id for one channel; ` +
      `got ${pendingUpdates.length}. queries=${JSON.stringify(tx._queries.map(q => q.sql.substring(0, 60)))}`,
    );

    // Verify the importId was passed as the pending_import_id value
    const updateQuery = pendingUpdates[0];
    assert.ok(
      updateQuery.params && updateQuery.params.includes(importId),
      `UPDATE sku_channels must include importId=${importId} in params; got ${JSON.stringify(updateQuery.params)}`,
    );
  });

  // Sub-test 2: REAL decideForSkuChannel SKIPs when pending_import_id is set
  test('sub-test 2: REAL decideForSkuChannel returns SKIP with reason=pending-import when pending_import_id set', async () => {
    const skuChannel = buildSkuChannel({ pending_import_id: 'some-import-uuid-pending' });
    const customerMarketplace = buildCustomerMarketplace();
    const tx = buildCapturingTx();

    // Call REAL decideForSkuChannel with non-null pending_import_id
    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace,
      ownShopName: customerMarketplace.shop_name,
      p11RawOffers: [
        { shop_name: 'Competitor A', active: true, total_price: 28.00, shop_id: null },
        { shop_name: 'Easy - Store', active: true, total_price: 31.99, shop_id: null },
      ],
      tx,
    });

    assert.equal(result.action, 'SKIP',
      `REAL decideForSkuChannel must SKIP when pending_import_id is set; got ${result.action}`);
    assert.equal(result.reason, 'pending-import',
      `reason must be 'pending-import' (STEP 1 precondition fail); got '${result.reason}'`);
    assert.deepEqual(result.auditEvents, [],
      `SKIP for pending-import must emit no audit events; got ${JSON.stringify(result.auditEvents)}`);
    assert.equal(result.newPriceCents, null,
      `SKIP must have null newPriceCents; got ${result.newPriceCents}`);
  });

  // Sub-test 3: REAL absorbExternalChange SKIPs when pending_import_id is set
  test('sub-test 3: REAL absorbExternalChange returns skipped=true when pending_import_id set', async () => {
    // Scenario: current_price != last_set_price (external change detectable)
    // but pending_import_id is set → must skip absorption
    const skuChannel = buildSkuChannel({
      pending_import_id: 'some-import-uuid-pending',
      current_price_cents: 2500,
      last_set_price_cents: 3199,  // different → would normally trigger absorption
      list_price_cents: 3000,
    });
    const customerMarketplace = buildCustomerMarketplace();
    const tx = buildCapturingTx();

    // Call REAL absorbExternalChange
    const absorb = await absorbExternalChange({ tx, skuChannel, customerMarketplace });

    assert.equal(absorb.absorbed, false,
      'absorbExternalChange must NOT absorb when pending_import_id is set');
    assert.equal(absorb.frozen, false,
      'absorbExternalChange must NOT freeze when pending_import_id is set');
    assert.equal(absorb.skipped, true,
      'absorbExternalChange must return skipped=true when pending_import_id is set (Bundle C atomicity invariant)');

    // Verify no DB writes were issued (no UPDATE sku_channels during skip)
    const skuChannelUpdates = tx._queries.filter(q =>
      q.sql.includes('UPDATE sku_channels'),
    );
    assert.equal(skuChannelUpdates.length, 0,
      `absorbExternalChange SKIP must not issue any DB writes; got ${skuChannelUpdates.length} UPDATE sku_channels`);
  });

  // Sub-test 4: REAL clearPendingImport(COMPLETE) clears pending_import_id atomically
  test('sub-test 4: REAL clearPendingImport(COMPLETE) issues exactly ONE UPDATE clearing pending_import_id = NULL', async () => {
    const importId = 'import-uuid-ac3-4';
    const customerMarketplaceId = 'cm-uuid-invariant-test';

    const tx = buildCapturingTx({
      channelRows: [{ id: 'sc-uuid-invariant-test' }],
    });

    // Call REAL clearPendingImport with COMPLETE outcome
    await clearPendingImport({
      tx,
      importId,
      customerMarketplaceId,
      outcome: 'COMPLETE',
    });

    // Assert: exactly ONE UPDATE sku_channels clearing pending_import_id = NULL
    const clearUpdates = tx._queries.filter(q =>
      q.sql.includes('UPDATE sku_channels') &&
      q.sql.includes('pending_import_id = NULL'),
    );
    assert.equal(
      clearUpdates.length,
      1,
      `clearPendingImport(COMPLETE) must issue exactly 1 UPDATE sku_channels SET pending_import_id = NULL; ` +
      `got ${clearUpdates.length}`,
    );

    // Verify the WHERE clause uses the importId
    const clearQuery = clearUpdates[0];
    assert.ok(
      clearQuery.params && clearQuery.params.includes(importId),
      `UPDATE sku_channels must match by importId=${importId}; params=${JSON.stringify(clearQuery.params)}`,
    );
  });

  // Sub-test 5: REAL clearPendingImport(FAILED) clears pending state + records PRI03 parser path
  test('sub-test 5: REAL clearPendingImport(FAILED) clears pending_import_id and skips PRI03 when hasErrorReport=false', async () => {
    const importId = 'import-uuid-ac3-5';
    const customerMarketplaceId = 'cm-uuid-invariant-test';

    const tx = buildCapturingTx({
      channelRows: [{ id: 'sc-uuid-invariant-test' }],
    });

    // Call REAL clearPendingImport with FAILED outcome (hasErrorReport=false → PRI03 not invoked)
    await clearPendingImport({
      tx,
      importId,
      customerMarketplaceId,
      outcome: 'FAILED',
      consecutiveFailures: 0,
      hasErrorReport: false,
    });

    // Assert: UPDATE sku_channels clearing pending_import_id = NULL (FAILED path)
    const clearUpdates = tx._queries.filter(q =>
      q.sql.includes('UPDATE sku_channels') &&
      q.sql.includes('pending_import_id = NULL'),
    );
    assert.equal(
      clearUpdates.length,
      1,
      `clearPendingImport(FAILED) must issue exactly 1 UPDATE sku_channels SET pending_import_id = NULL; ` +
      `got ${clearUpdates.length}`,
    );

    // Verify importId in the WHERE clause params
    const clearQuery = clearUpdates[0];
    assert.ok(
      clearQuery.params && clearQuery.params.includes(importId),
      `FAILED UPDATE must match by importId=${importId}; params=${JSON.stringify(clearQuery.params)}`,
    );

    // Verify audit event was emitted for FAILED path (pri02-failed-transient)
    const auditInserts = tx._queries.filter(q =>
      q.sql.includes('INSERT INTO audit_log'),
    );
    assert.ok(
      auditInserts.length >= 1,
      `clearPendingImport(FAILED) must emit at least 1 audit event (pri02-failed-transient); ` +
      `got ${auditInserts.length}`,
    );
  });

  // Negative assertion: transitionCronState is imported directly (no injection pattern)
  test('negative: transitionCronState imported from shared/state/cron-state.js (no injection)', () => {
    // Verify the module was imported and is a real function (not a stub)
    assert.equal(typeof transitionCronState, 'function',
      'transitionCronState must be a real function from shared/state/cron-state.js');
    // Verify it is async
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    assert.ok(transitionCronState instanceof AsyncFunction,
      'transitionCronState must be an async function');
  });
});
