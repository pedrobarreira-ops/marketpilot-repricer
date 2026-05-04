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
    table: 'shop_api_key_vault',
    ownerCol: 'customer_marketplace_id',
    // Note: customer_marketplace_id is a FK to customer_marketplaces (Epic 4).
    // At Epic 2 the table exists (via deferred migration, once applied) but
    // customer_marketplaces does not yet. Row-level RLS isolation is deferred to Story 4.x.
    // The test skips row ops when the table doesn't exist; policy existence is checked separately.
    seedHelper: async (_pool, _customerId) => {
      // Deferred until Epic 4 ships customer_marketplaces migration.
      // Story 4.2: INSERT INTO customer_marketplaces (...) then shop_api_key_vault (...).
    },
    cleanHelper: async (_pool, _customerId) => {
      // Deferred until Epic 4 ships customer_marketplaces migration.
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

      const { userAId, userBId, jwtA } = await seedTwoCustomers();
      await tableConfig.seedHelper(getServiceRoleClient(), userAId);
      await tableConfig.seedHelper(getServiceRoleClient(), userBId);

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

      const { userAId, userBId, jwtB } = await seedTwoCustomers();
      await tableConfig.seedHelper(getServiceRoleClient(), userAId);
      await tableConfig.seedHelper(getServiceRoleClient(), userBId);

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
        // creates the row. Attempt an INSERT and assert it is rejected.
        const { userAId: _aId, userBId, jwtA } = await seedTwoCustomers();
        const clientA = await getRlsAwareClient(jwtA);
        try {
          let threw = false;
          try {
            await clientA.query(
              `INSERT INTO customers (id, email) VALUES ($1, 'hack@test.marketpilot.pt')`,
              [userBId]
            );
          } catch {
            threw = true;
          }
          assert.ok(threw, `customers INSERT by authenticated user must be rejected (no INSERT policy)`);
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
          let threw = false;
          try {
            await clientA.query(
              `INSERT INTO customer_profiles (customer_id, first_name, last_name, company_name)
               VALUES ($1, 'Hack', 'Hack', 'Hack Corp')`,
              [userBId]
            );
          } catch {
            threw = true;
          }
          assert.ok(threw, `customer_profiles INSERT by authenticated user must be rejected (no INSERT policy)`);
        } finally {
          await clientA.release();
        }
        return;
      }

      // Generic: try INSERT with ownerCol = customerBId — expect rejection.
      const { userAId: _aId, userBId, jwtA } = await seedTwoCustomers();
      const clientA = await getRlsAwareClient(jwtA);
      try {
        let threw = false;
        try {
          await clientA.query(
            `INSERT INTO ${table} (${ownerCol}) VALUES ($1)`,
            [userBId]
          );
        } catch {
          threw = true;
        }
        assert.ok(threw, `INSERT with ${ownerCol}=customerBId via customer A's JWT must be rejected by RLS in ${table}`);
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
// AC#5 — Deferred: assert shop_api_key_vault RLS policy exists in pg_policies
// (row-level isolation deferred until Epic 4)
// ---------------------------------------------------------------------------
test('rls_isolation_shop_api_key_vault_deferred_awaiting_epic4', { concurrency: 1 }, async (t) => {
  t.after(async () => {
    await closeServiceRolePool();
  });

  const pool = getServiceRoleClient();
  const exists = await tableExists(pool, 'shop_api_key_vault');

  if (!exists) {
    // Migration is deferred (202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1)
    // — table not yet applied. This is expected at Epic 2 baseline.
    return;
  }

  // Table exists: assert RLS is enabled and the select policy is present.
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

// ---------------------------------------------------------------------------
// AC#4 — Convention: every table in seed is covered in the suite config array
// ---------------------------------------------------------------------------
test('convention_every_seed_table_is_in_regression_config', async () => {
  const seedPath = path.join(REPO_ROOT, 'db', 'seed', 'test', 'two-customers.sql');
  const seedContent = await readFile(seedPath, 'utf8');

  // Extract table names from INSERT INTO statements (case-insensitive).
  // Exclude auth.users (system-managed, not in public schema).
  const insertRe = /INSERT\s+INTO\s+(?:public\.)?(\w+)/gi;
  const seededTables = new Set();
  let match;
  while ((match = insertRe.exec(seedContent)) !== null) {
    const tableName = match[1].toLowerCase();
    if (tableName !== 'users') { // auth.users is excluded
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
  assert.ok(
    script.includes('rls-regression-suite') || script.includes('rls-regression'),
    `test:rls script must invoke the rls-regression suite; got: "${script}"`
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
  const EXEMPT_TABLES = new Set(['worker_heartbeats', 'founder_admins']);

  // Skip deferred migration files (not yet applied — may reference tables that don't exist).
  const activeFiles = entries.filter((f) => !f.includes('.deferred'));

  const gaps = [];

  for (const fileName of activeFiles) {
    const filePath = path.join(migrationsDir, fileName);
    const content = await readFile(filePath, 'utf8');

    // Find all CREATE TABLE statements in this file.
    const createTableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
    let tableMatch;
    while ((tableMatch = createTableRe.exec(content)) !== null) {
      const tableName = tableMatch[1].toLowerCase();
      if (EXEMPT_TABLES.has(tableName)) continue;

      // Check whether this file enables RLS and defines a policy for the table.
      const hasRls = /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(content);
      const hasPolicyForTable = new RegExp(
        `CREATE\\s+POLICY\\s+\\w+\\s+ON\\s+(?:public\\.)?${tableName}`,
        'i'
      ).test(content);

      if (!hasRls || !hasPolicyForTable) {
        gaps.push(`${fileName}: CREATE TABLE ${tableName} exists but missing RLS ENABLE or companion POLICY`);
      }
    }
  }

  assert.strictEqual(
    gaps.length,
    0,
    `The following migrations are missing RLS policies:\n${gaps.join('\n')}`
  );
});
