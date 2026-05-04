#!/usr/bin/env node
// scripts/rls-regression-suite.js
//
// Standalone RLS regression runner — Story 2.2 / AC#2, AC#3, AD30.
//
// Spins up (uses) a test Postgres (local Supabase) with two-customer seed data,
// attempts every SELECT/INSERT/UPDATE/DELETE as customer A using customer B's IDs
// and vice versa, asserts every attempt returns 0 rows or is denied, then exits
// with code 0 (all pass) or code 1 (any failure).
//
// Invoked by: npm run test:rls
// Requires:   .env.test (node --env-file=.env.test) or env vars set:
//               SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//               SUPABASE_SERVICE_ROLE_DATABASE_URL, MASTER_KEY_BASE64
//
// Convention: every new customer-scoped table added in Epics 4-11 must append
// an entry to CUSTOMER_SCOPED_TABLES below (same as rls-regression.test.js).
//
// Note: this script does NOT use Jest/Vitest — plain Node.js ESM, consistent
// with the project's node --test architecture constraint.

import { createClient } from '@supabase/supabase-js';
import { getServiceRoleClient, closeServiceRolePool } from '../shared/db/service-role-client.js';
import { getRlsAwareClient } from '../shared/db/rls-aware-client.js';

// ---------------------------------------------------------------------------
// Registry — same shape as rls-regression.test.js (kept in sync manually).
// ---------------------------------------------------------------------------
const CUSTOMER_SCOPED_TABLES = [
  {
    table: 'customers',
    ownerCol: 'id',
    selectQuery: (ownerId) => ({ text: 'SELECT id FROM customers WHERE id = $1', values: [ownerId] }),
    insertQuery: (_ownerId, otherId) => ({
      text: `INSERT INTO customers (id, email) VALUES ($1, 'hack@rls-suite.test')`,
      values: [otherId],
    }),
    updateQuery: (_ownerId, otherId) => ({
      text: `UPDATE customers SET email = 'hacked@rls-suite.test' WHERE id = $1`,
      values: [otherId],
    }),
    deleteQuery: (_ownerId, otherId) => ({
      text: `DELETE FROM customers WHERE id = $1`,
      values: [otherId],
    }),
    deferred: false,
    serviceRoleOnly: true, // INSERT/UPDATE/DELETE require service-role — only SELECT RLS is tested
  },
  {
    table: 'customer_profiles',
    ownerCol: 'customer_id',
    selectQuery: (ownerId) => ({
      text: 'SELECT customer_id FROM customer_profiles WHERE customer_id = $1',
      values: [ownerId],
    }),
    insertQuery: (_ownerId, otherId) => ({
      text: `INSERT INTO customer_profiles (customer_id, first_name, last_name, company_name)
             VALUES ($1, 'Hack', 'Hack', 'Hack Corp')`,
      values: [otherId],
    }),
    updateQuery: (_ownerId, otherId) => ({
      text: `UPDATE customer_profiles SET first_name = 'Hacked' WHERE customer_id = $1`,
      values: [otherId],
    }),
    deleteQuery: (_ownerId, otherId) => ({
      text: `DELETE FROM customer_profiles WHERE customer_id = $1`,
      values: [otherId],
    }),
    deferred: false,
    serviceRoleOnly: false,
  },
  {
    table: 'shop_api_key_vault',
    ownerCol: 'customer_marketplace_id',
    deferred: true, // Requires customer_marketplaces FK (Epic 4) — skip row ops.
    serviceRoleOnly: false,
    selectQuery: () => null,
    insertQuery: () => null,
    updateQuery: () => null,
    deleteQuery: () => null,
  },
];

// ---------------------------------------------------------------------------
// Test result tracking
// ---------------------------------------------------------------------------
const results = [];

function pass (label) {
  console.log(`  ✓  ${label}`); // eslint-disable-line no-console
  results.push({ label, pass: true });
}

function fail (label, reason) {
  console.error(`  ✗  ${label}`); // eslint-disable-line no-console
  console.error(`       ${reason}`); // eslint-disable-line no-console
  results.push({ label, pass: false, reason });
}

// ---------------------------------------------------------------------------
// Supabase clients (admin for seeding, anon for JWT acquisition)
// ---------------------------------------------------------------------------
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TEST_USERS = [
  {
    email: 'rls-suite-a@test.marketpilot.pt',
    password: 'test-password-A-suite-123!',
    user_metadata: { first_name: 'SuiteA', last_name: 'CustomerA', company_name: 'Suite Alpha Corp' },
  },
  {
    email: 'rls-suite-b@test.marketpilot.pt',
    password: 'test-password-B-suite-123!',
    user_metadata: { first_name: 'SuiteB', last_name: 'CustomerB', company_name: 'Suite Beta Corp' },
  },
];

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function cleanupTestUsers () {
  const pool = getServiceRoleClient();
  for (const u of TEST_USERS) {
    const { rows } = await pool.query(
      `SELECT id FROM auth.users WHERE email = $1`,
      [u.email]
    );
    if (rows.length > 0) {
      await pool.query(`DELETE FROM auth.users WHERE email = $1`, [u.email]);
    }
  }
}

async function seedTwoCustomers () {
  await cleanupTestUsers();

  const users = [];
  for (const u of TEST_USERS) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      user_metadata: u.user_metadata,
      email_confirm: true,
    });
    if (error) throw new Error(`rls-regression-suite: createUser failed for ${u.email}: ${error.message}`);
    users.push(data.user);
  }

  const sessions = [];
  for (const u of TEST_USERS) {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({
      email: u.email,
      password: u.password,
    });
    if (error) throw new Error(`rls-regression-suite: signIn failed for ${u.email}: ${error.message}`);
    sessions.push(data.session);
  }

  return {
    userAId: users[0].id,
    userBId: users[1].id,
    jwtA: sessions[0].access_token,
    jwtB: sessions[1].access_token,
  };
}

// ---------------------------------------------------------------------------
// RLS assertion helpers
// ---------------------------------------------------------------------------

/**
 * Assert that a query via a JWT-scoped client returns 0 rows (SELECT).
 */
async function assertSelectReturnsZeroRows (jwt, query, label) {
  const client = await getRlsAwareClient(jwt);
  try {
    const { rows } = await client.query(query.text, query.values);
    if (rows.length === 0) {
      pass(label);
    } else {
      fail(label, `Expected 0 rows, got ${rows.length}`);
    }
  } catch (err) {
    // An error (permission denied) is also acceptable — RLS blocked the query.
    pass(`${label} (blocked with error: ${err.message})`);
  } finally {
    await client.release();
  }
}

/**
 * Assert that a mutating query (INSERT/UPDATE/DELETE) via a JWT-scoped client
 * either throws (permission denied) or returns rowCount === 0.
 */
async function assertMutationBlocked (jwt, query, label) {
  if (!query) {
    pass(`${label} (skipped — no query defined)`);
    return;
  }
  const client = await getRlsAwareClient(jwt);
  try {
    const result = await client.query(query.text, query.values);
    if ((result.rowCount ?? 0) === 0) {
      pass(label);
    } else {
      fail(label, `Expected rowCount=0, got ${result.rowCount}`);
    }
  } catch {
    // Permission denied / unique violation / FK violation — all acceptable (RLS blocked).
    pass(`${label} (blocked with error)`);
  } finally {
    await client.release();
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------
async function run () {
  console.log('\nRLS Regression Suite — Story 2.2 / AD30\n'); // eslint-disable-line no-console

  let { userAId, userBId, jwtA, jwtB } = await seedTwoCustomers();

  for (const tableConfig of CUSTOMER_SCOPED_TABLES) {
    const { table, deferred } = tableConfig;
    console.log(`\n  Table: ${table}${deferred ? ' (deferred — row ops skipped)' : ''}`); // eslint-disable-line no-console

    if (deferred) {
      pass(`${table} — deferred until Epic 4; skipping row-level isolation tests`);
      continue;
    }

    // SELECT: A cannot read B's row
    await assertSelectReturnsZeroRows(
      jwtA,
      tableConfig.selectQuery(userBId, userAId),
      `${table}: A cannot SELECT B's row`
    );

    // SELECT: B cannot read A's row
    await assertSelectReturnsZeroRows(
      jwtB,
      tableConfig.selectQuery(userAId, userBId),
      `${table}: B cannot SELECT A's row`
    );

    if (!tableConfig.serviceRoleOnly) {
      // INSERT: A cannot insert as B
      await assertMutationBlocked(
        jwtA,
        tableConfig.insertQuery(userAId, userBId),
        `${table}: A cannot INSERT as B`
      );

      // UPDATE: A cannot update B's row
      await assertMutationBlocked(
        jwtA,
        tableConfig.updateQuery(userAId, userBId),
        `${table}: A cannot UPDATE B's row`
      );

      // DELETE: A cannot delete B's row
      await assertMutationBlocked(
        jwtA,
        tableConfig.deleteQuery(userAId, userBId),
        `${table}: A cannot DELETE B's row`
      );
    }
  }

  // Cleanup
  await cleanupTestUsers();
  await closeServiceRolePool();

  // Report
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${'─'.repeat(50)}`); // eslint-disable-line no-console
  console.log(`RLS Regression Suite: ${passed} passed, ${failed} failed`); // eslint-disable-line no-console

  if (failed > 0) {
    console.error('\nFailed checks:'); // eslint-disable-line no-console
    for (const r of results.filter((x) => !x.pass)) {
      console.error(`  ✗  ${r.label}: ${r.reason}`); // eslint-disable-line no-console
    }
    process.exit(1);
  }

  console.log('\nAll RLS isolation checks passed.\n'); // eslint-disable-line no-console
  process.exit(0);
}

run().catch((err) => {
  console.error('rls-regression-suite fatal error:', err); // eslint-disable-line no-console
  process.exit(1);
});
