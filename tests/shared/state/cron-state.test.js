// Story 4.1 / AC#5-AC#8 — cron_state machine + transitions matrix tests.
//
// Covers:
//   AC#1 — customer_marketplaces schema: enums, columns, F4 CHECK constraint, indexes
//   AC#2 — F4 CHECK constraint blocks DRY_RUN with NULL A01/PC01 columns
//   AC#3 — indexes + UNIQUE constraint (customer_id, operator, shop_id)
//   AC#4 — RLS: customer A cannot read/update/delete customer B rows
//   AC#5 — LEGAL_CRON_TRANSITIONS matrix: 12 legal (from, to) pairs per spec
//   AC#6 — transitionCronState: optimistic concurrency + InvalidTransitionError + audit emission
//   AC#7 — unit tests: mocked tx + transition success/failure paths
//   AC#8 — negative assertion: no raw cron_state UPDATE outside shared/state/cron-state.js
//
// Unit tests (AC#6-AC#7) use mocked DB; integration tests (AC#1-AC#4) require .env.test.
// Local-only: requires `.env.test` pointing SUPABASE_SERVICE_ROLE_DATABASE_URL
// at a local Supabase docker.
//
// Run with: node --env-file=.env.test --test tests/shared/state/cron-state.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// AC#5 — Transitions matrix
// ---------------------------------------------------------------------------

test('transitions_matrix_exports_legal_cron_transitions_object', async () => {
  const { LEGAL_CRON_TRANSITIONS } = await import('../../../shared/state/transitions-matrix.js');
  assert.ok(LEGAL_CRON_TRANSITIONS, 'LEGAL_CRON_TRANSITIONS must be exported');
  assert.equal(typeof LEGAL_CRON_TRANSITIONS, 'object', 'LEGAL_CRON_TRANSITIONS must be a plain object');
});

test('transitions_matrix_contains_all_12_legal_pairs', async () => {
  const { LEGAL_CRON_TRANSITIONS } = await import('../../../shared/state/transitions-matrix.js');
  const EXPECTED_PAIRS = [
    ['PROVISIONING', 'DRY_RUN'],
    ['DRY_RUN', 'ACTIVE'],
    ['ACTIVE', 'PAUSED_BY_CUSTOMER'],
    ['PAUSED_BY_CUSTOMER', 'ACTIVE'],
    ['ACTIVE', 'PAUSED_BY_PAYMENT_FAILURE'],
    ['PAUSED_BY_PAYMENT_FAILURE', 'ACTIVE'],
    ['ACTIVE', 'PAUSED_BY_CIRCUIT_BREAKER'],
    ['PAUSED_BY_CIRCUIT_BREAKER', 'ACTIVE'],
    ['ACTIVE', 'PAUSED_BY_KEY_REVOKED'],
    ['PAUSED_BY_KEY_REVOKED', 'ACTIVE'],
    ['ACTIVE', 'PAUSED_BY_ACCOUNT_GRACE_PERIOD'],
    ['PAUSED_BY_ACCOUNT_GRACE_PERIOD', 'DRY_RUN'],
  ];
  for (const [from, to] of EXPECTED_PAIRS) {
    assert.ok(
      LEGAL_CRON_TRANSITIONS[from]?.includes(to),
      `Expected (${from} → ${to}) to be a legal transition`,
    );
  }
});

test('illegal_transition_pair_not_in_matrix', async () => {
  const { LEGAL_CRON_TRANSITIONS } = await import('../../../shared/state/transitions-matrix.js');
  const illegalPairs = [
    ['PAUSED_BY_CIRCUIT_BREAKER', 'PAUSED_BY_CUSTOMER'],
    ['PROVISIONING', 'ACTIVE'],
    ['DRY_RUN', 'PAUSED_BY_CUSTOMER'],
  ];
  for (const [from, to] of illegalPairs) {
    const allowed = LEGAL_CRON_TRANSITIONS[from] ?? [];
    assert.ok(
      !allowed.includes(to),
      `(${from} → ${to}) must NOT be a legal transition`,
    );
  }
});

// ---------------------------------------------------------------------------
// AC#7 — Unit tests: mocked transitionCronState
// ---------------------------------------------------------------------------

test('unit_test_legal_transition_succeeds', async () => {
  const { transitionCronState } = await import('../../../shared/state/cron-state.js');

  let queryText = null;
  let queryParams = null;
  const mockClient = {
    query: async (text, params) => {
      queryText = text;
      queryParams = params;
      return { rowCount: 1 };
    },
  };
  const mockTx = async (client, cb) => cb(client);

  // Should not throw; rowCount = 1 → success
  await assert.doesNotReject(
    async () => transitionCronState({
      tx: mockTx,
      client: mockClient,
      customerMarketplaceId: 'test-uuid',
      from: 'ACTIVE',
      to: 'PAUSED_BY_CUSTOMER',
      context: {},
    }),
    'Legal transition must not throw',
  );

  assert.ok(queryText, 'DB UPDATE must be issued');
  assert.ok(queryText.includes('customer_marketplaces'), 'UPDATE must target customer_marketplaces');
});

test('unit_test_illegal_transition_throws_before_db', async () => {
  const { transitionCronState } = await import('../../../shared/state/cron-state.js');

  let dbCalled = false;
  const mockClient = {
    query: async () => {
      dbCalled = true;
      return { rowCount: 1 };
    },
  };
  const mockTx = async (client, cb) => cb(client);

  await assert.rejects(
    async () => transitionCronState({
      tx: mockTx,
      client: mockClient,
      customerMarketplaceId: 'test-uuid',
      from: 'PROVISIONING',
      to: 'ACTIVE', // illegal
      context: {},
    }),
    (err) => {
      assert.ok(err.name === 'InvalidTransitionError', `Expected InvalidTransitionError, got ${err.name}`);
      return true;
    },
  );

  assert.equal(dbCalled, false, 'DB must NOT be called for illegal transitions');
});

test('unit_test_concurrent_transition_throws', async () => {
  const { transitionCronState } = await import('../../../shared/state/cron-state.js');

  const mockClient = {
    query: async () => ({ rowCount: 0 }), // 0 rows → concurrent modification
  };
  const mockTx = async (client, cb) => cb(client);

  await assert.rejects(
    async () => transitionCronState({
      tx: mockTx,
      client: mockClient,
      customerMarketplaceId: 'test-uuid',
      from: 'ACTIVE',
      to: 'PAUSED_BY_CUSTOMER',
      context: {},
    }),
    (err) => {
      assert.ok(err.name === 'ConcurrentTransitionError', `Expected ConcurrentTransitionError, got ${err.name}`);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// AC#8 — Negative assertion: no raw cron_state UPDATE outside SSoT
// ---------------------------------------------------------------------------

test('negative_assertion_no_raw_cron_state_update_outside_ssot', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const SSOT_PATH = join('shared', 'state', 'cron-state.js');
  const RAW_PATTERN = /UPDATE\s+customer_marketplaces\s+SET\s+cron_state/i;

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
    ...await walk('worker', ['.js']),
    ...await walk('supabase/migrations', ['.sql']),
    ...await walk('scripts', ['.js']),
  ].filter((f) => !f.replace(/\\/g, '/').endsWith(SSOT_PATH.replace(/\\/g, '/')));

  const hits = [];
  for (const path of files) {
    const text = await readFile(path, 'utf8');
    if (RAW_PATTERN.test(text)) hits.push(path);
  }
  assert.equal(
    hits.length,
    0,
    `Raw cron_state UPDATE found outside SSoT: ${JSON.stringify(hits)}`,
  );
});

// ---------------------------------------------------------------------------
// Integration tests (require .env.test + local Supabase)
// Auto-skipped when SUPABASE_SERVICE_ROLE_DATABASE_URL is unset; auto-run
// under `npm run test:integration` which loads .env.test.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Integration test helpers (shared across all integration tests in this block)
// ---------------------------------------------------------------------------

/**
 * Return a lazily-initialised service-role pool for integration tests.
 * We import directly rather than using shared/db/service-role-client.js so
 * the unit tests above (which run without a DB) never touch this module.
 */
async function getPool () {
  const { getServiceRoleClient } = await import('../../../shared/db/service-role-client.js');
  return getServiceRoleClient();
}

/**
 * Create a test customer via the Supabase admin API.
 * The handle_new_auth_user trigger fires and creates the public.customers row.
 * Returns { userId, jwt } for the created user.
 */
async function createTestUser (supabaseAdmin, supabaseAnon, email, password) {
  const { data: user, error: errCreate } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    user_metadata: { first_name: 'Test', last_name: 'User', company_name: 'Test Corp' },
    email_confirm: true,
  });
  if (errCreate) throw new Error(`createTestUser failed for ${email}: ${errCreate.message}`);

  const { data: session, error: errSign } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (errSign) throw new Error(`signIn failed for ${email}: ${errSign.message}`);

  return { userId: user.user.id, jwt: session.session.access_token };
}

/**
 * Delete all auth.users (cascades to customers, customer_profiles, customer_marketplaces).
 * Only operates on localhost connections (safety guard mirrors reset-auth-tables.js).
 */
async function resetAllCustomers () {
  const { resetAuthAndCustomers, endResetAuthPool } = await import('../../integration/_helpers/reset-auth-tables.js');
  await resetAuthAndCustomers();
  return endResetAuthPool;
}

/**
 * Insert a minimal customer_marketplaces row in PROVISIONING for a given customer.
 * All A01/PC01 columns remain NULL (satisfies F4 CHECK constraint).
 * Returns the generated UUID.
 */
async function insertProvisioningMarketplace (pool, customerId) {
  const { rows } = await pool.query(
    `INSERT INTO customer_marketplaces
       (customer_id, operator, marketplace_instance_url, max_discount_pct)
     VALUES ($1, 'WORTEN', 'https://marketplace.worten.pt', 0.015)
     RETURNING id`,
    [customerId],
  );
  return rows[0].id;
}

/**
 * Build a minimal "fully populated" marketplace row suitable for DRY_RUN
 * (all A01 + PC01 columns set to non-NULL values so the F4 CHECK passes).
 */
function fullA01Pc01Columns () {
  return {
    shop_id: 12345,
    shop_name: 'Test Shop',
    shop_state: 'OPEN',
    currency_iso_code: 'EUR',
    is_professional: true,
    channels: ['{}'], // text[] with one element
    channel_pricing_mode: 'SINGLE',
    operator_csv_delimiter: 'COMMA',
    offer_prices_decimals: 2,
    discount_period_required: false,
    competitive_pricing_tool: false,
    scheduled_pricing: false,
    volume_pricing: false,
    multi_currency: false,
    order_tax_mode: 'NET',
    platform_features_snapshot: '{}',
    last_pc01_pulled_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Integration tests — run only when an .env.test is loaded (i.e. when
// SUPABASE_SERVICE_ROLE_DATABASE_URL is set). Skipped automatically by
// `node --test` (no env-file) so the unit tests at the top of this file
// remain runnable without a DB. Active under `npm run test:integration`,
// which loads `.env.test` and includes this file in the suite.
//
// Pattern matches other integration tests (rls-regression.test.js,
// signup-flow.test.js, audit-log-partition.test.js) which all rely on
// `--env-file=.env.test` to populate the env. We gate on the database URL
// because the unit tests above never touch the DB and must run cleanly
// without `.env.test` present.
// ---------------------------------------------------------------------------

if (process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL) {
  // AC#1 — migration creates the table with the full schema
  test('migration_creates_customer_marketplaces_table_with_full_schema', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    t.after(async () => { await closeServiceRolePool(); });

    // Verify the table exists in public schema
    const { rows: tableRows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'customer_marketplaces'
       LIMIT 1`,
    );
    assert.strictEqual(tableRows.length, 1, 'customer_marketplaces table must exist in public schema');

    // Verify required columns exist with correct data_type / udt_name
    const { rows: colRows } = await pool.query(
      `SELECT column_name, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'customer_marketplaces'
       ORDER BY ordinal_position`,
    );
    const colMap = Object.fromEntries(colRows.map((r) => [r.column_name, r]));

    // PK
    assert.ok(colMap['id'], 'id column must exist');
    assert.strictEqual(colMap['id'].udt_name, 'uuid', 'id must be uuid');
    // FK
    assert.ok(colMap['customer_id'], 'customer_id must exist');
    assert.strictEqual(colMap['customer_id'].is_nullable, 'NO', 'customer_id must be NOT NULL');
    // operator enum
    assert.ok(colMap['operator'], 'operator column must exist');
    assert.strictEqual(colMap['operator'].udt_name, 'marketplace_operator', 'operator must use marketplace_operator enum');
    // cron_state defaults to PROVISIONING
    assert.ok(colMap['cron_state'], 'cron_state column must exist');
    assert.strictEqual(colMap['cron_state'].udt_name, 'cron_state', 'cron_state must use cron_state enum');
    assert.strictEqual(colMap['cron_state'].is_nullable, 'NO', 'cron_state must be NOT NULL');
    // cron_state_changed_at
    assert.ok(colMap['cron_state_changed_at'], 'cron_state_changed_at must exist');
    assert.strictEqual(colMap['cron_state_changed_at'].is_nullable, 'NO', 'cron_state_changed_at must be NOT NULL');
    // A01 columns must be nullable
    for (const col of ['shop_id', 'shop_name', 'shop_state', 'currency_iso_code', 'is_professional', 'channels']) {
      assert.ok(colMap[col], `A01 column ${col} must exist`);
      assert.strictEqual(colMap[col].is_nullable, 'YES', `A01 column ${col} must be nullable`);
    }
    // PC01 columns must be nullable
    for (const col of ['channel_pricing_mode', 'operator_csv_delimiter', 'offer_prices_decimals',
      'discount_period_required', 'competitive_pricing_tool', 'scheduled_pricing',
      'volume_pricing', 'multi_currency', 'order_tax_mode', 'platform_features_snapshot', 'last_pc01_pulled_at']) {
      assert.ok(colMap[col], `PC01 column ${col} must exist`);
      assert.strictEqual(colMap[col].is_nullable, 'YES', `PC01 column ${col} must be nullable`);
    }
    // Engine config — max_discount_pct NOT NULL, no default (intentional)
    assert.ok(colMap['max_discount_pct'], 'max_discount_pct must exist');
    assert.strictEqual(colMap['max_discount_pct'].is_nullable, 'NO', 'max_discount_pct must be NOT NULL');
    // Stripe linkage nullable
    assert.ok(colMap['stripe_subscription_item_id'], 'stripe_subscription_item_id must exist');
    assert.strictEqual(colMap['stripe_subscription_item_id'].is_nullable, 'YES', 'stripe_subscription_item_id must be nullable');
    // Timestamps
    assert.ok(colMap['created_at'], 'created_at must exist');
    assert.ok(colMap['updated_at'], 'updated_at must exist');
  });

  // AC#1 — cron_state enum has exactly 8 UPPER_SNAKE_CASE values
  test('cron_state_enum_has_8_upper_snake_case_values', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    t.after(async () => { await closeServiceRolePool(); });

    const EXPECTED_VALUES = [
      'PROVISIONING',
      'DRY_RUN',
      'ACTIVE',
      'PAUSED_BY_CUSTOMER',
      'PAUSED_BY_PAYMENT_FAILURE',
      'PAUSED_BY_CIRCUIT_BREAKER',
      'PAUSED_BY_KEY_REVOKED',
      'PAUSED_BY_ACCOUNT_GRACE_PERIOD',
    ];

    const { rows } = await pool.query(
      `SELECT e.enumlabel::text AS val
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'cron_state'
       ORDER BY e.enumsortorder`,
    );
    const actual = rows.map((r) => r.val);
    assert.deepStrictEqual(actual, EXPECTED_VALUES, `cron_state enum values must be ${JSON.stringify(EXPECTED_VALUES)}; got ${JSON.stringify(actual)}`);
  });

  // AC#1 — channel_pricing_mode enum has 3 values
  test('channel_pricing_mode_enum_has_3_values', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    t.after(async () => { await closeServiceRolePool(); });

    const EXPECTED = ['SINGLE', 'MULTI', 'DISABLED'];
    const { rows } = await pool.query(
      `SELECT e.enumlabel::text AS val
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'channel_pricing_mode'
       ORDER BY e.enumsortorder`,
    );
    const actual = rows.map((r) => r.val);
    assert.deepStrictEqual(actual, EXPECTED, `channel_pricing_mode must have values ${JSON.stringify(EXPECTED)}; got ${JSON.stringify(actual)}`);
  });

  // AC#1 — csv_delimiter enum has 2 values
  test('csv_delimiter_enum_has_2_values', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    t.after(async () => { await closeServiceRolePool(); });

    const EXPECTED = ['COMMA', 'SEMICOLON'];
    const { rows } = await pool.query(
      `SELECT e.enumlabel::text AS val
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'csv_delimiter'
       ORDER BY e.enumsortorder`,
    );
    const actual = rows.map((r) => r.val);
    assert.deepStrictEqual(actual, EXPECTED, `csv_delimiter must have values ${JSON.stringify(EXPECTED)}; got ${JSON.stringify(actual)}`);
  });

  // AC#1 — marketplace_operator enum has 1 value: WORTEN
  test('marketplace_operator_enum_has_1_value_worten', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    t.after(async () => { await closeServiceRolePool(); });

    const EXPECTED = ['WORTEN'];
    const { rows } = await pool.query(
      `SELECT e.enumlabel::text AS val
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'marketplace_operator'
       ORDER BY e.enumsortorder`,
    );
    const actual = rows.map((r) => r.val);
    assert.deepStrictEqual(actual, EXPECTED, `marketplace_operator must have values ${JSON.stringify(EXPECTED)}; got ${JSON.stringify(actual)}`);
  });

  // AC#2 — F4 CHECK: PROVISIONING with all nullable columns NULL succeeds
  test('f4_check_constraint_allows_provisioning_with_null_a01_pc01', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    // Create a customer so we have a valid customer_id FK
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email: 'f4-provisioning@test.marketpilot.pt',
      password: 'test-pass-F4-123!',
      user_metadata: { first_name: 'F4', last_name: 'Test', company_name: 'F4 Corp' },
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);

    // INSERT in PROVISIONING with all nullable columns NULL — must succeed
    const { rows } = await pool.query(
      `INSERT INTO customer_marketplaces
         (customer_id, operator, marketplace_instance_url, max_discount_pct)
       VALUES ($1, 'WORTEN', 'https://marketplace.worten.pt', 0.015)
       RETURNING id, cron_state`,
      [user.user.id],
    );
    assert.strictEqual(rows.length, 1, 'INSERT in PROVISIONING with NULL A01/PC01 must succeed');
    assert.strictEqual(rows[0].cron_state, 'PROVISIONING', 'default cron_state must be PROVISIONING');
  });

  // AC#2 — F4 CHECK: UPDATE to DRY_RUN with null A01 column fails
  test('f4_check_constraint_blocks_dry_run_with_null_a01', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email: 'f4-dry-run-null-a01@test.marketpilot.pt',
      password: 'test-pass-F4b-123!',
      user_metadata: { first_name: 'F4b', last_name: 'Test', company_name: 'F4b Corp' },
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);

    const cmId = await insertProvisioningMarketplace(pool, user.user.id);

    // Attempt UPDATE to DRY_RUN with shop_id still NULL — must fail with 23514
    let caught;
    try {
      await pool.query(
        `UPDATE customer_marketplaces SET cron_state = 'DRY_RUN' WHERE id = $1`,
        [cmId],
      );
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'UPDATE to DRY_RUN with null A01 must throw');
    assert.strictEqual(
      caught.code,
      '23514',
      `Expected SQLSTATE 23514 (check_violation); got ${caught.code}: ${caught.message}`,
    );
  });

  // AC#2 — F4 CHECK: UPDATE to DRY_RUN with null PC01 column fails
  test('f4_check_constraint_blocks_dry_run_with_null_pc01', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email: 'f4-dry-run-null-pc01@test.marketpilot.pt',
      password: 'test-pass-F4c-123!',
      user_metadata: { first_name: 'F4c', last_name: 'Test', company_name: 'F4c Corp' },
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);

    const cmId = await insertProvisioningMarketplace(pool, user.user.id);

    const cols = fullA01Pc01Columns();
    // Populate only A01 columns; leave channel_pricing_mode (a PC01 column) NULL
    await pool.query(
      `UPDATE customer_marketplaces
       SET shop_id = $2, shop_name = $3, shop_state = $4, currency_iso_code = $5,
           is_professional = $6, channels = $7
       WHERE id = $1`,
      [cmId, cols.shop_id, cols.shop_name, cols.shop_state, cols.currency_iso_code,
        cols.is_professional, cols.channels],
    );

    // Now attempt UPDATE to DRY_RUN — channel_pricing_mode is still NULL → CHECK fails
    let caught;
    try {
      await pool.query(
        `UPDATE customer_marketplaces SET cron_state = 'DRY_RUN' WHERE id = $1`,
        [cmId],
      );
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'UPDATE to DRY_RUN with null PC01 column must throw');
    assert.strictEqual(
      caught.code,
      '23514',
      `Expected SQLSTATE 23514 (check_violation); got ${caught.code}: ${caught.message}`,
    );
  });

  // AC#3 — indexes exist per spec
  test('indexes_exist_per_spec', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    t.after(async () => { await closeServiceRolePool(); });

    const REQUIRED_INDEXES = [
      'idx_customer_marketplaces_customer_id',
      'idx_customer_marketplaces_cron_state_active',
      'idx_customer_marketplaces_last_pc01_pulled_at',
    ];

    const { rows } = await pool.query(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'customer_marketplaces'`,
    );
    const actualNames = rows.map((r) => r.indexname);

    for (const idx of REQUIRED_INDEXES) {
      assert.ok(
        actualNames.includes(idx),
        `Index ${idx} must exist on customer_marketplaces; found: ${JSON.stringify(actualNames)}`,
      );
    }
  });

  // AC#3 — UNIQUE constraint (customer_id, operator, shop_id) prevents duplicate row
  test('unique_constraint_customer_id_operator_shop_id', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email: 'unique-constraint@test.marketpilot.pt',
      password: 'test-pass-uniq-123!',
      user_metadata: { first_name: 'Uniq', last_name: 'Test', company_name: 'Uniq Corp' },
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);

    // Insert first row with shop_id = 99
    await pool.query(
      `INSERT INTO customer_marketplaces
         (customer_id, operator, marketplace_instance_url, max_discount_pct, shop_id)
       VALUES ($1, 'WORTEN', 'https://marketplace.worten.pt', 0.015, 99)`,
      [user.user.id],
    );

    // Insert second row with SAME (customer_id, operator, shop_id) — must fail with 23505
    let caught;
    try {
      await pool.query(
        `INSERT INTO customer_marketplaces
           (customer_id, operator, marketplace_instance_url, max_discount_pct, shop_id)
         VALUES ($1, 'WORTEN', 'https://marketplace.worten.pt', 0.015, 99)`,
        [user.user.id],
      );
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'Duplicate (customer_id, operator, shop_id) must throw');
    assert.strictEqual(
      caught.code,
      '23505',
      `Expected SQLSTATE 23505 (unique_violation); got ${caught.code}: ${caught.message}`,
    );
  });

  // AC#4 — RLS: customer A cannot SELECT customer B's customer_marketplaces row
  test('rls_customer_a_cannot_read_customer_b_row', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { getRlsAwareClient } = await import('../../../shared/db/rls-aware-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const supabaseAnon = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { userId: userAId, jwt: jwtA } = await createTestUser(
      supabaseAdmin, supabaseAnon,
      'rls-read-a@test.marketpilot.pt', 'test-rls-A-123!',
    );
    const { userId: userBId } = await createTestUser(
      supabaseAdmin, supabaseAnon,
      'rls-read-b@test.marketpilot.pt', 'test-rls-B-123!',
    );

    const cmBId = await insertProvisioningMarketplace(pool, userBId);
    // Pre-condition: service-role can see B's row
    const { rows: preRows } = await pool.query(
      'SELECT id FROM customer_marketplaces WHERE id = $1', [cmBId],
    );
    assert.strictEqual(preRows.length, 1, 'pre-condition: B row must exist via service-role');

    // Customer A's JWT-scoped connection must see 0 rows for B's marketplace
    const clientA = await getRlsAwareClient(jwtA);
    try {
      const { rows } = await clientA.query(
        'SELECT id FROM customer_marketplaces WHERE customer_id = $1', [userBId],
      );
      assert.strictEqual(rows.length, 0, 'customer A must not be able to read customer B rows in customer_marketplaces');
    } finally {
      await clientA.release();
    }
  });

  // AC#4 — RLS: customer A cannot UPDATE customer B's row
  test('rls_customer_a_cannot_update_customer_b_row', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { getRlsAwareClient } = await import('../../../shared/db/rls-aware-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const supabaseAnon = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { jwt: jwtA } = await createTestUser(
      supabaseAdmin, supabaseAnon,
      'rls-update-a@test.marketpilot.pt', 'test-rls-upd-A-123!',
    );
    const { userId: userBId } = await createTestUser(
      supabaseAdmin, supabaseAnon,
      'rls-update-b@test.marketpilot.pt', 'test-rls-upd-B-123!',
    );

    const cmBId = await insertProvisioningMarketplace(pool, userBId);

    const clientA = await getRlsAwareClient(jwtA);
    try {
      const result = await clientA.query(
        `UPDATE customer_marketplaces
         SET marketplace_instance_url = 'https://hacked.example.com'
         WHERE id = $1`,
        [cmBId],
      );
      assert.strictEqual(result.rowCount, 0, 'customer A must not be able to UPDATE customer B row in customer_marketplaces (rowCount must be 0)');
    } finally {
      await clientA.release();
    }
  });

  // AC#4 — RLS: customer A cannot DELETE customer B's row
  test('rls_customer_a_cannot_delete_customer_b_row', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { getRlsAwareClient } = await import('../../../shared/db/rls-aware-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const supabaseAnon = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { jwt: jwtA } = await createTestUser(
      supabaseAdmin, supabaseAnon,
      'rls-delete-a@test.marketpilot.pt', 'test-rls-del-A-123!',
    );
    const { userId: userBId } = await createTestUser(
      supabaseAdmin, supabaseAnon,
      'rls-delete-b@test.marketpilot.pt', 'test-rls-del-B-123!',
    );

    const cmBId = await insertProvisioningMarketplace(pool, userBId);

    const clientA = await getRlsAwareClient(jwtA);
    try {
      const result = await clientA.query(
        'DELETE FROM customer_marketplaces WHERE id = $1',
        [cmBId],
      );
      assert.strictEqual(result.rowCount, 0, 'customer A must not be able to DELETE customer B row in customer_marketplaces (rowCount must be 0)');
    } finally {
      await clientA.release();
    }
  });

  // AC#4 — CUSTOMER_SCOPED_TABLES registry must include customer_marketplaces
  test('rls_regression_suite_extended_with_customer_marketplaces', async () => {
    // Read the rls-regression.test.js source and assert it contains the registry entry.
    // This is a static assertion — it catches the case where a developer forgets to
    // update the registry when adding customer_marketplaces (Epic 2 retro Item 6 debt).
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = (await import('node:path')).dirname(fileURLToPath(import.meta.url));
    const rlsTestPath = join(__dirname, '..', '..', 'integration', 'rls-regression.test.js');
    const content = await readFile(rlsTestPath, 'utf8');

    assert.ok(
      content.includes("table: 'customer_marketplaces'"),
      "rls-regression.test.js CUSTOMER_SCOPED_TABLES must contain table: 'customer_marketplaces'",
    );
    // Also assert the deferred placeholder is replaced (no longer just a shell)
    assert.ok(
      !content.includes('rls_isolation_shop_api_key_vault_deferred_awaiting_epic4') ||
      content.includes('shop_api_key_vault_select_own'), // if still present it must have real assertions
      'rls_isolation_shop_api_key_vault_deferred_awaiting_epic4 placeholder test must be replaced or filled with real assertions in Story 4.1',
    );
  });

  // AC#6 — transitionCronState integration: real DB, ACTIVE → PAUSED_BY_CUSTOMER succeeds
  test('transition_cron_state_issues_optimistic_update_and_succeeds', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email: 'transition-success@test.marketpilot.pt',
      password: 'test-trans-S-123!',
      user_metadata: { first_name: 'Trans', last_name: 'Test', company_name: 'Trans Corp' },
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);

    const cmId = await insertProvisioningMarketplace(pool, user.user.id);

    // Manually force the row to ACTIVE so we can test the ACTIVE → PAUSED_BY_CUSTOMER transition.
    // We bypass transitionCronState here (which requires all A01/PC01 columns filled for
    // PROVISIONING → DRY_RUN → ACTIVE). This is acceptable in a test-only setup context.
    // NOTE: This raw UPDATE is ONLY acceptable inside tests — the ESLint rule only scans
    // app/src, worker/src, shared, scripts (not tests/).
    await pool.query(
      `UPDATE customer_marketplaces SET cron_state = 'ACTIVE' WHERE id = $1`,
      [cmId],
    );

    const { transitionCronState } = await import('../../../shared/state/cron-state.js');

    // Call transitionCronState with a real DB client inside a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await transitionCronState({
        tx: client,
        client,
        customerMarketplaceId: cmId,
        from: 'ACTIVE',
        to: 'PAUSED_BY_CUSTOMER',
        context: {},
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Verify DB state: cron_state must now be PAUSED_BY_CUSTOMER
    const { rows } = await pool.query(
      'SELECT cron_state FROM customer_marketplaces WHERE id = $1',
      [cmId],
    );
    assert.strictEqual(rows.length, 1, 'marketplace row must still exist after transition');
    assert.strictEqual(
      rows[0].cron_state,
      'PAUSED_BY_CUSTOMER',
      'cron_state must be PAUSED_BY_CUSTOMER after successful transition',
    );
  });

  // AC#6 — transitionCronState emits audit event for mapped transitions
  test('transition_emits_audit_event_for_mapped_transitions', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email: 'transition-audit-emit@test.marketpilot.pt',
      password: 'test-trans-audit-A-123!',
      user_metadata: { first_name: 'Audit', last_name: 'Test', company_name: 'Audit Corp' },
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);

    const cmId = await insertProvisioningMarketplace(pool, user.user.id);
    // Force ACTIVE state for the test transition
    await pool.query(
      `UPDATE customer_marketplaces SET cron_state = 'ACTIVE' WHERE id = $1`,
      [cmId],
    );

    // Count audit_log rows BEFORE transition
    const { rows: beforeRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM audit_log WHERE customer_marketplace_id = $1`,
      [cmId],
    );
    const countBefore = beforeRows[0].cnt;

    const { transitionCronState } = await import('../../../shared/state/cron-state.js');

    // Execute ACTIVE → PAUSED_BY_CUSTOMER (mapped → emits customer-paused)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await transitionCronState({
        tx: client,
        client,
        customerMarketplaceId: cmId,
        from: 'ACTIVE',
        to: 'PAUSED_BY_CUSTOMER',
        context: {},
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Verify audit_log gained exactly 1 row with event_type = 'customer-paused'
    const { rows: afterRows } = await pool.query(
      `SELECT event_type FROM audit_log
       WHERE customer_marketplace_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [cmId],
    );
    const countAfter = afterRows.length;
    assert.strictEqual(
      countAfter - countBefore,
      1,
      `audit_log must gain exactly 1 row for ACTIVE→PAUSED_BY_CUSTOMER; before=${countBefore}, after=${countBefore + 1}`,
    );
    assert.strictEqual(
      afterRows[0].event_type,
      'customer-paused',
      `audit event_type must be 'customer-paused'; got '${afterRows[0].event_type}'`,
    );
  });

  // AC#6 — transitionCronState does NOT emit audit event for unmapped transitions
  test('transition_does_not_emit_audit_event_for_unmapped_transitions', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../../shared/db/service-role-client.js');
    const { createClient } = await import('@supabase/supabase-js');
    const endReset = await resetAllCustomers();
    t.after(async () => {
      await resetAllCustomers();
      await closeServiceRolePool();
      await endReset();
    });

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email: 'transition-no-audit@test.marketpilot.pt',
      password: 'test-trans-noaudit-123!',
      user_metadata: { first_name: 'NoAudit', last_name: 'Test', company_name: 'NoAudit Corp' },
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);

    const cmId = await insertProvisioningMarketplace(pool, user.user.id);
    // PROVISIONING → DRY_RUN is an unmapped transition (no audit event per AC#6).
    // We need all A01+PC01 columns populated first (F4 CHECK).
    const cols = fullA01Pc01Columns();
    await pool.query(
      `UPDATE customer_marketplaces
       SET shop_id = $2, shop_name = $3, shop_state = $4, currency_iso_code = $5,
           is_professional = $6, channels = $7,
           channel_pricing_mode = $8, operator_csv_delimiter = $9,
           offer_prices_decimals = $10, discount_period_required = $11,
           competitive_pricing_tool = $12, scheduled_pricing = $13,
           volume_pricing = $14, multi_currency = $15,
           order_tax_mode = $16, platform_features_snapshot = $17,
           last_pc01_pulled_at = $18
       WHERE id = $1`,
      [cmId,
        cols.shop_id, cols.shop_name, cols.shop_state, cols.currency_iso_code,
        cols.is_professional, cols.channels,
        cols.channel_pricing_mode, cols.operator_csv_delimiter,
        cols.offer_prices_decimals, cols.discount_period_required,
        cols.competitive_pricing_tool, cols.scheduled_pricing,
        cols.volume_pricing, cols.multi_currency,
        cols.order_tax_mode, cols.platform_features_snapshot,
        cols.last_pc01_pulled_at],
    );

    // Count audit_log rows BEFORE transition
    const { rows: beforeRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM audit_log WHERE customer_marketplace_id = $1`,
      [cmId],
    );
    const countBefore = beforeRows[0].cnt;

    const { transitionCronState } = await import('../../../shared/state/cron-state.js');

    // Execute PROVISIONING → DRY_RUN (unmapped — NO audit event)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await transitionCronState({
        tx: client,
        client,
        customerMarketplaceId: cmId,
        from: 'PROVISIONING',
        to: 'DRY_RUN',
        context: {},
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Verify audit_log count is UNCHANGED after the transition
    const { rows: afterRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM audit_log WHERE customer_marketplace_id = $1`,
      [cmId],
    );
    const countAfter = afterRows[0].cnt;
    assert.strictEqual(
      countAfter,
      countBefore,
      `audit_log must NOT gain rows for PROVISIONING→DRY_RUN (unmapped transition); before=${countBefore}, after=${countAfter}`,
    );
  });

  // AC#8 — ESLint no-raw-cron-state-update rule fires on a file containing the violation.
  //
  // Implementation note: we use ESLint's Node API (programmatic) rather than spawning
  // the CLI. The CLI shim at node_modules/.bin/eslint is a shell script (or .cmd on
  // Windows), so `node node_modules/.bin/eslint` does not work cross-platform. The
  // programmatic API also avoids ESLint flat-config / legacy-flag friction —
  // `--no-eslintrc`, `--rulesdir`, `--plugin` are removed in ESLint 9+ flat config.
  // The ESLint constructor below loads the project's eslint.config.js (which already
  // registers no-raw-cron-state-update), so this test exercises the same configuration
  // the lint script uses in CI.
  test('eslint_no_raw_cron_state_update_fires_on_violation', async (t) => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { ESLint } = await import('eslint');

    const __dirname = (await import('node:path')).dirname(fileURLToPath(import.meta.url));
    const repoRoot = join(__dirname, '..', '..', '..');
    // Fixture lives under app/src/ so the project's eslint config (which scopes the
    // local-cron rule to app/**, worker/**, shared/**) actually matches it.
    const fixturePath = join(repoRoot, 'app', 'src', '__eslint_fixture_cron_state_test__.js');

    const fixtureContent = `
// ESLint test fixture — DO NOT SHIP
const sql = 'UPDATE customer_marketplaces SET cron_state = $1 WHERE id = $2';
`;

    t.after(async () => {
      try { await unlink(fixturePath); } catch { /* already cleaned up */ }
    });

    await writeFile(fixturePath, fixtureContent, 'utf8');

    // Run ESLint programmatically against the project config.
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles([fixturePath]);

    assert.strictEqual(results.length, 1, 'ESLint must return exactly one result for the fixture');
    const result = results[0];

    // The rule must fire at least once on this fixture.
    const violations = (result.messages ?? []).filter(
      (m) => m.ruleId === 'local-cron/no-raw-cron-state-update',
    );
    assert.ok(
      violations.length >= 1,
      `no-raw-cron-state-update must fire on fixture with raw cron_state UPDATE; ` +
      `got messages: ${JSON.stringify(result.messages)}`,
    );

    // And the overall errorCount must be > 0 — the rule is configured as 'error'.
    assert.ok(
      result.errorCount >= 1,
      `ESLint must report >= 1 error for fixture with raw cron_state UPDATE; got errorCount=${result.errorCount}`,
    );
  });
}
