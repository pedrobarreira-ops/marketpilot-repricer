---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-04-30'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/ux-skeleton.md
  - _bmad-output/planning-artifacts/product-brief-marketpilot-repricer.md
  - _bmad-output/planning-artifacts/product-brief-marketpilot-repricer-distillate.md
  - CLAUDE.md
  - RESEARCH.md
referenceRepos:
  - 'D:\Plannae Project\DynamicPriceIdea — production P11 client (apiClient.js, scanCompetitors.js, fetchCatalog.js); reusable as foundation'
  - 'D:\Plannae Project\Gabriel - Marketplace — env loader (connectors/mirakl/config.ts) + lock pattern (worker/src/lock/job-lock.ts); engine math NOT reusable (cost-based, MarketPilot is list_price-anchored); offer-sync NOT reusable (uses OF24 forbidden footgun)'
workflowType: 'architecture'
project_name: 'marketpilot-repricer'
user_name: 'Pedro'
date: '2026-04-30'
preLockedDecisions:
  - 'A1: Stripe cancel_at_period_end=true at deletion initiation; manual goodwill refund only'
  - 'B1: App-layer envelope encryption (AES-256-GCM); master in Coolify env on Hetzner; ciphertext in Postgres; annual rotation ceremony + on-incident; 1Password cold backup; GitHub secret-scanning + pre-commit hook'
  - 'C: Single cron_state enum on customer_marketplace (PROVISIONING | DRY_RUN | ACTIVE | PAUSED_BY_CUSTOMER | PAUSED_BY_PAYMENT_FAILURE | PAUSED_BY_CIRCUIT_BREAKER | PAUSED_BY_KEY_REVOKED | PAUSED_BY_ACCOUNT_GRACE_PERIOD); per-SKU frozen_for_anomaly_review orthogonal; dispatcher predicate WHERE cron_state = ''ACTIVE''. PROVISIONING value added F4 (Step 7) for onboarding-scan transient state. UPPER_SNAKE_CASE per Step 5 pattern doc.'
  - 'Engine edge logic: single edge_step_cents=1 hardcoded MVP, schema-reserved per-marketplace, covers BOTH undercut and ceiling-raise; graceful floor degradation candidate=MAX(competitor-edge_step, floor); HOLD on tie; ceiling mirror MIN(competitor_2nd-edge_step, ceiling)'
  - 'Schema reservations for Epic 2 (no migration later): customer_marketplace.anomaly_threshold_pct, customer_marketplace.tier_cadence_minutes_override, customer_marketplace.edge_step_cents, sku_channel.cost_cents, sku_channel.excluded_at'
  - 'Tier 2b cadence: 45 min starting default in tier_cadence_minutes column'
  - 'PRI01/PRI02 race resolution: pending_set_price + pending_import_id; cooperative-absorption logic skips SKUs with in-flight imports'
  - 'Audit log: monthly partitioning + compound indexes + precomputed daily_kpi_snapshots and cycle_summaries tables (mandatory for NFR-P8 at projected volume)'
  - 'Customer profile schema: first_name, last_name, company_name all NOT NULL at signup; written atomically with Supabase Auth user creation (single transaction, no orphan auth-without-profile state); NIF deliberately deferred to invoice-generation moment'
  - 'Auth header format: raw Authorization: <key> on Worten Mirakl (NO Bearer prefix); confirmed via DynamicPriceIdea production client'
empiricallyResolvedFromReferenceRepos:
  - 'Channel codes WRT_PT_ONLINE / WRT_ES_ONLINE confirmed in production use (DynamicPriceIdea scanCompetitors.js)'
  - 'P11 per-channel pattern: pricing_channel_code AND channel_codes both set per call; channel bucketing determined by which call returned the offer (NOT by reading offer.channel_code or offer.channels — neither exists/populated for competitor offers)'
  - 'P11 batch lookup: product_references=EAN|xxx,EAN|yyy (NOT product_ids — silently returns 0 products if EANs passed there)'
  - 'P11 default page size: 10 offers; total_count tells you total; need only top 2 for repricing so default suffices'
  - 'P11 active filter: filter offer.active === true AND total_price finite AND > 0 (Worten returns placeholder offers with total_price=0)'
  - 'EAN resolution (3-strategy): product.product_references EAN entry, then product.product_sku, then single-EAN-batch fallback'
  - 'Retry: 5 retries on 429/5xx, exponential backoff 1s/2s/4s/8s/16s; transport errors retryable; 4xx non-retryable except 429'
mcpVerificationList:
  - 'Q1: PRI01 per-channel write mechanism (CSV with channel-code column? separate import per channel? global price?)'
  - 'Q2: Channel codes WRT_PT_ONLINE / WRT_ES_ONLINE — empirically confirmed; MCP-confirm to lock'
  - 'Q3: Cross-channel parity rules between PT and ES?'
  - 'Q4: P11 single-channel offer return (SKU exists PT but not ES, schema "channel = N/A")?'
  - 'Q5: all_prices array shape — empirically the production pattern is per-channel calls with pricing_channel_code, NOT reading all_prices array; confirm via MCP whether all_prices alternative exists'
  - 'Q6: Source of own-shipping cost per offer (OF21 returns it?)'
  - 'Q7: P11 / PRI01 rate limits + per-customer cadence ceiling for 100k+ catalogs'
  - 'Q8: KMS spec — resolved by B1 lock; spec writes the rotation procedure'
  - 'Q9: active=true offer filtering — empirically confirmed reliable; MCP-confirm semantics'
  - 'Q10: PRI01 partial-success / EAN mismatch / pricing-import failures — semantics, retry idempotency, PRI02 polling cadence + timeout'
  - 'Q11: P11 pagination — empirically default 10, max param exists; confirm max value via MCP'
  - 'Q12: PRI01 CSV exact format — column names, header row, UTF-8 BOM, decimal separator (PT comma vs dot)'
  - 'Q13: PRI01 idempotency — resubmit same EAN+price behavior'
  - 'Q14: Mirakl webhook / push notifications for external price changes (default polling regardless)'
  - 'Q15: Identifying own listing in P11 response (does Mirakl auto-exclude self? if not, capture own shop_name from OF21 and filter client-side)'
documentsExcluded:
  - 'OUTREACH.md (sales pipeline, not architecture-relevant per Pedro)'
  - 'PRICING.md (superseded historical pricing, not architecture-relevant per Pedro)'
---

# Architecture Decision Document — MarketPilot Repricer

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

_Pre-locked decisions and the MCP verification list are recorded in frontmatter and will be cited inline as numbered Architecture Decisions (AD1, AD2, …) traceable to PRD FR/NFR throughout subsequent sections._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (51 total across 7 buckets, all traced through UX skeleton)**

- **A. Account & Identity** (FR1–FR7) — self-serve signup, email verification, single-login-per-account, multi-step deletion + 7-day grace, RLS data isolation, founder admin read-only, source-context query-param capture for free-report funnel attribution.
- **B. API Key & Catalog Onboarding** (FR8–FR16) — single-purpose key entry, inline 5-second P11 validation, encrypted-at-rest storage, async catalog scan with reconnection, single onboarding margin question.
- **C. Pricing Engine** (FR17–FR25) — per-SKU per-channel state with `last_won_at` + `tier_cadence_minutes`, 4-state tier classification (T1 / T2a / T2b / T3), single-cron polling every 5 min, P11 ranking by `total_price` with `active=true` filter, list_price-anchored floor/ceiling computation, cooperative-ERP-sync absorption, PRI01-only writes with PRI02 polling, decision-table cases.
- **D. Engine Safety & Customer Controls** (FR26–FR33) — outbound circuit breaker (≤20% catalog/cycle, ≤15% per-SKU), nightly reconciliation as Tier 3 daily pass, inbound anomaly freeze (>40% deviation), dry-run by default with no time limit, informed-consent Go-Live modal, single-click pause/resume freeze-not-rollback semantics, baseline snapshot retention.
- **E. Dashboard & Audit Log** (FR34–FR39) — KPI cards mirroring free-report categories, PT/ES channel toggle, margin editor with worked-profit-example, audit log with hierarchical 5-surface IA (daily summary / atenção / notável / search-by-SKU / cycle-aggregated firehose), event-type taxonomy at three priority levels (Atenção / Notável / Rotina), Portuguese-localized banners.
- **F. Subscription & Billing** (FR40–FR44) — Stripe €50/marketplace/month, single-marketplace-MVP + concierge-add (no self-serve UI), 14-day money-back guarantee, Stripe-managed dunning, Moloni manual invoicing.
- **G. Operations & Alerting** (FR45–FR48) — `/health` UptimeRobot 5-min ping, 3-tier failure model (transient retry / per-SKU operational / critical alert+banner), founder admin monitoring dashboard, Resend critical-alert delivery ≤5 min.

**Non-Functional Requirements (driving architecture)**

- **Performance** — Tier 1 / Tier 2a cycle p95 ≤18 min (NFR-P1, NFR-P2); Tier 2b p95 ≤75 min; Tier 3 p95 ≤28h; PRI01→PRI02 within 30 min (NFR-P5); `/health` ≥99% uptime; audit log filtering ≤2s on 90-day window (NFR-P8) — load-bearing for the schema-design decisions on partitioning + precomputation; catalog scan 50k SKUs in 4h (NFR-P10, UNVERIFIED — MCP gate).
- **Security** — encryption-at-rest for `shop_api_key` (NFR-S1, the trust commitment we're selling); TLS 1.2+ everywhere; RLS at Postgres layer with regression test suite per deploy (NFR-S3); Stripe webhook signature + replay protection (NFR-S4); audit log append-only at application layer (NFR-S6); zero card data stored (NFR-S7).
- **Scalability** — 5–10 customers at MVP scaling to 50 in Epic 2 without architectural rework (NFR-Sc1); 50k → 100k+ SKU catalogs (NFR-Sc2); single-cron + per-SKU `tier_cadence_minutes` supports horizontal worker scale via advisory-lock-or-similar (NFR-Sc3); free-tier capacity sufficient for MVP across Resend/Supabase (NFR-Sc4–Sc5).
- **Reliability** — RTO 30 min documented in rollback playbook (NFR-R2); RPO ≤24h via Supabase daily backups (NFR-R3) — audit log durability matches general state at MVP, with append-only semantics preserved independent of durability tier; 3-tier failure model + Portuguese-localized banner during sustained transients (NFR-R5).
- **Integration Quality** — Mirakl MCP-verified rate limits and pacing pre-launch (NFR-I1); Stripe idempotency keys + idempotent webhook handler (NFR-I2); RLS regression suite per deploy (NFR-I3); Resend with PT-localized templates (NFR-I4); cross-repo handoff with DynamicPriceIdea via signup query params (NFR-I6) — no shared schema, no shared DB, no shared deployment pipeline (deliberate isolation due to different security postures).
- **Accessibility / Localization** — WCAG 2.1 AA practical baseline (NFR-A1); audit log screen-reader readable (NFR-A3); PT-default UI, ES UI deferred to Epic 2 (NFR-L1, NFR-L2).
- **Operational Quality Attributes** — rollback playbook + 30-min response SLA, solo-founder continuity runbook, Day-1 active-monitoring protocol — all founder-side commitments tied to product surfaces.

**UX Skeleton (38 UX requirements)** layers onto the FRs. Architecturally load-bearing items: 5-surface audit log IA (UX7–UX12); banner stacking precedence + paused-state visual distinction (UX4, UX5); margin editor SKU-selection rule + stated-margin assumption (UX15, UX18); founder admin status page composition (UX28–UX30); mid-life key-revocation interception (UX31); payment-failure interception (UX32); scan-readiness summary (UX33–UX34); account-deletion 4-step flow (UX35–UX37); add-marketplace concierge (UX38).

### Scale & Complexity

- **Project type:** SaaS B2B, multi-tenant from day 1, integration-heavy backend, trust-critical (full-account-access API keys + automated price-setting agency).
- **Complexity:** medium-high. No regulator approval gate, no real-time-safety-critical path. Real complexity in (a) trust architecture (KMS, RLS, encrypted vault, 4-layer write safety), (b) Mirakl integration edge cases (per-channel pricing, async PRI01/PRI02, OF24 footgun, unverified rate limits), (c) engine decision table, (d) audit-log volume math at the projected ~3M entries/quarter/customer.
- **Architectural components (logical):** auth/RLS layer, encrypted key vault + KMS envelope, Mirakl integration client (P11, OF21, PRI01, PRI02), repricing engine + tier dispatcher + cooperative-absorption, 4-layer safety stack (tier system + circuit breaker + nightly reconciliation + anomaly freeze), audit log + precomputed aggregates, customer dashboard + audit-log UI, Stripe + Moloni billing integration, Resend alerting + UptimeRobot health, account-lifecycle workflow (signup → onboarding → dry-run → Go-Live → pause → cancellation → deletion grace → hard delete), founder admin status page.
- **Primary technical domain:** Node.js Fastify backend + Postgres + cron worker + browser dashboard. Multi-service single-deploy on Hetzner via Coolify; Postgres + Auth + RLS on Supabase Cloud EU.

### Technical Constraints & Dependencies

**Hard constraints (non-negotiable):**
- Stack: Node.js >=22, Fastify, Postgres. No framework swap.
- Hosting: Hetzner via Coolify + Supabase Cloud EU. No AWS / GCP / Azure at MVP.
- Mirakl access: MMP only; direct shop API key; no MiraklConnect.
- Price writes: PRI01 only; OF24 forbidden (resets unspecified offer fields).
- Encryption-at-rest for `shop_api_key`: zero-plaintext-keys-at-rest verified pre-launch and ongoing.
- Mirakl MCP verification mandate: all Mirakl behavior verified via MCP before architecture lock — applies to all agents (PM, ARCH, dev, code-review).

**Cross-org boundary:** customer Mirakl keys live at Supabase (their infra) while the application + worker live on Hetzner (your infra). DPA + ToS + Privacy Policy must reflect this. KMS architecture (B1 lock) keeps the encryption master on Hetzner so Supabase data leak alone never compromises customer keys — preserves the trust property.

**Code-reuse foundation:**
- **Reused from DynamicPriceIdea (production-tested):** Mirakl HTTP client + retry/backoff (`apiClient.js`), P11 batch scanner with per-channel pattern (`scanCompetitors.js`), EAN resolution strategy, channel-bucketing pattern, error classification → safe Portuguese messages.
- **Reused from Gabriel:** env-loader pattern (`connectors/mirakl/config.ts`); lock pattern as starting reference (`worker/src/lock/job-lock.ts`) — though MarketPilot will use Postgres advisory locks per-customer instead of single-row pseudo-mutex for NFR-Sc3 horizontal scale.
- **Net-new (no reuse):** PRI01 multipart-CSV writer, PRI02 poller with race-resolution semantics, cooperative-ERP-sync absorption logic, 4-state tier engine with `last_won_at`-driven transitions, per-customer advisory-lock dispatcher, multi-tenant RLS schema, encrypted key vault + envelope encryption + rotation ceremony, audit log + monthly partitioning + precomputed daily-KPI / cycle-summary aggregates, customer dashboard + 5-surface audit-log UI, Stripe + Moloni integration, founder admin status page, account-deletion grace-period workflow.

### Cross-Cutting Concerns

- **Tenant isolation** — RLS on every customer-scoped table; service-role-key usage limited to repricer-worker + operator-only admin endpoints; tested with deliberate cross-tenant access attempts; regression suite per deploy.
- **Trust as architectural property** — encrypted-at-rest keys, append-only audit log at application layer, dry-run-by-default, informed-consent self-flip Go-Live, customer-self-service investigation via 5-surface audit log. Every architectural decision is evaluated against "does this preserve or erode the trust property?" — including durability, observability, and key-rotation procedures.
- **Async-everywhere posture** — PRI01 async (PRI02 polling), catalog scan async (server-side job state, customer can disconnect/reconnect), cron cycles independent. No synchronous customer-facing operation blocks on Mirakl beyond key validation (5-second test P11 call).
- **State machine clarity** — single `cron_state` enum on `customer_marketplace` row drives banner UX, audit-log filtering, and cron dispatch query (`WHERE cron_state = 'ACTIVE'`). Per-SKU `frozen_for_anomaly_review` orthogonal, never folded into the customer-level state.
- **Localization** — PT-first; every customer-facing copy block traces to UX skeleton §9 microcopy specs. ES UI is Epic 2 trigger.
- **Mirakl MCP verification gate** — 15-question list (10 from distillate §16 + 5 added) blocks schema lock until MCP-verified or empirically resolved from reference repos. Frontmatter tracks each item's status.
- **Failure-mode propagation** — 3-tier failure model with explicit per-tier semantics; circuit breaker + anomaly freeze are independent layers, testable in isolation; Portuguese-localized banner triggers on sustained transient failures.
- **Audit-log volume reality** — ~3M entries/quarter/customer at production catalog scale demands monthly partitioning + compound indexes + precomputed aggregates from day 1. Computing daily summaries on demand against multi-million-row tables blows the NFR-P8 2s budget.
- **Schema reservations for Epic 2** — five columns reserved at MVP schema design (`customer_marketplace.anomaly_threshold_pct`, `customer_marketplace.tier_cadence_minutes_override`, `customer_marketplace.edge_step_cents`, `sku_channel.cost_cents`, `sku_channel.excluded_at`) so Epic 2 features ship without migration.

> **Note for step 6 (Structure / Schema):** Customer profile fields (`first_name`, `last_name`, `company_name`) are NOT NULL MVP requirements written atomically with the Supabase Auth user creation. They are NOT Epic 2 reservations and belong directly in the customer/profile table — surface them at the schema-design step.

### Operating Principle for the Rest of This Spec

**Every architectural decision in this document must have a clear "this becomes a Bob story" trace.** The spec is the WHAT (data model, module boundaries, integration contracts, decision rules); Bob (SM agent) translates each WHAT into the HOW (shell commands, Coolify config steps, file edits, test acceptance criteria) when sharding into stories. Where a decision implies a piece of operational setup (e.g., "Coolify deploys two service instances"), the spec names the requirement, not the click-path. The dev-facing translation lands in Bob's story sharding, not here.

This is load-bearing because the developer Pedro (founder) is not implementing — the BAD pipeline is, with subagents reading these stories cold. Architectural ambiguity in this doc translates directly to BAD subagent confusion downstream. Precision here = velocity there.

## Starter Template Evaluation

### Honest Framing

The stack is pre-locked by PRD constraints. There is no "starter template selection" decision — the choices have been made: Node.js ≥22, Fastify, Postgres on Supabase Cloud EU, Hetzner via Coolify, no AWS/GCP/Azure, MMP-only, PRI01-only. What this step actually delivers is the **scaffold structure and dependency baseline** — the inventory of npm packages and the project layout that downstream stories will assume.

### Primary Technology Domain

Multi-service Node.js backend (`app.marketpilot.pt` Fastify + `repricer-worker` cron service) talking to Postgres on Supabase Cloud EU. Customer-facing UI is server-rendered HTML with light vanilla-JS interaction layers. Mirakl integration client reuses production-tested code from DynamicPriceIdea.

### Frontend Approach (deliberate decision — locked)

**Server-rendered HTML + vanilla JS + CSS tokens, no SPA framework.** Rationale:

1. **Velocity datapoint precedent.** DynamicPriceIdea (`marketpilot.pt` free report, in production) is built on Fastify + vanilla HTML/JS/CSS, no build step. It is the stated 9-months-to-1-week velocity datapoint. Replicating the same shape preserves that velocity.
2. **Visual DNA already targets it.** UX skeleton §10 binds the visual system to `MarketPilot.html` — a single HTML document with embedded CSS tokens, Material Symbols Outlined icons, and the `Manrope/Inter/JetBrains Mono` type stack. No React component conventions, no build pipeline assumed.
3. **Bundle weight matches NFR-P7.** Mobile rendering target ≤4s on 3G (NFR-P7). A SPA framework + bundler adds 100–300KB before any feature code; vanilla pages stay sub-100KB end-to-end.
4. **Interactivity surface is bounded.** The most interactive surfaces are the margin editor (~150ms-debounced live worked-profit-example), the audit log filters (server-paginated), pause/resume buttons, and modals. None of these need framework-grade reactivity. Per-page small JS modules suffice.
5. **No build step = simpler deploy.** Coolify runs `node app/src/server.js` — no `npm run build`, no asset compilation, no source maps to manage. Reduces deploy surface.

> **Future-consideration footnote (NOT a current dependency):** if at Epic 2 the audit log's 5-surface IA feels gnarly to maintain (server-rendered fragment swaps for filters + pagination + search-by-SKU could grow imperative), **HTMX** is the obvious enhancement layer before reaching for React. ~14KB, no build step, plays well with Fastify + eta. Worth flagging here so the audit-log code at MVP is written with "HTMX-ready URL conventions" in mind (e.g., filter actions return discrete HTML fragments, not full pages).

### Initialization (no `npx create-*` command)

This project is not bootstrapped from a starter CLI. It is hand-scaffolded with explicit dependencies — pinned at scaffold time to current major versions:

```bash
# Application + worker (single npm package, two entry points)
npm init -y
npm pkg set engines.node=">=22.0.0"
npm pkg set type="module"

# Server + worker runtime
npm install fastify @fastify/static @fastify/view @fastify/rate-limit @fastify/cookie @fastify/csrf-protection eta pino pg @supabase/supabase-js

# Mirakl + integrations
npm install stripe resend

# Cron scheduling (worker)
npm install node-cron

# Crypto: Node built-in `node:crypto` (AES-256-GCM) — no extra dep

# Validation: Fastify built-in JSON Schema validation (`fastify.addSchema` / route `schema:`) — no extra dep at MVP

# Dev
npm install --save-dev eslint
```

(Versions verified at scaffold time via `npm view <pkg> version`. No version pinning in this doc — that's `package-lock.json`'s job.)

### Project Structure (single npm package, two entry points — locked)

Per distillate §13 ("No monorepo. If shared logic emerges, extract a small npm package — don't preempt the abstraction") and Pedro's confirmation that no Coolify projects pre-exist:

```
marketpilot-repricer/
├── package.json                # single package; npm run start:app / start:worker
├── app/
│   └── src/
│       ├── server.js           # Fastify app entry — `npm run start:app`
│       ├── routes/             # /signup, /login, /onboarding/*, /, /audit, /settings/*, /admin/status
│       ├── views/              # eta templates (PT-localized)
│       ├── middleware/         # auth, RLS-context binding, source-context capture, CSRF
│       └── lib/                # app-only helpers (session, csrf, view-helpers)
├── worker/
│   └── src/
│       ├── index.js            # cron entry — `npm run start:worker`
│       ├── dispatcher.js       # per-customer advisory-lock dispatch (5-min poll)
│       ├── engine/             # tier classification + decision table + cooperative-absorption
│       ├── safety/             # circuit breaker + anomaly freeze + reconciliation
│       └── lib/                # worker-only helpers (heartbeat, batch utilities)
├── shared/
│   ├── mirakl/                 # P11 + PRI01 + PRI02 + OF21 (reused/adapted from DynamicPriceIdea)
│   ├── crypto/                 # AES-256-GCM envelope encryption + master-key loader
│   ├── audit/                  # audit-log writers + readers + precomputed-aggregate updaters
│   └── db/                     # Supabase client factories (RLS-aware for app, service-role for worker)
├── db/
│   ├── migrations/             # Supabase CLI-managed SQL migrations
│   └── seed/                   # local-dev seed scripts
├── public/
│   ├── css/                    # tokens.css, layout.css, components.css (carrying free-report DNA)
│   └── js/                     # per-page modules: dashboard.js, audit.js, margin-editor.js, etc.
├── scripts/                    # ops scripts (key rotation ceremony, RLS regression suite, etc.)
└── tests/                      # Node test runner (built-in `node --test`)
```

**Two service processes from one image.** Coolify is configured to deploy this single git repo as **two service instances**: one running `npm run start:app` (port 3000, exposed as `app.marketpilot.pt`), one running `npm run start:worker` (no public port). Same image, different start commands, shared environment variables.

→ This becomes Bob's **Story 1.1: Scaffold the project + configure both Coolify deploy targets + verify two-service skeleton end-to-end**.

### Architectural Decisions Provided by Scaffold

**Language & Runtime:** JavaScript ESM (`"type": "module"`), Node.js ≥22, **no TypeScript at MVP**. Rationale: DynamicPriceIdea is JS-ESM; matching keeps shared-code reuse trivial. TypeScript migration is a future option (`*.js` → `*.ts` rename + cleanup, not a rewrite) if churn demands it.

> **Coding convention — JSDoc type hints required.** All exported functions must carry JSDoc `@param` / `@returns` / `@throws` annotations. Critical financial / state-mutation functions (margin math, decimal-separator handling, PRI01 CSV serialization, cron-state transitions, encryption helpers) carry richer JSDoc with `@typedef` for shapes. JSDoc costs almost nothing per function, gives AI-assisted dev (Claude Code reads JSDoc reliably) and IDE inline hints partial type safety, and makes the eventual TypeScript migration a `.ts` rename rather than a rewrite. ESLint config enforces this on `shared/`, `app/src/`, `worker/src/` exports. **Bob's Story 1.1 includes seeding the ESLint rule and one example fully-annotated function.**

**Web Framework:** Fastify v5 (matches DynamicPriceIdea). `@fastify/view` + `eta` for server-side templating; `@fastify/static` for `/public`; `@fastify/rate-limit` on signup + key-validation endpoints; `@fastify/cookie` + `@fastify/csrf-protection` for session security.

**Validation:** **Fastify built-in JSON Schema validation** (route-level `schema:` config). No additional library at MVP. Sufficient for signup, key-entry, margin-editor save, anomaly-review accept/reject, deletion-confirmation form validation. If at Epic 2 a validator surface emerges that JSON Schema can't express ergonomically, revisit (zod is the obvious candidate). Specified here so Bob's stories don't reach for a validator dep by reflex.

**Database Access:** Two patterns by service:
- **App** uses `@supabase/supabase-js` with the customer's JWT bound at request scope so RLS policies fire automatically. Service-role key NEVER exposed to the customer-facing path.
- **Worker** uses `pg` (canonical Postgres driver) directly with the service-role connection string. Allows raw `pg_try_advisory_lock(customer_id)` calls and bypasses RLS for cross-customer cron work. Uses `@supabase/supabase-js` only for auth-system reads when needed.

→ Bob's stories around RLS regression testing must explicitly verify: (a) app server cannot reach across tenants even with a malformed route; (b) worker advisory-lock pattern blocks duplicate per-customer dispatch.

**Migrations:** Supabase CLI conventions (`db/migrations/*.sql`). Drizzle was considered (DynamicPriceIdea uses it) and rejected for this repo: Supabase's migration tooling integrates with their dashboard, RLS policy management, and is the documented path. Drizzle's TS-only ergonomics also conflict with the JS-ESM-with-JSDoc convention above.

**Templating:** `eta` (lightweight, async-friendly). All customer-facing templates default-localize to PT (NFR-L1). Spanish UI templates deferred to Epic 2 (NFR-L2).

**Test Framework:** Built-in `node --test` runner (matches DynamicPriceIdea). No Jest/Vitest dependency. Playwright considered for Epic 2 if E2E coverage gap emerges.

**Linting/Formatting:** ESLint with thin config (incl. JSDoc rule above). No Prettier at MVP (one less config to maintain at solo-founder scale).

**Logging:** `pino` (already in DynamicPriceIdea's `apiClient.js`); structured JSON to stdout, Coolify captures.

**Process Management:** Coolify handles process lifecycle, restart-on-crash, zero-downtime deploys. No pm2 or systemd.

**Cron:** `node-cron` for the master 5-min poll inside the worker process; per-customer dispatch internal to the worker.

**Encryption:** Node's built-in `node:crypto` (`createCipheriv`/`createDecipheriv` with `aes-256-gcm`). Master key loaded from `MASTER_KEY_BASE64` env var at process start, validated against checksum, held in process memory only. No external KMS SDK at MVP per B1 lock.

**Stripe:** Official `stripe` SDK with idempotency keys on subscription mutations (NFR-I2); webhook signature verification + replay protection (NFR-S4).

**Resend:** Official `resend` SDK with PT-localized templates (NFR-I4); only critical-tier alerts (FR48, NFR-Sc4 budget).

**Frontend:** Per-page vanilla-JS modules (no bundler). CSS variable tokens from UX skeleton §10. Material Symbols Outlined via Google Fonts CSS import. No frontend framework. Audit-log endpoints designed to return discrete HTML fragments (HTMX-ready) to ease future enhancement layer.

→ **Bob's Story 1.1 acceptance criteria.** Project initialization (scaffold the directory tree, install dependencies, create the Supabase project, configure Coolify two-service deploy, wire up the master-key env var, seed ESLint config + JSDoc rule + one example annotated function) outputs:
- `npm run start:app` returns a "Hello MarketPilot" page on `localhost:3000`
- `npm run start:worker` writes a heartbeat row to `worker_heartbeats` every 30 seconds
- Both services are deployable to Coolify (one git push → two deploys)
- ESLint passes on the example annotated function
- One end-to-end test (Node test runner) verifies the app responds 200 and the worker heartbeat row appears within 60s

## Core Architectural Decisions

This section enumerates each numbered Architecture Decision (ADn) with: the decision; the FR/NFR it serves; the citation grounding it (MCP-doc fact, empirical-verification result, or pre-locked decision); and the Bob-story trace where applicable. Decisions cluster by problem area, not by template-generic categories.

### Empirical Verification Reference Block

All Mirakl-touching decisions in this section are grounded in **two corroborating sources**: (1) MCP-documented behavior (Mirakl Marketplace APIs OpenAPI spec, `developer.mirakl.com/mcp`, queried 2026-04-30), and (2) live empirical verification against Worten production via Gabriel's Easy-Store account (shop_id 19706), 2026-04-30, captured in `verification-results.json` (gitignored). Citations format: `[MCP: P11]`, `[Empirical: PT P11 ranked offers]`, etc. Where a decision rests on assumption (no MCP confirmation, no live data), it is explicitly flagged as `[UNVERIFIED — calibrate during dogfood]`.

The verification script `scripts/mirakl-empirical-verify.js` is reusable: it doubles as **Bob's Story 1.X — Mirakl integration smoke test** that runs at first-customer onboarding to assert the same architectural prerequisites.

### Decision Priority Analysis

**Critical Decisions (block implementation if not resolved):** AD1–AD22.
**Important Decisions (shape architecture; not blocking but spec-defining):** AD23–AD29.
**Deferred Decisions (Epic 2 / triggered):** documented in §Deferred Decisions below; called out individually but not numbered as ADs because their architectural shape lands when the trigger fires, not now.

---

### A. Service Topology, Tenancy, and Trust Architecture

#### AD1 — Two services, one repo, one image, two start commands

Single npm package with `app/` and `worker/` entry points (`npm run start:app` / `npm run start:worker`). Coolify deploys two service instances from the same git repo: `app.marketpilot.pt` (Fastify, public, port 3000) and `repricer-worker` (cron, no public URL). They share the same image and codebase; differentiation is the start command + per-service env-var subset.

- **Why:** matches distillate §13 ("no monorepo"), preserves shared-code reuse trivially (`shared/` symlinked into both build trees), and Coolify supports it via per-service start-command override.
- **Affects:** FR45 (/health), NFR-Sc1 (5–10 customers MVP), NFR-Sc3 (horizontal scale).
- **Bob trace:** Story 1.1 scaffolds the structure and configures Coolify two-service deploy.

#### AD2 — Multi-tenant isolation enforced at Postgres RLS layer; client/worker connection split

- **App** uses `@supabase/supabase-js` with the customer's JWT bound at request scope. RLS policies fire automatically on every query. **Service-role key NEVER reaches the customer-facing code path.**
- **Worker** uses `pg` directly with the service-role connection string. Allows raw `pg_try_advisory_lock(customer_id)` calls and bypasses RLS for cross-customer cron work. Uses `@supabase/supabase-js` only for auth-system reads when needed.
- Every customer-scoped table carries an RLS policy keyed on `customer_id`. The policy set is regression-tested on every deploy via `scripts/rls-regression-suite.js`.

- **Why:** PRD NFR-S3 (RLS at DB layer), NFR-I3 (RLS regression per deploy), and the trust-architecture commitment (FR5 / FR6).
- **Affects:** every customer-scoped data access in the app; every cross-customer query in the worker.
- **Bob trace:** Story 2.1 (RLS policy seed + first regression test); Story 2.x (RLS regression suite covering every customer-scoped table; runs in CI on every deploy).

#### AD3 — Encrypted shop_api_key vault: app-layer envelope encryption (B1 lock)

AES-256-GCM envelope encryption. Master key (`MASTER_KEY_BASE64`) loaded from Coolify environment at process start; held in process memory only; never written to disk; never logged. Each customer's `shop_api_key` is encrypted with the master and stored as ciphertext + nonce + auth tag in `shop_api_key_vault`. Decryption is on-demand, scoped to the worker process during cron cycles only — the app server never holds plaintext.

- **Master key custody:** Coolify-managed env var (encrypted at rest by Coolify on Hetzner disk). Cold backup: 1Password vault, founder-only access.
- **Rotation cadence:** annual ceremony. On-demand rotation if compromise suspected. Procedure (locked in spec, runbook in `scripts/rotate-master-key.md`):
  1. Generate new master key with `openssl rand -base64 32`.
  2. Coolify deploys new master as `MASTER_KEY_BASE64_NEXT` (alongside existing `MASTER_KEY_BASE64`).
  3. Worker process re-encrypts every `shop_api_key_vault` row: decrypt with `MASTER_KEY_BASE64`, re-encrypt with `MASTER_KEY_BASE64_NEXT`, atomic swap. Concurrency-safe via per-row advisory lock (uses customer_id).
  4. Coolify swap: rename `MASTER_KEY_BASE64_NEXT` → `MASTER_KEY_BASE64`, delete old.
  5. 1Password backup updated.
- **Repo defense:** GitHub secret-scanning enabled; pre-commit hook (`scripts/check-no-secrets.sh`) blocks commits matching `MASTER_KEY|shop_api_key|sk_live_|sk_test_` patterns.
- **Verification:** zero plaintext key occurrences in DB dumps (asserted pre-launch and ongoing).

- **Why:** PRD NFR-S1 (encryption-at-rest non-negotiable), the trust commitment we're selling, and CLAUDE.md's "trust-critical component" mandate.
- **Affects:** FR8 (key entry), FR9 (validation), FR11 (encryption at rest), every Mirakl call from the worker.
- **Bob trace:** Story 1.2 (envelope encryption helpers + master-key loader + secret-scanning hook). Customer-facing key-entry form + encryption pipeline lands in Epic 4 (Story 4.3 — onboarding key entry), NOT Story 1.3; Story 1.3 owns pino redaction (per AD27).

#### AD4 — Founder admin access via service-role bypass + role flag, never customer impersonation

A `founder_admins` table holds rows for elevated users. `/admin/*` routes verify the requesting user's email is in `founder_admins` AND uses the service-role DB connection server-side only. The customer-facing audit log UI is reused at `/audit?as_admin={customer_id}` with a red admin-mode banner; no separate UI is built. Founder NEVER logs in as a customer impersonator at MVP — all admin queries are read-only.

- **Why:** PRD FR6, FR47, NFR-O3; UX skeleton §UX28–UX30 specify the read-only posture and reuse pattern.
- **Affects:** /admin/status page composition, audit-log query shape, service-role-key access pattern.
- **Bob trace:** Story 1.5 (founder_admins table + seed migration + admin-route middleware that checks email membership); Story 8.10 (admin status page UI reusing the customer-facing audit log with `?as_admin=` parameter).

---

### B. Mirakl Integration

#### AD5 — Mirakl HTTP client reused from DynamicPriceIdea, adapted for multi-tenant

`shared/mirakl/api-client.js` is forked from DynamicPriceIdea's [`src/workers/mirakl/apiClient.js`](file:///d:/Plannae%20Project/DynamicPriceIdea/src/workers/mirakl/apiClient.js):

- **Auth header:** raw `Authorization: <api_key>` (NO Bearer prefix). [Empirical: confirmed on all 6 Worten calls in the verification run.]
- **Retry schedule:** 5 retries, exponential backoff `[1s, 2s, 4s, 8s, 16s]`. Retryable on 429 + 5xx + transport errors. Non-retryable on 4xx (except 429). Max attempt cap is 30s per delay.
- **Error classification:** `MiraklApiError` carries `status` (HTTP status code; 0 for transport). `getSafeErrorMessage(err)` returns PT-localized customer-facing strings; raw error text never reaches the customer.
- **Adaptation:** apiKey is a function parameter, never module-scope. The worker decrypts the customer's key at cycle start, passes it through `mirAklGet(...)`, never logs it.

- **Why:** production-tested code, covers retry/backoff per NFR-I1, satisfies the safety constraint that error responses don't leak operator-side detail (NFR-S1 trust posture).
- **Affects:** every Mirakl call (P11, OF21, A01, PC01, PRI01, PRI02, PRI03).
- **Bob trace:** Story 3.1 (port `apiClient.js` + tests + JSDoc annotation).

#### AD6 — Per-channel pricing model: `channel_pricing_mode` enum on customer_marketplace; Worten = SINGLE at MVP

- Schema column `customer_marketplace.channel_pricing_mode` enum: `'SINGLE' | 'MULTI' | 'DISABLED'`. Captured from PC01 at onboarding; persisted; checked at engine dispatch.
- **For Worten:** value is `'SINGLE'`. [Empirical: PC01 returned `channel_pricing: SINGLE`.] Engine writes one price per (SKU, channel). MULTI's tiered pricing capability is unused.
- **For DISABLED operators (future):** schema collapses to one price per SKU; engine ignores the channel dimension; PT/ES toggle becomes vestigial. Detected at onboarding and routed to a different code path.
- The engine reasons per-(SKU, channel) regardless of mode. The schema row is `sku_channel(customer_marketplace_id, sku_id, channel_code, ...)`. For DISABLED, only one channel_code (`'DEFAULT'`) row per SKU exists.

- **Why:** PRD FR25 (per-channel repricing for Worten PT vs ES); MCP-documented PC01 enum [MCP: PC01 features.pricing.channel_pricing]; empirical Worten value [Empirical: PC01]. Schema reservation for Epic 2 multi-marketplace where other operators may differ.
- **Affects:** every per-(SKU, channel) operation; engine dispatch; dashboard PT/ES toggle (UX skeleton UX14); audit-log per-channel filtering.
- **Bob trace:** Story 4.1 (PC01 onboarding capture + channel_pricing_mode persistence + engine dispatch branching).

#### AD7 — PRI01 writer: per-SKU aggregation, delete-and-replace semantic, pending_import_id atomicity

The PRI01 CSV writer is a per-SKU operation, even though the engine reasons per-(SKU, channel). Mechanic:

1. **Write boundary is per-SKU.** When the engine flags any (SKU, channel) for write in cycle N, the writer loads ALL `sku_channel` rows for that SKU's customer_marketplace_id, builds the CSV with one line per active channel (updated channels carry the new price; untouched channels pass through `last_set_price` so they're not deleted), and submits the full SKU's price set. [MCP: PRI01 — "import mode is delete and replace; any existing price that is not submitted will be deleted."]
2. **CSV column set (Worten MVP):** `offer-sku;price;channels` only. NO discount-start-date / discount-end-date / start-date / end-date / price-ranges columns. [Empirical: PC01 returned `discount_period_required: false`, `scheduled_pricing: false`, `volume_pricing: false`.]
3. **Delimiter:** `;` (semicolon). [Empirical: PC01 returned `operator_csv_delimiter: SEMICOLON`.] Captured per-marketplace in `customer_marketplace.operator_csv_delimiter` so the writer reads the live value, never a hardcoded default.
4. **Decimal precision:** 2 decimals. [Empirical: PC01 returned `offer_prices_decimals: "2"`.] Persisted in `customer_marketplace.offer_prices_decimals`.
5. **Decimal separator:** ASCII period (`.`) per CSV standard. [UNVERIFIED for Worten — calibrate empirically during dogfood; `verification-results.json` did not exercise PRI01 since writes are forbidden.] If dogfood reveals comma, the writer reads from a per-marketplace config column.
6. **`channels` column format:** pipe-separated channel codes (e.g., `WRT_PT_ONLINE|WRT_ES_ONLINE`) for the channels the line applies to; empty for default-channel pricing. For Worten SINGLE mode, every line carries its specific channel code. [MCP: PRI01 examples — Channel Pricing pattern.]
7. **`shop_sku` is the value in the `offer-sku` column.** The seller-provided SKU (e.g., `EZ8809606851663`) is what Mirakl maps the line back to internally. [Empirical: OF21 returned `shop_sku: "EZ8809606851663"` for the test offer; `offer_sku: null`; `product_sku` is Mirakl's internal UUID, NOT the seller SKU.]
8. **Pending-import atomicity:** at the moment of submitting a PRI01 batch, EVERY `sku_channel` row that participates in the batch (including channel rows whose price isn't changing — they appear as passthrough lines) gets `pending_import_id = <import_uuid>` set. This makes the cooperative-absorption logic's "skip-on-pending" predicate work correctly during in-flight imports. PRI02 COMPLETE clears `pending_import_id` for all rows in that batch atomically; PRI02 FAILED clears `pending_import_id` AND triggers per-SKU error handling per AD27.
9. **Recovery from PRI03 partial failures is per-SKU resubmit.** When PRI03 reports SKU001 line N failed, the writer DOES NOT resubmit just line N — it rebuilds SKU001's full multi-channel set with the corrected line and resubmits the whole SKU.

- **Why:** PRD FR23 (PRI01-only writes, PRI02 polling, PRI01 partial-success handling); MCP-documented per-SKU delete-and-replace semantic [MCP: PRI01]; empirical Worten CSV/delimiter/decimal config [Empirical: PC01]; the cooperative-ERP-sync race-condition resolution from pre-locked decisions.
- **Affects:** every PRI01 emission; the `sku_channel` schema (`pending_import_id`, `pending_set_price` columns); cooperative-absorption logic; PRI03 retry path.
- **Bob trace:** Story 6.1 (PRI01 CSV writer + per-marketplace config consumption + pending_import_id atomicity); Story 6.2 (PRI02 poller + COMPLETE/FAILED handling); Story 6.3 (PRI03 error report parser + per-SKU rebuild + retry).

#### AD8 — Engine decision table (the PRD gap, fully enumerated)

Closes the PRD gap where FR24 references "documented decision-table cases" but never enumerates them. This is the binding spec for the engine's per-(SKU, channel) decision per cycle.

```
INPUTS
  ean                         SKU's EAN
  channel                     current channel (e.g., 'WRT_PT_ONLINE')
  list_price                  engine's anchor price for (SKU, channel)
  current_price               last-known own price on this channel from P11 read
  last_set_price              last price we successfully pushed (post PRI02 COMPLETE)
  max_discount_pct,
  max_increase_pct            customer's tolerance bands (per-marketplace at MVP)
  edge_step_cents             1 (MVP default; per-marketplace config column for Epic 2)
  own_shop_name               customer_marketplace.shop_name (captured from A01)
  anomaly_threshold_pct       0.40 (MVP default; per-marketplace config column for Epic 2)

PRECONDITIONS (all must hold; if any false, SKIP this SKU this cycle)
  customer_marketplace.cron_state = 'ACTIVE'
  sku_channel.frozen_for_anomaly_review = false
  sku_channel.pending_import_id IS NULL                   ← AD7 atomicity
  sku_channel.excluded_at IS NULL                         ← Epic 2 reservation

STEP 1 — read competitor data via P11 for (ean, channel)
  P11(product_references=EAN|<ean>, channel_codes=<channel>, pricing_channel_code=<channel>)
  filter offers: o.active === true AND o.total_price > 0       ← MANDATORY (AD14)
  filter offers: o.shop_name !== own_shop_name                 ← defensive self-filter (AD13)
  rank ascending by total_price (Mirakl default; verify explicitly)
  if no remaining offers: tier = 3, no write, audit_log: 'tier-transition' (Rotina)

STEP 2 — cooperative-ERP-sync detection (AD9)
  if current_price != last_set_price (and pending_import_id IS NULL):
    deviation_pct = abs((current_price - list_price) / list_price)
    if deviation_pct > anomaly_threshold_pct:
      sku_channel.frozen_for_anomaly_review = true
      audit_log: 'anomaly-freeze' (Atenção, FR29)
      Resend critical alert (FR48)
      return HOLD (no write)
    sku_channel.list_price = current_price                     ← absorb as new baseline
    audit_log: 'external-change-absorbed' (Notável)

STEP 3 — compute floor and ceiling (rounded conservatively to offer_prices_decimals)
  floor_price   = ROUND_UP(list_price * (1 - max_discount_pct), decimals)
  ceiling_price = ROUND_DOWN(list_price * (1 + max_increase_pct), decimals)
  // ROUND_UP for floor (never below raw floor); ROUND_DOWN for ceiling (never above raw ceiling)

STEP 4 — branching by position
  competitor_lowest = ranked[0].total_price
  competitor_2nd    = ranked[1]?.total_price ?? null
  position          = our rank in {ranked + own offer at current_price+min_shipping}

  CASE A — position > 1  (we're contested)
    target_undercut_price = competitor_lowest - (edge_step_cents / 100)
    candidate_price       = MAX(target_undercut_price, floor_price)
    if candidate_price < competitor_lowest:
      action    = UNDERCUT
      new_price = candidate_price
      audit_log: 'undercut-decision' (Rotina)
    else:
      action = HOLD                                            ← can't undercut profitably
      audit_log: 'hold-floor-bound' (Rotina)

  CASE B — position == 1  (we're winning; ceiling-raise logic)
    if competitor_2nd is null:
      action = HOLD                                            ← no 2nd-place target
      audit_log: 'hold-already-in-1st' (Rotina)
    else:
      target_ceiling_price = competitor_2nd - (edge_step_cents / 100)
      new_ceiling_price    = MIN(target_ceiling_price, ceiling_price)
      if new_ceiling_price > current_price:
        action    = CEILING_RAISE
        new_price = new_ceiling_price
        audit_log: 'ceiling-raise-decision' (Rotina)
      else:
        action = HOLD
        audit_log: 'hold-already-in-1st' (Rotina)

STEP 5 — circuit breaker check (per-SKU 15% cap, AD11)
  if action ∈ {UNDERCUT, CEILING_RAISE}:
    delta_pct = abs(new_price - current_price) / current_price
    if delta_pct > 0.15:
      action = HOLD_CIRCUIT_BREAKER_PER_SKU
      audit_log: 'circuit-breaker-per-sku-trip' (Atenção)
      Resend critical alert
      // Per-cycle 20% catalog cap is enforced at the dispatcher (AD11), not here

STEP 6 — emit to PRI01 batch
  if action ∈ {UNDERCUT, CEILING_RAISE}:
    sku_channel.pending_set_price = new_price
    add (SKU, channel, new_price) to current cycle's PRI01 staging table

  // PRI01 writer (AD7) consumes the staging table per-SKU:
  //   - groups by SKU
  //   - loads ALL sku_channel rows for each SKU
  //   - emits CSV with all channels (updated + passthrough)
  //   - sets pending_import_id on all involved rows
  //   - submits one PRI01 per SKU-batch
```

**Tie handling (explicit):** when `candidate_price == competitor_lowest` (CASE A) or `new_ceiling_price <= current_price` (CASE B), action is HOLD. Worten's tiebreaker is unknown (likely shop quality, premium status, age, or random). Pushing into a tie is a coin-flip with margin sacrifice; HOLD is strictly better. [Pre-locked decision per the engine-undercut conversation.]

**Edge cases covered explicitly:**
- **Leader-is-self:** after the self-filter (AD13), our offer is not in `ranked[]`. We read our own position from a separate count: if the unfiltered P11 ranking placed us at position 1, we enter CASE B. If our own offer is missing from the unfiltered ranking entirely (e.g., we're inactive on this channel), we enter CASE A as if we never participated.
- **All competitors above ceiling:** position 1 already (we're cheapest); CASE B with `target_ceiling_price` capped at `ceiling_price` produces a HOLD or a small raise within tolerance. Never a write that violates ceiling.
- **Two-repricer-conflict:** Tier 2a's 15-min cadence (AD10) catches re-undercuts within ~15 min. Equilibrium converges to floor when both repricers configure tight edge_step. Customer-tunable response (e.g., back off, accept loss) deferred to Epic 2.
- **Single-channel offer:** if a SKU is listed only on PT, only the PT `sku_channel` row exists; the engine never queries P11 for ES on that SKU. The writer's per-SKU aggregation (AD7) emits only the PT channel line.
- **Single-competitor:** CASE A or CASE B with `competitor_2nd is null`. Already enumerated.

- **Why:** PRD FR21–FR25 (engine logic), FR24 (decision-table cases); pre-locked engine logic from your message.
- **Affects:** the entire engine; every audit-log event-type emission; the pending_set_price / last_set_price state machine.
- **Bob trace:** Story 7.1 (engine decision table implementation + unit tests covering every CASE + edge case); Story 7.2 (cooperative-absorption logic); Story 7.3 (anomaly-freeze trigger).

#### AD9 — Cooperative-ERP-sync absorption: PRI02-gated `last_set_price`, skip-on-pending

- **Mechanic:** each cycle, compare `current_price` (read from P11) against `last_set_price` (last value we PRI02-confirmed). If different AND `pending_import_id IS NULL`, the change is external — update `list_price = current_price`, recompute floor/ceiling, continue normal repricing.
- **PRI02 gate:** `last_set_price` only updates after PRI02 returns COMPLETE for the import_id that wrote it. While `pending_import_id IS NOT NULL` for any (SKU, channel) row, cooperative-absorption SKIPS that row entirely — the row's "current_price" is presumed to be in flux and not a stable signal.
- **Anomaly threshold:** if `abs((current_price - list_price) / list_price) > anomaly_threshold_pct` (default 0.40, per-marketplace config column reserved for Epic 2 customization), the SKU is FROZEN per AD8 STEP 2. Customer review/confirm/reject unfreezes via the modal in UX skeleton §9.2.
- **Audit:** every absorption fires an `external-change-absorbed` Notável event (FR38d). Every freeze fires an `anomaly-freeze` Atenção event (FR29).

- **Why:** PRD FR22 (cooperative-absorption mechanic), FR29 (anomaly freeze), pre-locked decision (PRI01/PRI02 race resolution via pending_import_id).
- **Affects:** the engine STEP 2 logic; the `sku_channel` schema; audit-log event-type taxonomy.
- **Bob trace:** Story 7.2 (cooperative-absorption + skip-on-pending unit tests); Story 7.3 (anomaly-freeze + frozen_for_anomaly_review state); Story 8.x (anomaly-review modal + accept/reject UI).

#### AD10 — 4-state tier system + per-SKU `tier_cadence_minutes` + `last_won_at`

- **Tier states:**
  - **Tier 1** (contested, position > 1): `tier_cadence_minutes = 15`
  - **Tier 2a** (winning, position = 1, `last_won_at < 4h ago`): `tier_cadence_minutes = 15`
  - **Tier 2b** (stable winner, position = 1, `last_won_at >= 4h ago`): `tier_cadence_minutes = 45` (lock value at midpoint of PRD's 30–60 range; calibratable from dogfood)
  - **Tier 3** (no competitors): `tier_cadence_minutes = 1440` (daily; doubles as nightly reconciliation per FR28)
- **Transitions** (per FR19):
  - T1 → T2a on winning 1st: set `last_won_at = NOW()`, `tier_cadence_minutes = 15`
  - T2a → T2b after 4h elapsed since `last_won_at`: engine detects on next cycle and **writes** `tier = '2b'`, `tier_cadence_minutes = 45` (atomic with the cycle's `tier-transition` audit event). Until that next cycle runs, the row continues at T2a's 15-min cadence — acceptable transient overshoot of one extra check. Without the write-back, the dispatcher predicate (`last_checked_at + tier_cadence_minutes < NOW()`) would keep the row at 15 min forever, defeating Tier 2b's API-economy purpose.
  - {T2, T2a, T2b} → T1 on losing 1st: `tier_cadence_minutes = 15`; `last_won_at` preserved (analytics)
  - T3 → T1/T2a on new competitor entering: if already at 1st AND beats new competitor → T2a; else → T1
- **Schema:** `sku_channel.tier_cadence_minutes` (integer), `sku_channel.last_won_at` (timestamptz nullable), `sku_channel.last_checked_at` (timestamptz NOT NULL), `sku_channel.tier` (enum '1' | '2a' | '2b' | '3').
- **Per-customer override (Epic 2):** `customer_marketplace.tier_cadence_minutes_override` JSONB or per-tier columns, NULL at MVP. When non-NULL, used in place of defaults.

- **Why:** PRD FR17–FR19 (4-state spec), pre-locked decision (Tier 2b = 45 min), the 100k+ SKU cadence-relaxation pathway.
- **Affects:** dispatcher SKU-selection query; tier-transition logic; KPI computation ("SKUs in 1st place" = COUNT WHERE tier IN {2a, 2b}; "losing position" = COUNT WHERE tier = 1; "exclusive" = COUNT WHERE tier = 3).
- **Bob trace:** Story 7.4 (tier classification + transitions + per-SKU cadence_minutes column).

#### AD11 — Outbound circuit breaker: per-cycle 20% + per-SKU 15%

- **Per-SKU cap (15%):** enforced at engine STEP 5 per AD8 (after candidate_price computation, before staging). Trip = HOLD + Atenção event + Resend alert.
- **Per-cycle cap (20%):** enforced at the **dispatcher** before staging is flushed to PRI01. After all per-SKU decisions are computed for the cycle:
  - **Numerator** = `COUNT(*) FROM pri01_staging WHERE cycle_id = <current> AND flushed_at IS NULL` (rows staged for write this cycle).
  - **Denominator** = `COUNT(*) FROM sku_channels WHERE customer_marketplace_id = <current> AND excluded_at IS NULL` (active SKUs in the marketplace).
  - **Trip predicate:** `numerator / denominator > 0.20`.
  - Denominator is the marketplace's full active-SKU count, NOT the cycle's scheduled set (which is a small slice and would trigger constantly). On trip, the dispatcher:
  1. Halts the staging flush (no PRI01 emitted this cycle).
  2. Sets `customer_marketplace.cron_state = 'PAUSED_BY_CIRCUIT_BREAKER'`.
  3. Emits `circuit-breaker-trip` Atenção event with the affected-SKU list.
  4. Sends Resend critical alert (FR48).
  5. Surfaces the customer-facing dashboard banner (UX skeleton §9.8).
- **Manual unblock:** customer reviews via the audit log (UX skeleton §2.2 flow), clicks "Retomar manualmente" — sets `cron_state = 'ACTIVE'`. The next cycle's per-SKU decisions are recomputed from current state (no pending writes survive a circuit-breaker trip).

- **Why:** PRD FR26, FR27; PRD's 4-layer safety stack.
- **Affects:** dispatcher logic; cron_state machine; audit-log + banner UX.
- **Bob trace:** Story 7.5 (circuit breaker — both caps + manual unblock).

#### AD12 — Inbound anomaly freeze (>40% external deviation) → per-SKU frozen_for_anomaly_review

Already specified in AD9 STEP 2. The freeze is per-SKU (not per-customer) — orthogonal to `cron_state`. Customer reviews via modal (UX skeleton §9.2), confirms (`list_price = new_value`, unfreeze) or rejects (`list_price` unchanged, unfreeze).

> **TBD — frozen-state semantic-overload (Story 6.3 sharding decision).** Story 6.3 (PRI03 escalation per AD24) introduces a second per-SKU freeze reason: 3-consecutive-cycles PRI01 failures escalate the SKU into a freeze pending review. Two viable representations, equivalent in customer UX, divergent in schema:
>
> - **Option (a) — `frozen_reason` enum discriminator.** Replace the boolean `sku_channels.frozen_for_anomaly_review` with `sku_channels.frozen_reason text` (NULL = unfrozen; non-NULL = frozen with reason). Reasons: `'ANOMALY_REVIEW' | 'PRI01_PERSISTENT_FAILURE'`. Engine SKIPs any non-NULL row. Pros: single freeze field; extensible if future freeze reasons emerge; review modal can switch on reason for tailored copy. Cons: data-migration on the column rename (forward-only per Step 5); ESLint rule `no-frozen-bool` enforces nobody reads the legacy field.
> - **Option (b) — parallel `frozen_for_pri01_persistent` boolean.** Add `sku_channels.frozen_for_pri01_persistent boolean NOT NULL DEFAULT false` alongside `frozen_for_anomaly_review`. Engine dispatcher predicate adds `AND frozen_for_pri01_persistent = false` to the existing skip-condition chain. Pros: zero migration on existing column; predicate change is additive. Cons: review-modal logic branches on two booleans; future freeze reasons each add another column (linear growth not enum-extensible).
>
> Bob picks during Story 6.3 sharding. **Architecture-doc obligation post-pick:** whoever shards Story 6.3 updates this AD12 trailing note (replace the TBD block with the chosen option's locked spec) AND the `sku_channels` DDL in §Database Schema (replace the corresponding column comment with the chosen representation) AND the dispatcher predicate in AD17. Both options preserve the "freeze is orthogonal to cron_state" invariant; both options preserve customer-review-modal as the unfreeze path.

- **Why:** PRD FR29; pre-locked decision (frozen_for_anomaly_review orthogonal to cron_state enum).
- **Affects:** engine STEP 2; sku_channel schema; anomaly-review modal flow.
- **Bob trace:** Story 7.3 (anomaly-freeze trigger); Story 8.x (review modal + accept/reject endpoints); **Story 6.3 (frozen-state representation decision per TBD note above).**

#### AD13 — Self-identification via defensive `shop_name` filter

- **Capture:** A01 at onboarding returns `shop_id` and `shop_name`; both persist on `customer_marketplace`. [Empirical: A01 returned `shop_id: 19706, shop_name: "Easy - Store"` for the test account.]
- **Filter:** every P11 response is post-processed to remove offers where `offer.shop_name === customer_marketplace.shop_name` BEFORE ranking. `shop_id` is `null` in P11 competitor offers, so it cannot be the primary key. [Empirical: all 30 P11 competitor offers across the 3 verification calls returned `shop_id: null`.]
- **Defensive collision check:** if more than one offer in a P11 response matches our `shop_name`, emit a `shop-name-collision-detected` Atenção audit event AND skip the SKU for the cycle (don't trust ranking under collision). Worten almost certainly enforces shop_name uniqueness, but this guards against a future Mirakl change.
- **Why both `false` empirically?** [Empirical: Easy-Store's offer is `active: false` (zero quantity); P11's default `all_offers=false` excludes inactive offers, so our offer didn't appear in either PT or ES P11 responses.] This is INCONCLUSIVE for whether Mirakl auto-excludes active-self. The defensive filter handles either reality.

- **Why:** PRD §Mirakl Integration Patterns + the engine "leader-is-self" decision-table case (AD8); empirical confirmation that `shop_id` is null in P11 [Empirical].
- **Affects:** every P11 read in the engine.
- **Bob trace:** Story 7.6 (self-filter + collision-detection unit tests).

#### AD14 — Mandatory P11 offer filter: `active === true AND total_price > 0`

Both filters are **non-optional** for the engine:

- `offer.active === true` — P11 may return inactive offers despite the `all_offers=false` default; the post-fetch filter is the safety net. [MCP: P11 — `inactivity_reasons` enum includes `SHOP_NOT_OPEN`, `ZERO_QUANTITY`.] DynamicPriceIdea's production code uses this filter.
- `offer.total_price > 0` — Worten returns placeholder offers with `total_price = 0` mixed in among real offers in production. [Empirical: Strawberrynet returned at rank 0 with `total_price: 0, price: 0` in the verification run's PT and ES P11 calls.] Without this filter, the engine would chase a phantom €0 floor target on every cycle.

The filter chain at engine STEP 1 is:
```
offers
  .filter(o => o.active === true)
  .filter(o => Number.isFinite(o.total_price) && o.total_price > 0)
  .filter(o => o.shop_name !== own_shop_name)
  .sort((a, b) => a.total_price - b.total_price)
```

- **Why:** PRD FR20 (P11 ranking), FR23 (decision-table); empirical confirmation of `total_price = 0` placeholders in production [Empirical].
- **Affects:** engine STEP 1 (every cycle); P11 batch-scanner reused from DynamicPriceIdea (already implements this).
- **Bob trace:** Story 7.1 (engine STEP 1 + filter chain unit tests with fixture data including a `total_price=0` competitor).

---

### C. Cron Architecture & State Machine

#### AD15 — `cron_state` enum on customer_marketplace; per-SKU `frozen_for_anomaly_review` orthogonal

- **`customer_marketplace.cron_state` enum values:**
  - `'PROVISIONING'` — F4: row exists, onboarding scan in progress (A01 + PC01 + OF21 + P11). A01/PC01 columns populating; CHECK constraint blocks transition out until all populated. Engine SKIPS rows in this state.
  - `'DRY_RUN'` — scan complete; engine simulates, audit log shows "would-have-done" events, no PRI01.
  - `'ACTIVE'` — live cron running.
  - `'PAUSED_BY_CUSTOMER'` — FR32 (customer clicked pause).
  - `'PAUSED_BY_PAYMENT_FAILURE'` — FR43 (Stripe sub auto-cancelled).
  - `'PAUSED_BY_CIRCUIT_BREAKER'` — FR27 (cycle halted, awaiting manual unblock).
  - `'PAUSED_BY_KEY_REVOKED'` — UX skeleton §8.1 (Worten 401 detected).
  - `'PAUSED_BY_ACCOUNT_GRACE_PERIOD'` — FR4 amended (deletion initiated, 7-day grace).
- **Dispatcher predicate:** `WHERE cron_state = 'ACTIVE' AND last_checked_at + tier_cadence_minutes < NOW()` (clean predicate, no NOT clauses).
- **Per-SKU `frozen_for_anomaly_review`** is a separate boolean column on `sku_channel`. Orthogonal to `cron_state`. Engine SKIPS the SKU regardless of `cron_state`.
- **Banner UX precedence** (UX skeleton UX4) is the natural priority order of the enum:
  1. payment_failure > 2. circuit_breaker > 3. anomaly (per-SKU, banner shows count) > 4. key_revoked > 5. account_grace_period > 6. paused_by_customer > 7. provisioning > 8. dry_run

  **F4 precedence note:** `PROVISIONING` slots between `paused_by_customer` and `dry_run`. UX-wise, the customer is redirected to `/onboarding/scan` during this state (UX skeleton §3.3); the banner is a defensive fallback if they somehow navigate elsewhere ("Catálogo a ser carregado…"). Engine SKIPS `PROVISIONING` rows (dispatcher predicate `WHERE cron_state = 'ACTIVE'` already excludes them).

- **Why:** pre-locked decision (single enum); UX skeleton UX4–UX5 (distinct visual treatments per paused reason); FR27, FR32, FR43, FR4 amended.
- **Affects:** dispatcher SQL; banner rendering; audit-log filtering by state; deletion-grace and key-revocation interception flows.
- **Bob trace:** Story 4.2 (cron_state schema + transitions); Story 8.x per state (pause/resume customer; circuit breaker unblock; anomaly review; key-revoked rotation flow; account-deletion grace).

#### AD16 — Onboarding scan sequence: key-validate → A01 → PC01 → OF21 → P11 → tier-classify → baseline

Locked sequence, all gating prefix steps before the customer reaches the dashboard:

1. **Key validation** — single P11 call against a known-good test EAN. If 401/403, surface inline error per UX skeleton §3.2; do NOT persist key.
2. **A01** (`GET /api/account`) — capture `shop_id`, `shop_name`, `channels[]`, `currency_iso_code`, `state`, `is_professional`, `domains[]`. Persist on `customer_marketplace`.
3. **PC01** (`GET /api/platform/configuration`) — capture `channel_pricing` (assert ∈ {SINGLE, MULTI}; abort onboarding with PT-localized error if DISABLED), `operator_csv_delimiter`, `offer_prices_decimals`, `discount_period_required`, `competitive_pricing_tool`, `scheduled_pricing`, `volume_pricing`, `multi_currency`, `order_tax_mode`. Persist as columns AND as a JSONB snapshot in `customer_marketplace.platform_features_snapshot` for audit/diagnostic.
4. **OF21** (`GET /api/offers` paginated) — read own catalog. Capture `shop_sku`, `product_sku`, `ean`, `quantity`, `price`, `total_price`, `min_shipping_price`, `channels[]`, `active`. Bulk-load into `sku_channel` rows (one per (SKU, channel) the offer is sellable on).
5. **P11 batch scan** (per AD5) — for each EAN, batch 100 EANs per call, 2 calls per batch (one per channel). Filter `active=true AND total_price>0 AND shop_name !== own_shop_name`. Read top-2 offers per (SKU, channel). Persist competitor snapshot.
6. **Tier classification** — assign each `sku_channel` row to T1 / T2a / T2b / T3 per AD10 transition rules; set `tier_cadence_minutes` accordingly; set `last_won_at = NOW()` for SKUs already at position 1.
7. **Baseline snapshot** — copy `current_price` → `list_price` for every `sku_channel`; persist a separate `baseline_snapshot` row per (SKU, channel) for Epic 2 "restore baseline" feature.

Customer lands on `/onboarding/scan-ready` (UX skeleton §8.3) once the scan completes; `/onboarding/margin` follows.

- **Pass-2 UX delta for Sally:** the existing 4-phase progress (UX skeleton §3.3) needs either a prepended "Configurando integração com Worten" phase (covering A01 + PC01) or a 6-phase rename. Non-blocking; tracked.
- **Smoke-test reuse:** `scripts/mirakl-empirical-verify.js` runs the same A01 + PC01 + OF21 + P11 calls and asserts the prerequisites. At first-customer onboarding, Bob's Story 1.X runs this script with the customer's freshly-validated key BEFORE proceeding with OF21 catalog import — fail-loudly if the assertion block has any `false`.

- **Why:** PRD FR12–FR16 (catalog scan), FR8–FR11 (key entry), the empirical-verification mandate; A01 + PC01 emerged as load-bearing during MCP/empirical work.
- **Affects:** the entire onboarding state machine; `customer_marketplace` schema columns; the scan-progress UI phase definition.
- **Bob trace:** Story 4.x (onboarding scan orchestration); Story 1.X (Mirakl integration smoke test reusing `scripts/mirakl-empirical-verify.js`).

#### AD17 — Dispatcher: master 5-min cron + per-customer Postgres advisory locks

- **Master cron** runs every 5 minutes inside the worker process via `node-cron`. Dispatch query:

```sql
SELECT cm.id, sc.id, sc.sku_id, sc.channel_code
FROM customer_marketplace cm
JOIN sku_channel sc ON sc.customer_marketplace_id = cm.id
WHERE cm.cron_state = 'ACTIVE'
  AND sc.frozen_for_anomaly_review = false
  AND sc.pending_import_id IS NULL
  AND sc.excluded_at IS NULL
  AND sc.last_checked_at + (sc.tier_cadence_minutes * INTERVAL '1 minute') < NOW()
ORDER BY cm.id, sc.last_checked_at ASC
LIMIT <batch_size>;
```

- **Per-customer parallelism via advisory locks.** Before processing any SKU for a customer, the dispatcher calls `pg_try_advisory_lock(<customer_marketplace_id>)`. If the lock is held by another worker, skip that customer's SKUs this tick — different customers can be processed in parallel by multiple workers without coordination overhead.
- **At MVP scale (5–10 customers, single worker)** the lock is essentially uncontended; it's an architectural invariant that supports horizontal scaling per NFR-Sc3 without rework.
- **Stale-lock handling:** advisory locks are session-scoped; a worker crash releases them automatically (Postgres handles it). No stale-lock cleanup logic needed (unlike the table-row pseudo-mutex pattern in Gabriel's project).
- **Cycle assembly:** within a customer's lock session, the dispatcher groups SKUs by tier, runs engine decisions per AD8, stages writes to a per-cycle `pri01_staging` table, runs the per-cycle 20% circuit-breaker check (AD11), then flushes staging to the PRI01 writer (AD7).

- **Why:** PRD FR18 (single cron + per-SKU cadence), NFR-Sc3 (advisory-lock-or-similar), the cleaner model than Gabriel's table-row pseudo-mutex.
- **Affects:** dispatcher logic; horizontal-scale story (Epic 2 second worker just runs the same code with no coordination changes).
- **Bob trace:** Story 5.1 (master cron + dispatcher + advisory-lock per-customer); Story 5.2 (cycle assembly + staging table flush).

#### AD18 — Polling-only architecture; no webhooks (seller-side unavailable)

[MCP: "Webhooks & Cloud Events are only available for Operator users, not for Seller users."] Locked.

- All Mirakl-side change detection is via P11 read each cycle. Cooperative-absorption is purely cycle-based.
- Internal Stripe webhooks (subscription state changes) ARE used and are NOT affected by this — they're inbound to MarketPilot, not from Mirakl.

- **Why:** MCP-confirmed seller-side webhooks unavailable; pre-locked decision.
- **Affects:** every external-change detection in the engine; rules out push-driven optimization in Epic 2 unless Mirakl changes the policy.

---

### D. Audit Log Architecture

#### AD19 — Monthly partitioning + compound indexes + precomputed aggregates

Volume math (FR38b per UX skeleton §4.1 + the brief's ~3M entries/quarter/customer estimate at production catalog scale) demands the schema ship with these from day 1; computing UX surfaces on demand against multi-million-row tables blows NFR-P8's 2s budget on a 90-day window.

**Schema:**

- **`audit_log`** (core append-only fact table) — partitioned by `created_at` MONTH using Postgres native declarative partitioning. Each partition is a separate table (`audit_log_2026_05`, etc.); creation automated by a monthly cron. Old partitions (> 90 days for Notável/Rotina, retained per customer-account lifetime per NFR-S6 for Atenção) detached and archived if needed.
- **Compound indexes:**
  - `(customer_marketplace_id, created_at DESC)` — primary
  - `(customer_marketplace_id, sku_id, created_at DESC)` — search-by-SKU surface
  - `(customer_marketplace_id, event_type, created_at DESC)` — feed filtering
  - `(customer_marketplace_id, channel_code, created_at DESC)` — channel-filtered views
  - `(customer_marketplace_id, cycle_id, sku_id)` — cycle-aggregated firehose drill-down
- **Precomputed aggregates** (separate tables, refreshed by background jobs):
  - **`daily_kpi_snapshots`** (one row per (customer_marketplace_id, channel_code, date)) — counts of position_won, position_lost, anomaly_freeze, external_change_absorbed, undercut, ceiling_raise, hold for the day; total catalog value in 1st place; total at risk. Refreshed at midnight by a daily cron + partial-incremental refresh every 5 min during the day for "today" row.
  - **`cycle_summaries`** (one row per (customer_marketplace_id, cycle_id)) — aggregate counts for the cycle (undercuts, raises, holds, failures), median price delta, affected SKU count. Written at cycle-end by the dispatcher.
- **Query patterns mapped to UX surfaces:**
  - Daily summary card (UX skeleton §4.1.1) → `daily_kpi_snapshots` row for today, joined to yesterday for delta.
  - Atenção feed (§4.1.2) → `audit_log` filtered by `event_type IN (atenção_set) AND resolved_at IS NULL`, last 30 days, ORDER BY created_at DESC LIMIT 50.
  - Notável feed (§4.1.3) → `audit_log` filtered by `event_type IN (notável_set)`, last 30 days, ORDER BY created_at DESC LIMIT 30.
  - Search-by-SKU (§4.1.4) → `audit_log` filtered by `(customer_marketplace_id, sku_id)`, last 90 days, no event_type filter (returns all events).
  - Firehose (§4.1.5) → `cycle_summaries` paginated 50/page; SKU expansion lazy-loads from `audit_log` filtered by `(customer_marketplace_id, cycle_id)`.

- **Why:** PRD NFR-S6 (append-only at app layer), NFR-P8 (≤2s on 90-day window); UX skeleton §4.1 5-surface IA + the volume-math justification the skeleton already encodes.
- **Affects:** entire schema and query layer for the dashboard's audit-log surfaces; the precomputed-aggregate refresh jobs.
- **Bob trace:** Story 9.1 (audit_log schema + monthly partition automation); Story 9.2 (daily_kpi_snapshots + cycle_summaries + refresh jobs); Story 9.3 (5-surface query endpoints with HTMX-ready URL conventions).

#### AD20 — Audit log event-type taxonomy locked from UX skeleton §4.1.6

Three priority levels enforce default UI surfacing (FR38d). Counts are spec-load-bearing: any future event_type addition extends one of the three lists below AND its row in `audit_log_event_types` AND the `EVENT_TYPES` constant exported from `shared/audit/event-types.js`.

**Base seed (26 event_types) — Story 9.0 lookup-table seed:**

- **Atenção (7):** `anomaly-freeze`, `circuit-breaker-trip`, `circuit-breaker-per-sku-trip`, `key-validation-fail`, `pri01-fail-persistent`, `payment-failure-pause`, `shop-name-collision-detected` (added per AD13).
- **Notável (8):** `external-change-absorbed`, `position-won`, `position-lost`, `new-competitor-entered`, `large-price-move-within-tolerance`, `customer-paused`, `customer-resumed`, `scan-complete-with-issues`.
- **Rotina (11):** `undercut-decision`, `ceiling-raise-decision`, `hold-floor-bound`, `hold-ceiling-bound`, `hold-already-in-1st`, `cycle-start`, `cycle-end`, `pri01-submit`, `pri02-complete`, `pri02-failed-transient`, `tier-transition`.

**Epic 12 additions (2 event_types) — joined to seed via Story 9.0's lookup table:**

- **Atenção (+1, Story 12.1):** `cycle-fail-sustained` — emitted by the 3-tier failure classifier after 3 consecutive cycles fail to reach Mirakl for the same customer (per AD24 sustained-transient escalation).
- **Atenção (+1, Story 12.3):** `platform-features-changed` — emitted by the monthly PC01 re-pull cron when the response differs from the persisted snapshot (per AD26).

**Total at end of MVP: 28 event_types** = **9 Atenção** (7 base + 2 from Epic 12) + **8 Notável** + **11 Rotina**.

Schema column `audit_log.event_type` is `text` referencing the `audit_log_event_types(event_type)` lookup table per F5 (NOT a Postgres enum — lookup table allows row-by-row priority assertion via trigger AND avoids `ALTER TYPE ... ADD VALUE` migration friction when Stories 12.1 + 12.3 add their event_types). The `audit_log.priority` column is denormalized via the BEFORE-INSERT trigger (`audit_log_set_priority`) which reads the lookup-table priority and stamps the row.

**Test-count assertion canonical pattern (per Item 7).** Story 9.0's integration tests MUST assert `EVENT_TYPES.length === <expected>` rather than hardcoding the integer literal `26` or `28`. The `EVENT_TYPES` constant lives in `shared/audit/event-types.js` and is the single source of truth for the count; Stories 12.1 and 12.3 each extend the constant in the same PR that adds their lookup-table seed row, and the integration test's expected count derives from `EVENT_TYPES.length` automatically. This pattern is canonical for any future event_type addition — never hardcode the count.

**Decided 2026-04-30 (Q2): NO 29th `account-deletion-initiated` event_type at MVP.** The total stays at 28 at end of MVP. Rationale: the email trail (deletion-confirmation + deletion-grace-reminder + deletion-final per Stories 10.1 + 12.2) is the canonical record for account-lifecycle events; `audit_log` scope stays restricted to engine and operational events. `audit_log` rows get wiped at T+7d hard-delete (per AD21) anyway, so logging the deletion-initiation event would be self-erasing. Story 10.1's `transitionCronState(<current> → PAUSED_BY_ACCOUNT_GRACE_PERIOD)` correctly emits NO audit event by passing `eventType: null` to the helper (helper accepts null for non-engine state changes).

- **Why:** UX skeleton §4.1.6 + FR38d (locked taxonomy); F5 (lookup-table over Postgres enum); Story 9.0 distillate's calendar-early ordering for audit-as-trust artifact.
- **Bob trace:** Story 9.0 (lookup table + 26-row seed + EVENT_TYPES constant + integration test asserting `EVENT_TYPES.length`); Story 12.1 extends seed +1 (`cycle-fail-sustained`); Story 12.3 extends seed +1 (`platform-features-changed`).

---

### E. Account Lifecycle & Billing

#### AD21 — Account-deletion 4-step + 7-day grace + Stripe `cancel_at_period_end`

Per pre-locked decision A1:

1. **Step 1** (`/settings/delete`): customer reads what gets wiped vs retained (UX skeleton §8.4).
2. **Step 2:** type `ELIMINAR` + email; submit.
3. **Step 3:**
   - **Encrypted shop_api_key destroyed at initiation** (NOT grace-period end) — security commitment.
   - **Stripe subscription** → `subscription.update({ cancel_at_period_end: true })`. Stripe stops renewing at end of current billing period; no automatic refund for grace-period days.
   - `customer_marketplace.cron_state = 'PAUSED_BY_ACCOUNT_GRACE_PERIOD'` — cron paused for all customer's marketplaces.
   - `customer.deletion_initiated_at = NOW()`; `customer.deletion_scheduled_at = NOW() + INTERVAL '7 days'`.
   - Resend confirmation email with "Cancelar eliminação" magic link.
   - Dashboard locks (read-only); banner per UX skeleton §9.12.
4. **Step 4** (T+7d, by daily cron): hard delete per GDPR Art 17 — wipe `audit_log` entries (excluding fiscal-evidence exceptions per ToS), Stripe customer/subscription references, catalog/baseline/pricing-state. **Retain Moloni invoice metadata** (separate `moloni_invoices` table — fiscal record).
- **Cancel-mid-grace:** customer clicks magic link OR dashboard banner button → `customer.deletion_initiated_at = NULL`, `cron_state = 'DRY_RUN'` (NOT directly to ACTIVE — customer must re-enter Stripe payment to reactivate, since the prior subscription is already canceling). UX flow same as Stripe payment-failed re-entry.

- **Why:** PRD FR4 amended; pre-locked decision A1 (Stripe `cancel_at_period_end`); UX skeleton §8.4.
- **Affects:** `customer` schema columns; cron_state machine; daily-deletion cron; Stripe integration.
- **Bob trace:** Story 10.1 (deletion flow + grace-period cron + Stripe cancel_at_period_end + key destruction); Story 10.2 (cancel-mid-grace flow). **Decided 2026-04-30 (Q1):** keep the current MVP-simple "re-enter Stripe payment from scratch" approach in cancel-mid-grace — AD22 and AD21 prose stay as-is. Story 10.2's `app/src/routes/settings/cancel-deletion.js` includes a code comment documenting the Phase 2 refinement opportunity: *"Phase 2: if Stripe Subscription's current billing period has not yet ended at cancel-mid-grace time, uncancel via `cancel_at_period_end=false` instead of forcing the customer to re-enter Stripe payment. Avoids the double-charge edge case for customers who cancel mid-grace early in their billing cycle. Trigger: any customer complaint about double-charge in months 1–2."*

#### AD22 — Stripe + Moloni integration

- **Stripe** model (corrected per F2): **one Stripe Customer per MarketPilot customer**. **One Stripe Subscription per MarketPilot customer**, created at first Go-Live click (NOT at signup — pre-Go-Live customers have no Stripe Customer). **One `SubscriptionItem` per `customer_marketplace`** — Tony's 5 marketplaces = 1 Customer + 1 Subscription + 5 SubscriptionItems @ €50/each. Adding a marketplace = adding a SubscriptionItem to the existing Subscription (Stripe proration applies). Removing a marketplace = removing the SubscriptionItem at end of cycle, no mid-cycle refund (FR41 Epic 2; concierge-only at MVP, but schema supports the Epic 2 self-serve flow without migration). Cancelling the customer's account = cancelling the whole Subscription (`cancel_at_period_end=true` per AD21).
- **Subscription state webhook** drives `cron_state` transitions for ALL of the customer's marketplaces (not just one). Webhook signature verified; replay attacks prevented via timestamp tolerance ≤5 minutes.
- **Idempotency** via `Stripe-Idempotency-Key` header on every mutation, derived from `(customer_id, action, attempt_id)`.
- **Moloni** manual at MVP: founder generates invoice from Moloni dashboard per Stripe payment, ~5–10 min/customer/month. `moloni_invoices` table records invoice metadata (NIF, Moloni invoice ID, Stripe payment_intent_id, amount, issued_at). Moloni API integration triggered Epic 2 at >2–3 hr/month aggregate founder time.
- **NIF capture flow** (resolves implicit gap): customer's company NIF is asked at first Moloni invoice generation (founder's Day-3 pulse-check email per Journey 1: *"Posso enviar a fatura Moloni para o NIF da {company}?"*). Founder writes the NIF into `customer_profiles.nif` (via service-role) AND into `moloni_invoices.nif` for the issued invoice (NOT NULL on `moloni_invoices`). Subsequent invoices for the same customer pre-fill from `customer_profiles.nif`. Customer self-update via `/settings/account` is Epic 2 (manual founder edit at MVP).
- **Schema linkage (F2 corrected):** `customers.stripe_customer_id`, `customers.stripe_subscription_id` (one Customer + one Subscription per MarketPilot customer), `customer_marketplaces.stripe_subscription_item_id` (one SubscriptionItem per marketplace), `moloni_invoices.moloni_invoice_id` (Moloni-side identifier). All NULL until first Go-Live click for the relevant entity.

- **Why:** PRD FR40–FR44; NFR-S4 (webhook signature + replay), NFR-I2 (Stripe idempotency).
- **Bob trace:** Story 11.1 (Stripe integration + webhook handler + idempotency); Story 11.2 (Moloni invoice metadata schema + manual-flow ops doc).

---

### F. Operations, Observability, and Failure Modes

#### AD23 — `/health` composition: app endpoint reads `worker_heartbeats` freshness

- App's `GET /health` returns 200 IFF:
  1. App can reach Postgres (issues a `SELECT 1` with 1s timeout).
  2. The most recent `worker_heartbeats` row is < 90 seconds old (worker writes a heartbeat every 30s; threshold = 3× the cadence).
- UptimeRobot pings only the app's `/health` (FR45). Worker has no public URL; its liveness is observed via the heartbeat.
- Failure → UptimeRobot emails the founder (NFR-I5).

- **Why:** PRD FR45, NFR-R1, NFR-R2; rules out the worker process becoming a silent failure.
- **Bob trace:** Story 1.1 (worker_heartbeats table + heartbeat write + app `/health` composition + UptimeRobot configuration — the full /health surface ships in 1.1 alongside the two-service scaffold so UptimeRobot has a target from day 1).

#### AD24 — 3-tier failure model: transient retry / per-SKU operational / critical alert+banner

Locked from PRD FR46 + NFR-R4:

- **Transient** (429, 5xx, network timeout): exponential backoff retry within cycle (per AD5). Logged at debug; no audit-log entry. If 3 consecutive cycles fail to reach Mirakl for the same customer, escalate to:
- **Sustained transient** → Portuguese-localized banner (UX skeleton §9.9), audit-log `cycle-fail-sustained` event (Atenção). NO Resend email at this tier — banner only. **Threshold (3 consecutive cycles)** is hardcoded at MVP; Epic 2 trigger to make per-customer configurable if a customer in a flaky-network region needs longer tolerance (no schema change at MVP — would land as a nullable `customer_marketplace.sustained_transient_cycle_threshold` column).
- **Per-SKU operational** (PRI03 reports SKU error, EAN mismatch, validation failure for a specific SKU): logged in `audit_log` as `pri01-submit-fail` (Rotina), retried in next cycle's PRI01 writer rebuild. After 3 consecutive cycles failing for the same SKU → escalates to `pri01-fail-persistent` Atenção event + Resend critical alert + per-SKU freeze pending review.
- **Critical** (auth invalid → `paused_by_key_revoked`; sustained Mirakl outage > N cycles → banner per above; anomaly freeze; circuit-breaker trip): freeze customer's repricing; Resend email within ≤5 min (NFR-P9, FR48); dashboard banner appears next render.

- **Bob trace:** Story 12.1 (failure-mode classifier + retry logic); Story 12.2 (sustained-transient banner trigger); Story 12.3 (Resend critical-alert delivery).

#### AD25 — Resend critical alerts + UptimeRobot health

- **Resend** is for critical-tier alerts ONLY (FR48 + NFR-Sc4 budget). Templates PT-localized (NFR-I4) under `app/src/views/emails/*.eta`. No marketing emails, no day-3/day-7 pulse-check templates (those are founder-direct per NFR-O3). Sized for ~10 customers × 2–3 alerts/month each (Resend free tier 3k/mo).
- **UptimeRobot** monitors `/health` at 5-min cadence (FR45). On consecutive failure, alerts founder email (out-of-band, not customer-facing).
- **Customer-facing observability:** banners + audit log only at MVP. No status page (Plan B per PRD §Implementation Considerations).

- **Why:** PRD FR45, FR48, NFR-I4, NFR-I5.
- **Bob trace:** Story 12.3 (Resend templates + delivery wiring); Story 1.x (UptimeRobot config — manual via UptimeRobot UI; documented in ops runbook).

#### AD26 — Customer-marketplace platform_features_snapshot (PC01 capture, JSONB)

- `customer_marketplace.platform_features_snapshot` JSONB carries the full PC01 response at onboarding for diagnostic + future-feature gating.
- Specific columns extracted from PC01 are also stored as typed columns for fast access in the engine + writer paths: `channel_pricing_mode`, `operator_csv_delimiter`, `offer_prices_decimals`, `discount_period_required`, `competitive_pricing_tool`, `scheduled_pricing`, `volume_pricing`, `multi_currency`, `order_tax_mode`. JSONB is the source of truth; columns are a denormalized projection refreshed if PC01 is re-pulled.
- **Re-pull cadence:** monthly cron re-calls PC01 per active customer_marketplace; if the response differs, log a `platform-features-changed` Atenção audit event AND alert the founder. Operator changes to PC01 (e.g., enabling `volume_pricing`) could break the writer if undetected.

- **Why:** captures the empirical reality that operator config is mutable; protects the writer from silent drift.
- **Bob trace:** Story 4.1 (PC01 capture); Story 12.4 (monthly PC01 re-pull cron).

#### AD27 — Logging: structured JSON via pino

- All app + worker logs go through pino, structured JSON to stdout, captured by Coolify.
- **Sensitive-field redaction list** (built into pino config): `Authorization`, `cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`. Any log line containing a redacted key replaces the value with `'[REDACTED]'`.
- Log levels: `info` for cycle-start/end, `warn` for retried failures, `error` for critical events. Customer-facing errors return safe PT messages per AD5.

- **Why:** trust property (NFR-S1: keys never in logs); operational debugging without leaking secrets.
- **Bob trace:** Story 1.3 (pino config + redaction list + unit test that asserts each redacted field name produces `'[REDACTED]'` in the log stream).

---

### G. Important Decisions (architecture-shaping, not blocking)

#### AD28 — Validation: Fastify built-in JSON Schema, no extra library at MVP

Already locked in Step 3. Re-affirmed here:

- Route-level `schema:` config with JSON Schema for body, query, params.
- Sufficient for signup, key-entry, margin editor save, anomaly-review accept/reject, deletion-confirmation, Stripe webhook payloads.
- Epic 2 trigger to add `zod` (or similar): a validator surface emerges that JSON Schema can't express ergonomically. Today, none.

#### AD29 — Customer profile schema: first_name, last_name, company_name NOT NULL

Per pre-locked decision:

- `customer_profiles` table with `customer_id` PK, `first_name TEXT NOT NULL`, `last_name TEXT NOT NULL`, `company_name TEXT NOT NULL`, plus `nif` (nullable, captured at first Moloni invoice per AD22), `created_at`, `updated_at`.
- **Atomic creation pattern (F3 lock):** Postgres trigger on `auth.users` AFTER INSERT. The trigger function (declared `SECURITY DEFINER` so it can write to `public.customer_profiles` from the `auth` schema):
  1. Reads `NEW.raw_user_meta_data` JSONB (Supabase auto-populates this from `signUp({ options: { data: {...} } })`).
  2. Validates `first_name`, `last_name`, `company_name` are present non-empty strings — `RAISE EXCEPTION` on any missing/empty field, which **rolls back the entire INSERT into auth.users** (Postgres transaction semantics).
  3. INSERTs the matching `customer_profiles` row with the validated values.
- The signup route (`app/src/routes/_public/signup.js`) calls `supabase.auth.signUp({ email, password, options: { data: { first_name, last_name, company_name } } })`. If the trigger raises, Supabase Auth returns an error; the route catches and returns the safe PT-localized message via `getSafeErrorMessage()` (per AD5 + Step 5 error pattern). No partial-state cleanup needed — Postgres did the rollback.
- **NIF deliberately deferred** — captured at first Moloni invoice generation per AD22 NIF capture flow, not at signup. UX placement of first/last/company (signup form vs interstitial) is Sally's Pass 2 call; backend doesn't care.

- **Why:** every MarketPilot customer is a registered B2B entity; "everyone has these" is true by segment definition; avoids manual founder follow-up. The trigger pattern guarantees atomicity at DB level — no orphan-auth-without-profile state is even representable.
- **Bob trace:** Story 1.4 (signup endpoint + auth.users trigger migration + JSON Schema validation on the route + safe-error mapping for trigger-raised exceptions + source-context capture middleware per FR7 — atomicity bundle lands as a single PR).

#### AD30 — RLS regression suite runs on every deploy

- `scripts/rls-regression-suite.js` runs in CI: spins up a test Postgres with seed data for 2 customers, attempts every mutation/query as customer A using customer B's IDs, asserts every attempt returns 0 rows or denied.
- Coverage: every customer-scoped table (customer_marketplace, sku_channel, audit_log, baseline_snapshot, customer_profile, shop_api_key_vault, moloni_invoices, etc.).
- Block the deploy on any test failure.

- **Why:** PRD NFR-S3, NFR-I3 (RLS regression per deploy); the trust commitment.
- **Bob trace:** Story 2.x (regression suite scaffolding); each new customer-scoped-table story adds its row to the suite.

---

### H. Deferred Decisions (Epic 2 / triggered)

These have schema reservations or hooks at MVP but no implementation:

- **Per-customer cadence customization** — `customer_marketplace.tier_cadence_minutes_override` JSONB nullable; engine reads when not null.
- **Customer-tunable anomaly threshold** — `customer_marketplace.anomaly_threshold_pct` numeric nullable; defaults to 0.40 when null.
- **Per-SKU exclude / "promo mode"** — `sku_channel.excluded_at` timestamp; engine SKIPS rows where not null.
- **Cost-CSV upload** — `sku_channel.cost_cents` integer nullable; engine path to use cost-based formula gates on this column being non-null for the SKU.
- **Multi-marketplace beyond Worten** — `customer_marketplace.operator` enum already `'WORTEN'` at MVP; Epic 2 adds `'PHONE_HOUSE'`, `'CARREFOUR_ES'`, etc. Each operator carries its own per-channel codes, base URL, and features.
- **HTMX upgrade for audit log** — URL conventions already designed for HTML-fragment swaps; HTMX library can be added without backend changes when ready.
- **TypeScript migration** — JSDoc convention (Step 3) keeps `*.js → *.ts` rename trivial.
- **Self-serve marketplace add/remove** — concierge-only at MVP per FR41; Epic 2 ships UI + Stripe proration logic. Schema already supports multi-marketplace.
- **Moloni API integration** — `moloni_invoices` table already supports it; Epic 2 swaps manual generation for API call.
- **Restore-baseline UI** — `baseline_snapshot` already captured at scan; Epic 2 adds the restore endpoint + UI.

---

### I. Decision Impact Analysis

**Implementation sequence (informs Bob's epic ordering):**

1. **Foundation** — Story 1.1–1.5: scaffold + worker heartbeat + /health (1.1, AD1+AD23), envelope encryption (1.2, AD3), pino redaction (1.3, AD27), signup + atomic customer_profile + source-context capture (1.4, AD29 + FR7), founder_admins seed + middleware (1.5, AD4).
2. **Tenancy + RLS** — Story 2.x: RLS policies + regression suite (AD2, AD30).
3. **Mirakl client** — Story 3.x: port + adapt apiClient.js + scanCompetitors.js with self-filter + total_price filter (AD5, AD13, AD14).
4. **Onboarding** — Story 4.x: key-entry + A01/PC01 capture + OF21 catalog scan + P11 batch scan + tier classification + baseline snapshot (AD16); platform_features_snapshot (AD26); Mirakl integration smoke test reusing `scripts/mirakl-empirical-verify.js` (AD16 cross-cite).
5. **Engine + safety** — Story 5–7.x: dispatcher + advisory locks (AD17); engine decision table (AD8); cooperative-absorption (AD9); tier transitions (AD10); circuit breaker (AD11); anomaly freeze (AD12); cron_state (AD15).
6. **PRI01 writer** — Story 6.x: per-SKU aggregation + delete-and-replace (AD7); pending_import_id atomicity; PRI02 poller; PRI03 error-report parser + per-SKU rebuild.
7. **Audit log** — Story 9.x: schema + monthly partitions + precomputed aggregates (AD19); event-type taxonomy + priority enum (AD20); 5-surface query endpoints.
8. **Dashboard + customer surfaces** — Story 8.x: dashboard root + KPI cards + margin editor + pause/resume + anomaly review modal + Go-Live consent modal + 5 audit-log surfaces.
9. **Billing + lifecycle** — Story 11.x: Stripe + Moloni (AD22); Story 10.x: account deletion + grace period (AD21).
10. **Operations** — Story 12.x: 3-tier failure model + Resend + sustained-transient banner (AD24, AD25); monthly PC01 re-pull (AD26).

**Cross-component dependencies (most load-bearing):**

- **Engine + writer atomicity:** AD7 (`pending_import_id` set on ALL participating rows, not just changing ones) + AD9 (skip-on-pending in cooperative-absorption) + AD10 (`last_won_at` set on T1→T2a transition AFTER PRI02 COMPLETE) form a tight invariant chain. Bob's stories must be ordered so Story 7.x (engine) lands together with Story 6.x (writer) — they cannot ship piecemeal without breaking the atomicity contract.
- **Onboarding + engine schema:** Story 4.x must land `channel_pricing_mode`, `operator_csv_delimiter`, `offer_prices_decimals` columns + populate them from PC01 BEFORE Story 6.x (PRI01 writer) is testable.
- **RLS suite + every customer-scoped table:** Story 2.x establishes the suite; every subsequent story adding a customer-scoped table extends the suite as part of its acceptance criteria.
- **Audit log + everything else:** the audit log writers (`shared/audit/`) are imported by the engine, the writer, the dispatcher, the lifecycle workflow, and the customer-facing endpoints. Story 9.1 (audit_log schema + writer module) is a Story 1.x sibling — must land before any feature that emits events.

---

### J. Worten Positioning Note (informational, not architectural)

[Empirical: Worten has `competitive_pricing_tool: true`.] Worten exposes competitor pricing natively to sellers in the Worten Seller Center. Implication for sales/marketing positioning (NOT for architecture):

- The free-report's "give you visibility" wedge is narrower for Worten specifically than for marketplaces without this feature — Worten sellers already see per-product competition in their seller portal.
- The free-report's wedge for Worten is: **catalog-level aggregation + quick-wins computation + margin-headroom analysis** (Worten's tool is per-product, not aggregated).
- The paid repricer's wedge is independent: **automation + cooperative-absorption + safety stack** — Worten doesn't reprice; we do.
- Track in OUTREACH.md / sales playbook for next pass; doesn't change any spec here.

## Implementation Patterns & Consistency Rules

This section locks the patterns BAD subagents must follow when implementing the AD set. Each pattern names the conflict point it prevents — generic conventions (snake_case vs camelCase) are decided where they have project-specific consequence. Patterns that don't apply to this stack (SPA state management, GraphQL schemas, WebSocket conventions, API versioning) are deliberately omitted.

The discipline this section enforces is **single source of truth per concern**. If a state mutation needs an audit event, only one module emits audit events. If a Mirakl call needs to happen, only one HTTP client makes it. Subagents implementing different stories cannot diverge if there is exactly one path to do the thing.

### Naming Patterns

#### Database

- **snake_case for everything** — table names, column names, index names, constraint names, function names. Postgres convention; matches what `@supabase/supabase-js` and the `pg` client expect; matches Mirakl's response field names so JSON↔column mapping is mechanical.
- **Plural table names** — `customer_marketplaces`, `sku_channels`, `audit_log` (collective noun stays singular), `worker_heartbeats`, `moloni_invoices`. Consistent with Postgres tooling and Supabase docs.
- **Foreign keys named `<table_singular>_id`** — `customer_marketplace_id`, `sku_id`, `cycle_id`. NOT `fk_*` prefixes. The column name IS the FK reference.
- **Indexes named `idx_<table>_<columns>`** — `idx_audit_log_customer_marketplace_id_created_at`. Verbose but unambiguous; avoids `_001` numeric suffixes that drift over migrations.
- **Constraints named `<table>_<col>_<kind>`** — `customer_marketplace_cron_state_check`, `sku_channel_unique_customer_sku_channel`. Postgres default names are unstable across versions; explicit naming makes migration diffs readable.
- **Enum types named `<table>_<col>` or domain-prefixed** — `cron_state` (used by `customer_marketplaces.cron_state`), `audit_log_priority`, `tier_value`. Enum values UPPER_SNAKE_CASE for state machines (`'ACTIVE'`, `'PAUSED_BY_CUSTOMER'`); short lower-case for taxonomic values (`'1'`, `'2a'`, `'2b'`, `'3'` for `tier_value`).
- **Timestamp columns** always `timestamptz` (UTC). Naming: `<verb>_at` (`created_at`, `updated_at`, `last_won_at`, `last_checked_at`, `last_set_at`, `deletion_initiated_at`).

#### URLs / Routes

- **Customer-facing routes are kebab-case**, plural where they refer to collections, singular where they refer to a state-of-self. UX skeleton §1 already locked these:
  - Plural collections: `/audit`, `/audit/firehose`, `/settings/marketplaces`
  - Singular pages: `/onboarding/key`, `/onboarding/scan`, `/onboarding/scan-ready`, `/onboarding/margin`, `/settings/account`, `/settings/key`, `/settings/billing`, `/settings/delete`
  - Internal: `/admin/status`
- **Audit log fragment endpoints** (HTMX-ready per AD7 future-consideration) follow `/audit/_fragments/<name>` — the `_fragments` segment marks them as partial-HTML returns, not full pages. Keeps the URL space clean for future HTMX wiring without rewrite.
- **Form-POST destinations** mirror their parent page — `POST /onboarding/key` posts to the same path that GET renders the form on. No `/api/v1/...` namespace; this is a server-rendered app, not a JSON API.
- **Webhook endpoints** scoped under `/_webhooks/`: `/_webhooks/stripe`. Underscore prefix marks them as machine-callable, never linked from UI.
- **Health endpoint** is `/health` (PRD FR45 — UptimeRobot expects this exact path).
- **Source-context query params** for funnel attribution (FR7) use `source` and `campaign`: `/signup?source=free_report&campaign=tony_august`. Locked names so DynamicPriceIdea's CTA wiring matches.

#### Code

- **Filenames are kebab-case** (`api-client.js`, `pri01-writer.js`, `engine-decision.js`, `cron-state.js`). Matches DynamicPriceIdea's pattern. Tests mirror source: `tests/<source-relative-path>.test.js`.
- **Module exports** use camelCase named exports: `export async function buildPri01Csv (...)`. Default exports forbidden — they break refactor tooling and force ad-hoc local naming on import.
- **Function names** start with verbs that name the side-effect class:
  - `read*` / `fetch*` / `get*` — pure I/O reads. `fetchCompetitorOffers`, `getCustomerMarketplace`.
  - `compute*` / `derive*` / `build*` — pure computation, no I/O. `computeFloorPrice`, `buildPri01Csv`.
  - `write*` / `persist*` / `record*` — DB writes. `writeAuditEvent`, `persistCronStateTransition`.
  - `submit*` / `dispatch*` — Mirakl writes (PRI01 only). `submitPriceImport`.
  - `apply*` / `transition*` — state-machine transitions. `transitionCronState`, `applyTierClassification`.
- **Variable naming** is camelCase. Currency variables ALWAYS suffixed `Cents` to avoid float confusion: `floorPriceCents`, `competitorLowestCents`, `edgeStepCents`. Display-formatted variables suffixed `Display`: `floorPriceDisplay`. See "Money handling" pattern below.
- **JSDoc convention** (locked Step 3): every exported function carries `@param`, `@returns`, `@throws` annotations. Critical financial / state-mutation functions (margin math, decimal handling, PRI01 CSV serialization, cron-state transitions, encryption helpers) carry `@typedef` for shapes.
- **`async`/`await` only.** No `.then()` chains, no callbacks, no mixed promise handling. ESLint rule enforces.
- **No `console.log`.** Pino only (per AD27). ESLint rule enforces; pre-commit hook double-checks.

### Structural Patterns

#### Single source of truth — load-bearing

The following modules are the **only** path to perform their concern. BAD subagents implementing other stories must import from them, never reimplement:

| Concern | Single source of truth | Why |
|---|---|---|
| Mirakl HTTP requests | `shared/mirakl/api-client.js` (`mirAklGet`) | AD5: retry, redaction, error mapping all in one place |
| PRI01 CSV building | `shared/mirakl/pri01-writer.js` (`buildPri01Csv`) | AD7: per-SKU aggregation + delete-and-replace + delimiter consumption |
| PRI02 polling | `shared/mirakl/pri02-poller.js` (`pollImportStatus`) | AD7: race resolution + pending_import_id atomicity |
| PRI03 error parsing | `shared/mirakl/pri03-parser.js` (`parseErrorReport`) | AD24: per-SKU rebuild semantics |
| Audit event emission | `shared/audit/writer.js` (`writeAuditEvent`) | AD20: event_type + priority enum + structured payload |
| Cron-state transitions | `shared/state/cron-state.js` (`transitionCronState`) | AD15: atomic state change + audit event in one transaction |
| Per-SKU freeze | `shared/state/sku-freeze.js` (`freezeSkuForReview`, `unfreezeSku`) | AD12: orthogonal to cron_state, audit emitted atomically |
| Engine decision | `worker/src/engine/decide.js` (`decideForSkuChannel`) | AD8: full decision table; one function per (SKU, channel) decision |
| Encryption envelope | `shared/crypto/envelope.js` (`encryptShopApiKey`, `decryptShopApiKey`) | AD3: master-key access localized; decryption only in worker context |
| Self-filter | `shared/mirakl/self-filter.js` (`filterCompetitorOffers`) | AD13 + AD14: active + total_price + shop_name filter chain |
| Money math | `shared/money/index.js` (`toCents`, `fromCents`, `roundFloorCents`, `roundCeilingCents`) | conservative rounding direction; integer-cents discipline |

→ Bob's story sharding must respect: any story touching one of these concerns extends the existing module rather than creating a parallel implementation. ESLint custom rule (added Story 1.1) flags imports of `node:fetch` or direct `fetch(` calls outside `shared/mirakl/api-client.js` — same for `csv-stringify`, raw `UPDATE customer_marketplaces SET cron_state` SQL, etc.

#### Module boundaries

- **`shared/`** — pure functions + module-level helpers usable by both `app/` and `worker/`. No app-only Fastify imports; no worker-only `pg` direct imports. Database access goes through factory functions parameterized by client.
- **`app/`** — Fastify routes, middleware, eta views, RLS-aware DB client factory. `app/src/lib/` is for app-only helpers (session, csrf, view-helpers).
- **`worker/`** — cron, dispatcher, engine, safety. `worker/src/lib/` is for worker-only helpers (heartbeat write, batch utilities). Worker uses service-role DB client.
- **`db/migrations/`** — append-only SQL migrations managed by Supabase CLI. Never edit a migration after it has been applied to any environment.
- **`scripts/`** — operational scripts: `mirakl-empirical-verify.js` (AD16 reuse), `rotate-master-key.md` runbook (AD3), `rls-regression-suite.js` (AD30), `check-no-secrets.sh` (AD3 secret-scanning).
- **`tests/`** — mirrors source tree. `tests/shared/mirakl/api-client.test.js` matches `shared/mirakl/api-client.js`. Integration tests under `tests/integration/`. RLS regression suite is its own file: `tests/integration/rls-regression.test.js`.

#### Test patterns

- **Node built-in test runner** (per Step 3 lock). `npm test` runs `node --test --env-file-if-exists=.env.test 'tests/**/*.test.js'`.
- **Test naming:** `tests/<source-path>.test.js` for unit; `tests/integration/<feature>.test.js` for integration.
- **Engine test fixtures** live in `tests/fixtures/p11/` as JSON files. Fixture naming reflects the case under test:
  - `p11-tier1-undercut-succeeds.json`
  - `p11-tier1-floor-bound-hold.json`
  - `p11-tier1-tie-with-competitor-hold.json` (tie-handling case)
  - `p11-tier2a-recently-won-stays-watched.json`
  - `p11-tier2b-ceiling-raise-headroom.json`
  - `p11-tier3-no-competitors.json`
  - `p11-tier3-then-new-competitor.json`
  - `p11-all-competitors-below-floor.json` ← addresses sub-case Pedro flagged on AD8
  - `p11-all-competitors-above-ceiling.json`
  - `p11-self-active-in-p11.json` ← would-only-occur-if-Mirakl-doesn't-auto-exclude; engine STILL filters via shop_name (AD13)
  - `p11-self-marked-inactive-but-returned.json` ← caught by AD14 filter
  - `p11-single-competitor-is-self.json` ← post-self-filter empty list → Tier 3 path (AD8 STEP 1)
  - `p11-zero-price-placeholder-mixed-in.json` ← Strawberrynet-style; caught by AD14 filter
  - `p11-shop-name-collision.json` ← two offers match own shop_name; AD13 collision-detection fires
  - `p11-pri01-pending-skip.json` ← `pending_import_id` set; engine SKIPs the SKU
  - `p11-cooperative-absorption-within-threshold.json`
  - `p11-cooperative-absorption-anomaly-freeze.json` ← >40% deviation triggers freeze (AD12)
- **One-test-per-AD discipline:** each engine AD has at least one test fixture exercising its happy path AND its negative path. Coverage is fixture-driven, not LoC-driven.
- **Golden-file pattern** for PRI01 CSV output: `tests/fixtures/pri01-csv/<scenario>.csv` is the expected serialization for a given engine + writer state. CSV bytes compared exactly (delimiter, line endings, decimal separator).
- **Pact-style** Mirakl mocking: `tests/mocks/mirakl-server.js` is a Fastify server that stands in for `marketplace.worten.pt`, replays fixture responses. Same fixtures used in CI and in dogfood replay. Empirical responses captured from `verification-results.json` are the seed.

→ Bob's stories that add new engine logic include their fixture file as part of the story acceptance. Stories that don't ship a fixture for a new path fail review.

### Format Patterns

#### Money

- **Always integer cents in code and DB.** A price of €17.99 is `1799` (int). NEVER stored as `17.99` (float) anywhere. Schema columns: `price_cents INTEGER NOT NULL`, `floor_price_cents INTEGER NOT NULL`, `min_shipping_price_cents INTEGER`. Mirakl returns prices as JSON numbers (e.g., `21.54`) — converted to cents (`2154`) at the boundary in `shared/mirakl/api-client.js` response normaliser.
- **Conservative rounding** at floor/ceiling computation:
  - `roundFloorCents(rawFloor)` rounds UP (`Math.ceil`) — the floor must never sink below its raw value.
  - `roundCeilingCents(rawCeiling)` rounds DOWN (`Math.floor`) — the ceiling must never exceed its raw value.
  - Both functions live in `shared/money/index.js`.
- **Display formatting** at the eta template boundary only: `{{ formatEur(priceCents) }}` → `'€17,99'` (PT locale uses comma as decimal separator). Never store the formatted string; never reverse-parse it.
- **`edgeStepCents = 1`** (€0.01) is the unit unit for both undercut and ceiling-raise per AD8. NOT 0.01 (float).

#### Dates / Timezones

- **DB columns are `timestamptz`** (timestamp with time zone). Postgres stores UTC.
- **Application code uses UTC throughout.** `new Date()` is acceptable; format conversion happens at output.
- **Customer-facing display in `Europe/Lisbon`** — eta helper `{{ formatLisbon(timestampUtc) }}` does the conversion. Audit log entries serialize as `'29/04/2026 17:32:14'` for customer view; UTC ISO 8601 for diagnostics view.
- **Mirakl wire format is ISO 8601 with `Z`** (`'2024-01-01T23:00:00Z'`) — per [MCP: PRI01 examples]. PRI01 writer emits exactly this format if discount-date columns are ever needed (Worten doesn't require them per [Empirical: PC01 `discount_period_required: false`]).

#### JSON

- **snake_case in all JSON wire formats.** Matches Mirakl response shape, matches Supabase response shape, matches Postgres column names. No `camelCase` ↔ `snake_case` translation layers — the cost of consistency is unfamiliarity for JS-default eyes; the benefit is grep-ability and zero translation bugs.
- **JSON is for diagnostics + Stripe webhooks + audit-log fragment payloads**, not customer-facing UI (server-rendered HTML).
- **No envelope** — return the resource directly. Stripe webhooks are JSON envelope (their format); we accept theirs unchanged. Audit-log fragment endpoints return HTML, not JSON.
- **Error responses (when JSON):** `{ error: { code: 'WORTEN_API_KEY_INVALID', message_pt: 'Chave inválida' } }`. The `code` is the program-readable identifier; `message_pt` is the customer-facing message. NEVER include raw error text from upstream services.

#### CSV (PRI01)

- **Encoding:** UTF-8 without BOM. [Empirical-pending — calibrate during dogfood.] Decimal separator: ASCII period (`.`); CSV standard regardless of locale. If Worten dogfood reveals comma is required, configurable via `customer_marketplace.csv_decimal_separator` column.
- **Delimiter:** captured per-marketplace from PC01 in `customer_marketplace.operator_csv_delimiter`. [Empirical: Worten = `SEMICOLON`.] Writer reads the column at write time; never hardcoded.
- **Line endings:** `\n` (LF). Mirakl docs don't specify; LF is the safe lowest-common-denominator.
- **Header row required** per [MCP: PRI01]: `offer-sku;price;channels` (Worten MVP set per AD7).
- **Quoting:** field values quoted only when they contain the delimiter or a newline. Standard CSV escape (double-quote inside quoted field).

### Communication Patterns

#### Audit event emission

Every state mutation that user/customer should ever ask "what happened?" about emits an audit event. The discipline — locked in `shared/audit/writer.js` — is:

```js
/**
 * Write a single audit-log entry. Must be called inside the transaction that
 * performs the state change so the event-and-state are atomic.
 *
 * @param {object} args
 * @param {pg.PoolClient} args.tx        active DB transaction
 * @param {string}        args.customerMarketplaceId
 * @param {string|null}   args.skuChannelId   null for customer-marketplace-level events
 * @param {string}        args.eventType      one of audit_log_event_type enum (AD20)
 * @param {string|null}   args.cycleId        null outside cycle context
 * @param {object}        args.payload        structured event-specific data; redaction-safe
 * @returns {Promise<{ id: string, priority: string }>}
 */
export async function writeAuditEvent ({ tx, customerMarketplaceId, skuChannelId, eventType, cycleId, payload }) { ... }
```

- **One event per atomic state mutation.** A cycle that processes 200 SKUs emits 200 events (plus aggregate `cycle-start` / `cycle-end`); the writer is internal to the dispatcher, not called scattered.
- **Priority is derived, not specified.** The function looks up `eventType` against the enum mapping (Atenção / Notável / Rotina) and stamps the row's `priority` column. Subagents cannot accidentally mis-prioritize.
- **Payload is structured, never freeform string.** Each event_type has a documented payload shape (in JSDoc `@typedef PayloadFor<EventType>`). `external-change-absorbed` carries `{ previousListPriceCents, newListPriceCents, deviationPct }`. Subagents adding a new event_type MUST add the typedef in the same PR.

#### Cron-state transitions

Single helper, atomic with audit emission:

```js
/**
 * Transition cron_state for a customer_marketplace. Validates the transition
 * is legal per AD15's state diagram. Atomic: state change + audit event in
 * one transaction. Rejects illegal transitions (e.g., 'PAUSED_BY_CIRCUIT_BREAKER' →
 * 'PAUSED_BY_CUSTOMER' would skip manual unblock).
 *
 * @param {object} args
 * @param {pg.PoolClient} args.tx
 * @param {string}        args.customerMarketplaceId
 * @param {string}        args.from               expected current state (optimistic-concurrency guard)
 * @param {string}        args.to                 target state
 * @param {object}        args.context            event-specific payload
 * @returns {Promise<void>}
 * @throws {InvalidTransitionError} if (from, to) is not in the legal-transitions matrix
 * @throws {ConcurrentTransitionError} if current state != args.from
 */
export async function transitionCronState ({ tx, customerMarketplaceId, from, to, context }) { ... }
```

- **Legal-transitions matrix** is defined as a JS object literal at the top of the module — the spec, not buried in conditionals. Subagents reading the file see all 7 valid transitions in one place.
- **Optimistic concurrency** via `from` parameter: the UPDATE includes `WHERE cron_state = $from`; 0 rows updated → `ConcurrentTransitionError`. Prevents races between webhook-driven and customer-action transitions.

#### Mirakl error mapping

Every Mirakl error reaches the customer through `getSafeErrorMessage(err)` (per AD5, ported from DynamicPriceIdea). NEVER:
- Pass `err.message` directly into a customer-facing template.
- Include the Mirakl response body in a banner.
- Log the full error response (it could echo headers — including ours).

ESLint rule (custom): `no-raw-error-to-template` flags any usage of `err.message`, `err.response`, `err.body` inside `app/views/` template render paths.

#### Multi-tenant filtering

- **App context (RLS-aware client):** queries do NOT manually filter by `customer_marketplace_id`. RLS does it. A query `SELECT * FROM sku_channel WHERE id = $1` is safe — RLS rejects rows not owned by the JWT subject.
- **Worker context (service-role client):** queries MUST manually filter by `customer_marketplace_id` because RLS is bypassed. ESLint rule (custom): `worker-must-filter-by-customer` flags any `from('sku_channel')` / `from('audit_log')` / etc. without a `.eq('customer_marketplace_id', ...)` clause OR an explicit `// safe: cross-customer cron` comment.
- **`shared/db/` factory functions** make this explicit: `getRlsAwareClient(jwt)` (app) vs `getServiceRoleClient()` (worker). A subagent implementing a query in `shared/` would pick the wrong factory only if they ignored the JSDoc — the JSDoc on each factory states the multi-tenant contract.

### Process Patterns

#### Migrations

- **One schema change per migration file.** Filename: `YYYYMMDDHHMM_<verb>_<noun>.sql` (Supabase CLI default).
- **Migrations are append-only.** Never edit a migration after it has been applied to any environment. To fix a wrong migration, write a new one.
- **Every customer-scoped table migration includes its RLS policy in the same file** — same atomic deploy. The RLS regression suite (AD30) verifies coverage.
- **Down migrations are NOT maintained** at MVP — Supabase migrations are forward-only; rollback is "write a new migration that reverses the change." Solo-founder velocity tradeoff.

#### Logging

- **`pino` only.** No `console.log`, no `console.error`, no `process.stdout.write` (except `scripts/` ops scripts where it's a deliberate output channel).
- **Redaction list** locked per AD27. Re-stated here so subagents don't accidentally add sensitive fields under different names: `Authorization`, `cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`. Adding a new sensitive field in code requires extending this list in the same PR.
- **Log levels:**
  - `trace` — disabled in production; per-request fine detail during local dev.
  - `debug` — disabled in production; cycle-step traces.
  - `info` — cycle-start, cycle-end, customer signup, Go-Live click.
  - `warn` — retried failures, rate-limit backoff triggers, sustained-transient banner triggers.
  - `error` — critical events (anomaly freeze, circuit breaker, key revoked, payment failure).
- **Structured fields:** every log line carries `customer_marketplace_id` (or `null` if pre-auth), `request_id` (app) or `cycle_id` (worker), and `event_type` if the line corresponds to an audit event.

#### Error handling

- **Throw + global handler.** Routes throw; a Fastify global error handler converts to safe responses. No try/catch inside individual routes for "general error mapping" — only catch where you have something specific to do (e.g., retry, fall through to alternative path, transform the error class).
- **Custom error classes** for predictable conditions: `MiraklApiError`, `RlsViolationError`, `InvalidTransitionError`, `ConcurrentTransitionError`, `KeyVaultDecryptError`. Each carries a `safeMessagePt` field (PT-localized customer-facing text) AND a `code` field (program-readable identifier).
- **Unhandled errors** route to a generic 500 with `safeMessagePt: 'Ocorreu um erro inesperado. Tenta novamente ou contacta o suporte.'`. Stack trace logged server-side (with redaction); never exposed to client.

#### Loading states

- **Server-rendered = no client-side loading state**, except where a long-running async job exists. Two such jobs at MVP:
  - **Catalog scan** (UX skeleton §3.3 + AD16): page polls `GET /onboarding/scan/status` every 1s; renders 4-phase progress. Reconnection-safe per FR14.
  - **Inline key validation** (FR9, ≤5s per NFR-P6): button disables, shows spinner, posts to `/onboarding/key/validate`, awaits response.
- **Audit log filters** are server-rendered HTML. No client-side debounce-then-fetch pattern; form submission re-renders the page (or a fragment if HTMX is added in Epic 2).

### Enforcement

The following mechanical enforcement runs BEFORE any code is reviewed:

| Check | Mechanism | Story |
|---|---|---|
| ESLint base ruleset (no-console, async-only, no-default-export) | ESLint config | 1.1 |
| JSDoc completeness on exported functions | Custom ESLint rule | 1.1 |
| `no-raw-error-to-template` (no `err.message` in eta render) | Custom ESLint rule | 1.x |
| `worker-must-filter-by-customer` (worker queries filter by `customer_marketplace_id`) | Custom ESLint rule | 2.x |
| Single-source-of-truth import discipline (no direct `fetch(` outside api-client; no raw CSV building outside pri01-writer; no raw SQL `UPDATE customer_marketplaces SET cron_state` outside cron-state) | Custom ESLint rules | 1.x and per-AD |
| Secret-pattern pre-commit hook | `scripts/check-no-secrets.sh` | 1.2 |
| Migration filename + content lint | Supabase CLI native | 1.1 |
| RLS regression suite | `npm run test:rls` in CI | 2.x |
| Engine fixture coverage (every AD8 case has a fixture file) | Test file presence asserted in CI | 7.x |
| Pino redaction assertion (test that secret values do not appear in `pino.stream` output) | Unit test | 1.4 |

### Pattern Examples

**✅ Good — money handling:**

```js
import { roundFloorCents, fromCents } from '../../../shared/money/index.js'

const floorCents = roundFloorCents(listPriceCents * (1 - maxDiscountPct))
auditPayload.floorPriceCents = floorCents
templateData.floorPriceDisplay = fromCents(floorCents) // '€17,99'
```

**❌ Anti-pattern — money handling:**

```js
const floor = list_price * (1 - max_discount_pct)            // float math
const floorRounded = Math.round(floor * 100) / 100            // ad-hoc rounding, wrong direction
auditPayload.floor = floor                                    // float in DB
templateData.floor = `€${floor.toFixed(2).replace('.', ',')}` // ad-hoc PT format
```

**✅ Good — cron-state transition:**

```js
await transitionCronState({
  tx,
  customerMarketplaceId,
  from: 'ACTIVE',
  to: 'PAUSED_BY_CUSTOMER',
  context: { initiated_at: new Date().toISOString() },
})
```

**❌ Anti-pattern — cron-state transition:**

```js
await tx.query(
  `UPDATE customer_marketplaces SET cron_state = 'PAUSED_BY_CUSTOMER' WHERE id = $1`,
  [customerMarketplaceId]
)
// audit event written separately... or forgotten... or wrong priority
```

**✅ Good — Mirakl call:**

```js
import { mirAklGet } from '../../../shared/mirakl/api-client.js'

const a01 = await mirAklGet(baseUrl, '/api/account', null, apiKey)
```

**❌ Anti-pattern — Mirakl call:**

```js
const res = await fetch(`${baseUrl}/api/account`, {
  headers: { Authorization: apiKey },
})
// no retry, no error mapping, key potentially logged on error
```

**✅ Good — audit event:**

```js
await writeAuditEvent({
  tx,
  customerMarketplaceId,
  skuChannelId,
  eventType: 'EXTERNAL_CHANGE_ABSORBED',
  cycleId,
  payload: {
    previousListPriceCents: previous,
    newListPriceCents: current,
    deviationPct: 0.034,
  },
})
```

**❌ Anti-pattern — audit event:**

```js
await tx.query(
  `INSERT INTO audit_log (customer_marketplace_id, event_type, message)
   VALUES ($1, 'absorbed', 'Price changed externally')`,
  [customerMarketplaceId]
)
// freeform message, no priority, no structured payload, can't be machine-queried
```

### Notes for Bob (story sharding)

Two pragmatic notes that don't change the spec but should land in Bob's epic backlog when sharding:

1. **ESLint custom-rule timing.** Step 5's enforcement matrix lists ~5 custom rules (`no-raw-error-to-template`, `worker-must-filter-by-customer`, single-source-of-truth import discipline, etc.). Custom ESLint rules require AST-walking logic — non-trivial. Practical sharding compromise:
   - **Story 1.1** ships with **vanilla ESLint** + the conventions documented as comments at the top of each single-source-of-truth module. No custom rules yet.
   - **Story 1.2** adds custom rules for the **3–4 highest-leverage modules**: `shared/mirakl/api-client.js` (no direct fetch), `shared/audit/writer.js` (no raw INSERT INTO audit_log), `shared/money/index.js` (no float price math). These prevent the divergence patterns most likely to bite first.
   - **Stories 2.x onward** add the remaining custom rules per relevant story (e.g., `worker-must-filter-by-customer` lands with the first cron-loop story; `no-raw-error-to-template` lands when first eta render touches Mirakl errors).

   This avoids front-loading lint config into Story 1.1 (already covers scaffold + worker heartbeat + `/health` per AD1+AD23) without deferring enforcement so far that subagents have time to drift. Custom rules can attach to whichever Story 1.x story most-naturally introduces the module they protect (e.g., the no-direct-fetch rule lands with Story 1.2 if `shared/mirakl/api-client.js` ships in 1.2's envelope-encryption work, otherwise lands with Story 3.1 when the api-client port lands).

2. **Engine fixture preservation.** The 17 P11 test fixtures (Step 5) are not optional artifacts — they are the executable spec for AD8. Every engine story must reference its fixtures by filename in the story's acceptance criteria (e.g., "Story 7.1 implements the contested-position branch and passes `tests/fixtures/p11/p11-tier1-undercut-succeeds.json`, `p11-tier1-floor-bound-hold.json`, `p11-tier1-tie-with-competitor-hold.json`"). The Mirakl mock server (`tests/mocks/mirakl-server.js`) seeds from `verification-results.json` (the live Worten captures from 2026-04-30) — this is the seed and must be preserved; replacing it with synthetic data weakens the dogfood-validation chain.

## Project Structure & Boundaries

This section ships:
1. The complete directory tree (every file location BAD subagents need).
2. The full database schema (every table, every column, every index, every RLS policy).
3. FR/AD → file mapping (so Bob can shard stories with a clear "this code lives here" trace).
4. Integration boundaries (where the system talks to Mirakl, Stripe, Resend, UptimeRobot, Moloni).

### Complete Project Directory Tree

```
marketpilot-repricer/
├── README.md                           # one-page: stack, deploy targets, "see _bmad-output/ for everything"
├── CLAUDE.md                           # already exists; project guardrails
├── package.json                        # single npm package, two start commands (start:app / start:worker)
├── package-lock.json
├── .env.example                        # template — every env var name, no values
├── .env.local                          # gitignored; local dev secrets
├── .env.test                           # test env (test DB connection, mock keys)
├── .gitignore
├── .nvmrc                              # 22 (Node version)
├── .editorconfig
├── eslint.config.js                    # base config; references ./eslint-rules/
├── eslint-rules/                       # custom rules (lands incrementally per Bob's note above)
│   ├── no-raw-error-to-template.js
│   ├── worker-must-filter-by-customer.js
│   ├── single-source-of-truth.js       # one rule with multiple module enforcements
│   └── no-direct-fetch.js
│
├── _bmad-output/                       # planning artifacts (already exists)
│   └── planning-artifacts/
│       ├── product-brief-marketpilot-repricer.md
│       ├── product-brief-marketpilot-repricer-distillate.md
│       ├── prd.md
│       ├── ux-skeleton.md
│       └── architecture.md             # this file
│
├── app/                                # Fastify public service (app.marketpilot.pt)
│   └── src/
│       ├── server.js                   # entry point: npm run start:app
│       ├── routes/                     # one file per route group
│       │   ├── _public/                # unauthenticated
│       │   │   ├── signup.js           # FR1, FR7 (source-context capture); AD29 atomic profile
│       │   │   ├── login.js
│       │   │   ├── verify-email.js
│       │   │   ├── forgot-password.js  # FR3
│       │   │   └── reset-password.js   # FR3
│       │   ├── onboarding/             # FR8–FR16; AD16 sequence
│       │   │   ├── key.js              # GET form + POST validate (FR8, FR9, FR10)
│       │   │   ├── scan.js             # GET progress page + status polling (FR12, FR13, FR14)
│       │   │   ├── scan-ready.js       # UX skeleton §8.3
│       │   │   └── margin.js           # FR16 single onboarding question
│       │   ├── dashboard/              # FR30–FR39
│       │   │   ├── index.js            # GET / — KPI cards + state-aware view (UX §3.1)
│       │   │   ├── pause-resume.js     # POST /pause, /resume (FR32; AD15 cron-state transition)
│       │   │   ├── go-live.js          # POST /go-live (FR31; informed-consent confirmation)
│       │   │   └── margin-edit.js      # POST /margin (FR36 save)
│       │   ├── audit/                  # FR37, FR38, FR38b/c/d
│       │   │   ├── index.js            # GET /audit — 3-surface stack (Daily / Atenção / Notável)
│       │   │   ├── _fragments/         # HTMX-ready partials (URL space reserved per Step 5)
│       │   │   │   ├── atencao-feed.js
│       │   │   │   ├── notavel-feed.js
│       │   │   │   └── search-by-sku.js
│       │   │   ├── search.js           # GET /audit?sku=EAN
│       │   │   ├── firehose.js         # GET /audit/firehose (UX §4.1.5)
│       │   │   └── anomaly-review.js   # POST /audit/anomaly/:sku/{accept|reject} (FR29)
│       │   ├── settings/
│       │   │   ├── account.js          # email/password
│       │   │   ├── key.js              # vault status + rotate flow (UX §5.2)
│       │   │   ├── marketplaces.js     # FR41 read-only at MVP (UX §8.5)
│       │   │   ├── billing.js          # Stripe Customer Portal link
│       │   │   └── delete.js           # FR4 amended; AD21 4-step flow
│       │   ├── interceptions/          # routes that override / on landing (UX §3.1 + §8.1)
│       │   │   ├── key-revoked.js      # paused_by_key_revoked
│       │   │   ├── payment-failed.js   # paused_by_payment_failure
│       │   │   └── scan-failed.js      # FR15
│       │   ├── admin/                  # AD4 founder-only
│       │   │   └── status.js           # /admin/status (UX §7)
│       │   ├── _webhooks/              # machine-callable, never linked from UI
│       │   │   └── stripe.js           # AD22 webhook signature + replay protection
│       │   └── health.js               # AD23 — UptimeRobot endpoint
│       ├── views/                      # eta templates (PT-localized)
│       │   ├── layouts/
│       │   │   └── default.eta         # sticky header + banner zone + body slot + footer
│       │   ├── components/
│       │   │   ├── kpi-cards.eta       # FR34 (3 status cards from free-report family)
│       │   │   ├── margin-editor.eta   # FR36 inline panel
│       │   │   ├── audit-feeds.eta     # 3-surface stack
│       │   │   ├── banners.eta         # UX skeleton §9 banner library, precedence-aware
│       │   │   └── pause-button.eta
│       │   ├── pages/                  # one per route
│       │   │   ├── dashboard.eta
│       │   │   ├── audit.eta
│       │   │   ├── onboarding-key.eta
│       │   │   ├── onboarding-scan.eta
│       │   │   ├── onboarding-scan-ready.eta
│       │   │   ├── onboarding-margin.eta
│       │   │   ├── settings-*.eta      # one per /settings route
│       │   │   ├── interception-*.eta  # one per interception route
│       │   │   └── admin-status.eta
│       │   ├── modals/
│       │   │   ├── go-live-consent.eta # FR31 (UX §9.1)
│       │   │   └── anomaly-review.eta  # FR29 (UX §9.2)
│       │   ├── partials/               # smaller reusables (alert pills, status badges, etc.)
│       │   └── emails/                 # PT-localized Resend templates
│       │       ├── critical-alert.eta
│       │       ├── deletion-confirmation.eta # AD21 step 3
│       │       ├── deletion-grace-reminder.eta # AD21 day-5 reminder
│       │       └── scan-failed.eta     # FR15
│       ├── middleware/
│       │   ├── auth.js                 # Supabase Auth session check; redirect to /login
│       │   ├── rls-context.js          # binds JWT to RLS-aware DB client
│       │   ├── csrf.js                 # @fastify/csrf-protection wiring
│       │   ├── source-context-capture.js # FR7 (?source / ?campaign)
│       │   ├── error-handler.js        # global Fastify error handler — safe PT messages
│       │   └── interception-redirect.js # AD15 — checks customer_marketplace.cron_state on /
│       └── lib/                        # app-only helpers (NOT shared/)
│           ├── session.js
│           ├── view-helpers.js         # eta helpers: formatEur, formatLisbon, etc.
│           └── format.js               # money/date display formatters
│
├── worker/                             # cron service (no public URL)
│   └── src/
│       ├── index.js                    # entry: npm run start:worker; starts cron + heartbeat
│       ├── dispatcher.js               # AD17 — master 5-min poll + advisory locks
│       ├── advisory-lock.js            # pg_try_advisory_lock wrapper
│       ├── engine/
│       │   ├── decide.js               # AD8 — full decision table (decideForSkuChannel)
│       │   ├── tier-classify.js        # AD10
│       │   ├── cooperative-absorb.js   # AD9 — skip-on-pending semantics
│       │   └── kpi-derive.js           # cycle-end aggregation → cycle_summaries
│       ├── safety/
│       │   ├── circuit-breaker.js      # AD11 — per-cycle 20% (per-SKU 15% lives in engine/decide.js)
│       │   ├── anomaly-freeze.js       # AD12
│       │   └── reconciliation.js       # nightly Tier 3 pass (FR28)
│       ├── jobs/
│       │   ├── master-cron.js          # node-cron: every 5 min → dispatcher
│       │   ├── pri02-poll.js           # node-cron: every 5 min → resolve pending imports
│       │   ├── deletion-grace.js       # node-cron: daily at midnight Lisbon → process T+7d deletions
│       │   ├── pc01-monthly-repull.js  # AD26 — monthly platform-features-changed detection
│       │   ├── daily-kpi-aggregate.js  # AD19 — midnight refresh + 5-min "today" partial
│       │   ├── monthly-partition-create.js # AD19 — last-day-of-month creates next month's audit_log partition
│       │   ├── audit-log-archive.js    # AD19 — detach old partitions
│       │   └── heartbeat.js            # AD23 — every 30s
│       └── lib/
│           └── batch-utils.js
│
├── shared/                             # imported by both app/ and worker/
│   ├── audit/                          # AD20 single source of truth for audit log
│   │   ├── writer.js                   # writeAuditEvent — atomic with state mutation
│   │   ├── event-types.js              # enum + priority mapping + @typedef PayloadFor<EventType>
│   │   └── readers.js                  # query helpers for the 5 surfaces (UX §4.1)
│   ├── crypto/                         # AD3
│   │   ├── envelope.js                 # AES-256-GCM encrypt/decrypt
│   │   └── master-key-loader.js        # process-start validation
│   ├── db/                             # AD2
│   │   ├── rls-aware-client.js         # app factory (JWT-scoped)
│   │   ├── service-role-client.js      # worker factory (cross-customer)
│   │   └── tx.js                       # transaction helpers
│   ├── mirakl/                         # AD5–AD7, AD13, AD14, AD16
│   │   ├── api-client.js               # mirAklGet — single source of truth (AD5)
│   │   ├── a01.js                      # GET /api/account
│   │   ├── pc01.js                     # GET /api/platform/configuration
│   │   ├── of21.js                     # GET /api/offers (paginated own catalog)
│   │   ├── p11.js                      # GET /api/products/offers (per-channel)
│   │   ├── pri01-writer.js             # AD7 — CSV builder + multipart submit, per-SKU aggregation
│   │   ├── pri02-poller.js             # AD7 — status polling
│   │   ├── pri03-parser.js             # AD24 — error report parser
│   │   ├── self-filter.js              # AD13 + AD14 — filterCompetitorOffers chain
│   │   └── safe-error.js               # AD5 — getSafeErrorMessage (PT-localized)
│   ├── money/                          # AD-pattern: integer cents discipline
│   │   └── index.js                    # toCents, fromCents, roundFloorCents, roundCeilingCents
│   ├── state/
│   │   ├── cron-state.js               # AD15 — transitionCronState (atomic + audit)
│   │   ├── sku-freeze.js               # AD12 — freezeSkuForReview, unfreezeSku
│   │   └── transitions-matrix.js       # legal-transitions enum (read at top of cron-state.js)
│   ├── stripe/                         # AD22
│   │   ├── webhooks.js                 # signature verify + replay protection (NFR-S4)
│   │   ├── subscriptions.js            # idempotent mutations (NFR-I2)
│   │   └── customer-portal.js          # link generator
│   ├── resend/                         # AD25
│   │   └── client.js                   # PT-localized critical-alert sender
│   ├── moloni/                         # AD22 (manual at MVP; API stub for Epic 2)
│   │   └── invoice-metadata.js         # write moloni_invoices row from manual workflow
│   └── config/
│       └── runtime-env.js              # validates required env vars at process start
│
├── db/
│   ├── migrations/                     # Supabase CLI-managed; append-only
│   │   ├── 202604301200_create_customers.sql
│   │   ├── 202604301201_create_customer_profiles_with_trigger.sql  # F3: includes handle_new_auth_user trigger on auth.users
│   │   ├── 202604301202_create_founder_admins.sql
│   │   ├── 202604301203_create_customer_marketplaces.sql
│   │   ├── 202604301204_create_shop_api_key_vault.sql
│   │   ├── 202604301205_create_skus.sql
│   │   ├── 202604301206_create_sku_channels.sql
│   │   ├── 202604301207_create_baseline_snapshots.sql
│   │   ├── 202604301207b_create_audit_log_event_types.sql  # F5: lookup table seeded with AD20 taxonomy; MUST run before audit_log
│   │   ├── 202604301208_create_audit_log_partitioned.sql
│   │   ├── 202604301209_create_daily_kpi_snapshots.sql
│   │   ├── 202604301210_create_cycle_summaries.sql
│   │   ├── 202604301211_create_scan_jobs.sql
│   │   ├── 202604301212_create_worker_heartbeats.sql
│   │   ├── 202604301213_create_moloni_invoices.sql
│   │   ├── 202604301214_create_pri01_staging.sql
│   │   ├── 202604301215_add_pri01_consecutive_failures_to_sku_channels.sql  # Story 6.3 escalation tracking (AD24)
│   │   └── 202604301216_add_day5_reminder_sent_at_to_customers.sql          # Story 10.3 day-5 reminder idempotency (AD21)
│   └── seed/
│       ├── dev/                        # local-dev seed data (2 fake customers for RLS tests)
│       └── test/                       # test-runner seed data
│
├── public/                             # served by @fastify/static
│   ├── css/
│   │   ├── tokens.css                  # OKLCH tokens carrying from MarketPilot.html (UX §10)
│   │   ├── layout.css                  # 1400px container, sticky header
│   │   └── components.css              # KPI cards, banners, modal, margin editor
│   ├── js/                             # per-page vanilla modules (no bundler)
│   │   ├── dashboard.js                # channel-toggle + pause confirmation
│   │   ├── audit.js                    # filter-form submission + sticky search
│   │   ├── margin-editor.js            # 150ms-debounced live worked-profit-example (UX §4.3)
│   │   ├── pause-resume.js             # confirmation modal trigger
│   │   ├── go-live-modal.js            # checkbox→Stripe wiring
│   │   ├── anomaly-review.js           # accept/reject submit
│   │   └── delete-account.js           # ELIMINAR phrase validation client-side
│   │   # F9: each eta page template includes its corresponding script via
│   │   # <script src="/js/<page>.js" defer></script> near </body>. No bundler.
│   │   # `defer` ensures scripts execute after HTML parse but before
│   │   # DOMContentLoaded. type="module" only declared per-script if ES syntax requires.
│   ├── images/
│   └── favicon.ico
│
├── scripts/
│   ├── mirakl-empirical-verify.js      # AD16 reuse — already exists; first-customer smoke test
│   ├── rotate-master-key.md            # AD3 runbook (markdown, not executable)
│   ├── check-no-secrets.sh             # AD3 pre-commit hook
│   ├── rls-regression-suite.js         # AD30 — runs in CI on every deploy
│   └── seed-test-data.js               # populates db/seed/test/ into a fresh test DB
│
└── tests/
    ├── shared/
    │   ├── mirakl/
    │   │   ├── api-client.test.js
    │   │   ├── pri01-writer.test.js     # uses tests/fixtures/pri01-csv/ golden files
    │   │   ├── pri02-poller.test.js
    │   │   ├── pri03-parser.test.js
    │   │   ├── self-filter.test.js     # references p11 fixtures with placeholder zero-price + collisions
    │   │   ├── safe-error.test.js
    │   │   └── a01-pc01.test.js
    │   ├── audit/
    │   │   └── writer.test.js
    │   ├── crypto/
    │   │   └── envelope.test.js
    │   ├── money/
    │   │   └── index.test.js           # rounding direction asserts
    │   ├── state/
    │   │   ├── cron-state.test.js      # legal-transitions matrix coverage + concurrency rejection
    │   │   └── sku-freeze.test.js
    │   └── stripe/
    │       └── webhooks.test.js
    ├── worker/
    │   └── src/
    │       ├── engine/
    │       │   ├── decide.test.js       # references all 17 P11 fixtures (Step 5 enumeration)
    │       │   └── tier-classify.test.js
    │       └── safety/
    │           ├── circuit-breaker.test.js
    │           └── anomaly-freeze.test.js
    ├── integration/
    │   ├── rls-regression.test.js       # AD30
    │   ├── onboarding-flow.test.js      # signup → key → A01 → PC01 → OF21 → P11 → margin → dashboard
    │   ├── go-live-flow.test.js         # dry-run → consent modal → Stripe → cron flips active
    │   ├── deletion-grace.test.js       # 4-step + 7-day grace + cancel-mid-grace
    │   ├── pri01-pri02-cycle.test.js    # full write→poll→complete cycle against mock
    │   └── circuit-breaker-trip.test.js # synthesize 21% catalog change → cycle halt + audit + alert
    ├── fixtures/
    │   ├── p11/                         # 17 fixtures enumerated in Step 5 (DO NOT remove)
    │   │   ├── p11-tier1-undercut-succeeds.json
    │   │   ├── p11-tier1-floor-bound-hold.json
    │   │   ├── p11-tier1-tie-with-competitor-hold.json
    │   │   ├── p11-tier2a-recently-won-stays-watched.json
    │   │   ├── p11-tier2b-ceiling-raise-headroom.json
    │   │   ├── p11-tier3-no-competitors.json
    │   │   ├── p11-tier3-then-new-competitor.json
    │   │   ├── p11-all-competitors-below-floor.json
    │   │   ├── p11-all-competitors-above-ceiling.json
    │   │   ├── p11-self-active-in-p11.json
    │   │   ├── p11-self-marked-inactive-but-returned.json
    │   │   ├── p11-single-competitor-is-self.json
    │   │   ├── p11-zero-price-placeholder-mixed-in.json
    │   │   ├── p11-shop-name-collision.json
    │   │   ├── p11-pri01-pending-skip.json
    │   │   ├── p11-cooperative-absorption-within-threshold.json
    │   │   └── p11-cooperative-absorption-anomaly-freeze.json
    │   ├── pri01-csv/                    # golden-file expected outputs
    │   │   ├── single-channel-undercut.csv
    │   │   ├── multi-channel-passthrough.csv
    │   │   └── pri03-recovery-resubmit.csv
    │   ├── a01/                          # captured A01 responses (Easy-Store + future ops)
    │   │   └── easy-store-2026-04-30.json # from verification-results.json
    │   ├── pc01/                         # captured PC01 responses
    │   │   └── worten-2026-04-30.json   # SINGLE / SEMICOLON / 2 — production-grounded
    │   └── of21/                         # captured OF21 responses
    │       └── easy-store-test-sku-2026-04-30.json
    └── mocks/
        └── mirakl-server.js              # Fastify mock; replays fixtures; seeded from verification-results.json
```

### Database Schema

The schema is RLS-aware from day 1. Customer-scoped tables carry RLS policies keyed on `customer_marketplace_id` (or `customer_id` where the row predates marketplace-scoping). Service-role queries (worker only) bypass RLS but MUST manually filter (per Step 5 multi-tenant pattern).

#### Schema overview (logical grouping)

| Group | Tables |
|---|---|
| Identity & Profile | `customers`, `customer_profiles`, `founder_admins` |
| Marketplaces & Keys | `customer_marketplaces`, `shop_api_key_vault` |
| Catalog & Engine state | `skus`, `sku_channels`, `baseline_snapshots` |
| Audit & Aggregates | `audit_log` (partitioned), `audit_log_event_types` (lookup), `daily_kpi_snapshots`, `cycle_summaries` |
| Operations | `scan_jobs`, `worker_heartbeats`, `pri01_staging` |
| Billing | `moloni_invoices` |

#### Identity & Profile

**`customers`** — one row per Supabase Auth user; mirrors `auth.users` for non-auth metadata.
```sql
CREATE TABLE customers (
  id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                    text NOT NULL,                 -- mirrored from auth.users
  source                   text,                          -- FR7 funnel attribution (?source=...)
  campaign                 text,                          -- FR7 (?campaign=...)
  deletion_initiated_at    timestamptz,                   -- AD21
  deletion_scheduled_at    timestamptz,                   -- = deletion_initiated_at + 7d
  day5_reminder_sent_at    timestamptz,                   -- AD21 / Story 10.3 idempotency:
                                                          -- the day-5 deletion-grace-reminder cron sets this
                                                          -- on email send so retries don't double-send. Cleared
                                                          -- if customer cancels mid-grace (Story 10.2).
  -- F2: Stripe Customer + Subscription live at the customer level (one Subscription
  -- per customer, with one SubscriptionItem per customer_marketplace).
  -- Both NULL until first Go-Live click; populated atomically with the first
  -- SubscriptionItem creation.
  stripe_customer_id       text UNIQUE,
  stripe_subscription_id   text UNIQUE,
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_customers_deletion_scheduled_at
  ON customers(deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL;
-- RLS: customer can read own row; founder admin can read all
```

**`customer_profiles`** — NOT NULL business-entity fields per AD29; created atomically with `auth.users` row via a Postgres trigger (F3 lock).
```sql
CREATE TABLE customer_profiles (
  customer_id   uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  company_name  text NOT NULL,
  nif           text,                                     -- captured at first Moloni invoice (deferred per AD22 + AD29)
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);
-- RLS: customer reads/writes own row; founder admin read-only

-- F3: trigger on auth.users guarantees atomic creation. SECURITY DEFINER lets
-- the trigger function write to public.customer_profiles from the auth schema.
-- Validation failure raises EXCEPTION → rolls back the auth.users INSERT
-- (Postgres transaction semantics) → no orphan auth-without-profile state.
-- Note: this also creates the `customers` row in the same transaction (the row
-- shadows auth.users for non-auth metadata).
CREATE OR REPLACE FUNCTION handle_new_auth_user () RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_first_name   text := NEW.raw_user_meta_data ->> 'first_name';
  v_last_name    text := NEW.raw_user_meta_data ->> 'last_name';
  v_company_name text := NEW.raw_user_meta_data ->> 'company_name';
  v_source       text := NEW.raw_user_meta_data ->> 'source';
  v_campaign     text := NEW.raw_user_meta_data ->> 'campaign';
BEGIN
  IF v_first_name IS NULL OR length(trim(v_first_name)) = 0 THEN
    RAISE EXCEPTION 'first_name is required'
      USING ERRCODE = '23502', HINT = 'PROFILE_FIRST_NAME_REQUIRED';
  END IF;
  IF v_last_name IS NULL OR length(trim(v_last_name)) = 0 THEN
    RAISE EXCEPTION 'last_name is required'
      USING ERRCODE = '23502', HINT = 'PROFILE_LAST_NAME_REQUIRED';
  END IF;
  IF v_company_name IS NULL OR length(trim(v_company_name)) = 0 THEN
    RAISE EXCEPTION 'company_name is required'
      USING ERRCODE = '23502', HINT = 'PROFILE_COMPANY_NAME_REQUIRED';
  END IF;

  INSERT INTO public.customers (id, email, source, campaign)
    VALUES (NEW.id, NEW.email, v_source, v_campaign);

  INSERT INTO public.customer_profiles (customer_id, first_name, last_name, company_name)
    VALUES (NEW.id, trim(v_first_name), trim(v_last_name), trim(v_company_name));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handle_new_auth_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
```

→ The signup route (`app/src/routes/_public/signup.js`) catches `auth.signUp` errors, inspects the error's `HINT` (returned via Supabase as part of the error context) and maps `PROFILE_*_REQUIRED` to the appropriate PT-localized field error. Other unexpected errors fall through to the generic `getSafeErrorMessage()` per AD5.

**`founder_admins`** — AD4 access list.
```sql
CREATE TABLE founder_admins (
  email      text PRIMARY KEY,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
-- No RLS (system table; service-role-only access by definition)
```

#### Marketplaces & Keys

**`customer_marketplaces`** — one row per (customer, Mirakl marketplace). Holds A01 + PC01 captures, engine config, cron state, Stripe linkage.
```sql
CREATE TYPE cron_state AS ENUM (
  'PROVISIONING',                                          -- F4: row exists, scan running, A01/PC01 columns NULL until populated
  'DRY_RUN',
  'ACTIVE',
  'PAUSED_BY_CUSTOMER',
  'PAUSED_BY_PAYMENT_FAILURE',
  'PAUSED_BY_CIRCUIT_BREAKER',
  'PAUSED_BY_KEY_REVOKED',
  'PAUSED_BY_ACCOUNT_GRACE_PERIOD'
);
CREATE TYPE channel_pricing_mode AS ENUM ('SINGLE', 'MULTI', 'DISABLED');
CREATE TYPE csv_delimiter AS ENUM ('COMMA', 'SEMICOLON');
CREATE TYPE marketplace_operator AS ENUM ('WORTEN');     -- enum extends in Epic 2

CREATE TABLE customer_marketplaces (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  operator                        marketplace_operator NOT NULL,
  marketplace_instance_url        text NOT NULL,         -- e.g., https://marketplace.worten.pt

  -- A01 capture (AD16 step 2). F4: NULLABLE while cron_state = 'PROVISIONING'.
  -- CHECK constraint below enforces NOT NULL once the row leaves PROVISIONING.
  shop_id                         bigint,
  shop_name                       text,
  shop_state                      text,                  -- 'OPEN' | 'SUSPENDED' | etc.
  currency_iso_code               text,                  -- 'EUR' for Worten
  is_professional                 boolean,
  channels                        text[],                -- ['WRT_PT_ONLINE', 'WRT_ES_ONLINE']

  -- PC01 capture (AD16 step 3, AD26 monthly re-pull). F4: NULLABLE while PROVISIONING.
  channel_pricing_mode            channel_pricing_mode,
  operator_csv_delimiter          csv_delimiter,
  offer_prices_decimals           smallint,
  discount_period_required        boolean,
  competitive_pricing_tool        boolean,
  scheduled_pricing               boolean,
  volume_pricing                  boolean,
  multi_currency                  boolean,
  order_tax_mode                  text,                  -- 'TAX_INCLUDED' | 'TAX_EXCLUDED'
  platform_features_snapshot      jsonb,                 -- full PC01 response (AD26)
  last_pc01_pulled_at             timestamptz,

  -- Engine config (per-marketplace)
  max_discount_pct                numeric(5,4) NOT NULL,  -- e.g., 0.0150 = 1.5%
  max_increase_pct                numeric(5,4) NOT NULL DEFAULT 0.0500,
  edge_step_cents                 integer NOT NULL DEFAULT 1, -- Epic 2 customer config
  anomaly_threshold_pct           numeric(5,4),           -- NULL = use default 0.40
  tier_cadence_minutes_override   jsonb,                  -- NULL = use defaults

  -- State machine. F4: row is born in PROVISIONING (scan running, A01/PC01
  -- columns populating). Transitions to DRY_RUN at scan-complete (UX skeleton
  -- §8.3 /onboarding/scan-ready), then to ACTIVE on Go-Live click.
  cron_state                      cron_state NOT NULL DEFAULT 'PROVISIONING',
  cron_state_changed_at           timestamptz NOT NULL DEFAULT NOW(),

  -- Stripe linkage (F2 corrected): per-marketplace SubscriptionItem ID only.
  -- Stripe Customer + Subscription live on `customers` (one per MarketPilot customer).
  -- NULL until this marketplace's Go-Live (or until concierge-add for additional marketplaces).
  stripe_subscription_item_id     text UNIQUE,

  created_at                      timestamptz NOT NULL DEFAULT NOW(),
  updated_at                      timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (customer_id, operator, shop_id),                -- prevents accidental dup-add

  -- F4: leaving PROVISIONING requires all A01/PC01 captures populated.
  CONSTRAINT customer_marketplace_provisioning_completeness
    CHECK (
      cron_state = 'PROVISIONING'
      OR (
        shop_id IS NOT NULL
        AND shop_name IS NOT NULL
        AND shop_state IS NOT NULL
        AND currency_iso_code IS NOT NULL
        AND is_professional IS NOT NULL
        AND channels IS NOT NULL
        AND channel_pricing_mode IS NOT NULL
        AND operator_csv_delimiter IS NOT NULL
        AND offer_prices_decimals IS NOT NULL
        AND discount_period_required IS NOT NULL
        AND competitive_pricing_tool IS NOT NULL
        AND scheduled_pricing IS NOT NULL
        AND volume_pricing IS NOT NULL
        AND multi_currency IS NOT NULL
        AND order_tax_mode IS NOT NULL
        AND platform_features_snapshot IS NOT NULL
        AND last_pc01_pulled_at IS NOT NULL
      )
    )
);
CREATE INDEX idx_customer_marketplaces_customer_id ON customer_marketplaces(customer_id);
CREATE INDEX idx_customer_marketplaces_cron_state_active
  ON customer_marketplaces(id) WHERE cron_state = 'ACTIVE';
CREATE INDEX idx_customer_marketplaces_last_pc01_pulled_at
  ON customer_marketplaces(last_pc01_pulled_at);          -- AD26 monthly re-pull cron
-- RLS: customer reads/writes own; founder admin read-only
```

**`shop_api_key_vault`** — AD3 encrypted ciphertext.
```sql
CREATE TABLE shop_api_key_vault (
  customer_marketplace_id  uuid PRIMARY KEY REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  ciphertext               bytea NOT NULL,
  nonce                    bytea NOT NULL,                 -- 12 bytes for AES-256-GCM
  auth_tag                 bytea NOT NULL,                 -- 16 bytes
  master_key_version       integer NOT NULL DEFAULT 1,     -- supports rotation ceremony
  last_validated_at        timestamptz,                    -- last successful Mirakl call
  last_failure_status      smallint,                       -- last HTTP status if 401/403/etc.
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW()
);
-- RLS: customer reads existence-only (not values; values bypass-only via service-role decrypt)
-- App routes that need to read/decrypt go through worker-side endpoint OR service-role-bound
-- helper that decrypts in worker context only.
```

#### Catalog & Engine state

**`skus`** — per-(customer_marketplace, EAN), invariant catalog metadata.
```sql
CREATE TABLE skus (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  ean                      text NOT NULL,
  shop_sku                 text NOT NULL,                  -- seller-provided SKU (e.g., 'EZ8809606851663')
  product_sku              text,                           -- Mirakl internal UUID
  product_title            text,
  cost_cents               integer,                        -- Epic 2 reservation (cost-CSV)
  excluded_at              timestamptz,                    -- Epic 2 reservation (per-SKU exclude)
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (customer_marketplace_id, ean),
  UNIQUE (customer_marketplace_id, shop_sku)
);
CREATE INDEX idx_skus_customer_marketplace_id_ean
  ON skus(customer_marketplace_id, ean);
-- RLS: customer reads own (via customer_marketplaces FK)
```

**`sku_channels`** — the per-(SKU, channel) engine state row. The most-frequently-read table in the system.
```sql
CREATE TYPE tier_value AS ENUM ('1', '2a', '2b', '3');

CREATE TABLE sku_channels (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id                          uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  customer_marketplace_id         uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  channel_code                    text NOT NULL,           -- 'WRT_PT_ONLINE' | 'WRT_ES_ONLINE'

  -- Pricing state
  list_price_cents                integer NOT NULL,        -- engine anchor
  last_set_price_cents            integer,                 -- last PRI02-COMPLETE-confirmed price
  current_price_cents             integer,                 -- last P11-observed price
  pending_set_price_cents         integer,                 -- AD7 — set on PRI01 emit
  pending_import_id               text,                    -- AD7 — set on PRI01 emit; UUID from response

  -- Engine state
  tier                            tier_value NOT NULL,
  tier_cadence_minutes            smallint NOT NULL,       -- AD10 — driven by tier
  last_won_at                     timestamptz,             -- T1→T2a transition timestamp
  last_checked_at                 timestamptz NOT NULL,    -- last cycle that ran for this row
  last_set_at                     timestamptz,             -- last PRI02 COMPLETE timestamp

  -- Per-SKU freeze (orthogonal to cron_state per AD12)
  frozen_for_anomaly_review       boolean NOT NULL DEFAULT false,
  frozen_at                       timestamptz,
  frozen_deviation_pct            numeric(6,4),            -- captured at freeze time for context

  -- Per-SKU PRI01 failure tracking (Story 6.3 escalation per AD24)
  -- Incremented on each PRI03-reported per-SKU failure; reset on successful
  -- PRI02 COMPLETE for the SKU. At threshold (3 consecutive cycles per AD24),
  -- escalates to `pri01-fail-persistent` Atenção event + Resend critical alert
  -- + per-SKU freeze pending review. Bob's Story 6.3 sharding picks the freeze
  -- representation (option a: extend a `frozen_reason` enum discriminator over
  -- the existing `frozen_for_anomaly_review` boolean; option b: add a parallel
  -- `frozen_for_pri01_persistent` boolean). DECISION DEFERRED to Story 6.3
  -- sharding — see AD12 trailing note for trade-offs and the architecture-doc
  -- update obligation post-pick.
  pri01_consecutive_failures      smallint NOT NULL DEFAULT 0,

  -- Shipping (from OF21 / P11)
  min_shipping_price_cents        integer,
  min_shipping_zone               text,
  min_shipping_type               text,

  -- Channel availability
  channel_active_for_offer        boolean NOT NULL DEFAULT true,  -- if SKU listed only on one channel

  created_at                      timestamptz NOT NULL DEFAULT NOW(),
  updated_at                      timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (sku_id, channel_code)
);
-- Dispatcher hot-path index (AD17 dispatch query)
CREATE INDEX idx_sku_channels_dispatch
  ON sku_channels(customer_marketplace_id, last_checked_at, tier_cadence_minutes)
  WHERE pending_import_id IS NULL
    AND frozen_for_anomaly_review = false
    AND excluded_at IS NULL;
-- KPI computation index
CREATE INDEX idx_sku_channels_tier
  ON sku_channels(customer_marketplace_id, channel_code, tier);
-- Pending-import resolution
CREATE INDEX idx_sku_channels_pending_import_id
  ON sku_channels(pending_import_id) WHERE pending_import_id IS NOT NULL;
-- RLS: customer reads own (via customer_marketplace_id)
```

**`baseline_snapshots`** — captured at scan time per AD16 step 7; reserved for Epic 2 "restore baseline."
```sql
CREATE TABLE baseline_snapshots (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_channel_id           uuid NOT NULL REFERENCES sku_channels(id) ON DELETE CASCADE,
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  list_price_cents         integer NOT NULL,
  current_price_cents      integer NOT NULL,
  captured_at              timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_baseline_snapshots_sku_channel_id ON baseline_snapshots(sku_channel_id);
-- RLS: customer reads own (via customer_marketplace_id)
```

#### Audit & Aggregates

**`audit_log_event_types`** — lookup table for AD20 enum + priority mapping. Postgres enums work for taxonomic values, but the priority mapping needs a queryable form.
```sql
CREATE TYPE audit_log_priority AS ENUM ('atencao', 'notavel', 'rotina');

CREATE TABLE audit_log_event_types (
  event_type   text PRIMARY KEY,
  priority     audit_log_priority NOT NULL,
  description  text NOT NULL                            -- short PT-localized hint
);
-- Seeded with the AD20 taxonomy at migration time: 26 base rows from Story 9.0
-- (7 Atenção + 8 Notável + 11 Rotina). Stories 12.1 and 12.3 each ALTER TABLE
-- ADD a row in their own migration, bringing total to 28 at end of MVP.
-- Tests assert against EVENT_TYPES.length (shared/audit/event-types.js), never
-- a hardcoded integer.
```

**`audit_log`** — partitioned by month per AD19. Append-only at app layer (NFR-S6).
```sql
CREATE TABLE audit_log (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL,
  -- F8: sku_id and sku_channel_id intentionally carry NO FK constraint —
  -- preserves audit history if a SKU or sku_channel is later removed from
  -- catalog (e.g., seller delists). Audit log is immutable per NFR-S6;
  -- referential integrity to ephemeral catalog rows would compromise that.
  sku_id                   uuid,                          -- null for marketplace-level events; NO FK
  sku_channel_id           uuid,                          -- null for SKU-or-marketplace-level events; NO FK
  cycle_id                 uuid,                          -- null outside cycle context
  event_type               text NOT NULL REFERENCES audit_log_event_types(event_type),
  priority                 audit_log_priority NOT NULL,   -- denormalized via trigger
  payload                  jsonb NOT NULL,                -- structured per @typedef PayloadFor<EventType>
  resolved_at              timestamptz,                   -- for Atenção events resolved by customer
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Initial partition (Bob seeds 12 months ahead in Story 9.1)
CREATE TABLE audit_log_2026_05 PARTITION OF audit_log
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
-- ... (one per month, ahead-create cron handles future)

-- Compound indexes (AD19 spec)
CREATE INDEX idx_audit_log_customer_created
  ON audit_log(customer_marketplace_id, created_at DESC);
CREATE INDEX idx_audit_log_customer_sku_created
  ON audit_log(customer_marketplace_id, sku_id, created_at DESC) WHERE sku_id IS NOT NULL;
CREATE INDEX idx_audit_log_customer_eventtype_created
  ON audit_log(customer_marketplace_id, event_type, created_at DESC);
CREATE INDEX idx_audit_log_customer_cycle
  ON audit_log(customer_marketplace_id, cycle_id, sku_id) WHERE cycle_id IS NOT NULL;

-- Trigger: derive priority from event_type lookup
CREATE OR REPLACE FUNCTION audit_log_set_priority () RETURNS trigger AS $$
BEGIN
  SELECT priority INTO NEW.priority
    FROM audit_log_event_types
   WHERE event_type = NEW.event_type;
  IF NEW.priority IS NULL THEN
    RAISE EXCEPTION 'Unknown audit_log event_type: %', NEW.event_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_log_set_priority
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_set_priority();
-- RLS: customer reads own (via customer_marketplace_id); append-only at app layer
```

**`daily_kpi_snapshots`** — per AD19 precomputed aggregate, refreshed at midnight + partial 5-min refresh for "today."
```sql
CREATE TABLE daily_kpi_snapshots (
  customer_marketplace_id          uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  channel_code                     text NOT NULL,
  date                             date NOT NULL,           -- Europe/Lisbon date
  skus_in_first_count              integer NOT NULL DEFAULT 0,
  skus_losing_count                integer NOT NULL DEFAULT 0,
  skus_exclusive_count             integer NOT NULL DEFAULT 0,
  catalog_value_at_risk_cents      bigint NOT NULL DEFAULT 0,
  undercut_count                   integer NOT NULL DEFAULT 0,
  ceiling_raise_count              integer NOT NULL DEFAULT 0,
  hold_count                       integer NOT NULL DEFAULT 0,
  external_change_absorbed_count   integer NOT NULL DEFAULT 0,
  anomaly_freeze_count             integer NOT NULL DEFAULT 0,
  refreshed_at                     timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_marketplace_id, channel_code, date)
);
CREATE INDEX idx_daily_kpi_snapshots_date ON daily_kpi_snapshots(date);
-- RLS: customer reads own
```

**`cycle_summaries`** — per AD19 written at cycle end.
```sql
CREATE TABLE cycle_summaries (
  cycle_id                  uuid PRIMARY KEY,
  customer_marketplace_id   uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  started_at                timestamptz NOT NULL,
  completed_at              timestamptz,
  tier_breakdown            jsonb,                          -- {"1": 300, "2a": 50, "2b": 100, "3": 20}
  undercut_count            integer NOT NULL DEFAULT 0,
  ceiling_raise_count       integer NOT NULL DEFAULT 0,
  hold_count                integer NOT NULL DEFAULT 0,
  failure_count             integer NOT NULL DEFAULT 0,
  circuit_breaker_tripped   boolean NOT NULL DEFAULT false,
  skus_processed_count      integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_cycle_summaries_customer_started
  ON cycle_summaries(customer_marketplace_id, started_at DESC);
-- RLS: customer reads own
```

#### Operations

**`scan_jobs`** — async catalog scan state per AD16 + FR12–FR14.
```sql
CREATE TYPE scan_job_status AS ENUM (
  'PENDING',
  'RUNNING_A01',
  'RUNNING_PC01',
  'RUNNING_OF21',
  'RUNNING_P11',
  'CLASSIFYING_TIERS',
  'SNAPSHOTTING_BASELINE',
  'COMPLETE',
  'FAILED'
);

CREATE TABLE scan_jobs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  status                   scan_job_status NOT NULL DEFAULT 'PENDING',
  phase_message            text NOT NULL DEFAULT 'A iniciar análise…',  -- PT-localized progress
  skus_total               integer,
  skus_processed           integer NOT NULL DEFAULT 0,
  failure_reason           text,
  started_at               timestamptz NOT NULL DEFAULT NOW(),
  completed_at             timestamptz,

  -- One scan job at a time per marketplace
  CONSTRAINT scan_job_unique_per_marketplace
    EXCLUDE USING btree (customer_marketplace_id WITH =)
    WHERE (status NOT IN ('COMPLETE', 'FAILED'))
);
-- RLS: customer reads own
```

**`worker_heartbeats`** — AD23 liveness signal.
```sql
CREATE TABLE worker_heartbeats (
  id                  bigserial PRIMARY KEY,
  worker_instance_id  text NOT NULL,                       -- e.g., Coolify container hostname
  written_at          timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_worker_heartbeats_written_at
  ON worker_heartbeats(written_at DESC);
-- No RLS (operational table; service-role only)
-- Retention: keep last 24h via daily prune cron (cheap; this table grows fast)
```

**`pri01_staging`** — per-cycle staging table per AD7/AD8. Rows are written by the engine, consumed by the writer, then archived (move to `audit_log` as `pri01-submit` events) and truncated.
```sql
CREATE TABLE pri01_staging (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  sku_id                   uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  channel_code             text NOT NULL,
  new_price_cents          integer NOT NULL,
  cycle_id                 uuid NOT NULL,
  staged_at                timestamptz NOT NULL DEFAULT NOW(),
  flushed_at               timestamptz,                    -- set when PRI01 submitted
  import_id                text                            -- set when PRI01 returned import_id
);
CREATE INDEX idx_pri01_staging_cycle ON pri01_staging(cycle_id);
CREATE INDEX idx_pri01_staging_sku_unflushed
  ON pri01_staging(sku_id) WHERE flushed_at IS NULL;
-- RLS: customer reads own (via customer_marketplace_id)
```

#### Billing

**`moloni_invoices`** — AD22.
```sql
CREATE TABLE moloni_invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                 uuid NOT NULL REFERENCES customers(id),
  customer_marketplace_id     uuid REFERENCES customer_marketplaces(id),  -- null if multi-marketplace invoice
  moloni_invoice_id           text NOT NULL,                              -- Moloni-side identifier
  stripe_payment_intent_id    text NOT NULL,                              -- links to Stripe payment
  amount_cents                integer NOT NULL,
  nif                         text NOT NULL,                              -- captured at invoice generation
  issued_at                   timestamptz NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (moloni_invoice_id)
);
CREATE INDEX idx_moloni_invoices_customer ON moloni_invoices(customer_id, issued_at DESC);
-- RLS: customer reads own; founder admin read-write
-- Retained even after account deletion (fiscal record per AD21)
```

#### RLS policy summary

Every customer-scoped table carries two policies:
- **`<table>_select_own`** — `USING (customer_id = auth.uid())` for tables with direct customer FK; `USING (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))` for tables linked through marketplace.
- **`<table>_modify_own`** — `WITH CHECK (...)` matching the SELECT predicate, applied to INSERT/UPDATE/DELETE where customer-write is allowed.

For tables where customers should NOT be able to write (e.g., `audit_log`, `cycle_summaries`, `daily_kpi_snapshots`, `worker_heartbeats`), only the SELECT policy is added; INSERT/UPDATE/DELETE are service-role-only.

**Service-role bypass:** the worker process and `/admin/*` routes (server-side only) connect with `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS. The contract these paths must obey:
- Worker queries MUST `.eq('customer_marketplace_id', ...)` explicitly per Step 5 multi-tenant pattern (custom ESLint rule enforces).
- `/admin/*` routes use service-role only for read; never write to customer-scoped tables outside the documented admin actions (none at MVP).

#### Schema reservations for Epic 2 (no migration later)

Already noted inline in the table definitions; consolidated:

| Reserved column | Table | Default | Epic 2 use |
|---|---|---|---|
| `cost_cents` | `skus` | NULL | Cost-CSV upload |
| `excluded_at` | `skus` | NULL | Per-SKU exclude / "promo mode" |
| `anomaly_threshold_pct` | `customer_marketplaces` | NULL → code uses 0.40 | Customer-tunable threshold |
| `tier_cadence_minutes_override` | `customer_marketplaces` | NULL | Per-customer cadence customization |
| `edge_step_cents` | `customer_marketplaces` | 1 | Customer-config undercut step |
| `master_key_version` | `shop_api_key_vault` | 1 | Master-key rotation ceremony (AD3) |

### FR/AD → File Mapping

For Bob's story sharding. Each row points to where the work physically lives.

| Spec ref | Where it lives |
|---|---|
| FR1, FR3 (auth + signup) | `app/src/routes/_public/{signup,login,verify-email,forgot-password,reset-password}.js` + `app/src/middleware/auth.js` |
| FR2 (single login) | Implicit in Supabase Auth — no per-customer multi-user table at MVP |
| FR4 + AD21 (deletion) | `app/src/routes/settings/delete.js` + `worker/src/jobs/deletion-grace.js` + email templates `app/src/views/emails/deletion-*.eta` |
| FR5 + AD2 (RLS) | `db/migrations/*.sql` (each customer-scoped table's policy) + `scripts/rls-regression-suite.js` |
| FR6 + AD4 (founder admin) | `app/src/routes/admin/status.js` + `db/migrations/202604301202_create_founder_admins.sql` |
| FR7 (source-context capture) | `app/src/middleware/source-context-capture.js` |
| FR8–FR11 + AD3 (key vault) | `app/src/routes/onboarding/key.js` + `shared/crypto/envelope.js` + `shared/mirakl/api-client.js` |
| FR12–FR15 + AD16 (catalog scan) | `app/src/routes/onboarding/scan.js` + `worker/src/jobs/master-cron.js` (scan jobs are also cron-driven) + `db/migrations/202604301211_create_scan_jobs.sql` |
| FR16 (margin question) | `app/src/routes/onboarding/margin.js` |
| FR17–FR19 + AD10 (tier system) | `worker/src/engine/tier-classify.js` + `db/migrations/202604301206_create_sku_channels.sql` |
| FR20–FR25 + AD8, AD13, AD14 (engine) | `worker/src/engine/decide.js` + `shared/mirakl/{p11,self-filter}.js` |
| FR22 + AD9 (cooperative-absorption) | `worker/src/engine/cooperative-absorb.js` |
| FR23 + AD7 (PRI01) | `shared/mirakl/{pri01-writer,pri02-poller,pri03-parser}.js` |
| FR26–FR27 + AD11 (circuit breaker) | `worker/src/safety/circuit-breaker.js` (per-cycle) + inline in `worker/src/engine/decide.js` (per-SKU) |
| FR28 (nightly reconciliation) | `worker/src/safety/reconciliation.js` (Tier 3 daily pass) |
| FR29 + AD12 (anomaly freeze) | `worker/src/safety/anomaly-freeze.js` + `app/src/routes/audit/anomaly-review.js` |
| FR30–FR32 (dry-run + Go-Live + pause) | `app/src/routes/dashboard/{go-live,pause-resume}.js` + UX modal eta files |
| FR33 (baseline snapshot) | `db/migrations/202604301207_create_baseline_snapshots.sql` + scan flow |
| FR34–FR39 + AD15 (dashboard + state UI) | `app/src/routes/dashboard/index.js` + `app/src/views/components/{kpi-cards,banners}.eta` |
| FR36 (margin editor) | `app/src/routes/dashboard/margin-edit.js` + `app/src/views/components/margin-editor.eta` + `public/js/margin-editor.js` |
| FR37–FR38d + AD19, AD20 (audit log) | `app/src/routes/audit/*` + `shared/audit/*` + `db/migrations/202604301208_create_audit_log_partitioned.sql` |
| FR40–FR44 + AD22 (Stripe + Moloni) | `shared/stripe/*` + `app/src/routes/_webhooks/stripe.js` + `shared/moloni/invoice-metadata.js` |
| FR41 (concierge marketplace add) | `app/src/routes/settings/marketplaces.js` (read-only at MVP per UX §8.5) |
| FR45 + AD23 (/health) | `app/src/routes/health.js` + `worker/src/jobs/heartbeat.js` |
| FR46 + AD24 (3-tier failure model) | Distributed: retry in `shared/mirakl/api-client.js` (transient); per-SKU in PRI01 lifecycle; critical in `shared/audit/writer.js` + `shared/resend/client.js` |
| FR47 + AD4 (founder dashboard) | `app/src/routes/admin/status.js` + reuses `app/src/routes/audit/*` with `?as_admin=` parameter |
| FR48 + AD25 (Resend) | `shared/resend/client.js` + `app/src/views/emails/critical-alert.eta` |
| AD17 (dispatcher) | `worker/src/dispatcher.js` + `worker/src/advisory-lock.js` |
| AD26 (PC01 monthly re-pull) | `worker/src/jobs/pc01-monthly-repull.js` |
| AD27 (logging) | Pino config in `app/src/server.js` and `worker/src/index.js` |
| AD28 (validation) | Per-route `schema:` config in route files (Fastify built-in) |
| AD29 (customer profile) | `app/src/routes/_public/signup.js` (atomic transaction) + `db/migrations/202604301201_create_customer_profiles.sql` |
| AD30 (RLS regression) | `scripts/rls-regression-suite.js` + `tests/integration/rls-regression.test.js` |

### Integration Boundaries

#### External integrations

| Service | Direction | Touchpoint | Auth | Failure mode |
|---|---|---|---|---|
| **Mirakl Marketplace API** (Worten) | Outbound only | `shared/mirakl/api-client.js` | `Authorization: <encrypted-key-decrypted-in-worker>` | 3-tier model (AD24) |
| **Supabase Auth** | Bidirectional | `@supabase/supabase-js` in app | Anon key (client), JWT-bound RLS | Standard Supabase availability |
| **Supabase Postgres** | Bidirectional | `pg` (worker) + `@supabase/supabase-js` (app) | Service-role (worker) / JWT (app) | Standard Postgres availability |
| **Stripe** | Bidirectional | `shared/stripe/*` (out) + `app/src/routes/_webhooks/stripe.js` (in) | Secret key (out), signature verify (in) | Webhook idempotency via `stripe_payment_intent_id` UNIQUE constraint |
| **Resend** | Outbound only | `shared/resend/client.js` | API key | Failure logged; alert ops; never blocks engine |
| **UptimeRobot** | Inbound (pings) | `app/src/routes/health.js` | None (public endpoint) | Failure → founder email |
| **Moloni** | Manual at MVP | Founder UI; `shared/moloni/invoice-metadata.js` writes metadata | N/A at MVP | N/A |

#### Internal boundaries

- **App ↔ Worker**: communicate via Postgres only. No direct HTTP, no shared message bus. Worker reads `customer_marketplaces.cron_state` to know what to dispatch; app writes the state through `transitionCronState`. Loosely coupled by design — either service can restart without affecting the other.
- **Shared ↔ App / Worker**: pure JS imports. `shared/` modules are stateless or factory-wrapped; the consuming process supplies the DB client.
- **Public ↔ App**: HTTPS only via Coolify. TLS terminated at Coolify; Fastify serves HTTP behind it.

#### Data flow — engine cycle (the load-bearing flow)

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

### Notable absences (deliberately deferred to Epic 2)

- **No customer-facing API endpoints** — UI is server-rendered only. JSON only for Stripe webhooks (incoming) and audit-log fragment endpoints (HTML, not JSON, despite "fragment" naming).
- **No connection pooler for the worker** — `pg` opens a small pool internally; at MVP scale (5–10 customers, single worker, 5-min cycles) this is sufficient. PgBouncer / Supavisor introduction is a known Epic 2 trigger when worker count exceeds 1.
- **No CDN** for `public/` — served directly via `@fastify/static` at MVP. Cloudflare in front of Coolify is an Epic 2 trigger if dashboard rendering latency becomes customer-visible (unlikely at PT/ES geographic concentration with Hetzner Frankfurt).
- **No background queue (BullMQ, etc.)** — DynamicPriceIdea uses BullMQ + Redis for queuing report jobs. The repricer's queue equivalent is `pri01_staging` table + Postgres advisory locks. No Redis dep at MVP. Trigger to add: > 5–10 second cycle latency requires async fan-out worker pattern.

### Development workflow

- `npm install` — single package install; no workspace logic.
- `npm run start:app` — Fastify on port 3000.
- `npm run start:worker` — cron service.
- `npm run start:both` — concurrently run both for local dev (uses `concurrently` if added; optional).
- `npm test` — `node --test --env-file-if-exists=.env.test 'tests/**/*.test.js'`.
- `npm run test:rls` — runs only `tests/integration/rls-regression.test.js`.
- `npm run lint` — ESLint over `app/`, `worker/`, `shared/`, `scripts/`.
- `npm run db:migrate` — Supabase CLI applies pending migrations.
- `npm run db:reset` — Supabase CLI resets local dev DB (test env only).
- `npm run mirakl:verify` — runs `scripts/mirakl-empirical-verify.js` against `.env.local`.

### Deployment workflow

- `git push` to main → Coolify webhook → both services rebuild + redeploy in parallel.
- **Worker process count at MVP: ONE instance** (Coolify configured `replicas: 1` for the worker service). Horizontal scaling to multiple worker instances is supported by AD17's per-customer `pg_try_advisory_lock` pattern but is an Epic 2 trigger when cycle latency exceeds NFR-P1/P2 budgets (Tier 1/2a p95 ≤18 min). Multi-worker activation is a Coolify config change with no code edits.
- App process count at MVP: ONE instance (Coolify `replicas: 1`). Stateless — horizontal scaling is trivial when traffic justifies; Coolify config-only.
- Pre-deploy: GitHub Actions runs `npm test` + `npm run lint` + `npm run test:rls`. Block deploy on any failure.
- Post-deploy: UptimeRobot detects the new deploy via `/health` (no manual check needed).
- Rollback: Coolify keeps the previous image; rollback is a one-click revert in the Coolify UI. Documented in `scripts/rollback-runbook.md` (Bob ships this in Story 1.x).

## Architecture Validation Results

This section runs three checks on the document: (1) coherence — do the 30 ADs, 11 amendments, and Step 5 patterns work together without contradiction; (2) requirements coverage — does every PRD FR and NFR map to an architectural answer; (3) implementation readiness — can a BAD subagent implement Story 1.1 without re-deriving anything.

### Pass 1 — initial validation (caught 11 issues)

A self-audit on the post-Step-6 document caught 11 findings, all addressed via inline amendments above. Listed here for traceability:

| # | Severity | Finding | Amendment |
|---|---|---|---|
| F1 | 🔴 Critical | AD10 said "no DB write needed" for T2a→T2b; without writing `tier_cadence_minutes=45`, dispatcher predicate keeps the row at 15-min cadence forever | AD10 transition list updated to write `tier='2b'`, `tier_cadence_minutes=45` atomic with `tier-transition` audit event |
| F2 | 🔴 Critical | AD22 was internally contradictory (one Subscription per marketplace + 5 line items on one Subscription) | Stripe model corrected: one Customer + one Subscription per MarketPilot customer, one SubscriptionItem per marketplace. Schema: `stripe_customer_id` + `stripe_subscription_id` moved to `customers`; `stripe_subscription_item_id` added to `customer_marketplaces` |
| F3 | 🔴 Critical | AD29 said "atomic with auth user creation" without specifying mechanism (Pedro's flag) | Locked: Postgres trigger on `auth.users` AFTER INSERT, `SECURITY DEFINER`, reads `raw_user_meta_data` JSONB, validates required fields, RAISE EXCEPTION rolls back the auth user creation. Full trigger DDL inline in schema. Migration filename updated to reflect inclusion |
| F4 | 🔴 Critical | Schema chicken-and-egg: `scan_jobs` needed `customer_marketplace_id` FK target, but A01/PC01 columns were NOT NULL (couldn't populate before scan ran) | Added `'PROVISIONING'` to `cron_state` enum; relaxed A01/PC01 columns to NULLABLE; added CHECK constraint `customer_marketplace_provisioning_completeness` enforcing all populated when `cron_state != 'PROVISIONING'`; default state changed from `DRY_RUN` to `PROVISIONING` |
| F5 | 🔴 Critical | `audit_log_event_types` lookup table referenced as FK target but missing from migrations list | Added `202604301207b_create_audit_log_event_types.sql` ahead of `_create_audit_log_partitioned.sql`; seeded with AD20 taxonomy (26 base rows) in same migration; Stories 12.1 + 12.3 each ALTER-INSERT one row, bringing end-of-MVP total to 28 |
| F6 | 🟡 Important | AD11 per-cycle 20% denominator was ambiguous ("20% of catalog") | Made explicit: numerator = staged-for-write count this cycle; denominator = `COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $1 AND excluded_at IS NULL` |
| F7 | 🟡 Important | NIF capture flow was implicit (schema had nullable column on profiles, NOT NULL on invoices, but no flow description) | AD22 NIF capture flow added: founder asks at Day-3 pulse-check, persists to both `customer_profiles.nif` and `moloni_invoices.nif`; subsequent invoices pre-fill |
| F8 | 🟡 Important | `audit_log.sku_id` and `sku_channel_id` had unspecified FK posture | Inline schema comment: NO FK constraint, intentional for audit-log immutability through SKU lifecycle |
| F9 | 🟡 Important | Step 6 listed `public/js/*.js` modules without saying how they load | Added: each eta page includes `<script src="/js/<page>.js" defer>` near `</body>`, no bundler |
| F10 | 🟢 Nice-to-have | Sustained-transient threshold (3 cycles) hardcoded; per-customer-config worth flagging | AD24 amended with Epic 2 trigger note: nullable `customer_marketplace.sustained_transient_cycle_threshold` column |
| F11 | 🟢 Nice-to-have | Worker process count was implicit | Step 6 deployment workflow: explicit `replicas: 1` for both app and worker at MVP; horizontal scaling is Epic 2 trigger via AD17 advisory locks |

### Pass 2 — fresh re-validation against the amended document (caught 2 residual issues)

After applying F1–F11, I ran the validation pass again against the amended document. The first pass surfaced architectural contradictions; the second pass looks for inconsistencies introduced BY the amendments. Two residual issues were caught and fixed:

| # | Severity | Finding | Resolution |
|---|---|---|---|
| F12 | 🟡 Important | F2 (Stripe model) was applied to the schema and AD22 prose, but a stale "Schema reservation for Epic 2" line in AD22 still referenced the old `customer_marketplace.stripe_subscription_id` / `customer_marketplace.stripe_customer_id` columns | Updated to cite the new Stripe linkage layout: `customers.stripe_customer_id`, `customers.stripe_subscription_id`, `customer_marketplaces.stripe_subscription_item_id` |
| F13 | 🟡 Important | Cron-state enum-value casing was inconsistent across the doc — schema declared UPPER_SNAKE_CASE (`'ACTIVE'`, `'PAUSED_BY_CUSTOMER'`, etc.) per Step 5 naming pattern, but multiple prose references and SQL examples used lowercase (`'active'`, `'paused_by_circuit_breaker'`, etc.). A subagent reading the lowercase examples would write code that fails the enum constraint | Standardized all references to UPPER_SNAKE_CASE matching the SQL enum: AD11 (2 spots), AD15 dispatcher predicate, AD17 dispatch SQL, AD21 deletion flow + cancel-mid-grace, frontmatter C-lock summary line, Step 5 cron-state JSDoc example. Cross-cutting concerns paragraph updated. The frontmatter line preserves the lock-decision provenance with a clarifying note |

Two residual findings is on the lower end of expected for an 11-amendment cascade against a 2,000+ line spec. Both were mechanical (stale reference + casing drift), neither structural. The fixes are localized and don't trigger further cascades.

### Coherence Validation ✅ (post-Pass-2)

**Decision compatibility.** All 30 ADs are mutually consistent post-amendments. Cross-cutting checks performed:

- **AD7 (PRI01 per-SKU writer) ↔ AD9 (cooperative-absorption skip-on-pending) ↔ AD10 (T2a→T2b write).** All three converge on the `pending_import_id` invariant: any row with `pending_import_id IS NOT NULL` is skipped by absorption AND skipped by tier-transition AND skipped by dispatcher. PRI02 COMPLETE clears the column atomically across all participating rows. Coherent.
- **AD11 (circuit breaker) ↔ AD15 (cron_state) ↔ F6 (denominator).** Per-cycle trip → `transitionCronState` to `'PAUSED_BY_CIRCUIT_BREAKER'` (atomic with audit event per Step 5 pattern). Manual unblock → back to `'ACTIVE'`. Denominator query is well-defined against `sku_channels.excluded_at`. Coherent.
- **AD16 (onboarding sequence) ↔ F4 (PROVISIONING).** Customer pastes key → key-validate → `customer_marketplace` row created in `'PROVISIONING'` (default per F4) → scan_job created (FK target now exists) → A01 + PC01 + OF21 + P11 run, populating the nullable columns → scan completes → `transitionCronState` to `'DRY_RUN'`. CHECK constraint blocks the transition if any A01/PC01 column is still NULL. Coherent.
- **F2 (Stripe customer-level) ↔ AD21 (deletion grace + cancel_at_period_end).** `cancel_at_period_end=true` operates on the Subscription (customer-level), so cancellation cancels the whole Subscription = all marketplaces for that customer at end of billing period. Marketplace-level removal (FR41 Epic 2) operates on `SubscriptionItem` instead. Different operations on different Stripe objects. Coherent.
- **F3 (auth+profile trigger) ↔ AD29 (NOT NULL fields) ↔ F4 (PROVISIONING).** Trigger creates `customers` and `customer_profiles` rows in one transaction. Customer-marketplaces are created later (when customer pastes their first Worten key) — independent flow. The trigger does NOT create `customer_marketplaces`; F4's PROVISIONING state is for THAT separate row. No interaction. Coherent.
- **AD13 (self-filter) ↔ AD14 (P11 placeholder filter) ↔ Step 5 single-source-of-truth `shared/mirakl/self-filter.js`.** Filter chain order is well-defined: `active === true` → `total_price > 0` → `shop_name !== own_shop_name` → ranking. One module, one chain, no parallel implementations. Coherent.

**Pattern consistency.** All Step 5 patterns survived the amendments:
- Single-source-of-truth modules unchanged; `shared/state/cron-state.js` carries the new `PROVISIONING` value through its legal-transitions matrix (Bob's Story 1.x will encode it).
- Naming conventions: F13 normalized casing — all enum-value references now UPPER_SNAKE_CASE, matching the pattern doc.
- JSON snake_case for wire formats: F2's `stripe_subscription_item_id` follows the pattern.
- Money-cents discipline: no amendment touched price math.
- Audit-event emission via `writeAuditEvent`: F1's `tier-transition` event uses the canonical pattern; F6's `circuit-breaker-trip` was already canonical.

**Structure alignment.** The directory tree's customer_profiles trigger lives in the same migration file as the table, per Step 5 ("RLS policy + table in same migration; trigger + table same migration"). Migration ordering is now well-defined: customers → customer_profiles_with_trigger → founder_admins → customer_marketplaces → shop_api_key_vault → skus → sku_channels → baseline_snapshots → audit_log_event_types → audit_log_partitioned → ... All FK targets exist when their referencer migrates.

### Requirements Coverage Validation ✅

| FR Group | Coverage | Notes |
|---|---|---|
| **A. Account & Identity (FR1–FR7)** | ✅ Complete | F3 closed the atomicity gap on FR1. FR4 amended deletion + AD21. FR5 RLS via AD2 + AD30. FR7 source-context middleware in app routes. |
| **B. API Key & Catalog Onboarding (FR8–FR16)** | ✅ Complete | F4 closed the schema chicken-and-egg on FR12–FR15. AD3 + AD16 cover encrypted vault + scan sequence. |
| **C. Pricing Engine (FR17–FR25)** | ✅ Complete | F1 closed the T2a→T2b cadence gap. AD8 enumerates the decision table. AD13 + AD14 lock the filter chain. |
| **D. Engine Safety (FR26–FR33)** | ✅ Complete | F6 closed circuit-breaker denominator ambiguity. AD11 + AD12 are layered (engine per-SKU, dispatcher per-cycle, anomaly per-SKU). FR33 baseline_snapshots table reserved. |
| **E. Dashboard & Audit Log (FR34–FR39)** | ✅ Complete | F5 closed the migration ordering gap. AD19 + AD20 with the lookup table + trigger handle volume math + taxonomy enforcement. |
| **F. Subscription & Billing (FR40–FR44)** | ✅ Complete | F2 closed the Stripe model contradiction. F7 closed the NIF capture flow. AD22 corrected. |
| **G. Operations & Alerting (FR45–FR48)** | ✅ Complete | AD23 + AD24 + AD25 cover health + 3-tier failure model + alerts. F11 made worker count explicit. |

| NFR Group | Coverage | Notes |
|---|---|---|
| **Performance (NFR-P1–P10)** | ✅ Complete | NFR-P10 (catalog scan) UNVERIFIED at MVP — empirical-verify script seeds latency floor (P11 ~140ms single call); calibrate during dogfood as documented. |
| **Security (NFR-S1–S7)** | ✅ Complete | NFR-S1 envelope encryption (AD3 + master_key_version). NFR-S3 RLS (AD2 + AD30). NFR-S6 append-only via DB-level event_types lookup + trigger + no-FK on audit_log columns. |
| **Scalability (NFR-Sc1–Sc5)** | ✅ Complete | NFR-Sc3 advisory locks (AD17). F11 explicit single-worker default with horizontal-scale Epic 2 trigger. |
| **Reliability (NFR-R1–R5)** | ✅ Complete | F11 Coolify rollback + worker_heartbeats + /health composition. AD24 3-tier model. |
| **Integration Quality (NFR-I1–I6)** | ✅ Complete | All five external integrations mapped to specific files in Step 6 FR/AD→file table. |
| **Accessibility / Localization (NFR-A1–A3, NFR-L1–L2)** | ✅ Spec-locked | UX skeleton enforces; backend doesn't alter. |
| **Operational (NFR-O1–O3)** | ✅ Complete | All three are documented founder-side commitments. Bob's stories include the runbook + monitoring dashboard. |

### Implementation Readiness Validation ✅

**Decision completeness.** All 30 ADs carry: (1) the decision; (2) FR/NFR trace; (3) MCP or empirical citation; (4) Bob-story handoff. No "TBD" placeholders. Six PRD gaps explicitly closed (engine decision table, PRI01/PRI02 race, Tier 2b cadence, audit-log indexing, /health composition, RLS-vs-service-role split).

**Structure completeness.** Step 6 directory tree names every file location BAD subagents need. 14-table schema with full DDL. RLS policy intent declared per table. FR/AD→file mapping covers 30+ rows.

**Pattern completeness.** Step 5 ships:
- 11 single-source-of-truth modules locked (no parallel implementations possible without ESLint failure)
- 17 enumerated engine fixture files (executable spec for AD8)
- 10-rule mechanical enforcement matrix
- Naming + structure + format + communication + process patterns each with concrete examples (good vs anti-pattern)

**Verification artifact reuse.** `scripts/mirakl-empirical-verify.js` doubles as Bob's Story 1.X smoke test; `verification-results.json` (live Worten captures) seeds the Mirakl mock server fixtures.

### Pedro's Two Flagged Checks — Verified

✅ **Atomic auth+profile creation pattern** — F3 locked the Postgres trigger pattern (option a). Trigger is `SECURITY DEFINER`, validates required fields with `RAISE EXCEPTION`, rolls back atomically via Postgres transaction semantics. Full DDL inline in schema. Migration filename `202604301201_create_customer_profiles_with_trigger.sql` reflects inclusion.

✅ **5 Epic 2 schema reservations all landed:**
- `customer_marketplaces.anomaly_threshold_pct` (numeric, nullable, defaults to 0.40 in code) — line 1707
- `customer_marketplaces.tier_cadence_minutes_override` (jsonb, nullable) — line 1709
- `customer_marketplaces.edge_step_cents` (integer NOT NULL DEFAULT 1) — line 1706
- `skus.cost_cents` (integer, nullable) — Step 6 schema reservation table
- `skus.excluded_at` (timestamptz, nullable) — Step 6 schema reservation table
- Bonus: `shop_api_key_vault.master_key_version` (integer NOT NULL DEFAULT 1) — supports AD3 rotation
- Bonus (post-F10): `customer_marketplaces.sustained_transient_cycle_threshold` flagged for Epic 2 (no MVP column)

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] PRD (51 FRs across 7 groups) and UX skeleton (38 UX requirements) loaded and mapped
- [x] All NFRs traced to architectural answers
- [x] Empirical reality (Worten via Easy-Store, 2026-04-30) grounds Mirakl-touching decisions
- [x] 5 reference repos surveyed (DPI reused; Gabriel partial; OUTREACH/PRICING skipped)

**✅ Architectural Decisions**
- [x] 30 numbered ADs, each with FR/NFR + MCP/empirical citation + Bob-story trace
- [x] 6 explicit PRD gaps closed (engine decision table, race resolution, cadence values, audit-log indexing, /health, RLS+service-role split)
- [x] 15 MCP verification questions resolved (10 from PRD/distillate + 5 added during work)
- [x] Critical pre-locks captured: A1 deletion+Stripe, B1 envelope encryption, C single cron_state enum, engine edge-step logic, schema reservations, customer profile NOT NULL fields

**✅ Implementation Patterns**
- [x] 11 single-source-of-truth modules locked
- [x] Naming + structure + format + communication + process patterns each with examples
- [x] 10-rule mechanical enforcement matrix (ESLint custom rules + secret-scanning + RLS regression suite)
- [x] 17 engine fixture cases enumerated
- [x] Mirakl mock server seed strategy (`verification-results.json` → fixtures)

**✅ Project Structure**
- [x] Complete directory tree (every file location)
- [x] 14-table schema with full DDL, RLS policies, indexes, triggers, CHECK constraints
- [x] Migration file ordering with FK target verification
- [x] FR/AD→file mapping (30+ rows)
- [x] External + internal integration boundaries
- [x] Engine cycle data flow trace (the load-bearing flow)

**✅ Validation**
- [x] Pass 1: 11 findings → all addressed via inline amendments
- [x] Pass 2: 2 residual findings (stale reference, casing drift) → addressed
- [x] Coherence cross-checks across 6 critical AD intersections
- [x] Pedro's flagged checks verified
- [x] Schema reservations confirmed

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence Level: HIGH.**
- Empirical grounding against live Worten via Easy-Store, not just MCP doc reading
- Two-pass validation caught 13 issues (11 + 2) and fixed all of them
- Single-source-of-truth + ESLint enforcement makes BAD subagent divergence mechanically impossible
- Engine fixture set (16 cases) provides executable spec for the highest-leverage AD
- Bob-story trace for every AD removes "where does this live" rederivation

**Key Strengths:**
1. **Empirical verification before lock** — `scripts/mirakl-empirical-verify.js` produced production-grounded values (channel_pricing=SINGLE, csv_delimiter=SEMICOLON, decimals=2, total_price=0 placeholder reality, shop_id=null in P11) that would have been mid-sprint discoveries otherwise.
2. **Trust as architectural property** — encrypted-at-rest with master on Hetzner / ciphertext on Supabase, append-only audit log enforced at DB layer (lookup table + trigger + no-FK), pause-as-freeze, dry-run-by-default, customer-self-flip Go-Live.
3. **Single-source-of-truth discipline** — 11 modules; ESLint custom rules; mechanical enforcement matrix.
4. **Schema designed for Epic 2 without migration** — 6 reservation columns; concierge-to-self-serve marketplace add path; cost-CSV / per-SKU exclude / customer-tunable thresholds all column-only changes.
5. **Two-pass validation** — Pass 1 + Pass 2 + 13 fixes documented inline.

**Areas for Future Enhancement (Epic 2 triggers):**
- HTMX upgrade for audit log if 5-surface IA gets gnarly
- TypeScript migration if JSDoc churn exceeds tolerance
- Cost-CSV upload + cost-based formula
- Customer-tunable anomaly threshold + transient-failure threshold
- Self-serve marketplace add/remove
- Multi-marketplace beyond Worten (Phone House ES, Carrefour ES, PCComponentes, MediaMarkt)
- Moloni API integration
- Restore-baseline UI
- HTMX-ready URL namespace already reserved

**Known UNVERIFIED items (calibrate during dogfood):**
- NFR-P10 catalog scan throughput (50k SKUs in 4h) — empirical floor in place, full scan calibration during dogfood
- PRI01 CSV decimal separator (period vs comma) — Worten dogfood calibration
- PRI01 idempotency at the prices-state level — confirmed via MCP; validate operationally during dogfood
- Worten/Mirakl operator ToS compatibility for automated repricing — pre-revenue legal review

**Known minor flags (post-Step-4 sweep, 2026-04-30 — non-blocking; cleanup during sharding):**

- **Item 9 — Story 1.5 `admin_access_denied` PII minimization (GDPR consideration).** Pedro flagged that logging the full denied-email plaintext in audit / log for failed admin-route attempts is over-retentive vs GDPR data-minimization. Phase 2 trigger: log a hash (e.g., SHA-256 first 8 hex chars of the email) instead of plaintext, OR extend the pino redaction list to cover the field. Decision lands at first GDPR review or first founder-side incident, whichever first.
- **Item 10 — Story 4.3 sign-off recording convention.** Open: PR comment vs `_bmad-output/sign-offs/story-4.3.md` for capturing Pedro's accept/reject sign-off on `16-onboarding-key-help.html` walkthrough screenshots. Pedro picks during first sign-off; that pick becomes the convention going forward (no architectural change).
- **Item 11 — UX-DR26 mobile bottom action bar safe-area inset (OQ-7).** Story 8.12 AC notes Step 4 verification on iPhone SE / iPhone 14 simulators (`env(safe-area-inset-bottom)` padding around the bottom action bar to clear iOS home indicator). Sally verifies in Pass 2 visual review; document any iOS Safari adjustments inline in `public/css/components.css`. Architectural impact: none.
- **Item 12 — `pri02-complete` event granularity (volume-math sanity check against AD19 ~3M/quarter).** Story 6.2 emits one `pri02-complete` audit event per affected `sku_channel` (not per import). At 50k-SKU-per-import scale across Tier 1 + Tier 2a customers, this can multiply audit-row volume meaningfully. Calibrate during dogfood: if the live volume materially exceeds AD19's ~3M-entries/quarter/customer estimate AND that overage threatens the NFR-P8 2s budget on the 90-day audit-log filter window, switch the writer to one aggregate `pri02-complete-batch` event per import_id (with per-SKU detail nested in the JSONB payload) instead of N per-SKU events. Schema change is forward-only (add the new event_type to the lookup table; legacy event_type stays in seed for historical continuity).
- **Item 13 — Story 9.6 `audit_log_atencao_archive` placement.** At MVP, the archive of detached old-month partitions is an in-DB single non-partitioned table (Bob picks the exact mechanic at Story 9.6 sharding). Phase 2 trigger to evaluate S3-equivalent external archive when scale demands (e.g., Postgres disk pressure on Supabase plan, or audit-log Atenção retention extending beyond a few customer-account-lifetimes). Architecturally non-blocking; Hetzner / Supabase Cloud EU current pricing accommodates the in-DB approach for the 5–10-customer MVP horizon.
- **Item 14 — Story 11.4 concierge marketplace-add CLI security review.** Pre-customer-#2 review of cleartext-key handling in the concierge CLI (terminal masking via `process.stdin.setRawMode(true)` + memory-only retention + zero-disk-write + CLI process exit clears the heap reference). Architecturally aligned with AD3 (key never on disk in plaintext); the CLI-specific hardening review confirms the implementation matches the spec. No architectural change anticipated.
- **Item 15 — Story 11.5 `moloni_invoices.customer_id` FK ON DELETE NO ACTION.** Confirms the fiscal-archive migration path before first deletion event hits a customer with prior Moloni invoices. Architecture's AD21 already states `moloni_invoices` are retained even after account deletion (fiscal record). The `ON DELETE NO ACTION` posture is consistent with that retention contract — the FK exists but doesn't cascade. Bob's Story 11.5 sharding asserts this in the migration DDL; the deletion-grace cron (Story 10.3) handles the orphan-FK case by NOT deleting `moloni_invoices` rows during T+7d hard-delete.
- **Item 16 — Story 12.3 `critical-alert-platform-features-changed.eta` template (one of 9 OR generic reuse).** Open: Story 12.3 needs either a 9th PT-localized Resend template specifically for platform-features-changed alerts, OR reuses the generic `critical-alert.eta` with payload-driven body text. Bob picks during Story 12.3 sharding; document the choice in Story 12.3 acceptance criteria. Architectural impact: none — `shared/resend/client.js` accepts arbitrary template names per AD25.

---

## Visual Design Reference Asset Class (post-completion supplement)

**Scope of this supplement:** documents the asset class introduced after architecture completion (status: `complete` per Step 8 frontmatter remains accurate — the binding decisions AD1-AD30 + F1-F13 are unchanged). This supplement is operational metadata for visual-contract sourcing consumed by epic-doc story sharding and BAD subagent implementation. The architecture's binding-decisions surface is not re-opened.

### Asset location

`_bmad-output/design-references/` (curated by Sally — UX designer):

- `README.md` — convention doc.
- `bundle/` — Claude Design Phase B+C output (300 KB curated from 3.3 MB upstream).
  - `project/dashboard-and-audit.html` — live canvas; open in browser, navigate via tweaks toolbar.
  - `project/dashboard-and-audit.css` — design tokens.
  - `project/*.jsx` — React component implementations (reference only; production stack ships vanilla JS per Step 3).
  - `project/MarketPilot.html` — original free-report visual-DNA reference.
  - `chats/chat2.md` — design-intent transcript (background; not normative).
- `screens/` — stable stub filenames (14 designed + 3 Phase D placeholders).
  - `01-…` through `12-…` + `06b-…` — 13 originally-designed dashboard/audit surfaces.
  - `16-onboarding-key-help.html` — Worten-key one-pager modal (added 2026-04-30; PT walkthrough verified, screenshots delivered, final review pending before customer #1).
  - `13-…`, `14-…`, `15-…` — Phase D placeholders (regenerate when Pedro's usage limit resets; ~5 days from 2026-04-30).

### Three reference patterns (binding for downstream stories)

The full UI surface area is ~28 screens. 16 are Claude-Design-mocked with stable stubs. 12 are deliberately not stubbed because they fall into one of two fallback patterns. Story acceptance criteria must explicitly declare which pattern the surface uses.

**Pattern A — Stubbed UI surface (17 surfaces).** Story acceptance cites three pointers:
- Behavior: PRD FR/NFR by number
- Structure: UX skeleton § by number
- Visual: `_bmad-output/design-references/screens/<NN>-<name>.html` stub filename
- Includes 16 dashboard/audit/onboarding surfaces (`01-…` through `12-…` + `06b-…` + `16-onboarding-key-help.html`).

**Pattern B — Skeleton with explicit visual fallback (2 surfaces).** Story acceptance cites:
- Behavior: PRD FR/NFR
- Structure + visual: UX skeleton § + named visual fallback
- Concrete cases:
  - `/onboarding/scan` (FR12-FR14) — UX skeleton §3.3 + visual fallback `bundle/project/MarketPilot.html` ProgressScreen
  - `/onboarding/margin` (FR16) — UX skeleton §3.3 + visual-DNA tokens

**Pattern C — Skeleton + Supabase chrome / DNA tokens (10 surfaces).** Story acceptance cites:
- Behavior: PRD FR/NFR
- Structure: UX skeleton § (sitemap entry or §4.4 settings row)
- Visual: explicit fallback statement
- Concrete cases:
  - 5 auth screens (`/signup`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`) — UX skeleton §1 sitemap + Supabase Auth defaults + visual-DNA tokens (Manrope/Inter, navy primary, radius scale)
  - 5 settings pages (`/settings/account`, `/settings/key`, `/settings/marketplaces`, `/settings/billing`, `/settings/delete`) — UX skeleton §4.4 settings row + visual-DNA tokens + consistent chrome from already-shipped designed pages

### Stable-stub-filename strategy

Stub filenames in `screens/` are stable across Phase D updates. When the bundle internals update (e.g., regenerated mockups when Pedro's Claude Design usage limit resets), only `bundle/` files change; stub filenames remain valid references in epic doc + story acceptance criteria. This isolates Pass-2 visual reconciliation work to mechanical eta-template ports — no story re-sharding when designs land.

### Escape hatch for missing patterns

If an epic-sharding pass surfaces a UI story whose surface doesn't cleanly fit Pattern A/B/C, the agent must NOT invent a fourth pattern. Flag the story to Pedro; Sally generates a stub via the gen template (~2 min) or updates UX skeleton §4.4 if the surface is a new settings page.

### Architecture decisions unchanged

Architecture decisions AD1-AD30 + F1-F13 reference PRD FRs and UX skeleton sections directly, never visual stubs. Visual references are operational metadata consumed at story sharding (epic doc) and story execution (BAD subagents). The architecture's binding-decisions surface stays unchanged; this supplement adds asset-class convention without re-opening the spec.
