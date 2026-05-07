# Story 4.8: Margin Question `/onboarding/margin` + Smart-Default Mapping + <5% Warning

**Sprint-status key:** `4-8-margin-question-onboarding-margin-smart-default-mapping-5-warning`
**Status:** ready-for-dev
**Size:** M
**Epic:** Epic 4 — Customer Onboarding (architecture S-I phase 4)
**Depends on:** Story 4.7 (scan-ready interstitial — "Continuar →" CTA points to `/onboarding/margin`), Story 4.1 (`max_discount_pct` + `max_increase_pct` columns on `customer_marketplaces`)
**Enables:** Story 4.9 (dashboard root in DRY_RUN — minimal landing only)

---

## Narrative

**As a** customer who has just reviewed my catalog quality summary at `/onboarding/scan-ready`,
**I want** to pick a margin-band that reflects my product economics (with a clear warning if I select under 5%),
**So that** the repricing engine has a calibrated discount floor from day one, and I understand the trade-offs before going live.

---

## Trace

- **Architecture decisions:** AD16 (final onboarding step before dashboard), AD15 (cron_state is already DRY_RUN at this point — no state transition here)
- **FRs:** FR16 (single onboarding margin-band question + smart-default mapping)
- **UX-DRs:** UX-DR2 (strictly-forward state machine)
- **Pattern A/B/C:** Pattern B — UX skeleton §3.3 + §8.6 + §9.10 + visual-DNA tokens (4 radio bands + inline §9.10 callout for `<5%`). No dedicated screens/ stub — skeleton + tokens suffice.
- **UX skeleton:** §3.3 (onboarding progress flow), §8.6 (smart-default warning for <5% segment), §9.10 (verbatim PT microcopy for the callout)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/02-epic-4-onboarding.md`, Story 4.8

---

## Acceptance Criteria

### AC#1 — GET /onboarding/margin renders 4 radio bands (PT-localized)

**Given** the route `app/src/routes/onboarding/margin.js` and template `app/src/views/pages/onboarding-margin.eta`
**When** a customer with `cron_state = 'DRY_RUN'` and a populated catalog (scan COMPLETE) visits `GET /onboarding/margin`
**Then**:
- The page renders the band picker with exactly 4 radio inputs:
  - Value `under_5`, label: `<5%` (or PT equivalent)
  - Value `5_10`, label: `5–10%`
  - Value `10_15`, label: `10–15%`
  - Value `15_plus`, label: `15%+`
- None of the radio inputs are pre-selected (no default selection — customer must actively choose)
- The page title / heading is PT-localized
- A "Confirmar" or "Continuar" submit button is present (disabled until a band is selected — JS progressive enhancement)
- Submit button text: **"Confirmar margem"** (or equivalent PT)

### AC#2 — Selecting `<5%` shows the inline warning callout with acknowledgement gate

**Given** the customer picks the `under_5` radio (`<5%`)
**When** the choice is made (client-side `change` event on the radio input)
**Then**:
- The inline warning callout (component `app/src/views/components/smart-default-warning-thin-margin.eta`) becomes visible
- The callout is **yellow-edged box with info icon** per UX skeleton §9.10 visual style
- The callout contains the **verbatim PT copy from UX skeleton §9.10**:
  ```
  Margem abaixo de 5%

  Para catálogos com margens mais apertadas, recomendamos:

    • Manter modo simulação por mais tempo (7+ dias) antes de ir live
    • O nosso default mais conservador para ti: max_discount_pct = 0.5%
    • Numa próxima versão, vamos suportar carregamento de custos por
      SKU para um controlo ainda mais fino. Para já, o motor protege
      a margem com o tier system + circuit breaker (≤15% por SKU).

  [ Compreendo e continuo ]
  ```
- The "Compreendo e continuo" acknowledgement button MUST be clicked before the form submit is allowed
- The submit button remains disabled (or the form POST is rejected server-side) until the acknowledgement has been given
- When another band (5_10, 10_15, 15_plus) is selected, the callout is hidden and the acknowledgement gate is cleared
- The callout visibility toggle is client-side (no page reload); JavaScript in `public/js/onboarding-margin.js`
- The callout is keyboard-accessible — clicking "Compreendo e continuo" sets a hidden field `acknowledge=true` in the form (or equivalent mechanism)

### AC#3 — POST /onboarding/margin persists smart-default mapping + redirects to `/`

**Given** the customer selects a band and submits `POST /onboarding/margin`
**When** the route runs
**Then**:
- `customer_marketplaces.max_discount_pct` is persisted per the smart-default mapping table:

  | Band (`band` form field) | `max_discount_pct` |
  |---|---|
  | `under_5` | `0.005` (0.5%) |
  | `5_10` | `0.01` (1%) |
  | `10_15` | `0.02` (2%) |
  | `15_plus` | `0.03` (3%) |

- `customer_marketplaces.max_increase_pct` is set to `0.05` (5% global default) **always**, regardless of band
- Both columns are updated in a single `UPDATE customer_marketplaces SET max_discount_pct = $1, max_increase_pct = $2 WHERE customer_id = $3 AND cron_state = 'DRY_RUN'` — do NOT use `transitionCronState` (no state transition occurs here)
- On success: redirect `302` to `/` (dashboard root, Story 4.9)
- **Server-side guard for `under_5` + missing acknowledgement:** If `band = under_5` and `acknowledge` field is missing/not `'true'`, respond with `400` or re-render the margin page with the callout pre-expanded. Do NOT silently allow unacknowledged submission.
- **Invalid band value:** If `band` is not one of the four valid values, respond with `400` (Fastify JSON Schema validation)
- **No `writeAuditEvent`** — no AD20 event type exists for "margin configured"; this is a simple DB write, not a cron_state transition
- **No `transitionCronState`** — cron_state stays `'DRY_RUN'` before and after

### AC#4 — UX-DR2 forward-only routing guards

**Given** UX-DR2 (strictly forward state machine)
**When** any of these routing scenarios occur:

| Scenario | Expected redirect |
|---|---|
| Customer with `cron_state = 'PROVISIONING'` hits `GET /onboarding/margin` | `302 /onboarding/scan` |
| Customer with `cron_state = 'DRY_RUN'` AND `max_discount_pct IS NOT NULL` hits `GET /onboarding/margin` | `302 /` (already set margin — forward to dashboard) |
| Customer with `cron_state = 'ACTIVE'` or any `PAUSED_*` hits `GET /onboarding/margin` | `302 /` |
| Unauthenticated customer hits `GET /onboarding/margin` | `302 /login?next=/onboarding/margin` (auth middleware handles) |

**Then** the redirect fires before any page render.

**Forward-only sentinel:** `max_discount_pct IS NOT NULL` is the reliable signal that the customer has completed the margin step. All four band choices produce a non-NULL value (`0.005`, `0.01`, `0.02`, `0.03`). The previous ambiguity with `0.0300` as sentinel (noted in Story 4.7 Dev Notes) is resolved here: simply check `IS NOT NULL`.

### AC#5 — Unit tests for smart-default mapping + routing guards

**Given** `tests/app/routes/onboarding/margin.test.js` (scaffold already committed at Epic-Start)
**When** the ATDD step fills in the scaffold stubs
**Then** the tests cover all the cases already scaffolded:
- `margin_page_renders_4_radio_bands` — GET renders all 4 radio inputs with correct values + PT labels
- `selecting_under_5_pct_shows_warning_callout` — callout element is present in HTML (may be hidden by default; JS reveals it)
- `under_5_pct_requires_acknowledge_before_submit` — POST with `band=under_5` and no `acknowledge` → rejected (400 or re-render)
- `submit_under_5_persists_00005_max_discount` — `max_discount_pct = 0.005`
- `submit_5_10_persists_001_max_discount` — `max_discount_pct = 0.01`
- `submit_10_15_persists_002_max_discount` — `max_discount_pct = 0.02`
- `submit_15_plus_persists_003_max_discount` — `max_discount_pct = 0.03`
- `submit_persists_005_max_increase_global_default` — `max_increase_pct = 0.05` always
- `submit_redirects_to_dashboard_root` — POST success → `302 /`
- `ux_dr2_forward_only_blocks_revisit_after_margin_set` — GET with `max_discount_pct IS NOT NULL` → `302 /`

**NOTE:** The test scaffold at `tests/app/routes/onboarding/margin.test.js` already exists with stubs. Do NOT recreate the file — fill in the stubs.

---

## Dev Notes

### POST Body Schema (Fastify JSON Schema validation)

```js
const MARGIN_POST_SCHEMA = {
  body: {
    type: 'object',
    required: ['band'],
    properties: {
      band: { type: 'string', enum: ['under_5', '5_10', '10_15', '15_plus'] },
      acknowledge: { type: 'string' },  // optional: 'true' when under_5 acknowledged
    },
    additionalProperties: false,
  },
};
```

Fastify's built-in JSON Schema validation (AD28 — no zod, no yup, no joi at MVP) rejects invalid `band` values automatically with a 400 before the handler runs.

Note: `@fastify/formbody` is already registered in `app/src/server.js` — it parses `application/x-www-form-urlencoded` POST bodies and makes them available as `req.body`. No additional setup needed.

### Smart-Default Mapping (pure function — safe to unit-test in isolation)

```js
/** @type {Record<string, number>} */
const BAND_TO_MAX_DISCOUNT = {
  under_5:  0.005,
  '5_10':   0.01,
  '10_15':  0.02,
  '15_plus': 0.03,
};

const MAX_INCREASE_DEFAULT = 0.05;
```

### DB Write Pattern

Use `req.db` (RLS-aware client from `rls-context.js` middleware — same pattern as Stories 4.3/4.7). The UPDATE uses the customer's auth ID to identify the row:

```js
await req.db.query(
  `UPDATE customer_marketplaces
   SET max_discount_pct = $1, max_increase_pct = $2
   WHERE customer_id = $3 AND cron_state = 'DRY_RUN'`,
  [maxDiscountPct, MAX_INCREASE_DEFAULT, req.user.id]
);
```

Do NOT call `transitionCronState` — cron_state is NOT changing. Do NOT call `writeAuditEvent` — no AD20 event type for this action.

### Forward-Only Guard — Reliable Sentinel

AC#4 uses `max_discount_pct IS NOT NULL` as the "margin already set" signal. Query:

```js
const { rows: [cm] } = await req.db.query(
  `SELECT id, cron_state, max_discount_pct FROM customer_marketplaces
   WHERE customer_id = $1 LIMIT 1`,
  [req.user.id]
);
```

Guard order in route:
1. No `cm` row OR `cron_state = 'PROVISIONING'` → redirect `/onboarding/scan`
2. `ACTIVE` or any `PAUSED_*` → redirect `/`
3. `cron_state = 'DRY_RUN'` AND `cm.max_discount_pct IS NOT NULL` → redirect `/` (already done)
4. Otherwise: render margin page

### Client-Side JS (`public/js/onboarding-margin.js`)

Per F9 pattern (no bundler), the script is a vanilla JS IIFE near `</body>`. Responsibilities:
1. Listen to `change` events on the 4 radio inputs
2. When `under_5` selected: show `.mp-thin-margin-callout` + disable submit until `Compreendo e continuo` is clicked
3. When other band selected: hide `.mp-thin-margin-callout` + clear `acknowledge` hidden field + re-enable submit
4. `Compreendo e continuo` click: set hidden input `acknowledge` to `'true'` + enable submit button

The submit button starts disabled (HTML `disabled` attribute) until a band is selected. This is progressive enhancement — the form is submittable without JS (server validates band + acknowledge server-side).

### Eta Template Structure

```eta
<%# app/src/views/pages/onboarding-margin.eta %>
<%# Variables: it.error (optional, string) %>
<% layout('/layouts/default', { ...it, title: 'Configura as tuas margens' }) %>
<section class="mp-onboarding-card">
  <span class="mp-onboarding-badge">Passo 4 de 4</span>
  <h1>Qual é a tua margem habitual?</h1>
  <p class="mp-onboarding-subtitle">
    Usamos isto para calcular o limite mínimo de desconto ao repriçar.
  </p>

  <% if (it.error) { %>
    <p class="mp-inline-error" role="alert" aria-live="polite"><%= it.error %></p>
  <% } %>

  <form method="POST" action="/onboarding/margin" novalidate>
    <!-- CSRF token if wired — check if csrf.js middleware adds it -->
    <fieldset class="mp-band-picker">
      <legend class="mp-sr-only">Seleciona a tua margem habitual</legend>
      <!-- 4 radio inputs -->
    </fieldset>

    <!-- Component: thin-margin warning (AC#2) -->
    <%~ include('/components/smart-default-warning-thin-margin', {}) %>

    <!-- Hidden field for acknowledgement -->
    <input type="hidden" name="acknowledge" id="acknowledge-field" value="" />

    <div class="mp-form-actions">
      <button type="submit" id="margin-submit" class="mp-btn mp-btn-primary" disabled>
        Confirmar margem
      </button>
    </div>
  </form>
</section>

<script src="/public/js/onboarding-margin.js" defer></script>
```

**Component:** `app/src/views/components/smart-default-warning-thin-margin.eta` — renders the yellow callout with the three bullets and "Compreendo e continuo" button. Hidden by default via CSS (`display: none`); revealed by JS when `under_5` selected.

### Route Handler Shape

```js
// app/src/routes/onboarding/margin.js
import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';

const BAND_TO_MAX_DISCOUNT = {
  under_5:   0.005,
  '5_10':    0.01,
  '10_15':   0.02,
  '15_plus': 0.03,
};

const ACTIVE_AND_PAUSED_STATES = [
  'ACTIVE', 'PAUSED_BY_CUSTOMER', 'PAUSED_BY_PAYMENT_FAILURE',
  'PAUSED_BY_CIRCUIT_BREAKER', 'PAUSED_BY_KEY_REVOKED', 'PAUSED_BY_ACCOUNT_GRACE_PERIOD',
];

const MARGIN_POST_SCHEMA = {
  body: {
    type: 'object',
    required: ['band'],
    properties: {
      band: { type: 'string', enum: ['under_5', '5_10', '10_15', '15_plus'] },
      acknowledge: { type: 'string' },
    },
    additionalProperties: false,
  },
};

export async function marginRoutes (fastify, _opts) {
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rlsContext);
  fastify.addHook('onResponse', releaseRlsClient);

  // GET /onboarding/margin
  fastify.get('/onboarding/margin', async (req, reply) => {
    const { rows: [cm] } = await req.db.query(
      `SELECT id, cron_state, max_discount_pct FROM customer_marketplaces
       WHERE customer_id = $1 LIMIT 1`,
      [req.user.id]
    );

    if (!cm || cm.cron_state === 'PROVISIONING') return reply.redirect('/onboarding/scan', 302);
    if (ACTIVE_AND_PAUSED_STATES.includes(cm.cron_state)) return reply.redirect('/', 302);
    if (cm.cron_state === 'DRY_RUN' && cm.max_discount_pct !== null) return reply.redirect('/', 302);

    return reply.view('pages/onboarding-margin.eta', { error: null });
  });

  // POST /onboarding/margin
  fastify.post('/onboarding/margin', { schema: MARGIN_POST_SCHEMA }, async (req, reply) => {
    const { band, acknowledge } = req.body;

    // Server-side acknowledgement guard for <5% band
    if (band === 'under_5' && acknowledge !== 'true') {
      return reply.view('pages/onboarding-margin.eta', {
        error: 'Por favor confirma que compreendeste o aviso de margem abaixo de 5%.',
      });
    }

    const maxDiscountPct = BAND_TO_MAX_DISCOUNT[band];

    await req.db.query(
      `UPDATE customer_marketplaces
       SET max_discount_pct = $1, max_increase_pct = 0.05
       WHERE customer_id = $2 AND cron_state = 'DRY_RUN'`,
      [maxDiscountPct, req.user.id]
    );

    req.log.info({ band, max_discount_pct: maxDiscountPct }, 'margin: smart-default mapping persisted');
    return reply.redirect('/', 302);
  });
}
```

### Verbatim §9.10 Copy — Do NOT Paraphrase

The smart-default warning component (`smart-default-warning-thin-margin.eta`) MUST contain verbatim:

```
Margem abaixo de 5%

Para catálogos com margens mais apertadas, recomendamos:

  • Manter modo simulação por mais tempo (7+ dias) antes de ir live
  • O nosso default mais conservador para ti: max_discount_pct = 0.5%
  • Numa próxima versão, vamos suportar carregamento de custos por
    SKU para um controlo ainda mais fino. Para já, o motor protege
    a margem com o tier system + circuit breaker (≤15% por SKU).

[ Compreendo e continuo ]
```

The button label is `"Compreendo e continuo"` (verbatim). No paraphrasing or translation variation.

### No Audit Event, No State Transition

- `writeAuditEvent` MUST NOT be called — no AD20 event type for margin configuration
- `transitionCronState` MUST NOT be called — cron_state stays `DRY_RUN`
- The `shared/state/cron-state.js` ESLint rule (`single-source-of-truth`) will flag any raw `UPDATE customer_marketplaces SET cron_state` — do NOT touch the cron_state column

### Onboarding Script Path Pattern

Per F9 and existing codebase convention, the script reference in the eta template is:

```eta
<script src="/public/js/onboarding-margin.js" defer></script>
```

(Note: `onboarding-scan-ready.eta` uses `/public/js/onboarding-scan-ready.js` — same prefix pattern. Do NOT use `/js/...` — the static root is served at `/public/` prefix per `FastifyStatic` config in `app/src/server.js`.)

### register Route in `app/src/server.js`

Add after the existing `scanReadyRoutes` registration:

```js
import { marginRoutes } from './routes/onboarding/margin.js';
// ...
await fastify.register(marginRoutes);
```

---

## File-Touch List

### New files (create)

| File | Purpose |
|---|---|
| `app/src/routes/onboarding/margin.js` | GET + POST `/onboarding/margin` — band picker + smart-default mapping + AC#4 guards |
| `app/src/views/pages/onboarding-margin.eta` | Margin band picker template (4 radios + warning component include) |
| `app/src/views/components/smart-default-warning-thin-margin.eta` | Yellow callout with §9.10 verbatim copy + "Compreendo e continuo" button |
| `public/js/onboarding-margin.js` | Client-side: show/hide callout on radio change; acknowledgement gate |

### Modified files

| File | Change |
|---|---|
| `app/src/server.js` | Import + `await fastify.register(marginRoutes)` after `scanReadyRoutes` |
| `tests/app/routes/onboarding/margin.test.js` | ATDD step fills in the scaffold stubs (DO NOT recreate — file already exists) |

### Pre-existing (DO NOT recreate or restructure)

| File | Status | Note |
|---|---|---|
| `shared/db/rls-aware-client.js` | EXISTS — Story 2.1 | Use `req.db` in route handlers |
| `app/src/middleware/auth.js` | EXISTS — Story 1.5 | Handles unauthenticated redirect |
| `app/src/middleware/rls-context.js` | EXISTS — Story 2.1 | Binds JWT; exposes `req.db` |
| `shared/audit/writer.js` | EXISTS — Story 9.0 | DO NOT call in this story |
| `shared/state/cron-state.js` | EXISTS — Story 4.1 | DO NOT call in this story |
| `supabase/migrations/` | ALL MIGRATIONS EXIST | No new migrations — `max_discount_pct` + `max_increase_pct` columns exist on `customer_marketplaces` per Story 4.1 |
| `tests/app/routes/onboarding/margin.test.js` | EXISTS — Epic-Start scaffold | Fill in stubs; do NOT overwrite |

---

## Critical Constraints (Do Not Violate)

1. **No `writeAuditEvent`** — MUST NOT call. No AD20 event type for margin configuration.

2. **No `transitionCronState`** — MUST NOT call. cron_state stays `DRY_RUN`. The ESLint rule `single-source-of-truth` will flag any raw `UPDATE customer_marketplaces SET cron_state`.

3. **Verbatim §9.10 copy** — The three bullets and button label are spec-locked. Do not paraphrase.

4. **Server-side acknowledgement guard** — `band=under_5` without `acknowledge=true` MUST be rejected. Client-side gate alone is insufficient (forms can be submitted programmatically).

5. **No new migrations** — `max_discount_pct` and `max_increase_pct` columns already exist on `customer_marketplaces` (Story 4.1 migration `202604301203_create_customer_marketplaces.sql`).

6. **No `export default` in source modules** — Route file uses named export: `export async function marginRoutes(...)`. This is the Fastify plugin convention used by all existing routes (`keyRoutes`, `scanRoutes`, `scanReadyRoutes`, `scanFailedRoutes`).

7. **No `.then()` chains** — async/await only (architecture constraint + ESLint).

8. **No `console.log`** — pino only (`req.log`). `req.log.info(...)` for the band mapping log line.

9. **Fastify built-in JSON Schema validation only** — No zod, no yup, no joi. The `MARGIN_POST_SCHEMA` body schema auto-rejects invalid `band` values before the handler runs.

10. **RLS-aware client in app routes** — use `req.db` (set by `rls-context.js` middleware). Never service-role client in app routes.

11. **`max_discount_pct IS NOT NULL` as forward-only sentinel** — This resolves the ambiguity noted in Story 4.7's Dev Notes about the `0.0300` sentinel. Use `IS NOT NULL` check, not a value comparison.

12. **Test scaffold already exists** — `tests/app/routes/onboarding/margin.test.js` has stubs. ATDD step fills them in. Do NOT create a new test file or overwrite the existing one.

---

## Previous Story Learnings (patterns to preserve)

**From Story 4.7 (scan-ready):**
- DB client is `req.db` (not `req.dbClient`) — confirmed by Story 4.7 completion note #2. `req.db` is the correct name from `rls-context.js` middleware.
- `export async function scanReadyRoutes(fastify, _opts)` — named export, not `export default`. Same pattern for `marginRoutes`.
- Per-page `<script src="/public/js/....js" defer></script>` near `</body>` per F9 — even if the script is minimal.
- Route hooks: `fastify.addHook('preHandler', authMiddleware)` + `fastify.addHook('preHandler', rlsContext)` + `fastify.addHook('onResponse', releaseRlsClient)` — applied at encapsulated plugin scope.

**From Story 4.7 (forward-only guard note):**
- Story 4.7 left a Phase 2 comment: *"add session flag or margin_set_at column to make the DRY_RUN revisit guard stricter"*. Story 4.8 resolves this by using `max_discount_pct IS NOT NULL` — no additional column needed.

**From Story 4.3 (key entry form):**
- Error rendering: pass `{ error: getSafeErrorMessage(err) }` or a plain PT string to the template; render via `<%= it.error %>`.
- CSRF: check if `csrf.js` middleware is registered — if so, include the CSRF token in the form. Current `server.js` does NOT register `@fastify/csrf-protection`, so no CSRF token needed at this stage.
- `@fastify/formbody` is already registered (Story 4.3 requires it for POST). No re-registration needed.

**From Story 4.1 (cron-state ESLint rule):**
- ESLint rule `single-source-of-truth` flags raw `UPDATE customer_marketplaces SET cron_state`. This story does NOT update `cron_state`. The UPDATE here touches `max_discount_pct` and `max_increase_pct` only — safe.

**From Story 2.1 (RLS-aware client):**
- `req.db` is request-scoped. Use it in the route handler for the `UPDATE` and the forward-only `SELECT`.

---

## Visual Design Reference

- **Pattern B** — no dedicated screens/ stub exists for this surface
- **Structure reference:** UX skeleton §3.3 (onboarding progress ProgressScreen pattern) + §8.6 (smart-default warning integration point) + §9.10 (verbatim callout copy)
- **Visual tokens:** `public/css/tokens.css` OKLCH tokens + `public/css/components.css` for yellow callout class (`.mp-callout-warning` or similar — use consistent naming with other callout components)
- The 4 radio inputs should use the existing `mp-band-picker` / `mp-field` / `mp-radio` CSS classes for visual consistency with the rest of the onboarding flow

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Step 1 BAD subagent — story creation, 2026-05-07)

### Debug Log References

(none — story creation only)

### Completion Notes List

(to be filled in by dev agent at Step 3)

### File List

(to be filled in by dev agent at Step 3)
