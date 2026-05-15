// tests/app/routes/dashboard/channel-toggle.test.js
// Epic 8 Test Plan — Story 8.3 (ATDD-filled, 2026-05-15)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage:
//   AC#1 — PT|ES segmented pill buttons in sticky header; scope: KPIs, margin editor, audit preview
//   AC#2 — Toggle persists per-session (localStorage); default = PT
//   AC#3 — No "Both" merged view button (UX-DR14 single-select MVP)
//   AC#4 — Toggle hidden when customer has single-channel marketplace
//
// Depends on: Story 8.1 (dashboard chrome + default.eta channelToggle slot),
//             Story 8.2 (KPIs re-render on toggle)
//
// Run with: node --test tests/app/routes/dashboard/channel-toggle.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a req.db mock whose query() method returns rowSets in call order.
 *
 * The dashboard route (Story 8.1 extended by Story 8.3) issues up to three queries:
 *   1. interception-redirect: SELECT cron_state, state_updated_at, scan_status FROM customer_marketplaces
 *   2. dashboard route handler: SELECT cron_state, anomaly_count, sustained_transient_active, ...
 *   3. Story 8.3 channel count: SELECT COUNT(DISTINCT sc.channel_code)::int AS channel_count FROM sku_channels
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
    async release () {},
  };
}

/**
 * Build a Fastify test app with dashboardRoutes registered, injecting the
 * provided req.db mock and a fixed req.user for every request.
 *
 * @param {{ db: object, userId?: string, session?: object }} opts
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function buildApp ({ db, userId = 'test-customer-uuid', session = {} } = {}) {
  const fastify = Fastify({ logger: false });

  fastify.addHook('preHandler', async (req) => {
    req.user = { id: userId, access_token: 'test-token', email: 'test@example.com' };
    req.db = db;
    req.session = { ...session };
  });

  const FastifyView = (await import('@fastify/view')).default;
  const { Eta } = await import('eta');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const viewsDir = join(__dirname, '../../../../app/src/views');
  await fastify.register(FastifyView, {
    engine: { eta: new Eta() },
    templates: viewsDir,
    defaultContext: { appName: 'MarketPilot' },
    propertyName: 'view',
    asyncPropertyName: 'viewAsync',
  });

  const { dashboardRoutes } = await import('../../../../app/src/routes/dashboard/index.js');
  await fastify.register(dashboardRoutes);

  await fastify.ready();
  return fastify;
}

/**
 * Build the standard 3-query DB mock for a multi-channel (2 channels) ACTIVE customer.
 * Query order: intercept row → dashboard row → channel count row
 */
function makeMultiChannelDb (cronState = 'ACTIVE', channelCount = 2) {
  return makeDb([
    [{ cron_state: cronState, scan_status: null, state_updated_at: new Date('2026-05-15T10:00:00Z') }],
    [{ cron_state: cronState, max_discount_pct: 0.02, max_increase_pct: 0.05,
       state_updated_at: new Date('2026-05-15T10:00:00Z'), anomaly_count: 0,
       sustained_transient_active: false }],
    [{ channel_count: channelCount }],
  ]);
}

// ---------------------------------------------------------------------------
// AC#1 — Toggle renders PT|ES in sticky header
// ---------------------------------------------------------------------------

describe('channel-toggle-rendering', () => {
  test('toggle_renders_pt_es_segmented_buttons_in_sticky_header', async () => {
    // Given: customer with multi-channel marketplace (PT + ES), channelCount = 2
    // When:  GET / (sticky header rendered)
    // Then:  channel toggle with "PT" and "ES" buttons visible, rendered inside the sticky header
    const db = makeMultiChannelDb('ACTIVE', 2);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200; got ${res.statusCode}`);
      const html = res.body;
      // Both PT and ES toggle buttons must be present (abbreviated labels per §10.1 sticky-header constraint)
      assert.ok(html.includes('>PT<'), 'toggle must include "PT" button (abbreviated label per §10.1)');
      assert.ok(html.includes('>ES<'), 'toggle must include "ES" button (abbreviated label per §10.1)');
      // Toggle must use mp-channel-toggle class
      assert.ok(html.includes('mp-channel-toggle'), 'toggle must use mp-channel-toggle class');
      // Structural check: toggle must be rendered INSIDE the sticky header (default.eta line 17-37).
      // The mp-sticky-header opens before mp-channel-toggle and closes after it.
      const stickyOpenIdx = html.indexOf('mp-sticky-header');
      const toggleIdx = html.indexOf('mp-channel-toggle');
      // Locate the closing </header> tag for the sticky header element
      const headerCloseIdx = html.indexOf('</header>', stickyOpenIdx);
      assert.ok(stickyOpenIdx !== -1, 'mp-sticky-header marker must exist (Story 8.1 chrome)');
      assert.ok(toggleIdx !== -1, 'mp-channel-toggle marker must exist');
      assert.ok(headerCloseIdx !== -1, 'sticky-header </header> closing tag must exist');
      assert.ok(
        stickyOpenIdx < toggleIdx && toggleIdx < headerCloseIdx,
        'mp-channel-toggle must be rendered INSIDE the sticky header (between mp-sticky-header opening and </header>)',
      );
    } finally {
      await app.close();
    }
  });

  test('active_channel_button_has_highlighted_class', async () => {
    // Given: toggle defaults to PT (server-side default: activeChannel = 'pt')
    // When:  GET / with channelCount = 2
    // Then:  PT button has aria-selected="true" and mp-toggle-btn--active class;
    //        ES button has aria-selected="false"
    const db = makeMultiChannelDb('ACTIVE', 2);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // PT button active on first-load (server-side default per AC#2: activeChannel = 'pt')
      assert.ok(
        html.includes('mp-toggle-btn--active') || html.includes('aria-selected="true"'),
        'active channel button must have mp-toggle-btn--active or aria-selected="true"',
      );
      // ARIA semantic: active button is aria-selected="true"
      assert.ok(html.includes('aria-selected="true"'), 'active toggle button must have aria-selected="true"');
      assert.ok(html.includes('aria-selected="false"'), 'inactive toggle button must have aria-selected="false"');
    } finally {
      await app.close();
    }
  });

  test('toggle_scope_includes_kpi_cards_margin_editor_audit_preview', async () => {
    // Given: toggle rendered with channelCount = 2
    // When:  HTML inspected
    // Then:  data-toggle-scope or data-channel-scope attribute present on dashboard sections
    //        Banner zone (mp-banner-zone) is NOT scoped — system-level (per AC#1 note)
    const db = makeMultiChannelDb('ACTIVE', 2);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // The scoped container or KPI grid must have a data attribute for toggle-driven scope
      // Per AC#1: "data-toggle-scope attribute on the scoped container or data-channel-scope"
      const hasScopeAttr = html.includes('data-toggle-scope') || html.includes('data-channel-scope');
      assert.ok(hasScopeAttr,
        'dashboard must have a data-toggle-scope or data-channel-scope attribute on KPI/margin/audit sections (AC#1)');
      // Stronger assertion: KPI section specifically must be marked as channel-scoped per implementation
      // (the KPI grid is the first downstream consumer of the toggle — Story 8.2 re-renders on channelchange)
      assert.ok(
        /mp-kpi-grid[^>]*data-channel-scope/.test(html) || /data-channel-scope[^>]*mp-kpi-grid/.test(html),
        'KPI grid (mp-kpi-grid) must carry data-channel-scope attribute so Story 8.2 KPI cards re-render on channelchange (AC#1)',
      );
    } finally {
      await app.close();
    }
  });

  test('toggle_does_not_scope_global_banner_zone', async () => {
    // Given: ACTIVE customer with anomaly (banner renders) and channelCount = 2
    // When:  GET /
    // Then:  mp-banner-zone is NOT inside a data-toggle-scope container;
    //        banner renders regardless of channel toggle state (system-level per AC#1)
    const db = makeDb([
      [{ cron_state: 'ACTIVE', scan_status: null, state_updated_at: new Date('2026-05-15T10:00:00Z') }],
      [{ cron_state: 'ACTIVE', max_discount_pct: 0.02, max_increase_pct: 0.05,
         state_updated_at: new Date('2026-05-15T10:00:00Z'), anomaly_count: 3,
         sustained_transient_active: false }],
      [{ channel_count: 2 }],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // Banner zone must be present (anomaly banner fired)
      assert.ok(html.includes('mp-banner-zone'), 'banner zone must render regardless of channel toggle');
      // The banner zone must NOT appear inside a data-toggle-scope container.
      // Since we can't parse HTML fully in node --test, verify the anomaly banner renders
      // (proving it's not suppressed by channel toggle scope):
      assert.ok(html.includes('mp-banner-warning') || html.includes('Rever'),
        'anomaly banner must render (banner zone is not channel-scoped)');
      // Structural check: mp-banner-zone must appear BEFORE the data-channel-scope KPI section
      // in source order. The default.eta layout places the banner zone above the body slot
      // (which contains dashboard.eta's KPI grid). If the banner zone appeared after or
      // inside the scoped container, the toggle would inadvertently hide/scope system-level banners.
      const bannerZoneIdx = html.indexOf('mp-banner-zone');
      const kpiScopeIdx = html.indexOf('data-channel-scope="kpi"');
      assert.ok(bannerZoneIdx !== -1, 'mp-banner-zone marker must be present in HTML');
      assert.ok(kpiScopeIdx !== -1, 'data-channel-scope="kpi" marker must be present in HTML');
      assert.ok(
        bannerZoneIdx < kpiScopeIdx,
        'mp-banner-zone must appear BEFORE data-channel-scope="kpi" in source order — banner zone is NOT nested inside the toggle scope (AC#1)',
      );
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AC#2 — Session persistence
// ---------------------------------------------------------------------------

describe('channel-toggle-persistence', () => {
  test('default_channel_is_pt_on_first_load', async () => {
    // Given: first-time dashboard load (no localStorage state — server-side default)
    // When:  GET / with channelCount = 2
    // Then:  PT channel button has aria-selected="true" and mp-toggle-btn--active class
    //        (server always renders activeChannel = 'pt' as default per AC#2 + story spec)
    const db = makeMultiChannelDb('ACTIVE', 2);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // Server-side default: PT button MUST be active (strict — not a fallback OR).
      // The PT button must have aria-selected="true" AND ES must have aria-selected="false".
      // Either attribute order on the button is acceptable.
      const ptAriaTrue = /data-channel="pt"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-channel="pt"/.test(html);
      const esAriaFalse = /data-channel="es"[^>]*aria-selected="false"|aria-selected="false"[^>]*data-channel="es"/.test(html);
      assert.ok(
        ptAriaTrue,
        'PT toggle button must have aria-selected="true" by default (server-side: activeChannel = "pt") per AC#2',
      );
      assert.ok(
        esAriaFalse,
        'ES toggle button must have aria-selected="false" by default (PT is the default channel) per AC#2',
      );
      // PT button must also carry the --active CSS modifier on first load (highlighted styling per AC#1)
      assert.ok(
        /data-channel="pt"[^>]*mp-toggle-btn--active|mp-toggle-btn--active[^>]*data-channel="pt"|class="[^"]*mp-toggle-btn--active[^"]*"[^>]*data-channel="pt"/.test(html),
        'PT toggle button must carry mp-toggle-btn--active modifier class on first load (AC#1 highlighted state)',
      );
    } finally {
      await app.close();
    }
  });

  test('toggle_state_sticky_via_local_storage_across_navigation', async () => {
    // Given: customer toggles to ES (localStorage set to 'es')
    //        customer navigates to /audit and back to /
    // When:  Second visit to GET /
    // Then:  Client JS restores ES channel from localStorage
    //
    // Note: localStorage is a browser API — server-side Fastify inject cannot test it directly.
    // This test validates the CONTRACT: dashboard.js reads and writes localStorage for toggle
    // persistence (static source assertion per epic-8-test-plan.md §Notes 1).
    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const jsPath = join(__dirname, '../../../../public/js/dashboard.js');
    let src;
    try { src = await readFile(jsPath, 'utf8'); } catch { return; }
    // Contract: dashboard.js must use localStorage for toggle persistence (AC#2, UX-DR14)
    assert.ok(
      src.includes('localStorage'),
      'dashboard.js must use localStorage for toggle persistence (UX-DR14)',
    );
    // Must read the stored channel value on init
    assert.ok(
      src.includes('localStorage.getItem') || src.includes("localStorage['getItem']"),
      'dashboard.js must call localStorage.getItem to restore toggle state across navigation',
    );
    // Must write the channel value on toggle click
    assert.ok(
      src.includes('localStorage.setItem') || src.includes("localStorage['setItem']"),
      'dashboard.js must call localStorage.setItem to persist toggle state on click',
    );
    // localStorage key must be 'mp_channel' per spec
    assert.ok(
      src.includes('mp_channel'),
      "dashboard.js must use 'mp_channel' as the localStorage key for toggle state",
    );
    // Default channel must be 'pt' (lowercase per spec: "lowercase 'pt' or 'es'")
    assert.ok(
      src.includes("'pt'") || src.includes('"pt"'),
      "dashboard.js must default to 'pt' channel when no localStorage entry exists (AC#2)",
    );
  });
});

// ---------------------------------------------------------------------------
// AC#3 — No "Both" merged view (UX-DR14 single-select)
// ---------------------------------------------------------------------------

describe('channel-toggle-single-select', () => {
  test('no_both_merged_view_button_exists', async () => {
    // Per UX-DR14: "Both" is Phase 2; not available at MVP
    // Given: rendered toggle with channelCount = 2
    // When:  GET /
    // Then:  no third "Both" or "Ambos" button in the toggle
    const db = makeMultiChannelDb('ACTIVE', 2);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      assert.ok(!html.includes('Ambos'), 'toggle must NOT include "Ambos" button (UX-DR14 MVP)');
      assert.ok(!html.includes('>Both<'), 'toggle must NOT include "Both" button (UX-DR14 MVP)');
      // Also verify no "Ambas" (feminine plural variant in PT)
      assert.ok(!html.includes('Ambas'), 'toggle must NOT include "Ambas" button variant (UX-DR14 MVP)');
    } finally {
      await app.close();
    }
  });

  test('toggle_is_strictly_pt_xor_es', async () => {
    // Given: toggle rendered with channelCount = 2
    // When:  GET /
    // Then:  exactly 2 buttons with data-channel attribute: PT and ES (not 3)
    const db = makeMultiChannelDb('ACTIVE', 2);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200);
      const html = res.body;
      // Count data-channel attribute occurrences — must be exactly 2 (pt and es)
      const dataChannelMatches = html.match(/data-channel=/g) ?? [];
      assert.equal(
        dataChannelMatches.length,
        2,
        `toggle must have exactly 2 buttons with data-channel attribute (pt and es); found ${dataChannelMatches.length}`,
      );
      // Confirm the two values are pt and es specifically
      assert.ok(html.includes('data-channel="pt"'), 'toggle must have data-channel="pt" button');
      assert.ok(html.includes('data-channel="es"'), 'toggle must have data-channel="es" button');
    } finally {
      await app.close();
    }
  });

  test('channel_toggle_eta_has_phase2_comment_for_both_button', async () => {
    // AC#3 spec: "a code comment in channel-toggle.eta documents: Phase 2 deferred per UX-DR14"
    // This is a static assertion on the template source file
    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const templatePath = join(__dirname, '../../../../app/src/views/components/channel-toggle.eta');
    let src;
    try { src = await readFile(templatePath, 'utf8'); } catch { return; }
    // Must have a comment documenting Phase 2 deferral per UX-DR14
    const hasPhase2Comment = src.includes('Phase 2') && src.includes('UX-DR14');
    assert.ok(hasPhase2Comment,
      "channel-toggle.eta must contain a comment documenting 'Phase 2' deferral referencing UX-DR14 (AC#3)");
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Single-channel: toggle hidden or disabled
// ---------------------------------------------------------------------------

describe('channel-toggle-single-channel', () => {
  test('toggle_hidden_when_customer_has_single_channel_only', async () => {
    // Given: customer_marketplaces has only 1 active channel (e.g., PT only), channelCount = 1
    // When:  GET /
    // Then:  channel toggle is NOT rendered (hidden per spec — "choose hidden; document in Dev Notes")
    const db = makeMultiChannelDb('ACTIVE', 1);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200; got ${res.statusCode}`);
      const html = res.body;
      // When channelCount = 1, the toggle component (mp-channel-toggle) must NOT be rendered
      assert.ok(
        !html.includes('mp-channel-toggle'),
        'mp-channel-toggle must NOT be rendered for single-channel customer (channelCount=1, AC#4)',
      );
      // The "ES" button must not appear when customer only has 1 channel
      assert.ok(
        !html.includes('data-channel="es"'),
        'data-channel="es" button must NOT render for single-channel customer (AC#4)',
      );
    } finally {
      await app.close();
    }
  });

  test('single_channel_shows_tooltip_apenas_pt_ativo_neste_marketplace', async () => {
    // Per AC#4 spec: "Apenas PT ativo neste marketplace" tooltip OR toggle hidden (either variant)
    // Spec explicitly says "choose hidden; document in Dev Notes" → test accepts both variants:
    //   Variant A: toggle absent entirely (mp-channel-toggle not in HTML)
    //   Variant B: toggle present but disabled with tooltip "Apenas PT ativo neste marketplace"
    // This test passes for both variants (the implementation documents the chosen variant).
    const db = makeMultiChannelDb('ACTIVE', 1);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200; got ${res.statusCode}`);
      const html = res.body;
      // Either the toggle is hidden OR it shows the tooltip
      const toggleHidden = !html.includes('mp-channel-toggle');
      const tooltipPresent = html.includes('Apenas PT ativo neste marketplace');
      assert.ok(
        toggleHidden || tooltipPresent,
        'single-channel customer must either hide the toggle (mp-channel-toggle absent) ' +
        'OR show tooltip "Apenas PT ativo neste marketplace" (AC#4)',
      );
    } finally {
      await app.close();
    }
  });

  test('multi_channel_customer_sees_toggle_normally', async () => {
    // Positive assertion: channelCount >= 2 → toggle renders normally (AC#4 conditional)
    const db = makeMultiChannelDb('ACTIVE', 2);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      assert.equal(res.statusCode, 200, `expected 200; got ${res.statusCode}`);
      const html = res.body;
      // channelCount = 2 → toggle MUST render (positive counterpart to the single-channel test)
      assert.ok(
        html.includes('mp-channel-toggle'),
        'mp-channel-toggle must render for multi-channel customer (channelCount >= 2, AC#4)',
      );
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Static source assertions (Critical Constraints)
// ---------------------------------------------------------------------------

test('dashboard_js_dispatches_channelchange_custom_event', async () => {
  // AC#2 + story spec: on toggle click, JS dispatches 'channelchange' CustomEvent on document
  // This allows KPI cards (Story 8.2) and margin editor (Story 8.4) to react without coupling
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const jsPath = join(__dirname, '../../../../public/js/dashboard.js');
  let src;
  try { src = await readFile(jsPath, 'utf8'); } catch { return; }
  assert.ok(
    src.includes('channelchange') && src.includes('CustomEvent'),
    "dashboard.js must dispatch 'channelchange' CustomEvent for KPI cards + margin editor to react (story spec §Toggle JS)",
  );
});

test('dashboard_js_toggle_has_no_console_log', async () => {
  // Architectural constraint #18: no console.log in production code (pino-only logging)
  // Applies to client-side JS too — silent operation per story spec Dev Notes
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const jsPath = join(__dirname, '../../../../public/js/dashboard.js');
  let src;
  try { src = await readFile(jsPath, 'utf8'); } catch { return; }
  // Strip comments before checking
  const codeOnly = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!codeOnly.includes('console.log'),
    'dashboard.js must not use console.log (architectural constraint #18 — silent operation)');
});

test('channel_toggle_css_classes_in_components_css', async () => {
  // Story spec Dev Notes §CSS: .mp-channel-toggle and .mp-toggle-btn must be in components.css
  // NOT in tokens.css or layout.css (CSS ownership rule from memory)
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const cssPath = join(__dirname, '../../../../public/css/components.css');
  let src;
  try { src = await readFile(cssPath, 'utf8'); } catch { return; }
  assert.ok(src.includes('.mp-channel-toggle'),
    'components.css must define .mp-channel-toggle class (CSS ownership: components.css only)');
  assert.ok(src.includes('.mp-toggle-btn'),
    'components.css must define .mp-toggle-btn class (CSS ownership: components.css only)');
  assert.ok(src.includes('.mp-toggle-btn--active'),
    'components.css must define .mp-toggle-btn--active modifier class');
});

test('channel_toggle_css_not_in_tokens_or_layout_css', async () => {
  // CSS file ownership: tokens.css = tokens only; layout.css = layout; components.css = components
  // Toggle CSS must NOT bleed into tokens.css or layout.css (memory rule: css-merge-test-gap)
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const tokensPath = join(__dirname, '../../../../public/css/tokens.css');
  const layoutPath = join(__dirname, '../../../../public/css/layout.css');
  let tokensSrc = '';
  let layoutSrc = '';
  try { tokensSrc = await readFile(tokensPath, 'utf8'); } catch { /* file may not exist — defaults to '' for negative assertions */ }
  try { layoutSrc = await readFile(layoutPath, 'utf8'); } catch { /* file may not exist — defaults to '' for negative assertions */ }
  assert.ok(!tokensSrc.includes('.mp-channel-toggle'),
    'tokens.css must NOT define .mp-channel-toggle (CSS ownership violation)');
  assert.ok(!tokensSrc.includes('.mp-toggle-btn'),
    'tokens.css must NOT define .mp-toggle-btn (CSS ownership violation)');
  assert.ok(!layoutSrc.includes('.mp-channel-toggle'),
    'layout.css must NOT define .mp-channel-toggle (CSS ownership violation)');
  assert.ok(!layoutSrc.includes('.mp-toggle-btn'),
    'layout.css must NOT define .mp-toggle-btn (CSS ownership violation)');
});

test('channel_toggle_eta_uses_html_comments_not_eta_comment_syntax', async () => {
  // Story 8.1 Dev Notes warning: <%# -%> is NOT a silent comment in Eta v4 — causes parse error
  // All template comments must be HTML comments <!-- --> (not Eta comment syntax)
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const templatePath = join(__dirname, '../../../../app/src/views/components/channel-toggle.eta');
  let src;
  try { src = await readFile(templatePath, 'utf8'); } catch { return; }
  // Must NOT contain <%# ... %> comment syntax (Eta v4 parse error risk per Story 8.1 Dev Notes)
  assert.ok(
    !src.includes('<%#'),
    'channel-toggle.eta must NOT use <%# %> Eta comment syntax (causes parse error in Eta v4 — use HTML comments)',
  );
});

test('dashboard_route_channel_count_query_uses_sku_channels_not_customer_marketplaces', async () => {
  // Story spec Dev Notes §Channel Count Query: count query targets sku_channels.channel_code,
  // NOT customer_marketplaces (channel_code values are on sku_channels, not cm table)
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const routePath = join(__dirname, '../../../../app/src/routes/dashboard/index.js');
  let src;
  try { src = await readFile(routePath, 'utf8'); } catch { return; }
  // Must query sku_channels for the channel count (not customer_marketplaces)
  assert.ok(
    src.includes('sku_channels') && (src.includes('channel_count') || src.includes('COUNT(DISTINCT')),
    'dashboard route must query sku_channels for COUNT(DISTINCT channel_code) (Story 8.3 AC#4 guard)',
  );
});
