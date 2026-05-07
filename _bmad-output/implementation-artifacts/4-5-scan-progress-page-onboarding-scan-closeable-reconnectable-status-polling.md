# Story 4.5: Scan Progress Page `/onboarding/scan` — Closeable + Reconnectable + Status Polling

> No Mirakl API endpoints called by this story. Story is purely a UI consumer of the `GET /onboarding/scan/status` app route that reads from `scan_jobs` via Postgres. No MCP verification required.

**Sprint-status key:** `4-5-scan-progress-page-onboarding-scan-closeable-reconnectable-status-polling`
**Status:** ready-for-dev
**Size:** M
**Epic:** Epic 4 — Customer Onboarding (architecture S-I phase 4)
**Depends on:** Story 4.4 (worker populates `scan_jobs` status + `phase_message`; exposes `{status, phase_message, skus_total, skus_processed, started_at, completed_at}` shape from the status endpoint)
**Enables:** Story 4.6 (`/scan-failed` interception page — needs scan status polling to know when to redirect), Story 4.7 (`/onboarding/scan-ready` — destination after `status: COMPLETE`)

---

## Narrative

**As a** signed-up customer who has validated and submitted my Worten API key (Story 4.3),
**I want** to see live progress of the background catalog scan — with a 5-phase indicator, shimmer progress bar, and PT-localized status messages — and be able to close the tab and reopen it at any point without losing progress,
**So that** I trust the scan is running safely in the background and I know when it's done without having to keep the tab open.

---

## Trace

- **Architecture decisions:** AD16 (UX for scan progress — closeable + server-side state per FR14), UX-DR6 (5-phase progress labels + prepended A01/PC01 phase per AD16 Pass-2 UX delta)
- **FRs:** FR13 (closeable progress page with reconnect), FR14 (server-side scan job state)
- **UX-DRs:** UX-DR2 (strictly forward state machine — guards every path), UX-DR6 (5-phase scan progress with specific PT labels)
- **Pattern A/B/C contract:**
  - Behavior: FR13, FR14; UX-DR6
  - Structure: UX skeleton §3.3 ProgressScreen + AD16 Pass-2 UX delta (covering A01+PC01 as first phase)
  - Visual: **Pattern B** — UX skeleton §3.3 ProgressScreen + visual fallback `_bmad-output/design-references/bundle/project/MarketPilot.html` ProgressScreen (radial progress glyph + shimmer bar + 5-phase checklist). No dedicated `screens/` stub — use the MarketPilot.html ProgressScreen pattern directly.
- **SSoT modules created by this story:** `app/src/routes/onboarding/scan.js`, `app/src/views/pages/onboarding-scan.eta`, `public/js/scan-progress.js`
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/02-epic-4-onboarding.md`, Story 4.5

---

## Acceptance Criteria

### AC#1 — GET /onboarding/scan renders 5-phase progress page for in-flight scan

**Given** the route `GET /onboarding/scan`
**When** an authenticated customer with an in-flight `scan_jobs` row (status NOT IN `COMPLETE`, `FAILED`) visits
**Then** the page renders with:
- 5-phase progress checklist (UX-DR6 labels — see exact copy below)
- A shimmer bar showing `skus_processed / skus_total` (hide or show "Aguarda…" when `skus_total` is `null`)
- Current `phase_message` from the `scan_jobs` row displayed as the active phase label
- No abort/cancel button — closing the tab is the intentional "close" action (scan runs in worker)
**And** `public/js/scan-progress.js` loads via `<script src="/public/js/scan-progress.js" defer></script>` near `</body>` (F9 pattern — no bundler)
**And** the page is keyboard-accessible (NFR-A2)

**5-phase checklist labels (verbatim — UX-DR6 + AD16 Pass-2 UX delta):**
1. "A configurar integração com Worten" ← prepended A01+PC01 phase (AD16 Pass-2 UX delta)
2. "A obter catálogo"
3. "A classificar tiers iniciais"
4. "A snapshotar baselines"
5. "Pronto"

Mapping from `scan_jobs.status` to which checklist step is "active":
- `PENDING` → step 1 active
- `RUNNING_A01` → step 1 active
- `RUNNING_PC01` → step 1 active
- `RUNNING_OF21` → step 2 active
- `RUNNING_P11` → step 3 active
- `CLASSIFYING_TIERS` → step 3 active
- `SNAPSHOTTING_BASELINE` → step 4 active
- `COMPLETE` → step 5 active (redirect fires before this renders)
- `FAILED` → redirect fires before this renders

### AC#2 — Polling: scan-progress.js polls /onboarding/scan/status every 1s and auto-redirects

**Given** `public/js/scan-progress.js` running on the scan progress page
**When** the script initializes
**Then** it polls `GET /onboarding/scan/status` every 1 second
**And** on `status: "COMPLETE"` in the JSON response → `window.location.href = '/onboarding/scan-ready'`
**And** on `status: "FAILED"` in the JSON response → `window.location.href = '/scan-failed'`
**And** on any network error (fetch fails) → log silently (no console.log — browser console OK for debug but don't surface to user) and retry next tick
**And** the polling interval is cleared when the redirect fires (no dangling timer)
**And** the shimmer bar percentage and phase text update on each successful poll response

### AC#3 — GET /onboarding/scan/status returns correct JSON shape (RLS-aware + rate-limited)

**Given** the route handler at `app/src/routes/onboarding/scan.js`
**When** `GET /onboarding/scan/status` is called by an authenticated customer
**Then** it returns JSON:
```json
{
  "status": "RUNNING_OF21",
  "phase_message": "A obter catálogo",
  "skus_total": 12430,
  "skus_processed": 3200,
  "started_at": "2026-05-07T14:00:00Z",
  "completed_at": null
}
```
**And** the route queries ONLY the customer's own `scan_jobs` row (RLS-aware client — `req.db` from `rls-context.js` middleware; RLS enforces row ownership automatically)
**And** the route is rate-limited to **5 req/sec per customer** via `@fastify/rate-limit` (already installed in the project — do NOT install a new package)
**And** if no `scan_jobs` row exists for this customer, return `404` with `{ "error": "Nenhuma análise encontrada." }`
**And** the response `Content-Type` is `application/json`

### AC#4 — UX-DR2 strictly-forward state machine guards

**Given** a customer attempts to access `/onboarding/scan`
**When** the route loads
**Then**:
- Customer has **no `customer_marketplaces` row** → redirect to `/onboarding/key` (no key, no scan)
- Customer's `customer_marketplaces.cron_state = 'PROVISIONING'` AND **no `scan_jobs` row** → redirect to `/onboarding/key` (key was never fully validated)
- Customer's `customer_marketplaces.cron_state = 'PROVISIONING'` AND **`scan_jobs.status IN ('COMPLETE', 'FAILED')`** → redirect to `/onboarding/scan-ready` (COMPLETE) or `/scan-failed` (FAILED)
- Customer's `cron_state` is ANY value other than `'PROVISIONING'` (i.e., `DRY_RUN`, `ACTIVE`, `PAUSED_*`) → redirect to `/` (forward-only per UX-DR2)
- Customer's `cron_state = 'PROVISIONING'` AND **`scan_jobs.status` is in-flight** → render progress page (happy path)

**Note:** Do NOT use `@fastify/rate-limit` on the GET `/onboarding/scan` page itself — only on the `/status` polling endpoint.

### AC#5 — Disconnected / reconnected case

**Given** a customer closes the browser tab during `RUNNING_OF21` and reopens 30 minutes later (scan still running)
**When** the same progress page renders
**Then** it renders the live progress at whatever phase the scan is in at that moment (server-side state, not client-side)
**And** polling resumes immediately from the first render (no delay)
**And** no client-side state is persisted (no localStorage/sessionStorage — purely server-driven)

### AC#6 — Unit tests: tests/app/src/routes/onboarding/scan.test.js

**Given** `tests/app/src/routes/onboarding/scan.test.js`
**When** ATDD Step 2 fills in the stubs
**Then** the stubs cover all of these scenarios:

| Test ID | Scenario |
|---|---|
| `renders_scan_page_for_in_flight_scan` | PROVISIONING + in-flight scan_jobs → 200 HTML with phase checklist |
| `redirects_to_key_if_no_cm_row` | No customer_marketplaces row → 302 to /onboarding/key |
| `redirects_to_key_if_no_scan_job` | PROVISIONING + no scan_jobs row → 302 to /onboarding/key |
| `redirects_to_scan_ready_if_complete` | PROVISIONING + scan_jobs COMPLETE → 302 to /onboarding/scan-ready |
| `redirects_to_scan_failed_if_failed` | PROVISIONING + scan_jobs FAILED → 302 to /scan-failed |
| `redirects_to_root_if_not_provisioning` | DRY_RUN cron_state → 302 to / |
| `status_endpoint_returns_correct_shape` | GET /onboarding/scan/status → JSON with all 6 fields |
| `status_endpoint_404_when_no_scan` | No scan_jobs row → 404 JSON |
| `status_endpoint_rate_limit_enforced` | 6th request within 1s → 429 |
| `status_endpoint_rls_isolation` | Customer B cannot read Customer A's scan_jobs status |

**Test harness:** Node built-in test runner (`node --test`). Mock the DB client (`req.db`) — do NOT use a real Supabase instance for route unit tests. Mock `authMiddleware` and `rlsContext` to inject `req.user = { id: 'test-customer-uuid' }` and `req.db`.

---

## Dev Notes

### Route File: app/src/routes/onboarding/scan.js

This story creates `app/src/routes/onboarding/scan.js` alongside the existing `key.js`. Follow the exact same Fastify plugin pattern as `key.js`:

```js
// app/src/routes/onboarding/scan.js
import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';

export async function scanRoutes (fastify, _opts) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rlsContext);
  fastify.addHook('onResponse', releaseRlsClient);

  // GET /onboarding/scan — progress page (AC#1, AC#4, AC#5)
  fastify.get('/onboarding/scan', async (req, reply) => { ... });

  // GET /onboarding/scan/status — JSON polling endpoint (AC#3)
  fastify.get('/onboarding/scan/status', {
    config: { rateLimit: { max: 5, timeWindow: '1 second' } },
  }, async (req, reply) => { ... });
}
```

**Named export required** — `export async function scanRoutes` (never `export default`).

### Rate Limiting on /status Endpoint

The project already uses `@fastify/rate-limit`. Check `package.json` to confirm it's installed — do NOT re-install. Apply rate limiting ONLY to the `/status` endpoint via Fastify's per-route `config.rateLimit` option:

```js
fastify.get('/onboarding/scan/status', {
  config: { rateLimit: { max: 5, timeWindow: '1 second' } },
}, async (req, reply) => { ... });
```

For this to work, `@fastify/rate-limit` must be registered globally in `server.js`. If it's not already registered there, add it:

```js
import FastifyRateLimit from '@fastify/rate-limit';
await fastify.register(FastifyRateLimit, {
  global: false, // only apply to routes that opt in via config.rateLimit
});
```

Check `server.js` before adding — do NOT double-register.

### DB Query Pattern for /scan Route

The route uses the **RLS-aware client** (`req.db`) — NOT the service-role client. RLS automatically limits queries to the current customer's rows.

```js
// 1. Check customer_marketplaces state
const cmResult = await req.db.query(
  `SELECT id, cron_state FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1`,
  [req.user.id]
);

// 2. If PROVISIONING, check scan_jobs
const sjResult = await req.db.query(
  `SELECT id, status, phase_message, skus_total, skus_processed, started_at, completed_at
   FROM scan_jobs
   WHERE customer_marketplace_id = $1
   ORDER BY created_at DESC
   LIMIT 1`,
  [cmId]
);
```

**Important:** The `scan_jobs` query uses `customer_marketplace_id` as the FK, not `customer_id` directly. The customer's ID comes from `req.user.id`; join through `customer_marketplaces` to get `cmId` first.

### Status Endpoint — JSON Response

The `/status` endpoint returns raw JSON (not HTML). Use `reply.send({ ... })` — Fastify will set `Content-Type: application/json` automatically:

```js
return reply.code(200).send({
  status: row.status,
  phase_message: row.phase_message,
  skus_total: row.skus_total,       // may be null if scan hasn't reached OF21 yet
  skus_processed: row.skus_processed,
  started_at: row.started_at,
  completed_at: row.completed_at,   // null until COMPLETE or FAILED
});
```

### Template: app/src/views/pages/onboarding-scan.eta

Follow the exact same layout pattern as `onboarding-key.eta`:

```eta
<% layout('/layouts/default', { ...it, title: 'A analisar o teu catálogo' }) %>
<section class="mp-onboarding-card">
  <span class="mp-onboarding-badge">Passo 2 de 4</span>
  <h1>A analisar o teu catálogo</h1>
  ...
</section>
<script src="/public/js/scan-progress.js" defer></script>
```

**Data passed from route to template:**
```js
{
  currentStatus: row.status,        // scan_jobs.status enum value
  phaseMessage: row.phase_message,  // PT-localized current phase label
  skusTotal: row.skus_total,        // may be null
  skusProcessed: row.skus_processed,
}
```

**5-phase checklist rendering:** Server-render the checklist with CSS classes for `active`, `done`, and `pending` states so the page renders correctly before JavaScript loads (progressive enhancement). The JS polling script then updates these classes dynamically.

### Phase Status Mapping (Server-Side Render)

Map `scan_jobs.status` → which checklist step is highlighted:

```js
// In the route handler — compute before passing to template
const PHASE_MAP = {
  PENDING: 1, RUNNING_A01: 1, RUNNING_PC01: 1,
  RUNNING_OF21: 2,
  RUNNING_P11: 3, CLASSIFYING_TIERS: 3,
  SNAPSHOTTING_BASELINE: 4,
  COMPLETE: 5,
};
const activePhase = PHASE_MAP[row.status] ?? 1;
```

Pass `activePhase` to the template so it can apply `mp-phase--active` / `mp-phase--done` CSS classes without JavaScript.

### Public JS: public/js/scan-progress.js

**Critical constraints:**
- No `import` statements (plain defer script, no bundler — architectural constraint #4)
- No framework JS (vanilla DOM only — architectural constraint #3)
- No `console.log` in production paths (use `console.warn` for debug only — acceptable in browser context per ESLint config for `public/js/` files)
- Wrapped in an IIFE `(function () { 'use strict'; ... })()`

**Polling pattern:**

```js
(function () {
  'use strict';

  var POLL_INTERVAL_MS = 1000;
  var pollTimer = null;

  function updateProgress (data) {
    // Update shimmer bar: data.skus_total, data.skus_processed
    // Update phase text: data.phase_message
    // Update active checklist step: map data.status → phase number
  }

  function poll () {
    fetch('/onboarding/scan/status')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.status === 'COMPLETE') {
          clearInterval(pollTimer);
          window.location.href = '/onboarding/scan-ready';
          return;
        }
        if (data.status === 'FAILED') {
          clearInterval(pollTimer);
          window.location.href = '/scan-failed';
          return;
        }
        updateProgress(data);
      })
      .catch(function () {
        // Network error — silently retry next tick
      });
  }

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // Fire immediately on load (don't wait 1s for first update)
  poll();
})();
```

**DOM element IDs** the JS interacts with (define these in the eta template):
- `#scan-phase-message` — current phase text
- `#scan-shimmer-bar` — `<progress>` or `<div>` for percentage bar
- `#scan-skus-processed` — number display
- `#scan-skus-total` — number display
- `#scan-phase-list` — the `<ol>` containing phase items
- Phase items: `.mp-scan-phase` with `data-phase="1"` through `data-phase="5"` and classes `mp-phase--done`, `mp-phase--active`, `mp-phase--pending`

### Shimmer Bar Percentage Calculation

```js
function calcPercent (processed, total) {
  if (!total || total === 0) return 0;
  return Math.min(100, Math.round((processed / total) * 100));
}
```

When `skus_total` is `null` (scan hasn't reached OF21 yet), show an indeterminate shimmer animation rather than `0%`. Add CSS class `mp-shimmer--indeterminate` when `!skus_total`, `mp-shimmer--determinate` when `skus_total > 0`.

### Register scanRoutes in server.js

Add `scanRoutes` import and registration alongside `keyRoutes`:

```js
// server.js — ADD:
import { scanRoutes } from './routes/onboarding/scan.js';
// ...
await fastify.register(scanRoutes);
```

Place it after `keyRoutes` registration.

### UX-DR2 Guard Logic (Critical — Do Not Shortcut)

The UX-DR2 guard is the same pattern as `key.js` but with different redirect targets. Map exactly:

| Condition | Action |
|---|---|
| No `customer_marketplaces` row | redirect `/onboarding/key` |
| `cron_state != 'PROVISIONING'` | redirect `/` (forward-only) |
| `cron_state = 'PROVISIONING'` + no `scan_jobs` | redirect `/onboarding/key` |
| `cron_state = 'PROVISIONING'` + `scan_jobs.status = 'COMPLETE'` | redirect `/onboarding/scan-ready` |
| `cron_state = 'PROVISIONING'` + `scan_jobs.status = 'FAILED'` | redirect `/scan-failed` |
| `cron_state = 'PROVISIONING'` + in-flight scan | render progress page (200) |

The `/status` polling endpoint does NOT need a redirect guard — if no scan_jobs row exists, return `404 JSON`. The polling script on the page will never call `/status` if the page itself redirected, so this is safe.

### Visual Reference (Pattern B)

This is a **Pattern B** surface — no dedicated `screens/` stub exists. Use the ProgressScreen section of `_bmad-output/design-references/bundle/project/MarketPilot.html` as the visual reference:
- Radial progress glyph (decorative — can simplify to CSS shimmer)
- Shimmer bar (horizontal progress bar with animation while indeterminate)
- 5-phase checklist with done/active/pending states
- PT copy per UX-DR6

Do NOT over-engineer the visual — a clean, functional server-rendered HTML page with minimal CSS using the existing `tokens.css` tokens is acceptable. The ProgressScreen in `MarketPilot.html` is a reference for copy and layout intent, not a pixel-perfect target.

Visual tokens from `tokens.css` to use:
- `--mp-primary` for active phase indicator
- `--mp-ink` for text
- `--mp-surface` for card background
- `--mp-win` for completed phase checkmarks (green)
- `--mp-muted` for pending phases

### ESLint Rules in Force

At the time Story 4.5 ships, these custom ESLint rules are active:
- `no-direct-fetch` (Story 3.1) — no raw `fetch()` in server-side code (applies to `scan.js`; client-side `scan-progress.js` is exempt per ESLint globals.browser config)
- `single-source-of-truth` (Story 4.1) — no raw `UPDATE customer_marketplaces SET cron_state` outside `cron-state.js`
- `no-raw-INSERT-audit-log` (Story 9.0) — use `writeAuditEvent` only
- `no-console` (Story 1.1) — pino only in `app/src/` (browser JS files are exempt)
- `no-default-export` — named exports only in all `app/src/`, `shared/`, `worker/src/` modules

**This story does NOT call `writeAuditEvent`** — no audit events are specified for scan progress page loads or status polls.

### No Mirakl Calls in This Story

This story has ZERO Mirakl API calls. It is purely:
- A Fastify route that reads from `scan_jobs` (Postgres)
- An eta template that renders the checklist
- A vanilla JS poller that hits the `/status` endpoint

Do NOT add any Mirakl client imports.

---

## File-Touch List

### New files (create)

| File | Purpose |
|---|---|
| `app/src/routes/onboarding/scan.js` | GET /onboarding/scan + GET /onboarding/scan/status routes |
| `app/src/views/pages/onboarding-scan.eta` | Progress page template (Pattern B) |
| `public/js/scan-progress.js` | Vanilla JS polling + DOM update + redirect |
| `tests/app/src/routes/onboarding/scan.test.js` | ATDD Step 2 stubs (10 scenarios per AC#6) |

### Modified files

| File | Change |
|---|---|
| `app/src/server.js` | Add `import { scanRoutes }` + `await fastify.register(scanRoutes)` |

### Pre-existing (DO NOT recreate)

| File | Status | Note |
|---|---|---|
| `app/src/routes/onboarding/key.js` | ALREADY EXISTS — Story 4.3 | Pattern reference for route shape |
| `app/src/views/pages/onboarding-key.eta` | ALREADY EXISTS — Story 4.3 | Pattern reference for eta template layout block |
| `app/src/views/layouts/default.eta` | ALREADY EXISTS — Story 1.1 | Layout used via `<% layout('/layouts/default', ...) %>` |
| `app/src/middleware/auth.js` | ALREADY EXISTS | `authMiddleware` hook |
| `app/src/middleware/rls-context.js` | ALREADY EXISTS | `rlsContext` + `releaseRlsClient` hooks |
| `shared/db/rls-aware-client.js` | ALREADY EXISTS — Story 2.1 | Used internally by `rlsContext` middleware |
| `public/css/tokens.css` | ALREADY EXISTS — Story 1.1 | CSS token variables |
| `public/js/onboarding-key.js` | ALREADY EXISTS — Story 4.3 | Pattern reference for vanilla JS IIFE shape |
| `worker/src/jobs/onboarding-scan.js` | ALREADY EXISTS — Story 4.4 | Populates scan_jobs rows (dependency) |

---

## Critical Constraints (Do Not Violate)

1. **No server-side raw `fetch()`** in `app/src/routes/onboarding/scan.js` — DB access only via `req.db` (RLS-aware client). The `no-direct-fetch` ESLint rule flags raw `fetch(` in server-side modules.

2. **No `export default`** — use `export async function scanRoutes`. Named exports only.

3. **No `.then()` chains** in server-side code — async/await only.

4. **No `console.log`** in `app/src/routes/onboarding/scan.js` — pino via `req.log` only.

5. **No bundler, no `import` in client JS** — `public/js/scan-progress.js` must be a plain IIFE with vanilla DOM APIs.

6. **No client-side state persistence** (no localStorage, sessionStorage) — reconnection works purely by re-fetching from `/status`.

7. **Rate limit ONLY on `/status`** — the GET `/onboarding/scan` page is NOT rate-limited (would penalize normal page loads).

8. **RLS-aware client, not service-role** — this is an app route serving a customer HTTP request. Use `req.db` (set by `rlsContext` middleware). Never import `getServiceRoleClient` here.

9. **No new npm packages** — `@fastify/rate-limit` is already in `package.json`. Check before installing anything.

10. **`scan_jobs` query via `customer_marketplace_id` FK** — not directly by `customer_id`. Get `cmId` from `customer_marketplaces` first, then query `scan_jobs` with `WHERE customer_marketplace_id = $1`.

---

## Previous Story Learnings (from Story 4.3 + Story 4.4)

**From Story 4.3 (key.js route pattern):**
- Route file shape: `export async function keyRoutes(fastify, _opts)` — Fastify plugin with named export
- Hook registration: `addHook('preHandler', authMiddleware)` + `addHook('preHandler', rlsContext)` + `addHook('onResponse', releaseRlsClient)` — same pattern for `scanRoutes`
- Template pattern: `reply.view('pages/onboarding-scan.eta', { ...data })` — use `reply.view` (NOT `reply.send`)
- Redirect pattern: `return reply.redirect('/target', 302)` — return the redirect reply
- RLS DB queries use `req.db.query(sql, params)` — standard pg interface
- Schema guard: query `customer_marketplaces WHERE customer_id = $1` first to get cmId, then join to other tables

**From Story 4.3 (eta template pattern):**
- Layout inclusion: `<% layout('/layouts/default', { ...it, title: '...' }) %>`
- Error display: `<% if (it.error) { %><p class="mp-inline-error" role="alert">...<% } %>`
- Script tag: `<script src="/public/js/<page>.js" defer></script>` at bottom of template (F9)
- `it` prefix for all template variables: `it.phaseMessage`, `it.activePhase`, etc.

**From Story 4.4 (scan_jobs schema):**
- `scan_jobs` columns: `id`, `customer_marketplace_id`, `status` (enum), `phase_message` (TEXT, PT-localized), `skus_total` (INT, nullable), `skus_processed` (INT NOT NULL DEFAULT 0), `failure_reason`, `started_at`, `completed_at`
- `scan_jobs` EXCLUDE constraint: one active scan per marketplace (status NOT IN COMPLETE/FAILED)
- `scan_jobs.status` enum values: `PENDING`, `RUNNING_A01`, `RUNNING_PC01`, `RUNNING_OF21`, `RUNNING_P11`, `CLASSIFYING_TIERS`, `SNAPSHOTTING_BASELINE`, `COMPLETE`, `FAILED`
- `phase_message` is updated at each phase transition by the worker (Story 4.4 sets it); the status endpoint just reads it — no need to re-derive it server-side
- `scan_jobs` has no `updated_at` column — do NOT include it in queries (confirmed in Story 4.4 Dev Agent Record)

**From Story 1.1 + 1.3 (server.js + logger patterns):**
- Fastify plugins registered with `await fastify.register(pluginFn)` — no prefix option needed for onboarding routes
- `req.log.info({}, 'message')` — structured pino logging
- `req.log.warn({}, 'message')` for rate-limit approach logging

---

## Integration Test Gate

This story is `integration_test_required: false` — the route unit tests in `tests/app/src/routes/onboarding/scan.test.js` are sufficient to gate this story. No Mirakl mock server needed.

The full onboarding integration flow (`tests/integration/onboarding-flow.test.js`) covers the end-to-end path when it ships in a later story — this story's unit tests cover the routing logic in isolation.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Auth bypass pattern: authMiddleware and rlsContext hooks check `req.user` / `req.db` before calling real middleware, allowing tests to inject mocks via global preHandler without mock.module.
- Column names verified against migrations before writing SQL: `scan_jobs` (202604301211), `customer_marketplaces` (202604301203).
- `@fastify/rate-limit` already in package.json; registered globally with `global: false` in server.js. Per-route opt-in via `config.rateLimit`.
- `buildApp` in tests requires `@fastify/view` registration to make `reply.view()` work in unit tests.

### Completion Notes List

- AC#1: GET /onboarding/scan renders 5-phase checklist with UX-DR6 labels, shimmer bar, scan-progress.js script tag. Server-side phase class rendering via PHASE_MAP.
- AC#2: public/js/scan-progress.js polls /onboarding/scan/status every 1s, redirects on COMPLETE/FAILED, silently retries on network error.
- AC#3: GET /onboarding/scan/status returns 6-field JSON shape, 404 for no scan row, rate-limited 5 req/sec.
- AC#4: UX-DR2 guards all 5 conditions correctly (no CM, non-PROVISIONING, PROVISIONING+no job, COMPLETE, FAILED).
- AC#5: Pure server-side state; no localStorage/sessionStorage; reconnection works via re-render.
- AC#6: All 10 unit test scenarios pass with `node --test` (no experimental flags needed).

### File List

**New:**
- `app/src/routes/onboarding/scan.js`
- `app/src/views/pages/onboarding-scan.eta`
- `public/js/scan-progress.js`

**Modified:**
- `app/src/server.js` — added `scanRoutes` import + registration, `@fastify/rate-limit` registration
- `tests/app/routes/onboarding/scan.test.js` — added `buildApp` with view engine + auth bypass pattern

### Change Log

| Date | Change |
|---|---|
| 2026-05-07 | Story 4.5 implemented: scan progress page, /status endpoint, vanilla JS poller, server.js updated |
