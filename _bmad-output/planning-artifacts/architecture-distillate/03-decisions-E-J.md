This section covers Core Architectural Decisions E-J: Account Lifecycle & Billing (AD21-AD22), Operations & Failure Modes (AD23-AD27), Important Decisions (AD28-AD30), Deferred Decisions (Epic 2), Decision Impact Analysis, and Worten Positioning Note. Part 3 of 9 from `architecture.md`.

## E. Account Lifecycle & Billing

### AD21 — Account-deletion 4-step + 7-day grace + Stripe cancel_at_period_end
- Per pre-locked decision A1
- Step 1 (`/settings/delete`): customer reads what gets wiped vs retained (UX skeleton §8.4)
- Step 2: type `ELIMINAR` + email; submit
- Step 3: encrypted `shop_api_key` destroyed at initiation (NOT grace-period end) — security commitment; Stripe subscription → `subscription.update({ cancel_at_period_end: true })` (Stripe stops renewing at end of current billing period; no automatic refund for grace-period days); `customer_marketplace.cron_state = 'PAUSED_BY_ACCOUNT_GRACE_PERIOD'` (cron paused for all customer's marketplaces); `customer.deletion_initiated_at = NOW()`; `customer.deletion_scheduled_at = NOW() + INTERVAL '7 days'`; Resend confirmation email with "Cancelar eliminação" magic link; dashboard locks read-only; banner per UX skeleton §9.12
- Step 4 (T+7d, daily cron): hard delete per GDPR Art 17 — wipe `audit_log` (excluding fiscal-evidence exceptions per ToS), Stripe customer/subscription references, catalog/baseline/pricing-state; retain Moloni invoice metadata (separate `moloni_invoices` table — fiscal record)
- Cancel-mid-grace: customer clicks magic link OR dashboard banner button → `customer.deletion_initiated_at = NULL`, `cron_state = 'DRY_RUN'` (NOT directly to ACTIVE — customer must re-enter Stripe payment to reactivate, prior subscription already canceling); UX flow same as Stripe payment-failed re-entry
- Decided 2026-04-30 (Q1): keep MVP-simple "re-enter Stripe payment from scratch" approach in cancel-mid-grace; AD22 + AD21 stay as-is; Story 10.2's `app/src/routes/settings/cancel-deletion.js` includes code comment documenting Phase 2 refinement: if Stripe Subscription's current billing period not yet ended at cancel-mid-grace, uncancel via `cancel_at_period_end=false` instead of forcing re-entry; avoids double-charge edge case for customers cancelling mid-grace early in billing cycle; trigger: any complaint about double-charge in months 1–2
- Why: PRD FR4 amended; pre-locked A1 (Stripe `cancel_at_period_end`); UX skeleton §8.4
- Affects: `customer` schema columns; `cron_state` machine; daily-deletion cron; Stripe integration
- Bob trace: Story 10.1 (deletion flow + grace-period cron + Stripe `cancel_at_period_end` + key destruction); Story 10.2 (cancel-mid-grace flow); Story 10.3 (day-5 reminder cron with idempotency via `customers.day5_reminder_sent_at`)

### AD22 — Stripe + Moloni integration
- Stripe model (corrected per F2): ONE Stripe Customer per MarketPilot customer; ONE Stripe Subscription per MarketPilot customer, created at first Go-Live click (NOT at signup — pre-Go-Live customers have no Stripe Customer); ONE `SubscriptionItem` per `customer_marketplace`
- Example: Tony's 5 marketplaces = 1 Customer + 1 Subscription + 5 SubscriptionItems @ €50/each
- Adding marketplace = adding SubscriptionItem to existing Subscription (Stripe proration applies); removing marketplace = removing SubscriptionItem at end of cycle, no mid-cycle refund (FR41 Epic 2; concierge-only at MVP, schema supports Epic 2 self-serve flow without migration); cancelling account = cancelling whole Subscription (`cancel_at_period_end=true` per AD21)
- Subscription state webhook drives `cron_state` transitions for ALL of customer's marketplaces (not just one); webhook signature verified; replay attacks prevented via timestamp tolerance ≤5 min
- Idempotency via `Stripe-Idempotency-Key` header on every mutation, derived from `(customer_id, action, attempt_id)`
- Moloni manual at MVP: founder generates invoice from Moloni dashboard per Stripe payment, ~5–10 min/customer/month; `moloni_invoices` table records invoice metadata (NIF, Moloni invoice ID, Stripe payment_intent_id, amount, issued_at); Moloni API integration triggered Epic 2 at >2–3 hr/month aggregate founder time
- NIF capture flow (F7 — resolves implicit gap): customer's company NIF asked at first Moloni invoice generation (founder's Day-3 pulse-check email per Journey 1: "Posso enviar a fatura Moloni para o NIF da {company}?"); founder writes NIF into `customer_profiles.nif` (via service-role) AND `moloni_invoices.nif` for issued invoice (NOT NULL on `moloni_invoices`); subsequent invoices for same customer pre-fill from `customer_profiles.nif`; customer self-update via `/settings/account` is Epic 2 (manual founder edit at MVP)
- Schema linkage (F2 corrected): `customers.stripe_customer_id`, `customers.stripe_subscription_id` (one Customer + one Subscription per MarketPilot customer), `customer_marketplaces.stripe_subscription_item_id` (one SubscriptionItem per marketplace), `moloni_invoices.moloni_invoice_id` (Moloni-side identifier); all NULL until first Go-Live click for relevant entity
- Why: PRD FR40–FR44; NFR-S4 (webhook signature + replay); NFR-I2 (Stripe idempotency)
- Bob trace: Story 11.1 (Stripe integration + webhook handler + idempotency); Story 11.2 (Moloni invoice metadata schema + manual-flow ops doc)

## F. Operations, Observability, and Failure Modes

### AD23 — /health composition: app endpoint reads worker_heartbeats freshness
- App's `GET /health` returns 200 IFF: app reaches Postgres (`SELECT 1` with 1s timeout) AND most recent `worker_heartbeats` row <90s old (worker writes heartbeat every 30s; threshold = 3× cadence)
- UptimeRobot pings only app's `/health` (FR45) at 5-min cadence; worker has no public URL — liveness observed via heartbeat; failure → UptimeRobot emails founder (NFR-I5)
- NFR-P9 ≥99% uptime
- Why: PRD FR45, NFR-R1, NFR-R2; rules out worker process becoming silent failure
- Bob trace: Story 1.1 (`worker_heartbeats` table + heartbeat write + app `/health` composition + UptimeRobot configuration — full /health surface ships in 1.1 alongside two-service scaffold so UptimeRobot has target from day 1)

### AD24 — 3-tier failure model: transient retry / per-SKU operational / critical alert+banner
- Locked from PRD FR46 + NFR-R4
- Transient (429, 5xx, network timeout): exponential backoff retry within cycle (per AD5); logged at debug; no audit-log entry; if 3 consecutive cycles fail to reach Mirakl for same customer → escalate to sustained-transient
- Sustained transient → Portuguese-localized banner (UX skeleton §9.9); audit-log `cycle-fail-sustained` event (Atenção); NO Resend email at this tier — banner only; threshold (3 consecutive cycles) hardcoded at MVP; Epic 2 trigger to make per-customer configurable if customer in flaky-network region needs longer tolerance (no schema change at MVP — would land as nullable `customer_marketplace.sustained_transient_cycle_threshold` column — F10)
- Per-SKU operational (PRI03 reports SKU error, EAN mismatch, validation failure for specific SKU): logged in `audit_log` as `pri01-submit-fail` (Rotina); retried in next cycle's PRI01 writer rebuild; after 3 consecutive cycles failing for same SKU → escalates to `pri01-fail-persistent` Atenção event + Resend critical alert + per-SKU freeze pending review (Story 6.3 representation TBD per AD12)
- Critical (auth invalid → `paused_by_key_revoked`; sustained Mirakl outage > N cycles → banner; anomaly freeze; circuit-breaker trip): freeze customer's repricing; Resend email within ≤5 min (NFR-P9, FR48); dashboard banner appears next render
- Bob trace: Story 12.1 (failure-mode classifier + retry logic + `cycle-fail-sustained` event); Story 12.2 (sustained-transient banner trigger); Story 12.3 (Resend critical-alert delivery + `platform-features-changed` event from monthly PC01 re-pull)

### AD25 — Resend critical alerts + UptimeRobot health
- Resend for critical-tier alerts ONLY (FR48 + NFR-Sc4 budget); templates PT-localized (NFR-I4) under `app/src/views/emails/*.eta`; NO marketing emails, NO day-3/day-7 pulse-check templates (founder-direct per NFR-O3); sized for ~10 customers × 2–3 alerts/month each (Resend free tier 3k/mo)
- UptimeRobot monitors `/health` at 5-min cadence (FR45); on consecutive failure, alerts founder email (out-of-band, not customer-facing)
- Customer-facing observability: banners + audit log only at MVP; no status page (Plan B per PRD §Implementation Considerations)
- Why: PRD FR45, FR48, NFR-I4, NFR-I5
- Bob trace: Story 12.3 (Resend templates + delivery wiring); Story 1.x (UptimeRobot config — manual via UptimeRobot UI; documented in ops runbook)

### AD26 — Customer-marketplace platform_features_snapshot (PC01 capture, JSONB)
- `customer_marketplace.platform_features_snapshot` JSONB carries full PC01 response at onboarding for diagnostic + future-feature gating
- Specific PC01 columns also stored as typed columns for fast access in engine + writer paths: `channel_pricing_mode`, `operator_csv_delimiter`, `offer_prices_decimals`, `discount_period_required`, `competitive_pricing_tool`, `scheduled_pricing`, `volume_pricing`, `multi_currency`, `order_tax_mode`; JSONB is source of truth; columns are denormalized projection refreshed if PC01 re-pulled
- Re-pull cadence: monthly cron re-calls PC01 per active `customer_marketplace`; if response differs, log `platform-features-changed` Atenção audit event AND alert founder; operator changes to PC01 (e.g., enabling `volume_pricing`) could break writer if undetected
- Why: captures empirical reality that operator config is mutable; protects writer from silent drift
- Bob trace: Story 4.1 (PC01 capture); Story 12.4 (monthly PC01 re-pull cron)

### AD27 — Logging: structured JSON via pino
- All app + worker logs through pino, structured JSON to stdout, captured by Coolify
- Sensitive-field redaction list (built into pino config): `Authorization`, `authorization`, `Cookie`, `cookie`, `Set-Cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`; any log line containing redacted key replaces value with `'[REDACTED]'`. Both casings (uppercase + lowercase) listed for `Authorization`, `Cookie`, `Set-Cookie` because Node's HTTP parser yields lowercase but ad-hoc code may construct log objects with the capitalized form — symmetric coverage is the AD27 contract (extended 2026-05-02 per Story 1.3 review).
- Log levels: trace (disabled prod; per-request fine detail in dev), debug (disabled prod; cycle-step traces), info (cycle-start, cycle-end, customer signup, Go-Live click), warn (retried failures, rate-limit backoff triggers, sustained-transient banner triggers), error (critical events: anomaly freeze, circuit breaker, key revoked, payment failure)
- Structured fields: every log line carries `customer_marketplace_id` (or null pre-auth), `request_id` (app) or `cycle_id` (worker), `event_type` if line corresponds to audit event
- Customer-facing errors return safe PT messages per AD5
- Why: trust property (NFR-S1: keys never in logs); operational debugging without leaking secrets
- Bob trace: Story 1.3 (pino config + redaction list + unit test asserting each redacted field name produces `'[REDACTED]'` in log stream)

## G. Important Decisions (architecture-shaping, not blocking)

### AD28 — Validation: Fastify built-in JSON Schema, no extra library at MVP
- Already locked Step 3; route-level `schema:` config with JSON Schema for body, query, params
- Sufficient for: signup, key-entry, margin editor save, anomaly-review accept/reject, deletion-confirmation, Stripe webhook payloads
- Epic 2 trigger to add zod (or similar): when validator surface emerges that JSON Schema can't express ergonomically; today, none

### AD29 — Customer profile schema: first_name, last_name, company_name NOT NULL
- Per pre-locked decision
- `customer_profiles` table: `customer_id` PK, `first_name TEXT NOT NULL`, `last_name TEXT NOT NULL`, `company_name TEXT NOT NULL`, `nif` (nullable, captured at first Moloni invoice per AD22), `created_at`, `updated_at`
- Atomic creation pattern (F3 lock): Postgres trigger `handle_new_auth_user` on `auth.users` AFTER INSERT; trigger function declared `SECURITY DEFINER` so can write to `public.customer_profiles` from `auth` schema; (1) reads `NEW.raw_user_meta_data` JSONB (Supabase auto-populates from `signUp({ options: { data: {...} } })`); (2) validates `first_name`, `last_name`, `company_name` present non-empty strings — `RAISE EXCEPTION` on any missing/empty rolls back entire INSERT into auth.users (Postgres transaction semantics); (3) INSERTs matching `customers` row AND `customer_profiles` row with validated values
- Signup route `app/src/routes/_public/signup.js` calls `supabase.auth.signUp({ email, password, options: { data: { first_name, last_name, company_name } } })`; if trigger raises, Supabase Auth returns error; route catches and returns safe PT-localized message via `getSafeErrorMessage()` (per AD5 + Step 5 error pattern); HINT codes `PROFILE_FIRST_NAME_REQUIRED` / `PROFILE_LAST_NAME_REQUIRED` / `PROFILE_COMPANY_NAME_REQUIRED` mapped to PT-localized field errors; no partial-state cleanup needed — Postgres did rollback
- NIF deliberately deferred — captured at first Moloni invoice generation per AD22 NIF capture flow, NOT at signup; UX placement of first/last/company (signup form vs interstitial) is Sally's Pass 2 call; backend doesn't care
- Why: every MarketPilot customer is registered B2B entity; "everyone has these" true by segment definition; avoids manual founder follow-up; trigger pattern guarantees atomicity at DB level — no orphan-auth-without-profile state representable
- Bob trace: Story 1.4 (signup endpoint + auth.users trigger migration + JSON Schema validation on route + safe-error mapping for trigger-raised exceptions + source-context capture middleware per FR7 — atomicity bundle lands as single PR)

### AD30 — RLS regression suite runs on every deploy
- `scripts/rls-regression-suite.js` runs in CI: spins up test Postgres with seed data for 2 customers, attempts every mutation/query as customer A using customer B's IDs, asserts every attempt returns 0 rows or denied
- Coverage: every customer-scoped table (`customer_marketplace`, `sku_channel`, `audit_log`, `baseline_snapshot`, `customer_profile`, `shop_api_key_vault`, `moloni_invoices`, etc.)
- Block deploy on any test failure
- Why: PRD NFR-S3, NFR-I3 (RLS regression per deploy); trust commitment
- Bob trace: Story 2.x (regression suite scaffolding); each new customer-scoped-table story adds its row to suite

## H. Deferred Decisions (Epic 2 / triggered)

- Schema reservations or hooks at MVP, no implementation
- Per-customer cadence customization — `customer_marketplace.tier_cadence_minutes_override` JSONB nullable; engine reads when not null
- Customer-tunable anomaly threshold — `customer_marketplace.anomaly_threshold_pct` numeric nullable; defaults to 0.40 when null
- Per-SKU exclude / "promo mode" — `sku_channel.excluded_at` timestamp; engine SKIPS rows where not null
- Cost-CSV upload — `sku_channel.cost_cents` integer nullable; engine path to use cost-based formula gates on this column being non-null for SKU
- Multi-marketplace beyond Worten — `customer_marketplace.operator` enum already `'WORTEN'` at MVP; Epic 2 adds `'PHONE_HOUSE'`, `'CARREFOUR_ES'`, etc.; each operator carries own per-channel codes, base URL, features
- HTMX upgrade for audit log — URL conventions already designed for HTML-fragment swaps; HTMX library can be added without backend changes when ready
- TypeScript migration — JSDoc convention (Step 3) keeps `*.js → *.ts` rename trivial
- Self-serve marketplace add/remove — concierge-only at MVP per FR41; Epic 2 ships UI + Stripe proration logic; schema already supports multi-marketplace
- Moloni API integration — `moloni_invoices` table already supports it; Epic 2 swaps manual generation for API call (trigger: >2–3 hr/month aggregate founder time)
- Restore-baseline UI — `baseline_snapshot` already captured at scan; Epic 2 adds restore endpoint + UI
- Sustained-transient threshold per-customer (AD24) — `customer_marketplace.sustained_transient_cycle_threshold` nullable; trigger: customer in flaky-network region complains 3-cycle threshold too strict (F10)
- Customer self-update of NIF (AD22) — `/settings/account` form; manual founder edit at MVP
- Admin status page — Story 8.10 reuses customer-facing audit log with `?as_admin=` parameter; deferred from Important to MVP via Story 8.10

## I. Decision Impact Analysis

- Implementation sequence (informs Bob's epic ordering):
- 1. Foundation — Story 1.1–1.5: scaffold + worker heartbeat + /health (1.1, AD1+AD23); envelope encryption (1.2, AD3); pino redaction (1.3, AD27); signup + atomic customer_profile + source-context capture (1.4, AD29 + FR7); founder_admins seed + middleware (1.5, AD4)
- 2. Tenancy + RLS — Story 2.x: RLS policies + regression suite (AD2, AD30)
- 3. Mirakl client — Story 3.x: port + adapt apiClient.js + scanCompetitors.js with self-filter + total_price filter (AD5, AD13, AD14)
- 4. Onboarding — Story 4.x: key-entry + A01/PC01 capture + OF21 catalog scan + P11 batch scan + tier classification + baseline snapshot (AD16); platform_features_snapshot (AD26); Mirakl integration smoke test reusing `scripts/mirakl-empirical-verify.js`
- 5. Engine + safety — Story 5–7.x: dispatcher + advisory locks (AD17); engine decision table (AD8); cooperative-absorption (AD9); tier transitions (AD10); circuit breaker (AD11); anomaly freeze (AD12); cron_state (AD15)
- 6. PRI01 writer — Story 6.x: per-SKU aggregation + delete-and-replace (AD7); pending_import_id atomicity; PRI02 poller; PRI03 error-report parser + per-SKU rebuild
- 7. Audit log — Story 9.x: schema + monthly partitions + precomputed aggregates (AD19); event-type taxonomy + priority enum (AD20); 5-surface query endpoints
- 8. Dashboard + customer surfaces — Story 8.x: dashboard root + KPI cards + margin editor + pause/resume + anomaly review modal + Go-Live consent modal + 5 audit-log surfaces; Story 8.10 admin status page reusing `?as_admin=` parameter
- 9. Billing + lifecycle — Story 11.x: Stripe + Moloni (AD22); Story 10.x: account deletion + grace period (AD21)
- 10. Operations — Story 12.x: 3-tier failure model + Resend + sustained-transient banner (AD24, AD25); monthly PC01 re-pull (AD26)
- Cross-component dependencies (most load-bearing):
- Engine + writer atomicity: AD7 (`pending_import_id` set on ALL participating rows, not just changing ones) + AD9 (skip-on-pending in cooperative-absorption) + AD10 (`last_won_at` set on T1→T2a transition AFTER PRI02 COMPLETE) form tight invariant chain; Story 7.x (engine) MUST land together with Story 6.x (writer) — cannot ship piecemeal without breaking atomicity contract
- Onboarding + engine schema: Story 4.x must land `channel_pricing_mode`, `operator_csv_delimiter`, `offer_prices_decimals` columns + populate from PC01 BEFORE Story 6.x (PRI01 writer) is testable
- RLS suite + every customer-scoped table: Story 2.x establishes suite; every subsequent story adding customer-scoped table extends suite as part of acceptance criteria
- Audit log + everything else: audit log writers (`shared/audit/`) imported by engine, writer, dispatcher, lifecycle workflow, customer-facing endpoints; Story 9.1 (audit_log schema + writer module) is Story 1.x sibling — must land before any feature emitting events

## J. Worten Positioning Note (informational, not architectural)

- Empirical: Worten has `competitive_pricing_tool: true`; Worten exposes competitor pricing natively to sellers in Worten Seller Center
- Implication for sales/marketing positioning (NOT architecture)
- Free-report's "give you visibility" wedge narrower for Worten specifically vs marketplaces without this feature — Worten sellers already see per-product competition in seller portal
- Free-report wedge for Worten: catalog-level aggregation + quick-wins computation + margin-headroom analysis (Worten's tool is per-product, not aggregated)
- Paid repricer wedge independent: automation + cooperative-absorption + safety stack — Worten doesn't reprice; we do
- Track in OUTREACH.md / sales playbook for next pass; doesn't change any spec here
