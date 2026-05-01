This section is the FR/AD → file mapping table (load-bearing for code-review compliance auditing), external + internal integration boundaries, engine-cycle data flow, notable absences, and dev/deploy workflows. Part 7 of 9 from `architecture.md`.

## FR/AD File Mapping
- For Bob's story sharding; load-bearing for code-review architecture-compliance auditing

| Spec ref | File path |
|---|---|
| FR1, FR3 (auth + signup) | `app/src/routes/_public/{signup,login,verify-email,forgot-password,reset-password}.js` + `app/src/middleware/auth.js` |
| FR2 (single login) | Implicit in Supabase Auth — no per-customer multi-user table at MVP |
| FR4 + AD21 (deletion) | `app/src/routes/settings/delete.js` + `worker/src/jobs/deletion-grace.js` + email templates `app/src/views/emails/deletion-*.eta` |
| FR5 + AD2 (RLS) | `supabase/migrations/*.sql` (each customer-scoped table's policy) + `scripts/rls-regression-suite.js` |
| FR6 + AD4 (founder admin) | `app/src/routes/admin/status.js` + `supabase/migrations/202604301202_create_founder_admins.sql` |
| FR7 (source-context capture) | `app/src/middleware/source-context-capture.js` |
| FR8-FR11 + AD3 (key vault) | `app/src/routes/onboarding/key.js` + `shared/crypto/envelope.js` + `shared/mirakl/api-client.js` |
| FR12-FR15 + AD16 (catalog scan) | `app/src/routes/onboarding/scan.js` + `worker/src/jobs/master-cron.js` + `supabase/migrations/202604301211_create_scan_jobs.sql` |
| FR16 (margin question) | `app/src/routes/onboarding/margin.js` |
| FR17-FR19 + AD10 (tier system) | `worker/src/engine/tier-classify.js` + `supabase/migrations/202604301206_create_sku_channels.sql` |
| FR20-FR25 + AD8, AD13, AD14 (engine) | `worker/src/engine/decide.js` + `shared/mirakl/{p11,self-filter}.js` |
| FR22 + AD9 (cooperative-absorption) | `worker/src/engine/cooperative-absorb.js` |
| FR23 + AD7 (PRI01) | `shared/mirakl/{pri01-writer,pri02-poller,pri03-parser}.js` |
| FR26-FR27 + AD11 (circuit breaker) | `worker/src/safety/circuit-breaker.js` (per-cycle) + inline in `worker/src/engine/decide.js` (per-SKU) |
| FR28 (nightly reconciliation) | `worker/src/safety/reconciliation.js` (Tier 3 daily pass) |
| FR29 + AD12 (anomaly freeze) | `worker/src/safety/anomaly-freeze.js` + `app/src/routes/audit/anomaly-review.js` |
| FR30-FR32 (dry-run + Go-Live + pause) | `app/src/routes/dashboard/{go-live,pause-resume}.js` + UX modal eta files |
| FR33 (baseline snapshot) | `supabase/migrations/202604301207_create_baseline_snapshots.sql` + scan flow |
| FR34-FR39 + AD15 (dashboard + state UI) | `app/src/routes/dashboard/index.js` + `app/src/views/components/{kpi-cards,banners}.eta` |
| FR36 (margin editor) | `app/src/routes/dashboard/margin-edit.js` + `app/src/views/components/margin-editor.eta` + `public/js/margin-editor.js` |
| FR37-FR38d + AD19, AD20 (audit log) | `app/src/routes/audit/*` + `shared/audit/*` + `supabase/migrations/202604301208_create_audit_log_partitioned.sql` |
| FR40-FR44 + AD22 (Stripe + Moloni) | `shared/stripe/*` + `app/src/routes/_webhooks/stripe.js` + `shared/moloni/invoice-metadata.js` |
| FR41 (concierge marketplace add) | `app/src/routes/settings/marketplaces.js` (read-only at MVP per UX §8.5) |
| FR45 + AD23 (/health) | `app/src/routes/health.js` + `worker/src/jobs/heartbeat.js` |
| FR46 + AD24 (3-tier failure model) | Distributed: retry in `shared/mirakl/api-client.js` (transient); per-SKU in PRI01 lifecycle; critical in `shared/audit/writer.js` + `shared/resend/client.js` |
| FR47 + AD4 (founder dashboard) | `app/src/routes/admin/status.js` + reuses `app/src/routes/audit/*` with `?as_admin=` parameter |
| FR48 + AD25 (Resend) | `shared/resend/client.js` + `app/src/views/emails/critical-alert.eta` |
| AD17 (dispatcher) | `worker/src/dispatcher.js` + `worker/src/advisory-lock.js` |
| AD26 (PC01 monthly re-pull) | `worker/src/jobs/pc01-monthly-repull.js` |
| AD27 (logging) | Pino config in `app/src/server.js` and `worker/src/index.js` |
| AD28 (validation) | Per-route `schema:` config in route files (Fastify built-in) |
| AD29 (customer profile) | `app/src/routes/_public/signup.js` (atomic transaction) + `supabase/migrations/202604301201_create_customer_profiles_with_trigger.sql` |
| AD30 (RLS regression) | `scripts/rls-regression-suite.js` + `tests/integration/rls-regression.test.js` |

## Integration Boundaries — External

| Service | Direction | Touchpoint | Auth | Failure mode |
|---|---|---|---|---|
| Mirakl Marketplace API (Worten) | Outbound only | `shared/mirakl/api-client.js` | `Authorization: <encrypted-key-decrypted-in-worker>` | 3-tier model (AD24) |
| Supabase Auth | Bidirectional | `@supabase/supabase-js` in app | Anon key (client), JWT-bound RLS | Standard Supabase availability |
| Supabase Postgres | Bidirectional | `pg` (worker) + `@supabase/supabase-js` (app) | Service-role (worker) / JWT (app) | Standard Postgres availability |
| Stripe | Bidirectional | `shared/stripe/*` (out) + `app/src/routes/_webhooks/stripe.js` (in) | Secret key (out), signature verify (in) | Webhook idempotency via `stripe_payment_intent_id` UNIQUE |
| Resend | Outbound only | `shared/resend/client.js` | API key | Failure logged; alert ops; never blocks engine |
| UptimeRobot | Inbound (pings) | `app/src/routes/health.js` | None (public endpoint) | Failure → founder email |
| Moloni | Manual at MVP | Founder UI; `shared/moloni/invoice-metadata.js` writes metadata | N/A at MVP | N/A |

## Integration Boundaries — Internal
- App ↔ Worker: communicate via Postgres only; no direct HTTP, no shared message bus; worker reads `customer_marketplaces.cron_state` to know what to dispatch; app writes state through `transitionCronState`; loosely coupled — either can restart without affecting the other
- Shared ↔ App / Worker: pure JS imports; `shared/` modules stateless or factory-wrapped; consuming process supplies the DB client
- Public ↔ App: HTTPS only via Coolify; TLS terminated at Coolify; Fastify serves HTTP behind it

## Data Flow — Engine Cycle (load-bearing)

```
[node-cron: every 5 min] in worker/src/index.js
   ↓
[worker/src/jobs/master-cron.js]
   ↓ for each customer_marketplace WHERE cron_state = 'ACTIVE':
   ↓   pg_try_advisory_lock(customer_marketplace.id)
   ↓   IF acquired:
       [worker/src/dispatcher.js]
           ↓ SELECT FROM sku_channels WHERE last_checked_at + tier_cadence_minutes < NOW()
           ↓
           [worker/src/engine/decide.js]                              # AD8
               ↓ shared/mirakl/p11.js → mirAklGet → competitors
               ↓ shared/mirakl/self-filter.js                         # AD13 + AD14
               ↓ worker/src/engine/cooperative-absorb.js              # AD9
               ↓ shared/money/index.js (floor/ceiling math)           # rounding
               ↓ decision: UNDERCUT | CEILING_RAISE | HOLD
               ↓ shared/audit/writer.js (Rotina events)               # AD20
               ↓ IF write decision: INSERT INTO pri01_staging
           [worker/src/safety/circuit-breaker.js]                     # AD11 — per-cycle 20%
               ↓ IF tripped: transitionCronState → PAUSED_BY_CIRCUIT_BREAKER + Atenção + Resend
       [shared/mirakl/pri01-writer.js]                                # AD7
           ↓ GROUP BY sku_id → build CSV per-SKU
           ↓ shared/mirakl/api-client.js (POST /api/offers/pricing/imports)
           ↓ INSERT into sku_channels.pending_import_id (atomic for all participating rows)
   ↓ pg_advisory_unlock
[worker/src/jobs/pri02-poll.js] in parallel cron
   ↓ shared/mirakl/pri02-poller.js — for each pending_import_id
   ↓ ON COMPLETE: clear pending_import_id, set last_set_price_cents, last_set_at
   ↓ ON FAILED: shared/mirakl/pri03-parser.js — schedule per-SKU rebuild
[worker/src/engine/kpi-derive.js] at cycle-end
   ↓ INSERT INTO cycle_summaries
   ↓ partial-refresh daily_kpi_snapshots for "today"
```

## Notable Absences (deliberately deferred to Epic 2)
- No customer-facing API endpoints — UI is server-rendered only; JSON only for Stripe webhooks (incoming) and audit-log fragment endpoints (HTML, not JSON, despite "fragment" naming)
- No connection pooler for the worker — `pg` opens small pool internally; at MVP scale (5–10 customers, single worker, 5-min cycles) sufficient; PgBouncer / Supavisor introduction is Epic 2 trigger when worker count exceeds 1
- No CDN for `public/` — served directly via `@fastify/static` at MVP; Cloudflare in front of Coolify is Epic 2 trigger if dashboard rendering latency becomes customer-visible (unlikely at PT/ES geographic concentration with Hetzner Frankfurt)
- No background queue (BullMQ, etc.) — DynamicPriceIdea uses BullMQ + Redis for queuing report jobs; repricer's queue equivalent is `pri01_staging` table + Postgres advisory locks; no Redis dep at MVP; trigger to add: > 5–10 second cycle latency requires async fan-out worker pattern

## Development Workflow
- `npm install` — single package install; no workspace logic
- `npm run start:app` — Fastify on port 3000
- `npm run start:worker` — cron service
- `npm run start:both` — concurrently run both for local dev (uses `concurrently` if added; optional)
- `npm test` — `node --test --env-file-if-exists=.env.test 'tests/**/*.test.js'`
- `npm run test:rls` — runs only `tests/integration/rls-regression.test.js`
- `npm run lint` — ESLint over `app/`, `worker/`, `shared/`, `scripts/`
- `npm run db:migrate` — Supabase CLI applies pending migrations
- `npm run db:reset` — Supabase CLI resets local dev DB (test env only)
- `npm run mirakl:verify` — runs `scripts/mirakl-empirical-verify.js` against `.env.local`

## Deployment Workflow
- `git push` to main → Coolify webhook → both services rebuild + redeploy in parallel
- Worker process count at MVP: ONE instance (Coolify `replicas: 1`); horizontal scaling supported by AD17 per-customer `pg_try_advisory_lock` pattern; Epic 2 trigger when cycle latency exceeds NFR-P1/P2 budgets (Tier 1/2a p95 ≤18 min); multi-worker activation is Coolify config change with no code edits
- App process count at MVP: ONE instance (Coolify `replicas: 1`); stateless — horizontal scaling trivial when traffic justifies; Coolify config-only
- Pre-deploy: GitHub Actions runs `npm test` + `npm run lint` + `npm run test:rls`; block deploy on any failure
- Post-deploy: UptimeRobot detects new deploy via `/health` (no manual check needed)
- Rollback: Coolify keeps previous image; rollback is one-click revert in Coolify UI; documented in `scripts/rollback-runbook.md` (Bob ships this in Story 1.x)
