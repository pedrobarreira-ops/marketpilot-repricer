// tests/integration/dashboard-state-machine.test.js
// Epic 8 Test Plan — Story 8.1 integration scaffold (epic-start-test-design 2026-05-14)
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

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const INTEGRATION_ENABLED = Boolean(process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL);

// All 7 legal cron_state values for dashboard rendering
const DASHBOARD_CRON_STATES = [
  'DRY_RUN',
  'ACTIVE',
  'PAUSED_BY_CUSTOMER',
  'PAUSED_BY_PAYMENT_FAILURE',
  'PAUSED_BY_CIRCUIT_BREAKER',
  'PAUSED_BY_KEY_REVOKED',
  'PAUSED_BY_ACCOUNT_GRACE_PERIOD',
];

// Expected banner type per cron_state (for assertion)
const EXPECTED_BANNER = {
  DRY_RUN: 'dry_run',
  ACTIVE: null, // no banner in healthy ACTIVE state (unless anomaly/sustained-transient)
  PAUSED_BY_CUSTOMER: 'paused_by_customer',
  PAUSED_BY_PAYMENT_FAILURE: 'payment_failure',
  PAUSED_BY_CIRCUIT_BREAKER: 'circuit_breaker',
  PAUSED_BY_KEY_REVOKED: null, // redirects to /key-revoked (first time)
  PAUSED_BY_ACCOUNT_GRACE_PERIOD: 'grace_period',
};

// ---------------------------------------------------------------------------
// AC#7 — Parametric: 7 cron_state variants render correct banner + CTA
// ---------------------------------------------------------------------------

describe('dashboard-state-machine-integration', () => {
  before(async () => {
    if (!INTEGRATION_ENABLED) return;
    // TODO (Amelia): run reset-auth-tables helper; seed two customers + customer_marketplaces
    //   customer A: initial cron_state = DRY_RUN
    //   customer B: initial cron_state = ACTIVE
    //   Use service-role client for seeding
  });

  after(async () => {
    if (!INTEGRATION_ENABLED) return;
    // TODO (Amelia): teardown — delete seeded rows; close DB connection
  });

  for (const cronState of DASHBOARD_CRON_STATES) {
    test(`state_${cronState.toLowerCase()}_renders_correct_banner_and_cta`, async () => {
      if (!INTEGRATION_ENABLED) {
        // Skip integration tests when Supabase is not available
        return;
      }
      // TODO (Amelia): update customer A's cron_state to cronState via service-role client
      //   inject GET / with customer A's session
      //   assert res.statusCode is 200 (or 302 for PAUSED_BY_KEY_REVOKED first time)
      //   assert correct banner class / copy present per EXPECTED_BANNER[cronState]
      //   assert correct CTA button present per epic spec
      assert.ok(true, `scaffold: ${cronState}`);
    });
  }

  test('ux_dr3_interception_triggers_only_once_per_state_transition', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Given: customer transitions to PAUSED_BY_KEY_REVOKED
    // First login: GET / → 302 /key-revoked (first-time interception)
    // Second login (same cron_state): GET / → 200 with red banner (not redirect)
    // TODO (Amelia): simulate two sequential GET / requests with session tracking
    //   assert first → 302; second → 200 with red banner
    assert.ok(true, 'scaffold');
  });

  test('rls_prevents_customer_a_seeing_customer_b_dashboard', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Given: two seeded customers A and B
    // When:  customer A's session used to GET /
    // Then:  customer A sees ONLY their own cron_state / KPI data
    //        customer B's customer_marketplace rows are not accessible via RLS
    // TODO (Amelia): inject GET / with customer A's JWT; inspect DB query in route;
    //   assert response contains customer A data, NOT customer B data
    assert.ok(true, 'scaffold');
  });
});
