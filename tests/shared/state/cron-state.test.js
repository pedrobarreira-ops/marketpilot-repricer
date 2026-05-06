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
// Run separately or guard behind INTEGRATION_TESTS env var
// ---------------------------------------------------------------------------

if (process.env.INTEGRATION_TESTS) {
  test('migration_creates_customer_marketplaces_table_with_full_schema', async () => {
    // TODO (ATDD Step 2): verify table columns + types via information_schema
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('cron_state_enum_has_8_upper_snake_case_values', async () => {
    // TODO (ATDD Step 2): SELECT enum_range(NULL::cron_state) and assert all 8 values
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('channel_pricing_mode_enum_has_3_values', async () => {
    // TODO (ATDD Step 2): SELECT enum_range(NULL::channel_pricing_mode)
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('csv_delimiter_enum_has_2_values', async () => {
    // TODO (ATDD Step 2): SELECT enum_range(NULL::csv_delimiter)
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('marketplace_operator_enum_has_1_value_worten', async () => {
    // TODO (ATDD Step 2): SELECT enum_range(NULL::marketplace_operator) = '{WORTEN}'
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('f4_check_constraint_allows_provisioning_with_null_a01_pc01', async () => {
    // TODO (ATDD Step 2): INSERT row in PROVISIONING with all nullable columns NULL; expect success
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('f4_check_constraint_blocks_dry_run_with_null_a01', async () => {
    // TODO (ATDD Step 2): UPDATE cron_state to DRY_RUN with shop_id NULL; expect SQLSTATE 23514
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('f4_check_constraint_blocks_dry_run_with_null_pc01', async () => {
    // TODO (ATDD Step 2): UPDATE cron_state to DRY_RUN with channel_pricing_mode NULL; expect 23514
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('indexes_exist_per_spec', async () => {
    // TODO (ATDD Step 2): query pg_indexes for all 3 required indexes on customer_marketplaces
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('unique_constraint_customer_id_operator_shop_id', async () => {
    // TODO (ATDD Step 2): INSERT two rows with same (customer_id, operator, shop_id); expect 23505
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('rls_customer_a_cannot_read_customer_b_row', async () => {
    // TODO (ATDD Step 2): JWT-A SELECT WHERE id = customer_B marketplace id → 0 rows
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('rls_customer_a_cannot_update_customer_b_row', async () => {
    // TODO (ATDD Step 2): JWT-A UPDATE customer_B row → rowCount 0
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('rls_customer_a_cannot_delete_customer_b_row', async () => {
    // TODO (ATDD Step 2): JWT-A DELETE customer_B row → rowCount 0
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('rls_regression_suite_extended_with_customer_marketplaces', async () => {
    // TODO (ATDD Step 2): assert CUSTOMER_SCOPED_TABLES in rls-regression.test.js includes customer_marketplaces
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('transition_cron_state_issues_optimistic_update_and_succeeds', async () => {
    // TODO (ATDD Step 2): integration — real DB, ACTIVE → PAUSED_BY_CUSTOMER succeeds; check DB state
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('transition_emits_audit_event_for_mapped_transitions', async () => {
    // TODO (ATDD Step 2): (ACTIVE, PAUSED_BY_CUSTOMER) → audit_log row with event_type customer-paused
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('transition_does_not_emit_audit_event_for_unmapped_transitions', async () => {
    // TODO (ATDD Step 2): (PROVISIONING, DRY_RUN) → audit_log count unchanged
    assert.fail('ATDD stub — implement at Step 2');
  });

  test('eslint_no_raw_cron_state_update_fires_on_violation', async () => {
    // TODO (ATDD Step 2): run ESLint on a fixture file with raw cron_state UPDATE; assert error reported
    assert.fail('ATDD stub — implement at Step 2');
  });
}
