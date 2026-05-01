This section covers project context, requirements overview, hard constraints, code-reuse foundation, frontend approach, and scaffold/dependency baseline. Part 1 of 9 from `architecture.md`.

## Requirements Overview
- 51 FRs across 7 buckets, all traced through UX skeleton
- A. Account & Identity (FR1-FR7): self-serve signup, email verification, single-login-per-account, multi-step deletion + 7-day grace, RLS data isolation, founder admin read-only, source-context query-param capture for free-report funnel attribution
- B. API Key & Catalog Onboarding (FR8-FR16): single-purpose key entry, inline 5-second P11 validation, encrypted-at-rest storage, async catalog scan with reconnection, single onboarding margin question
- C. Pricing Engine (FR17-FR25): per-SKU per-channel state with `last_won_at` + `tier_cadence_minutes`; 4-state tier classification (T1/T2a/T2b/T3); single-cron polling every 5 min; P11 ranking by `total_price` with `active=true` filter; list_price-anchored floor/ceiling; cooperative-ERP-sync absorption; PRI01-only writes with PRI02 polling; decision-table cases
- D. Engine Safety & Customer Controls (FR26-FR33): outbound circuit breaker (≤20% catalog/cycle, ≤15% per-SKU); nightly reconciliation as Tier 3 daily pass; inbound anomaly freeze (>40% deviation); dry-run by default no time limit; informed-consent Go-Live modal; single-click pause/resume freeze-not-rollback; baseline snapshot retention
- E. Dashboard & Audit Log (FR34-FR39): KPI cards mirroring free-report categories; PT/ES channel toggle; margin editor with worked-profit-example; audit log 5-surface IA (daily summary / atenção / notável / search-by-SKU / cycle-aggregated firehose); event-type taxonomy 3 priority levels (Atenção/Notável/Rotina); PT-localized banners
- F. Subscription & Billing (FR40-FR44): Stripe €50/marketplace/month; single-marketplace-MVP + concierge-add (no self-serve UI); 14-day money-back guarantee; Stripe-managed dunning; Moloni manual invoicing
- G. Operations & Alerting (FR45-FR48): /health UptimeRobot 5-min ping; 3-tier failure model (transient retry / per-SKU operational / critical alert+banner); founder admin monitoring dashboard; Resend critical-alert delivery ≤5 min

## NFRs Driving Architecture
- Performance: Tier 1/2a cycle p95 ≤18 min (NFR-P1, P2); Tier 2b p95 ≤75 min; Tier 3 p95 ≤28h; PRI01→PRI02 within 30 min (NFR-P5); /health ≥99% uptime; audit log filter ≤2s on 90-day window (NFR-P8 — drives partitioning + precomputation); catalog scan 50k SKUs in 4h (NFR-P10, UNVERIFIED MCP gate); mobile render ≤4s on 3G (NFR-P7)
- Security: shop_api_key encryption-at-rest (NFR-S1, trust commitment); TLS 1.2+; Postgres RLS with regression test suite per deploy (NFR-S3); Stripe webhook signature + replay protection (NFR-S4); audit log append-only at app layer (NFR-S6); zero card data stored (NFR-S7)
- Scalability: 5-10 customers MVP → 50 Epic 2 no rework (NFR-Sc1); 50k → 100k+ SKU catalogs (NFR-Sc2); single-cron + per-SKU `tier_cadence_minutes` via advisory-lock horizontal worker scale (NFR-Sc3); free-tier capacity sufficient MVP across Resend/Supabase (NFR-Sc4-Sc5)
- Reliability: RTO 30 min rollback playbook (NFR-R2); RPO ≤24h via Supabase daily backups (NFR-R3) — audit log durability matches general state at MVP, append-only preserved independent of durability tier; 3-tier failure model + PT-localized banner during sustained transients (NFR-R5)
- Integration: Mirakl MCP-verified rate limits/pacing pre-launch (NFR-I1); Stripe idempotency keys + idempotent webhook handler (NFR-I2); RLS regression suite per deploy (NFR-I3); Resend PT-localized templates (NFR-I4); cross-repo handoff with DynamicPriceIdea via signup query params (NFR-I6) — no shared schema/DB/pipeline (deliberate isolation, different security postures)
- A11y/L10n: WCAG 2.1 AA practical baseline (NFR-A1); audit log screen-reader readable (NFR-A3); PT-default UI; ES UI deferred Epic 2 (NFR-L1, L2)
- Operational: rollback playbook + 30-min SLA, solo-founder continuity runbook, Day-1 active-monitoring protocol

## UX Skeleton (Architecturally Load-Bearing)
- 5-surface audit log IA (UX7-UX12); banner stacking precedence + paused-state visual distinction (UX4, UX5); margin editor SKU-selection rule + stated-margin assumption (UX15, UX18); founder admin status page composition (UX28-UX30); mid-life key-revocation interception (UX31); payment-failure interception (UX32); scan-readiness summary (UX33-UX34); account-deletion 4-step flow (UX35-UX37); add-marketplace concierge (UX38)

## Scale & Complexity
- SaaS B2B, multi-tenant from day 1, integration-heavy backend, trust-critical (full-account-access API keys + automated price-setting agency)
- Complexity medium-high; no regulator gate; no real-time-safety-critical path
- Real complexity sources: trust architecture (KMS, RLS, encrypted vault, 4-layer write safety); Mirakl integration edge cases (per-channel pricing, async PRI01/PRI02, OF24 footgun, unverified rate limits); engine decision table; audit-log volume math (~3M entries/quarter/customer)
- Logical components: auth/RLS layer; encrypted key vault + KMS envelope; Mirakl client (P11, OF21, PRI01, PRI02); repricing engine + tier dispatcher + cooperative-absorption; 4-layer safety stack (tier system + circuit breaker + nightly reconciliation + anomaly freeze); audit log + precomputed aggregates; customer dashboard + audit-log UI; Stripe + Moloni billing; Resend alerting + UptimeRobot health; account-lifecycle workflow; founder admin status page
- Primary technical domain: Node.js Fastify backend + Postgres + cron worker + browser dashboard; multi-service single-deploy on Hetzner via Coolify; Postgres + Auth + RLS on Supabase Cloud EU

## Hard Constraints (Non-Negotiable)
- Stack: Node.js >=22, Fastify, Postgres; no framework swap
- Hosting: Hetzner via Coolify + Supabase Cloud EU; no AWS/GCP/Azure at MVP
- Mirakl access: MMP only; direct shop API key; no MiraklConnect
- Price writes: PRI01 ONLY; OF24 FORBIDDEN (resets unspecified offer fields)
- Encryption-at-rest for shop_api_key: zero-plaintext-keys-at-rest verified pre-launch and ongoing
- Mirakl MCP verification mandate: all Mirakl behavior verified via MCP before architecture lock — applies to all agents (PM, ARCH, dev, code-review)

## Cross-Org Boundary
- Customer Mirakl keys live at Supabase (their infra); application + worker live on Hetzner (your infra)
- DPA + ToS + Privacy Policy must reflect this
- KMS architecture (B1 lock): encryption master on Hetzner so Supabase data leak alone never compromises customer keys — preserves trust property

## Code-Reuse Foundation
- Reused-from-DynamicPriceIdea (production-tested): Mirakl HTTP client + retry/backoff (`apiClient.js`); P11 batch scanner with per-channel pattern (`scanCompetitors.js`); EAN resolution strategy; channel-bucketing pattern; error classification → safe Portuguese messages
- Reused-from-Gabriel: env-loader pattern (`connectors/mirakl/config.ts`); lock pattern as starting reference (`worker/src/lock/job-lock.ts`) — MarketPilot uses Postgres advisory locks per-customer instead of single-row pseudo-mutex for NFR-Sc3 horizontal scale
- Net-new (no reuse): PRI01 multipart-CSV writer; PRI02 poller with race-resolution; cooperative-ERP-sync absorption logic; 4-state tier engine with `last_won_at`-driven transitions; per-customer advisory-lock dispatcher; multi-tenant RLS schema; encrypted key vault + envelope encryption + rotation ceremony; audit log + monthly partitioning + precomputed daily-KPI/cycle-summary aggregates; customer dashboard + 5-surface audit-log UI; Stripe + Moloni integration; founder admin status page; account-deletion grace-period workflow

## Cross-Cutting Concerns
- Tenant isolation: RLS on every customer-scoped table; service-role-key limited to repricer-worker + operator-only admin endpoints; tested with deliberate cross-tenant attempts; regression suite per deploy
- Trust as architectural property: encrypted-at-rest keys; append-only audit log at app layer; dry-run-by-default; informed-consent self-flip Go-Live; customer-self-service investigation via 5-surface audit log; every decision evaluated against "preserves or erodes trust property?"
- Async-everywhere posture: PRI01 async (PRI02 polling); catalog scan async (server-side job state, customer can disconnect/reconnect); cron cycles independent; no synchronous customer-facing op blocks on Mirakl beyond key validation (5-second test P11)
- State machine clarity: single `cron_state` enum on `customer_marketplace` drives banner UX, audit-log filtering, cron dispatch query (`WHERE cron_state = 'ACTIVE'`); per-SKU `frozen_for_anomaly_review` orthogonal, never folded into customer-level state
- Localization: PT-first; every customer-facing copy block traces to UX skeleton §9 microcopy specs; ES UI is Epic 2 trigger
- Mirakl MCP verification gate: 15-question list blocks schema lock until MCP-verified or empirically resolved from reference repos; frontmatter tracks each item's status
- Failure-mode propagation: 3-tier failure model with explicit per-tier semantics; circuit breaker + anomaly freeze independent layers, testable in isolation; PT-localized banner triggers on sustained transient failures
- Audit-log volume reality: ~3M entries/quarter/customer at production catalog scale demands monthly partitioning + compound indexes + precomputed aggregates from day 1; computing daily summaries on demand against multi-million-row tables blows NFR-P8 2s budget
- Schema reservations for Epic 2 (5 columns at MVP design, no migration later): `customer_marketplace.anomaly_threshold_pct`; `customer_marketplace.tier_cadence_minutes_override`; `customer_marketplace.edge_step_cents`; `sku_channel.cost_cents`; `sku_channel.excluded_at`
- Customer profile fields (`first_name`, `last_name`, `company_name`) are NOT NULL MVP requirements written atomically with Supabase Auth user creation; NOT Epic 2 reservations; belong directly in customer/profile table

## Operating Principle
- Every architectural decision must have a clear "this becomes a Bob story" trace
- Spec is WHAT (data model, module boundaries, integration contracts, decision rules); Bob (SM agent) translates each WHAT into HOW (shell commands, Coolify config steps, file edits, test acceptance criteria) when sharding into stories
- Where decision implies operational setup, spec names the requirement, not click-path; dev-facing translation lands in Bob's story sharding
- Architectural ambiguity translates directly to BAD subagent confusion downstream — precision here = velocity there

## Frontend Approach (Locked Decision)
- Decision: server-rendered HTML + vanilla JS + CSS tokens; NO SPA framework; NO bundler
- Rationale: (1) DynamicPriceIdea (marketpilot.pt free report, in production) uses Fastify + vanilla HTML/JS/CSS no build step — the 9-months-to-1-week velocity datapoint; replicating shape preserves velocity; (2) UX skeleton §10 binds visual system to `MarketPilot.html` — single HTML doc with embedded CSS tokens, Material Symbols Outlined icons, Manrope/Inter/JetBrains Mono type stack; (3) NFR-P7 mobile ≤4s on 3G — SPA + bundler adds 100-300KB before features; vanilla pages stay sub-100KB end-to-end; (4) interactivity surface bounded (margin editor ~150ms-debounced live worked-profit-example, audit log filters server-paginated, pause/resume buttons, modals) — none need framework reactivity; (5) no build step = simpler deploy: Coolify runs `node app/src/server.js`, no `npm run build`, no asset compilation, no source maps
- Future Epic 2 fallback: HTMX (~14KB, no build step, plays well with Fastify + eta) as enhancement layer before reaching for React if audit log 5-surface IA grows imperative; audit-log code at MVP written with "HTMX-ready URL conventions" (filter actions return discrete HTML fragments, not full pages)

## Initialization (No `npx create-*`)
- Hand-scaffolded with explicit dependencies pinned at scaffold time to current major versions
- Setup: `npm init -y`; `npm pkg set engines.node=">=22.0.0"`; `npm pkg set type="module"`
- Server + worker runtime deps: `fastify`, `@fastify/static`, `@fastify/view`, `@fastify/rate-limit`, `@fastify/cookie`, `@fastify/csrf-protection`, `eta`, `pino`, `pg`, `@supabase/supabase-js`
- Mirakl + integrations: `stripe`, `resend`
- Cron: `node-cron`
- Crypto: Node built-in `node:crypto` (AES-256-GCM) — no extra dep
- Validation: Fastify built-in JSON Schema validation (`fastify.addSchema` / route `schema:`) — no extra dep at MVP
- Dev: `eslint` (--save-dev)
- Versions verified at scaffold time via `npm view <pkg> version`; no version pinning in this doc (`package-lock.json`'s job)

## Project Structure (Single npm Package, Two Entry Points — Locked)
- Per distillate §13: "No monorepo. If shared logic emerges, extract a small npm package — don't preempt the abstraction"; no Coolify projects pre-exist
- Top-level layout: `marketpilot-repricer/` with single `package.json` (npm run start:app / start:worker); subdirectories `app/`, `worker/`, `shared/`, `db/`, `public/`, `scripts/`, `tests/` (full file-by-file tree in [05-directory-tree.md](05-directory-tree.md))
- Two service processes from one image: Coolify deploys single git repo as TWO service instances — one running `npm run start:app` (port 3000, exposed as `app.marketpilot.pt`), one running `npm run start:worker` (no public port); same image, different start commands, shared environment variables

## Scaffold Architectural Decisions
- Language & Runtime: JavaScript ESM (`"type": "module"`), Node.js ≥22; NO TypeScript at MVP; rationale: DynamicPriceIdea is JS-ESM, matching keeps shared-code reuse trivial; TS migration future option (`.js` → `.ts` rename + cleanup, not rewrite) if churn demands
- JSDoc type hints REQUIRED: all exported functions carry JSDoc `@param`/`@returns`/`@throws`; critical financial/state-mutation functions (margin math, decimal-separator handling, PRI01 CSV serialization, cron-state transitions, encryption helpers) carry richer JSDoc with `@typedef` for shapes; ESLint enforces on `shared/`, `app/src/`, `worker/src/` exports; Story 1.1 seeds ESLint rule + one example fully-annotated function
- Web Framework: Fastify v5 (matches DynamicPriceIdea); `@fastify/view` + `eta` for SSR templating; `@fastify/static` for `/public`; `@fastify/rate-limit` on signup + key-validation endpoints; `@fastify/cookie` + `@fastify/csrf-protection` for session security
- Validation: Fastify built-in JSON Schema validation (route-level `schema:` config); NO additional library at MVP; sufficient for signup, key-entry, margin-editor save, anomaly-review accept/reject, deletion-confirmation; if Epic 2 surface emerges JSON Schema can't express ergonomically, revisit (zod is candidate); specified so Bob's stories don't reach for validator dep by reflex; **NO ZOD AT MVP**
- Database Access (two patterns by service): App uses `@supabase/supabase-js` with customer's JWT bound at request scope so RLS policies fire automatically; service-role key NEVER exposed to customer-facing path. Worker uses `pg` (canonical Postgres driver) directly with service-role connection string; allows raw `pg_try_advisory_lock(customer_id)` calls; bypasses RLS for cross-customer cron work; uses `@supabase/supabase-js` only for auth-system reads when needed
- RLS regression test stories must verify: (a) app server cannot reach across tenants even with malformed route; (b) worker advisory-lock pattern blocks duplicate per-customer dispatch
- Migrations: Supabase CLI conventions (`supabase/migrations/*.sql`); Drizzle considered (DynamicPriceIdea uses it) and REJECTED — Supabase migration tooling integrates with their dashboard, RLS policy management, documented path; Drizzle's TS-only ergonomics also conflict with JS-ESM-with-JSDoc convention
- Templating: `eta` (lightweight, async-friendly); all customer-facing templates default-localize to PT (NFR-L1); Spanish UI templates deferred Epic 2 (NFR-L2)
- Test Framework: built-in `node --test` runner (matches DynamicPriceIdea); NO Jest/Vitest dependency; Playwright considered Epic 2 if E2E coverage gap emerges
- Linting/Formatting: ESLint with thin config (incl. JSDoc rule); NO Prettier at MVP (one less config at solo-founder scale)
- Logging: `pino` (already in DynamicPriceIdea `apiClient.js`); structured JSON to stdout, Coolify captures
- Process Management: Coolify handles process lifecycle, restart-on-crash, zero-downtime deploys; NO pm2 or systemd
- Cron: `node-cron` for master 5-min poll inside worker process; per-customer dispatch internal to worker
- Encryption: Node built-in `node:crypto` (`createCipheriv`/`createDecipheriv` with `aes-256-gcm`); master key loaded from `MASTER_KEY_BASE64` env var at process start, validated against checksum, held in process memory only; NO external KMS SDK at MVP per B1 lock
- Stripe: official `stripe` SDK with idempotency keys on subscription mutations (NFR-I2); webhook signature verification + replay protection (NFR-S4)
- Resend: official `resend` SDK with PT-localized templates (NFR-I4); only critical-tier alerts (FR48, NFR-Sc4 budget)
- Frontend: per-page vanilla-JS modules (NO bundler); CSS variable tokens from UX skeleton §10; Material Symbols Outlined via Google Fonts CSS import; NO frontend framework; audit-log endpoints designed to return discrete HTML fragments (HTMX-ready) to ease future enhancement layer

## Story 1.1 Acceptance Criteria
- Bob's Story 1.1: Scaffold project + configure both Coolify deploy targets + verify two-service skeleton end-to-end
- Initialization scope: scaffold directory tree; install dependencies; create Supabase project; configure Coolify two-service deploy; wire up master-key env var; seed ESLint config + JSDoc rule + one example annotated function
- Outputs: `npm run start:app` returns "Hello MarketPilot" page on `localhost:3000`; `npm run start:worker` writes heartbeat row to `worker_heartbeats` every 30 seconds; both services deployable to Coolify (one git push → two deploys); ESLint passes on example annotated function; one end-to-end test (Node test runner) verifies app responds 200 AND worker heartbeat row appears within 60s
- AD23-aligned scope addition: `worker_heartbeats` table + `/health` composition + UptimeRobot configuration ship with Story 1.1 alongside two-service scaffold so UptimeRobot has target from day 1

## Empirical Verification Reference Block
- All Mirakl decisions grounded in 2 corroborating sources: (1) MCP-documented behavior (Mirakl Marketplace APIs OpenAPI spec, `developer.mirakl.com/mcp`, queried 2026-04-30); (2) live empirical verification against Worten production via Gabriel's Easy-Store account (shop_id 19706), 2026-04-30, captured in `verification-results.json` (gitignored)
- Citation format: `[MCP: P11]`, `[Empirical: PT P11 ranked offers]`; assumption-based decisions flagged `[UNVERIFIED — calibrate during dogfood]`
- Verification script `scripts/mirakl-empirical-verify.js` is reusable; doubles as Bob's Story 1.X — Mirakl integration smoke test at first-customer onboarding

## Decision Priority Analysis
- Critical Decisions (block implementation if not resolved): AD1–AD22
- Important Decisions (shape architecture; spec-defining, not blocking): AD23–AD29
- Deferred Decisions (Epic 2 / triggered): documented in §Deferred Decisions, not numbered
