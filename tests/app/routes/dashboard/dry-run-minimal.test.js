// Story 4.9 / AC#1-AC#2 — Dashboard root in DRY_RUN minimal landing tests.
//
// Covers:
//   AC#1 — Customer with DRY_RUN state lands on minimal dry-run dashboard:
//           Blue banner with verbatim PT copy from UX skeleton §9.5
//           No Go-Live button (ships in Epic 8)
//           /audit link present
//   AC#2 — Customer with PROVISIONING state: GET / → 302 /onboarding/scan (UX-DR2)
//
// Test harness: Node built-in test runner (node --test).
// DB client (req.db) is mocked — no real Supabase instance required.
// authMiddleware and rlsContext skip when req.user / req.db are already set
// (the route plugin checks this before calling the real middleware, so the
// global preHandler in buildApp() is sufficient to inject auth context).
//
// Run with: node --test tests/app/routes/dashboard/dry-run-minimal.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

// Verbatim PT copy from UX skeleton §9.5 (DRY_RUN banner)
// Spec-locked: do NOT paraphrase or truncate.
const DRY_RUN_BANNER_COPY_FRAGMENT = 'MODO SIMULAÇÃO';

// ---------------------------------------------------------------------------
// Helpers — mock DB factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal req.db mock whose query() method returns rows in sequence.
 * Each call to makeDb([...rowSets]) pops the next rowSet for each query call.
 *
 * @param {Array<Array<object>>} rowSets - ordered list of row arrays to return per query call
 * @returns {{ query: Function, release: Function }}
 */
function makeDb (rowSets) {
  let callIndex = 0;
  return {
    async query (_sql, _params) {
      const rows = rowSets[callIndex] ?? [];
      callIndex += 1;
      return { rows };
    },
    async release () {
      // no-op: tests don't use a real pg pool
    },
  };
}

/**
 * Build a Fastify test app with dashboardRoutes registered, injecting the
 * provided req.db mock and a fixed req.user for every request.
 *
 * authMiddleware and rlsContext are bypassed by the route plugin itself:
 * dashboard/index.js checks whether req.user / req.db are already set before
 * calling the real middleware (bypass-aware conditional wrappers per Story 4.8
 * Debug Log #2). Setting them in a global preHandler is sufficient.
 *
 * @param {{ db: object, userId?: string }} opts
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildApp ({ db, userId = 'test-customer-uuid' } = {}) {
  const fastify = Fastify({ logger: false });

  // Inject auth + rls-context without the real middleware.
  // Global preHandler runs before any plugin-scoped hooks.
  fastify.addHook('preHandler', async (req) => {
    req.user = { id: userId, access_token: 'test-token', email: 'test@example.com' };
    req.db = db;
  });

  // Register view engine so reply.view() works in unit tests
  const FastifyView = (await import('@fastify/view')).default;
  const { Eta } = await import('eta');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // views directory: tests/app/routes/dashboard/ → ../../../../app/src/views
  const viewsDir = join(__dirname, '../../../../app/src/views');
  await fastify.register(FastifyView, {
    engine: { eta: new Eta() },
    templates: viewsDir,
    defaultContext: { appName: 'MarketPilot' },
    propertyName: 'view',
    asyncPropertyName: 'viewAsync',
  });

  // Register the route plugin under test
  const { dashboardRoutes } = await import('../../../../app/src/routes/dashboard/index.js');
  await fastify.register(dashboardRoutes);

  await fastify.ready();
  return fastify;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

// Story 8.1 note: the dashboard route now makes TWO queries:
//   1. interception-redirect: SELECT cron_state, updated_at, scan_status FROM customer_marketplaces
//   2. dashboard handler: SELECT cron_state, anomaly_count, sustained_transient_active ...
// Tests must supply TWO row sets.

/** interception-redirect row: DRY_RUN — no scan failure */
const DRY_RUN_INTERCEPT = {
  cron_state: 'DRY_RUN',
  state_updated_at: new Date('2026-05-14T10:00:00Z'),
  scan_status: null,
};

/** dashboard handler row: DRY_RUN — full state context */
const DRY_RUN_CM = {
  id: 'cm-uuid-1',
  cron_state: 'DRY_RUN',
  max_discount_pct: 0.02,
  max_increase_pct: 0.05,
  state_updated_at: new Date('2026-05-14T10:00:00Z'),
  anomaly_count: 0,
  sustained_transient_active: false,
};

/** interception-redirect row: PROVISIONING (scan not started / in progress) */
const PROVISIONING_INTERCEPT = {
  cron_state: 'PROVISIONING',
  state_updated_at: new Date('2026-05-14T10:00:00Z'),
  scan_status: null,
};

/** Legacy alias kept for backward-compat within this file */
const PROVISIONING_CM = PROVISIONING_INTERCEPT;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('dashboard-dry-run-minimal', async (t) => {
  // ---------------------------------------------------------------------------
  // AC#1 — DRY_RUN landing renders correctly
  // ---------------------------------------------------------------------------

  await t.test('dry_run_banner_renders_with_pt_copy', async () => {
    // Given: DRY_RUN customer with margin set (post-onboarding complete)
    // When:  GET / with session cookie
    // Then:
    //   - response is 200 (not redirect)
    //   - HTML contains verbatim §9.5 banner copy: "MODO SIMULAÇÃO"
    //   - HTML contains the full §9.5 banner body text fragment
    //   - HTML contains "Ir live" CTA (wired to Go-Live modal in Story 8.6)
    //   - HTML contains the banner CSS class mp-banner-info (blue info styling)
    //   - HTML contains "science" icon (material-symbols-outlined per spec)
    //
    // Story 8.1 note: route now makes TWO queries (interception + dashboard handler).
    // Row set 1: interception-redirect query; Row set 2: dashboard handler query.

    const db = makeDb([
      [DRY_RUN_INTERCEPT],  // interceptionRedirect: cron_state, updated_at, scan_status
      [DRY_RUN_CM],         // dashboard handler: full state context
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for DRY_RUN customer; got ${res.statusCode}`);
      assert.ok(
        res.headers['content-type']?.includes('text/html'),
        'expected HTML response',
      );
      const html = res.body;

      // §9.5 verbatim copy — bold "MODO SIMULAÇÃO" heading (spec-locked, AC#1)
      assert.ok(
        html.includes(DRY_RUN_BANNER_COPY_FRAGMENT),
        `banner must contain verbatim "MODO SIMULAÇÃO" from UX skeleton §9.5`,
      );

      // §9.5 body text fragment (spec-locked PT copy, AC#1)
      assert.ok(
        html.includes('O que vês são decisões que o motor TOMARIA'),
        'banner must contain verbatim §9.5 body copy fragment "O que vês são decisões..."',
      );
      assert.ok(
        html.includes('não acções no Worten'),
        'banner must contain "não acções no Worten" (§9.5 verbatim)',
      );
      assert.ok(
        html.includes('Quando estiveres confortável, vai live'),
        'banner must contain "Quando estiveres confortável, vai live" (§9.5 verbatim)',
      );

      // "Ir live →" CTA (Story 8.6 wires the Go-Live modal)
      assert.ok(
        html.includes('Ir live'),
        'banner must contain "Ir live" CTA button (Story 8.6 wires modal)',
      );

      // science icon (material-symbols-outlined per spec §9.5)
      assert.ok(
        html.includes('science'),
        'banner must include "science" icon (material-symbols-outlined)',
      );

      // Page title (AC#1)
      assert.ok(
        html.includes('Dashboard') && html.includes('MarketPilot'),
        'page title must contain "Dashboard · MarketPilot"',
      );
    } finally {
      await app.close();
    }
  });

  await t.test('dry_run_page_has_no_go_live_button', async () => {
    // Given: DRY_RUN customer
    // When:  GET /
    // Then:
    //   - HTML does NOT contain a functional Go-Live form action (POST /go-live)
    //   - HTML does NOT contain "Ativar repricing" or "Go Live" English text
    //   - NOTE: "Ir live →" button in Story 8.1 banner is NOT disabled — Story 8.6
    //           wires the Go-Live modal click handler. The button exists without disabled.
    //
    // Story 8.1 note: row set 1 = interception query; row set 2 = dashboard handler.

    const db = makeDb([
      [DRY_RUN_INTERCEPT],
      [DRY_RUN_CM],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for DRY_RUN customer; got ${res.statusCode}`);
      const html = res.body;

      // No Go-Live form action (Go-Live action ships in Epic 8 Story 8.6)
      assert.ok(
        !html.includes('action="/go-live"') && !html.includes("action='/go-live'"),
        'page must NOT contain form action="/go-live" (Go-Live ships in Epic 8 Story 8.6)',
      );

      // No JavaScript Go-Live handler (e.g., fetch('/go-live', ...))
      assert.ok(
        !html.includes("fetch('/go-live'") && !html.includes('fetch("/go-live"'),
        'page must NOT contain fetch("/go-live") JS handler (Go-Live ships in Epic 8 Story 8.6)',
      );

      // No English Go-Live text
      assert.ok(
        !html.includes('Go Live') && !html.includes('Ativar repricing'),
        'page must NOT contain "Go Live" or "Ativar repricing" English/live text',
      );

      // "Ir live →" button must exist (Story 8.6 wires the click handler)
      assert.ok(
        html.includes('Ir live'),
        '"Ir live →" button must be present in DRY_RUN banner (Story 8.6 wires modal)',
      );

      // No raw SQL or margin data in rendered HTML
      assert.ok(
        !html.includes('max_discount_pct'),
        'page must NOT expose raw column names in rendered HTML',
      );
    } finally {
      await app.close();
    }
  });

  await t.test('dry_run_page_renders_kpi_grid', async () => {
    // Given: DRY_RUN customer
    // When:  GET /
    // Then:  HTML contains the KPI grid slot (Story 8.2 fills with real data).
    //        Story 8.1 renders shimmer skeleton placeholders.
    //
    // Story 8.1 note: row set 1 = interception query; row set 2 = dashboard handler.

    const db = makeDb([
      [DRY_RUN_INTERCEPT],
      [DRY_RUN_CM],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for DRY_RUN customer; got ${res.statusCode}`);
      const html = res.body;

      // KPI grid slot must be present (shimmer skeletons; Story 8.2 adds real data)
      assert.ok(
        html.includes('mp-kpi-grid'),
        'page must contain mp-kpi-grid slot (Story 8.2 fills with real KPI data)',
      );

      // Shimmer skeleton placeholders (Story 8.1 — Story 8.2 replaces with real cards)
      assert.ok(
        html.includes('mp-kpi-shimmer'),
        'page must contain mp-kpi-shimmer placeholders (Story 8.2 replaces with real cards)',
      );
    } finally {
      await app.close();
    }
  });

  await t.test('dry_run_page_has_kpi_placeholders', async () => {
    // Given: DRY_RUN customer
    // When:  GET /
    // Then:  HTML contains KPI shimmer skeleton placeholders
    //        (Story 8.1 — Story 8.2 replaces with real kpi-cards.eta)
    //
    // Story 8.1 note: row set 1 = interception query; row set 2 = dashboard handler.

    const db = makeDb([
      [DRY_RUN_INTERCEPT],
      [DRY_RUN_CM],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for DRY_RUN customer; got ${res.statusCode}`);
      const html = res.body;

      // KPI shimmer placeholder elements (Story 8.1 — Story 8.2 replaces)
      const shimmerCount = (html.match(/mp-kpi-shimmer/g) ?? []).length;
      assert.ok(
        shimmerCount >= 3,
        `page must have 3 KPI shimmer placeholder elements; found ${shimmerCount}`,
      );

      // aria-busy on loading placeholders
      assert.ok(
        html.includes('aria-busy="true"'),
        'KPI shimmer placeholders must have aria-busy="true" for accessibility',
      );

      // No real DB data in KPI cards (placeholder only)
      assert.ok(
        !html.includes('SELECT') && !html.includes('COUNT('),
        'page must NOT include raw SQL in rendered HTML (no KPI data queries)',
      );
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#2 — PROVISIONING customer redirected
  // ---------------------------------------------------------------------------

  await t.test('provisioning_customer_redirected_to_onboarding_scan', async () => {
    // Given: customer with cron_state = PROVISIONING (no scan started yet)
    // When:  GET / (interceptionRedirect middleware + dashboard forward-only guard)
    // Then:  302 → /onboarding/scan (UX-DR2 forward-only)
    //
    // Note: The interceptionRedirect middleware (Story 4.6) handles
    // PROVISIONING + FAILED_SCAN → /scan-failed. PROVISIONING without a FAILED
    // scan (no scan started or scan PENDING/IN_PROGRESS) is handled by the
    // dashboard route itself or by an extended interceptionRedirect guard.
    // The test asserts the 302 behaviour regardless of which layer enforces it.

    const db = makeDb([
      // interceptionRedirect query: PROVISIONING, no FAILED scan_jobs row
      [PROVISIONING_CM],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(
        res.statusCode,
        302,
        `PROVISIONING customer at GET / must redirect (302); got ${res.statusCode}`,
      );
      assert.equal(
        res.headers.location,
        '/onboarding/scan',
        `PROVISIONING customer must redirect to /onboarding/scan; got ${res.headers.location}`,
      );
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Critical Constraints — static analysis guards
  // ---------------------------------------------------------------------------

  await t.test('dashboard_route_does_not_call_write_audit_event_or_transition_cron_state', async () => {
    // Static assertion: app/src/routes/dashboard/index.js must NOT import or
    // call writeAuditEvent (no AD20 event type for dashboard landing) and
    // must NOT call transitionCronState (no state transition in Story 4.9).
    // This enforces Critical Constraints 3 and 4.

    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const routePath = join(__dirname, '../../../../app/src/routes/dashboard/index.js');

    let routeSrc;
    try {
      routeSrc = await readFile(routePath, 'utf8');
    } catch {
      // File does not exist yet (pre-dev ATDD stub) — skip static check
      return;
    }

    assert.ok(
      !routeSrc.includes('writeAuditEvent'),
      'dashboard/index.js must NOT call writeAuditEvent (no AD20 event type for dashboard landing)',
    );
    assert.ok(
      !routeSrc.includes('transitionCronState'),
      'dashboard/index.js must NOT call transitionCronState (no state transition in Story 4.9)',
    );
    assert.ok(
      !routeSrc.includes('.then('),
      'dashboard/index.js must NOT use .then() chains (async/await only per architecture constraint)',
    );
    assert.ok(
      !routeSrc.includes('console.log'),
      'dashboard/index.js must NOT use console.log (pino only)',
    );

    // Named export check (Critical Constraint 5)
    assert.ok(
      routeSrc.includes('export async function dashboardRoutes'),
      'dashboard/index.js must use named export "dashboardRoutes" (not default export)',
    );
  });
});
