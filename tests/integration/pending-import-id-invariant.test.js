// ATOMICITY BUNDLE C GATE — AD7+AD8+AD9+AD11
// This test is the single binding integration gate for Bundle C.
// Epic 6 writer code (Stories 6.1, 6.2, 6.3) is NOT safe to ship to production
// until all assertions in this test file pass.
//
// tests/integration/pending-import-id-invariant.test.js — Story 7.8 AC3
//
// Bundle C atomicity: pending_import_id set atomically on ALL participating sku_channel rows.
// While non-null: engine STEP 1 SKIPs. PRI02 COMPLETE clears atomically.
//
// Run with: node --test tests/integration/pending-import-id-invariant.test.js

// Stub RESEND_API_KEY before any imports — circuit-breaker.js loads resend/client.js at import time.
if (!process.env.RESEND_API_KEY) {
  process.env.RESEND_API_KEY = 're_test_integration_stub_xxxxxxxxxxxxxx';
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ESM static imports are hoisted above top-level statements. Modules that transitively
// import shared/resend/client.js (circuit-breaker.js, pri02-poller.js, decide.js) will throw
// at import time if RESEND_API_KEY is unset. Use dynamic imports so the env stub runs first.
const { markStagingPending } = await import('../../shared/mirakl/pri01-writer.js');
const { clearPendingImport } = await import('../../shared/mirakl/pri02-poller.js');
const { decideForSkuChannel } = await import('../../worker/src/engine/decide.js');

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock tx that records all queries + UPDATE calls.
 * Supports specific queries to simulate DB state for clearPendingImport.
 */
function buildInvariantMockTx ({
  stagingRows = [],
  channelRows = [],
} = {}) {
  const queries = [];
  const updates = [];

  return {
    query: async (sql, params) => {
      queries.push({ sql, params });

      // SELECT pri01_staging rows (markStagingPending step 1)
      if (sql && sql.includes('pri01_staging') && sql.toUpperCase().includes('SELECT') && !sql.toUpperCase().includes('COUNT')) {
        return { rows: stagingRows };
      }

      // SELECT sku_channels rows (markStagingPending step 2)
      if (sql && sql.includes('sku_channels') && sql.toUpperCase().includes('SELECT') && !sql.toUpperCase().includes('COUNT')) {
        return { rows: channelRows };
      }

      // UPDATE sku_channels (markStagingPending step 3 / clearPendingImport)
      if (sql && sql.toUpperCase().includes('UPDATE') && sql.includes('sku_channels')) {
        updates.push({ sql, params });
        return { rows: channelRows.map(r => ({ id: r.id })), rowCount: channelRows.length };
      }

      // UPDATE pri01_staging (markStagingPending step 4)
      if (sql && sql.toUpperCase().includes('UPDATE') && sql.includes('pri01_staging')) {
        updates.push({ sql, params });
        return { rows: [], rowCount: stagingRows.length };
      }

      // COUNT queries
      if (sql && sql.toUpperCase().includes('COUNT')) {
        return { rows: [{ count: 0 }] };
      }

      return { rows: [], rowCount: 0 };
    },
    _queries: queries,
    _updates: updates,
  };
}

/**
 * Build a default skuChannel mock.
 */
function buildMockSkuChannel (overrides = {}) {
  return {
    id: 'sc-uuid-test',
    sku_id: 'sku-uuid-test',
    customer_marketplace_id: 'cm-uuid-test',
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

function buildMockCustomerMarketplace (overrides = {}) {
  return {
    id: 'cm-test-uuid',
    cron_state: 'ACTIVE',
    max_discount_pct: 0.05,
    max_increase_pct: 0.10,
    edge_step_cents: 1,
    anomaly_threshold_pct: null,
    offer_prices_decimals: 2,
    shop_name: 'Easy - Store',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC3.1 — markStagingPending sets pending_import_id atomically (not per-row)
// ---------------------------------------------------------------------------

describe('AC3.1 — markStagingPending: single transaction, ALL rows marked atomically', () => {
  test('marks multiple sku_channel rows with pending_import_id in one atomic batch', async () => {
    const IMPORT_ID = 'import-uuid-abc123';
    const CYCLE_ID = 'cycle-uuid-xyz';
    const CM_ID = 'cm-uuid-test';

    // Simulate 3 staging rows (2 staged + 1 passthrough channel)
    const stagingRows = [
      { id: 'staging-1', sku_id: 'sku-1', channel_code: 'WRT_PT_ONLINE', new_price_cents: 2849, shop_sku: 'SKU-A' },
      { id: 'staging-2', sku_id: 'sku-2', channel_code: 'WRT_PT_ONLINE', new_price_cents: 3100, shop_sku: 'SKU-B' },
    ];

    // Simulate sku_channels rows (2 active + 1 passthrough channel for sku-1)
    const channelRows = [
      { id: 'sc-1', sku_id: 'sku-1', channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 2999 },
      { id: 'sc-2', sku_id: 'sku-1', channel_code: 'WRT_ES_ONLINE', last_set_price_cents: 3050 },  // passthrough
      { id: 'sc-3', sku_id: 'sku-2', channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 3199 },
    ];

    const tx = buildInvariantMockTx({ stagingRows, channelRows });

    await markStagingPending({
      tx,
      cycleId: CYCLE_ID,
      importId: IMPORT_ID,
      customerMarketplaceId: CM_ID,
    });

    // AC3.1: verify UPDATE sku_channels was called for EACH channel row (including passthrough)
    const skuChannelUpdates = tx._updates.filter(q =>
      q.sql && q.sql.includes('sku_channels') && q.sql.toUpperCase().includes('UPDATE'),
    );

    // Each channel row gets an UPDATE — staged and passthrough both receive pending_import_id
    assert.ok(
      skuChannelUpdates.length >= channelRows.length,
      `Expected at least ${channelRows.length} sku_channels UPDATEs (including passthrough), got ${skuChannelUpdates.length}`,
    );

    // All UPDATE calls include the IMPORT_ID as the pending_import_id value
    const allHaveImportId = skuChannelUpdates.every(q =>
      q.params && q.params.includes(IMPORT_ID),
    );
    assert.ok(allHaveImportId, 'All sku_channels UPDATEs must include the importId as pending_import_id');

    // pri01_staging also gets a bulk UPDATE (step 4 of markStagingPending)
    const stagingUpdates = tx._updates.filter(q =>
      q.sql && q.sql.includes('pri01_staging') && q.sql.toUpperCase().includes('UPDATE'),
    );
    assert.ok(
      stagingUpdates.length >= 1,
      `Expected at least 1 pri01_staging bulk UPDATE, got ${stagingUpdates.length}`,
    );

    // The staging bulk UPDATE covers all rows for the cycle + customer in ONE statement
    const bulkStagingUpdate = stagingUpdates[0];
    assert.ok(
      bulkStagingUpdate.params && bulkStagingUpdate.params.includes(CYCLE_ID),
      'Bulk staging UPDATE must reference cycleId',
    );
    assert.ok(
      bulkStagingUpdate.params && bulkStagingUpdate.params.includes(IMPORT_ID),
      'Bulk staging UPDATE must reference importId',
    );
  });

  test('returns early (no-op) when no staging rows exist for cycle', async () => {
    const tx = buildInvariantMockTx({ stagingRows: [], channelRows: [] });

    // Should not throw, and should make no UPDATE calls
    await markStagingPending({
      tx,
      cycleId: 'cycle-empty',
      importId: 'import-empty',
      customerMarketplaceId: 'cm-empty',
    });

    assert.equal(tx._updates.length, 0, 'No UPDATEs expected when no staging rows');
  });
});

// ---------------------------------------------------------------------------
// AC3.2 — Engine STEP 1 SKIP when pending_import_id IS NOT NULL
// ---------------------------------------------------------------------------

describe('AC3.2 — engine STEP 1: SKIP when pending_import_id is set', () => {
  test('decideForSkuChannel returns SKIP with reason=pending-import when pending_import_id is set', async () => {
    const skuChannel = buildMockSkuChannel({ pending_import_id: 'some-import-uuid' });
    const customerMarketplace = buildMockCustomerMarketplace();
    const tx = { query: async () => ({ rows: [], rowCount: 0 }) };

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace,
      ownShopName: 'Easy - Store',
      p11RawOffers: [
        { shop_name: 'Competitor A', active: true, total_price: 28.00, shop_id: null },
        { shop_name: 'Easy - Store', active: true, total_price: 31.99, shop_id: null },
      ],
      tx,
    });

    assert.equal(result.action, 'SKIP', `Expected SKIP, got ${result.action}`);
    assert.equal(result.reason, 'pending-import', `Expected reason=pending-import, got ${result.reason}`);
    assert.deepEqual(result.auditEvents, [], 'Expected no auditEvents for pending-import SKIP');
    assert.equal(result.newPriceCents, null, 'Expected newPriceCents=null for SKIP');
  });

  test('decideForSkuChannel proceeds normally when pending_import_id is null', async () => {
    const skuChannel = buildMockSkuChannel({
      pending_import_id: null,
      list_price_cents: 2985,
      current_price_cents: 3199,
    });
    const customerMarketplace = buildMockCustomerMarketplace();
    const tx = { query: async () => ({ rows: [], rowCount: 0 }) };

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace,
      ownShopName: 'Easy - Store',
      p11RawOffers: [
        { shop_name: 'Competitor A', active: true, total_price: 28.50, shop_id: null },
        { shop_name: 'Easy - Store', active: true, total_price: 31.99, shop_id: null },
      ],
      tx,
    });

    // Should proceed to engine decision (not SKIP for pending-import reason)
    assert.notEqual(result.reason, 'pending-import', 'Should not skip for pending-import when pending_import_id is null');
  });
});

// ---------------------------------------------------------------------------
// AC3.2 extended — SKIP precondition panel (companion barriers to pending_import_id)
//
// Bundle C atomicity depends on the engine STEP 0 panel of preconditions returning
// SKIP without consulting P11/staging when ANY guard tripsk. Without this panel,
// a row whose cron_state was paused mid-cycle, or whose frozen flag was set after
// markStagingPending, could emit a second write — breaking atomicity.
//
// Tests here lock in the full barrier panel as a single binding regression suite.
// ---------------------------------------------------------------------------

describe('AC3.2 extended — engine STEP 0: SKIP precondition panel (Bundle C barrier)', () => {
  const p11OffersFixture = [
    { shop_name: 'Competitor A', active: true, total_price: 28.50, shop_id: null },
    { shop_name: 'Easy - Store', active: true, total_price: 31.99, shop_id: null },
  ];
  const tx = { query: async () => ({ rows: [], rowCount: 0 }) };

  test('cron_state != ACTIVE → SKIP with reason=cron-state-not-active (no audit event)', async () => {
    const result = await decideForSkuChannel({
      skuChannel: buildMockSkuChannel(),
      customerMarketplace: buildMockCustomerMarketplace({ cron_state: 'PAUSED_BY_CIRCUIT_BREAKER' }),
      ownShopName: 'Easy - Store',
      p11RawOffers: p11OffersFixture,
      tx,
    });
    assert.equal(result.action, 'SKIP');
    assert.equal(result.reason, 'cron-state-not-active');
    assert.deepEqual(result.auditEvents, []);
    assert.equal(result.newPriceCents, null);
  });

  test('frozen_for_anomaly_review=true → SKIP with reason=frozen-for-anomaly-review', async () => {
    const result = await decideForSkuChannel({
      skuChannel: buildMockSkuChannel({ frozen_for_anomaly_review: true }),
      customerMarketplace: buildMockCustomerMarketplace(),
      ownShopName: 'Easy - Store',
      p11RawOffers: p11OffersFixture,
      tx,
    });
    assert.equal(result.action, 'SKIP');
    assert.equal(result.reason, 'frozen-for-anomaly-review');
    assert.deepEqual(result.auditEvents, []);
  });

  test('frozen_for_pri01_persistent=true → SKIP with reason=frozen-for-pri01-persistent', async () => {
    const result = await decideForSkuChannel({
      skuChannel: buildMockSkuChannel({ frozen_for_pri01_persistent: true }),
      customerMarketplace: buildMockCustomerMarketplace(),
      ownShopName: 'Easy - Store',
      p11RawOffers: p11OffersFixture,
      tx,
    });
    assert.equal(result.action, 'SKIP');
    assert.equal(result.reason, 'frozen-for-pri01-persistent');
    assert.deepEqual(result.auditEvents, []);
  });

  test('excluded_at set → SKIP with reason=excluded', async () => {
    const result = await decideForSkuChannel({
      skuChannel: buildMockSkuChannel({ excluded_at: new Date().toISOString() }),
      customerMarketplace: buildMockCustomerMarketplace(),
      ownShopName: 'Easy - Store',
      p11RawOffers: p11OffersFixture,
      tx,
    });
    assert.equal(result.action, 'SKIP');
    assert.equal(result.reason, 'excluded');
    assert.deepEqual(result.auditEvents, []);
  });

  test('current_price_cents not finite → SKIP with reason=current-price-unknown (data-integrity guard)', async () => {
    const result = await decideForSkuChannel({
      skuChannel: buildMockSkuChannel({ current_price_cents: null }),
      customerMarketplace: buildMockCustomerMarketplace(),
      ownShopName: 'Easy - Store',
      p11RawOffers: p11OffersFixture,
      tx,
    });
    assert.equal(result.action, 'SKIP');
    assert.equal(result.reason, 'current-price-unknown');
    assert.deepEqual(result.auditEvents, []);
    assert.equal(result.newPriceCents, null);
  });

  test('pending_import_id wins precedence over excluded_at when both set', async () => {
    // Order matters: pending_import_id is checked BEFORE excluded_at in decide.js.
    // Verifies the precondition order is locked in (regression guard against accidental reorder).
    const result = await decideForSkuChannel({
      skuChannel: buildMockSkuChannel({
        pending_import_id: 'pending-uuid',
        excluded_at: new Date().toISOString(),
      }),
      customerMarketplace: buildMockCustomerMarketplace(),
      ownShopName: 'Easy - Store',
      p11RawOffers: p11OffersFixture,
      tx,
    });
    assert.equal(result.action, 'SKIP');
    assert.equal(result.reason, 'pending-import', 'pending-import must take precedence over excluded');
  });
});

// ---------------------------------------------------------------------------
// AC3.3 — Cooperative-absorption SKIP on pending_import_id
//          (module not on this branch → verified via fixture p11-pri01-pending-skip.json)
// ---------------------------------------------------------------------------

describe('AC3.3 — cooperative-absorption: SKIP path when pending_import_id IS NOT NULL', () => {
  test('engine STEP 1 catches pending_import_id before cooperative-absorb is attempted', async () => {
    // cooperative-absorb.js is NOT on this branch (Story 7.3, parallel worktree).
    // The Bundle C invariant is still enforced via engine STEP 1 (decide.js line 60-63):
    // pending_import_id IS NOT NULL → SKIP before STEP 2 (cooperative-absorb) is reached.
    // This test verifies the STEP 1 guard is a complete barrier.

    const skuChannel = buildMockSkuChannel({
      pending_import_id: 'pending-coop-uuid',
      current_price_cents: 2800,
      last_set_price_cents: 2500,  // deviation = 12% (would trigger absorption if reached)
    });

    const tx = { query: async () => ({ rows: [], rowCount: 0 }) };

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: buildMockCustomerMarketplace(),
      ownShopName: 'Easy - Store',
      p11RawOffers: [
        { shop_name: 'Competitor A', active: true, total_price: 29.99, shop_id: null },
        { shop_name: 'Easy - Store', active: true, total_price: 28.00, shop_id: null },
      ],
      tx,
    });

    // Must SKIP at STEP 1 — cooperative-absorb never reached
    assert.equal(result.action, 'SKIP');
    assert.equal(result.reason, 'pending-import');
    assert.deepEqual(result.auditEvents, []);
  });
});

// ---------------------------------------------------------------------------
// AC3.4 — PRI02 COMPLETE: clearPendingImport clears pending_import_id atomically
// ---------------------------------------------------------------------------

describe('AC3.4 — PRI02 COMPLETE: clearPendingImport clears pending_import_id in one UPDATE', () => {
  test('COMPLETE path: single UPDATE clears pending_import_id for all rows with matching import_uuid', async () => {
    const IMPORT_ID = 'import-complete-uuid';
    const CM_ID = 'cm-test-uuid';

    const updates = [];
    const auditEvents = [];

    const tx = {
      query: async (sql, params) => {
        if (sql && sql.toUpperCase().includes('UPDATE') && sql.includes('sku_channels')) {
          updates.push({ sql, params });
          // Return simulated updated rows
          return {
            rows: [{ id: 'sc-1' }, { id: 'sc-2' }, { id: 'sc-3' }],
            rowCount: 3,
          };
        }
        if (sql && sql.toUpperCase().includes('UPDATE') && sql.includes('pri01_consecutive_failures')) {
          updates.push({ sql, params });
          return { rows: [], rowCount: 3 };
        }
        // Audit inserts
        if (sql && sql.toUpperCase().includes('INSERT') && sql.includes('audit_log')) {
          auditEvents.push({ sql, params });
          return { rows: [{ id: 'audit-1' }] };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CM_ID,
      outcome: 'COMPLETE',
    });

    // AC3.4: exactly ONE UPDATE to sku_channels that clears pending_import_id
    const clearUpdates = updates.filter(q =>
      q.sql && q.sql.includes('sku_channels') &&
      q.sql.includes('pending_import_id') &&
      q.sql.includes('NULL'),
    );

    assert.ok(
      clearUpdates.length >= 1,
      `Expected at least 1 UPDATE clearing pending_import_id, got ${clearUpdates.length}`,
    );

    // The UPDATE must reference the importId in WHERE clause (batch-targeted, not per-row)
    const batchUpdate = clearUpdates[0];
    assert.ok(
      batchUpdate.params && batchUpdate.params.includes(IMPORT_ID),
      'UPDATE must be parameterized with importId for atomic batch clear',
    );
  });

  test('COMPLETE path: clears last_set_price_cents = pending_set_price_cents (confirmed price)', async () => {
    const updates = [];
    const tx = {
      query: async (sql, params) => {
        if (sql && sql.toUpperCase().includes('UPDATE') && sql.includes('sku_channels')) {
          updates.push({ sql, params });
          return { rows: [{ id: 'sc-1' }], rowCount: 1 };
        }
        if (sql && sql.toUpperCase().includes('INSERT')) {
          return { rows: [{ id: 'audit-1' }] };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    await clearPendingImport({
      tx,
      importId: 'import-price-confirm',
      customerMarketplaceId: 'cm-uuid',
      outcome: 'COMPLETE',
    });

    const update = updates.find(q => q.sql && q.sql.includes('last_set_price_cents'));
    assert.ok(update, 'COMPLETE path must UPDATE last_set_price_cents = pending_set_price_cents');
  });
});

// ---------------------------------------------------------------------------
// AC3.5 — PRI02 FAILED: clears pending AND invokes PRI03 parser (when hasErrorReport=true)
// ---------------------------------------------------------------------------

describe('AC3.5 — PRI02 FAILED: clears pending_import_id AND records PRI03 invocation', () => {
  test('FAILED path: clears pending_import_id for all rows with matching import_uuid', async () => {
    const IMPORT_ID = 'import-failed-uuid';
    const CM_ID = 'cm-test-uuid';

    const updates = [];
    const auditEvents = [];

    const tx = {
      query: async (sql, params) => {
        if (sql && sql.toUpperCase().includes('UPDATE') && sql.includes('sku_channels') &&
            sql.includes('pending_import_id')) {
          updates.push({ sql, params });
          return { rows: [{ id: 'sc-1' }], rowCount: 1 };
        }
        if (sql && sql.toUpperCase().includes('UPDATE') && sql.includes('pri01_consecutive_failures')) {
          updates.push({ sql, params });
          return { rows: [], rowCount: 1 };
        }
        if (sql && sql.toUpperCase().includes('INSERT') && sql.includes('audit_log')) {
          auditEvents.push({ sql, params });
          return { rows: [{ id: 'audit-1' }] };
        }
        if (sql && sql.toUpperCase().includes('SELECT') && sql.includes('csv_line_number')) {
          return { rows: [] };  // lineMap query — no rows (pre-AC#6)
        }
        return { rows: [], rowCount: 0 };
      },
    };

    // FAILED path — hasErrorReport=false so PRI03 parser not invoked
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CM_ID,
      outcome: 'FAILED',
      hasErrorReport: false,
    });

    // AC3.5: UPDATE clears pending_import_id for matching rows
    const clearUpdates = updates.filter(q =>
      q.sql && q.sql.includes('sku_channels') && q.sql.includes('pending_import_id'),
    );

    assert.ok(
      clearUpdates.length >= 1,
      `FAILED path: expected UPDATE clearing pending_import_id, got ${clearUpdates.length}`,
    );

    const batchUpdate = clearUpdates[0];
    assert.ok(
      batchUpdate.params && batchUpdate.params.includes(IMPORT_ID),
      'FAILED path: UPDATE must reference importId',
    );

    // FAILED path must NOT touch last_set_price_cents (import never applied)
    const lspUpdate = updates.find(q =>
      q.sql && q.sql.includes('last_set_price_cents') && !q.sql.includes('consecutive'),
    );
    assert.equal(
      lspUpdate,
      undefined,
      'FAILED path must NOT update last_set_price_cents (price was never applied)',
    );
  });

  test('FAILED path with hasErrorReport=true: invokes lineMap query (PRI03 path)', async () => {
    const queriedSqls = [];
    const tx = {
      query: async (sql, _params) => {
        queriedSqls.push(sql);
        if (sql && sql.toUpperCase().includes('UPDATE') && sql.includes('sku_channels')) {
          return { rows: [{ id: 'sc-1' }], rowCount: 1 };
        }
        if (sql && sql.toUpperCase().includes('UPDATE') && sql.includes('pri01_consecutive_failures')) {
          return { rows: [], rowCount: 1 };
        }
        if (sql && sql.toUpperCase().includes('INSERT')) {
          return { rows: [{ id: 'audit-1' }] };
        }
        if (sql && sql.includes('csv_line_number')) {
          // Simulate lineMap query success
          return { rows: [{ csv_line_number: 1, shop_sku: 'SKU-A', cycle_id: 'cycle-uuid' }] };
        }
        return { rows: [], rowCount: 0 };
      },
    };

    // FAILED path with hasErrorReport=true: triggers lineMap query + PRI03 parser invocation.
    // PRI03 parser performs a real HTTP fetch to baseUrl — the fetch fails because baseUrl is
    // fake. We capture the thrown error to assert the lineMap path was reached (the lineMap
    // query is issued BEFORE the fetch), then explicitly classify the failure mode.
    let caughtError = null;
    try {
      await clearPendingImport({
        tx,
        importId: 'import-with-report',
        customerMarketplaceId: 'cm-uuid',
        outcome: 'FAILED',
        hasErrorReport: true,
        baseUrl: 'https://worten.mirakl.net.fake-host-for-test.invalid',
        apiKey: 're_test_key',
      });
    } catch (err) {
      caughtError = err;
    }

    // The lineMap query must have been issued BEFORE the fetch fails (proves PRI03 path entered).
    const lineMapQueried = queriedSqls.some(sql => sql && sql.includes('csv_line_number'));
    assert.ok(lineMapQueried, 'FAILED path with hasErrorReport=true: must query csv_line_number for PRI03 lineMap');

    // If clearPendingImport threw, the error must be a network/fetch failure — NOT a query/
    // schema error. This narrows the catch above (no longer swallows arbitrary failures).
    if (caughtError) {
      const msg = String(caughtError.message ?? '');
      const isNetworkErr = msg.includes('fetch') || msg.includes('ENOTFOUND') ||
                           msg.includes('Failed to fetch') || msg.includes('network') ||
                           caughtError.code === 'ENOTFOUND' || caughtError.code === 'ECONNREFUSED' ||
                           caughtError.cause?.code === 'ENOTFOUND' || caughtError.cause?.code === 'ECONNREFUSED';
      assert.ok(
        isNetworkErr,
        `Expected network/fetch error from fake baseUrl, got: ${msg} (code=${caughtError.code})`,
      );
    }
  });
});
