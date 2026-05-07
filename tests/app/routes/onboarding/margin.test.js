// Story 4.8 / AC#1-AC#4 — Margin question + smart-default mapping tests.
//
// Covers:
//   AC#1 — GET /onboarding/margin renders 4 radio bands (PT-localized)
//   AC#2 — Selecting <5% shows warning callout with 3 bullet recommendations
//           Submit blocked until "Compreendo e continuo" clicked
//   AC#3 — POST /onboarding/margin persists max_discount_pct per smart-default mapping:
//           <5%    → 0.005  |  5-10% → 0.01  |  10-15% → 0.02  |  15%+ → 0.03
//           max_increase_pct always → 0.05
//           Redirects to /
//   AC#4 — UX-DR2 forward-only: revisiting /onboarding/margin after margin set → 302 /
//
// Test harness: Node built-in test runner (node --test).
// DB client (req.db) is mocked — no real Supabase instance required.
// authMiddleware and rlsContext skip when req.user / req.db are already set
// (the route plugin checks this before calling the real middleware, so the
// global preHandler in buildApp() is sufficient to inject auth context).
//
// Run with: node --test tests/app/routes/onboarding/margin.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import FastifyFormbody from '@fastify/formbody';

// ---------------------------------------------------------------------------
// Smart-default mapping per Story 4.8 AC#3
// ---------------------------------------------------------------------------

const BAND_MAPPINGS = [
  { band: 'under_5', expectedMaxDiscount: 0.005 },
  { band: '5_10', expectedMaxDiscount: 0.01 },
  { band: '10_15', expectedMaxDiscount: 0.02 },
  { band: '15_plus', expectedMaxDiscount: 0.03 },
];

// ---------------------------------------------------------------------------
// Verbatim §9.10 copy fragments (AC#2)
// ---------------------------------------------------------------------------

const THIN_MARGIN_CALLOUT_TITLE = 'Margem abaixo de 5%';
const THIN_MARGIN_ACK_BUTTON = 'Compreendo e continuo';

// ---------------------------------------------------------------------------
// Helpers — mock DB factory
// ---------------------------------------------------------------------------

/**
 * Build a minimal req.db mock whose query() method returns rows in sequence.
 * Each call to makeDb([...rowSets]) pops the next rowSet for each query call.
 * Also captures UPDATE queries to allow post-test assertions.
 *
 * @param {Array<Array<object>>} rowSets - ordered list of row arrays to return per query call
 * @returns {{ query: Function, release: Function, updates: Array<{sql: string, params: Array}> }}
 */
function makeDb (rowSets) {
  let callIndex = 0;
  const updates = [];
  return {
    async query (sql, params) {
      // Capture UPDATE calls for assertion in persistence tests
      if (typeof sql === 'string' && sql.trimStart().toUpperCase().startsWith('UPDATE')) {
        updates.push({ sql, params });
      }
      const rows = rowSets[callIndex] ?? [];
      callIndex += 1;
      return { rows };
    },
    async release () {
      // no-op: tests don't use a real pg pool
    },
    updates,
  };
}

/**
 * Build a Fastify test app with marginRoutes registered, injecting the provided
 * req.db mock and a fixed req.user for every request.
 *
 * authMiddleware and rlsContext are bypassed by the route plugin itself:
 * margin.js checks whether req.user / req.db are already set before calling
 * the real middleware, so setting them in a global preHandler is sufficient.
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
    req.user = { id: userId, access_token: 'test-token', email: 'test@example.com' };
    req.db = db;
  });

  // Register @fastify/formbody so POST bodies are parsed (already registered in
  // app/src/server.js — this mirrors that setup for unit tests).
  await fastify.register(FastifyFormbody);

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
  const { marginRoutes } = await import('../../../../app/src/routes/onboarding/margin.js');
  await fastify.register(marginRoutes);

  await fastify.ready();
  return fastify;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** customer_marketplaces row: DRY_RUN, margin not yet set */
const DRY_RUN_NO_MARGIN_CM = {
  id: 'cm-uuid-1',
  cron_state: 'DRY_RUN',
  max_discount_pct: null,
};

/** customer_marketplaces row: DRY_RUN, margin already set */
const DRY_RUN_MARGIN_SET_CM = {
  id: 'cm-uuid-1',
  cron_state: 'DRY_RUN',
  max_discount_pct: 0.02,
};

/** customer_marketplaces row: PROVISIONING */
const PROVISIONING_CM = {
  id: 'cm-uuid-1',
  cron_state: 'PROVISIONING',
  max_discount_pct: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('margin-question', async (t) => {
  // ---------------------------------------------------------------------------
  // AC#1 — Page renders 4 radio bands
  // ---------------------------------------------------------------------------

  await t.test('margin_page_renders_4_radio_bands', async () => {
    // Given: DRY_RUN customer with no margin set
    // When:  GET /onboarding/margin
    // Then:  200 HTML with exactly 4 radio inputs:
    //        value="under_5", value="5_10", value="10_15", value="15_plus"
    //        and PT-localized labels (<5%, 5–10%, 10–15%, 15%+)
    //        and submit button "Confirmar margem" (initially disabled)

    const db = makeDb([
      [DRY_RUN_NO_MARGIN_CM], // query 1: customer_marketplaces forward-only guard
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/margin' });
      assert.equal(res.statusCode, 200, 'expected 200 for DRY_RUN customer with no margin set');
      assert.ok(res.headers['content-type'].includes('text/html'), 'expected HTML response');
      const html = res.body;

      // 4 radio inputs with correct values (AC#1)
      assert.ok(html.includes('value="under_5"'), 'radio value="under_5" missing');
      assert.ok(html.includes('value="5_10"'), 'radio value="5_10" missing');
      assert.ok(html.includes('value="10_15"'), 'radio value="10_15" missing');
      assert.ok(html.includes('value="15_plus"'), 'radio value="15_plus" missing');

      // Radio inputs are type="radio"
      assert.ok(html.includes('type="radio"'), 'radio input type missing');

      // PT-localized labels (AC#1) — labels are spec-locked verbatim per Story 4.8 AC#1.
      // Note: `<` is HTML-escaped to `&lt;` in the rendered template, so we accept
      // either the literal `<5%` (raw) or `&lt;5%` (escaped) form, but require the
      // exact `5%` boundary — not just any occurrence of `5%`.
      assert.ok(
        html.includes('&lt;5%') || html.includes('<5%'),
        'PT label "<5%" for under_5 band missing (expected literal or HTML-escaped)',
      );
      // `5–10%` uses an en-dash (U+2013) per spec. Accept ASCII `-` as a fallback
      // only because UX-skeleton variants sometimes emit `5-10%`.
      assert.ok(
        html.includes('5–10%') || html.includes('5-10%'),
        'PT label "5–10%" for 5_10 band missing (en-dash or ASCII hyphen)',
      );
      assert.ok(
        html.includes('10–15%') || html.includes('10-15%'),
        'PT label "10–15%" for 10_15 band missing (en-dash or ASCII hyphen)',
      );
      assert.ok(
        html.includes('15%+'),
        'PT label "15%+" for 15_plus band missing',
      );

      // None of the radios are pre-selected (AC#1 — customer must actively choose)
      // A pre-selected radio would have checked="checked" or just "checked"
      assert.ok(
        !html.includes('checked="checked"') && !html.match(/type="radio"[^>]*checked(?!\s*=\s*"false")/),
        'no radio should be pre-selected',
      );

      // Submit button "Confirmar margem" present (AC#1)
      assert.ok(
        html.includes('Confirmar margem'),
        '"Confirmar margem" submit button text missing',
      );

      // Submit button starts disabled (progressive enhancement, AC#1).
      // Match a <button ...> element that contains both id="margin-submit" and
      // a `disabled` attribute, in either order, to avoid matching a stray
      // `disabled` token elsewhere in the document.
      const submitDisabledRegex = /<button[^>]*\bid="margin-submit"[^>]*\bdisabled\b|<button[^>]*\bdisabled\b[^>]*\bid="margin-submit"/;
      assert.ok(
        submitDisabledRegex.test(html),
        'submit button (id="margin-submit") should have disabled attribute by default',
      );
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#2 — <5% warning callout
  // ---------------------------------------------------------------------------

  await t.test('selecting_under_5_pct_shows_warning_callout', async () => {
    // Given: GET /onboarding/margin for DRY_RUN customer
    // Then:  HTML contains the thin-margin warning callout element
    //        (may be hidden by default; JS reveals it on under_5 selection)
    //        Callout must include the §9.10 title and "Compreendo e continuo" button.

    const db = makeDb([
      [DRY_RUN_NO_MARGIN_CM],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/margin' });
      assert.equal(res.statusCode, 200, 'expected 200');
      const html = res.body;

      // Callout component is included in the DOM (AC#2 — hidden by CSS/JS toggle)
      assert.ok(
        html.includes('mp-thin-margin-callout') ||
        html.includes('smart-default-warning') ||
        html.includes(THIN_MARGIN_CALLOUT_TITLE),
        'thin-margin warning callout element missing from HTML',
      );

      // §9.10 title (AC#2 verbatim PT copy)
      assert.ok(
        html.includes(THIN_MARGIN_CALLOUT_TITLE),
        `callout title "${THIN_MARGIN_CALLOUT_TITLE}" missing`,
      );

      // "Compreendo e continuo" acknowledgement button (AC#2)
      assert.ok(
        html.includes(THIN_MARGIN_ACK_BUTTON),
        `callout acknowledgement button "${THIN_MARGIN_ACK_BUTTON}" missing`,
      );

      // §9.10 bullet copy fragments (AC#2 verbatim)
      assert.ok(
        html.includes('modo simulação') || html.includes('simulação') || html.includes('7+ dias'),
        '§9.10 first bullet (simulation mode / 7+ dias) missing',
      );
      assert.ok(
        html.includes('max_discount_pct = 0.5%') || html.includes('0.5%'),
        '§9.10 second bullet (max_discount_pct = 0.5%) missing',
      );
      assert.ok(
        html.includes('tier system') || html.includes('circuit breaker') || html.includes('≤15%'),
        '§9.10 third bullet (tier system + circuit breaker) missing',
      );

      // Hidden input for acknowledge field (AC#2 — keyboard-accessible)
      assert.ok(
        html.includes('name="acknowledge"') || html.includes('id="acknowledge-field"'),
        'hidden acknowledge input missing from form',
      );
    } finally {
      await app.close();
    }
  });

  await t.test('under_5_pct_requires_acknowledge_before_submit', async () => {
    // Given: POST /onboarding/margin with band=under_5 WITHOUT acknowledge=true
    // Then:  rejected (400 Bad Request OR re-render with error message)
    //        Server-side guard prevents unacknowledged submission (AC#2)

    const db = makeDb([]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/onboarding/margin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ band: 'under_5' }).toString(),
      });

      // Server must reject: either 400 or re-render (200 with error)
      // The spec says: respond with 400 or re-render the margin page with callout pre-expanded
      const isRejected = res.statusCode === 400 || res.statusCode === 200;
      assert.ok(
        isRejected,
        `expected 400 or 200 re-render for under_5 without acknowledge; got ${res.statusCode}`,
      );

      if (res.statusCode === 200) {
        // Re-render must include an error indication (callout pre-expanded or error message)
        const html = res.body;
        const hasErrorIndication =
          html.includes('Por favor confirma') ||
          html.includes('Compreendo e continuo') ||
          html.includes('mp-thin-margin-callout') ||
          html.includes('aviso');
        assert.ok(
          hasErrorIndication,
          're-render on unacknowledged under_5 must include callout/error indication',
        );
      }

      // Either way: must NOT have redirected to /
      assert.notEqual(res.statusCode, 302, 'must NOT redirect to / without acknowledgement');
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#3 — Smart-default mapping persistence
  // ---------------------------------------------------------------------------

  for (const { band, expectedMaxDiscount } of BAND_MAPPINGS) {
    // Generate acknowledgement payload for under_5 band (AC#2 server-side guard)
    const isUnder5 = band === 'under_5';
    const testName = `submit_${band}_persists_${String(expectedMaxDiscount).replace('.', '')}_max_discount`;

    await t.test(testName, async () => {
      // Given: authenticated DRY_RUN customer with no margin set
      // When:  POST /onboarding/margin with correct band (+ acknowledge for under_5)
      // Then:  UPDATE customer_marketplaces sets max_discount_pct = expectedMaxDiscount

      const db = makeDb([
        [], // UPDATE returns no rows (no SELECT needed for write path)
      ]);
      const app = await buildApp({ db });
      try {
        const payload = isUnder5
          ? new URLSearchParams({ band, acknowledge: 'true' }).toString()
          : new URLSearchParams({ band }).toString();

        const res = await app.inject({
          method: 'POST',
          url: '/onboarding/margin',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          payload,
        });

        // Must redirect to dashboard root on success (AC#3)
        assert.equal(
          res.statusCode,
          302,
          `expected 302 redirect on successful band submission for ${band}; got ${res.statusCode}`,
        );
        assert.equal(res.headers.location, '/', `expected redirect to /; got ${res.headers.location}`);

        // Assert max_discount_pct was set correctly in the UPDATE query
        assert.equal(db.updates.length, 1, 'expected exactly 1 UPDATE query');
        const { params } = db.updates[0];
        assert.ok(params, 'UPDATE params must not be null');
        // First param should be max_discount_pct
        assert.equal(
          params[0],
          expectedMaxDiscount,
          `max_discount_pct: expected ${expectedMaxDiscount} for band "${band}", got ${params[0]}`,
        );
      } finally {
        await app.close();
      }
    });
  }

  await t.test('submit_persists_005_max_increase_global_default', async () => {
    // Given: any band submission
    // Then:  max_increase_pct = 0.05 always (global default, AC#3)

    const db = makeDb([[]]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/onboarding/margin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ band: '5_10' }).toString(),
      });

      assert.equal(res.statusCode, 302, `expected 302 on success; got ${res.statusCode}`);
      assert.equal(db.updates.length, 1, 'expected exactly 1 UPDATE query');

      const { params } = db.updates[0];
      assert.ok(params, 'UPDATE params must not be null');
      // max_increase_pct is the second param (0.05 hardcoded per AC#3)
      // params: [$1=max_discount_pct, $2=max_increase_pct (0.05), $3=customer_id]
      const maxIncreasePct = params[1];
      assert.equal(
        maxIncreasePct,
        0.05,
        `max_increase_pct must always be 0.05 (global default); got ${maxIncreasePct}`,
      );
    } finally {
      await app.close();
    }
  });

  await t.test('submit_redirects_to_dashboard_root', async () => {
    // Given: valid POST /onboarding/margin with a valid band
    // Then:  302 → / (dashboard root, Story 4.9)

    const db = makeDb([[]]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/onboarding/margin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ band: '10_15' }).toString(),
      });

      assert.equal(res.statusCode, 302, `expected 302 redirect to /; got ${res.statusCode}`);
      assert.equal(
        res.headers.location,
        '/',
        `expected redirect to /; got ${res.headers.location}`,
      );
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#4 — UX-DR2 forward-only
  // ---------------------------------------------------------------------------

  await t.test('ux_dr2_forward_only_blocks_revisit_after_margin_set', async () => {
    // Given: DRY_RUN customer with max_discount_pct already set (IS NOT NULL)
    // When:  GET /onboarding/margin
    // Then:  302 → / (margin already configured — forward to dashboard)
    // This resolves the Phase 2 forward-only guard note left in Story 4.7

    const db = makeDb([
      [DRY_RUN_MARGIN_SET_CM], // max_discount_pct IS NOT NULL
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/margin' });
      assert.equal(res.statusCode, 302, 'expected 302 redirect for customer with margin already set');
      assert.equal(
        res.headers.location,
        '/',
        `expected redirect to /; got ${res.headers.location}`,
      );
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Additional AC#4 routing guards (coverage of full guard table in AC#4)
  // ---------------------------------------------------------------------------

  await t.test('ux_dr2_provisioning_redirects_to_scan', async () => {
    // Given: customer with cron_state = 'PROVISIONING' (scan not yet done)
    // When:  GET /onboarding/margin
    // Then:  302 → /onboarding/scan

    const db = makeDb([
      [PROVISIONING_CM],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/margin' });
      assert.equal(res.statusCode, 302, 'expected 302 redirect for PROVISIONING customer');
      assert.equal(
        res.headers.location,
        '/onboarding/scan',
        `expected redirect to /onboarding/scan for PROVISIONING; got ${res.headers.location}`,
      );
    } finally {
      await app.close();
    }
  });

  await t.test('ux_dr2_no_cm_row_redirects_to_scan', async () => {
    // Given: no customer_marketplaces row for this customer
    // When:  GET /onboarding/margin
    // Then:  302 → /onboarding/scan (treat same as PROVISIONING)

    const db = makeDb([
      [], // no customer_marketplaces row
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/margin' });
      assert.equal(res.statusCode, 302, 'expected 302 redirect when no CM row');
      assert.equal(
        res.headers.location,
        '/onboarding/scan',
        `expected redirect to /onboarding/scan when no CM row; got ${res.headers.location}`,
      );
    } finally {
      await app.close();
    }
  });

  await t.test('ux_dr2_active_state_redirects_to_dashboard', async () => {
    // Given: customer with cron_state = 'ACTIVE' (fully live)
    // When:  GET /onboarding/margin
    // Then:  302 → / (AC#4 — any ACTIVE or PAUSED_* → /)

    const db = makeDb([
      [{ id: 'cm-uuid-1', cron_state: 'ACTIVE', max_discount_pct: 0.02 }],
    ]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({ method: 'GET', url: '/onboarding/margin' });
      assert.equal(res.statusCode, 302, 'expected 302 redirect for ACTIVE customer');
      assert.equal(
        res.headers.location,
        '/',
        `expected redirect to / for ACTIVE cron_state; got ${res.headers.location}`,
      );
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#3 — Invalid band rejected (Fastify JSON Schema validation)
  // ---------------------------------------------------------------------------

  await t.test('invalid_band_rejected_with_400', async () => {
    // Given: POST /onboarding/margin with an invalid band value
    // When:  Fastify JSON Schema validation (MARGIN_POST_SCHEMA) runs
    // Then:  400 Bad Request (Fastify auto-rejects before handler runs)

    const db = makeDb([]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/onboarding/margin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ band: 'invalid_band_value' }).toString(),
      });

      assert.equal(res.statusCode, 400, `invalid band must return 400; got ${res.statusCode}`);
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#3 — under_5 with acknowledge=true is accepted
  // ---------------------------------------------------------------------------

  await t.test('under_5_with_acknowledge_true_is_accepted', async () => {
    // Given: POST /onboarding/margin with band=under_5 AND acknowledge=true
    // When:  server-side guard passes (acknowledge present and truthy)
    // Then:  302 → / (success — not rejected)

    const db = makeDb([[]]);
    const app = await buildApp({ db });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/onboarding/margin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({ band: 'under_5', acknowledge: 'true' }).toString(),
      });

      assert.equal(
        res.statusCode,
        302,
        `under_5 with acknowledge=true must succeed (302); got ${res.statusCode}`,
      );
      assert.equal(res.headers.location, '/', `expected redirect to /; got ${res.headers.location}`);
    } finally {
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#3 — No writeAuditEvent / transitionCronState called (static guard)
  // ---------------------------------------------------------------------------

  await t.test('margin_route_does_not_call_write_audit_event_or_transition_cron_state', async () => {
    // Static assertion: app/src/routes/onboarding/margin.js must NOT import or
    // call writeAuditEvent (no AD20 event type for margin configuration) and
    // must NOT call transitionCronState (cron_state stays DRY_RUN).
    // This enforces AC#3 Critical Constraints 1 and 2.

    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const routePath = join(__dirname, '../../../../app/src/routes/onboarding/margin.js');

    let routeSrc;
    try {
      routeSrc = await readFile(routePath, 'utf8');
    } catch {
      // File does not exist yet (pre-dev ATDD stub) — skip static check
      return;
    }

    assert.ok(
      !routeSrc.includes('writeAuditEvent'),
      'margin.js must NOT call writeAuditEvent (no AD20 event type for margin configuration)',
    );
    assert.ok(
      !routeSrc.includes('transitionCronState'),
      'margin.js must NOT call transitionCronState (cron_state stays DRY_RUN, no state transition here)',
    );
  });
});
