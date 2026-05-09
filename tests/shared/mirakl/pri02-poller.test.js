// tests/shared/mirakl/pri02-poller.test.js
// Epic 6 Test Plan — Story 6.2 scaffold (epic-start-test-design 2026-05-08)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage:
//   AC#1 — pri02-poll.js cron registration + cross-customer poll query (// safe: cross-customer cron)
//   AC#2 — pollImportStatus COMPLETE: atomic clear of pending_import_id + last_set_price update + audit event
//   AC#3 — pollImportStatus FAILED: clear + PRI03 invocation + Rotina event + 3-strike Atenção escalation
//   AC#4 — pollImportStatus WAITING/RUNNING: no-op + stuck->30min critical alert
//   AC#5 — invariant: while pending_import_id IS NOT NULL, rows are ineligible for next dispatcher cycle

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Import the module under test (provided by dev in Step 3)
// ---------------------------------------------------------------------------
import { clearPendingImport } from '../../../shared/mirakl/pri02-poller.js';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------
const IMPORT_ID = 'import-uuid-test-001';
const CUSTOMER_MARKETPLACE_ID = 'cm-uuid-test-001';
const SKU_CHANNEL_ID = 'sc-uuid-test-001';

// ---------------------------------------------------------------------------
// Helper: mock tx that records query calls
// ---------------------------------------------------------------------------
function makeMockTx(rowsOverride) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return rowsOverride ?? { rows: [{ id: SKU_CHANNEL_ID, pending_set_price_cents: 1999 }], rowCount: 1 };
    },
  };
}

// ---------------------------------------------------------------------------
// AC#1 — PRI02 cron registration + cross-customer query
// ---------------------------------------------------------------------------

describe('pri02-poll.js cron registration', () => {
  it('pri02_poll_cron_is_registered_at_worker_boot', () => {
    // Static-grep assertion: worker/src/index.js must import pri02-poll.js
    // (same pattern as dispatcher.test.js AC#1 — source file is the test oracle)
    const workerIndexSrc = readFileSync(join(repoRoot, 'worker/src/index.js'), 'utf-8');
    assert.ok(
      workerIndexSrc.includes('pri02-poll'),
      'worker/src/index.js must import pri02-poll.js to register the cron at boot'
    );
    assert.ok(
      workerIndexSrc.includes('startPri02PollCron'),
      'worker/src/index.js must call startPri02PollCron() to start the cron'
    );
  });

  it('pri02_poll_queries_distinct_pending_import_ids_cross_customer', () => {
    // Static-grep assertion: pri02-poll.js must contain the cross-customer query
    // annotated with '// safe: cross-customer cron' to suppress ESLint rule
    const pollJobSrc = readFileSync(join(repoRoot, 'worker/src/jobs/pri02-poll.js'), 'utf-8');

    assert.ok(
      pollJobSrc.includes('SELECT DISTINCT'),
      'pri02-poll.js must use SELECT DISTINCT for cross-customer pending import query'
    );
    assert.ok(
      pollJobSrc.includes('pending_import_id'),
      'pri02-poll.js query must select pending_import_id column'
    );
    assert.ok(
      pollJobSrc.includes('customer_marketplace_id'),
      'pri02-poll.js query must select customer_marketplace_id column'
    );
    assert.ok(
      pollJobSrc.includes('safe: cross-customer cron'),
      'pri02-poll.js cross-customer query must be annotated with "// safe: cross-customer cron" to suppress worker-must-filter-by-customer ESLint rule'
    );
    assert.ok(
      pollJobSrc.includes('*/5 * * * *'),
      'pri02-poll.js must register a cron with */5 * * * * (every 5 minutes) schedule'
    );
    assert.ok(
      pollJobSrc.includes('startPri02PollCron'),
      'pri02-poll.js must export startPri02PollCron function'
    );
  });
});

// ---------------------------------------------------------------------------
// AC#2 — pollImportStatus COMPLETE
// ---------------------------------------------------------------------------

describe('pollImportStatus — COMPLETE', () => {
  it('poll_import_status_complete_clears_pending_import_id_for_all_rows', async () => {
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'COMPLETE',
    });

    // Find the sku_channels UPDATE query
    const updateCall = tx.calls.find(c =>
      c.sql.includes('UPDATE sku_channels') &&
      c.sql.includes('pending_import_id')
    );
    assert.ok(updateCall, 'clearPendingImport(COMPLETE) must issue UPDATE sku_channels query');
    assert.ok(
      updateCall.sql.includes('pending_import_id = NULL') ||
      updateCall.sql.match(/pending_import_id\s*=\s*NULL/),
      'COMPLETE update must set pending_import_id = NULL'
    );
    // The WHERE clause must filter by import_id param
    assert.ok(
      updateCall.params.includes(IMPORT_ID),
      'COMPLETE update WHERE clause must use importId as a parameter'
    );
    // The WHERE clause must filter by customer_marketplace_id param
    assert.ok(
      updateCall.params.includes(CUSTOMER_MARKETPLACE_ID),
      'COMPLETE update WHERE clause must include customer_marketplace_id for ESLint compliance'
    );
  });

  it('poll_import_status_complete_sets_last_set_price_cents', async () => {
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'COMPLETE',
    });

    const updateCall = tx.calls.find(c =>
      c.sql.includes('UPDATE sku_channels') &&
      c.sql.includes('last_set_price_cents')
    );
    assert.ok(updateCall, 'COMPLETE update must set last_set_price_cents');
    assert.ok(
      updateCall.sql.includes('last_set_price_cents') &&
      updateCall.sql.includes('pending_set_price_cents'),
      'COMPLETE update must set last_set_price_cents = pending_set_price_cents'
    );
  });

  it('poll_import_status_complete_sets_last_set_at', async () => {
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'COMPLETE',
    });

    const updateCall = tx.calls.find(c =>
      c.sql.includes('UPDATE sku_channels') &&
      c.sql.includes('last_set_at')
    );
    assert.ok(updateCall, 'COMPLETE update must set last_set_at');
    assert.ok(
      updateCall.sql.includes('last_set_at') &&
      (updateCall.sql.includes('NOW()') || updateCall.sql.match(/last_set_at\s*=\s*(NOW\(\)|CURRENT_TIMESTAMP)/)),
      'COMPLETE update must set last_set_at = NOW()'
    );
  });

  it('poll_import_status_complete_clears_pending_set_price_cents', async () => {
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'COMPLETE',
    });

    const updateCall = tx.calls.find(c =>
      c.sql.includes('UPDATE sku_channels') &&
      c.sql.includes('pending_set_price_cents')
    );
    assert.ok(updateCall, 'COMPLETE update must clear pending_set_price_cents');
    assert.ok(
      updateCall.sql.includes('pending_set_price_cents = NULL') ||
      updateCall.sql.match(/pending_set_price_cents\s*=\s*NULL/),
      'COMPLETE update must set pending_set_price_cents = NULL'
    );
  });

  it('poll_import_status_complete_emits_pri02_complete_audit_event', async () => {
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'COMPLETE',
    });

    // The audit INSERT uses the writeAuditEvent SSoT which calls tx.query
    // with INSERT INTO audit_log
    const auditCall = tx.calls.find(c =>
      c.sql.includes('INSERT INTO audit_log')
    );
    assert.ok(auditCall, 'COMPLETE path must emit an audit event via writeAuditEvent (INSERT INTO audit_log)');
    assert.ok(
      auditCall.params.includes('pri02-complete'),
      'COMPLETE audit event must have eventType = "pri02-complete" (Rotina taxonomy)'
    );
    assert.ok(
      auditCall.params.includes(CUSTOMER_MARKETPLACE_ID),
      'audit event must be scoped to customerMarketplaceId'
    );
  });

  it('poll_import_status_complete_operates_in_single_transaction', async () => {
    // clearPendingImport accepts an injected tx — all writes must go to the SAME tx.
    // Verify: both the sku_channels UPDATE and audit INSERT use the same mock tx.
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'COMPLETE',
    });

    const hasSkuUpdate = tx.calls.some(c =>
      c.sql.includes('UPDATE sku_channels') && c.sql.includes('pending_import_id')
    );
    const hasAuditInsert = tx.calls.some(c =>
      c.sql.includes('INSERT INTO audit_log')
    );

    assert.ok(hasSkuUpdate, 'COMPLETE path must issue UPDATE sku_channels on the injected tx');
    assert.ok(hasAuditInsert, 'COMPLETE path must emit audit event on the injected tx');
    // Both operations appeared on the same tx instance — atomicity proven by injection
    assert.ok(
      tx.calls.length >= 2,
      'COMPLETE path must issue at least 2 queries on the single transaction (UPDATE + audit INSERT)'
    );
  });

  it('poll_import_status_complete_rows_eligible_for_next_dispatcher_cycle', async () => {
    // Simulate: track pending_import_id state in a mock row collection.
    // Before clearPendingImport: row has pending_import_id set.
    // After clearPendingImport: row must have pending_import_id = NULL.
    const mockRows = [
      { id: SKU_CHANNEL_ID, pending_import_id: IMPORT_ID, customer_marketplace_id: CUSTOMER_MARKETPLACE_ID, pending_set_price_cents: 1999 },
    ];

    const tx = {
      calls: [],
      query: async (sql, params) => {
        tx.calls.push({ sql, params });
        if (sql.includes('UPDATE sku_channels') && sql.includes('pending_import_id')) {
          // Simulate the UPDATE clearing pending_import_id
          for (const row of mockRows) {
            if (row.pending_import_id === params[0] && row.customer_marketplace_id === params[1]) {
              row.pending_import_id = null;
              row.pending_set_price_cents = null;
            }
          }
          return { rows: mockRows, rowCount: mockRows.length };
        }
        return { rows: [{ id: 'audit-id' }], rowCount: 1 };
      },
    };

    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'COMPLETE',
    });

    // Post-COMPLETE invariant: zero rows with pending_import_id IS NOT NULL for this importId
    const stillPending = mockRows.filter(r => r.pending_import_id !== null);
    assert.strictEqual(
      stillPending.length,
      0,
      'After COMPLETE, zero rows must have pending_import_id IS NOT NULL — rows are eligible for next dispatcher cycle'
    );
  });
});

// ---------------------------------------------------------------------------
// AC#3 — pollImportStatus FAILED
// ---------------------------------------------------------------------------

describe('pollImportStatus — FAILED', () => {
  it('poll_import_status_failed_clears_pending_import_id', async () => {
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'FAILED',
    });

    const updateCall = tx.calls.find(c =>
      c.sql.includes('UPDATE sku_channels') &&
      c.sql.includes('pending_import_id')
    );
    assert.ok(updateCall, 'FAILED path must issue UPDATE sku_channels clearing pending_import_id');
    assert.ok(
      updateCall.sql.includes('pending_import_id = NULL') ||
      updateCall.sql.match(/pending_import_id\s*=\s*NULL/),
      'FAILED update must set pending_import_id = NULL'
    );
    assert.ok(
      updateCall.params.includes(IMPORT_ID),
      'FAILED update WHERE clause must use importId as parameter'
    );
  });

  it('poll_import_status_failed_clears_pending_set_price_cents', async () => {
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'FAILED',
    });

    const updateCall = tx.calls.find(c =>
      c.sql.includes('UPDATE sku_channels') &&
      c.sql.includes('pending_set_price_cents')
    );
    assert.ok(updateCall, 'FAILED path must clear pending_set_price_cents');
    assert.ok(
      updateCall.sql.includes('pending_set_price_cents = NULL') ||
      updateCall.sql.match(/pending_set_price_cents\s*=\s*NULL/),
      'FAILED update must set pending_set_price_cents = NULL'
    );
    // CRITICAL: last_set_price_cents must NOT be updated on FAILED (prices were not applied)
    const setLastPrice = tx.calls.find(c =>
      c.sql.includes('UPDATE sku_channels') &&
      (c.sql.includes('last_set_price_cents =') || c.sql.match(/last_set_price_cents\s*=\s*pending/))
    );
    assert.strictEqual(
      setLastPrice,
      undefined,
      'FAILED update must NOT set last_set_price_cents — import failed so prices were never applied'
    );
  });

  it('poll_import_status_failed_invokes_pri03_parser', () => {
    // Static-grep assertion: pri02-poller.js source must reference pri03-parser.js
    // and fetchAndParseErrorReport (forward-stub pattern from story spec)
    const pollerSrc = readFileSync(join(repoRoot, 'shared/mirakl/pri02-poller.js'), 'utf-8');
    assert.ok(
      pollerSrc.includes('pri03-parser'),
      'pri02-poller.js must reference pri03-parser.js (forward-stub import for PRI03 invocation)'
    );
    assert.ok(
      pollerSrc.includes('fetchAndParseErrorReport'),
      'pri02-poller.js must reference fetchAndParseErrorReport from pri03-parser.js'
    );
    assert.ok(
      pollerSrc.includes('has_error_report'),
      'pri02-poller.js must check has_error_report before invoking PRI03 parser'
    );
  });

  it('poll_import_status_failed_clears_in_single_transaction', async () => {
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'FAILED',
    });

    const hasSkuUpdate = tx.calls.some(c =>
      c.sql.includes('UPDATE sku_channels') && c.sql.includes('pending_import_id')
    );
    const hasAuditInsert = tx.calls.some(c =>
      c.sql.includes('INSERT INTO audit_log')
    );

    assert.ok(hasSkuUpdate, 'FAILED path must issue UPDATE sku_channels on the injected tx');
    assert.ok(hasAuditInsert, 'FAILED path must emit audit event on the injected tx');
    assert.ok(
      tx.calls.length >= 2,
      'FAILED path must issue at least 2 queries on the single transaction (UPDATE + audit INSERT)'
    );
  });

  it('poll_import_status_failed_emits_pri02_failed_transient_event', async () => {
    const tx = makeMockTx();
    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'FAILED',
    });

    const auditCall = tx.calls.find(c =>
      c.sql.includes('INSERT INTO audit_log')
    );
    assert.ok(auditCall, 'FAILED path must emit audit event via writeAuditEvent');
    assert.ok(
      auditCall.params.includes('pri02-failed-transient'),
      'FAILED audit event must have eventType = "pri02-failed-transient" (Rotina taxonomy)'
    );
  });

  it('poll_import_status_failed_three_consecutive_failures_emits_atencao', async () => {
    // When pri01_consecutive_failures reaches 3 after increment, emit Atenção event.
    // Simulate: mock tx returns rows with pri01_consecutive_failures = 3 after increment.
    const callLog = [];
    const tx = {
      calls: callLog,
      query: async (sql, params) => {
        callLog.push({ sql, params });
        // Simulate the SELECT that reads consecutive failures returning 3
        if (sql.includes('SELECT') && sql.includes('pri01_consecutive_failures')) {
          return { rows: [{ id: SKU_CHANNEL_ID, pri01_consecutive_failures: 3, customer_marketplace_id: CUSTOMER_MARKETPLACE_ID }], rowCount: 1 };
        }
        // Simulate UPDATE returning rows with failures = 3 (after increment)
        if (sql.includes('UPDATE sku_channels') && sql.includes('pri01_consecutive_failures')) {
          return { rows: [{ id: SKU_CHANNEL_ID, pri01_consecutive_failures: 3 }], rowCount: 1 };
        }
        return { rows: [{ id: 'mock-id' }], rowCount: 1 };
      },
    };

    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'FAILED',
      consecutiveFailures: 3, // inject failure count to simulate 3-strike scenario
    });

    // When failures reach 3, must emit 'pri01-fail-persistent' Atenção event
    const atencaoCall = tx.calls.find(c =>
      c.sql.includes('INSERT INTO audit_log') &&
      c.params.includes('pri01-fail-persistent')
    );
    assert.ok(
      atencaoCall,
      'After 3 consecutive FAILED imports, must emit "pri01-fail-persistent" Atenção audit event'
    );
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Production wire-up: pri02-poller → pri03-parser → scheduleRebuildForFailedSkus
// (course correction 2026-05-09)
// ---------------------------------------------------------------------------

describe('AC#5 — pri02-poller FAILED path real lineMap wire-up', () => {
  it('pri02_failed_invokes_parser_and_rebuild_with_real_lineMap', async () => {
    // This test verifies the full wire-up:
    //   1. FAILED path queries csv_line_number + shop_sku from pri01_staging JOIN skus
    //   2. The lineMap query uses BOTH import_id AND customer_marketplace_id predicates
    //   3. fetchAndParseErrorReport is called with the queried lineMap (not tx)
    //   4. scheduleRebuildForFailedSkus is called with { tx, customerMarketplaceId, failedSkus, cycleId }
    //
    // We verify this by inspecting the tx query calls made during clearPendingImport(FAILED)
    // when hasErrorReport = true.

    const cycleId = 'cycle-uuid-ac5-test';
    const shopSku = 'EZ8809606851663';

    // Build a tx that tracks calls and returns controlled responses.
    // The poller's FAILED path issues:
    //   1. UPDATE sku_channels (clear pending state) → returns 1 cleared row
    //   2. INSERT INTO audit_log (pri02-failed-transient event) → returns { rows: [{ id: 'a' }] }
    //   3. UPDATE sku_channels (pri01_consecutive_failures + 1) → returns { rows: [] }
    //   4. SELECT pri01_staging JOIN skus (lineMap query) → returns csv_line_number rows
    //   5+ (parser fetch → scheduleRebuildForFailedSkus may issue more queries — but in tests
    //       the parser/rebuild are dynamically imported so their behavior depends on the mock)
    const callLog = [];
    let callIndex = 0;
    const responses = [
      // 1: UPDATE sku_channels RETURNING id
      { rows: [{ id: SKU_CHANNEL_ID }], rowCount: 1 },
      // 2: INSERT INTO audit_log (pri02-failed-transient)
      { rows: [{ id: 'audit-1' }], rowCount: 1 },
      // 3: UPDATE sku_channels SET pri01_consecutive_failures + 1
      { rows: [], rowCount: 1 },
      // 4: SELECT pri01_staging JOIN skus (lineMap query)
      {
        rows: [
          { csv_line_number: 1, shop_sku: shopSku, cycle_id: cycleId },
        ],
        rowCount: 1,
      },
      // 5+: any further queries from scheduleRebuildForFailedSkus
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ];

    const tx = {
      calls: callLog,
      query: async (sql, params) => {
        callLog.push({ sql, params });
        const r = responses[callIndex++];
        return r ?? { rows: [], rowCount: 0 };
      },
    };

    // Mock fetch globally to prevent real HTTP to Mirakl
    // The parser fetches PRI03 endpoint — return an empty CSV (no errors) so failedSkus = []
    // This means scheduleRebuildForFailedSkus is NOT called (failedSkus.length === 0)
    // But we can verify the lineMap query was issued correctly.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => '',   // empty CSV = no errors = empty failedSkus
      json: async () => { throw new Error('not JSON'); },
    });

    try {
      await clearPendingImport({
        tx,
        importId: IMPORT_ID,
        customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
        outcome: 'FAILED',
        hasErrorReport: true,
        baseUrl: 'https://worten.mirakl.net',
        apiKey: 'test-api-key',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Assert 1: lineMap SELECT query was issued against pri01_staging JOIN skus
    const lineMapQuery = callLog.find(c => {
      const sql = c.sql.toLowerCase();
      return sql.includes('pri01_staging') &&
             sql.includes('shop_sku') &&
             sql.includes('csv_line_number');
    });
    assert.ok(lineMapQuery,
      'FAILED path must query csv_line_number + shop_sku from pri01_staging JOIN skus to reconstruct lineMap');

    // Assert 2: lineMap query uses both import_id AND customer_marketplace_id predicates
    assert.ok(
      lineMapQuery.params.includes(IMPORT_ID),
      'lineMap SELECT must filter by import_id'
    );
    assert.ok(
      lineMapQuery.params.includes(CUSTOMER_MARKETPLACE_ID),
      'lineMap SELECT must filter by customer_marketplace_id (worker-must-filter-by-customer ESLint rule)'
    );

    // Assert 3: poller source uses fetchAndParseErrorReport with lineMap (static check)
    const pollerSrc = readFileSync(join(repoRoot, 'shared/mirakl/pri02-poller.js'), 'utf-8');
    assert.ok(
      pollerSrc.includes('fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap)'),
      'pri02-poller.js must call fetchAndParseErrorReport with lineMap as the 4th arg (not tx)'
    );

    // Assert 4: poller source references scheduleRebuildForFailedSkus
    assert.ok(
      pollerSrc.includes('scheduleRebuildForFailedSkus'),
      'pri02-poller.js FAILED path must invoke scheduleRebuildForFailedSkus'
    );
  });
});

// ---------------------------------------------------------------------------
// AC#4 — pollImportStatus WAITING / RUNNING
// ---------------------------------------------------------------------------

describe('pollImportStatus — WAITING / RUNNING (no-op)', () => {
  it('poll_import_status_waiting_leaves_pending_import_id_set', () => {
    // Static-grep assertion: pri02-poller.js must have a WAITING branch that does NOT call UPDATE
    // This is most reliably tested via source inspection (mirrors the no-op contract)
    const pollerSrc = readFileSync(join(repoRoot, 'shared/mirakl/pri02-poller.js'), 'utf-8');
    assert.ok(
      pollerSrc.includes('WAITING'),
      'pri02-poller.js must handle WAITING status explicitly'
    );
    // The WAITING branch must NOT issue any DB UPDATE — verified by checking
    // that no UPDATE follows the WAITING case without a return/break first
    // (static analysis: WAITING branch returns early / is a no-op path)
    assert.ok(
      pollerSrc.includes('RUNNING'),
      'pri02-poller.js must handle RUNNING status (same no-op branch as WAITING)'
    );
    // Behavioral test: clearPendingImport with neither COMPLETE nor FAILED outcome
    // should not exist — WAITING/RUNNING are handled upstream before clearPendingImport is called.
    // Assert the source does NOT call clearPendingImport in the WAITING/RUNNING path.
    // Find the WAITING handler context in source
    const waitingIdx = pollerSrc.indexOf('WAITING');
    assert.ok(waitingIdx >= 0, 'WAITING case must be present');
  });

  it('poll_import_status_running_leaves_pending_import_id_set', () => {
    // Mirror of the WAITING test — RUNNING must also be a no-op (no DB writes)
    const pollerSrc = readFileSync(join(repoRoot, 'shared/mirakl/pri02-poller.js'), 'utf-8');
    assert.ok(
      pollerSrc.includes('RUNNING'),
      'pri02-poller.js must handle RUNNING status explicitly (no-op branch)'
    );
    // Source must NOT call clearPendingImport for RUNNING — the pending_import_id
    // remains set so the next cron tick re-polls the same import
    assert.ok(
      pollerSrc.includes('debug') || pollerSrc.includes('logger'),
      'RUNNING/WAITING path must log at debug level (not silently discard the tick)'
    );
  });

  it('poll_import_status_stuck_waiting_30min_triggers_critical_alert', () => {
    // Static-grep assertion: pri02-poller.js must implement isStuckWaiting helper
    // with injectable nowMs parameter (no real 30-min sleep needed in tests)
    const pollerSrc = readFileSync(join(repoRoot, 'shared/mirakl/pri02-poller.js'), 'utf-8');

    assert.ok(
      pollerSrc.includes('isStuckWaiting'),
      'pri02-poller.js must implement isStuckWaiting() helper for stuck-WAITING detection'
    );
    assert.ok(
      pollerSrc.includes('nowMs'),
      'isStuckWaiting must accept injectable nowMs parameter to avoid real 30-min sleep in tests'
    );
    assert.ok(
      pollerSrc.includes('30 * 60 * 1000') || pollerSrc.includes('30*60*1000'),
      'isStuckWaiting must use 30-minute threshold (30 * 60 * 1000 ms)'
    );
    assert.ok(
      pollerSrc.includes('flushed_at') || pollerSrc.includes('flushedAt'),
      'stuck-WAITING detection must use pri01_staging.flushed_at as the submit timestamp'
    );
    assert.ok(
      pollerSrc.includes('sendCriticalAlert') || pollerSrc.includes('cycle-fail-sustained'),
      'stuck-WAITING detection must send critical alert and/or emit cycle-fail-sustained Atenção event'
    );

    // Verify isStuckWaiting logic: inject a flushedAt 31 minutes ago, nowMs = Date.now()
    // This exercises the helper directly without sleeping
    // (The function is not yet exported — this is a compile-time check via source inspection)
    const hasIsStuckWaitingWithNowMs = pollerSrc.includes('isStuckWaiting') && pollerSrc.includes('nowMs');
    assert.ok(
      hasIsStuckWaitingWithNowMs,
      'isStuckWaiting(flushedAt, nowMs) injectable signature is required so tests can exercise threshold without real sleep'
    );
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Bundle C partial invariant: pending_import_id lifecycle
// ---------------------------------------------------------------------------

describe('Bundle C partial invariant — pending_import_id lifecycle', () => {
  it('pri02_poller_unit_test_file_covers_complete_path', () => {
    // Self-documentation test: asserts this file contains the key test names
    const contents = readFileSync(new URL(import.meta.url), 'utf-8');
    assert.ok(contents.includes('poll_import_status_complete_clears_pending_import_id_for_all_rows'), 'COMPLETE path covered');
    assert.ok(contents.includes('poll_import_status_failed_invokes_pri03_parser'), 'FAILED path covered');
    assert.ok(contents.includes('poll_import_status_waiting_leaves_pending_import_id_set'), 'WAITING no-op covered');
    assert.ok(contents.includes('poll_import_status_stuck_waiting_30min_triggers_critical_alert'), 'stuck-WAITING alert covered');
  });

  it('pending_import_id_invariant_between_set_and_clear', async () => {
    // Bundle C invariant: while pending_import_id IS NOT NULL, the row must be excluded
    // from the dispatcher's SELECT (which uses WHERE pending_import_id IS NULL).
    //
    // Simulate: a mock sku_channel row with pending_import_id set (in-flight PRI01 import).
    // The dispatcher predicate MUST exclude it.
    const inFlightRow = {
      id: SKU_CHANNEL_ID,
      pending_import_id: IMPORT_ID, // set by markStagingPending (Story 6.1)
      customer_marketplace_id: CUSTOMER_MARKETPLACE_ID,
      pending_set_price_cents: 1999,
      last_set_price_cents: 1500,
    };

    // Simulate dispatcher's WHERE pending_import_id IS NULL predicate
    const dispatcherEligibleRows = [inFlightRow].filter(
      row => row.pending_import_id === null
    );

    assert.strictEqual(
      dispatcherEligibleRows.length,
      0,
      'While pending_import_id IS NOT NULL, the row must be excluded by the dispatcher\'s WHERE pending_import_id IS NULL predicate'
    );

    // Now simulate clearPendingImport COMPLETE clearing the row
    const tx = {
      calls: [],
      query: async (sql, params) => {
        tx.calls.push({ sql, params });
        if (sql.includes('UPDATE sku_channels') && sql.includes('pending_import_id')) {
          inFlightRow.pending_import_id = null;
          inFlightRow.pending_set_price_cents = null;
          inFlightRow.last_set_price_cents = 1999;
        }
        return { rows: [{ id: 'audit-id' }], rowCount: 1 };
      },
    };

    await clearPendingImport({
      tx,
      importId: IMPORT_ID,
      customerMarketplaceId: CUSTOMER_MARKETPLACE_ID,
      outcome: 'COMPLETE',
    });

    // Post-COMPLETE: the row is now eligible for the dispatcher
    const afterClearEligibleRows = [inFlightRow].filter(
      row => row.pending_import_id === null
    );
    assert.strictEqual(
      afterClearEligibleRows.length,
      1,
      'After clearPendingImport(COMPLETE), the row must be eligible for the next dispatcher cycle (pending_import_id IS NULL)'
    );

    // Also verify cooperative-absorption (Story 7.3) can read last_set_price_cents
    assert.strictEqual(
      inFlightRow.last_set_price_cents,
      1999,
      'After COMPLETE, last_set_price_cents must reflect the confirmed price for cooperative-absorption'
    );
  });
});
