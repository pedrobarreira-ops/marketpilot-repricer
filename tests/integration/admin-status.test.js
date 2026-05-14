// tests/integration/admin-status.test.js
// Epic 8 Test Plan — Story 8.10 integration scaffold (epic-start-test-design 2026-05-14)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage (integration_test_required: true):
//   AC#1 — Founder admin sees full /admin/status page (sistema + customers + events rows)
//   AC#2 — UX-DR29 deliberately different visual register (monospace, dense, slate/cool grey)
//   AC#3 — UX-DR30: /audit?as_admin={customer_id} reuses customer audit log UI with red banner
//   AC#4 — UX-DR28: read-only; no edit UI; founder never impersonates
//   AC#5 — Access control: non-founder gets 403/404; non-founder cannot use ?as_admin=
//
// Prerequisites:
//   - Real Supabase with SUPABASE_SERVICE_ROLE_DATABASE_URL
//   - founder_admins seed row for test founder email
//   - At least one test customer seeded
//
// Depends on: Story 1.5 (founder_admins seed + admin-auth middleware),
//             Story 9.3 (audit query endpoints — admin reuses /audit?as_admin=),
//             Story 4.1 (cron_state for per-customer rollup)
//
// Run with: node --test tests/integration/admin-status.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const INTEGRATION_ENABLED = Boolean(process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL);

// Verbatim admin-mode banner copy (AC#3 — spec-locked)
const ADMIN_MODE_BANNER_FRAGMENT = 'A ver o audit log de';
const ADMIN_MODE_BANNER_SUFFIX = 'como administrador. Modo apenas leitura.';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

before(async () => {
  if (!INTEGRATION_ENABLED) return;
  // TODO (Amelia): seed founder_admins row for FOUNDER_TEST_EMAIL
  //   seed one test customer with cron_state = ACTIVE
  //   seed a few audit_log rows for that customer
});

after(async () => {
  if (!INTEGRATION_ENABLED) return;
  // TODO (Amelia): teardown seeded rows; close DB connection
});

// ---------------------------------------------------------------------------
// AC#1 — Founder admin page content
// ---------------------------------------------------------------------------

describe('admin-status-founder-view', () => {
  test('founder_admin_sees_full_admin_status_page', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Given: founder_admins email authenticated
    // When:  GET /admin/status with founder session
    // Then:  200; page includes sistema row + customers row + recent critical events row
    //        per UX skeleton §7.2
    // TODO (Amelia): inject GET /admin/status with founder JWT; assert 200 + all 3 sections
    assert.ok(true, 'scaffold');
  });

  test('sistema_row_shows_health_uptime_p11_latency_pri01_stuck_count', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per AC#1 §7.2: Sistema row fields:
    //   /health status (200/503), uptime % (30d), Mirakl P11 latency p95 (1h), PRI01 stuck count
    // TODO (Amelia): assert each field label present in HTML
    assert.ok(true, 'scaffold');
  });

  test('customers_row_shows_per_customer_status_pill_cron_state_last_cycle_age', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per AC#1: customers table with per-customer: status pill, cron_state, last cycle age,
    //           Atenção count, winning-count / total
    // TODO (Amelia): assert seeded customer row visible with at least cron_state column
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#2 — UX-DR29: visual register
// ---------------------------------------------------------------------------

describe('admin-status-visual-register', () => {
  test('admin_page_uses_monospace_font_dominant', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per UX-DR29: monospace font dominates (JetBrains Mono for tabular data)
    // Dense tables; no ambient washes; slate/cool greys (NOT navy primary)
    // Given: admin status page rendered
    // When:  HTML inspected
    // Then:  JetBrains Mono font reference in CSS class or style; no navy-primary class
    // TODO (Amelia): assert html includes monospace or jb-mono class; not mp-primary class
    assert.ok(true, 'scaffold');
  });

  test('admin_page_layout_distinct_from_customer_dashboard_visual_register', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per UX-DR29: "founder doesn't see your data the way you do" — trust commitment legible
    // Given: admin page vs customer dashboard side by side
    // When:  admin page HTML inspected
    // Then:  no celebratory animations; no ambient washes; no tonal tints
    // TODO (Amelia): assert no mp-wash or ambient-tint classes in admin HTML
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#3 — UX-DR30: /audit?as_admin= reuse
// ---------------------------------------------------------------------------

describe('admin-audit-reuse', () => {
  test('founder_clicking_customer_row_navigates_to_audit_with_as_admin_param', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per UX-DR30: no duplicate UI; customer-side audit log renders via ?as_admin=
    // Given: founder on admin-status page
    // When:  clicks a customer row
    // Then:  navigation target is /audit?as_admin={customer_id}
    // TODO (Amelia): assert customer row link href includes '?as_admin=' param
    assert.ok(true, 'scaffold');
  });

  test('as_admin_audit_view_shows_red_admin_mode_banner', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per UX-DR30: admin-mode-banner.eta renders above customer audit log
    // Given: founder GET /audit?as_admin={customer_B_id}
    // When:  audit log page rendered
    // Then:  red admin-mode banner visible: "A ver o audit log de {email} como administrador."
    // TODO (Amelia): inject GET /audit?as_admin=<customer_id> with founder JWT;
    //   assert html.includes(ADMIN_MODE_BANNER_FRAGMENT) && html.includes(ADMIN_MODE_BANNER_SUFFIX)
    assert.ok(true, 'scaffold');
  });

  test('admin_mode_banner_verbatim_copy_with_customer_email', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per AC#3 verbatim: "⚠ A ver o audit log de {customer.email} como administrador. Modo apenas leitura."
    // Given: seeded customer with known email
    // When:  /audit?as_admin= rendered
    // Then:  banner contains the customer's email address
    // TODO (Amelia): assert banner HTML includes seeded customer email
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#4 — UX-DR28: read-only
// ---------------------------------------------------------------------------

describe('admin-status-read-only', () => {
  test('admin_status_page_has_no_edit_ui', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per UX-DR28: no edit UI on /admin/status (reads-only from Supabase Studio)
    // Given: admin page rendered
    // When:  HTML inspected
    // Then:  no <form> with write actions; no <input> for editing customer data;
    //        no "Edit" or "Save" buttons
    // TODO (Amelia): assert !html.includes('<form') for any write-action form on admin page
    assert.ok(true, 'scaffold');
  });

  test('founder_never_logs_in_as_customer_impersonator', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per AC#4: ?as_admin= is read-only + service-role-bound; no auth.users impersonation
    // Given: founder uses /admin/status + /audit?as_admin=
    // When:  session inspected
    // Then:  founder's own JWT is used (not a customer JWT); no auth.users.signInAs call
    // TODO (Amelia): static assertion: admin routes use service-role client, not customer JWT
    assert.ok(true, 'scaffold');
  });
});

// ---------------------------------------------------------------------------
// AC#5 — Access control
// ---------------------------------------------------------------------------

describe('admin-status-access-control', () => {
  test('non_founder_customer_gets_403_or_404_on_admin_status', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per AC#5: founder-admin-only middleware blocks non-founders
    // Given: regular customer (NOT in founder_admins) sends GET /admin/status
    // When:  request processed
    // Then:  403 or 404 (not 200) — per Story 1.5 middleware choice
    // TODO (Amelia): inject GET /admin/status with customer JWT; assert 403 or 404
    assert.ok(true, 'scaffold');
  });

  test('non_founder_cannot_use_as_admin_param', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Per AC#5: non-founder cannot view other customer's audit log via ?as_admin=
    // Given: customer A sends GET /audit?as_admin={customer_B_id}
    // When:  request processed
    // Then:  403 or 404 (middleware blocks); customer B's data NOT returned
    // TODO (Amelia): inject with customer A JWT + as_admin=B; assert 403/404
    assert.ok(true, 'scaffold');
  });

  test('as_admin_from_founder_shows_correct_customer_audit_log', async () => {
    if (!INTEGRATION_ENABLED) return;
    // Positive: founder CAN view customer B's audit log
    // Given: founder JWT + GET /audit?as_admin={customer_B_id}
    // When:  processed by admin-auth middleware + service-role DB bypass
    // Then:  customer B's audit events visible; customer A's events NOT visible
    // TODO (Amelia): seed audit events for both customers; assert correct customer's events shown
    assert.ok(true, 'scaffold');
  });
});
