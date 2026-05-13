// tests/worker/safety/anomaly-freeze.test.js
//
// Story 7.4 — ATDD: Unit tests for worker/src/safety/anomaly-freeze.js
//
// Covers AC8 (6 test cases) + source-inspection negative assertions.
//
// Tests:
//   1. freezeSkuForReview happy path — UPDATE sku_channels + writeAuditEvent + sendCriticalAlert
//      called AFTER tx commits; returns { frozen: true, auditId }
//   2. freezeSkuForReview Resend best-effort — sendCriticalAlert throws; freeze still succeeds
//   3. unfreezeSkuAfterAccept happy path — UPDATE sku_channels + UPDATE audit_log resolved_at;
//      no new audit INSERT; returns { unfrozenAt, action: 'accept' }
//   4. unfreezeSkuAfterAccept not-frozen guard — rowCount=0 → throws SkuChannelNotFrozenError;
//      no resolved_at patch attempted
//   5. unfreezeSkuAfterReject happy path — UPDATE sku_channels (NO list_price_cents mutation) +
//      UPDATE audit_log resolved_at; no new audit INSERT; returns { unfrozenAt, action: 'reject' }
//   6. unfreezeSkuAfterReject not-frozen guard — rowCount=0 → throws SkuChannelNotFrozenError
//
// Negative source-inspection assertions:
//   - anomaly-freeze.js must NOT contain raw INSERT INTO audit_log (ESLint no-raw-INSERT-audit-log)
//   - anomaly-freeze.js must NOT contain console.log (pino only, Constraint #18)
//   - anomaly-freeze.js must NOT contain direct fetch() (Constraint #19)
//   - freezeSkuForReview, unfreezeSkuAfterAccept, unfreezeSkuAfterReject must be exported functions
//   - SkuChannelNotFrozenError must be an exported Error subclass
//
// RESEND_API_KEY env-stub pattern (per memory project_resend_env_stub_import_pattern):
//   anomaly-freeze.js transitively imports shared/resend/client.js which throws at
//   module-load time if RESEND_API_KEY is unset. Static imports are hoisted above
//   top-level statements, so dynamic `await import` is mandatory here.
//
// Run with: node --test tests/worker/safety/anomaly-freeze.test.js
// Or via:   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Stub RESEND_API_KEY BEFORE we dynamically import anomaly-freeze.js, which
// transitively imports shared/resend/client.js (throws at import time when
// RESEND_API_KEY is unset). ESM static imports are hoisted above top-level
// statements, so we MUST dynamic-import the module under test.
// Real Resend never gets called because sendCriticalAlertFn is injected by tests.
if (!process.env.RESEND_API_KEY) {
  process.env.RESEND_API_KEY = 're_test_anomaly_freeze_stub_xxxxxxxxxx';
}

const { freezeSkuForReview, unfreezeSkuAfterAccept, unfreezeSkuAfterReject, SkuChannelNotFrozenError } =
  await import('../../../worker/src/safety/anomaly-freeze.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock tx that captures all SQL calls.
 * Supports per-keyword configurable return values.
 * writeAuditEvent (INSERT) returns { rows: [{ id: 'mock-audit-id' }] }.
 * UPDATE sku_channels (frozen path) returns { rows: [{ id: 'sc-test-uuid' }], rowCount: 1 }.
 * UPDATE sku_channels (already-unfrozen path): caller passes rowCount=0 override.
 *
 * @param {object} [opts]
 * @param {number} [opts.updateSkuChannelsRowCount=1] - Simulates rows-matched on freeze/unfreeze UPDATE
 * @param {object} [opts.updateSkuChannelsReturning] - Rows to return on sku_channels UPDATE RETURNING
 * @returns {{ query: Function, calls: Array<{sql: string, params: Array}> }}
 */
function buildMockTx ({
  updateSkuChannelsRowCount = 1,
  updateSkuChannelsReturning = [{ customer_marketplace_id: 'cm-test-uuid', sku_id: 'sku-test-uuid' }],
} = {}) {
  const calls = [];
  return {
    async query (sql, params) {
      calls.push({ sql, params });
      const sqlUpper = sql.trim().toUpperCase();

      // writeAuditEvent INSERT — must return { rows: [{ id }] }
      if (sqlUpper.startsWith('INSERT') && sql.toLowerCase().includes('audit_log')) {
        return { rows: [{ id: 'mock-audit-id' }], rowCount: 1 };
      }

      // UPDATE sku_channels — rowCount is configurable for the not-frozen guard tests
      if (sqlUpper.startsWith('UPDATE') && sql.toLowerCase().includes('sku_channels')) {
        return {
          rows: updateSkuChannelsRowCount > 0 ? updateSkuChannelsReturning : [],
          rowCount: updateSkuChannelsRowCount,
        };
      }

      // UPDATE audit_log SET resolved_at (unfreeze path)
      if (sqlUpper.startsWith('UPDATE') && sql.toLowerCase().includes('audit_log')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
    get calls () { return calls; },
  };
}

// ---------------------------------------------------------------------------
// Test 1 — freezeSkuForReview happy path
// ---------------------------------------------------------------------------

describe('freezeSkuForReview — happy path (AC8 test 1)', () => {
  test('freezeSkuForReview_happy_path_updates_sku_channels_emits_audit_calls_alert_after_tx', async () => {
    // GIVEN: a mock tx + valid params + a mock sendCriticalAlertFn
    const tx = buildMockTx();
    const alertCalls = [];
    const mockSendCriticalAlert = async (args) => { alertCalls.push(args); };

    // WHEN: freezeSkuForReview is called
    const result = await freezeSkuForReview({
      tx,
      skuChannelId: 'sc-test-uuid',
      skuId: 'sku-test-uuid',
      customerMarketplaceId: 'cm-test-uuid',
      deviationPct: 0.60,
      currentPriceCents: 1000,
      listPriceCents: 2500,
      customerEmail: 'customer@example.com',
      sendCriticalAlertFn: mockSendCriticalAlert,
    });

    // THEN: returns { frozen: true, auditId }
    assert.equal(result.frozen, true, 'freezeSkuForReview must return { frozen: true }');
    assert.ok(result.auditId, 'freezeSkuForReview must return auditId');

    // THEN: UPDATE sku_channels SET frozen_for_anomaly_review = true was issued
    const updateCall = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels')
    );
    assert.ok(updateCall, 'tx must issue UPDATE sku_channels');
    assert.ok(
      c => c.sql.toLowerCase().includes('frozen_for_anomaly_review') || updateCall.sql.toLowerCase().includes('frozen'),
      'UPDATE must set frozen_for_anomaly_review or frozen columns',
    );
    assert.ok(
      updateCall.params.includes('sc-test-uuid') ||
      updateCall.params.some(p => p === 'sc-test-uuid'),
      'UPDATE must target the correct skuChannelId',
    );

    // THEN: INSERT INTO audit_log was issued via writeAuditEvent
    const insertCall = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('INSERT') &&
      c.sql.toLowerCase().includes('audit_log')
    );
    assert.ok(insertCall, 'tx must issue INSERT INTO audit_log (via writeAuditEvent)');
    assert.ok(
      insertCall.params.includes('anomaly-freeze'),
      'audit INSERT must use event_type "anomaly-freeze"',
    );

    // THEN: payload matches PayloadForAnomalyFreeze shape
    const payloadParam = insertCall.params.find(p =>
      typeof p === 'string' && p.includes('previousListPriceCents')
    );
    assert.ok(payloadParam, 'audit INSERT params must include serialised payload with previousListPriceCents');
    const payload = JSON.parse(payloadParam);
    assert.equal(payload.previousListPriceCents, 2500, 'payload.previousListPriceCents must be listPriceCents');
    assert.equal(payload.suspectedListPriceCents, 1000, 'payload.suspectedListPriceCents must be currentPriceCents');
    assert.ok(Math.abs(payload.deviationPct - 0.60) < 0.0001, `payload.deviationPct must be 0.60, got ${payload.deviationPct}`);
    assert.equal(payload.skuId, 'sku-test-uuid', 'payload.skuId must be the passed skuId');

    // THEN: sendCriticalAlert was called (AFTER the tx — best-effort, outside tx)
    assert.equal(alertCalls.length, 1, 'sendCriticalAlertFn must be called exactly once after tx');
  });
});

// ---------------------------------------------------------------------------
// Test 2 — freezeSkuForReview Resend best-effort (sendCriticalAlert throws)
// ---------------------------------------------------------------------------

describe('freezeSkuForReview — Resend best-effort (AC8 test 2)', () => {
  test('freezeSkuForReview_succeeds_even_when_sendCriticalAlert_throws', async () => {
    // GIVEN: a mock sendCriticalAlertFn that throws
    const tx = buildMockTx();
    const mockSendCriticalAlert = async () => {
      throw new Error('Resend delivery failure — simulated error');
    };

    // WHEN: freezeSkuForReview is called with the throwing alert fn
    // THEN: must NOT throw — freeze is not gated on email delivery (AD25 best-effort)
    let result;
    await assert.doesNotReject(
      () => freezeSkuForReview({
        tx,
        skuChannelId: 'sc-test-uuid',
        skuId: 'sku-test-uuid',
        customerMarketplaceId: 'cm-test-uuid',
        deviationPct: 0.60,
        currentPriceCents: 1000,
        listPriceCents: 2500,
        customerEmail: 'customer@example.com',
        sendCriticalAlertFn: mockSendCriticalAlert,
      }).then(r => { result = r; }),
      'freezeSkuForReview must NOT throw when sendCriticalAlertFn throws (best-effort alert)',
    );

    // The freeze itself must have succeeded (DB writes occurred)
    assert.equal(result.frozen, true, 'result.frozen must be true even when alert delivery fails');
    assert.ok(result.auditId, 'result.auditId must be set even when alert delivery fails');

    // The UPDATE and INSERT must have been issued (freeze completed before the alert)
    const updateCall = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels')
    );
    assert.ok(updateCall, 'UPDATE sku_channels must have been issued before alert throws');

    const insertCall = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('INSERT') &&
      c.sql.toLowerCase().includes('audit_log')
    );
    assert.ok(insertCall, 'INSERT audit_log must have been issued before alert throws');
  });
});

// ---------------------------------------------------------------------------
// Test 3 — unfreezeSkuAfterAccept happy path
// ---------------------------------------------------------------------------

describe('unfreezeSkuAfterAccept — happy path (AC8 test 3)', () => {
  test('unfreezeSkuAfterAccept_happy_path_updates_sku_channels_and_patches_audit_resolved_at', async () => {
    // GIVEN: a frozen sku_channel (rowCount=1)
    const tx = buildMockTx({ updateSkuChannelsRowCount: 1 });

    // WHEN: unfreezeSkuAfterAccept is called
    const result = await unfreezeSkuAfterAccept({ tx, skuChannelId: 'sc-test-uuid' });

    // THEN: returns { unfrozenAt, action: 'accept' }
    assert.ok(result.unfrozenAt, 'unfreezeSkuAfterAccept must return unfrozenAt');
    assert.equal(result.action, 'accept', 'unfreezeSkuAfterAccept must return action: "accept"');

    // THEN: UPDATE sku_channels SET list_price_cents = current_price_cents ... frozen_for_anomaly_review=false
    const skuChannelsUpdate = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels')
    );
    assert.ok(skuChannelsUpdate, 'tx must issue UPDATE sku_channels on accept path');
    assert.ok(
      skuChannelsUpdate.sql.toLowerCase().includes('list_price_cents'),
      'accept path UPDATE must set list_price_cents = current_price_cents (absorbs the anomalous price)',
    );
    assert.ok(
      skuChannelsUpdate.sql.toLowerCase().includes('frozen_for_anomaly_review'),
      'accept path UPDATE must reset frozen_for_anomaly_review to false',
    );
    assert.ok(
      skuChannelsUpdate.params.includes('sc-test-uuid') ||
      skuChannelsUpdate.params.some(p => p === 'sc-test-uuid'),
      'accept path UPDATE must target the correct skuChannelId',
    );

    // THEN: UPDATE audit_log SET resolved_at = NOW() for the anomaly-freeze row
    const auditLogUpdate = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('audit_log')
    );
    assert.ok(auditLogUpdate, 'tx must issue UPDATE audit_log SET resolved_at = NOW() on accept path');
    assert.ok(
      auditLogUpdate.sql.toLowerCase().includes('resolved_at'),
      'audit_log UPDATE must set resolved_at',
    );
    assert.ok(
      auditLogUpdate.sql.toLowerCase().includes('anomaly-freeze') ||
      auditLogUpdate.params.includes('anomaly-freeze'),
      'audit_log UPDATE must target rows with event_type = anomaly-freeze',
    );

    // THEN: NO new INSERT INTO audit_log (no "anomaly-resolved" event — AD20 taxonomy locked)
    const insertCall = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('INSERT') &&
      c.sql.toLowerCase().includes('audit_log')
    );
    assert.equal(
      insertCall,
      undefined,
      'unfreezeSkuAfterAccept must NOT INSERT a new audit_log row (no anomaly-resolved event in AD20 taxonomy)',
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4 — unfreezeSkuAfterAccept not-frozen guard (rowCount=0)
// ---------------------------------------------------------------------------

describe('unfreezeSkuAfterAccept — not-frozen guard (AC8 test 4)', () => {
  test('unfreezeSkuAfterAccept_throws_SkuChannelNotFrozenError_when_rowCount_is_zero', async () => {
    // GIVEN: a sku_channel that is already unfrozen / non-existent (rowCount=0)
    const tx = buildMockTx({ updateSkuChannelsRowCount: 0 });

    // WHEN: unfreezeSkuAfterAccept is called
    // THEN: must throw SkuChannelNotFrozenError
    await assert.rejects(
      () => unfreezeSkuAfterAccept({ tx, skuChannelId: 'sc-not-frozen-uuid' }),
      (err) => {
        assert.ok(
          err instanceof SkuChannelNotFrozenError,
          `Expected SkuChannelNotFrozenError, got ${err.constructor.name}: ${err.message}`,
        );
        assert.ok(err.message.length > 0, 'SkuChannelNotFrozenError must have a useful error message');
        return true;
      },
      'unfreezeSkuAfterAccept must throw SkuChannelNotFrozenError when sku_channel is not frozen (rowCount=0)',
    );

    // THEN: NO UPDATE audit_log was issued (guard fires before resolved_at patch)
    const auditLogUpdate = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('audit_log')
    );
    assert.equal(
      auditLogUpdate,
      undefined,
      'must NOT UPDATE audit_log when guard fires (SkuChannelNotFrozenError thrown before resolved_at patch)',
    );
  });
});

// ---------------------------------------------------------------------------
// Test 5 — unfreezeSkuAfterReject happy path
// ---------------------------------------------------------------------------

describe('unfreezeSkuAfterReject — happy path (AC8 test 5)', () => {
  test('unfreezeSkuAfterReject_happy_path_does_not_mutate_list_price_but_patches_audit_resolved_at', async () => {
    // GIVEN: a frozen sku_channel (rowCount=1)
    const tx = buildMockTx({ updateSkuChannelsRowCount: 1 });

    // WHEN: unfreezeSkuAfterReject is called
    const result = await unfreezeSkuAfterReject({ tx, skuChannelId: 'sc-test-uuid' });

    // THEN: returns { unfrozenAt, action: 'reject' }
    assert.ok(result.unfrozenAt, 'unfreezeSkuAfterReject must return unfrozenAt');
    assert.equal(result.action, 'reject', 'unfreezeSkuAfterReject must return action: "reject"');

    // THEN: UPDATE sku_channels — MUST reset frozen flags but MUST NOT touch list_price_cents
    const skuChannelsUpdate = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels')
    );
    assert.ok(skuChannelsUpdate, 'tx must issue UPDATE sku_channels on reject path');
    assert.ok(
      skuChannelsUpdate.sql.toLowerCase().includes('frozen_for_anomaly_review'),
      'reject path UPDATE must reset frozen_for_anomaly_review to false',
    );
    // CRITICAL: reject path must NOT set list_price_cents = current_price_cents
    // (preserves old list_price per epic AC#3 — customer disagreed with the detected price)
    assert.ok(
      !skuChannelsUpdate.sql.toLowerCase().includes('list_price_cents'),
      'reject path UPDATE must NOT mutate list_price_cents — old list_price is preserved (epic AC#3)',
    );

    // THEN: UPDATE audit_log SET resolved_at (same as accept path)
    const auditLogUpdate = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('audit_log')
    );
    assert.ok(auditLogUpdate, 'tx must issue UPDATE audit_log SET resolved_at = NOW() on reject path');

    // THEN: NO new INSERT INTO audit_log (no "anomaly-resolved" event — AD20 taxonomy locked)
    const insertCall = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('INSERT') &&
      c.sql.toLowerCase().includes('audit_log')
    );
    assert.equal(
      insertCall,
      undefined,
      'unfreezeSkuAfterReject must NOT INSERT a new audit_log row (no anomaly-resolved event in AD20 taxonomy)',
    );
  });
});

// ---------------------------------------------------------------------------
// Test 6 — unfreezeSkuAfterReject not-frozen guard (rowCount=0)
// ---------------------------------------------------------------------------

describe('unfreezeSkuAfterReject — not-frozen guard (AC8 test 6)', () => {
  test('unfreezeSkuAfterReject_throws_SkuChannelNotFrozenError_when_rowCount_is_zero', async () => {
    // GIVEN: a sku_channel that is already unfrozen / non-existent (rowCount=0)
    const tx = buildMockTx({ updateSkuChannelsRowCount: 0 });

    // WHEN: unfreezeSkuAfterReject is called
    // THEN: must throw SkuChannelNotFrozenError
    await assert.rejects(
      () => unfreezeSkuAfterReject({ tx, skuChannelId: 'sc-not-frozen-uuid' }),
      (err) => {
        assert.ok(
          err instanceof SkuChannelNotFrozenError,
          `Expected SkuChannelNotFrozenError, got ${err.constructor.name}: ${err.message}`,
        );
        assert.ok(err.message.length > 0, 'SkuChannelNotFrozenError must have a useful error message');
        return true;
      },
      'unfreezeSkuAfterReject must throw SkuChannelNotFrozenError when sku_channel is not frozen (rowCount=0)',
    );

    // THEN: NO UPDATE audit_log was issued (guard fires before resolved_at patch)
    const auditLogUpdate = tx.calls.find(c =>
      c.sql.toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('audit_log')
    );
    assert.equal(
      auditLogUpdate,
      undefined,
      'must NOT UPDATE audit_log when guard fires (SkuChannelNotFrozenError thrown before resolved_at patch)',
    );
  });
});

// ---------------------------------------------------------------------------
// SkuChannelNotFrozenError — class shape assertions
// ---------------------------------------------------------------------------

describe('SkuChannelNotFrozenError — class shape', () => {
  test('SkuChannelNotFrozenError_is_an_Error_subclass_with_correct_name', () => {
    const err = new SkuChannelNotFrozenError('sc-test-uuid');
    assert.ok(err instanceof Error, 'SkuChannelNotFrozenError must be an Error subclass');
    assert.ok(err instanceof SkuChannelNotFrozenError, 'instanceof check must work');
    assert.equal(err.name, 'SkuChannelNotFrozenError', 'err.name must be "SkuChannelNotFrozenError"');
    assert.ok(err.message.length > 0, 'must have a non-empty message');
  });

  test('SkuChannelNotFrozenError_is_correctly_exported_as_named_export', () => {
    // Verify it is a constructor function (class)
    assert.ok(
      typeof SkuChannelNotFrozenError === 'function',
      'SkuChannelNotFrozenError must be exported as a named class/function',
    );
  });
});

// ---------------------------------------------------------------------------
// Export shape assertions
// ---------------------------------------------------------------------------

describe('anomaly-freeze.js — exported function shapes', () => {
  test('freezeSkuForReview_is_an_exported_async_function', () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    assert.ok(
      typeof freezeSkuForReview === 'function',
      'freezeSkuForReview must be an exported function',
    );
    assert.ok(
      freezeSkuForReview instanceof AsyncFunction,
      'freezeSkuForReview must be async (returns a Promise)',
    );
  });

  test('unfreezeSkuAfterAccept_is_an_exported_async_function', () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    assert.ok(
      typeof unfreezeSkuAfterAccept === 'function',
      'unfreezeSkuAfterAccept must be an exported function',
    );
    assert.ok(
      unfreezeSkuAfterAccept instanceof AsyncFunction,
      'unfreezeSkuAfterAccept must be async',
    );
  });

  test('unfreezeSkuAfterReject_is_an_exported_async_function', () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    assert.ok(
      typeof unfreezeSkuAfterReject === 'function',
      'unfreezeSkuAfterReject must be an exported function',
    );
    assert.ok(
      unfreezeSkuAfterReject instanceof AsyncFunction,
      'unfreezeSkuAfterReject must be async',
    );
  });
});

// ---------------------------------------------------------------------------
// AC8 — Negative source-inspection assertions
// ---------------------------------------------------------------------------

describe('AC8 — Negative assertions via source inspection', () => {
  test('anomaly-freeze.js must NOT contain raw INSERT INTO audit_log', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '../../../worker/src/safety/anomaly-freeze.js'),
      'utf-8',
    );

    assert.ok(
      !src.includes('INSERT INTO audit_log'),
      'anomaly-freeze.js must NOT contain raw INSERT INTO audit_log ' +
      '(ESLint no-raw-INSERT-audit-log, Constraint #21 — all audit emission via writeAuditEvent SSoT)',
    );
  });

  test('anomaly-freeze.js must NOT contain console.log', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '../../../worker/src/safety/anomaly-freeze.js'),
      'utf-8',
    );

    assert.ok(
      !src.includes('console.log'),
      'anomaly-freeze.js must NOT use console.log (Constraint #18 — pino only via createWorkerLogger)',
    );
  });

  test('anomaly-freeze.js must NOT contain export default', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '../../../worker/src/safety/anomaly-freeze.js'),
      'utf-8',
    );

    assert.ok(
      !src.includes('export default'),
      'anomaly-freeze.js must only use named exports (no-default-export ESLint rule)',
    );
  });

  test('anomaly-freeze.js must NOT contain direct fetch() call (Constraint #19)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      join(__dirname, '../../../worker/src/safety/anomaly-freeze.js'),
      'utf-8',
    );

    // Direct fetch() calls are banned outside shared/mirakl/ (Constraint #19).
    // anomaly-freeze.js uses shared/resend/client.js for email — never raw fetch.
    assert.ok(
      !(/\bfetch\s*\(/.test(src)),
      'anomaly-freeze.js must NOT call fetch() directly (Constraint #19 — HTTP only via shared/mirakl/ wrappers)',
    );
  });
});
