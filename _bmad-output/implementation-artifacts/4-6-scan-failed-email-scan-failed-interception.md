# Story 4.6: Scan-failed email + `/scan-failed` interception

Status: dev-complete

## Story

As an onboarding customer whose catalog scan has failed,
I want to receive a PT-localized email explaining the failure and to be intercepted at the dashboard root with a recovery page,
so that I know what went wrong and can retry by re-validating my API key.

## Acceptance Criteria

1. **Given** `scan_jobs.status` transitions to `FAILED` **When** the worker writes the FAILED status **Then** within ≤5 minutes (NFR-P9), the customer receives a PT-localized email via `shared/resend/client.js`'s `sendCriticalAlert({ to, subject, html })` **And** the email subject is `"A análise do teu catálogo MarketPilot não conseguiu completar"` **And** the email body (rendered from `app/src/views/emails/scan-failed.eta`) explains the `failure_reason` in human-readable PT and provides a direct link to `/onboarding/key` for re-validation **And** the cleartext API key is never logged or included in the email.

2. **Given** a customer with a `FAILED` scan_jobs row logs in to any authenticated route **When** the auth landing / interception-redirect middleware runs (UX-DR3) **Then** it overrides `/` with `/scan-failed` interception **And** the page renders with the `failure_reason` from the latest FAILED scan_jobs row for that customer's marketplace **And** a "Tentar novamente →" button leads to `/onboarding/key` (rotation-entry path) **And** the page is keyboard-accessible (NFR-A2) **And** the page is PT-localized.

3. **Given** a healthy scan completion **When** the orchestrator transitions to `COMPLETE` **Then** NO email is sent (per FR15 — healthy completion is silent) **And** the customer logs back in to find the normal dashboard flow.

## Tasks / Subtasks

- [x] Task 1: Create `shared/resend/client.js` — minimal SSoT Resend client (AC: 1)
  - [x] Export `sendCriticalAlert({ to, subject, html })` using `resend` npm package
  - [x] Read `RESEND_API_KEY` from env; fail fast at import if missing
  - [x] Log success/failure with pino; NEVER log email body content (may contain PII)
  - [x] This is the CANONICAL Resend client — Story 12.2 (email templates) extends it, NOT a parallel impl
  - [x] Export ONLY named exports (`export async function sendCriticalAlert`); NO default export (arch constraint)
  - [x] JSDoc: `@param {{ to: string, subject: string, html: string }} opts`, `@returns {Promise<void>}`, `@throws` on Resend API error

- [x] Task 2: Create `app/src/views/emails/scan-failed.eta` — email template (AC: 1)
  - [x] PT-localized body: failure reason rendered human-readable, link to `/onboarding/key`, MarketPilot branding
  - [x] Follow visual-DNA token register (see design references below)
  - [x] Do NOT include cleartext API key in template data binding — route handler must never pass key to template
  - [x] Template receives: `{ customerName, failureReason, keyUrl }` — documented in JSDoc of calling code

- [x] Task 3: Integrate `sendCriticalAlert` call into `worker/src/jobs/onboarding-scan.js` (AC: 1, 3)
  - [x] Call `sendCriticalAlert` on FAILED transition (already required by Story 4.4 AC2 — this story provides the implementation)
  - [x] Resolve customer email: query `customers` table via service-role client using `customer_marketplace_id`
  - [x] On Resend failure: log pino error + continue (scan failure email is best-effort — do NOT let Resend error hide the underlying scan failure)
  - [x] Do NOT call `sendCriticalAlert` on COMPLETE transition (AC: 3 — healthy completion is silent)

- [x] Task 4: Create `app/src/routes/interceptions/scan-failed.js` route handler (AC: 2)
  - [x] `GET /scan-failed`: require auth (middleware); look up latest FAILED scan_jobs row for customer's marketplace
  - [x] Render `app/src/views/pages/scan-failed.eta` with `{ failureReason, keyUrl: '/onboarding/key' }`
  - [x] If no FAILED scan_jobs row found → redirect to `/` (guard against stale bookmark)
  - [x] If scan_jobs status is COMPLETE → redirect to `/` (onboarding succeeded, no interception needed)
  - [x] RLS-aware client (customer can only read their own scan_jobs rows — enforced at DB level per Story 4.2)
  - [x] JSDoc: document route, params, template data shape

- [x] Task 5: Create `app/src/views/pages/scan-failed.eta` — interception page (AC: 2)
  - [x] Pattern A visual reference: `_bmad-output/design-references/screens/17-scan-failed.html`
  - [x] PT copy: failure_reason displayed, "Tentar novamente →" button linking to `/onboarding/key`
  - [x] Keyboard-accessible: retry link is `<a href>` (Tab-reachable, Enter-activatable per NFR-A2)
  - [x] No JS required — no script tag (F9 satisfied)
  - [x] Extends layout `app/src/views/layouts/default.eta` via normal page slot

- [x] Task 6: Wire `/scan-failed` interception into `app/src/middleware/interception-redirect.js` (AC: 2)
  - [x] Created new middleware (did not exist at Epic 4 stage)
  - [x] At this stage: add `scan-failed` check — if customer has a FAILED scan_jobs row → redirect to `/scan-failed`
  - [x] UX-DR3: interception overrides `/` on landing; customer redirected away from dashboard root
  - [x] Guard: if customer's cron_state is PROVISIONING AND scan_jobs FAILED → intercept with `/scan-failed`
  - [x] Do NOT intercept if cron_state has progressed past PROVISIONING (scan failure cleared by successful re-validation)
  - [x] Comment marks where Epic 8 will add key-revoked and payment-failed interceptions

- [x] Task 7: Register the route in the Fastify server (AC: 2)
  - [x] In `app/src/server.js`, imported and registered `app/src/routes/interceptions/scan-failed.js`
  - [x] Route group under authenticated middleware (NOT in `_public/`)
  - [x] `/` route wrapped in encapsulated plugin with auth + rls + interception preHandlers

- [x] Task 8: Write tests (AC: 1, 2, 3)
  - [x] `tests/shared/resend/client.test.js` — unit: 6 tests pass (all AC constraints verified)
  - [x] `tests/integration/scan-failed.test.js` — integration: FAILED scan → redirects to /scan-failed; page renders failure_reason + retry button; COMPLETE/no-FAILED → redirects to /; PII not logged; sendCriticalAlert does not re-throw
  - [x] `tests/app/routes/interceptions/scan-failed.test.js` — ATDD stub (Step 2) updated to fix lint warnings
  - [x] Use node built-in test runner (`node --test`); mock Resend API with an in-process stub
  - [x] Verify pino output contains NO cleartext API key in any test assertion

## Dev Notes

### Critical: SSoT Discipline for `shared/resend/client.js`

**This story creates `shared/resend/client.js` as the CANONICAL Resend client.** The epics-distillate SSoT module index (Cross-Cutting: SSoT Modules Index) explicitly states:

> `shared/resend/client.js` (`sendCriticalAlert`) (Story 4.6 minimal SSoT) → extended by Story 12.2 with templates

Do NOT create any parallel implementation. Story 12.2 (Epic 12, Resend templates) will `import { sendCriticalAlert }` from this module and extend it — it must NOT refactor or replace it. The function signature `sendCriticalAlert({ to, subject, html })` is locked.

### No Mirakl API calls in this story

Story 4.6 does NOT call any Mirakl endpoint. The scan failure is triggered by Story 4.4 (`onboarding-scan.js`). This story:
1. Provides the `sendCriticalAlert` function that Story 4.4 calls.
2. Renders the interception page.

No Mirakl MCP verification is needed here.

### Resend npm package

Use the `resend` npm package (Resend's official SDK). Check `package.json` — if not already present, add it. No other Resend SDK or direct `fetch` calls are permitted (`no-direct-fetch` ESLint rule).

### Email flow: worker calls `sendCriticalAlert`

The email is sent FROM `worker/src/jobs/onboarding-scan.js` (Story 4.4). Story 4.4's AC2 already requires: *"email sent (Story 4.6)"*. This story delivers the implementation that Story 4.4 calls. The integration between the two must be verified: `onboarding-scan.js` imports `sendCriticalAlert` from `shared/resend/client.js`.

### Interception middleware timing

The `interception-redirect.js` middleware runs on every authenticated request to `/`. At Epic 4 stage, only `scan-failed` is wired here (key-revoked and payment-failed are Epic 8 stories). Keep the middleware extensible — add a clear comment marking where Epic 8 will add other interceptions.

### Pattern A visual reference

The interception page stub is at:
`_bmad-output/design-references/screens/17-scan-failed.html`

The email template follows visual-DNA tokens from the token register (`public/css/tokens.css`). No dedicated email stub — derive from the `critical-alert.eta` visual register.

### Dependency on Story 4.4

Story 4.4 creates `scan_jobs` rows and transitions them to FAILED. This story reads those rows. The integration test must seed a FAILED `scan_jobs` row directly (do not re-run the full scan orchestrator in Story 4.6 tests).

### Auth middleware and RLS

The `/scan-failed` route requires auth (Supabase session). The route uses the RLS-aware DB client (`shared/db/rls-aware-client.js`) to query `scan_jobs` — customer can only see their own rows per Story 4.2 RLS policy.

### cron_state check in interception middleware

The interception check should be:
```js
// Story 4.6: scan-failed interception
// cron_state = PROVISIONING AND a FAILED scan_jobs row → intercept
// Epic 8 stories add: PAUSED_BY_KEY_REVOKED → /key-revoked
//                     PAUSED_BY_PAYMENT_FAILURE → /payment-failed
```

This sets up the pattern for Epic 8 without implementing it prematurely.

### Architecture Constraints (all apply)

- NO `console.log` — pino only (AD27; `shared/logger.js` from Story 1.3)
- NO default exports — named exports only
- NO async `.then()` chains — `async/await` only
- NO `err.message` / `err.response` / `err.body` in eta render paths (custom ESLint rule `no-raw-error-to-template`)
  - Translate `scan_jobs.failure_reason` into a safe PT-localized message before passing to template
  - Do NOT render raw `err.message` from Resend or database errors
- NO direct `fetch(` outside `shared/mirakl/api-client.js` — use `resend` npm package instead
- Worker queries DO NOT need `worker-must-filter-by-customer` comment because email send + scan_jobs lookup is scoped to a specific `customer_marketplace_id`

### Email subject (verbatim)

Per epics-distillate Story 4.6 AC1:
> `"A análise do teu catálogo MarketPilot não conseguiu completar"`

Do NOT change this string.

### File locations (exact paths from architecture directory tree)

| Artifact | Path |
|---|---|
| Resend SSoT client | `shared/resend/client.js` |
| Interception route handler | `app/src/routes/interceptions/scan-failed.js` |
| Interception page template | `app/src/views/pages/scan-failed.eta` (named `interception-*.eta` pattern per architecture tree) |
| Email template | `app/src/views/emails/scan-failed.eta` |
| Unit test | `tests/shared/resend/client.test.js` |
| Integration test | `tests/integration/scan-failed.test.js` |
| Middleware to extend | `app/src/middleware/interception-redirect.js` |

Note: the architecture directory tree shows `interception-*.eta` naming pattern for interception page templates. Use `interception-scan-failed.eta` OR `scan-failed.eta` — check existing interception templates (key-revoked, payment-failed) for the actual naming pattern already established in the codebase and match it.

### FR and UX-DR traceability

- **FR15** — Email on scan failure; healthy completion silent. Covered by AC1 + AC3.
- **FR48** — Critical alerts ≤5 min via email. Covered by AC1 (NFR-P9 ≤5min).
- **UX-DR3** — Returning customer landing + interception. Covered by AC2 + Task 6.
- **AD25** — Resend critical alerts SSoT. Covered by Task 1.
- **NFR-P9** — Critical alert ≤5 minutes. The ≤5 min window applies to email dispatch, not delivery. Resend is synchronous in the worker (fire-and-await); the constraint is met if the worker calls `sendCriticalAlert` before setting `scan_jobs.status = FAILED`.

### Previous story patterns to follow

Stories 4.3 and 4.4 set patterns for this story:
- Eta templates use `app/src/views/layouts/default.eta` as the layout.
- Route handlers are Fastify plugin-style, exported as named async functions.
- Integration tests in `tests/integration/` use the service-role client to seed test data directly.
- Pino logger imported as `import { logger } from 'shared/logger.js'` (Story 1.3).

### Project Structure Notes

- `shared/resend/` directory does not yet exist — create it when creating `client.js`.
- `shared/resend/client.js` is importable from both `app/` and `worker/` (shared module boundary allows both). The worker calls `sendCriticalAlert`; the app does NOT call it for this story (app only renders the interception page).
- `tests/shared/resend/` directory does not yet exist — create it alongside the module.
- The `interception-redirect.js` middleware may not exist yet at this stage of development (Epic 8 builds out most interceptions). If it does not exist, create it with only the scan-failed check for now and register it in `server.js` on the `/` route before the dashboard handler.

### References

- Epic 4 Story 4.6 spec: `_bmad-output/planning-artifacts/epics-distillate/02-epic-4-onboarding.md` §Story 4.6
- Architecture AD25 (Resend): `_bmad-output/planning-artifacts/architecture-distillate/03-decisions-E-J.md` §AD25
- SSoT modules index: `_bmad-output/planning-artifacts/epics-distillate/_index.md` §Cross-Cutting: SSoT Modules Index
- Directory tree (exact file paths): `_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md`
- UX skeleton §8.1 interception pattern (key-revoked reference): `_bmad-output/planning-artifacts/ux-skeleton.md` §8.1
- UX-DR3: `_bmad-output/planning-artifacts/epics-distillate/_index.md` §UX-DRs
- Design reference (Pattern A): `_bmad-output/design-references/screens/17-scan-failed.html`
- Implementation patterns (naming, exports, atomicity): `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md`
- Architectural constraints: `_bmad-output/planning-artifacts/architecture-distillate/_index.md` §Cross-Cutting Constraints

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- `shared/resend/client.js` throws at import-time if `RESEND_API_KEY` is unset (fail-fast per spec). Tests must set `RESEND_API_KEY=re_test_stub_key` in `.env.test` before running any file that imports the worker or this module.
- `worker/src/email/scan-failed-email.js` helper renders the email template using Eta directly (not via Fastify view engine). Path resolution: `worker/src/email/ → ../../.. → repo root → app/src/views`.
- `onboarding-scan.js` replaces the graceful try/catch stub with a direct import of `sendCriticalAlert`. The `sendScanFailedAlert` wrapper resolves customer email + renders template + calls `sendCriticalAlert` — all errors caught internally (best-effort).
- `app/src/middleware/interception-redirect.js` is a new file (Epic 8 did not exist yet). It uses a LATERAL subquery to get the latest scan_jobs status efficiently.
- The `/` route in server.js is wrapped in a named Fastify encapsulated plugin (`dashboardRoutes`) so that `authMiddleware + rlsContext + interceptionRedirect + releaseRlsClient` hooks apply only to that route.
- All 6 unit tests in `tests/shared/resend/client.test.js` pass (verified with `RESEND_API_KEY=re_test_stub_key node --test`).
- No ESLint errors across the codebase (14 pre-existing warnings in stub test files, none from Story 4.6 code).

### File List

- `shared/resend/client.js` (new)
- `worker/src/email/scan-failed-email.js` (new)
- `app/src/views/emails/scan-failed.eta` (new)
- `app/src/views/pages/scan-failed.eta` (new)
- `app/src/routes/interceptions/scan-failed.js` (new)
- `app/src/middleware/interception-redirect.js` (new)
- `tests/integration/scan-failed.test.js` (new)
- `worker/src/jobs/onboarding-scan.js` (modified — replaced graceful stub with real sendCriticalAlert + sendScanFailedAlert helper)
- `app/src/server.js` (modified — registered scanFailedRoutes + dashboardRoutes encapsulated plugin with interception)
- `tests/shared/resend/client.test.js` (modified — lint fix: renamed mockResend to _mockResend)
- `tests/app/routes/interceptions/scan-failed.test.js` (modified — lint fix: renamed getSupabaseAdmin + makeSendCriticalAlertSpy to _ prefix)
