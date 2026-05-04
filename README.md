# MarketPilot Repricer

Automated repricing tool for Mirakl marketplaces. Monitors competitor prices via the Mirakl P11 API and reprices listings (via PRI01) to maintain 1st-place ranking within configurable margin floor/ceiling bands.

## Stack

- **Runtime:** Node.js ≥ 22, ESM (`"type": "module"`)
- **Web framework:** Fastify v5
- **Database:** PostgreSQL via Supabase (direct `pg` Pool)
- **Logging:** pino (structured JSON to stdout)
- **Payment:** Stripe
- **Email:** Resend
- **Templates:** eta (server-rendered, no SPA)

## Project structure

```
app/        — Fastify web server (port 3000)
worker/     — Background worker (heartbeat + repricing engine)
shared/     — Modules imported by both app and worker
db/         — SQL migrations and seed data
tests/      — Integration and unit tests
public/     — Static assets (CSS, JS, images)
scripts/    — Operational scripts
_bmad-output/ — Planning and implementation artifacts (AI context)
```

## Auth & Signup

Story 1.4 ships **Atomicity Bundle A (F3 + AD29)** — the load-bearing primitive that guarantees a customer never lands in a broken `auth.users`-without-`customers`-or-`customer_profiles` state.

When a customer hits `POST /signup`, Supabase Auth's `auth.signUp()` runs an INSERT on `auth.users` inside a Postgres transaction. The `trg_handle_new_auth_user` trigger fires in the same transaction and:

1. Reads `first_name` / `last_name` / `company_name` / `source` / `campaign` out of `raw_user_meta_data`.
2. Validates the three required B2B fields (`length(trim(...)) > 0`); raises with `ERRCODE='23502'` + a `PROFILE_*_REQUIRED` HINT on missing fields — which **rolls the entire transaction back**, including the `auth.users` row.
3. On valid input, INSERTs both `customers` and `customer_profiles` rows — atomically with `auth.users`.

The route layer does NOT carry partial-state cleanup logic. Postgres atomicity is the contract; do not add catch-and-DELETE code that would break under concurrent load. The PT-localized field error mapping lives in [`app/src/lib/signup-error-mapper.js`](app/src/lib/signup-error-mapper.js); the source-context (`?source=`/`?campaign=`, FR7) cookie middleware lives in [`app/src/middleware/source-context-capture.js`](app/src/middleware/source-context-capture.js). See [`_bmad-output/implementation-artifacts/1-4-signup-endpoint-atomic-profile-trigger-source-context-capture.md`](_bmad-output/implementation-artifacts/1-4-signup-endpoint-atomic-profile-trigger-source-context-capture.md) for the full spec, ACs, and review checklist.

## Admin Authorization

Story 1.5 ships the **founder-admin gate** that protects every future admin-only surface (`/admin/status` from Story 8.10, founder operational endpoints from Stories 11.4 / 11.5). The design is **binary** — a request is either authenticated as a founder, or it is not. There is no role table, no `is_admin` claim on the JWT, and **no customer-impersonation flow** (Constraint #13 — the founder NEVER logs in as the customer; the read-only `?as_admin={customer_id}` pattern in Story 8.10 reuses the customer audit-log surface and is NOT impersonation).

The two composable preHandler primitives are:

- [`app/src/middleware/auth.js`](app/src/middleware/auth.js) — generic Supabase Auth session-check. Reads the `mp_session` signed cookie set by [`app/src/routes/_public/login.js`](app/src/routes/_public/login.js), validates the JWT via `supabase.auth.getUser()`, and decorates `request.user = {id, email, access_token, refresh_token}`. Redirects to `/login?next=<current-path>` on any failure (UX-DR1).
- [`app/src/middleware/founder-admin-only.js`](app/src/middleware/founder-admin-only.js) — founder gate, composed on top of `auth.js`. Looks `request.user.email` up against the [`founder_admins`](supabase/migrations/202604301202_create_founder_admins.sql) allow-list via a service-role pg.Pool (AD4). On match: decorates `request.adminContext = {email}`. On absence: 403 + PT-localized `admin-denied.eta`. On lookup error: 503.

Future admin route groups wire both hooks in order:

```js
fastify.register(async (instance) => {
  instance.addHook('preHandler', authMiddleware);    // 1. validates session
  instance.addHook('preHandler', founderAdminOnly);  // 2. gates by founder_admins
  await instance.register(adminStatusRoutes);
}, { prefix: '/admin' });
```

The `founder_admins` table is **service-role-only** (RLS explicitly disabled, no per-tenant scope). Adding a co-founder ships as a new `<ts>_add_<name>_to_founder_admins.sql` migration — **never** edit the original seed migration. See [`_bmad-output/implementation-artifacts/1-5-founder-admins-seed-admin-auth-middleware.md`](_bmad-output/implementation-artifacts/1-5-founder-admins-seed-admin-auth-middleware.md) for the full spec, ACs, and review checklist.

## Local development

```sh
cp .env.example .env.local
# Fill in required values — see .env.example for all vars

npm install

# Install the pre-commit secret-scanning hook (one time, per fresh clone)
bash scripts/install-git-hooks.sh

# Start app server (localhost:3000)
npm run start:app

# Start worker (separate terminal)
npm run start:worker

# Lint
npm run lint

# Integration smoke test (requires .env.local with real Supabase credentials)
node --test tests/integration/scaffold-smoke.test.js
```

## Developer setup

### Pre-commit secret-scanning hook (AD3, mandatory)

The repo ships a pre-commit hook that blocks accidentally-staged secrets — `MASTER_KEY_BASE64` values, Mirakl `shop_api_key` values, Stripe `sk_live_` / `sk_test_` keys, and `Authorization: Bearer ...` tokens. Install once per fresh clone:

```sh
bash scripts/install-git-hooks.sh
# → tells git to look in .githooks/ instead of .git/hooks/ (which is per-clone, untracked)
```

If the hook flags a false positive, refine the regex in `scripts/check-no-secrets.sh` rather than bypassing with `--no-verify`. Bypass discipline is part of the AD3 trust commitment.

**Second layer of defense — GitHub-side secret scanning:** also enable repo Settings → Code security & analysis → Secret scanning. Catches anything that slipped past the local hook on someone else's clone.

### Master key generation

The worker process loads a 32-byte AES-256-GCM master key from `MASTER_KEY_BASE64` at boot and holds it in memory only — never on disk, never in logs, never exported. Generate with:

```sh
openssl rand -base64 32
# → 44-character base64 string; paste into .env.local AND Coolify env vars
```

The annual rotation procedure lives in [`scripts/rotate-master-key.md`](scripts/rotate-master-key.md).

## Coolify two-service deployment

Both services deploy from the **same git repository** pushed to `main`. Coolify runs them as two independent container instances from the same image.

### Service 1 — App

| Setting | Value |
|---|---|
| Start command | `node app/src/server.js` |
| Port | `3000` |
| Public URL | `app.marketpilot.pt` |
| Replicas | `1` (F11 — explicit) |

### Service 2 — Worker

| Setting | Value |
|---|---|
| Start command | `node worker/src/index.js` |
| Port | (none — no public URL) |
| Replicas | `1` (F11 — explicit) |

Both services share the same environment variables (Coolify-managed). Inject all vars listed in `.env.example`.

**No pm2, no systemd** — Coolify handles restart-on-crash and deploys.

### UptimeRobot (post-deploy)

Configure monitor for `https://app.marketpilot.pt/health` at 5-minute cadence with email alert.

## RLS Regression Suite Convention (Story 2.2 / AD30)

Every new customer-scoped table migration (Epics 4–11) **MUST** include in the **same PR**:

1. The RLS `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` statement in the migration file.
2. A seed row for both test customers in `db/seed/test/two-customers.sql`.
3. A new entry object in the `CUSTOMER_SCOPED_TABLES` registry array in `tests/integration/rls-regression.test.js`.

Failing step 3 causes the `convention_every_seed_table_is_in_regression_config` test to fail loudly:

> `table "<name>" is present in db/seed/test/two-customers.sql but missing from CUSTOMER_SCOPED_TABLES registry in rls-regression.test.js`

Run the full RLS suite locally with:

```sh
npm run test:rls
```

CI (`npm run test:rls`) blocks PRs and deploys on any failure — see `.github/workflows/ci.yml`.
