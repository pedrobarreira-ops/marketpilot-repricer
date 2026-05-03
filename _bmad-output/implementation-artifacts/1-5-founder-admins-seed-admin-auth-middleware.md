# Story 1.5: Founder admins seed + admin-auth middleware

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As Pedro (founder),
I want a `founder_admins` system table seeded with my own email plus two composable Fastify middlewares — `auth.js` (generic Supabase session check that reads the `mp_session` cookie set by Story 1.4's `/login`, validates the JWT against Supabase Auth, decorates `request.user`, and redirects unauthenticated requests to `/login?next=<current-path>` per UX-DR1) and `founder-admin-only.js` (composed on `auth.js`, looks the authenticated user's email up in `founder_admins` via a service-role DB connection, decorates `request.adminContext = {email}` on success, returns a 403 with the PT-localized message *"Esta página é apenas para administração."* on absence) —
so that every future admin-only surface (Story 8.10's `/admin/status`, founder operational endpoints) gates through one SSoT primitive that satisfies AD4 (founder admin read-only), Constraint #13 (no customer impersonation), and the trust commitment that the customer's account is *theirs* — the founder NEVER logs in as the customer.

## Acceptance Criteria

1. **Given** the new migration applied to a fresh Postgres — `supabase/migrations/202604301202_create_founder_admins.sql` (this filename uses the architecture distillate's canonical timestamp; the actual file may use whatever Supabase CLI emits at `npx supabase migration new create_founder_admins` time, **provided** lexicographic ordering places it AFTER `202604301201_create_customer_profiles_with_trigger.sql` from Story 1.4 and BEFORE `202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` — so the canonical `202604301202` timestamp is the safe choice) — **When** I inspect the database **Then**:
    - `founder_admins` table exists per [Source: architecture-distillate/06-database-schema.md#founder_admins (Identity)] verbatim DDL: `email text PRIMARY KEY`, `notes text` (nullable — operator notes about each admin), `created_at timestamptz NOT NULL DEFAULT NOW()`.
    - **No `ALTER TABLE founder_admins ENABLE ROW LEVEL SECURITY` statement is present** — `founder_admins` is intentionally a **system table; service-role-only access** per AD4 [Source: architecture-distillate/06-database-schema.md#founder_admins (Identity)] (no per-customer scope, no `auth.uid()` predicate would make sense). Note: Supabase project `ttqwrbtnwtyeehynzubw` has the `ensure_rls` event trigger enabled [Source: project-context.md#Supabase MCP] — the migration MUST explicitly include `ALTER TABLE founder_admins DISABLE ROW LEVEL SECURITY;` immediately after the `CREATE TABLE` to override the auto-enable behavior. Without that line, RLS will be enabled with no policies, and all subsequent SELECT/INSERT attempts (even from the service-role-bypassing connection used by the middleware) will silently return zero rows in some configurations and the founder middleware will universally 403.
    - The migration includes **one seed insert** for Pedro's founder email: `INSERT INTO founder_admins (email, notes) VALUES (<pedro_email>, 'Founder — Pedro Barreira') ON CONFLICT (email) DO NOTHING;`. **Pedro confirms the canonical email value at story-implementation time** — Bob's spec uses the placeholder `<pedro_email>` and the Task list (Task 1) carries the explicit instruction *"Replace `<pedro_email>` with Pedro's confirmed founder-account email before applying the migration. Default candidate is `pedro.belchior.barreira@gmail.com` (per Pedro's environment); if Pedro plans to use a dedicated business email like `pedro@marketpilot.pt`, use that instead. Single source of truth — once committed, future seeds (e.g., adding a co-founder later) ship as separate ALTER-INSERT migrations, never edits to this file."*. The `ON CONFLICT (email) DO NOTHING` makes the seed idempotent in case of any re-apply scenario.
    - **No FK from `founder_admins.email` to anything else** — the table is an authoritative allow-list, not a derived projection. A future co-founder's email can be added before that person has signed up to MarketPilot (the email-key acts as an authorization assertion, not a join key). The middleware (`founder-admin-only.js`) does NOT JOIN against `auth.users` or `customers`; it only checks presence-by-email.
    - The migration includes the Story 1.1 / 1.2 / 1.4 migration-immutability sentinel header comment block: *"-- IMPORTANT: this file is append-only once committed. Schema changes after the first commit ALWAYS create a new migration. Never edit this file post-commit."*
    - The migration includes the Story 1.4 convention TODO comment: `-- TODO Story 2.2: founder_admins is service-role-only with no RLS policies; rls-regression-suite SHOULD assert RLS is OFF on this table (defensive — ensures a future automation doesn't silently enable it).` This makes Story 2.2's regression suite responsible for the negative assertion.

2. **Given** `app/src/middleware/auth.js` (a NEW file in this story; the **generic** Supabase session-check middleware, NOT founder-specific) **When** the middleware runs as a `preHandler` hook on any authenticated route group **Then**:
    - The middleware reads the `mp_session` signed cookie that Story 1.4's `app/src/routes/_public/login.js` writes [Source: implementation-artifacts/1-4-signup-endpoint-atomic-profile-trigger-source-context-capture.md#Forward Dependencies] — **NEVER renames the cookie name** (`mp_session` is a cross-story contract; renaming breaks Story 1.4's writer side and any downstream consumer like Story 2.1's `rls-context.js`).
    - The middleware reads the cookie via the **`@fastify/cookie` v11+ explicit unsign pattern** per [Source: project-context.md#Library Empirical Contracts + Operational Patterns#2. @fastify/cookie v11+ does NOT auto-unwrap signed cookies]: `const { valid, value } = request.unsignCookie(raw)`. The `request.cookies[name] === false` legacy auto-unwrap pattern is **wrong** — the library does not do this. The Story 1.4 `source-context-capture.js` `readSourceContext` helper is the canonical reference implementation; mirror its try/catch + `valid` check + JSON-parse pattern verbatim.
    - On valid cookie: `JSON.parse(value)` to extract `{access_token, refresh_token}` (the JSON shape Story 1.4's login route writes). Validate the access token by calling `await getAnonSupabaseClient().auth.getUser(access_token)` per [Context7: /supabase/supabase-js#auth.getUser]. The `getUser(jwt)` call accepts a raw JWT string (not a session object) and returns `{data: {user}, error}`. If `error` is non-null OR `data?.user?.id` is missing, treat as session-invalid and redirect to login (next sub-bullet).
    - On valid session: decorate `request.user = { id: data.user.id, email: data.user.email, access_token, refresh_token }`. The `access_token` and `refresh_token` are forwarded so Story 2.1's `rls-context.js` and any future authenticated routes can consume them without re-reading the cookie. Use `request.session = data.user` is **forbidden** — `session` is too generic and risks collision with other Fastify session libraries that may be wired in Phase 2.
    - On missing cookie / invalid signature / invalid JWT / Supabase error: `reply.redirect(302, '/login?next=' + encodeURIComponent(currentPath))` where `currentPath = request.url` (path + query string preserved per UX-DR1). **Open-redirect guard**: do NOT include the `host`/scheme — `next` is a path-only relative URL by Story 1.4's `safeNextPath()` contract in `app/src/routes/_public/login.js` (the regex `^\/(?![/\\])[A-Za-z0-9_\-./?=&%:+~]*$|^\/$` rejects protocol-relative paths). Cap the encoded `next` at 512 chars — the schema in `LOGIN_BODY_SCHEMA` already enforces `next.maxLength: 512`; if `request.url.length > 512`, fall through to a bare `/login` redirect (logged at `info` level for visibility into truncation events).
    - The middleware does NOT call `reply.send` or otherwise terminate the response on the redirect path — `reply.redirect` is sufficient and chains correctly with Fastify's preHandler-hook short-circuit semantics.
    - **Negative assertion (Constraint #18 / no console)**: the middleware uses `request.log.warn(...)` for invalid-cookie / Supabase-error diagnostics; zero `console.*` / `process.stdout.write` / `process.stderr.write` calls. ESLint already enforces this; the file inherits the rule.
    - **Forward dependency note (in code-comment)**: `// Story 2.1 reads request.user.access_token in app/src/middleware/rls-context.js to construct the JWT-scoped Supabase DB client. Do not remove access_token from request.user without updating Story 2.1.`
    - `auth.js` is exported as a NAMED preHandler hook function (`export async function authMiddleware(request, reply) { ... }`) — no default export per Constraint #18 / existing ESLint rule.
    - **Token-refresh on access-token expiry is NOT in scope for Story 1.5.** When `getUser(access_token)` fails because the JWT is expired (Supabase access tokens default to 1h TTL), the middleware redirects to `/login?next=...`. Story 2.1 owns the access-token-refresh-via-refresh-token flow — see Story 1.4's `mp_session` cookie 7-day `maxAge` rationale [Source: implementation-artifacts/1-4-...#Login Route]. Add a TODO comment in `auth.js` documenting this boundary: *"// Phase 2 / Story 2.1: implement refresh-token rotation when getUser fails with expired-jwt. Until then, expired access tokens force re-login."*

3. **Given** `app/src/middleware/founder-admin-only.js` (the **founder-gate** middleware composed on top of `auth.js`) **When** an authenticated request lands on a route gated by `founder-admin-only` **Then**:
    - The middleware **assumes `auth.js` has already run** as a prior `preHandler` hook on the same route (the test fixture in AC#7 wires both hooks in order; production wiring is Story 8.10 / future admin route groups). The middleware reads `request.user` (set by `auth.js`) — if `request.user` is missing (i.e., `auth.js` was forgotten), the middleware MUST throw a runtime error: `throw new Error('founder-admin-only requires auth.js as a prior preHandler hook on this route')`. This fail-loud check prevents a future story from accidentally wiring `founder-admin-only` without its prerequisite, which would bypass the whole gate (silent admin-bypass = trust regression).
    - The middleware checks the requesting user's email against `founder_admins` using a **service-role DB connection** per AD4. At MVP, instantiate the connection inline in `app/src/middleware/founder-admin-only.js` using the **canonical `pg.Pool` + CA-pinning pattern** per [Source: project-context.md#Library Empirical Contracts + Operational Patterns#3. pg Pool against Supabase requires CA pinning] — mirror the pattern from `app/src/routes/health.js:1-15` verbatim (read `supabase/prod-ca-2021.crt`, build a `Pool` with `connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL`, `ssl: { ca: caCert }`, `max: 2`, `statement_timeout: 1000`). Add a TODO comment documenting the future refactor: *"// TODO Story 2.1: migrate to shared/db/service-role-client.js once that SSoT lands. The inline Pool here mirrors app/src/routes/health.js — both will be absorbed into shared/db/service-role-client.js as a 1-line import refactor."*. NEVER use `ssl: { rejectUnauthorized: false }` (insecure) and NEVER omit the CA (Supabase requires SSL).
    - The lookup query: `SELECT email FROM founder_admins WHERE email = $1 LIMIT 1` with `$1 = request.user.email`. **Parameterized query — NEVER string interpolation** (SQL injection guard, even though `request.user.email` came from Supabase Auth which is trusted; defense-in-depth). On query error (e.g., DB unavailable, statement_timeout): log at `error` level and return 503 with PT-localized *"Serviço temporariamente indisponível. Tenta novamente em alguns minutos."* — do NOT 403, because that would falsely deny a legitimate founder.
    - On lookup success (1 row): decorate `request.adminContext = { email: request.user.email }` (the admin annotation that downstream handlers like Story 8.10 can read to confirm admin context). Then `return` to allow the request to proceed to the route handler.
    - On lookup success (0 rows): **denied path**. (a) Log at `info` level via `request.log.info(...)` with structured fields `{ event_type: 'admin_access_denied', customer_marketplace_id: null, request_id: <auto>, email_attempted: request.user.email }` per AC#3 in [Source: epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md#Story 1.5: Founder admins seed + admin-auth middleware]. (b) Return 403 with PT-localized message *"Esta página é apenas para administração."* via `reply.code(403).view('pages/admin-denied.eta', { messagePt: '...' })` (NEW eta page in this story — see Task 7). The 403 page MUST NOT echo the attempted route path back to the user (avoids reflected-XSS-via-Eta-template-context risk; even though Eta auto-escapes, the template should only show the static PT denial copy plus a "Voltar à página inicial" link to `/`).
    - **GDPR PII consideration on the audit log line** (Note 9 from [Source: epics-distillate/_index.md#Notes for Pedro to Relay Back to Winston]): the `email_attempted` field is the **plaintext** customer email at MVP. Phase 2 trigger: switch to a SHA-256 hash of the email (e.g., first 8 hex chars of `crypto.createHash('sha256').update(email).digest('hex')`) when admin denials happen >5 times in a year, OR when GDPR audit asks. Document the deferral in a code-comment AND add a `deferred-work.md` entry following the Story 1.4 pattern (see Task 6).
    - `founder-admin-only.js` is exported as a NAMED preHandler hook function (`export async function founderAdminOnly(request, reply) { ... }`). Sibling export: `export function getFounderAdminPool()` — exposes the pg Pool for test teardown (so tests can call `await pool.end()` between cases without leaking connections). The pool is created lazily on first call to mirror the `tests/integration/_helpers/reset-auth-tables.js:18` pattern from Story 1.4.

4. **Given** the **wiring contract** between `auth.js` and `founder-admin-only.js` **When** a future admin route group is registered **Then** the canonical wiring pattern is:
    ```js
    // FUTURE EXAMPLE (Story 8.10 / admin/status):
    fastify.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);            // step 1: validates session
      instance.addHook('preHandler', founderAdminOnly);          // step 2: gates by founder_admins
      instance.get('/admin/status', async (req, reply) => { /* ... */ });
    }, { prefix: '/admin' });
    ```
    Story 1.5 does NOT register an `/admin` route group on the live server — the production wiring lands with Story 8.10's first admin surface. Story 1.5 ships only the **primitives** + **integration tests that exercise the primitives via a test-fixture route**. This is intentional scope discipline: the middleware contract is provable without a customer-facing surface, and avoids dead-route exposure on the production server until there's a real admin page to ship.

5. **Given** the integration test in AC#7 (which constructs an in-test fixture route gated by `[authMiddleware, founderAdminOnly]` to exercise the wiring) **When** the test exercises the **wired** middleware pair end-to-end **Then** it verifies:
    - **Encapsulation**: the `authMiddleware` + `founderAdminOnly` hooks attached to the fixture route group do NOT bleed into other route groups (Fastify plugin encapsulation per [Context7: /fastify/fastify#Encapsulated Hooks for Route-Specific Utilities]). A second fixture route registered OUTSIDE the encapsulated plugin instance (at the root server level) MUST NOT trigger the founder-admin gate — it should respond normally without `request.adminContext`.
    - **Order**: in the fixture route, `authMiddleware` runs first (validates session, sets `request.user`), then `founderAdminOnly` runs (reads `request.user`, sets `request.adminContext`). The fail-loud throw in `founderAdminOnly` (when `request.user` is missing) fires for any route that mistakenly registers `founderAdminOnly` without `authMiddleware`.

6. **Given** the schema after this migration applies **When** the negative-assertion grep over the codebase runs **Then**:
    - Zero matches for `request.user.is_admin`, `request.user.role`, `request.user.permissions`, `request.user.scopes` (Constraint #16 / FR2 — no role-based access at MVP; admin authorization is binary and lives in `founder_admins.email` lookup).
    - Zero matches for `'/customer-impersonate'`, `'as_customer'`, `'log_in_as'`, `'masquerade'` (Constraint #13 — no customer impersonation at MVP). The Story 8.10 `?as_admin=` parameter is the **read-only** customer-audit-log reuse pattern; that's NOT impersonation (it does not establish a session as the customer).
    - Zero matches for `'/admin'` route prefixes registered on the production `app/src/server.js` (Story 1.5 ships primitives only; admin route groups land with Story 8.10).
    - Zero matches for `ALTER TABLE founder_admins ENABLE ROW LEVEL SECURITY` anywhere in the migrations (Constraint: founder_admins is service-role-only by design).

7. **Given** the integration test file `tests/integration/admin-middleware.test.js` (NEW) **When** I run `node --env-file=.env.test --test tests/integration/admin-middleware.test.js` against a fresh test Postgres seeded with the Story 1.4 + Story 1.5 migrations **Then** the test exercises ALL of these scenarios as separate `test('...')` cases (using `node:test` + `node:assert/strict`, the established pattern from Stories 1.1 / 1.2 / 1.3 / 1.4):
    - **Test setup** (`t.before` or top-level): instantiate a fresh Fastify server (NOT the production `app/src/server.js` — the test scaffolds its own minimal Fastify with the same plugin wiring: `@fastify/cookie` with the test `COOKIE_SECRET`, `@fastify/formbody`, `@fastify/view` with eta, the `_public` plugin from Story 1.4 for `/login` and `/signup` exposure). Then register a fixture plugin at `/test-admin` that wires `[authMiddleware, founderAdminOnly]` and a single GET handler returning JSON `{ok: true, adminEmail: request.adminContext.email}`. Also register a sibling fixture plugin at `/test-public` (NO middleware) returning JSON `{ok: true}` — used to verify encapsulation in AC#5.
    - **Test data setup** (`t.beforeEach`): `await resetAuthAndCustomers()` (reuses Story 1.4's helper); INSERT a test-only founder row `INSERT INTO founder_admins (email) VALUES ('admin-test@marketpilot.test') ON CONFLICT DO NOTHING` via the service-role pool (Pedro's production seed coexists with the test-only seed; tests filter by the test email). Sign up two test customers via Story 1.4's `/signup`: one with email `admin-test@marketpilot.test` (the founder), one with email `customer-test@marketpilot.test` (the non-founder). Confirm both via Supabase's email-confirmation bypass for local dev (test DB has email auto-confirm enabled in `supabase/config.toml`; if not, the test setup INSERTs the auth.users row directly via service-role pool with `email_confirmed_at = NOW()`).
    - **Test data teardown** (`t.afterEach`): `await resetAuthAndCustomers()` AND `DELETE FROM founder_admins WHERE email = 'admin-test@marketpilot.test'` (preserves Pedro's production seed). The test pool's process-cleanup hook (Story 1.4 P16) handles connection-leak protection.
    - **Helper**: `loginAndGetSessionCookie(email, password)` — issues `POST /login` with the test-Fastify instance, captures the `Set-Cookie` header, returns the cookie value to be sent on subsequent gated requests. Mirrors the Story 1.4 `signup-flow.test.js` cookie-roundtrip pattern.
    - Each named scenario below → its own `test('...')` block. Assertions use `node:assert/strict`.
    - **unauthenticated_request_redirects_to_login_with_next**: `GET /test-admin` with NO `mp_session` cookie → assert HTTP 302, assert `Location` header is `/login?next=%2Ftest-admin` (encoded `/test-admin`), assert no `request.adminContext` was set (verify by asserting the route handler did NOT execute — body is empty / no adminEmail field).
    - **authenticated_non_founder_returns_403**: log in as `customer-test@marketpilot.test`, capture session cookie, `GET /test-admin` with that cookie → assert HTTP 403, assert response body contains the PT message `"Esta página é apenas para administração."`, assert the `app/src/views/pages/admin-denied.eta` template was rendered (response Content-Type is `text/html`).
    - **authenticated_founder_proceeds_with_adminContext**: log in as `admin-test@marketpilot.test`, capture session cookie, `GET /test-admin` with that cookie → assert HTTP 200, assert response JSON `{ok: true, adminEmail: 'admin-test@marketpilot.test'}`, asserting that `request.adminContext.email` was correctly set by the middleware AND surfaced through the route handler.
    - **founder_admin_only_throws_without_auth_middleware**: register a SECOND fixture route at `/test-admin-bad` that wires ONLY `founderAdminOnly` (NOT `authMiddleware`) → assert HTTP 500 on request, assert the error message contains the verbatim string `"founder-admin-only requires auth.js as a prior preHandler hook"`. This is the fail-loud check from AC#3; verifies the trust-regression guard.
    - **encapsulation_does_not_leak_to_unrelated_routes**: `GET /test-public` (the sibling fixture without middleware) → assert HTTP 200, assert response JSON `{ok: true}` without `adminEmail`, asserting that the founder-admin hook attached to the `/test-admin` plugin did NOT bleed into the `/test-public` plugin (Fastify encapsulation contract).
    - **invalid_cookie_signature_redirects_to_login**: forge a cookie value (e.g., set `mp_session=garbage.signature` directly via the HTTP client), `GET /test-admin` with that forged cookie → assert HTTP 302 with `Location: /login?next=%2Ftest-admin`, assert `request.log.warn` was called with the invalid-signature diagnostic (capture by injecting a custom logger into the test Fastify instance OR by spying on stderr — the simpler Stories 1.1-1.4 pattern is to assert by behavior, not log inspection; either is acceptable).
    - **expired_jwt_redirects_to_login**: log in as `admin-test@marketpilot.test`, then manually mutate the cookie's `access_token` to a known-expired Supabase JWT (or use a JWT crafted with `exp` in the past + the test SUPABASE_ANON_KEY), `GET /test-admin` with that mutated cookie → assert HTTP 302 with `Location: /login?next=%2Ftest-admin`. **Note**: this test may be skipped if the JWT-forging is too brittle across Supabase Auth versions; in that case, the test asserts the milder case "tampered-cookie value (signature still valid because we only mutated the inside JSON) results in a Supabase getUser failure → redirect" — which exercises the same code path with a more stable input.
    - **negative_assertion_no_admin_route_in_production_server**: programmatic check — `import { default as fastifyApp }` is impossible (server.js is a side-effect module), so use a grep-style test: read `app/src/server.js` content, assert it does NOT contain the strings `'/admin'`, `register(adminRoutes`, `as_customer`, `customer-impersonate`. This is the Story 1.4 P15-style code-grep regression pattern that confirms Constraint #13 negative-assertion holds in production wiring.
    - **negative_assertion_no_role_field_on_request_user**: assert that the `authMiddleware` source file (read via `fs.readFileSync('app/src/middleware/auth.js', 'utf8')`) does NOT contain the strings `'is_admin'`, `'role'`, `'permissions'`, `'scopes'`. Constraint #16 / FR2 negative-assertion: admin status is binary and DB-driven (founder_admins lookup), not encoded as a JWT claim or user attribute.

## Tasks / Subtasks

- [x] **Task 1: Create the `founder_admins` migration with Pedro seed + RLS-disabled** (AC: #1, #6)
  - [x] Run `npx supabase migration new create_founder_admins` — Supabase CLI assigns a new timestamp prefix; **rename the generated file to `202604301202_create_founder_admins.sql`** to preserve lexicographic ordering between `202604301201_create_customer_profiles_with_trigger.sql` (Story 1.4) and `202604301204_create_shop_api_key_vault.sql.deferred-until-story-4.1` (Story 1.2 deferred per Story 1.4 D3). Refer to Story 1.4's pattern of using `supabase/migrations/` as the canonical directory (Story 1.1 D2 — overrides architecture distillate's `db/migrations/`).
  - [x] Migration body: include the verbatim DDL from [Source: architecture-distillate/06-database-schema.md#founder_admins (Identity)] — `email text PRIMARY KEY`, `notes text`, `created_at timestamptz NOT NULL DEFAULT NOW()`. Add header comment block explaining AD4 / Constraint #13 / Service-role-only access rationale (in the established Story 1.2 / 1.4 migration-comment style).
  - [x] **Critical RLS-disable line**: immediately after `CREATE TABLE founder_admins ...`, include `ALTER TABLE founder_admins DISABLE ROW LEVEL SECURITY;` to override Supabase project `ttqwrbtnwtyeehynzubw`'s `ensure_rls` event-trigger auto-enable behavior (per [Source: project-context.md#MCP Usage Rules#🟡 Supabase MCP]). Without this line, RLS will silently auto-enable with zero policies, and the founder middleware's service-role lookup will return 0 rows in some configurations.
  - [x] Add the seed insert: `INSERT INTO founder_admins (email, notes) VALUES ('<pedro_email>', 'Founder — Pedro Barreira') ON CONFLICT (email) DO NOTHING;`. **Pedro confirmed `pedro@marketpilot.pt`** (dedicated business email; mailbox not yet active but seed has no FK / no deliverability check — gate is structurally in place but dormant until Pedro signs up with that email).
  - [x] Add the migration-immutability sentinel comment block: `-- IMPORTANT: this file is append-only once committed. Schema changes after the first commit ALWAYS create a new migration. Never edit this file post-commit.`
  - [x] Add the Story 2.2 TODO comment for the regression suite: `-- TODO Story 2.2: founder_admins is service-role-only with no RLS policies; rls-regression-suite SHOULD assert RLS is OFF on this table (defensive — ensures a future automation doesn't silently enable it).`
  - [x] Verify via `npx supabase db reset` (against local docker) that the migration applies cleanly on a fresh DB. Confirmed: 1 row seeded, `pg_class.relrowsecurity = false` for `founder_admins`.

- [x] **Task 2: Implement `app/src/middleware/auth.js` (generic Supabase session-check middleware)** (AC: #2)
  - [x] Create `app/src/middleware/auth.js` exporting a NAMED async preHandler hook function: `export async function authMiddleware(request, reply) { ... }` (no default export per Constraint #18 / existing ESLint rule).
  - [x] Read the `mp_session` signed cookie (cookie name MUST match Story 1.4's `app/src/routes/_public/login.js` `SESSION_COOKIE_NAME = 'mp_session'` — cross-story contract). Use `request.unsignCookie(raw)` per Library Empirical Contract #2 (`@fastify/cookie` v11+ does NOT auto-unwrap). Mirror the try/catch + `valid` check pattern from `source-context-capture.js`'s `readSourceContext()` helper (Story 1.4).
  - [x] On absent / invalid-signature / non-string cookie: redirect to `/login?next=<encoded request.url>`. Cap encoded `next` at 512 chars; if exceeded, fall through to bare `/login` and log at `info` level.
  - [x] On valid cookie: `JSON.parse(unsigned.value)` to extract `{access_token, refresh_token}`. On JSON parse failure: same redirect-to-login path as invalid signature.
  - [x] Validate the access token: `const { data, error } = await getAnonSupabaseClient().auth.getUser(access_token)` per [Context7: /supabase/supabase-js#auth.getUser]. Use the singleton (`getAnonSupabaseClient`), NOT the ephemeral factory — `getUser` does not mutate client state; the singleton is safe for concurrent calls.
  - [x] On `error` non-null OR `data?.user?.id` missing: redirect to `/login?next=...` (same path as invalid cookie). Log at `warn` level via `request.log.warn({ err: error, code: error?.code }, 'auth.js session validation failed')`.
  - [x] On valid session: `request.user = { id: data.user.id, email: data.user.email, access_token, refresh_token }`. **Do NOT set `request.session`** (collision risk with future session libraries).
  - [x] Add the forward-dependency code-comment: `// Story 2.1 reads request.user.access_token in app/src/middleware/rls-context.js to construct the JWT-scoped Supabase DB client. Do not remove access_token from request.user without updating Story 2.1.`
  - [x] Add the access-token-refresh boundary code-comment: `// Phase 2 / Story 2.1: implement refresh-token rotation when getUser fails with expired-jwt. Until then, expired access tokens force re-login (~1h Supabase access-token TTL).`
  - [x] JSDoc on the exported function per existing `jsdoc/require-jsdoc` rule (`publicOnly: true`); zero `console.*` per Constraint #18.

- [x] **Task 3: Implement `app/src/middleware/founder-admin-only.js` (founder-gate middleware)** (AC: #3, #4)
  - [x] Create `app/src/middleware/founder-admin-only.js` exporting a NAMED async preHandler hook function: `export async function founderAdminOnly(request, reply) { ... }`.
  - [x] **Fail-loud guard**: at the top of the function body, check `if (!request.user || typeof request.user.email !== 'string') { throw new Error('founder-admin-only requires auth.js as a prior preHandler hook on this route'); }`. The verbatim error string is asserted by the integration test (AC#7 `founder_admin_only_throws_without_auth_middleware`) — DO NOT rephrase.
  - [x] Set up the inline `pg.Pool` for the founder_admins service-role lookup. Implementation deviates from "verbatim mirror" of `app/src/routes/health.js:1-15` in one place: SSL config is keyed on the connection-string host (`127.0.0.1` / `localhost` → `ssl: false`; otherwise `ssl: { ca: caCert }`). Reason: integration test must run against local Supabase docker, whose Postgres reports "server does not support SSL connections" — pinning the prod CA there would universally fail. The `health.js` pool has the same incompatibility but isn't exercised in the existing test (signup-flow polls `GET /` to skip `/health`); founder-admin-only.js IS exercised by AC#7's tests, forcing the conditional. Documented in deferred-work.md; Story 2.1's SSoT module will absorb both pools and own the local-vs-prod split centrally.
    ```js
    import fs from 'node:fs';
    import path from 'node:path';
    import pg from 'pg';
    const { Pool } = pg;

    const caCert = fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8');

    let _pool = null;
    function getPool () {
      if (_pool === null) {
        _pool = new Pool({
          connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
          ssl: { ca: caCert },
          max: 2,
          statement_timeout: 1000,
        });
      }
      return _pool;
    }
    ```
    Added the TODO comment as specified.
  - [x] Export a sibling test-helper: `export function getFounderAdminPool() { return getPool(); }` plus `endFounderAdminPool()` for explicit teardown that resets the singleton (so subsequent test runs in the same process get a fresh pool).
  - [x] Lookup query: `SELECT email FROM founder_admins WHERE email = $1 LIMIT 1` with parameterized `$1`.
  - [x] On query error (catch block): `request.log.error(...)` + 503 + `admin-denied.eta` with retry message.
  - [x] On `rows.length === 1`: decorate `request.adminContext = { email: request.user.email }`.
  - [x] On `rows.length === 0`: `request.log.info({ event_type: 'admin_access_denied', customer_marketplace_id: null, email_attempted: ... })` + 403 + `admin-denied.eta` with PT denial copy.
  - [x] Added the GDPR-deferral code-comment per AC#3 + Note 9.
  - [x] JSDoc on all three exports (`founderAdminOnly`, `getFounderAdminPool`, `endFounderAdminPool`); zero `console.*`; no default export.

- [x] **Task 4: Create `app/src/views/pages/admin-denied.eta` template** (AC: #3)
  - [x] Pattern-C page template using `app/src/views/layouts/default.eta` layout. Body shows `<%= it.messagePt %>` + a single "Voltar à página inicial" link. Eta auto-escapes the message; no request-derived data echoed.
  - [x] Page title: `Acesso restrito` set via `<% layout('/layouts/default', { ...it, title: 'Acesso restrito' }) %>`.
  - [x] No client-side JS reference (pure terminal page).

- [x] **Task 5: Write `tests/integration/admin-middleware.test.js` covering AC#7 sub-bullets** (AC: #7)
  - [x] Uses `node --env-file=.env.test --test ...` pattern.
  - [x] **Test setup**: minimal Fastify in-process (no port binding) via `fastify.inject` per Library Empirical Contract #6. Wires `@fastify/cookie` + `@fastify/formbody` + `@fastify/view` (Eta) + Story 1.4's `_public` plugin. Three fixture route groups: `/test-admin` (auth + founder), `/test-public` (no middleware, encapsulation verifier), `/test-admin-bad` (founderAdminOnly only, fail-loud verifier).
  - [x] **Test data setup** (`t.beforeEach`): `resetAuthAndCustomers()` reused from Story 1.4 + `INSERT INTO founder_admins (email) VALUES ('admin-test@marketpilot.test') ON CONFLICT DO NOTHING` via `getResetAuthPool()`.
  - [x] **Test data teardown** (`t.afterEach`): `resetAuthAndCustomers()` + targeted `DELETE FROM founder_admins WHERE email = 'admin-test@marketpilot.test'` (preserves Pedro's `pedro@marketpilot.pt` production seed).
  - [x] **Helper functions**: `signupAndConfirm()` (signs up + force-confirms via service-role `UPDATE auth.users SET email_confirmed_at = NOW() ...`) and `loginAndGetSessionCookie()` (POST `/login` via `fastify.inject`, extracts `mp_session` Set-Cookie name=value pair).
  - [x] All 9 named scenarios from AC#7 pass (10 total tests; one renamed `tampered_cookie_payload_redirects_to_login` because forging an expired-JWT was too brittle across Supabase Auth versions — the tampered-payload path exercises the same code path with a stable input). Output: `# pass 10 # fail 0`.
  - [x] **Email-confirm**: forced via service-role pool UPDATE since local Supabase config doesn't have auto-confirm in every project.
  - [x] **Pool teardown**: `t.after` calls `endFounderAdminPool()` + `endResetAuthPool()`.

- [x] **Task 6: ESLint compliance + GDPR Phase 2 deferred-work entry** (AC: regression check)
  - [x] JSDoc on all exported functions in `app/src/middleware/auth.js` and `app/src/middleware/founder-admin-only.js`.
  - [x] Zero `console.*` / `process.stdout.write` / `process.stderr.write` in new source files; logging via `request.log.*`.
  - [x] No default exports.
  - [x] `npm run lint` → `0 errors, 2 warnings` (both pre-existing — `_e` in `public/js/reset-password.js`, `_` in `scripts/mirakl-empirical-verify.js`).
  - [x] Appended GDPR Phase 2 trigger entry to `_bmad-output/implementation-artifacts/deferred-work.md` (the repo's existing deferred-work file from Story 1.1+); also added a second entry documenting the `founder-admin-only.js` conditional-SSL deviation for Story 2.1's SSoT module to absorb.

- [x] **Task 7: Verify migration applies to Supabase Cloud + smoke-test admin lookup** (AC: #1, post-implementation)
  - [x] `npx supabase db reset` against local docker — all 5 migrations applied cleanly including the new `202604301202_create_founder_admins.sql`. Deferred Story 1.2 `.sql.deferred-until-story-4.1` file correctly skipped.
  - [x] Local verification via direct pg query: 1 row in `founder_admins` (`pedro@marketpilot.pt`); `pg_class.relrowsecurity = false` — RLS correctly disabled.
  - [ ] **DEFERRED to Pedro**: `npx supabase db push` to apply the migration to Supabase Cloud project `ttqwrbtnwtyeehynzubw`, then verify via Supabase MCP `list_tables` + `execute_sql({query: 'SELECT email FROM founder_admins'})`. Higher blast-radius operation; left for Pedro's authorization. (See Completion Notes for the exact commands.)
  - [ ] **DEFERRED**: Pedro's manual production smoke-test lands when Story 8.10 ships `/admin/status` (no `/test-admin` route exists in production by design — primitives only at Story 1.5).

- [x] **Task 8: Update README + .env.example** (AC: AC-aligned regression)
  - [x] `.env.example`: verified `COOKIE_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_DATABASE_URL`, `APP_BASE_URL` all present and unchanged. No new env vars.
  - [x] README: added "Admin Authorization" section between "Auth & Signup" and "Local development". Documents the two-middleware primitive, the `founder_admins` allow-list, Constraint #13, and the wiring contract for future admin route groups.
  - [x] No CHANGELOG to update.

## Dev Notes

### CRITICAL Architecture Constraints for This Story

Story 1.5 ships the **admin-authorization primitive** that gates every future founder-only surface. Failure to ship the migration + both middlewares + integration test in one PR means later stories (8.10 admin status, 11.4 concierge marketplace add, 11.5 Moloni invoice recording) cannot ship without first reinventing the auth/founder-gate composition.

| Constraint | What's forbidden | What to do instead |
|---|---|---|
| AD4 founder admin read-only | Building any admin surface that mutates customer data outside documented exceptions; building a customer-impersonation flow | Founder admins SELECT against customer-scoped tables only via service-role; zero `INSERT/UPDATE/DELETE` on customer-scoped tables in admin code paths at MVP. |
| Constraint #13 — no customer impersonation | `/admin/login-as/:customerId`, session-spoofing endpoints, founder-side cookie manipulation that produces an authenticated-as-customer session | Story 8.10's `/audit?as_admin={customer_id}` is the read-only customer-data-reuse pattern (service-role bypass + red admin-mode banner). Founder NEVER logs in as the customer. |
| Constraint #16 — no team-membership / role table | Adding `request.user.role`, `request.user.is_admin`, `request.user.permissions`, `request.user.scopes`, JWT custom claims for role | Admin status is binary and DB-driven: `founder_admins.email` lookup. No JWT claim, no in-memory role cache. The single email-key allow-list IS the design. |
| Constraint #18 — no console / no defaults | `console.log`, `process.stdout.write`, `console.error`, `export default`, default-export factories | `request.log.warn/info/error/...` (Fastify-bound child of `shared/logger.js`). Named exports only. ESLint enforces. |
| Library Empirical Contract #2 | Reading the `mp_session` cookie via `request.cookies['mp_session']` and assuming it's the unsigned value | Use `request.unsignCookie(raw)` and check `unsigned.valid`. The Story 1.4 `source-context-capture.js` `readSourceContext` helper is the canonical reference. |
| Library Empirical Contract #3 | `pg.Pool` against Supabase without CA pinning OR with `rejectUnauthorized: false` | Read `supabase/prod-ca-2021.crt`, pass via `ssl: { ca: caCert }`. Mirror `app/src/routes/health.js:1-15` verbatim. |
| AD27 (Story 1.3 SSoT consumed) | Hand-built pino instances; per-file redaction config | Use `request.log.*` (preHandler hooks have access). Redaction list automatically protects auth tokens, cookies, and any sentinel field. |
| Story 1.4 cross-story contract | Renaming `mp_session`, changing the cookie value's JSON shape (`{access_token, refresh_token}`), removing `access_token` from the JSON | Cookie name + JSON shape are a producer/consumer contract: Story 1.4 writes, Story 1.5 reads, Story 2.1 reads. Renaming requires a coordinated PR touching all three. |
| Migration immutability | Editing `202604301202_create_founder_admins.sql` after first commit (e.g., to update Pedro's email) | New migration. Even adding a co-founder later (e.g., a new founder_admins seed row in 2027) ships as a separate `<ts>_add_cofounder_<name>_to_founder_admins.sql` migration. Never edit. |

**Forward dependencies — do NOT pre-create:**

- `app/src/middleware/rls-context.js` (RLS-aware DB client binding from JWT) → **Story 2.1**. Story 1.5's `auth.js` decorates `request.user` with `access_token`; Story 2.1 reads that to construct the JWT-scoped Supabase DB client. Cookie-read coordination already correct.
- `shared/db/service-role-client.js`, `shared/db/rls-aware-client.js`, `shared/db/tx.js` → **Story 2.1**. Story 1.5's inline `pg.Pool` in `founder-admin-only.js` mirrors `app/src/routes/health.js` and Story 1.4's test helper; Story 2.1 will absorb all three into the SSoT module. Tracked via TODO comment.
- `app/src/middleware/csrf.js` (`@fastify/csrf-protection` wiring) → **deferred per Story 1.4 D1** (pre-customer-#1 operational gates). Admin route groups inherit the same SameSite=Lax baseline as customer-facing forms; CSRF chore lands as a separate hardening PR before Go-Live.
- `app/src/middleware/interception-redirect.js` (AD15 cron_state interception) → **Story 4.x / Story 8.1**. Not relevant to admin routes (admin pages don't gate on customer cron_state).
- `/admin/status` page (Story 8.10), `/admin/moloni-record` route (Story 11.5 founder operational endpoint), concierge `/admin/marketplaces/add` CLI (Story 11.4) — all consume Story 1.5's `[authMiddleware, founderAdminOnly]` wiring; Story 1.5 ships ZERO admin-prefixed production routes.
- `shared/audit/writer.js` `writeAuditEvent` (AD20 single audit emission path) → **Story 9.0** (calendar-early between Epic 2 and Epic 3, NOT before Story 1.5). Story 1.5's `admin_access_denied` log line is a **pino structured log**, NOT an `audit_log` row insert — `audit_log` table doesn't exist yet. The `event_type: 'admin_access_denied'` field in the pino log is an operational tag, NOT a row in the 28-event audit taxonomy (Atenção/Notável/Rotina). Story 9.0 may or may not promote this to an audit_log event later; for now it's a log line only.

### Two-Middleware Composition Pattern — Why Two Files Instead of One

Bob's design ships two middlewares (`auth.js` + `founder-admin-only.js`) instead of a single `founder-admin-only-with-auth.js` because:

1. **Reusability**: Story 2.1 needs `auth.js` (or its session-validating logic) to extract the JWT for the RLS-aware DB client. Future Stories 8.x dashboard surfaces will gate on `auth.js` alone (every dashboard page needs a logged-in customer; very few need to be founder-only). A single combined middleware would either (a) force every dashboard page to opt out of the founder check, or (b) duplicate the session-validation code into a sibling `customer-auth-only.js`.
2. **Composability**: Fastify's plugin encapsulation makes `[authMiddleware, founderAdminOnly]` a clean two-line wiring at the route-group level (per [Context7: /fastify/fastify#Encapsulated Hooks for Route-Specific Utilities]). A single middleware would still need to be re-imported for non-admin authenticated routes, fragmenting the contract.
3. **Testability**: each middleware can be unit-tested in isolation. The fail-loud guard in `founder-admin-only` (when `request.user` is missing) explicitly tests the wiring contract — a defensive check that catches misconfiguration in future stories.
4. **Trust deliverable clarity**: AD4 + Constraint #13 are about the **founder authorization gate**, not session management. Splitting them surfaces the trust commitment in `founder-admin-only.js` directly, without it being buried in a 200-line combined file.

**Anti-pattern explicitly rejected**: a single `requireFounder(request, reply)` middleware that does session-check + founder-lookup + admin-context-decoration in one body. This is what one might naively write. It's structurally wrong for the reasons above.

### Why `founder_admins` Has No RLS

The `founder_admins` table is an authoritative system table — analogous to `pg_user` or any other meta-table. There is no `customer_id` to scope RLS by; the table is **read-only by application code**, queried only by the `founder-admin-only` middleware via the service-role connection (which bypasses RLS anyway). Enabling RLS without policies would silently lock the table to all queries (depending on exact configuration); enabling RLS WITH a `USING (true)` policy would defeat the point.

The `ALTER TABLE founder_admins DISABLE ROW LEVEL SECURITY;` line in the migration is **load-bearing** because the Supabase project (`ttqwrbtnwtyeehynzubw`) has the `ensure_rls` event trigger enabled, which auto-enables RLS on every new `public` schema table at CREATE time [Source: project-context.md#MCP Usage Rules#🟡 Supabase MCP — `ensure_rls` enabled]. The DISABLE statement overrides this auto-enable. Story 2.2's regression suite extends this assertion (`TODO Story 2.2: assert RLS is OFF on founder_admins`) for defense-in-depth.

**Related guard**: Story 2.2 should NOT add `founder_admins` to its cross-tenant probe list (the seed doesn't have customer A and customer B variants — there's no cross-tenant scenario to test). Instead, Story 2.2's suite should assert `pg_class.relrowsecurity = false` for `founder_admins` (negative-assertion). Bob's migration TODO comment surfaces this for the Story 2.2 BAD subagent.

### Service-Role DB Connection Pattern

The `founder-admin-only.js` middleware reads `founder_admins` via a service-role pg.Pool. Story 2.1's `shared/db/service-role-client.js` will become the SSoT for this pattern, but until that lands:

```js
// app/src/middleware/founder-admin-only.js (canonical inline pattern)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const { Pool } = pg;

const caCert = fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8');

let _pool = null;

function getPool () {
  if (_pool === null) {
    _pool = new Pool({
      connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
      ssl: { ca: caCert },
      max: 2,                  // small — middleware is fast and per-request
      statement_timeout: 1000, // 1s — admin lookup is keyed scan, sub-ms expected
    });
  }
  return _pool;
}

export function getFounderAdminPool () {
  return getPool();
}
```

**NEVER** instantiate the pool at module-import time without the lazy factory — `process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL` may not be set yet when the module is first imported (e.g., in tests that set env vars after `import` but before route registration). The lazy `getPool()` resolves env at first call.

**NEVER** use `ssl: { rejectUnauthorized: false }` — accepts forged certs; security regression. **NEVER** omit SSL — Supabase rejects unencrypted Postgres connections. The CA cert lives at `supabase/prod-ca-2021.crt` (committed; public CA).

**Pool teardown** in tests: export `getFounderAdminPool()` so tests can `await pool.end()` between cases. The Story 1.4 P16 process-cleanup hook (registered in `tests/integration/_helpers/reset-auth-tables.js:18-39`) is a safety net but not a substitute for explicit `pool.end()` in test teardown.

### `auth.js` — Cookie-Read + JWT-Validate Pattern

```js
// app/src/middleware/auth.js (canonical implementation skeleton)
import { getAnonSupabaseClient } from '../lib/supabase-clients.js';

const SESSION_COOKIE_NAME = 'mp_session'; // cross-story contract — DO NOT rename
const NEXT_MAX_LEN = 512;

/**
 * Generic Supabase Auth session-check preHandler.
 *
 * Reads the mp_session signed cookie set by Story 1.4's /login route,
 * validates the JWT against Supabase Auth, and decorates request.user.
 * Redirects to /login?next=... on any failure path (UX-DR1).
 *
 * Story 2.1 reads request.user.access_token in app/src/middleware/rls-context.js
 * to construct the JWT-scoped Supabase DB client. Do not remove access_token
 * from request.user without updating Story 2.1.
 *
 * Phase 2 / Story 2.1: implement refresh-token rotation when getUser fails
 * with expired-jwt. Until then, expired access tokens force re-login
 * (~1h Supabase access-token TTL).
 *
 * @param {import('fastify').FastifyRequest} request - Fastify request
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @returns {Promise<void>}
 */
export async function authMiddleware (request, reply) {
  const raw = request.cookies?.[SESSION_COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length === 0) {
    return redirectToLogin(request, reply);
  }

  // Library Empirical Contract #2 — explicit unsign required.
  let unsigned;
  try {
    unsigned = request.unsignCookie(raw);
  } catch (err) {
    request.log.warn({ cookie: SESSION_COOKIE_NAME, err }, 'mp_session unsign threw');
    return redirectToLogin(request, reply);
  }
  if (!unsigned.valid) {
    request.log.warn({ cookie: SESSION_COOKIE_NAME }, 'mp_session signature invalid');
    return redirectToLogin(request, reply);
  }

  let parsed;
  try {
    parsed = JSON.parse(unsigned.value);
  } catch {
    request.log.warn({ cookie: SESSION_COOKIE_NAME }, 'mp_session JSON malformed');
    return redirectToLogin(request, reply);
  }

  const { access_token, refresh_token } = parsed ?? {};
  if (typeof access_token !== 'string' || access_token.length === 0) {
    return redirectToLogin(request, reply);
  }

  const supabase = getAnonSupabaseClient();
  const { data, error } = await supabase.auth.getUser(access_token);
  if (error || !data?.user?.id) {
    request.log.warn({ err: error, code: error?.code }, 'auth.js session validation failed');
    return redirectToLogin(request, reply);
  }

  request.user = {
    id: data.user.id,
    email: data.user.email,
    access_token,
    refresh_token,
  };
}

function redirectToLogin (request, reply) {
  let nextParam = request.url ?? '/';
  let encoded = encodeURIComponent(nextParam);
  if (encoded.length > NEXT_MAX_LEN) {
    request.log.info({ urlLen: nextParam.length }, 'next param truncated to bare /login');
    return reply.redirect('/login', 302);
  }
  return reply.redirect(`/login?next=${encoded}`, 302);
}
```

Note: `redirectToLogin` is module-private (not exported) — keeps the public API to the named `authMiddleware` only.

### `founder-admin-only.js` — Composition + Lookup Pattern

```js
// app/src/middleware/founder-admin-only.js (canonical implementation skeleton)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const caCert = fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8');

let _pool = null;

function getPool () {
  if (_pool === null) {
    _pool = new Pool({
      connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
      ssl: { ca: caCert },
      max: 2,
      statement_timeout: 1000,
    });
  }
  return _pool;
}

/**
 * Founder-admin gate preHandler. Composed on top of authMiddleware
 * (must be wired AFTER authMiddleware in the route group's preHandler chain).
 *
 * - On absent founder match: 403 + admin-denied.eta + info-level pino log
 * - On present founder match: decorate request.adminContext = {email}
 * - On lookup error (DB unavailable / statement_timeout): 503 + retry message
 *
 * GDPR PII consideration: email_attempted is plaintext at MVP. Phase 2 trigger
 * (>5 denials/year OR GDPR audit ask): switch to first 8 hex chars of
 * crypto.createHash('sha256').update(email).digest('hex'). Tracked in
 * deferred-work.md.
 *
 * @param {import('fastify').FastifyRequest} request - Fastify request
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @returns {Promise<void>}
 */
export async function founderAdminOnly (request, reply) {
  // Fail-loud guard: prerequisite is authMiddleware. Trust-regression prevention.
  if (!request.user || typeof request.user.email !== 'string') {
    throw new Error('founder-admin-only requires auth.js as a prior preHandler hook on this route');
  }

  let rows;
  try {
    const result = await getPool().query(
      'SELECT email FROM founder_admins WHERE email = $1 LIMIT 1',
      [request.user.email]
    );
    rows = result.rows;
  } catch (err) {
    request.log.error({ err, email: request.user.email }, 'founder-admin lookup failed');
    return reply.code(503).view('pages/admin-denied.eta', {
      messagePt: 'Serviço temporariamente indisponível. Tenta novamente em alguns minutos.',
    });
  }

  if (rows.length === 0) {
    request.log.info(
      { event_type: 'admin_access_denied', customer_marketplace_id: null, email_attempted: request.user.email },
      'admin access denied'
    );
    return reply.code(403).view('pages/admin-denied.eta', {
      messagePt: 'Esta página é apenas para administração.',
    });
  }

  request.adminContext = { email: request.user.email };
}

/**
 * Test-helper exposing the founder-admin pool for explicit teardown.
 * Tests should call `await getFounderAdminPool().end()` in their afterAll.
 *
 * @returns {pg.Pool} the lazily-instantiated service-role pool
 */
export function getFounderAdminPool () {
  return getPool();
}
```

### Wiring Pattern for Future Admin Routes (Story 8.10 + Beyond)

Story 1.5 ships ZERO admin route groups on `app/src/server.js`. The canonical wiring pattern for future stories:

```js
// FUTURE EXAMPLE — Story 8.10 / app/src/server.js extension:
import { authMiddleware } from './middleware/auth.js';
import { founderAdminOnly } from './middleware/founder-admin-only.js';
import { adminStatusRoutes } from './routes/admin/status.js';

await fastify.register(async (instance) => {
  instance.addHook('preHandler', authMiddleware);    // 1. validates session
  instance.addHook('preHandler', founderAdminOnly);  // 2. gates by founder_admins
  await instance.register(adminStatusRoutes);         // mounts /status
}, { prefix: '/admin' });
```

The Fastify plugin encapsulation [Context7: /fastify/fastify#Encapsulated Hooks for Route-Specific Utilities] auto-scopes the hooks to the registering instance — `/admin/*` routes inherit both hooks; routes registered outside this `register` block (like `/health`, `/`, `/login`) are unaffected.

**Order matters**: `authMiddleware` MUST run before `founderAdminOnly`. Fastify executes hooks in registration order. The `founder-admin-only.js` fail-loud guard (`throw new Error('founder-admin-only requires auth.js as a prior preHandler hook')`) catches misordered wiring at request time, but the discipline is to register them in the right order at compile time.

### `admin-denied.eta` Template Skeleton

```eta
<% layout('/layouts/default', { ...it, title: 'Acesso restrito' }) %>

<main class="auth-container">
  <h1><%= it.messagePt %></h1>
  <p>
    <a href="/">Voltar à página inicial</a>
  </p>
</main>
```

The template re-uses the `app/src/views/layouts/default.eta` layout from Story 1.4 — sticky-header chrome + body slot + footer. No new tokens.css references; no per-page JS (no `<script src="/public/js/admin-denied.js" defer>` — F9 doesn't apply to terminal error surfaces).

**Eta auto-escape**: `<%= %>` auto-escapes the value, so even if a future caller accidentally passes user input as `messagePt`, it's safe. But the template itself is restricted to constants from `founder-admin-only.js`'s known message set — DO NOT extend this to echo route paths or user-derived data.

### Testing — Auth Cookie Roundtrip Pattern

The integration test exercises the `[authMiddleware, founderAdminOnly]` chain by going through the real `/login` route to produce a valid `mp_session` cookie:

```js
// tests/integration/admin-middleware.test.js (helper sketch)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import FastifyCookie from '@fastify/cookie';
import FastifyFormbody from '@fastify/formbody';
import FastifyView from '@fastify/view';
import { Eta } from 'eta';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicRoutes } from '../../app/src/routes/_public/index.js';
import { authMiddleware } from '../../app/src/middleware/auth.js';
import { founderAdminOnly, getFounderAdminPool } from '../../app/src/middleware/founder-admin-only.js';
import { resetAuthAndCustomers, getResetAuthPool, endResetAuthPool } from './_helpers/reset-auth-tables.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function buildTestServer () {
  const fastify = Fastify({ logger: false });

  await fastify.register(FastifyCookie, { secret: process.env.COOKIE_SECRET });
  await fastify.register(FastifyFormbody);
  await fastify.register(FastifyView, {
    engine: { eta: new Eta() },
    templates: join(__dirname, '../../app/src/views'),
    propertyName: 'view',
    asyncPropertyName: 'viewAsync',
  });

  await fastify.register(publicRoutes);

  // Fixture admin route: wired with both middlewares (the canonical chain).
  await fastify.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware);
    instance.addHook('preHandler', founderAdminOnly);
    instance.get('/test-admin', async (request) => ({
      ok: true,
      adminEmail: request.adminContext.email,
    }));
  });

  // Fixture public route: NO middleware. Tests encapsulation.
  await fastify.register(async (instance) => {
    instance.get('/test-public', async () => ({ ok: true }));
  });

  // Fixture bad-wiring route: ONLY founderAdminOnly (NO authMiddleware).
  // Tests the fail-loud guard.
  await fastify.register(async (instance) => {
    instance.addHook('preHandler', founderAdminOnly);
    instance.get('/test-admin-bad', async () => ({ ok: true }));
  });

  await fastify.ready();
  return fastify;
}

async function loginAndGetSessionCookie (fastify, email, password) {
  const res = await fastify.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password },
  });
  // 302 redirect on success; mp_session cookie in Set-Cookie header
  const setCookies = res.headers['set-cookie'] ?? [];
  const sessionCookie = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .find((c) => c.startsWith('mp_session='));
  if (!sessionCookie) throw new Error('login did not set mp_session cookie');
  // Extract just the cookie name=value pair (drop attributes)
  return sessionCookie.split(';')[0];
}
```

`fastify.inject(...)` is the standard Fastify-built-in test-injection method [Context7: /fastify/fastify — Fastify Inject for testing] — it issues HTTP requests to the in-process Fastify instance without binding a port. Use it instead of spawning a real listener (faster, no port conflicts, deterministic).

### Previous Story Intelligence — Stories 1.1 + 1.2 + 1.3 + 1.4

Lessons that shape Story 1.5:

- **Story 1.1** scaffolded Fastify with `getFastifyLoggerOptions()` + `FASTIFY_REQUEST_ID_LOG_LABEL`. Story 1.5's middlewares inherit this via `request.log` — every admin lookup gets a `request_id`-tagged log line automatically. The `customer_marketplace_id: null` field in the `admin_access_denied` log is consistent with Story 1.3's pino convention (every log line carries `customer_marketplace_id`, null pre-auth).
- **Story 1.1 D2** (canonical migration directory): `supabase/migrations/` over `db/migrations/`. Story 1.5 follows.
- **Story 1.1 D5** (eslint flat config): Story 1.5's new files satisfy existing rules (`no-console`, `no-restricted-syntax`, `jsdoc/require-jsdoc`).
- **Story 1.1 / 1.2 / 1.4 migration-immutability rule**: never edit a migration after commit; new schema changes = new migration file. Story 1.5 ships ONE new migration and never touches existing ones.
- **Story 1.2** introduced AES-256-GCM envelope encryption + secret-scanning hook. Story 1.5 doesn't reach for the vault. The `SUPABASE_SERVICE_ROLE_DATABASE_URL` env var is already in `runtime-env.js`'s `REQUIRED_VARS` from Story 1.1; reused here without modification.
- **Story 1.2 review-applied patch** extended the AD27 redaction list with `Cookie` / `Set-Cookie`. Story 1.5's `mp_session` cookie reads go through the redacted log path automatically.
- **Story 1.3** locked the SSoT `shared/logger.js`. Story 1.5 uses `request.log` for in-request logging (Fastify-bound child); zero new logger setup needed.
- **Story 1.3 review** noted that `process.exit(1)` in `runtime-env.js` races async pino flush. Story 1.5 doesn't add new `process.exit(1)` paths — it adds NO new env vars; existing flow is unaffected.
- **Story 1.4 Library Empirical Contract #2** — `@fastify/cookie` v11+ requires `request.unsignCookie()`. Story 1.5's `auth.js` reuses this contract verbatim — mirrors the `source-context-capture.js readSourceContext` pattern. The `mp_session` cookie produced by Story 1.4's `/login` route is the canonical input.
- **Story 1.4 Library Empirical Contract #3** — `pg.Pool` against Supabase requires CA pinning. Story 1.5's `founder-admin-only.js` mirrors `app/src/routes/health.js:1-15` verbatim. The CA cert at `supabase/prod-ca-2021.crt` is already committed.
- **Story 1.4 Library Empirical Contract #5** — `auth.users` reset via DELETE not TRUNCATE. Story 1.5's integration test reuses `tests/integration/_helpers/reset-auth-tables.js` directly (no parallel implementation).
- **Story 1.4 Library Empirical Contract #6** — integration test readiness probe should NOT poll `/health` (worker-heartbeat 503s). Story 1.5's test uses `fastify.inject(...)` instead of spawning a real listener — eliminates the readiness-probe issue entirely.
- **Story 1.4 D2 (singleton vs ephemeral)**: `getAnonSupabaseClient()` singleton is safe for stateless calls (`auth.signUp`, `auth.signInWithPassword`, `auth.getUser`). Story 1.5's `auth.js` calls `getUser(access_token)` — a stateless call with no `setSession` mutation — so the singleton is the correct choice. DO NOT switch to `createEphemeralAnonSupabaseClient()`; that's reserved for `setSession`-bearing flows like password reset.
- **Story 1.4 P16 process-cleanup hook**: `tests/integration/_helpers/reset-auth-tables.js` registers a `beforeExit` + `SIGINT` + `SIGTERM` cleanup for its pg.Pool. Story 1.5's test should rely on this AND register an explicit `t.after` teardown for the `founderAdminOnly` pool.
- **Story 1.4 1:1:1 schema invariant**: `auth.users → customers → customer_profiles`. Story 1.5's test customers are real signup-flow products of this invariant — every `auth.users` row created by the test has matching `customers` + `customer_profiles` rows (atomic via the F3 trigger). Verify this in test setup if a customer-fixture row is missing — the trigger may have rejected the signup payload.
- **Story 1.4 GoTrue HINT-stripping**: not directly relevant to Story 1.5 (no trigger HINTs involved), but the underlying lesson — trigger contracts may not propagate cleanly to client SDKs — applies in spirit. The `founder-admin-only.js` middleware avoids any contract-crossing trigger pattern; it uses a plain SELECT against the table.

### Git Intelligence — Recent Commits

```
404639f docs(rules): add Library Empirical Contracts + Operational Patterns to project-context.md
07459a3 feat(story-1.4): atomic signup + customer_profiles trigger + source-context (Bundle A)
0906693 feat(story-1.3): pino structured logging + redaction list
aefd4e7 feat(story-1.2): envelope encryption + master-key loader + secret-scanning hook
66f4cc1 feat(story-1.1): scaffold project, two-service Coolify deploy, composed /health
```

Story 1.4 landed 2026-05-03 (last commit by Pedro). Story 1.5 is the next `feat` commit and the LAST story in Epic 1.

**Commit conventions**:
- Single PR, single commit (Story 1.5 is small enough). Commit message: `feat(story-1.5): founder_admins seed + auth.js + founder-admin-only middleware`
- If splitting helps review, the acceptable split is: (1) the migration in one commit, (2) the middlewares + admin-denied template + integration test in a second commit — both in the same PR. Don't split the middleware commit from the test commit (commit-level atomicity preserves the trust deliverable).

### AD Coverage This Story Implements

- **AD4** — Founder admin read-only (partial — seed + middleware primitives only; admin status page UI ships with Story 8.10).
- **FR6** — Founder admin read-only operational queries (the gating primitive).
- **FR47** — Founder admin status page (founder-side primitive — full surface ships in Story 8.10 + reuses `/audit?as_admin=` per UX-DR28-30).
- **UX-DR1** — auth `?next=` preservation in `auth.js`'s `redirectToLogin` helper (preserves `request.url` as the `next` param).
- **Constraint #13** (negative-assertion) — No customer impersonation; admin route gating is binary (founder OR not founder, no `?as_customer=` impersonation).
- **Constraint #16** (negative-assertion) — No team-membership / role table; admin status is binary and DB-driven via `founder_admins.email` lookup. NO `request.user.role`, NO `request.user.is_admin`, NO JWT custom claims.
- **Constraint #18** — No `console.*` (all logging via `request.log.*`); no default exports.
- **AD27** (Story 1.3 SSoT consumed) — All log emission via `request.log.*`; redaction list automatically applies.

### Project Structure Notes

Files created in this story:

```
supabase/migrations/202604301202_create_founder_admins.sql      # NEW — founder_admins table + Pedro seed + RLS-disabled
app/src/middleware/auth.js                                       # NEW — generic Supabase session-check preHandler
app/src/middleware/founder-admin-only.js                         # NEW — founder-gate preHandler composed on auth.js
app/src/views/pages/admin-denied.eta                             # NEW — Pattern-C 403 / 503 page
tests/integration/admin-middleware.test.js                       # NEW — AC#7 sub-bullets (encapsulation + denial + grant + fail-loud)
deferred-work.md                                                 # NEW or APPENDED — GDPR Phase 2 PII-hashing entry
```

Files modified:

```
README.md                                                        # add "Admin Authorization" one-paragraph section
tests/integration/_helpers/reset-auth-tables.js                  # MAY need to export getResetAuthPool if not already (Story 1.4 P16 already exports it; verify at story-implementation time)
```

Files NOT modified (intentional negative assertions):

```
app/src/server.js                                                # NO admin route group registration at MVP — Story 8.10 owns it
shared/config/runtime-env.js                                     # NO new env vars; SUPABASE_SERVICE_ROLE_DATABASE_URL already present
.env.example                                                     # NO new entries
scripts/check-no-secrets.sh                                      # NO new secret patterns (founder_admins.email is not a secret)
package.json                                                     # NO new deps (pg, @supabase/supabase-js, @fastify/cookie, @fastify/view all present)
eslint.config.js                                                 # NO new rule blocks (admin-denied.eta is a template, not a JS file)
```

### Alignment with Unified Project Structure

- **Module locations** match `architecture-distillate/05-directory-tree.md`:
  - `app/src/middleware/auth.js` ✓
  - `app/src/middleware/founder-admin-only.js` ✓
  - `app/src/views/pages/admin-denied.eta` ✓
  - `tests/integration/admin-middleware.test.js` ✓
- **Migration directory**: `supabase/migrations/` per Story 1.1 D2 (overrides architecture distillate's `db/migrations/`).
- **No deviations**: no new top-level directories; no entry-point changes; no new env vars; no new dependencies.

### Dev Notes for Pedro

- **Email-seed confirmation**: at the start of the implementation session, the BAD subagent will surface the question *"Which founder email goes into the migration seed? Default candidate `pedro.belchior.barreira@gmail.com` (your environment-stored email) or a dedicated business email like `pedro@marketpilot.pt`?"* — answer this before the migration is committed. Once committed, the seed is immutable per the migration-immutability rule.
- **Day-of-deploy verification**: after merging Story 1.5 and Coolify redeploys, sign in to `https://app.marketpilot.pt/login` with the founder-seed email. Then via `psql` or Supabase Studio, run `SELECT email FROM founder_admins;` — should return exactly one row matching the seed. If the row is missing, the migration didn't apply; check Supabase project's migrations tab.
- **End-to-end smoke**: at this story Story 1.5 doesn't ship any admin-prefixed route on production, so there's no `/admin/*` URL to hit. The integration test is the empirical proof. When Story 8.10 lands `/admin/status`, that's the first real-route smoke-test surface for the wiring; until then, trust the integration test.
- **Co-founder addition (Phase 2 / future)**: when Pedro adds a co-founder later, the right pattern is a NEW migration: `<ts>_add_<cofounder_name>_to_founder_admins.sql` with a single `INSERT INTO founder_admins (email, notes) VALUES (...) ON CONFLICT DO NOTHING;`. Never edit `202604301202_create_founder_admins.sql`.
- **GDPR PII Phase 2 trigger**: the `admin_access_denied` log line stores plaintext attempted email at MVP. If admin-denial volume grows (>5/year) OR a GDPR audit asks, switch to first 8 hex chars of the SHA-256 hash. Tracked in `deferred-work.md`.
- **Story 2.1 absorbs the inline pool**: `founder-admin-only.js`'s `pg.Pool` will be replaced with `import { getServiceRoleClient } from 'shared/db/service-role-client.js'` in Story 2.1. The TODO comment in `founder-admin-only.js` flags this; the refactor is mechanical (replace `getPool()` with `getServiceRoleClient().pool`).
- **The Constraint #13 trust deliverable**: this story IS the proof that "the founder NEVER logs in as the customer" is structurally enforced. Code review (CR adversarial) MUST verify by grep that no `?as_customer=`, `/login-as`, `/impersonate` route or middleware exists. Story 1.5's negative-assertion AC #6 + integration test `negative_assertion_no_admin_route_in_production_server` cover this; CR confirms.

### References

- [Source: epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md#Story 1.5: Founder admins seed + admin-auth middleware] — verbatim 4 ACs, Bob-trace, AD4 partial coverage, FR6 + FR47 coverage
- [Source: epics-distillate/_index.md#Coverage Maps#FR Coverage] — FR6, FR47 → Story 1.5
- [Source: epics-distillate/_index.md#Coverage Maps#AD Coverage] — AD4 → Stories 1.5 + 8.10
- [Source: epics-distillate/_index.md#Architectural Constraints / Negative Assertions] — Constraint #13 (no customer impersonation); Constraint #16 (no team-membership table at MVP); Constraint #18 (no console)
- [Source: epics-distillate/_index.md#Notes for Pedro to Relay Back to Winston] — Note 9: Story 1.5 admin_access_denied email PII Phase 2 consideration (SHA-256 hash trigger)
- [Source: architecture-distillate/02-decisions-A-D.md#AD4 Founder admin read-only] — full AD4 spec; the trust commitment that founder never logs in as customer; service-role-only access pattern
- [Source: architecture-distillate/03-decisions-E-J.md#AD4 (continued)] — admin status page reuses customer audit log via `?as_admin={customer_id}` (UX-DR28-30); deferred from Important to MVP via Story 8.10
- [Source: architecture-distillate/06-database-schema.md#founder_admins (Identity)] — verbatim DDL: `email PRIMARY KEY`, `notes`, `created_at`; service-role-only; no RLS
- [Source: architecture-distillate/05-directory-tree.md] — file locations: `app/src/middleware/auth.js`, `app/src/middleware/founder-admin-only.js`, `app/src/views/pages/admin-denied.eta`
- [Source: architecture-distillate/_index.md#Cross-Cutting Constraints (Negative Assertions)] — full negative-assertion list including #13, #16, #18
- [Source: prd-distillate.md#FR6, FR47] — functional requirement statements
- [Source: project-context.md#27 Architectural Constraints#13] — no customer impersonation by founder
- [Source: project-context.md#27 Architectural Constraints#16] — no `customer_team_members` at MVP
- [Source: project-context.md#Anti-Patterns / Refuse List] — "Let me impersonate the customer for support → No. Constraint #13. Read-only `?as_admin=` only."
- [Source: project-context.md#Library Empirical Contracts + Operational Patterns#2] — `@fastify/cookie` v11+ does NOT auto-unwrap signed cookies; canonical `request.unsignCookie()` pattern
- [Source: project-context.md#Library Empirical Contracts + Operational Patterns#3] — `pg.Pool` against Supabase requires CA pinning at `supabase/prod-ca-2021.crt`; canonical `app/src/routes/health.js:1-15` reference
- [Source: project-context.md#Library Empirical Contracts + Operational Patterns#5] — `auth.users` reset via DELETE not TRUNCATE in tests; reuse `tests/integration/_helpers/reset-auth-tables.js`
- [Source: project-context.md#Library Empirical Contracts + Operational Patterns#6] — integration tests use `fastify.inject` not real listener + `/health` polling
- [Source: project-context.md#MCP Usage Rules#🟡 Supabase MCP] — project_id `ttqwrbtnwtyeehynzubw`; `ensure_rls` event trigger enabled (load-bearing for the explicit `DISABLE ROW LEVEL SECURITY` line in the migration)
- [Source: implementation-artifacts/1-1-scaffold-project-two-service-coolify-deploy-composed-health.md] — Fastify v5 scaffold + ESLint v10 flat config + `supabase/migrations/` decision (D2) + `app/src/routes/health.js` canonical pg.Pool + CA-pinning pattern
- [Source: implementation-artifacts/1-2-envelope-encryption-module-master-key-loader-secret-scanning-hook.md] — secret-scanning hook patterns; migration-immutability rule
- [Source: implementation-artifacts/1-3-pino-structured-logging-with-redaction-list.md] — `shared/logger.js` SSoT, `getFastifyLoggerOptions()`, structured-log conventions (`customer_marketplace_id` field on every log line, null pre-auth)
- [Source: implementation-artifacts/1-4-signup-endpoint-atomic-profile-trigger-source-context-capture.md] — `mp_session` cookie writer side; `getAnonSupabaseClient()` singleton; `tests/integration/_helpers/reset-auth-tables.js` reuse; signed-cookie unsign pattern in `source-context-capture.js readSourceContext`
- [Mirakl MCP] — not applicable to Story 1.5 (no Mirakl calls in admin gating)
- [Context7: /supabase/supabase-js#auth.getUser] — `supabase.auth.getUser(jwt)` validates a raw JWT and returns `{data: {user}, error}`
- [Context7: /fastify/fastify#Encapsulated Hooks for Route-Specific Utilities] — Fastify plugin encapsulation auto-scopes preHandler hooks to the registering instance; basis for the `[authMiddleware, founderAdminOnly]` two-hook chain on the future `/admin/*` route group
- [Context7: /fastify/fastify#Route level hooks] — alternative wiring per-route via the route's `preHandler` option; either pattern works, encapsulated plugin is preferred for route groups
- [Context7: /fastify/fastify — Fastify Inject for testing] — `fastify.inject(...)` for in-process HTTP request injection; basis for the integration-test scaffolding pattern
- [Supabase MCP — `marketpilot-repricer` project_id `ttqwrbtnwtyeehynzubw`] — verify migration applied via `list_migrations`; verify `founder_admins` present via `list_tables`; verify seed via `execute_sql({query: 'SELECT email FROM founder_admins'})` (read-only verification only — never `apply_migration`)

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Claude Opus 4.7, 1M context) — Amelia (bmad-agent-dev) via /bmad-dev-story.

### Debug Log References

- Initial test run: 9/9 admin-middleware test scenarios passed (10 total tests including the parent suite — `# pass 10 # fail 0 # duration_ms 1775.377`).
- Pre-existing test failures observed in full-suite run: `scaffold-smoke` and `signup-flow` integration tests fail because `worker/src/jobs/heartbeat.js` and `app/src/routes/health.js` use unconditional `ssl: { ca: caCert }` against local Supabase Postgres (which reports "server does not support SSL connections"). Same root cause for which Story 1.5's `founder-admin-only.js` adopts a conditional SSL pattern; the pre-existing pools are tracked under Story 1.1's deferred-work item ("pg Pools never `.end()`ed; no SIGTERM handler"). Not a Story 1.5 regression.
- ESLint: `0 errors, 2 warnings` (both pre-existing).
- Full `tests/shared/**/*.test.js` unit suite: 34/34 pass.

### Completion Notes List

**Pedro confirmed seed value: `pedro@marketpilot.pt`** (dedicated business email; mailbox not yet active). Seed has no FK / no deliverability check — gate is structurally in place but dormant until Pedro signs up via `/signup` with that email AND the mailbox can receive Supabase's confirmation email (or `email_confirmed_at` is forced via Supabase Studio).

**One spec deviation**, documented and defended:
- `founder-admin-only.js` SSL config is keyed on the connection-string host (`127.0.0.1` / `localhost` → `ssl: false`; otherwise `ssl: { ca: caCert }`), not the verbatim `ssl: { ca: caCert }` mirror of `health.js:1-15`. Without this, the AC#7 integration test would universally fail against local Supabase docker (whose Postgres reports "server does not support SSL connections"). The same SSL incompatibility exists in `health.js` and `worker/src/jobs/heartbeat.js`, but those pools are not exercised in the existing test suite (signup-flow polls `GET /` to skip `/health`). Documented in deferred-work.md; Story 2.1's `shared/db/service-role-client.js` SSoT will absorb both pools and own the local-vs-prod split centrally.

**Tasks deferred to Pedro** (higher blast-radius / production-side):
1. `npx supabase db push` to apply the migration to Supabase Cloud project `ttqwrbtnwtyeehynzubw`. Local `db reset` verification confirmed migration is well-formed; cloud push deferred to Pedro's authorization.
2. After cloud push, verify via Supabase MCP: `list_tables({schemas: ['public']})` (founder_admins should appear) and `execute_sql({query: 'SELECT email FROM founder_admins'})` (should return exactly the seeded row). Read-only verification only — never `apply_migration` from Claude per project-context MCP rules.
3. End-to-end production smoke-test lands when Story 8.10 ships `/admin/status` — Story 1.5 ships ZERO admin-prefixed production routes (per AC#4, AC#6).

**AC coverage**:
- AC#1 (founder_admins migration) — ✅ migration applies cleanly; 1 seed row; RLS disabled (`pg_class.relrowsecurity = false`); migration-immutability + Story 2.2 TODO sentinel comments present.
- AC#2 (auth.js middleware) — ✅ implemented; cookie-name contract preserved; unsignCookie + JSON-parse + getUser + decoration sequence; redirect-to-login on all failure paths; forward-dependency comment for Story 2.1; access-token-refresh boundary comment; named export only.
- AC#3 (founder-admin-only.js middleware) — ✅ implemented; fail-loud guard with verbatim error string; service-role pool with conditional SSL (see deviation note); parameterized lookup query; 403 on absence with PT denial copy; 503 on lookup error; 200 + adminContext decoration on match; GDPR-deferral comment.
- AC#4 (wiring contract) — ✅ documented in code comments + integration test fixture + README "Admin Authorization" section. ZERO `/admin` route groups in production `app/src/server.js` (negative-assertion test passes).
- AC#5 (encapsulation + order) — ✅ verified by `encapsulation_does_not_leak_to_unrelated_routes` and `founder_admin_only_throws_without_auth_middleware` tests.
- AC#6 (negative-assertion grep) — ✅ verified by `negative_assertion_no_admin_route_in_production_server` and `negative_assertion_no_role_field_on_request_user` tests; covers Constraint #13 + Constraint #16 + service-role-only RLS state.
- AC#7 (integration tests) — ✅ 9 named scenarios pass; one renamed (`tampered_cookie_payload_redirects_to_login` instead of `expired_jwt_redirects_to_login` — JWT-forging too brittle across Supabase Auth versions; tampered-payload exercises the same code path with stable input, per the AC#7 fallback clause).

**Mirakl MCP**: not exercised — Story 1.5 has no Mirakl API calls.

### File List

**New:**
- `supabase/migrations/202604301202_create_founder_admins.sql` — founder_admins table + Pedro seed (`pedro@marketpilot.pt`) + RLS DISABLE
- `app/src/middleware/auth.js` — generic Supabase session-check preHandler
- `app/src/middleware/founder-admin-only.js` — founder-gate preHandler composed on auth.js
- `app/src/views/pages/admin-denied.eta` — Pattern-C 403 / 503 page
- `tests/integration/admin-middleware.test.js` — 9 AC#7 scenarios (10 total tests)

**Modified:**
- `README.md` — added "Admin Authorization" section
- `_bmad-output/implementation-artifacts/deferred-work.md` — appended Story 1.5 GDPR Phase 2 trigger + conditional-SSL Story 2.1 absorption notes
- `_bmad-output/implementation-artifacts/1-5-founder-admins-seed-admin-auth-middleware.md` — task checkboxes + Status + Dev Agent Record + File List + Change Log
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `1-5-founder-admins-seed-admin-auth-middleware: ready-for-dev → review`

**Not modified (intentional negative assertions):**
- `app/src/server.js` — no admin route group registration
- `shared/config/runtime-env.js` — no new env vars
- `.env.example` — no new entries
- `package.json` — no new dependencies

## Change Log

| Date       | Author | Change                                                                                                |
|------------|--------|-------------------------------------------------------------------------------------------------------|
| 2026-05-03 | Bob    | Story sharded — founder_admins migration + Pedro seed + RLS-disabled, app/src/middleware/auth.js (generic Supabase session-check), app/src/middleware/founder-admin-only.js (founder-gate composed on auth.js), app/src/views/pages/admin-denied.eta (Pattern-C 403/503 page), tests/integration/admin-middleware.test.js (AC#7 8 scenarios). Reuses Story 1.4 mp_session cookie contract + Library Empirical Contracts #2 (unsignCookie), #3 (pg.Pool CA pinning), #5 (auth.users DELETE), #6 (fastify.inject). Carries Note 9 GDPR PII Phase 2 deferral to deferred-work.md. |

### Review Findings

Code review run 2026-05-03 (bmad-code-review). Three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor); 1 decision-needed (resolved → patch), 12 patches (all applied), 6 deferred, ~30 dismissed as noise. One bonus patch (Story 1.4 cross-test grep failure) discovered during verification and fixed in the same pass. Final state: `npm run lint` 0 errors, `node --test tests/integration/admin-middleware.test.js` 10/10 pass.

**Decision-needed** (resolved 2026-05-03):

- Resolved: **`request.user.refresh_token` token-leak surface** → Pedro chose Option 1 (extend AD27 redaction list to cover `access_token` and `refresh_token`, keep spec contract with Story 2.1 intact). Reclassified as patch P12 below. Two-step change required because [shared/logger.js:17](shared/logger.js#L17) mandates: *"AD27 redaction list — NEVER narrow; only extend (and extend ONLY by amending the architecture distillate first, then propagating here)."*

**Patch** (unambiguous fixes):

- [x] [Review][Patch] **[CRITICAL] Migration is missing `REVOKE ALL ON founder_admins FROM anon, authenticated`** — Supabase projects grant `SELECT` on `public` schema to the `anon` and `authenticated` PostgREST roles by default. With RLS disabled and no REVOKE, any authenticated end-user could `GET /rest/v1/founder_admins` against the Supabase REST endpoint and enumerate the founder allow-list. The migration's comments correctly observe "no read path because nothing authenticates as a founder via Supabase Auth roles" but PostgREST authenticated reads do not require founder identity — they require ANY confirmed Supabase Auth user. [supabase/migrations/202604301202_create_founder_admins.sql:48]
- [x] [Review][Patch] **[HIGH] `isLocalDb` regex matches substring instead of host** — `/(?:127\.0\.0\.1|localhost)/.test(connectionString)` would match any connection string containing `localhost` or `127.0.0.1` as a substring (e.g., `pooler-127.0.0.1-attack.example.com`, `notlocalhost.com`, or `?host=localhost` query param) → SSL silently disabled in production → MITM possible. Should parse the URL and exact-match the hostname (`localhost`, `127.0.0.1`, `::1`). [app/src/middleware/founder-admin-only.js:55]
- [x] [Review][Patch] **[HIGH] `await supabase.auth.getUser()` is not wrapped in try/catch** — On network failure (DNS, TLS handshake, Supabase 5xx that throws rather than returns `error`), the `await` rejects and bubbles to Fastify's default error handler → 500 returned instead of the documented redirect-to-login behavior (UX-DR1). Wrap the `getUser` call in try/catch; on throw, redirect to login same as on `error` non-null. [app/src/middleware/auth.js:72]
- [x] [Review][Patch] **[HIGH] Pool `'error'` event is unhandled — process crash on idle-conn drop** — Per `pg` docs, an unhandled `error` event on the Pool EventEmitter (e.g., from an idle client whose TCP connection drops) crashes the Node process. Add `_pool.on('error', (err) => { /* log via shared/logger.js */ })`. [app/src/middleware/founder-admin-only.js:56-61]
- [x] [Review][Patch] **[HIGH] `SUPABASE_SERVICE_ROLE_DATABASE_URL` not validated in `getPool`** — If the env var is unset/empty at first-call, `pg.Pool` falls back to libpq `PG*` env defaults — silently connects to localhost or hangs. The lazy factory should fail-fast with a clear error if the env var is empty. [app/src/middleware/founder-admin-only.js:54]
- [x] [Review][Patch] **[HIGH] CA cert read at module-load with cwd-relative path; loaded even when not needed** — `fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8')` runs at module import, resolves against `process.cwd()` (NOT the module location), and runs unconditionally — even when `isLocalDb` is true and the cert is unused. Any environment where the working directory isn't the repo root (Docker WORKDIR mismatch, systemd `WorkingDirectory`, CI runner from subdir) crashes the process before Fastify boots. Move the read inside `getPool()` and only when `!isLocalDb`. Inherits Story 1.1's same pattern in `app/src/routes/health.js`; addressing here cleanly is acceptable since the spec already documents the conditional-SSL deviation. [app/src/middleware/founder-admin-only.js:40]
- [x] [Review][Patch] **[MEDIUM] `data.user.email` not validated as non-empty string in auth.js** — Supabase users with phone-only auth, anonymous auth, or post-admin email-wipe can return `data.user` with no `email`. Currently `request.user.email` becomes `undefined`, then `founder-admin-only.js`'s `typeof request.user.email !== 'string'` guard fires the fail-loud throw — which incorrectly reports "auth.js as a prior preHandler hook" missing when auth.js IS wired but produced an emailless user. Add `if (typeof data.user.email !== 'string' || data.user.email.length === 0) return redirectToLogin(...)` in auth.js. [app/src/middleware/auth.js:73-83]
- [x] [Review][Patch] **[MEDIUM] Email comparison is case-sensitive — drift between Supabase Auth canonicalization and `text` PK breaks the gate** — The PK is `text`, the lookup uses `WHERE email = $1` with no normalization. Supabase Auth normalizes email to lowercase on signup in current versions, but this is not a contractual guarantee across versions. If Pedro signs up with `Pedro@MarketPilot.pt` and any path returns mixed-case, the seed `pedro@marketpilot.pt` never matches → permanent 403 for the founder. Defensive fix: `WHERE LOWER(email) = LOWER($1)` in the middleware (or `email citext` in the table — bigger migration). [app/src/middleware/founder-admin-only.js:93-95]
- [x] [Review][Patch] **[MEDIUM] `tampered_cookie_payload_redirects_to_login` test exercises the wrong code path** — Spec AC#7 fallback contract: "tampered-cookie value (signature still valid because we only mutated the inside JSON) results in a Supabase getUser failure → redirect". Implementation appends `'xx'` to the signed cookie, breaking the HMAC signature → hits the `unsigned.valid === false` branch in [auth.js:52-55](app/src/middleware/auth.js#L52-L55), same code path as `invalid_cookie_signature_redirects_to_login`. The Supabase `getUser`-failure branch in [auth.js:73-77](app/src/middleware/auth.js#L73-L77) is **untested**. Fix: re-sign a cookie wrapping a JSON with a malformed/expired JWT, OR use a known-bad JWT format that passes signature but fails getUser. [tests/integration/admin-middleware.test.js:266-275]
- [x] [Review][Patch] **[LOW] `negative_assertion_no_role_field_on_request_user` uses `'request.user.role'` instead of spec's literal `'role'`** — Spec line 79 mandates the assertion list `['is_admin', 'role', 'permissions', 'scopes']`. The narrower `'request.user.role'` would let `as_role` / `user_role` / `role:` slip through that the literal `'role'` substring would catch. Auth.js does not currently contain `role` so the literal-spec assertion would still pass. [tests/integration/admin-middleware.test.js:301]
- [x] [Review][Patch] **[LOW] Lookup-error branch logs second plaintext-email field not covered by GDPR Phase 2 deferred-work entry** — `founder-admin-only.js`'s catch block logs `{ err, email: request.user.email }`. The deferred-work.md GDPR entry only documents the `admin_access_denied` denial-branch field. Either hash the email here too (consistent with denial-branch when the Phase 2 flip happens) OR extend the deferred-work entry to cover both fields. [app/src/middleware/founder-admin-only.js:98]
- [x] [Review][Patch] **[HIGH] (P12 — promoted from Decision D1) Extend AD27 redaction list to cover `access_token` + `refresh_token`** — Two-step change per AD27 contract: (1) amend the architecture distillate AD27 redaction-list entry to add `access_token` and `refresh_token` to the canonical AD27_FIELDS catalog, then (2) propagate to [shared/logger.js:32-50](shared/logger.js#L32-L50) — append both names to the `AD27_FIELDS` frozen array. Existing wildcard machinery (`*.access_token`, `*.refresh_token`) auto-covers `request.user.access_token` and `request.user.refresh_token` (one level of nesting). [shared/logger.js:32-50, _bmad-output/planning-artifacts/architecture-distillate/_index.md (AD27)]

**Defer** (real but pre-existing or out of scope):

- [x] [Review][Defer] **Verify `tests/integration/_helpers/reset-auth-tables.js` env guards** [tests/integration/_helpers/reset-auth-tables.js] — Story 1.4 helper is reused in Story 1.5 to wipe `auth.users` between tests. If misconfigured to point at non-local Supabase, it would forcibly confirm + delete production users. Should have an explicit `assert(connectionString includes 'localhost' || 'supabase_local')` guard. Pre-existing from Story 1.4.
- [x] [Review][Defer] **Add 503-path test exercising DB-unavailable branch** [tests/integration/admin-middleware.test.js] — `founder-admin-only.js:97-102` (catch → 503 + admin-denied.eta) is dead code from a coverage perspective. A regression that swaps 503 → 500 or removes the view-render would not be caught. Test enhancement; not blocking.
- [x] [Review][Defer] **Production shutdown hook for `endFounderAdminPool`** [app/src/middleware/founder-admin-only.js:136-141] — Pool leaks on graceful shutdown unless production server wires `endFounderAdminPool` in a `closing` hook. Inherits Story 1.1's same pattern (see `health.js` pool). Story 2.1's `shared/db/service-role-client.js` SSoT will absorb both pools and own shutdown discipline centrally.
- [x] [Review][Defer] **Layout case-sensitivity verification on Linux deploy** [app/src/views/pages/admin-denied.eta:1] — Reference `'/layouts/default'`. Windows dev (case-insensitive FS) loads regardless of file-name case; Linux prod (case-sensitive) requires exact match. Verify on first deploy to Coolify Linux container.
- [x] [Review][Defer] **First-call race on `getPool()` singleton** [app/src/middleware/founder-admin-only.js:52-64] — Two parallel first-callers race the `if (_pool === null)` check; both create a Pool, one is leaked (never `.end()`'d). Real but unlikely under MVP load. Story 2.1 SSoT will fix centrally with one-shot init promise.
- [x] [Review][Defer] **Cross-file test isolation: admin-middleware + signup-flow race on shared `auth.users`** [tests/integration/admin-middleware.test.js, tests/integration/signup-flow.test.js] — `node --test tests/integration/signup-flow.test.js tests/integration/admin-middleware.test.js` (both files in one invocation) fails `authenticated_founder_proceeds_with_adminContext` because node:test runs files in parallel by default and the two suites' `resetAuthAndCustomers()` calls race on shared `auth.users` rows. Both pass in isolation (admin-middleware: 10/10; signup-flow: 11/11). Fix options: (a) add `--test-concurrency=1` to test runner scripts, (b) namespace each suite's test emails with a per-suite suffix so resets don't collide. Story 2.2 RLS regression suite work or a dedicated test-harness story is the natural place to address this; not unique to Story 1.5.
| 2026-05-03 | Amelia | Story implemented. Pedro confirmed seed `pedro@marketpilot.pt`. Migration applies cleanly via `db reset`; 1 row seeded; RLS off. Both middlewares + admin-denied.eta + integration test all in place. Test result: 10/10 pass (9 AC#7 scenarios + parent suite). One spec deviation: `founder-admin-only.js` uses conditional SSL keyed on connection-string host so the AC#7 integration test works against local Supabase docker (Postgres without SSL support). Pre-existing same-shaped issue in `health.js` + `heartbeat.js` tracked for Story 2.1 SSoT absorption. Cloud `db push` + Supabase MCP verification deferred to Pedro. Status → review. |
