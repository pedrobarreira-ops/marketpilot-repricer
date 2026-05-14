# Story 8.1: Dashboard Root State-Aware View + Sticky Header Chrome

**Sprint-status key:** `8-1-dashboard-root-state-aware-view-sticky-header-chrome`
**Status:** ready-for-dev
**Size:** L
**Epic:** Epic 8 — Customer Dashboard & Surfaces
**Atomicity:** Bundle B — dashboard chrome surface; interception-redirect logic; banner library consumer
**Depends on:** Story 4.9 (minimal stub being replaced), Story 4.1 (cron_state schema + `transitionCronState`), Story 4.2 (sku_channels), Story 9.0 (audit foundation, writeAuditEvent), Story 9.1 (audit_log partitioning)
**Enables:** Stories 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9 (all surface inside dashboard chrome)

---

## Narrative

**As a** customer who has completed onboarding (key → scan → margin),
**I want** the dashboard root `/` to display a state-aware view matching my current repricing state (DRY_RUN, ACTIVE, PAUSED_BY_CUSTOMER, PAUSED_BY_PAYMENT_FAILURE, PAUSED_BY_CIRCUIT_BREAKER, PAUSED_BY_KEY_REVOKED, PAUSED_BY_ACCOUNT_GRACE_PERIOD),
**So that** I always land in the right context with the right actions available and interception pages override when critical account conditions require my attention.

---

## Trace

- **Architecture decisions:** AD15 (cron_state-driven banner stack surfacing), UX-DR2 (forward-only), UX-DR3 (interception override), UX-DR13 (KPI card visual treatment carries; report narrative arc does NOT), UX-DR32 (first-time interception per state-transition)
- **FRs:** FR30 (dry-run state), FR34 partial (dashboard chrome — KPI cards data in 8.2), FR35 partial (toggle UI in 8.3)
- **NFRs:** NFR-P7 (≤2s broadband), NFR-A1 (WCAG 2.1 AA), NFR-A2 (keyboard accessibility), NFR-L1 (PT default)
- **UX-DRs:** UX-DR2, UX-DR3, UX-DR4, UX-DR13, UX-DR14 (partial — toggle chrome in 8.3), UX-DR25 (desktop ≥1280px primary)
- **Pattern A/B/C:** Pattern A — multiple state stubs in `_bmad-output/design-references/screens/`:
  - `03-dashboard-live.html` (healthy ACTIVE state)
  - `04-dashboard-paused-customer.html` (PAUSED_BY_CUSTOMER)
  - `05-dashboard-paused-payment.html` (PAUSED_BY_PAYMENT_FAILURE)
  - `18-dashboard-anomaly-attention.html` (ACTIVE + anomaly_count > 0)
  - `19-dashboard-circuit-breaker.html` (PAUSED_BY_CIRCUIT_BREAKER)
  - `20-dashboard-sustained-transient.html` (ACTIVE + sustained transient)
  - `02-dashboard-dryrun.html` (full DRY_RUN Epic 8 state — distinct from Story 4.9's `26-dashboard-dryrun-minimal.html`)
- **UX skeleton:** §3.1 (dashboard root state table), §10 (visual DNA continuity rules — sticky header `backdrop-filter: blur(12px)` + 85% bg opacity)

---

## Acceptance Criteria

### AC#1 — Interception-redirect middleware reads cron_state and routes correctly

**Given** the route `GET /` with `interception-redirect.js` middleware
**When** an authenticated customer visits `/`
**Then** the middleware reads `customer_marketplaces.cron_state` (via RLS-aware client per Story 2.1) and:
- `PROVISIONING` → 302 to `/onboarding/scan` (UX-DR2 forward-only)
- `DRY_RUN | ACTIVE | PAUSED_BY_CUSTOMER | PAUSED_BY_PAYMENT_FAILURE | PAUSED_BY_CIRCUIT_BREAKER | PAUSED_BY_ACCOUNT_GRACE_PERIOD` → render `/` with state-appropriate view
- `PAUSED_BY_KEY_REVOKED` (first login post-state-transition) → 302 to `/key-revoked` (UX-DR3); subsequent visits in same state → render `/` with persistent red banner (UX-DR32)
- `PAUSED_BY_PAYMENT_FAILURE` (first login post-state-transition) → 302 to `/payment-failed`; subsequent visits → render `/` with persistent red banner (UX-DR32)

**Implementation note:** The existing `interception-redirect.js` (Story 4.6) handles PROVISIONING → `/onboarding/scan` and PROVISIONING + FAILED_SCAN → `/scan-failed`. Story 8.1 EXTENDS this middleware to add the Epic 8 interceptions. Do NOT create a new middleware.

### AC#2 — Default layout: sticky header chrome + banner zone + body slot + footer

**Given** the dashboard page renders
**When** the customer's cron_state is loaded
**Then**:
- Layout uses `app/src/views/layouts/default.eta` (the shared chrome)
- Sticky header contains: logo + channel toggle placeholder (toggle component ships in 8.3 — leave slot) + pause/resume slot (ships 8.5) + Settings link + session avatar
- Sticky header uses `backdrop-filter: blur(12px)` with 85% bg opacity per §10.1
- Banner zone slot above body — receives banners from `banners.eta` (ships 8.8; this story connects the slot)
- Body slot for state-specific content
- Footer present
- Response renders within NFR-P7 budget (≤2s broadband; server-side < 200ms per Fastify inject)

### AC#3 — State-appropriate body slot per §3.1 state table

**Given** the body slot
**When** rendered for each cron_state per UX skeleton §3.1
**Then** visual treatments match:
- **Loading**: skeleton KPI cards with shimmer animation (`shimmer` from §10.1 animation primitives)
- **DRY_RUN**: KPI cards populated with simulated values; "MODO SIMULAÇÃO" badge top-right; persistent dry-run banner (§9.5 copy); "Ir live" CTA (connects to Story 8.6 modal)
- **ACTIVE (healthy)**: full KPI cards slot (KPI data in 8.2), ambient tonal washes, audit-log highlights row, margin editor accessible slot
- **PAUSED_BY_CUSTOMER**: KPI cards greyed 60% opacity class (`mp-kpi--greyed`); pause icon top-left; grey banner (§9.4); "Retomar" button → Story 8.5
- **PAUSED_BY_PAYMENT_FAILURE**: KPI cards greyed; `warning` filled icon (NOT `pause_circle` — UX-DR5); red banner (§9.6); "Atualizar pagamento" CTA → Stripe Portal (Epic 11)
- **PAUSED_BY_CIRCUIT_BREAKER**: KPI cards stale-watermarked; red banner (§9.8); "Investigar" + "Retomar" buttons
- **PAUSED_BY_KEY_REVOKED**: (intercepted to `/key-revoked` first time; subsequent visits show persistent red banner with no "Retomar" — key rotation is the only recovery)
- **Anomaly attention** (cron_state=ACTIVE + `anomaly_count > 0`): normal KPI cards; yellow banner (§9.7) with count; "Rever X eventos" link → `/audit` Atenção feed
- **Sustained transient** (cron_state=ACTIVE + `sustained_transient_active = true`, i.e. ≥3 consecutive cycle failures): KPI cards stale-watermarked, timestamp visible; grey informational banner (§9.9); NO action CTA

### AC#4 — UX-DR4 banner stacking precedence (encoded in banners.eta consumer)

**Given** the dashboard view and `banners.eta` component (ships with Story 8.8 — this story connects the slot)
**When** multiple banner conditions hold simultaneously
**Then** only the highest-precedence banner renders; lower-precedence banners reappear when the higher clears
**And** the precedence order encoded in this story's view template and consumed from `banners.eta`:
1. `payment_failure` — red, `warning` filled icon, §9.6 copy
2. `circuit_breaker` — red, `gpp_maybe` filled icon, §9.8 copy
3. `anomaly_attention` (anomaly_count > 0) — yellow, `error` filled icon, §9.7 copy with per-channel split when both have items
4. `sustained_transient` (≥3 consecutive failures) — grey, `schedule` filled icon, §9.9 copy
5. `paused_by_customer` — grey, `pause_circle` filled icon, §9.4 copy
6. `provisioning` — grey defensive fallback ("Catálogo a ser carregado…")
7. `dry_run` — blue, `science` filled icon, §9.5 copy

### AC#5 — UX-DR3/UX-DR32: interception fires only once per state-transition

**Given** UX-DR3 interception behavior
**When** a customer with `PAUSED_BY_KEY_REVOKED` or `PAUSED_BY_PAYMENT_FAILURE` logs in for the FIRST TIME post-state-transition
**Then** redirect to `/key-revoked` or `/payment-failed` interception page respectively
**And** subsequent visits still in the same state → render `/` with persistent red banner (NO second interception)
**And** the once-per-transition tracking is implemented via session state (e.g., `req.session.shownInterceptionFor = cron_state + transition_at timestamp`)

### AC#6 — Keyboard accessibility (NFR-A1 / NFR-A2)

**Given** the dashboard page in any state
**When** navigating via Tab / Shift+Tab
**Then**:
- Focus order matches visual hierarchy: header → banner → KPI cards → margin editor → recent Atenção → footer
- No positive `tabindex` values (breaks natural flow)
- No focus traps outside open modals
- Escape closes any open modal
- Red banners use `role="alert"` for screen-reader announcement; grey/blue banners use `role="status"`
- Icon-only buttons carry `aria-label` attributes

### AC#7 — Integration test covers all 7 cron_state variants + UX-DR3 once-semantics + RLS

**Given** `tests/integration/dashboard-state-machine.test.js` (scaffold already committed at Epic-Start)
**When** ATDD step fills in scaffold stubs
**Then** tests cover:
- All 7 cron_state variants: correct banner + CTA renders per state
- UX-DR3 interception triggers only ONCE per state-transition (session tracking)
- RLS: customer A cannot see customer B's dashboard data (cross-tenant 403/404)

---

## Tasks / Subtasks

- [ ] Task 1: Extend `interception-redirect.js` with Epic 8 intercepts (AC#1)
  - [ ] Add Epic 8 PAUSED_BY_KEY_REVOKED → `/key-revoked` (first login only) redirect
  - [ ] Add Epic 8 PAUSED_BY_PAYMENT_FAILURE → `/payment-failed` (first login only) redirect
  - [ ] Implement once-per-transition tracking via session state
  - [ ] Extend existing DB query to return `cron_state` + `transition_at` (or use `updated_at` on `customer_marketplaces`)
- [ ] Task 2: Replace Story 4.9 dashboard route with full state-aware handler (AC#1, AC#2, AC#3)
  - [ ] Update `app/src/routes/dashboard/index.js` — query cron_state + auxiliary state (anomaly_count, sustained_transient_active)
  - [ ] Pass full state context to `dashboard.eta` template
  - [ ] Register `app/src/views/components/banners.eta` slot in template (forward-compatible with Story 8.8)
- [ ] Task 3: Implement `default.eta` layout chrome (AC#2)
  - [ ] Sticky header with `backdrop-filter: blur(12px)` + 85% bg opacity
  - [ ] Logo, channel toggle slot, pause/resume slot, Settings link, session avatar
  - [ ] Banner zone slot (above body)
  - [ ] Body slot, footer
  - [ ] `role="alert"` / `role="status"` on banner elements
- [ ] Task 4: Implement `dashboard.eta` state-specific body slot (AC#3)
  - [ ] Per-state rendering: DRY_RUN, ACTIVE-healthy, ACTIVE+anomaly, ACTIVE+sustained-transient, PAUSED_BY_CUSTOMER, PAUSED_BY_PAYMENT_FAILURE, PAUSED_BY_CIRCUIT_BREAKER, PAUSED_BY_KEY_REVOKED (persistent banner)
  - [ ] KPI card placeholder slot (Story 8.2 will fill with `kpi-cards.eta`)
  - [ ] Banner slot connecting to `banners.eta` (Story 8.8 ships the component; this story wires the call)
  - [ ] "MODO SIMULAÇÃO" badge top-right on DRY_RUN
  - [ ] Verbatim §9.5 copy for dry-run banner
  - [ ] KPI greyed class + pause icon for PAUSED_BY_CUSTOMER
  - [ ] Shimmer skeleton for Loading state
- [ ] Task 5: Implement `public/js/dashboard.js` — baseline toggle placeholder (AC#2)
  - [ ] Reserve toggle state management slot (Story 8.3 populates — do not implement toggle logic here)
  - [ ] No-op initial file if Story 4.9 left it empty — confirm and leave scaffold for 8.3
- [ ] Task 6: Fill in test scaffold stubs (AC#1–AC#7)
  - [ ] `tests/app/routes/dashboard/index.test.js` — all 9 cron_state variant tests + layout + banner precedence + interception once-semantics + accessibility static assertions
  - [ ] `tests/integration/dashboard-state-machine.test.js` — parametric 7-state test + UX-DR3 session tracking + RLS cross-tenant test
  - [ ] Static source assertions (no OF24, no console.log, no SPA framework imports) — stubs already present

---

## Dev Notes

### CRITICAL: This Story Replaces Story 4.9's Minimal Stub

Story 4.9 shipped a minimal dashboard route at `app/src/routes/dashboard/index.js` that renders only the `DRY_RUN` state. Story 8.1 **replaces** the handler with the full state-aware implementation. The file exists — do NOT create a new file. The `dashboard-dry-run-minimal.eta` template and tests from Story 4.9 are superseded by this story's `dashboard.eta`.

**What to preserve from Story 4.9:**
- The bypass-aware conditional middleware wrapper pattern (`authMiddlewareConditional`, `rlsContextConditional`) — confirmed working, required for unit test injection
- The NODE_ENV=test guard on bypass — Critical: "authMiddlewareConditional bypass fired outside NODE_ENV=test" error
- Import paths for auth.js, rls-context.js, interception-redirect.js
- `fastify.addHook('onResponse', releaseRlsClient)` pattern

**What to change from Story 4.9:**
- Replace `reply.view('pages/dashboard-dry-run-minimal.eta', {})` with full state-aware handler that queries cron_state + auxiliary state and passes to `dashboard.eta`
- The route handler now queries the DB (unlike Story 4.9's no-query handler)

### CRITICAL: interception-redirect.js Extension Pattern

The existing middleware at `app/src/middleware/interception-redirect.js` (Story 4.6) already has Epic 8 extension stubs:
```js
// Epic 8: PAUSED_BY_KEY_REVOKED → /key-revoked
// Epic 8: PAUSED_BY_PAYMENT_FAILURE → /payment-failed
```
Extend the existing function — do NOT create a new middleware.

The existing query already fetches `cron_state`. Extend it to also return enough data for once-per-transition tracking. The simplest implementation uses a session flag:
- `req.session.shownInterceptionFor` = `{ state: 'PAUSED_BY_KEY_REVOKED', since: <timestamp> }`
- On subsequent visits with same state and same timestamp → render `/` with banner, no redirect

### Route Handler Shape (Full State-Aware)

```js
// app/src/routes/dashboard/index.js — Story 8.1 (replaces 4.9 minimal stub)
fastify.get('/', async (req, reply) => {
  // interceptionRedirect middleware has already run and allowed this through.
  // Query full dashboard state for the authenticated customer.
  const { rows } = await req.db.query(
    `SELECT
       cm.cron_state,
       cm.max_discount_pct,
       cm.max_increase_pct,
       cm.updated_at AS state_updated_at,
       COALESCE(
         (SELECT COUNT(*) FROM sku_channels sc
          WHERE sc.customer_marketplace_id = cm.id
            AND sc.frozen_for_anomaly_review = TRUE),
         0
       )::int AS anomaly_count,
       COALESCE(
         (SELECT COUNT(*) FROM audit_log al
          WHERE al.customer_marketplace_id = cm.id
            AND al.event_type = 'cycle-fail'
            AND al.created_at >= NOW() - INTERVAL '3 cycles'),
         0
       )::int >= 3 AS sustained_transient_active
     FROM customer_marketplaces cm
     WHERE cm.customer_id = $1
     LIMIT 1`,
    [req.user.id]
  );

  const state = rows[0];
  return reply.view('pages/dashboard.eta', {
    cronState: state.cron_state,
    anomalyCount: state.anomaly_count,
    sustainedTransientActive: state.sustained_transient_active,
    maxDiscountPct: state.max_discount_pct,
    maxIncreasePct: state.max_increase_pct,
  });
});
```

**Note on sustained_transient_active:** Story 12.1 ships the `cycle-fail-sustained` event type and the classifier. At MVP, check if `customer_marketplaces.sustained_transient_active` column exists (it may or may not be present depending on Story 12.1 shipping order). The `sustained_transient_cycle_threshold` column is flagged as "Epic 2 trigger" in the schema (architecture-distillate §6). If the column does not exist when Story 8.1 is implemented, add a migration: `202605140001_add_sustained_transient_active_to_customer_marketplaces.sql` with `ALTER TABLE customer_marketplaces ADD COLUMN sustained_transient_active BOOLEAN NOT NULL DEFAULT FALSE;`. The worker (Story 12.1) will set it. For Story 8.1 dev, hardcode `sustainedTransientActive = false` in the query until Story 12.1 adds the column, or check column existence defensively.

### Layout: `default.eta` — Sticky Header Chrome

```eta
<%# app/src/views/layouts/default.eta %>
<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><%= it.title || 'MarketPilot' %></title>
  <link rel="stylesheet" href="/css/tokens.css" />
  <link rel="stylesheet" href="/css/layout.css" />
  <link rel="stylesheet" href="/css/components.css" />
  <!-- Material Symbols (icon font) -->
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />
</head>
<body>
  <!-- Sticky header — backdrop-filter: blur(12px) + 85% bg opacity (§10.1) -->
  <header class="mp-sticky-header" role="banner">
    <div class="mp-container">
      <a href="/" class="mp-logo" aria-label="MarketPilot Dashboard">
        <!-- Logo SVG or text -->
        <span class="mp-logo-text">MarketPilot</span>
      </a>
      <!-- Channel toggle slot — Story 8.3 fills this with channel-toggle.eta -->
      <%~ it.channelToggle || '' %>
      <!-- Pause/resume slot — Story 8.5 fills this with pause-button.eta -->
      <%~ it.pauseButton || '' %>
      <nav class="mp-header-nav" aria-label="Navegação principal">
        <a href="/settings/account" class="mp-header-nav-link">Definições</a>
      </nav>
      <!-- Session avatar — Story 1.4 auth provides req.user.email -->
      <div class="mp-avatar" aria-label="Conta: <%= it.userEmail || '' %>">
        <span class="mp-avatar-initials"><%= it.userInitials || '?' %></span>
      </div>
    </div>
  </header>

  <!-- Banner zone (populated by banners.eta consumer) -->
  <div class="mp-banner-zone" aria-live="polite">
    <%~ it.banner || '' %>
  </div>

  <!-- Body slot -->
  <main class="mp-container mp-main" id="main-content" tabindex="-1">
    <%~ it.body %>
  </main>

  <footer class="mp-footer" role="contentinfo">
    <div class="mp-container">
      <p class="mp-footer-copy">MarketPilot &copy; <%= new Date().getFullYear() %></p>
    </div>
  </footer>
</body>
</html>
```

**CSS for sticky header (add to `public/css/layout.css`):**
```css
.mp-sticky-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background-color: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--mp-line);
  display: flex;
  align-items: center;
}
```

### Dashboard Template: `dashboard.eta` State-Specific Body

The `dashboard.eta` template receives `cronState`, `anomalyCount`, `sustainedTransientActive` and renders the body slot. It drives banner selection and KPI treatment. Use Eta's `if` conditionals:

```eta
<%# app/src/views/pages/dashboard.eta %>
<% layout('/layouts/default', { ...it, title: 'Dashboard · MarketPilot' }) %>

<%# Banner selection (Story 8.8 ships banners.eta — this story wires the input) %>
<%# Precedence: payment_failure > circuit_breaker > anomaly > sustained_transient > paused_customer > dry_run %>
<% const cronState = it.cronState; %>
<% const anomalyCount = it.anomalyCount || 0; %>
<% const sustainedTransient = it.sustainedTransientActive || false; %>

<!-- Banner zone populated via include — Story 8.8 delivers banners.eta -->
<!-- For Story 8.1: render inline banner stubs; Story 8.8 extracts to component -->
<% if (cronState === 'PAUSED_BY_PAYMENT_FAILURE') { %>
  <div class="mp-banner mp-banner-danger" role="alert">
    <span class="material-symbols-outlined" aria-hidden="true">warning</span>
    <p class="mp-banner-text"><%# §9.6 copy — Story 8.8 finalises verbatim %></p>
    <a href="/settings/billing" class="mp-banner-cta">Atualizar pagamento</a>
  </div>
<% } else if (cronState === 'PAUSED_BY_CIRCUIT_BREAKER') { %>
  <div class="mp-banner mp-banner-danger" role="alert">
    <span class="material-symbols-outlined" aria-hidden="true">gpp_maybe</span>
    <p class="mp-banner-text"><%# §9.8 copy %></p>
    <a href="/audit" class="mp-banner-cta">Investigar</a>
    <button class="mp-banner-cta-secondary">Retomar</button>
  </div>
<% } else if (anomalyCount > 0) { %>
  <div class="mp-banner mp-banner-warning" role="status">
    <span class="material-symbols-outlined" aria-hidden="true">error</span>
    <p class="mp-banner-text"><%# §9.7 copy with count %></p>
    <a href="/audit" class="mp-banner-cta">Rever <%= anomalyCount %> eventos</a>
  </div>
<% } else if (sustainedTransient) { %>
  <div class="mp-banner mp-banner-neutral" role="status">
    <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
    <p class="mp-banner-text"><%# §9.9 informational copy %></p>
  </div>
<% } else if (cronState === 'PAUSED_BY_CUSTOMER') { %>
  <div class="mp-banner mp-banner-neutral" role="status">
    <span class="material-symbols-outlined" aria-hidden="true">pause_circle</span>
    <p class="mp-banner-text"><%# §9.4 copy %></p>
    <button class="mp-banner-cta">Retomar repricing</button>
  </div>
<% } else if (cronState === 'DRY_RUN') { %>
  <div class="mp-banner mp-banner-info" role="status">
    <span class="material-symbols-outlined" aria-hidden="true">science</span>
    <p class="mp-banner-text">
      <strong>MODO SIMULAÇÃO</strong> · O que vês são decisões que o motor TOMARIA,
      não acções no Worten. Quando estiveres confortável, vai live.
    </p>
    <button class="mp-banner-cta" id="btn-go-live">Ir live →</button>
  </div>
<% } %>

<!-- KPI cards slot — Story 8.2 fills this with kpi-cards.eta -->
<section class="mp-kpi-grid <% if (cronState === 'PAUSED_BY_CUSTOMER' || cronState === 'PAUSED_BY_PAYMENT_FAILURE') { %>mp-kpi-grid--greyed<% } %> <% if (cronState === 'PAUSED_BY_CIRCUIT_BREAKER' || sustainedTransient) { %>mp-kpi-grid--stale<% } %>">
  <%# KPI component slot — Story 8.2 injects kpi-cards.eta here %>
  <!-- Loading skeleton (replaced by real KPI cards in Story 8.2) -->
  <div class="mp-kpi-placeholder mp-kpi-shimmer" aria-busy="true"></div>
  <div class="mp-kpi-placeholder mp-kpi-shimmer" aria-busy="true"></div>
  <div class="mp-kpi-placeholder mp-kpi-shimmer" aria-busy="true"></div>
</section>

<!-- DRY_RUN: MODO SIMULAÇÃO badge top-right -->
<% if (cronState === 'DRY_RUN') { %>
  <div class="mp-dry-run-badge" aria-label="Modo simulação activo">
    MODO SIMULAÇÃO
  </div>
<% } %>

<!-- Margin editor slot — Story 8.4 fills this -->
<% if (cronState === 'DRY_RUN' || cronState === 'ACTIVE') { %>
  <section class="mp-margin-editor-zone">
    <%# margin-editor.eta (Story 8.4) injected here %>
  </section>
<% } %>

<!-- Script defer near </body> (F9: no bundler) -->
<script src="/js/dashboard.js" defer></script>
```

### Mechanism Trace

Story 8.1 is primarily a UI routing and rendering story with a meaningful DB read path. No `transitionCronState` or `writeAuditEvent` calls occur in this story.

**Call-chain trace:**
1. HTTP GET `/` hits Fastify
2. `authMiddlewareConditional` (preHandler) → validates Supabase JWT, sets `req.user`
3. `rlsContextConditional` (preHandler) → binds JWT to RLS-aware DB client, sets `req.db`
4. `interceptionRedirect` (preHandler — Story 4.6 extended in Story 8.1) → queries `customer_marketplaces.cron_state`; redirects or passes through
5. Route handler `GET /` → queries `customer_marketplaces` for full dashboard state (cron_state + anomaly_count + sustained_transient)
6. `reply.view('pages/dashboard.eta', stateData)` → Eta renders layout + banner + body
7. `releaseRlsClient` (onResponse hook) → releases the RLS DB connection

**Tx-topology:** No BEGIN/COMMIT block. All DB reads in the route handler are autocommit-per-statement via `req.db.query()` (RLS-aware Supabase client). No writes occur in this story. No `tx` parameter anywhere.

**Commit-boundary:** N/A — read-only story. No writes to persist.

**Statement-ordering:** The interception check happens in middleware BEFORE the route handler runs. The route handler query runs only when the middleware passes the request through (not redirecting). These are sequential, not parallel.

**interception-redirect.js query extension:**
The middleware currently queries:
```sql
SELECT cm.cron_state, sj.status AS scan_status
FROM customer_marketplaces cm
LEFT JOIN LATERAL (SELECT status FROM scan_jobs ...) ...
```
Story 8.1 extends this to also return `cm.updated_at` (for once-per-transition tracking):
```sql
SELECT cm.cron_state, cm.updated_at AS state_updated_at, sj.status AS scan_status
FROM customer_marketplaces cm
...
```
The `updated_at` timestamp is used to detect state-transitions: if `req.session.shownInterceptionFor?.since !== state_updated_at.toISOString()`, the interception fires for the first time.

### Dashboard State Machine (AD15 Context)

The `cron_state` enum values (per F13 — UPPER_SNAKE_CASE, per architecture constraint C):
```
PROVISIONING | DRY_RUN | ACTIVE | PAUSED_BY_CUSTOMER | PAUSED_BY_PAYMENT_FAILURE
| PAUSED_BY_CIRCUIT_BREAKER | PAUSED_BY_KEY_REVOKED | PAUSED_BY_ACCOUNT_GRACE_PERIOD
```

This story reads `cron_state` but does NOT call `transitionCronState`. The legal-transitions matrix lives in `shared/state/transitions-matrix.js` (Story 4.1) — do not re-define it here.

### Story 4.9 File State (What Exists to Extend)

The full Story 4.9 file list that this story modifies or replaces:

| File | Story 4.9 State | Story 8.1 Action |
|------|-----------------|------------------|
| `app/src/routes/dashboard/index.js` | EXISTS — minimal stub | REPLACE handler with full state-aware version; preserve bypass wrappers |
| `app/src/middleware/interception-redirect.js` | EXISTS — Story 4.6 | EXTEND with PAUSED_BY_KEY_REVOKED + PAUSED_BY_PAYMENT_FAILURE intercepts |
| `app/src/views/layouts/default.eta` | EXISTS (Story 4.9 set up basic version) | EXTEND with sticky header chrome per §10.1 |
| `app/src/views/pages/dashboard-dry-run-minimal.eta` | EXISTS — Story 4.9 | KEEP (legacy; Story 4.9 tests still reference it); add new `dashboard.eta` |
| `public/js/dashboard.js` | EXISTS — empty scaffold | EXTEND (Story 8.3 populates toggle; this story ensures file exists) |
| `public/css/layout.css` | EXISTS | EXTEND with `.mp-sticky-header` and backdrop-filter |
| `public/css/components.css` | EXISTS | EXTEND with `.mp-kpi-grid--greyed`, `.mp-kpi-grid--stale`, `.mp-kpi-shimmer`, `.mp-banner-*` variants, `.mp-dry-run-badge` |

### Test Scaffolds (DO NOT RECREATE — Fill Stubs)

Both test files exist from Epic-Start:
- `tests/app/routes/dashboard/index.test.js` — 16 scaffold stubs, all `assert.ok(true, 'scaffold')`
- `tests/integration/dashboard-state-machine.test.js` — 3 scaffold stubs

**Implementation approach for unit tests (index.test.js):**
Use Fastify `inject()` pattern with mocked DB. Inject `req.user` and `req.db` via a global preHandler in test setup (confirmed pattern from Stories 4.7 / 4.8 / 4.9):
```js
// In test setup:
const app = await buildApp({ logger: false });
app.addHook('preHandler', async (req) => {
  req.user = { id: 'test-customer-uuid' };
  req.db = { query: async (sql, params) => mockDbRows };
});
```

Mock `req.db.query()` to return different cron_state rows for each test.

**For UX-DR32 once-semantics test:** Mock `req.session` object. On first inject call: no session flag → middleware redirects. On second inject call: session flag set → no redirect.

**Key HTML assertions to wire in:**
```js
// DRY_RUN: assert html.includes('MODO SIMULAÇÃO')
// PAUSED_BY_CUSTOMER: assert html.includes('pause_circle')
// PAUSED_BY_PAYMENT_FAILURE: assert html.includes('warning') && !html.includes('pause_circle')
// PAUSED_BY_CIRCUIT_BREAKER: assert html.includes('gpp_maybe') && html.includes('Investigar')
// Banner precedence: seed both payment_failure + anomaly; assert one banner div only
// Backdrop blur: assert html.includes('backdrop-filter') or CSS class presence
```

### Pattern A Visual References

BAD subagent (Amelia) MUST open these stubs before writing Eta templates:
- `_bmad-output/design-references/screens/03-dashboard-live.html` — ACTIVE state baseline
- `_bmad-output/design-references/screens/02-dashboard-dryrun.html` — full DRY_RUN with KPIs + "Ir live" CTA
- `_bmad-output/design-references/screens/04-dashboard-paused-customer.html` — grey banner + greyed KPIs
- `_bmad-output/design-references/screens/05-dashboard-paused-payment.html` — red banner + warning icon
- `_bmad-output/design-references/screens/18-dashboard-anomaly-attention.html` — yellow banner + anomaly count
- `_bmad-output/design-references/screens/19-dashboard-circuit-breaker.html` — red banner + Investigar CTA
- `_bmad-output/design-references/screens/20-dashboard-sustained-transient.html` — grey informational banner

**Key §10.1 visual DNA tokens for sticky header:**
```css
/* sticky header */
background-color: rgba(255, 255, 255, 0.85);
backdrop-filter: blur(12px);
/* Primary navy gradient (buttons) */
background: linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2));
/* Type: Manrope 700/800 display, Inter 400/500/600/700 body, JetBrains Mono tabular */
/* Radius: --mp-radius-sm (8px), --mp-radius (12px), --mp-radius-lg (18px) */
/* Animation: shimmer (for loading skeleton KPI cards) */
```

### CSS Classes to Add (Extend components.css, Do NOT Create New Files)

```css
/* KPI state variants */
.mp-kpi-grid--greyed .mp-kpi-card { opacity: 0.6; }
.mp-kpi-grid--stale .mp-kpi-card::after { content: 'desatualizado'; /* stale watermark */ }
.mp-kpi-shimmer { animation: shimmer 1.5s ease-in-out infinite; /* from §10.1 */ }

/* Banner variants */
.mp-banner-danger { background: var(--mp-danger-soft); border-left: 3px solid var(--mp-danger); }
.mp-banner-warning { background: var(--mp-warning-soft); border-left: 3px solid var(--mp-warning); }
.mp-banner-neutral { background: var(--mp-line-soft); border-left: 3px solid var(--mp-line); }
.mp-banner-info { background: var(--mp-info-soft); border-left: 3px solid var(--mp-info); }

/* DRY_RUN badge */
.mp-dry-run-badge {
  position: absolute; top: 80px; right: 24px; /* below sticky header */
  font-size: 10px; letter-spacing: 0.12em; font-weight: 700;
  color: var(--mp-info); background: var(--mp-info-soft);
  padding: 4px 8px; border-radius: var(--mp-radius-sm);
}
```

### UX-DR5 Anti-Pattern Prevention

**CRITICAL (UX-DR5):** The `pause` and `payment-failed` states MUST use DIFFERENT icons:
- Customer-initiated pause: `pause_circle` filled icon + calm grey banner (`.mp-banner-neutral`)
- Payment failed: `warning` filled icon + warning-amber banner (`.mp-banner-danger`)

Tests in `index.test.js` assert: when `cron_state = PAUSED_BY_PAYMENT_FAILURE`, HTML contains `warning` icon AND does NOT contain `pause_circle`.

### UX-DR13 Anti-Pattern Prevention

The dashboard MUST NOT reproduce the free report's narrative arc. Verify the Eta template does NOT contain:
- "A um passo do 1.º" (rocket hero card)
- "Maiores oportunidades" table
- "Margem para subir" table
- "Vitórias rápidas" table

Static assertion in test: `assert.ok(!html.includes('A um passo do'))`.

### F9 Script Pattern

Per F9 (no bundler), include near `</body>` in `default.eta`:
```eta
<script src="/js/dashboard.js" defer></script>
```
The `defer` attribute ensures execution after HTML parse. Do NOT use `type="module"` unless ES import syntax is used in the file. `dashboard.js` is a per-page vanilla script.

### Verbatim PT Copy Snippets (Spec-Locked — Do NOT Paraphrase)

**§9.5 DRY_RUN banner:**
> `MODO SIMULAÇÃO · O que vês são decisões que o motor TOMARIA, não acções no Worten. Quando estiveres confortável, vai live.`
> `MODO SIMULAÇÃO` = `<strong>` bold.

**§9.4 PAUSED_BY_CUSTOMER banner:** (full verbatim to be sourced from UX skeleton §9.4 — key elements: "pause_circle" icon, grey treatment, "Retomar repricing" CTA)

**§9.6 PAUSED_BY_PAYMENT_FAILURE banner:** (full verbatim to be sourced from UX skeleton §9.6 — key elements: "warning" icon, red treatment, "Atualizar pagamento" CTA)

**§9.7 ANOMALY ATTENTION banner:** (key elements: "error" icon, yellow treatment, "Rever X eventos" where X = anomaly_count)

**§9.8 CIRCUIT BREAKER banner:** (key elements: "gpp_maybe" icon, red treatment, "Investigar" + "Retomar" buttons)

**§9.9 SUSTAINED TRANSIENT banner:** (key elements: "schedule" icon, grey treatment, informational only, NO CTA)

Read `_bmad-output/planning-artifacts/ux-skeleton.md` §9 for full verbatim copy for each banner section before writing templates.

### No Mirakl Endpoints in This Story

Story 8.1 is a dashboard rendering story — it reads only from Postgres (RLS-aware client, no Mirakl API calls). The architecture's Mirakl endpoint verification step (Step 5 of story creation) does NOT apply.

---

## Project Structure Notes

### Alignment with Unified Project Structure

```
# Files to CREATE:
app/src/views/pages/dashboard.eta        # Full state-aware dashboard template (replaces minimal stub's render target)

# Files to EXTEND (do NOT recreate):
app/src/routes/dashboard/index.js        # Replace minimal handler with full state-aware handler (keep bypass wrappers)
app/src/middleware/interception-redirect.js  # Add Epic 8 intercepts (PAUSED_BY_KEY_REVOKED, PAUSED_BY_PAYMENT_FAILURE)
app/src/views/layouts/default.eta        # Add sticky header chrome per §10.1
public/css/layout.css                    # Add .mp-sticky-header backdrop-filter rule
public/css/components.css               # Add KPI state variants + banner variants + dry-run badge

# Test files to FILL (DO NOT recreate — scaffolds exist):
tests/app/routes/dashboard/index.test.js
tests/integration/dashboard-state-machine.test.js
```

### Detected Conflicts / Variances

1. **Story 4.9 `dashboard-dry-run-minimal.eta`**: Story 8.1 adds `dashboard.eta` as the new render target. The `dashboard-dry-run-minimal.eta` remains for backward compatibility with Story 4.9's test suite (`dry-run-minimal.test.js`). The route handler in `index.js` will now render `dashboard.eta` for all states.

2. **`banners.eta` component (Story 8.8)**: Story 8.1 renders inline banner stubs in `dashboard.eta`. When Story 8.8 ships, the inline stubs in `dashboard.eta` get replaced by `<%~ include('/components/banners.eta', { cronState, anomalyCount, sustainedTransientActive }) %>`. The slot wiring is forward-compatible — Story 8.8 just fills the component. This is expected sequencing.

3. **`sustained_transient_active` detection**: Story 12.1 ships the `cycle-fail-sustained` event type + sustained-transient classifier. For Story 8.1 MVP, add a `sustained_transient_active BOOLEAN DEFAULT FALSE NOT NULL` column to `customer_marketplaces` as a placeholder the worker will set. If this column was not added by an earlier story, add a migration: `202605140001_add_sustained_transient_active_to_customer_marketplaces.sql`. Check existing schema before adding.

4. **Session for UX-DR32 tracking**: Story 4.6 established Fastify session (via `@fastify/session` or `@fastify/secure-session`). Story 8.1 uses `req.session.shownInterceptionFor` to track once-per-transition semantics. Verify the session plugin is registered in `server.js` before implementing. If not registered, register it in this story.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics-distillate/05-epic-8-dashboard.md` — Story 8.1]
- [Source: `_bmad-output/planning-artifacts/epics-distillate/_index.md` — Bundle B + UX-DR coverage maps]
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/_index.md` — Cross-cutting constraints + atomicity bundles]
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` — Pattern A/B/C contracts + SSoT modules]
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md` — File locations]
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/09-visual-design-asset-class.md` — Pattern A stable stubs]
- [Source: `_bmad-output/planning-artifacts/ux-skeleton.md` §3.1, §8.1, §9, §10 — State table + banner copy + visual DNA]
- [Source: `_bmad-output/implementation-artifacts/4-9-dashboard-root-in-dry-run-minimal-landing-only.md` — Predecessor story; bypass wrapper pattern; server.js registration]
- [Source: `_bmad-output/implementation-artifacts/epic-8-test-plan.md` — Story 8.1 test plan + scaffold stubs]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Step 1 BAD subagent — story creation, 2026-05-14)

### Debug Log References

(empty)

### Completion Notes List

(empty)

### File List

(empty)
