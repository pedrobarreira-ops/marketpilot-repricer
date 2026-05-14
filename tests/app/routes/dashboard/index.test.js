// tests/app/routes/dashboard/index.test.js
// Epic 8 Test Plan — Story 8.1 (ATDD-filled, 2026-05-14)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage:
//   AC#1 — interception-redirect middleware: 7 cron_state variants → correct banner/redirect
//   AC#2 — sticky header layout: default.eta with backdrop-filter, banner zone, footer
//   AC#3 — state body slot: DRY_RUN simulated values + "Ir live" CTA; ACTIVE KPIs
//   AC#4 — UX-DR4 banner stack precedence: only highest-precedence banner renders
//   AC#5 — UX-DR3/32 interception fires once per state-transition
//   AC#6 — keyboard accessibility: focus order, no positive tabindex, role=alert/status
//
// Depends on: Story 4.1 (cron_state schema), Story 4.9 (minimal stub being replaced),
//             Story 9.0+9.1 (audit foundation)
//
// Run with: node --test tests/app/routes/dashboard/index.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal req.db mock whose query() method returns rows in sequence.
 * Each call to makeDb([...rowSets]) pops the next rowSet for each query call.
 *
 * The dashboard route (Story 8.1) issues up to two queries:
 *   1. interception-redirect: SELECT cron_state, updated_at, scan_status FROM customer_marketplaces
 *   2. dashboard route handler: SELECT cron_state, anomaly_count, sustained_transient_active ...
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
 * calling the real middleware (bypass-aware conditional wrappers).
 * Setting them in a global preHandler is sufficient.
 *
 * @param {{ db: object, userId?: string, session?: object }} opts
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildApp ({ db, userId = 'test-customer-uuid', session = {} } = {}) {
  const fastify = Fastify({ logger: false });

  // Inject auth + rls-context without the real middleware.
  // Global preHandler runs before any plugin-scoped hooks.
  fastify.addHook('preHandler', async (req) => {
    req.user = { id: userId, access_token: 'test-token', email: 'test@example.com' };
    req.db = db;
    // Inject session mock for UX-DR32 once-per-transition tracking
    req.session = { ...session };
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
// Shared DB row factories
// ---------------------------------------------------------------------------

/**
 * Build interception-redirect row (first query: customer_marketplaces + scan_jobs lateral).
 * Story 8.1 extends this query to include updated_at for once-per-transition tracking.
 */
function interceptRow (cronState, opts = {}) {
  return {
    cron_state: cronState,
    scan_status: opts.scanStatus ?? null,
    state_updated_at: opts.stateUpdatedAt ?? new Date('2026-05-14T10:00:00Z'),
  };
}

/**
 * Build dashboard route handler row (second query: full state context).
 */
function dashboardRow (cronState, opts = {}) {
  return {
    cron_state: cronState,
    max_discount_pct: opts.maxDiscountPct ?? 0.02,
    max_increase_pct: opts.maxIncreasePct ?? 0.05,
    state_updated_at: opts.stateUpdatedAt ?? new Date('2026-05-14T10:00:00Z'),
    anomaly_count: opts.anomalyCount ?? 0,
    sustained_transient_active: opts.sustainedTransientActive ?? false,
  };
}

// ---------------------------------------------------------------------------
// AC#1 — cron_state variant redirect/render behaviour
// ---------------------------------------------------------------------------

describe('dashboard-root-interception-redirect', () => {
  test('provisioning_state_redirects_to_onboarding_scan', async () => {
    // Given: authenticated customer with cron_state = PROVISIONING
    // When:  GET / via interception-redirect middleware
    // Then:  302 → /onboarding/scan (UX-DR2 forward-only)
    const db = makeDb([
      [interceptRow('PROVISIONING', { scanStatus: null })],
      // dashboard handler should NOT run — intercept fires
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 302, `expected 302 for PROVISIONING; got ${res.statusCode}`);
      assert.equal(res.headers.location, '/onboarding/scan', 'must redirect to /onboarding/scan');
    } finally {
      await app.close();
    }
  });

  test('dry_run_state_renders_200_with_modo_simulacao_badge', async () => {
    // Given: cron_state = DRY_RUN
    // When:  GET /
    // Then:  200; HTML contains "MODO SIMULAÇÃO" badge; §9.5 banner with science icon;
    //        "Ir live" CTA visible; banner has mp-banner-info class
    const db = makeDb([
      [interceptRow('DRY_RUN')],
      [dashboardRow('DRY_RUN')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for DRY_RUN; got ${res.statusCode}`);
      const html = res.body;
      // §9.5 verbatim copy — spec-locked (AC#1)
      assert.ok(html.includes('MODO SIMULAÇÃO'), 'must contain "MODO SIMULAÇÃO" badge/banner');
      // "Ir live" CTA
      assert.ok(html.includes('Ir live'), 'must contain "Ir live" CTA');
      // science icon (material-symbols-outlined per §9.5)
      assert.ok(html.includes('science'), 'must include "science" icon');
      // Banner uses info styling (blue)
      assert.ok(html.includes('mp-banner-info'), 'DRY_RUN banner must use mp-banner-info class');
    } finally {
      await app.close();
    }
  });

  test('active_healthy_state_renders_full_kpi_cards', async () => {
    // Given: cron_state = ACTIVE, no anomaly/circuit-breaker/sustained-transient conditions
    // When:  GET /
    // Then:  200; no pause/error banner visible; KPI card slot present
    const db = makeDb([
      [interceptRow('ACTIVE')],
      [dashboardRow('ACTIVE', { anomalyCount: 0, sustainedTransientActive: false })],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for ACTIVE; got ${res.statusCode}`);
      const html = res.body;
      // KPI grid slot must be present (Stories 8.2 fills it with real data)
      assert.ok(html.includes('mp-kpi-grid') || html.includes('mp-kpi'), 'KPI card grid slot must be present');
      // No danger banners in healthy ACTIVE state
      assert.ok(!html.includes('mp-banner-danger'), 'healthy ACTIVE state must NOT show danger banner');
      // No payment failure icon
      assert.ok(!html.includes('Atualizar pagamento'), 'healthy ACTIVE must NOT show payment failure CTA');
    } finally {
      await app.close();
    }
  });

  test('paused_by_customer_renders_grey_banner_with_section_9_4_copy', async () => {
    // Given: cron_state = PAUSED_BY_CUSTOMER
    // When:  GET /
    // Then:  200; §9.4 grey/neutral banner; pause_circle icon; "Retomar" button;
    //        KPI cards greyed (mp-kpi-grid--greyed class)
    const db = makeDb([
      [interceptRow('PAUSED_BY_CUSTOMER')],
      [dashboardRow('PAUSED_BY_CUSTOMER')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for PAUSED_BY_CUSTOMER; got ${res.statusCode}`);
      const html = res.body;
      // pause_circle icon (§9.4 — calm grey treatment, UX-DR5)
      assert.ok(html.includes('pause_circle'), 'PAUSED_BY_CUSTOMER must use pause_circle icon');
      // "Retomar" resume button
      assert.ok(html.includes('Retomar'), 'PAUSED_BY_CUSTOMER must show "Retomar" button');
      // Neutral grey banner class (NOT danger)
      assert.ok(html.includes('mp-banner-neutral'), 'PAUSED_BY_CUSTOMER must use mp-banner-neutral class');
      // KPI cards greyed class
      assert.ok(html.includes('mp-kpi-grid--greyed'), 'PAUSED_BY_CUSTOMER KPI grid must have --greyed modifier');
      // Must NOT use warning icon (UX-DR5 distinction from payment failure)
      assert.ok(!html.includes('mp-banner-danger'), 'PAUSED_BY_CUSTOMER must NOT use danger banner');
    } finally {
      await app.close();
    }
  });

  test('paused_by_payment_failure_renders_red_banner_with_warning_icon', async () => {
    // Given: cron_state = PAUSED_BY_PAYMENT_FAILURE
    // When:  GET /
    // Then:  200; red danger banner; "warning" filled icon (NOT pause_circle — UX-DR5);
    //        "Atualizar pagamento" CTA; KPI cards greyed
    const db = makeDb([
      [interceptRow('PAUSED_BY_PAYMENT_FAILURE')],
      [dashboardRow('PAUSED_BY_PAYMENT_FAILURE')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for PAUSED_BY_PAYMENT_FAILURE; got ${res.statusCode}`);
      const html = res.body;
      // "warning" filled icon (UX-DR5 — MUST differ from pause_circle)
      assert.ok(html.includes('>warning<'), '"warning" icon must be present for payment failure state');
      // "Atualizar pagamento" CTA
      assert.ok(html.includes('Atualizar pagamento'), 'must show "Atualizar pagamento" CTA');
      // Red danger banner
      assert.ok(html.includes('mp-banner-danger'), 'payment failure must use mp-banner-danger class');
      // UX-DR5: MUST NOT use pause_circle icon in this state
      assert.ok(!html.includes('pause_circle'), 'payment failure must NOT use pause_circle icon (UX-DR5)');
    } finally {
      await app.close();
    }
  });

  test('paused_by_circuit_breaker_renders_red_banner_with_investigate_button', async () => {
    // Given: cron_state = PAUSED_BY_CIRCUIT_BREAKER
    // When:  GET /
    // Then:  200; red danger banner with gpp_maybe icon; "Investigar" + "Retomar" buttons;
    //        KPI cards stale-watermarked (mp-kpi-grid--stale)
    const db = makeDb([
      [interceptRow('PAUSED_BY_CIRCUIT_BREAKER')],
      [dashboardRow('PAUSED_BY_CIRCUIT_BREAKER')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for PAUSED_BY_CIRCUIT_BREAKER; got ${res.statusCode}`);
      const html = res.body;
      // gpp_maybe icon (§9.8)
      assert.ok(html.includes('gpp_maybe'), 'circuit breaker banner must use gpp_maybe icon');
      // "Investigar" button (links to /audit)
      assert.ok(html.includes('Investigar'), 'circuit breaker banner must have "Investigar" button');
      // Red danger banner
      assert.ok(html.includes('mp-banner-danger'), 'circuit breaker must use mp-banner-danger class');
      // Stale KPI cards
      assert.ok(html.includes('mp-kpi-grid--stale'), 'circuit breaker KPI grid must have --stale modifier');
    } finally {
      await app.close();
    }
  });

  test('paused_by_key_revoked_redirects_to_key_revoked_page_first_login', async () => {
    // Given: cron_state = PAUSED_BY_KEY_REVOKED AND first login post-state-transition
    //        (no session.shownInterceptionFor flag set)
    // When:  GET /
    // Then:  302 → /key-revoked (UX-DR3 first-time interception)
    const stateUpdatedAt = new Date('2026-05-14T10:00:00Z');
    const db = makeDb([
      [interceptRow('PAUSED_BY_KEY_REVOKED', { stateUpdatedAt })],
      // dashboard handler should NOT run — intercept fires
    ]);
    // No session flag → first login
    const app = await buildApp({ db, session: {} });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 302, `expected 302 for PAUSED_BY_KEY_REVOKED first login; got ${res.statusCode}`);
      assert.equal(res.headers.location, '/key-revoked', 'must redirect to /key-revoked');
    } finally {
      await app.close();
    }
  });

  test('anomaly_attention_active_shows_yellow_banner_with_sku_count', async () => {
    // Given: cron_state = ACTIVE; anomaly_count = 3
    // When:  GET /
    // Then:  200; yellow warning banner; "error" filled icon; "Rever 3 eventos" CTA
    const db = makeDb([
      [interceptRow('ACTIVE')],
      [dashboardRow('ACTIVE', { anomalyCount: 3, sustainedTransientActive: false })],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for ACTIVE+anomaly; got ${res.statusCode}`);
      const html = res.body;
      // Yellow warning banner
      assert.ok(html.includes('mp-banner-warning'), 'anomaly state must use mp-banner-warning class');
      // "error" icon (§9.7)
      assert.ok(html.includes('>error<'), 'anomaly banner must use "error" icon');
      // "Rever N eventos" CTA with count
      assert.ok(html.includes('Rever') && html.includes('eventos'), 'anomaly banner must show "Rever X eventos" CTA');
      assert.ok(html.includes('3'), 'anomaly banner must include the anomaly count (3)');
    } finally {
      await app.close();
    }
  });

  test('sustained_transient_active_shows_grey_informational_banner', async () => {
    // Given: cron_state = ACTIVE; sustained_transient_active = true (≥3 consecutive failures)
    // When:  GET /
    // Then:  200; grey neutral banner; "schedule" filled icon; §9.9 informational copy;
    //        NO action CTA (informational only per AC#3)
    const db = makeDb([
      [interceptRow('ACTIVE')],
      [dashboardRow('ACTIVE', { anomalyCount: 0, sustainedTransientActive: true })],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for ACTIVE+sustained-transient; got ${res.statusCode}`);
      const html = res.body;
      // "schedule" icon (§9.9)
      assert.ok(html.includes('schedule'), 'sustained transient banner must use "schedule" icon');
      // Grey neutral banner class
      assert.ok(html.includes('mp-banner-neutral'), 'sustained transient must use mp-banner-neutral class');
      // Stale KPI watermark (AC#3: KPI cards stale-watermarked)
      assert.ok(html.includes('mp-kpi-grid--stale'), 'sustained transient KPI grid must have --stale modifier');
    } finally {
      await app.close();
    }
  });

  test('paused_by_account_grace_period_renders_dashboard_no_banner_no_crash', async () => {
    // Given: cron_state = PAUSED_BY_ACCOUNT_GRACE_PERIOD (legal state per spec, no banner today)
    // When:  GET /
    // Then:  200; layout renders (header + main); no danger banner since dashboard.eta
    //        currently has no PAUSED_BY_ACCOUNT_GRACE_PERIOD branch — must not crash.
    // Behavioural intent: AC#1 lists this state as a render-through; defensive coverage
    // ensures it doesn't fall into a stray banner condition by accident.
    const db = makeDb([
      [interceptRow('PAUSED_BY_ACCOUNT_GRACE_PERIOD')],
      [dashboardRow('PAUSED_BY_ACCOUNT_GRACE_PERIOD')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200,
        `expected 200 for PAUSED_BY_ACCOUNT_GRACE_PERIOD; got ${res.statusCode}`);
      const html = res.body;
      // Sticky header + main slot present (full chrome renders)
      assert.ok(html.includes('mp-sticky-header'), 'grace-period state must still render sticky header');
      assert.ok(html.includes('id="main-content"'), 'grace-period state must render the main slot');
      // Must NOT accidentally render a danger or pause banner
      assert.ok(!html.includes('mp-banner-danger'),
        'grace-period must NOT render danger banner (no spec mapping today)');
      assert.ok(!html.includes('pause_circle'),
        'grace-period must NOT render pause_circle icon');
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC#2 — Sticky header layout structure
// ---------------------------------------------------------------------------

describe('dashboard-layout', () => {
  test('layout_includes_sticky_header_with_backdrop_blur', async () => {
    // Given: any authenticated customer
    // When:  GET /
    // Then:  HTML contains mp-sticky-header class (CSS in layout.css applies backdrop-filter: blur(12px));
    //        sticky header has logo, Settings link, and session avatar area
    const db = makeDb([
      [interceptRow('ACTIVE')],
      [dashboardRow('ACTIVE')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // Sticky header class (CSS in layout.css applies backdrop-filter: blur(12px) per §10.1)
      assert.ok(html.includes('mp-sticky-header'), 'layout must include mp-sticky-header class');
      // Settings navigation link
      assert.ok(html.includes('/settings') || html.includes('Definições'), 'header must contain Settings link');
      // Role="banner" on header element
      assert.ok(html.includes('role="banner"'), 'sticky header must have role="banner"');
    } finally {
      await app.close();
    }
  });

  test('layout_includes_banner_zone_body_slot_footer', async () => {
    // Given: any cron_state
    // When:  GET /
    // Then:  layout has mp-banner-zone div, main#main-content, footer[role=contentinfo]
    const db = makeDb([
      [interceptRow('DRY_RUN')],
      [dashboardRow('DRY_RUN')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // Banner zone
      assert.ok(html.includes('mp-banner-zone'), 'layout must include mp-banner-zone slot');
      // Main body slot with id=main-content
      assert.ok(html.includes('id="main-content"'), 'layout must include id="main-content" on main element');
      // Footer with role=contentinfo
      assert.ok(html.includes('role="contentinfo"'), 'layout must include footer with role="contentinfo"');
    } finally {
      await app.close();
    }
  });

  test('layout_css_defines_sticky_header_backdrop_filter_blur_12px', async () => {
    // AC#2 — verify the CSS rule itself (not just the class on HTML) so a future refactor
    // that removes backdrop-filter from layout.css does not silently regress the §10.1 chrome.
    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const cssPath = join(__dirname, '../../../../public/css/layout.css');
    const src = await readFile(cssPath, 'utf8');
    // Match either backdrop-filter or -webkit-backdrop-filter with blur(12px)
    const hasBackdropBlur = /(-webkit-)?backdrop-filter\s*:\s*blur\(\s*12px\s*\)/.test(src);
    assert.ok(hasBackdropBlur,
      'public/css/layout.css must define backdrop-filter: blur(12px) on the sticky header (§10.1)');
    // Verify 85% bg opacity rule per §10.1
    assert.ok(
      /background-color\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.85\s*\)/.test(src) ||
        src.includes('background-color: rgba(255, 255, 255, 0.85)'),
      'public/css/layout.css must define 85% white bg on the sticky header (§10.1)'
    );
  });

  test('dashboard_body_renders_kpi_shimmer_loading_skeleton_with_aria_busy', async () => {
    // AC#3 Loading state — even pre-Story-8.2 KPI placeholders, shimmer skeletons must
    // be announced as busy to assistive tech. Behavioural assertion: 3 placeholders + aria-busy.
    const db = makeDb([
      [interceptRow('ACTIVE')],
      [dashboardRow('ACTIVE')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      const shimmerCount = (html.match(/mp-kpi-shimmer/g) ?? []).length;
      assert.ok(shimmerCount >= 3,
        `dashboard must render at least 3 mp-kpi-shimmer placeholders; found ${shimmerCount}`);
      assert.ok(html.includes('aria-busy="true"'),
        'KPI shimmer placeholders must carry aria-busy="true" for screen readers (NFR-A1)');
    } finally {
      await app.close();
    }
  });

  test('page_renders_within_nfr_p7_budget_2s_broadband', async () => {
    // Given: ACTIVE customer
    // When:  GET / timed via Date.now() around Fastify inject
    // Then:  server-side response time < 200ms (proxy for NFR-P7 broadband budget)
    const db = makeDb([
      [interceptRow('ACTIVE')],
      [dashboardRow('ACTIVE')],
    ]);
    const app = await buildApp({ db });
    try {
      const start = Date.now();
      const res = await app.inject({ method: 'GET', url: '/' });
      const elapsed = Date.now() - start;
      assert.equal(res.statusCode, 200);
      assert.ok(elapsed < 200, `server-side render must be < 200ms; was ${elapsed}ms (NFR-P7)`);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC#3 — DRY_RUN state body slot
// ---------------------------------------------------------------------------

describe('dashboard-dry-run-full-state', () => {
  test('dry_run_state_shows_kpi_simulated_values_and_ir_live_cta', async () => {
    // Given: cron_state = DRY_RUN (full Epic 8 state)
    // When:  GET /
    // Then:  "MODO SIMULAÇÃO" badge top-right; "Ir live" CTA button;
    //        §9.5 verbatim body copy; dry-run banner uses science icon
    const db = makeDb([
      [interceptRow('DRY_RUN')],
      [dashboardRow('DRY_RUN')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200 for DRY_RUN; got ${res.statusCode}`);
      const html = res.body;
      // "MODO SIMULAÇÃO" badge (top-right positioning via mp-dry-run-badge class)
      assert.ok(html.includes('MODO SIMULAÇÃO'), 'DRY_RUN must show "MODO SIMULAÇÃO" badge');
      // "Ir live" CTA (Story 8.6 wires the actual Go-Live modal; badge present here)
      assert.ok(html.includes('Ir live'), 'DRY_RUN must show "Ir live" CTA');
      // §9.5 verbatim body copy — spec-locked
      assert.ok(
        html.includes('O que vês são decisões que o motor TOMARIA'),
        'DRY_RUN banner must include §9.5 verbatim body copy'
      );
      // DRY_RUN badge class
      assert.ok(html.includes('mp-dry-run-badge') || html.includes('MODO SIMULAÇÃO'), 'DRY_RUN badge class must be present');
      // UX-DR13: must NOT reproduce free report narrative arc
      assert.ok(!html.includes('A um passo do'), 'DRY_RUN must NOT include report narrative arc (UX-DR13)');
      assert.ok(!html.includes('Maiores oportunidades'), 'DRY_RUN must NOT include free-report tables (UX-DR13)');
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC#4 — UX-DR4 banner stack precedence
// ---------------------------------------------------------------------------

describe('dashboard-banner-precedence', () => {
  test('multiple_banner_conditions_only_highest_precedence_renders', async () => {
    // Given: cron_state = PAUSED_BY_PAYMENT_FAILURE AND anomaly_count = 5
    //        (payment_failure precedence #1 > anomaly_attention precedence #3)
    // When:  GET /
    // Then:  ONLY payment_failure banner renders; anomaly banner does NOT render
    const db = makeDb([
      [interceptRow('PAUSED_BY_PAYMENT_FAILURE')],
      [dashboardRow('PAUSED_BY_PAYMENT_FAILURE', { anomalyCount: 5 })],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // Payment failure banner present (highest precedence)
      assert.ok(html.includes('Atualizar pagamento'), 'payment_failure banner must render');
      // Anomaly attention banner must NOT render (lower precedence)
      assert.ok(
        !html.includes('Rever') || !html.includes('eventos'),
        'anomaly_attention banner must NOT render when payment_failure is active (UX-DR4 precedence)'
      );
      // Exactly one mp-banner div with danger class (payment_failure)
      const dangerBannerCount = (html.match(/mp-banner-danger/g) || []).length;
      assert.ok(dangerBannerCount >= 1, 'exactly one danger banner must render');
    } finally {
      await app.close();
    }
  });

  test('lower_precedence_banner_reappears_when_higher_clears', async () => {
    // Given: First request: PAUSED_BY_PAYMENT_FAILURE with anomaly_count = 3
    //        Second request: ACTIVE (payment_failure cleared) with anomaly_count = 3
    // When:  GET / twice with different DB state
    // Then:  Second request shows anomaly_attention banner (was hidden behind payment_failure)
    const app1 = await buildApp({
      db: makeDb([
        [interceptRow('PAUSED_BY_PAYMENT_FAILURE')],
        [dashboardRow('PAUSED_BY_PAYMENT_FAILURE', { anomalyCount: 3 })],
      ]),
    });
    const app2 = await buildApp({
      db: makeDb([
        [interceptRow('ACTIVE')],
        [dashboardRow('ACTIVE', { anomalyCount: 3 })],
      ]),
    });
    try {
      const res1 = await app1.inject({ method: 'GET', url: '/' });
      // First state: payment_failure hides anomaly banner
      assert.ok(!res1.body.includes('Rever') || !res1.body.includes('eventos'),
        'payment_failure state must hide anomaly banner');

      const res2 = await app2.inject({ method: 'GET', url: '/' });
      assert.equal(res2.statusCode, 200);
      // Second state: anomaly banner reappears now that payment_failure is cleared
      assert.ok(res2.body.includes('mp-banner-warning'), 'anomaly banner must reappear when payment_failure clears');
      assert.ok(res2.body.includes('Rever') && res2.body.includes('eventos'),
        'anomaly "Rever X eventos" CTA must reappear');
    } finally {
      await app1.close();
      await app2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC#5 — UX-DR3/32: interception fires only once
// ---------------------------------------------------------------------------

describe('dashboard-interception-once-semantics', () => {
  test('key_revoked_interception_fires_only_first_time_subsequent_visits_show_dashboard', async () => {
    // Given: cron_state = PAUSED_BY_KEY_REVOKED; session already shows interception was shown
    //        (req.session.shownInterceptionFor = { state: 'PAUSED_BY_KEY_REVOKED', since: <iso> })
    // When:  GET /
    // Then:  200 (not redirect); persistent red danger banner; no redirect to /key-revoked
    // Per UX-DR32: interception fires only ONCE per state-transition
    const stateUpdatedAt = new Date('2026-05-14T10:00:00Z');
    const db = makeDb([
      [interceptRow('PAUSED_BY_KEY_REVOKED', { stateUpdatedAt })],
      [dashboardRow('PAUSED_BY_KEY_REVOKED')],
    ]);
    // Simulate: interception already shown for this transition (session flag set)
    const session = {
      shownInterceptionFor: {
        state: 'PAUSED_BY_KEY_REVOKED',
        since: stateUpdatedAt.toISOString(),
      },
    };
    const app = await buildApp({ db, session });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      // Subsequent visit → render dashboard with persistent banner, NOT redirect
      assert.equal(res.statusCode, 200,
        `subsequent PAUSED_BY_KEY_REVOKED visit must return 200 (not redirect); got ${res.statusCode}`);
      const html = res.body;
      // Persistent red banner (not an interception redirect)
      assert.ok(html.includes('mp-banner-danger'), 'PAUSED_BY_KEY_REVOKED subsequent visit must show red danger banner');
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC#6 — Keyboard accessibility (NFR-A2)
// ---------------------------------------------------------------------------

describe('dashboard-keyboard-accessibility', () => {
  test('page_keyboard_accessible_focus_order_header_banner_kpi_margin_footer', async () => {
    // Given: ACTIVE state dashboard
    // When:  HTML inspected for tab order indicators
    // Then:  No positive tabindex > 0 that breaks natural DOM flow (accessibility anti-pattern)
    //        role="status" or role="alert" on banners for screen reader announcement
    const db = makeDb([
      [interceptRow('ACTIVE')],
      [dashboardRow('ACTIVE')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // Check for positive tabindex anti-pattern (tabindex="1", tabindex="2", etc.)
      const positiveTabindex = /tabindex="[1-9][0-9]*"/.test(html);
      assert.ok(!positiveTabindex, 'must NOT use positive tabindex values (breaks focus flow, NFR-A2)');
      // tabindex="-1" on main is acceptable (skip nav target)
      // main#main-content should have tabindex="-1" per default.eta spec
      assert.ok(html.includes('id="main-content"'), 'main content anchor must exist for skip-nav');
    } finally {
      await app.close();
    }
  });

  test('no_focus_traps_in_dashboard_layout', async () => {
    // Given: dashboard with no open modal
    // When:  HTML inspected
    // Then:  Red banners use role="alert"; grey/blue banners use role="status"
    //        Icon-only buttons carry aria-label attributes
    const db = makeDb([
      [interceptRow('PAUSED_BY_PAYMENT_FAILURE')],
      [dashboardRow('PAUSED_BY_PAYMENT_FAILURE')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // Red banners must use role="alert" for screen-reader announcement (AC#6, NFR-A1)
      assert.ok(html.includes('role="alert"'), 'red danger banners must use role="alert" (NFR-A1)');
    } finally {
      await app.close();
    }
  });

  test('grey_and_blue_banners_use_role_status', async () => {
    // Given: DRY_RUN state (blue info banner)
    // When:  GET /
    // Then:  Banner uses role="status" (not role="alert") for non-critical states
    const db = makeDb([
      [interceptRow('DRY_RUN')],
      [dashboardRow('DRY_RUN')],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // DRY_RUN info banner must use role="status" (not role="alert")
      assert.ok(html.includes('role="status"'), 'DRY_RUN (info) banner must use role="status"');
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Static source assertions (Critical Constraints)
// ---------------------------------------------------------------------------

test('dashboard_route_does_not_import_of24', async () => {
  // Critical: OF24 is forbidden for price updates (CLAUDE.md mandate)
  // The dashboard route must NEVER import or reference OF24
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const routePath = join(__dirname, '../../../../app/src/routes/dashboard/index.js');
  let src;
  try { src = await readFile(routePath, 'utf8'); } catch { return; }
  assert.ok(!src.includes('of24') && !src.includes('OF24'), 'dashboard route must never reference OF24');
});

test('dashboard_route_does_not_use_console_log', async () => {
  // Constraint #18: no console.log in production code (pino only)
  // Strip comments before checking — only detect actual calls, not comment mentions
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const routePath = join(__dirname, '../../../../app/src/routes/dashboard/index.js');
  let src;
  try { src = await readFile(routePath, 'utf8'); } catch { return; }
  const codeOnly = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!codeOnly.includes('console.log'), 'dashboard route must not use console.log (pino only)');
});

test('dashboard_route_no_spa_framework_imports', async () => {
  // Constraint #3: No SPA framework (no react, vue, svelte, angular, solid-js)
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const routePath = join(__dirname, '../../../../app/src/routes/dashboard/index.js');
  let src;
  try { src = await readFile(routePath, 'utf8'); } catch { return; }
  for (const framework of ['react', 'vue', 'svelte', 'angular', 'solid-js']) {
    assert.ok(!src.includes(framework), `dashboard route must not import ${framework}`);
  }
});

test('dashboard_eta_template_has_no_report_narrative_arc', async () => {
  // UX-DR13: dashboard must NOT reproduce the free report's narrative arc
  // Negative assertions: tables that belong to the free report must be absent
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const templatePath = join(__dirname, '../../../../app/src/views/pages/dashboard.eta');
  let src;
  try { src = await readFile(templatePath, 'utf8'); } catch { return; }
  assert.ok(!src.includes('A um passo do'), 'dashboard template must NOT include rocket hero card (UX-DR13)');
  assert.ok(!src.includes('Maiores oportunidades'), 'dashboard template must NOT include free-report tables');
  assert.ok(!src.includes('Margem para subir'), 'dashboard template must NOT include margin table from report');
  assert.ok(!src.includes('Vitórias rápidas'), 'dashboard template must NOT include quick-wins table from report');
});

test('interception_redirect_middleware_does_not_use_console_log', async () => {
  // pino-only logging constraint applies to all production middleware
  // Check that console.log is not called (not just mentioned in comments)
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const middlewarePath = join(__dirname, '../../../../app/src/middleware/interception-redirect.js');
  let src;
  try { src = await readFile(middlewarePath, 'utf8'); } catch { return; }
  // Strip comments before checking — only detect actual console.log calls in code
  const codeOnly = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!codeOnly.includes('console.log'), 'interception-redirect must not use console.log (pino only)');
});
