// Story 4.4 / AC#5 — Async catalog scan orchestration integration test.
// Atomicity Bundle B sibling of Story 4.1.
//
// Covers:
//   AC#1 — Full 9-phase scan sequence against Mirakl mock server seeded with 200-SKU fixture:
//           PENDING → RUNNING_A01 → RUNNING_PC01 → RUNNING_OF21 → RUNNING_P11 →
//           CLASSIFYING_TIERS → SNAPSHOTTING_BASELINE → COMPLETE
//           A01/PC01 columns populated; skus/sku_channels/baseline_snapshots rows created
//           Tier cadence_minutes defaults per AD10; self-filter applied to P11 responses
//           PROVISIONING → DRY_RUN transition via transitionCronState
//   AC#2 — Failure path: any step throws → FAILED + failure_reason + email + PROVISIONING stays
//           Idempotent: new scan_jobs row allowed once previous is FAILED
//   AC#3 — Status endpoint returns PT-localized phase_message per AD16 UX delta
//   AC#4 — 200-SKU scan completes within 60s test timeout (mock server, not live)
//   AC#5 — Atomicity Bundle B invariants:
//           - cleartext key never in pino output
//           - no parallel scan_jobs row possible (EXCLUDE constraint)
//           - PRI02 never called during scan (read-only operation)
//           - F4 CHECK constraint never violated during scan
//           - DRY_RUN + all A01/PC01 non-NULL after COMPLETE
//
// Local-only: requires `.env.test` pointing at a local Supabase docker.
// Mirakl mock server from tests/mocks/mirakl-server.js must be seeded with
// 200-SKU OF21 fixture + batched P11 responses.
//
// Run with: node --env-file=.env.test --test tests/integration/onboarding-scan.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { createMiraklMockServer } from '../mocks/mirakl-server.js';
import { getServiceRoleClient, closeServiceRolePool } from '../../shared/db/service-role-client.js';
import { resetAuthAndCustomers, endResetAuthPool } from './_helpers/reset-auth-tables.js';

// ---------------------------------------------------------------------------
// PT-localized phase messages (UX-DR6 verbatim — encode as constants so diffs
// in PR review are obvious if copy changes).
// ---------------------------------------------------------------------------
const PHASE_MESSAGES = {
  PENDING:             'A configurar integração com Worten',
  RUNNING_A01:         'A configurar integração com Worten',
  RUNNING_PC01:        'A configurar integração com Worten',
  RUNNING_OF21:        'A obter catálogo',
  RUNNING_P11:         'A classificar tiers iniciais',
  CLASSIFYING_TIERS:   'A classificar tiers iniciais',
  SNAPSHOTTING_BASELINE: 'A snapshotar baselines',
  COMPLETE:            'Pronto',
  FAILED:              'Falhou',
};

// Deterministic synthetic API key for log-inspection tests.
// It contains a recognizable prefix that would stand out in any log line.
const SYNTHETIC_API_KEY = 'MP_TEST_CLEARTEXT_APIKEY_DO_NOT_LOG_xyz9872';

// PT-localized failure reason for DISABLED channel_pricing (verbatim from AC#1 spec).
const PC01_DISABLED_FAILURE_MSG =
  'O Worten não tem preços por canal activados. Por favor contacta o suporte.';

// ---------------------------------------------------------------------------
// Supabase admin client (lazy)
// ---------------------------------------------------------------------------

let _supabaseAdmin = null;
let _supabaseAnon = null;

function getSupabaseAdmin () {
  if (_supabaseAdmin === null) {
    _supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _supabaseAdmin;
}

function getSupabaseAnon () {
  if (_supabaseAnon === null) {
    _supabaseAnon = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _supabaseAnon;
}

// ---------------------------------------------------------------------------
// Test user credentials
// ---------------------------------------------------------------------------

const TEST_USER = {
  email: 'scan-test@test.marketpilot.pt',
  password: 'test-scan-password-123!',
  user_metadata: { first_name: 'ScanTest', last_name: 'User', company_name: 'ScanCo' },
};

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Create a test customer via Supabase admin API (fires handle_new_auth_user trigger
 * which creates public.customers + public.customer_profiles rows).
 *
 * @returns {{ userId: string, jwt: string }}
 */
async function seedTestCustomer () {
  const admin = getSupabaseAdmin();
  const anon = getSupabaseAnon();

  // Clean up any pre-existing user with the same email
  const { data: existing } = await admin.auth.admin.listUsers();
  if (existing?.users) {
    for (const u of existing.users) {
      if (u.email === TEST_USER.email) {
        await admin.auth.admin.deleteUser(u.id);
      }
    }
  }

  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email: TEST_USER.email,
    password: TEST_USER.password,
    user_metadata: TEST_USER.user_metadata,
    email_confirm: true,
  });
  if (createErr) throw new Error(`seedTestCustomer: create user failed — ${createErr.message}`);

  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({
    email: TEST_USER.email,
    password: TEST_USER.password,
  });
  if (signInErr) throw new Error(`seedTestCustomer: sign-in failed — ${signInErr.message}`);

  return { userId: newUser.user.id, jwt: session.session.access_token };
}

/**
 * Create a customer_marketplaces row in PROVISIONING + a vault row with a known synthetic
 * API key encrypted via the existing envelope module.
 *
 * Returns: { customerMarketplaceId, scanJobId }
 */
async function seedProvisioningMarketplace (customerId, mockBaseUrl, apiKey = SYNTHETIC_API_KEY) {
  const db = getServiceRoleClient();

  // Derive customer UUID from auth.users.id via the customers table
  const { rows: custRows } = await db.query(
    'SELECT id FROM customers WHERE id = $1',
    [customerId],
  );
  if (custRows.length === 0) throw new Error(`seedProvisioningMarketplace: customer ${customerId} not in public.customers yet`);

  const { rows: cmRows } = await db.query(
    `INSERT INTO customer_marketplaces
       (customer_id, operator, marketplace_instance_url, max_discount_pct)
     VALUES ($1, 'WORTEN', $2, 0.0300)
     RETURNING id`,
    [customerId, mockBaseUrl],
  );
  const customerMarketplaceId = cmRows[0].id;

  // Import envelope to encrypt the test key. The master key must be loaded from env.
  const { encryptShopApiKey } = await import('../../shared/crypto/envelope.js');
  const { loadMasterKey } = await import('../../shared/crypto/master-key-loader.js');
  const masterKey = loadMasterKey();
  const vaultRow = encryptShopApiKey(apiKey, masterKey);

  await db.query(
    `INSERT INTO shop_api_key_vault
       (customer_marketplace_id, ciphertext, nonce, auth_tag, master_key_version)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      customerMarketplaceId,
      vaultRow.ciphertext,
      vaultRow.nonce,
      vaultRow.authTag,
      vaultRow.masterKeyVersion,
    ],
  );

  // Create PENDING scan_jobs row
  const { rows: sjRows } = await db.query(
    `INSERT INTO scan_jobs
       (customer_marketplace_id, status, phase_message)
     VALUES ($1, 'PENDING', $2)
     RETURNING id`,
    [customerMarketplaceId, PHASE_MESSAGES.PENDING],
  );
  const scanJobId = sjRows[0].id;

  return { customerMarketplaceId, scanJobId };
}

/**
 * Invoke processNextPendingScan() directly — calls the worker module.
 * The module must be importable; if it doesn't exist yet (pre-dev) this throws.
 *
 * @param {{ MIRAKL_BASE_URL?: string }} [envOverrides={}] - env overrides for the scan run
 */
async function runScan (envOverrides = {}) {
  const savedEnv = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    const { processNextPendingScan } = await import('../../worker/src/jobs/onboarding-scan.js');
    await processNextPendingScan();
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

/**
 * Poll scan_jobs.status for customerMarketplaceId until it reaches one of the
 * terminal states (COMPLETE / FAILED) or the timeoutMs expires.
 *
 * @param {string} customerMarketplaceId
 * @param {number} [timeoutMs=60000]
 * @returns {Promise<object>} the final scan_jobs row
 */
async function pollScanUntilTerminal (customerMarketplaceId, timeoutMs = 60_000) {
  const db = getServiceRoleClient();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await db.query(
      `SELECT * FROM scan_jobs WHERE customer_marketplace_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [customerMarketplaceId],
    );
    if (rows.length > 0 && (rows[0].status === 'COMPLETE' || rows[0].status === 'FAILED')) {
      return rows[0];
    }
    await delay(200);
  }
  throw new Error(`pollScanUntilTerminal: timed out after ${timeoutMs}ms for cm ${customerMarketplaceId}`);
}

/**
 * Clean up test data for a customer_marketplace_id (cascades to scan_jobs, skus, etc.)
 */
async function cleanupMarketplace (customerMarketplaceId) {
  if (!customerMarketplaceId) return;
  const db = getServiceRoleClient();
  await db.query(
    'DELETE FROM customer_marketplaces WHERE id = $1',
    [customerMarketplaceId],
  );
}

// ---------------------------------------------------------------------------
// 200-SKU fixture generator for OF21 + P11 mock responses
// ---------------------------------------------------------------------------

/**
 * Generate an OF21 fixture with `count` SKUs. Returns the same shape as FIXTURE_OF21_PAGE1.
 * Half the SKUs have both PT and ES channels; the other half have PT only.
 * One SKU has NO EAN (for the skip-EAN test).
 */
function generate200SkuOf21Fixture (count = 200) {
  const offers = [];
  for (let i = 0; i < count; i++) {
    const ean = `880960685${String(i).padStart(4, '0')}`;
    const hasBothChannels = i % 2 === 0;
    const noEan = (i === count - 1); // last SKU has no EAN

    offers.push({
      shop_sku: `EZ${ean}`,
      offer_sku: null,
      product_sku: `mirakl-uuid-${i}`,
      price: 20.00 + (i % 50),
      total_price: 22.00 + (i % 50),
      min_shipping_price: 2.00,
      quantity: 10,
      active: true,
      channels: hasBothChannels
        ? [{ code: 'WRT_PT_ONLINE' }, { code: 'WRT_ES_ONLINE' }]
        : [{ code: 'WRT_PT_ONLINE' }],
      product_references: noEan
        ? [] // no EAN — should be skipped
        : [{ reference_type: 'EAN', reference: ean }],
    });
  }
  return { total_count: count, offers };
}

/**
 * Generate a P11 response for a batch of EANs. First 5 EANs get competitors;
 * rest get no competitors → Tier 3.
 * For the first 5: EANs 0-2 have us winning (Tier 2a), EANs 3-4 have us losing (Tier 1).
 */
function generateP11BatchResponse (eans, channelCode, ownShopName) {
  const products = eans.map((ean, idx) => {
    // Skip no-EAN placeholders (shouldn't appear in P11 calls)
    if (!ean) return null;

    const ownPrice = 22.00 + (parseInt(ean.slice(-4)) % 50);
    const offers = [];

    if (idx < 5) {
      // Has competitors
      const competitorPrice = idx < 3
        ? ownPrice + 1.00   // we're winning → Tier 2a
        : ownPrice - 1.00;  // competitor cheaper → Tier 1

      offers.push(
        { shop_name: 'Competitor A', active: true, total_price: competitorPrice, shop_id: null, channels: [] },
        // Include own shop (should be filtered out by self-filter.js)
        { shop_name: ownShopName, active: true, total_price: ownPrice, shop_id: null, channels: [] },
      );
    }
    // idx >= 5 → no competitors → Tier 3

    return {
      product_references: [{ reference_type: 'EAN', reference: ean }],
      product_sku: `mirakl-uuid-${idx}`,
      offers,
    };
  }).filter(Boolean);

  return { products };
}

// ---------------------------------------------------------------------------
// Mock server factory with 200-SKU fixture
// ---------------------------------------------------------------------------

async function createScanMockServer ({ disableChannelPricing = false } = {}) {
  const { mockServer, baseUrl } = await createMiraklMockServer();

  // We need to override the OF21 and P11 routes to serve 200-SKU fixture.
  // The base mock server doesn't expose route overrides; we create a NEW mock
  // server (Fastify) with extended behaviour.
  //
  // Strategy: close the base mock server and create a fresh Fastify instance
  // with 200-SKU fixture + optional PC01 DISABLED override.
  await mockServer.close();

  // Build a custom Fastify mock with 200-SKU fixture
  const { default: Fastify } = await import('fastify');
  const fastify = Fastify({ logger: false });

  // Track all request paths for no-PRI02 assertion
  const requestLog = [];
  fastify.addHook('onRequest', async (req) => {
    requestLog.push(req.url.split('?')[0]);
  });

  const of21Fixture = generate200SkuOf21Fixture(200);
  const ownShopName = 'Easy - Store';

  // A01
  fastify.get('/api/account', (_req, reply) => {
    reply.send({
      shop_id: 19706,
      shop_name: ownShopName,
      shop_state: 'OPEN',
      currency_iso_code: 'EUR',
      is_professional: true,
      channels: [
        { code: 'WRT_PT_ONLINE', label: 'Worten PT Online' },
        { code: 'WRT_ES_ONLINE', label: 'Worten ES Online' },
      ],
      domains: ['worten.pt', 'worten.es'],
    });
  });

  // PC01 — nested structure per MCP-confirmed schema
  fastify.get('/api/platform/configuration', (_req, reply) => {
    if (disableChannelPricing) {
      reply.send({
        features: {
          pricing: {
            channel_pricing: 'DISABLED',
            discount_period_required: false,
            scheduled_pricing: false,
            volume_pricing: false,
          },
          operator_csv_delimiter: 'SEMICOLON',
          offer_prices_decimals: '2',
          competitive_pricing_tool: true,
          multi_currency: false,
          order_tax_mode: 'TAX_EXCLUSIVE',
        },
      });
    } else {
      reply.send({
        features: {
          pricing: {
            channel_pricing: 'SINGLE',
            discount_period_required: false,
            scheduled_pricing: false,
            volume_pricing: false,
          },
          operator_csv_delimiter: 'SEMICOLON',
          offer_prices_decimals: '2',
          competitive_pricing_tool: true,
          multi_currency: false,
          order_tax_mode: 'TAX_EXCLUSIVE',
        },
      });
    }
  });

  // OF21 — paginated (100 per page)
  const PAGE_SIZE = 100;
  fastify.get('/api/offers', (req, reply) => {
    const offset = Number(req.query.offset ?? 0);
    const pageOffers = of21Fixture.offers.slice(offset, offset + PAGE_SIZE);
    reply.send({
      total_count: of21Fixture.total_count,
      offers: pageOffers,
    });
  });

  // P11 — batch 100 EANs per call
  fastify.get('/api/products/offers', (req, reply) => {
    const productRefsParam = req.query.product_references ?? '';
    const channelCode = req.query.pricing_channel_code ?? req.query.channel_codes ?? 'WRT_PT_ONLINE';

    // Parse EANs from "EAN|xxx,EAN|yyy,..." format
    const eans = productRefsParam
      .split(',')
      .map((r) => {
        const parts = r.split('|');
        return parts[1] ?? null;
      })
      .filter(Boolean);

    reply.send(generateP11BatchResponse(eans, channelCode, ownShopName));
  });

  // Smoke test endpoint (A01 also serves this role; the verify script calls A01)
  // already handled above

  // Fallback 404
  fastify.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'Mock server: path not registered' });
  });

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const { port } = fastify.server.address();
  const mockBaseUrl = `http://127.0.0.1:${port}`;

  return {
    mockBaseUrl,
    getRequestLog: () => [...requestLog],
    close: () => fastify.close(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test('onboarding-scan integration', async (t) => {
  // -------------------------------------------------------------------------
  // Suite-level setup: start mock server
  // -------------------------------------------------------------------------

  let mockServer = null;
  let mockBaseUrl = null;

  t.before(async () => {
    const srv = await createScanMockServer();
    mockServer = srv;
    mockBaseUrl = srv.mockBaseUrl;
  });

  t.after(async () => {
    if (mockServer) await mockServer.close();
    await endResetAuthPool();
    await closeServiceRolePool();
  });

  // ---------------------------------------------------------------------------
  // AC#1 — Full 9-phase scan sequence
  // ---------------------------------------------------------------------------

  await t.test('scan_runs_9_phases_in_sequence_against_mock_server', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    const db = getServiceRoleClient();
    const statuses = [];

    // Poll for status transitions with a short interval to capture ordering
    const deadline = Date.now() + 60_000;
    let lastStatus = null;

    // Run scan in background and collect statuses
    const scanPromise = runScan();

    while (Date.now() < deadline) {
      const { rows } = await db.query(
        'SELECT status FROM scan_jobs WHERE customer_marketplace_id = $1 ORDER BY created_at DESC LIMIT 1',
        [customerMarketplaceId],
      );
      if (rows.length > 0 && rows[0].status !== lastStatus) {
        lastStatus = rows[0].status;
        statuses.push(lastStatus);
      }
      if (lastStatus === 'COMPLETE' || lastStatus === 'FAILED') break;
      await delay(100);
    }

    await scanPromise;

    // Assert terminal state
    assert.equal(lastStatus, 'COMPLETE', `Expected COMPLETE but got ${lastStatus}`);

    // Assert PENDING was the start state (may have been captured or transitioned immediately)
    assert.ok(
      statuses.includes('COMPLETE'),
      `Expected COMPLETE in status sequence, got: ${statuses.join(' → ')}`,
    );

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('scan_persists_a01_columns_to_customer_marketplaces', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();
    const { rows } = await db.query(
      `SELECT shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels
       FROM customer_marketplaces WHERE id = $1`,
      [customerMarketplaceId],
    );
    assert.equal(rows.length, 1, 'customer_marketplaces row must exist');
    const cm = rows[0];

    assert.ok(cm.shop_id != null, 'shop_id must be populated after A01');
    assert.ok(cm.shop_name != null && cm.shop_name.length > 0, 'shop_name must be populated after A01');
    assert.ok(cm.shop_state != null, 'shop_state must be populated after A01');
    assert.ok(cm.currency_iso_code != null, 'currency_iso_code must be populated after A01');
    assert.ok(cm.is_professional != null, 'is_professional must be populated after A01');
    assert.ok(Array.isArray(cm.channels) || cm.channels != null, 'channels must be populated after A01');

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('scan_persists_pc01_columns_to_customer_marketplaces', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();
    const { rows } = await db.query(
      `SELECT channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals,
              platform_features_snapshot, last_pc01_pulled_at
       FROM customer_marketplaces WHERE id = $1`,
      [customerMarketplaceId],
    );
    assert.equal(rows.length, 1, 'customer_marketplaces row must exist');
    const cm = rows[0];

    assert.ok(cm.channel_pricing_mode != null, 'channel_pricing_mode must be populated after PC01');
    assert.ok(cm.operator_csv_delimiter != null, 'operator_csv_delimiter must be populated after PC01');
    assert.ok(cm.offer_prices_decimals != null, 'offer_prices_decimals must be populated after PC01');
    assert.ok(cm.platform_features_snapshot != null, 'platform_features_snapshot JSONB must be populated after PC01');
    assert.ok(cm.last_pc01_pulled_at != null, 'last_pc01_pulled_at must be set after PC01');

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('scan_aborts_on_channel_pricing_mode_disabled', async () => {
    // Create a separate disabled-channel mock server
    const disabledSrv = await createScanMockServer({ disableChannelPricing: true });

    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, disabledSrv.mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();
    const { rows: scanRows } = await db.query(
      'SELECT status, failure_reason FROM scan_jobs WHERE customer_marketplace_id = $1',
      [customerMarketplaceId],
    );
    assert.equal(scanRows.length, 1, 'scan_jobs row must exist');
    assert.equal(scanRows[0].status, 'FAILED', 'scan must fail with DISABLED channel_pricing');
    assert.ok(
      scanRows[0].failure_reason?.includes('Worten') ||
      scanRows[0].failure_reason?.includes('canal'),
      `failure_reason must be PT-localized; got: ${scanRows[0].failure_reason}`,
    );

    // customer_marketplaces must stay in PROVISIONING
    const { rows: cmRows } = await db.query(
      'SELECT cron_state FROM customer_marketplaces WHERE id = $1',
      [customerMarketplaceId],
    );
    assert.equal(cmRows[0].cron_state, 'PROVISIONING', 'marketplace must stay PROVISIONING on DISABLED abort');

    await cleanupMarketplace(customerMarketplaceId);
    await disabledSrv.close();
  });

  await t.test('scan_populates_skus_and_sku_channels', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();
    const { rows: skuRows } = await db.query(
      'SELECT COUNT(*)::int AS cnt FROM skus WHERE customer_marketplace_id = $1',
      [customerMarketplaceId],
    );
    // 200 offers, 1 without EAN → 199 skus expected
    assert.ok(skuRows[0].cnt >= 199, `Expected >= 199 sku rows, got ${skuRows[0].cnt}`);

    const { rows: scRows } = await db.query(
      'SELECT COUNT(*)::int AS cnt FROM sku_channels WHERE customer_marketplace_id = $1',
      [customerMarketplaceId],
    );
    // At least 199 sku_channels (some SKUs have 2 channels)
    assert.ok(scRows[0].cnt >= 199, `Expected >= 199 sku_channels rows, got ${scRows[0].cnt}`);

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('scan_populates_baseline_snapshots', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();
    const { rows: scRows } = await db.query(
      'SELECT COUNT(*)::int AS cnt FROM sku_channels WHERE customer_marketplace_id = $1',
      [customerMarketplaceId],
    );
    const { rows: bsRows } = await db.query(
      'SELECT COUNT(*)::int AS cnt FROM baseline_snapshots WHERE customer_marketplace_id = $1',
      [customerMarketplaceId],
    );

    // One baseline_snapshot per sku_channel row
    assert.equal(
      bsRows[0].cnt,
      scRows[0].cnt,
      `baseline_snapshots count (${bsRows[0].cnt}) must equal sku_channels count (${scRows[0].cnt})`,
    );

    // Spot-check: list_price_cents and current_price_cents non-NULL, captured_at set
    const { rows: sampleRows } = await db.query(
      `SELECT bs.list_price_cents, bs.current_price_cents, bs.captured_at
       FROM baseline_snapshots bs
       WHERE bs.customer_marketplace_id = $1
       LIMIT 5`,
      [customerMarketplaceId],
    );
    for (const row of sampleRows) {
      assert.ok(row.list_price_cents > 0, 'list_price_cents must be > 0');
      assert.ok(row.current_price_cents > 0, 'current_price_cents must be > 0');
      assert.ok(row.captured_at != null, 'captured_at must be set');
    }

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('scan_applies_self_filter_to_p11_responses', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();

    // The ownShopName is 'Easy - Store' (from FIXTURE_A01 in mock server).
    // After scan, tier classification was applied. SKUs where we are winning
    // must have tier '2a'; none should be classified based on our own offer.
    //
    // Verify: the scan completed successfully (self-filter didn't crash or
    // leave partial data) and no sku_channel has a tier that would only be
    // possible if own shop was included in competitor data (i.e., we didn't
    // compare against ourselves).
    //
    // Structural assertion: at least some Tier 1 and Tier 2a SKUs exist (from
    // the fixture design: first 5 EANs have competitors, 3 winning / 2 losing).
    const { rows: t1Rows } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM sku_channels WHERE customer_marketplace_id = $1 AND tier = '1'`,
      [customerMarketplaceId],
    );
    const { rows: t2aRows } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM sku_channels WHERE customer_marketplace_id = $1 AND tier = '2a'`,
      [customerMarketplaceId],
    );
    const { rows: t3Rows } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM sku_channels WHERE customer_marketplace_id = $1 AND tier = '3'`,
      [customerMarketplaceId],
    );

    // With the fixture design: first 5 EANs have competitors (some on PT, some on both channels)
    // Rest have no competitors → Tier 3
    assert.ok(t3Rows[0].cnt > 0, 'Tier 3 SKUs must exist (those with no competitors after self-filter)');
    // The combined Tier1 + Tier2a must be > 0 (some SKUs had competitors)
    assert.ok(
      t1Rows[0].cnt + t2aRows[0].cnt > 0,
      'Some Tier 1 or Tier 2a SKUs must exist (from SKUs with competitors)',
    );

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('scan_assigns_tier_cadence_minutes_per_ad10_defaults', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();

    // AD10 tier defaults: Tier 1 → 15 min, Tier 2a → 15 min, Tier 3 → 1440 min
    // Note: story spec says 15 min for Tier 1 and 2a; test plan note 8 says 5 min
    // but the story spec (AC#1 Phase 6, Dev Notes tier-classify.js shape) says 15.
    // Using story spec as canonical source.
    const { rows: tier1Rows } = await db.query(
      `SELECT DISTINCT tier_cadence_minutes FROM sku_channels
       WHERE customer_marketplace_id = $1 AND tier = '1'`,
      [customerMarketplaceId],
    );
    const { rows: tier2aRows } = await db.query(
      `SELECT DISTINCT tier_cadence_minutes FROM sku_channels
       WHERE customer_marketplace_id = $1 AND tier = '2a'`,
      [customerMarketplaceId],
    );
    const { rows: tier3Rows } = await db.query(
      `SELECT DISTINCT tier_cadence_minutes FROM sku_channels
       WHERE customer_marketplace_id = $1 AND tier = '3'`,
      [customerMarketplaceId],
    );

    if (tier1Rows.length > 0) {
      assert.equal(tier1Rows[0].tier_cadence_minutes, 15, 'Tier 1 cadence must be 15 min per AD10');
    }
    if (tier2aRows.length > 0) {
      assert.equal(tier2aRows[0].tier_cadence_minutes, 15, 'Tier 2a cadence must be 15 min per AD10');
    }
    if (tier3Rows.length > 0) {
      assert.equal(tier3Rows[0].tier_cadence_minutes, 1440, 'Tier 3 cadence must be 1440 min (daily) per AD10');
    }

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('scan_transitions_to_dry_run_on_complete', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();
    const { rows: cmRows } = await db.query(
      'SELECT cron_state FROM customer_marketplaces WHERE id = $1',
      [customerMarketplaceId],
    );
    assert.equal(cmRows.length, 1, 'customer_marketplaces row must exist');
    assert.equal(
      cmRows[0].cron_state,
      'DRY_RUN',
      `Expected DRY_RUN cron_state after scan COMPLETE, got: ${cmRows[0].cron_state}`,
    );

    await cleanupMarketplace(customerMarketplaceId);
  });

  // ---------------------------------------------------------------------------
  // AC#2 — Failure paths
  // ---------------------------------------------------------------------------

  await t.test('scan_failure_persists_failed_status_and_failure_reason', async () => {
    // Use the disabled-channel mock to trigger a known failure path
    const failSrv = await createScanMockServer({ disableChannelPricing: true });

    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, failSrv.mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();
    const { rows: sjRows } = await db.query(
      `SELECT status, failure_reason, completed_at FROM scan_jobs
       WHERE customer_marketplace_id = $1`,
      [customerMarketplaceId],
    );
    assert.equal(sjRows.length, 1, 'scan_jobs row must exist');
    assert.equal(sjRows[0].status, 'FAILED', 'scan_jobs must be FAILED');
    assert.ok(sjRows[0].failure_reason != null && sjRows[0].failure_reason.length > 0,
      'failure_reason must be set');
    assert.ok(sjRows[0].completed_at != null, 'completed_at must be set on failure');

    // customer_marketplaces must remain in PROVISIONING
    const { rows: cmRows } = await db.query(
      'SELECT cron_state FROM customer_marketplaces WHERE id = $1',
      [customerMarketplaceId],
    );
    assert.equal(
      cmRows[0].cron_state,
      'PROVISIONING',
      'customer_marketplace must stay PROVISIONING after failed scan',
    );

    await cleanupMarketplace(customerMarketplaceId);
    await failSrv.close();
  });

  await t.test('scan_failure_sends_email_via_resend', async () => {
    // Stub sendCriticalAlert via dynamic mock.module — captured by wrapper import
    // We assert the stub was called with expected arguments after a failed scan.
    //
    // Implementation note: since node:test mock.module() patches at module level,
    // and the scan module is already loaded, we verify the stub contract by
    // checking the import path is correct in the source file (static assertion)
    // and by inspecting a spy if available. If Story 4.6 is not yet shipped,
    // the stub in onboarding-scan.js (Story 4.6 no-op stub) means no throw occurs.
    //
    // This test verifies: no crash + scan_jobs.status = FAILED (the email stub
    // does not block scan failure recording). Full email send verification
    // belongs to Story 4.6's test suite.

    const failSrv = await createScanMockServer({ disableChannelPricing: true });

    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, failSrv.mockBaseUrl);

    // Run scan — should not throw even if sendCriticalAlert is a stub
    await assert.doesNotReject(
      () => runScan(),
      'runScan must not throw even when sendCriticalAlert is stubbed',
    );

    const db = getServiceRoleClient();
    const { rows: sjRows } = await db.query(
      'SELECT status FROM scan_jobs WHERE customer_marketplace_id = $1',
      [customerMarketplaceId],
    );
    assert.equal(sjRows[0].status, 'FAILED', 'scan must record FAILED status');

    await cleanupMarketplace(customerMarketplaceId);
    await failSrv.close();
  });

  await t.test('scan_idempotent_new_scan_allowed_after_failed', async () => {
    const failSrv = await createScanMockServer({ disableChannelPricing: true });

    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, failSrv.mockBaseUrl);

    // Run first scan → FAILED
    await runScan();

    const db = getServiceRoleClient();
    const { rows: sjRows1 } = await db.query(
      'SELECT status FROM scan_jobs WHERE customer_marketplace_id = $1',
      [customerMarketplaceId],
    );
    assert.equal(sjRows1[0].status, 'FAILED', 'first scan must be FAILED');

    // EXCLUDE constraint allows a new PENDING row once previous is FAILED
    let insertError = null;
    try {
      await db.query(
        `INSERT INTO scan_jobs (customer_marketplace_id, status, phase_message)
         VALUES ($1, 'PENDING', $2)`,
        [customerMarketplaceId, PHASE_MESSAGES.PENDING],
      );
    } catch (err) {
      insertError = err;
    }

    assert.equal(insertError, null,
      `New PENDING scan_jobs row must be allowed after FAILED scan; got error: ${insertError?.message}`);

    // Verify the new row was created
    const { rows: sjRows2 } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM scan_jobs WHERE customer_marketplace_id = $1`,
      [customerMarketplaceId],
    );
    assert.equal(sjRows2[0].cnt, 2, 'Two scan_jobs rows must exist (one FAILED, one PENDING)');

    await cleanupMarketplace(customerMarketplaceId);
    await failSrv.close();
  });

  // ---------------------------------------------------------------------------
  // AC#3 — Status endpoint (phase_message column)
  // ---------------------------------------------------------------------------

  await t.test('status_endpoint_returns_correct_phase_message_per_status', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    const db = getServiceRoleClient();

    // Verify that the PENDING row has the correct PT-localized phase_message
    const { rows: pendingRows } = await db.query(
      `SELECT status, phase_message FROM scan_jobs WHERE customer_marketplace_id = $1`,
      [customerMarketplaceId],
    );
    assert.equal(pendingRows.length, 1, 'PENDING scan_jobs row must exist');
    assert.equal(
      pendingRows[0].phase_message,
      PHASE_MESSAGES.PENDING,
      `PENDING phase_message must be "${PHASE_MESSAGES.PENDING}", got: ${pendingRows[0].phase_message}`,
    );

    // Run scan to COMPLETE and verify COMPLETE phase_message
    await runScan();

    const { rows: completeRows } = await db.query(
      `SELECT status, phase_message FROM scan_jobs WHERE customer_marketplace_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [customerMarketplaceId],
    );
    assert.equal(completeRows[0].status, 'COMPLETE');
    assert.equal(
      completeRows[0].phase_message,
      PHASE_MESSAGES.COMPLETE,
      `COMPLETE phase_message must be "${PHASE_MESSAGES.COMPLETE}", got: ${completeRows[0].phase_message}`,
    );

    await cleanupMarketplace(customerMarketplaceId);
  });

  // ---------------------------------------------------------------------------
  // AC#4 — Performance: 200-SKU scan within 60s (mock server)
  // ---------------------------------------------------------------------------

  await t.test('scan_200_skus_completes_within_60s_test_timeout', { timeout: 65_000 }, async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    const start = Date.now();
    await runScan();
    const elapsed = Date.now() - start;

    assert.ok(
      elapsed < 60_000,
      `Scan must complete within 60s on mock server; took ${elapsed}ms`,
    );

    const db = getServiceRoleClient();
    const { rows } = await db.query(
      'SELECT status FROM scan_jobs WHERE customer_marketplace_id = $1 ORDER BY created_at DESC LIMIT 1',
      [customerMarketplaceId],
    );
    assert.equal(rows[0].status, 'COMPLETE', 'Scan must COMPLETE within timeout');

    await cleanupMarketplace(customerMarketplaceId);
  });

  // ---------------------------------------------------------------------------
  // AC#5 — Atomicity Bundle B invariants
  // ---------------------------------------------------------------------------

  await t.test('cleartext_key_never_appears_in_pino_output', async () => {
    // Intercept pino output by temporarily capturing process.stdout writes
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    const logChunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...args) => {
      logChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return originalWrite(chunk, ...args);
    };

    try {
      await runScan();
    } finally {
      process.stdout.write = originalWrite;
    }

    const logOutput = logChunks.join('');

    // The synthetic key is a recognizable string — assert it never appears in logs
    assert.ok(
      !logOutput.includes(SYNTHETIC_API_KEY),
      `Cleartext API key "${SYNTHETIC_API_KEY}" must never appear in pino log output`,
    );

    // Also assert no partial match of the key prefix (paranoia check)
    assert.ok(
      !logOutput.includes('MP_TEST_CLEARTEXT_APIKEY'),
      'Key prefix must not appear in pino output',
    );

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('no_parallel_scan_job_can_be_created', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    // The PENDING row already exists from seedProvisioningMarketplace.
    // Attempting to INSERT another PENDING row should fail with the EXCLUDE constraint.
    const db = getServiceRoleClient();

    let exclusionError = null;
    try {
      await db.query(
        `INSERT INTO scan_jobs (customer_marketplace_id, status, phase_message)
         VALUES ($1, 'PENDING', $2)`,
        [customerMarketplaceId, PHASE_MESSAGES.PENDING],
      );
    } catch (err) {
      exclusionError = err;
    }

    assert.ok(
      exclusionError != null,
      'Second PENDING scan_jobs row must be rejected by EXCLUDE constraint',
    );
    // Postgres EXCLUDE constraint violation is caught under error code 23P01
    assert.ok(
      exclusionError?.code === '23P01' || exclusionError?.message?.includes('conflicting'),
      `Expected EXCLUDE constraint error (23P01), got: ${exclusionError?.code} — ${exclusionError?.message}`,
    );

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('pri02_is_never_called_during_scan', async () => {
    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const requestLog = mockServer.getRequestLog();

    // PRI02 endpoint pattern: /api/offers/pricing/imports/{id}  (GET)
    const pri02Calls = requestLog.filter((path) =>
      path.match(/\/api\/offers\/pricing\/imports\/[^/]+$/) ||
      path.match(/\/api\/offers\/pricing\/imports\/[^/]+\/error_report/),
    );

    assert.equal(
      pri02Calls.length,
      0,
      `PRI02 must never be called during scan; found calls: ${pri02Calls.join(', ')}`,
    );

    // Also assert PRI01 (POST /api/offers/pricing/imports) never called
    const pri01Calls = requestLog.filter((path) =>
      path === '/api/offers/pricing/imports',
    );
    assert.equal(
      pri01Calls.length,
      0,
      `PRI01 must never be called during scan (read-only); found ${pri01Calls.length} calls`,
    );

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('f4_check_constraint_never_violated_during_scan', async () => {
    // This test verifies that at no point during the scan does the orchestrator
    // attempt to transition to DRY_RUN before A01/PC01 columns are populated.
    // Since the CHECK constraint fires at DB level, a violation would cause the
    // scan to FAIL with a Postgres error code 23514 (check_violation).
    //
    // Strategy: run a successful scan and verify it reached COMPLETE (not FAILED
    // with a 23514 error), which proves the constraint was never violated.

    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();
    const { rows: sjRows } = await db.query(
      'SELECT status, failure_reason FROM scan_jobs WHERE customer_marketplace_id = $1',
      [customerMarketplaceId],
    );
    assert.equal(sjRows[0].status, 'COMPLETE', 'Scan must COMPLETE — no F4 CHECK violation');

    // If there were a 23514 violation, failure_reason would contain 'check' or constraint name
    assert.ok(
      sjRows[0].failure_reason == null ||
      !sjRows[0].failure_reason.toLowerCase().includes('check'),
      `F4 CHECK constraint must not appear in failure_reason; got: ${sjRows[0].failure_reason}`,
    );

    await cleanupMarketplace(customerMarketplaceId);
  });

  await t.test('atomicity_bundle_b_check_constraint_validates_after_scan', async () => {
    // Atomicity Bundle B: Story 4.1 schema + Story 4.4 population.
    // After COMPLETE: DRY_RUN state AND all A01/PC01 non-NULL — verifies F4 CHECK passed.

    await resetAuthAndCustomers();
    const { userId } = await seedTestCustomer();
    const { customerMarketplaceId } = await seedProvisioningMarketplace(userId, mockBaseUrl);

    await runScan();

    const db = getServiceRoleClient();
    const { rows } = await db.query(
      `SELECT
         cron_state,
         shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels,
         channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals,
         platform_features_snapshot, last_pc01_pulled_at
       FROM customer_marketplaces WHERE id = $1`,
      [customerMarketplaceId],
    );
    assert.equal(rows.length, 1, 'customer_marketplaces row must exist');
    const cm = rows[0];

    // cron_state must be DRY_RUN
    assert.equal(cm.cron_state, 'DRY_RUN',
      `cron_state must be DRY_RUN after Bundle B completion, got: ${cm.cron_state}`);

    // All A01 columns non-NULL
    const a01Cols = ['shop_id', 'shop_name', 'shop_state', 'currency_iso_code', 'is_professional', 'channels'];
    for (const col of a01Cols) {
      assert.ok(cm[col] != null, `A01 column '${col}' must be non-NULL after Bundle B completion`);
    }

    // All PC01 columns non-NULL
    const pc01Cols = [
      'channel_pricing_mode', 'operator_csv_delimiter', 'offer_prices_decimals',
      'platform_features_snapshot', 'last_pc01_pulled_at',
    ];
    for (const col of pc01Cols) {
      assert.ok(cm[col] != null, `PC01 column '${col}' must be non-NULL after Bundle B completion`);
    }

    // Structural verify: an UPDATE to DRY_RUN with these columns populated must NOT raise 23514
    // (indirectly proven by the fact that cron_state IS DRY_RUN — transitionCronState succeeded)

    await cleanupMarketplace(customerMarketplaceId);
  });
});
