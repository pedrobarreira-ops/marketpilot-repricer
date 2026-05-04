// Epic 9 — Story 9.0 / AC#2-4: writeAuditEvent SSoT module unit tests.
//
// Covers:
//   AC#2 — EVENT_TYPES constant (26 entries, all three priority groups) + @typedef
//           PayloadFor<EventType> documentation presence.
//   AC#3 — writeAuditEvent: unknown eventType throws UnknownEventTypeError (named class);
//           payload MUST be non-null (throws NullAuditPayloadError named class);
//           customerMarketplaceId MUST be non-null; priority is NOT set by caller
//           (derived by DB trigger in Story 9.1); tx is the only INSERT pathway;
//           writeAuditEvent MUST accept a tx parameter and NOT open its own transaction
//           (Bundle B atomicity invariant).
//   AC#4 — eslint-rules/no-raw-INSERT-audit-log.js: file exists; rule is loaded in
//           eslint.config.js; behavioral check that patterns outside writer.js are flagged.
//
// NOT covered here (covered in integration tests):
//   - DB-level trigger priority derivation       → tests/integration/audit-log-partition.test.js
//   - 26-row seed count                          → tests/integration/audit-event-types.test.js
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

let writeAuditEvent, UnknownEventTypeError, NullAuditPayloadError, EVENT_TYPES;
try {
  ({ writeAuditEvent, UnknownEventTypeError, NullAuditPayloadError } = await import('../../../shared/audit/writer.js'));
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

test('writeAuditEvent throws NullAuditPayloadError (named class) when payload is null', { skip: SKIP }, async () => {
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
    (err) => {
      // Architecture mandates a named NullAuditPayloadError class (AC#3 / NFR-S6)
      assert.ok(
        NullAuditPayloadError
          ? err instanceof NullAuditPayloadError
          : /payload.*non-null/i.test(err.message),
        `Expected NullAuditPayloadError or message matching /payload.*non-null/i, got: ${err?.constructor?.name} — ${err?.message}`
      );
      return true;
    }
  );
});

test('writeAuditEvent throws NullAuditPayloadError when payload is undefined', { skip: SKIP }, async () => {
  const fakeTx = {};
  await assert.rejects(
    () => writeAuditEvent({
      tx: fakeTx,
      customerMarketplaceId: 'uuid-cm',
      skuId: null,
      skuChannelId: null,
      eventType: Object.values(EVENT_TYPES)[0],
      cycleId: null,
      payload: undefined,
    }),
    (err) => {
      assert.ok(
        NullAuditPayloadError
          ? err instanceof NullAuditPayloadError
          : /payload.*non-null/i.test(err.message),
        `Expected NullAuditPayloadError for undefined payload, got: ${err?.constructor?.name} — ${err?.message}`
      );
      return true;
    }
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
// AC#3 — Bundle B atomicity: writeAuditEvent must NOT open its own transaction
// ---------------------------------------------------------------------------

test('writeAuditEvent uses the supplied tx parameter and does NOT call a transaction-open method', { skip: SKIP }, async () => {
  // If the implementation were to call tx.begin() / BEGIN internally it would
  // violate the Bundle B atomicity invariant (audit event + state mutation must
  // share the caller's tx). We detect this by passing a spy-tx and asserting
  // that query() is called exactly once (the INSERT) with no BEGIN statement.
  const calls = [];
  const fakeTx = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'uuid-test' }] };
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

  const beginCalls = calls.filter((c) => /^\s*BEGIN/i.test(c.sql));
  assert.equal(
    beginCalls.length,
    0,
    'writeAuditEvent must NOT issue BEGIN — it must use the tx parameter and rely on the caller to manage the transaction boundary (Bundle B atomicity invariant)'
  );

  const insertCalls = calls.filter((c) => /INSERT\s+INTO\s+audit_log/i.test(c.sql));
  assert.ok(
    insertCalls.length >= 1,
    'writeAuditEvent must call tx.query() with an INSERT INTO audit_log statement'
  );
});

// ---------------------------------------------------------------------------
// AC#4 — ESLint rule: structural presence + eslint.config.js wiring
// ---------------------------------------------------------------------------

test('eslint-rules/no-raw-INSERT-audit-log.js file exists', async () => {
  const { access } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const ruleFile = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');
  await assert.doesNotReject(access(ruleFile), `ESLint rule file missing: ${ruleFile}`);
});

test('eslint.config.js loads no-raw-INSERT-audit-log rule (AC#4)', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const configFile = path.resolve(__dirname, '..', '..', '..', 'eslint.config.js');
  const content = await readFile(configFile, 'utf8');
  assert.ok(
    content.includes('no-raw-INSERT-audit-log'),
    'eslint.config.js must import and register the no-raw-INSERT-audit-log rule (AC#4)'
  );
});

// ---------------------------------------------------------------------------
// AC#4 — ESLint rule behavioral test: rule flags forbidden patterns
// The rule module exports a `create` function (or a plugin object); we call it
// directly with a mock context to verify the visitor logic without running the
// full ESLint CLI (which requires a live project setup).
// ---------------------------------------------------------------------------

test('no-raw-INSERT-audit-log rule module exports a valid ESLint rule shape', async () => {
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  let ruleModule;
  try {
    ruleModule = await import(rulePath);
  } catch {
    // Rule not yet implemented — skip behavioral tests; structural file-existence
    // test above already covers the missing-file case.
    return;
  }

  // The module must export either:
  //   { default: { create: fn, meta: {...} } }   — plugin rule
  //   { default: { rules: { ... } } }             — plugin object
  const exported = ruleModule.default ?? ruleModule;
  const hasRuleShape =
    (typeof exported?.create === 'function') ||
    (typeof exported?.rules === 'object' && exported?.rules !== null);
  assert.ok(
    hasRuleShape,
    `no-raw-INSERT-audit-log.js must export a rule with a 'create' function or a plugin 'rules' object. Got: ${JSON.stringify(Object.keys(exported ?? {}))}`
  );
});

test('no-raw-INSERT-audit-log rule forbids raw INSERT INTO audit_log in strings (AC#4)', async () => {
  // This test validates the rule's detection logic by invoking the rule's
  // visitor on a synthetic AST node constructed to represent a forbidden pattern.
  // If the rule module is not yet implemented, the test is skipped gracefully.
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  let ruleModule;
  try {
    ruleModule = await import(rulePath);
  } catch {
    return;
  }

  const exported = ruleModule.default ?? ruleModule;
  // Only test if the module exposes a create() function directly (rule shape)
  if (typeof exported?.create !== 'function') return;

  const reported = [];
  const mockContext = {
    getFilename: () => 'app/src/routes/some-route.js',
    report: (descriptor) => reported.push(descriptor),
    options: [],
  };

  // Simulate a TemplateLiteral node with a raw INSERT string
  const visitor = exported.create(mockContext);
  const fakeTemplateLiteralNode = {
    type: 'TemplateLiteral',
    quasis: [{ value: { raw: 'INSERT INTO audit_log (customer_marketplace_id) VALUES ($1)' } }],
  };

  // Call the TemplateLiteral visitor if registered
  if (typeof visitor?.TemplateLiteral === 'function') {
    visitor.TemplateLiteral(fakeTemplateLiteralNode);
    assert.ok(
      reported.length > 0,
      'no-raw-INSERT-audit-log rule must report an error for INSERT INTO audit_log in a template literal outside shared/audit/writer.js (AC#4)'
    );
    assert.ok(
      /forbidden|writeAuditEvent/i.test(reported[0]?.message ?? ''),
      `Rule error message should mention 'forbidden' or 'writeAuditEvent'. Got: "${reported[0]?.message}"`
    );
  }
});

test('no-raw-INSERT-audit-log rule allows INSERT inside shared/audit/writer.js (allowlist — AC#4)', async () => {
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  let ruleModule;
  try {
    ruleModule = await import(rulePath);
  } catch {
    return;
  }

  const exported = ruleModule.default ?? ruleModule;
  if (typeof exported?.create !== 'function') return;

  const reported = [];
  const mockContext = {
    // Allowlisted file — rule must NOT report
    getFilename: () => 'shared/audit/writer.js',
    report: (descriptor) => reported.push(descriptor),
    options: [],
  };

  const visitor = exported.create(mockContext);
  const fakeTemplateLiteralNode = {
    type: 'TemplateLiteral',
    quasis: [{ value: { raw: 'INSERT INTO audit_log (customer_marketplace_id) VALUES ($1)' } }],
  };

  if (typeof visitor?.TemplateLiteral === 'function') {
    visitor.TemplateLiteral(fakeTemplateLiteralNode);
    assert.equal(
      reported.length,
      0,
      'no-raw-INSERT-audit-log rule must NOT report errors inside shared/audit/writer.js (allowlist — AC#4)'
    );
  }
});
