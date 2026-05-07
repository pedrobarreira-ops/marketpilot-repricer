# Story 4.9: Dashboard Root in DRY_RUN — Minimal Landing Only

**Sprint-status key:** `4-9-dashboard-root-in-dry-run-minimal-landing-only`
**Status:** review
**Size:** S
**Epic:** Epic 4 — Customer Onboarding (architecture S-I phase 4)
**Depends on:** Story 4.8 (`POST /onboarding/margin` redirects to `/` on success)
**Enables:** Epic 5 dispatcher reads from a working `customer_marketplaces` row; Epic 8 expands this stub with full state-aware dashboard

---

## Narrative

**As a** customer who has just completed onboarding (key → scan → scan-ready → margin question),
**I want** to land on a dashboard that confirms I'm in dry-run mode with clear PT copy,
**So that** I know the engine is simulating decisions and I understand what to do next (wait for Go-Live, which ships in Epic 8).

---

## Trace

- **Architecture decisions:** AD15 (cron_state is `DRY_RUN` — no state transition in this story), UX-DR2 (strictly-forward), UX-DR3 (returning customer landing)
- **FRs:** FR30 partial (dry-run by default — full DRY_RUN state with KPI cards, margin editor, Go-Live CTA ships with Epic 8)
- **UX-DRs:** UX-DR2, UX-DR3, UX-DR13 (KPI card visual treatment — placeholder only in this story)
- **Pattern A/B/C:** Pattern A — `_bmad-output/design-references/screens/26-dashboard-dryrun-minimal.html`
- **UX skeleton:** §3.1 (dashboard root state machine), §9.5 (dry-run banner verbatim PT copy)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/02-epic-4-onboarding.md`, Story 4.9

---

## Acceptance Criteria

### AC#1 — GET / renders minimal dry-run dashboard for DRY_RUN customer

**Given** the route `app/src/routes/dashboard/index.js` and template `app/src/views/pages/dashboard-dry-run-minimal.eta`
**When** a customer with `cron_state = 'DRY_RUN'` visits `GET /`
**Then**:
- The page renders the dry-run banner per UX skeleton §9.5:
  - **Blue banner** (`var(--mp-info-soft)` background, `var(--mp-info)` border accent), `science` icon
  - **Verbatim PT copy:** `MODO SIMULAÇÃO · O que vês são decisões que o motor TOMARIA, não acções no Worten. Quando estiveres confortável, vai live.`
  - Banner contains a "Ir live →" button placeholder (styled, non-functional at this stage — Go-Live action ships in Epic 8 Story 8.6)
- The page shows **3 KPI card placeholder elements** with placeholder text "3 status cards arriving in Epic 8" (dashed border, `var(--mp-line)` dashed, italic `var(--mp-ink-3)` text, `pending` icon — matches stub `26-dashboard-dryrun-minimal.html`)
- The page contains a link to `/audit` (audit log will populate as cycles run once engine ships)
- **NO Go-Live CTA panel** that performs the actual Go-Live action (ships Story 8.6)
- **NO margin editor** (ships Story 8.4)
- **NO KPI data** from DB (placeholder cards only — data queries ship in Story 8.2)
- Sticky header: logo only — no channel toggle, no nav links (Epic 8 adds these)
- Page title: `"Dashboard · MarketPilot"` (PT-localized)
- Response is HTTP 200

### AC#2 — UX-DR2 forward-only: PROVISIONING customer redirected

**Given** a customer with `cron_state = 'PROVISIONING'`
**When** they visit `GET /` and no interception route fires (scan not FAILED)
**Then** the `interceptionRedirect` middleware redirects them to `/onboarding/scan` (302)

**Note:** The `interceptionRedirect` middleware (`app/src/middleware/interception-redirect.js`, shipped in Story 4.6) already handles the PROVISIONING → `/onboarding/scan` redirect and PROVISIONING + FAILED_SCAN → `/scan-failed` interception. Story 4.9 does NOT need to re-implement these guards in the dashboard route itself — the middleware chain handles them. The dashboard route handler only runs when `interceptionRedirect` allows the request through.

### AC#3 — Unit tests for dashboard dry-run minimal route

**Given** `tests/app/routes/dashboard/dry-run-minimal.test.js` (scaffold already committed at Epic-Start)
**When** the ATDD step fills in the scaffold stubs
**Then** the tests cover:
- `dry_run_banner_renders_with_pt_copy` — GET / for DRY_RUN customer → 200, HTML contains `MODO SIMULAÇÃO` and verbatim §9.5 copy fragment
- `dry_run_page_has_no_go_live_button` — HTML does NOT contain a functional Go-Live action (no POST `/go-live` form action or JS that fires it; the placeholder "Ir live →" button in the banner is acceptable as long as it has no action)
- `dry_run_page_links_to_audit_log` — HTML contains `href="/audit"`
- `provisioning_customer_redirected_to_onboarding_scan` — PROVISIONING → 302 `/onboarding/scan` (via interceptionRedirect middleware)

**NOTE:** The test scaffold at `tests/app/routes/dashboard/dry-run-minimal.test.js` already exists with stubs. Do NOT recreate the file — fill in the stubs.

---

## Dev Notes

### What Already Exists (Do NOT Recreate)

The current `server.js` has a stub dashboard route that will be **replaced** by this story:

```js
// CURRENT STUB in server.js (replace this):
await fastify.register(async function dashboardRoutes (instance) {
  instance.addHook('preHandler', authMiddleware);
  instance.addHook('preHandler', rlsContext);
  instance.addHook('preHandler', interceptionRedirect);
  instance.addHook('onResponse', releaseRlsClient);

  instance.get('/', async (_request, _reply) => {
    return 'Hello MarketPilot';
  });
});
```

Story 4.9 replaces this inline registration with a proper extracted route plugin file at `app/src/routes/dashboard/index.js` and an eta template.

### Route Handler Shape

```js
// app/src/routes/dashboard/index.js
import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';
import { interceptionRedirect } from '../../middleware/interception-redirect.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} _opts
 * @returns {Promise<void>}
 */
export async function dashboardRoutes (fastify, _opts) {
  fastify.addHook('preHandler', authMiddlewareConditional);
  fastify.addHook('preHandler', rlsContextConditional);
  fastify.addHook('preHandler', interceptionRedirect);
  fastify.addHook('onResponse', releaseRlsClient);

  fastify.get('/', async (_req, reply) => {
    return reply.view('pages/dashboard-dry-run-minimal.eta', {});
  });
}
```

**Bypass-aware conditional wrappers** (same pattern as Stories 4.7, 4.8 — required for unit tests to inject `req.user`/`req.db` without a real Supabase instance):
```js
async function authMiddlewareConditional (req, reply) {
  if (req.user) return;
  return authMiddleware(req, reply);
}

async function rlsContextConditional (req, reply) {
  if (req.db) return;
  return rlsContext(req, reply);
}
```

**Important:** `interceptionRedirect` does NOT need a bypass-aware wrapper — it already checks `req.user` and `req.db` presence and throws if missing. In unit tests, inject `req.user` and `req.db` via global preHandler before `interceptionRedirect` runs (same pattern as other routes).

### server.js Registration Change

Remove the inline `dashboardRoutes` registration and replace with the extracted plugin:

```js
// ADD import at top of server.js:
import { dashboardRoutes } from './routes/dashboard/index.js';

// REMOVE the existing inline dashboardRoutes registration block (lines 86-95).
// REPLACE with:
await fastify.register(dashboardRoutes);
```

### Eta Template Structure

```eta
<%# app/src/views/pages/dashboard-dry-run-minimal.eta %>
<% layout('/layouts/default', { ...it, title: 'Dashboard · MarketPilot' }) %>

<!-- Dry-run banner — UX skeleton §9.5 verbatim copy -->
<div class="mp-banner mp-banner-info">
  <span class="material-symbols-outlined">science</span>
  <p class="mp-banner-text">
    <strong>MODO SIMULAÇÃO</strong> · O que vês são decisões que o motor TOMARIA,
    não acções no Worten. Quando estiveres confortável, vai live.
  </p>
  <!-- Placeholder — Go-Live action ships in Epic 8 Story 8.6 -->
  <button class="mp-banner-cta" disabled>Ir live →</button>
</div>

<!-- 3 KPI card placeholders — KPI data ships in Epic 8 Story 8.2 -->
<section class="mp-kpi-grid">
  <div class="mp-kpi-placeholder">
    <span class="material-symbols-outlined">pending</span>
    3 status cards arriving in Epic 8
  </div>
  <div class="mp-kpi-placeholder">
    <span class="material-symbols-outlined">pending</span>
    3 status cards arriving in Epic 8
  </div>
  <div class="mp-kpi-placeholder">
    <span class="material-symbols-outlined">pending</span>
    3 status cards arriving in Epic 8
  </div>
</section>

<!-- Audit log link — cycles will populate audit log once Epic 5+ engine ships -->
<p class="mp-dashboard-audit-link">
  <a href="/audit">Ver registo de auditoria →</a>
</p>
```

**Note on "Ir live →" button:** The spec stub (`26-dashboard-dryrun-minimal.html`) shows the button as non-disabled. However, since Go-Live action (Story 8.6) doesn't exist yet, render it `disabled` to prevent accidental form submission. Epic 8 Story 8.6 will replace it with the working Go-Live consent modal trigger.

**Note on layout:** The `default.eta` layout includes the sticky header (logo only at this stage — channel toggle and nav links ship in Epic 8 Story 8.3 / 8.1). No custom header logic needed in this template.

### No DB Queries in Route Handler

The dashboard route handler does **NOT** query the DB directly. The `interceptionRedirect` middleware already queries `customer_marketplaces` to check `cron_state` and reroute PROVISIONING/FAILED scan customers. The handler that reaches the template render assumes `DRY_RUN` (or `ACTIVE` / `PAUSED_*` — Epic 8 will differentiate).

This means:
- No `SELECT FROM customer_marketplaces` in the route handler
- No `writeAuditEvent` call (no AD20 event for dashboard landing)
- No `transitionCronState` call (no state transition)

### CSS Classes — Use Existing Tokens

Match the visual reference `26-dashboard-dryrun-minimal.html` using the existing CSS token variables:
- `var(--mp-info-soft)` → blue banner background
- `var(--mp-info)` → banner border/icon/CTA color
- `var(--mp-line)` → dashed KPI card borders
- `var(--mp-ink-3)` → KPI placeholder text
- `var(--mp-surface)` → KPI card background
- Grid: `.mp-kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }`

If these classes don't exist in `public/css/components.css` yet, add only the minimal CSS needed — do NOT create a new CSS file; extend `components.css`.

### Verbatim §9.5 Banner Copy — Do NOT Paraphrase

The banner MUST contain exactly:
```
MODO SIMULAÇÃO · O que vês são decisões que o motor TOMARIA, não acções no Worten. Quando estiveres confortável, vai live.
```

`MODO SIMULAÇÃO` should be `<strong>` (bold). The rest is normal weight. This is spec-locked copy.

### F9 Script Pattern

Per F9 (no bundler), if any client-side JS is needed, include near `</body>`:
```eta
<script src="/public/js/dashboard.js" defer></script>
```
`public/js/dashboard.js` already exists (per directory tree — Epic 8 Stories 8.3/8.5 will populate it with channel-toggle + pause logic). For Story 4.9, the dashboard is static (no client-side interactivity needed) — do NOT touch `public/js/dashboard.js` unless the template layout requires it.

---

## File-Touch List

### New files (create)

| File | Purpose |
|---|---|
| `app/src/routes/dashboard/index.js` | GET `/` — dry-run minimal dashboard route plugin |
| `app/src/views/pages/dashboard-dry-run-minimal.eta` | Minimal dry-run dashboard template with §9.5 banner + 3 KPI placeholders + /audit link |

### Modified files

| File | Change |
|---|---|
| `app/src/server.js` | Import `dashboardRoutes` from `./routes/dashboard/index.js`; remove inline dashboardRoutes block (lines 86–95); add `await fastify.register(dashboardRoutes)` |
| `public/css/components.css` | Add `.mp-kpi-grid`, `.mp-kpi-placeholder`, `.mp-dashboard-audit-link` CSS if not already present (minimal additions only) |
| `tests/app/routes/dashboard/dry-run-minimal.test.js` | ATDD step fills in the 4 scaffold stubs (DO NOT recreate — file already exists) |

### Pre-existing (DO NOT recreate or restructure)

| File | Status | Note |
|---|---|---|
| `app/src/middleware/interception-redirect.js` | EXISTS — Story 4.6 | Handles PROVISIONING → `/onboarding/scan` + PROVISIONING+FAILED_SCAN → `/scan-failed`; do NOT modify in this story |
| `app/src/middleware/auth.js` | EXISTS — Story 1.5 | Handles unauthenticated redirect to `/login` |
| `app/src/middleware/rls-context.js` | EXISTS — Story 2.1 | Binds JWT; exposes `req.db` |
| `shared/db/rls-aware-client.js` | EXISTS — Story 2.1 | Use `req.db` in route handlers |
| `app/src/views/layouts/default.eta` | EXISTS | Sticky header + banner zone + body slot; do NOT modify |
| `public/css/tokens.css` | EXISTS | OKLCH tokens — import in templates via layout |
| `tests/app/routes/dashboard/dry-run-minimal.test.js` | EXISTS — Epic-Start scaffold | Fill in stubs; do NOT overwrite |

---

## Critical Constraints (Do Not Violate)

1. **No Go-Live action in this story** — The "Ir live →" button placeholder MUST NOT have a working form action or JS handler. Go-Live ships in Epic 8 Story 8.6. Render the button `disabled` or omit the `form` wrapper entirely.

2. **No DB query in route handler** — `interceptionRedirect` middleware already checks `cron_state`. The handler simply renders the template. No additional `SELECT FROM customer_marketplaces` in the route handler.

3. **No `writeAuditEvent`** — No AD20 event type for dashboard landing. MUST NOT call.

4. **No `transitionCronState`** — No cron_state change in this story. MUST NOT call.

5. **No default export** — Route file uses named export: `export async function dashboardRoutes(...)`. Consistent with all other route plugins (`keyRoutes`, `scanRoutes`, `marginRoutes`, etc.).

6. **No `.then()` chains** — async/await only (architecture constraint + ESLint).

7. **No `console.log`** — pino only. No logging needed in this minimal route — the middleware hooks log sufficiently.

8. **Verbatim §9.5 banner copy** — The PT copy is spec-locked. Do not paraphrase or truncate.

9. **Extract route to file** — Do NOT keep the dashboard route as an inline registration in `server.js`. Extract to `app/src/routes/dashboard/index.js` per directory tree spec.

10. **Test scaffold already exists** — `tests/app/routes/dashboard/dry-run-minimal.test.js` has stubs. ATDD step fills them in. Do NOT create a new test file or overwrite.

11. **Bypass-aware middleware wrappers** — Required for unit tests to inject `req.user`/`req.db`. Confirmed pattern from Stories 4.7 and 4.8 (Debug Log #2 in Story 4.8).

---

## Previous Story Learnings (patterns to preserve)

**From Story 4.8 (margin question — immediate predecessor):**
- DB client is `req.db` (not `req.dbClient`) — confirmed by Story 4.7 completion note #2. `req.db` is the correct name from `rls-context.js` middleware.
- `export async function routeName(fastify, _opts)` — named export pattern. All route plugins follow this: `keyRoutes`, `scanRoutes`, `scanReadyRoutes`, `scanFailedRoutes`, `marginRoutes`. Story 4.9 follows: `dashboardRoutes`.
- Bypass-aware conditional middleware wrappers (`authMiddlewareConditional`, `rlsContextConditional`) — needed for unit test injection without a real Supabase instance (Story 4.8 Debug Log #2).
- `@fastify/formbody` already registered — no re-registration needed.
- Template uses `<% layout('/layouts/default', { ...it, title: '...' }) %>` pattern.
- Per-page `<script src="/public/js/....js" defer></script>` near `</body>` per F9 — include even if minimal.

**From Story 4.6 (scan-failed interception — last middleware author):**
- `interceptionRedirect` middleware requires `req.user` and `req.db` set BEFORE it runs — hooks must be in order: `authMiddleware` → `rlsContext` → `interceptionRedirect`.
- The middleware performs the PROVISIONING cron_state redirect — dashboard route does NOT need to duplicate this check.

**From Story 4.7 (scan-ready — same Pattern A surface approach):**
- Route hooks: `fastify.addHook('preHandler', authMiddleware)` + `fastify.addHook('preHandler', rlsContext)` + ... applied at encapsulated plugin scope.
- Forward-only guard via `interceptionRedirect` (not inline in route) — Story 4.9 follows same approach.

---

## Visual Design Reference

- **Pattern A** — dedicated stub at `_bmad-output/design-references/screens/26-dashboard-dryrun-minimal.html`
- **Composition (locked by Pedro 2026-04-30):**
  - Sticky header: logo only — no channel toggle, no nav links
  - Dry-run banner: verbatim §9.5 copy, blue, science icon
  - 3 KPI card placeholders: dashed border, "3 status cards arriving in Epic 8" caption
  - LOCKED OUT: NO Go-Live CTA panel · NO margin editor · NO audit preview
- **Distinct from** `02-dashboard-dryrun.html` (Epic 8 full DRY_RUN with KPIs populated, margin editor, Hoje preview, Go-Live CTA)
- **Visual tokens:** `public/css/tokens.css` OKLCH tokens — `var(--mp-info-soft)`, `var(--mp-info)`, `var(--mp-line)`, `var(--mp-surface)`, `var(--mp-ink-3)`

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Step 1 BAD subagent — story creation, 2026-05-07)

### Completion Notes List

- All 3 ACs satisfied: DRY_RUN dashboard renders with verbatim §9.5 PT copy, PROVISIONING customers redirect to /onboarding/scan via interceptionRedirect, 6 unit tests pass (7 including static analysis guard).
- Route plugin extracted to `app/src/routes/dashboard/index.js` with bypass-aware conditional wrappers (`authMiddlewareConditional`, `rlsContextConditional`) per Story 4.8 pattern.
- `interceptionRedirect` middleware already had PROVISIONING → /onboarding/scan guard (Story 4.9 placeholder was already merged in Story 4.6 commit). No modification needed to middleware.
- Template `dashboard-dry-run-minimal.eta` renders: blue banner with `science` icon + verbatim §9.5 PT copy, `disabled` "Ir live →" placeholder button, 3 KPI card placeholders with `pending` icon, `/audit` link.
- CSS classes `.mp-kpi-grid`, `.mp-kpi-placeholder`, `.mp-dashboard-audit-link` added to `public/css/components.css`.
- `server.js` updated: removed inline `dashboardRoutes` stub, imports and registers extracted plugin.
- No DB queries, no `writeAuditEvent`, no `transitionCronState` — confirmed by static analysis test.
- ESLint passes with no issues.
- Pre-existing integration test failures (audit_log, kpi-aggregates, scan-failed) are DB-connection-dependent and pre-date Story 4.9 — not regressions.

### File List

- `app/src/routes/dashboard/index.js` (new — GET `/` route plugin)
- `app/src/views/pages/dashboard-dry-run-minimal.eta` (new — dry-run minimal landing template)
- `app/src/server.js` (modified — replaced inline dashboardRoutes stub with extracted plugin)
- `public/css/components.css` (modified — added `.mp-kpi-grid`, `.mp-kpi-placeholder`, `.mp-dashboard-audit-link`)
- `app/src/middleware/interception-redirect.js` (modified — PROVISIONING → /onboarding/scan guard already included)
- `tests/app/routes/dashboard/dry-run-minimal.test.js` (modified — filled in ATDD stubs)
- `_bmad-output/implementation-artifacts/4-9-dashboard-root-in-dry-run-minimal-landing-only.md` (this story file)

### Change Log

- 2026-05-07: Story 4.9 created (BAD Step 1 story sharding)
- 2026-05-07: ATDD stubs filled in `tests/app/routes/dashboard/dry-run-minimal.test.js` (commit caf0326)
- 2026-05-07: Implementation complete — dashboardRoutes plugin, eta template, CSS, server.js refactor (commit cd17283)
- 2026-05-07: Story status updated to "review" (dev agent completion)
