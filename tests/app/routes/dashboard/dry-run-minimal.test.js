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

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';

// Verbatim PT copy from UX skeleton §9.5 (DRY_RUN banner)
// Spec-locked: do NOT paraphrase or truncate.
const DRY_RUN_BANNER_COPY_FRAGMENT = 'MODO SIMULAÇÃO';
const DRY_RUN_BANNER_FULL_COPY =
  'O que vês são decisões que o motor TOMARIA, não acções no Worten. Quando estiveres confortável, vai live.';

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

/** customer_marketplaces row: DRY_RUN — post-onboarding, margin set */
const DRY_RUN_CM = {
  id: 'cm-uuid-1',
  cron_state: 'DRY_RUN',
  max_discount_pct: 0.02,
  scan_status: null,
};

/** customer_marketplaces row: PROVISIONING (scan not started / in progress) */
const PROVISIONING_CM = {
  id: 'cm-uuid-1',
  cron_state: 'PROVISIONING',
  max_discount_pct: null,
  scan_status: null,
};

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
    //   - HTML contains "Ir live" (the disabled placeholder CTA per dev notes)
    //   - HTML contains the banner CSS class mp-banner-info (blue info styling)
    //   - HTML contains "science" icon (material-symbols-outlined per spec)

    const db = makeDb([
      // interceptionRedirect queries customer_marketplaces + scan_jobs lateral join
      [DRY_RUN_CM],
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

      // "Ir live →" placeholder CTA (disabled, Go-Live action ships in Epic 8 Story 8.6)
      assert.ok(
        html.includes('Ir live'),
        'banner must contain "Ir live" placeholder button (disabled, ships Story 8.6)',
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
    //   - NOTE: "Ir live →" disabled placeholder in banner IS acceptable (AC#1 spec)
    //           but must have no form action or POST target

    const db = makeDb([[DRY_RUN_CM]]);
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

      // No margin editor (ships Story 8.4)
      assert.ok(
        !html.includes('margin-editor') && !html.includes('max_discount_pct'),
        'page must NOT contain margin editor elements (ships Epic 8 Story 8.4)',
      );
    } finally {
      await app.close();
    }
  });

  await t.test('dry_run_page_links_to_audit_log', async () => {
    // Given: DRY_RUN customer
    // When:  GET /
    // Then:  HTML contains <a href="/audit"> link (audit log will populate as cycles run)

    const db = makeDb([[DRY_RUN_CM]]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for DRY_RUN customer; got ${res.statusCode}`);
      const html = res.body;

      assert.ok(
        html.includes('href="/audit"'),
        'page must contain <a href="/audit"> link to audit log',
      );
    } finally {
      await app.close();
    }
  });

  await t.test('dry_run_page_has_kpi_placeholders', async () => {
    // Given: DRY_RUN customer
    // When:  GET /
    // Then:  HTML contains 3 KPI card placeholder elements with placeholder text
    //        "3 status cards arriving in Epic 8" (AC#1 — no real KPI data)

    const db = makeDb([[DRY_RUN_CM]]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for DRY_RUN customer; got ${res.statusCode}`);
      const html = res.body;

      // KPI placeholder text (3 identical elements per spec)
      const placeholderCount = (html.match(/3 status cards arriving in Epic 8/g) ?? []).length;
      assert.ok(
        placeholderCount >= 3,
        `page must have 3 KPI placeholder cards; found ${placeholderCount}`,
      );

      // pending icon (material-symbols-outlined per spec)
      assert.ok(
        html.includes('pending'),
        'KPI placeholder cards must include "pending" icon',
      );

      // No real DB data in KPI cards (AC#1 — placeholder only)
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
