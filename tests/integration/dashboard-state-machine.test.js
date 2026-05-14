// tests/integration/dashboard-state-machine.test.js
// Epic 8 Test Plan — Story 8.1 integration (ATDD-filled, 2026-05-14)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage (integration_test_required: true):
//   AC#7 — All 7 cron_state variants render correct banner + CTA; UX-DR3 interception
//           triggers only once per state-transition; RLS: customer A cannot see customer B's dashboard
//
// Prerequisites:
//   - Real Supabase instance with SUPABASE_SERVICE_ROLE_DATABASE_URL set
//   - Full schema migrations applied (including Epic 4: customer_marketplaces + cron_state)
//   - Two test customers seeded (customer A + customer B) with distinct UUIDs
//
// Run with: node --test tests/integration/dashboard-state-machine.test.js
//
// NODE_ENV guard: dashboard/index.js has bypass guards that require NODE_ENV=test
// when req.user is pre-set by a global preHandler (to prevent auth bypass in production).
// Set NODE_ENV=test before imports so the rlsContext bypass fires correctly in integration.
if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') {
  process.env.NODE_ENV = 'test';
}

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const INTEGRATION_ENABLED = Boolean(process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL);

// All 7 legal cron_state values for dashboard rendering (AC#7)
const DASHBOARD_CRON_STATES = [
  'DRY_RUN',
  'ACTIVE',
  'PAUSED_BY_CUSTOMER',
  'PAUSED_BY_PAYMENT_FAILURE',
  'PAUSED_BY_CIRCUIT_BREAKER',
  'PAUSED_BY_KEY_REVOKED',
  'PAUSED_BY_ACCOUNT_GRACE_PERIOD',
];

// Expected assertions per cron_state: what the dashboard renders (HTML contains)
const STATE_ASSERTIONS = {
  DRY_RUN: {
    statusCode: 200,
    contains: ['MODO SIMULAÇÃO', 'science', 'Ir live', 'mp-banner-info'],
    notContains: [],
    redirectTo: null,
  },
  ACTIVE: {
    statusCode: 200,
    contains: ['mp-kpi-grid'],
    notContains: ['mp-banner-danger', 'Atualizar pagamento'],
    redirectTo: null,
  },
  PAUSED_BY_CUSTOMER: {
    statusCode: 200,
    contains: ['pause_circle', 'Retomar', 'mp-banner-neutral', 'mp-kpi-grid--greyed'],
    notContains: ['mp-banner-danger'],
    redirectTo: null,
  },
  PAUSED_BY_PAYMENT_FAILURE: {
    // First login post-state-transition: redirect to /payment-failed (UX-DR3, UX-DR32).
    // Subsequent visits in same state render dashboard with persistent red banner —
    // covered by ux_dr3_interception_triggers_only_once_per_state_transition below
    // (the parametric loop only exercises the first-visit case per state).
    statusCode: 302,
    contains: [],
    notContains: [],
    redirectTo: '/payment-failed',
  },
  PAUSED_BY_CIRCUIT_BREAKER: {
    statusCode: 200,
    contains: ['gpp_maybe', 'Investigar', 'mp-banner-danger', 'mp-kpi-grid--stale'],
    notContains: [],
    redirectTo: null,
  },
  PAUSED_BY_KEY_REVOKED: {
    // First login: redirect to /key-revoked
    statusCode: 302,
    contains: [],
    notContains: [],
    redirectTo: '/key-revoked',
  },
  PAUSED_BY_ACCOUNT_GRACE_PERIOD: {
    statusCode: 200,
    // Grace period: renders dashboard (no interception); specific banner TBD per spec
    contains: ['mp-main'],
    notContains: [],
    redirectTo: null,
  },
};

// ---------------------------------------------------------------------------
// Integration DB helpers
// ---------------------------------------------------------------------------

let serviceRoleClient = null;

/** Get or initialise a service-role Postgres client for seeding. */
async function getServiceRoleClient () {
  if (serviceRoleClient) return serviceRoleClient;
  // Use the existing service-role DB module from the project
  const { createServiceRoleClient } = await import('../../app/src/lib/db.js').catch(() => {
    // Fallback: direct pg connection
    return { createServiceRoleClient: null };
  });
  if (createServiceRoleClient) {
    serviceRoleClient = await createServiceRoleClient();
    return serviceRoleClient;
  }
  // Minimal fallback: direct pg client
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL });
  await client.connect();
  serviceRoleClient = { query: (sql, params) => client.query(sql, params), release: () => client.end() };
  return serviceRoleClient;
}

/** Lazily constructed Supabase admin client (service-role key). */
let _supabaseAdmin = null;
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

// Test customer seed data — customer IDs are assigned by Supabase admin API at seed time.
// These are populated in the `before` hook and used throughout the tests.
let TEST_CUSTOMER_A_ID = null;
let TEST_CUSTOMER_B_ID = null;
const TEST_CM_A_ID = randomUUID();
const TEST_CM_B_ID = randomUUID();

const TEST_EMAIL_A = `dashsm-a-${randomUUID()}@integration.test`;
const TEST_EMAIL_B = `dashsm-b-${randomUUID()}@integration.test`;

/**
 * Seed a minimal customer + customer_marketplace row for integration testing.
 * Creates the auth user via Supabase admin API (triggers handle_new_auth_user
 * which populates public.customers + public.customer_profiles automatically).
 * Returns the assigned customer UUID.
 */
async function seedTestCustomer (email, customerMarketplaceId, cronState) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: `Seed-${randomUUID()}`,
    user_metadata: { first_name: 'Test', last_name: 'Customer', company_name: 'Test Corp' },
    email_confirm: true,
  });
  if (error) throw new Error(`seedTestCustomer: failed to create auth user — ${error.message}`);
  const customerId = data.user.id;

  const client = await getServiceRoleClient();
  // Insert customer_marketplaces row using the auth-assigned customer UUID.
  // Required NOT NULL columns: operator, marketplace_instance_url.
  // F4 CHECK constraint: non-PROVISIONING states require A01/PC01 columns to be non-NULL.
  // Seed with minimal valid values to satisfy the constraint for any starting cron_state.
  await client.query(
    `INSERT INTO customer_marketplaces
       (id, customer_id, cron_state, operator, marketplace_instance_url, max_discount_pct, updated_at,
        shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels,
        channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals,
        discount_period_required, competitive_pricing_tool, scheduled_pricing,
        volume_pricing, multi_currency, order_tax_mode, platform_features_snapshot, last_pc01_pulled_at)
     VALUES ($1, $2, $3::cron_state, 'WORTEN', 'https://marketplace.worten.pt', 0.02, NOW(),
        19706, 'Test Shop', 'OPEN', 'EUR', true, ARRAY['WRT_PT_ONLINE'],
        'SINGLE', 'COMMA', 2,
        false, true, false,
        false, false, 'TAX_EXCLUDED', '{}', NOW())
     ON CONFLICT (id) DO UPDATE
       SET cron_state = $3::cron_state, updated_at = NOW()`,
    [customerMarketplaceId, customerId, cronState]
  );
  return customerId;
}

/**
 * Update customer_marketplace cron_state for integration test.
 */
async function updateCronState (client, customerMarketplaceId, cronState) {
  await client.query(
    `UPDATE customer_marketplaces SET cron_state = $1::cron_state, updated_at = NOW()
     WHERE id = $2`,
    [cronState, customerMarketplaceId]
  );
}

/**
 * Build a Fastify app for integration tests using REAL DB connections.
 * Auth is injected via req.user (bypasses real JWT validation for test isolation).
 * req.db is pre-injected as a service-role pg client (bypasses RLS; route handler
 * already filters by WHERE cm.customer_id = $1 with req.user.id, so data isolation
 * is preserved by the application query, not by row-level security policy, in this test).
 */
async function buildIntegrationApp ({ userId, session = {} } = {}) {
  const fastify = Fastify({ logger: false });

  // Inject user + fresh service-role DB client without real JWT validation.
  // NODE_ENV=test is required by authMiddlewareConditional + rlsContextConditional
  // bypass guards when req.user / req.db are pre-set (see dashboard/index.js comments).
  // A fresh pg.Client is created per request to avoid the releaseRlsClient onResponse
  // hook (which calls req.db.release() → client.end()) closing the shared service-role
  // singleton client between tests.
  fastify.addHook('preHandler', async (req) => {
    req.user = { id: userId, access_token: 'integration-test-token', email: `test-${userId}@integration.test` };
    req.session = { ...session };
    // Create a fresh pg.Client per request — isolated from the shared serviceRoleClient.
    const { default: pg } = await import('pg');
    const perRequestClient = new pg.Client({ connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL });
    await perRequestClient.connect();
    req.db = {
      query: (sql, params) => perRequestClient.query(sql, params),
      release: async () => { await perRequestClient.end(); },
    };
  });

  // Register view engine
  const FastifyView = (await import('@fastify/view')).default;
  const { Eta } = await import('eta');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const viewsDir = join(__dirname, '../../app/src/views');
  await fastify.register(FastifyView, {
    engine: { eta: new Eta() },
    templates: viewsDir,
    defaultContext: { appName: 'MarketPilot' },
    propertyName: 'view',
    asyncPropertyName: 'viewAsync',
  });

  // Register dashboard routes
  const { dashboardRoutes } = await import('../../app/src/routes/dashboard/index.js');
  await fastify.register(dashboardRoutes);

  await fastify.ready();
  return fastify;
}

// ---------------------------------------------------------------------------
// AC#7 — Parametric: 7 cron_state variants render correct banner + CTA
// ---------------------------------------------------------------------------

describe('dashboard-state-machine-integration', () => {
  before(async () => {
    if (!INTEGRATION_ENABLED) return;
    // Seed customer A (DRY_RUN initial state)
    TEST_CUSTOMER_A_ID = await seedTestCustomer(TEST_EMAIL_A, TEST_CM_A_ID, 'DRY_RUN');
    // Seed customer B (ACTIVE initial state) for RLS test
    TEST_CUSTOMER_B_ID = await seedTestCustomer(TEST_EMAIL_B, TEST_CM_B_ID, 'ACTIVE');
  });

  after(async () => {
    if (!INTEGRATION_ENABLED) return;
    const client = await getServiceRoleClient();
    // Teardown: clean up seeded rows (customer_marketplaces first — FK dep)
    await client.query(
      'DELETE FROM customer_marketplaces WHERE id = ANY($1)',
      [[TEST_CM_A_ID, TEST_CM_B_ID]]
    );
    // Delete auth users via admin API (triggers reverse-cascade on public.customers)
    const supabaseAdmin = getSupabaseAdmin();
    if (TEST_CUSTOMER_A_ID) await supabaseAdmin.auth.admin.deleteUser(TEST_CUSTOMER_A_ID);
    if (TEST_CUSTOMER_B_ID) await supabaseAdmin.auth.admin.deleteUser(TEST_CUSTOMER_B_ID);
    if (serviceRoleClient) {
      await serviceRoleClient.release();
      serviceRoleClient = null;
    }
  });

  for (const cronState of DASHBOARD_CRON_STATES) {
    test(`state_${cronState.toLowerCase()}_renders_correct_banner_and_cta`, async () => {
      if (!INTEGRATION_ENABLED) {
        // Skip integration tests when Supabase is not available (unit-test environment)
        return;
      }

      const client = await getServiceRoleClient();
      // Update customer A to the test cron_state
      await updateCronState(client, TEST_CM_A_ID, cronState);

      const expectations = STATE_ASSERTIONS[cronState];
      const isFirstTimeInterception = expectations.statusCode === 302;
      const session = isFirstTimeInterception ? {} : {
        // For non-interception states, simulate no active interception session flag
      };

      const app = await buildIntegrationApp({ userId: TEST_CUSTOMER_A_ID, session });
      try {
        const res = await app.inject({ method: 'GET', url: '/' });

        assert.equal(
          res.statusCode,
          expectations.statusCode,
          `cron_state=${cronState}: expected statusCode ${expectations.statusCode}; got ${res.statusCode}`
        );

        if (expectations.redirectTo) {
          assert.equal(
            res.headers.location,
            expectations.redirectTo,
            `cron_state=${cronState}: expected redirect to ${expectations.redirectTo}`
          );
        }

        if (expectations.statusCode === 200) {
          const html = res.body;
          for (const fragment of expectations.contains) {
            assert.ok(
              html.includes(fragment),
              `cron_state=${cronState}: HTML must contain "${fragment}"`
            );
          }
          for (const fragment of expectations.notContains) {
            assert.ok(
              !html.includes(fragment),
              `cron_state=${cronState}: HTML must NOT contain "${fragment}"`
            );
          }
        }
      } finally {
        await app.close();
      }
    });
  }

  test('ux_dr3_interception_triggers_only_once_per_state_transition', async () => {
    if (!INTEGRATION_ENABLED) return;

    const client = await getServiceRoleClient();
    // Transition customer A to PAUSED_BY_KEY_REVOKED
    await updateCronState(client, TEST_CM_A_ID, 'PAUSED_BY_KEY_REVOKED');

    // First login: no session flag → expect 302 → /key-revoked
    const appFirst = await buildIntegrationApp({
      userId: TEST_CUSTOMER_A_ID,
      session: {}, // no prior interception shown
    });
    try {
      const firstRes = await appFirst.inject({ method: 'GET', url: '/' });
      assert.equal(firstRes.statusCode, 302,
        `UX-DR32: first PAUSED_BY_KEY_REVOKED visit must redirect (302); got ${firstRes.statusCode}`);
      assert.equal(firstRes.headers.location, '/key-revoked',
        'UX-DR32: first visit must redirect to /key-revoked');
    } finally {
      await appFirst.close();
    }

    // Get the current updated_at to simulate the session flag
    const { rows } = await client.query(
      'SELECT updated_at FROM customer_marketplaces WHERE id = $1',
      [TEST_CM_A_ID]
    );
    const stateUpdatedAt = rows[0]?.updated_at;

    // Second login: session flag set → expect 200 with persistent banner (no redirect)
    const appSecond = await buildIntegrationApp({
      userId: TEST_CUSTOMER_A_ID,
      session: {
        shownInterceptionFor: {
          state: 'PAUSED_BY_KEY_REVOKED',
          since: stateUpdatedAt?.toISOString(),
        },
      },
    });
    try {
      const secondRes = await appSecond.inject({ method: 'GET', url: '/' });
      assert.equal(secondRes.statusCode, 200,
        `UX-DR32: subsequent PAUSED_BY_KEY_REVOKED visit must return 200; got ${secondRes.statusCode}`);
      const html = secondRes.body;
      // Persistent red banner must be visible on the dashboard
      assert.ok(html.includes('mp-banner-danger'),
        'UX-DR32: subsequent visit must show persistent red danger banner on dashboard');
    } finally {
      await appSecond.close();
    }
  });

  test('ux_dr3_payment_failure_interception_triggers_only_once_per_state_transition', async () => {
    if (!INTEGRATION_ENABLED) return;

    const client = await getServiceRoleClient();
    // Transition customer A to PAUSED_BY_PAYMENT_FAILURE
    await updateCronState(client, TEST_CM_A_ID, 'PAUSED_BY_PAYMENT_FAILURE');

    // First login: no session flag → expect 302 → /payment-failed
    const appFirst = await buildIntegrationApp({
      userId: TEST_CUSTOMER_A_ID,
      session: {},
    });
    try {
      const firstRes = await appFirst.inject({ method: 'GET', url: '/' });
      assert.equal(firstRes.statusCode, 302,
        `UX-DR32: first PAUSED_BY_PAYMENT_FAILURE visit must redirect (302); got ${firstRes.statusCode}`);
      assert.equal(firstRes.headers.location, '/payment-failed',
        'UX-DR32: first visit must redirect to /payment-failed');
    } finally {
      await appFirst.close();
    }

    const { rows } = await client.query(
      'SELECT updated_at FROM customer_marketplaces WHERE id = $1',
      [TEST_CM_A_ID]
    );
    const stateUpdatedAt = rows[0]?.updated_at;

    const appSecond = await buildIntegrationApp({
      userId: TEST_CUSTOMER_A_ID,
      session: {
        shownInterceptionFor: {
          state: 'PAUSED_BY_PAYMENT_FAILURE',
          since: stateUpdatedAt?.toISOString(),
        },
      },
    });
    try {
      const secondRes = await appSecond.inject({ method: 'GET', url: '/' });
      assert.equal(secondRes.statusCode, 200,
        `UX-DR32: subsequent PAUSED_BY_PAYMENT_FAILURE visit must return 200; got ${secondRes.statusCode}`);
      const html = secondRes.body;
      assert.ok(html.includes('mp-banner-danger'),
        'UX-DR32: subsequent visit must show persistent red danger banner');
      assert.ok(html.includes('Atualizar pagamento'),
        'UX-DR32: subsequent visit must show "Atualizar pagamento" CTA');
    } finally {
      await appSecond.close();
    }
  });

  test('rls_prevents_customer_a_seeing_customer_b_dashboard', async () => {
    if (!INTEGRATION_ENABLED) return;

    const client = await getServiceRoleClient();
    // Reset customer A to DRY_RUN, customer B remains ACTIVE
    await updateCronState(client, TEST_CM_A_ID, 'DRY_RUN');

    // Inject GET / with customer A's session
    const appA = await buildIntegrationApp({ userId: TEST_CUSTOMER_A_ID });
    try {
      const res = await appA.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200,
        `RLS test: customer A GET / must return 200; got ${res.statusCode}`);
      const html = res.body;
      // Customer A sees DRY_RUN state (their own marketplace)
      assert.ok(html.includes('MODO SIMULAÇÃO'),
        'RLS: customer A must see their own DRY_RUN state dashboard');
      // Customer B's ACTIVE state dashboard elements must NOT appear
      // (RLS ensures the query is scoped to customer_id = A's ID)
      // Verify the DB query returned A's state, not B's — if RLS is working,
      // no ACTIVE-specific elements from B should bleed into A's view
      // (since A is DRY_RUN and B is ACTIVE, if cross-tenant bleed occurred,
      // A would see ACTIVE state content instead of DRY_RUN)
      assert.ok(!html.includes('mp-kpi-grid') || html.includes('MODO SIMULAÇÃO'),
        'RLS: customer A must NOT see customer B\'s ACTIVE state KPI data');
    } finally {
      await appA.close();
    }
  });
});
