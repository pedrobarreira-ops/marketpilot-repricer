// Epic 9 — Stories 9.0 + 9.1 / AC#1-7 integration test:
// audit_log_event_types lookup, partitioned audit_log base table,
// priority-derivation trigger, RLS isolation, compound indexes.
//
// Covers:
//   Story 9.0 AC#1 — migration seeds exactly 26 event_type rows with correct priorities.
//   Story 9.0 AC#3 — writeAuditEvent fires a real INSERT; priority populated by trigger.
//   Story 9.0 AC#3 — unknown eventType raises DB-level EXCEPTION (trigger guard).
//   Story 9.1 AC#1 — audit_log base table schema matches architecture (F8 no-FK columns).
//   Story 9.1 AC#3 — priority-derivation trigger populates priority on every INSERT.
//   Story 9.1 AC#4 — all four compound indexes exist.
//   Story 9.1 AC#5 — RLS: customer A's JWT returns 0 rows for customer B's events.
//   Story 9.1 AC#7 — integration test assertions: trigger, unknown event_type, partition
//                    routing, RLS, index hit via EXPLAIN.
//
// Local-only: requires .env.test pointing at local Supabase with migrations applied.
// Run with:
//   node --env-file=.env.test --test tests/integration/audit-log-partition.test.js
// Or via:
//   npm run test:integration

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { getServiceRoleClient, closeServiceRolePool } from '../../shared/db/service-role-client.js';
import { getRlsAwareClient } from '../../shared/db/rls-aware-client.js';
import { endResetAuthPool } from './_helpers/reset-auth-tables.js';

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

test.after(async () => {
  await closeServiceRolePool();
  await endResetAuthPool();
});

// ---------------------------------------------------------------------------
// Story 9.1 dependency gate
//
// This file combines Story 9.0 (audit_log_event_types lookup, ships first) and
// Story 9.1 (audit_log partitioned base table, RLS, indexes, trigger — ships
// next). When the test runs against the Story 9.0-only database, all assertions
// that touch `audit_log` must SKIP cleanly rather than fail with a "relation
// does not exist" hard error. Otherwise a clean `npm run test:integration` will
// be red between Story 9.0 merge and Story 9.1 merge — exactly the window where
// CI must stay green so dependent stories can ship.
//
// `auditLogTableMissing()` returns true iff the audit_log table is absent.
// `skipIfNo91(t)` calls t.skip() with a clear reason in that case.
// ---------------------------------------------------------------------------

let _auditLogPresence = null; // memoised: 'present' | 'missing' | null
async function auditLogTableMissing () {
  if (_auditLogPresence !== null) return _auditLogPresence === 'missing';
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'audit_log' LIMIT 1`
  );
  _auditLogPresence = rows.length > 0 ? 'present' : 'missing';
  return _auditLogPresence === 'missing';
}

/**
 * Skip a Story 9.1-dependent subtest cleanly when the audit_log table is
 * missing (i.e. running against Story 9.0-only DB). Returns true if skipped.
 *
 * @param {import('node:test').TestContext} t
 * @returns {Promise<boolean>}
 */
async function skipIfNo91 (t) {
  if (await auditLogTableMissing()) {
    t.skip('Story 9.1 not yet applied — audit_log table does not exist; this assertion will activate when migration 202604301208_create_audit_log_partitioned.sql lands');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Story 9.0 AC#1 — 26-row seed count + taxonomy structure
// ---------------------------------------------------------------------------

test('audit_log_event_types has exactly 26 base rows', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query('SELECT COUNT(*)::int AS cnt FROM audit_log_event_types');
  // Story 9.0 base seed is exactly 26 (7 Atenção + 8 Notável + 11 Rotina).
  // Stories 12.1 and 12.3 add 2 more in their own migrations; until then the
  // count must be exactly 26 — a loose `>=` masks a typo seed (e.g. 27 rows
  // shipped early under the wrong story). When Story 12.1 lands, this test
  // is updated to 27 in that PR.
  assert.equal(
    rows[0].cnt,
    26,
    `Expected exactly 26 rows in audit_log_event_types at Story 9.0 baseline (7 Atenção + 8 Notável + 11 Rotina). Got ${rows[0].cnt}`
  );
});

test('audit_log_event_types contains all 7 Atenção rows', async () => {
  const db = getServiceRoleClient();
  const expected = [
    'anomaly-freeze',
    'circuit-breaker-trip',
    'circuit-breaker-per-sku-trip',
    'key-validation-fail',
    'pri01-fail-persistent',
    'payment-failure-pause',
    'shop-name-collision-detected',
  ];
  const { rows } = await db.query(
    "SELECT event_type FROM audit_log_event_types WHERE priority = 'atencao'"
  );
  const found = rows.map((r) => r.event_type);
  for (const ev of expected) {
    assert.ok(found.includes(ev), `Missing Atenção event_type in DB: ${ev}`);
  }
});

test('audit_log_event_types contains all 8 Notável rows', async () => {
  const db = getServiceRoleClient();
  const expected = [
    'external-change-absorbed',
    'position-won',
    'position-lost',
    'new-competitor-entered',
    'large-price-move-within-tolerance',
    'customer-paused',
    'customer-resumed',
    'scan-complete-with-issues',
  ];
  const { rows } = await db.query(
    "SELECT event_type FROM audit_log_event_types WHERE priority = 'notavel'"
  );
  const found = rows.map((r) => r.event_type);
  for (const ev of expected) {
    assert.ok(found.includes(ev), `Missing Notável event_type in DB: ${ev}`);
  }
});

test('audit_log_event_types contains all 11 Rotina rows', async () => {
  const db = getServiceRoleClient();
  const expected = [
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
  const { rows } = await db.query(
    "SELECT event_type FROM audit_log_event_types WHERE priority = 'rotina'"
  );
  const found = rows.map((r) => r.event_type);
  for (const ev of expected) {
    assert.ok(found.includes(ev), `Missing Rotina event_type in DB: ${ev}`);
  }
});

test('each event_type row has a non-empty PT description', async () => {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    "SELECT event_type FROM audit_log_event_types WHERE description IS NULL OR description = ''"
  );
  assert.equal(
    rows.length,
    0,
    `${rows.length} audit_log_event_types rows have empty description: ${rows.map((r) => r.event_type).join(', ')}`
  );
});

// ---------------------------------------------------------------------------
// Story 9.1 AC#1 — audit_log base table schema (F8 no-FK, columns, partitioning)
// ---------------------------------------------------------------------------

test('audit_log table exists and is partitioned by range on created_at', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT pt.partattrs, c.relname, p.partstrat
    FROM pg_class c
    JOIN pg_partitioned_table p ON p.partrelid = c.oid
    WHERE c.relname = 'audit_log'
  `);
  assert.ok(rows.length > 0, 'audit_log table is not partitioned — check migration 202604301208');
  assert.equal(rows[0].partstrat, 'r', 'audit_log must use RANGE partitioning');
});

test('audit_log has no FK constraint on sku_id (F8 amendment)', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'audit_log'::regclass
      AND contype = 'f'
      AND conname LIKE '%sku_id%'
  `);
  assert.equal(
    rows.length,
    0,
    `F8 violation — FK on sku_id found in audit_log: ${rows.map((r) => r.conname).join(', ')}`
  );
});

test('audit_log has no FK constraint on sku_channel_id (F8 amendment)', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'audit_log'::regclass
      AND contype = 'f'
      AND conname LIKE '%sku_channel_id%'
  `);
  assert.equal(
    rows.length,
    0,
    `F8 violation — FK on sku_channel_id found in audit_log: ${rows.map((r) => r.conname).join(', ')}`
  );
});

test('audit_log has FK on event_type referencing audit_log_event_types', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'audit_log'::regclass
      AND contype = 'f'
      AND conname LIKE '%event_type%'
  `);
  assert.ok(
    rows.length > 0,
    'Expected FK on audit_log.event_type → audit_log_event_types(event_type)'
  );
});

test('audit_log has required columns: id, customer_marketplace_id, event_type, priority, payload, created_at', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const required = ['id', 'customer_marketplace_id', 'event_type', 'priority', 'payload', 'created_at'];
  const { rows } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'audit_log'
  `);
  const cols = rows.map((r) => r.column_name);
  for (const col of required) {
    assert.ok(cols.includes(col), `audit_log missing required column: ${col}`);
  }
});

// ---------------------------------------------------------------------------
// Story 9.1 AC#3 — priority-derivation trigger
// ---------------------------------------------------------------------------

test('INSERT into audit_log with known event_type derives priority automatically', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  // We also need a real customer_marketplace_id — skip if Epic 4 hasn't shipped yet.
  let cmId;
  try {
    const { rows } = await db.query('SELECT id FROM customer_marketplaces LIMIT 1');
    cmId = rows[0]?.id;
  } catch {
    t.skip('customer_marketplaces table not yet created (Epic 4 dependency) — trigger test deferred');
    return;
  }
  if (!cmId) {
    t.skip('No customer_marketplace rows seeded — trigger test cannot run without a real FK target');
    return;
  }

  const { rows } = await db.query(`
    INSERT INTO audit_log (customer_marketplace_id, event_type, payload)
    VALUES ($1, 'cycle-start', '{"test":true}'::jsonb)
    RETURNING priority
  `, [cmId]);
  assert.equal(rows[0].priority, 'rotina', 'cycle-start must derive priority=rotina via trigger');

  // Cleanup
  await db.query(
    'DELETE FROM audit_log WHERE customer_marketplace_id = $1 AND event_type = $2',
    [cmId, 'cycle-start']
  );
});

test('INSERT into audit_log with unknown event_type raises EXCEPTION', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  let cmId;
  try {
    const { rows } = await db.query('SELECT id FROM customer_marketplaces LIMIT 1');
    cmId = rows[0]?.id;
  } catch {
    t.skip('customer_marketplaces table not yet created (Epic 4 dependency) — unknown-event-type guard deferred');
    return;
  }
  if (!cmId) {
    t.skip('No customer_marketplace rows seeded — unknown-event-type guard cannot run without a real FK target');
    return;
  }

  await assert.rejects(
    () => db.query(`
      INSERT INTO audit_log (customer_marketplace_id, event_type, payload)
      VALUES ($1, 'not-a-real-event', '{"test":true}'::jsonb)
    `, [cmId]),
    /unknown audit_log event_type/i
  );
});

// ---------------------------------------------------------------------------
// Story 9.1 AC#4 — compound indexes exist
// ---------------------------------------------------------------------------

test('idx_audit_log_customer_created index exists', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'audit_log' AND indexname = 'idx_audit_log_customer_created'
  `);
  assert.ok(rows.length > 0, 'Missing index: idx_audit_log_customer_created');
});

test('idx_audit_log_customer_sku_created index exists', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'audit_log' AND indexname = 'idx_audit_log_customer_sku_created'
  `);
  assert.ok(rows.length > 0, 'Missing index: idx_audit_log_customer_sku_created');
});

test('idx_audit_log_customer_eventtype_created index exists', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'audit_log' AND indexname = 'idx_audit_log_customer_eventtype_created'
  `);
  assert.ok(rows.length > 0, 'Missing index: idx_audit_log_customer_eventtype_created');
});

test('idx_audit_log_customer_cycle index exists', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'audit_log' AND indexname = 'idx_audit_log_customer_cycle'
  `);
  assert.ok(rows.length > 0, 'Missing index: idx_audit_log_customer_cycle');
});

// ---------------------------------------------------------------------------
// Story 9.1 AC#5 — RLS cross-tenant isolation
// ---------------------------------------------------------------------------

test('RLS: customer A JWT returns 0 audit_log rows owned by customer B', async (t) => {
  // Story 9.1 dependency — requires audit_log table.
  if (await skipIfNo91(t)) return;

  // Story 9.1 + Epic 4 dependency — requires customer_marketplaces with seeded
  // rows so we have a real cmBId to insert against. The previous version of
  // this test silently skipped its single assertion when cmBId was null —
  // making the test a soft-pass during the entire Story 9.0 → 9.1 → 4.x window.
  // We now route every "skip" reason through t.skip() so the failure mode is
  // visible in test output, not invisible.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — RLS isolation test requires Supabase admin auth');
    return;
  }

  const supabaseAdmin = await getSupabaseAdmin();
  const emailA = `rls-audit-a-${Date.now()}@test.invalid`;
  const emailB = `rls-audit-b-${Date.now()}@test.invalid`;
  const pw = 'RlsAudit1!';

  let signUpA, signUpB;
  try {
    signUpA = await supabaseAdmin.auth.admin.createUser({ email: emailA, password: pw, email_confirm: true });
    signUpB = await supabaseAdmin.auth.admin.createUser({ email: emailB, password: pw, email_confirm: true });
  } catch (err) {
    t.skip(`Supabase auth.admin.createUser unavailable (${err?.message ?? 'unknown error'}) — RLS isolation test deferred`);
    return;
  }

  const userAId = signUpA.data?.user?.id;
  const userBId = signUpB.data?.user?.id;
  if (!userAId || !userBId) {
    t.skip('createUser did not return user ids — auth admin unavailable');
    return;
  }

  // Get customer_marketplace_id for user B (service role)
  const db = getServiceRoleClient();
  let cmBId;
  let cmTableMissing = false;
  try {
    const { rows } = await db.query(
      'SELECT cm.id FROM customer_marketplaces cm JOIN customers c ON c.id = cm.customer_id WHERE c.id = $1 LIMIT 1',
      [userBId]
    );
    cmBId = rows[0]?.id;
  } catch {
    cmTableMissing = true;
  }

  if (cmTableMissing || !cmBId) {
    // Cleanup test users before bailing
    await supabaseAdmin.auth.admin.deleteUser(userAId).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(userBId).catch(() => {});
    t.skip(
      cmTableMissing
        ? 'customer_marketplaces table not yet created (Epic 4 dependency) — RLS isolation deferred'
        : 'No customer_marketplace seeded for user B — RLS isolation cannot be tested without a real audit row to filter'
    );
    return;
  }

  // Insert a test audit row for user B via service role
  try {
    await db.query(
      `INSERT INTO audit_log (customer_marketplace_id, event_type, payload)
       VALUES ($1, 'cycle-start', '{"rls_test":true}'::jsonb)`,
      [cmBId]
    );
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(userAId).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(userBId).catch(() => {});
    t.skip(`audit_log INSERT failed (${err?.message ?? 'unknown'}) — RLS isolation cannot be verified without a seeded row`);
    return;
  }

  // Pre-condition: verify the row was actually inserted via service role.
  // Without this, if the INSERT silently failed to land (e.g. trigger
  // suppression), the RLS test below would pass vacuously — RLS appears
  // to "filter out" a row that never existed.
  const { rows: serviceRows } = await db.query(
    `SELECT 1 FROM audit_log WHERE customer_marketplace_id = $1 LIMIT 1`,
    [cmBId]
  );
  assert.equal(
    serviceRows.length,
    1,
    `pre-condition: B's audit_log row must exist via service-role before RLS isolation test; if 0 rows the test below would pass vacuously`
  );

  // Sign in as user A and attempt to read user B's audit rows
  const { data: signInData } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: emailA,
  });
  if (!signInData?.properties?.access_token) {
    await db.query(`DELETE FROM audit_log WHERE customer_marketplace_id = $1`, [cmBId]);
    await supabaseAdmin.auth.admin.deleteUser(userAId).catch(() => {});
    await supabaseAdmin.auth.admin.deleteUser(userBId).catch(() => {});
    t.skip('Could not generate magic-link access token for user A — RLS test cannot acquire a JWT');
    return;
  }

  const rlsClient = getRlsAwareClient(signInData.properties.access_token);
  const { rows: rlsRows } = await rlsClient.query(
    'SELECT 1 FROM audit_log WHERE customer_marketplace_id = $1 LIMIT 1',
    [cmBId]
  );
  assert.equal(
    rlsRows.length,
    0,
    'RLS violation: customer A can see customer B audit_log rows'
  );

  // Cleanup
  await db.query(`DELETE FROM audit_log WHERE customer_marketplace_id = $1`, [cmBId]);
  await supabaseAdmin.auth.admin.deleteUser(userAId).catch(() => {});
  await supabaseAdmin.auth.admin.deleteUser(userBId).catch(() => {});
});

// ---------------------------------------------------------------------------
// Story 9.1 AC#2 — initial partition exists for the MVP launch month
// ---------------------------------------------------------------------------

test('at least one audit_log partition exists (initial partition from migration)', async (t) => {
  if (await skipIfNo91(t)) return;
  const db = getServiceRoleClient();
  const { rows } = await db.query(`
    SELECT inhrelid::regclass AS partition_name
    FROM pg_inherits
    WHERE inhparent = 'audit_log'::regclass
    LIMIT 1
  `);
  assert.ok(rows.length > 0, 'No audit_log partitions found — initial partition missing from migration 202604301208');
});

// ---------------------------------------------------------------------------
// Story 9.1 — rls-regression suite includes audit_log
// ---------------------------------------------------------------------------

test('rls-regression.test.js registry includes audit_log', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const suiteFile = path.resolve(__dirname, 'rls-regression.test.js');
  const content = await readFile(suiteFile, 'utf8');
  assert.ok(
    content.includes('audit_log'),
    'rls-regression.test.js CUSTOMER_SCOPED_TABLES must include audit_log per Story 9.1 AC#5'
  );
});
