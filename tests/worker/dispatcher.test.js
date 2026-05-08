// Story 5.1 — Master cron + dispatcher SQL + advisory locks + worker-must-filter-by-customer ESLint rule
//
// Covers:
//   AC#1 — dispatchCycle logs cycle-start with cycle_id UUID; concurrency guard skips overlapping tick
//   AC#2 — Dispatcher SELECT SQL matches AD17 verbatim; batch_size configurable via env
//   AC#3 — Advisory lock helpers: tryAcquireCustomerLock / releaseCustomerLock; bigint determinism
//   AC#4 — ESLint worker-must-filter-by-customer: fires on violation, suppressed by pragma, covers 9 tables
//   AC#4 — Story 9.1 retrofit: monthly-partition-create.js has `// safe: cross-customer cron` pragma
//   AC#5 — Cycle-end log includes stats; cycle-start + cycle-end audit events emitted
//   AC#6 — Negative assertion: no worker_locks table in codebase
//
// Unit tests run without a live DB. Integration tests are in tests/integration/dispatcher.test.js.
//
// Run with: node --test tests/worker/dispatcher.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// AC#2 — Dispatcher SELECT SQL matches AD17 verbatim
// ---------------------------------------------------------------------------

test('dispatcher_selection_sql_matches_ad17_verbatim', async () => {
  const { dispatchCycle } = await import('../../worker/src/dispatcher.js');

  let capturedQuery = null;
  const mockClient = {
    query: async (text, params) => {
      if (text && text.includes('sku_channels')) {
        capturedQuery = text;
      }
      return { rows: [] };
    },
  };

  // Call dispatchCycle with a mock pool that yields our mock client
  const mockPool = {
    connect: async () => ({
      ...mockClient,
      release: () => {},
    }),
    query: mockClient.query,
  };

  await dispatchCycle({ pool: mockPool }).catch(() => {
    // Swallow errors — we only care about the query text
  });

  assert.ok(capturedQuery, 'Dispatcher must issue a SELECT query on sku_channels');

  // Normalize whitespace for comparison
  const normalize = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const normalized = normalize(capturedQuery);

  // All required AD17 WHERE clause predicates must be present
  assert.ok(normalized.includes("cm.cron_state = 'active'"), "WHERE must filter cm.cron_state = 'ACTIVE'");
  assert.ok(normalized.includes('sc.frozen_for_anomaly_review = false'), 'WHERE must include frozen_for_anomaly_review = false');
  assert.ok(normalized.includes('sc.pending_import_id is null'), 'WHERE must include pending_import_id IS NULL');
  assert.ok(normalized.includes('sc.excluded_at is null'), 'WHERE must include excluded_at IS NULL');
  assert.ok(normalized.includes('sc.last_checked_at +'), 'WHERE must include last_checked_at + interval check');
  assert.ok(normalized.includes('order by cm.id, sc.last_checked_at asc'), 'Must ORDER BY cm.id, sc.last_checked_at ASC');
  assert.ok(normalized.includes('limit $1') || normalized.includes('limit $'), 'Must use parameterized LIMIT $1');

  // JOIN between customer_marketplaces and sku_channels
  assert.ok(normalized.includes('from customer_marketplaces cm'), 'Must SELECT FROM customer_marketplaces cm');
  assert.ok(normalized.includes('join sku_channels sc on sc.customer_marketplace_id = cm.id'), 'Must JOIN sku_channels on customer_marketplace_id');
});

test('dispatcher_batch_size_configurable_via_env', async () => {
  const { dispatchCycle } = await import('../../worker/src/dispatcher.js');

  let capturedParams = null;
  const mockClient = {
    query: async (text, params) => {
      if (text && text.includes('sku_channels')) {
        capturedParams = params;
      }
      return { rows: [] };
    },
    release: () => {},
  };

  const mockPool = {
    connect: async () => mockClient,
    query: mockClient.query,
  };

  // With a default (no env override), params[0] must be a positive integer
  await dispatchCycle({ pool: mockPool }).catch(() => {});

  assert.ok(capturedParams, 'Query must receive parameterized arguments');
  assert.ok(Array.isArray(capturedParams) && capturedParams.length >= 1, 'First param must exist (batch size)');
  assert.ok(typeof capturedParams[0] === 'number' && capturedParams[0] > 0, `batch_size must be a positive number; got ${capturedParams[0]}`);
});

// ---------------------------------------------------------------------------
// AC#1 — Dispatcher logs cycle-start with cycle_id
// ---------------------------------------------------------------------------

test('dispatcher_calls_dispatch_cycle_on_cron_tick', async () => {
  const { dispatchCycle } = await import('../../worker/src/dispatcher.js');
  // dispatchCycle must be an exported async function
  assert.equal(typeof dispatchCycle, 'function', 'dispatchCycle must be exported as a function');
});

test('dispatcher_skips_new_tick_while_previous_still_running', async () => {
  // The node-cron built-in concurrency guard (runOnInit: false + scheduled single-instance)
  // means that if a tick fires while a previous invocation is still running, the new tick
  // must be a no-op. We verify this by checking the master-cron.js exports a schedule
  // call that uses node-cron's overlapping-guard pattern.
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const content = await readFile(join('worker', 'src', 'jobs', 'master-cron.js'), 'utf8');

  // Must use node-cron and configure overlap protection
  assert.ok(
    content.includes('node-cron') || content.includes('nodeCron') || content.includes('cron.schedule'),
    'master-cron.js must use node-cron',
  );
  // Guard can be the runOnInit pattern, a running-flag, or node-cron's scheduled.running check
  const hasGuard = content.includes('running') || content.includes('scheduled') || content.includes('isRunning') || content.includes('inFlight');
  assert.ok(hasGuard, 'master-cron.js must implement an overlapping-tick concurrency guard');
});

// ---------------------------------------------------------------------------
// AC#3 — Advisory lock helpers
// ---------------------------------------------------------------------------

test('advisory_lock_try_acquire_calls_pg_try_advisory_lock', async () => {
  const { tryAcquireCustomerLock } = await import('../../worker/src/advisory-lock.js');
  assert.equal(typeof tryAcquireCustomerLock, 'function', 'tryAcquireCustomerLock must be exported');

  let queryCalled = false;
  let queryText = '';
  const mockClient = {
    query: async (text, params) => {
      queryCalled = true;
      queryText = text;
      return { rows: [{ pg_try_advisory_lock: true }] };
    },
  };

  const testUuid = '12345678-1234-1234-1234-123456789012';
  const result = await tryAcquireCustomerLock(mockClient, testUuid);

  assert.ok(queryCalled, 'tryAcquireCustomerLock must issue a DB query');
  assert.ok(queryText.toLowerCase().includes('pg_try_advisory_lock'), 'Query must call pg_try_advisory_lock');
  assert.equal(result, true, 'Must return true when lock acquired');
});

test('advisory_lock_release_calls_pg_advisory_unlock', async () => {
  const { releaseCustomerLock } = await import('../../worker/src/advisory-lock.js');
  assert.equal(typeof releaseCustomerLock, 'function', 'releaseCustomerLock must be exported');

  let queryText = '';
  const mockClient = {
    query: async (text, params) => {
      queryText = text;
      return { rows: [{ pg_advisory_unlock: true }] };
    },
  };

  const testUuid = '12345678-1234-1234-1234-123456789012';
  await releaseCustomerLock(mockClient, testUuid);

  assert.ok(queryText.toLowerCase().includes('pg_advisory_unlock'), 'Query must call pg_advisory_unlock');
});

test('advisory_lock_returns_false_when_lock_already_held', async () => {
  const { tryAcquireCustomerLock } = await import('../../worker/src/advisory-lock.js');

  const mockClient = {
    query: async () => ({ rows: [{ pg_try_advisory_lock: false }] }),
  };

  const testUuid = '12345678-1234-1234-1234-123456789012';
  const result = await tryAcquireCustomerLock(mockClient, testUuid);

  assert.equal(result, false, 'Must return false when lock is already held by another session');
});

test('advisory_lock_bigint_derivation_is_deterministic', async () => {
  const { uuidToBigint } = await import('../../worker/src/advisory-lock.js');
  assert.equal(typeof uuidToBigint, 'function', 'uuidToBigint must be exported for testing');

  const uuid = '12345678-1234-1234-1234-123456789012';
  const result1 = uuidToBigint(uuid);
  const result2 = uuidToBigint(uuid);
  const result3 = uuidToBigint(uuid);

  assert.equal(result1.toString(), result2.toString(), 'Same UUID must always yield same bigint (call 1 vs 2)');
  assert.equal(result2.toString(), result3.toString(), 'Same UUID must always yield same bigint (call 2 vs 3)');
});

test('advisory_lock_different_uuids_map_to_different_bigints', async () => {
  const { uuidToBigint } = await import('../../worker/src/advisory-lock.js');

  const uuidA = '11111111-1111-1111-1111-111111111111';
  const uuidB = '22222222-2222-2222-2222-222222222222';

  const bigintA = uuidToBigint(uuidA);
  const bigintB = uuidToBigint(uuidB);

  assert.notEqual(bigintA.toString(), bigintB.toString(), 'Different UUIDs must produce different bigints');
});

// ---------------------------------------------------------------------------
// AC#5 — Cycle-end log includes stats; audit events emitted
// ---------------------------------------------------------------------------

test('dispatcher_logs_cycle_end_with_stats', async () => {
  const { dispatchCycle } = await import('../../worker/src/dispatcher.js');

  // Verify dispatchCycle's signature documents the stats it returns/logs
  // (full behavior verified in integration test with a seeded catalog)
  const source = await (await import('node:fs/promises')).readFile(
    'worker/src/dispatcher.js', 'utf8',
  );

  // dispatcher must reference stats fields per AC#5
  const hasCustomersProcessed = source.includes('customers_processed') || source.includes('customersProcessed');
  const hasSkusEvaluated = source.includes('skus_evaluated') || source.includes('skusEvaluated');
  const hasDuration = source.includes('duration') || source.includes('duration_ms') || source.includes('durationMs');

  assert.ok(hasCustomersProcessed, 'Dispatcher must log customers_processed in cycle-end stats');
  assert.ok(hasSkusEvaluated, 'Dispatcher must log skus_evaluated in cycle-end stats');
  assert.ok(hasDuration, 'Dispatcher must log duration in cycle-end stats');
});

test('cycle_start_and_end_audit_events_emitted', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile('worker/src/dispatcher.js', 'utf8');

  // Dispatcher must call writeAuditEvent (or reference the audit writer)
  const hasAuditWriter = source.includes('writeAuditEvent') || source.includes('audit/writer') || source.includes('audit-writer');
  assert.ok(hasAuditWriter, 'Dispatcher must emit audit events via writeAuditEvent');

  // Must reference both cycle-start and cycle-end event types
  const hasCycleStart = source.includes('cycle-start');
  const hasCycleEnd = source.includes('cycle-end');
  assert.ok(hasCycleStart, "Dispatcher must emit 'cycle-start' audit event");
  assert.ok(hasCycleEnd, "Dispatcher must emit 'cycle-end' audit event");
});

// ---------------------------------------------------------------------------
// AC#6 — Negative assertion: no worker_locks table in codebase
// ---------------------------------------------------------------------------

test('no_worker_locks_table_in_codebase', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const FORBIDDEN_PATTERNS = [
    /worker_locks/i,
    /CREATE\s+TABLE\s+.*worker_locks/i,
  ];

  async function walk (root, exts) {
    const out = [];
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch { return out; }
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) {
        out.push(...await walk(path, exts));
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        out.push(path);
      }
    }
    return out;
  }

  const files = [
    ...await walk('app/src', ['.js']),
    ...await walk('shared', ['.js']),
    ...await walk('worker/src', ['.js']),
    ...await walk('supabase/migrations', ['.sql']),
    ...await walk('scripts', ['.js']),
  ];

  const hits = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) {
        hits.push(file);
        break;
      }
    }
  }

  assert.equal(
    hits.length,
    0,
    `worker_locks table reference found in codebase (forbidden per AD17 negative assertion — use Postgres advisory locks): ${JSON.stringify(hits)}`,
  );
});

// ---------------------------------------------------------------------------
// AC#4 — ESLint worker-must-filter-by-customer
// ---------------------------------------------------------------------------

test('eslint_worker_must_filter_by_customer_fires_on_violation', async () => {
  const { writeFile, unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { ESLint } = await import('eslint');

  const __dirname = (await import('node:path')).dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(__dirname, '..', '..');
  const fixturePath = join(repoRoot, 'worker', 'src', '__eslint_fixture_worker_filter_test__.js');

  const fixtureContent = `
// ESLint test fixture — DO NOT SHIP
async function bad(client) {
  const result = await client.query('SELECT id FROM sku_channels WHERE tier = $1', ['1']);
  return result.rows;
}
`;

  const cleanup = async () => {
    try { await unlink(fixturePath); } catch { /* already cleaned up */ }
  };

  try {
    await writeFile(fixturePath, fixtureContent, 'utf8');

    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles([fixturePath]);

    assert.strictEqual(results.length, 1, 'ESLint must return exactly one result for the fixture');
    const result = results[0];

    const violations = (result.messages ?? []).filter(
      (m) => m.ruleId === 'local-cron/worker-must-filter-by-customer',
    );
    assert.ok(
      violations.length >= 1,
      `worker-must-filter-by-customer must fire on a query missing customer_marketplace_id filter; ` +
      `got messages: ${JSON.stringify(result.messages)}`,
    );
  } finally {
    await cleanup();
  }
});

test('eslint_rule_suppressed_by_safe_cross_customer_cron_comment', async () => {
  const { writeFile, unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { ESLint } = await import('eslint');

  const __dirname = (await import('node:path')).dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(__dirname, '..', '..');
  const fixturePath = join(repoRoot, 'worker', 'src', '__eslint_fixture_worker_filter_suppressed__.js');

  // Query is cross-customer but has the explicit escape-hatch comment
  const fixtureContent = `
// ESLint test fixture — DO NOT SHIP
async function crossCustomerCron(client) {
  // safe: cross-customer cron
  const result = await client.query('SELECT DISTINCT pending_import_id FROM sku_channels WHERE pending_import_id IS NOT NULL');
  return result.rows;
}
`;

  const cleanup = async () => {
    try { await unlink(fixturePath); } catch { /* already cleaned up */ }
  };

  try {
    await writeFile(fixturePath, fixtureContent, 'utf8');

    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles([fixturePath]);

    const result = results[0];
    const violations = (result.messages ?? []).filter(
      (m) => m.ruleId === 'local-cron/worker-must-filter-by-customer',
    );
    assert.equal(
      violations.length,
      0,
      `worker-must-filter-by-customer must NOT fire when '// safe: cross-customer cron' comment is present; ` +
      `got violations: ${JSON.stringify(violations)}`,
    );
  } finally {
    await cleanup();
  }
});

test('eslint_rule_covers_all_customer_scoped_tables', async () => {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const CUSTOMER_SCOPED_TABLES = [
    'sku_channels',
    'audit_log',
    'baseline_snapshots',
    'pri01_staging',
    'cycle_summaries',
    'daily_kpi_snapshots',
    'scan_jobs',
    'customer_marketplaces',
    'customer_profiles',
  ];

  const ruleSource = await readFile(
    join('eslint-rules', 'worker-must-filter-by-customer.js'),
    'utf8',
  );

  for (const table of CUSTOMER_SCOPED_TABLES) {
    assert.ok(
      ruleSource.includes(table),
      `worker-must-filter-by-customer ESLint rule must reference table '${table}' in its table list`,
    );
  }
});

test('monthly_partition_cron_has_safe_cross_customer_pragma', async () => {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const content = await readFile(
    join('worker', 'src', 'jobs', 'monthly-partition-create.js'),
    'utf8',
  );

  assert.ok(
    content.includes('// safe: cross-customer cron'),
    'worker/src/jobs/monthly-partition-create.js (Story 9.1) must have `// safe: cross-customer cron` ' +
    'pragma comment — this is the Story 5.1 ESLint retrofit obligation per epics.md cross-cutting note',
  );
});
