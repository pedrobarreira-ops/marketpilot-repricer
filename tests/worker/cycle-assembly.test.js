// Story 5.2 — pri01_staging schema + cycle-assembly skeleton
//
// Covers:
//   AC#1 — Migration creates pri01_staging table with full schema + indexes + RLS
//   AC#1 — RLS regression suite extended with pri01_staging
//   AC#2 — assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId):
//             UNDERCUT / CEILING_RAISE → staging row inserted
//             HOLD → no staging row inserted
//             cycle_id propagated; audit event emitted per decision
//             circuit-breaker stub logs staged count at batch end
//   AC#3 — Unit tests use mock engine, not real decide.js
//
// Unit tests run without a live DB. Integration tests (migration schema + RLS)
// are gated on SUPABASE_SERVICE_ROLE_DATABASE_URL.
//
// Run with: node --test tests/worker/cycle-assembly.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// AC#2 — assembleCycle unit tests (no DB required)
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock transaction object that captures INSERTs.
 * @returns {{ tx: object, inserts: Array<{text: string, params: any[]}> }}
 */
function buildMockTx () {
  const inserts = [];
  const tx = {
    query: async (text, params) => {
      if (text && text.toUpperCase().includes('INSERT')) {
        inserts.push({ text, params });
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { tx, inserts };
}

/**
 * Build a minimal mock writeAuditEvent that captures calls.
 * @returns {{ calls: Array, stub: function }}
 */
function buildMockAuditWriter () {
  const calls = [];
  const stub = async (args) => { calls.push(args); };
  return { calls, stub };
}

/**
 * Factory for a mock engine stub that returns a fixed decision.
 * @param {string} action — 'UNDERCUT' | 'CEILING_RAISE' | 'HOLD'
 * @param {number} [newPriceCents]
 */
function mockEngine (action, newPriceCents = 1799) {
  return {
    decideForSkuChannel: async (_skuChannel, _context) => ({
      action,
      newPriceCents: action === 'HOLD' ? null : newPriceCents,
      auditEvents: [`${action.toLowerCase()}-decision`],
    }),
  };
}

/**
 * Minimal sku_channel row shape expected by cycle-assembly.
 */
function buildSkuChannel (overrides = {}) {
  return {
    id: randomUUID(),
    sku_id: randomUUID(),
    customer_marketplace_id: randomUUID(),
    channel_code: 'WRT_PT_ONLINE',
    tier_value: '1',
    tier_cadence_minutes: 5,
    frozen_for_anomaly_review: false,
    pending_import_id: null,
    ...overrides,
  };
}

test('cycle_assembly_exports_assemble_cycle_function', async () => {
  const mod = await import('../../worker/src/cycle-assembly.js');
  assert.equal(
    typeof mod.assembleCycle,
    'function',
    'assembleCycle must be exported from worker/src/cycle-assembly.js',
  );
});

test('unit_tests_use_mock_engine_not_real_decide_js', async () => {
  // This is a meta-test: verify decide.js (Epic 7) is NOT imported by cycle-assembly
  // at module resolution time — the cycle-assembly skeleton uses a stub/no-op.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile('worker/src/cycle-assembly.js', 'utf8');

  // cycle-assembly must NOT hard-import the real engine at module level;
  // it may import a stub or call engine via dependency injection.
  const hardImportsDecide = source.includes("from './engine/decide.js'") ||
    source.includes("require('./engine/decide.js')") ||
    source.includes("from '../engine/decide.js'") ||
    source.includes("require('../engine/decide.js')");

  // Allow: dynamic import inside the function body OR a conditional import
  // at the top that falls back to a no-op stub
  if (hardImportsDecide) {
    // If it imports decide.js at all, it must provide a fallback stub path
    const hasFallback = source.includes('catch') || source.includes('?.') || source.includes('null') || source.includes('stub');
    assert.ok(
      hasFallback,
      'If cycle-assembly imports decide.js at module level, it must handle the case where decide.js is not yet implemented (stub fallback)',
    );
  }
  // Either no import or graceful fallback — both are acceptable
});

test('cycle_assembly_inserts_staging_row_for_undercut_decision', async () => {
  const { assembleCycle } = await import('../../worker/src/cycle-assembly.js');
  const { tx, inserts } = buildMockTx();
  const { stub: mockWriteAuditEvent } = buildMockAuditWriter();

  const customerMarketplaceId = randomUUID();
  const cycleId = randomUUID();
  const skuChannels = [buildSkuChannel({ customer_marketplace_id: customerMarketplaceId })];

  await assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, {
    engine: mockEngine('UNDERCUT', 1799),
    writeAuditEvent: mockWriteAuditEvent,
  });

  const stagingInserts = inserts.filter((i) => i.text.toLowerCase().includes('pri01_staging'));
  assert.equal(
    stagingInserts.length,
    1,
    'UNDERCUT decision must produce exactly 1 pri01_staging INSERT',
  );

  // The INSERT must carry all 5 documented columns in the documented param order
  // [customer_marketplace_id, sku_id, channel_code, new_price_cents, cycle_id]
  const params = stagingInserts[0].params ?? [];
  assert.deepEqual(
    params,
    [
      customerMarketplaceId,
      skuChannels[0].sku_id,
      skuChannels[0].channel_code,
      1799,
      cycleId,
    ],
    'staging INSERT params must match the documented column order [cm_id, sku_id, channel_code, new_price_cents, cycle_id]',
  );
});

test('cycle_assembly_inserts_staging_row_for_ceiling_raise_decision', async () => {
  const { assembleCycle } = await import('../../worker/src/cycle-assembly.js');
  const { tx, inserts } = buildMockTx();
  const { stub: mockWriteAuditEvent } = buildMockAuditWriter();

  const customerMarketplaceId = randomUUID();
  const cycleId = randomUUID();
  const skuChannels = [buildSkuChannel({ customer_marketplace_id: customerMarketplaceId })];

  await assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, {
    engine: mockEngine('CEILING_RAISE', 2099),
    writeAuditEvent: mockWriteAuditEvent,
  });

  const stagingInserts = inserts.filter((i) => i.text.toLowerCase().includes('pri01_staging'));
  assert.equal(
    stagingInserts.length,
    1,
    'CEILING_RAISE decision must produce exactly 1 pri01_staging INSERT',
  );
});

test('cycle_assembly_does_not_insert_staging_row_for_hold_decision', async () => {
  const { assembleCycle } = await import('../../worker/src/cycle-assembly.js');
  const { tx, inserts } = buildMockTx();
  const { stub: mockWriteAuditEvent } = buildMockAuditWriter();

  const customerMarketplaceId = randomUUID();
  const cycleId = randomUUID();
  const skuChannels = [buildSkuChannel({ customer_marketplace_id: customerMarketplaceId })];

  await assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, {
    engine: mockEngine('HOLD'),
    writeAuditEvent: mockWriteAuditEvent,
  });

  const stagingInserts = inserts.filter((i) => i.text.toLowerCase().includes('pri01_staging'));
  assert.equal(
    stagingInserts.length,
    0,
    'HOLD decision must NOT produce any pri01_staging INSERT',
  );
});

test('cycle_assembly_propagates_cycle_id_to_staging_row', async () => {
  const { assembleCycle } = await import('../../worker/src/cycle-assembly.js');
  const { tx, inserts } = buildMockTx();
  const { stub: mockWriteAuditEvent } = buildMockAuditWriter();

  const customerMarketplaceId = randomUUID();
  const cycleId = randomUUID();
  const skuChannels = [buildSkuChannel({ customer_marketplace_id: customerMarketplaceId })];

  await assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, {
    engine: mockEngine('UNDERCUT', 1799),
    writeAuditEvent: mockWriteAuditEvent,
  });

  const stagingInserts = inserts.filter((i) => i.text.toLowerCase().includes('pri01_staging'));
  assert.equal(stagingInserts.length, 1, 'Should have exactly one staging INSERT');

  // The cycle_id must appear in the INSERT params
  const allParams = stagingInserts[0].params ?? [];
  assert.ok(
    allParams.some((p) => p === cycleId),
    `cycle_id (${cycleId}) must be present in staging INSERT params; got: ${JSON.stringify(allParams)}`,
  );
});

test('cycle_assembly_emits_audit_event_for_each_decision', async () => {
  const { assembleCycle } = await import('../../worker/src/cycle-assembly.js');
  const { tx } = buildMockTx();
  const { calls: auditCalls, stub: mockWriteAuditEvent } = buildMockAuditWriter();

  const customerMarketplaceId = randomUUID();
  const cycleId = randomUUID();

  // 3 SKU-channels: UNDERCUT, HOLD, CEILING_RAISE
  const skuChannels = [
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
  ];

  // Engine returns different decisions based on call order
  let callCount = 0;
  const decisions = ['UNDERCUT', 'HOLD', 'CEILING_RAISE'];
  const varEngine = {
    decideForSkuChannel: async () => {
      const action = decisions[callCount % decisions.length];
      callCount++;
      return { action, newPriceCents: 1799, auditEvents: [`${action.toLowerCase()}`] };
    },
  };

  await assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, {
    engine: varEngine,
    writeAuditEvent: mockWriteAuditEvent,
  });

  assert.equal(
    auditCalls.length,
    3,
    `writeAuditEvent must be called once per SKU-channel decision (3 SKUs = 3 audit calls); got ${auditCalls.length}`,
  );
});

test('cycle_assembly_calls_circuit_breaker_stub_at_batch_end', async () => {
  const { assembleCycle } = await import('../../worker/src/cycle-assembly.js');
  const { tx } = buildMockTx();
  const { stub: mockWriteAuditEvent } = buildMockAuditWriter();

  const customerMarketplaceId = randomUUID();
  const cycleId = randomUUID();
  const skuChannels = [
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
  ];

  const cbCalls = [];
  const circuitBreakerStub = async (stagedCount) => {
    cbCalls.push(stagedCount);
  };

  await assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, {
    engine: mockEngine('UNDERCUT', 1799),
    writeAuditEvent: mockWriteAuditEvent,
    circuitBreakerCheck: circuitBreakerStub,
  });

  assert.equal(
    cbCalls.length,
    1,
    'cycle-assembly must call the circuit-breaker check stub exactly once at the end of each customer batch',
  );
  // Both SKU-channels were UNDERCUT → 2 staged rows; the stub must receive that count
  // so Story 7.6 can implement the >50% rate threshold check.
  assert.equal(
    cbCalls[0],
    2,
    'circuit-breaker stub must receive the actual stagedCount from the batch (2 UNDERCUTs → 2)',
  );
});

test('cycle_assembly_returns_staged_and_held_counts', async () => {
  const { assembleCycle } = await import('../../worker/src/cycle-assembly.js');
  const { tx } = buildMockTx();
  const { stub: mockWriteAuditEvent } = buildMockAuditWriter();

  const customerMarketplaceId = randomUUID();
  const cycleId = randomUUID();
  const skuChannels = [
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
  ];

  // 4 SKUs: UNDERCUT + HOLD + CEILING_RAISE + HOLD → 2 staged, 2 held
  let idx = 0;
  const seq = ['UNDERCUT', 'HOLD', 'CEILING_RAISE', 'HOLD'];
  const seqEngine = {
    decideForSkuChannel: async () => {
      const action = seq[idx++];
      return { action, newPriceCents: action === 'HOLD' ? null : 1799, auditEvents: [action.toLowerCase()] };
    },
  };

  const result = await assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, {
    engine: seqEngine,
    writeAuditEvent: mockWriteAuditEvent,
  });

  assert.deepEqual(
    result,
    { stagedCount: 2, heldCount: 2 },
    'assembleCycle must return { stagedCount, heldCount } reflecting the batch outcome (documented contract)',
  );
});

test('cycle_assembly_audit_event_payload_includes_documented_fields', async () => {
  const { assembleCycle } = await import('../../worker/src/cycle-assembly.js');
  const { tx } = buildMockTx();
  const { calls: auditCalls, stub: mockWriteAuditEvent } = buildMockAuditWriter();

  const customerMarketplaceId = randomUUID();
  const cycleId = randomUUID();
  const skuChannel = buildSkuChannel({ customer_marketplace_id: customerMarketplaceId });

  await assembleCycle(tx, customerMarketplaceId, [skuChannel], cycleId, {
    engine: mockEngine('UNDERCUT', 1799),
    writeAuditEvent: mockWriteAuditEvent,
  });

  assert.equal(auditCalls.length, 1, 'one decision → one audit call');
  const call = auditCalls[0];
  assert.equal(call.customerMarketplaceId, customerMarketplaceId, 'audit must carry customerMarketplaceId');
  assert.equal(call.skuId, skuChannel.sku_id, 'audit must carry skuId from sku_channel.sku_id');
  assert.equal(call.skuChannelId, skuChannel.id, 'audit must carry skuChannelId from sku_channel.id');
  assert.equal(call.cycleId, cycleId, 'audit must carry cycleId');
  assert.equal(call.eventType, 'undercut-decision', 'audit eventType must come from engine auditEvents');
  assert.deepEqual(
    call.payload,
    { action: 'UNDERCUT', newPriceCents: 1799 },
    'audit payload must include action + newPriceCents (Story 7.6/Epic 9 will key on this)',
  );
  assert.ok(call.tx, 'audit call must include tx for transactional audit-event write');
});

test('cycle_assembly_test_covers_mixed_decisions', async () => {
  const { assembleCycle } = await import('../../worker/src/cycle-assembly.js');
  const { tx, inserts } = buildMockTx();
  const { calls: auditCalls, stub: mockWriteAuditEvent } = buildMockAuditWriter();

  const customerMarketplaceId = randomUUID();
  const cycleId = randomUUID();

  // 3 SKUs: UNDERCUT + HOLD + CEILING_RAISE → expect 2 staging inserts + 3 audit calls
  const skuChannels = [
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
    buildSkuChannel({ customer_marketplace_id: customerMarketplaceId }),
  ];

  let idx = 0;
  const seq = ['UNDERCUT', 'HOLD', 'CEILING_RAISE'];
  const seqEngine = {
    decideForSkuChannel: async () => {
      const action = seq[idx++];
      return { action, newPriceCents: 1799, auditEvents: [action.toLowerCase()] };
    },
  };

  await assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId, {
    engine: seqEngine,
    writeAuditEvent: mockWriteAuditEvent,
  });

  const stagingInserts = inserts.filter((i) => i.text.toLowerCase().includes('pri01_staging'));
  assert.equal(stagingInserts.length, 2, 'UNDERCUT + CEILING_RAISE must produce 2 staging inserts (HOLD produces 0)');
  assert.equal(auditCalls.length, 3, '3 SKU-channels must produce 3 audit events regardless of action type');
});

// ---------------------------------------------------------------------------
// Integration tests — require .env.test + local Supabase
// ---------------------------------------------------------------------------

if (process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL) {
  async function getPool () {
    const { getServiceRoleClient } = await import('../../shared/db/service-role-client.js');
    return getServiceRoleClient();
  }

  async function resetAllCustomers () {
    const { resetAuthAndCustomers, endResetAuthPool } = await import('../integration/_helpers/reset-auth-tables.js');
    await resetAuthAndCustomers();
    return endResetAuthPool;
  }

  // AC#1 — Migration creates pri01_staging table with full schema

  test('migration_creates_pri01_staging_table_with_full_schema', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../shared/db/service-role-client.js');
    t.after(async () => { await closeServiceRolePool(); });

    const { rows: tableRows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'pri01_staging' LIMIT 1`,
    );
    assert.strictEqual(tableRows.length, 1, 'pri01_staging table must exist in public schema');

    const { rows: colRows } = await pool.query(
      `SELECT column_name, udt_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pri01_staging'
       ORDER BY ordinal_position`,
    );
    const colMap = Object.fromEntries(colRows.map((r) => [r.column_name, r]));

    // Required columns per Story 5.2 AC#1
    assert.ok(colMap['id'], 'id column must exist');
    assert.ok(colMap['customer_marketplace_id'], 'customer_marketplace_id FK must exist');
    assert.ok(colMap['sku_id'], 'sku_id FK must exist');
    assert.ok(colMap['channel_code'], 'channel_code must exist');

    assert.ok(colMap['new_price_cents'], 'new_price_cents must exist');
    assert.strictEqual(colMap['new_price_cents'].is_nullable, 'NO', 'new_price_cents must be NOT NULL');

    assert.ok(colMap['cycle_id'], 'cycle_id must exist');
    assert.strictEqual(colMap['cycle_id'].udt_name, 'uuid', 'cycle_id must be uuid type');
    assert.strictEqual(colMap['cycle_id'].is_nullable, 'NO', 'cycle_id must be NOT NULL');

    assert.ok(colMap['staged_at'], 'staged_at timestamp must exist');

    assert.ok(colMap['flushed_at'], 'flushed_at must exist (nullable — set when PRI01 submitted)');
    assert.strictEqual(colMap['flushed_at'].is_nullable, 'YES', 'flushed_at must be nullable');

    assert.ok(colMap['import_id'], 'import_id must exist (nullable text — set when PRI01 returns importId)');
    assert.strictEqual(colMap['import_id'].is_nullable, 'YES', 'import_id must be nullable');
  });

  test('migration_creates_idx_pri01_staging_cycle_index', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../shared/db/service-role-client.js');
    t.after(async () => { await closeServiceRolePool(); });

    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'pri01_staging'`,
    );
    const names = rows.map((r) => r.indexname);

    assert.ok(
      names.includes('idx_pri01_staging_cycle'),
      `idx_pri01_staging_cycle must exist on pri01_staging; found: ${JSON.stringify(names)}`,
    );
  });

  test('migration_creates_idx_pri01_staging_sku_unflushed_index', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../shared/db/service-role-client.js');
    t.after(async () => { await closeServiceRolePool(); });

    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'pri01_staging'`,
    );
    const names = rows.map((r) => r.indexname);

    assert.ok(
      names.includes('idx_pri01_staging_sku_unflushed'),
      `idx_pri01_staging_sku_unflushed (partial index WHERE flushed_at IS NULL) must exist on pri01_staging; found: ${JSON.stringify(names)}`,
    );
  });

  test('rls_policy_prevents_cross_customer_staging_read', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../shared/db/service-role-client.js');
    const { getRlsAwareClient } = await import('../../shared/db/rls-aware-client.js');
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

    // Create customer A and customer B
    async function createUser (email) {
      const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: 'test-rls-staging-123!',
        user_metadata: { first_name: 'RLS', last_name: 'Test', company_name: 'RLS Corp' },
        email_confirm: true,
      });
      if (error) throw new Error(`createUser failed for ${email}: ${error.message}`);
      const { data: session, error: errSign } = await supabaseAnon.auth.signInWithPassword({ email, password: 'test-rls-staging-123!' });
      if (errSign) throw new Error(`signIn failed: ${errSign.message}`);
      return { userId: user.user.id, jwt: session.session.access_token };
    }

    const { jwt: jwtA } = await createUser('rls-staging-a@test.marketpilot.pt');
    const { userId: userBId } = await createUser('rls-staging-b@test.marketpilot.pt');

    // Create customer_marketplace for customer B
    const { rows: [cmB] } = await pool.query(
      `INSERT INTO customer_marketplaces
         (customer_id, operator, marketplace_instance_url, max_discount_pct,
          cron_state, cron_state_changed_at,
          shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels,
          channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals,
          discount_period_required, competitive_pricing_tool, scheduled_pricing,
          volume_pricing, multi_currency, order_tax_mode, platform_features_snapshot,
          last_pc01_pulled_at)
       VALUES ($1, 'WORTEN', 'https://marketplace.worten.pt', 0.02,
               'ACTIVE', NOW(),
               19706, 'Test Shop B', 'OPEN', 'EUR', true, ARRAY['WRT_PT_ONLINE'],
               'SINGLE', 'SEMICOLON', 2,
               false, false, false, false, false, 'NET', '{}', NOW())
       RETURNING id`,
      [userBId],
    );

    // Insert a sku for customer B
    const { rows: [skuB] } = await pool.query(
      `INSERT INTO skus (customer_marketplace_id, ean, shop_sku)
       VALUES ($1, '0000000000001', 'SHOP_SKU_B') RETURNING id`,
      [cmB.id],
    );

    // Insert a pri01_staging row for customer B
    const cycleId = randomUUID();
    const { rows: [staging] } = await pool.query(
      `INSERT INTO pri01_staging
         (customer_marketplace_id, sku_id, channel_code, new_price_cents, cycle_id)
       VALUES ($1, $2, 'WRT_PT_ONLINE', 1799, $3)
       RETURNING id`,
      [cmB.id, skuB.id, cycleId],
    );

    // Pre-condition: service-role can see B's staging row
    const { rows: preRows } = await pool.query(
      'SELECT id FROM pri01_staging WHERE id = $1',
      [staging.id],
    );
    assert.strictEqual(preRows.length, 1, 'Service-role must see customer B staging row');

    // Customer A's JWT must NOT be able to read customer B's staging row
    const clientA = await getRlsAwareClient(jwtA);
    try {
      const { rows } = await clientA.query(
        'SELECT id FROM pri01_staging WHERE id = $1',
        [staging.id],
      );
      assert.strictEqual(
        rows.length,
        0,
        'RLS must prevent customer A from reading customer B pri01_staging rows',
      );
    } finally {
      await clientA.release();
    }
  });

  test('rls_regression_suite_extended_with_pri01_staging', async () => {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile('scripts/rls-regression-suite.js', 'utf8');

    assert.ok(
      content.includes('pri01_staging'),
      "scripts/rls-regression-suite.js must include 'pri01_staging' in CUSTOMER_SCOPED_TABLES registry",
    );
  });
}
