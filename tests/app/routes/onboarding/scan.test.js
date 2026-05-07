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
// authMiddleware and rlsContext skip when req.user / req.db are already set
// (the route plugin checks this before calling the real middleware), so the
// global preHandler in buildApp() is sufficient to inject auth context.
//
// Run with: node --test tests/app/routes/onboarding/scan.test.js

import { test } from 'node:test';
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
 * authMiddleware and rlsContext are bypassed by the route plugin itself:
 * scan.js checks whether req.user / req.db are already set before calling the
 * real middleware, so setting them in a global preHandler is sufficient.
 * releaseRlsClient onResponse hook is a no-op when req.db was externally set.
 *
 * @param {{ db: object, userId?: string }} opts
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildApp ({ db, userId = 'test-customer-uuid' } = {}) {
  const fastify = Fastify({ logger: false });

  // Inject auth + rls-context without the real middleware.
  // Global preHandler runs before any plugin-scoped hooks.
  fastify.addHook('preHandler', async (req) => {
    req.user = { id: userId };
    req.db = db;
  });

  // Register rate-limit globally (opts-in per route via config.rateLimit)
  const FastifyRateLimit = (await import('@fastify/rate-limit')).default;
  await fastify.register(FastifyRateLimit, { global: false });

  // Register view engine so reply.view() works in unit tests
  const FastifyView = (await import('@fastify/view')).default;
  const { Eta } = await import('eta');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // views directory: tests/app/routes/onboarding/ → ../../../../app/src/views
  const viewsDir = join(__dirname, '../../../../app/src/views');
  await fastify.register(FastifyView, {
    engine: { eta: new Eta() },
    templates: viewsDir,
    defaultContext: { appName: 'MarketPilot' },
    propertyName: 'view',
    asyncPropertyName: 'viewAsync',
  });

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
    // Given: PROVISIONING customer_marketplaces row + in-flight scan_jobs row (RUNNING_OF21)
    // When:  GET /onboarding/scan
    // Then:  200 HTML with 5 UX-DR6 phase labels, phase 2 active, shimmer bar,
    //        script tag, and phase_message rendered into the live region.
    const db = makeDb([
      [IN_FLIGHT_CM_ROW],   // query 1: customer_marketplaces
      [IN_FLIGHT_SCAN_ROW], // query 2: scan_jobs
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan' });
      assert.equal(res.statusCode, 200, 'expected 200 for in-flight scan');
      assert.ok(res.headers['content-type'].includes('text/html'), 'expected HTML response');
      // 5 UX-DR6 phase labels (AC#1)
      assert.ok(res.body.includes('A configurar integração com Worten'), 'phase 1 label missing');
      assert.ok(res.body.includes('A obter catálogo'), 'phase 2 label missing');
      assert.ok(res.body.includes('A classificar tiers iniciais'), 'phase 3 label missing');
      assert.ok(res.body.includes('A snapshotar baselines'), 'phase 4 label missing');
      assert.ok(res.body.includes('Pronto'), 'phase 5 label missing');
      // RUNNING_OF21 → activePhase 2: phase 2 carries mp-phase--active, phase 1 done, phases 3+ pending.
      // The eta template emits class= and data-phase= on separate lines (see template), so use /s flag.
      assert.match(
        res.body,
        /class="[^"]*mp-phase--active[^"]*"\s+data-phase="2"/s,
        'phase 2 should have mp-phase--active class for RUNNING_OF21',
      );
      assert.match(
        res.body,
        /class="[^"]*mp-phase--done[^"]*"\s+data-phase="1"/s,
        'phase 1 should have mp-phase--done class when activePhase=2',
      );
      assert.match(
        res.body,
        /class="[^"]*mp-phase--pending[^"]*"\s+data-phase="3"/s,
        'phase 3 should have mp-phase--pending class when activePhase=2',
      );
      // DOM hooks the JS poller relies on (AC#2)
      assert.ok(res.body.includes('id="scan-shimmer-bar"'), 'shimmer bar element missing');
      assert.ok(res.body.includes('id="scan-phase-message"'), 'phase message element missing');
      assert.ok(res.body.includes('id="scan-phase-list"'), 'phase list element missing');
      assert.ok(res.body.includes('id="scan-skus-processed"'), 'skus-processed element missing');
      assert.ok(res.body.includes('id="scan-skus-total"'), 'skus-total element missing');
      // phase_message from DB rendered into the page (AC#1)
      assert.ok(res.body.includes(IN_FLIGHT_SCAN_ROW.phase_message), 'phase_message missing from page');
      // Script tag with defer (F9 pattern)
      assert.match(
        res.body,
        /<script[^>]*src="\/public\/js\/scan-progress\.js"[^>]*defer/,
        'scan-progress.js script tag (with defer) missing',
      );
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 2. redirects_to_key_if_no_cm_row
  // -------------------------------------------------------------------------

  await t.test('redirects_to_key_if_no_cm_row', async () => {
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
      assert.equal(body.skus_total, IN_FLIGHT_SCAN_ROW.skus_total, 'skus_total value mismatch');
      assert.equal(body.skus_processed, IN_FLIGHT_SCAN_ROW.skus_processed, 'skus_processed value mismatch');
      assert.equal(body.started_at, IN_FLIGHT_SCAN_ROW.started_at, 'started_at value mismatch');
      assert.equal(body.completed_at, IN_FLIGHT_SCAN_ROW.completed_at, 'completed_at value mismatch');
    } finally {
      await app.close();
    }
  });

  // -------------------------------------------------------------------------
  // 8. status_endpoint_404_when_no_scan
  // -------------------------------------------------------------------------

  await t.test('status_endpoint_404_when_no_scan', async () => {
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

  // -------------------------------------------------------------------------
  // 11. phase_map_coverage — every status maps to the correct phase number
  //     (regression guard against PHASE_MAP drift between server + client).
  //     AC#1 specifies the exact mapping; the page renders mp-phase--active
  //     on data-phase="N" where N is PHASE_MAP[status].
  // -------------------------------------------------------------------------

  await t.test('renders_correct_active_phase_for_each_status', async () => {
    const cases = [
      { status: 'PENDING', expectedPhase: 1 },
      { status: 'RUNNING_A01', expectedPhase: 1 },
      { status: 'RUNNING_PC01', expectedPhase: 1 },
      { status: 'RUNNING_OF21', expectedPhase: 2 },
      { status: 'RUNNING_P11', expectedPhase: 3 },
      { status: 'CLASSIFYING_TIERS', expectedPhase: 3 },
      { status: 'SNAPSHOTTING_BASELINE', expectedPhase: 4 },
    ];
    for (const { status, expectedPhase } of cases) {
      const db = makeDb([
        [IN_FLIGHT_CM_ROW],
        [{ ...IN_FLIGHT_SCAN_ROW, status }],
      ]);
      const app = await buildApp({ db });
      try {
        const res = await app.inject({ method: 'GET', url: '/onboarding/scan' });
        assert.equal(res.statusCode, 200, `expected 200 for status=${status}`);
        const activeRe = new RegExp(
          `class="[^"]*mp-phase--active[^"]*"\\s+data-phase="${expectedPhase}"`,
          's',
        );
        assert.match(
          res.body,
          activeRe,
          `status=${status} should mark phase ${expectedPhase} as active`,
        );
      } finally {
        await app.close();
      }
    }
  });

  // -------------------------------------------------------------------------
  // 12. indeterminate_shimmer_when_skus_total_null — the worker doesn't know
  //     the SKU total before OF21 finishes. The page must render the
  //     indeterminate shimmer state without throwing on null arithmetic.
  // -------------------------------------------------------------------------

  await t.test('renders_indeterminate_shimmer_when_skus_total_null', async () => {
    const db = makeDb([
      [IN_FLIGHT_CM_ROW],
      [{
        ...IN_FLIGHT_SCAN_ROW,
        status: 'RUNNING_A01',
        phase_message: 'A configurar integração com Worten',
        skus_total: null,
        skus_processed: 0,
      }],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/scan' });
      assert.equal(res.statusCode, 200, 'expected 200 with skus_total=null');
      assert.ok(
        res.body.includes('mp-shimmer--indeterminate'),
        'expected indeterminate shimmer wrapper class when skus_total is null',
      );
      assert.ok(
        !res.body.includes('mp-shimmer--determinate'),
        'should not have determinate shimmer class when skus_total is null',
      );
      // Phase 1 active (RUNNING_A01)
      assert.match(
        res.body,
        /class="[^"]*mp-phase--active[^"]*"\s+data-phase="1"/s,
        'phase 1 should be active for RUNNING_A01',
      );
    } finally {
      await app.close();
    }
  });
});
