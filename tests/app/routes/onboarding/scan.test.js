// Story 4.5 / AC#1-AC#5 — Scan progress page + /status endpoint unit tests.
//
// Covers (AC#6):
//   renders_scan_page_for_in_flight_scan     — PROVISIONING + in-flight scan_jobs → 200 HTML
//   redirects_to_key_if_no_cm_row           — No customer_marketplaces row → 302 /onboarding/key
//   redirects_to_key_if_no_scan_job         — PROVISIONING + no scan_jobs row → 302 /onboarding/key
//   redirects_to_scan_ready_if_complete     — PROVISIONING + COMPLETE → 302 /onboarding/scan-ready
//   redirects_to_scan_failed_if_failed      — PROVISIONING + FAILED → 302 /scan-failed
//   redirects_to_root_if_not_provisioning   — DRY_RUN cron_state → 302 /
//   status_endpoint_returns_correct_shape   — GET /onboarding/scan/status → JSON with 6 fields
//   status_endpoint_404_when_no_scan        — No scan_jobs row → 404 JSON
//   status_endpoint_rate_limit_enforced     — 6th request within 1s → 429
//   status_endpoint_rls_isolation           — Customer B cannot read Customer A's scan_jobs
//
// Test harness: Node built-in test runner (node --test).
// DB client (req.db) is mocked — no real Supabase instance required.
// Mock authMiddleware and rlsContext inject req.user + req.db.
//
// Run with: node --test tests/app/routes/onboarding/scan.test.js

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Helpers — mock DB factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal req.db mock whose query() method returns rows in sequence.
 * Each call to makeDb([...rowSets]) pops the next rowSet for each query call.
 *
 * @param {Array<Array<object>>} rowSets - ordered list of row arrays to return per query call
 * @returns {{ query: Function }}
 */
function makeDb (rowSets) {
  let callIndex = 0;
  return {
    async query (_sql, _params) {
      const rows = rowSets[callIndex] ?? [];
      callIndex += 1;
      return { rows };
    },
  };
}

/**
 * Build a Fastify test app with scanRoutes registered, injecting the provided
 * req.db mock and a fixed req.user for every request.
 *
 * authMiddleware and rlsContext are replaced by a preHandler that sets
 * req.user = { id: userId } and req.db = mockDb.
 * releaseRlsClient onResponse hook is replaced by a no-op.
 *
 * @param {{ db: object, userId?: string }} opts
 */
async function buildApp ({ db, userId = 'test-customer-uuid' } = {}) {
  const fastify = Fastify({ logger: false });

  // Inject auth + rls-context without the real middleware
  fastify.addHook('preHandler', async (req) => {
    req.user = { id: userId };
    req.db = db;
  });

  // Register rate-limit globally (opts-in per route via config.rateLimit)
  const FastifyRateLimit = (await import('@fastify/rate-limit')).default;
  await fastify.register(FastifyRateLimit, { global: false });

  // Register the route plugin under test
  const { scanRoutes } = await import('../../../../app/src/routes/onboarding/scan.js');
  await fastify.register(scanRoutes);

  await fastify.ready();
  return fastify;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const IN_FLIGHT_CM_ROW = { id: 'cm-uuid-1', cron_state: 'PROVISIONING' };
const IN_FLIGHT_SCAN_ROW = {
  id: 'sj-uuid-1',
  status: 'RUNNING_OF21',
  phase_message: 'A obter catálogo',
  skus_total: 12430,
  skus_processed: 3200,
  started_at: '2026-05-07T14:00:00Z',
  completed_at: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('scan-progress-page', async (t) => {
  // -------------------------------------------------------------------------
  // 1. renders_scan_page_for_in_flight_scan
  // -------------------------------------------------------------------------

  await t.test('renders_scan_page_for_in_flight_scan', async () => {
    // TODO (ATDD Step 2 — to be filled during story implementation):
    // Given: PROVISIONING customer_marketplaces row + in-flight scan_jobs row
    // When:  GET /onboarding/scan
    // Then:
    //   • HTTP 200
    //   • HTML contains all 5 phase checklist labels (UX-DR6):
    //       "A configurar integração com Worten"
    //       "A obter catálogo"
    //       "A classificar tiers iniciais"
    //       "A snapshotar baselines"
    //       "Pronto"
    //   • phase step 2 carries mp-phase--active (RUNNING_OF21 → activePhase 2)
    //   • shimmer bar element present (#scan-shimmer-bar)
    //   • <script src="/public/js/scan-progress.js" defer></script> in HTML
    const db = makeDb([
      [IN_FLIGHT_CM_ROW],   // query 1: customer_marketplaces
      [IN_FLIGHT_SCAN_ROW], // query 2: scan_jobs
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan' });
      assert.equal(res.statusCode, 200, 'expected 200 for in-flight scan');
      assert.ok(res.headers['content-type'].includes('text/html'), 'expected HTML response');
      assert.ok(res.body.includes('A configurar integração com Worten'), 'phase 1 label missing');
      assert.ok(res.body.includes('A obter catálogo'), 'phase 2 label missing');
      assert.ok(res.body.includes('A classificar tiers iniciais'), 'phase 3 label missing');
      assert.ok(res.body.includes('A snapshotar baselines'), 'phase 4 label missing');
      assert.ok(res.body.includes('Pronto'), 'phase 5 label missing');
      assert.ok(res.body.includes('scan-progress.js'), 'scan-progress.js script tag missing');
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 2. redirects_to_key_if_no_cm_row
  // -------------------------------------------------------------------------

  await t.test('redirects_to_key_if_no_cm_row', async () => {
    // TODO (ATDD Step 2):
    // Given: no customer_marketplaces row for this customer
    // When:  GET /onboarding/scan
    // Then:  302 → /onboarding/key
    const db = makeDb([
      [],  // query 1: customer_marketplaces → empty (no row)
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan' });
      assert.equal(res.statusCode, 302, 'expected 302 redirect');
      assert.equal(res.headers.location, '/onboarding/key', 'expected redirect to /onboarding/key');
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 3. redirects_to_key_if_no_scan_job
  // -------------------------------------------------------------------------

  await t.test('redirects_to_key_if_no_scan_job', async () => {
    // TODO (ATDD Step 2):
    // Given: PROVISIONING customer_marketplaces row but no scan_jobs row
    // When:  GET /onboarding/scan
    // Then:  302 → /onboarding/key (key never fully validated / scan not started)
    const db = makeDb([
      [IN_FLIGHT_CM_ROW], // query 1: customer_marketplaces → PROVISIONING
      [],                 // query 2: scan_jobs → empty
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan' });
      assert.equal(res.statusCode, 302, 'expected 302 redirect');
      assert.equal(res.headers.location, '/onboarding/key', 'expected redirect to /onboarding/key');
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 4. redirects_to_scan_ready_if_complete
  // -------------------------------------------------------------------------

  await t.test('redirects_to_scan_ready_if_complete', async () => {
    // TODO (ATDD Step 2):
    // Given: PROVISIONING + scan_jobs.status = 'COMPLETE'
    // When:  GET /onboarding/scan
    // Then:  302 → /onboarding/scan-ready
    const db = makeDb([
      [IN_FLIGHT_CM_ROW],
      [{ ...IN_FLIGHT_SCAN_ROW, status: 'COMPLETE', completed_at: '2026-05-07T15:00:00Z' }],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan' });
      assert.equal(res.statusCode, 302, 'expected 302 redirect');
      assert.equal(res.headers.location, '/onboarding/scan-ready', 'expected redirect to /onboarding/scan-ready');
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 5. redirects_to_scan_failed_if_failed
  // -------------------------------------------------------------------------

  await t.test('redirects_to_scan_failed_if_failed', async () => {
    // TODO (ATDD Step 2):
    // Given: PROVISIONING + scan_jobs.status = 'FAILED'
    // When:  GET /onboarding/scan
    // Then:  302 → /scan-failed
    const db = makeDb([
      [IN_FLIGHT_CM_ROW],
      [{ ...IN_FLIGHT_SCAN_ROW, status: 'FAILED', completed_at: '2026-05-07T14:30:00Z' }],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan' });
      assert.equal(res.statusCode, 302, 'expected 302 redirect');
      assert.equal(res.headers.location, '/scan-failed', 'expected redirect to /scan-failed');
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 6. redirects_to_root_if_not_provisioning
  // -------------------------------------------------------------------------

  await t.test('redirects_to_root_if_not_provisioning', async () => {
    // TODO (ATDD Step 2):
    // Given: customer_marketplaces.cron_state = 'DRY_RUN' (past PROVISIONING)
    // When:  GET /onboarding/scan
    // Then:  302 → / (UX-DR2 forward-only guard)
    const db = makeDb([
      [{ id: 'cm-uuid-1', cron_state: 'DRY_RUN' }],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan' });
      assert.equal(res.statusCode, 302, 'expected 302 redirect');
      assert.equal(res.headers.location, '/', 'expected redirect to / for non-PROVISIONING state');
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 7. status_endpoint_returns_correct_shape
  // -------------------------------------------------------------------------

  await t.test('status_endpoint_returns_correct_shape', async () => {
    // TODO (ATDD Step 2):
    // Given: authenticated customer with in-flight scan
    // When:  GET /onboarding/scan/status
    // Then:  200 JSON with all 6 required fields:
    //        { status, phase_message, skus_total, skus_processed, started_at, completed_at }
    const db = makeDb([
      [IN_FLIGHT_CM_ROW],   // query 1: customer_marketplaces (for cmId)
      [IN_FLIGHT_SCAN_ROW], // query 2: scan_jobs
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan/status' });
      assert.equal(res.statusCode, 200, 'expected 200');
      assert.ok(res.headers['content-type'].includes('application/json'), 'expected JSON response');
      const body = JSON.parse(res.body);
      assert.ok('status' in body, 'status field missing');
      assert.ok('phase_message' in body, 'phase_message field missing');
      assert.ok('skus_total' in body, 'skus_total field missing');
      assert.ok('skus_processed' in body, 'skus_processed field missing');
      assert.ok('started_at' in body, 'started_at field missing');
      assert.ok('completed_at' in body, 'completed_at field missing');
      assert.equal(body.status, IN_FLIGHT_SCAN_ROW.status, 'status value mismatch');
      assert.equal(body.phase_message, IN_FLIGHT_SCAN_ROW.phase_message, 'phase_message value mismatch');
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 8. status_endpoint_404_when_no_scan
  // -------------------------------------------------------------------------

  await t.test('status_endpoint_404_when_no_scan', async () => {
    // TODO (ATDD Step 2):
    // Given: authenticated customer with no scan_jobs row (PROVISIONING but scan not started)
    // When:  GET /onboarding/scan/status
    // Then:  404 JSON { "error": "Nenhuma análise encontrada." }
    const db = makeDb([
      [IN_FLIGHT_CM_ROW], // query 1: customer_marketplaces (cmId found)
      [],                 // query 2: scan_jobs → empty
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan/status' });
      assert.equal(res.statusCode, 404, 'expected 404');
      const body = JSON.parse(res.body);
      assert.ok('error' in body, 'error field missing from 404 response');
      assert.equal(body.error, 'Nenhuma análise encontrada.', 'error message mismatch');
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 9. status_endpoint_rate_limit_enforced
  // -------------------------------------------------------------------------

  await t.test('status_endpoint_rate_limit_enforced', async () => {
    // TODO (ATDD Step 2):
    // Given: same authenticated customer fires 6 requests within 1 second
    // When:  GET /onboarding/scan/status × 6 (Promise.all)
    // Then:  at least one response is 429
    // Note:  rate-limit is 5 req/sec per customer (config.rateLimit on the /status route)
    //
    // For unit tests, use `app.inject` in parallel — fastify-rate-limit counts calls
    // even in inject mode when registered with global: false + per-route config.rateLimit.

    // Build a db mock that can handle up to 12 queries (6 × 2 queries per request)
    const rowSets = [];
    for (let i = 0; i < 6; i++) {
      rowSets.push([IN_FLIGHT_CM_ROW]);
      rowSets.push([IN_FLIGHT_SCAN_ROW]);
    }
    const db = makeDb(rowSets);
    const app = await buildApp({ db });
    try {
      const requests = Array.from({ length: 6 }, () =>
        app.inject({ method: 'GET', url: '/onboarding/scan/status' }),
      );
      const results = await Promise.all(requests);
      const statuses = results.map((r) => r.statusCode);
      assert.ok(
        statuses.includes(429),
        `expected at least one 429, got: [${statuses.join(', ')}]`,
      );
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 10. status_endpoint_rls_isolation
  // -------------------------------------------------------------------------

  await t.test('status_endpoint_rls_isolation', async () => {
    // TODO (ATDD Step 2):
    // Given: Customer A has an in-flight scan_jobs row
    //        Customer B sends GET /onboarding/scan/status with their own session
    // Then:  Customer B receives 404 (their scan_jobs query returns empty — RLS enforces isolation)
    //
    // RLS isolation is guaranteed by using the RLS-aware req.db client (set by rlsContext).
    // In unit tests: the mock db for Customer B simply returns no scan_jobs rows,
    // simulating what RLS would return when Customer B queries for their own (non-existent) scan.
    //
    // The critical invariant: the status route queries scan_jobs via customer_marketplace_id
    // (joined from customer_marketplaces WHERE customer_id = req.user.id), so Customer B
    // can never access Customer A's rows even without explicit RLS — the query is scoped.

    const dbForCustomerB = makeDb([
      [], // query 1: customer_marketplaces → no row for Customer B
    ]);

    const app = await buildApp({ db: dbForCustomerB, userId: 'customer-b-uuid' });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan/status' });
      assert.equal(res.statusCode, 404, 'Customer B should receive 404, not Customer A\'s scan data');
      const body = JSON.parse(res.body);
      assert.ok('error' in body, 'error field missing from 404 response');
    } finally {
      await app.close();
    }
  });
});
