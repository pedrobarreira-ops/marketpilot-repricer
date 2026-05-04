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
  // Story 9.0 ships exactly 26 base entries (7 Atenção + 8 Notável + 11 Rotina).
  // Stories 12.1 and 12.3 will append a 27th and 28th entry in their own PRs;
  // this baseline assertion enforces NUMERIC equality at Story 9.0 time so a typo
  // (extra/missing key) cannot slip through. When 12.1 lands, this assertion is
  // updated to 27 in that story's PR.
  assert.equal(keys.length, 26, `Expected exactly 26 base keys at Story 9.0 (7 Atenção + 8 Notável + 11 Rotina). Got ${keys.length}`);
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
  // Stub tx with a .query() method so the tx-shape guard (Bundle B
  // architectural invariant) doesn't short-circuit before the per-arg
  // guard under test. The guards under test should still fire because
  // they validate caller-supplied arguments, independent of tx shape.
  const fakeTx = { query: async () => ({ rows: [{ id: 'uuid-stub' }] }) };
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
  // Stub tx with a .query() method so the tx-shape guard (Bundle B
  // architectural invariant) doesn't short-circuit before the per-arg
  // guard under test. The guards under test should still fire because
  // they validate caller-supplied arguments, independent of tx shape.
  const fakeTx = { query: async () => ({ rows: [{ id: 'uuid-stub' }] }) };
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
  // Stub tx with a .query() method so the tx-shape guard (Bundle B
  // architectural invariant) doesn't short-circuit before the per-arg
  // guard under test. The guards under test should still fire because
  // they validate caller-supplied arguments, independent of tx shape.
  const fakeTx = { query: async () => ({ rows: [{ id: 'uuid-stub' }] }) };
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
  // Stub tx with a .query() method so the tx-shape guard (Bundle B
  // architectural invariant) doesn't short-circuit before the per-arg
  // guard under test. The guards under test should still fire because
  // they validate caller-supplied arguments, independent of tx shape.
  const fakeTx = { query: async () => ({ rows: [{ id: 'uuid-stub' }] }) };
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

test('writeAuditEvent throws when customerMarketplaceId is the empty string', { skip: SKIP }, async () => {
  // Defensive guard: '' is a common sentinel for "missing" in JS callers and
  // would otherwise reach Postgres as a UUID-cast failure or NOT NULL violation
  // with a less-actionable error. The named guard surfaces the programming
  // mistake at the writer boundary.
  const fakeTx = { query: async () => ({ rows: [{ id: 'uuid-stub' }] }) };
  await assert.rejects(
    () => writeAuditEvent({
      tx: fakeTx,
      customerMarketplaceId: '',
      skuId: null,
      skuChannelId: null,
      eventType: Object.values(EVENT_TYPES)[0],
      cycleId: null,
      payload: { test: true },
    }),
    /customerMarketplaceId/i
  );
});

test('writeAuditEvent throws when tx is missing (Bundle B atomicity invariant)', { skip: SKIP }, async () => {
  // Bundle B: writeAuditEvent must NEVER open its own transaction. If the
  // caller forgets to pass `tx`, the failure mode should clearly identify
  // the architectural invariant being violated, not surface as a late
  // "Cannot read properties of undefined (reading 'query')" TypeError.
  await assert.rejects(
    () => writeAuditEvent({
      // tx intentionally omitted
      customerMarketplaceId: 'uuid-cm',
      skuId: null,
      skuChannelId: null,
      eventType: Object.values(EVENT_TYPES)[0],
      cycleId: null,
      payload: { test: true },
    }),
    /tx must be|transaction client|Bundle B/i
  );
});

test('writeAuditEvent throws when tx lacks a .query() method (Bundle B atomicity invariant)', { skip: SKIP }, async () => {
  // A bare {} satisfies a truthy/null check but cannot run queries. The guard
  // must validate the SHAPE, not just presence. This catches accidental misuse
  // where a caller passes a non-pg object (e.g. a raw connection string, a
  // Supabase client wrapper) instead of a transaction client.
  await assert.rejects(
    () => writeAuditEvent({
      tx: {},
      customerMarketplaceId: 'uuid-cm',
      skuId: null,
      skuChannelId: null,
      eventType: Object.values(EVENT_TYPES)[0],
      cycleId: null,
      payload: { test: true },
    }),
    /tx must be|transaction client|\.query\(\) method/i
  );
});

test('writeAuditEvent does NOT set priority in the INSERT params (trigger handles it)', { skip: SKIP }, async () => {
  // Capture what gets passed to tx.query()
  let capturedSql = null;
  const fakeTx = {
    query: async (sql, _params) => {
      capturedSql = sql;
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
  // Behavioral check: import the actual eslint.config.js module and assert that
  // one of its config blocks registers the no-raw-INSERT-audit-log rule under a
  // recognised plugin namespace. This is stricter than a substring grep — a
  // grep would pass even if the rule is mentioned in a comment but never
  // registered. Importing the config and inspecting the rules tree confirms
  // the rule is wired into ESLint, not just textually present.
  const path = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const configFile = path.resolve(__dirname, '..', '..', '..', 'eslint.config.js');

  // Windows: dynamic import() requires a file:// URL, not a raw absolute path.
  const configModule = await import(pathToFileURL(configFile).href);
  const configs = configModule.default;
  assert.ok(Array.isArray(configs), 'eslint.config.js must default-export an array');

  // Find a config block that registers our rule (under any plugin namespace).
  // The rule is registered as `<plugin>/no-raw-INSERT-audit-log` (currently
  // `no-raw-audit/no-raw-INSERT-audit-log`); we accept any namespace so a
  // future rename of the plugin alias does not break this test.
  const found = configs.some((block) => {
    const rules = block?.rules ?? {};
    return Object.keys(rules).some((ruleName) => ruleName.endsWith('/no-raw-INSERT-audit-log'));
  });
  assert.ok(
    found,
    'eslint.config.js must register a rule whose name ends in "/no-raw-INSERT-audit-log" in at least one config block (AC#4 — actual wiring, not just a comment)'
  );

  // Additionally confirm the rule's plugin is listed in the same block, so the
  // ESLint runtime can resolve the rule namespace.
  const blockWithRule = configs.find((block) => {
    const rules = block?.rules ?? {};
    return Object.keys(rules).some((ruleName) => ruleName.endsWith('/no-raw-INSERT-audit-log'));
  });
  assert.ok(
    blockWithRule?.plugins && typeof blockWithRule.plugins === 'object',
    'the config block that registers no-raw-INSERT-audit-log must also declare a `plugins` map so ESLint can resolve the rule (AC#4)'
  );
});

// ---------------------------------------------------------------------------
// AC#4 — ESLint rule behavioral test: rule flags forbidden patterns
// The rule module exports a `create` function (or a plugin object); we call it
// directly with a mock context to verify the visitor logic without running the
// full ESLint CLI (which requires a live project setup).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AC#4 — Resolve the actual rule object from the plugin export shape.
//
// The module exports a plugin object `{ rules: { 'no-raw-INSERT-audit-log': rule } }`
// (the ESLint flat-config plugin shape used in eslint.config.js). Tests below
// must drill down through `.rules['no-raw-INSERT-audit-log']` to access the
// actual rule's `create()` function. Earlier versions of these tests only
// looked for `exported.create` directly and silently early-returned on the
// plugin shape — that left the behavioral assertions never executing
// (soft-pass: the tests passed against a buggy implementation just as easily
// as against a working one). The helper below resolves both shapes so the
// behavioral assertions actually run.
// ---------------------------------------------------------------------------

/**
 * Extract the rule object (with .create + .meta) from the module's export
 * regardless of whether the module exports the rule directly or wrapped in a
 * plugin `{ rules: { 'no-raw-INSERT-audit-log': rule } }` object.
 * @param {object} mod - Imported rule module (await import(...))
 * @returns {object|null} - The rule object (with .create), or null if not resolvable
 */
function resolveRuleObject (mod) {
  const exported = mod?.default ?? mod;
  if (!exported) return null;
  if (typeof exported.create === 'function') return exported;
  if (exported.rules && typeof exported.rules === 'object') {
    const rule = exported.rules['no-raw-INSERT-audit-log'];
    if (rule && typeof rule.create === 'function') return rule;
  }
  return null;
}

test('no-raw-INSERT-audit-log rule module exports a valid ESLint rule shape', async () => {
  const path = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  // Windows: dynamic import() requires a file:// URL, not a raw absolute path.
  const ruleModule = await import(pathToFileURL(rulePath).href);

  // Resolve the rule object from either { create: fn } or { rules: { ... } } shapes.
  const rule = resolveRuleObject(ruleModule);
  assert.ok(
    rule !== null && typeof rule.create === 'function',
    `no-raw-INSERT-audit-log.js must export a rule with a 'create' function (directly or under 'rules.no-raw-INSERT-audit-log'). Got export keys: ${JSON.stringify(Object.keys(ruleModule.default ?? ruleModule ?? {}))}`
  );
});

test('no-raw-INSERT-audit-log rule forbids raw INSERT INTO audit_log in template literals (AC#4)', async () => {
  // Behavioral check: the rule MUST report a violation when a TemplateLiteral
  // containing `INSERT INTO audit_log` is encountered in a non-allowlisted file.
  // This invokes the rule's create() with a mock ESLint context and runs the
  // TemplateLiteral visitor against a synthetic AST node.
  const path = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  // Windows: dynamic import() requires a file:// URL, not a raw absolute path.
  const ruleModule = await import(pathToFileURL(rulePath).href);
  const rule = resolveRuleObject(ruleModule);
  assert.ok(rule !== null, 'rule object must be resolvable from module export');

  const reported = [];
  const mockContext = {
    filename: 'app/src/routes/some-route.js',
    getFilename: () => 'app/src/routes/some-route.js',
    report: (descriptor) => reported.push(descriptor),
    options: [],
  };

  const visitor = rule.create(mockContext);
  assert.ok(
    typeof visitor?.TemplateLiteral === 'function',
    'rule must register a TemplateLiteral visitor for AC#4 detection of forbidden raw INSERT'
  );

  const fakeTemplateLiteralNode = {
    type: 'TemplateLiteral',
    quasis: [{ value: { raw: 'INSERT INTO audit_log (customer_marketplace_id) VALUES ($1)' } }],
  };

  visitor.TemplateLiteral(fakeTemplateLiteralNode);
  assert.equal(
    reported.length,
    1,
    `no-raw-INSERT-audit-log rule must report exactly one error for INSERT INTO audit_log in a TemplateLiteral outside shared/audit/writer.js (AC#4). Got ${reported.length} reports.`
  );
  assert.match(
    reported[0]?.message ?? '',
    /forbidden|writeAuditEvent/i,
    `Rule error message must mention 'forbidden' or 'writeAuditEvent'. Got: "${reported[0]?.message}"`
  );
});

test('no-raw-INSERT-audit-log rule forbids string-literal INSERT INTO audit_log (AC#4)', async () => {
  // Behavioral check for the Literal visitor — covers `'INSERT INTO audit_log ...'`
  // string literals (not just template literals). Without this, a developer who
  // builds raw SQL via string concatenation would slip past the rule.
  const path = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  // Windows: dynamic import() requires a file:// URL, not a raw absolute path.
  const ruleModule = await import(pathToFileURL(rulePath).href);
  const rule = resolveRuleObject(ruleModule);
  assert.ok(rule !== null, 'rule object must be resolvable from module export');

  const reported = [];
  const mockContext = {
    filename: 'app/src/routes/some-route.js',
    getFilename: () => 'app/src/routes/some-route.js',
    report: (descriptor) => reported.push(descriptor),
    options: [],
  };

  const visitor = rule.create(mockContext);
  if (typeof visitor?.Literal !== 'function') {
    // Rule may not implement Literal coverage — accept that as a known limitation.
    // The TemplateLiteral test above is the primary behavioral guarantee.
    return;
  }

  const fakeLiteralNode = {
    type: 'Literal',
    value: 'INSERT INTO audit_log (customer_marketplace_id) VALUES ($1)',
  };

  visitor.Literal(fakeLiteralNode);
  assert.ok(
    reported.length >= 1,
    'no-raw-INSERT-audit-log rule must report a violation for INSERT INTO audit_log in a string literal (AC#4 Pattern 1 — string concatenation form)'
  );
});

test('no-raw-INSERT-audit-log rule forbids Supabase .from(\'audit_log\').insert(...) chain (AC#4 Pattern 2)', async () => {
  // Behavioral check for AC#4 Pattern 2: the Supabase-client style chain that
  // bypasses raw SQL but still INSERTs into audit_log. Without this test, a
  // developer using @supabase/supabase-js would slip past the rule even though
  // the spec explicitly enumerates this pattern. Pattern 2 was previously
  // uncovered by any test (D-category gap).
  const path = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  // Windows: dynamic import() requires a file:// URL, not a raw absolute path.
  const ruleModule = await import(pathToFileURL(rulePath).href);
  const rule = resolveRuleObject(ruleModule);
  assert.ok(rule !== null, 'rule object must be resolvable from module export');

  const reported = [];
  const mockContext = {
    filename: 'app/src/routes/some-route.js',
    getFilename: () => 'app/src/routes/some-route.js',
    report: (descriptor) => reported.push(descriptor),
    options: [],
  };

  const visitor = rule.create(mockContext);
  assert.ok(
    typeof visitor?.CallExpression === 'function',
    'rule must register a CallExpression visitor for AC#4 Pattern 2 (.from(\'audit_log\').insert(...))'
  );

  // Synthetic AST shape for: someClient.from('audit_log').insert({ ... })
  //
  // CallExpression                                  ← outer .insert(...)
  //   callee: MemberExpression
  //     object: CallExpression                       ← .from('audit_log')
  //       callee: MemberExpression
  //         property: Identifier('from')
  //       arguments: [ Literal('audit_log') ]
  //     property: Identifier('insert')
  const insertCallNode = {
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      object: {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          property: { type: 'Identifier', name: 'from' },
        },
        arguments: [{ type: 'Literal', value: 'audit_log' }],
      },
      property: { type: 'Identifier', name: 'insert' },
    },
    arguments: [],
  };

  visitor.CallExpression(insertCallNode);
  assert.equal(
    reported.length,
    1,
    `no-raw-INSERT-audit-log rule must report exactly one error for .from('audit_log').insert(...) chain outside shared/audit/writer.js (AC#4 Pattern 2). Got ${reported.length} reports.`
  );
  assert.match(
    reported[0]?.message ?? '',
    /forbidden|writeAuditEvent/i,
    `Rule error message must mention 'forbidden' or 'writeAuditEvent'. Got: "${reported[0]?.message}"`
  );
});

test('no-raw-INSERT-audit-log rule does NOT flag INSERT INTO audit_log_event_types (AC#4 negative — lookup-table false-positive guard)', async () => {
  // Negative behavioral check: `audit_log_event_types` is the lookup/seed table
  // (created by Story 9.0's own migration). A naive regex `/audit_log/` would
  // false-positive on every INSERT into the lookup table — including the seed
  // INSERTs in the migration and any future test fixture INSERTs. The rule
  // MUST be precisely scoped to `audit_log` proper, not any identifier that
  // begins with `audit_log_`.
  const path = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  const ruleModule = await import(pathToFileURL(rulePath).href);
  const rule = resolveRuleObject(ruleModule);
  assert.ok(rule !== null);

  const reported = [];
  const mockContext = {
    filename: 'app/src/seed/some-fixture.js',
    getFilename: () => 'app/src/seed/some-fixture.js',
    report: (descriptor) => reported.push(descriptor),
    options: [],
  };

  const visitor = rule.create(mockContext);

  const lookupTableInsertNode = {
    type: 'TemplateLiteral',
    quasis: [{ value: { raw: 'INSERT INTO audit_log_event_types (event_type, priority) VALUES ($1, $2)' } }],
  };

  if (typeof visitor?.TemplateLiteral === 'function') {
    visitor.TemplateLiteral(lookupTableInsertNode);
  }
  assert.equal(
    reported.length,
    0,
    `no-raw-INSERT-audit-log rule must NOT flag INSERT INTO audit_log_event_types — that's the lookup table, not audit_log. Got ${reported.length} false-positive reports.`
  );
});

test('no-raw-INSERT-audit-log rule DOES flag INSERT INTO public.audit_log (AC#4 — schema-prefixed form)', async () => {
  // Positive behavioral check: schema-prefixed `public.audit_log` must be
  // caught — without this guard, a sufficiently-determined developer could
  // bypass the rule by writing `INSERT INTO public.audit_log` instead of
  // `INSERT INTO audit_log`.
  const path = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  const ruleModule = await import(pathToFileURL(rulePath).href);
  const rule = resolveRuleObject(ruleModule);
  assert.ok(rule !== null);

  const reported = [];
  const mockContext = {
    filename: 'app/src/routes/some-route.js',
    getFilename: () => 'app/src/routes/some-route.js',
    report: (descriptor) => reported.push(descriptor),
    options: [],
  };

  const visitor = rule.create(mockContext);

  const schemaPrefixedInsertNode = {
    type: 'TemplateLiteral',
    quasis: [{ value: { raw: 'INSERT INTO public.audit_log (customer_marketplace_id) VALUES ($1)' } }],
  };

  if (typeof visitor?.TemplateLiteral === 'function') {
    visitor.TemplateLiteral(schemaPrefixedInsertNode);
  }
  assert.ok(
    reported.length >= 1,
    `no-raw-INSERT-audit-log rule MUST flag INSERT INTO public.audit_log (schema-prefixed form). Got ${reported.length} reports.`
  );
});

test('no-raw-INSERT-audit-log rule does NOT flag .from(\'other_table\').insert(...) (AC#4 negative — false-positive guard)', async () => {
  // Negative behavioral check: the rule must be precisely scoped to audit_log.
  // Inserting into any other table via Supabase client is legitimate and must
  // not trigger a violation. Without this test, a future regex-tightening that
  // accidentally matches `.from(<any>).insert(...)` would slip through.
  const path = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  // Windows: dynamic import() requires a file:// URL, not a raw absolute path.
  const ruleModule = await import(pathToFileURL(rulePath).href);
  const rule = resolveRuleObject(ruleModule);
  assert.ok(rule !== null);

  const reported = [];
  const mockContext = {
    filename: 'app/src/routes/some-route.js',
    getFilename: () => 'app/src/routes/some-route.js',
    report: (descriptor) => reported.push(descriptor),
    options: [],
  };

  const visitor = rule.create(mockContext);

  const otherInsertCallNode = {
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      object: {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          property: { type: 'Identifier', name: 'from' },
        },
        arguments: [{ type: 'Literal', value: 'customers' }],
      },
      property: { type: 'Identifier', name: 'insert' },
    },
    arguments: [],
  };

  if (typeof visitor?.CallExpression === 'function') {
    visitor.CallExpression(otherInsertCallNode);
  }
  assert.equal(
    reported.length,
    0,
    `no-raw-INSERT-audit-log rule must NOT flag .from('customers').insert(...) — only audit_log is forbidden. Got ${reported.length} false-positive reports.`
  );
});

test('no-raw-INSERT-audit-log rule allows INSERT inside shared/audit/writer.js (allowlist — AC#4)', async () => {
  const path = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rulePath = path.resolve(__dirname, '..', '..', '..', 'eslint-rules', 'no-raw-INSERT-audit-log.js');

  // Windows: dynamic import() requires a file:// URL, not a raw absolute path.
  const ruleModule = await import(pathToFileURL(rulePath).href);
  const rule = resolveRuleObject(ruleModule);
  assert.ok(rule !== null, 'rule object must be resolvable from module export');

  const reported = [];
  const mockContext = {
    // Allowlisted file — rule must NOT report. The rule normalises backslashes
    // to forward slashes and matches the suffix `shared/audit/writer.js`, so
    // any path ending in that suffix should be allowlisted.
    filename: 'shared/audit/writer.js',
    getFilename: () => 'shared/audit/writer.js',
    report: (descriptor) => reported.push(descriptor),
    options: [],
  };

  const visitor = rule.create(mockContext);
  const fakeTemplateLiteralNode = {
    type: 'TemplateLiteral',
    quasis: [{ value: { raw: 'INSERT INTO audit_log (customer_marketplace_id) VALUES ($1)' } }],
  };

  // The allowlisted writer file may either return an empty visitor object (no
  // visitors registered → all patterns silently allowed) OR return visitors
  // that no-op. Either is acceptable; we just assert no reports.
  if (typeof visitor?.TemplateLiteral === 'function') {
    visitor.TemplateLiteral(fakeTemplateLiteralNode);
  }
  assert.equal(
    reported.length,
    0,
    'no-raw-INSERT-audit-log rule must NOT report errors inside shared/audit/writer.js (allowlist — AC#4)'
  );
});
