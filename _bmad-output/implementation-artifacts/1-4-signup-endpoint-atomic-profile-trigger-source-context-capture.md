# Story 1.4: Signup endpoint, atomic profile trigger, source-context capture

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Pedro (founder),
I want a self-serve signup flow that creates `auth.users`, `customers`, and `customer_profiles` rows in a single atomic Postgres transaction (driven by a `SECURITY DEFINER` trigger on `auth.users`), validates the required B2B profile fields (`first_name`, `last_name`, `company_name`) inside that transaction, captures the `?source` / `?campaign` funnel-attribution params (FR7) on `customers.source` / `customers.campaign`, and exposes login + email-verified password reset routes,
so that no MarketPilot customer can ever land in an orphan-auth-without-profile state, every customer carries the company-entity fields needed for Moloni invoicing later, and Pedro retains the funnel-attribution datapoint that pays the free-report → paid-tool conversion path. This story ships **Atomicity Bundle A (F3 + AD29)** as a single PR — schema + trigger + endpoints + JSON Schema validation + safe-error mapping + middleware all land together.

## Acceptance Criteria

1. **Given** the two new migrations applied to a fresh Postgres in lexicographic order — `supabase/migrations/202604301200_create_customers.sql` then `supabase/migrations/202604301201_create_customer_profiles_with_trigger.sql` — **When** I inspect the database **Then**:
    - `customers` table exists with columns per [Source: architecture-distillate/06-database-schema.md#customers (Identity)] verbatim DDL: `id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`, `email text NOT NULL`, `source text` (nullable, FR7), `campaign text` (nullable, FR7), `deletion_initiated_at timestamptz`, `deletion_scheduled_at timestamptz`, `day5_reminder_sent_at timestamptz`, `stripe_customer_id text UNIQUE`, `stripe_subscription_id text UNIQUE`, `created_at`, `updated_at` **And** the partial index `idx_customers_deletion_scheduled_at ON customers(deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL` is present **And** RLS is ENABLED on the table with policy `customers_select_own ON customers FOR SELECT USING (id = auth.uid())` (no customer-side INSERT/UPDATE/DELETE policy — writes go through the trigger via service-role only).
    - `customer_profiles` table exists per [Source: architecture-distillate/06-database-schema.md#customer_profiles (Identity)] verbatim DDL: `customer_id uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE`, `first_name text NOT NULL`, `last_name text NOT NULL`, `company_name text NOT NULL`, `nif text` (nullable, captured at first Moloni invoice per AD22 — DO NOT make NOT NULL), `created_at`, `updated_at` **And** RLS is ENABLED with policies `customer_profiles_select_own FOR SELECT USING (customer_id = auth.uid())` and `customer_profiles_update_own FOR UPDATE USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid())` (UPDATE allowed for future Phase-2 self-edit; INSERT/DELETE remain trigger / cascade-only).
    - The trigger function `public.handle_new_auth_user()` exists exactly per [Source: architecture-distillate/06-database-schema.md#customer_profiles (Identity)] verbatim function body: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`, reads `NEW.raw_user_meta_data ->> 'first_name' / 'last_name' / 'company_name' / 'source' / 'campaign'`, validates each of the three required fields with `IS NULL OR length(trim(...)) = 0`, raises with `ERRCODE = '23502'` and HINT `PROFILE_FIRST_NAME_REQUIRED` / `PROFILE_LAST_NAME_REQUIRED` / `PROFILE_COMPANY_NAME_REQUIRED` on missing/empty (matches the verbatim values in the architecture distillate — DO NOT rename), then `INSERT INTO public.customers (id, email, source, campaign) VALUES (NEW.id, NEW.email, v_source, v_campaign)` and `INSERT INTO public.customer_profiles (customer_id, first_name, last_name, company_name) VALUES (NEW.id, trim(...), trim(...), trim(...))` and `RETURN NEW`.
    - The trigger `trg_handle_new_auth_user AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()` exists.
    - **Negative assertion (Constraint #16):** there is NO `customer_team_members` (or any equivalent multi-user / RBAC) table created by these migrations. Verified by `\dt` listing showing only `customers`, `customer_profiles` from this story.

2. **Given** the route `POST /signup` registered via `app/src/routes/_public/signup.js` with Fastify built-in JSON Schema validation **When** the customer submits a valid form body `{email, password, first_name, last_name, company_name}` (with optional `?source` and `?campaign` query params already captured into the session/cookie by the source-context middleware — see AC#4) **Then**:
    - The route validates the body via Fastify `schema:` (per AD28 — NO `zod`, NO `joi`, NO `ajv`): `body` is `{ type: 'object', required: ['email','password','first_name','last_name','company_name'], properties: { email: { type: 'string', format: 'email', maxLength: 254 }, password: { type: 'string', minLength: 8, maxLength: 72 }, first_name: { type: 'string', minLength: 1, maxLength: 100 }, last_name: { type: 'string', minLength: 1, maxLength: 100 }, company_name: { type: 'string', minLength: 1, maxLength: 200 } }, additionalProperties: false }`. Schema validation failures render `views/pages/signup.eta` with PT-localized field errors and HTTP 400 (NOT a JSON 400) — preserves the entered values for `email`, `last_name`, `company_name` (NEVER for `password`).
    - The route reads source-context from session/cookie (set by middleware in AC#4) and constructs the `signUp` payload per [Context7: /supabase/supabase-js#Sign Up Users with Email/Password and Phone OTP]: `await supabase.auth.signUp({ email, password, options: { data: { first_name, last_name, company_name, source, campaign }, emailRedirectTo: '<APP_BASE_URL>/verify-email' } })`. The Supabase client used here is the **anon-key client** (NOT service-role) so the signUp goes through the public auth flow; instantiate via `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` from `@supabase/supabase-js` per the env-var convention below.
    - On `signUp` success: Supabase Auth INSERT into `auth.users` fires `trg_handle_new_auth_user`, the trigger writes `customers` + `customer_profiles` rows in the SAME transaction (atomicity guaranteed by Postgres semantics — no application-side cleanup needed), and the route redirects via `reply.redirect(302, '/verify-email')` per UX-DR1 / [Source: epics-distillate/_index.md#UX-DR Coverage — UX-DR1 → Story 1.4]. The Supabase Auth confirmation email is dispatched by Supabase (NOT by `shared/resend/`).
    - **Negative assertion (Pattern C — visual-DNA):** the rendered `signup.eta` uses the visual-DNA tokens (Manrope/Inter, navy primary, radius scale per UX skeleton §10) and no per-screen Pattern A stub HTML is referenced; auth surfaces share the consistent chrome layout in `views/layouts/default.eta` per [Source: epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md#Story 1.4 Pattern A/B/C contract — Visual: Pattern C].

3. **Given** the route receives a request where the trigger raises `ERRCODE 23502` with `HINT = 'PROFILE_FIRST_NAME_REQUIRED'` (or `_LAST_` or `_COMPANY_`) **When** Supabase Auth surfaces the failure to `supabase.auth.signUp(...)` **Then**:
    - The route's catch path inspects the returned `error` object (supabase-js `AuthError` with at minimum `.message` string and possibly `.code` / `.status`) and uses `app/src/lib/signup-error-mapper.js` (a NEW file in this story) to detect each of the three HINT sentinels via case-sensitive substring match on `error.message` AND `error.code` (when present) — both are checked because GoTrue's HINT propagation format may vary; the empirical contract is "the HINT string appears verbatim somewhere in the error response". The mapper returns a `{ field: 'first_name' | 'last_name' | 'company_name', messagePt: string }` tuple (or `null` if no HINT match — fall through to generic safe-error path).
    - PT-localized strings (constants in `app/src/lib/signup-error-mapper.js`):
      - `PROFILE_FIRST_NAME_REQUIRED` → field `first_name`, message `"Por favor introduz o teu nome próprio."`
      - `PROFILE_LAST_NAME_REQUIRED` → field `last_name`, message `"Por favor introduz o teu apelido."`
      - `PROFILE_COMPANY_NAME_REQUIRED` → field `company_name`, message `"Por favor introduz o nome da tua empresa."`
    - The signup form re-renders with HTTP 400, the mapped field error is displayed inline next to the offending input, AND the customer's other valid fields (`email`, `last_name`, `company_name` if not the offending field — never `password`) are preserved as form values.
    - **Atomicity verification:** the trigger raised an exception, which rolls back the `auth.users` INSERT per Postgres `SECURITY DEFINER` + AFTER INSERT FOR EACH ROW transaction semantics. There is NO partial-state cleanup code in the route — the architecture distillate explicitly states "no partial-state cleanup needed — Postgres did rollback" [Source: architecture-distillate/03-decisions-E-J.md#AD29 — Customer profile schema]. An integration test (AC#7 first sub-bullet) verifies post-failure that `auth.users`, `customers`, and `customer_profiles` are all empty for the attempted email.
    - For non-HINT errors (e.g., `User already registered`, network failure, unexpected 500): the route falls through to a generic PT-localized message via the existing safe-error pattern (see Dev Notes — no Mirakl `getSafeErrorMessage` import; the signup-error-mapper handles this case locally by returning the string `"Não foi possível criar a conta. Tenta novamente em alguns minutos."` for unmapped errors). The exception is logged at `error` level with `error.message` and `error.code`, but the customer never sees the raw upstream message (NFR-S1 / safe-error contract).

4. **Given** the `app/src/middleware/source-context-capture.js` middleware (NEW file) wired via `fastify.addHook('preHandler', ...)` on the `_public` route group only **When** any request hits a `_public` route with query params `?source=<value>` and/or `?campaign=<value>` **Then**:
    - The middleware extracts `request.query.source` (string, max 100 chars) and `request.query.campaign` (string, max 100 chars), validates them as printable ASCII with no control characters (regex `/^[\x20-\x7E]+$/` — narrow on purpose; query-param injection prevention) and length ≤100, and persists them into the Fastify session via `@fastify/cookie` signed cookie (NEW dep wiring: register `@fastify/cookie` with `secret: process.env.COOKIE_SECRET` already-pinned in `package.json` from Story 1.1).
    - **Cookie naming and lifetime:** signed cookie name `mp_source_ctx`, value `JSON.stringify({ source, campaign })`, `httpOnly: true`, `secure: true` (in production — gated on `NODE_ENV === 'production'`), `sameSite: 'lax'`, `path: '/'`, `maxAge: 60 * 60 * 24 * 7` (7 days — covers the typical free-report → free-report email → signup latency window per OUTREACH.md).
    - Once captured, the cookie is **first-write-wins** within its lifetime: subsequent visits to other `_public` routes with different `?source=...` values do NOT overwrite the existing cookie. Rationale: a returning lead who visits `/login` from a different campaign URL must not have their original signup attribution rewritten. Implemented via "set only if cookie absent" check in the middleware.
    - Unknown / missing params produce **NULL** in the cookie value (NOT empty string `""`) — when the signup route reads the cookie and forwards to `signUp options.data`, both `source` and `campaign` get `null` if the cookie is absent or partial. The trigger's `NEW.raw_user_meta_data ->> 'source'` returns `NULL` for absent JSONB key, which is the correct DB value (the column is nullable — `customers.source` is `text` NOT NULL-less per the schema DDL).
    - The middleware is wired into `_public` route group ONLY (see directory tree `app/src/routes/_public/`) — NOT into authenticated, onboarding, dashboard, audit, settings, admin, or webhook route groups. Verify via grep that `addHook('preHandler', sourceContextCapture)` is called only on the `_public` register block.
    - The middleware is auth-agnostic and never blocks a request — pure side-effect capture. If cookie set/read fails for any reason (e.g., `COOKIE_SECRET` missing — which Story 1.4 makes a required env var), the middleware logs `warn` via the shared pino logger (Story 1.3 SSoT) but allows the request to proceed; signup will simply persist `null` for `source` / `campaign`.

5. **Given** the database schema after these migrations apply **When** I run an integration test that attempts to INSERT a second `customers` row for an existing `auth.uid()` **Then**:
    - The INSERT fails with `error.code = '23505'` (unique violation) — the `customers.id` PRIMARY KEY (which is also FK to `auth.users(id)`) ensures 1:1 mapping between `auth.users` and `customers`.
    - Equivalent assertion for `customer_profiles`: a second row with the same `customer_id` PK fails with `23505`.
    - Negative-assertion grep over the migrations and source: zero hits for `customer_team_members`, `team_members`, `user_organizations`, `customer_users` (Constraint #16 — no team-membership / multi-user table at MVP; FR2 negative-assertion).

6. **Given** the password-reset routes per FR3 — `POST /forgot-password` and `GET/POST /reset-password` registered in `app/src/routes/_public/forgot-password.js` and `app/src/routes/_public/reset-password.js` — **When** the customer submits `POST /forgot-password` with `{email}` (Fastify JSON Schema validation: `{type:'object', required:['email'], properties:{email:{type:'string',format:'email',maxLength:254}}, additionalProperties:false}`) **Then**:
    - The route calls `await supabase.auth.resetPasswordForEmail(email, { redirectTo: '<APP_BASE_URL>/reset-password' })` (per [Context7: /supabase/supabase-js] — supabase handles the email send + recovery-token-link generation; NO Resend involvement).
    - The route renders a generic confirmation page **regardless of whether the email exists** (`"Se o email existir na nossa base, foi enviado um link para repor a palavra-passe."`) — prevents user-enumeration attacks via the password-reset endpoint. The Supabase call's success/failure is logged but never surfaced to the customer.
    - `GET /reset-password` accepts the recovery token via the URL fragment / query (Supabase Auth recovery-link conventions) and renders `views/pages/reset-password.eta` with a password-input form. `POST /reset-password` calls `await supabase.auth.updateUser({ password })` (using a Supabase client constructed with the recovery-token-derived session — supabase-js handles this transparently in the browser-style flow, but server-side requires `setSession({ access_token, refresh_token })` first; see Dev Notes for the verbatim pattern). On success, redirect to `/login?msg=password_reset_ok`.
    - **Negative assertion:** there is NO MarketPilot-side password storage — `customers` and `customer_profiles` carry NO `password` / `password_hash` columns. Supabase Auth (GoTrue) handles bcrypt internally. Grep over the migrations confirms zero matches for `password` column references.
    - Login route `POST /login` ships in this story too (`app/src/routes/_public/login.js`): JSON Schema validation `{email, password}`, calls `supabase.auth.signInWithPassword({email, password})`, on success sets the Supabase session cookies (using `@supabase/ssr`-style cookie wiring is Phase 2 — at MVP the route stores the session JWT in a signed httpOnly cookie `mp_session` with `secure: true`, `sameSite: 'lax'`, `maxAge: <session.expires_in seconds>`, `path: '/'`; this cookie is read by Story 2.1's RLS middleware to construct the JWT-scoped DB client. Story 1.4 ships only the cookie-write side; Story 2.1 owns the cookie-read side — see Forward Dependencies). On failure, render `login.eta` with PT-localized `"Email ou palavra-passe incorretos."` — intentionally generic to prevent user enumeration.

7. **Given** an integration test file `tests/integration/signup-flow.test.js` (NEW) **When** I run `node --env-file=.env.test --test tests/integration/signup-flow.test.js` against a fresh test Postgres seeded with the two migrations **Then** the test exercises ALL of these scenarios as separate `test('...')` cases (using `node:test` + `node:assert/strict`, the established pattern from Stories 1.1 / 1.2 / 1.3):
    - **happy_path_atomic_creation**: POST `/signup` with valid payload AND `?source=free_report&campaign=tony_august` query-string-captured-via-middleware-cookie → assert HTTP 302 to `/verify-email`, assert `auth.users` has 1 matching row, assert `customers` has 1 matching row with `source='free_report'` and `campaign='tony_august'`, assert `customer_profiles` has 1 matching row with the trimmed first/last/company values.
    - **trigger_rolls_back_on_missing_first_name**: POST `/signup` with `first_name=''` (passes Fastify schema's minLength via whitespace-only `'   '` — to specifically test the trigger's `length(trim(...)) = 0` branch, not the JSON Schema validator) → assert HTTP 400, assert response body contains the PT message `"Por favor introduz o teu nome próprio."`, assert `auth.users` count is 0 for the test email, assert `customers` count is 0, assert `customer_profiles` count is 0. Repeat for `last_name=''` and `company_name=''` (parameterized).
    - **single_user_uniqueness**: attempt to insert a second `customers` row with the same `id` value as an existing one → assert `error.code === '23505'` (unique violation; PK conflict).
    - **source_context_first_write_wins**: send a request with `?source=free_report` to set the cookie, then a second request to a different `_public` route with `?source=facebook_ad`, then signup → assert the persisted `customers.source === 'free_report'` (NOT `'facebook_ad'`).
    - **source_context_null_when_absent**: signup without ever visiting a `?source=`-tagged URL → assert `customers.source IS NULL` and `customers.campaign IS NULL` (NOT empty string).
    - **password_reset_request_does_not_leak_existence**: POST `/forgot-password` with a non-existent email → assert HTTP 200, assert response body matches the generic `"Se o email existir..."` text, assert nothing distinguishes this response from the existing-email case (response time within ~50ms tolerance — see Dev Notes for the timing-attack note).
    - **login_failure_generic_error**: POST `/login` with valid email + wrong password AND with non-existent email + any password → assert both responses are HTTP 400 with the same `"Email ou palavra-passe incorretos."` text (no enumeration).
    - **negative_assertion_no_team_table**: introspect `information_schema.tables` for `customer_team_members` → assert zero rows.

## Tasks / Subtasks

- [x] **Task 1: Create the `customers` migration with FR7 source-context columns + RLS policy** (AC: #1)
  - [x] Run `npx supabase migration new create_customers` — Supabase CLI assigns a new timestamp prefix; **rename the generated file to `202604301200_create_customers.sql`** (or whatever timestamp lands; the architecture distillate's `202604301200` is the canonical example, but the actual filename uses Supabase CLI's UTC-now timestamp — what matters is lexicographic ordering relative to other migrations: this file MUST sort BEFORE `202604301201_create_customer_profiles_with_trigger.sql` AND the existing `202604301204_create_shop_api_key_vault.sql`). Refer to Story 1.1's pattern of using `supabase/migrations/` as the canonical directory (NOT `db/migrations/` — the architecture distillate's `db/migrations/` directory tree was overruled by Story 1.1 D2).
  - [x] Migration body: include the verbatim DDL from [Source: architecture-distillate/06-database-schema.md#customers (Identity)] including the `idx_customers_deletion_scheduled_at` partial index. Add RLS-enable + select-own policy at the bottom of the file. Add a header comment block explaining FR7 / AD21 / AD29 / F2 column rationales (in the established Story 1.2 / 1.1 migration-comment style).
  - [x] Add the migration-immutability sentinel comment block (per Story 1.1 / 1.2 convention): `-- IMPORTANT: this file is append-only once committed. Schema changes after the first commit ALWAYS create a new migration. Never edit this file post-commit.`
  - [x] Verify via `npx supabase db reset` (against local docker) that the migration applies cleanly on a fresh DB.

- [x] **Task 2: Create the `customer_profiles` migration with `handle_new_auth_user()` trigger function and trigger** (AC: #1, #3)
  - [x] Run `npx supabase migration new create_customer_profiles_with_trigger` and rename to `202604301201_create_customer_profiles_with_trigger.sql` (or equivalent timestamp ordered after the customers migration).
  - [x] Migration body: include the verbatim DDL from [Source: architecture-distillate/06-database-schema.md#customer_profiles (Identity)] for the `customer_profiles` table + the `handle_new_auth_user()` function + the `trg_handle_new_auth_user` trigger. The function MUST be `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public` — the `SECURITY DEFINER` is what allows the function (running as the migration owner / Supabase superuser) to write to `public.customers` and `public.customer_profiles` from a transaction kicked off by GoTrue's INSERT into `auth.users`. The `SET search_path = public` is a hardening guard against search-path-based privilege-escalation attacks (well-documented Postgres SECURITY DEFINER hazard).
  - [x] **Verbatim function body must match the architecture distillate** — same variable names (`v_first_name`, `v_last_name`, etc.), same HINT codes (`PROFILE_FIRST_NAME_REQUIRED` etc.), same `length(trim(...)) = 0` checks, same `RAISE EXCEPTION 'first_name is required' USING ERRCODE = '23502', HINT = '...'` form. Do NOT rename HINTs (the route-side error mapper depends on the literal sentinel strings).
  - [x] Add RLS-enable + `customer_profiles_select_own` + `customer_profiles_update_own` policies. The UPDATE policy is reserved for Phase 2 self-edit per AD22 / Phase 2 reservations — leave it in place at MVP since the policy is harmless without a Phase-1 UI consumer.
  - [x] **Critical migration ordering**: this file MUST sort lexicographically AFTER the customers migration (Task 1) so that `customer_profiles.customer_id REFERENCES customers(id)` resolves at apply time. Verify the rename achieves this ordering via `ls supabase/migrations/ | sort`.
  - [x] Apply the migration to the local docker DB and the Supabase Cloud project once both files exist (per Story 1.2 Option A pattern: commit first, push when atomicity bundle is complete; do not push the customers migration to Cloud until the customer_profiles+trigger migration is also ready, since the schema needs the trigger to be functional before any GoTrue signUp call lands in production).

- [x] **Task 3: Wire `@fastify/cookie` and `@supabase/supabase-js` into the app server** (AC: #2, #4, #6)
  - [x] In `app/src/server.js`, add `await fastify.register(import('@fastify/cookie'), { secret: process.env.COOKIE_SECRET, hook: 'onRequest', parseOptions: { sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production', path: '/' } })` BEFORE the `_public` route registration. `@fastify/cookie` is already in `package.json` from Story 1.1 (`^11.0.2`) — Story 1.4 only wires the registration; no new dep.
  - [x] Add `COOKIE_SECRET` to the required-env list in `shared/config/runtime-env.js`'s `REQUIRED_VARS` array. Update the `getEnv()` return type and JSDoc accordingly. Add `COOKIE_SECRET=<random-32-byte-base64>` to `.env.example` with a comment explaining its role (signed-cookie HMAC secret).
  - [x] Add `SUPABASE_ANON_KEY` to `REQUIRED_VARS` (anon key for the public-flow `auth.signUp` and `auth.signInWithPassword` calls — the service-role key in `SUPABASE_SERVICE_ROLE_DATABASE_URL` cannot be used for these because anon-flow JWTs are issued by GoTrue on the anon path). Update `.env.example`. Note: this is the **anon API key** (JWT-style, starts with `eyJ...`), NOT a database password — distinct from `SUPABASE_SERVICE_ROLE_DATABASE_URL`.
  - [x] Create `app/src/lib/supabase-clients.js` exporting `getAnonSupabaseClient()` which returns a process-singleton `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` with `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }` — server-side use only, no browser-style session-management. This replaces what would otherwise be ad-hoc `createClient(...)` calls in each `_public` route.

- [x] **Task 4: Implement `app/src/middleware/source-context-capture.js`** (AC: #4)
  - [x] Export `sourceContextCapture` (named export, per project convention — no default export per Constraint #18). The export is a Fastify pre-handler hook signature: `async function sourceContextCapture (request, reply) { ... }`.
  - [x] Logic:
    1. If signed cookie `mp_source_ctx` already exists and parses cleanly → no-op (first-write-wins).
    2. Read `request.query.source` and `request.query.campaign`. Validate each against the printable-ASCII regex `/^[\x20-\x7E]+$/` AND length 1-100. Discard (treat as null) any value that fails.
    3. If at least one of `{source, campaign}` is present after validation → set the signed cookie `mp_source_ctx` with `JSON.stringify({ source: source ?? null, campaign: campaign ?? null })`, lifetime 7 days, secure in production.
    4. If both are absent → no-op.
  - [x] Export a sibling helper `readSourceContext(request) -> { source: string|null, campaign: string|null }` for the signup route to consume. Returns `{ source: null, campaign: null }` if the cookie is absent or fails to parse.
  - [x] JSDoc on the exported functions; no `console.*`; no `process.stdout.write`; uses the shared pino logger via `request.log.warn(...)` for diagnostic warnings.

- [x] **Task 5: Implement `app/src/lib/signup-error-mapper.js`** (AC: #3)
  - [x] Export `mapSignupError(error) -> { field: 'first_name'|'last_name'|'company_name', messagePt: string } | { field: null, messagePt: string }`. The second shape (field=null) is the generic-failure case for unmapped errors.
  - [x] HINT-substring lookup: scan `String(error?.message ?? '')` AND `String(error?.code ?? '')` for the three sentinel strings (`PROFILE_FIRST_NAME_REQUIRED`, `PROFILE_LAST_NAME_REQUIRED`, `PROFILE_COMPANY_NAME_REQUIRED`). First match wins (left-to-right declaration order is irrelevant since at most one HINT can fire per request).
  - [x] Generic-failure messages (PT-localized constants): `"Não foi possível criar a conta. Tenta novamente em alguns minutos."` for the catch-all. **Do NOT echo `error.message` to the customer** — NFR-S1 / safe-error contract.
  - [x] Unit test: `tests/app/lib/signup-error-mapper.test.js` parameterized over the three HINT cases + a `User already registered`-style error + an unstructured `Error('boom')` + a null/undefined input → asserts the field + message shape.

- [x] **Task 6: Implement the `_public` route group plugin and register it on the Fastify server** (AC: #2, #6)
  - [x] Create `app/src/routes/_public/index.js` exporting an async Fastify plugin that:
    1. Registers `sourceContextCapture` as `fastify.addHook('preHandler', sourceContextCapture)` (scope: this plugin only — Fastify's encapsulation auto-scopes hooks to the registering instance).
    2. Imports and registers each of the five public routes: `signup.js`, `login.js`, `verify-email.js`, `forgot-password.js`, `reset-password.js`. (`verify-email.js` is a thin pass-through page — Supabase Auth's email-confirm link handles the actual confirmation; the route just renders `views/pages/verify-email.eta` with PT copy.)
  - [x] In `app/src/server.js`, register the plugin: `await fastify.register(import('./routes/_public/index.js'))`. NO prefix — the routes use their natural paths (`/signup`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`).

- [x] **Task 7: Implement `app/src/routes/_public/signup.js`** (AC: #2, #3, #4)
  - [x] GET `/signup`: render `views/pages/signup.eta` with empty form values + no errors. Decorate `reply.locals` with `{ formValues: {}, fieldErrors: {} }` (or pass directly to `reply.viewAsync`).
  - [x] POST `/signup`: Fastify-schema-validated body per the verbatim shape in AC#2. Validation-failure handler (custom Fastify `schemaErrorFormatter`) re-renders `signup.eta` with HTTP 400 + per-field PT-localized errors derived from the AJV (Fastify-built-in) error array.
  - [x] Happy-path body handler:
    1. Read source-context via `readSourceContext(request)`.
    2. `await getAnonSupabaseClient().auth.signUp({ email, password, options: { data: { first_name, last_name, company_name, source, campaign }, emailRedirectTo: `${process.env.APP_BASE_URL}/verify-email` } })`.
    3. On error: `mapSignupError(error)` → if field-mapped, re-render `signup.eta` with the field error + preserved `formValues` (NEVER `password`); if generic, render with the catch-all message at the top of the form.
    4. On success: `reply.redirect(302, '/verify-email')`.
  - [x] Add `APP_BASE_URL` to `REQUIRED_VARS` (e.g., `https://app.marketpilot.pt` in production, `http://localhost:3000` in dev). Update `.env.example` with the dev value.

- [x] **Task 8: Implement `app/src/routes/_public/login.js`** (AC: #6)
  - [x] GET `/login`: render `views/pages/login.eta` with optional `?next=<path>` preserved into a hidden form field per UX-DR1 (auth `?next=` preservation).
  - [x] POST `/login`: Fastify-schema-validated `{email, password}`. Call `auth.signInWithPassword`. On success: write the signed httpOnly `mp_session` cookie with the access_token + refresh_token (JSON-stringified), set its `maxAge` to `session.expires_in` seconds, redirect to the validated `next` path (default `/`). On failure: re-render with the generic PT error (no enumeration leak).
  - [x] **Forward dependency note in code-comment**: `// Story 2.1 reads this cookie in app/src/middleware/rls-context.js to construct the JWT-scoped DB client. Do not change the cookie name without updating Story 2.1.`
  - [x] Validate `next` param: only allow paths matching `/^\/[a-zA-Z0-9_\-\/?=&]*$/` (relative paths starting with `/`, no protocol-prefix open-redirect bait).

- [x] **Task 9: Implement `app/src/routes/_public/forgot-password.js` + `reset-password.js`** (AC: #6)
  - [x] `forgot-password.js`: GET renders the email-input form; POST validates `{email}`, calls `auth.resetPasswordForEmail(email, { redirectTo: <APP_BASE_URL>/reset-password })`, ALWAYS renders the same generic confirmation page (regardless of Supabase response). Add a tiny artificial delay (e.g., `await setTimeout(50)` from `node:timers/promises`) to mask response-time differences between exists / not-exists email paths — defensive against timing-based user enumeration.
  - [x] `reset-password.js`: GET renders the new-password-input form (Supabase's recovery link redirects here with the recovery token in the URL fragment / params per Supabase Auth conventions). POST validates `{password}` (minLength 8, maxLength 72), calls `await getAnonSupabaseClient().auth.updateUser({ password })` AFTER calling `await getAnonSupabaseClient().auth.setSession({ access_token, refresh_token })` derived from the recovery flow. On success redirect to `/login?msg=password_reset_ok`; on failure render with PT message `"Não foi possível repor a palavra-passe. Tenta novamente."`.

- [x] **Task 10: Implement `app/src/routes/_public/verify-email.js`** (AC: #2 redirect target)
  - [x] GET `/verify-email`: render `views/pages/verify-email.eta` with PT copy `"Confirma o teu email — enviámos-te um link para <email>. Verifica também a pasta de spam."`. The page is a pass-through; Supabase Auth handles the actual confirmation when the customer clicks the link in the email (Supabase redirects them to `<APP_BASE_URL>/verify-email#access_token=...&type=signup`, which is the same page; the eta template can include a vanilla-JS `defer` snippet that detects the URL fragment and redirects to `/`, but at MVP the simpler approach is to leave them on the page with a "Já confirmaste? Clica aqui" link to `/`).

- [x] **Task 11: Register `@fastify/view` with eta engine + create the eta layout + page templates** (AC: #2, #6)
  - [x] In `app/src/server.js`, register `@fastify/view` (already in `package.json`) per [Context7: /fastify/point-of-view#Configure Eta Async Templates with Fastify]: pass an `Eta` instance, set `templates: <__dirname>/views`, `defaultContext: { appName: 'MarketPilot' }`, `propertyName: 'view'`, `asyncPropertyName: 'viewAsync'`. The Story 1.4 routes use `reply.view(...)` (sync).
  - [x] Create the layout `app/src/views/layouts/default.eta` with a minimal sticky-header chrome + body slot + footer (Pattern C — no per-screen Pattern A stub; visual-DNA tokens via `<link rel="stylesheet" href="/public/css/tokens.css">` referencing the Story 1.1 `public/css/tokens.css` file if present, else a placeholder reference for now since tokens.css is owned by Epic 8).
  - [x] Create the per-page templates: `views/pages/signup.eta`, `views/pages/login.eta`, `views/pages/forgot-password.eta`, `views/pages/reset-password.eta`, `views/pages/verify-email.eta`. Each includes the layout, a form (where applicable), per-field error rendering, and a `<script src="/public/js/<page>.js" defer></script>` reference per F9 (the JS files are stubs at MVP — this story does NOT ship interactive client-side behavior beyond the trivial form submission).
  - [x] PT-localized form labels and helper text — see Dev Notes for the canonical strings.

- [x] **Task 12: ESLint + JSDoc compliance** (AC: regression check)
  - [x] All new `.js` files in `app/src/middleware/`, `app/src/lib/`, `app/src/routes/_public/` carry JSDoc on exported functions per the existing `eslint.config.js` rule (`jsdoc/require-jsdoc` with `publicOnly: true`).
  - [x] No `console.*`, no `process.stdout.write`, no `process.stderr.write` in source — use `request.log.*` (Fastify-bound child of the shared logger) or `import { createWorkerLogger } from '../../shared/logger.js'` if outside a request context. (Story 1.4 stays inside request contexts — the middleware and routes both have `request` access.)
  - [x] No default exports (Constraint #18 / existing rule).
  - [x] `npm run lint` passes with zero errors.

- [x] **Task 13: Write `tests/integration/signup-flow.test.js` covering AC#7 sub-bullets** (AC: #7)
  - [x] Use the established `node --env-file=.env.test --test ...` pattern from Stories 1.1 / 1.2 / 1.3.
  - [x] Test setup: spawn the app server in-process, point it at the test Postgres (Supabase local docker), reset the relevant tables between tests via `TRUNCATE auth.users, customers, customer_profiles RESTART IDENTITY CASCADE`. The `auth.users` truncate works because the test DB is local — DO NOT attempt this against Supabase Cloud (the migration can't truncate auth.users via service-role; the test setup uses a direct service-role connection bypassing GoTrue).
  - [x] Test fixtures: a small JS `makeValidSignupBody()` helper that produces fresh `{email, password, first_name, last_name, company_name}` per test (using `randomUUID()` for the email local-part to keep tests independent).
  - [x] Each named scenario in AC#7 → its own `test('...')` block.
  - [x] Assertions use `node:assert/strict`.

- [x] **Task 14: Write `tests/app/middleware/source-context-capture.test.js`** (AC: #4)
  - [x] Unit-test the middleware in isolation by stubbing the Fastify `request.query` and a captured-cookie `reply.setCookie` spy.
  - [x] Cases: query has source only / has campaign only / has both / has neither / first-write-wins / invalid-character rejection.
  - [x] Cases for `readSourceContext`: cookie present → returns parsed values; cookie absent → returns `{source: null, campaign: null}`; cookie present but malformed JSON → returns `{source: null, campaign: null}` AND logs a `warn`.

- [x] **Task 15: Update `scripts/rls-regression-suite.js` to include `customers` and `customer_profiles`** (AC: #1)
  - [x] If the file does not exist yet (Story 2.2 owns its full implementation), add a TODO sentinel comment to BOTH new migration files: `-- TODO Story 2.2: add 'customers' / 'customer_profiles' to scripts/rls-regression-suite.js coverage list.` This matches the convention from Story 1.2's `shop_api_key_vault` migration.
  - [x] If the file does exist (Story 2.2 has shipped) — extend its tables array. Verify by inspecting the file at story-implementation time.

- [x] **Task 16: Update README + .env.example + project documentation** (AC: AC-aligned regression)
  - [x] `.env.example`: add `COOKIE_SECRET=`, `SUPABASE_ANON_KEY=`, `APP_BASE_URL=http://localhost:3000` with one-line comments explaining each. Confirm `MASTER_KEY_BASE64`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_DATABASE_URL` (Story 1.1/1.2) remain present.
  - [x] README: add a one-paragraph "Auth & Signup" section noting the 3-table atomic creation pattern and the Bundle A sentinel — this is the single most-reviewed primitive in the system, future-Pedro will appreciate the marker. Cite this story file by relative path.
  - [x] No CHANGELOG file is maintained at MVP — no update there.

### Review Findings

Three-layer adversarial review on 2026-05-02 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). 45 raw findings → 37 after dedup. 5 decision-needed, 17 patches, 12 deferred, 3 dismissed. Decision-needed must be resolved before patches are applied.

#### Decision-needed (5)

- [x] [Review][Defer] **D1 — CSRF protection not registered on any state-changing form route** — `@fastify/csrf-protection` is in `package.json` from Story 1.1 but never `fastify.register`-ed. `POST /signup`, `POST /login`, `POST /forgot-password`, `POST /reset-password` accept form bodies with no CSRF token. — deferred to "Pre-customer-#1 operational gates"; SameSite=Lax provides baseline; standalone chore before Go-Live, not retrofit into Story 1.4 [app/src/server.js — registration absent]
- [x] [Review][Patch] **D2 — Process-singleton anon Supabase client races on `setSession`/`updateUser` in `reset-password`** — **RESOLVED (option c, applied 2026-05-02)**: added `createEphemeralAnonSupabaseClient()` sibling factory in `app/src/lib/supabase-clients.js`; switched `app/src/routes/_public/reset-password.js` POST handler to use it. Singleton (`getAnonSupabaseClient()`) preserved everywhere else. JSDoc on the singleton now warns against `setSession`-bearing flows and points to the ephemeral factory. See Change Log 2026-05-02 entry.
- [x] [Review][Defer] **D3 — Out-of-scope rename `supabase/migrations/202604301204_create_shop_api_key_vault.sql` → `.deferred-until-story-4.1.sql`** — **ACCEPTED (2026-05-02)**: rename retained as-is; documented in Change Log entry. Story 1.2's "Option A — commit but defer push" pattern is preserved (file is still in the repo, just no longer matched by `supabase db push`'s glob until Story 4.1 lands `customer_marketplaces`). [supabase/migrations/202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1]
- [x] [Review][Defer] **D4 — Out-of-scope `supabase/config.toml` disables realtime/studio/storage/edge_runtime/analytics** — **ACCEPTED (2026-05-02)**: changes retained; documented in Change Log entry. Local-dev workaround for WSL2/Ryzen 5800XT compat (segfault `exit 139` per `supabase-debug*.log`); enables Pedro's local Supabase to boot for integration-test execution. Other contributors who pull will inherit the same disabled-services profile. [supabase/config.toml]
- [x] [Review][Defer] **D5 — `mapSignupError` returns `{field: 'email', ...}` for `user_already_exists`, beyond AC#3's "fall through to generic" mandate** — **ACCEPTED (2026-05-02)**: drift retained as a UX win (field-specific error inline next to the email input is materially better than a generic top-error message). Documented in Change Log entry. AC#3 itself is not amended — the story-level deviation is the authoritative record. [app/src/lib/signup-error-mapper.js:46-52]

#### Patch (17 — 15 applied, 2 deferred)

- [x] [Review][Patch] **P1 (Critical) — Open redirect via protocol-relative path in `safeNextPath`** — **APPLIED**: regex now uses negative lookahead `(?![/\\])` after the leading `/` to reject `//evil` and `/\evil`. [app/src/routes/_public/login.js:36]
- [x] [Review][Patch] **P2 (High) — `mp_session` cookie `maxAge` evicts refresh-token capability hourly** — **APPLIED**: `SESSION_COOKIE_MAX_AGE_S = 7 days` (Supabase refresh-token default). Cookie now lives as long as the refresh token; access-token-refresh dance is Story 2.1's responsibility. [app/src/routes/_public/login.js:18]
- [x] [Review][Patch] **P3 (High) — `safeNextPath` regex rejects every URL-encoded path** — **APPLIED**: character class extended with `%`, `.`, `:`, `+`, `~` plus the alternation `^\/$` to keep root-path matching after the negative lookahead. [app/src/routes/_public/login.js:36]
- [x] [Review][Patch] **P4 (High) — Source-context cookie write side never sign-checks; first-write-wins fails on forged/stale cookies** — **APPLIED**: write-side now calls `request.unsignCookie(existing)` (in try/catch); only treats `unsigned.valid === true` as "already captured". Forged/tampered cookies log a warn and get overwritten by the legitimate capture. [app/src/middleware/source-context-capture.js:42-58]
- [x] [Review][Patch] **P5 (Medium) — `sourceContextCapture` runs on POST too** — **APPLIED**: `if (request.method !== 'GET') return;` at the top of the hook; new unit test covers the POST → no-op path. [app/src/middleware/source-context-capture.js:39]
- [x] [Review][Patch] **P6 (Medium) — `forgot-password` 50ms delay does not mask exists/not-exists timing variance** — **APPLIED**: replaced fixed 50ms additive with deterministic floor `padToFloor(start)` targeting `TIMING_FLOOR_MS = 600ms`. Both validation-failure and Supabase-call paths pad to the same floor. [app/src/routes/_public/forgot-password.js:25-37]
- [x] [Review][Defer] **P7 (Medium) — Whitespace-only NBSP/non-ASCII whitespace bypasses trim** — **DEFERRED to schema-hardening pass**: route-side `.trim()` is correct in Node 22+ (Unicode whitespace IS stripped). The trigger-side fix would require deviating from the verbatim DDL spec contract (architecture-distillate/06-database-schema.md) and is the only remaining gap (defense-in-depth for direct DB writes only). Logged in `deferred-work.md`. [supabase/migrations/202604301201_create_customer_profiles_with_trigger.sql:91-104]
- [x] [Review][Patch] **P8 (Medium) — Bcrypt 72-byte cap silently truncates multibyte passwords** — **APPLIED**: route-level `Buffer.byteLength(password, 'utf8') > 72` checks added to both `signup.js` and `reset-password.js`; PT error `"Palavra-passe demasiado longa em UTF-8 (máx 72 bytes)."`. [app/src/routes/_public/signup.js + app/src/routes/_public/reset-password.js]
- [x] [Review][Patch] **P9 (Medium) — `APP_BASE_URL` trailing slash duplicates into Supabase redirect URLs** — **APPLIED**: `(process.env.APP_BASE_URL ?? '').replace(/\/$/, '')` at the use sites in `signup.js` and `forgot-password.js`. [app/src/routes/_public/signup.js + app/src/routes/_public/forgot-password.js]
- [x] [Review][Patch] **P10 (Medium) — `readSourceContext` `unsignCookie()` not wrapped in try/catch** — **APPLIED**: try/catch around the `unsignCookie` call; logs warn + returns nulls on throw. New unit test covers the throw → benign null path. [app/src/middleware/source-context-capture.js:88-95]
- [x] [Review][Patch] **P11 (Medium) — Source-context `sanitize` regex too permissive** — **APPLIED**: replaced `printable-ASCII` with `SAFE_IDENTIFIER = /^[A-Za-z0-9_.\-+]+$/`; rejects `<`, `>`, `"`, `'`, `&`, `\`, `/`, `:`, etc. New unit test covers HTML/quote rejection. [app/src/middleware/source-context-capture.js:14-17]
- [x] [Review][Patch] **P12 (Medium) — `additionalProperties: false` produces silent 400 with no visible error on extra fields** — **APPLIED**: `ajvErrorsToFieldErrors` now returns `{fieldErrors, topError}` shape; `additionalProperties` keyword errors land a generic `GENERIC_VALIDATION_ERROR_PT` topError so the user sees something instead of a blank 400. [app/src/routes/_public/signup.js:56-78]
- [x] [Review][Patch] **P13 (Medium) — `single_user_uniqueness` test misses `customer_profiles` 23505 assertion** — **APPLIED**: parallel block added; asserts duplicate `customer_profiles.customer_id` PK insert raises `23505`. [tests/integration/signup-flow.test.js]
- [x] [Review][Patch] **P14 (Low) — `password_reset_request_does_not_leak_existence` test omits timing assertion** — **APPLIED**: test now measures `realElapsed` and `fakeElapsed` and asserts `Math.abs(real - fake) <= 250ms` (slightly looser than the spec's "~50ms" because forgot-password's deterministic floor pads to 600ms — drift comes from Supabase RTT variance, not from the route logic). [tests/integration/signup-flow.test.js]
- [x] [Review][Patch] **P15 (Low) — `negative_assertion_no_team_table` source/migration grep missing** — **APPLIED**: new test `negative_assertion_no_team_table_in_source` walks `supabase/migrations/`, `app/src/`, `shared/`, `worker/` and asserts zero hits for `customer_team_members`, `team_members`, `user_organizations`, `customer_users`. [tests/integration/signup-flow.test.js]
- [x] [Review][Patch] **P16 (Low) — `pg.Pool` may leak on test failure path** — **APPLIED**: process-level cleanup hook (`beforeExit` + `SIGINT` + `SIGTERM`) registered on first `getPool()` call. [tests/integration/_helpers/reset-auth-tables.js:18-34]
- [x] [Review][Defer] **P17 (Low) — `getAnonSupabaseClient` reads `process.env` at first-call instead of via `getEnv()`** — **DEFERRED**: tightening this to read from `getEnv()` introduces module-load-order coupling (server.js calls `getEnv()` at boot; the supabase-clients singleton is initialized later at first call). Better unified with a broader env-binding refactor when Story 2.1's `shared/db/` clients land. Logged in `deferred-work.md`. [app/src/lib/supabase-clients.js]

#### Deferred (12)

- [x] [Review][Defer] **W1 (High) — `mp_session` stores access + refresh tokens as plaintext signed (not encrypted) JSON** — Spec-sanctioned design (Task 8 + Story 2.1 contract). Future hardening: server-side opaque session ID OR envelope-encrypt the cookie value with `MASTER_KEY_BASE64`. — deferred, spec-sanctioned [app/src/routes/_public/login.js:64-78]
- [x] [Review][Defer] **W2 (Medium) — `mapSignupError` HINT-substring path is dead per route's own comment** — GoTrue strips Postgres HINTs before the JS sees them; the route-level pre-validation is the real path. Keeping as defense-in-depth (covers direct-DB writes / future code paths). — deferred, defense-in-depth [app/src/lib/signup-error-mapper.js:31-35]
- [x] [Review][Defer] **W3 (Medium) — `secure: NODE_ENV === 'production'` may emit Insecure cookies on staging** — Defer until staging environment exists and `NODE_ENV` taxonomy is decided. — deferred, env-policy decision [app/src/server.js + app/src/middleware/source-context-capture.js + app/src/routes/_public/login.js]
- [x] [Review][Defer] **W4 (Medium) — `?msg=password_reset_ok` banner enables phishing-grade UX spoofing** — Attacker hosts a redirector that lands users on `/login` with the fake "password reset OK" banner, then phishes from there. Mitigate by signing the msg or using a server-side flash. — deferred, low actual risk [app/src/routes/_public/login.js + app/src/views/pages/login.eta]
- [x] [Review][Defer] **W5 (Low) — Trigger does not enforce length/charset CHECK on `customers.source`/`customers.campaign`** — Validation lives only in the middleware; storage layer is unbounded `text`. Add `CHECK (length(source) <= 100 AND source ~ '^[A-Za-z0-9_.\-]+$')` in a future schema-hardening pass. — deferred, defense-in-depth [supabase/migrations/202604301200_create_customers.sql]
- [x] [Review][Defer] **W6 (Low) — Trigger writes `NEW.email` without normalization** — `customers.email` may diverge from `auth.users.email` casing. Decide on email-normalization strategy (CITEXT vs `lower(trim(...))` at write) in a future story. — deferred, cosmetic [supabase/migrations/202604301201_create_customer_profiles_with_trigger.sql]
- [x] [Review][Defer] **W7 (Low) — Integration test feeds set-cookie back without isolating write-side check** — Test happens to exercise the broken write-side path (P4) and still passes because the read side is correct. A regression in `unsignCookie` ordering would not be caught. — deferred, test quality [tests/integration/signup-flow.test.js:1717-1722]
- [x] [Review][Defer] **W8 (Low) — `mp_session` cookie payload approaches 4KB browser limit when JWT/refresh-token payloads grow with custom claims** — Latent failure mode; not currently triggered. — deferred, latent [app/src/routes/_public/login.js]
- [x] [Review][Defer] **W9 (Low) — `reset-password.js` extracts tokens from URL fragment only, no query-string fallback** — Supabase recovery flow uses fragment by default; if Pedro changes the auth-flow config, revisit. — deferred, config-dependent [public/js/reset-password.js]
- [x] [Review][Defer] **W10 (Low) — Trigger does not strip non-printable / control bytes from name fields** — Partial mitigation by tightening middleware sanitize (P11) and a future schema CHECK; control bytes (`\x07`) commit silently today. — deferred, defense-in-depth [supabase/migrations/202604301201_create_customer_profiles_with_trigger.sql:91-100]
- [x] [Review][Defer] **W11 (Low) — `forgot-password` renders generic confirm on schema-validation failure** — Deliberate hardening (prevents distinguishing "valid email, not registered" from "invalid format"); spec didn't authorize but reasonable. Document the deviation in story Change Log. — deferred, intentional drift [app/src/routes/_public/forgot-password.js:48-56]
- [x] [Review][Defer] **W12 (Low) — Signup HTML field-error mapping uses dynamic key assignment (`out[field]`)** — Theoretical prototype-pollution path requires AJV to emit `__proto__` as a path segment, which the current schema cannot trigger. Latent; harden if schema grows. — deferred, latent [app/src/routes/_public/signup.js:590]

#### Dismissed (3, no action)

- `setCookie` no try/catch in middleware — comment-drift nit, no realistic failure mode
- Login `next` field in JSON Schema body — necessary side-effect of `additionalProperties: false`, OK
- Login `formValues` cosmetic with non-string body — Eta auto-escapes; cosmetic only

## Dev Notes

### CRITICAL Architecture Constraints for This Story

Story 1.4 ships **Atomicity Bundle A (F3 + AD29)** as a single PR. Failure to ship the migration + trigger + endpoint + JSON Schema validation + safe-error mapping + source-context middleware in one commit means the system is shippable in a state where `auth.users` rows can exist without matching `customers` / `customer_profiles` rows — exactly the orphan state the bundle exists to prevent.

| Constraint | What's forbidden | What to do instead |
|---|---|---|
| AD29 + F3 atomicity | Application-side cleanup of partial-state rows after a `signUp` failure | Trust Postgres rollback semantics — the `SECURITY DEFINER` trigger's `RAISE EXCEPTION` rolls back the `auth.users` INSERT in the same transaction. NO catch-and-DELETE pattern in the route. |
| Constraint #16 | Adding `customer_team_members`, `team_members`, `user_organizations`, or any multi-user RBAC table | One `customers` row per `auth.users` row; one `customer_profiles` row per `customers` row (1:1:1). Multi-user is Phase 2. |
| Constraint #2 (AD28) | Adding `zod`, `joi`, `yup`, `ajv` to `package.json` | Fastify built-in JSON Schema only. The `schema:` option on each route handles validation; `schemaErrorFormatter` handles the user-facing error rendering. |
| Constraint #18 | `console.*` or `process.stdout.write` / `process.stderr.write` in source | Use `request.log.*` (Fastify-bound child of the shared pino logger from Story 1.3) or `createWorkerLogger()` outside request contexts. ESLint enforces. |
| AD27 (Story 1.3 SSoT) | Hand-built pino instances or per-file redaction config | Use `getFastifyLoggerOptions()` (already wired in Story 1.3); the redaction list automatically protects auth tokens, cookies, and any sentinel field that lands in a log object. |
| AD3 (Story 1.2 SSoT) | Reading or writing customer Mirakl `shop_api_key` plaintext | Story 1.4 doesn't touch the vault. The `shop_api_key_vault` migration ships in Story 1.2 (vault table) and Story 4.3 (key entry). Don't reach for it. |
| FR2 negative-assertion (Constraint #16) | Building a /team route, adding a `team_id` column, planning multi-tenant-via-team patterns | Single login per customer at MVP. The schema design (1:1:1 `auth.users` → `customers` → `customer_profiles`) is the negative assertion in code. |
| Trust commitment (NFR-S5) | Surfacing raw `error.message` from Supabase / Postgres / network errors to the customer | All customer-facing errors are PT-localized constants in `signup-error-mapper.js`. Raw errors get logged at `error` level (with redaction); the customer sees a safe message only. |

**Forward dependencies — do NOT pre-create:**
- `app/src/middleware/auth.js` (Supabase session check + redirect to `/login?next=...`) → Story 1.5 (founder-admin middleware also lives here per the directory tree). Story 1.4 ships only the `_public` route group; the `auth.js` middleware that protects authenticated route groups is the next epic-1 deliverable.
- `app/src/middleware/rls-context.js` (RLS-aware DB client binding from JWT) → Story 2.1. Story 1.4 writes the `mp_session` cookie; Story 2.1 reads it.
- `shared/db/rls-aware-client.js`, `shared/db/service-role-client.js`, `shared/db/tx.js` → Story 2.1. Story 1.4 uses the supabase-js client directly for the auth flow (because GoTrue is the sole writer to `auth.users`); the Postgres-direct DB clients are Story 2.1's deliverable.
- `scripts/rls-regression-suite.js` full implementation → Story 2.2. Story 1.4 only adds the sentinel-comment TODO to the new migrations.
- `app/src/middleware/auth-redirect-on-cron-state.js` (interception-redirect for `cron_state IN ('PAUSED_BY_*', 'PROVISIONING')`) → Story 4.x / Story 8.1. Story 1.4 doesn't gate the dashboard on `cron_state`.
- `customer_marketplaces` schema, `shop_api_key_vault` wiring, founder admin middleware, Stripe Customer / Subscription creation → all later stories.

### Database Migration Filename + Ordering

The architecture distillate's directory tree shows `db/migrations/` but Story 1.1 D2 (file-canonical-location decision) chose `supabase/migrations/` to keep the Supabase CLI happy. Story 1.4's two migrations land in `supabase/migrations/`.

The architecture distillate's example timestamps (`202604301200_create_customers.sql`, `202604301201_create_customer_profiles_with_trigger.sql`) are **canonical example values** — the actual filenames use whatever timestamp `npx supabase migration new <name>` emits at story-implementation time. The lexicographic-ordering invariant is what matters:

```
supabase/migrations/
  YYYYMMDDHHMMSS_create_customers.sql                       <-- Task 1
  YYYYMMDDHHMMSS_create_customer_profiles_with_trigger.sql  <-- Task 2 (sorts AFTER customers)
  202604301204_create_shop_api_key_vault.sql                <-- Story 1.2 (already shipped; sorts AFTER both Task 1 + Task 2)
  202604301212_create_worker_heartbeats.sql                 <-- Story 1.1 (already shipped)
  202605011940_add_worker_heartbeats_written_at_idx.sql     <-- Story 1.1 review patch
```

**Important**: the existing `shop_api_key_vault` migration (Story 1.2) references `customer_marketplaces` which does not exist yet — Story 1.2 chose Option A (commit the migration file but defer `npx supabase db push` until Story 4.1's `customer_marketplaces` migration lands). The Story 1.4 migrations have no such dependency: `customers` references `auth.users` (always exists in Supabase) and `customer_profiles` references `customers`. Both migrations can be applied to Cloud once committed. Apply via `npx supabase db push` after both files are staged.

### Trigger Atomicity — Why Postgres Rollback Is Sufficient

When `supabase.auth.signUp(...)` is called, GoTrue runs an INSERT into `auth.users` inside a transaction. The `AFTER INSERT FOR EACH ROW` trigger `trg_handle_new_auth_user` runs in the SAME transaction. Postgres docs (and the Supabase architecture distillate) confirm:

- A `RAISE EXCEPTION` inside the trigger function rolls back the entire transaction, including the row that fired the trigger.
- This means: if `handle_new_auth_user()` raises because `first_name` is missing, the `auth.users` INSERT is undone. There's no `auth.users` row, no `customers` row, no `customer_profiles` row — atomicity preserved.

**The route does NOT need cleanup logic.** This is a load-bearing fact: any reviewer who proposes "what if the trigger half-succeeds and we need to clean up" is wrong. The trigger either fully succeeds (all three rows committed) or fully fails (zero rows committed); there is no in-between state representable in the schema.

Empirical verification: AC#7's `trigger_rolls_back_on_missing_first_name` integration test asserts post-failure that `auth.users` count is zero for the test email. If the test ever fails, the atomicity invariant is broken and the story regresses.

### Supabase Auth — HINT Propagation Empirical Contract

`@supabase/supabase-js` returns an `AuthError` (or related subclass) when a `signUp` fails. The shape is:

```js
{
  message: string,    // human-readable message; sometimes contains the underlying Postgres error text
  code: string,       // GoTrue error code (e.g., 'unexpected_failure', 'user_already_exists', 'weak_password')
  status: number,     // HTTP status from GoTrue (typically 400, 422, or 500)
  __isAuthError: true,
}
```

When a trigger raises with `RAISE EXCEPTION '...' USING ERRCODE = '23502', HINT = 'PROFILE_FIRST_NAME_REQUIRED'`, GoTrue catches the Postgres error and surfaces it. The empirical contract (verified against Supabase Auth ≥ 2.x):

1. `error.code` is typically `'unexpected_failure'` or similar generic value (NOT `'23502'`).
2. `error.message` contains the trigger's exception text AND the HINT — usually formatted as `"Database error saving new user"` or `"first_name is required (...HINT: PROFILE_FIRST_NAME_REQUIRED...)"` depending on the Supabase Auth version.
3. The HINT sentinel appears verbatim somewhere in `error.message` for ALL recent Supabase Auth versions. **The mapper's job is to substring-search for the sentinel** — not to parse a structured field.

**This contract is verified during dogfood (Pedro signs up to MarketPilot via Gabriel's account — first real signup test) before customer #1.** If the empirical contract changes (e.g., Supabase strips HINTs in a future version), the mapper still falls through to the generic error path safely; the worst case is "customer sees the generic message instead of the field-specific one" — degraded UX but no security/atomicity regression.

### supabase-js Anon Client Setup

```js
// app/src/lib/supabase-clients.js
import { createClient } from '@supabase/supabase-js';

let _anonClient = null;

/**
 * Process-singleton supabase-js anon client for public-flow auth calls.
 * Server-side use only — no browser-style session persistence.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient} configured anon client
 */
export function getAnonSupabaseClient () {
  if (_anonClient === null) {
    _anonClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );
  }
  return _anonClient;
}
```

The `auth: { persistSession: false, ... }` block is critical — supabase-js defaults assume a browser environment with `localStorage`; on the server we explicitly opt out so each `signUp` / `signInWithPassword` call is stateless.

### Source-Context Capture Implementation Notes

```js
// app/src/middleware/source-context-capture.js
const COOKIE_NAME = 'mp_source_ctx';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7;
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;
const MAX_LEN = 100;

function sanitize (raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_LEN) return null;
  if (!PRINTABLE_ASCII.test(raw)) return null;
  return raw;
}

/**
 * Fastify pre-handler hook. Captures FR7 source-context query params
 * (?source=, ?campaign=) into a signed httpOnly cookie. First-write-wins
 * within the cookie's 7-day lifetime.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
export async function sourceContextCapture (request, reply) {
  // First-write-wins: if cookie already exists, do nothing.
  const existing = request.cookies?.[COOKIE_NAME];
  if (typeof existing === 'string' && existing.length > 0) return;

  const source = sanitize(request.query?.source);
  const campaign = sanitize(request.query?.campaign);
  if (source === null && campaign === null) return;

  const value = JSON.stringify({ source, campaign });
  reply.setCookie(COOKIE_NAME, value, {
    signed: true,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  });
}

/**
 * Read FR7 source-context from the signed cookie set by sourceContextCapture.
 * Returns nulls for both fields if the cookie is absent or malformed.
 *
 * @param {import('fastify').FastifyRequest} request
 * @returns {{source: string|null, campaign: string|null}}
 */
export function readSourceContext (request) {
  const raw = request.cookies?.[COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length === 0) {
    return { source: null, campaign: null };
  }
  // @fastify/cookie auto-parses signed cookies; if the signature is invalid,
  // request.cookies[name] is set to false. Fall through to nulls.
  if (raw === false) {
    request.log.warn({ cookie: COOKIE_NAME }, 'source-context cookie signature invalid');
    return { source: null, campaign: null };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      source: typeof parsed?.source === 'string' ? parsed.source : null,
      campaign: typeof parsed?.campaign === 'string' ? parsed.campaign : null,
    };
  } catch {
    request.log.warn({ cookie: COOKIE_NAME }, 'source-context cookie JSON malformed');
    return { source: null, campaign: null };
  }
}
```

Note on `@fastify/cookie` signed-cookie behavior: when `signed: true`, `reply.setCookie` HMACs the value with `COOKIE_SECRET`; on the next request, `request.cookies[name]` is auto-unwrapped — returns the original value if signature valid, or the literal `false` if tampered. The `readSourceContext` helper handles both branches.

### Signup Route Implementation Skeleton

```js
// app/src/routes/_public/signup.js
import { getAnonSupabaseClient } from '../../lib/supabase-clients.js';
import { mapSignupError } from '../../lib/signup-error-mapper.js';
import { readSourceContext } from '../../middleware/source-context-capture.js';

const SIGNUP_BODY_SCHEMA = {
  type: 'object',
  required: ['email', 'password', 'first_name', 'last_name', 'company_name'],
  properties: {
    email:        { type: 'string', format: 'email', maxLength: 254 },
    password:     { type: 'string', minLength: 8, maxLength: 72 },
    first_name:   { type: 'string', minLength: 1, maxLength: 100 },
    last_name:    { type: 'string', minLength: 1, maxLength: 100 },
    company_name: { type: 'string', minLength: 1, maxLength: 200 },
  },
  additionalProperties: false,
};

const PT_FIELD_LABELS = {
  email:        'email',
  password:     'palavra-passe',
  first_name:   'nome próprio',
  last_name:    'apelido',
  company_name: 'nome da empresa',
};

/**
 * Render `signup.eta` with optional preserved form values + per-field PT errors.
 * NEVER preserves the password field value back to the form.
 */
function renderSignup (reply, { formValues = {}, fieldErrors = {}, topError = null, status = 200 } = {}) {
  const { password: _drop, ...safeValues } = formValues;
  return reply.code(status).view('pages/signup.eta', {
    formValues: safeValues,
    fieldErrors,
    topError,
    fieldLabels: PT_FIELD_LABELS,
  });
}

/**
 * Convert Fastify/AJV validation errors into per-field PT-localized messages.
 */
function ajvErrorsToFieldErrors (errors) {
  const out = {};
  for (const e of errors ?? []) {
    // e.instancePath is e.g. '/email'; split + last segment is the field name
    const segments = (e.instancePath ?? '').split('/').filter(Boolean);
    const field = segments[0] ?? (e.params?.missingProperty ?? null);
    if (field !== null && !(field in out)) {
      out[field] = `O campo ${PT_FIELD_LABELS[field] ?? field} é obrigatório ou inválido.`;
    }
  }
  return out;
}

/**
 * Public signup routes: GET + POST /signup.
 * @param {import('fastify').FastifyInstance} fastify
 * @returns {Promise<void>}
 */
export async function signupRoutes (fastify) {
  fastify.get('/signup', async (_request, reply) => renderSignup(reply));

  fastify.post('/signup', {
    schema: { body: SIGNUP_BODY_SCHEMA },
    attachValidation: true,
  }, async (request, reply) => {
    if (request.validationError) {
      return renderSignup(reply, {
        formValues: request.body ?? {},
        fieldErrors: ajvErrorsToFieldErrors(request.validationError.validation),
        status: 400,
      });
    }
    const { email, password, first_name, last_name, company_name } = request.body;
    const { source, campaign } = readSourceContext(request);

    const supabase = getAnonSupabaseClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name, last_name, company_name, source, campaign },
        emailRedirectTo: `${process.env.APP_BASE_URL}/verify-email`,
      },
    });

    if (error) {
      request.log.error({ err: error, code: error.code, status: error.status }, 'signup failed');
      const { field, messagePt } = mapSignupError(error);
      if (field !== null) {
        return renderSignup(reply, {
          formValues: request.body,
          fieldErrors: { [field]: messagePt },
          status: 400,
        });
      }
      return renderSignup(reply, {
        formValues: request.body,
        topError: messagePt,
        status: 400,
      });
    }

    return reply.redirect('/verify-email', 302);
  });
}
```

Note: `attachValidation: true` on the route options tells Fastify NOT to throw on schema-validation errors — the handler inspects `request.validationError` and decides how to render. This is the canonical pattern for routes that want to re-render a form on validation failure rather than return a JSON 400.

### Signup Error Mapper Implementation Skeleton

```js
// app/src/lib/signup-error-mapper.js
const HINT_MAP = Object.freeze({
  PROFILE_FIRST_NAME_REQUIRED:   { field: 'first_name',   messagePt: 'Por favor introduz o teu nome próprio.' },
  PROFILE_LAST_NAME_REQUIRED:    { field: 'last_name',    messagePt: 'Por favor introduz o teu apelido.' },
  PROFILE_COMPANY_NAME_REQUIRED: { field: 'company_name', messagePt: 'Por favor introduz o nome da tua empresa.' },
});

const HINT_KEYS = Object.freeze(Object.keys(HINT_MAP));

const GENERIC_MESSAGE = 'Não foi possível criar a conta. Tenta novamente em alguns minutos.';
const ALREADY_REGISTERED_MESSAGE = 'Este email já está registado. Tenta iniciar sessão.';

/**
 * Map a Supabase auth.signUp error to a {field, messagePt} tuple for rendering.
 * Returns {field: null, messagePt} for unmapped errors (generic catch-all).
 *
 * @param {unknown} error - the error returned from supabase.auth.signUp
 * @returns {{field: 'first_name'|'last_name'|'company_name'|null, messagePt: string}}
 */
export function mapSignupError (error) {
  const message = String(error?.message ?? '');
  const code = String(error?.code ?? '');
  const haystack = `${message} ${code}`;

  for (const key of HINT_KEYS) {
    if (haystack.includes(key)) return HINT_MAP[key];
  }

  // GoTrue surfaces "User already registered" / "user_already_exists" for duplicate emails.
  if (
    code === 'user_already_exists' ||
    /already (registered|exists)/i.test(message)
  ) {
    return { field: 'email', messagePt: ALREADY_REGISTERED_MESSAGE };
  }

  return { field: null, messagePt: GENERIC_MESSAGE };
}
```

### PT-Localized Form Strings (canonical values for Task 11)

| Element | PT string |
|---|---|
| Signup page title | `Cria a tua conta MarketPilot` |
| Signup CTA | `Criar conta` |
| Email label | `Email` |
| Password label | `Palavra-passe (mínimo 8 caracteres)` |
| First-name label | `Nome próprio` |
| Last-name label | `Apelido` |
| Company-name label | `Nome da empresa` |
| Signup → Login link | `Já tens conta? Iniciar sessão` |
| Login page title | `Iniciar sessão` |
| Login CTA | `Entrar` |
| Login → Signup link | `Ainda não tens conta? Cria uma agora` |
| Login → Forgot link | `Esqueceste-te da palavra-passe?` |
| Forgot-password page title | `Repor palavra-passe` |
| Forgot-password CTA | `Enviar link de recuperação` |
| Forgot-password generic confirm | `Se o email existir na nossa base, foi enviado um link para repor a palavra-passe.` |
| Reset-password page title | `Define uma nova palavra-passe` |
| Reset-password CTA | `Guardar palavra-passe` |
| Verify-email page title | `Confirma o teu email` |
| Verify-email body | `Enviámos-te um link para <strong>{{email}}</strong>. Verifica também a pasta de spam.` |
| Already-registered error | `Este email já está registado. Tenta iniciar sessão.` |
| Generic-failure error | `Não foi possível criar a conta. Tenta novamente em alguns minutos.` |
| Login generic error | `Email ou palavra-passe incorretos.` |
| Reset-password failure | `Não foi possível repor a palavra-passe. Tenta novamente.` |
| First-name required | `Por favor introduz o teu nome próprio.` |
| Last-name required | `Por favor introduz o teu apelido.` |
| Company-name required | `Por favor introduz o nome da tua empresa.` |

These strings are **the spec** for Story 1.4. Any change requires Pedro's sign-off (PT copy can be revised but reverberates to the regression-test assertion strings — keep it tight).

### Library Versions and Empirical Patterns (Context7-verified 2026-05-02)

- `@supabase/supabase-js@^2.105.1` (already in `package.json` from Story 1.1): `supabase.auth.signUp({email, password, options: {data, emailRedirectTo}})` is the canonical API. The `options.data` object becomes `auth.users.raw_user_meta_data` — this is what the trigger reads. [Context7: /supabase/supabase-js#Sign Up Users with Email/Password and Phone OTP].
- `fastify@^5.8.5`: route-level `schema: { body: ... }` is the AD28-compliant validation path. `attachValidation: true` lets the handler see validation errors instead of Fastify auto-throwing. [Context7: /fastify/fastify#Register Routes and Schemas].
- `@fastify/view@^11.1.1` with eta engine: register pattern per [Context7: /fastify/point-of-view#Configure Eta Async Templates with Fastify]. Use `propertyName: 'view'` (default) for sync rendering — Story 1.4's pages don't need async data fetching at template time.
- `@fastify/cookie@^11.0.2`: signed-cookie pattern with `secret` option; `request.cookies[name]` returns the unwrapped value or `false` if tampered. The `secret` is `process.env.COOKIE_SECRET`. (This is a NEW required env var added by Story 1.4.)
- `eta@^4.6.0`: tag syntax `<%= it.value %>` (auto-escape) vs `<%~ it.value %>` (no escape). Default is auto-escape — exactly what we want for user-entered form values. The layout is set per-template via `<% layout('layouts/default.eta') %>` (eta v4 syntax — verified against the eta docs page Context7 returned). [Context7: /eta-dev/eta] — uniform with the @fastify/view ecosystem.

### Integration Test — Auth.users Truncation Pattern

The Story 1.4 integration tests need to reset `auth.users` between cases. Because `auth.users` is in the `auth` schema (Supabase-internal), a service-role-bypassing connection is required:

```js
// tests/integration/_helpers/reset-auth-tables.js
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
  // CA cert wiring follows Story 1.1 health.js pattern if needed against Cloud
});

export async function resetAuthAndCustomers () {
  await pool.query(`
    TRUNCATE TABLE
      public.customer_profiles,
      public.customers,
      auth.users
    RESTART IDENTITY CASCADE;
  `);
}
```

`TRUNCATE ... CASCADE` on `auth.users` propagates through the `customers.id REFERENCES auth.users(id) ON DELETE CASCADE` chain. The tests run against a local Supabase instance (the test DB pointed at by `.env.test`) — never against Cloud.

### Forward Dependencies — What This Story Does NOT Do

- **Story 1.5** ships `app/src/middleware/founder-admin-only.js` and the `founder_admins` migration; the `auth.js` middleware that gates non-public routes lands there too (per directory tree).
- **Story 2.1** ships `app/src/middleware/rls-context.js` which reads the `mp_session` cookie set by Story 1.4's `/login` route and constructs the JWT-scoped DB client. The cookie name `mp_session` is a contract between Story 1.4 (writer) and Story 2.1 (reader).
- **Story 2.2** ships `scripts/rls-regression-suite.js`. Story 1.4 leaves a TODO comment in its migrations.
- **Story 4.x onboarding** ships the `customer_marketplaces` schema, `cron_state` enum, the F4 PROVISIONING state, and the onboarding /key + /scan flow. Story 1.4 lands a customer who can sign up + log in but has no marketplace yet.
- **Story 8.x dashboard** ships the actual `/` dashboard surface and the cron_state-based interception redirects. Story 1.4's signed-in customer redirects to `/` per the existing Story 1.1 stub (`'Hello MarketPilot'`).
- **Story 11.5 Moloni**: the `customer_profiles.nif` column (nullable) is captured at first-invoice time; Story 1.4 leaves it NULL.
- **`/admin/status`, `/audit`, `/settings`** route groups — Story 1.4 doesn't ship them.
- **Per-customer rate limiting on `/signup`, `/login`, `/forgot-password`**: `@fastify/rate-limit@^10.3.0` is in `package.json` from Story 1.1 but is NOT wired in this story. Phase 2 trigger if a brute-force or signup-spam pattern emerges; at MVP the Resend free-tier email cost is the practical brake on signup-spam. Note in the codebase as a deferred item.

### Previous Story Intelligence — Stories 1.1 + 1.2 + 1.3

Lessons that shape Story 1.4:

- **Story 1.1** scaffolded Fastify with `getFastifyLoggerOptions()` + `FASTIFY_REQUEST_ID_LOG_LABEL`. Story 1.4's routes inherit this via `request.log` — every signup attempt gets a `request_id`-tagged log line automatically.
- **Story 1.1** chose `supabase/migrations/` over `db/migrations/`. Story 1.4 follows that.
- **Story 1.1 D2 / migration-immutability** rule: never edit a migration after commit; new schema changes = new migration file. Story 1.4 ships TWO new migrations and never touches existing ones.
- **Story 1.1 D5** picked `eslint@^10.3.0` flat config. Story 1.4's new files satisfy the existing rules (`no-console`, `no-restricted-syntax`, `jsdoc/require-jsdoc`).
- **Story 1.2** introduced AES-256-GCM envelope encryption + `MASTER_KEY_BASE64` + the secret-scanning hook. Story 1.4 doesn't reach for the vault; it does add `COOKIE_SECRET` and `SUPABASE_ANON_KEY` to the secret-scanning hook's purview — both are sensitive secrets and SHOULD be flagged if someone accidentally commits them. Add `COOKIE_SECRET=` and `SUPABASE_ANON_KEY=` patterns to `scripts/check-no-secrets.sh` if not already covered by the existing AD3 sentinel patterns.
- **Story 1.2 review-applied patch** extended the AD27 redaction list with `Cookie` / `Set-Cookie`. Story 1.4's signed-cookie writes go through Fastify's `reply.setCookie` API — the resulting `Set-Cookie` response header is automatically redacted in any pino log line per Story 1.3.
- **Story 1.3** locked the SSoT `shared/logger.js`. Story 1.4 uses `request.log` for in-request logging (Fastify-bound child) and `createWorkerLogger()` only if any code runs at module import time outside a request (the supabase-clients singleton lazy-init does NOT need a logger).
- **Story 1.3 review** noted that `process.exit(1)` in `runtime-env.js` races async pino flush. Story 1.4 doesn't add new `process.exit(1)` paths — it adds REQUIRED env vars (`COOKIE_SECRET`, `SUPABASE_ANON_KEY`, `APP_BASE_URL`) which `runtime-env.js`'s existing flow already handles.
- **Story 1.1 / 1.2 / 1.3 test convention**: `node --test`-based, `node:assert/strict`, `.env.test` for env-var injection via `node --env-file=.env.test`. Story 1.4 follows.
- **Story 1.1's existing route registration pattern** (`app/src/routes/health.js` exports `healthRoutes` registered via `fastify.register(healthRoutes)`) — Story 1.4 mirrors this with `signupRoutes` etc., wrapped in the `_public` group plugin.

### Git Intelligence — Recent Commits

```
0906693 feat(story-1.3): pino structured logging + redaction list
aefd4e7 feat(story-1.2): envelope encryption + master-key loader + secret-scanning hook
66f4cc1 feat(story-1.1): scaffold project, two-service Coolify deploy, composed /health
2acb867 docs(planning): three distillates + project-context.md + CLAUDE.md path updates
87fc05d docs(sprint): generate sprint-status.yaml — 62 stories sequenced
```

Story 1.3 landed today (2026-05-02). Story 1.4 is the next `feat` commit.

**Commit conventions for Atomicity Bundle A**:
- Single PR, single commit recommended (Bundle A is the epitome of "ship together"). Commit message: `feat(story-1.4): signup + atomic auth+profile trigger + source-context capture (Bundle A)`
- If splitting helps review, the acceptable split is: (1) the two migrations in one commit, (2) the supabase-clients + middleware + routes + views in a second commit, (3) the tests in a third — ALL in the same PR. NEVER split the migration commit from the trigger-consuming code; the trigger MUST exist before any signUp call lands in production.

### AD Coverage This Story Implements

- **AD29** — `customer_profiles` schema (`first_name`, `last_name`, `company_name` NOT NULL); atomic creation pattern via Postgres trigger.
- **F3** — Postgres trigger `handle_new_auth_user` on `auth.users` AFTER INSERT, `SECURITY DEFINER`, RAISE EXCEPTION rolls back transaction.
- **FR1** — Self-serve signup with email verification (Supabase handles the email verification leg).
- **FR2** — Single login per customer at MVP; multi-user RBAC = Phase 2 (negative-assertion: no `customer_team_members` table created).
- **FR3** — Email-verified password reset (via Supabase Auth's `resetPasswordForEmail` + `updateUser`).
- **FR7** — Source-context query params (`?source`, `?campaign`) persist on customer record.
- **NFR-S5** — Supabase Auth handles bcrypt internally; no MarketPilot-side password storage.
- **UX-DR1** — auth `?next=` preservation in login route.
- **AD28** (negative-assertion) — Fastify built-in JSON Schema validation only (no zod/joi/yup/ajv added).
- **Constraint #16** (negative-assertion) — No multi-user / team-membership table created.
- **AD27** (Story 1.3 SSoT consumed) — All log emission via `request.log.*` / `createWorkerLogger()`; redaction list automatically applies to `Set-Cookie` and any sensitive field.

### Project Structure Notes

Files created in this story:

```
supabase/migrations/<ts>_create_customers.sql                     # NEW — customers schema + RLS
supabase/migrations/<ts>_create_customer_profiles_with_trigger.sql # NEW — customer_profiles + trg_handle_new_auth_user
app/src/lib/supabase-clients.js                                   # NEW — singleton anon client factory
app/src/lib/signup-error-mapper.js                                # NEW — HINT → PT field message
app/src/middleware/source-context-capture.js                      # NEW — sourceContextCapture, readSourceContext
app/src/routes/_public/index.js                                   # NEW — public route group plugin
app/src/routes/_public/signup.js                                  # NEW — GET + POST /signup
app/src/routes/_public/login.js                                   # NEW — GET + POST /login
app/src/routes/_public/verify-email.js                            # NEW — GET /verify-email
app/src/routes/_public/forgot-password.js                         # NEW — GET + POST /forgot-password
app/src/routes/_public/reset-password.js                          # NEW — GET + POST /reset-password
app/src/views/layouts/default.eta                                 # NEW — sticky-header chrome layout
app/src/views/pages/signup.eta                                    # NEW — signup form (Pattern C)
app/src/views/pages/login.eta                                     # NEW — login form (Pattern C)
app/src/views/pages/forgot-password.eta                           # NEW — email-input form (Pattern C)
app/src/views/pages/reset-password.eta                            # NEW — password-input form (Pattern C)
app/src/views/pages/verify-email.eta                              # NEW — pass-through page (Pattern C)
public/js/signup.js, login.js, forgot-password.js, reset-password.js  # NEW — minimal `defer` stubs per F9
tests/integration/signup-flow.test.js                             # NEW — AC#7 atomicity + happy-path + negatives
tests/integration/_helpers/reset-auth-tables.js                   # NEW — service-role TRUNCATE helper
tests/app/middleware/source-context-capture.test.js               # NEW — AC#4 unit tests
tests/app/lib/signup-error-mapper.test.js                         # NEW — AC#3 unit tests
```

Files modified:

```
app/src/server.js                                                 # register @fastify/cookie + @fastify/view + _public plugin
shared/config/runtime-env.js                                      # add COOKIE_SECRET, SUPABASE_ANON_KEY, APP_BASE_URL to REQUIRED_VARS
.env.example                                                      # add new env vars with one-line comments
scripts/check-no-secrets.sh                                       # add COOKIE_SECRET / SUPABASE_ANON_KEY patterns if not subsumed by AD3 sentinels
README.md                                                         # add "Auth & Signup" one-paragraph section
```

### Alignment with Unified Project Structure

- **Module locations** match `architecture-distillate/05-directory-tree.md`:
  - `app/src/routes/_public/{signup, login, verify-email, forgot-password, reset-password}.js` ✓
  - `app/src/middleware/source-context-capture.js` ✓
  - `app/src/lib/` — used for app-only helpers (`supabase-clients.js`, `signup-error-mapper.js`); the directory tree shows `session.js` / `view-helpers.js` / `format.js` already reserved for app-only modules. New helpers fit the convention.
  - `app/src/views/{layouts,pages}/*.eta` ✓
  - `public/js/<page>.js` per F9 — files exist as defer-loaded stubs even when no client-side behavior is shipped, to maintain the "every page has a JS file" pattern that Epic 8 will fill in.
- **Migration directory**: `supabase/migrations/` per Story 1.1 D2 (overrides architecture distillate's `db/migrations/`).
- **No deviations**: no new top-level directories; no entry-point changes.

### Dev Notes for Pedro

- **Day-of-deploy verification**: after merging Story 1.4 and Coolify redeploys, sign up at `https://app.marketpilot.pt/signup` with your own email. Confirm the email link arrives. Confirm a row appears in `auth.users`, `customers`, `customer_profiles` in the Supabase Studio table editor. If the email doesn't arrive within 60 seconds, check Supabase project's Auth → Email Templates configuration and SMTP settings (Supabase free tier has SMTP rate limits — Phase 2 trigger to wire a custom SMTP provider via Supabase Auth's `auth.email` config if signup volume exceeds free-tier).
- **Test the missing-field path**: in dev, send a signup request via `curl` with `first_name=" "` (whitespace-only). The trigger should reject the request and you should see the PT field error. If you instead see "User created" with a whitespace first_name, the trigger function didn't apply correctly — check the migration log.
- **Source-context cookie**: visit `https://app.marketpilot.pt/signup?source=free_report&campaign=tony_august` in a fresh browser, look at DevTools → Application → Cookies for `mp_source_ctx`. Sign up and verify `customers.source` and `customers.campaign` populated. The 7-day cookie lifetime means a customer who clicks the free-report email link, browses the site, signs up a few days later still gets attributed correctly.
- **Reset password flow**: this is the trickiest UX path because Supabase Auth's recovery link returns to `/reset-password` with the token in the URL fragment (`#access_token=...&type=recovery`). The default eta server-rendered page can't read the fragment server-side; the F9 `defer` script in `public/js/reset-password.js` will need to extract the fragment in client-side JS and POST it back. This is the closest to a "real client-side" surface in Story 1.4 — Pedro can validate by triggering a real reset email and walking the flow end-to-end.
- **The atomicity bundle is the trust deliverable**: this story IS the proof that "signup never lands a customer in a broken state". Code review by another LLM (CR adversarial) MUST verify the atomicity invariant by attempting a missing-field signup against the live test DB and confirming zero rows in all three tables post-attempt. Don't merge without that empirical check.

### References

- [Source: epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md#Story 1.4: Signup endpoint, atomic profile trigger, source-context capture] — verbatim 7 ACs, Bob-trace, Pattern C contract, atomicity-bundle annotation
- [Source: epics-distillate/_index.md#Cross-Cutting: Atomicity Bundles] — Bundle A definition (F3 + AD29 single PR; signup never lands in orphan-auth-without-profile state)
- [Source: epics-distillate/_index.md#Coverage Maps#FR Coverage] — FR1, FR2, FR3, FR7 → Story 1.4
- [Source: epics-distillate/_index.md#Coverage Maps#AD Coverage] — AD29 → Story 1.4 (with F3)
- [Source: epics-distillate/_index.md#F1-F13 Amendments → story mapping] — F3 → Story 1.4 (Postgres trigger SECURITY DEFINER — atomicity bundle)
- [Source: epics-distillate/_index.md#UX-DR Coverage] — UX-DR1 (auth `?next=` preservation) → Story 1.4
- [Source: epics-distillate/_index.md#Architectural Constraints / Negative Assertions] — Constraint #16 (no team-membership table at MVP — FR2 negative assertion); Constraint #2 (AD28 — no external validator); Constraint #18 (no console.log)
- [Source: architecture-distillate/03-decisions-E-J.md#AD29 — Customer profile schema: first_name, last_name, company_name NOT NULL] — full AD29 spec including the F3 atomic-creation pattern, HINT → PT-localized error mapping, "no partial-state cleanup needed" rollback semantics
- [Source: architecture-distillate/06-database-schema.md#customers (Identity)] — verbatim DDL for `customers` table including FR7 source/campaign columns, F2 Stripe linkage columns, AD21 deletion columns
- [Source: architecture-distillate/06-database-schema.md#customer_profiles (Identity)] — verbatim DDL for `customer_profiles` table + `handle_new_auth_user()` function body + `trg_handle_new_auth_user` trigger declaration
- [Source: architecture-distillate/_index.md#Cross-Cutting Atomicity Bundles] — Bundle A definition; the auth+profile transaction is the canonical Bundle A
- [Source: architecture-distillate/_index.md#Cross-Cutting Pre-Locked Decisions] — "Customer profile schema: first_name, last_name, company_name all NOT NULL at signup; written atomically with Supabase Auth user creation (single transaction, no orphan auth-without-profile state); NIF deliberately deferred to invoice-generation moment"
- [Source: architecture-distillate/05-directory-tree.md] — file locations for `app/src/routes/_public/`, `app/src/middleware/`, `app/src/lib/`, `app/src/views/` and the migration filename examples
- [Source: prd-distillate.md#FR1, FR2, FR3, FR7] — functional requirement statements
- [Source: prd-distillate.md#NFR-S5] — Supabase Auth defaults; no MarketPilot-side password storage
- [Source: project-context.md#3 Atomicity Bundles#Bundle A — auth+profile creation (F3 + AD29)] — single-PR landing convention; HINT → PT-localized error mapping; trigger rollback atomicity
- [Source: project-context.md#27 Architectural Constraints#16] — no `customer_team_members` at MVP
- [Source: project-context.md#Anti-Patterns / Refuse List] — "Add `customer_team_members` for multi-user → No. Constraint #16. Phase 2."
- [Source: implementation-artifacts/1-1-scaffold-project-two-service-coolify-deploy-composed-health.md] — Fastify v5 scaffold + ESLint v10 flat config + `supabase/migrations/` decision (D2)
- [Source: implementation-artifacts/1-2-envelope-encryption-module-master-key-loader-secret-scanning-hook.md] — secret-scanning hook patterns; migration-immutability rule
- [Source: implementation-artifacts/1-3-pino-structured-logging-with-redaction-list.md] — `shared/logger.js` SSoT, `getFastifyLoggerOptions()`, `Cookie`/`Set-Cookie` redaction extension; integration-smoke test pattern
- [Mirakl MCP] — not applicable to Story 1.4 (no Mirakl calls in signup/login/reset)
- [Context7: /supabase/supabase-js#Sign Up Users with Email/Password and Phone OTP] — `auth.signUp({email, password, options: {data, emailRedirectTo}})` canonical API
- [Context7: /supabase/supabase-js#Manage User Sessions] — `auth.updateUser({password})`; `auth.setSession({access_token, refresh_token})`
- [Context7: /fastify/fastify#Register Routes and Schemas] — `schema: { body: ... }` + `attachValidation: true` route-level validation pattern
- [Context7: /fastify/fastify#Registering Routes with Prefixes] — Fastify plugin encapsulation for the `_public` route group
- [Context7: /fastify/point-of-view#Configure Eta Async Templates with Fastify] — `@fastify/view` + eta engine registration; `reply.view(...)` rendering
- [Context7: /fastify/point-of-view#`reply.locals` for Request-Scoped Variables] — pattern for hook-set per-request template variables (deferred to Story 2.1's RLS middleware; Story 1.4 passes data directly to `reply.view`)
- [Supabase MCP — `marketpilot-repricer` project_id `ttqwrbtnwtyeehynzubw`] — verify migrations applied via `list_migrations`; verify `customers` and `customer_profiles` tables present via `list_tables`; verify RLS via `execute_sql` SELECT cross-tenant probe (read-only verification only — never `apply_migration`)
- DynamicPriceIdea (`D:\Plannae Project\DynamicPriceIdea`) — does NOT include a customer-signup flow (it's a static report generator). No reusable code from there for this story.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Opus 4.7, 1M context)

### Debug Log References

- ESLint final: 0 errors, 2 pre-existing warnings (`_`-prefixed catch param + unrelated scripts/ warning).
- Unit tests: 71/71 pass (`tests/shared/`, `tests/scripts/`, `tests/worker/`, `tests/app/`).
- Live server smoke (PORT=13347 with stub env vars): all 5 GET surfaces (`/signup`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`) return HTTP 200 with rendered HTML; POST `/signup` with invalid body returns HTTP 400 with PT-localized field errors and re-renders the form.
- Source-context cookie behaviour confirmed at HTTP level: first request with `?source=&campaign=` sets `mp_source_ctx`; subsequent request with different params and the cookie attached emits NO Set-Cookie (first-write-wins).
- Local Supabase docker is broken on this WSL2/Ryzen 5800XT machine (segfault `exit 139` per `supabase-debug*.log` files), so `tests/integration/signup-flow.test.js` was authored to spec but not executed in this session — it requires `.env.test` + a working local Postgres (the AC#7 contract is verifiable as soon as Pedro's local Supabase is running, or against a CI Postgres).

### Completion Notes List

- **Atomicity Bundle A (F3 + AD29) shipped as a single PR-ready commit set.** The `handle_new_auth_user()` trigger function uses `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`, validates each required B2B field with `length(trim(...)) = 0`, and raises with `ERRCODE='23502'` + the verbatim HINTs (`PROFILE_FIRST_NAME_REQUIRED` / `_LAST_` / `_COMPANY_`) — matching the architecture distillate's specification character-for-character. Atomicity is enforced by Postgres transaction semantics; the route layer carries zero partial-state cleanup logic.
- **FR7 source-context capture** persists `?source` / `?campaign` on a 7-day signed cookie (`mp_source_ctx`), validated as printable ASCII ≤100 chars, first-write-wins. Both the middleware (`sourceContextCapture`) and the read helper (`readSourceContext`) live in `app/src/middleware/source-context-capture.js`. Cookie wiring is auto-encapsulated to the `_public` plugin only — authenticated route groups will NOT inherit this hook.
- **Constraint #16 negative-assertion enforced in code**: zero migrations create `customer_team_members` / `team_members` / `user_organizations` / `customer_users` tables. The integration test `negative_assertion_no_team_table` introspects `information_schema.tables` to assert this at runtime.
- **AD28 negative-assertion enforced**: only Fastify built-in JSON Schema validation. `npm ls zod joi yup ajv` shows none in package.json. Routes use `schema: { body: ... }` + `attachValidation: true` (no extra validator deps).
- **NFR-S5 / safe-error contract**: `signup-error-mapper.js` never echoes raw upstream `error.message` to the customer; unmapped errors fall through to PT generic catch-all. Unit tests verify NFR-S5 with a synthetic upstream-message-leak test.
- **Dependency added: `@fastify/formbody@^8.0.2`.** The story spec called for HTML `<form method="POST">` postings to the `/signup`, `/login`, `/forgot-password`, `/reset-password` routes plus `request.body.email` access in handlers, but Fastify v5's default content-type parser only handles JSON — meaning `application/x-www-form-urlencoded` POSTs returned 415 until formbody was registered. This is a missed dependency in the story planning, not scope creep — the spec is otherwise non-functional. Flagged for review-time approval.
- **ESLint config extended** to add a `public/js/**/*.js` block with browser globals (window/document/URLSearchParams) — Story 1.4 is the first story to ship `public/js/*.js` files (F9 stubs + the recovery-token fragment extractor). Pre-existing source/test/script blocks unchanged.
- **Secret-scanning hook extended** with two new patterns: `COOKIE_SECRET=` substantial-value assignment + `SUPABASE_ANON_KEY=eyJ...` JWT-shaped assignment. Four new regression tests in `tests/scripts/check-no-secrets.test.js`.
- **Migration filenames** use the architecture-distillate's canonical timestamps `202604301200_create_customers.sql` and `202604301201_create_customer_profiles_with_trigger.sql` to preserve lexicographic ordering relative to the deferred `202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` and the already-applied `202604301212_create_worker_heartbeats.sql`. Apply via `npx supabase db push` once both new files are committed (per Story 1.2 Option A pattern: do not push the customers migration to Cloud until customer_profiles+trigger is also ready, since GoTrue signUp requires the trigger to function).
- **Visual surface**: the auth pages share a Pattern-C layout (`views/layouts/default.eta`) referencing `/public/css/tokens.css` (placeholder palette + spacing tokens shipped here, full visual-DNA owned by Epic 8). Each page is a self-contained eta template using the `<% layout('/layouts/default', { ...it, title: '...' }) %>` directive (eta v4 absolute-path layout resolution).

### Post-Implementation Verification (2026-05-02 Pedro session)

After Amelia's implementation, the integration test `tests/integration/signup-flow.test.js` was executed end-to-end against a working local Supabase docker stack (Pedro's hardware-compat issues resolved earlier in the session). Initial run: **5/11 pass**. Two empirical contract violations were caught and fixed before Story 1.4 ships. Final run: **11/11 pass**.

**Empirical contract #1 — GoTrue strips Postgres HINT codes from error responses.**

Bob's spec (and Amelia's `signup-error-mapper.js`) assumed `PROFILE_FIRST_NAME_REQUIRED` / `_LAST_` / `_COMPANY_` HINT codes raised from the trigger would propagate through GoTrue and be substring-detectable in `error.message` of the supabase-js `AuthError`. Empirical reality: current Supabase Auth (`@supabase/auth-js` v2.x) genericizes the error to `message: "Database error saving new user"` and `code: "unexpected_failure"` — the HINT is stripped before reaching the client. The mapper falls through to its `GENERIC_MESSAGE` catch-all and the customer never sees the field-specific PT error.

**Fix applied to `app/src/routes/_public/signup.js`**: route-level pre-validation mirrors the trigger's `length(trim(...)) = 0` check. After Fastify schema validation, before calling `auth.signUp`, the route inspects `first_name.trim().length`, `last_name.trim().length`, `company_name.trim().length`. Any whitespace-only field returns 400 + the PT field error directly via `renderSignup({ fieldErrors })`. The trigger remains as defense-in-depth (catches direct DB writes / future code paths that bypass this route), but the user-facing PT-localized field error is produced at the route, not the mapper. `signup-error-mapper.js` is unchanged — it still handles non-trigger errors (e.g., `user_already_exists`).

**Empirical contract #2 — `@fastify/cookie` does NOT auto-unwrap signed cookies.**

`source-context-capture.js`'s `readSourceContext()` assumed `request.cookies[COOKIE_NAME]` returns the original (unsigned) value, with `false` indicating tampered. Empirical reality: `@fastify/cookie` v11+ returns the raw signed string (`s:<value>.<signature>`) and requires explicit `request.unsignCookie(raw)` to verify and extract. Without that call, `JSON.parse` fails on the signed format and the catch-block returns `{ source: null, campaign: null }` — silently zeroing out FR7 funnel attribution.

**Fix applied to `app/src/middleware/source-context-capture.js`**: `readSourceContext()` now calls `request.unsignCookie(raw)` and uses the returned `{ valid, value }` tuple. Invalid signature → log warn + return nulls. Valid → JSON.parse the unsigned `value`. The middleware's write-side `sourceContextCapture()` is unchanged (first-write-wins on raw cookie presence is fine).

**Test infrastructure fixes (not implementation bugs)**:

- `tests/integration/_helpers/reset-auth-tables.js`: replaced `TRUNCATE auth.users CASCADE RESTART IDENTITY` with `DELETE FROM auth.users`. Reason: TRUNCATE CASCADE requires ownership of the auth schema's sequences (e.g. `refresh_tokens_id_seq`), which are owned by `supabase_auth_admin` and not the postgres connection user. DELETE relies on the Supabase-defined `ON DELETE CASCADE` chain on `auth.users` children to wipe dependents — works without ownership.
- `tests/integration/signup-flow.test.js`: changed readiness probe from `GET /health` to `GET /` because the test spawns only the app process (not the worker), so `/health`'s worker-heartbeat freshness check would always 503. `GET /` returns the scaffold's `Hello MarketPilot` placeholder once Fastify is listening.

**Files modified during verification** (added to File List below):

- `app/src/routes/_public/signup.js` — route-level pre-validation block before `auth.signUp` call
- `app/src/middleware/source-context-capture.js` — `readSourceContext()` uses `request.unsignCookie()`
- `tests/integration/_helpers/reset-auth-tables.js` — `TRUNCATE → DELETE`
- `tests/integration/signup-flow.test.js` — readiness probe `/health → /`
- `.env.test` — NEW file (gitignored), points at local Supabase stack

**What this means for review**:

CR (different LLM) should specifically validate:
1. The pre-validation block's logic exactly mirrors the trigger's `length(trim(...)) = 0` check (no drift). If the trigger ever changes its validation rules, both must update together.
2. The `request.unsignCookie()` migration didn't break the middleware's write-side (it didn't — only the read side was touched).
3. The atomicity invariant (Bundle A) is still empirically proven by the 3 `trigger_rolls_back_on_missing_*` integration tests — the rollback path now fires when the trigger raises (which still happens for direct DB writes), AND when the route pre-validation rejects (which is the user-facing path). Both paths satisfy AC#3's atomicity requirement.

### File List

**New files:**
- `supabase/migrations/202604301200_create_customers.sql`
- `supabase/migrations/202604301201_create_customer_profiles_with_trigger.sql`
- `app/src/lib/supabase-clients.js`
- `app/src/lib/signup-error-mapper.js`
- `app/src/middleware/source-context-capture.js`
- `app/src/routes/_public/index.js`
- `app/src/routes/_public/signup.js`
- `app/src/routes/_public/login.js`
- `app/src/routes/_public/verify-email.js`
- `app/src/routes/_public/forgot-password.js`
- `app/src/routes/_public/reset-password.js`
- `app/src/views/layouts/default.eta`
- `app/src/views/pages/signup.eta`
- `app/src/views/pages/login.eta`
- `app/src/views/pages/forgot-password.eta`
- `app/src/views/pages/reset-password.eta`
- `app/src/views/pages/verify-email.eta`
- `public/js/signup.js`
- `public/js/login.js`
- `public/js/forgot-password.js`
- `public/js/reset-password.js`
- `public/css/tokens.css`
- `tests/integration/signup-flow.test.js`
- `tests/integration/_helpers/reset-auth-tables.js`
- `tests/app/middleware/source-context-capture.test.js`
- `tests/app/lib/signup-error-mapper.test.js`

**Modified files:**
- `app/src/server.js` (registers `@fastify/cookie`, `@fastify/formbody`, `@fastify/view` + eta engine, `_public` plugin)
- `shared/config/runtime-env.js` (adds `SUPABASE_ANON_KEY`, `COOKIE_SECRET`, `APP_BASE_URL` to `REQUIRED_VARS`)
- `eslint.config.js` (adds `public/js/**/*.js` config block with browser globals)
- `scripts/check-no-secrets.sh` (adds `COOKIE_SECRET` + `SUPABASE_ANON_KEY` patterns)
- `tests/scripts/check-no-secrets.test.js` (adds 4 new regression cases for the new patterns)
- `package.json` (adds `@fastify/formbody@^8.0.2`)
- `package-lock.json` (regenerated)
- `.env.example` (adds `COOKIE_SECRET`, `APP_BASE_URL`, comments for `SUPABASE_ANON_KEY`)
- `README.md` (adds "Auth & Signup" section)

**Modified during post-implementation verification (Pedro session 2026-05-02):**
- `app/src/routes/_public/signup.js` — added route-level pre-validation block (`first_name.trim() / last_name / company_name`) before `auth.signUp` call. Reason: GoTrue empirically strips trigger HINT codes; route pre-validation produces user-facing PT error directly. See "Post-Implementation Verification" section above.
- `app/src/middleware/source-context-capture.js` — `readSourceContext()` now uses `request.unsignCookie(raw)` for explicit signed-cookie verification. Reason: `@fastify/cookie` v11+ does not auto-unwrap; previous code returned nulls silently for valid cookies. See "Post-Implementation Verification" above.
- `tests/integration/_helpers/reset-auth-tables.js` — `TRUNCATE auth.users CASCADE` → `DELETE FROM auth.users`. Reason: TRUNCATE requires sequence ownership which the postgres user lacks for `auth.refresh_tokens_id_seq` (owned by `supabase_auth_admin`); DELETE relies on `ON DELETE CASCADE` chain.
- `tests/integration/signup-flow.test.js` — readiness probe `GET /health` → `GET /`. Reason: test spawns only the app, not the worker, so `/health`'s heartbeat-freshness gate would always 503.

**New file (verification, gitignored):**
- `.env.test` — local-Supabase test environment configuration; never committed.

## Change Log

| Date       | Author | Change                                                                                                |
|------------|--------|-------------------------------------------------------------------------------------------------------|
| 2026-05-02 | Bob    | Story sharded — Atomicity Bundle A (F3 + AD29): customers + customer_profiles migrations + handle_new_auth_user trigger + signup/login/forgot-password/reset-password/verify-email routes + source-context-capture middleware + signup-error-mapper |
| 2026-05-02 | Amelia | Implemented Atomicity Bundle A. 16/16 tasks + 56 subtasks complete. New dep: `@fastify/formbody@^8.0.2` (HTML form parsing — missed in spec planning). 71/71 unit tests pass; integration test authored but requires local Supabase to run. |
| 2026-05-02 | Pedro / Code Review | **D2 (review patch)** — Singleton `setSession` race in `/reset-password`: added `createEphemeralAnonSupabaseClient()` sibling factory in `app/src/lib/supabase-clients.js`; `reset-password.js` POST handler now uses a per-request client. Singleton (`getAnonSupabaseClient()`) preserved for stateless flows (`/signup`, `/login`, `/forgot-password`). |
| 2026-05-02 | Pedro / Code Review | **D3 (accepted out-of-scope)** — `supabase/migrations/202604301204_create_shop_api_key_vault.sql` renamed to `.deferred-until-story-4.1` to remove from `supabase db push` glob until Story 4.1 lands `customer_marketplaces`. Preserves Story 1.2's "Option A — commit but defer push" intent; the file content is unchanged and remains in the repo. |
| 2026-05-02 | Pedro / Code Review | **D4 (accepted out-of-scope)** — `supabase/config.toml` disables `[realtime]`, `[studio]`, `[storage]`, `[edge_runtime]`, `[analytics]` as a local-Supabase WSL2/Ryzen 5800XT compat workaround (segfault `exit 139` documented in `supabase-debug*.log`). Required to run integration tests locally. Other contributors pulling this branch inherit the disabled-services profile; if they need any of those services, override locally and do not commit. |
| 2026-05-02 | Pedro / Code Review | **D5 (accepted UX-drift from AC#3)** — `mapSignupError` returns `{field: 'email', messagePt: 'Este email já está registado. Tenta iniciar sessão.'}` for `user_already_exists` instead of falling through to the generic top-error path. PT message is canonical (spec line 535); the field-mapping is the deviation. Inline field error judged materially better UX than a generic top-error banner. AC#3 is not amended — this Change Log entry is the authoritative record of the deviation. |
| 2026-05-02 | Pedro / Code Review | **15 review patches applied** — P1 open-redirect (`safeNextPath` regex with negative lookahead), P2 mp_session 7-day maxAge, P3 next-path regex broadened, P4 source-context write-side sign-check, P5 GET-only attribution-capture gate, P6 deterministic timing floor on `/forgot-password`, P8 password byte-length cap (signup + reset), P9 APP_BASE_URL trailing-slash strip, P10 unsignCookie try/catch, P11 SAFE_IDENTIFIER sanitize regex, P12 additionalProperties topError surfacing, P13 customer_profiles 23505 assertion, P14 timing-tolerance assertion, P15 source/migration team-table grep test, P16 pg.Pool process-cleanup. P7 (trigger NBSP) and P17 (`getAnonSupabaseClient` env timing) deferred to schema-hardening pass / Story 2.1 env-binding refactor; logged in `deferred-work.md`. Lint clean (0 errors). 74/74 unit tests pass. Status flipped review → done. |
| 2026-05-02 | Pedro session | Post-implementation integration-test verification: 11/11 pass after fixing 2 empirical contract violations. (1) GoTrue strips Postgres HINTs — added route-level pre-validation in `signup.js`. (2) `@fastify/cookie` requires explicit `unsignCookie()` — fixed in `source-context-capture.js`. Plus 2 test infra fixes (TRUNCATE→DELETE for sequence ownership; readiness probe `/health`→`/` since worker not spawned). See "Post-Implementation Verification" section. |
