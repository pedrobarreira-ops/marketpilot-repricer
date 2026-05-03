// Story 2.1 / AC#4 — RLS-aware client + service-role client + tx helper tests.
//
// Covers:
//   AC#1 — getRlsAwareClient(jwt) scopes all queries to the JWT subject via RLS
//   AC#2 — getServiceRoleClient() bypasses RLS; instantiated ONLY in worker context
//   AC#3 — tx(client, cb) commits on success, rolls back on throw; savepoint behaviour
//   AC#4 — integration test confirming rls-aware rows never include customer-B data
//           when authenticated as customer A
//   AC#5 — ESLint rule fires when `pg` Pool is imported directly inside app/src/
//
// Topology constraints (AD2 / NFR-S3):
//   - RLS-aware client uses the JWT from Supabase Auth (user role)
//   - Service-role client uses SUPABASE_SERVICE_ROLE_DATABASE_URL (service_role role)
//   - The app process MUST NOT instantiate the service-role pool (grep assertion)
//   - The worker process MUST NOT expose getRlsAwareClient (grep assertion)
//
// Local-only: requires .env.test pointing at a local Supabase docker.
// Run with: node --env-file=.env.test --test tests/shared/db/clients.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// AC#1 — getRlsAwareClient scopes queries to the JWT subject
// ---------------------------------------------------------------------------
test('rls_aware_client_scopes_to_jwt_subject', async () => {
  // TODO (Story 2.1 ATDD): import { getRlsAwareClient } from '../../../shared/db/rls-aware-client.js'
  // 1. Obtain a valid JWT for customer-A from a Supabase test signup.
  // 2. const client = getRlsAwareClient(jwtA)
  // 3. INSERT a customers row for customer A (via service-role pool, bypassing RLS).
  // 4. INSERT a customers row for customer B (via service-role pool).
  // 5. const { rows } = await client.query('SELECT id FROM customers')
  //    — must return ONLY customer A's row (RLS predicate: id = auth.uid()).
  // 6. assert rows.length === 1 && rows[0].id === customerAId
  assert.ok(true, 'scaffold — implementation required at ATDD step');
});

// ---------------------------------------------------------------------------
// AC#2 — getServiceRoleClient bypasses RLS
// ---------------------------------------------------------------------------
test('service_role_client_bypasses_rls', async () => {
  // TODO (Story 2.1 ATDD): import { getServiceRoleClient } from '../../../shared/db/service-role-client.js'
  // 1. Seed two customer rows via migrations fixture.
  // 2. const client = getServiceRoleClient()
  // 3. const { rows } = await client.query('SELECT id FROM customers ORDER BY created_at')
  //    — must return ALL rows (no RLS predicate fires for service_role).
  // 4. assert rows.length >= 2
  // 5. Verify pool max <= 5 (check pool.options.max).
  assert.ok(true, 'scaffold — implementation required at ATDD step');
});

// ---------------------------------------------------------------------------
// AC#3 — tx helper commits on success
// ---------------------------------------------------------------------------
test('tx_helper_commits_on_success', async () => {
  // TODO (Story 2.1 ATDD): import { tx } from '../../../shared/db/tx.js'
  // 1. const client = getServiceRoleClient()
  // 2. Capture a unique sentinel value (e.g. a UUID note column on a scratch table).
  // 3. await tx(client, async (txClient) => { INSERT sentinel row; })
  // 4. assert row visible after tx completes (SELECT via the same pool).
  assert.ok(true, 'scaffold — implementation required at ATDD step');
});

// ---------------------------------------------------------------------------
// AC#3 — tx helper rolls back on throw
// ---------------------------------------------------------------------------
test('tx_helper_rolls_back_on_throw', async () => {
  // TODO (Story 2.1 ATDD):
  // 1. const client = getServiceRoleClient()
  // 2. await assert.rejects(async () => {
  //      await tx(client, async (txClient) => {
  //        await txClient.query('INSERT ...');   // row exists in-transaction
  //        throw new Error('intentional rollback');
  //      });
  //    }, /intentional rollback/)
  // 3. assert row NOT visible after rollback.
  assert.ok(true, 'scaffold — implementation required at ATDD step');
});

// ---------------------------------------------------------------------------
// AC#3 — tx helper savepoint / nesting behaviour (document choice)
// ---------------------------------------------------------------------------
test('tx_helper_nesting_behaviour_documented', async () => {
  // TODO (Story 2.1 ATDD): choose ONE of two documented paths:
  //   Option A — rejects nesting with ConcurrentTransactionError
  //   Option B — wraps inner call in SAVEPOINT and releases/rolls-back
  // The test must assert the chosen behaviour (not both).
  // If Option A: assert.rejects(() => tx(outer, async () => tx(outer, cb)), /ConcurrentTransactionError/)
  // If Option B: assert inner-throw rolls back only to the inner savepoint.
  assert.ok(true, 'scaffold — implementation required at ATDD step');
});

// ---------------------------------------------------------------------------
// AC#2 — service-role client advisory lock API (pg_try_advisory_lock)
// ---------------------------------------------------------------------------
test('service_role_client_supports_advisory_locks', async () => {
  // TODO (Story 2.1 ATDD):
  // 1. const client = getServiceRoleClient()
  // 2. const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [12345678n])
  // 3. assert rows[0].locked === true  (lock acquired)
  // 4. await client.query('SELECT pg_advisory_unlock($1)', [12345678n])  (cleanup)
  assert.ok(true, 'scaffold — implementation required at ATDD step');
});

// ---------------------------------------------------------------------------
// Architectural-constraint negative assertions
// ---------------------------------------------------------------------------
test('negative_assertion_service_role_client_not_importable_in_app_src', async () => {
  // Constraint: service-role pool instantiated only in worker.
  // Grep app/src/** for any import of service-role-client.js.
  // If found → test fails (state-machine violation: AD2 / Constraint).
  const { readFile, readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  /** @param {string} dir @param {string[]} exts @returns {Promise<string[]>} */
  async function walk (dir, exts) {
    const out = [];
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...await walk(p, exts));
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
    return out;
  }

  const files = await walk('app/src', ['.js']);
  const hits = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    if (text.includes('service-role-client')) hits.push(f);
  }
  assert.deepEqual(hits, [], `service-role-client must not be imported in app/src/: ${hits.join(', ')}`);
});

test('negative_assertion_rls_aware_client_not_importable_in_worker', async () => {
  // Constraint (symmetric): getRlsAwareClient must not be imported in worker/src/.
  // Worker has no concept of user JWT — it operates as service_role only.
  const { readFile, readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  /** @param {string} dir @param {string[]} exts @returns {Promise<string[]>} */
  async function walk (dir, exts) {
    const out = [];
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...await walk(p, exts));
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
    return out;
  }

  const files = await walk('worker/src', ['.js']);
  const hits = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    if (text.includes('rls-aware-client')) hits.push(f);
  }
  assert.deepEqual(hits, [], `rls-aware-client must not be imported in worker/src/: ${hits.join(', ')}`);
});

test('negative_assertion_no_direct_pg_pool_in_app_routes', async () => {
  // AC#5 (ESLint rule backup): app/src/routes and app/src/middleware must not
  // import pg Pool directly — they must use getRlsAwareClient factory.
  // This static grep complements the ESLint rule with a runtime-runnable assertion.
  const { readFile, readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  /** @param {string} dir @param {string[]} exts @returns {Promise<string[]>} */
  async function walk (dir, exts) {
    const out = [];
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...await walk(p, exts));
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
    return out;
  }

  const files = [
    ...await walk('app/src/routes', ['.js']),
    ...await walk('app/src/middleware', ['.js']),
  ];
  const hits = [];
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    // Flag direct 'pg' import or new Pool() — allow import in shared/db/ only
    if (/import\s+(?:\{[^}]*Pool[^}]*\}|pg)\s+from\s+['"]pg['"]/.test(text)) {
      hits.push(f);
    }
  }
  assert.deepEqual(hits, [], `direct pg Pool import found in app/ layer (must use getRlsAwareClient): ${hits.join(', ')}`);
});
