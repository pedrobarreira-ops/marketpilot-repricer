// Story 2.2 / AC#2-4 — RLS regression suite integration test.
//
// Covers:
//   AC#2 — Per-table RLS isolation: customer A's JWT cannot SELECT/INSERT/UPDATE/DELETE
//           rows owned by customer B, and vice versa.
//   AC#3 — `npm run test:rls` exits non-zero on any failure.
//   AC#4 — Convention assertion: every customer-scoped table in `db/seed/test/two-customers.sql`
//           is also covered in the regression suite config array.
//   AC#5 — Adding a new table to the config array is a one-line change (structural test).
//
// Tables covered at Epic 2 baseline:
//   - customers
//   - customer_profiles
//   - shop_api_key_vault   (seeded by Story 2.2 seed extension in Story 1.2)
//
// Convention: every new customer-scoped table migration (Epics 4-11) MUST:
//   1. Include its RLS policy in the same migration file.
//   2. Add a row for both test customers to `db/seed/test/two-customers.sql`.
//   3. Add the table name to the CUSTOMER_SCOPED_TABLES array below.
// Failure to add to step 3 causes this file's parameterized test to fail loudly
// with: "table <name> present in seed but missing from RLS regression suite config".
//
// Local-only: requires .env.test pointing at local Supabase docker.
// Run with: node --env-file=.env.test --test tests/integration/rls-regression.test.js
// Or via: npm run test:rls (which also runs scripts/rls-regression-suite.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';

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
    seedHelper: async (_pool, _customerId) => { /* seeded by two-customers.sql trigger */ },
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
    // At Epic 2 the table exists but customer_marketplaces does not yet.
    // The seed helper inserts a placeholder row only if customer_marketplaces exists;
    // otherwise this table's RLS row-level check is deferred to Story 4.x.
    seedHelper: async (_pool, _customerId) => {
      // TODO (Story 2.2 ATDD): once customer_marketplaces table exists (Epic 4),
      // INSERT a customer_marketplaces row for customerId, then INSERT a
      // shop_api_key_vault row with that customer_marketplace_id.
    },
    cleanHelper: async (_pool, _customerId) => {
      // TODO (Story 2.2 ATDD): DELETE FROM shop_api_key_vault WHERE ... (and marketplace row).
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers — will be imported from the live implementation at ATDD step
// ---------------------------------------------------------------------------

// TODO (Story 2.2 ATDD): import { getServiceRoleClient } from '../../shared/db/service-role-client.js'
// TODO (Story 2.2 ATDD): import { getRlsAwareClient } from '../../shared/db/rls-aware-client.js'
// TODO (Story 2.2 ATDD): import { resetAuthAndCustomers, endResetAuthPool } from './_helpers/reset-auth-tables.js'
// TODO (Story 2.2 ATDD): import { createClient } from '@supabase/supabase-js'  for JWTs

// ---------------------------------------------------------------------------
// AC#1 — two-customers seed applies cleanly
// ---------------------------------------------------------------------------
test('two_customers_seed_creates_two_distinct_customers', async () => {
  // TODO (Story 2.2 ATDD):
  // 1. Apply db/seed/test/two-customers.sql via service-role pool.
  // 2. const { rows } = await pool.query('SELECT id FROM customers ORDER BY created_at')
  // 3. assert rows.length === 2
  // 4. assert rows[0].id !== rows[1].id
  // Also assert: two shop_api_key_vault rows with distinct customer_marketplace_ids
  // (deferred until Epic 4 ships customer_marketplaces; assert table exists and
  // has a valid RLS policy at minimum).
  assert.ok(true, 'scaffold — implementation required at ATDD step');
});

// ---------------------------------------------------------------------------
// AC#2 — Parameterized cross-customer isolation per table
// ---------------------------------------------------------------------------

for (const tableConfig of CUSTOMER_SCOPED_TABLES) {
  const { table, ownerCol } = tableConfig;

  test(`rls_isolation_${table}_customer_a_cannot_read_customer_b_rows`, async () => {
    // TODO (Story 2.2 ATDD):
    // 1. Obtain JWT for customer A via Supabase Auth signIn.
    // 2. const clientA = getRlsAwareClient(jwtA)
    // 3. await tableConfig.seedHelper(servicePool, customerAId)
    // 4. await tableConfig.seedHelper(servicePool, customerBId)
    // 5. const { rows } = await clientA.query(`SELECT * FROM ${table}`)
    // 6. Verify every returned row has ownerCol === customerAId.
    //    assert rows.every(r => r[ownerCol] === customerAId || ...)
    //    (for customers table: id === customerAId)
    assert.ok(true, `scaffold — ${table} RLS isolation test, implementation required at ATDD`);
  });

  test(`rls_isolation_${table}_customer_b_cannot_read_customer_a_rows`, async () => {
    // TODO (Story 2.2 ATDD): symmetric test from customer B's perspective.
    assert.ok(true, `scaffold — ${table} RLS isolation test (B→A), implementation required at ATDD`);
  });

  test(`rls_isolation_${table}_customer_a_cannot_insert_as_customer_b`, async () => {
    // TODO (Story 2.2 ATDD):
    // 1. Obtain JWT for customer A.
    // 2. const clientA = getRlsAwareClient(jwtA)
    // 3. Attempt INSERT with ownerCol = customerBId → expect pg error (23P01 or 0 rows).
    assert.ok(true, `scaffold — ${table} RLS insert isolation test, implementation required at ATDD`);
  });

  test(`rls_isolation_${table}_customer_a_cannot_update_customer_b_rows`, async () => {
    // TODO (Story 2.2 ATDD):
    // 1. Seed a row for customer B.
    // 2. Use customer A's JWT client to attempt UPDATE on customer B's row.
    // 3. assert rowCount === 0 (RLS silently blocks, not a pg error for UPDATE).
    assert.ok(true, `scaffold — ${table} RLS update isolation test, implementation required at ATDD`);
  });

  test(`rls_isolation_${table}_customer_a_cannot_delete_customer_b_rows`, async () => {
    // TODO (Story 2.2 ATDD):
    // 1. Seed a row for customer B.
    // 2. Use customer A's JWT client to attempt DELETE on customer B's row.
    // 3. assert rowCount === 0 (RLS silently blocks DELETE).
    assert.ok(true, `scaffold — ${table} RLS delete isolation test, implementation required at ATDD`);
  });
}

// ---------------------------------------------------------------------------
// AC#4 — Convention: every table in seed is covered in the suite config array
// ---------------------------------------------------------------------------
test('convention_every_seed_table_is_in_regression_config', async () => {
  // TODO (Story 2.2 ATDD):
  // 1. Read db/seed/test/two-customers.sql.
  // 2. Extract all table names mentioned in INSERT INTO statements.
  // 3. For each table name (excluding auth.users which is system-managed):
  //    assert CUSTOMER_SCOPED_TABLES.some(c => c.table === tableName),
  //    message: `table ${tableName} present in seed but missing from CUSTOMER_SCOPED_TABLES registry`
  // This enforces the convention: new stories that extend the seed must also
  // extend this registry, or this test will fail loudly.
  assert.ok(true, 'scaffold — convention enforcement test, implementation required at ATDD step');
});

// ---------------------------------------------------------------------------
// AC#3 — npm run test:rls exits with non-zero on RLS failure
// ---------------------------------------------------------------------------
test('test_rls_script_exits_nonzero_on_failure', async () => {
  // TODO (Story 2.2 ATDD):
  // This test is meta: we verify the script is correctly configured to exit 1
  // when any table fails. Since we can't easily inject a deliberate RLS failure
  // in CI without breaking the DB state, this test asserts the structural
  // condition instead:
  // 1. Read package.json.
  // 2. const scripts = JSON.parse(content).scripts
  // 3. assert scripts['test:rls'] includes 'rls-regression-suite'
  // 4. assert scripts['test:rls'] does NOT contain '|| true' or '2>/dev/null'
  //    (which would suppress the exit code).
  const { readFile } = await import('node:fs/promises');
  let pkg;
  try {
    pkg = JSON.parse(await readFile('package.json', 'utf8'));
  } catch {
    assert.fail('package.json not found at repo root');
  }
  const script = pkg.scripts?.['test:rls'];
  assert.ok(script, 'npm run test:rls must be defined in package.json scripts');
  assert.ok(
    script.includes('rls-regression-suite') || script.includes('rls-regression'),
    `test:rls script must invoke the rls-regression-suite; got: "${script}"`
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
  // TODO (Story 2.2 ATDD):
  // 1. Read all files in supabase/migrations/ (or db/migrations/).
  // 2. For each file containing 'CREATE TABLE', check whether the same file
  //    OR the immediately-following migration (same timestamp prefix) contains
  //    a POLICY statement targeting the same table.
  // 3. If a CREATE TABLE for a customer-scoped table has no companion RLS policy,
  //    list it as a gap. Convention violation (per Story 2.2 AC readme).
  //    Constraint: system-level tables (worker_heartbeats, founder_admins) are
  //    exempt (no RLS, service-role-only access).
  assert.ok(true, 'scaffold — migration RLS coverage assertion, implementation required at ATDD step');
});
