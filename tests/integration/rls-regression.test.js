// Story 2.2 / AC#1-5 — RLS regression suite integration test.
//
// Covers:
//   AC#1 — Two-customer seed creates two distinct customers.
//   AC#2 — Per-table RLS isolation: customer A's JWT cannot SELECT/INSERT/UPDATE/DELETE
//           rows owned by customer B, and vice versa.
//   AC#3 — `npm run test:rls` exits non-zero on any failure (structural assertion).
//   AC#4 — Convention assertion: every customer-scoped table in `db/seed/test/two-customers.sql`
//           is also covered in the regression suite config array.
//   AC#5 — No customer-scoped migration shipped without a companion RLS policy.
//
// Tables covered at Epic 2 baseline:
//   - customers
//   - customer_profiles
//   - shop_api_key_vault   (deferred: Epic 4 ships customer_marketplaces FK target;
//                           policy existence check still runs here — AC#5 deferred file)
//
// Convention: every new customer-scoped table migration (Epics 4-11) MUST:
//   1. Include its RLS policy in the same migration file.
//   2. Add a row for both test customers to `db/seed/test/two-customers.sql`.
//   3. Add the table name to the CUSTOMER_SCOPED_TABLES array below.
// Failure to add to step 3 causes convention_every_seed_table_is_in_regression_config
// to fail loudly: "table <name> present in seed but missing from CUSTOMER_SCOPED_TABLES registry"
//
// Local-only: requires .env.test pointing at local Supabase docker.
// Run with: node --env-file=.env.test --test tests/integration/rls-regression.test.js
// Or via:   npm run test:rls

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

import { getServiceRoleClient, closeServiceRolePool } from '../../shared/db/service-role-client.js';
import { getRlsAwareClient } from '../../shared/db/rls-aware-client.js';
import { resetAuthAndCustomers, endResetAuthPool } from './_helpers/reset-auth-tables.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Supabase admin client (for seeding test users via admin API)
//
// Lazily constructed so the static-only tests (convention checks, package.json
// shape, registry-sync) remain runnable without SUPABASE_URL set. Module-level
// createClient() with an empty url throws synchronously at import time, which
// would block even tests that never touch Supabase. Lazy init defers the env
// dependency to the first DB-touching test only.
// ---------------------------------------------------------------------------

let _supabaseAdmin = null;
let _supabaseAnon = null;

function getSupabaseAdmin () {
  if (_supabaseAdmin === null) {
    _supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return _supabaseAdmin;
}

function getSupabaseAnon () {
  if (_supabaseAnon === null) {
    _supabaseAnon = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return _supabaseAnon;
}

const TEST_USER_A = {
  email: 'customer-a@test.marketpilot.pt',
  password: 'test-password-A-123!',
  user_metadata: { first_name: 'TestA', last_name: 'CustomerA', company_name: 'Alpha Corp' },
};
const TEST_USER_B = {
  email: 'customer-b@test.marketpilot.pt',
  password: 'test-password-B-123!',
  user_metadata: { first_name: 'TestB', last_name: 'CustomerB', company_name: 'Beta Corp' },
};

/**
 * Create both test users via Supabase admin API.
 * The handle_new_auth_user trigger fires and creates customers + customer_profiles rows.
 *
 * @returns {{ userAId: string, userBId: string, jwtA: string, jwtB: string }}
 */
async function seedTwoCustomers () {
  const supabaseAdmin = getSupabaseAdmin();
  const supabaseAnon = getSupabaseAnon();

  const { data: userA, error: errA } = await supabaseAdmin.auth.admin.createUser({
    email: TEST_USER_A.email,
    password: TEST_USER_A.password,
    user_metadata: TEST_USER_A.user_metadata,
    email_confirm: true,
  });
  if (errA) throw new Error(`seedTwoCustomers: failed to create user A — ${errA.message}`);

  const { data: userB, error: errB } = await supabaseAdmin.auth.admin.createUser({
    email: TEST_USER_B.email,
    password: TEST_USER_B.password,
    user_metadata: TEST_USER_B.user_metadata,
    email_confirm: true,
  });
  if (errB) throw new Error(`seedTwoCustomers: failed to create user B — ${errB.message}`);

  const { data: sessionA, error: signInErrA } = await supabaseAnon.auth.signInWithPassword({
    email: TEST_USER_A.email,
    password: TEST_USER_A.password,
  });
  if (signInErrA) throw new Error(`seedTwoCustomers: signIn A failed — ${signInErrA.message}`);

  const { data: sessionB, error: signInErrB } = await supabaseAnon.auth.signInWithPassword({
    email: TEST_USER_B.email,
    password: TEST_USER_B.password,
  });
  if (signInErrB) throw new Error(`seedTwoCustomers: signIn B failed — ${signInErrB.message}`);

  return {
    userAId: userA.user.id,
    userBId: userB.user.id,
    jwtA: sessionA.session.access_token,
    jwtB: sessionB.session.access_token,
  };
}

// ---------------------------------------------------------------------------
// Registry — add one entry per new customer-scoped table (Epics 4-11 extend this).
// Each entry defines:
//   table      — SQL table name in public schema
//   ownerCol   — column that holds the customer's id (FK to customers.id / auth.uid)
//   seedHelper — async (pool, customerId) => { INSERT a minimal row for customerId }
//   cleanHelper— async (pool, customerId) => { DELETE test rows for customerId }
// ---------------------------------------------------------------------------

/**
 * @typedef {{ table: string, ownerCol: string, seedHelper: Function, cleanHelper: Function }} TableConfig
 */

/**
 * Customer-scoped tables covered by the RLS regression suite at Epic 2 baseline.
 * Subsequent epics APPEND entries here (one line change per new table).
 *
 * @type {TableConfig[]}
 */
const CUSTOMER_SCOPED_TABLES = [
  {
    table: 'customers',
    ownerCol: 'id',
    // customers row is created by the signup trigger — seed helper is a no-op;
    // the row already exists after the two-customers seed applies.
    seedHelper: async (_pool, _customerId) => { /* seeded by handle_new_auth_user trigger */ },
    cleanHelper: async (_pool, _customerId) => { /* cleaned by resetAuthAndCustomers */ },
  },
  {
    table: 'customer_profiles',
    ownerCol: 'customer_id',
    seedHelper: async (_pool, _customerId) => { /* seeded by handle_new_auth_user trigger */ },
    cleanHelper: async (_pool, _customerId) => { /* cleaned by CASCADE from customers */ },
  },
  {
    table: 'customer_marketplaces',
    ownerCol: 'customer_id',
    // Story 4.1: customer_marketplaces ships with F4 PROVISIONING state.
    // Seed a minimal row in PROVISIONING with all A01/PC01 columns NULL (satisfies F4 CHECK).
    // max_discount_pct is required (no DEFAULT per architecture constraint).
    seedHelper: async (pool, customerId) => {
      await pool.query(
        `INSERT INTO customer_marketplaces
           (customer_id, operator, marketplace_instance_url, max_discount_pct)
         VALUES ($1, 'WORTEN', 'https://marketplace.worten.pt', 0.015)
         ON CONFLICT DO NOTHING`,
        [customerId],
      );
    },
    cleanHelper: async (pool, customerId) => {
      await pool.query(
        'DELETE FROM customer_marketplaces WHERE customer_id = $1',
        [customerId],
      );
    },
  },
  {
    table: 'shop_api_key_vault',
    ownerCol: 'customer_marketplace_id',
    // Story 4.1: customer_marketplaces now exists as FK target.
    // shop_api_key_vault rows are seeded via a customer_marketplaces row.
    // RLS is customer-scoped via join through customer_marketplaces.
    seedHelper: async (pool, customerId) => {
      // Insert a customer_marketplaces row first (to satisfy the FK).
      const { rows } = await pool.query(
        `INSERT INTO customer_marketplaces
           (customer_id, operator, marketplace_instance_url, max_discount_pct)
         VALUES ($1, 'WORTEN', 'https://marketplace-vault-seed.worten.pt', 0.015)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [customerId],
      );
      if (rows.length === 0) {
        // Row already exists from customer_marketplaces seedHelper — find it
        const { rows: existing } = await pool.query(
          `SELECT id FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1`,
          [customerId],
        );
        if (existing.length === 0) return;
        const cmId = existing[0].id;
        await pool.query(
          `INSERT INTO shop_api_key_vault
             (customer_marketplace_id, ciphertext, nonce, auth_tag, master_key_version)
           VALUES ($1, '\\xdeadbeef', '\\xdeadbeef', '\\xdeadbeef', 1)
           ON CONFLICT DO NOTHING`,
          [cmId],
        );
        return;
      }
      const cmId = rows[0].id;
      await pool.query(
        `INSERT INTO shop_api_key_vault
           (customer_marketplace_id, ciphertext, nonce, auth_tag, master_key_version)
         VALUES ($1, '\\xdeadbeef', '\\xdeadbeef', '\\xdeadbeef', 1)
         ON CONFLICT DO NOTHING`,
        [cmId],
      );
    },
    cleanHelper: async (pool, customerId) => {
      // shop_api_key_vault rows cascade-delete when customer_marketplaces rows are deleted.
      await pool.query(
        `DELETE FROM shop_api_key_vault
         WHERE customer_marketplace_id IN (
           SELECT id FROM customer_marketplaces WHERE customer_id = $1
         )`,
        [customerId],
      );
    },
  },
  {
    table: 'audit_log',
    ownerCol: 'customer_marketplace_id',
    // Story 9.1 AC#5: audit_log is customer-scoped (SELECT gated by customer_marketplace_id).
    // INSERT/UPDATE/DELETE are service-role only (NFR-S6 append-only at app layer).
    // Row-level isolation testing is deferred to Story 9.x because it requires
    // customer_marketplaces (Epic 4) as an FK target for seeding real audit rows.
    // The RLS policy (audit_log_select_own) is present in the migration; policy
    // existence is verified by negative_assertion_no_migration_missing_rls_policy.
    seedHelper: async (_pool, _customerId) => {
      // Deferred until Story 9.x: INSERT INTO audit_log (customer_marketplace_id, event_type, payload)
      // using a real customer_marketplace row seeded for the test customer.
    },
    cleanHelper: async (_pool, _customerId) => {
      // Deferred until Story 9.x.
    },
    deferred: true, // Signals parameterized tests to skip row operations for this table.
  },
];

// ---------------------------------------------------------------------------
// Helper: check if a table exists in public schema
// ---------------------------------------------------------------------------
async function tableExists (pool, tableName) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1
     LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Postgres SQLSTATE codes that legitimately indicate RLS or constraint
// blocked the mutation. Any OTHER error (column not found, network drop,
// schema typo) escalates as a real test failure, preventing silent
// false-positives where a schema bug masquerades as "RLS blocked it".
//
//   42501 — insufficient_privilege          (RLS / GRANT denied)
//   42P17 — invalid_definition              (RLS policy expression error)
//   23502 — not_null_violation              (acceptable for INSERT blocked by trigger)
//   23503 — foreign_key_violation           (acceptable for cross-tenant FK)
//   23505 — unique_violation                (acceptable for INSERT clash with PK row created by trigger)
//
// Mirrors RLS_BLOCKED_CODES_MUTATION in scripts/rls-regression-suite.js.
// ---------------------------------------------------------------------------
const RLS_BLOCKED_CODES_MUTATION = new Set(['42501', '42P17', '23502', '23503', '23505']);

/**
 * Assert that running `query` via the JWT-scoped client `client` is rejected
 * by RLS or a closely related constraint. Throws on unexpected errors.
 */
async function assertInsertBlockedByRls (client, queryText, queryValues, message) {
  let err;
  try {
    await client.query(queryText, queryValues);
  } catch (caught) {
    err = caught;
  }
  assert.ok(err, message);
  assert.ok(
    err && typeof err === 'object' && RLS_BLOCKED_CODES_MUTATION.has(err.code),
    `${message} — expected RLS/constraint SQLSTATE (one of ${[...RLS_BLOCKED_CODES_MUTATION].join(', ')}), ` +
    `got: code=${err?.code ?? '?'} message=${err?.message ?? err}`
  );
}

// ---------------------------------------------------------------------------
// AC#1 — two-customers seed applies cleanly
// ---------------------------------------------------------------------------
test('two_customers_seed_creates_two_distinct_customers', { concurrency: 1 }, async (t) => {
  t.after(async () => {
    await closeServiceRolePool();
    await endResetAuthPool();
  });

  await resetAuthAndCustomers();

  const { userAId, userBId } = await seedTwoCustomers();

  const pool = getServiceRoleClient();

  // Verify two distinct customers exist
  const { rows: customerRows } = await pool.query(
    'SELECT id FROM customers WHERE id = ANY($1::uuid[]) ORDER BY created_at',
    [[userAId, userBId]]
  );
  assert.strictEqual(customerRows.length, 2, 'seed must produce exactly 2 customer rows');
  assert.notStrictEqual(customerRows[0].id, customerRows[1].id, 'customer IDs must be distinct');

  // Verify two distinct customer_profiles exist
  const { rows: profileRows } = await pool.query(
    'SELECT customer_id FROM customer_profiles WHERE customer_id = ANY($1::uuid[]) ORDER BY created_at',
    [[userAId, userBId]]
  );
  assert.strictEqual(profileRows.length, 2, 'seed must produce exactly 2 customer_profile rows');

  // Verify shop_api_key_vault table is present and RLS-enabled (policy existence; row isolation deferred to Epic 4)
  const vaultExists = await tableExists(pool, 'shop_api_key_vault');
  if (vaultExists) {
    const { rows: policyRows } = await pool.query(
      `SELECT policyname FROM pg_policies WHERE tablename = 'shop_api_key_vault' AND schemaname = 'public'`
    );
    assert.ok(policyRows.length > 0, 'shop_api_key_vault must have at least one RLS policy');
  }
  // If shop_api_key_vault doesn't exist yet (deferred migration not applied), skip gracefully.

  await resetAuthAndCustomers();
});

// ---------------------------------------------------------------------------
// Diagnostic — auth.uid() smoke test (Story 2.2 test review finding)
//
// Without this test, every RLS isolation assertion below has a SILENT
// FALSE-POSITIVE failure mode: if getRlsAwareClient's JWT decoding silently
// produced an empty/wrong sub claim, auth.uid() would return NULL, all RLS
// policies (USING (id = auth.uid())) would filter to 0 rows, and every
// "customer A cannot see B's rows" test would pass vacuously — because the
// connection isn't authenticated as A at all (it's authenticated as nobody).
//
// This test verifies the JWT round-trip works end-to-end: the JWT we acquire
// from signInWithPassword decodes and arms request.jwt.claims correctly, so
// auth.uid() inside the connection actually returns customer A's id.
// ---------------------------------------------------------------------------
test('rls_aware_client_auth_uid_matches_jwt_subject', { concurrency: 1 }, async (t) => {
  t.after(async () => {
    await closeServiceRolePool();
    await endResetAuthPool();
  });

  await resetAuthAndCustomers();
  const { userAId, userBId, jwtA, jwtB } = await seedTwoCustomers();

  const clientA = await getRlsAwareClient(jwtA);
  try {
    const { rows } = await clientA.query('SELECT auth.uid()::text AS uid');
    assert.strictEqual(
      rows[0].uid,
      userAId,
      `RLS-aware client for A's JWT must arm auth.uid() = userAId; got "${rows[0].uid}". ` +
      `If this fails, every isolation test below passes vacuously — RLS filters to 0 rows ` +
      `because auth.uid() is NULL/wrong, not because RLS is enforcing isolation.`
    );
  } finally {
    await clientA.release();
  }

  const clientB = await getRlsAwareClient(jwtB);
  try {
    const { rows } = await clientB.query('SELECT auth.uid()::text AS uid');
    assert.strictEqual(rows[0].uid, userBId, 'RLS-aware client for B must arm auth.uid() = userBId');
  } finally {
    await clientB.release();
  }

  await resetAuthAndCustomers();
});

// ---------------------------------------------------------------------------
// AC#2 — Parameterized cross-customer isolation per table
// ---------------------------------------------------------------------------

test('rls_isolation_suite', { concurrency: 1 }, async (t) => {
  t.after(async () => {
    await closeServiceRolePool();
    await endResetAuthPool();
  });

  t.beforeEach(async () => {
    await resetAuthAndCustomers();
  });

  for (const tableConfig of CUSTOMER_SCOPED_TABLES) {
    const { table, ownerCol } = tableConfig;
    const isDeferred = tableConfig.deferred === true;

    await t.test(`rls_isolation_${table}_customer_a_cannot_read_customer_b_rows`, async () => {
      if (isDeferred) {
        // Deferred table: verify it either doesn't exist yet or has no rows to read.
        const pool = getServiceRoleClient();
        const exists = await tableExists(pool, table);
        if (!exists) {
          // Table not yet applied — skip gracefully.
          return;
        }
        // Table exists but no rows (no customer_marketplaces to FK against) — deferred.
        return;
      }

      if (table === 'shop_api_key_vault') {
        // shop_api_key_vault ownership is indirect: customer_marketplace_id → customer_marketplaces.customer_id.
        // The generic ownerCol=userId pattern doesn't apply — resolve the FK id first.
        const { userAId, userBId, jwtA } = await seedTwoCustomers();
        await tableConfig.seedHelper(getServiceRoleClient(), userAId);
        await tableConfig.seedHelper(getServiceRoleClient(), userBId);
        const pool = getServiceRoleClient();
        const { rows: cmB } = await pool.query(
          'SELECT id FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1', [userBId]
        );
        assert.strictEqual(cmB.length, 1, 'pre-condition: customer B must have a customer_marketplace row');
        const cmBId = cmB[0].id;
        const { rows: vaultCheck } = await pool.query(
          'SELECT 1 FROM shop_api_key_vault WHERE customer_marketplace_id = $1', [cmBId]
        );
        assert.strictEqual(vaultCheck.length, 1,
          'pre-condition: customer B vault row must exist via service-role; if 0 rows, seedHelper failed silently'
        );
        const clientA = await getRlsAwareClient(jwtA);
        try {
          const { rows } = await clientA.query('SELECT customer_marketplace_id FROM shop_api_key_vault');
          const bRows = rows.filter((r) => r.customer_marketplace_id === cmBId);
          assert.strictEqual(bRows.length, 0, 'customer A must not see customer B vault row in shop_api_key_vault');
        } finally {
          await clientA.release();
        }
        return;
      }

      const { userAId, userBId, jwtA } = await seedTwoCustomers();
      await tableConfig.seedHelper(getServiceRoleClient(), userAId);
      await tableConfig.seedHelper(getServiceRoleClient(), userBId);

      // Pre-condition: verify B's row actually exists via service-role.
      // Without this guard, if seedTwoCustomers/seedHelper silently failed
      // to create B's row, the test would pass vacuously — RLS appears
      // to "filter out" a row that never existed in the first place.
      const pool = getServiceRoleClient();
      const { rows: serviceRows } = await pool.query(
        `SELECT 1 FROM ${table} WHERE ${ownerCol} = $1 LIMIT 1`,
        [userBId]
      );
      assert.strictEqual(
        serviceRows.length,
        1,
        `pre-condition: customer B's row must exist in ${table} via service-role before testing RLS isolation; ` +
        `if 0 rows, the seed helper failed silently and the isolation test below would pass vacuously`
      );

      const clientA = await getRlsAwareClient(jwtA);
      try {
        const { rows } = await clientA.query(`SELECT * FROM ${table}`);
        // Every returned row must belong to customer A — customer B's rows must be invisible.
        for (const row of rows) {
          assert.strictEqual(
            row[ownerCol],
            userAId,
            `RLS must filter out customer B's rows from ${table}; got ownerCol=${row[ownerCol]}`
          );
        }
        // Verify customer B's row is not visible
        const bRows = rows.filter((r) => r[ownerCol] === userBId);
        assert.strictEqual(bRows.length, 0, `customer A must not see customer B's rows in ${table}`);
      } finally {
        await clientA.release();
      }
    });

    await t.test(`rls_isolation_${table}_customer_b_cannot_read_customer_a_rows`, async () => {
      if (isDeferred) return;

      if (table === 'shop_api_key_vault') {
        // shop_api_key_vault ownership is indirect — resolve customer_marketplace_id for each user.
        const { userAId, userBId, jwtB } = await seedTwoCustomers();
        await tableConfig.seedHelper(getServiceRoleClient(), userAId);
        await tableConfig.seedHelper(getServiceRoleClient(), userBId);
        const pool = getServiceRoleClient();
        const { rows: cmA } = await pool.query(
          'SELECT id FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1', [userAId]
        );
        assert.strictEqual(cmA.length, 1, 'pre-condition: customer A must have a customer_marketplace row');
        const cmAId = cmA[0].id;
        const { rows: vaultCheck } = await pool.query(
          'SELECT 1 FROM shop_api_key_vault WHERE customer_marketplace_id = $1', [cmAId]
        );
        assert.strictEqual(vaultCheck.length, 1,
          'pre-condition: customer A vault row must exist via service-role; if 0 rows, seedHelper failed silently'
        );
        const clientB = await getRlsAwareClient(jwtB);
        try {
          const { rows } = await clientB.query('SELECT customer_marketplace_id FROM shop_api_key_vault');
          const aRows = rows.filter((r) => r.customer_marketplace_id === cmAId);
          assert.strictEqual(aRows.length, 0, 'customer B must not see customer A vault row in shop_api_key_vault');
        } finally {
          await clientB.release();
        }
        return;
      }

      const { userAId, userBId, jwtB } = await seedTwoCustomers();
      await tableConfig.seedHelper(getServiceRoleClient(), userAId);
      await tableConfig.seedHelper(getServiceRoleClient(), userBId);

      // Pre-condition: verify A's row actually exists via service-role (see
      // rationale on the symmetric A→B test above).
      const pool = getServiceRoleClient();
      const { rows: serviceRows } = await pool.query(
        `SELECT 1 FROM ${table} WHERE ${ownerCol} = $1 LIMIT 1`,
        [userAId]
      );
      assert.strictEqual(
        serviceRows.length,
        1,
        `pre-condition: customer A's row must exist in ${table} via service-role before testing RLS isolation`
      );

      const clientB = await getRlsAwareClient(jwtB);
      try {
        const { rows } = await clientB.query(`SELECT * FROM ${table}`);
        const aRows = rows.filter((r) => r[ownerCol] === userAId);
        assert.strictEqual(aRows.length, 0, `customer B must not see customer A's rows in ${table}`);
      } finally {
        await clientB.release();
      }
    });

    await t.test(`rls_isolation_${table}_customer_a_cannot_insert_as_customer_b`, async () => {
      if (isDeferred) return;

      if (table === 'customers') {
        // customers INSERT is service-role only (no customer INSERT policy).
        // An authenticated user cannot INSERT into customers at all — the trigger
        // creates the row. Attempt an INSERT and assert it is rejected with a
        // recognised RLS/constraint SQLSTATE (not just any error).
        const { userAId: _aId, userBId, jwtA } = await seedTwoCustomers();
        const clientA = await getRlsAwareClient(jwtA);
        try {
          await assertInsertBlockedByRls(
            clientA,
            `INSERT INTO customers (id, email) VALUES ($1, 'hack@test.marketpilot.pt')`,
            [userBId],
            `customers INSERT by authenticated user must be rejected (no INSERT policy)`
          );
        } finally {
          await clientA.release();
        }
        return;
      }

      if (table === 'customer_profiles') {
        // customer_profiles INSERT is service-role only (no customer INSERT policy).
        const { userAId: _aId, userBId, jwtA } = await seedTwoCustomers();
        const clientA = await getRlsAwareClient(jwtA);
        try {
          await assertInsertBlockedByRls(
            clientA,
            `INSERT INTO customer_profiles (customer_id, first_name, last_name, company_name)
             VALUES ($1, 'Hack', 'Hack', 'Hack Corp')`,
            [userBId],
            `customer_profiles INSERT by authenticated user must be rejected (no INSERT policy)`
          );
        } finally {
          await clientA.release();
        }
        return;
      }

      // Generic: try INSERT with ownerCol = customerBId — expect rejection.
      const { userAId: _aId, userBId, jwtA } = await seedTwoCustomers();
      const clientA = await getRlsAwareClient(jwtA);
      try {
        await assertInsertBlockedByRls(
          clientA,
          `INSERT INTO ${table} (${ownerCol}) VALUES ($1)`,
          [userBId],
          `INSERT with ${ownerCol}=customerBId via customer A's JWT must be rejected by RLS in ${table}`
        );
      } finally {
        await clientA.release();
      }
    });

    await t.test(`rls_isolation_${table}_customer_a_cannot_update_customer_b_rows`, async () => {
      if (isDeferred) return;

      if (table === 'customers') {
        // customers has no UPDATE policy — any UPDATE attempt is rejected.
        const { userBId, jwtA } = await seedTwoCustomers();
        const clientA = await getRlsAwareClient(jwtA);
        try {
          const result = await clientA.query(
            `UPDATE customers SET email = 'hack@test.marketpilot.pt' WHERE id = $1`,
            [userBId]
          );
          assert.strictEqual(result.rowCount, 0, `customers UPDATE must be blocked by RLS (rowCount=0)`);
        } finally {
          await clientA.release();
        }
        return;
      }

      if (table === 'customer_profiles') {
        // customer_profiles UPDATE: policy USING(customer_id = auth.uid()) — customer A cannot update B's profile.
        const { userBId, jwtA } = await seedTwoCustomers();
        const clientA = await getRlsAwareClient(jwtA);
        try {
          const result = await clientA.query(
            `UPDATE customer_profiles SET first_name = 'Hacked' WHERE customer_id = $1`,
            [userBId]
          );
          assert.strictEqual(result.rowCount, 0, `customer_profiles UPDATE of B's profile via A's JWT must return rowCount=0`);
        } finally {
          await clientA.release();
        }
        return;
      }

      // Generic: UPDATE ownerCol = customerBId via A's JWT → rowCount 0.
      const { userBId, jwtA } = await seedTwoCustomers();
      await tableConfig.seedHelper(getServiceRoleClient(), userBId);
      const clientA = await getRlsAwareClient(jwtA);
      try {
        const result = await clientA.query(
          `UPDATE ${table} SET ${ownerCol} = ${ownerCol} WHERE ${ownerCol} = $1`,
          [userBId]
        );
        assert.strictEqual(result.rowCount, 0, `RLS must block cross-customer UPDATE in ${table} (rowCount must be 0)`);
      } finally {
        await clientA.release();
      }
    });

    await t.test(`rls_isolation_${table}_customer_a_cannot_delete_customer_b_rows`, async () => {
      if (isDeferred) return;

      if (table === 'customers') {
        // customers has no DELETE policy for authenticated customers.
        const { userBId, jwtA } = await seedTwoCustomers();
        const clientA = await getRlsAwareClient(jwtA);
        try {
          const result = await clientA.query(
            `DELETE FROM customers WHERE id = $1`,
            [userBId]
          );
          assert.strictEqual(result.rowCount, 0, `customers DELETE by authenticated user must return rowCount=0 (no DELETE policy)`);
        } finally {
          await clientA.release();
        }
        return;
      }

      if (table === 'customer_profiles') {
        // customer_profiles has no customer DELETE policy.
        const { userBId, jwtA } = await seedTwoCustomers();
        const clientA = await getRlsAwareClient(jwtA);
        try {
          const result = await clientA.query(
            `DELETE FROM customer_profiles WHERE customer_id = $1`,
            [userBId]
          );
          assert.strictEqual(result.rowCount, 0, `customer_profiles DELETE by authenticated user must return rowCount=0 (no DELETE policy)`);
        } finally {
          await clientA.release();
        }
        return;
      }

      // Generic: DELETE by customer A targeting customer B's rows → rowCount 0.
      const { userBId, jwtA } = await seedTwoCustomers();
      await tableConfig.seedHelper(getServiceRoleClient(), userBId);
      const clientA = await getRlsAwareClient(jwtA);
      try {
        const result = await clientA.query(
          `DELETE FROM ${table} WHERE ${ownerCol} = $1`,
          [userBId]
        );
        assert.strictEqual(result.rowCount, 0, `RLS must block cross-customer DELETE in ${table} (rowCount must be 0)`);
      } finally {
        await clientA.release();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Story 4.1 / AC#4 — shop_api_key_vault row-level RLS isolation
// (deferred placeholder from Epic 2 now replaced with real tests, unlocked by
// customer_marketplaces migration shipping in Story 4.1)
// ---------------------------------------------------------------------------
test('shop_api_key_vault_select_own_policy_exists_and_has_auth_uid_guard', { concurrency: 1 }, async (t) => {
  t.after(async () => {
    await closeServiceRolePool();
  });

  const pool = getServiceRoleClient();
  const exists = await tableExists(pool, 'shop_api_key_vault');

  if (!exists) {
    // Migration not yet applied — skip gracefully.
    return;
  }

  // Assert RLS is enabled and the select policy is present.
  const { rows: policyRows } = await pool.query(
    `SELECT policyname, cmd, qual
     FROM pg_policies
     WHERE tablename = 'shop_api_key_vault' AND schemaname = 'public'`
  );
  assert.ok(policyRows.length > 0, 'shop_api_key_vault must have at least one RLS policy when the table exists');

  const selectPolicy = policyRows.find((p) => p.policyname === 'shop_api_key_vault_select_own');
  assert.ok(selectPolicy, 'shop_api_key_vault_select_own policy must exist');

  // Verify the defensive auth.uid() IS NOT NULL clause was added (Story 1.2 deferred finding).
  const qual = selectPolicy.qual ?? '';
  assert.ok(
    qual.includes('auth.uid() IS NOT NULL') || qual.includes('uid() IS NOT NULL'),
    `shop_api_key_vault_select_own USING clause must include "auth.uid() IS NOT NULL" defensive guard; got: ${qual}`
  );
});

test('shop_api_key_vault_customer_a_cannot_read_customer_b_vault_row', { concurrency: 1 }, async (t) => {
  t.after(async () => {
    await closeServiceRolePool();
    await endResetAuthPool();
  });

  const pool = getServiceRoleClient();
  const vaultExists = await tableExists(pool, 'shop_api_key_vault');
  const cmExists = await tableExists(pool, 'customer_marketplaces');

  if (!vaultExists || !cmExists) {
    // Migrations not yet applied — skip gracefully.
    return;
  }

  await resetAuthAndCustomers();

  const { userAId, userBId, jwtA } = await seedTwoCustomers();

  // Create customer_marketplaces rows for both customers (service-role)
  const { rows: cmBRows } = await pool.query(
    `INSERT INTO customer_marketplaces
       (customer_id, operator, marketplace_instance_url, max_discount_pct)
     VALUES ($1, 'WORTEN', 'https://marketplace.worten.pt', 0.015)
     RETURNING id`,
    [userBId],
  );
  const cmBId = cmBRows[0].id;

  // Create shop_api_key_vault row for customer B
  await pool.query(
    `INSERT INTO shop_api_key_vault
       (customer_marketplace_id, ciphertext, nonce, auth_tag, master_key_version)
     VALUES ($1, '\\xdeadbeef', '\\xdeadbeef', '\\xdeadbeef', 1)`,
    [cmBId],
  );

  // Also seed customer A's marketplace (needed for pre-condition: A is authenticated)
  await pool.query(
    `INSERT INTO customer_marketplaces
       (customer_id, operator, marketplace_instance_url, max_discount_pct)
     VALUES ($1, 'WORTEN', 'https://marketplace.worten.pt', 0.015)`,
    [userAId],
  );

  // Pre-condition: service-role can see B's vault row
  const { rows: preRows } = await pool.query(
    'SELECT customer_marketplace_id FROM shop_api_key_vault WHERE customer_marketplace_id = $1',
    [cmBId],
  );
  assert.strictEqual(preRows.length, 1, 'pre-condition: B vault row must exist via service-role');

  // Customer A's JWT-scoped connection must see 0 vault rows for B's marketplace
  const clientA = await getRlsAwareClient(jwtA);
  try {
    const { rows } = await clientA.query(
      `SELECT s.customer_marketplace_id
       FROM shop_api_key_vault s
       JOIN customer_marketplaces cm ON cm.id = s.customer_marketplace_id
       WHERE cm.customer_id = $1`,
      [userBId],
    );
    assert.strictEqual(
      rows.length,
      0,
      'customer A must not be able to read customer B vault rows in shop_api_key_vault via JOIN',
    );
  } finally {
    await clientA.release();
  }

  await resetAuthAndCustomers();
});

// ---------------------------------------------------------------------------
// AC#4 — Convention: every table in seed is covered in the suite config array
// ---------------------------------------------------------------------------
test('convention_every_seed_table_is_in_regression_config', async () => {
  const seedPath = path.join(REPO_ROOT, 'db', 'seed', 'test', 'two-customers.sql');
  const seedContent = await readFile(seedPath, 'utf8');

  // Strip SQL comments before parsing — both single-line `--` comments and
  // block `/* ... */` comments. Without this, example/template INSERTs that
  // live inside SQL comment blocks (Epic 4 templates, documentation examples)
  // would be picked up as real seed rows and trigger spurious failures.
  // The seed file contains multiple commented-out INSERT examples specifically
  // because Epic 4 will uncomment them.
  const stripped = seedContent
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/--[^\n]*/g, '');           // single-line comments

  // Extract table names from INSERT INTO statements (case-insensitive).
  // Exclude auth.users (system-managed, not in public schema). The captured
  // group matches just the FIRST identifier — for `auth.users` that's `auth`,
  // so we exclude both 'auth' and 'users' to be schema-prefix robust.
  const insertRe = /INSERT\s+INTO\s+(?:public\.)?(\w+)/gi;
  const seededTables = new Set();
  let match;
  while ((match = insertRe.exec(stripped)) !== null) {
    const tableName = match[1].toLowerCase();
    if (tableName !== 'users' && tableName !== 'auth') {
      seededTables.add(tableName);
    }
  }

  const registeredTables = new Set(CUSTOMER_SCOPED_TABLES.map((c) => c.table.toLowerCase()));

  for (const tableName of seededTables) {
    assert.ok(
      registeredTables.has(tableName),
      `table "${tableName}" is present in db/seed/test/two-customers.sql but missing from CUSTOMER_SCOPED_TABLES registry in rls-regression.test.js`
    );
  }
});

// ---------------------------------------------------------------------------
// Convention — script and test-file registries must stay in sync
// (Story 2.2 test review finding — drift risk between two parallel arrays)
//
// The Dev Notes acknowledge "kept in sync manually" for the two
// CUSTOMER_SCOPED_TABLES arrays — this test enforces it. If a future
// developer extends one but forgets the other, this test fails loudly
// rather than letting the suites silently diverge.
// ---------------------------------------------------------------------------
test('convention_script_and_test_registries_match', async () => {
  const scriptPath = path.join(REPO_ROOT, 'scripts', 'rls-regression-suite.js');
  const scriptContent = await readFile(scriptPath, 'utf8');

  // Extract `table: '<name>'` entries inside CUSTOMER_SCOPED_TABLES from the script.
  // Scoped to the array literal to avoid matching unrelated `table:` strings.
  const arrayMatch = scriptContent.match(/CUSTOMER_SCOPED_TABLES\s*=\s*\[([\s\S]*?)\n\]/);
  assert.ok(arrayMatch, 'scripts/rls-regression-suite.js must export a CUSTOMER_SCOPED_TABLES array literal');
  const scriptTableRe = /table:\s*['"]([\w]+)['"]/g;
  const scriptTables = new Set();
  let m;
  while ((m = scriptTableRe.exec(arrayMatch[1])) !== null) {
    scriptTables.add(m[1].toLowerCase());
  }

  const testTables = new Set(CUSTOMER_SCOPED_TABLES.map((c) => c.table.toLowerCase()));

  const onlyInTest = [...testTables].filter((t) => !scriptTables.has(t));
  const onlyInScript = [...scriptTables].filter((t) => !testTables.has(t));

  assert.deepStrictEqual(
    { onlyInTest, onlyInScript },
    { onlyInTest: [], onlyInScript: [] },
    `CUSTOMER_SCOPED_TABLES drift between rls-regression.test.js and rls-regression-suite.js — ` +
    `add the missing tables to BOTH registries (Dev Note: kept in sync manually).`
  );
});

// ---------------------------------------------------------------------------
// AC#3 — npm run test:rls exits non-zero on RLS failure (structural assertion)
// ---------------------------------------------------------------------------
test('test_rls_script_exits_nonzero_on_failure', async () => {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  } catch {
    assert.fail('package.json not found at repo root');
  }
  const script = pkg.scripts?.['test:rls'];
  assert.ok(script, 'npm run test:rls must be defined in package.json scripts');
  // Must invoke BOTH the integration test AND the standalone script.
  // The two are not redundant: the integration test covers parameterized
  // node:test assertions; the standalone script is the AD30-canonical CI
  // gate that exits non-zero on any RLS failure. Dropping either weakens
  // CI coverage, so structurally enforce both invocations.
  assert.ok(
    script.includes('rls-regression.test.js'),
    `test:rls script must invoke tests/integration/rls-regression.test.js; got: "${script}"`
  );
  assert.ok(
    script.includes('scripts/rls-regression-suite.js') || script.includes('scripts\\rls-regression-suite.js'),
    `test:rls script must invoke scripts/rls-regression-suite.js; got: "${script}"`
  );
  assert.ok(
    !script.includes('|| true') && !script.includes('2>/dev/null'),
    `test:rls script must not suppress exit code; got: "${script}"`
  );
});

// ---------------------------------------------------------------------------
// AC#5 — Negative: no customer-scoped table migration shipped without RLS policy
// ---------------------------------------------------------------------------
test('negative_assertion_no_migration_missing_rls_policy', async () => {
  const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
  const entries = await readdir(migrationsDir);

  // System-only tables that are intentionally exempt from customer-facing RLS.
  // audit_log_event_types — Story 9.0: lookup/reference data, not customer-scoped.
  //   Read-only reference data (26 seeded event types); shared across all tenants.
  //   No customer PII. Publicly readable within the service-role. No RLS required.
  //   FKs flow inward: audit_log.event_type → audit_log_event_types.event_type (Story 9.1).
  const EXEMPT_TABLES = new Set(['worker_heartbeats', 'founder_admins', 'audit_log_event_types']);

  // Skip deferred migration files (not yet applied — may reference tables that don't exist).
  // Match `.sql.deferred` rather than the bare substring `.deferred` so future
  // legitimate migration filenames that happen to contain "deferred" (e.g.
  // a hypothetical `2026xxxx_create_deferred_jobs_table.sql`) aren't silently
  // skipped by the convention check. The deferred-migration filename pattern
  // in this repo is always `<timestamp>_<name>.sql.deferred-until-story-X.X`.
  const activeFiles = entries.filter((f) => !f.includes('.sql.deferred'));

  const gaps = [];

  for (const fileName of activeFiles) {
    const filePath = path.join(migrationsDir, fileName);
    const rawContent = await readFile(filePath, 'utf8');

    // Strip SQL comments first so commented-out CREATE TABLE / CREATE POLICY
    // examples don't satisfy or trip the convention check. Defensive: today
    // no migration has commented DDL, but Epic 4+ migrations may include
    // documentation comments referencing CREATE TABLE.
    const content = rawContent
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '');

    // Find all CREATE TABLE statements in this file.
    // Capture the token after the table name to detect PARTITION OF child tables —
    // partition children inherit RLS from the parent and do NOT need separate
    // ALTER TABLE ... ENABLE ROW LEVEL SECURITY or CREATE POLICY statements.
    // Story 9.1: audit_log_2026_05 ... audit_log_2027_04 are partition children of
    // audit_log whose RLS is enabled and policy defined on the parent table.
    const createTableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*(\w*)/gi;
    let tableMatch;
    while ((tableMatch = createTableRe.exec(content)) !== null) {
      const tableName = tableMatch[1].toLowerCase();
      const nextToken = (tableMatch[2] || '').toUpperCase();
      // Skip PARTITION OF child tables — they inherit RLS from their parent.
      if (nextToken === 'PARTITION') continue;
      if (EXEMPT_TABLES.has(tableName)) continue;

      // Check whether this file enables RLS for THIS specific table and defines
      // a policy for it. The RLS-enable check must be table-scoped: a multi-table
      // migration that enables RLS on only one of two tables would otherwise
      // pass the convention check for both. The previous global-test version
      // (`/ALTER TABLE ... ENABLE ROW LEVEL SECURITY/.test(content)`) silently
      // approved any file that enabled RLS on at least one table — losing
      // per-table coverage.
      const hasRlsForTable = new RegExp(
        `ALTER\\s+TABLE\\s+(?:public\\.)?${tableName}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        'i'
      ).test(content);
      const hasPolicyForTable = new RegExp(
        `CREATE\\s+POLICY\\s+\\w+\\s+ON\\s+(?:public\\.)?${tableName}`,
        'i'
      ).test(content);

      if (!hasRlsForTable || !hasPolicyForTable) {
        gaps.push(`${fileName}: CREATE TABLE ${tableName} exists but missing RLS ENABLE for ${tableName} or companion POLICY on ${tableName}`);
      }
    }
  }

  assert.strictEqual(
    gaps.length,
    0,
    `The following migrations are missing RLS policies:\n${gaps.join('\n')}`
  );
});
