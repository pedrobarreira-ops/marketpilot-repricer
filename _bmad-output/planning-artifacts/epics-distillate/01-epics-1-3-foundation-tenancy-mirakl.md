---
type: bmad-distillate-section
sources:
  - "../epics.md"
parent: "_index.md"
part: 1
of: 8
---

This section covers Epic 1 Foundation & Trust Primitives (5 stories), Epic 2 Multi-Tenant Isolation (2 stories), and Epic 3 Mirakl Integration Foundation (3 stories) — 10 stories total. Part 1 of 8 from epics.md.

## Epic 1: Foundation & Trust Primitives

**Goal.** Self-serve signup; server-side trust primitives (envelope encryption, redacted logs, atomic profile creation, /health from worker_heartbeats freshness, source-context capture, founder_admins seed) in place from day 1.

**Coverage:** FR1, FR2 (negative-assertion), FR3, FR6 (seed+middleware only), FR7, FR11 (crypto module only), FR45. NFRs: NFR-S1, NFR-S2, NFR-S5, NFR-R1, NFR-Sc4. ADs: AD1, AD3, AD4 partial, AD23, AD27, AD29 (with F3). UX-DR1.

**Atomicity bundles:** F3 + AD29 ship as a single story (Story 1.4).

**Constraints:** Story 1.1 ships vanilla ESLint + JSDoc rule + base config only; ACs include negative assertions for AD18 (no Mirakl webhook code paths) and AD28 (no extra validator library — Fastify built-in JSON Schema only).

**Phase 2 reservations:** `shop_api_key_vault.master_key_version` (defaults to 1).

---

### Story 1.1: Scaffold project, two-service Coolify deploy, composed /health
- **Trace:** Implements AD1, AD23; FRs FR45; NFRs NFR-R1, NFR-Sc4. Size L.
- **Bob-trace:** SSoT modules: `app/src/server.js`, `worker/src/index.js`, `worker/src/jobs/heartbeat.js`, `app/src/routes/health.js`, `eslint.config.js`. Migrations: `db/migrations/202604301212_create_worker_heartbeats.sql`. First story (no deps).
- **Acceptance Criteria:**
  1. **Given** a fresh clone **When** I run `npm install && npm run start:app` **Then** Fastify returns 200 on `GET /` on `localhost:3000` **And** `package.json` has `engines.node = ">=22.0.0"` and `type = "module"` (JS-ESM) **And** dependencies match architecture's pinned set (fastify + plugins, eta, pino, pg, supabase-js, stripe, resend, node-cron) plus dev: eslint **And** ESLint vanilla config + JSDoc completeness rule pass with one example annotated function.
  2. **Given** required env vars set (`MASTER_KEY_BASE64`, Supabase URL + service-role key) **When** I run `npm run start:worker` **Then** the worker writes a row to `worker_heartbeats(id bigserial, worker_instance_id text NOT NULL, written_at timestamptz NOT NULL DEFAULT NOW())` every 30 seconds via `worker/src/jobs/heartbeat.js` **And** logs `info`-level boot message via pino structured JSON to stdout **And** the worker process does not depend on the app server.
  3. **Given** the worker is writing heartbeats **When** the app server receives `GET /health` **Then** response is 200 IFF (a) `SELECT 1` from Postgres returns within 1s AND (b) the most recent `worker_heartbeats.written_at` is < 90 seconds old **And** response is 503 with `{status: "degraded", details: {db, worker_heartbeat_age_s}}` if either fails **And** the route is defined in `app/src/routes/health.js` (no Fastify auth middleware applied — public endpoint per FR45).
  4. **Given** Coolify configured with two services **When** I `git push` to main **Then** Coolify deploys both services in parallel from one image with start commands `npm run start:app` (port 3000, public as `app.marketpilot.pt`) and `npm run start:worker` (no public URL) **And** both services share the same env-var subset (Coolify-managed; verified by spot-checking three vars).
  5. **Given** the scaffolded project **When** I inspect `package.json` and source tree **Then** there is NO Mirakl webhook listener defined (AD18 — polling-only) **And** the validator dep is Fastify built-in JSON Schema only — `zod`, `yup`, `joi`, `ajv` are NOT in dependencies (AD28) **And** there is no SPA framework (`react`, `vue`, `svelte`, `angular` not in deps), no bundler (`vite`, `webpack`, `rollup`, `esbuild` not in deps), no TypeScript compiler (`typescript` not in deps), no Redis/BullMQ **And** there is no ES UI translation file or `i18n` infrastructure (PT-only at MVP per NFR-L2).
  6. **Given** the project scaffold is complete **When** I run `node --test 'tests/integration/scaffold-smoke.test.js'` **Then** the test starts both services, asserts `/health` returns 200 within 60s, asserts a `worker_heartbeats` row appears within 60s, then shuts down cleanly.

---

### Story 1.2: Envelope encryption module, master-key loader, secret-scanning hook
- **Trace:** Implements AD3; FRs FR11 (crypto module only — vault wiring lands Epic 4); NFRs NFR-S1. Size M.
- **Bob-trace:** SSoT: `shared/crypto/envelope.js`, `shared/crypto/master-key-loader.js`, `scripts/check-no-secrets.sh`, `scripts/rotate-master-key.md`. Migration: `db/migrations/202604301204_create_shop_api_key_vault.sql` (table only — wiring in Epic 4). Depends on Story 1.1. Enables Story 4.3, Story 10.x.
- **Acceptance Criteria:**
  1. **Given** the master-key loader **When** the worker process starts with `MASTER_KEY_BASE64` set to a valid 32-byte base64 value **Then** `shared/crypto/master-key-loader.js` validates the key length, holds it in process memory only, and never writes it to disk or logs **And** if `MASTER_KEY_BASE64` is missing or malformed, the worker exits with a clear error message (no partial-state startup) **And** the master key is never read from a file — env var only.
  2. **Given** `shared/crypto/envelope.js` **When** I call `encryptShopApiKey(plaintext, masterKey)` **Then** I get back `{ciphertext: Buffer, nonce: Buffer (12 bytes), authTag: Buffer (16 bytes), masterKeyVersion: 1}` **And** decryption via `decryptShopApiKey({ciphertext, nonce, authTag, masterKey})` returns the original plaintext **And** decryption with a tampered ciphertext or auth tag throws `KeyVaultDecryptError` **And** unit tests cover happy path + tamper detection + wrong-key rejection (`tests/shared/crypto/envelope.test.js`).
  3. **Given** the `shop_api_key_vault` migration **When** I apply it to a fresh Postgres **Then** the table exists per architecture's schema: `customer_marketplace_id uuid PK FK`, `ciphertext bytea NOT NULL`, `nonce bytea NOT NULL`, `auth_tag bytea NOT NULL`, `master_key_version integer NOT NULL DEFAULT 1`, `last_validated_at timestamptz`, `last_failure_status smallint`, `created_at`, `updated_at` **And** RLS policy `shop_api_key_vault_select_own` is present in the same migration **And** `scripts/rls-regression-suite.js` is extended with a test that asserts customer A cannot read customer B's vault row.
  4. **Given** the secret-scanning hook is installed **When** I attempt `git commit` with a file containing any of `MASTER_KEY`, `shop_api_key`, `sk_live_`, `sk_test_` (the four AD3-locked patterns), OR the heuristic `Authorization: Bearer` **Then** `scripts/check-no-secrets.sh` (configured as a pre-commit hook) blocks the commit and prints which file/pattern matched **And** the hook is idempotent **And** the hook's regex matches `MASTER_KEY_BASE64=...` AND `MASTER_KEY=...` AND any string containing `shop_api_key` (case-sensitive) AND `sk_live_<anything>` AND `sk_test_<anything>`.
  5. **Given** the rotation runbook **When** I open `scripts/rotate-master-key.md` **Then** it documents the 5-step rotation procedure verbatim from architecture AD3 (generate new key → deploy as `MASTER_KEY_BASE64_NEXT` alongside existing → worker re-encrypts every vault row with per-row advisory lock → swap env vars → 1Password backup updated) **And** the runbook is markdown only, NOT executable code.

---

### Story 1.3: Pino structured logging with redaction list
- **Trace:** Implements AD27; FRs (foundation — no positive FR); NFRs NFR-S1 (logs never contain cleartext keys). Size S.
- **Bob-trace:** SSoT: `shared/logger.js` (or `app/src/lib/logger.js` + `worker/src/lib/logger.js` factory pair). Depends on Story 1.1.
- **Acceptance Criteria:**
  1. **Given** the pino config **When** the app server boots and writes a log line containing any of `Authorization`, `authorization`, `Cookie`, `cookie`, `Set-Cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` **Then** the value is replaced with `'[REDACTED]'` in the output stream **And** the same redaction applies to the worker's pino instance **And** redaction works whether the field is at the top level or nested in an object. Both casings (uppercase + lowercase) listed for `Authorization`, `Cookie`, `Set-Cookie` because Node's HTTP parser yields lowercase but ad-hoc code may construct log objects with the capitalized form (extended 2026-05-02 per Story 1.3 review).
  2. **Given** a log line emitted by the app server **When** I read it from stdout **Then** it is valid JSON (one line per record, structured) **And** every record carries `customer_marketplace_id` (or `null` if pre-auth), `request_id` (app) or `cycle_id` (worker), and `event_type` if the line corresponds to an audit event **And** log levels respected: `info` for cycle-start/cycle-end, `warn` for retried failures, `error` for critical events.
  3. **Given** a unit test asserting redaction **When** I run `node --test tests/shared/logger.test.js` **Then** the test feeds a sample object containing a `shop_api_key` field through pino's stream and asserts the secret value never appears in the captured output (only `[REDACTED]`) **And** the test also covers `Authorization` header redaction in a simulated Fastify request log.
  4. **Given** the codebase **When** I grep for `console.log`, `console.error`, `process.stdout.write` outside `scripts/` **Then** there are zero matches (ESLint base rule enforces this; pre-commit hook double-checks per Story 1.2).

---

### Story 1.4: Signup endpoint, atomic profile trigger, source-context capture
- **Trace:** Implements AD29 (with F3 — atomicity bundle), FR7 source-context middleware; FRs FR1, FR2 (negative-assertion), FR3, FR7; NFRs NFR-S5. Size L.
- **Atomicity:** Bundle A — F3 + AD29 ship as a single PR — schema migration + trigger + endpoint + JSON Schema validation + safe-error mapping all in one commit.
- **Bob-trace:** SSoT: `app/src/routes/_public/signup.js`, `app/src/routes/_public/login.js`, `app/src/routes/_public/forgot-password.js`, `app/src/routes/_public/reset-password.js`, `app/src/middleware/source-context-capture.js`, `app/src/middleware/auth.js`, `app/src/views/pages/signup.eta`, `app/src/views/pages/login.eta`. Migrations: `db/migrations/202604301200_create_customers.sql`, `db/migrations/202604301201_create_customer_profiles_with_trigger.sql`. Depends on Stories 1.1, 1.3. Enables Story 4.3, every customer-scoped feature.
- **Pattern A/B/C contract:**
  - Behavior: FR1, FR2, FR3, FR7; NFR-S5
  - Structure: UX skeleton §1 sitemap auth screens (`/signup`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`) + Supabase Auth defaults + visual-DNA tokens (Manrope/Inter, navy primary, radius scale per UX skeleton §10)
  - Visual: Pattern C — no per-screen stub; auth surfaces share consistent chrome.
- **Acceptance Criteria:**
  1. **Given** the signup migration **When** I apply `202604301200_create_customers.sql` then `202604301201_create_customer_profiles_with_trigger.sql` **Then** `customers` table exists with columns from architecture (id PK FK to auth.users, email, source, campaign, deletion_initiated_at, deletion_scheduled_at, stripe_customer_id, stripe_subscription_id, created_at, updated_at) **And** `customer_profiles` table exists with `customer_id PK FK to customers ON DELETE CASCADE`, `first_name TEXT NOT NULL`, `last_name TEXT NOT NULL`, `company_name TEXT NOT NULL`, `nif TEXT` (nullable — captured later per F7), timestamps **And** the Postgres trigger `trg_handle_new_auth_user` exists on `auth.users AFTER INSERT FOR EACH ROW` **And** the trigger function `handle_new_auth_user()` is `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public` and reads `NEW.raw_user_meta_data ->> 'first_name'/'last_name'/'company_name'/'source'/'campaign'` **And** the trigger validates each required field non-empty and `RAISE EXCEPTION ... USING ERRCODE = '23502', HINT = 'PROFILE_FIRST_NAME_REQUIRED'` (or `_LAST_`/`_COMPANY_`) on missing/empty **And** RLS policies for both tables present in the same migrations.
  2. **Given** the signup route `POST /signup` **When** the customer submits `{email, password, first_name, last_name, company_name}` with all required fields valid **Then** the route calls `supabase.auth.signUp({email, password, options: {data: {first_name, last_name, company_name, source, campaign}}})` **And** Supabase Auth creates the `auth.users` row, the trigger fires, `customers` + `customer_profiles` rows are created in the same transaction **And** the response redirects to `/verify-email` (Supabase chrome) per UX-DR1 **And** the customer's `source` and `campaign` are persisted on the `customers` row per FR7.
  3. **Given** the signup route receives a request missing `first_name` **When** the trigger raises with `HINT = 'PROFILE_FIRST_NAME_REQUIRED'` **Then** Supabase Auth returns the error to the route **And** the route inspects the error's HINT field and renders a PT-localized field-level error: e.g., *"Por favor introduz o teu nome próprio."* **And** the customer remains on `/signup` with their other fields preserved (email, last_name, company_name) **And** no partial-state `customers` or `auth.users` rows exist (verify with a DB query).
  4. **Given** the source-context-capture middleware **When** a request lands on `/signup?source=free_report&campaign=tony_august` **Then** the middleware extracts `?source` and `?campaign` query params, persists them to a session/cookie until signup completes, and propagates them to `signUp options.data` so the trigger writes them to `customers.source` / `customers.campaign` **And** unknown / missing params are stored as NULL (NOT empty string) **And** the middleware is wired into the public-routes group only (no auth required).
  5. **Given** the schema (negative assertion for FR2) **When** I inspect the database **Then** there is NO `customer_team_members` or equivalent multi-user table **And** the schema design produces exactly one `customers` row + one `customer_profiles` row per `auth.users` row (1:1:1) **And** an integration test (`tests/integration/signup-single-user.test.js`) attempts to create a second `customers` row for the same `auth.uid()` and asserts it fails (UNIQUE constraint or RLS rejection).
  6. **Given** the password reset route per FR3 **When** the customer submits `POST /forgot-password` with their email **Then** the route calls `supabase.auth.resetPasswordForEmail()` and Supabase sends the email-verified reset link **And** `/reset-password` accepts the link's recovery token and updates the password via Supabase Auth **And** there is no MarketPilot-side password storage (Supabase handles bcrypt).
  7. **Given** an integration test **When** I run `tests/integration/signup-flow.test.js` **Then** it covers: happy-path signup → trigger fires → both rows created; missing-field rejection → trigger raises → no rows created → PT field error; source-context capture from `?source=free_report` → persisted on `customers.source`.

---

### Story 1.5: Founder admins seed + admin-auth middleware
- **Trace:** Implements AD4 (partial — seed + middleware only; admin status page UI in Epic 8); FRs FR6, FR47 (founder-side primitive). Size S.
- **Bob-trace:** SSoT: `app/src/middleware/founder-admin-only.js`. Migration: `db/migrations/202604301202_create_founder_admins.sql`. Depends on Story 1.4 (auth middleware). Enables Story 8.10, every admin-route gate.
- **Acceptance Criteria:**
  1. **Given** the migration **When** I apply `202604301202_create_founder_admins.sql` **Then** `founder_admins` exists with columns `email TEXT PRIMARY KEY`, `notes TEXT`, `created_at timestamptz NOT NULL DEFAULT NOW()` **And** there is NO RLS policy on this table (system table; service-role-only access) **And** the migration includes a seed insert for Pedro's founder email.
  2. **Given** the middleware `app/src/middleware/founder-admin-only.js` **When** an authenticated request lands on a route gated by `founder-admin-only` **Then** the middleware checks the requesting user's email against `founder_admins` using a service-role DB connection **And** if the email is present → request proceeds with a `request.adminContext = {email}` annotation **And** if the email is absent → response is 403 with PT-localized message *"Esta página é apenas para administração."* **And** unauthenticated requests redirect to `/login?next=...` per UX-DR1.
  3. **Given** the middleware is wired **When** I send a request as a non-founder customer to a route gated by it **Then** the request never reaches the route handler **And** the access denial is logged at `info` level via pino with `customer_marketplace_id`, `request_id`, and `event_type: 'admin_access_denied'` **And** Step 4 Notes-for-Pedro tracks the consideration of hashing/truncating email in this log line for GDPR PII minimization.
  4. **Given** an integration test **When** I run `tests/integration/admin-middleware.test.js` **Then** it covers: unauthenticated → redirect to login; authenticated non-founder → 403; authenticated founder → request proceeds with adminContext annotation.

---

## Epic 2: Multi-Tenant Isolation

**Goal.** Customer data isolated at Postgres layer via RLS on every customer-scoped table. RLS regression suite runs in CI and blocks deploys.

**Coverage:** FR5 (full); NFR-S3, NFR-I3; AD2, AD30.

**Convention established:** Every customer-scoped table migration in Epics 4-11 includes its RLS policy in the same migration file AND extends `scripts/rls-regression-suite.js`.

---

### Story 2.1: RLS-aware app DB client + service-role worker DB client + transaction helper
- **Trace:** Implements AD2; FRs FR5 (foundation); NFRs NFR-S3. Size M.
- **Bob-trace:** SSoT: `shared/db/rls-aware-client.js`, `shared/db/service-role-client.js`, `shared/db/tx.js`, `app/src/middleware/rls-context.js`. Depends on Story 1.4. Enables every customer-scoped feature.
- **Acceptance Criteria:**
  1. **Given** `shared/db/rls-aware-client.js` exports `getRlsAwareClient(jwt)` **When** the app server receives a request with a valid Supabase Auth session **Then** the middleware in `app/src/middleware/rls-context.js` extracts the JWT, calls `getRlsAwareClient(jwt)`, and binds the resulting client to `request.db` **And** every query through `request.db` runs as the JWT subject — RLS policies fire automatically **And** the service-role key is NEVER reachable from this code path (verify via grep against `app/`).
  2. **Given** `shared/db/service-role-client.js` exports `getServiceRoleClient()` **When** the worker process boots **Then** it instantiates a `pg` Pool with `process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL` (or equivalent service-role connection string) **And** the pool config sets a small max (e.g., `max: 5`) appropriate for MVP scale **And** the worker can issue raw `pg_try_advisory_lock(<bigint>)` calls **And** the service-role client is NEVER instantiated in the app process.
  3. **Given** a service-role client and a callback **When** I call `tx(client, async (txClient) => {...})` from `shared/db/tx.js` **Then** the helper opens a transaction, runs the callback, commits on success, rolls back on throw **And** the helper supports nested savepoints if called recursively (or rejects nesting with a clear error — pick one and document).
  4. **Given** an integration test **When** I run `tests/shared/db/clients.test.js` **Then** it covers: rls-aware-client returns rows scoped to JWT subject; service-role-client bypasses RLS; tx helper commits on success and rolls back on throw.
  5. **Given** ESLint configuration **When** I write `import { Pool } from 'pg'` directly inside `app/src/` **Then** ESLint flags it (custom rule: app routes must not instantiate `pg` directly — use `getRlsAwareClient` factory).

---

### Story 2.2: RLS regression suite + CI block
- **Trace:** Implements AD30; FRs FR5; NFRs NFR-S3, NFR-I3. Size M.
- **Bob-trace:** SSoT: `scripts/rls-regression-suite.js`, `tests/integration/rls-regression.test.js`, `db/seed/test/two-customers.sql`. Depends on Stories 1.4, 1.2, 2.1. Enables every subsequent customer-scoped table story extends this suite.
- **Acceptance Criteria:**
  1. **Given** the seed file `db/seed/test/two-customers.sql` **When** I apply it to a fresh test Postgres **Then** two distinct customers exist with their own `customer_profiles` rows AND `shop_api_key_vault` rows.
  2. **Given** the regression suite `scripts/rls-regression-suite.js` **When** I run it **Then** for every customer-scoped table, the suite (a) authenticates as customer A via JWT, attempts SELECT/INSERT/UPDATE/DELETE on a row owned by customer B identified by ID, asserts 0 rows returned or operation rejected; (b) repeats with customer B's JWT against customer A's rows **And** the suite covers (at this story): `customers`, `customer_profiles`, `shop_api_key_vault` **And** the suite is parameterized so subsequent stories add their tables to a single config array — adding a table = one line change.
  3. **Given** an `npm run test:rls` script **When** I run it **Then** the regression suite executes and reports per-table pass/fail **And** any failure exits with non-zero code.
  4. **Given** a CI configuration (GitHub Actions or Coolify pre-deploy hook) **When** a PR runs CI or a deploy is triggered **Then** `npm run test:rls` runs and blocks on failure **And** the README documents the convention: every new customer-scoped table migration MUST extend the seed AND the suite in the same PR.
  5. **Given** the convention **When** a developer (or BAD subagent) attempts to ship a customer-scoped table without extending the suite **Then** the integration test for that table will fail with a clear "this table is not in the RLS regression suite" message.

---

## Epic 3: Mirakl Integration Foundation

**Goal.** System can talk to Mirakl reliably (retry/backoff, error mapping, PT-localized safe error messages). HTTP client + endpoint wrappers (A01, PC01, OF21, P11) + Mirakl mock server (seeded from `verification-results.json` live captures) + smoke-test script.

**Coverage:** Foundation (FR8-FR11, FR12-FR15, FR20, FR23); NFR-I1; AD5, AD16 partial.

**Constraints:**
- ESLint custom rule `no-direct-fetch` ships with `shared/mirakl/api-client.js` (Story 3.1) per Pedro's refined ESLint sequencing.
- Mirakl mock server test fixtures preserved exactly from `verification-results.json` (live Worten captures from 2026-04-30); do NOT replace with synthetic data.

**Phase 2 reservations:** `marketplace_operator` enum at `'WORTEN'` only at MVP; Phase 2 extends with `'PHONE_HOUSE'`, `'CARREFOUR_ES'`, `'PCCOMPONENTES'`, `'MEDIAMARKT'`.

---

### Story 3.1: Mirakl HTTP client port — apiClient + retry/backoff + safe-error mapping + no-direct-fetch ESLint rule
- **Trace:** Implements AD5; FRs (foundation); NFRs NFR-I1. Size M.
- **Bob-trace:** SSoT: `shared/mirakl/api-client.js` (`mirAklGet`, `MiraklApiError` class — `mirAklGet` is the only Mirakl HTTP export per AD5; PRI01 multipart submit is handled in `shared/mirakl/pri01-writer.js`, Epic 6, since no other POST endpoints exist), `shared/mirakl/safe-error.js` (`getSafeErrorMessage`), `eslint-rules/no-direct-fetch.js`. Depends on Stories 1.1, 1.3. Enables Stories 3.2, 3.3.
- **ESLint rules:** `no-direct-fetch`
- **SSoT modules:** `shared/mirakl/api-client.js`, `shared/mirakl/safe-error.js`
- **Acceptance Criteria:**
  1. **Given** `shared/mirakl/api-client.js` exports `mirAklGet(baseUrl, path, params, apiKey)` as the single source of truth for Mirakl HTTP GET **When** I call `mirAklGet` with a Worten URL + path + apiKey **Then** the request includes header `Authorization: <apiKey>` (raw — NO `Bearer` prefix; per AD5 + DynamicPriceIdea production confirmation) **And** the request uses Node's built-in `fetch` (Node ≥22) — no third-party HTTP library **And** on 429 or 5xx, the client retries up to 5 times with exponential backoff `[1s, 2s, 4s, 8s, 16s]` (max 30s per delay) **And** transport errors (network timeout, ECONNRESET, etc.) are retryable on the same schedule **And** 4xx (except 429) is non-retryable — throws `MiraklApiError` immediately.
  2. **Given** any error from a Mirakl call **When** the caller receives a `MiraklApiError` **Then** the error has `.status` (HTTP status code; 0 for transport), `.code` (program-readable identifier like `WORTEN_API_KEY_INVALID`), `.safeMessagePt` (PT-localized customer-facing string) **And** the `apiKey` is never present in the error message, the error stack, or the error's serialized form **And** pino redaction (Story 1.3) applies to any logged error — `Authorization` header values redact to `[REDACTED]`.
  3. **Given** `shared/mirakl/safe-error.js` exports `getSafeErrorMessage(err)` **When** I pass a `MiraklApiError` for a 401 status **Then** the function returns `"A chave Worten é inválida. Verifica a chave e tenta novamente."` **And** for 429 / 5xx after retry exhaustion: `"O Worten está temporariamente indisponível. Vamos tentar novamente em breve."` **And** for a generic 4xx: `"Pedido recusado pelo Worten. Contacta o suporte se persistir."` **And** the function NEVER returns the raw upstream error message.
  4. **Given** the custom ESLint rule `eslint-rules/no-direct-fetch.js` **When** ESLint runs against the codebase **Then** any `fetch(...)` call OUTSIDE `shared/mirakl/` directory triggers a lint error: *"Direct fetch() forbidden. Use shared/mirakl/api-client.js for GET; PRI01 multipart submit lives in shared/mirakl/pri01-writer.js (Epic 6)."* The directory-level scope allows `api-client.js` and `pri01-writer.js` to share the rule's allowlist without bespoke per-file exceptions **And** the rule also flags `import { fetch }` or destructured equivalent **And** Story 1.1's vanilla ESLint config is updated to load this custom rule **And** legitimate non-Mirakl fetches (none expected at MVP) require an `// eslint-disable-next-line no-direct-fetch` with justification comment.
  5. **Given** unit tests in `tests/shared/mirakl/api-client.test.js` **When** I run them **Then** they cover: happy GET path, retry on 429 → succeed on attempt 3, retry exhaustion on 500 → throws MiraklApiError with status=500, immediate throw on 401, transport error retryable, apiKey redaction in error stack **And** tests run against a Fastify mock server (not the real Worten) using fixture responses.

---

### Story 3.2: Endpoint wrappers — A01, PC01, OF21, P11 + Mirakl mock server
- **Trace:** Implements AD5, AD16 (partial); FRs (foundation for FR8-FR15, FR20); NFRs NFR-I1. Size L.
- **Bob-trace:** SSoT: `shared/mirakl/a01.js`, `shared/mirakl/pc01.js`, `shared/mirakl/of21.js`, `shared/mirakl/p11.js`, `shared/mirakl/self-filter.js`, `tests/mocks/mirakl-server.js`. Test fixtures: `tests/fixtures/a01/easy-store-2026-04-30.json`, `tests/fixtures/pc01/worten-2026-04-30.json`, `tests/fixtures/of21/easy-store-test-sku-2026-04-30.json` (seeded from `verification-results.json`). Depends on Story 3.1. Enables Story 3.3, Story 4.4, Story 7.1.
- **Acceptance Criteria:**
  1. **Given** `shared/mirakl/a01.js` exports `getAccount(baseUrl, apiKey)` **When** I call it **Then** it returns `{shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels[], domains[]}` (typed via JSDoc `@typedef AccountInfo`) **And** values come from the Mirakl `GET /api/account` response.
  2. **Given** `shared/mirakl/pc01.js` exports `getPlatformConfiguration(baseUrl, apiKey)` **When** I call it **Then** it returns the full PC01 response including (at minimum): `channel_pricing` enum (`SINGLE`/`MULTI`/`DISABLED`), `operator_csv_delimiter` (`COMMA`/`SEMICOLON`), `offer_prices_decimals`, `discount_period_required`, `competitive_pricing_tool`, `scheduled_pricing`, `volume_pricing`, `multi_currency`, `order_tax_mode` **And** the function preserves the entire JSON for `customer_marketplaces.platform_features_snapshot` JSONB storage.
  3. **Given** `shared/mirakl/of21.js` exports `getOffers(baseUrl, apiKey, {pageToken?, pageSize?})` **When** I call it **Then** it returns an array of offers with `{shop_sku, product_sku, ean, quantity, price, total_price, min_shipping_price, channels[], active}` plus a pageToken for pagination **And** it iterates pages until exhaustion when called as `getAllOffers(baseUrl, apiKey)` (sibling helper).
  4. **Given** `shared/mirakl/p11.js` exports `getProductOffersByEan(baseUrl, apiKey, {ean, channel, pricingChannelCode})` **When** I call it for a single EAN + channel pair **Then** it issues `GET /api/products/offers?product_references=EAN|<ean>&channel_codes=<channel>&pricing_channel_code=<channel>` **And** it returns the raw offer list (filtering happens in `shared/mirakl/self-filter.js`, Epic 7) **And** for batch lookups, `getProductOffersByEanBatch(baseUrl, apiKey, {eans, channel})` accepts up to 100 EANs per call (concatenated as `EAN|x,EAN|y,...` per empirical pattern).
  5. **Given** the Mirakl mock server `tests/mocks/mirakl-server.js` **When** test code starts it on a free port **Then** the server returns fixture responses for known requests (replays `verification-results.json`-derived JSON) **And** unknown requests return a deliberate 404 (so tests fail loudly on un-mocked calls) **And** the server supports configurable failure-injection (e.g., `mockServer.injectError({path, status: 429, count: 2})` for retry-test scenarios).
  6. **Given** unit tests in `tests/shared/mirakl/a01-pc01-of21-p11.test.js` **When** I run them **Then** they cover each wrapper against the mock server returning the fixture responses **And** they assert the parsed return shape matches the JSDoc typedefs **And** they assert that the wrappers do NOT bypass the api-client (verified by ESLint `no-direct-fetch` rule from Story 3.1).
  7. **Given** `shared/mirakl/self-filter.js` exports `filterCompetitorOffers(rawOffers, ownShopName)` **When** Story 4.4 (onboarding scan) or Story 7.2 (engine STEP 1) passes a P11 response to it **Then** it applies the AD13 + AD14 filter chain in this order: `o.active === true` → `Number.isFinite(o.total_price) && o.total_price > 0` → `o.shop_name !== ownShopName` → `.sort((a, b) => a.total_price - b.total_price)` (ascending) **And** it returns `{filteredOffers: [...], collisionDetected: boolean}` — `collisionDetected` is `true` when more than one offer in the raw list matches `ownShopName` (per AD13 defensive collision check) **And** unit tests in `tests/shared/mirakl/self-filter.test.js` cover: zero-price-placeholder filtered out, inactive offers filtered out, own-shop filtered out, sort order verified, collision detection signals correctly, empty-after-filter case (caller must handle Tier 3 path).

---

### Story 3.3: mirakl-empirical-verify smoke-test script + reusable for first-customer onboarding
- **Trace:** Implements AD16 (smoke-test reuse); FRs (operational tooling consumed by FR9 inline validation + Story 4.4 onboarding orchestration). Size S.
- **Bob-trace:** SSoT: `scripts/mirakl-empirical-verify.js`. Depends on Story 3.2. Enables Story 4.3 (key entry inline validation), Story 4.4 (full smoke-test before OF21 fan-out).
- **Acceptance Criteria:**
  1. **Given** `scripts/mirakl-empirical-verify.js` **When** I run `npm run mirakl:verify` with `.env.local` set to my own (or Gabriel's) Worten credentials **Then** the script runs in this order: A01 → PC01 → OF21 (first page) → P11 (one EAN per channel) → reports pass/fail per assertion **And** assertions include:
      - A01 returns `shop_id`, `shop_name`, `currency_iso_code: "EUR"`, `state: "OPEN"`
      - PC01 returns `channel_pricing: SINGLE` (Worten MVP assumption per AD6); aborts onboarding with PT message if DISABLED
      - PC01 returns `operator_csv_delimiter`, `offer_prices_decimals` populated
      - OF21 first page returns ≥1 offer with `shop_sku` populated
      - P11 for a known-good EAN + channel returns offers with `active === true` after filtering, all `total_price > 0` after the placeholder filter
    **And** the script writes its output to `verification-results.json` (gitignored).
  2. **Given** the script's reusability for customer onboarding **When** Story 4.3 (key entry validation) calls into the same code **Then** the inline-validation path uses a single P11 call against a known-good reference EAN (the lightweight subset of the smoke test) within the 5-second budget per NFR-P6 **And** Story 4.4 (onboarding orchestration) runs the full smoke-test sequence on the freshly-validated key BEFORE kicking off the full catalog scan — fail-loudly if any assertion fails.
  3. **Given** the script run produces output **When** I inspect `verification-results.json` **Then** it contains: timestamp, masked apiKey hash (NOT the key itself), per-call response status + parsed shape + assertion results **And** the file is in `.gitignore` (the actual responses contain PII / customer data).
