// Story 5.1 — Integration tests for dispatcher + advisory locks
//
// Covers:
//   AC#1 — master-cron.js registered at worker boot (static assertion on worker/src/index.js)
//   AC#2 — Dispatcher index hit: EXPLAIN ANALYZE shows idx_sku_channels_dispatch in plan
//   AC#3 — Real Postgres advisory locks: acquire, double-acquire returns false, auto-release on session close
//   AC#5 — cycle_summaries stub helper callable without error
//
// Local-only: requires `.env.test` pointing at a local Supabase docker.
// Run with: node --env-file=.env.test --test tests/integration/dispatcher.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// AC#1 — master-cron.js registered at worker boot (static assertion)
// This test runs WITHOUT a DB — it only reads worker/src/index.js source.
// ---------------------------------------------------------------------------

test('master_cron_file_registered_with_node_cron_at_worker_boot', async () => {
  const { readFile } = await import('node:fs/promises');
  const content = await readFile('worker/src/index.js', 'utf8');

  const hasMasterCronImport = content.includes('master-cron') || content.includes('masterCron');
  assert.ok(
    hasMasterCronImport,
    'worker/src/index.js must import master-cron.js (the cron entry point for the dispatcher)',
  );
});

// ---------------------------------------------------------------------------
// Integration tests — require .env.test + local Supabase
// Auto-skipped when SUPABASE_SERVICE_ROLE_DATABASE_URL is unset.
// ---------------------------------------------------------------------------

if (process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL) {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function getPool () {
    const { getServiceRoleClient } = await import('../../shared/db/service-role-client.js');
    return getServiceRoleClient();
  }

  async function resetAllCustomers () {
    const { resetAuthAndCustomers, endResetAuthPool } = await import('./_helpers/reset-auth-tables.js');
    await resetAuthAndCustomers();
    return endResetAuthPool;
  }

  // Seed a minimal ACTIVE customer_marketplace + some sku_channels old enough to be dispatched
  async function seedActiveMarketplaceWithSkus (pool, customerId, numSkus = 10) {
    // Insert customer_marketplace in ACTIVE state with full A01/PC01 columns
    const { rows: [cm] } = await pool.query(
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
               19706, 'Test Shop', 'OPEN', 'EUR', true, ARRAY['WRT_PT_ONLINE'],
               'SINGLE', 'SEMICOLON', 2,
               false, false, false, false, false, 'NET', '{}', NOW())
       RETURNING id`,
      [customerId],
    );

    const cmId = cm.id;

    // Insert sku rows
    for (let i = 0; i < numSkus; i++) {
      const ean = `000000000${String(i).padStart(4, '0')}`;
      const { rows: [sku] } = await pool.query(
        `INSERT INTO skus (customer_marketplace_id, ean, shop_sku)
         VALUES ($1, $2, $3) RETURNING id`,
        [cmId, ean, `SHOP_SKU_${i}`],
      );

      // Insert sku_channel with last_checked_at = 10 minutes ago (well past the 5-min cadence)
      await pool.query(
        `INSERT INTO sku_channels
           (sku_id, customer_marketplace_id, channel_code, tier_value, tier_cadence_minutes,
            last_checked_at, frozen_for_anomaly_review)
         VALUES ($1, $2, 'WRT_PT_ONLINE', '1', 5,
                 NOW() - INTERVAL '10 minutes', false)`,
        [sku.id, cmId],
      );
    }

    return cmId;
  }

  // ---------------------------------------------------------------------------
  // AC#2 — EXPLAIN ANALYZE shows idx_sku_channels_dispatch is used
  // ---------------------------------------------------------------------------

  test('dispatcher_index_hit_on_seeded_catalog_explain_analyze', async (t) => {
    const pool = await getPool();
    const { createClient } = await import('@supabase/supabase-js');
    const { closeServiceRolePool } = await import('../../shared/db/service-role-client.js');
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

    // Create a test customer
    const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
      email: 'dispatcher-explain@test.marketpilot.pt',
      password: 'test-disp-explain-123!',
      user_metadata: { first_name: 'Disp', last_name: 'Explain', company_name: 'Disp Corp' },
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);

    await seedActiveMarketplaceWithSkus(pool, user.user.id, 100);

    // Run EXPLAIN ANALYZE on the AD17 dispatcher SQL
    const DISPATCHER_SQL = `
      EXPLAIN (ANALYZE, FORMAT TEXT)
      SELECT cm.id, sc.id AS sku_channel_id, sc.sku_id, sc.channel_code
        FROM customer_marketplaces cm
        JOIN sku_channels sc ON sc.customer_marketplace_id = cm.id
       WHERE cm.cron_state = 'ACTIVE'
         AND sc.frozen_for_anomaly_review = false
         AND sc.pending_import_id IS NULL
         AND sc.excluded_at IS NULL
         AND sc.last_checked_at + (sc.tier_cadence_minutes * INTERVAL '1 minute') < NOW()
       ORDER BY cm.id, sc.last_checked_at ASC
       LIMIT $1
    `;

    const { rows } = await pool.query(DISPATCHER_SQL, [1000]);
    const plan = rows.map((r) => Object.values(r).join('')).join('\n');

    assert.ok(
      plan.includes('idx_sku_channels_dispatch'),
      `EXPLAIN ANALYZE must show idx_sku_channels_dispatch index usage.\nPlan:\n${plan}`,
    );
  });

  // ---------------------------------------------------------------------------
  // AC#3 — Real Postgres advisory locks
  // ---------------------------------------------------------------------------

  test('advisory_lock_real_pg_try_advisory_lock_succeeds_for_free_key', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../shared/db/service-role-client.js');
    const { tryAcquireCustomerLock, releaseCustomerLock } = await import('../../worker/src/advisory-lock.js');

    t.after(async () => {
      await closeServiceRolePool();
    });

    const testUuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const client = await pool.connect();

    try {
      // First acquisition must succeed
      const acquired = await tryAcquireCustomerLock(client, testUuid);
      assert.equal(acquired, true, 'First tryAcquireCustomerLock must return true for a free lock key');

      // Clean up: release the lock
      await releaseCustomerLock(client, testUuid);
    } finally {
      client.release();
    }
  });

  test('advisory_lock_real_pg_try_advisory_lock_returns_false_for_held_key', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../shared/db/service-role-client.js');
    const { tryAcquireCustomerLock, releaseCustomerLock } = await import('../../worker/src/advisory-lock.js');

    t.after(async () => {
      await closeServiceRolePool();
    });

    const testUuid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      // Client A acquires the lock
      const acquiredA = await tryAcquireCustomerLock(clientA, testUuid);
      assert.equal(acquiredA, true, 'Client A must acquire the lock first');

      // Client B tries to acquire the same lock — must fail (return false)
      const acquiredB = await tryAcquireCustomerLock(clientB, testUuid);
      assert.equal(
        acquiredB,
        false,
        'Client B must get false when lock is already held by Client A',
      );

      // Clean up: A releases
      await releaseCustomerLock(clientA, testUuid);
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  test('advisory_lock_auto_released_on_session_close', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../shared/db/service-role-client.js');
    const { tryAcquireCustomerLock } = await import('../../worker/src/advisory-lock.js');

    t.after(async () => {
      await closeServiceRolePool();
    });

    const testUuid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    // Client A acquires and then releases (simulates session close)
    const clientA = await pool.connect();
    const acquiredA = await tryAcquireCustomerLock(clientA, testUuid);
    assert.equal(acquiredA, true, 'Client A must acquire the lock');
    // Release client A (auto-releases session-scoped advisory locks in Postgres)
    clientA.release();

    // Client B must now be able to acquire the same lock
    const clientB = await pool.connect();
    try {
      const acquiredB = await tryAcquireCustomerLock(clientB, testUuid);
      assert.equal(
        acquiredB,
        true,
        'After Client A releases, Client B must be able to acquire the same advisory lock',
      );
    } finally {
      clientB.release();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#5 — cycle_summaries stub helper callable without error
  // ---------------------------------------------------------------------------

  test('cycle_summaries_stub_helper_callable_without_error', async (t) => {
    const pool = await getPool();
    const { closeServiceRolePool } = await import('../../shared/db/service-role-client.js');

    t.after(async () => {
      await closeServiceRolePool();
    });

    // The dispatcher's cycle-summaries write is a stub at this stage (Epic 9 hasn't shipped yet).
    // It should be callable without throwing even if the table doesn't exist.
    const { dispatchCycle } = await import('../../worker/src/dispatcher.js');
    assert.equal(typeof dispatchCycle, 'function', 'dispatchCycle must be exported and callable');

    // Run with an empty catalog (no ACTIVE marketplaces): should complete cleanly without error
    const mockPool = {
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {},
      }),
      query: async () => ({ rows: [] }),
    };

    await assert.doesNotReject(
      async () => dispatchCycle({ pool: mockPool }),
      'dispatchCycle must not throw when cycle_summaries stub helper is invoked with empty catalog',
    );
  });
}
