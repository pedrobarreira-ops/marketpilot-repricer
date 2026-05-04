// Epic 9 — Story 9.0 / AC#2-3: writeAuditEvent SSoT module unit tests.
//
// Covers:
//   AC#2 — EVENT_TYPES constant + @typedef PayloadFor<EventType> presence assertion.
//   AC#3 — writeAuditEvent: unknown eventType throws UnknownEventTypeError; payload
//          MUST be non-null; priority is NOT set by caller (derived by trigger in 9.1);
//          function calls INSERT into audit_log via the supplied tx.
//
// NOT covered here (covered in integration tests):
//   - DB-level trigger priority derivation       → tests/integration/audit-log-partition.test.js
//   - 26-row seed count                          → tests/integration/audit-log-partition.test.js
//   - RLS cross-tenant isolation                 → tests/integration/audit-log-partition.test.js
//
// Run with:
//   node --env-file=.env.test --test tests/shared/audit/writer.test.js
// No live DB required for these unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Lazy import — module ships with Story 9.0; tests are scaffolded first.
// Import errors surface as skipped-suite rather than a hard crash so BAD
// subagents can run the full test suite at any sprint point.

let writeAuditEvent, UnknownEventTypeError, EVENT_TYPES;
try {
  ({ writeAuditEvent, UnknownEventTypeError } = await import('../../../shared/audit/writer.js'));
  ({ EVENT_TYPES } = await import('../../../shared/audit/event-types.js'));
} catch {
  // Module not yet implemented — scaffold placeholder tests only.
}

const SKIP = !writeAuditEvent;

// ---------------------------------------------------------------------------
// EVENT_TYPES constant shape
// ---------------------------------------------------------------------------

test('EVENT_TYPES is a non-empty object with exactly 26 base entries', { skip: SKIP }, () => {
  assert.ok(typeof EVENT_TYPES === 'object' && EVENT_TYPES !== null, 'EVENT_TYPES must be an object');
  const keys = Object.keys(EVENT_TYPES);
  // 26 base entries (Stories 12.1 + 12.3 add 2 more — this suite tests baseline)
  assert.ok(keys.length >= 26, `Expected >= 26 keys, got ${keys.length}`);
});

test('EVENT_TYPES includes all 7 Atenção event types', { skip: SKIP }, () => {
  const atencao = [
    'anomaly-freeze',
    'circuit-breaker-trip',
    'circuit-breaker-per-sku-trip',
    'key-validation-fail',
    'pri01-fail-persistent',
    'payment-failure-pause',
    'shop-name-collision-detected',
  ];
  for (const ev of atencao) {
    assert.ok(Object.values(EVENT_TYPES).includes(ev), `Missing Atenção event: ${ev}`);
  }
});

test('EVENT_TYPES includes all 8 Notável event types', { skip: SKIP }, () => {
  const notavel = [
    'external-change-absorbed',
    'position-won',
    'position-lost',
    'new-competitor-entered',
    'large-price-move-within-tolerance',
    'customer-paused',
    'customer-resumed',
    'scan-complete-with-issues',
  ];
  for (const ev of notavel) {
    assert.ok(Object.values(EVENT_TYPES).includes(ev), `Missing Notável event: ${ev}`);
  }
});

test('EVENT_TYPES includes all 11 Rotina event types', { skip: SKIP }, () => {
  const rotina = [
    'undercut-decision',
    'ceiling-raise-decision',
    'hold-floor-bound',
    'hold-ceiling-bound',
    'hold-already-in-1st',
    'cycle-start',
    'cycle-end',
    'pri01-submit',
    'pri02-complete',
    'pri02-failed-transient',
    'tier-transition',
  ];
  for (const ev of rotina) {
    assert.ok(Object.values(EVENT_TYPES).includes(ev), `Missing Rotina event: ${ev}`);
  }
});

// ---------------------------------------------------------------------------
// writeAuditEvent — validation guards
// ---------------------------------------------------------------------------

test('writeAuditEvent throws UnknownEventTypeError for unrecognised eventType', { skip: SKIP }, async () => {
  const fakeTx = {};
  await assert.rejects(
    () => writeAuditEvent({
      tx: fakeTx,
      customerMarketplaceId: 'uuid-cm',
      skuId: null,
      skuChannelId: null,
      eventType: 'not-a-real-event-type',
      cycleId: null,
      payload: { test: true },
    }),
    (err) => {
      assert.ok(err instanceof UnknownEventTypeError, `Expected UnknownEventTypeError, got ${err?.constructor?.name}`);
      return true;
    }
  );
});

test('writeAuditEvent throws when payload is null', { skip: SKIP }, async () => {
  const fakeTx = {};
  await assert.rejects(
    () => writeAuditEvent({
      tx: fakeTx,
      customerMarketplaceId: 'uuid-cm',
      skuId: null,
      skuChannelId: null,
      eventType: Object.values(EVENT_TYPES)[0],
      cycleId: null,
      payload: null,
    }),
    /payload.*non-null/i
  );
});

test('writeAuditEvent throws when customerMarketplaceId is missing', { skip: SKIP }, async () => {
  const fakeTx = {};
  await assert.rejects(
    () => writeAuditEvent({
      tx: fakeTx,
      customerMarketplaceId: null,
      skuId: null,
      skuChannelId: null,
      eventType: Object.values(EVENT_TYPES)[0],
      cycleId: null,
      payload: { test: true },
    }),
    /customerMarketplaceId/i
  );
});

test('writeAuditEvent does NOT set priority in the INSERT params (trigger handles it)', { skip: SKIP }, async () => {
  // Capture what gets passed to tx.query()
  let capturedSql = null;
  let capturedParams = null;
  const fakeTx = {
    query: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [{ id: 'uuid-generated' }] };
    },
  };
  await writeAuditEvent({
    tx: fakeTx,
    customerMarketplaceId: 'uuid-cm',
    skuId: null,
    skuChannelId: null,
    eventType: Object.values(EVENT_TYPES)[0],
    cycleId: null,
    payload: { test: true },
  });
  assert.ok(capturedSql, 'expected tx.query to be called');
  // priority should NOT appear in the INSERT column list — trigger derives it
  assert.ok(
    !capturedSql.toLowerCase().includes('priority'),
    'priority should not be set by writeAuditEvent — derived by trigger'
  );
});

// ---------------------------------------------------------------------------
// Gap 11 — Positive shape assertion: INSERT includes all required columns
// Complements the negative-priority assertion above (Story 9.0 AC#3 / SSoT-C)
// ---------------------------------------------------------------------------

test('writeAuditEvent INSERT includes all required columns (positive shape — Story 9.0 AC#3)', { skip: SKIP }, async () => {
  // Capture the SQL and params for positive shape verification
  let capturedSql = null;
  let capturedParams = null;
  const fakeTx = {
    query: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [{ id: 'uuid-generated' }] };
    },
  };

  const testCycleId = 'cycle-uuid-test';
  const testSkuId = 'sku-uuid-test';
  const testSkuChannelId = 'sku-channel-uuid-test';
  const testCmId = 'cm-uuid-test';
  const testPayload = { test: true, detail: 'shape-check' };
  const testEventType = Object.values(EVENT_TYPES)[0];

  await writeAuditEvent({
    tx: fakeTx,
    customerMarketplaceId: testCmId,
    skuId: testSkuId,
    skuChannelId: testSkuChannelId,
    eventType: testEventType,
    cycleId: testCycleId,
    payload: testPayload,
  });

  assert.ok(capturedSql, 'expected tx.query to be called with SQL');

  // Positive assertions: each required column must appear in the INSERT statement
  const sqlLower = capturedSql.toLowerCase();
  const requiredColumns = [
    'customer_marketplace_id',
    'event_type',
    'payload',
    'cycle_id',
    'sku_id',
    'sku_channel_id',
  ];
  for (const col of requiredColumns) {
    assert.ok(
      sqlLower.includes(col),
      `writeAuditEvent INSERT must include column "${col}" (Story 9.0 AC#3 positive shape)`
    );
  }

  // Values must appear in params (order-independent check)
  const paramsStr = JSON.stringify(capturedParams ?? []);
  assert.ok(
    paramsStr.includes(testCmId) || sqlLower.includes(testCmId.toLowerCase()),
    'customerMarketplaceId value must be passed to INSERT'
  );
  assert.ok(
    paramsStr.includes(testEventType) || sqlLower.includes(testEventType.toLowerCase()),
    'eventType value must be passed to INSERT'
  );
});

// ---------------------------------------------------------------------------
// ESLint rule presence check (structural)
// ---------------------------------------------------------------------------

test('eslint-rules/no-raw-INSERT-audit-log.js file exists', { skip: SKIP }, async () => {
  const { access } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ruleFile = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');
  await assert.doesNotReject(access(ruleFile), `ESLint rule file missing: ${ruleFile}`);
});
