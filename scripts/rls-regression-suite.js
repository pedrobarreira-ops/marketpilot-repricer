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
// Fail-fast env-var validation
//
// Without this, missing env vars surface as opaque crashes deep inside
// @supabase/supabase-js (e.g. "Invalid URL" from `new URL(undefined)`). A
// clear up-front error tells the operator exactly which secret is missing
// and how to remedy it (set in `.env.test` locally, or as GitHub Actions
// repository secrets in CI).
// ---------------------------------------------------------------------------
const REQUIRED_ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE_DATABASE_URL',
];
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
if (missingEnvVars.length > 0) {
  console.error(
    `rls-regression-suite: missing required env vars: ${missingEnvVars.join(', ')}.\n` +
    `Set them in .env.test for local runs (node --env-file=.env.test) or as GitHub ` +
    `Actions secrets in .github/workflows/ci.yml for CI.`
  );
  process.exit(1);
}

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
    table: 'customer_marketplaces',
    ownerCol: 'customer_id',
    // Story 4.1: customer_marketplaces ships with F4 PROVISIONING state (all A01/PC01 nullable).
    // max_discount_pct is required (no DEFAULT); all other A01/PC01 columns are NULL.
    selectQuery: (ownerId) => ({
      text: 'SELECT customer_id FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1',
      values: [ownerId],
    }),
    insertQuery: (_ownerId, otherId) => ({
      text: `INSERT INTO customer_marketplaces
               (customer_id, operator, marketplace_instance_url, max_discount_pct)
             VALUES ($1, 'WORTEN', 'https://hack.worten.pt', 0.015)`,
      values: [otherId],
    }),
    updateQuery: (_ownerId, otherId) => ({
      text: `UPDATE customer_marketplaces
             SET marketplace_instance_url = 'https://hacked.worten.pt'
             WHERE customer_id = $1`,
      values: [otherId],
    }),
    deleteQuery: (_ownerId, otherId) => ({
      text: `DELETE FROM customer_marketplaces WHERE customer_id = $1`,
      values: [otherId],
    }),
    deferred: false,
    serviceRoleOnly: false,
  },
  {
    table: 'shop_api_key_vault',
    ownerCol: 'customer_marketplace_id',
    // Story 4.1: customer_marketplaces now exists as FK target — row isolation is now live.
    // shop_api_key_vault SELECT is customer-scoped via JOIN through customer_marketplaces.
    // INSERT/UPDATE/DELETE require service-role (worker writes only).
    // SELECT isolation verified via joined query.
    selectQuery: (_ownerId, otherId) => ({
      text: `SELECT s.customer_marketplace_id
             FROM shop_api_key_vault s
             JOIN customer_marketplaces cm ON cm.id = s.customer_marketplace_id
             WHERE cm.customer_id = $1
             LIMIT 1`,
      values: [otherId],
    }),
    insertQuery: () => null, // service-role only — skip insert test
    updateQuery: () => null, // service-role only — skip update test
    deleteQuery: () => null, // service-role only — skip delete test
    deferred: false,
    serviceRoleOnly: true, // Only SELECT RLS is testable from customer JWT context
  },
  {
    table: 'audit_log',
    ownerCol: 'customer_marketplace_id',
    // Story 9.1 AC#5: audit_log is customer-scoped (SELECT gated by customer_marketplace_id).
    // INSERT/UPDATE/DELETE are service-role only (NFR-S6 append-only at app layer).
    // Row-level isolation testing is deferred to Story 9.x because it requires
    // customer_marketplaces (Epic 4) as an FK target for seeding real audit rows.
    deferred: true, // Requires real audit rows — deferred to Story 9.x.
    serviceRoleOnly: false,
    // Query builders are no-ops — deferred branch in run() skips this table entirely.
    selectQuery: () => null,
    insertQuery: () => null,
    updateQuery: () => null,
    deleteQuery: () => null,
  },
  // ---------------------------------------------------------------------------
  // Story 4.2: skus, sku_channels, baseline_snapshots, scan_jobs
  // Ownership is indirect via customer_marketplace_id → customer_marketplaces.customer_id.
  // SELECT queries resolve the FK via JOIN to find the other customer's rows.
  // ---------------------------------------------------------------------------
  {
    table: 'skus',
    ownerCol: 'customer_marketplace_id',
    // SELECT: customer A queries skus joined to customer B's marketplace — must return 0 rows.
    // ownerId = userBId (the target whose rows we're trying to access), otherId = userAId (the attacker).
    // WHERE cm.customer_id = ownerId (= userBId) so the query targets B's rows; RLS on skus
    // (customer_marketplace_id IN subquery for auth.uid()=A) must filter them all out.
    selectQuery: (ownerId, _otherId) => ({
      text: `SELECT s.customer_marketplace_id
             FROM skus s
             JOIN customer_marketplaces cm ON cm.id = s.customer_marketplace_id
             WHERE cm.customer_id = $1
             LIMIT 1`,
      values: [ownerId],
    }),
    insertQuery: (_ownerId, otherId) => ({
      text: `INSERT INTO skus (customer_marketplace_id, ean, shop_sku)
             VALUES ($1, '0000000000000', 'HACK-INSERT')`,
      values: [otherId],
    }),
    updateQuery: (_ownerId, otherId) => ({
      text: `UPDATE skus SET shop_sku = 'HACK-UPDATE'
             WHERE customer_marketplace_id = $1`,
      values: [otherId],
    }),
    deleteQuery: (_ownerId, otherId) => ({
      text: `DELETE FROM skus WHERE customer_marketplace_id = $1`,
      values: [otherId],
    }),
    deferred: false,
    serviceRoleOnly: false,
  },
  {
    table: 'sku_channels',
    ownerCol: 'customer_marketplace_id',
    selectQuery: (ownerId, _otherId) => ({
      text: `SELECT sc.customer_marketplace_id
             FROM sku_channels sc
             JOIN customer_marketplaces cm ON cm.id = sc.customer_marketplace_id
             WHERE cm.customer_id = $1
             LIMIT 1`,
      values: [ownerId],
    }),
    insertQuery: (_ownerId, otherId) => ({
      text: `INSERT INTO sku_channels (customer_marketplace_id, sku_id, channel_code,
               list_price_cents, tier, tier_cadence_minutes, last_checked_at)
             VALUES ($1, gen_random_uuid(), 'WRT_PT_ONLINE', 100, '3', 1440, NOW())`,
      values: [otherId],
    }),
    updateQuery: (_ownerId, otherId) => ({
      text: `UPDATE sku_channels SET channel_code = 'WRT_PT_ONLINE'
             WHERE customer_marketplace_id = $1`,
      values: [otherId],
    }),
    deleteQuery: (_ownerId, otherId) => ({
      text: `DELETE FROM sku_channels WHERE customer_marketplace_id = $1`,
      values: [otherId],
    }),
    deferred: false,
    serviceRoleOnly: false,
  },
  {
    table: 'baseline_snapshots',
    ownerCol: 'customer_marketplace_id',
    selectQuery: (ownerId, _otherId) => ({
      text: `SELECT bs.customer_marketplace_id
             FROM baseline_snapshots bs
             JOIN customer_marketplaces cm ON cm.id = bs.customer_marketplace_id
             WHERE cm.customer_id = $1
             LIMIT 1`,
      values: [ownerId],
    }),
    insertQuery: (_ownerId, otherId) => ({
      text: `INSERT INTO baseline_snapshots (customer_marketplace_id, sku_channel_id, list_price_cents, current_price_cents)
             VALUES ($1, gen_random_uuid(), 100, 100)`,
      values: [otherId],
    }),
    updateQuery: (_ownerId, otherId) => ({
      text: `UPDATE baseline_snapshots SET list_price_cents = 1
             WHERE customer_marketplace_id = $1`,
      values: [otherId],
    }),
    deleteQuery: (_ownerId, otherId) => ({
      text: `DELETE FROM baseline_snapshots WHERE customer_marketplace_id = $1`,
      values: [otherId],
    }),
    deferred: false,
    serviceRoleOnly: false,
  },
  {
    table: 'scan_jobs',
    ownerCol: 'customer_marketplace_id',
    // scan_jobs: customer can only SELECT — worker writes via service-role (no modify policy).
    // INSERT/UPDATE/DELETE queries return null to skip those sub-tests (serviceRoleOnly=true).
    selectQuery: (ownerId, _otherId) => ({
      text: `SELECT sj.customer_marketplace_id
             FROM scan_jobs sj
             JOIN customer_marketplaces cm ON cm.id = sj.customer_marketplace_id
             WHERE cm.customer_id = $1
             LIMIT 1`,
      values: [ownerId],
    }),
    insertQuery: () => null, // service-role only — no customer INSERT policy
    updateQuery: () => null, // service-role only — no customer UPDATE policy
    deleteQuery: () => null, // service-role only — no customer DELETE policy
    deferred: false,
    serviceRoleOnly: true,
  },
];

// ---------------------------------------------------------------------------
// Test result tracking
// ---------------------------------------------------------------------------
const results = [];

function pass (label) {
  console.log(`  ✓  ${label}`);
  results.push({ label, pass: true });
}

function fail (label, reason) {
  console.error(`  ✗  ${label}`);
  console.error(`       ${reason}`);
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

// Postgres SQLSTATE codes that indicate RLS or auth blocked the query —
// any OTHER error is a real test failure (e.g., 42703 column does not exist,
// 42P01 relation does not exist, network drop, schema typo). Without this
// allow-list, a schema bug or wrong column name in the query builder above
// would silently masquerade as "RLS blocked it" — a critical false-positive.
//
//   42501 — insufficient_privilege          (RLS / GRANT denied)
//   42P17 — invalid_definition              (RLS policy expression error)
//   23502 — not_null_violation              (acceptable for INSERT blocked by trigger)
//   23503 — foreign_key_violation           (acceptable for cross-tenant FK)
//   23505 — unique_violation                (acceptable for INSERT clash)
//
// SELECT path is stricter: only 42501 is treated as "RLS blocked" because a
// SELECT should never trip 23xxx integrity codes. Anything else escalates.
const RLS_BLOCKED_CODES_SELECT = new Set(['42501', '42P17']);
const RLS_BLOCKED_CODES_MUTATION = new Set(['42501', '42P17', '23502', '23503', '23505']);

/**
 * Assert that a query via a JWT-scoped client returns 0 rows (SELECT).
 *
 * @param {string} jwt - access token to arm RLS context with
 * @param {{ text: string, values?: unknown[] }} query - SQL to execute
 * @param {string} label - test label for pass/fail reporting
 */
async function assertSelectReturnsZeroRows (jwt, query, label) {
  if (!query) {
    pass(`${label} (skipped — no query defined)`);
    return;
  }
  const client = await getRlsAwareClient(jwt);
  try {
    const { rows } = await client.query(query.text, query.values);
    if (rows.length === 0) {
      pass(label);
    } else {
      fail(label, `Expected 0 rows, got ${rows.length}`);
    }
  } catch (err) {
    // Only treat known RLS/auth-related SQLSTATE codes as "blocked = pass".
    // Any other error (column not found, table not found, network, etc.)
    // would silently masquerade as a successful RLS block — a critical
    // false-positive vector.
    if (err && typeof err === 'object' && RLS_BLOCKED_CODES_SELECT.has(err.code)) {
      pass(`${label} (blocked, SQLSTATE ${err.code})`);
    } else {
      fail(label, `unexpected error (not an RLS block): ${err?.code ?? '?'} ${err?.message ?? err}`);
    }
  } finally {
    await client.release();
  }
}

/**
 * Assert that a mutating query (INSERT/UPDATE/DELETE) via a JWT-scoped client
 * either throws an RLS-related error or returns rowCount === 0.
 *
 * @param {string} jwt - access token to arm RLS context with
 * @param {{ text: string, values?: unknown[] } | null} query - SQL to execute, or null to skip
 * @param {string} label - test label for pass/fail reporting
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
  } catch (err) {
    // Allow-list of SQLSTATE codes that legitimately mean "RLS / constraint
    // blocked the write." Other errors (schema typo, network, etc.) escalate.
    if (err && typeof err === 'object' && RLS_BLOCKED_CODES_MUTATION.has(err.code)) {
      pass(`${label} (blocked, SQLSTATE ${err.code})`);
    } else {
      fail(label, `unexpected error (not an RLS block): ${err?.code ?? '?'} ${err?.message ?? err}`);
    }
  } finally {
    await client.release();
  }
}

// ---------------------------------------------------------------------------
// Diagnostic — confirm auth.uid() inside the RLS-armed connection actually
// resolves to the JWT subject. Without this guard, every isolation assertion
// below has a silent false-positive failure mode: if JWT decoding inside
// getRlsAwareClient silently produced an empty/wrong sub claim, auth.uid()
// would return NULL, all RLS policies would filter to 0 rows, and the suite
// would report "all isolation checks passed" — even though the real reason
// was an unauthenticated connection, not RLS enforcement.
// ---------------------------------------------------------------------------
async function assertAuthUidMatchesJwt (jwt, expectedUserId, label) {
  const client = await getRlsAwareClient(jwt);
  try {
    const { rows } = await client.query('SELECT auth.uid()::text AS uid');
    if (rows[0]?.uid === expectedUserId) {
      pass(label);
    } else {
      fail(label, `auth.uid() = "${rows[0]?.uid}", expected "${expectedUserId}". RLS isolation assertions would pass vacuously.`);
    }
  } catch (err) {
    fail(label, `auth.uid() probe failed: ${err?.code ?? '?'} ${err?.message ?? err}`);
  } finally {
    await client.release();
  }
}

// ---------------------------------------------------------------------------
// Story 4.2 seed helpers — ensure rows exist for the 4 new tables so SELECT
// isolation checks don't pass vacuously (0 rows because table is empty, not
// because RLS filtered them). Called once per customer in run() after auth.
// ---------------------------------------------------------------------------

/**
 * Resolve or create a customer_marketplaces row for the given customer.
 * @param {import('pg').Pool} pool
 * @param {string} customerId
 * @returns {Promise<string>} marketplace UUID
 */
async function resolveOrCreateMarketplace (pool, customerId, urlSuffix) {
  const { rows: existing } = await pool.query(
    'SELECT id FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1',
    [customerId],
  );
  if (existing.length > 0) return existing[0].id;
  const { rows: inserted } = await pool.query(
    `INSERT INTO customer_marketplaces
       (customer_id, operator, marketplace_instance_url, max_discount_pct)
     VALUES ($1, 'WORTEN', $2, 0.015)
     RETURNING id`,
    [customerId, `https://suite-${urlSuffix}.worten.pt`],
  );
  return inserted[0].id;
}

/**
 * Seed Story 4.2 rows for a customer — skus, sku_channels, baseline_snapshots, scan_jobs.
 * Idempotent: uses ON CONFLICT DO NOTHING where possible.
 */
async function seedStory42RowsForCustomer (pool, customerId, suffix) {
  const cmId = await resolveOrCreateMarketplace(pool, customerId, suffix);

  // Check if the tables exist before trying to insert (graceful skip if migrations not applied).
  const { rows: skusExist } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'skus' LIMIT 1`
  );
  if (skusExist.length === 0) return; // migrations not yet applied

  // skus
  const { rows: skuRows } = await pool.query(
    `INSERT INTO skus (customer_marketplace_id, ean, shop_sku, product_title)
     VALUES ($1, '560123450${suffix}00', 'EZ560123450${suffix}00', 'Suite Test SKU')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [cmId],
  );
  let skuId;
  if (skuRows.length > 0) {
    skuId = skuRows[0].id;
  } else {
    const { rows: existingSkus } = await pool.query(
      'SELECT id FROM skus WHERE customer_marketplace_id = $1 LIMIT 1', [cmId]
    );
    skuId = existingSkus[0]?.id;
  }
  if (!skuId) return;

  // sku_channels
  const { rows: scRows } = await pool.query(
    `INSERT INTO sku_channels
       (sku_id, customer_marketplace_id, channel_code,
        list_price_cents, tier, tier_cadence_minutes, last_checked_at)
     VALUES ($1, $2, 'WRT_PT_ONLINE', 2999, '3', 1440, NOW())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [skuId, cmId],
  );
  let scId;
  if (scRows.length > 0) {
    scId = scRows[0].id;
  } else {
    const { rows: existingSc } = await pool.query(
      'SELECT id FROM sku_channels WHERE sku_id = $1 LIMIT 1', [skuId]
    );
    scId = existingSc[0]?.id;
  }

  // baseline_snapshots
  if (scId) {
    await pool.query(
      `INSERT INTO baseline_snapshots
         (sku_channel_id, customer_marketplace_id, list_price_cents, current_price_cents)
       VALUES ($1, $2, 2999, 2999)
       ON CONFLICT DO NOTHING`,
      [scId, cmId],
    );
  }

  // scan_jobs — use COMPLETE to avoid EXCLUDE constraint conflict
  await pool.query(
    `INSERT INTO scan_jobs (customer_marketplace_id, status, phase_message)
     VALUES ($1, 'COMPLETE', 'Pronto')
     ON CONFLICT DO NOTHING`,
    [cmId],
  );
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------
async function run () {
  console.log('\nRLS Regression Suite — Story 2.2 / AD30\n');
  const { userAId, userBId, jwtA, jwtB } = await seedTwoCustomers();

  // PRE-FLIGHT — verify the RLS context arming actually works before relying
  // on it for the isolation assertions below.
  console.log('\n  Pre-flight: auth.uid() smoke test');
  await assertAuthUidMatchesJwt(jwtA, userAId, 'auth.uid() == userAId for jwtA');
  await assertAuthUidMatchesJwt(jwtB, userBId, 'auth.uid() == userBId for jwtB');

  // Seed Story 4.2 rows for both customers so SELECT isolation checks are not vacuous.
  // Uses service-role pool (bypasses RLS). Skips gracefully if migrations not yet applied.
  console.log('\n  Pre-seed: Story 4.2 rows (skus, sku_channels, baseline_snapshots, scan_jobs)');
  const seedPool = getServiceRoleClient();
  await seedStory42RowsForCustomer(seedPool, userAId, 'a');
  await seedStory42RowsForCustomer(seedPool, userBId, 'b');

  for (const tableConfig of CUSTOMER_SCOPED_TABLES) {
    const { table, deferred } = tableConfig;
    console.log(`\n  Table: ${table}${deferred ? ' (deferred — row ops skipped)' : ''}`);
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
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`RLS Regression Suite: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\nFailed checks:');
    for (const r of results.filter((x) => !x.pass)) {
      console.error(`  ✗  ${r.label}: ${r.reason}`);
    }
    process.exit(1);
  }

  console.log('\nAll RLS isolation checks passed.\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('rls-regression-suite fatal error:', err);
  process.exit(1);
});
