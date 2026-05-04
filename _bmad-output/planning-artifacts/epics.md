---
stepsCompleted: [1, 2, 3, 4]
lastStep: 4
status: 'complete'
startedAt: '2026-04-30'
completedAt: '2026-04-30'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-skeleton.md
  - _bmad-output/planning-artifacts/product-brief-marketpilot-repricer-distillate.md
  - CLAUDE.md
project_name: 'marketpilot-repricer'
user_name: 'Pedro'
date: '2026-04-30'
note_on_terminology: |
  The label "Epic 2" is overloaded across input documents. Inside this document,
  "Epic 1" through "Epic N" refer to MVP-build epics. The PRD/architecture/distillate
  use "Epic 2" to mean the post-MVP growth phase — wherever those source documents
  are quoted, this document inserts an inline annotation **"Phase 2 (post-MVP)"**
  to disambiguate. All Phase 2 features are deliberately out of scope here; their
  schema reservations live in MVP migrations per architecture's design.
---

# marketpilot-repricer — Epic Breakdown

## Overview

This document decomposes the binding capability contract (PRD: 51 FRs across 7 groups + 42 NFRs across 8 categories), the architecture spec (30 numbered Architecture Decisions AD1-AD30 + 13 validation amendments F1-F13), and the UX skeleton (38 numbered UX requirements + 5-surface audit-log IA + PT microcopy specs) into implementable stories grouped by epic.

The implementation sequence follows architecture §I (Decision Impact Analysis) as the binding spine. Story granularity rule: each story is independently shippable AND independently testable. Atomicity bundles documented in architecture (AD7+AD8+AD9+AD11; F3+AD29; F4+onboarding scan) ship as adjacent stories with single integration-test gates — they cannot be split across epics without breaking architectural invariants.

**Audience for this document:** Bob (SM agent) for sprint planning, then BAD subagents for parallel implementation. Each story's acceptance criteria must enumerate (a) the AD(s) and FR(s) it implements, (b) the single-source-of-truth module(s) it creates or extends, (c) the test fixtures it must pass, (d) the prior stories that must have shipped, (e) the downstream stories that depend on it.

**Out of scope for this document** (per the CE brief):
- Pixel-level UI design — UX skeleton is structural; visual polish is a downstream Claude Design pass. Stories include backend wiring + eta template scaffolding only.
- Pre-revenue legal gates and founder operational commitments — surfaced in the **Parallel Tracks** appendix at the end, not as dev stories.
- Refurbished products on Worten — structurally out of scope (no shared EAN catalog).
- Multi-marketplace beyond Worten — Phase 2 (post-MVP) trigger; concierge-only at MVP per FR41.
- Customer-facing API for ERP integration — Phase 3+, not now.

## Requirements Inventory

### Functional Requirements

51 functional requirements across 7 groups. Quoted compactly from `prd.md` §Functional Requirements; verbatim PRD text is the authority.

#### A. Account & Identity

- **FR1:** Customers can self-serve signup with email + password, completing email verification before accessing the application.
- **FR2:** Customers authenticate to a single login per customer account at MVP; multi-user RBAC reserved for Phase 2 (post-MVP).
- **FR3:** Customers can reset password via an email-verified flow.
- **FR4:** Customers can request account deletion via a discoverable mechanism in settings. Deletion is multi-step: (1) initiate from settings; (2) modal requires typing `ELIMINAR` + email; (3) 7-day soft-delete grace period (cron paused, dashboard locked, data retained, customer can cancel); (4) at grace-end, GDPR Article 17 hard-delete (encrypted shop API key wiped at INITIATION not grace-end; audit log + Stripe refs + catalog/baseline wiped; Moloni invoice metadata retained as fiscal record). Email confirmation at initiation + day-5 reminder + final-deletion confirmation.
- **FR5:** Tenant data-isolation enforced at the database layer (RLS) — application-code misconfiguration cannot cross tenants.
- **FR6:** Founder admin performs read-only operational queries across customer tenants without editing customer data through normal product flows.
- **FR7:** Signup form accepts and persists optional source-context query parameters (`?source=free_report&campaign=tony_august`) against the customer record for funnel-attribution. Wires the cross-repo handoff from DynamicPriceIdea.

#### B. API Key & Catalog Onboarding

- **FR8:** Customers paste a single Worten Mirakl shop API key into a single-purpose entry form during onboarding.
- **FR9:** System validates the API key inline within 5 seconds via a known-good Mirakl P11 call against a reference EAN; inline error feedback on failure.
- **FR10:** Customers can access a one-page guide ("How to find your Worten Marketplace API key") linked from the key-entry form.
- **FR11:** System stores the API key encrypted at rest; the founder cannot view cleartext key material; the application never logs cleartext key material.
- **FR12:** Upon successful key validation, the system kicks off an asynchronous catalog scan that reads the customer's Mirakl catalog and snapshots the baseline pricing state per SKU per channel.
- **FR13:** Customers can monitor scan progress via a closeable progress page, disconnecting and reconnecting without disrupting the scan.
- **FR14:** System persists scan job state server-side, allowing reconnection after disconnect without restarting the scan.
- **FR15:** System emails the customer on scan failure or critical scan issues; healthy completion does NOT trigger email.
- **FR16:** Customers answer a single onboarding margin question (bands: <5%, 5-10%, 10-15%, 15%+) driving smart default `max_discount_pct` (0.5% / 1% / 2% / 3%) and global default `max_increase_pct = 5%`. The form displays a warning for the <5% band recommending extended dry-run and noting cost-CSV control is reserved for Phase 2 (post-MVP).

#### C. Pricing Engine

- **FR17:** Engine maintains per-SKU per-channel pricing state including `list_price`, `last_set_price`, `current_price`, baseline snapshot, tier classification, `last_won_at` (nullable timestamp of most recent transition into 1st place), and `tier_cadence_minutes` (per-SKU cycle cadence in minutes).
- **FR18:** Engine classifies each SKU into one of four tier states with per-SKU cadence: **Tier 1** (contested, position > 1) = 15 min; **Tier 2a** (winning, `last_won_at < 4h` ago) = 15 min; **Tier 2b** (winning, `last_won_at ≥ 4h` ago) = 30-60 min (locked at 45 per pre-locked decision); **Tier 3** (no competitors) = daily, doubles as nightly reconciliation. Single cron polling every 5 min selects SKUs where `last_checked_at + tier_cadence_minutes < now()`.
- **FR19:** Engine handles tier transitions: T1 → T2a on winning 1st (set `last_won_at = now()`); T2a → T2b after 4h elapsed (atomic write of `tier='2b'`, `tier_cadence_minutes=45` with audit event per F1 amendment); {T2, T2a, T2b} → T1 on losing 1st (preserve `last_won_at`); T3 → T1/T2a on new competitor entering.
- **FR20:** Engine reads competitor offer data per SKU via Mirakl P11, ranking by `total_price` (price + shipping), filtering active offers only.
- **FR21:** Engine computes per-SKU floor (`list_price × (1 - max_discount_pct)`) and ceiling (`list_price × (1 + max_increase_pct)`), pushing prices only within that band.
- **FR22:** When an external entity changes `current_price` between cycles, the engine treats the change as new pricing intent and updates `list_price` to match (cooperative ERP-sync), rather than overwriting the change.
- **FR23:** Engine writes price updates via PRI01 only (never OF24), polls PRI02 until COMPLETE or FAILED, and only updates `last_set_price` after PRI02 confirms COMPLETE.
- **FR24:** Engine handles documented decision-table cases (tie cases, leader-is-self, all-competitors-above-ceiling, two-repricer-conflict, single-channel offer, single-competitor) per AD8's full enumeration.
- **FR25:** Engine repricing is per-channel for Worten PT vs Worten ES; margin tolerance configured globally per customer at MVP (per-channel margin overrides reserved for Phase 2 / post-MVP).

#### D. Engine Safety & Customer Controls

- **FR26:** System enforces an outbound circuit breaker that halts a cycle if more than 20% of the customer's catalog would be repriced in that cycle, OR if any single SKU's price would move by more than 15%.
- **FR27:** When the circuit breaker trips, the system freezes the cycle, alerts the customer, and requires manual review/unblock before resuming.
- **FR28:** System performs nightly reconciliation pass (implemented as Tier 3's daily cycle) that re-scans all products, re-classifies tiers, and self-heals stale state.
- **FR29:** When the system detects an external price change with deviation greater than 40% from previous `list_price`, it freezes that SKU's repricing and surfaces a review/confirm-or-reject UI.
- **FR30:** Customers can run the engine in dry-run mode by default (simulates decisions, logs would-have-done events, no PRI01 push) for as long as they want before going live.
- **FR31:** Customers flip Go-Live for active repricing only after viewing and accepting an informed-consent modal containing conditional language about how many products may be repriced and within what margin tolerance.
- **FR32:** Customers can pause and resume active repricing with a single click each; pause freezes the cron and leaves current Worten prices at their last-set state (no rollback at MVP); resume reactivates the cron.
- **FR33:** System retains the pre-tool baseline pricing snapshot captured during initial scan, enabling Phase 2 (post-MVP) "restore baseline" without data archaeology.

#### E. Dashboard & Audit Log

- **FR34:** Customers view a dashboard with KPI cards using the same categories as the free report (SKUs in 1st place, SKUs losing position, SKUs exclusive / Tier 3, total catalog value at risk).
- **FR35:** Customers toggle between Worten PT and Worten ES channels with the dashboard reflecting per-channel state.
- **FR36:** Customers edit `max_discount_pct` and `max_increase_pct` via a margin editor that displays a worked-profit-example using a representative SKU from their catalog, with the example updating live as values change.
- **FR37:** Customers view a per-customer-per-channel audit log of every engine action with timestamp, competitor context (price, shop name, ranking position), engine decision rationale (undercut / ceiling raise / hold), tolerance band (floor/ceiling), tier classification, and PRI01/PRI02 lifecycle status.
- **FR38:** Customers filter the audit log by channel, SKU/EAN, and event type (with external-change-absorbed and circuit-breaker-trip events tagged distinctly).
- **FR38b:** The audit log UI uses hierarchical summarization with four default surfaces: (1) **Daily-summary stats card** (aggregate counts + position deltas vs prior day); (2) **"A precisar de atenção" feed** (action-required events; steady state 0-2/day); (3) **"Eventos notáveis" feed** (browsable events; capped 30 with "Ver todos"); (4) **Search by SKU/EAN as primary investigation primitive**. Routine repricing churn hidden by default behind "Mostrar todos os ajustes" filter.
- **FR38c:** When the customer activates the firehose filter, events are presented grouped by cycle, NOT flat chronologically — one row per cycle showing aggregate counts, with per-SKU detail expandable on click.
- **FR38d:** Audit log event types are classified at three priority levels driving default surfacing: **Atenção** (anomaly-freeze, circuit-breaker-trip, key-validation-fail, persistent PRI01-fail, payment-failure-pause); **Notável** (external-change-absorbed, position-won, position-lost, new-competitor-entered, large-price-move-within-tolerance, customer-paused, customer-resumed); **Rotina** (undercut-decision, ceiling-raise-decision, hold-floor-bound, hold-already-in-1st, cycle-start, cycle-end, PRI01-submit, PRI02-complete, scan-progress).
- **FR39:** Dashboard surfaces a Portuguese-localized banner during sustained transient issues (e.g., Mirakl outages), informing the customer no new price actions are running until conditions stabilize.

#### F. Subscription & Billing

- **FR40:** Customers start a recurring monthly Stripe subscription on Go-Live click, billed at €50 per marketplace per month, no setup fee.
- **FR41 (MVP):** Customers operate a single marketplace at MVP (Worten — both PT and ES channels under one shop API key). Adding additional marketplaces is **concierge-only** at MVP: customer emails founder; founder configures encrypted key + Stripe SubscriptionItem + next Moloni invoice covers combined payment. **No "Add Marketplace" UI** in customer dashboard at MVP.
- **FR41 (Phase 2 / post-MVP):** Customers self-serve add or remove marketplaces from their subscription via dashboard UI. Schema supports multi-marketplace from day 1; only UI ships in Phase 2.
- **FR42:** Customers can request a first-month money-back guarantee within 14 days of Go-Live, no questions asked.
- **FR43:** System handles failed payments via Stripe-managed dunning at MVP; on final failure, subscription auto-cancels, cron flips paused, prices remain at last-set state until customer re-enters payment details.
- **FR44:** Founder admin can generate manual Moloni invoices per Stripe payment with PT NIF/IVA compliance, recording invoice metadata against the customer account.

#### G. Operations & Alerting

- **FR45:** System exposes a `/health` endpoint pinged by external uptime monitoring at 5-minute cadence, with failure triggering founder email alerts.
- **FR46:** System implements a 3-tier failure model: transient errors retry with exponential backoff within cycle; per-SKU operational failures log and continue the cycle; critical errors (auth invalid, sustained outage, anomaly freeze, circuit-breaker trip) freeze the customer's repricing and trigger immediate email + dashboard banner.
- **FR47:** Founder admin can view an internal monitoring dashboard (not customer-facing) showing cross-customer audit-log tail, uptime status, and circuit-breaker state.
- **FR48:** System delivers critical-tier alerts to customers via email within 5 minutes of event detection.

### NonFunctional Requirements

42 NFRs across 8 categories. Quoted compactly from `prd.md` §Non-Functional Requirements. (Note: NFR-O4 — Manual Moloni invoice SLA — was added to PRD post-Step-1 extraction; see C1 fix in implementation-readiness report 2026-05-01 + Story 11.5 binding.)

#### Performance

- **NFR-P1:** Engine **Tier 1** cycle latency p95 ≤ 18 min (15-min nominal + retry/backoff allowance), measured p95 across all customers' Tier 1 SKUs over 7-day rolling window.
- **NFR-P2:** Engine **Tier 2a** cycle latency p95 ≤ 18 min — match Tier 1 (NOT Tier 2b) to protect against active-repricer markets.
- **NFR-P3:** Engine **Tier 2b** cycle latency p95 ≤ 75 min.
- **NFR-P4:** Engine **Tier 3** cycle latency p95 ≤ 28 hours (daily nominal; doubles as nightly reconciliation per FR28).
- **NFR-P5:** PRI01 → PRI02 resolution within 30 min from submission to COMPLETE or FAILED. Stuck-WAITING SKUs ≥30 min trip a critical alert per FR46.
- **NFR-P6:** Inline API key validation completes within 5 seconds (worst case) on submission.
- **NFR-P7:** Customer dashboard initial render ≤2s on broadband, ≤4s on 3G mobile.
- **NFR-P8:** Audit log filtering responds within 2s for the default 90-day window.
- **NFR-P9:** Critical alert delivery latency ≤5 min from event detection to customer email.
- **NFR-P10:** Catalog scan throughput target: 50k SKUs scanned within 4 hours assuming Mirakl rate-limit budget supports ~10 concurrent calls × 200ms (UNVERIFIED — calibrate during dogfood; empirical floor seeded by `scripts/mirakl-empirical-verify.js`).

#### Security

- **NFR-S1:** All customer Mirakl shop API keys encrypted at rest using a KMS-managed key (envelope encryption per AD3). Founder cannot view cleartext key material; application logs never contain cleartext key material. Verified pre-launch via security review and ongoing via DB-dump scans.
- **NFR-S2:** All HTTP traffic between customer browser and `app.marketpilot.pt` uses TLS 1.2+; internal traffic between Hetzner-hosted Fastify and Supabase Cloud uses TLS.
- **NFR-S3:** Multi-tenant data isolation enforced at the Postgres layer via RLS policies on every customer-scoped table. Service-role-key usage limited to repricer-worker and operator-only admin endpoints; never exposed to client. RLS regressions blocked via test suite that runs on every deploy.
- **NFR-S4:** Stripe webhooks signed and verified per Stripe docs; replay attacks prevented via webhook timestamp validation (≤5 min tolerance).
- **NFR-S5:** Authentication uses Supabase Auth defaults (bcrypt hashing, secure session cookies, email verification). Password reset flows are email-verified per FR3.
- **NFR-S6:** Audit log entries are append-only at the application layer; no admin UI to delete or edit audit log records (deletion only via documented GDPR Art 17 workflow per FR4).
- **NFR-S7:** Stripe customer/subscription data: store only Stripe customer IDs and subscription IDs — no card data, no PAN, no full bank details (Stripe handles all PCI-DSS scope; MarketPilot is out of PCI scope by design).

#### Scalability

- **NFR-Sc1:** System designed for 5-10 concurrent customer accounts at MVP, scaling to 50 in Phase 2 (post-MVP) without architectural rework.
- **NFR-Sc2:** Per-customer catalog scale: 50k SKUs at MVP; 100k+ catalogs may use relaxed Tier 1 / Tier 2a cadence per `tier_cadence_minutes` model.
- **NFR-Sc3:** Cron scheduling supports horizontal scale: additional worker instances poll the same SKU table without coordination overhead via per-customer Postgres advisory locks (AD17).
- **NFR-Sc4:** Resend free tier (3k emails/mo) sized for ~10 customers × 2-3 critical alerts/month each.
- **NFR-Sc5:** Supabase Cloud free tier sized for MVP catalog scale.

#### Reliability & Availability

- **NFR-R1:** `/health` endpoint ≥99% uptime measured by UptimeRobot 5-min pings over 30-day rolling window.
- **NFR-R2:** Recovery Time Objective (RTO) for application service: 30 minutes from critical alert to customer-facing action per the documented rollback playbook (NFR-O1).
- **NFR-R3:** Recovery Point Objective (RPO) for customer data, including audit log: ≤24 hours via Supabase Cloud daily backups. Append-only semantics (NFR-S6) preserved at MVP independent of durability tier.
- **NFR-R4:** 3-tier failure model (per FR46): transient retry within cycle; per-SKU operational log + retry next cycle; critical freeze immediately. No silent failures.
- **NFR-R5:** Customer impact during external dependency outages (Mirakl, Stripe, Supabase): customer-facing dashboard remains accessible; engine pauses gracefully; PT-localized banner within 3 cycles of sustained outage detection.

#### Integration Quality

- **NFR-I1:** Mirakl MMP integration: rate-limit budget verified via MCP; cadence pacing baked into design pre-launch; PRI01 → PRI02 polling resilient to transient failures.
- **NFR-I2:** Stripe integration: idempotency keys on subscription mutations; webhook handler idempotent; subscription state always reconcilable from Stripe API as source of truth.
- **NFR-I3:** Supabase Auth + RLS integration: RLS policies tested with deliberate cross-tenant access attempts pre-launch; regressions blocked via test suite that runs on every deploy.
- **NFR-I4:** Resend integration: critical-alert emails use templated PT-localized content; delivery failures logged and surfaced in founder monitoring dashboard.
- **NFR-I5:** UptimeRobot integration: monitor configured for `/health` 5-min cadence; failure routes to founder email (not customer-facing).
- **NFR-I6:** Cross-repo handoff with DynamicPriceIdea: signup form accepts source-context query parameters per FR7; no shared schema, no shared DB, no shared deployment pipeline (deliberate isolation).

#### Accessibility

- **NFR-A1:** Customer dashboard meets WCAG 2.1 AA practical baseline at MVP (sufficient color contrast, keyboard navigability, semantic HTML, alt text for icons).
- **NFR-A2:** Critical-action confirmations (Go-Live consent modal, Pause/Resume) accessible via keyboard without mouse interaction.
- **NFR-A3:** Audit log content readable by screen readers (proper table semantics or ARIA roles).

#### Localization

- **NFR-L1:** Customer-facing UI defaults to Portuguese (PT). All conditional copy is Portuguese-localized.
- **NFR-L2:** Spanish (ES) UI localization is NOT in MVP — Phase 2 trigger when a primary-ES customer signs up.

#### Operational Quality Attributes

- **NFR-O1:** Founder admin maintains a documented rollback playbook with a 30-minute response target. Drafted before customer #1.
- **NFR-O2:** Founder admin maintains a 1-page solo-founder continuity runbook covering laptop loss, hospitalization, extended absence. Drafted before customer #1.
- **NFR-O3:** Founder admin runs a documented Day-1 active-monitoring protocol for the first 24 hours post-Go-Live per customer (audit-log tail + uptime). 2-hour response SLA during the customer's launch week. Day-3 and day-7 pulse-check outreach via call or email.
- **NFR-O4:** Founder admin generates manual Moloni invoices per Stripe payment within 24 hours of billing, target ≤10 minutes per invoice. Aggregate exceeding 2-3 hr/month triggers Phase 2 Moloni API integration (per FR40 / FR44 Phase 2 trigger). **Story binding:** NFR-O4 is operational-tier work supported by Story 11.5's `recordMoloniInvoice` admin route; the SLA itself is a founder commitment, the supporting tooling is dev work. Both layers are covered.

> **NFR-O1, NFR-O2, NFR-O3** are founder-side operational commitments — not dev stories. Tracked in the **Parallel Tracks → Founder Operational Track** appendix at the end of this document. **NFR-O4** is hybrid: the SLA target lives in the Founder Operational Track; the supporting `/admin/moloni-record` route is Story 11.5 dev work.

### Additional Requirements

Architecture decisions that drive implementation. 30 numbered ADs (AD1-AD30) plus 13 validation amendments (F1-F13). Each carries an FR/NFR trace, MCP/empirical citation, and a Bob-story handoff in the source `architecture.md`.

#### Trust architecture & service topology

- **AD1** — Two services (`app.marketpilot.pt` Fastify + `repricer-worker` cron), one repo, one image, two start commands (`npm run start:app` / `npm run start:worker`). Coolify deploys two service instances from same git repo. → Affects FR45, NFR-Sc1, NFR-Sc3.
- **AD2** — Multi-tenant isolation enforced at Postgres RLS layer; client/worker connection split (app uses `@supabase/supabase-js` JWT-bound; worker uses `pg` direct service-role). → Affects FR5, FR6, NFR-S3, NFR-I3.
- **AD3** — Encrypted shop_api_key vault: app-layer envelope encryption (AES-256-GCM), master key in Coolify env on Hetzner, ciphertext in Postgres, annual rotation ceremony + 1Password cold backup + GitHub secret-scanning + pre-commit hook. → Affects FR8-FR11, NFR-S1.
- **AD4** — Founder admin via service-role bypass + role flag (`founder_admins` table); reuses customer-facing audit-log UI at `/audit?as_admin={customer_id}` with red admin-mode banner. Read-only at MVP, never customer impersonation. → Affects FR6, FR47, NFR-O3.

#### Mirakl integration

- **AD5** — Mirakl HTTP client reused from DynamicPriceIdea (`shared/mirakl/api-client.js`): raw `Authorization: <api_key>` header (no Bearer), 5-retry exponential backoff on 429/5xx/transport, `MiraklApiError` with PT-localized `getSafeErrorMessage()`, apiKey passed as parameter (never module-scope). → Affects every Mirakl call.
- **AD6** — Per-channel pricing model: `customer_marketplaces.channel_pricing_mode` enum (`'SINGLE' | 'MULTI' | 'DISABLED'`); Worten = `'SINGLE'` (empirically confirmed via PC01). Engine reasons per-(SKU, channel); schema is `sku_channel(customer_marketplace_id, sku_id, channel_code, ...)`. → Affects FR25, FR35.
- **AD7** — PRI01 writer: per-SKU aggregation with delete-and-replace semantic; CSV column set `offer-sku;price;channels` (Worten MVP); delimiter from PC01 (`SEMICOLON`); decimal precision 2; pipe-separated channel codes; `shop_sku` is the value in `offer-sku`; pending-import atomicity (`pending_import_id` set on ALL rows in batch including passthroughs); per-SKU resubmit on PRI03 partial failures. → Affects FR23.
- **AD8** — Engine decision table fully enumerated: 5-step decision flow (P11 read → cooperative-absorption check → floor/ceiling compute → branching by position → circuit-breaker check → PRI01 staging emit). Tie handling = HOLD. Edge cases enumerated (leader-is-self, all-above-ceiling, two-repricer-conflict, single-channel, single-competitor). Closes the FR24 gap. → Affects FR21, FR24.
- **AD9** — Cooperative-ERP-sync absorption: PRI02-gated `last_set_price`, skip-on-pending semantic (rows with `pending_import_id IS NOT NULL` are skipped by absorption); anomaly threshold 0.40 default. → Affects FR22.
- **AD10** — 4-state tier system + per-SKU `tier_cadence_minutes` + `last_won_at`: T1=15, T2a=15, T2b=45, T3=1440. Atomic write of `tier='2b'`, `tier_cadence_minutes=45` on T2a→T2b transition (F1 amendment closes the dispatcher predicate gap). → Affects FR17, FR18, FR19.
- **AD11** — Outbound circuit breaker: per-SKU 15% (engine STEP 5) + per-cycle 20% (dispatcher; F6 amendment locks denominator = `COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $1 AND excluded_at IS NULL`). Trip → `cron_state = 'PAUSED_BY_CIRCUIT_BREAKER'` + Atenção event + Resend. → Affects FR26, FR27.
- **AD12** — Inbound anomaly freeze (>40% external deviation) → per-SKU `frozen_for_anomaly_review`, orthogonal to `cron_state`. Customer review modal accepts/rejects; unfreeze. → Affects FR29.
- **AD13** — Self-identification via defensive `shop_name` filter (A01 captures `shop_id` + `shop_name`; P11 post-process removes offers where `offer.shop_name === own_shop_name`). Collision detection emits `shop-name-collision-detected` Atenção event + skip cycle. → Affects FR20, FR24.
- **AD14** — Mandatory P11 offer filter chain: `active === true` AND `total_price > 0` AND `shop_name !== own_shop_name`. Both are non-optional (Worten returns placeholder offers with `total_price=0` empirically). → Affects FR20.

#### Cron architecture & state machine

- **AD15** — `cron_state` enum on `customer_marketplaces` (UPPER_SNAKE_CASE): `'PROVISIONING' | 'DRY_RUN' | 'ACTIVE' | 'PAUSED_BY_CUSTOMER' | 'PAUSED_BY_PAYMENT_FAILURE' | 'PAUSED_BY_CIRCUIT_BREAKER' | 'PAUSED_BY_KEY_REVOKED' | 'PAUSED_BY_ACCOUNT_GRACE_PERIOD'`. Per-SKU `frozen_for_anomaly_review` orthogonal. Banner UX precedence: payment_failure > circuit_breaker > anomaly > key_revoked > account_grace > paused_by_customer > provisioning > dry_run. → Affects FR27, FR32, FR43, FR4 amended, UX4-UX5.
- **AD16** — Onboarding scan sequence: key-validate → A01 → PC01 → OF21 → P11 batch scan → tier classification → baseline snapshot. F4 amendment: row born in `'PROVISIONING'`, A01/PC01 columns NULLABLE while in PROVISIONING, CHECK constraint blocks transition out until populated. `scripts/mirakl-empirical-verify.js` reused as smoke test at first-customer onboarding. → Affects FR8-FR16.
- **AD17** — Dispatcher: master 5-min cron + per-customer Postgres advisory locks (`pg_try_advisory_lock(customer_marketplace.id)`); session-scoped (auto-release on crash); supports horizontal scaling without coordination. → Affects FR18, NFR-Sc3.
- **AD18** — Polling-only architecture; no Mirakl webhooks (seller-side unavailable per MCP). All change detection via P11 read each cycle. *(Constraint, not feature — see Architectural Constraints section.)*

#### Audit log architecture

- **AD19** — Monthly partitioning + compound indexes + precomputed aggregates. `audit_log` partitioned by `created_at` MONTH; daily/cycle aggregates in `daily_kpi_snapshots` and `cycle_summaries` tables; refreshed by daily cron + 5-min "today" partial refresh. Volume math (~3M entries/quarter at 50k contested catalog) demands ship-from-day-1. → Affects FR37, FR38, NFR-P8, NFR-S6.
- **AD20** — Audit log event-type taxonomy locked: 6 Atenção, 8 Notável, 11 Rotina (~22 types total). `audit_log_event_types` lookup table seeded at migration time (F5 amendment). Trigger derives `priority` column from event_type lookup. → Affects FR38d.

#### Account lifecycle & billing

- **AD21** — Account-deletion 4-step + 7-day grace + Stripe `cancel_at_period_end=true`. Encrypted shop_api_key destroyed AT INITIATION (not grace-end). Cancel-mid-grace returns customer to `'DRY_RUN'` (not directly `'ACTIVE'` — must re-enter Stripe payment). Hard-delete cron at T+7d. → Affects FR4 amended.
- **AD22** — Stripe + Moloni integration: ONE Stripe Customer + ONE Stripe Subscription per MarketPilot customer; ONE SubscriptionItem per `customer_marketplace` (F2 amendment corrects earlier model). Webhook signature + replay protection (≤5 min tolerance). Idempotency keys on mutations. NIF capture flow: founder asks at Day-3 pulse-check; persists to `customer_profiles.nif` and `moloni_invoices.nif` (F7 amendment). Moloni manual at MVP. → Affects FR40-FR44, NFR-S4, NFR-I2.

#### Operations, observability, failure modes

- **AD23** — `/health` composition: app endpoint reads `worker_heartbeats` freshness (most recent row < 90s old; worker writes every 30s). UptimeRobot pings only the app's `/health`; worker liveness observed via heartbeat. → Affects FR45, NFR-R1, NFR-R2.
- **AD24** — 3-tier failure model: transient (retry within cycle) → sustained transient after 3 consecutive cycle failures (PT-localized banner + `cycle-fail-sustained` Atenção event, NO Resend) → per-SKU operational (PRI03 reports → 3-cycle-rule escalates to `pri01-fail-persistent` Atenção + Resend) → critical (auth invalid / circuit breaker / anomaly). F10 amendment: hardcoded 3-cycle threshold; Phase 2 trigger to make per-customer configurable. → Affects FR46, NFR-R4.
- **AD25** — Resend critical alerts (FR48 only) + UptimeRobot health (5-min). PT-localized templates under `app/src/views/emails/*.eta`. No marketing emails. Sized for ~10 customers × 2-3 alerts/month. → Affects FR48, NFR-I4, NFR-I5.
- **AD26** — `customer_marketplaces.platform_features_snapshot` JSONB carries full PC01 response; typed columns are denormalized projection. Monthly cron re-pulls PC01 per active marketplace; differences logged as `platform-features-changed` Atenção + founder alert.
- **AD27** — Logging: structured JSON via pino. Sensitive-field redaction list locked: `Authorization`, `cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`. → Affects NFR-S1.

#### Important architecture-shaping decisions

- **AD28** — Validation: Fastify built-in JSON Schema, no extra library at MVP. *(Constraint — see Architectural Constraints section.)*
- **AD29** — Customer profile schema: `first_name`, `last_name`, `company_name` NOT NULL. F3 amendment locks atomic creation pattern: Postgres trigger on `auth.users` AFTER INSERT, `SECURITY DEFINER`, validates `raw_user_meta_data`, RAISE EXCEPTION rolls back the auth user creation. Signup route maps trigger HINT field to PT-localized field errors. NIF deferred to first Moloni invoice. → Affects FR1, FR42 (refund implies invoicing implies NIF).
- **AD30** — RLS regression suite runs on every deploy: `scripts/rls-regression-suite.js` spins up test Postgres with 2 customer fixture, attempts every mutation/query as customer A using customer B's IDs, asserts every attempt returns 0 rows or denied. Coverage: every customer-scoped table. Block deploy on failure. → Affects NFR-S3, NFR-I3.

#### Validation amendments (F1-F13)

Inline post-Pass-1 + Pass-2 fixes against the architecture. Each amendment is treated as part of its parent AD when sharding stories.

- **F1 (AD10)** — T2a→T2b atomic write of `tier_cadence_minutes=45`.
- **F2 (AD22)** — Stripe model corrected: ONE Customer + ONE Subscription per MarketPilot customer; ONE SubscriptionItem per `customer_marketplace`.
- **F3 (AD29)** — Atomic auth+profile via Postgres trigger with SECURITY DEFINER.
- **F4 (AD15, AD16)** — `'PROVISIONING'` cron_state value + nullable A01/PC01 columns + CHECK constraint.
- **F5 (AD20)** — `audit_log_event_types` lookup table migration ordering.
- **F6 (AD11)** — Circuit-breaker per-cycle 20% denominator clarified.
- **F7 (AD22)** — NIF capture flow at first Moloni invoice.
- **F8 (AD19)** — `audit_log.sku_id` and `sku_channel_id` carry NO FK constraint (immutability through SKU lifecycle).
- **F9 (Step 6 frontend)** — Per-page `<script src="/js/<page>.js" defer>` near `</body>`, no bundler.
- **F10 (AD24)** — Sustained-transient threshold (3 cycles) hardcoded at MVP; Phase 2 trigger for per-customer config.
- **F11 (Step 6 deployment)** — Worker process count: ONE instance at MVP via `replicas: 1`; horizontal scale is Phase 2 trigger.
- **F12 (AD22)** — Stripe linkage layout corrected post-F2.
- **F13 (cross-doc)** — Cron-state enum-value casing standardized to UPPER_SNAKE_CASE across prose + SQL examples.

### UX Design Requirements

38 numbered UX requirements from `ux-skeleton.md`. Each is a structural commitment (sitemap, flows, screen states, IA, microcopy) — pixel-level visuals are a downstream Claude Design pass and out of scope for this epic doc.

#### Auth & onboarding state machine

- **UX-DR1** — All authenticated routes require active Supabase Auth session; failed auth redirects to `/login` preserving intended destination as `?next=` param. [FR1, FR2, NFR-S5]
- **UX-DR2** — First-time customers always land on `/onboarding/key` after first email-verified login; onboarding state machine advances strictly forward; cannot reach `/` until `/onboarding/margin` complete and scan past readiness threshold. [FR8-FR16]
- **UX-DR3** — Returning customers land on `/`; if interception state detected (`/key-revoked`, `/payment-failed`, `/scan-failed`), it overrides `/`. [§8.1, §8.2]

#### Banner stacking & paused-state distinction

- **UX-DR4** — Banner stacking precedence top-down: payment_failure > circuit_breaker > anomaly > sustained_transient > dry_run. Only highest-precedence visible at a given time. [FR39, FR46]
- **UX-DR5** — `pause` and `payment-failed` states use **distinct visual treatments**: customer-pause = calm grey + `pause_circle` filled; payment-failed = warning-amber + `warning` filled. Same icon for both = trust failure. [FR32, FR43]

#### Scan progress

- **UX-DR6** — Phase labels for repricer scan: "A obter catálogo · A snapshotar baselines · A classificar tiers iniciais · Pronto." Each emits server-side progress events the page subscribes to. [FR12-FR14]

#### Audit log 5-surface IA

- **UX-DR7** — Daily summary card is the customer's daily glance. Counts are clickable: clicking "12 absorções ERP" filters Notável feed to that event type for today. [FR37, FR38]
- **UX-DR8** — Atenção feed items render expanded by default. Each carries: timestamp, scope, affected SKUs, root-cause snippet, primary action, secondary "Ver detalhes". When 0 items: small green confirmation copy.
- **UX-DR9** — Notável feed items collapsed-by-default (one-line summary), expand on click. In-place filter ("Ver só absorções ERP"). Per-channel filter chip pinned above feed (PT · ES · Ambos).
- **UX-DR10** — Search-by-SKU is the most common investigation pattern (Journey 4). Sticky-top search box on `/audit` landing if no Atenção to surface. [FR38]
- **UX-DR11** — Firehose (`/audit/firehose`) is opt-in. Cycle-paginated 50/page; SKU expansion lazy-loaded. [NFR-P8]
- **UX-DR12** — Trust property preserved: every event recorded and accessible via Surface 4 (search) or Surface 5 (firehose). Default surfaces don't drown customer in routine; they don't omit anything. [NFR-S6]

#### Dashboard layout & channel toggle

- **UX-DR13** — Dashboard does NOT replicate free report's 4-section narrative arc. Uses report's KPI card visual treatment (3 status cards in tonal tints — green/red/blue) but does NOT include rocket hero card or "Maiores oportunidades / Margem para subir / Vitórias rápidas" tables.
- **UX-DR14** — Channel toggle is single-select at MVP (PT or ES, never "Both"). "Both" merged view is Phase 2. [FR25, FR35]

#### Margin editor

- **UX-DR15** — Worked-example SKU selected by deterministic rule: `tier IN (1, 2a, 2b)` AND `current_price` between catalog `p25`/`p75` quartiles, ranked ascending by `|current_price - catalog_median_price|`, top SKU.
- **UX-DR16** — "Ver outro" refresh button cycles through top 5 candidates by same rule. Pure UX affordance; doesn't change engine.
- **UX-DR17** — If catalog has zero SKUs satisfying filter (e.g., all-Tier-3): empty-state copy. Customer-pickable SKU is Phase 2.
- **UX-DR18** — Stated-margin assumption uses **floor of selected band**: `<5%` → assume 5%, `5-10%` → 5%, `10-15%` → 10%, `15%+` → 15%. Conservative interpretation — example shows tighter margin than reality.
- **UX-DR19** — Display the assumption explicitly in editor caveat (microcopy §9.11).
- **UX-DR20** — Live update on input: example recomputes per keystroke debounced ~150ms. Numeric inputs accept percentages with one decimal; client-side validation (0-50% range), re-validated server-side on save.
- **UX-DR21** — Save action explicit (button, not auto-save). New values take effect at *next* cycle; toast: *"Margens guardadas. Aplicado a partir do próximo ciclo (~15 min)."*

#### Settings architecture

- **UX-DR22** — Settings is sectioned navigation (sidebar on desktop, accordion on mobile). All settings pages share dashboard chrome (sticky header, channel toggle hidden on settings). [FR1, FR4 amended, FR41 amended, FR43]

#### Trust-messaging layered system

- **UX-DR23** — Primary trust block at `/onboarding/key`, immediately below API-key input. Lock icon + green-edged box. Modal "Ver as nossas garantias →" with four-facet detail. [NFR-S1, FR11]
- **UX-DR24** — Secondary trust evidence embedded in operational UI (vault status pill on `/settings/key`; consent-modal language; always-visible pause; anomaly-review "Nada acontece até confirmares"; email footer customer-as-authority line).

#### Mobile vs desktop strategy

- **UX-DR25** — Dashboard, audit log, margin editor, settings, founder admin target ≥1280px viewport as primary. Render acceptably to ~960px. Below 768px = mobile-focused surfaces only.
- **UX-DR26** — Mobile-first surfaces within broader desktop product: (1) critical-alert email → mobile dashboard glance (`/?alert=X` stripped variant); (2) Atenção feed entry detail (single anomaly-review or circuit-breaker-trip fully readable + actionable); (3) Pause button always reachable in ≤2 taps from any state.
- **UX-DR27** — Mobile chrome strips channel toggle, margin editor, settings sidebar, audit-log firehose entirely.

#### Founder status page

- **UX-DR28** — `/admin/status` is read-only. Founder cannot edit customer data through this page (deliberate friction; edits require Supabase Studio). [FR6]
- **UX-DR29** — Visual register **deliberately differs** from customer dashboard: monospace dominant, dense tables, no ambient washes, slate/cool greys.
- **UX-DR30** — Click on customer row → `/audit?as_admin={customer_id}` reusing customer-side audit log UI; subtle red admin-mode banner across top. [FR6, FR47]

#### Mid-life key revocation + payment-failure interception

- **UX-DR31** — Engine emits `key-validation-fail` Atenção event + Resend. `/key-revoked` interception page replaces `/`. Button → `/onboarding/key` in **rotation mode**. On successful validation, customer returns to dashboard healthy live state; no re-onboarding, no scan repeat. [§8.1]
- **UX-DR32** — `/payment-failed` interception triggered on first login post-failure. Subsequent logins still in failed state revert to dashboard with persistent red banner — interception only triggers once. [FR43]

#### Catalog scan readiness summary

- **UX-DR33** — Post-scan completion, customer lands on `/onboarding/scan-ready` (NEW per UX skeleton). Layout shows: in-scope SKUs ready for repricing, Tier-3 (no competitors) count, no-EAN-ignored count, "porquê?" disclosure on refurbished structurally OOS.
- **UX-DR34** — "porquê?" disclosure expands inline with PT copy explaining refurbished-out-of-scope is structural to Worten (no shared EAN catalog), not a MarketPilot limitation.

#### Account deletion multi-step + grace

- **UX-DR35** — 4-step deletion flow: (1) read what gets wiped vs retained; (2) type `ELIMINAR` + email; (3) submit → confirmation email sent + 7-day grace; (4) hard delete at T+7d. Encrypted key destroyed at INITIATION, not grace-end. [FR4 amended]
- **UX-DR36** — During grace period: dashboard renders grey "Conta em eliminação · Faltam X dias" banner with prominent "Cancelar eliminação" button. All other UI disabled (read-only).
- **UX-DR37** — Confirmation email subject: *"Confirmação — eliminação da tua conta MarketPilot em 7 dias"*. Body: what gets deleted, what's retained for fiscal compliance, cancellation link, timestamp of irreversible deletion.

#### Add-marketplace concierge

- **UX-DR38** — `/settings/marketplaces` shows active marketplaces (read-only). Inactive "Adicionar marketplace" button with hover tooltip pointing to `hello@marketpilot.pt`. Founder handles addition out-of-band. [FR41 MVP]

### FR Coverage Map

Every functional requirement in the PRD has a primary epic home. FRs whose work splits between epics show their primary owner; the secondary epic wires the consumer-side surface.

```
FR1   → Epic 1   signup endpoint + auth.users trigger + customer_profiles
FR2   → Epic 1   negative-assertion AC: no customer_team_members table; one auth.users → one customers → one customer_profile
FR3   → Epic 1   password reset flow via Supabase Auth defaults
FR4   → Epic 10  4-step deletion + 7-day grace + hard-delete cron + key-destroy-at-initiation
FR5   → Epic 2   RLS policies + regression suite (extended by every customer-scoped-table migration in later epics)
FR6   → Epic 1   founder_admins seed + admin-auth middleware
        Epic 8   admin status page UI + /audit?as_admin= reuse pattern
FR7   → Epic 1   source-context capture middleware (?source / ?campaign)
FR8   → Epic 4   single-purpose key entry form
FR9   → Epic 4   inline 5s validation via P11 with reference EAN
FR10  → Epic 4   "Como gerar?" Worten-key one-page guide modal
FR11  → Epic 1   envelope encryption module + master-key loader (shared/crypto/)
        Epic 4   key vault persistence on form submit + redaction in logs
FR12  → Epic 4   async catalog scan kickoff
FR13  → Epic 4   closeable progress page with phase events
FR14  → Epic 4   server-side scan job state with reconnection
FR15  → Epic 4   scan-failure email; healthy completion silent
FR16  → Epic 4   margin band question + smart-default mapping + <5% segment warning
FR17  → Epic 4   sku_channels schema with state columns (list_price, last_set_price, current_price, baseline, tier, last_won_at, tier_cadence_minutes)
        Epic 7   engine logic populating + transitioning the state
FR18  → Epic 5   single 5-min cron + per-SKU tier_cadence_minutes dispatch
FR19  → Epic 7   tier transitions (T1→T2a, T2a→T2b atomic write per F1, etc.)
FR20  → Epic 7   P11 ranking by total_price + active+total_price+self filter chain (consumes Epic 3 mechanics)
FR21  → Epic 7   floor/ceiling math via shared/money/index.js (module ships in Epic 7)
FR22  → Epic 7   cooperative ERP-sync absorption (skip-on-pending semantic per AD9)
FR23  → Epic 6   PRI01 writer + PRI02 poller + PRI03 parser
FR24  → Epic 7   engine decision table — AD8 full enumeration; tie cases, leader-is-self, all-above-ceiling, two-repricer, single-channel, single-competitor
FR25  → Epic 4   per-channel data model (sku_channel.channel_code; channel_pricing_mode)
        Epic 7   per-channel engine logic
        Epic 8   PT/ES UI toggle
FR26  → Epic 7   per-SKU 15% (engine STEP 5) + per-cycle 20% (dispatcher gate per F6) circuit breakers
FR27  → Epic 7   circuit-breaker freeze + manual unblock; cron_state PAUSED_BY_CIRCUIT_BREAKER
FR28  → Epic 7   nightly reconciliation = Tier 3 daily pass
FR29  → Epic 7   anomaly-freeze trigger + frozen_for_anomaly_review state
        Epic 8   review modal UI + accept/reject endpoints (server in Epic 7, UI in Epic 8)
FR30  → Epic 8   dry-run state on dashboard root + dry-run banner
FR31  → Epic 8   informed-consent Go-Live modal with conditional language
FR32  → Epic 8   pause/resume buttons → cron_state transitions
FR33  → Epic 4   baseline_snapshots table + capture during scan
FR34  → Epic 8   KPI cards UI (3 status cards from free-report family)
        Epic 9   daily_kpi_snapshots data source
FR35  → Epic 8   PT/ES channel toggle pill
FR36  → Epic 8   margin editor + worked-profit-example with representative SKU
FR37  → Epic 9   per-customer-per-channel audit log surfaces
FR38  → Epic 9   filtering by channel, SKU/EAN, event type
FR38b → Epic 9   5-surface hierarchical IA (daily summary + Atenção feed + Notável feed + search + firehose)
FR38c → Epic 9   firehose cycle-aggregated view with per-SKU expansion
FR38d → Epic 9   event-type taxonomy at three priority levels (atencao/notavel/rotina) — uses architecture AD20's enumerated list, NOT the "6 / 8 / 11" prose summary (see Step 4 Notes)
FR39  → Epic 8   PT-localized banner UI (UX4 stack precedence)
        Epic 12  sustained-transient classifier (3-cycle threshold per F10)
FR40  → Epic 11  Stripe subscription start on Go-Live click
FR41  → Epic 11  concierge marketplace-add server-side process (admin tooling, no self-serve UI at MVP)
        Epic 8   read-only /settings/marketplaces page with concierge tooltip per UX-DR38
FR42  → Parallel Tracks split (per Step 3 detailing note below):
        Legal track   → ToS clause: "first-month money-back guarantee within 14 days of Go-Live, no questions asked" rides along with the price-setting-agency ToS update (single fixed-fee legal review)
        Operational track → runbook for issuing the refund manually via Stripe Dashboard
        Epic 8 (optional) → small "Issue refund (Stripe Portal)" link surfaced on /admin/status
        FR42 produces ZERO customer-facing dev stories — do NOT manufacture a refund UI story
FR43  → Epic 11  Stripe-managed dunning + final-failure webhook → cron_state PAUSED_BY_PAYMENT_FAILURE
FR44  → Epic 11  Moloni invoice metadata table + manual-flow ops doc + NIF capture flow per F7
FR45  → Epic 1   /health endpoint + worker_heartbeats freshness composition (AD23)
FR46  → Epic 12  3-tier failure model finalization (transient retry / per-SKU operational / critical)
FR47  → Epic 1   founder_admins seed + middleware
        Epic 8   admin status page UI (read-only, admin aesthetic register per UX-DR28-30)
FR48  → Epic 12  Resend critical-alert delivery (≤5 min, PT-localized templates)

NFR-O4 → Epic 11  Manual Moloni invoice SLA (Story 11.5 — admin route + per-customer `recordMoloniInvoice`); operational-tier SLA itself in Founder Operational Track
```

**Coverage check:** every FR1-FR48 + FR38b/c/d has at least one primary epic. FR42 is intentionally zero-dev-stories per the split above. FRs spanning multiple epics show the primary owner first. NFR-O4 hybrid (added 2026-05-01 per readiness check C1) — dev tooling in Story 11.5, operational SLA in parallel track.

## Epic List

### Epic 1: Foundation & Trust Primitives

**Goal.** A new prospect arriving from the free-report CTA self-serves signup; all server-side trust primitives (envelope encryption module, redacted logs via pino, atomic profile creation via Postgres trigger, /health observability composed from worker_heartbeats freshness, source-context capture for funnel attribution, founder_admins seed) are in place from day 1. Trust property is established before any customer data exists.

**FRs covered:** FR1, FR2 (negative-assertion only — no `customer_team_members` table; AC asserts schema does not include team-membership), FR3, FR6 (founder_admins seed + middleware only — admin status page UI in Epic 8), FR7, FR11 (crypto module only — key-vault wiring lands Epic 4), FR45 (/health endpoint + worker heartbeat write).

**NFRs covered:** NFR-S1 (envelope encryption foundation), NFR-S2 (TLS), NFR-S5 (Supabase Auth defaults), NFR-R1 (/health uptime), NFR-Sc4 (free-tier-sized for ~10 customers). NFR-O1/O2/O3 are founder operational commitments — Parallel Tracks → Founder Operational appendix.

**ADs covered:** AD1 (two services, one repo), AD3 (envelope encryption + master-key + secret-scanning + rotation runbook), AD4 partial (founder_admins seed + middleware only — page UI Epic 8), AD23 (/health composition reads worker_heartbeats), AD27 (pino + redaction list), AD29 (with F3 — atomic auth+profile via SECURITY DEFINER trigger).

**UX-DRs covered:** UX-DR1 (auth-required redirects with `?next=` preservation).

**Atomicity bundles in this epic:** F3 + AD29 ship together as a single story (signup endpoint + Postgres trigger migration + JSON Schema validation + safe-error mapping for trigger HINT field).

**Constraints honored:**
- Story 1.1 ships **vanilla ESLint + JSDoc rule + base config only** (per Pedro's refined ESLint guidance). Custom ESLint rules ship with their target modules in later epics.
- Story 1.1 ACs include negative assertions for **AD18 (no Mirakl webhook code paths)** and **AD28 (no extra validator library — Fastify built-in JSON Schema only)**.

**Phase 2 (post-MVP) reservations introduced here:**
- `shop_api_key_vault.master_key_version` (defaults to 1) — supports AD3 rotation ceremony.

**Independence:** Standalone — produces a working app server + worker + signup form + heartbeat + /health composition. No other epic depends on Epic 1 internals beyond the modules it ships.

---

### Epic 2: Multi-Tenant Isolation

**Goal.** Customer data is isolated at the Postgres layer via RLS policies on every customer-scoped table. Cross-tenant access is mechanically impossible regardless of route bugs. The RLS regression suite runs in CI and blocks deploys on any cross-tenant access attempt.

**FRs covered:** FR5 (full coverage).

**NFRs covered:** NFR-S3 (RLS at DB layer, service-role-key never to client), NFR-I3 (RLS regression per deploy).

**ADs covered:** AD2 (RLS-aware app client + service-role worker client; client/worker connection split), AD30 (regression suite in CI; block deploy on failure).

**UX-DRs covered:** none directly (foundation).

**Convention established:** Every customer-scoped table migration in Epics 4-11 includes its RLS policy in the same migration file AND extends `scripts/rls-regression-suite.js` as part of its acceptance criteria. This is a recurring AC pattern, not a per-epic story.

**Phase 2 reservations introduced here:** none.

**Independence:** Depends on Epic 1's `customers` + `customer_profiles` tables. Ships RLS enforcement primitives + the regression-suite scaffolding that all subsequent epics extend per their migration files.

---

### Epic 3: Mirakl Integration Foundation

**Goal.** System can talk to Mirakl reliably (retry/backoff, error mapping, PT-localized safe error messages). The HTTP client + endpoint wrappers (A01, PC01, OF21, P11) + Mirakl mock server (seeded from `verification-results.json` live captures) + smoke-test script all exist; not yet wired to a customer flow. This is the integration layer that Epics 4 and 7 consume.

**FRs covered:** none directly (foundation for FR8-FR11, FR12-FR15, FR20, FR23).

**NFRs covered:** NFR-I1 (Mirakl rate-limit budget verified via MCP; cadence pacing baked in pre-launch).

**ADs covered:** AD5 (apiClient.js port from DynamicPriceIdea + adaptation for multi-tenant), AD16 partial (smoke-test script `scripts/mirakl-empirical-verify.js` adapted for first-customer onboarding reuse).

**UX-DRs covered:** none (server-side).

**Constraints honored:**
- ESLint custom rule **`no-direct-fetch`** ships in this epic with `shared/mirakl/api-client.js` (per Pedro's refined ESLint sequencing — rules ship with their target modules).
- Mirakl mock server test fixtures preserved exactly from `verification-results.json` (live Worten captures from 2026-04-30); do NOT replace with synthetic data.

**Phase 2 reservations introduced here:**
- `marketplace_operator` enum at `'WORTEN'` only at MVP; Phase 2 extends with `'PHONE_HOUSE'`, `'CARREFOUR_ES'`, `'PCCOMPONENTES'`, `'MEDIAMARKT'`.

**Independence:** Depends on Epic 1 for `shared/crypto/envelope.js` (decryption when used live in Epic 4+). Produces the apiClient layer + endpoint wrappers + mock server + smoke-test script.

---

### Epic 4: Customer Onboarding

**Goal.** A signed-up customer can paste their Worten Mirakl shop API key, see it validate inline within 5 seconds, watch the catalog scan progress in PT (closeable + reconnectable), land on a transparent scan-readiness summary that honestly explains in-scope vs Tier-3 vs no-EAN-ignored counts, answer the single onboarding margin band question (with <5% segment warning), and arrive at the dashboard in DRY_RUN state. End-to-end onboarding works through to dry-run.

**FRs covered:** FR8, FR9, FR10, FR11 (key vault wiring on form submit), FR12, FR13, FR14, FR15, FR16, FR17 (sku_channels schema only — engine logic in Epic 7), FR25 (per-channel data model), FR33 (baseline_snapshots).

**NFRs covered:** NFR-P6 (5s key validation), NFR-P10 (50k SKUs in 4h scan target), NFR-L1 (PT-localized scan progress + scan-ready microcopy).

**ADs covered:** AD6 (channel_pricing_mode enum + Worten=SINGLE), AD15 partial (cron_state PROVISIONING → DRY_RUN transitions for onboarding; full transitions in Epic 5), AD16 (with F4 — onboarding scan sequence: key-validate → A01 → PC01 → OF21 → P11 → tier classify → baseline; F4 PROVISIONING state + nullable A01/PC01 columns + CHECK constraint), AD26 (PC01 capture into platform_features_snapshot JSONB).

**UX-DRs covered:** UX-DR2 (onboarding state machine advances strictly forward), UX-DR6 (4-phase scan progress labels), UX-DR23 (primary trust block at /onboarding/key), UX-DR33 (scan-ready interstitial), UX-DR34 ("porquê?" disclosure on refurbished structurally OOS).

**Atomicity bundles in this epic:** **F4 + onboarding scan ship together.** The `customer_marketplaces` schema migration with PROVISIONING state + nullable A01/PC01 columns + CHECK constraint MUST ship in the same epic as the scan flow that populates those columns. Splitting would leave rows stuck in PROVISIONING with no path forward (CHECK constraint blocks the transition, but no scan code exists to populate the columns). The schema migration story and the scan-orchestration story land adjacent with a shared integration test.

**Constraints honored:** Per-channel data model (`sku_channel(customer_marketplace_id, sku_id, channel_code, ...)`) lands here so Epic 7's engine and Epic 8's PT/ES toggle have a structured table to reason about.

**Phase 2 reservations introduced here:**
- `customer_marketplaces.tier_cadence_minutes_override` (JSONB nullable)
- `customer_marketplaces.anomaly_threshold_pct` (numeric nullable; defaults to 0.40 in code when null)
- `customer_marketplaces.edge_step_cents` (integer NOT NULL DEFAULT 1; per-marketplace customer-config in Phase 2)
- `skus.cost_cents` (integer nullable — Phase 2 cost-CSV upload)
- `skus.excluded_at` (timestamptz nullable — Phase 2 per-SKU exclude / promo mode)
- `customer_marketplaces.sustained_transient_cycle_threshold` flagged but NOT migrated at MVP per F10; Phase 2 trigger only.

**Independence:** Depends on Epic 1 (auth, crypto, signup), Epic 2 (RLS for `customer_marketplaces` + `skus` + `sku_channels` + `baseline_snapshots`), Epic 3 (apiClient + A01/PC01/OF21/P11 wrappers + smoke test). Produces a working onboarding flow that lands customers in DRY_RUN with populated catalog + tier-classified sku_channels + baseline snapshots.

---

### Epic 5: Cron Dispatcher & State Machine

**Goal.** Background work runs reliably. Master cron polls every 5 minutes via `node-cron`, picks SKUs whose `last_checked_at + tier_cadence_minutes < NOW()`, acquires per-customer Postgres advisory locks (`pg_try_advisory_lock(customer_marketplace_id)`), runs cycles, and writes heartbeats. Cron-state transitions are atomic with audit events via `transitionCronState`. Without Epic 7's engine, the dispatcher loops over no-op staging — the machinery is correct but does no work.

**FRs covered:** FR18 (single cron + per-SKU cadence dispatch).

**NFRs covered:** NFR-Sc3 (advisory locks support horizontal scale), NFR-P1, NFR-P2, NFR-P3, NFR-P4 (cycle-latency targets exercised by dispatcher's polling cadence).

**ADs covered:** AD15 (full cron_state transition logic — schema landed Epic 4), AD17 (master cron + per-customer advisory locks + cycle assembly + staging table flush), AD18 (negative assertion: no Mirakl webhook listener; polling-only — already established Epic 1 but reinforced here at the dispatcher).

**UX-DRs covered:** none (server-side).

**Atomicity bundles in this epic:** none unique to this epic (the engine atomicity bundle AD7+AD8+AD9+AD11 is between Epics 6 and 7).

**Phase 2 reservations introduced here:** none (`tier_cadence_minutes_override` already reserved Epic 4).

**Independence:** Depends on Epic 1 (worker process, heartbeat schema), Epic 2 (RLS for cron_state column reads), Epic 4 (`customer_marketplaces.cron_state` schema + `sku_channels` with `tier_cadence_minutes` populated by onboarding scan). Produces a dispatcher that can drive the engine in Epic 7.

---

### Epic 6: PRI01 Writer Plumbing

**Goal.** System can submit price imports to Mirakl per Worten's PRI01 spec — per-SKU aggregation (one PRI01 batch per SKU containing all that SKU's channel rows including passthroughs); delete-and-replace semantics with operator-config-driven CSV delimiter (semicolon for Worten per PC01 capture); pending_import_id atomicity (set on ALL participating rows including passthroughs at PRI01 submit; cleared atomically by PRI02 COMPLETE); PRI02 polling resolves COMPLETE/FAILED; PRI03 error reports parsed for per-SKU rebuild semantics.

**FRs covered:** FR23 (PRI01-only writes, PRI02 polling, PRI03 partial-success → per-SKU resubmit).

**NFRs covered:** NFR-P5 (PRI01 → PRI02 within 30 min; stuck-WAITING ≥30 min trips critical alert).

**ADs covered:** AD7 (per-SKU aggregation + delete-and-replace + pending_import_id atomicity + per-SKU resubmit on PRI03 failure).

**UX-DRs covered:** none (server-side).

**Atomicity bundles in this epic:** **AD7 belongs to a 4-AD atomicity bundle with AD8 + AD9 + AD11 (engine bundle in Epic 7).** Epic 6 ships the writer with unit tests + golden-file CSV fixtures + isolated PRI02-poller behavior tests against the Mirakl mock server. The **integration-test gate ships at the end of Epic 7** — that gate exercises the full cycle (engine STEP 1 → STEP 6 → writer → PRI02 COMPLETE) against all 17 P11 fixtures. Epic 6 cannot ship to production without Epic 7 (no engine to consume it; no caller in the dispatcher).

**Constraints honored:**
- ESLint custom rule **`no-raw-CSV-building`** (or equivalent — single-source-of-truth import discipline forcing all PRI01 CSV emission through `shared/mirakl/pri01-writer.js`) ships with this epic per Pedro's refined ESLint sequencing.
- Operator-driven CSV delimiter consumed at write time from `customer_marketplaces.operator_csv_delimiter` (captured by Epic 4 PC01 step); never hardcoded.

**Phase 2 reservations introduced here:** none.

**Independence:** Depends on Epic 3 (apiClient for HTTP transport), Epic 4 (`customer_marketplaces.operator_csv_delimiter` + `offer_prices_decimals` columns populated), Epic 9-foundation (audit writer for `pri01-submit` events). Standalone unit-tested writer with golden-file CSVs at the end of Epic 6; full integration validated in Epic 7.

---

### Epic 7: Engine Decision & Safety

**Goal.** The repricing engine: each cycle, for each (SKU, channel) the dispatcher selects, the engine reads competitors via P11, applies the mandatory filter chain (active=true AND total_price>0 AND shop_name≠own_shop_name), classifies tier, absorbs external changes within tolerance (skip-on-pending), computes floor/ceiling via integer-cents rounding, branches by position (UNDERCUT / CEILING_RAISE / HOLD per AD8's full decision table including tie cases), applies per-SKU 15% circuit breaker, stages writes; the dispatcher then applies the per-cycle 20% circuit-breaker check and flushes staging to the writer. Anomaly freezes (>40% external deviation) emit through audit log and require customer review. Tier 3 daily pass doubles as nightly reconciliation. **Atomicity bundle gate ships here.**

**FRs covered:** FR17 (engine state transitions populate the schema columns), FR19 (tier transitions with F1 atomic write of `tier='2b'`, `tier_cadence_minutes=45`), FR20 (P11 ranking + filter chain via Epic 3 mechanics), FR21 (floor/ceiling math via `shared/money/index.js` — module ships in this epic), FR22 (cooperative ERP-sync absorption with PRI02-gated `last_set_price`), FR24 (full AD8 decision table including all enumerated edge cases), FR26 (per-SKU 15% engine STEP 5 + per-cycle 20% dispatcher gate per F6 denominator), FR27 (circuit-breaker freeze + manual unblock), FR28 (Tier 3 daily pass = nightly reconciliation), FR29 (anomaly-freeze trigger + frozen_for_anomaly_review state).

**NFRs covered:** NFR-P1 (Tier 1 cycle latency p95 ≤ 18 min — exercised by engine cycle code), NFR-P2 (Tier 2a same target).

**ADs covered:** AD8 (full decision table), AD9 (cooperative-absorption with skip-on-pending), AD10 (with F1 — 4-state tier system + atomic T2a→T2b write), AD11 (with F6 — per-SKU 15% engine STEP 5 + per-cycle 20% dispatcher denominator), AD12 (anomaly freeze orthogonal to cron_state), AD13 (self-filter chain via `shared/mirakl/self-filter.js` + collision detection), AD14 (mandatory active+total_price filter; Worten zero-price-placeholder reality).

**UX-DRs covered:** none directly (server-side; review modal UI in Epic 8 wires to Epic 7's anomaly endpoints).

**Atomicity bundle gate:** **AD7 (Epic 6) + AD8 + AD9 + AD11 ship through a single integration-test gate at the end of Epic 7.** The gate is a single integration test (`tests/integration/pri01-pri02-cycle.test.js` or equivalent) that exercises the full cycle on all 17 P11 fixtures against the Mirakl mock server seeded with `verification-results.json`. Epic 6's writer code becomes safe to ship to production only after this gate passes.

**Constraints honored:**
- **`shared/money/index.js` (toCents, fromCents, roundFloorCents, roundCeilingCents) ships in Epic 7** alongside its primary caller (engine math). ESLint custom rule **`no-float-price`** ships with this module per Pedro's refined ESLint sequencing. Epic 8's eta templates import `formatEur()` / `fromCents()` for display formatters from this module.
- **All 17 P11 fixtures** (architecture's enumerated list, NOT the prose's "16" — see Step 4 Notes) used across Epic 7 stories. Each story names its applicable fixtures by filename in acceptance criteria.

**Phase 2 reservations introduced here:**
- Customer-tunable `anomaly_threshold_pct` reads NULL → uses 0.40 default; flips to customer-set value when Phase 2 ships UI (column already reserved Epic 4).

**Independence:** Depends on Epic 5 (dispatcher driving the engine), Epic 6 (writer consuming engine staging), Epic 9-foundation (audit writer for engine event emissions), Epic 4 (per-channel sku_channels populated). Together with Epic 5 + Epic 6 + Epic 9-foundation, completes the live-cycle path.

---

### Epic 8: Customer Dashboard & Surfaces

**Goal.** Customer can use the dashboard end-to-end: see KPI cards (driven by `daily_kpi_snapshots` from Epic 9; visually consistent family with the free report's KPI categories), toggle PT/ES, edit margins via inline panel with live worked-profit-example using a representative SKU from their own catalog, pause and resume with a single click each, click Go-Live behind an informed-consent modal that uses conditional Portuguese language, review anomaly-freezes via per-SKU modal, see banners for all paused/transient states (UX4 stack precedence). Founder admin status page lives here too — read-only, deliberately different aesthetic register. Interception pages (`/key-revoked`, `/payment-failed`, `/scan-failed`) override the dashboard root when triggered. Settings sectioned navigation (account, key, marketplaces concierge read-only, billing portal link, delete entry).

**FRs covered:** FR29 (review modal UI — server in Epic 7), FR30 (dry-run state on dashboard root + dry-run banner), FR31 (Go-Live consent modal), FR32 (pause/resume buttons), FR34 (KPI cards UI), FR35 (PT/ES channel toggle), FR36 (margin editor with worked-profit-example), FR39 (PT-localized banner UI; classifier in Epic 12), FR41 read-only UI (`/settings/marketplaces` concierge tooltip per UX-DR38; backend in Epic 11), FR47 (admin status page UI — middleware in Epic 1).

**NFRs covered:** NFR-P7 (≤2s broadband, ≤4s 3G mobile), NFR-A1 (WCAG 2.1 AA practical baseline), NFR-A2 (keyboard-accessible critical-action confirmations), NFR-L1 (PT-localized UI).

**ADs covered:** AD15 surfacing (banner UX consumes cron_state enum + UX4 precedence), AD24 partial (sustained-transient banner UI rendering — classifier in Epic 12).

**UX-DRs covered:** UX-DR1, UX-DR3, UX-DR4, UX-DR5, UX-DR13, UX-DR14, UX-DR15, UX-DR16, UX-DR17, UX-DR18, UX-DR19, UX-DR20, UX-DR21, UX-DR22, UX-DR24, UX-DR25, UX-DR26, UX-DR27, UX-DR28, UX-DR29, UX-DR30, UX-DR31, UX-DR32, UX-DR38.

**Constraints honored:** Eta templates import `formatEur()` / `fromCents()` from `shared/money/index.js` (module shipped Epic 7). Dashboard rendering does NOT replicate the free report's 4-section narrative arc, rocket hero card, or three product tables (UX-DR13).

**Step 3 detailing notes baked in:**
- AD4 admin-page reuse pattern: `/admin/status` row click opens `/audit?as_admin={customer_id}` per UX-DR30 — depends on Epic 9's audit-log query infrastructure. Story ACs make this dependency explicit.
- FR42 may produce a small "Issue refund (Stripe Portal link)" link on `/admin/status` — at most one tiny story; if not, FR42 produces zero stories here (refund operation runs in Stripe Dashboard out-of-band per the FR42 split note).

**Phase 2 reservations introduced here:** none new (channel-toggle "Both" merged view per UX-DR14 is Phase 2 trigger).

**Independence:** Depends on Epic 4 (state schema + cron_state column), Epic 7 (engine emits the events surfaced as KPIs and audit feed previews; engine endpoints for anomaly accept/reject), Epic 9 (5-surface IA + KPI aggregates power the dashboard's audit-log preview + KPI cards).

---

### Epic 9: Audit Log

**Goal.** Customer can investigate any engine action via 5-surface IA — daily summary card (5-min refresh), Atenção feed (action-required, expanded by default, steady-state 0-2/day), Notável feed (browsable, capped 30 with "Ver todos"), search-by-SKU (primary investigation primitive — sticky-top search, last 90 days default), firehose (cycle-aggregated, opt-in, paginated 50 cycles/page with lazy-loaded SKU expansion). Volume-tested at ~3M entries/quarter on a 50k contested catalog. Append-only at app layer with monthly partitioning + compound indexes + precomputed daily/cycle aggregates. Event-type taxonomy enforced via lookup table + priority-derivation trigger.

**FRs covered:** FR37, FR38, FR38b, FR38c, FR38d.

**NFRs covered:** NFR-P8 (≤2s on 90-day window via partitioning + indexes + aggregates), NFR-S6 (append-only at app layer), NFR-A3 (screen-reader-readable audit log).

**ADs covered:** AD19 (with F8 — `audit_log.sku_id` + `sku_channel_id` carry NO FK constraint for immutability through SKU lifecycle), AD20 (taxonomy via lookup table + trigger).

**UX-DRs covered:** UX-DR7, UX-DR8, UX-DR9, UX-DR10, UX-DR11, UX-DR12.

**Internal sequencing — Option A locked (per Pedro's confirmation):**

Epic 9 internally sequences foundation stories AS Story 1.x calendar siblings, while the rest of the epic ships at §I phase 7 order:

- **Foundation (lands as Story 1.x calendar siblings — earliest sequence):**
  - `audit_log_event_types` lookup table + AD20 taxonomy seed (F5 amendment migration ordering)
  - `audit_log` partitioned base table + `audit_log_set_priority` trigger + initial partition + monthly-partition-create cron
  - `shared/audit/writer.js` with `writeAuditEvent` single-source-of-truth helper
  - ESLint custom rule **`no-raw-INSERT-audit-log`** (per Pedro's refined ESLint sequencing — ships with `shared/audit/writer.js`)
- **UI (lands at §I phase 7 — after Epic 7 ships engine events):**
  - `daily_kpi_snapshots` + `cycle_summaries` schemas + daily-aggregate cron + 5-min "today" partial refresh
  - 5-surface query endpoints (HTMX-ready URL conventions; `/audit/_fragments/*`)
  - Search-by-SKU endpoint and rendering
  - Firehose cycle-aggregated view with lazy-loaded SKU expansion
  - Audit-log archive job for old partitions

**Why Option A:** Architecture's note for Bob explicitly says *"Story 9.1 (audit_log schema + writer module) is a Story 1.x sibling — must land before any feature that emits events."* Epics 5, 7, 10, 11, 12 all emit audit events. The foundation must exist when those epics ship. Option A keeps Epic 9 thematically coherent while honoring the dependency.

**Constraints honored:** `audit_log` event types in story acceptance criteria reference architecture AD20's enumerated list (7 Atenção / 8 Notável / 11 Rotina), NOT the prose summary's count "6 / 8 / 11" (see Step 4 Notes for Pedro).

**Phase 2 reservations introduced here:** none.

**Independence:** Foundation depends on Epic 1 + Epic 2 (RLS). UI depends on Epic 7 (engine emits events) + Epic 8 (chrome). Foundation's `writeAuditEvent` is consumed by Epics 5, 7, 10, 11, 12 — they ship audit emissions that "go nowhere visible" until Epic 9 UI lands, but the events ARE recorded and queryable raw.

---

### Epic 10: Account Deletion & Grace

**Goal.** Customer can request account deletion via 4-step flow — (1) settings page reads what gets wiped vs retained; (2) modal requires typing `ELIMINAR` + email; (3) confirmation email sent + 7-day grace period begins (cron paused, dashboard locked, banner with cancel button, cancel-mid-grace returns to DRY_RUN — must re-enter Stripe to reactivate); (4) T+7d hard-delete cron job per GDPR Article 17. **Encrypted shop_api_key destroyed at INITIATION, not grace-end** (security commitment "the moment you say delete me, the key is gone"). Stripe subscription cancels via `cancel_at_period_end=true`. Moloni invoice metadata retained (fiscal record).

**FRs covered:** FR4 (amended).

**NFRs covered:** NFR-S1 (encrypted-key destruction at deletion initiation), NFR-S6 (audit log retention with fiscal-evidence exception).

**ADs covered:** AD21.

**UX-DRs covered:** UX-DR35, UX-DR36 (grace-period banner + read-only mode), UX-DR37 (PT-localized confirmation email).

**Atomicity bundles in this epic:** none.

**Phase 2 reservations introduced here:** none.

**Independence:** Depends on Epic 1 (key vault for destruction at initiation; customer schema), Epic 4 (cron_state for `PAUSED_BY_ACCOUNT_GRACE_PERIOD`), Epic 8 (`/settings/delete` UI surface + grace-period banner rendering), Epic 11 (Stripe `cancel_at_period_end` integration), Epic 9-foundation (audit writer for deletion-initiated / grace-cancelled / hard-deleted events).

---

### Epic 11: Billing — Stripe & Moloni

**Goal.** Customer is billed via Stripe €50/marketplace/month on first Go-Live click. ONE Stripe Customer + ONE Stripe Subscription per MarketPilot customer (per F2 amendment); ONE SubscriptionItem per `customer_marketplace`. Stripe webhook drives `cron_state` transitions for payment-failure pause (with signature + replay protection). Founder generates Moloni invoices manually with PT NIF/IVA compliance; NIF captured at first Moloni invoice per F7 (founder asks at Day-3 pulse-check; persists to `customer_profiles.nif` + `moloni_invoices.nif`). Concierge marketplace-add operates server-side (no self-serve UI at MVP).

**FRs covered:** FR40 (Stripe subscription start on Go-Live), FR41 MVP (concierge backend; UI is read-only per UX-DR38 in Epic 8), FR42 (refund policy — see Step 3 detailing note below; FR42 likely produces zero dev stories), FR43 (Stripe-managed dunning + webhook-driven cron_state transitions), FR44 (Moloni manual invoicing + NIF capture flow).

**NFRs covered:** NFR-S4 (webhook signature + replay protection ≤5 min tolerance), NFR-S7 (no card data stored — only Stripe customer/subscription IDs), NFR-I2 (idempotency keys on mutations).

**ADs covered:** AD22 (with F2 corrected Stripe model; F7 NIF capture flow; F12 schema linkage layout corrected).

**UX-DRs covered:** UX-DR38 (concierge marketplace-add tooltip — UI in Epic 8).

**Step 3 detailing note baked in (FR42 split):**

When sharding Epic 11 stories, recognize FR42 has **three components**, none of which is a customer-facing dev story:
1. **Legal track** — ToS clause "first-month money-back guarantee within 14 days of Go-Live, no questions asked" rides along with the price-setting-agency ToS update (single fixed-fee legal review covers both). Tracked in **Parallel Tracks → Legal**, not here.
2. **Operational track** — runbook for issuing the refund manually via Stripe Dashboard. Tracked in **Parallel Tracks → Founder Operational**, not here.
3. **Optional Epic 8 micro-story** — small "Issue refund (Stripe Portal link)" link surfaced on `/admin/status`. Decide in Step 3: ship it as a tiny story OR drop it (founder uses Stripe Dashboard direct).

**Do NOT manufacture a customer-facing "refund UI" story.** FR42 likely produces zero dev stories in this epic; the policy lives in ToS, the operation runs out-of-band.

**Atomicity bundles in this epic:** none.

**Phase 2 reservations introduced here:**
- Schema supports multi-marketplace from day 1; Phase 2 ships self-serve add/remove UI without migration (per FR41 Phase 2 spec).
- Moloni API integration triggered Phase 2 when founder time exceeds 2-3 hr/month aggregate (today: manual ~5-10 min/customer/month).

**Independence:** Depends on Epic 1 (`customers` table for Stripe linkage), Epic 4 (`customer_marketplaces` for SubscriptionItem linkage), Epic 8 (Go-Live consent modal + `/settings/billing` Customer Portal link UI), Epic 9-foundation (audit writer for billing-event emissions).

---

### Epic 12: Operations & Failure Model

**Goal.** 3-tier failure model active across the system (transient retry within cycle → sustained transient after 3 consecutive cycle failures emits PT-localized banner + `cycle-fail-sustained` Atenção event without Resend → per-SKU operational with 3-cycle-rule escalation to `pri01-fail-persistent` Atenção + Resend → critical with auth-invalid / circuit-breaker-trip / anomaly-freeze freezing customer's repricing immediately). Resend delivers critical-tier alerts ≤5 min in PT. UptimeRobot pings `/health` every 5 min; failure routes to founder email out-of-band. Sustained-transient threshold hardcoded at 3 cycles per F10 (Phase 2 trigger for per-customer config). PC01 monthly re-pull cron catches operator-config drift (`platform-features-changed` Atenção event + founder alert).

**FRs covered:** FR46 (3-tier failure model finalization), FR48 (Resend critical-alert delivery ≤5 min).

**NFRs covered:** NFR-I4 (Resend PT-localized templates), NFR-I5 (UptimeRobot config), NFR-R5 (PT-localized banner within 3 cycles), NFR-P9 (≤5 min critical alert).

**ADs covered:** AD24 (with F10 hardcoded 3-cycle threshold), AD25 (Resend + UptimeRobot), AD26 partial (PC01 monthly re-pull cron — capture itself in Epic 4).

**UX-DRs covered:** none directly (banner UI in Epic 8; this epic is the classifier + sender).

**Atomicity bundles in this epic:** none.

**Constraints honored:**
- Resend used ONLY for critical-tier alerts (FR48 + NFR-Sc4 budget). No marketing emails, no day-3/day-7 pulse-check templates (those are founder-direct per NFR-O3 — Parallel Tracks → Founder Operational).
- UptimeRobot config is manual via UptimeRobot UI; documented in ops runbook (NOT a dev story).

**Phase 2 reservations introduced here:**
- `customer_marketplaces.sustained_transient_cycle_threshold` flagged as Phase 2 trigger only; no MVP migration (per F10).

**Independence:** Depends on Epic 5 (dispatcher cycles to count for sustained-transient threshold), Epic 7 (engine events to escalate per-SKU), Epic 8 (banner UI surface for sustained-transient banner trigger), Epic 9-foundation (audit writer for `cycle-fail-sustained` and `pri01-fail-persistent` events).

---

## Step 3 detailing notes (folded in for story sharding)

Three notes from Pedro to fold into Step 3 story creation:

1. **Epic 9 internal sequencing — Option A locked.** Foundation stories (writer module + event_types lookup + base partitioned table + priority-derivation trigger + monthly-partition cron) ship as **Story 1.x calendar siblings** even though they live in Epic 9 thematically. The 5-surface IA + KPI aggregates + search + firehose ship later in §I phase 7 order. Story numbering inside Epic 9 reflects this: Story 9.0 / 9.1 are foundation; 9.2+ are UI.
2. **FR42 split.** Three components, zero customer-facing dev stories. (a) ToS clause → Parallel Tracks → Legal (rides along with ToS update for price-setting agency, single fixed-fee legal review). (b) Operational process → Parallel Tracks → Founder Operational (runbook for issuing refund via Stripe Dashboard). (c) Optional micro-story for `/admin/status` Stripe Portal link in Epic 8. **Do not manufacture a customer-facing refund UI story.**
3. **`shared/money/index.js` placement — picked Epic 7.** Ships alongside engine math (highest-leverage caller). ESLint custom rule `no-float-price` lands with it per refined ESLint sequencing. Epic 8 imports `formatEur()` / `fromCents()` for eta template helpers.

---

# Epic Definitions and Stories

Stories follow the template's user-story + Given/When/Then ACs. Each story carries a metadata block: AD/FR/NFR/UX-DR refs, single-source-of-truth modules created, migrations created, prior dependencies, downstream enablers, and S/M/L size.

---

## Epic 1: Foundation & Trust Primitives

### Story 1.1: Scaffold project, two-service Coolify deploy, composed /health
**GH Issue:** #1

**Implements:** AD1, AD23 · **FRs:** FR45 · **NFRs:** NFR-R1, NFR-Sc4 · **Size:** L
**SSoT modules created:** `app/src/server.js`, `worker/src/index.js`, `worker/src/jobs/heartbeat.js`, `app/src/routes/health.js`, `eslint.config.js`
**Migrations:** `supabase/migrations/202604301212_create_worker_heartbeats.sql`
**Depends on:** (none — first story)
**Enables:** Stories 1.2, 1.3, 1.4, 1.5; all subsequent epics

As Pedro (developer/founder),
I want a working two-service skeleton with `npm run start:app` and `npm run start:worker` deployed to Coolify, with `/health` composed from worker heartbeat freshness,
So that every subsequent epic builds on a Coolify-deployable foundation that UptimeRobot can monitor.

**Acceptance Criteria:**

**Given** a fresh clone of the repo
**When** I run `npm install && npm run start:app`
**Then** Fastify returns 200 on `GET /` on `localhost:3000`
**And** `package.json` has `engines.node = ">=22.0.0"` and `type = "module"` (JS-ESM)
**And** dependencies match architecture's pinned set (fastify + plugins, eta, pino, pg, supabase-js, stripe, resend, node-cron) plus dev: eslint
**And** ESLint vanilla config + JSDoc completeness rule pass with one example annotated function

**Given** required env vars set (`MASTER_KEY_BASE64`, Supabase URL + service-role key)
**When** I run `npm run start:worker`
**Then** the worker writes a row to `worker_heartbeats(id bigserial, worker_instance_id text NOT NULL, written_at timestamptz NOT NULL DEFAULT NOW())` every 30 seconds via `worker/src/jobs/heartbeat.js`
**And** the worker logs `info`-level boot message via pino structured JSON to stdout
**And** the worker process does not depend on the app server

**Given** the worker is writing heartbeats
**When** the app server receives `GET /health`
**Then** response is 200 IFF (a) `SELECT 1` from Postgres returns within 1s AND (b) the most recent `worker_heartbeats.written_at` is < 90 seconds old
**And** response is 503 with `{status: "degraded", details: {db, worker_heartbeat_age_s}}` if either fails
**And** the route is defined in `app/src/routes/health.js` (no Fastify auth middleware applied — public endpoint per FR45)

**Given** Coolify configured with two services pointing at this repo
**When** I `git push` to main
**Then** Coolify deploys both services in parallel from one image with start commands `npm run start:app` (port 3000, public as `app.marketpilot.pt`) and `npm run start:worker` (no public URL)
**And** both services share the same env-var subset (Coolify-managed; verified by spot-checking three vars)

**Given** the scaffolded project (negative assertions per Architectural Constraints)
**When** I inspect `package.json` and source tree
**Then** there is NO Mirakl webhook listener defined (AD18 — polling-only)
**And** the validator dep is Fastify built-in JSON Schema only — `zod`, `yup`, `joi`, `ajv` are NOT in dependencies (AD28)
**And** there is no SPA framework (`react`, `vue`, `svelte`, `angular` not in deps), no bundler (`vite`, `webpack`, `rollup`, `esbuild` not in deps), no TypeScript compiler (`typescript` not in deps), no Redis/BullMQ
**And** there is no ES UI translation file or `i18n` infrastructure (PT-only at MVP per NFR-L2)

**Given** the project scaffold is complete
**When** I run `node --test 'tests/integration/scaffold-smoke.test.js'`
**Then** the test starts both services, asserts `/health` returns 200 within 60s, asserts a `worker_heartbeats` row appears within 60s, then shuts down cleanly

---

### Story 1.2: Envelope encryption module, master-key loader, secret-scanning hook
**GH Issue:** #2

**Implements:** AD3 · **FRs:** FR11 (crypto module only — vault wiring lands Epic 4) · **NFRs:** NFR-S1 · **Size:** M
**SSoT modules created:** `shared/crypto/envelope.js`, `shared/crypto/master-key-loader.js`, `scripts/check-no-secrets.sh`, `scripts/rotate-master-key.md`
**Migrations:** `supabase/migrations/202604301204_create_shop_api_key_vault.sql` (table only — wiring in Epic 4)
**Depends on:** Story 1.1
**Enables:** Story 4.3 (key entry form with encryption pipeline), Story 10.x (key destruction at deletion initiation)

As Pedro (developer/founder),
I want envelope-encryption helpers (AES-256-GCM) with a master-key loader and a secret-scanning pre-commit hook,
So that customer Mirakl shop API keys can later be encrypted at rest with zero plaintext leakage and the master-key custody chain is locked from day 1.

**Acceptance Criteria:**

**Given** the master-key loader module
**When** the worker process starts with `MASTER_KEY_BASE64` set to a valid 32-byte base64 value
**Then** `shared/crypto/master-key-loader.js` validates the key length, holds it in process memory only, and never writes it to disk or logs
**And** if `MASTER_KEY_BASE64` is missing or malformed, the worker exits with a clear error message (no partial-state startup)
**And** the master key is never read from a file — env var only

**Given** `shared/crypto/envelope.js`
**When** I call `encryptShopApiKey(plaintext, masterKey)` with a sample API key
**Then** I get back `{ciphertext: Buffer, nonce: Buffer (12 bytes), authTag: Buffer (16 bytes), masterKeyVersion: 1}`
**And** decryption via `decryptShopApiKey({ciphertext, nonce, authTag, masterKey})` returns the original plaintext
**And** decryption with a tampered ciphertext or auth tag throws `KeyVaultDecryptError`
**And** unit tests cover happy path + tamper detection + wrong-key rejection (`tests/shared/crypto/envelope.test.js`)

**Given** the `shop_api_key_vault` migration
**When** I apply it to a fresh Postgres
**Then** the table exists per architecture's schema: `customer_marketplace_id uuid PK FK`, `ciphertext bytea NOT NULL`, `nonce bytea NOT NULL`, `auth_tag bytea NOT NULL`, `master_key_version integer NOT NULL DEFAULT 1`, `last_validated_at timestamptz`, `last_failure_status smallint`, `created_at`, `updated_at`
**And** RLS policy `shop_api_key_vault_select_own` (existence read only — values bypass-only via service-role decrypt) is present in the same migration
**And** `scripts/rls-regression-suite.js` is extended with a test that asserts customer A cannot read customer B's vault row

**Given** the secret-scanning hook is installed
**When** I attempt `git commit` with a file containing any of the patterns `MASTER_KEY`, `shop_api_key`, `sk_live_`, `sk_test_` (the four AD3-locked patterns), OR the heuristic `Authorization: Bearer`
**Then** `scripts/check-no-secrets.sh` (configured as a pre-commit hook) blocks the commit and prints which file/pattern matched
**And** the hook is idempotent (running it twice produces identical output)
**And** the hook's regex matches `MASTER_KEY_BASE64=...` AND `MASTER_KEY=...` AND any string containing `shop_api_key` (case-sensitive) AND `sk_live_<anything>` AND `sk_test_<anything>`

**Given** the rotation runbook
**When** I open `scripts/rotate-master-key.md`
**Then** it documents the 5-step rotation procedure verbatim from architecture AD3 (generate new key → deploy as `MASTER_KEY_BASE64_NEXT` alongside existing → worker re-encrypts every vault row with per-row advisory lock → swap env vars → 1Password backup updated)
**And** the runbook is markdown only, NOT executable code

---

### Story 1.3: Pino structured logging with redaction list
**GH Issue:** #3

**Implements:** AD27 · **FRs:** (foundation — no positive FR) · **NFRs:** NFR-S1 (logs never contain cleartext keys) · **Size:** S
**SSoT modules created:** `shared/logger.js` (or `app/src/lib/logger.js` + `worker/src/lib/logger.js` factory pair)
**Depends on:** Story 1.1 (Pino is in deps from scaffold)
**Enables:** all subsequent stories that emit logs

As Pedro (developer/founder),
I want pino configured with a locked sensitive-field redaction list,
So that operational debugging never leaks secrets to stdout or to Coolify's log capture.

**Acceptance Criteria:**

**Given** the pino config
**When** the app server boots and writes a log line containing any of `Authorization`, `cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`
**Then** the value is replaced with `'[REDACTED]'` in the output stream
**And** the same redaction applies to the worker's pino instance
**And** redaction works whether the field is at the top level or nested in an object

**Given** a log line emitted by the app server
**When** I read it from stdout
**Then** it is valid JSON (one line per record, structured)
**And** every record carries `customer_marketplace_id` (or `null` if pre-auth), `request_id` (app) or `cycle_id` (worker), and `event_type` if the line corresponds to an audit event
**And** log levels respected: `info` for cycle-start/cycle-end, `warn` for retried failures, `error` for critical events

**Given** a unit test asserting redaction
**When** I run `node --test tests/shared/logger.test.js`
**Then** the test feeds a sample object containing a `shop_api_key` field through pino's stream and asserts the secret value never appears in the captured output (only `[REDACTED]`)
**And** the test also covers `Authorization` header redaction in a simulated Fastify request log

**Given** the codebase
**When** I grep for `console.log`, `console.error`, `process.stdout.write` outside `scripts/`
**Then** there are zero matches (ESLint base rule enforces this; pre-commit hook double-checks per Story 1.2)

---

### Story 1.4: Signup endpoint, atomic profile trigger, source-context capture
**GH Issue:** #4

**Implements:** AD29 (with F3 — atomicity bundle), FR7 source-context middleware · **FRs:** FR1, FR2 (negative-assertion), FR3, FR7 · **NFRs:** NFR-S5 · **Size:** L
**SSoT modules created:** `app/src/routes/_public/signup.js`, `app/src/routes/_public/login.js`, `app/src/routes/_public/forgot-password.js`, `app/src/routes/_public/reset-password.js`, `app/src/middleware/source-context-capture.js`, `app/src/middleware/auth.js`, `app/src/views/pages/signup.eta`, `app/src/views/pages/login.eta`
**Migrations:** `supabase/migrations/202604301200_create_customers.sql`, `supabase/migrations/202604301201_create_customer_profiles_with_trigger.sql`
**Depends on:** Story 1.1, Story 1.3
**Enables:** Story 4.3 (key entry — requires authenticated customer), every customer-scoped feature
**Visual reference pattern:** **C** — UX skeleton §1 sitemap auth screens (`/signup`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`) + Supabase Auth defaults + visual-DNA tokens (Manrope/Inter, navy primary, radius scale per UX skeleton §10). No per-screen stub; auth surfaces share consistent chrome.

**Atomicity bundle:** F3 + AD29 ship as a single PR — schema migration + trigger + endpoint + JSON Schema validation + safe-error mapping all in one commit.

As a new prospect arriving from the free-report CTA,
I want to sign up with email + password + first name + last name + company name and have my profile created atomically,
So that I can verify my email and proceed to onboarding without ending up in an orphan-auth-without-profile state.

**Acceptance Criteria:**

**Given** the signup migration
**When** I apply `202604301200_create_customers.sql` then `202604301201_create_customer_profiles_with_trigger.sql`
**Then** `customers` table exists with columns from architecture (id PK FK to auth.users, email, source, campaign, deletion_initiated_at, deletion_scheduled_at, stripe_customer_id, stripe_subscription_id, created_at, updated_at)
**And** `customer_profiles` table exists with `customer_id PK FK to customers ON DELETE CASCADE`, `first_name TEXT NOT NULL`, `last_name TEXT NOT NULL`, `company_name TEXT NOT NULL`, `nif TEXT` (nullable — captured later per F7), timestamps
**And** the Postgres trigger `trg_handle_new_auth_user` exists on `auth.users AFTER INSERT FOR EACH ROW`
**And** the trigger function `handle_new_auth_user()` is `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public` and reads `NEW.raw_user_meta_data ->> 'first_name'/'last_name'/'company_name'/'source'/'campaign'`
**And** the trigger validates each required field non-empty and `RAISE EXCEPTION ... USING ERRCODE = '23502', HINT = 'PROFILE_FIRST_NAME_REQUIRED'` (or `_LAST_`/`_COMPANY_`) on missing/empty
**And** RLS policies for both tables present in the same migrations

**Given** the signup route `POST /signup`
**When** the customer submits `{email, password, first_name, last_name, company_name}` with all required fields valid
**Then** the route calls `supabase.auth.signUp({email, password, options: {data: {first_name, last_name, company_name, source, campaign}}})`
**And** Supabase Auth creates the `auth.users` row, the trigger fires, `customers` + `customer_profiles` rows are created in the same transaction
**And** the response redirects to `/verify-email` (Supabase chrome) per UX-DR1
**And** the customer's `source` and `campaign` (captured by middleware) are persisted on the `customers` row per FR7

**Given** the signup route receives a request missing `first_name`
**When** the trigger raises with `HINT = 'PROFILE_FIRST_NAME_REQUIRED'`
**Then** Supabase Auth returns the error to the route
**And** the route inspects the error's HINT field and renders a PT-localized field-level error: e.g., *"Por favor introduz o teu nome próprio."*
**And** the customer remains on `/signup` with their other fields preserved (email, last_name, company_name)
**And** no partial-state `customers` or `auth.users` rows exist (verify with a DB query)

**Given** the source-context-capture middleware
**When** a request lands on `/signup?source=free_report&campaign=tony_august`
**Then** the middleware extracts `?source` and `?campaign` query params, persists them to a session/cookie until signup completes, and propagates them to `signUp options.data` so the trigger writes them to `customers.source` / `customers.campaign`
**And** unknown / missing params are stored as NULL (NOT empty string)
**And** the middleware is wired into the public-routes group only (no auth required)

**Given** the schema (negative assertion for FR2)
**When** I inspect the database
**Then** there is NO `customer_team_members` or equivalent multi-user table
**And** the schema design produces exactly one `customers` row + one `customer_profiles` row per `auth.users` row (1:1:1)
**And** an integration test (`tests/integration/signup-single-user.test.js`) attempts to create a second `customers` row for the same `auth.uid()` and asserts it fails (UNIQUE constraint or RLS rejection)

**Given** the password reset route per FR3
**When** the customer submits `POST /forgot-password` with their email
**Then** the route calls `supabase.auth.resetPasswordForEmail()` and Supabase sends the email-verified reset link
**And** `/reset-password` accepts the link's recovery token and updates the password via Supabase Auth
**And** there is no MarketPilot-side password storage (Supabase handles bcrypt)

**Given** an integration test
**When** I run `tests/integration/signup-flow.test.js`
**Then** it covers: happy-path signup → trigger fires → both rows created; missing-field rejection → trigger raises → no rows created → PT field error; source-context capture from `?source=free_report` → persisted on `customers.source`

---

### Story 1.5: Founder admins seed + admin-auth middleware
**GH Issue:** #5

**Implements:** AD4 (partial — seed + middleware only; admin status page UI in Epic 8) · **FRs:** FR6, FR47 (founder-side primitive) · **Size:** S
**SSoT modules created:** `app/src/middleware/founder-admin-only.js`
**Migrations:** `supabase/migrations/202604301202_create_founder_admins.sql`
**Depends on:** Story 1.4 (auth middleware)
**Enables:** Story 8.10 (`/admin/status` page UI), every admin-route gate

As Pedro (founder),
I want a `founder_admins` lookup table + a Fastify middleware that gates `/admin/*` routes by checking the requesting user's email against that table,
So that the admin status page in Epic 8 has a working access gate the moment its UI ships, and so the admin path uses a service-role DB connection server-side only.

**Acceptance Criteria:**

**Given** the migration
**When** I apply `202604301202_create_founder_admins.sql`
**Then** `founder_admins` exists with columns `email TEXT PRIMARY KEY`, `notes TEXT`, `created_at timestamptz NOT NULL DEFAULT NOW()`
**And** there is NO RLS policy on this table (system table; service-role-only access)
**And** the migration includes a seed insert for Pedro's founder email

**Given** the middleware `app/src/middleware/founder-admin-only.js`
**When** an authenticated request lands on a route gated by `founder-admin-only`
**Then** the middleware checks the requesting user's email against `founder_admins` using a service-role DB connection
**And** if the email is present → request proceeds with a `request.adminContext = {email}` annotation
**And** if the email is absent → response is 403 with PT-localized message *"Esta página é apenas para administração."*
**And** unauthenticated requests redirect to `/login?next=...` per UX-DR1

**Given** the middleware is wired
**When** I send a request as a non-founder customer to a route gated by it
**Then** the request never reaches the route handler
**And** the access denial is logged at `info` level via pino with `customer_marketplace_id`, `request_id`, and `event_type: 'admin_access_denied'`
**And** Step 4 Notes-for-Pedro tracks the consideration of hashing/truncating email in this log line for GDPR PII minimization

**Given** an integration test
**When** I run `tests/integration/admin-middleware.test.js`
**Then** it covers: unauthenticated → redirect to login; authenticated non-founder → 403; authenticated founder → request proceeds with adminContext annotation

---

## Epic 2: Multi-Tenant Isolation

### Story 2.1: RLS-aware app DB client + service-role worker DB client + transaction helper
**GH Issue:** #6

> **Carried requirements (Bob: read before sharding):** see `_bmad-output/implementation-artifacts/epic-1-retro-2026-05-03.md` Item 3 for spec constraints — (1) centralize conditional-SSL-by-host into a single helper (`getDbClientForHost` or similar; this is the SSL drift root cause Library Empirical Contract #9 documents); (2) explicitly enumerate the 3 pools being absorbed (`app/src/routes/health.js`, `worker/src/jobs/heartbeat.js`, `app/src/middleware/founder-admin-only.js`) — `endFounderAdminPool` test-teardown export must survive absorption; (3) honor the `mp_session` cookie empirical contract (auth.js decorates `request.user.access_token`, rls-context.js consumes it directly — do NOT re-derive from cookie); (4) pre-load Library Empirical Contracts entries #2 (unsignCookie), #3 (CA pinning), #5 (auth.users DELETE) when sharding.

**Implements:** AD2 · **FRs:** FR5 (foundation) · **NFRs:** NFR-S3 · **Size:** M
**SSoT modules created:** `shared/db/rls-aware-client.js`, `shared/db/service-role-client.js`, `shared/db/tx.js`, `app/src/middleware/rls-context.js`
**Depends on:** Story 1.4
**Enables:** every customer-scoped feature in Epics 4-12

As Pedro (developer/founder),
I want explicit DB client factories distinguishing app-context (RLS-aware via JWT) from worker-context (service-role bypass), with a transaction helper,
So that BAD subagents have one path per context and cannot accidentally use the wrong client.

**Acceptance Criteria:**

**Given** `shared/db/rls-aware-client.js` exports `getRlsAwareClient(jwt)`
**When** the app server receives a request with a valid Supabase Auth session
**Then** the middleware in `app/src/middleware/rls-context.js` extracts the JWT, calls `getRlsAwareClient(jwt)`, and binds the resulting client to `request.db`
**And** every query through `request.db` runs as the JWT subject — RLS policies fire automatically
**And** the service-role key is NEVER reachable from this code path (verify via grep against `app/`)

**Given** `shared/db/service-role-client.js` exports `getServiceRoleClient()`
**When** the worker process boots
**Then** it instantiates a `pg` Pool with `process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL` (or equivalent service-role connection string)
**And** the pool config sets a small max (e.g., `max: 5`) appropriate for MVP scale
**And** the worker can issue raw `pg_try_advisory_lock(<bigint>)` calls (Epic 5 dispatcher requires this)
**And** the service-role client is NEVER instantiated in the app process

**Given** a service-role client and a callback
**When** I call `tx(client, async (txClient) => {...})` from `shared/db/tx.js`
**Then** the helper opens a transaction, runs the callback, commits on success, rolls back on throw
**And** the helper supports nested savepoints if called recursively (or rejects nesting with a clear error — pick one and document)

**Given** an integration test
**When** I run `tests/shared/db/clients.test.js`
**Then** it covers: rls-aware-client returns rows scoped to JWT subject; service-role-client bypasses RLS; tx helper commits on success and rolls back on throw

**Given** ESLint configuration
**When** I write `import { Pool } from 'pg'` directly inside `app/src/`
**Then** ESLint flags it (custom rule: app routes must not instantiate `pg` directly — use `getRlsAwareClient` factory)

---

### Story 2.2: RLS regression suite + CI block
**GH Issue:** #7

**Implements:** AD30 · **FRs:** FR5 · **NFRs:** NFR-S3, NFR-I3 · **Size:** M
**SSoT modules created:** `scripts/rls-regression-suite.js`, `tests/integration/rls-regression.test.js`, `db/seed/test/two-customers.sql`
**Depends on:** Story 1.4 (customers, customer_profiles), Story 1.2 (shop_api_key_vault), Story 2.1
**Enables:** every subsequent customer-scoped table story extends this suite

As Pedro (developer/founder),
I want a regression suite that seeds two customers, attempts every cross-tenant access pattern, and asserts every attempt fails — running on every deploy and blocking on failure —
So that route bugs cannot leak cross-tenant data and the convention "every new customer-scoped table extends the suite" is enforced as a deploy gate from day 1.

**Acceptance Criteria:**

**Given** the seed file `db/seed/test/two-customers.sql`
**When** I apply it to a fresh test Postgres
**Then** two distinct customers exist with their own `customer_profiles` rows AND `shop_api_key_vault` rows

**Given** the regression suite `scripts/rls-regression-suite.js`
**When** I run it
**Then** for every customer-scoped table, the suite (a) authenticates as customer A via JWT, attempts SELECT/INSERT/UPDATE/DELETE on a row owned by customer B identified by ID, asserts 0 rows returned or operation rejected; (b) repeats with customer B's JWT against customer A's rows
**And** the suite covers (at this story): `customers`, `customer_profiles`, `shop_api_key_vault`
**And** the suite is parameterized so subsequent stories add their tables to a single config array — adding a table = one line change

**Given** an `npm run test:rls` script
**When** I run it
**Then** the regression suite executes and reports per-table pass/fail
**And** any failure exits with non-zero code

**Given** a CI configuration (GitHub Actions or Coolify pre-deploy hook)
**When** a PR runs CI or a deploy is triggered
**Then** `npm run test:rls` runs and blocks on failure
**And** the README documents the convention: every new customer-scoped table migration MUST extend the seed AND the suite in the same PR

**Given** the convention
**When** a developer (or BAD subagent) attempts to ship a customer-scoped table without extending the suite
**Then** the integration test for that table will fail with a clear "this table is not in the RLS regression suite" message

---

## Epic 3: Mirakl Integration Foundation

### Story 3.1: Mirakl HTTP client port — apiClient + retry/backoff + safe-error mapping + no-direct-fetch ESLint rule
**GH Issue:** #10

**Implements:** AD5 · **FRs:** (foundation) · **NFRs:** NFR-I1 · **Size:** M
**SSoT modules created:** `shared/mirakl/api-client.js` (`mirAklGet`, `MiraklApiError` class — `mirAklGet` is the only Mirakl HTTP export per AD5; PRI01 multipart submit is handled in `shared/mirakl/pri01-writer.js`, Epic 6, since no other POST endpoints exist in MarketPilot's Mirakl integration), `shared/mirakl/safe-error.js` (`getSafeErrorMessage`), `eslint-rules/no-direct-fetch.js` (custom rule)
**Depends on:** Story 1.1, Story 1.3
**Enables:** Stories 3.2, 3.3; every Mirakl-touching story

As Pedro (developer/founder),
I want the production-tested Mirakl HTTP client from DynamicPriceIdea ported to this repo as a single-source-of-truth module, with retry/backoff + PT-localized safe-error mapping + a custom ESLint rule blocking direct `fetch(` outside this file,
So that every Mirakl call uses one path with one retry policy, one error classification, and one redaction discipline — and BAD subagents cannot accidentally introduce a parallel Mirakl client.

**Acceptance Criteria:**

**Given** `shared/mirakl/api-client.js` exports `mirAklGet(baseUrl, path, params, apiKey)` as the single source of truth for Mirakl HTTP GET (PRI01 multipart POST lives in `shared/mirakl/pri01-writer.js`, Epic 6 — there are no other POST endpoints in MarketPilot's Mirakl integration)
**When** I call `mirAklGet` with a Worten URL + path + apiKey
**Then** the request includes header `Authorization: <apiKey>` (raw — NO `Bearer` prefix; per AD5 + DynamicPriceIdea production confirmation)
**And** the request uses Node's built-in `fetch` (Node ≥22) — no third-party HTTP library
**And** on 429 or 5xx, the client retries up to 5 times with exponential backoff `[1s, 2s, 4s, 8s, 16s]` (max 30s per delay)
**And** transport errors (network timeout, ECONNRESET, etc.) are retryable on the same schedule
**And** 4xx (except 429) is non-retryable — throws `MiraklApiError` immediately

**Given** any error from a Mirakl call
**When** the caller receives a `MiraklApiError`
**Then** the error has `.status` (HTTP status code; 0 for transport), `.code` (program-readable identifier like `WORTEN_API_KEY_INVALID`), `.safeMessagePt` (PT-localized customer-facing string)
**And** the `apiKey` is never present in the error message, the error stack, or the error's serialized form
**And** pino redaction (Story 1.3) applies to any logged error — `Authorization` header values redact to `[REDACTED]`

**Given** `shared/mirakl/safe-error.js` exports `getSafeErrorMessage(err)`
**When** I pass a `MiraklApiError` for a 401 status
**Then** the function returns `"A chave Worten é inválida. Verifica a chave e tenta novamente."` (PT-localized)
**And** for 429 / 5xx after retry exhaustion: `"O Worten está temporariamente indisponível. Vamos tentar novamente em breve."`
**And** for a generic 4xx: `"Pedido recusado pelo Worten. Contacta o suporte se persistir."`
**And** the function NEVER returns the raw upstream error message — every output is from a curated PT lookup

**Given** the custom ESLint rule `eslint-rules/no-direct-fetch.js`
**When** ESLint runs against the codebase
**Then** any `fetch(...)` call OUTSIDE `shared/mirakl/` directory triggers a lint error: *"Direct fetch() forbidden. Use shared/mirakl/api-client.js for GET; PRI01 multipart submit lives in shared/mirakl/pri01-writer.js (Epic 6)."* The directory-level scope allows `api-client.js` and `pri01-writer.js` to share the rule's allowlist without bespoke per-file exceptions.
**And** the rule also flags `import { fetch }` or destructured equivalent
**And** Story 1.1's vanilla ESLint config is updated to load this custom rule
**And** legitimate non-Mirakl fetches (none expected at MVP) require an `// eslint-disable-next-line no-direct-fetch` with justification comment

**Given** unit tests in `tests/shared/mirakl/api-client.test.js`
**When** I run them
**Then** they cover: happy GET path, retry on 429 → succeed on attempt 3, retry exhaustion on 500 → throws MiraklApiError with status=500, immediate throw on 401, transport error retryable, apiKey redaction in error stack
**And** tests run against a Fastify mock server (not the real Worten) using fixture responses

---

### Story 3.2: Endpoint wrappers — A01, PC01, OF21, P11 + Mirakl mock server
**GH Issue:** #11

**Implements:** AD5, AD16 (partial) · **FRs:** (foundation for FR8-FR15, FR20) · **NFRs:** NFR-I1 · **Size:** L
**SSoT modules created:** `shared/mirakl/a01.js`, `shared/mirakl/pc01.js`, `shared/mirakl/of21.js`, `shared/mirakl/p11.js`, `shared/mirakl/self-filter.js`, `tests/mocks/mirakl-server.js`
**Test fixtures:** `tests/fixtures/a01/easy-store-2026-04-30.json`, `tests/fixtures/pc01/worten-2026-04-30.json`, `tests/fixtures/of21/easy-store-test-sku-2026-04-30.json` (seeded from `verification-results.json`)
**Depends on:** Story 3.1
**Enables:** Story 3.3, Story 4.4, Story 7.1

As Pedro (developer/founder),
I want typed wrapper functions for the four Mirakl endpoints we use (A01 account, PC01 platform configuration, OF21 own offers paginated, P11 product offers per-channel), plus a Fastify-based Mirakl mock server seeded from live Worten captures,
So that every endpoint has one calling pattern with one set of return-shape JSDoc typedefs, and tests can replay the empirical responses without hitting Worten.

**Acceptance Criteria:**

**Given** `shared/mirakl/a01.js` exports `getAccount(baseUrl, apiKey)`
**When** I call it
**Then** it returns `{shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels[], domains[]}` (typed via JSDoc `@typedef AccountInfo`)
**And** values come from the Mirakl `GET /api/account` response

**Given** `shared/mirakl/pc01.js` exports `getPlatformConfiguration(baseUrl, apiKey)`
**When** I call it
**Then** it returns the full PC01 response including (at minimum): `channel_pricing` enum (`SINGLE`/`MULTI`/`DISABLED`), `operator_csv_delimiter` (`COMMA`/`SEMICOLON`), `offer_prices_decimals`, `discount_period_required`, `competitive_pricing_tool`, `scheduled_pricing`, `volume_pricing`, `multi_currency`, `order_tax_mode`
**And** the function preserves the entire JSON for `customer_marketplaces.platform_features_snapshot` JSONB storage

**Given** `shared/mirakl/of21.js` exports `getOffers(baseUrl, apiKey, {pageToken?, pageSize?})`
**When** I call it
**Then** it returns an array of offers with `{shop_sku, product_sku, ean, quantity, price, total_price, min_shipping_price, channels[], active}` plus a pageToken for pagination
**And** it iterates pages until exhaustion when called as `getAllOffers(baseUrl, apiKey)` (sibling helper)

**Given** `shared/mirakl/p11.js` exports `getProductOffersByEan(baseUrl, apiKey, {ean, channel, pricingChannelCode})`
**When** I call it for a single EAN + channel pair
**Then** it issues `GET /api/products/offers?product_references=EAN|<ean>&channel_codes=<channel>&pricing_channel_code=<channel>` (per AD7 + empirical confirmation)
**And** it returns the raw offer list (filtering happens in `shared/mirakl/self-filter.js`, Epic 7)
**And** for batch lookups, `getProductOffersByEanBatch(baseUrl, apiKey, {eans, channel})` accepts up to 100 EANs per call (concatenated as `EAN|x,EAN|y,...` per empirical pattern)

**Given** the Mirakl mock server `tests/mocks/mirakl-server.js`
**When** test code starts it on a free port
**Then** the server returns fixture responses for known requests (replays `verification-results.json`-derived JSON)
**And** unknown requests return a deliberate 404 (so tests fail loudly on un-mocked calls)
**And** the server supports configurable failure-injection (e.g., `mockServer.injectError({path, status: 429, count: 2})` for retry-test scenarios)

**Given** unit tests in `tests/shared/mirakl/a01-pc01-of21-p11.test.js`
**When** I run them
**Then** they cover each wrapper against the mock server returning the fixture responses
**And** they assert the parsed return shape matches the JSDoc typedefs
**And** they assert that the wrappers do NOT bypass the api-client (verified by ESLint `no-direct-fetch` rule from Story 3.1)

**Given** `shared/mirakl/self-filter.js` exports `filterCompetitorOffers(rawOffers, ownShopName)`
**When** Story 4.4 (onboarding scan) or Story 7.2 (engine STEP 1) passes a P11 response to it
**Then** it applies the AD13 + AD14 filter chain in this order: `o.active === true` → `Number.isFinite(o.total_price) && o.total_price > 0` → `o.shop_name !== ownShopName` → `.sort((a, b) => a.total_price - b.total_price)` (ascending)
**And** it returns `{filteredOffers: [...], collisionDetected: boolean}` — `collisionDetected` is `true` when more than one offer in the raw list matches `ownShopName` (per AD13 defensive collision check)
**And** unit tests in `tests/shared/mirakl/self-filter.test.js` cover: zero-price-placeholder filtered out, inactive offers filtered out, own-shop filtered out, sort order verified, collision detection signals correctly, empty-after-filter case (caller must handle Tier 3 path)

---

### Story 3.3: mirakl-empirical-verify smoke-test script + reusable for first-customer onboarding
**GH Issue:** #12

**Implements:** AD16 (smoke-test reuse) · **FRs:** (operational tooling consumed by FR9 inline validation + Story 4.4 onboarding orchestration) · **Size:** S
**SSoT modules created:** `scripts/mirakl-empirical-verify.js`
**Depends on:** Story 3.2
**Enables:** Story 4.3 (key entry inline validation reuses lightweight subset), Story 4.4 (full smoke-test before OF21 fan-out)

As Pedro (developer/founder),
I want a standalone CLI script that runs A01 + PC01 + OF21 + P11 against a customer's key and asserts the architectural prerequisites (channel codes valid, operator config matches expectations, P11 returns active offers with `total_price` > 0, etc.),
So that I can verify a customer's environment matches our assumptions BEFORE the full onboarding scan kicks off, and so the same script doubles as my dogfood verification tool against Gabriel's account.

**Acceptance Criteria:**

**Given** `scripts/mirakl-empirical-verify.js`
**When** I run `npm run mirakl:verify` with `.env.local` set to my own (or Gabriel's) Worten credentials
**Then** the script runs in this order: A01 → PC01 → OF21 (first page) → P11 (one EAN per channel) → reports pass/fail per assertion
**And** assertions include:
  - A01 returns `shop_id`, `shop_name`, `currency_iso_code: "EUR"`, `state: "OPEN"`
  - PC01 returns `channel_pricing: SINGLE` (Worten MVP assumption per AD6); aborts onboarding with PT message if DISABLED
  - PC01 returns `operator_csv_delimiter`, `offer_prices_decimals` populated
  - OF21 first page returns ≥1 offer with `shop_sku` populated
  - P11 for a known-good EAN + channel returns offers with `active === true` after filtering, all `total_price > 0` after the placeholder filter
**And** the script writes its output to `verification-results.json` (gitignored)

**Given** the script's reusability for customer onboarding
**When** Story 4.3 (key entry validation) calls into the same code
**Then** the inline-validation path uses a single P11 call against a known-good reference EAN (the lightweight subset of the smoke test) within the 5-second budget per NFR-P6
**And** Story 4.4 (onboarding orchestration) runs the full smoke-test sequence on the freshly-validated key BEFORE kicking off the full catalog scan — fail-loudly if any assertion fails

**Given** the script run produces output
**When** I inspect `verification-results.json`
**Then** it contains: timestamp, masked apiKey hash (NOT the key itself), per-call response status + parsed shape + assertion results
**And** the file is in `.gitignore` (the actual responses contain PII / customer data)

---

## Epic 4: Customer Onboarding

### Story 4.1: customer_marketplaces schema with F4 PROVISIONING + cron_state machine + transitions matrix
**GH Issue:** #13

**Implements:** AD15 (schema + transitions matrix), AD16 (with F4 — PROVISIONING + nullable A01/PC01 + CHECK constraint), AD26 (PC01 capture columns + JSONB snapshot) · **FRs:** FR8 (foundation) · **Size:** L
**SSoT modules created:** `shared/state/cron-state.js` (`transitionCronState`), `shared/state/transitions-matrix.js` (`LEGAL_CRON_TRANSITIONS`)
**Migrations:** `supabase/migrations/202604301203_create_customer_marketplaces.sql`
**Depends on:** Story 1.4, Story 2.1, Story 2.2, Story 9.0 + Story 9.1 (audit foundation — `writeAuditEvent` + `audit_log_event_types` lookup + base partitioned table + priority trigger; ships calendar-early per Option A so `transitionCronState` can emit per-(from,to) events on the very first transition)
**Enables:** Stories 4.2, 4.3, 4.4; Epic 5; Epic 7; Epic 10; Epic 11

**Atomicity bundle:** F4 + onboarding scan ship adjacent (this story is the schema half; Story 4.4 is the population half). Splitting them would leave rows stuck in PROVISIONING forever.

As Pedro (developer/founder),
I want the `customer_marketplaces` table with the cron_state enum (UPPER_SNAKE_CASE), the F4 PROVISIONING state, nullable A01/PC01 columns gated by a CHECK constraint, and a single-source-of-truth `transitionCronState` helper enforcing a legal-transitions matrix,
So that every cron-state mutation is atomic with its audit event and BAD subagents cannot accidentally write `cron_state = 'active'` (lowercase) or skip an illegal transition.

**Acceptance Criteria:**

**Given** the migration `202604301203_create_customer_marketplaces.sql`
**When** I apply it
**Then** the table exists per architecture's full schema: PK uuid, customer_id FK, operator enum (`marketplace_operator` with single value `'WORTEN'` at MVP), marketplace_instance_url, A01 columns (shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels[]) — ALL NULLABLE, PC01 columns (channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals, discount_period_required, competitive_pricing_tool, scheduled_pricing, volume_pricing, multi_currency, order_tax_mode, platform_features_snapshot JSONB, last_pc01_pulled_at) — ALL NULLABLE, engine config columns (max_discount_pct, max_increase_pct DEFAULT 0.0500, edge_step_cents DEFAULT 1, anomaly_threshold_pct, tier_cadence_minutes_override JSONB), cron_state enum DEFAULT `'PROVISIONING'`, cron_state_changed_at, stripe_subscription_item_id, timestamps
**And** the cron_state enum has 8 values UPPER_SNAKE_CASE: `PROVISIONING`, `DRY_RUN`, `ACTIVE`, `PAUSED_BY_CUSTOMER`, `PAUSED_BY_PAYMENT_FAILURE`, `PAUSED_BY_CIRCUIT_BREAKER`, `PAUSED_BY_KEY_REVOKED`, `PAUSED_BY_ACCOUNT_GRACE_PERIOD`
**And** the channel_pricing_mode enum has 3 values: `SINGLE`, `MULTI`, `DISABLED`
**And** the csv_delimiter enum has 2 values: `COMMA`, `SEMICOLON`
**And** the marketplace_operator enum has 1 value at MVP: `WORTEN`

**Given** the F4 CHECK constraint
**When** the migration creates `customer_marketplace_provisioning_completeness`
**Then** the constraint asserts: `cron_state = 'PROVISIONING' OR (all A01 + PC01 + last_pc01_pulled_at columns NOT NULL)`
**And** an INSERT with `cron_state = 'DRY_RUN'` and any A01 or PC01 column NULL fails the CHECK
**And** an INSERT with `cron_state = 'PROVISIONING'` and all A01/PC01 columns NULL succeeds (this is how rows are born during onboarding)
**And** an UPDATE setting `cron_state = 'DRY_RUN'` while any A01/PC01 column is NULL fails the CHECK

**Given** the indexes from architecture's spec
**When** I inspect the schema
**Then** the following indexes exist: `idx_customer_marketplaces_customer_id`, `idx_customer_marketplaces_cron_state_active` (partial: WHERE cron_state = 'ACTIVE'), `idx_customer_marketplaces_last_pc01_pulled_at`
**And** UNIQUE constraint `(customer_id, operator, shop_id)` prevents accidental dup-add

**Given** the RLS policies in the same migration
**When** customer A is logged in
**Then** `SELECT FROM customer_marketplaces WHERE id = <customer_B_marketplace_id>` returns 0 rows
**And** UPDATE/DELETE attempts on customer B's row fail
**And** founder admin via service role can read all rows
**And** `scripts/rls-regression-suite.js` is extended with customer_marketplaces

**Given** `shared/state/transitions-matrix.js` exports `LEGAL_CRON_TRANSITIONS`
**When** I open the file
**Then** it is a JS object literal at the top of the module documenting every legal `(from, to)` transition:
  - `PROVISIONING → DRY_RUN` (scan complete with A01/PC01 populated)
  - `DRY_RUN → ACTIVE` (Go-Live click)
  - `ACTIVE → PAUSED_BY_CUSTOMER` (pause click)
  - `PAUSED_BY_CUSTOMER → ACTIVE` (resume click)
  - `ACTIVE → PAUSED_BY_PAYMENT_FAILURE` (Stripe webhook final-failure)
  - `PAUSED_BY_PAYMENT_FAILURE → ACTIVE` (customer re-enters payment + re-Go-Lives)
  - `ACTIVE → PAUSED_BY_CIRCUIT_BREAKER` (circuit-breaker trip)
  - `PAUSED_BY_CIRCUIT_BREAKER → ACTIVE` (manual unblock)
  - `ACTIVE → PAUSED_BY_KEY_REVOKED` (401 detected)
  - `PAUSED_BY_KEY_REVOKED → ACTIVE` (rotation flow validates new key)
  - `ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD` (deletion initiated)
  - `PAUSED_BY_ACCOUNT_GRACE_PERIOD → DRY_RUN` (cancel-mid-grace; customer must re-enter Stripe per AD21)
**And** the matrix is the single spec, NOT buried in `transitionCronState` conditionals

**Given** `shared/state/cron-state.js` exports `transitionCronState({tx, customerMarketplaceId, from, to, context})`
**When** the helper is called inside an active transaction
**Then** it issues `UPDATE customer_marketplaces SET cron_state = $to, cron_state_changed_at = NOW() WHERE id = $cmId AND cron_state = $from` (optimistic concurrency)
**And** if 0 rows updated → throws `ConcurrentTransitionError`
**And** if `(from, to)` is not in `LEGAL_CRON_TRANSITIONS` → throws `InvalidTransitionError` BEFORE issuing the UPDATE
**And** the helper dispatches to a specific AD20 audit event_type per the `(from, to)` tuple via a static map at the top of `shared/state/cron-state.js`. The map (documented verbatim in the JSDoc of `transitionCronState`) is at minimum:
  - `(ACTIVE, PAUSED_BY_CUSTOMER)` → `customer-paused` (Notável)
  - `(PAUSED_BY_CUSTOMER, ACTIVE)` → `customer-resumed` (Notável)
  - `(ACTIVE, PAUSED_BY_CIRCUIT_BREAKER)` → `circuit-breaker-trip` (Atenção)
  - `(ACTIVE, PAUSED_BY_PAYMENT_FAILURE)` → `payment-failure-pause` (Atenção)
  - `(ACTIVE, PAUSED_BY_KEY_REVOKED)` → `key-validation-fail` (Atenção)
**And** transitions WITHOUT an AD20 counterpart (e.g., `PROVISIONING → DRY_RUN`, `DRY_RUN → ACTIVE` Go-Live click, `ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD`, manual unblocks back to ACTIVE) do NOT emit audit events — the helper writes the state change but emits no event for these tuples
**And** the JSDoc explicitly enumerates which transitions emit and which don't (no inventing of events outside AD20's locked taxonomy)

**Given** unit tests in `tests/shared/state/cron-state.test.js`
**When** I run them
**Then** they cover: legal transition succeeds + emits audit event; illegal transition throws InvalidTransitionError without DB write; concurrent transition throws ConcurrentTransitionError

**Given** the negative-assertion check
**When** I grep for raw `UPDATE customer_marketplaces SET cron_state` SQL
**Then** matches only appear inside `shared/state/cron-state.js`
**And** custom ESLint rule (lands as part of this story) `single-source-of-truth` flags raw cron_state UPDATEs outside this module

---

### Story 4.2: skus + sku_channels + baseline_snapshots + scan_jobs schemas + RLS
**GH Issue:** #14

**Implements:** AD10 (schema only — engine logic Epic 7), AD16 step 4-7 · **FRs:** FR17 (schema), FR25, FR33 · **Size:** M
**SSoT modules created:** (schema-only)
**Migrations:** `supabase/migrations/202604301205_create_skus.sql`, `supabase/migrations/202604301206_create_sku_channels.sql`, `supabase/migrations/202604301207_create_baseline_snapshots.sql`, `supabase/migrations/202604301211_create_scan_jobs.sql`
**Depends on:** Story 4.1
**Enables:** Story 4.4 (populates these), Story 6.x (PRI01 reads sku_channels), Story 7.x (engine state)

**Acceptance Criteria:**

**Given** the migration `202604301205_create_skus.sql`
**When** applied
**Then** `skus` table has columns: id PK, customer_marketplace_id FK CASCADE, ean, shop_sku, product_sku, product_title, **`cost_cents` (integer NULLABLE — Phase 2 reservation)**, **`excluded_at` (timestamptz NULLABLE — Phase 2 reservation)**, timestamps
**And** UNIQUE constraints: `(customer_marketplace_id, ean)` and `(customer_marketplace_id, shop_sku)`
**And** index `idx_skus_customer_marketplace_id_ean`
**And** RLS policy for customer-own access

**Given** the migration `202604301206_create_sku_channels.sql`
**When** applied
**Then** the `tier_value` enum is created with values `'1'`, `'2a'`, `'2b'`, `'3'` (lowercase taxonomic)
**And** `sku_channels` has columns per architecture: id PK, sku_id FK CASCADE, customer_marketplace_id FK CASCADE, channel_code, list_price_cents (integer NOT NULL), last_set_price_cents (nullable), current_price_cents (nullable), pending_set_price_cents (nullable), pending_import_id (text nullable), tier (tier_value NOT NULL), tier_cadence_minutes (smallint NOT NULL), last_won_at (nullable), last_checked_at (NOT NULL), last_set_at (nullable), frozen_for_anomaly_review (boolean NOT NULL DEFAULT false), frozen_at (nullable), frozen_deviation_pct (nullable), min_shipping_price_cents (nullable), min_shipping_zone (nullable), min_shipping_type (nullable), channel_active_for_offer (boolean NOT NULL DEFAULT true), timestamps
**And** UNIQUE constraint `(sku_id, channel_code)`
**And** dispatcher hot-path index `idx_sku_channels_dispatch` (composite with WHERE `pending_import_id IS NULL AND frozen_for_anomaly_review = false AND excluded_at IS NULL`)
**And** indexes `idx_sku_channels_tier`, `idx_sku_channels_pending_import_id`
**And** RLS policy

**Given** the migration `202604301207_create_baseline_snapshots.sql`
**When** applied
**Then** the table holds the pre-tool snapshot: id PK, sku_channel_id FK CASCADE, customer_marketplace_id FK CASCADE, list_price_cents NOT NULL, current_price_cents NOT NULL, captured_at
**And** index on sku_channel_id
**And** RLS policy

**Given** the migration `202604301211_create_scan_jobs.sql`
**When** applied
**Then** `scan_jobs` table has: id PK, customer_marketplace_id FK CASCADE, status (`scan_job_status` enum with 9 values: PENDING, RUNNING_A01, RUNNING_PC01, RUNNING_OF21, RUNNING_P11, CLASSIFYING_TIERS, SNAPSHOTTING_BASELINE, COMPLETE, FAILED), phase_message (PT-localized; default `'A iniciar análise…'`), skus_total, skus_processed (NOT NULL DEFAULT 0), failure_reason, started_at, completed_at
**And** EXCLUDE constraint enforces "one active scan per marketplace" (`status NOT IN ('COMPLETE', 'FAILED')`)
**And** RLS policy

**Given** the RLS regression suite extension
**When** I extend `scripts/rls-regression-suite.js` with these four tables
**Then** the suite asserts customer A cannot read/write customer B's `skus`, `sku_channels`, `baseline_snapshots`, `scan_jobs` rows
**And** the seed data adds at least one row per table per customer

---

### Story 4.3: Key entry form `/onboarding/key` + inline 5s validation + encrypted persistence + Worten-key one-page guide modal
**GH Issue:** #15

**Implements:** AD3 (vault wiring — module landed Story 1.2), AD16 step 1, UX-DR23 · **FRs:** FR8, FR9, FR10, FR11 (vault wiring) · **NFRs:** NFR-P6 · **Size:** L
**SSoT modules created:** `app/src/routes/onboarding/key.js`, `app/src/views/pages/onboarding-key.eta`, `app/src/views/modals/key-help.eta`, `app/src/views/components/trust-block.eta`
**Depends on:** Story 1.2, Story 1.4, Story 3.1, Story 3.3, Story 4.1
**Enables:** Story 4.4
**Visual reference pattern:** **A** — `_bmad-output/design-references/screens/16-onboarding-key-help.html` (Worten-key one-pager modal stub with verified PT walkthrough copy + redacted screenshots inline, delivered 2026-04-30 against live Worten flow). The `/onboarding/key` form surface itself is also Pattern A (stubbed in `screens/<NN>-onboarding-key.html` per the screen→stub mapping appendix in Step 4).

**Acceptance Criteria:**

**Given** the route `app/src/routes/onboarding/key.js` and template `onboarding-key.eta`
**When** an authenticated customer (with no existing customer_marketplace row OR a row in PROVISIONING with no validated key) lands on `GET /onboarding/key`
**Then** the page renders with a single-purpose API key input, the trust block (UX-DR23) below it, a "Como gerar a chave?" link opening the modal, and a "Validar chave" button (disabled until input non-empty)

**Given** the trust block per UX-DR23 (component `app/src/views/components/trust-block.eta`)
**When** rendered
**Then** it carries the lock icon (`lock` filled, var(--mp-win)), green-edged box, the verbatim PT copy from UX skeleton §5.1: *"A tua chave fica **encriptada em repouso**. Apenas o motor de repricing a usa para falar com o Worten — nem o nosso fundador a vê em texto puro."* + the "Ver as nossas garantias →" link to `/security` modal stub

**Given** the customer pastes a key and clicks Validar
**When** the form posts to `POST /onboarding/key/validate`
**Then** the route runs ONE P11 call against a known-good reference EAN via `shared/mirakl/p11.js` (Story 3.2) within a 5-second timeout
**And** the spinner shows label `"A validar a tua chave..."`
**And** on success: the key is encrypted via `shared/crypto/envelope.js` (Story 1.2), persisted as a new `shop_api_key_vault` row, AND a new `customer_marketplaces` row is created with `cron_state = 'PROVISIONING'`, `operator = 'WORTEN'`, `marketplace_instance_url = 'https://marketplace.worten.pt'`, A01/PC01 columns NULL (CHECK constraint allows because PROVISIONING)
**And** on failure (401): inline red error in `onboarding-key.eta` with PT-localized message from `getSafeErrorMessage` (Story 3.1)
**And** on network/transport error: inline retry CTA with PT-localized message
**And** the cleartext key is never logged (verified by integration test grep through pino output)

**Given** validation succeeds
**When** the route completes
**Then** the customer is redirected to `/onboarding/scan` (Story 4.4 picks up scan_jobs row)
**And** `shop_api_key_vault.last_validated_at` is set to NOW() — this timestamp is the customer-visible signal of successful validation; NO audit event is emitted because `KEY_VALIDATED` is not in AD20's locked taxonomy. Customer surfaces (Story 5.2 settings/key vault status pill) read `last_validated_at` directly

**Given** the customer clicks "Como gerar a chave?"
**When** the modal `app/src/views/modals/key-help.eta` opens
**Then** it shows the one-page guide content (FR10) walking through Worten Seller Center → Account → API in 3 screenshots (image assets in `public/images/key-guide/*`)
**And** the modal closes via Escape key OR "Fechar" button
**And** keyboard navigation works without mouse (NFR-A2)

**Given** an integration test
**When** I run `tests/integration/key-entry.test.js`
**Then** it covers: valid key → encrypted vault row created + customer_marketplace row in PROVISIONING + redirect to /onboarding/scan; invalid key (401 from mock Worten) → inline error + no vault row created; 5-second-timeout → inline retry CTA; cleartext key never appears in pino output

**Given** the Pattern A visual reference is `screens/16-onboarding-key-help.html`
**When** Story 4.3 is implemented
**Then** before being considered shippable to the first paying customer, Pedro signs off on the rendered output of the `/onboarding/key` page + "Como gerar?" modal against the stub
**And** the sign-off is recorded as a comment on the merged PR or in `_bmad-output/sign-offs/story-4.3.md`
**And** any visual deviations from the stub are either fixed or documented as accepted deviations with rationale (the stub is the binding visual target, NOT a suggestion)

---

### Story 4.4: Async catalog scan orchestration — A01 → PC01 → OF21 → P11 → tier classify → baseline (atomicity sibling of Story 4.1)
**GH Issue:** #16

**Implements:** AD16 (full sequence), AD26 (PC01 capture), F4 (transitions out of PROVISIONING) · **FRs:** FR12, FR14, FR17 (population), FR25 (per-channel population) · **NFRs:** NFR-P10, NFR-Sc2 · **Size:** L
**SSoT modules created:** `worker/src/jobs/onboarding-scan.js`, `worker/src/lib/tier-classify.js` (initial classification only — engine logic Epic 7)
**Depends on:** Story 3.2, Story 3.3, Story 4.1, Story 4.2, Story 4.3
**Enables:** Story 4.5, Story 4.7; Epic 5 (dispatcher)

**Atomicity bundle (with Story 4.1):** F4 + onboarding scan ship adjacent. The CHECK constraint blocks transition out of PROVISIONING until A01/PC01 populate; this story populates them. Without 4.4, rows from 4.3 stay in PROVISIONING forever.

**Acceptance Criteria:**

**Given** a customer_marketplaces row in PROVISIONING with a freshly-validated encrypted key in `shop_api_key_vault`
**When** the worker process picks up a `scan_jobs` row in PENDING status (created by Story 4.3 redirect)
**Then** `worker/src/jobs/onboarding-scan.js` orchestrates this sequence:
  1. Decrypt the customer's key via `shared/crypto/envelope.js` (key in process memory only; never written to logs)
  2. **Smoke-test reuse:** call `scripts/mirakl-empirical-verify.js` programmatically against the customer's key — if any assertion fails, transition `scan_jobs.status = FAILED`, persist `failure_reason`, send Story 4.6's failure email
  3. Status `RUNNING_A01`: call `getAccount` (Story 3.2), persist shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels[] to customer_marketplaces
  4. Status `RUNNING_PC01`: call `getPlatformConfiguration`, persist channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals, discount_period_required, competitive_pricing_tool, scheduled_pricing, volume_pricing, multi_currency, order_tax_mode, platform_features_snapshot (full JSONB), last_pc01_pulled_at = NOW()
  5. **Abort if** `channel_pricing_mode = DISABLED` — transition scan_jobs to FAILED with PT-localized failure_reason
  6. Status `RUNNING_OF21`: paginate `getOffers` and bulk-load skus + sku_channels rows (one per (SKU, channel) the offer is sellable on; channel_active_for_offer=true). Track `scan_jobs.skus_total` and `skus_processed`
  7. Status `RUNNING_P11`: for each EAN, batch 100 EANs per call, 2 calls per channel (PT and ES if both active); apply `shared/mirakl/self-filter.js` (Story 3.2) post-fetch — filter chain `active === true && total_price > 0 && shop_name !== ownShopName`, sort ascending by total_price; collision detection per AD13 (>1 offer matching ownShopName → emit `shop-name-collision-detected` Atenção event + skip cycle for that SKU)
  8. Status `CLASSIFYING_TIERS`: assign each sku_channel row to T1/T2a/T2b/T3 per AD10's rules (winning SKUs land T2a with `last_won_at = NOW()` since no win history exists at scan time); assign tier_cadence_minutes per AD10 defaults
  9. Status `SNAPSHOTTING_BASELINE`: copy `current_price_cents → list_price_cents` for every sku_channel; persist `baseline_snapshots` row per (SKU, channel)
  10. Status `COMPLETE`: call `transitionCronState` (PROVISIONING → DRY_RUN); CHECK constraint passes because A01/PC01 columns are now populated

**Given** any step in the orchestrator throws
**When** the failure is caught
**Then** scan_jobs.status → FAILED, failure_reason persisted, email sent (Story 4.6)
**And** the customer_marketplaces row stays in PROVISIONING (CHECK constraint blocks transition since A01/PC01 columns may be partially populated)
**And** customer can re-validate key + re-trigger scan (idempotent — scan_jobs EXCLUDE constraint allows new scan once previous is COMPLETE/FAILED)

**Given** the scan is in-flight
**When** Story 4.5's progress page polls `GET /onboarding/scan/status`
**Then** it returns `{status, phase_message, skus_total, skus_processed}`
**And** phase_message is PT-localized per UX-DR6: "A configurar integração com Worten" (A01+PC01), "A obter catálogo" (OF21), "A snapshotar baselines" (P11+classify), "A classificar tiers iniciais", "Pronto"

**Given** scan throughput
**When** the scan runs against a 50k-SKU catalog (test scenario)
**Then** target: complete within 4 hours (NFR-P10)
**And** if the scan exceeds 8 hours, the worker logs a warning + emits an Atenção audit event

**Given** an integration test
**When** I run `tests/integration/onboarding-scan.test.js` against the Mirakl mock server seeded with 200-SKU fixture data
**Then** the orchestrator runs through all 9 phases, populates customer_marketplaces + skus + sku_channels + baseline_snapshots, transitions to DRY_RUN, completes within a generous test timeout (60s for 200 SKUs)
**And** the test asserts no cleartext key appears in pino output, no parallel scan_jobs row exists, the CHECK constraint never violated, and PRI02 is never called (read-only)

---

### Story 4.5: Scan progress page `/onboarding/scan` — closeable + reconnectable + status polling
**GH Issue:** #17

**Implements:** AD16 (UX), UX-DR6 · **FRs:** FR13, FR14 · **Size:** M
**SSoT modules created:** `app/src/routes/onboarding/scan.js`, `app/src/views/pages/onboarding-scan.eta`, `public/js/scan-progress.js`
**Depends on:** Story 4.4
**Enables:** Story 4.6, Story 4.7
**Visual reference pattern:** **B** — UX skeleton §3.3 ProgressScreen + visual fallback `_bmad-output/design-references/bundle/project/MarketPilot.html` ProgressScreen pattern (radial progress glyph + shimmer bar + 5-phase checklist per UX-DR6 + AD16 Pass-2 UX delta). No dedicated screens/ stub; downstream Claude Design pass can produce one if needed.

**Acceptance Criteria:**

**Given** the route `GET /onboarding/scan`
**When** a customer with an in-flight scan_jobs row visits
**Then** the page renders with: 5-phase progress (UX-DR6 labels + prepended "A configurar integração com Worten" phase per architecture AD16 Pass-2 UX delta covering A01 + PC01), shimmer bar showing skus_processed/skus_total, current `phase_message`
**And** `public/js/scan-progress.js` polls `GET /onboarding/scan/status` every 1 second
**And** on `status: COMPLETE` → redirects to `/onboarding/scan-ready`
**And** on `status: FAILED` → redirects to `/scan-failed` (Story 4.6)
**And** the page is closeable — closing the tab does NOT abort the scan; reopening returns to live progress

**Given** the disconnected/reconnected case
**When** a customer closes the tab during RUNNING_OF21 and reopens 30 minutes later (scan still running)
**Then** the same progress page renders showing live progress at whatever phase the scan is now in
**And** the polling resumes immediately

**Given** the route handler
**When** `GET /onboarding/scan/status` is called
**Then** it returns JSON `{status, phase_message, skus_total, skus_processed, started_at, completed_at}`
**And** the endpoint is RLS-aware (customer can only read their own scan_jobs row)
**And** the endpoint is rate-limited via `@fastify/rate-limit` to 5 req/sec per customer

**Given** a customer attempts to access `/onboarding/scan` with no in-flight scan_jobs row
**When** the route loads
**Then** it redirects to the appropriate state — `/onboarding/key` if no key, `/onboarding/scan-ready` if scan COMPLETE, `/scan-failed` if FAILED
**And** UX-DR2 (strictly forward state machine) is honored

---

### Story 4.6: Scan-failed email + `/scan-failed` interception
**GH Issue:** #18

**Implements:** AD16 (failure handling), UX-DR3 · **FRs:** FR15 · **Size:** S
**SSoT modules created:** `shared/resend/client.js` (`sendCriticalAlert({to, subject, html})` — minimal canonical interface), `app/src/routes/interceptions/scan-failed.js`, `app/src/views/pages/scan-failed.eta`, `app/src/views/emails/scan-failed.eta`
**Depends on:** Story 4.4
**SSoT discipline:** Story 4.6 ships the minimal `shared/resend/client.js` as the single canonical interface from day one — Epic 12 (Story 12.3) extends this module with PT-localized templates, delivery monitoring, and redaction-aware logging. NO parallel implementation, NO later refactor.
**Enables:** customer recovers via re-validation
**Visual reference pattern:** **A** — `/scan-failed` interception page stubbed at `_bmad-output/design-references/screens/<NN>-scan-failed.html` per the screen→stub mapping appendix; email template rendered from `app/src/views/emails/scan-failed.eta` follows visual-DNA tokens (no separate stub for transactional emails).

**Acceptance Criteria:**

**Given** scan_jobs.status transitions to FAILED
**When** the worker writes the FAILED status
**Then** within ≤5 minutes (NFR-P9), the customer receives a PT-localized email via `shared/resend/client.js`'s `sendCriticalAlert({to, subject, html})` — html rendered from `app/src/views/emails/scan-failed.eta`
**And** the email subject: *"A análise do teu catálogo MarketPilot não conseguiu completar"*
**And** the body explains the failure reason + provides a link to `/onboarding/key` for re-validation

**Given** a customer with a FAILED scan_jobs row logs in to dashboard
**When** the auth landing logic runs (UX-DR3)
**Then** it overrides `/` with `/scan-failed` interception
**And** the page renders with the failure reason + "Tentar novamente →" button leading to `/onboarding/key` rotation flow
**And** the page is keyboard-accessible (NFR-A2)

**Given** a healthy scan completion
**When** the orchestrator transitions to COMPLETE
**Then** NO email is sent (per FR15 — only failure triggers email)
**And** the customer logs back in to find populated dashboard

---

### Story 4.7: Scan-ready interstitial `/onboarding/scan-ready` (UX-DR33-34)
**GH Issue:** #21

**Implements:** UX-DR33, UX-DR34 · **FRs:** FR16 (gateway to margin question) · **Size:** S
**SSoT modules created:** `app/src/routes/onboarding/scan-ready.js`, `app/src/views/pages/onboarding-scan-ready.eta`
**Depends on:** Story 4.4
**Enables:** Story 4.8
**Visual reference pattern:** **A** — `/onboarding/scan-ready` stubbed at `_bmad-output/design-references/screens/<NN>-onboarding-scan-ready.html` per the screen→stub mapping appendix.

**Acceptance Criteria:**

**Given** a customer with cron_state = DRY_RUN and scan_jobs status = COMPLETE
**When** they hit `/onboarding/scan-ready`
**Then** the page renders with the count summary per UX-DR33 layout:
  - "X produtos encontrados no Worten" (total OF21 SKUs)
  - "Y prontos para repricing" (sku_channels rows with tier IN (1, 2a, 2b))
  - "Z sem competidores (Tier 3 — vamos monitorizar)" (tier = 3)
  - "W sem EAN no Worten — ignorados" (OF21 SKUs without EAN — counted but no sku_channels row)
**And** counts come from queries against the populated tables, NOT placeholders

**Given** the "porquê?" disclosure (UX-DR34)
**When** the customer clicks it
**Then** the inline disclosure expands with verbatim copy from UX skeleton §8.3:
  > *"Produtos refurbished e listings privados não têm EAN partilhado no Worten — não conseguimos ver competidores no mesmo produto. Ficam fora do scope do repricing automático. Isto é estrutural ao Worten, não uma limitação da MarketPilot."*

**Given** the "Continuar →" button
**When** clicked
**Then** the customer is redirected to `/onboarding/margin` (Story 4.8)

**Given** UX-DR2 (strictly-forward state machine)
**When** a customer with cron_state = DRY_RUN tries to skip back to `/onboarding/scan`
**Then** they're redirected to `/onboarding/scan-ready`

---

### Story 4.8: Margin question `/onboarding/margin` + smart-default mapping + <5% warning
**GH Issue:** #63

**Implements:** AD16 (final onboarding step), UX-DR2 · **FRs:** FR16 · **Size:** M
**SSoT modules created:** `app/src/routes/onboarding/margin.js`, `app/src/views/pages/onboarding-margin.eta`, `app/src/views/components/smart-default-warning-thin-margin.eta`
**Depends on:** Story 4.7, Story 4.1 (max_discount_pct + max_increase_pct columns)
**Enables:** Story 4.9
**Visual reference pattern:** **B** — UX skeleton §3.3 + visual-DNA tokens (4 radio bands + inline §9.10 callout for `<5%`). Downstream Claude Design pass produces a dedicated stub if visual tension surfaces; otherwise the skeleton + tokens suffice.

**Acceptance Criteria:**

**Given** the route `GET /onboarding/margin`
**When** a customer with cron_state = DRY_RUN and a populated catalog visits
**Then** the page renders the band picker with 4 options (radio): `<5%`, `5-10%`, `10-15%`, `15%+`
**And** the page is PT-localized

**Given** the customer picks `<5%`
**When** the choice is made (client-side reactive)
**Then** an inline warning callout appears (UX skeleton §9.10): yellow-edged box, info icon, full PT copy verbatim including the 3 bulleted recommendations and "Compreendo e continuo" acknowledgement button (must click before submit)

**Given** the customer submits
**When** `POST /onboarding/margin` runs
**Then** the route persists `customer_marketplaces.max_discount_pct` per smart-default mapping:
  - `<5%` → 0.005 (0.5%)
  - `5-10%` → 0.01 (1%)
  - `10-15%` → 0.02 (2%)
  - `15%+` → 0.03 (3%)
**And** `max_increase_pct = 0.05` (5% global default)
**And** redirects to `/`

**Given** UX-DR2 (strictly-forward)
**When** a customer with margin already set tries to revisit `/onboarding/margin`
**Then** they're redirected to `/`

---

### Story 4.9: Dashboard root in DRY_RUN — minimal landing only
**GH Issue:** #20

**Implements:** UX-DR3, UX-DR13 (KPI card visual treatment but no full dashboard yet) · **FRs:** FR30 partial · **Size:** S
**SSoT modules created:** `app/src/routes/dashboard/index.js` (minimal — full page Epic 8), `app/src/views/pages/dashboard-dry-run-minimal.eta`
**Depends on:** Story 4.8
**Enables:** Epic 5 dispatcher reads from a working customer_marketplaces row; Epic 8 expands this stub
**Visual reference pattern:** **A** — minimal landing in DRY_RUN state stubbed at `_bmad-output/design-references/screens/<NN>-dashboard-dry-run-minimal.html`; Epic 8 stories ship the full state-aware dashboard with separate stubs per state (healthy live, paused-by-customer, paused-by-payment, anomaly attention, circuit-breaker, sustained transient).

**Acceptance Criteria:**

**Given** a customer with cron_state = DRY_RUN
**When** they visit `/`
**Then** the page renders the dry-run banner per UX skeleton §9.5: blue, science icon, full PT copy verbatim
**And** the page shows a single KPI card stub ("3 status cards visuals coming in Epic 8") — explicit placeholder text is acceptable at MVP
**And** the page links to `/audit` (audit log will populate as cycles run)
**And** there is NO Go-Live button at this stage (Go-Live ships in Epic 8)

**Given** a customer with cron_state = PROVISIONING
**When** they visit `/`
**Then** they're redirected to `/onboarding/scan` (UX-DR2 forward-only)

---

## Epic 5: Cron Dispatcher & State Machine

### Story 5.1: Master cron + dispatcher SQL + per-customer advisory locks + `worker-must-filter-by-customer` ESLint rule
**GH Issue:** #24

**Implements:** AD17 · **FRs:** FR18 · **NFRs:** NFR-Sc3, NFR-P1, NFR-P2 · **Size:** L
**SSoT modules created:** `worker/src/dispatcher.js`, `worker/src/advisory-lock.js`, `worker/src/jobs/master-cron.js`, `eslint-rules/worker-must-filter-by-customer.js`
**Depends on:** Story 1.1 (worker scaffold), Story 2.1 (service-role-client + tx helper), Story 4.1 (cron_state + customer_marketplaces), Story 4.2 (sku_channels + dispatcher hot-path index), Story 9.0 + Story 9.1 (audit foundation for `cycle-start` / `cycle-end` Rotina events, calendar-early per Option A)
**Enables:** Story 5.2; every subsequent worker logic story; Epic 7 (engine consumed by dispatcher)

As Pedro (developer/founder),
I want a master cron + dispatcher that selects work via the SQL predicate from architecture AD17, acquires per-customer advisory locks for parallelism, and a custom ESLint rule that flags any worker query missing a `customer_marketplace_id` filter,
So that background work runs reliably with horizontal-scale primitives in place from day 1, and BAD subagents writing future worker queries cannot accidentally cross tenants.

**Acceptance Criteria:**

**Given** `worker/src/jobs/master-cron.js` registered with `node-cron` at the worker process boot (Story 1.1's worker entry imports + starts it)
**When** the cron tick fires (every 5 minutes, `*/5 * * * *`)
**Then** it calls `worker/src/dispatcher.js`'s exported `dispatchCycle()` function
**And** the dispatcher logs cycle-start at `info` level via pino with `cycle_id` (UUID minted at dispatch time)
**And** if a previous tick is still running, the new tick is skipped (`node-cron`'s built-in concurrency guard) — verify by injecting a 6-minute synthetic delay and asserting only one `cycle-start` log per 5-minute window

**Given** the dispatcher's selection SQL
**When** it queries for work
**Then** the query is exactly (architecture AD17 verbatim, parameterized):
```sql
SELECT cm.id, sc.id AS sku_channel_id, sc.sku_id, sc.channel_code
  FROM customer_marketplaces cm
  JOIN sku_channels sc ON sc.customer_marketplace_id = cm.id
 WHERE cm.cron_state = 'ACTIVE'
   AND sc.frozen_for_anomaly_review = false
   AND sc.pending_import_id IS NULL
   AND sc.excluded_at IS NULL
   AND sc.last_checked_at + (sc.tier_cadence_minutes * INTERVAL '1 minute') < NOW()
 ORDER BY cm.id, sc.last_checked_at ASC
 LIMIT $1;
```
**And** the index `idx_sku_channels_dispatch` (Story 4.2) is hit per `EXPLAIN ANALYZE` on a seeded test catalog
**And** `$1` (batch_size) is configurable via env var with a sensible default (e.g., 1000) — calibrate during dogfood

**Given** `worker/src/advisory-lock.js` exports `tryAcquireCustomerLock(client, customerMarketplaceId)` and `releaseCustomerLock(client, customerMarketplaceId)`
**When** the dispatcher iterates the SELECT result grouped by `customer_marketplace_id`
**Then** for each group it calls `pg_try_advisory_lock(<bigint derived from customerMarketplaceId>)` first; if returns false → skip that customer's batch this tick
**And** if returns true → process the customer's SKUs, then release the lock at end-of-batch (or rely on session-scope auto-release on worker crash)
**And** the bigint derivation from a UUID is deterministic (e.g., hash the UUID's first 8 bytes as bigint) — same UUID always maps to same bigint
**And** unit tests cover: lock acquired succeeds; lock held by other worker → skipped; auto-release on session close

**Given** `eslint-rules/worker-must-filter-by-customer.js`
**When** ESLint runs against `worker/src/`
**Then** any query call (e.g., `client.query('SELECT ... FROM sku_channels ...', ...)` OR `client.from('sku_channels')...`) without a `customer_marketplace_id = $N` (raw SQL) or `.eq('customer_marketplace_id', ...)` (Supabase client) clause triggers a lint error: *"Worker queries on customer-scoped tables must filter by customer_marketplace_id (RLS is bypassed in worker context). Add the filter, or annotate with `// safe: cross-customer cron` if the query is deliberately cross-customer."*
**And** the rule applies to: `sku_channels`, `audit_log`, `baseline_snapshots`, `pri01_staging`, `cycle_summaries`, `daily_kpi_snapshots`, `scan_jobs`, `customer_marketplaces`, `customer_profiles` (when worker reads these — uncommon but possible)
**And** an explicit comment escape-hatch (`// safe: cross-customer cron`) on the line above the query suppresses the rule for legitimate cross-customer queries (e.g., the dispatcher's initial SELECT iterating all ACTIVE customers)
**And** Story 1.1's ESLint config is updated to load this rule

**Given** the dispatcher in operation
**When** a cycle completes
**Then** it logs cycle-end with stats: customers processed, SKUs evaluated, decisions emitted, duration
**And** it writes a `cycle_summaries` row (schema lands in Epic 9 — for now, omit if Epic 9 hasn't shipped, but write to a stub helper that will be consumed when 9.x lands)
**And** `cycle-start` and `cycle-end` audit events emit via `writeAuditEvent` per AD20 Rotina taxonomy

**Given** stale-lock handling
**When** a worker process crashes mid-cycle while holding advisory locks
**Then** the locks are auto-released by Postgres on session-close — no manual cleanup needed (per AD17)
**And** the next cron tick acquires the locks freshly and resumes work for those customers
**And** there is no `worker_locks` table or row-based pseudo-mutex anywhere in the codebase (negative assertion — distinguishes from Gabriel project's pattern)

---

### Story 5.2: pri01_staging schema + cycle-assembly skeleton
**GH Issue:** #25

**Implements:** AD17 (cycle assembly + staging table flush), AD11 partial (per-cycle CB gate placeholder for Epic 7) · **FRs:** FR18 partial · **Size:** M
**SSoT modules created:** `worker/src/cycle-assembly.js`
**Migrations:** `supabase/migrations/202604301214_create_pri01_staging.sql`
**Depends on:** Story 5.1, Story 9.0 + Story 9.1 (audit foundation for staging-flush events, calendar-early per Option A)
**Enables:** Story 6.1 (writer reads from staging), Story 7.2+ (engine writes decisions to staging via cycle-assembly)

As Pedro (developer/founder),
I want the per-cycle staging table created and a cycle-assembly skeleton that the engine in Epic 7 will populate,
So that the writer in Epic 6 has a stable consumer-side contract and the engine integration in Epic 7 just plugs in.

**Acceptance Criteria:**

**Given** the migration `202604301214_create_pri01_staging.sql`
**When** I apply it
**Then** `pri01_staging` table has columns per architecture: id PK, customer_marketplace_id FK CASCADE, sku_id FK CASCADE, channel_code, new_price_cents (integer NOT NULL), cycle_id (uuid NOT NULL), staged_at, flushed_at (nullable — set when PRI01 submitted), import_id (text nullable — set when PRI01 returns import_id)
**And** indexes: `idx_pri01_staging_cycle ON pri01_staging(cycle_id)`, `idx_pri01_staging_sku_unflushed ON pri01_staging(sku_id) WHERE flushed_at IS NULL`
**And** RLS policy for customer-own access via customer_marketplace_id chain
**And** `scripts/rls-regression-suite.js` extended with pri01_staging cross-tenant assertion

**Given** `worker/src/cycle-assembly.js` exports `assembleCycle(tx, customerMarketplaceId, skuChannels, cycleId)`
**When** the dispatcher calls it for a customer's batch of SKU-channels in a cycle
**Then** the function (skeleton at this story; engine logic in Epic 7) iterates the SKU-channels and calls a stub engine function (`worker/src/engine/decide.js` exists from Epic 7 dependency; if not yet shipped, this story imports a no-op stub that returns `{action: 'HOLD', auditEvents: ['hold-already-in-1st']}`)
**And** when the engine returns an action ∈ {UNDERCUT, CEILING_RAISE}, cycle-assembly INSERTs a `pri01_staging` row with the cycle_id and new_price_cents
**And** when the engine returns HOLD, cycle-assembly emits the audit event but does NOT stage a write
**And** at the end of the customer's batch, cycle-assembly calls a per-cycle circuit-breaker check stub (Story 7.6 fills it in); for now, just logs the staged count

**Given** unit tests in `tests/worker/cycle-assembly.test.js`
**When** I run them
**Then** they cover: staging row insertion on UNDERCUT/CEILING_RAISE; no insertion on HOLD; cycle_id propagation; audit event emission per decision
**And** the tests use a mock engine returning predetermined decisions (no real engine logic exercised at this story)

---

## Epic 6: PRI01 Writer Plumbing

### Story 6.1: `shared/mirakl/pri01-writer.js` — per-SKU aggregation + multipart submit + pending_import_id atomicity + `no-raw-CSV-building` ESLint rule
**GH Issue:** #22

**Implements:** AD7 (writer half) · **FRs:** FR23 (writer) · **NFRs:** NFR-P5 partial · **Size:** L
**SSoT modules created:** `shared/mirakl/pri01-writer.js` (`buildPri01Csv`, `submitPriceImport`, `markStagingPending`), `eslint-rules/no-raw-CSV-building.js`
**Test fixtures:** `tests/fixtures/pri01-csv/single-channel-undercut.csv`, `tests/fixtures/pri01-csv/multi-channel-passthrough.csv`, `tests/fixtures/pri01-csv/pri03-recovery-resubmit.csv`
**Depends on:** Story 3.1 (api-client patterns + ESLint scope), Story 4.1 (`customer_marketplaces.operator_csv_delimiter` + `offer_prices_decimals`), Story 4.2 (`sku_channels.pending_import_id`), Story 5.2 (`pri01_staging` table), Story 9.0 + Story 9.1 (audit foundation for `pri01-submit` event, calendar-early per Option A)
**Enables:** Story 6.2 (PRI02 poller), Story 7.x (engine writes staging which writer flushes), Story 7.8 (atomicity-bundle integration gate)

**Atomicity bundle:** AD7 ships in this story; the bundle's integration-test gate sits at end of Epic 7 (Story 7.8). Epic 6 ships the writer with unit tests + golden-file CSVs; Epic 7 ships the gate that exercises engine + writer + absorption + circuit-breaker on all 17 P11 fixtures.

As Pedro (developer/founder),
I want a single-source-of-truth PRI01 writer that aggregates staging rows per SKU, builds the CSV with operator-config-driven delimiter and decimals, performs the multipart POST, and atomically marks all participating sku_channel rows with the import_id,
So that no parallel CSV-building or PRI01-submission code can exist in the codebase, and the pending_import_id invariant chain stays intact through engine STEP 1 (skip-on-pending) + cooperative-absorption + PRI02 COMPLETE (clears atomically).

**Acceptance Criteria:**

**Given** `buildPri01Csv({skuChannels, operatorCsvDelimiter, offerPricesDecimals})`
**When** I pass a list of sku_channel rows for ONE SKU (mixed: some with new prices from staging, some passthroughs at last_set_price_cents)
**Then** the function returns a CSV string with header row `offer-sku<DELIM>price<DELIM>channels` and one body line per active channel for that SKU
**And** the delimiter is read from the input `operatorCsvDelimiter` parameter (`SEMICOLON` → `;`, `COMMA` → `,`); if the parameter is null or undefined, the function throws a clear error — NEVER falls back to a default
**And** the price column is formatted with the input `offerPricesDecimals` (e.g., `2` → `1799` cents → `17.99` with ASCII period decimal separator at MVP — calibrate during dogfood per architecture if Worten requires comma)
**And** the offerPricesDecimals parameter likewise throws on null
**And** the channels column is pipe-separated channel codes for that line's channels (e.g., `WRT_PT_ONLINE`); empty if default-channel pricing
**And** the offer-sku value is `sku.shop_sku` (NOT product_sku — empirical confirmation from architecture)
**And** untouched channels appear as passthrough lines with their `last_set_price_cents` so they're not deleted (PRI01 delete-and-replace semantic)
**And** golden-file fixture `tests/fixtures/pri01-csv/single-channel-undercut.csv` matches the byte-exact output for a single-channel SKU; `multi-channel-passthrough.csv` matches a 2-channel SKU where only PT changes; `pri03-recovery-resubmit.csv` matches a per-SKU rebuild after PRI03 partial failure

**Given** `submitPriceImport(baseUrl, apiKey, csvBody)`
**When** called
**Then** it issues a multipart POST to `<baseUrl>/api/offers/pricing/imports` with the CSV body as a multipart file part
**And** it uses Node's built-in `fetch` directly (allowed in `shared/mirakl/` per Story 3.1's directory-scoped `no-direct-fetch` rule)
**And** it includes `Authorization: <apiKey>` header (raw, NO Bearer prefix — same pattern as `mirAklGet`)
**And** retry/backoff matches `mirAklGet`'s pattern (5 retries, exponential `[1s, 2s, 4s, 8s, 16s]`, retryable on 429/5xx/transport)
**And** apiKey never appears in error messages, stacks, or pino output
**And** on success returns `{importId: <uuid from response>}`; on failure throws `MiraklApiError` with safeMessagePt + code

**Given** `markStagingPending({tx, cycleId, importId})` — atomicity helper
**When** called within a transaction after `submitPriceImport` returns the importId
**Then** for every staging row in the cycle for the customer (including passthrough rows added during CSV build), the helper sets `sku_channels.pending_import_id = importId`, `sku_channels.pending_set_price_cents = staging.new_price_cents` (passthroughs get their existing last_set_price_cents — no change but pending_import_id IS set)
**And** the helper marks `pri01_staging.flushed_at = NOW()` and `pri01_staging.import_id = importId` for the participating rows
**And** all writes happen in ONE transaction — partial-state recovery is impossible
**And** an integration test asserts: after submit, ALL participating rows (changing + passthrough) have non-null pending_import_id; no row in the cycle is left without it; engine STEP 1 SKIPs all of them on subsequent polls until PRI02 COMPLETE clears

**Given** `eslint-rules/no-raw-CSV-building.js`
**When** ESLint runs
**Then** any usage of `csv-stringify`, `papaparse`, manual CSV string concatenation with `;` or `,` separators followed by `\n`, or any `Buffer.from(...).toString()` pattern that smells like CSV-building — OUTSIDE `shared/mirakl/pri01-writer.js` — triggers a lint error: *"Raw CSV building forbidden. Use shared/mirakl/pri01-writer.js for all PRI01 emission."*
**And** the rule has a heuristic detector (regex on string literals containing `;` followed by `\n` near a JS template, OR explicit calls to known CSV libs) plus an explicit allowlist for `shared/mirakl/pri01-writer.js`
**And** legitimate non-PRI01 CSV usage (e.g., test fixtures reading `.csv` files) is not flagged because the rule targets CSV-WRITING patterns, not reading

**Given** the writer respects PC01 capture failures
**When** `customer_marketplaces.operator_csv_delimiter` IS NULL OR `offer_prices_decimals` IS NULL
**Then** `buildPri01Csv` throws a clear error before producing any output: *"PC01 capture incomplete for customer_marketplace <id>: operator_csv_delimiter or offer_prices_decimals is NULL. Re-run onboarding scan or PC01 monthly re-pull (Story 12.4) to populate."*
**And** the dispatcher catches this and emits a `cycle-fail-sustained` Atenção event after 3 consecutive cycles fail this way for the same customer (per AD24)

---

### Story 6.2: `shared/mirakl/pri02-poller.js` + `worker/src/jobs/pri02-poll.js` cron entry + COMPLETE/FAILED handling
**GH Issue:** #23

**Implements:** AD7 (poller half) · **FRs:** FR23 (PRI02 polling) · **NFRs:** NFR-P5 (≤30 min resolution) · **Size:** M
**SSoT modules created:** `shared/mirakl/pri02-poller.js` (`pollImportStatus`, `clearPendingImport`), `worker/src/jobs/pri02-poll.js`
**Depends on:** Story 3.1 (api-client), Story 6.1 (pending_import_id is set by writer), Story 9.0 + Story 9.1 (audit foundation for `pri02-complete` / `pri02-failed-transient` events, calendar-early per Option A)
**Enables:** Story 6.3 (PRI03 parser invoked on FAILED), Story 7.3 (cooperative-absorption observes cleared pending_import_id)

As Pedro (developer/founder),
I want a separate cron job that polls every active pending_import_id, clears the column atomically on COMPLETE, and triggers per-SKU rebuild via PRI03 parser on FAILED,
So that the pending_import_id invariant chain closes (writer sets → poller clears) and stuck-WAITING SKUs don't pile up beyond the 30-min NFR-P5 budget.

**Acceptance Criteria:**

**Given** `worker/src/jobs/pri02-poll.js` is registered with `node-cron` at worker boot
**When** the cron tick fires (every 5 minutes — independent from master cron)
**Then** it queries `SELECT DISTINCT pending_import_id, customer_marketplace_id FROM sku_channels WHERE pending_import_id IS NOT NULL` (ESLint `worker-must-filter-by-customer` exception via `// safe: cross-customer cron` comment — this is a deliberately cross-customer poll)
**And** for each `(pending_import_id, customer_marketplace_id)` pair, decrypts the customer's apiKey, calls `pollImportStatus(baseUrl, apiKey, importId)`

**Given** `pollImportStatus(baseUrl, apiKey, importId)` returns COMPLETE
**When** the poller processes it
**Then** in ONE transaction: `UPDATE sku_channels SET last_set_price_cents = pending_set_price_cents, last_set_at = NOW(), pending_set_price_cents = NULL, pending_import_id = NULL WHERE pending_import_id = $importId`
**And** emits one `pri02-complete` Rotina audit event per affected sku_channel (or one aggregate event for the import — Pedro to clarify if needed; default: one per sku_channel for trace fidelity)
**And** the cleared rows are immediately eligible for the next dispatcher cycle (engine STEP 1 precondition `pending_import_id IS NULL` now passes)

**Given** `pollImportStatus(...)` returns FAILED
**When** the poller processes it
**Then** clears `pending_import_id` and `pending_set_price_cents` for the affected rows in ONE transaction
**And** invokes `shared/mirakl/pri03-parser.js` (Story 6.3) to fetch + parse the error report
**And** based on the parser's per-SKU error breakdown, schedules per-SKU rebuilds (cycle-assembly will pick them up on next dispatcher tick)
**And** emits `pri02-failed-transient` Rotina event for the import; if the same SKU has failed 3 consecutive cycles, also emits `pri01-fail-persistent` Atenção event + sends critical alert via `shared/resend/client.js` (Story 4.6)

**Given** `pollImportStatus(...)` returns WAITING / RUNNING
**When** the poller processes it
**Then** does nothing this tick — leaves pending_import_id set for next poll
**And** if the import has been pending for >30 minutes (compare `sku_channels.updated_at` or a `pri01_staging.flushed_at` marker), emits a critical alert per FR46 + NFR-P5 (stuck-WAITING detection)

**Given** unit tests in `tests/shared/mirakl/pri02-poller.test.js`
**When** I run them
**Then** they cover: COMPLETE clears all participating rows atomically; FAILED triggers PRI03 parse + per-SKU rebuild scheduling; WAITING leaves state unchanged; stuck-WAITING (>30min) triggers critical alert
**And** integration test asserts pending_import_id invariant — between writer SET and poller CLEAR, engine STEP 1 SKIPs the row, cooperative-absorption SKIPs the row

---

### Story 6.3: `shared/mirakl/pri03-parser.js` + per-SKU rebuild semantics
**GH Issue:** #26

**Implements:** AD7 (PRI03 partial-success), AD24 partial · **FRs:** FR23 (partial-success handling) · **Size:** M
**SSoT modules created:** `shared/mirakl/pri03-parser.js` (`fetchAndParseErrorReport`, `scheduleRebuildForFailedSkus`)
**Depends on:** Story 6.2 (poller invokes parser on FAILED), Story 6.1 (rebuild produces a new CSV via writer), Story 9.0 + Story 9.1 (audit foundation for `pri01-fail-persistent` Atenção event, calendar-early per Option A)
**Enables:** Story 7.6 (per-SKU CB observes per-SKU failure count for the 3-cycle escalation rule)

As Pedro (developer/founder),
I want a parser that fetches the PRI03 error report on a FAILED import, identifies which SKU lines failed, and schedules per-SKU rebuilds (whole-SKU resubmit, not per-line patches),
So that PRI01's delete-and-replace semantic stays correct under partial failures and the writer doesn't accidentally delete other channels of a failed SKU.

**Acceptance Criteria:**

**Given** `fetchAndParseErrorReport(baseUrl, apiKey, importId)` is called for a FAILED import
**When** it runs
**Then** it fetches `GET <baseUrl>/api/offers/pricing/imports/<importId>/error_report` — MCP-verified path returning a CSV with `line_number` + `error_reason` columns; resubmittable with the same import_id semantics
**And** parses the CSV response into `{failedSkus: [{shopSku, errorCode, errorMessage}, ...], successfulSkus: [...]}` — line numbers map back to the original PRI01 CSV's `offer-sku` rows via the writer's per-SKU line tracking
**And** PT-localizes any error messages via `getSafeErrorMessage` patterns (Story 3.1)

**Given** `scheduleRebuildForFailedSkus({tx, customerMarketplaceId, failedSkus, cycleId})`
**When** called
**Then** for each failed SKU, INSERTs a fresh `pri01_staging` row reflecting the SKU's current state (NOT just the failed line — full SKU rebuild per AD7's per-SKU resubmit semantic)
**And** the rebuild is picked up by the next dispatcher cycle (cycle-assembly processes the new staging rows)
**And** does NOT modify the failed SKU's `last_set_price_cents` (since PRI02 was FAILED, the prices were never applied — last_set_price_cents stays at pre-failure value)
**And** tracks per-SKU failure count via a counter column on `sku_channels` (e.g., add `pri01_consecutive_failures smallint NOT NULL DEFAULT 0` in this story's migration) — incremented on each failure, reset to 0 on PRI02 COMPLETE
**And** when the counter hits 3, emits `pri01-fail-persistent` Atenção event + critical alert + freezes the SKU pending review (sets `frozen_for_anomaly_review = true` per AD24)

**Given** unit tests in `tests/shared/mirakl/pri03-parser.test.js`
**When** I run them
**Then** they cover: parse error report with mixed success/failure SKUs; per-SKU rebuild produces correct staging rows; failure counter increments correctly; 3-strike escalation freezes SKU + emits Atenção
**And** golden-file fixture `tests/fixtures/pri01-csv/pri03-recovery-resubmit.csv` matches the byte-exact output for a per-SKU rebuild scenario

**Given** the 3-strike escalation freezes the SKU pending review (per AD24), and Story 7.4 already uses `frozen_for_anomaly_review` for anomaly freezes — there is a semantic-overload risk per Step 4 audit refinement I2
**When** Bob shards Story 6.3 (the design choice question)
**Then** he must explicitly choose between:
  - **(a)** Discriminator column `frozen_reason` enum on `sku_channels` with values `'ANOMALY_REVIEW' | 'PRI01_PERSISTENT'` (and `frozen_for_anomaly_review` boolean stays — set when frozen, with `frozen_reason` distinguishing why), OR
  - **(b)** Separate boolean column `frozen_for_pri01_persistent` parallel to `frozen_for_anomaly_review`; engine STEP 1 SKIPs if EITHER is true
**And** the choice is documented in the story's PR description — NO silent overload of the `frozen_for_anomaly_review` column to mean both anomaly + PRI01-persistent
**And** dispatcher predicate (Story 5.1's SQL) is updated accordingly: option (a) keeps current predicate; option (b) adds a second clause `AND frozen_for_pri01_persistent = false`
**And** RLS regression suite extended with the chosen column(s)

---

## Epic 7: Engine Decision & Safety

### Story 7.1: `shared/money/index.js` + `no-float-price` ESLint rule
**GH Issue:** #27

**Implements:** AD8 STEP 3 dependency (math primitives), money discipline foundation · **FRs:** FR21 (math foundation) · **Size:** S
**SSoT modules created:** `shared/money/index.js` (`toCents`, `fromCents`, `roundFloorCents`, `roundCeilingCents`, `formatEur`), `eslint-rules/no-float-price.js`
**Depends on:** Story 1.1 (eslint config)
**Enables:** Story 7.2 (engine STEP 3 floor/ceiling math); Epic 8 (eta template helpers `formatEur`, `fromCents`)

As Pedro (developer/founder),
I want a single-source-of-truth money module enforcing integer-cents discipline with conservative rounding directions, plus a custom ESLint rule that catches accidental float-price math,
So that BAD subagents writing engine STEP 3 floor/ceiling computations and Epic 8's eta template formatters cannot silently introduce float-rounding bugs that drift cents.

**Acceptance Criteria:**

**Given** `shared/money/index.js` exports
**When** I call `toCents(eurDecimal)`
**Then** for `17.99` → returns integer `1799` (rounded to nearest cent if input has more than 2 decimals)
**And** for invalid inputs (NaN, undefined, negative) throws

**Given** `fromCents(integerCents)`
**When** I call it with `1799`
**Then** returns the string `'€17,99'` (PT locale: comma as decimal separator, € prefix, NO space between € and digits)
**And** for `0` returns `'€0,00'`; for `1` returns `'€0,01'`

**Given** `roundFloorCents(rawFloorFloat)`
**When** I call it with a non-integer cents value (e.g., 1798.7)
**Then** returns `Math.ceil(rawFloorFloat)` → `1799` (conservative — floor never sinks below raw, protects margin)
**And** for an exact integer input, returns the input unchanged

**Given** `roundCeilingCents(rawCeilingFloat)`
**When** I call it with a non-integer cents value (e.g., 1801.3)
**Then** returns `Math.floor(rawCeilingFloat)` → `1801` (conservative — ceiling never exceeds raw, prevents accidental over-pricing)

**Given** `formatEur(integerCents)`
**When** Epic 8 eta templates call it (registered as a view helper)
**Then** the template renders `'€17,99'` style display strings consistently with `fromCents` (alias or same function — pick one)

**Given** `eslint-rules/no-float-price.js`
**When** ESLint runs
**Then** any of these patterns OUTSIDE `shared/money/index.js` triggers a lint error:
  - `<var>.toFixed(2)` where `<var>` is a price-like identifier (heuristic: name contains `price`, `floor`, `ceiling`, `cost`, `margin`)
  - `parseFloat(<expr>)` where the result is assigned to a price-like identifier
  - `<var> * 100` or `<var> * 0.01` where `<var>` is a price-like identifier
  - `Math.round(<expr> * 100) / 100` (the classic ad-hoc-cents pattern)
**And** the rule allows these patterns inside `shared/money/index.js` (the module is the only place these are legitimate)
**And** the rule's error message: *"Float-price math forbidden. Use shared/money/index.js (toCents, fromCents, roundFloorCents, roundCeilingCents) for all price arithmetic."*

**Given** unit tests in `tests/shared/money/index.test.js`
**When** I run them
**Then** they cover: round-trip toCents → fromCents preserves value; conservative rounding directions verified with edge cases (1798.5 floor → 1799; 1801.5 ceiling → 1801); locale formatting (PT comma); error cases for invalid inputs

---

### Story 7.2: `worker/src/engine/decide.js` — full AD8 decision flow with filter chain via self-filter
**GH Issue:** #28

**Implements:** AD8 (full enumeration), AD13 (collision detection), AD14 (mandatory filter chain) · **FRs:** FR20, FR21, FR24 partial · **Size:** L
**SSoT modules created:** `worker/src/engine/decide.js` (`decideForSkuChannel`)
**Test fixtures (12 of 17 P11 fixtures):** `p11-tier1-undercut-succeeds.json`, `p11-tier1-floor-bound-hold.json`, `p11-tier1-tie-with-competitor-hold.json`, `p11-tier2b-ceiling-raise-headroom.json`, `p11-all-competitors-below-floor.json`, `p11-all-competitors-above-ceiling.json`, `p11-self-active-in-p11.json`, `p11-self-marked-inactive-but-returned.json`, `p11-single-competitor-is-self.json`, `p11-zero-price-placeholder-mixed-in.json`, `p11-shop-name-collision.json`, `p11-pri01-pending-skip.json`
**Depends on:** Story 3.2 (P11 wrapper + self-filter), Story 7.1 (money module), Story 5.2 (cycle-assembly + pri01_staging), Story 4.2 (sku_channels), Story 6.1 (writer's pending_import_id contract — engine SKIPs on it), Story 9.0 + Story 9.1 (audit foundation for decision events: `undercut-decision`, `ceiling-raise-decision`, `hold-floor-bound`, `hold-already-in-1st`, `shop-name-collision-detected`; calendar-early per Option A)
**Enables:** Stories 7.3, 7.4, 7.5, 7.6 (each fills in the orchestrator's stubs); Story 7.8 (atomicity-bundle integration gate)

As Pedro (developer/founder),
I want the AD8 decision flow implemented end-to-end with the filter chain wired via `shared/mirakl/self-filter.js`, the floor/ceiling math via `shared/money/index.js`, and stub calls into cooperative-absorption + per-SKU circuit-breaker that subsequent stories fill in,
So that the heart of the system ships behind a clear orchestrator that BAD subagents cannot diverge from and that all 12 of its applicable P11 fixtures pass against.

**Acceptance Criteria:**

**Given** `decideForSkuChannel({skuChannel, customerMarketplace, ownShopName, p11RawOffers, tx})` exported from `worker/src/engine/decide.js`
**When** the orchestrator runs
**Then** it implements AD8's 6 steps in order:
  - **Preconditions** (any false → return `{action: 'SKIP', reason}`):
    - `customer_marketplace.cron_state === 'ACTIVE'`
    - `sku_channel.frozen_for_anomaly_review === false`
    - `sku_channel.pending_import_id === null`
    - `sku_channel.excluded_at === null`
  - **STEP 1**: filter `p11RawOffers` via `filterCompetitorOffers(p11RawOffers, ownShopName)` (Story 3.2 self-filter); if `collisionDetected === true` → emit `shop-name-collision-detected` Atenção + return `{action: 'SKIP', reason: 'collision'}`; if `filteredOffers.length === 0` → tier=3, return `{action: 'HOLD', auditEvent: 'tier-transition'}` (no write)
  - **STEP 2**: stub call to `cooperative-absorb.js` (Story 7.3) — for now passes through; if Story 7.3 has shipped, dispatches to its logic
  - **STEP 3**: compute `floor_price_cents = roundFloorCents(list_price_cents * (1 - max_discount_pct))` and `ceiling_price_cents = roundCeilingCents(list_price_cents * (1 + max_increase_pct))` via `shared/money/index.js` (Story 7.1)
  - **STEP 4**: branching by position
    - `competitor_lowest = filteredOffers[0].total_price_cents`
    - `competitor_2nd = filteredOffers[1]?.total_price_cents ?? null`
    - own position determined by comparing `current_price_cents + min_shipping_price_cents` against `filteredOffers[0]`
    - **CASE A (position > 1)**: `target_undercut = competitor_lowest - edge_step_cents`; `candidate = MAX(target_undercut, floor_price_cents)`; if `candidate < competitor_lowest` → `action = UNDERCUT`, `new_price = candidate`, emit `undercut-decision` Rotina; else `action = HOLD`, emit `hold-floor-bound` Rotina
    - **CASE B (position == 1)**: if `competitor_2nd === null` → `action = HOLD`, emit `hold-already-in-1st` Rotina; else `target_ceiling = competitor_2nd - edge_step_cents`; `new_ceiling = MIN(target_ceiling, ceiling_price_cents)`; if `new_ceiling > current_price_cents` → `action = CEILING_RAISE`, emit `ceiling-raise-decision` Rotina; else `action = HOLD`, emit `hold-already-in-1st` Rotina
  - **STEP 5**: stub call to `circuit-breaker.js` (Story 7.6) per-SKU 15% check — for now passes through; if Story 7.6 has shipped, dispatches
  - **STEP 6**: if action ∈ {UNDERCUT, CEILING_RAISE} → emit to cycle-assembly (Story 5.2) which INSERTs into `pri01_staging` with the new_price_cents

**Given** the filter chain is mandatory
**When** the engine runs against any P11 response
**Then** EVERY ranking computation is post-filter-chain (no engine math reads `p11RawOffers` directly — only `filteredOffers`)
**And** the filter chain order is verified: active first, then total_price, then self-filter, then sort by total_price ascending

**Given** tie-handling (per Pedro's pre-locked decision)
**When** `candidate_price === competitor_lowest` in CASE A
**Then** action = HOLD with `hold-floor-bound` Rotina event (NOT push into the tie — coin-flip with margin sacrifice strictly worse)

**Given** the 12 fixtures listed above
**When** I run `tests/worker/engine/decide.test.js`
**Then** for each fixture the test loads the P11 response from JSON, calls `decideForSkuChannel` with the fixture's `skuChannel` + `customerMarketplace` + `ownShopName`, and asserts:
  - `p11-tier1-undercut-succeeds.json` → action=UNDERCUT, new_price = competitor_lowest - 0.01
  - `p11-tier1-floor-bound-hold.json` → action=HOLD, event=hold-floor-bound
  - `p11-tier1-tie-with-competitor-hold.json` → action=HOLD, event=hold-floor-bound
  - `p11-tier2b-ceiling-raise-headroom.json` → action=CEILING_RAISE
  - `p11-all-competitors-below-floor.json` → action=HOLD (cannot undercut profitably)
  - `p11-all-competitors-above-ceiling.json` → action=HOLD or CEILING_RAISE within ceiling — never violates ceiling
  - `p11-self-active-in-p11.json` → self filtered out, ranking proceeds correctly
  - `p11-self-marked-inactive-but-returned.json` → AD14 active filter catches it
  - `p11-single-competitor-is-self.json` → post-filter empty → tier 3 path (action=HOLD, no write)
  - `p11-zero-price-placeholder-mixed-in.json` → AD14 total_price>0 filter catches Strawberrynet-style placeholder
  - `p11-shop-name-collision.json` → AD13 collision detected, action=SKIP, `shop-name-collision-detected` Atenção emitted
  - `p11-pri01-pending-skip.json` → precondition fails (pending_import_id set), action=SKIP

**Given** the negative-assertion check
**When** I grep for direct P11 access OR direct money-cents math OR direct cron_state UPDATE inside `worker/src/engine/decide.js`
**Then** there are no matches (all access goes through `shared/mirakl/p11.js`, `shared/mirakl/self-filter.js`, `shared/money/index.js`, `shared/state/cron-state.js`)

---

### Story 7.3: `worker/src/engine/cooperative-absorb.js` — STEP 2 absorption + skip-on-pending
**GH Issue:** #29

**Implements:** AD9 · **FRs:** FR22 · **Size:** M
**SSoT modules created:** `worker/src/engine/cooperative-absorb.js` (`absorbExternalChange`)
**Test fixtures:** `p11-cooperative-absorption-within-threshold.json`
**Depends on:** Story 7.2 (engine orchestrator's STEP 2 stub call wired here), Story 9.0 + Story 9.1 (audit foundation for `external-change-absorbed` Notável event, calendar-early per Option A)
**Enables:** Story 7.4 (anomaly-freeze shares the deviation detection logic)

As Pedro (developer/founder),
I want a single-source-of-truth absorption module that, on detecting `current_price ≠ last_set_price` with no pending import, treats the change as new pricing intent and updates `list_price = current_price`,
So that the customer's ERP / manual edit / other tool stays authoritative for pricing intent and MarketPilot follows their lead within tolerance.

**Acceptance Criteria:**

**Given** `absorbExternalChange({tx, skuChannel, customerMarketplace})` is called from engine STEP 2
**When** `skuChannel.current_price_cents !== skuChannel.last_set_price_cents` AND `skuChannel.pending_import_id === null`
**Then** the function detects the external change
**And** computes `deviation_pct = Math.abs((current_price - list_price) / list_price)`
**And** if `deviation_pct > threshold` (where threshold = `customer_marketplace.anomaly_threshold_pct ?? 0.40` — null reads default, per architecture) → calls `freezeSkuForReview` (Story 7.4) and returns `{absorbed: false, frozen: true}` (engine STEP 2 returns early — no normal repricing this cycle)
**And** otherwise → updates `sku_channel.list_price_cents = current_price_cents` in the same transaction, emits `external-change-absorbed` Notável audit event with payload `{previousListPriceCents, newListPriceCents, deviationPct}`, and returns `{absorbed: true, frozen: false}` (engine STEP 2 continues to STEP 3 with the new list_price)

**Given** the skip-on-pending semantic
**When** `skuChannel.pending_import_id IS NOT NULL`
**Then** absorption is SKIPPED entirely (per AD9) — current_price is in flux and not a stable signal; engine STEP 2 returns `{absorbed: false, frozen: false, skipped: true}` and the orchestrator returns SKIP for this cycle

**Given** the case where `current_price === last_set_price`
**When** absorbExternalChange is called
**Then** returns `{absorbed: false, frozen: false}` immediately (no external change detected)

**Given** fixture `p11-cooperative-absorption-within-threshold.json`
**When** loaded as input
**Then** the test asserts: deviation < 0.40 → list_price updated → `external-change-absorbed` Notável emitted with correct payload
**And** the test verifies the audit_log row's `priority` column is `'notavel'` (set by trigger from Story 9 foundation)

**Given** unit tests in `tests/worker/engine/cooperative-absorb.test.js`
**When** I run them
**Then** they cover: external change detected → absorption succeeds; pending import → skipped; no change → no-op; threshold exceeded → freeze branch (mock the freeze call to verify dispatch)

---

### Story 7.4: `worker/src/safety/anomaly-freeze.js` + `/audit/anomaly/:sku/{accept|reject}` endpoints
**GH Issue:** #30

**Implements:** AD12 · **FRs:** FR29 · **Size:** M
**SSoT modules created:** `worker/src/safety/anomaly-freeze.js` (`freezeSkuForReview`, `unfreezeSkuAfterAccept`, `unfreezeSkuAfterReject`), `app/src/routes/audit/anomaly-review.js`
**Test fixtures:** `p11-cooperative-absorption-anomaly-freeze.json`
**Depends on:** Story 7.3 (absorption invokes freeze when deviation > threshold), Story 4.6 (`shared/resend/client.js`), Story 9.0 + Story 9.1 (audit foundation for `anomaly-freeze` Atenção event, calendar-early per Option A)
**Enables:** Epic 8 (anomaly-review modal UI consumes the accept/reject endpoints)

As Pedro (developer/founder),
I want a single-source-of-truth anomaly-freeze module that sets `sku_channel.frozen_for_anomaly_review`, emits the Atenção audit event, sends the critical alert, and exposes accept/reject endpoints for Story 8.x's review modal,
So that customers can confirm or reject suspicious external changes without me building parallel freeze logic in multiple places.

**Acceptance Criteria:**

**Given** `freezeSkuForReview({tx, skuChannelId, customerMarketplaceId, deviationPct, currentPriceCents, listPriceCents})`
**When** called from Story 7.3's absorption logic
**Then** in ONE transaction: sets `sku_channels.frozen_for_anomaly_review = true`, `frozen_at = NOW()`, `frozen_deviation_pct = deviationPct`
**And** emits `anomaly-freeze` Atenção audit event with payload `{deviationPct, currentPriceCents, listPriceCents}` — the audit_log row's `resolved_at` is NULL (set later when customer accepts/rejects)
**And** sends a critical alert email via `shared/resend/client.js`'s `sendCriticalAlert` (Story 4.6) within ≤5 min (NFR-P9)
**And** subsequent dispatcher cycles SKIP this sku_channel (engine STEP 1 precondition `frozen_for_anomaly_review === false` fails)

**Given** `POST /audit/anomaly/:skuChannelId/accept` (signed-in customer)
**When** the customer accepts the new external price as the new list_price
**Then** `unfreezeSkuAfterAccept({tx, skuChannelId})` runs in ONE transaction: sets `list_price_cents = current_price_cents`, `frozen_for_anomaly_review = false`, `frozen_at = null`, `frozen_deviation_pct = null`
**And** marks the original `anomaly-freeze` audit_log row's `resolved_at = NOW()` (NO new audit event emitted — `anomaly-resolved` is not in AD20 taxonomy)
**And** the next dispatcher cycle picks up the unfrozen sku_channel and reprices normally

**Given** `POST /audit/anomaly/:skuChannelId/reject`
**When** the customer rejects the change (preserves old list_price)
**Then** `unfreezeSkuAfterReject({tx, skuChannelId})` runs in ONE transaction: leaves `list_price_cents` unchanged, sets `frozen_for_anomaly_review = false`, `frozen_at = null`, `frozen_deviation_pct = null`
**And** marks the original audit_log row's `resolved_at = NOW()`
**And** next dispatcher cycle picks up the unfrozen sku_channel; cooperative-absorption (Story 7.3) will detect `current_price ≠ last_set_price` again — the customer must use whole-tool pause if they want to permanently override the absorption

**Given** RLS on the routes
**When** customer A attempts `POST /audit/anomaly/<customer_B_skuChannelId>/accept`
**Then** the RLS-aware client (Story 2.1) returns 0 rows; route returns 404 (not 403 — don't leak existence)
**And** RLS regression suite extended with anomaly-review endpoint coverage

**Given** fixture `p11-cooperative-absorption-anomaly-freeze.json`
**When** loaded as input to the engine
**Then** the integration test asserts: deviation > 0.40 → freeze invoked → `anomaly-freeze` Atenção emitted → critical alert sent (via mock Resend client) → sku_channel marked frozen → engine SKIPs the SKU on next cycle

---

### Story 7.5: `worker/src/engine/tier-classify.js` — full transitions + atomic T2a→T2b write per F1
**GH Issue:** #31

**Implements:** AD10 (with F1 amendment) · **FRs:** FR17 (tier transitions populate state), FR19 · **Size:** M
**SSoT modules created:** `worker/src/engine/tier-classify.js` (`applyTierClassification`)
**Test fixtures:** `p11-tier2a-recently-won-stays-watched.json`, `p11-tier3-no-competitors.json`, `p11-tier3-then-new-competitor.json`
**Depends on:** Story 7.2 (engine calls into tier-classify after determining position), Story 4.2 (sku_channels.tier + tier_cadence_minutes + last_won_at columns), Story 9.0 + Story 9.1 (audit foundation for `tier-transition` Rotina event, calendar-early per Option A)
**Enables:** Story 7.8 (integration gate)

As Pedro (developer/founder),
I want the 4-state tier classification with per-SKU cadence and `last_won_at` timestamps, including the F1 atomic write of `tier='2b'` + `tier_cadence_minutes=45` on T2a→T2b transitions,
So that the dispatcher's predicate correctly relaxes Tier 2b cadence after 4h holding 1st (without F1, the row would stay at 15-min cadence forever).

**Acceptance Criteria:**

**Given** `applyTierClassification({tx, skuChannel, currentPosition, hasCompetitors})` is called from engine STEP 4 (after position is determined but before audit emission)
**When** the function evaluates transitions
**Then** it implements AD10 + F1 transition rules:
  - **T1 → T2a** on winning 1st place (currentPosition === 1, previously not 1st): set `tier = '2a'`, `tier_cadence_minutes = 15`, `last_won_at = NOW()`; emit `tier-transition` Rotina event
  - **T2a → T2b** when `tier === '2a'` AND `last_won_at` is ≥ 4h ago AND currentPosition still === 1: ATOMIC write of `tier = '2b'` AND `tier_cadence_minutes = 45` in the SAME transaction as the `tier-transition` audit event (F1 amendment — without this atomic write, the dispatcher predicate keeps the row at 15-min cadence forever)
  - **{T2, T2a, T2b} → T1** on losing 1st place (currentPosition > 1): set `tier = '1'`, `tier_cadence_minutes = 15`; preserve `last_won_at` (analytics signal); emit `tier-transition` Rotina event
  - **T3 → T1 or T2a** on new competitor entering (was tier 3, now hasCompetitors === true): if currentPosition === 1 AND beats new competitor → tier = '2a', last_won_at = NOW(); else tier = '1'; emit `tier-transition` Rotina event
  - **T1 ↔ T2b stable**: no transition needed if state is unchanged

**Given** the per-SKU cadence_minutes column drives dispatcher selection
**When** the dispatcher runs after a T2a → T2b transition
**Then** the row is checked at 45-min cadence (not 15-min), confirming the F1 atomic write has effect
**And** an integration test asserts: simulate a T2a row with `last_won_at = NOW() - 5h`; run the engine; verify the row's `tier` is now `'2b'` and `tier_cadence_minutes` is `45` after the transaction commits

**Given** fixture `p11-tier2a-recently-won-stays-watched.json` (last_won_at < 4h ago, position still 1)
**When** loaded
**Then** test asserts: tier stays at '2a', cadence stays at 15 min, no transition emitted

**Given** fixture `p11-tier3-no-competitors.json`
**When** loaded
**Then** test asserts: tier classified as '3', cadence = 1440 (daily), no audit event for steady-state

**Given** fixture `p11-tier3-then-new-competitor.json` (was T3, now competitor present)
**When** loaded
**Then** test asserts: tier transitions to '1' or '2a' depending on position, `tier-transition` event emitted

**Given** unit tests in `tests/worker/engine/tier-classify.test.js`
**When** I run them
**Then** they cover all 4 transition rules + the F1 atomic write verification

---

### Story 7.6: `worker/src/safety/circuit-breaker.js` — per-SKU 15% + per-cycle 20%
**GH Issue:** #32

**Implements:** AD11 (with F6) · **FRs:** FR26, FR27 · **Size:** M
**SSoT modules created:** `worker/src/safety/circuit-breaker.js` (`checkPerSkuCircuitBreaker`, `checkPerCycleCircuitBreaker`)
**Depends on:** Story 7.2 (engine STEP 5 calls into per-SKU CB), Story 5.2 (cycle-assembly calls into per-cycle CB after staging, before flush), Story 9.0 + Story 9.1 (audit foundation for `circuit-breaker-trip` and `circuit-breaker-per-sku-trip` Atenção events, calendar-early per Option A)
**Enables:** Story 7.8 (integration gate exercises both caps)

As Pedro (developer/founder),
I want both circuit-breaker caps as a single-source-of-truth module (per-SKU 15% in engine STEP 5; per-cycle 20% in dispatcher gate per F6 denominator), with manual unblock via cron_state transition,
So that engine bugs and customer ERP cascades both have explicit catches, and the manual-unblock path goes through `transitionCronState`.

**Acceptance Criteria:**

**Given** `checkPerSkuCircuitBreaker({skuChannel, newPriceCents, currentPriceCents})` called from engine STEP 5
**When** `Math.abs(newPriceCents - currentPriceCents) / currentPriceCents > 0.15`
**Then** the function returns `{tripped: true, action: 'HOLD_CIRCUIT_BREAKER_PER_SKU', deltaPct}`
**And** the engine emits `circuit-breaker-per-sku-trip` Atenção audit event with payload `{deltaPct, attemptedNewPriceCents, currentPriceCents}`
**And** sends critical alert via `shared/resend/client.js`
**And** the per-cycle 20% cap is computed independently at the dispatcher (not affected by per-SKU trips)

**Given** `checkPerCycleCircuitBreaker({tx, customerMarketplaceId, cycleId})` called by cycle-assembly after staging, before flushing to writer (Story 5.2 + Story 6.1)
**When** the function runs
**Then** numerator = `SELECT COUNT(*) FROM pri01_staging WHERE cycle_id = $cycleId AND flushed_at IS NULL` (rows staged for write this cycle)
**And** denominator = `SELECT COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $customerMarketplaceId AND excluded_at IS NULL` (active SKUs in the marketplace — F6 amendment denominator)
**And** trip predicate: `numerator / denominator > 0.20`
**And** if NOT tripped → returns `{tripped: false}`; cycle-assembly proceeds to flush via writer (Story 6.1)
**And** if tripped → in ONE transaction: cycle-assembly halts the staging flush (no PRI01 emitted this cycle); calls `transitionCronState({from: 'ACTIVE', to: 'PAUSED_BY_CIRCUIT_BREAKER', context: {cycleId, numerator, denominator}})` — which (per Story 4.1's per-transition map) emits `circuit-breaker-trip` Atenção via `transitionCronState`'s lookup; sends critical alert via `shared/resend/client.js`

**Given** the customer reviews via the dashboard banner (Epic 8) and clicks "Retomar manualmente"
**When** the dashboard sends `POST /resume`
**Then** the route calls `transitionCronState({from: 'PAUSED_BY_CIRCUIT_BREAKER', to: 'ACTIVE', context: {manualUnblock: true}})` — note: `(PAUSED_BY_CIRCUIT_BREAKER, ACTIVE)` is in `LEGAL_CRON_TRANSITIONS` (Story 4.1) but NOT in the per-transition event map (Pedro's discipline — manual unblocks don't emit AD20 events)
**And** the next dispatcher cycle's per-SKU decisions are recomputed from CURRENT state (no pending writes survive a circuit-breaker trip — the staging rows were never flushed)

**Given** unit tests in `tests/worker/safety/circuit-breaker.test.js`
**When** I run them
**Then** they cover: per-SKU 14% delta does NOT trip; 16% delta DOES trip + emits Atenção; per-cycle numerator/denominator boundary at exactly 20% does NOT trip (strict `> 0.20`); 21% trips + transitions cron_state; manual unblock path works

**Given** an integration test
**When** I synthesize a scenario where 21% of a customer's catalog stages for write in a single cycle
**Then** the per-cycle CB trips, no PRI01 emitted, cron_state = PAUSED_BY_CIRCUIT_BREAKER, Atenção event in audit_log, Resend mock received critical alert

**Given** the manual unblock path `(PAUSED_BY_CIRCUIT_BREAKER → ACTIVE)` per Step 4 audit refinement I3
**When** the customer clicks "Retomar manualmente" and the route calls `transitionCronState` (this `(from, to)` tuple is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-transition event map per Story 4.1)
**Then** the unblock route ALSO finds the original `circuit-breaker-trip` audit_log row for this customer_marketplace + cycle_id and sets `resolved_at = NOW()` (mirrors Story 7.4's anomaly-freeze pattern — the original Atenção event gets a resolution timestamp, not a new event)
**And** NO new event_type is emitted on the manual unblock (no `circuit-breaker-resolved` etc. — that's not in AD20's locked taxonomy)
**And** the customer's audit log surface (Epic 9) renders the original `circuit-breaker-trip` row with a "resolvido às HH:MM" annotation derived from the timestamp

---

### Story 7.7: `worker/src/safety/reconciliation.js` — Tier 3 daily pass = nightly reconciliation
**GH Issue:** #33

**Implements:** FR28, AD10 (Tier 3 daily) · **Size:** S
**SSoT modules created:** `worker/src/safety/reconciliation.js` (`runReconciliationPass`), `worker/src/jobs/reconciliation.js` (cron entry)
**Depends on:** Story 7.2 (engine), Story 7.5 (tier-classify), Story 3.2 (P11 wrapper + self-filter), Story 9.0 + Story 9.1 (audit foundation for `new-competitor-entered` Notável event, calendar-early per Option A)
**Enables:** Story 7.8

As Pedro (developer/founder),
I want a daily reconciliation cron that re-scans Tier 3 SKUs for new competitors and re-classifies tiers, doubling as the nightly reconciliation per FR28,
So that newly-entered competitors are picked up within 24h without polling Tier 3 SKUs at higher frequency than necessary.

**Acceptance Criteria:**

**Given** `worker/src/jobs/reconciliation.js` registered with `node-cron` to run daily at midnight Lisbon (`0 0 * * *` with TZ adjustment)
**When** the cron tick fires
**Then** it queries Tier 3 sku_channels (per the dispatcher predicate, which already covers Tier 3 at 1440-min cadence — but reconciliation runs an EXPLICIT cycle to ensure no Tier 3 SKU is missed even if dispatcher backlog is delayed)
**And** for each Tier 3 sku_channel: calls P11 (Story 3.2), applies self-filter (Story 3.2), checks if `filteredOffers.length > 0` (new competitor entered)
**And** if new competitor → invokes `applyTierClassification` (Story 7.5) — transitions to T1 or T2a; emits `tier-transition` and `new-competitor-entered` Notável events
**And** if still no competitors → updates `last_checked_at = NOW()` only; no audit event (silent steady state)

**Given** the reconciliation also self-heals stale state
**When** it encounters a sku_channel where `last_checked_at` is older than `tier_cadence_minutes * 2` (drifted)
**Then** logs a warning at `warn` level via pino with `customer_marketplace_id` + `sku_channel_id` + `last_checked_at`
**And** forces a check this cycle to recover

**Given** unit tests in `tests/worker/safety/reconciliation.test.js`
**When** I run them
**Then** they cover: T3 with no competitors → no transition; T3 with new competitor → T1 or T2a transition; stale-state detection logs warning

---

### Story 7.8: END-TO-END INTEGRATION GATE — full cycle test on all 17 P11 fixtures (atomicity-bundle gate for AD7+AD8+AD9+AD11)
**GH Issue:** #34

**Implements:** AD7 + AD8 + AD9 + AD11 atomicity-bundle gate · **FRs:** FR17-FR29 (engine + writer + safety integrated) · **Size:** L
**Test fixtures:** ALL 17 P11 fixtures: `p11-tier1-undercut-succeeds`, `p11-tier1-floor-bound-hold`, `p11-tier1-tie-with-competitor-hold`, `p11-tier2a-recently-won-stays-watched`, `p11-tier2b-ceiling-raise-headroom`, `p11-tier3-no-competitors`, `p11-tier3-then-new-competitor`, `p11-all-competitors-below-floor`, `p11-all-competitors-above-ceiling`, `p11-self-active-in-p11`, `p11-self-marked-inactive-but-returned`, `p11-single-competitor-is-self`, `p11-zero-price-placeholder-mixed-in`, `p11-shop-name-collision`, `p11-pri01-pending-skip`, `p11-cooperative-absorption-within-threshold`, `p11-cooperative-absorption-anomaly-freeze`
**SSoT modules created:** `tests/integration/full-cycle.test.js`, `tests/integration/circuit-breaker-trip.test.js`, `tests/integration/pending-import-id-invariant.test.js`
**Depends on:** ALL prior Epic 6 + Epic 7 stories (Stories 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7)
**Enables:** Epic 6 + Epic 7 atomicity bundle is verified safe to ship to production. Without this gate passing, Epic 6's writer cannot ship live (writer is functional in isolation but the engine integration is unproven).

As Pedro (developer/founder),
I want a single end-to-end integration test that exercises the full repricing cycle (dispatcher → engine → cooperative-absorption → tier-classify → circuit-breaker → staging → writer → mock PRI02 COMPLETE → cleared pending_import_id) against all 17 P11 fixtures,
So that the AD7+AD8+AD9+AD11 atomicity bundle has a single binding gate that proves the invariants hold across the full bundle before any of its stories ship to production.

**Acceptance Criteria:**

**Given** `tests/integration/full-cycle.test.js` is the atomicity-bundle gate
**When** it runs
**Then** it boots the Mirakl mock server (Story 3.2) seeded with fixture responses, instantiates a test Postgres with seed data for one customer with one customer_marketplace + 17 sku_channels (one per fixture), and for each fixture:
  1. Loads the fixture's P11 response into the mock server
  2. Triggers a single dispatcher cycle via `dispatchCycle()` (Story 5.1) for the test customer
  3. Asserts the engine produces the expected action per the fixture's documented expectation (UNDERCUT / CEILING_RAISE / HOLD / SKIP)
  4. Asserts the audit_log contains the expected event(s) with the expected `priority` (atencao/notavel/rotina derived by the trigger)
  5. For UNDERCUT/CEILING_RAISE: asserts a `pri01_staging` row was inserted with the expected `new_price_cents`
  6. Triggers `cycleAssembly.flush()` which calls into the writer (Story 6.1) → asserts CSV emitted matches a golden file (where applicable) → asserts ALL participating sku_channel rows have `pending_import_id` set (the invariant)
  7. Simulates PRI02 COMPLETE via the mock server → triggers `worker/src/jobs/pri02-poll.js` (Story 6.2) once → asserts ALL participating sku_channels have `pending_import_id = null` and `last_set_price_cents = pending_set_price_cents` (atomic clear)

**Given** the per-fixture expected outcomes (each fixture file has a `_expected` sibling JSON or inline assertions)
**When** the test parametrizes over the 17 fixtures
**Then** all 17 pass with their expected behavior:
  - 12 from Story 7.2 (engine decision flow)
  - 1 from Story 7.3 (cooperative-absorption-within-threshold)
  - 1 from Story 7.4 (cooperative-absorption-anomaly-freeze → freeze + Atenção + critical alert)
  - 3 from Story 7.5 (tier transitions)

**Given** the pending_import_id invariant test (`tests/integration/pending-import-id-invariant.test.js`)
**When** it runs synthetic scenarios
**Then** it asserts:
  - After writer.submitPriceImport + markStagingPending: ALL participating rows (including passthroughs) have `pending_import_id` set in the same transaction
  - While `pending_import_id` IS NOT NULL: engine STEP 1 SKIPs the row (precondition fails)
  - While `pending_import_id` IS NOT NULL: cooperative-absorption SKIPs the row (Story 7.3 skip-on-pending)
  - On PRI02 COMPLETE: clears atomically across ALL participating rows
  - On PRI02 FAILED: clears `pending_import_id`, triggers PRI03 parser (Story 6.3), schedules per-SKU rebuild

**Given** the circuit-breaker integration test (`tests/integration/circuit-breaker-trip.test.js`)
**When** it synthesizes a 21% catalog price-change scenario
**Then** asserts: cycle halts before flushing, cron_state transitions to PAUSED_BY_CIRCUIT_BREAKER, `circuit-breaker-trip` Atenção emitted, mock Resend received critical alert, no PRI01 emitted to mock Mirakl

**Given** the gate runs on every PR via CI
**When** any of the 17 fixtures fails OR the invariant test fails OR the circuit-breaker test fails
**Then** the deploy is blocked
**And** Epic 6's writer code is considered NOT-safe-to-ship-to-production until this gate passes

**Given** the gate is the AD7+AD8+AD9+AD11 atomicity bundle's single binding integration-test
**When** all assertions pass
**Then** the bundle ships together — Story 6.1 writer + Story 7.2 engine + Story 7.3 absorption + Story 7.6 per-SKU CB are jointly verified safe

---

## Epic 8: Customer Dashboard & Surfaces

**Visual targets** live at `_bmad-output/design-references/bundle/project/dashboard-and-audit.html` — open in browser, navigate via tweaks toolbar. Per-story references use stable stub filenames in `screens/<NN>-<name>.html` (Pattern A) or skeleton fallbacks (Patterns B / C). Each story's acceptance criteria explicitly declares Pattern A / B / C; reviews are mechanical against this declaration. Per Pedro's escape-hatch rule: any UI surface that doesn't fit A/B/C is flagged in Step 4 Notes-for-Pedro rather than inventing a fourth pattern.

The screen→stub mapping appendix lands in Step 4 Parallel Tracks; each Story 8.x AC names its stub by filename when applicable.

---

### Story 8.1: Dashboard root state-aware view + sticky header chrome
**GH Issue:** #35

**Implements:** AD15 surfacing (cron_state-driven banner stack), UX-DR3 (interception override), UX-DR13 (KPI card visual treatment carries; report's narrative arc does NOT) · **FRs:** FR30 (dry-run state), FR34 partial (dashboard chrome — KPI cards in 8.2), FR35 partial (toggle UI in 8.3) · **NFRs:** NFR-P7 (≤2s broadband / ≤4s 3G), NFR-A1, NFR-L1 · **Size:** L
**SSoT modules created:** `app/src/routes/dashboard/index.js` (full version replacing Story 4.9's minimal stub), `app/src/views/layouts/default.eta`, `app/src/views/pages/dashboard.eta`, `app/src/middleware/interception-redirect.js`, `public/js/dashboard.js`
**Depends on:** Story 4.9 (minimal stub being replaced), Story 4.1 (cron_state schema), Story 4.2 (sku_channels), Story 7.x (engine writes events Epic 9 consumes), Story 9.0 + Story 9.1 (audit foundation), Story 9.3 (5-surface query endpoints — KPI cards consume daily_kpi_snapshots)
**Enables:** Stories 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8 (all surface inside this dashboard chrome)
**Visual reference pattern:** **A** — multiple state stubs in `screens/`: `05-dashboard-live.html` (healthy live), `06-dashboard-paused-by-customer.html`, `07-dashboard-paused-by-payment.html`, `08-dashboard-anomaly-attention.html`, `09-dashboard-circuit-breaker.html`, `10-dashboard-sustained-transient.html` (filenames per the screen→stub mapping appendix; verify against `_bmad-output/design-references/screens/` directory listing during Step 4)

As a customer (e.g., Tony @ You Get) post-onboarding,
I want a dashboard that renders correctly across all 7 cron_state variants (DRY_RUN, ACTIVE, PAUSED_BY_*) with the right banner stacking and the right CTAs visible per state,
So that the dashboard is one coherent surface that adapts to my account's state rather than 7 different pages.

**Acceptance Criteria:**

**Given** the route `GET /` and the `interception-redirect.js` middleware
**When** an authenticated customer visits `/`
**Then** the middleware reads `customer_marketplaces.cron_state` (RLS-aware client per Story 2.1) and:
  - `PROVISIONING` → redirect to `/onboarding/scan` (UX-DR2 forward-only)
  - `cron_state IN ('DRY_RUN', 'ACTIVE', 'PAUSED_BY_CUSTOMER', 'PAUSED_BY_PAYMENT_FAILURE', 'PAUSED_BY_CIRCUIT_BREAKER', 'PAUSED_BY_KEY_REVOKED', 'PAUSED_BY_ACCOUNT_GRACE_PERIOD')` → render `/` with state-appropriate view
  - state interception conditions (key revoked, payment failed, scan failed) → redirect to corresponding `/key-revoked`, `/payment-failed`, `/scan-failed` per UX-DR3 (only first time post-state-transition; subsequent visits land on `/` with persistent banner per UX-DR32)

**Given** the dashboard page renders
**When** the customer's cron_state is loaded
**Then** the layout uses `app/src/views/layouts/default.eta` with sticky header (logo + channel toggle + pause/resume + Settings link + session avatar) + banner zone + body slot + footer
**And** the sticky header uses `backdrop-filter: blur(12px)` and 85% bg opacity per UX skeleton §10
**And** the layout renders within NFR-P7 budget (≤2s broadband)

**Given** the body slot
**When** rendered for each state per UX skeleton §3.1 state table
**Then** the visual treatments match:
  - **Loading**: skeleton KPI cards with shimmer (per UX skeleton's `shimmer` animation)
  - **DRY_RUN**: KPI cards populated with simulated values; "MODO SIMULAÇÃO" badge top-right; persistent dry-run banner (UX-DR8 + §9.5); prominent "Ir live" CTA (Story 8.6 modal)
  - **ACTIVE healthy**: full KPI cards, ambient washes, audit-log highlights row; margin editor accessible
  - **PAUSED_BY_CUSTOMER**: KPI cards greyed 60% opacity; pause icon top-left; grey banner (§9.4); "Retomar" button (Story 8.5)
  - **PAUSED_BY_PAYMENT_FAILURE**: KPI cards greyed; warning icon (NOT pause icon — UX-DR5); red banner (§9.6); "Atualizar pagamento" → Stripe Portal (Epic 11)
  - **PAUSED_BY_CIRCUIT_BREAKER**: KPI cards stale-watermarked; red banner (§9.8); "Investigar" + "Retomar" buttons
  - **PAUSED_BY_KEY_REVOKED**: redirected to `/key-revoked` interception (Story 8.9)
  - **Anomaly attention** (cron_state=ACTIVE but ≥1 SKU frozen): normal KPI cards; yellow banner (§9.7) with count; "Rever X eventos" → /audit Atenção feed
  - **Sustained transient** (cron_state=ACTIVE but ≥3 consecutive cycle failures): KPI cards stale-watermarked, timestamp visible; grey banner (§9.9); informational, no action

**Given** UX-DR4 banner stacking precedence
**When** multiple banner conditions hold simultaneously
**Then** only the highest-precedence banner renders at a given time; lower-precedence banners reappear when the higher one clears
**And** the precedence is encoded in `app/src/views/components/banners.eta` (Story 8.8) and consumed by this story's view template

**Given** UX-DR3 interception
**When** a customer with cron_state=PAUSED_BY_KEY_REVOKED logs in for the first time post-state-transition
**Then** they're redirected to `/key-revoked` (Story 8.9 interception page)
**And** subsequent logins still in PAUSED_BY_KEY_REVOKED state revert to `/` with persistent red banner (UX-DR32 — interception only triggers once)

**Given** the page is keyboard-accessible per NFR-A2
**When** I navigate via Tab / Shift+Tab
**Then** focus order matches visual hierarchy (header → banner → KPI cards → margin editor → recent Atenção → footer); no focus traps; Escape closes any open modal

**Given** an integration test
**When** I run `tests/integration/dashboard-state-machine.test.js`
**Then** it covers all 7 cron_state variants, verifies the correct banner + CTA renders per state, and asserts UX-DR3 interception triggers only once per state-transition

---

### Story 8.2: KPI cards row (3 status cards from free-report family + secondary catalog-value lines)
**GH Issue:** #36

**Implements:** UX-DR13, UX-DR14 (channel-scoped) · **FRs:** FR34 · **NFRs:** NFR-A1, NFR-L1 · **Size:** M
**SSoT modules created:** `app/src/views/components/kpi-cards.eta`
**Depends on:** Story 8.1 (dashboard chrome), Story 9.2 (`daily_kpi_snapshots` data source), Story 7.1 (`shared/money/index.js` `formatEur` for `valor de catálogo` lines)
**Enables:** Story 8.3 (channel toggle re-renders KPIs)
**Visual reference pattern:** **A** — `screens/05-dashboard-live.html` includes the rendered KPI card row (the same component is used across dashboard states with appropriate data variations).

As a customer,
I want three KPI cards mirroring the free report's categories (Em 1.º lugar / A perder posição / Sem concorrência (Tier 3)) with secondary `valor de catálogo` lines,
So that I recognize the dashboard as the same product family as the free report I saw before signup, and I see the same operational metrics I expected.

**Acceptance Criteria:**

**Given** `app/src/views/components/kpi-cards.eta`
**When** rendered with the current channel toggle (PT or ES) and customer_marketplace_id
**Then** queries `daily_kpi_snapshots` for today's row matching `(customer_marketplace_id, channel_code, date=today_lisbon)`
**And** displays 3 status cards in tonal tints (green / red / blue per UX skeleton §10):
  - **Em 1.º lugar**: count from `daily_kpi_snapshots.skus_in_first_count`; secondary line shows `valor de catálogo` summed via `shared/money/index.js`'s `formatEur`
  - **A perder posição**: count from `skus_losing_count`; secondary line shows `valor de catálogo at risk` from `catalog_value_at_risk_cents`
  - **Sem concorrência (Tier 3)**: count from `skus_exclusive_count`; secondary line shows `valor de catálogo` for Tier 3 SKUs
**And** each card carries an uppercase eyebrow label (10-11px, 0.12em tracking, 700 weight per UX skeleton §10)
**And** each card uses the 44-52px tabular display number with JetBrains Mono per UX skeleton's type stack
**And** position deltas vs prior day (e.g., `+12 vs ontem`) appear if `daily_kpi_snapshots` for yesterday exists

**Given** the channel toggle (Story 8.3) is set to PT
**When** the KPI cards render
**Then** counts reflect only PT channel data (`channel_code = 'WRT_PT_ONLINE'`); ES counts excluded
**And** vice versa when toggled to ES

**Given** the daily KPI snapshot query
**When** today's row doesn't exist yet (e.g., before midnight refresh runs)
**Then** the cards render with `0` placeholder counts and a small "Atualização em curso..." caption — never blank skeletons in steady state
**And** the worker's 5-min "today" partial refresh (Story 9.2) populates incrementally

**Given** UX-DR13 (the dashboard does NOT replicate the report's narrative arc)
**When** I inspect the dashboard
**Then** there is NO rocket hero card "A um passo do 1.º"
**And** there are NO "Maiores oportunidades", "Margem para subir", "Vitórias rápidas" tables
**And** ONLY the 3 KPI cards from this story render in the KPI row

---

### Story 8.3: PT/ES channel toggle pill in sticky header
**GH Issue:** #37

**Implements:** UX-DR14 (single-select; "Both" is Phase 2) · **FRs:** FR35 · **NFRs:** NFR-L1 · **Size:** S
**SSoT modules created:** `app/src/views/components/channel-toggle.eta`, `public/js/dashboard.js` (toggle state management)
**Depends on:** Story 8.1, Story 8.2 (toggle re-renders KPI scope)
**Enables:** Story 8.4 (margin editor's worked-example SKU pool re-evaluates on toggle), Story 9.3 (audit feeds filter by channel)
**Visual reference pattern:** **A** — same toggle pill as free report's `MarketPilot.html` PT/ES toggle (carried verbatim per UX skeleton §10); rendered within `screens/05-dashboard-live.html` and other dashboard state stubs.

As a customer with both Worten PT and Worten ES active,
I want a pill toggle in the sticky header that scopes the dashboard to one channel at a time,
So that I can compare per-channel competitive landscapes by toggling without juggling two browser tabs.

**Acceptance Criteria:**

**Given** the toggle component
**When** rendered in the sticky header per UX skeleton §10's pill toggle pattern
**Then** it shows `PT | ES` segmented buttons with the active channel highlighted
**And** the toggle scope per UX-DR14: KPI cards (Story 8.2), margin editor's worked-example SKU candidate pool (Story 8.4), "Hoje" audit-log preview (Story 8.x), Recent Atenção items (Story 8.x)
**And** the toggle does NOT scope the global banner zone (banners are system-level, not channel-level — exception: anomaly counts in §9.7 banner specify per-channel split when both have items)

**Given** the toggle persists per-session
**When** the customer toggles to ES, navigates to `/audit`, returns to `/`
**Then** the toggle remains on ES (sticky between visits via local storage)
**And** the default channel on first dashboard load is **PT** (founder is PT-based + most warm leads PT-primary per UX skeleton §4.2.2)

**Given** UX-DR14 single-select at MVP
**When** I attempt to render a "Both" merged view
**Then** the option does NOT exist in the UI (no third button); the toggle is strictly PT XOR ES
**And** "Both" merged view is flagged in epic-level Phase 2 reservations (NOT this story's scope — Phase 2 trigger requires cross-channel deduplication by EAN)

**Given** the customer has a single-channel marketplace (e.g., only PT active)
**When** the dashboard loads
**Then** the toggle is hidden entirely (or shown disabled with a tooltip "Apenas PT ativo neste marketplace")

---

### Story 8.4: Margin editor inline panel with worked-profit-example
**GH Issue:** #38

**Implements:** UX-DR15-21 (representative SKU rule, stated-margin assumption, live update mechanics) · **FRs:** FR36 · **NFRs:** NFR-A1, NFR-A2, NFR-L1 · **Size:** L
**SSoT modules created:** `app/src/views/components/margin-editor.eta`, `app/src/routes/dashboard/margin-edit.js` (POST handler), `public/js/margin-editor.js` (150ms-debounced live recompute)
**Depends on:** Story 8.1, Story 7.1 (`shared/money/index.js` floor/ceiling math + formatEur), Story 4.2 (sku_channels for representative-SKU selection), Story 4.8 (margin band stored on customer_marketplace)
**Enables:** customer can tune margin tolerance pre-Go-Live and post-Go-Live
**Visual reference pattern:** **A** — `screens/<NN>-margin-editor.html` per the screen→stub mapping appendix.

As a customer (e.g., Tony @ You Get) configuring margin tolerance,
I want a margin editor with a live worked-profit-example using a representative SKU from my own catalog,
So that I see the euro impact of my settings on a real product, not abstract percentages.

**Acceptance Criteria:**

**Given** UX-DR15 representative-SKU selection rule
**When** the margin editor mounts (or the channel toggle changes)
**Then** the server-side handler picks the worked-example SKU by:
  1. Filter: `tier IN ('1', '2a', '2b')` AND `channel_code = current_toggle_channel` (Tier 3 silent SKUs make for a bad demo per UX-DR15)
  2. Filter: `current_price_cents` between catalog `p25` and `p75` price quartiles for the customer_marketplace + channel (avoid outliers per UX-DR15)
  3. Rank: ascending by `ABS(current_price_cents - catalog_median_price_cents)` (closest to median per UX-DR15)
  4. Pick top SKU
**And** if zero SKUs satisfy the filter (UX-DR17 rare case): display the empty-state copy *"Adiciona produtos contestados ao catálogo para ver um exemplo prático. Os teus limites continuam a aplicar-se."*

**Given** UX-DR16 "Ver outro" refresh button
**When** clicked
**Then** the editor cycles through the top 5 candidates by the same UX-DR15 rule (deterministic — same 5 candidates each time for the same catalog state)
**And** it's a pure UX affordance — does NOT change engine behavior

**Given** UX-DR18 stated-margin assumption (conservative — floor of selected band)
**When** computing the worked example
**Then** the back-calculation uses:
  - `<5%` band (stored as 0.005 max_discount_pct) → assume **5% margin** (band's upper bound, treated as floor)
  - `5-10%` band → assume **5%**
  - `10-15%` band → assume **10%**
  - `15%+` band → assume **15%**
**And** the assumption is displayed explicitly in the editor caveat per UX-DR19 + §9.11 microcopy verbatim

**Given** the editor anatomy per UX skeleton §4.3.3
**When** rendered
**Then** two numeric inputs (`max_discount_pct`, `max_increase_pct`) appear with the worked-profit-example panel beside them
**And** the example shows: SKU title + current_price + minimum_allowed_price (computed via `shared/money/index.js` `roundFloorCents`) + impact in euros + remaining margin estimate
**And** the format follows §4.3.3's box layout (mocked in the visual stub)

**Given** UX-DR20 live update on input
**When** I change the input value
**Then** the example recomputes via `public/js/margin-editor.js` debounced ~150ms
**And** numeric inputs accept percentages with one decimal (e.g., `1.5%`)
**And** client-side validation: 0-50% range, out-of-range = red border + inline message *"Valor entre 0% e 50%"*, save disabled
**And** server-side re-validation on POST per AD28 (Fastify built-in JSON Schema)

**Given** UX-DR21 explicit save action
**When** the customer clicks "Guardar alterações"
**Then** `POST /dashboard/margin` (handled by `app/src/routes/dashboard/margin-edit.js`) updates `customer_marketplaces.max_discount_pct` + `max_increase_pct` via the RLS-aware client
**And** the response shows a confirmation toast: *"Margens guardadas. Aplicado a partir do próximo ciclo (~15 min)."* (verbatim per UX-DR21)
**And** the next dispatcher cycle reads the new values; current in-flight cycle (if any) does NOT use the new values (mid-cycle behavior change is unsafe per Pedro's OQ-2 lock)

**Given** the editor is keyboard-accessible per NFR-A2
**When** I use Tab → input → Tab → save button → Enter
**Then** I can adjust + save without mouse interaction; ARIA labels announce `Reduzir até` and `Aumentar até` to screen readers per NFR-A1

---

### Story 8.5: Pause / Resume buttons + customer-pause cron_state transitions
**GH Issue:** #39

**Implements:** UX-DR5 (paused-state distinction), AD15 (cron_state transitions) · **FRs:** FR32 · **NFRs:** NFR-A2 · **Size:** M
**SSoT modules created:** `app/src/routes/dashboard/pause-resume.js` (`POST /pause`, `POST /resume`), `app/src/views/components/pause-button.eta`, `public/js/pause-resume.js` (confirmation modal)
**Depends on:** Story 8.1, Story 4.1 (transitionCronState helper + LEGAL_CRON_TRANSITIONS includes the pause/resume tuples), Story 9.0 + Story 9.1 (transitionCronState emits `customer-paused` / `customer-resumed` per the per-(from,to) map)
**Enables:** customer can freeze repricing in 1 click anytime
**Visual reference pattern:** **A** — pause button rendered within `screens/05-dashboard-live.html` (live state) and `screens/06-dashboard-paused-by-customer.html` (paused state).

As a customer,
I want big single-click pause/resume buttons in the sticky header with a confirmation modal,
So that I can freeze repricing fast (trust escape valve per UX-DR24) without accidentally clicking it.

**Acceptance Criteria:**

**Given** `app/src/views/components/pause-button.eta`
**When** the customer's cron_state is `ACTIVE`
**Then** the button renders with label `"Pausar repricing"` and `pause_circle` filled icon (per §9.3 microcopy)
**And** clicking opens a confirmation modal with verbatim copy: *"Tens a certeza? O cron vai parar e os preços ficam onde estão até retomares."* + [Cancelar] [Pausar] buttons (per §9.3)

**Given** the customer confirms pause
**When** `POST /pause` runs
**Then** the route calls `transitionCronState({tx, customerMarketplaceId, from: 'ACTIVE', to: 'PAUSED_BY_CUSTOMER', context: {initiated_at: NOW()}})`
**And** the helper emits `customer-paused` Notável audit event per the per-(from,to) map (Story 4.1 + Story 9.0)
**And** the dashboard re-renders in PAUSED_BY_CUSTOMER state per Story 8.1's state-aware view; banner per §9.4 verbatim

**Given** the customer's cron_state is `PAUSED_BY_CUSTOMER`
**When** the dashboard renders
**Then** the button changes to label `"Retomar repricing"` with `play_circle` filled icon
**And** clicking immediately (no confirmation modal — resume is single-click per FR32) calls `POST /resume` → `transitionCronState({from: 'PAUSED_BY_CUSTOMER', to: 'ACTIVE'})` → emits `customer-resumed` Notável

**Given** UX-DR5 distinct visual treatment
**When** the customer is in PAUSED_BY_PAYMENT_FAILURE state
**Then** the pause button is hidden (replaced by "Atualizar pagamento" CTA — Story 8.x); pause/resume only applies to PAUSED_BY_CUSTOMER state
**And** `customer-paused` event NEVER fires for non-customer-initiated paused states (the per-(from,to) map distinguishes)

**Given** keyboard accessibility per NFR-A2
**When** I Tab to the pause button + Enter
**Then** the confirmation modal opens; Escape cancels; Tab through modal to confirm + Enter completes the action
**And** screen-reader-readable button labels (NFR-A1)

---

### Story 8.6: Go-Live consent modal + Stripe redirect
**GH Issue:** #40

**Implements:** UX-DR24 ("Tu confirmas. Nós executamos."), AD15 (DRY_RUN → ACTIVE transition without audit event per per-(from,to) map) · **FRs:** FR31 · **NFRs:** NFR-A2, NFR-L1 · **Size:** M
**SSoT modules created:** `app/src/routes/dashboard/go-live.js` (`POST /go-live`), `app/src/views/modals/go-live-consent.eta`, `public/js/go-live-modal.js`
**Depends on:** Story 8.1, Story 4.1 (transitionCronState DRY_RUN → ACTIVE), Story 11.1 (Stripe Customer + Subscription + first SubscriptionItem creation — see cross-epic note)
**Enables:** customer flips to live billing-active state
**Cross-epic note:** Stripe wiring lives in Epic 11 (Story 11.1). Story 8.6 ships the consent modal + DRY_RUN → ACTIVE transition + the Stripe redirect SHELL (modal redirects to Stripe Checkout). Until Story 11.1 ships, this story uses a stub Stripe redirect. Once Story 11.1 lands, this story's redirect target swaps to the real Stripe Customer Portal / Checkout.
**Visual reference pattern:** **A** — `screens/<NN>-go-live-consent.html` per the screen→stub mapping appendix.

As a customer ready to flip to live (e.g., Tony @ You Get after dry-run review),
I want an informed-consent modal with conditional language about how many products may be repriced and within what margin,
So that the consent is documented (audit log + customer self-flip) and I'm fully aware before billing starts.

**Acceptance Criteria:**

**Given** the customer is in `DRY_RUN` state with the dashboard's "Ir live" CTA visible (per Story 8.1's state-aware view)
**When** they click "Ir live"
**Then** the Go-Live consent modal opens (`app/src/views/modals/go-live-consent.eta`) with verbatim copy from §9.1:
  - **Título:** "Pronto para ir live?"
  - **Corpo:** "Até **{N} produtos** poderão ter preços ajustados, dentro da margem de **{X}%** que configuraste. Os preços são otimizados a cada 15 minutos, sempre dentro da tua tolerância — nunca abaixo do floor, nunca acima do ceiling.\n\nTu confirmas. Nós executamos. Tu podes parar a qualquer momento."
  - **Checkbox:** "☐ Compreendo e autorizo o repricing automático"
  - **Botão (off, disabled):** "Confirmar e ir live (€50/mês)"
  - **Cancelar:** "Manter em modo simulação"
**And** `{N}` is `SELECT COUNT(*) FROM sku_channels WHERE customer_marketplace_id = $1 AND tier IN ('1', '2a', '2b')` (repriceable count from most recent scan)
**And** `{X}%` is `(customer_marketplaces.max_discount_pct * 100)` formatted with one decimal

**Given** the checkbox state
**When** unchecked → "Confirmar e ir live" button is disabled with grey styling
**When** checked → button enables, navy gradient (`linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))`) per UX skeleton §10
**And** keyboard navigation works without mouse (NFR-A2): Tab → checkbox → Space to toggle → Tab → submit → Enter

**Given** the customer confirms with the box checked
**When** `POST /go-live` runs
**Then** the route initiates Stripe Customer + Subscription + first SubscriptionItem creation via Story 11.1's helpers (or stub during interim)
**And** on Stripe success: calls `transitionCronState({tx, from: 'DRY_RUN', to: 'ACTIVE'})` — note this `(from, to)` is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-(from,to) audit event map (no `go-live-flipped` event exists in AD20; the customer-visible signal is the cron_state itself + the start of `cycle-start` Rotina events on the next dispatcher tick)
**And** redirects to `/` (dashboard re-renders in ACTIVE state per Story 8.1)
**And** on Stripe failure: modal stays open with PT-localized error from `getSafeErrorMessage`-equivalent for Stripe errors

**Given** UX-DR24 trust footer copy
**When** the modal renders
**Then** below the body: "Tu confirmas. Nós executamos. Tu podes parar a qualquer momento." (already in §9.1's body — repeat as footer for emphasis if visual stub specifies)

---

### Story 8.7: Anomaly review modal (consumes Story 7.4 endpoints)
**GH Issue:** #41

**Implements:** UX-DR8, UX-DR24 ("Nada acontece até confirmares.") · **FRs:** FR29 · **NFRs:** NFR-A2 · **Size:** M
**SSoT modules created:** `app/src/views/modals/anomaly-review.eta`, `public/js/anomaly-review.js`
**Depends on:** Story 8.1, Story 7.4 (`POST /audit/anomaly/:skuChannelId/{accept,reject}` endpoints), Story 9.3 (audit feed Atenção surface — modal opens from there)
**Enables:** customer reviews per-SKU anomaly freezes without leaving the audit log
**Visual reference pattern:** **A** — `screens/<NN>-anomaly-review-modal.html` per the screen→stub mapping appendix.

As a customer with ≥1 SKU frozen for anomaly review,
I want a modal showing the SKU's name + before/after price + deviation %, with explicit accept/reject buttons,
So that I can confirm or reject the external change in one click without digging through audit log entries.

**Acceptance Criteria:**

**Given** the modal `app/src/views/modals/anomaly-review.eta`
**When** the customer clicks an `anomaly-freeze` Atenção feed entry (Story 9.3) OR the dashboard banner (§9.7)
**Then** the modal opens with verbatim §9.2 copy:
  - **Título:** "Mudança externa de preço · {SKU name}"
  - **Corpo:** "Detetámos uma alteração ao preço deste produto fora dos nossos ciclos:\n  Antes:  €{old}\n  Agora:  €{new}    ({±deviation}%)\nComo a mudança é maior que 40%, congelámos o repricing deste produto até confirmares. Pode ser uma promoção intencional ou um erro do teu ERP.\n\nNada acontece até confirmares."
  - **Botão A:** "Confirmar — usar €{new} como novo list_price"
  - **Botão B:** "Rejeitar — manter €{old} como list_price"
  - **Link:** "Ver histórico no audit log →" (jumps to Story 9.4 search-by-SKU for that SKU)

**Given** prices in the modal
**When** the modal queries the audit_log row + sku_channels current state
**Then** `{old}` is the `audit_log.payload.previousListPriceCents` formatted via `formatEur` (Story 7.1)
**And** `{new}` is the `audit_log.payload.newListPriceCents` (or current `current_price_cents` if absorbed but frozen) formatted via `formatEur`
**And** `{±deviation}%` is `audit_log.payload.deviationPct * 100` formatted with one decimal sign-prefixed (e.g., `+47.8%`)

**Given** the customer clicks "Confirmar"
**When** `POST /audit/anomaly/:skuChannelId/accept` (Story 7.4 endpoint) runs
**Then** the route runs the unfreeze-with-new-baseline flow per Story 7.4 — sets `list_price_cents = current_price_cents`, clears frozen state, sets `audit_log.resolved_at = NOW()` on the original event
**And** the modal closes and the dashboard banner re-evaluates (anomaly count decrements by 1)

**Given** the customer clicks "Rejeitar"
**When** `POST /audit/anomaly/:skuChannelId/reject` runs
**Then** the route runs the unfreeze-preserving-old-baseline flow — `list_price_cents` unchanged, clears frozen state, sets `resolved_at = NOW()`
**And** Story 7.3's cooperative-absorption will detect `current_price ≠ last_set_price` again on next cycle — customer is informed in the modal that whole-tool pause is the only permanent override at MVP

**Given** UX-DR24 + §9.2 emphasis
**When** the modal renders
**Then** the line "Nada acontece até confirmares." is visually emphasized (bolder weight or italic per visual stub)

---

### Story 8.8: Banner library + UX4 stack precedence
**GH Issue:** #42

**Implements:** UX-DR4 (precedence), UX-DR5 (paused-state distinction) · **FRs:** FR39 partial (banner UI; classifier in Epic 12) · **NFRs:** NFR-L1 · **Size:** M
**SSoT modules created:** `app/src/views/components/banners.eta` (precedence-aware library)
**Depends on:** Story 8.1 (chrome that hosts banners)
**Enables:** Stories 8.1, 8.5, 8.7, 8.9 all consume this library
**Visual reference pattern:** **A** — banner variants rendered within state-stub files (`screens/05-...html` through `screens/10-...html`).

As a customer,
I want banners that stack additively above the primary state with strict precedence ordering, and visually distinct treatments for customer-pause vs payment-failure,
So that I never see two contradictory banners and the visual treatment matches the severity (pause = calm grey, payment-failure = warning amber, circuit-breaker = red).

**Acceptance Criteria:**

**Given** `app/src/views/components/banners.eta`
**When** rendered with the dashboard's current cron_state + auxiliary state (anomaly_count, sustained_transient_active)
**Then** the component evaluates banner conditions in precedence order per UX-DR4:
  1. `payment_failure` — red, `warning` filled icon, §9.6 copy
  2. `circuit_breaker` — red, `gpp_maybe` filled icon, §9.8 copy
  3. `anomaly_attention` (per-SKU count > 0) — yellow, `error` filled icon, §9.7 copy with per-channel split if both have items
  4. `sustained_transient` (≥3 consecutive cycle failures) — grey, `schedule` filled icon, §9.9 copy
  5. `paused_by_customer` — grey, `pause_circle` filled icon, §9.4 copy
  6. `provisioning` — grey defensive fallback ("Catálogo a ser carregado…")
  7. `dry_run` — blue, `science` filled icon, §9.5 copy
**And** only the highest-precedence banner renders; lower-precedence ones reappear only when the higher clears

**Given** UX-DR5 visual distinction
**When** I render the customer-paused banner (§9.4) vs the payment-failed banner (§9.6)
**Then** customer-pause uses calm grey + `pause_circle` filled
**And** payment-failed uses warning-amber + `warning` filled
**And** they DO NOT share an icon (per UX-DR5: "Same icon for both = trust failure")

**Given** keyboard accessibility per NFR-A2
**When** a banner has a CTA button (e.g., "Retomar repricing")
**Then** the button is focusable via Tab + activatable via Enter / Space
**And** ARIA roles announce the banner severity (`role="alert"` for red banners; `role="status"` for grey/blue)

**Given** the per-channel split for anomaly banner
**When** anomaly count > 0 in BOTH channels
**Then** §9.7 banner copy renders with `{N_pt} no PT · {N_es} no ES` literal split per microcopy spec

---

### Story 8.9: Interception pages — `/key-revoked`, `/payment-failed`
**GH Issue:** #43

**Implements:** UX-DR31 (key-revoked override), UX-DR32 (payment-failed first-time interception only) · **FRs:** FR43 partial (`/payment-failed`); Worten 401 detection covered in worker code · **NFRs:** NFR-L1 · **Size:** M
**SSoT modules created:** `app/src/routes/interceptions/key-revoked.js`, `app/src/routes/interceptions/payment-failed.js`, `app/src/views/pages/key-revoked.eta`, `app/src/views/pages/payment-failed.eta`
**Depends on:** Story 8.1 (interception-redirect middleware), Story 4.1 (cron_state PAUSED_BY_KEY_REVOKED + PAUSED_BY_PAYMENT_FAILURE), Story 4.3 (rotation flow at `/onboarding/key`)
**Enables:** customer recovers from mid-life key revocation OR Stripe failed payment without re-onboarding
**Visual reference pattern:** **A** — `screens/<NN>-key-revoked.html`, `screens/<NN>-payment-failed.html` per the screen→stub mapping appendix.

As a customer whose Worten key was revoked OR whose Stripe payment failed,
I want a dedicated interception page that explains what happened in PT and provides the recovery action,
So that I'm not stuck in a degraded dashboard state and can fix the issue in one click.

**Acceptance Criteria:**

**Given** the cron_state is `PAUSED_BY_KEY_REVOKED`
**When** the customer logs in for the first time post-state-transition
**Then** UX-DR31 interception triggers: redirected to `/key-revoked` (page renders with verbatim §8.1 copy)
**And** the page has prominent "Configurar nova chave →" button leading to `/onboarding/key` in **rotation mode** (UI variant of Story 4.3 noting old-key-destruction-on-success-of-validation)
**And** the page has a secondary "Como gerar uma chave Worten?" link opening Story 4.3's modal (Pattern A stub)

**Given** the customer successfully validates a new key via the rotation flow
**When** Story 4.3 completes the validation
**Then** `transitionCronState({from: 'PAUSED_BY_KEY_REVOKED', to: 'ACTIVE'})` (this transition is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-(from,to) audit event map — no audit event)
**And** the customer is redirected to `/` healthy live state
**And** NO scan repeat (catalog snapshot retained from original onboarding)
**And** NO re-onboarding required

**Given** the cron_state is `PAUSED_BY_PAYMENT_FAILURE`
**When** the customer logs in for the FIRST TIME post-state-transition (UX-DR32)
**Then** redirected to `/payment-failed` interception page with §9.6-style copy + "Atualizar pagamento" CTA → Stripe Customer Portal (Story 11.4)
**And** subsequent logins still in PAUSED_BY_PAYMENT_FAILURE state revert to `/` with persistent red banner (UX-DR32 — interception only triggers ONCE per state-transition; tracked via session state or last-shown-interception timestamp)

**Given** UX-DR2 forward-only state machine
**When** a customer NOT in PAUSED_BY_KEY_REVOKED visits `/key-revoked` directly
**Then** redirected to `/`
**And** same for `/payment-failed` — direct visits without the matching state redirect to `/`

---

### Story 8.10: `/admin/status` founder page (reuses customer audit-log UI)
**GH Issue:** #44

**Implements:** UX-DR28 (read-only, edits only via Supabase Studio), UX-DR29 (deliberately different visual register), UX-DR30 (reuse customer audit-log UI) · **FRs:** FR6, FR47 · **NFRs:** NFR-O3 · **Size:** L
**SSoT modules created:** `app/src/routes/admin/status.js`, `app/src/views/pages/admin-status.eta`, `app/src/views/components/admin-mode-banner.eta` (red banner shown when impersonating customer audit log)
**Depends on:** Story 1.5 (founder_admins seed + admin-auth middleware), Story 9.3 (5-surface query endpoints — admin reuses `/audit?as_admin={customer_id}`), Story 4.1 (cron_state schema for per-customer rollup)
**Enables:** founder Day-1 monitoring without context-switching between Supabase Studio + UptimeRobot + customer audit log
**Visual reference pattern:** **A** — `screens/<NN>-admin-status.html` per the screen→stub mapping appendix; UX-DR29 mandates deliberately different visual register (monospace dominant, dense tables, no ambient washes, slate/cool greys).

As Pedro (founder) doing Day-1 active monitoring,
I want a single read-only aggregator page showing system health + per-customer rollup + recent critical events across customers,
So that I can do the 22:47 Tuesday triage from PRD Journey 3 without context-switching three tools.

**Acceptance Criteria:**

**Given** the route `GET /admin/status` gated by Story 1.5's `founder-admin-only` middleware
**When** an authenticated founder admin (email in `founder_admins`) visits
**Then** the page renders with the layout per UX skeleton §7.2:
  - **Sistema row**: `/health` status (200 / 503), uptime % (30d), Mirakl P11 latency p95 (last 1h), PRI01 → PRI02 stuck count
  - **Customers row** (sortable by name): per-customer status pill + cron_state + last cycle age + Atenção count + winning-count / total
  - **Recent critical events row**: cross-customer audit-log tail filtered to Atenção priority, last 24h, paginated 50 per page

**Given** UX-DR29 deliberately different visual register
**When** the page renders
**Then** monospace font dominates (JetBrains Mono for tabular data)
**And** dense tables (no ambient washes, no celebratory animations)
**And** color palette uses slate/cool greys (NOT the customer dashboard's navy primary + tonal tints)
**And** if Pedro shares a screenshot, no customer thinks "why does Pedro have a different/nicer view of my data?" — the visual register makes "founder doesn't see your data the way you do" trust commitment legible

**Given** UX-DR30 reuse pattern
**When** Pedro clicks a customer row
**Then** the route opens `/audit?as_admin={customer_id}` (Story 9.3's audit-log query endpoint; admin-auth middleware reads `?as_admin=` param + verifies the requesting user is in founder_admins + uses service-role DB connection — RLS bypass)
**And** the customer-side audit log UI renders (NO duplicate UI built)
**And** a subtle red admin-mode banner across the top (`app/src/views/components/admin-mode-banner.eta`) makes the impersonation context visible: *"⚠ A ver o audit log de {customer.email} como administrador. Modo apenas leitura."*

**Given** UX-DR28 read-only posture
**When** Pedro tries to edit any customer data through `/admin/*`
**Then** there is NO edit UI — `/admin/status` is strictly read-only; edits require Supabase Studio (deliberate friction so accidental edits are impossible)
**And** the founder NEVER logs in as a customer impersonator at MVP — the `?as_admin=` reuse is read-only + service-role-bound; no auth.users impersonation

**Given** an integration test
**When** I run `tests/integration/admin-status.test.js`
**Then** it covers: founder admin sees full page; non-founder customer gets 403 (or 404 per Story 1.5's middleware); `/audit?as_admin={customer_B_id}` from founder shows customer B's audit log with red admin-mode banner; non-founder cannot use `?as_admin=` param

---

### Story 8.11: Settings sectioned navigation (5 pages)
**GH Issue:** #45

**Implements:** UX-DR22 (sectioned nav, accordion on mobile), UX-DR38 (concierge marketplace-add) · **FRs:** FR1 (account email + password change via Supabase Auth), FR4 deletion entry, FR41 MVP read-only marketplaces, FR43 billing portal link · **NFRs:** NFR-L1 · **Size:** L
**SSoT modules created:** `app/src/routes/settings/account.js`, `app/src/routes/settings/key.js`, `app/src/routes/settings/marketplaces.js`, `app/src/routes/settings/billing.js`, `app/src/routes/settings/delete.js` (delete entry — full flow lands in Epic 10), `app/src/views/pages/settings-account.eta`, `app/src/views/pages/settings-key.eta`, `app/src/views/pages/settings-marketplaces.eta`, `app/src/views/pages/settings-billing.eta`, `app/src/views/pages/settings-delete.eta`, `app/src/views/components/settings-sidebar.eta`
**Depends on:** Story 8.1 (chrome), Story 1.4 (account email/password via Supabase Auth), Story 1.2 + Story 4.3 (key vault status), Story 4.1 (marketplaces table for read-only list), Story 11.4 (Stripe Customer Portal link — interim stub if Epic 11 hasn't shipped), Story 10.1 (delete flow — Epic 10)
**Enables:** customer manages account from one section
**Visual reference pattern:** **C** — UX skeleton §4.4 settings architecture + visual-DNA tokens + consistent chrome from already-shipped designed pages. No per-page stubs (the 5 pages share consistent chrome from Epic 8's dashboard chrome).

As a customer,
I want a sectioned settings area covering account / key / marketplaces / billing / delete-entry with sidebar nav (desktop) or accordion (mobile),
So that all account management lives in one section with consistent chrome instead of scattered routes.

**Acceptance Criteria:**

**Given** `app/src/views/components/settings-sidebar.eta`
**When** rendered on desktop (≥768px viewport)
**Then** sidebar with 5 entries: Conta, Chave Worten, Marketplaces, Faturação, Eliminar conta
**And** the active section is highlighted; navigation between sections uses standard links (no SPA-style routing)
**And** below 768px the sidebar collapses to an accordion per UX-DR22 (mobile accordion)

**Given** `/settings/account`
**When** the customer visits
**Then** the page shows email (read-only at MVP — change via Supabase Auth flow) + password change form + last login timestamp
**And** the page is keyboard-accessible (NFR-A2)

**Given** `/settings/key`
**When** the customer visits
**Then** the page shows the vault status pill: *"🔒 Encriptada · Validada às {HH:MM} em {DD/MM}"* (read from `shop_api_key_vault.last_validated_at` per Story 4.3's signal)
**And** a "Rotacionar chave" button triggers the rotation flow (same UX as Story 4.3's `/onboarding/key` in rotation mode)
**And** rotation success: §5.2 confirmation copy *"A chave anterior é destruída no momento da nova validação."* + audit event NOT emitted (rotation isn't in AD20 taxonomy; the new `last_validated_at` timestamp is the signal)
**And** the page NEVER displays plaintext key material (NFR-S1)

**Given** `/settings/marketplaces` per UX-DR38
**When** the customer visits
**Then** the page shows a read-only list of active marketplaces (e.g., "Worten PT" active; "Worten ES" if added concierge — both under one shop API key for Worten per FR41 MVP)
**And** an inactive "Adicionar marketplace" button with hover tooltip: *"Contacta-nos em hello@marketpilot.pt para adicionar mais marketplaces. Tratamos de tudo: nova chave, scan, configuração — e somamos €50/mês na próxima fatura."* (verbatim per UX skeleton §8.5)
**And** there is NO "Add Marketplace" UI form / wizard (FR41 MVP — concierge-only)

**Given** `/settings/billing`
**When** the customer visits
**Then** shows current plan summary (€50 × N marketplaces/month) + next billing date + last invoice link + "Abrir Stripe Customer Portal" CTA (Story 11.4 link)
**And** until Story 11.4 ships, the CTA is a placeholder with caption *"Disponível em breve"* — non-blocking interim

**Given** `/settings/delete` (entry only — full flow in Epic 10)
**When** the customer visits
**Then** the page describes what gets wiped vs retained (per UX skeleton §8.4 Step 1 verbatim)
**And** has a "Continuar com a eliminação" button → opens Story 10.1's multi-step modal flow
**And** is discoverable but not visually prominent (small text link in bottom of `/settings/account` per UX-DR22, OR a clear sidebar entry — pick one and document)

---

### Story 8.12: Mobile-focused critical-alert response surface
**GH Issue:** #46

**Implements:** UX-DR26, UX-DR27 (mobile chrome strips channel toggle, margin editor, settings sidebar, firehose) · **FRs:** FR48 (alert delivery — recipient-side mobile rendering) · **NFRs:** NFR-P7 (≤4s on 3G mobile) · **Size:** M
**SSoT modules created:** `app/src/views/layouts/mobile-alert.eta` (stripped layout for `/?alert=X` query param), `public/css/mobile.css` (mobile breakpoint overrides)
**Depends on:** Story 8.1 (route handler detects `?alert=X` and serves stripped layout), Story 8.7 (anomaly review modal accessible mobile), Story 8.5 (pause button mobile-reachable)
**Enables:** Pedro Journey 3's "22:47 mobile critical-alert response" works as designed
**Visual reference pattern:** **A** — `screens/<NN>-mobile-critical-alert.html` per the screen→stub mapping appendix.

As a customer who receives a critical-alert email at 22:47 (PRD Journey 3's mobile moment),
I want to tap the email link and land on a stripped-down dashboard variant that shows the alert + pause + "Ver detalhes" link in a mobile-first layout,
So that I can react fast on mobile without the desktop dashboard's full chrome cluttering the surface.

**Acceptance Criteria:**

**Given** the route `GET /?alert=anomaly` (or `?alert=circuit-breaker` etc.) on mobile viewport (<768px)
**When** the request is detected
**Then** Story 8.1's route handler serves `app/src/views/layouts/mobile-alert.eta` instead of the full dashboard layout
**And** the stripped variant shows: large status banner (UX4 stack precedence per Story 8.8), pause button reachable in ≤2 taps, "Ver detalhes" link to the matching Atenção feed entry (Story 9.3)
**And** NO KPI cards, NO margin editor, NO firehose — per UX-DR27 mobile chrome strips

**Given** mobile bottom action bar per UX-DR26
**When** the stripped layout renders
**Then** a persistent bottom action bar carries pause + "ver alertas" buttons only
**And** the bar sits ABOVE iOS Safari's safe-area inset (test on iPhone SE / iPhone 14 simulators) — flagged in Step 4 Notes-for-Pedro per OQ-7

**Given** Atenção feed entry detail (UX-DR26 surface 2)
**When** the customer taps "Ver detalhes" on a single anomaly-review entry
**Then** the entry is fully readable + actionable on mobile: Story 8.7's anomaly-review modal renders mobile-optimized (accept/reject buttons stacked vertically, hit targets ≥44px)
**And** circuit-breaker-trip entries similarly fit mobile (pause / resume buttons stacked)

**Given** NFR-P7 mobile budget (≤4s on 3G)
**When** the stripped variant renders
**Then** KPI cards render skeleton/shimmer placeholders within 800ms; full data within 4s budget
**And** the Atenção feed loads from a separate lighter endpoint (count + top 3 entries) before the Notable feed loads — customer can act on critical events before full audit log is rendered (UX skeleton §6.3)
**And** firehose surface is excluded from the mobile bundle entirely (lazy-loaded only when explicitly requested — never on first paint)

---

## Epic 9: Audit Log

> **Internal sequencing — Option A locked.** Stories 9.0 and 9.1 are the **calendar-early foundation** that ships as Story 1.x siblings (BEFORE Epic 5's dispatcher), even though they're labeled Epic 9. Stories 9.2-9.6 (5-surface IA + KPI aggregates + search + firehose + archive) ship later in §I phase 7 order. Bob does NOT shard Epic 9 in numerical order — the foundation ships first per architecture's note: *"Story 9.1 (audit_log schema + writer module) is a Story 1.x sibling — must land before any feature that emits events."*

### Story 9.0: `writeAuditEvent` SSoT module + `audit_log_event_types` lookup table + 26-row AD20 taxonomy seed [CALENDAR-EARLY — Story 1.x sibling]
**GH Issue:** #8

**Implements:** AD20 (taxonomy + lookup), F5 (migration ordering) · **FRs:** FR38d (event-type taxonomy at three priority levels) · **NFRs:** NFR-S6 (append-only at app layer) · **Size:** M
**SSoT modules created:** `shared/audit/writer.js` (`writeAuditEvent`), `shared/audit/event-types.js` (enum + JSDoc `@typedef PayloadFor<EventType>` per audit event type), `eslint-rules/no-raw-INSERT-audit-log.js`
**Migrations:** `supabase/migrations/20260430120730_create_audit_log_event_types.sql` (table + 26-row seed; F5 amendment migration ordering — runs BEFORE `audit_log` partitioned base table in Story 9.1)
**Calendar-early sequencing:** SHIPS BEFORE Epic 5 dispatcher (Story 5.1 imports `writeAuditEvent`). Epic 1 stories that emit events (Story 4.1's `transitionCronState`) depend on this. Bob's sprint-ordering must front-load Story 9.0 alongside Stories 1.x even though it's labeled Epic 9.
**Depends on:** Story 1.1 (scaffold), Story 1.4 (RLS context for app-side reads — not strictly needed at this story since only the worker writes, but RLS policy on `audit_log` reads requires it)
**Enables:** Story 9.1, every event-emitting story across Epics 4-12

As Pedro (developer/founder),
I want the audit-log writer module + event_types lookup table seeded with the full AD20 taxonomy (7 Atenção + 8 Notável + 11 Rotina = 26 rows) shipped calendar-early before any event-emitting story,
So that BAD subagents writing the engine, dispatcher, billing, and lifecycle code have one canonical event emission path with one taxonomy reference and cannot drift into freeform `INSERT INTO audit_log` SQL.

**Acceptance Criteria:**

**Given** the migration `20260430120730_create_audit_log_event_types.sql`
**When** I apply it
**Then** the `audit_log_priority` enum is created with three values: `'atencao'`, `'notavel'`, `'rotina'` (lowercase taxonomic, no diacritics for SQL safety per architecture pattern doc)
**And** the `audit_log_event_types` lookup table exists with columns: `event_type TEXT PRIMARY KEY`, `priority audit_log_priority NOT NULL`, `description TEXT NOT NULL` (PT-localized hint)
**And** the migration seeds **exactly 26 rows** matching architecture AD20's enumerated taxonomy:
  - **7 Atenção rows:** `anomaly-freeze`, `circuit-breaker-trip`, `circuit-breaker-per-sku-trip`, `key-validation-fail`, `pri01-fail-persistent`, `payment-failure-pause`, `shop-name-collision-detected`
  - **8 Notável rows:** `external-change-absorbed`, `position-won`, `position-lost`, `new-competitor-entered`, `large-price-move-within-tolerance`, `customer-paused`, `customer-resumed`, `scan-complete-with-issues`
  - **11 Rotina rows:** `undercut-decision`, `ceiling-raise-decision`, `hold-floor-bound`, `hold-ceiling-bound`, `hold-already-in-1st`, `cycle-start`, `cycle-end`, `pri01-submit`, `pri02-complete`, `pri02-failed-transient`, `tier-transition`
**And** each row's `description` is a short PT-localized hint (e.g., for `anomaly-freeze`: *"Mudança externa de preço >40% — congelado para revisão"*)
**And** an integration test asserts `SELECT COUNT(*) FROM audit_log_event_types` returns exactly 26
**And** there is no FK from `audit_log_event_types.event_type` to anything (it's a lookup table; FKs flow inward — `audit_log.event_type → audit_log_event_types.event_type`)

**Given** `shared/audit/event-types.js`
**When** I open the file
**Then** it exports a `EVENT_TYPES` constant (object literal) mirroring the 26 seeded rows + their priorities — used as the JS-side single-source-of-truth for event_type strings
**And** for each event_type, a JSDoc `@typedef PayloadFor<EventType>` documents the structured payload shape (e.g., `PayloadForExternalChangeAbsorbed = { previousListPriceCents: number, newListPriceCents: number, deviationPct: number }`)
**And** subagents adding a new event_type MUST add the migration row + the typedef + the constant in the same PR

**Given** `shared/audit/writer.js` exports `writeAuditEvent({tx, customerMarketplaceId, skuId, skuChannelId, eventType, cycleId, payload})`
**When** called inside an active transaction
**Then** the function INSERTs into `audit_log` (table created in Story 9.1) with the provided fields
**And** `priority` is NOT explicitly set — it's derived by Story 9.1's `audit_log_set_priority` BEFORE INSERT trigger
**And** if `eventType` is not in `EVENT_TYPES` constant, the function throws `UnknownEventTypeError` (additional guard alongside Story 9.1's trigger-level RAISE EXCEPTION)
**And** the `payload` JSONB field is required NON-NULL (architecture mandates structured payload, never freeform string)

**Given** the custom ESLint rule `eslint-rules/no-raw-INSERT-audit-log.js`
**When** ESLint runs
**Then** any `INSERT INTO audit_log` raw SQL OR `client.from('audit_log').insert(...)` Supabase-style insert OUTSIDE `shared/audit/writer.js` triggers a lint error: *"Raw audit_log INSERT forbidden. Use shared/audit/writer.js's writeAuditEvent for all audit emissions."*
**And** the rule's allowlist is `shared/audit/writer.js` (the only legitimate INSERT path)
**And** Story 1.1's ESLint config is updated to load this rule

**Given** the calendar-early shipping order
**When** Bob shards the sprint
**Then** Stories 9.0 and 9.1 are scheduled to ship BEFORE Story 5.1 (dispatcher) — even though Epic 9's UI portion ships in §I phase 7 order
**And** the sprint-status doc explicitly notes the out-of-numerical-order shipping for Stories 9.0 + 9.1

---

### Story 9.1: `audit_log` partitioned base table + priority-derivation trigger + initial partition + monthly partition cron [CALENDAR-EARLY — Story 1.x sibling]
**GH Issue:** #9

**Implements:** AD19 (with F8 — no FK on sku_id / sku_channel_id), AD20 (priority trigger) · **FRs:** FR37 partial (storage layer) · **NFRs:** NFR-S6, NFR-P8 (foundation) · **Size:** L
**SSoT modules created:** `worker/src/jobs/monthly-partition-create.js`
**Migrations:** `supabase/migrations/202604301208_create_audit_log_partitioned.sql` (partitioned base table + initial month partition + priority trigger function)
**Calendar-early sequencing:** SHIPS BEFORE Epic 5 alongside Story 9.0. Order within Epic 1: Story 9.0 → Story 9.1 → all event-emitting stories.
**Depends on:** Story 9.0 (event_types lookup must exist for FK), Story 1.1 (worker for cron), Story 2.1 (RLS clients)
**Enables:** Story 9.0's `writeAuditEvent` has a table to write to; every event-emitting story across Epics 4-12 produces persisted rows

As Pedro (developer/founder),
I want the partitioned `audit_log` base table with the F8-amended schema (sku_id and sku_channel_id carry NO FK constraint to preserve audit history through SKU lifecycle), the priority-derivation trigger, the initial month's partition, and the monthly-partition-create cron,
So that audit emissions from day 1 land in a queryable durable table and partition rotation is automated without manual ops.

**Acceptance Criteria:**

**Given** the migration `202604301208_create_audit_log_partitioned.sql`
**When** I apply it
**Then** the `audit_log` base table exists per architecture's schema:
  - `id uuid NOT NULL DEFAULT gen_random_uuid()`
  - `customer_marketplace_id uuid NOT NULL`
  - `sku_id uuid` — **NO FK constraint per F8 amendment** (preserves audit history if a SKU is later removed from catalog; audit log is immutable per NFR-S6, referential integrity to ephemeral catalog rows would compromise that)
  - `sku_channel_id uuid` — **NO FK constraint per F8 amendment** (same rationale)
  - `cycle_id uuid` — null outside cycle context
  - `event_type text NOT NULL REFERENCES audit_log_event_types(event_type)` (FK to lookup table is OK — event_types is a versioned schema, not ephemeral catalog data)
  - `priority audit_log_priority NOT NULL` (denormalized via trigger)
  - `payload jsonb NOT NULL` (structured per @typedef)
  - `resolved_at timestamptz` (for Atenção events resolved by customer per Story 7.4 + Story 7.6)
  - `created_at timestamptz NOT NULL DEFAULT NOW()`
  - `PRIMARY KEY (id, created_at)` (composite for partitioning)
**And** the table is `PARTITION BY RANGE (created_at)`
**And** an inline schema comment documents the F8 no-FK rationale (so future devs don't reflexively add the FK "for cleanliness")

**Given** the initial month partition
**When** the migration runs in May 2026 (or whatever month MVP launches)
**Then** the partition `audit_log_2026_05` (or `audit_log_<YYYY>_<MM>` matching launch month) is created `FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')`
**And** Bob seeds 12 months ahead manually as part of this story (Story 9.1's migration creates partitions through `audit_log_2027_04`)
**And** subsequent month creation is automated by the cron (below)

**Given** the priority-derivation trigger
**When** an `INSERT INTO audit_log` runs
**Then** the `audit_log_set_priority` BEFORE INSERT trigger function fires:
  ```sql
  SELECT priority INTO NEW.priority FROM audit_log_event_types WHERE event_type = NEW.event_type;
  IF NEW.priority IS NULL THEN
    RAISE EXCEPTION 'Unknown audit_log event_type: %', NEW.event_type;
  END IF;
  ```
**And** the trigger guarantees `audit_log.priority` always matches the lookup table — denormalization is internally consistent

**Given** the compound indexes per AD19
**When** I inspect the schema
**Then** the following indexes exist on the partitioned base table (Postgres propagates to partitions):
  - `idx_audit_log_customer_created ON audit_log(customer_marketplace_id, created_at DESC)` — primary
  - `idx_audit_log_customer_sku_created ON audit_log(customer_marketplace_id, sku_id, created_at DESC) WHERE sku_id IS NOT NULL` — search-by-SKU surface (Story 9.4)
  - `idx_audit_log_customer_eventtype_created ON audit_log(customer_marketplace_id, event_type, created_at DESC)` — feed filtering (Story 9.3)
  - `idx_audit_log_customer_cycle ON audit_log(customer_marketplace_id, cycle_id, sku_id) WHERE cycle_id IS NOT NULL` — firehose drill-down (Story 9.5)

**Given** RLS policies on the partitioned table
**When** customer A queries `audit_log` via the RLS-aware client
**Then** customer A only sees their own customer_marketplace_id rows
**And** INSERT/UPDATE/DELETE are forbidden for customers (NFR-S6 append-only at app layer; only worker via service-role inserts)
**And** `scripts/rls-regression-suite.js` extended with `audit_log` partitioned table coverage

**Given** `worker/src/jobs/monthly-partition-create.js` registered with `node-cron` to run on the 28th of each month at 02:00 Lisbon (`0 2 28 * *` with TZ adjustment)
**When** the cron tick fires
**Then** the job creates the partition for the FOLLOWING month (e.g., on May 28th 02:00 → creates `audit_log_2026_07` for July if not exists; the buffer ensures partitions exist before they're needed)
**And** uses `IF NOT EXISTS` semantics — safe to re-run idempotently
**And** logs at `info` level via pino with the new partition's date range
**And** if the create fails (e.g., partition already exists, schema mismatch), logs at `error` level + emits an audit event `cycle-fail-sustained` (or admin-only alert — Bob picks)

**Given** an integration test
**When** I run `tests/integration/audit-log-partition.test.js`
**Then** it covers: trigger-driven priority derivation; INSERT with unknown event_type raises EXCEPTION; INSERT for a known event_type lands in the correct month's partition; cross-tenant SELECT returns 0 rows (RLS); compound index hit verified via EXPLAIN

---

### Story 9.2: `daily_kpi_snapshots` + `cycle_summaries` schemas + daily-aggregate cron + 5-min "today" partial refresh
**GH Issue:** #47

**Implements:** AD19 (precomputed aggregates), Story 8.2 KPI cards' data source · **FRs:** FR34 partial (data) · **NFRs:** NFR-P8 (≤2s on 90-day window — aggregates make this feasible) · **Size:** M
**SSoT modules created:** `worker/src/jobs/daily-kpi-aggregate.js`, `worker/src/engine/kpi-derive.js` (cycle-end aggregation → cycle_summaries; consumed by Story 5.2's cycle-end hook)
**Migrations:** `supabase/migrations/202604301209_create_daily_kpi_snapshots.sql`, `supabase/migrations/202604301210_create_cycle_summaries.sql`
**Depends on:** Story 9.0 + Story 9.1 (audit_log foundation), Story 5.2 (cycle-end hook), Story 4.1 (customer_marketplace), Story 4.2 (sku_channels for tier-derived counts)
**Enables:** Story 8.2 KPI cards consume `daily_kpi_snapshots`; Story 9.5 firehose consumes `cycle_summaries`

As Pedro (developer/founder),
I want precomputed daily KPI snapshots and per-cycle summaries refreshed by daily + 5-min crons,
So that the dashboard's KPI cards (Story 8.2) and the firehose (Story 9.5) hit indexes on small tables instead of computing aggregates over multi-million-row `audit_log` partitions on every render.

**Acceptance Criteria:**

**Given** the migration `202604301209_create_daily_kpi_snapshots.sql`
**When** applied
**Then** `daily_kpi_snapshots` table exists per architecture: composite PK `(customer_marketplace_id, channel_code, date)`, columns for skus_in_first_count, skus_losing_count, skus_exclusive_count, catalog_value_at_risk_cents, undercut_count, ceiling_raise_count, hold_count, external_change_absorbed_count, anomaly_freeze_count, refreshed_at
**And** index `idx_daily_kpi_snapshots_date ON daily_kpi_snapshots(date)`
**And** RLS policy for customer-own access via customer_marketplace_id chain
**And** RLS regression suite extended

**Given** the migration `202604301210_create_cycle_summaries.sql`
**When** applied
**Then** `cycle_summaries` table exists per architecture: cycle_id PK, customer_marketplace_id FK CASCADE, started_at, completed_at, tier_breakdown JSONB (e.g., `{"1": 300, "2a": 50, "2b": 100, "3": 20}`), undercut_count, ceiling_raise_count, hold_count, failure_count, circuit_breaker_tripped boolean, skus_processed_count
**And** index `idx_cycle_summaries_customer_started ON cycle_summaries(customer_marketplace_id, started_at DESC)`
**And** RLS policy + regression suite extension

**Given** `worker/src/engine/kpi-derive.js` is called at cycle-end by Story 5.2's cycle-assembly
**When** a cycle completes
**Then** the function INSERTs a `cycle_summaries` row with the aggregated counts derived from the cycle's audit events + sku_channels state
**And** the INSERT is in the same transaction as the cycle-end audit event (atomicity: cycle_summaries.cycle_id matches the dispatcher's cycle_id)

**Given** `worker/src/jobs/daily-kpi-aggregate.js` registered with `node-cron`
**When** it runs at midnight Lisbon (`0 0 * * *`)
**Then** for each active customer_marketplace, computes yesterday's `daily_kpi_snapshots` row from yesterday's `audit_log` events + sku_channels state-at-midnight snapshot
**And** UPSERTs the row keyed on `(customer_marketplace_id, channel_code, date=yesterday)`

**Given** the 5-min "today" partial refresh
**When** the same cron tick fires every 5 minutes (separate sub-job within `daily-kpi-aggregate.js` or a sibling cron)
**Then** for each active customer_marketplace, recomputes today's `daily_kpi_snapshots` row incrementally from the day's audit events
**And** UPSERTs keyed on `(customer_marketplace_id, channel_code, date=today)`
**And** `refreshed_at` is updated so Story 8.2 can show "Atualização há 3min" if needed

---

### Story 9.3: 5-surface query endpoints — `/audit` root with Daily summary + Atenção feed + Notável feed
**GH Issue:** #48

**Implements:** UX-DR7 (daily summary), UX-DR8 (Atenção feed expanded by default), UX-DR9 (Notável feed collapsed-by-default), UX-DR12 (every event accessible via search/firehose) · **FRs:** FR37, FR38, FR38b, FR38d · **NFRs:** NFR-P8, NFR-A3, NFR-L1 · **Size:** L
**SSoT modules created:** `app/src/routes/audit/index.js` (`GET /audit`), `app/src/routes/audit/_fragments/atencao-feed.js`, `app/src/routes/audit/_fragments/notavel-feed.js`, `app/src/views/pages/audit.eta`, `app/src/views/components/audit-feeds.eta`, `shared/audit/readers.js` (query helpers for the 5 surfaces — single-source-of-truth for audit reads)
**Depends on:** Story 8.1 (chrome), Story 9.0 + Story 9.1 (audit foundation), Story 9.2 (daily_kpi_snapshots for the summary card)
**Enables:** Story 9.4 (search), Story 9.5 (firehose), Story 8.10 admin reuse via `?as_admin=`
**Visual reference pattern:** **A** — `screens/<NN>-audit-root.html` per the screen→stub mapping appendix.

As a customer investigating engine actions,
I want the `/audit` root with three surfaces (Daily summary card + Atenção feed + Notável feed) ordered by hierarchical priority, with HTMX-ready fragment URLs,
So that the highest-priority signals reach me first and I never need to scroll a flat chronological feed.

**Acceptance Criteria:**

**Given** the route `GET /audit`
**When** an authenticated customer visits
**Then** the page renders 3 surfaces stacked per UX skeleton §4.1:
  1. **Daily summary card** at top (UX-DR7): aggregate counts from `daily_kpi_snapshots` today's row + position deltas vs yesterday; counts are clickable links that filter the Notável feed (e.g., clicking "12 absorções ERP" → filters Notável to `external-change-absorbed` for today)
  2. **Atenção feed** (UX-DR8): events from AD20 Atenção set (anomaly-freeze, circuit-breaker-trip, circuit-breaker-per-sku-trip, key-validation-fail, pri01-fail-persistent, payment-failure-pause, shop-name-collision-detected) where `resolved_at IS NULL`, last 30 days, ORDER BY created_at DESC LIMIT 50; rendered EXPANDED by default (UX-DR8); when 0 items: green confirmation copy *"Nada que precise da tua atenção."*
  3. **Notável feed** (UX-DR9): events from AD20 Notável set, last 30 days, ORDER BY created_at DESC LIMIT 30 (capped); rendered COLLAPSED by default (one-line summary), expand on click; "Ver todos" link → firehose-filtered

**Given** UX-DR9 per-channel filter chip pinned above Notável feed (PT · ES · Ambos)
**When** the customer clicks a chip
**Then** the feed re-queries with the channel filter applied
**And** the filter persists in URL (`?channel=PT`) for shareable / bookmarkable views

**Given** HTMX-ready fragment endpoints per architecture's URL convention
**When** the Notável feed needs to re-render (e.g., filter change)
**Then** `GET /audit/_fragments/notavel-feed?channel=PT` returns a discrete HTML fragment (not a full page)
**And** same for `GET /audit/_fragments/atencao-feed`
**And** at MVP these are full-page reloads (no HTMX library); the URL convention is reserved so Phase 2 HTMX upgrade is a configuration change

**Given** UX-DR12 (every event accessible)
**When** the customer needs to find a Rotina event (e.g., a specific cycle's `pri01-submit`)
**Then** they go to Story 9.4 (search by SKU) OR Story 9.5 (firehose) — Rotina events are NOT in the default feeds but ARE in the storage and queryable
**And** the Daily summary card includes a small "Mostrar todos os ajustes" link that navigates to Story 9.5 firehose

**Given** NFR-P8 ≤2s response on 90-day window
**When** the audit query for the Atenção feed runs
**Then** it hits `idx_audit_log_customer_eventtype_created` (Story 9.1) for the relevant event_types, and completes in <2s on a 50k-SKU contested catalog's 90-day audit_log
**And** the Daily summary card hits `daily_kpi_snapshots` (Story 9.2's precomputed aggregate) — sub-100ms

**Given** RLS on `/audit`
**When** customer A visits with a JWT scoped to customer A
**Then** they only see customer A's audit events (no manual filter needed in route code — RLS does it)
**And** `?as_admin={customer_B_id}` from a non-founder returns 404 per Story 1.5 (admin-auth gates the param)
**And** founder admin via `?as_admin=` reads customer B's events through service-role bypass with admin-mode banner per Story 8.10

---

### Story 9.4: Search by SKU/EAN endpoint (primary investigation primitive)
**GH Issue:** #49

**Implements:** UX-DR10 (sticky-top search), UX-DR12 (search exposes all event types for a single SKU) · **FRs:** FR38 partial (filter by SKU/EAN) · **NFRs:** NFR-P8 · **Size:** M
**SSoT modules created:** `app/src/routes/audit/search.js` (`GET /audit?sku={EAN}`), `app/src/routes/audit/_fragments/search-by-sku.js`, `app/src/views/components/search-by-sku.eta`
**Depends on:** Story 9.3 (audit chrome reused), Story 9.0 + Story 9.1
**Enables:** Story 9.5 firehose drill-down can also expand to search-by-SKU; Story 8.7 anomaly-review modal "Ver histórico" link
**Visual reference pattern:** **A** — `screens/<NN>-audit-search-by-sku.html` per the screen→stub mapping appendix.

As a customer investigating a specific SKU's history (PRD Journey 4: Tony's warehouse-manager scenario, 90 seconds end-to-end),
I want a sticky-top search that takes an EAN or product name and returns ALL events for that one SKU chronologically,
So that the most common investigation pattern is the most prominent affordance.

**Acceptance Criteria:**

**Given** the search box on `/audit` (rendered at top per UX-DR10 sticky-top)
**When** the customer types an EAN or partial product name and submits
**Then** route handler resolves to the matching sku_id via:
  - If EAN matches `skus.ean` (12-13 digit numeric) → exact match
  - Otherwise → ILIKE on `skus.product_title` returning top 5 candidates with disambiguation list

**Given** an exact SKU match
**When** the route renders results
**Then** it shows ALL events (Atenção + Notável + Rotina — UX-DR10 / UX-DR12) for that one SKU in chronological order (most recent first), within the active date range (default last 90 days)
**And** each event shows: timestamp, event_type label, scope (channel if applicable), structured payload data formatted via PT helpers (e.g., `external-change-absorbed` shows previous + new + deviation%)
**And** the result page replaces the 3 stacked surfaces (Daily summary + Atenção + Notável) — search-result view is the primary view when active

**Given** date-range filter per UX skeleton §3.5
**When** the customer opens the date-range popover
**Then** quick ranges: Hoje · Últimos 7 · Últimos 30 · Últimos 90 · Personalizado
**And** ranges >90 days show warning *"Filtros >90 dias podem demorar mais"* (per UX skeleton §3.5)

**Given** NFR-P8 ≤2s response on 90-day window
**When** the search-by-SKU query runs
**Then** it hits `idx_audit_log_customer_sku_created` (Story 9.1) and completes in <2s for a 90-day window with up to ~10k events for a single SKU

**Given** UX-DR10 search is the primary investigation pattern
**When** `/audit` loads with NO Atenção items (steady state — common case)
**Then** the search box auto-focuses (per UX-DR10) so the customer can type immediately
**And** when Atenção items > 0, the search box does NOT auto-focus (Atenção items take visual priority)

**Given** the empty-result state
**When** an EAN search returns 0 events
**Then** the page shows *"Nenhum evento para EAN {X} nos últimos 90 dias."* (verbatim per UX skeleton §3.5)

---

### Story 9.5: Firehose `/audit/firehose` — cycle-aggregated view with lazy-loaded SKU expansion
**GH Issue:** #50

**Implements:** UX-DR11 (opt-in, paginated 50/page), UX-DR12 (firehose preserves trust property) · **FRs:** FR37, FR38c (cycle-aggregated NOT flat) · **NFRs:** NFR-P8 · **Size:** M
**SSoT modules created:** `app/src/routes/audit/firehose.js` (`GET /audit/firehose`), `app/src/views/pages/audit-firehose.eta`
**Depends on:** Story 9.3 (audit chrome), Story 9.2 (cycle_summaries — firehose root reads this; SKU expansion lazy-loads from audit_log)
**Enables:** customer can verify "show me everything" trust property on demand
**Visual reference pattern:** **A** — `screens/<NN>-audit-firehose.html` per the screen→stub mapping appendix.

As a customer who wants trust-verification ("show me everything the engine did"),
I want a firehose view that's cycle-aggregated (one row per cycle showing aggregate counts), NOT flat per-SKU, with per-SKU detail expandable on click,
So that even at 3M-events/quarter volume the firehose stays digestible and respects NFR-P8.

**Acceptance Criteria:**

**Given** the route `GET /audit/firehose`
**When** the customer clicks "Mostrar todos os ajustes" link from the Daily summary card OR navigates directly
**Then** the page renders cycle rows (NOT individual events) — one row per cycle showing aggregate counts per UX skeleton §4.1.5:
  ```
  03:14 ciclo (Tier 1 + Tier 2a — 47 ações)              ▾
    ↓ 43 undercuts · preço médio: -€2,14
    ↑ 4 aumentos · preço médio: +€1,87
    ⏸ 12 holds · 3 abaixo do floor, 9 já em 1.º
    [Expandir SKUs ▸]
  ```
**And** data comes from `cycle_summaries` (Story 9.2) — sub-100ms even on 90-day windows
**And** UX-DR11 pagination: 50 cycles per page; "Próxima página →" link

**Given** the customer clicks "Expandir SKUs ▸" on a cycle row
**When** the lazy-load fires
**Then** an HTMX-ready fragment endpoint (`GET /audit/firehose/cycle/:cycleId/skus`) returns the per-SKU detail for that cycle: each SKU row shows decision (UNDERCUT / CEILING_RAISE / HOLD) + competitor context + tolerance band
**And** the SKU expansion query uses `idx_audit_log_customer_cycle` (Story 9.1)
**And** drill-down past the SKU level → individual events for that (cycle_id, sku_id) tuple

**Given** UX-DR11 firehose is opt-in
**When** I inspect the dashboard root and `/audit` root
**Then** the firehose surface is NOT visible by default; access only via the explicit "Mostrar todos os ajustes" link OR direct URL navigation
**And** mobile bundle excludes the firehose entirely (UX-DR27 — lazy-loaded only when explicitly requested)

**Given** UX-DR12 trust property
**When** the firehose drill-down expands per-SKU
**Then** EVERY event for that (cycle_id, sku_id) is rendered (Atenção + Notável + Rotina) — the firehose is the "show me everything" surface

---

### Story 9.6: Audit-log archive job — detach old partitions per AD19 retention semantics
**GH Issue:** #51

**Implements:** AD19 (archive policy), Pedro's audit_log retention clarification (T+7d hard delete: zero fiscal-evidence exceptions; all rows wiped — fiscal evidence lives in `moloni_invoices`) · **FRs:** FR4 + NFR-S6 retention · **Size:** S
**SSoT modules created:** `worker/src/jobs/audit-log-archive.js`
**Depends on:** Story 9.1 (partitioned base table), Story 10.1 (deletion grace cron — coordinated retention)
**Enables:** long-term storage management without manual ops

As Pedro (developer/founder),
I want a monthly archive job that detaches old partitions per AD19's retention rules — Notável/Rotina older than 90 days detached and archived; Atenção retained per NFR-S6 customer-account lifetime — and that respects the FR4 deletion semantic (zero fiscal exceptions; all wiped),
So that the audit_log doesn't grow unbounded and FR4 hard-delete at T+7d wipes all customer audit data cleanly.

**Acceptance Criteria:**

**Given** `worker/src/jobs/audit-log-archive.js` registered with `node-cron` to run on the 1st of each month at 03:00 Lisbon (`0 3 1 * *`)
**When** the cron tick fires
**Then** the job iterates partitions older than 90 days
**And** for each old partition: COPYs Atenção rows to a long-term archive table (`audit_log_atencao_archive` — single non-partitioned table per architecture's intent)
**And** detaches the partition from the parent (`ALTER TABLE audit_log DETACH PARTITION audit_log_<YYYY>_<MM>`)
**And** retains Atenção via the archive copy; drops Notável + Rotina from the detached partition (or archives them to S3-equivalent — Bob picks; at MVP simplest is in-DB archive table)
**And** logs at `info` level via pino with stats (rows archived, rows dropped, partition detached)

**Given** the FR4 deletion at T+7d hard-delete (Story 10.3)
**When** the deletion cron processes an account
**Then** ALL audit_log rows for that customer_marketplace_id are wiped — including the Atenção archive (since the architectural retention rationale is "customer-account lifetime"; once the account is hard-deleted, retention ends)
**And** zero rows are retained as "fiscal evidence" — fiscal evidence lives in `moloni_invoices` (separate table per AD22, separate retention per Portuguese fiscal law)
**And** an integration test asserts: simulate a deletion at T+7d → query `audit_log` + `audit_log_atencao_archive` for the customer_marketplace_id → 0 rows in both

**Given** the archive job is non-disruptive
**When** it runs during normal operations
**Then** it doesn't lock active partitions (only detaches partitions older than 90 days)
**And** ongoing INSERTs to current month's partition are unaffected

---

## Epic 10: Account Deletion & Grace

### Story 10.1: `/settings/delete` multi-step initiation + ELIMINAR phrase + key destruction at INITIATION + Stripe `cancel_at_period_end`
**GH Issue:** #52

**Implements:** AD21 (initiation half) · **FRs:** FR4 amended (steps 1-3) · **NFRs:** NFR-S1 (encrypted key destruction at initiation as security commitment), NFR-S6 · **Size:** L
**SSoT modules created:** `app/src/routes/settings/delete.js` (multi-step routes), `app/src/views/pages/settings-delete.eta` (Step 1 page), `app/src/views/modals/delete-confirm.eta` (Step 2 ELIMINAR + email modal), `public/js/delete-account.js` (client-side ELIMINAR phrase validation)
**Migrations:** none (uses existing `customers.deletion_initiated_at` + `deletion_scheduled_at` + `customer_marketplaces.cron_state` enum)
**Depends on:** Story 1.2 (envelope encryption — for vault destruction), Story 4.1 (`PAUSED_BY_ACCOUNT_GRACE_PERIOD` cron_state value), Story 4.6 (`shared/resend/client.js` for confirmation email — Story 12.2 extends with PT template), Story 8.11 (settings sectioned navigation surfaces `/settings/delete`), Story 11.1 (`cancelSubscriptionAtPeriodEnd` helper), Story 9.0 + Story 9.1 (audit foundation — note: `(ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD)` is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-(from,to) audit event map per Story 4.1, so no audit event fires on deletion-initiation transition; the customer-visible signal is the email + grace banner)
**Enables:** Stories 10.2 (cancel-mid-grace), 10.3 (T+7d hard-delete cron)
**Visual reference pattern:** **A** — `screens/<NN>-settings-delete-step1.html` (warning page) and `screens/<NN>-delete-confirm-modal.html` (Step 2 modal) per the screen→stub mapping appendix.

As a customer who decides to delete their account,
I want a 4-step deletion flow that requires typing `ELIMINAR` + my email, with the encrypted shop API key destroyed at INITIATION (not grace-end) and the Stripe subscription set to `cancel_at_period_end=true` immediately,
So that the security commitment "the moment you say delete, the key is gone" is honored, and Stripe stops renewing without auto-charging me again.

**Acceptance Criteria:**

**Given** the route `GET /settings/delete` (Step 1)
**When** an authenticated customer visits
**Then** the page renders verbatim §8.4 Step 1 copy: warning header + "what gets wiped" list (encrypted key destroyed at initiation, catalog snapshot, baselines, audit log, all margin configs) + "what stays" list (Moloni invoice metadata as fiscal record per AD22) + "Continuar com a eliminação" button
**And** the page is keyboard-accessible (NFR-A2); back-button navigates to `/settings/account` cleanly

**Given** the customer clicks "Continuar"
**When** the Step 2 modal opens (`app/src/views/modals/delete-confirm.eta`)
**Then** the modal renders verbatim §8.4 Step 2 + §9.12 Step 2 copy: "Para confirmar, escreve ELIMINAR e o teu email:" + two text inputs + [Cancelar] [Iniciar eliminação] buttons
**And** the "Iniciar eliminação" button is disabled until BOTH inputs match: ELIMINAR (case-sensitive exact) AND the customer's email (case-insensitive exact match against `customers.email`)
**And** client-side validation in `public/js/delete-account.js` enforces this; server-side re-validates on POST

**Given** the customer submits with both fields valid (Step 3)
**When** `POST /settings/delete/confirm` runs
**Then** in ONE transaction (via shared/db/tx.js):
  1. **Destroy encrypted key**: UPDATE `shop_api_key_vault` SET `ciphertext = NULL, nonce = NULL, auth_tag = NULL` WHERE `customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = $1)` — security commitment per AD21 + NFR-S1; the vault row exists for audit but the cryptographic material is gone (acceptable Bob alternative: DELETE the row entirely — choice is documented in Story 10.1's PR)
  2. **Transition cron_state for ALL customer's marketplaces**: for each marketplace, `transitionCronState({tx, from: <current>, to: 'PAUSED_BY_ACCOUNT_GRACE_PERIOD'})` — this `(from, to)` is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-(from,to) audit event map (no audit event)
  3. **Persist deletion timestamps**: UPDATE `customers` SET `deletion_initiated_at = NOW(), deletion_scheduled_at = NOW() + INTERVAL '7 days'` WHERE `id = $1`
  4. **Cancel Stripe subscription**: call `shared/stripe/subscriptions.js`'s `cancelSubscriptionAtPeriodEnd({customerId})` (Story 11.1) — Stripe stops renewing at end of current billing period; NO automatic refund for grace-period days
  5. **Send confirmation email** via `shared/resend/client.js` (Story 4.6 + Story 12.2 extension) using template `deletion-confirmation.eta` with magic-link URL containing a signed token: `https://app.marketpilot.pt/settings/cancel-deletion?token=<signed_token>`
  6. **Lock dashboard** (subsequent dashboard renders show grace-period read-only banner per UX-DR36 + §9.12 — Story 10.2 surface)
**And** the route returns a Step 3 toast per §9.12: *"Eliminação agendada para {date_T+7}. Tens 7 dias para mudar de ideias..."*

**Given** any step in the transaction throws
**When** the failure is caught
**Then** the transaction rolls back — partial-state recovery is impossible
**And** the route returns a generic 500 with PT-localized error
**And** the customer's account is unchanged (no key destruction, no cron_state transition, no Stripe call — atomicity invariant)

**Given** the customer has multiple marketplaces (e.g., Tony @ You Get with 5)
**When** deletion is initiated
**Then** ALL marketplaces transition to `PAUSED_BY_ACCOUNT_GRACE_PERIOD` (per AD21 — cron paused for all)
**And** Stripe Subscription is canceled at period end (one Subscription per customer per F2 — covers all SubscriptionItems)

**Given** an integration test
**When** I run `tests/integration/deletion-initiation.test.js`
**Then** it covers: happy-path initiation → all 5 transactional steps complete; key destruction verified (vault row's ciphertext IS NULL); cron_state transitions verified for ALL customer's marketplaces; Stripe API mock receives cancelSubscription call with cancel_at_period_end=true; confirmation email sent (mock Resend received it); deletion_initiated_at set on customers; rollback on failure leaves zero changes

---

### Story 10.2: Cancel-mid-grace flow (magic link in email + dashboard "Cancelar eliminação" banner button)
**GH Issue:** #53

**Implements:** AD21 (cancel-mid-grace half), UX-DR36 (grace banner with cancel button), UX-DR37 (magic link in confirmation email) · **FRs:** FR4 amended (cancel during grace) · **Size:** M
**SSoT modules created:** `app/src/routes/settings/cancel-deletion.js`, `app/src/views/pages/cancel-deletion-confirm.eta`, magic-link signed-token verification helper in `app/src/lib/signed-tokens.js`
**Depends on:** Story 10.1 (sets deletion_initiated_at + sends email with magic link), Story 8.8 (banner library renders the grace banner with cancel button)
**Enables:** customer can abort deletion mid-grace via email link OR dashboard banner
**Visual reference pattern:** **A** — grace banner rendered within `screens/<NN>-grace-period-banner.html` per the screen→stub mapping appendix; cancel-deletion confirmation page at `screens/<NN>-cancel-deletion-confirm.html`.

As a customer who initiated deletion but changed my mind within the 7-day grace,
I want two paths to cancel — clicking the magic link in my confirmation email OR clicking "Cancelar eliminação" in the dashboard banner —
So that I can recover my account easily, even if I no longer have the original email at hand.

**Acceptance Criteria:**

**Given** the magic-link URL `https://app.marketpilot.pt/settings/cancel-deletion?token=<signed_token>`
**When** the customer clicks it
**Then** the route verifies the signed token (HMAC-signed with a server-side secret in env; payload includes customer_id + deletion_initiated_at; expires at deletion_scheduled_at)
**And** if token is valid AND the customer's `customers.deletion_initiated_at IS NOT NULL` (deletion still pending) → renders the cancel-deletion confirmation page
**And** if token is invalid OR expired → renders an error page with link to `/login`

**Given** the dashboard banner per UX-DR36 + §9.12 ("Conta em eliminação · Faltam {N} dia(s)")
**When** the customer clicks "Cancelar eliminação"
**Then** the same `POST /settings/cancel-deletion` runs (without token — uses session auth)

**Given** `POST /settings/cancel-deletion`
**When** the route runs
**Then** in ONE transaction:
  1. UPDATE `customers` SET `deletion_initiated_at = NULL, deletion_scheduled_at = NULL` WHERE `id = $1`
  2. For each customer_marketplace: `transitionCronState({tx, from: 'PAUSED_BY_ACCOUNT_GRACE_PERIOD', to: 'DRY_RUN'})` — NOT directly to `'ACTIVE'` per AD21 (customer must re-enter Stripe payment to reactivate, since the prior Subscription is already canceling)
  3. **NOTE:** Stripe subscription is already canceling (cancel_at_period_end=true was set at initiation per Story 10.1) — cancel-mid-grace does NOT auto-reactivate Stripe; the customer must visit `/settings/billing` and re-enter Stripe payment from scratch (Story 11.3) to flip back to ACTIVE
  4. **NOTE:** The encrypted key was destroyed at initiation (Story 10.1) — the customer must visit `/onboarding/key` (rotation flow per UX-DR31) to re-validate a key before the engine can run; the existing catalog snapshot + baselines + sku_channels are retained (CASCADE was NOT run since customer_marketplaces still exist; only the vault row's ciphertext was nulled)
  5. Send "Eliminação cancelada" confirmation email via `shared/resend/client.js`

**Given** the post-cancel state
**When** the customer logs in after canceling
**Then** the dashboard renders in DRY_RUN state (per Story 8.1's state-aware view)
**And** UX-DR3 interception logic recognizes the state — customer sees the dry-run banner + minimal dashboard (catalog snapshot retained but engine cannot run without a key)
**And** the customer is gently guided to either (a) re-enter the Worten key via /onboarding/key (rotation flow) or (b) re-enter Stripe payment via /settings/billing — both gates must be re-satisfied to reach ACTIVE

**Given** an integration test
**When** I run `tests/integration/cancel-mid-grace.test.js`
**Then** it covers: magic-link path with valid token → state restored to DRY_RUN; magic-link path with expired/invalid token → error page; dashboard-banner path with session auth → same restoration; cron_state transitions for ALL marketplaces back to DRY_RUN; deletion timestamps cleared; encrypted key remains destroyed (NOT auto-restored)

---

### Story 10.3: Daily deletion-grace cron (day-5 reminder email + T+7d hard-delete with audit-log archive coordination)
**GH Issue:** #54

**Implements:** AD21 (T+7d hard-delete + day-5 reminder), Pedro's clarification (zero fiscal-evidence exceptions on audit_log; all wiped — fiscal evidence lives in `moloni_invoices` only) · **FRs:** FR4 amended (steps 4 + reminder) · **Size:** M
**SSoT modules created:** `worker/src/jobs/deletion-grace.js`
**Migrations:** `supabase/migrations/202604301216_add_day5_reminder_sent_at_to_customers.sql` (adds `day5_reminder_sent_at timestamptz` column to `customers` for idempotency tracking; per N1 audit refinement — column referenced by Pass 1 below was missing from Story 1.4's customers schema)
**Depends on:** Story 10.1 (`customers.deletion_scheduled_at` set), Story 4.6 (`shared/resend/client.js` — extended by Story 12.2 templates `deletion-grace-reminder.eta` + `deletion-final.eta`), Story 9.6 (audit-log archive — coordinated retention; hard-delete wipes `audit_log_atencao_archive` rows too)
**Enables:** account fully deleted at grace-period end with no orphan data

As Pedro (developer/founder),
I want a daily cron that (a) sends a day-5 reminder email and (b) executes T+7d hard-delete per GDPR Art 17 — wiping all customer data including the Atenção archive, while retaining `moloni_invoices` as fiscal record,
So that grace-period mechanics are automated without manual ops and the FR4 deletion semantic is honored cleanly.

**Acceptance Criteria:**

**Given** `worker/src/jobs/deletion-grace.js` registered with `node-cron` to run daily at 00:30 Lisbon (`30 0 * * *` — staggered from Story 9.1's 02:00 partition cron and Story 9.6's 03:00 archive cron)
**When** the cron tick fires
**Then** it runs two passes:

**Pass 1 — Day-5 reminder:**
  - SELECT customers WHERE `deletion_initiated_at <= NOW() - INTERVAL '5 days' AND deletion_initiated_at > NOW() - INTERVAL '6 days'` (window catches accounts at exactly day 5)
  - For each match: send PT-localized reminder email via `shared/resend/client.js` using template `deletion-grace-reminder.eta` (Story 12.2) with copy *"Faltam 2 dias para a eliminação..."*
  - Idempotent: a flag column `customers.day5_reminder_sent_at timestamptz` is set on first send so re-runs don't re-send

**Pass 2 — T+7d hard-delete:**
  - SELECT customers WHERE `deletion_scheduled_at <= NOW()` (grace period elapsed)
  - For each match: in ONE transaction (per customer):
    1. **Wipe audit_log + Atenção archive**: DELETE FROM `audit_log` WHERE `customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = $1)`; DELETE FROM `audit_log_atencao_archive` WHERE same predicate (per Story 9.6 coordination — zero fiscal exceptions)
    2. **Wipe customer data via FK CASCADE**: DELETE FROM `customer_marketplaces` WHERE `customer_id = $1` — cascades to `sku_channels` → `skus` → `baseline_snapshots` → `scan_jobs` → `pri01_staging` → `shop_api_key_vault` (already nulled at initiation; row deleted now) → `cycle_summaries` → `daily_kpi_snapshots`
    3. **RETAIN moloni_invoices**: this table has no CASCADE from customers (FK is `ON DELETE NO ACTION` — fiscal record preserved per AD22 statutory retention)
    4. **Wipe Stripe references**: UPDATE `customers` SET `stripe_customer_id = NULL, stripe_subscription_id = NULL` (the actual Stripe Customer + Subscription are already canceled at period-end via Story 10.1's cancel_at_period_end; we just clear our local references)
    5. **Wipe auth.users via Supabase Admin API**: call `supabase.auth.admin.deleteUser(customer.id)` — this cascades to `customers` + `customer_profiles` rows via FK `ON DELETE CASCADE`
    6. **Send final-deletion confirmation email** to the customer's email (LAST action before the customer record is gone — uses email from local snapshot before it's wiped) via template `deletion-final.eta`
  - Each deletion is its own transaction — one customer's failure doesn't roll back others
  - Idempotent: completed deletions are gone; re-running the cron skips them naturally (their rows no longer exist)

**Given** the audit-log retention semantic per Pedro's clarification
**When** Pass 2 runs
**Then** ZERO `audit_log` rows are retained as "fiscal evidence" — the FR4 amended retention says all entries get wiped; fiscal evidence lives in `moloni_invoices` (separate table per AD22, separate retention per Portuguese fiscal law)
**And** the `audit_log_atencao_archive` table (Story 9.6's long-term Atenção archive) is also wiped for this customer
**And** `moloni_invoices` rows for this customer are PRESERVED (verified post-deletion: `SELECT COUNT(*) FROM moloni_invoices WHERE customer_id = $1` > 0 if they had invoices)

**Given** an integration test
**When** I run `tests/integration/deletion-grace-cron.test.js`
**Then** it covers:
  - Day-5 reminder: customer at exactly day 5 receives email; customer at day 6+ is NOT re-sent (idempotency); customer at day 4 is NOT yet sent
  - T+7d hard-delete: at exactly day 7+, all customer data wiped except moloni_invoices; auth.users deleted; final email sent
  - Coordinated retention: audit_log_atencao_archive wiped alongside audit_log
  - Concurrent runs: two simultaneous cron ticks don't double-process the same customer (DB-level row-locking)

---

## Epic 11: Billing — Stripe & Moloni

### Story 11.1: Stripe Customer + Subscription + first SubscriptionItem creation on Go-Live (consumed by Story 8.6)
**GH Issue:** #55

**Implements:** AD22 (with F2 + F12 schema linkage corrected) · **FRs:** FR40 · **NFRs:** NFR-I2 (idempotency on mutations), NFR-S7 (no card data stored — Stripe handles PCI-DSS) · **Size:** M
**SSoT modules created:** `shared/stripe/subscriptions.js` (`createCustomerAndSubscription`, `addSubscriptionItem`, `cancelSubscriptionAtPeriodEnd`, `getSubscriptionStatus`)
**Depends on:** Story 1.4 (customers.stripe_customer_id + stripe_subscription_id columns), Story 4.1 (customer_marketplaces.stripe_subscription_item_id column), Story 1.3 (pino redaction includes STRIPE_SECRET_KEY)
**Enables:** Story 8.6 (Go-Live consent modal calls into this), Story 11.2 (webhook handler), Story 11.3 (Customer Portal link), Story 10.1 (cancelSubscriptionAtPeriodEnd at deletion initiation), Story 11.4 (concierge marketplace-add)

As Pedro (developer/founder),
I want a single-source-of-truth Stripe subscriptions module with idempotency keys on every mutation, implementing the F2-corrected model (ONE Customer + ONE Subscription per MarketPilot customer; ONE SubscriptionItem per customer_marketplace),
So that the billing model can't drift into the architecture's pre-F2 contradiction (one Subscription per marketplace) and BAD subagents can't accidentally write parallel Stripe-mutation paths.

**Acceptance Criteria:**

**Given** `shared/stripe/subscriptions.js` exports `createCustomerAndSubscription({customerId, customerMarketplaceId, customerEmail, paymentMethodId})`
**When** called from Story 8.6's Go-Live consent flow (the FIRST customer_marketplace transitioning to ACTIVE)
**Then** the function calls Stripe API to create:
  1. ONE Stripe Customer with metadata `{marketpilot_customer_id: customerId, customer_email: customerEmail}` — uses idempotency key `customer:${customerId}:create` per NFR-I2
  2. ONE Stripe Subscription on the new Customer with `cancel_at_period_end: false`, billing_cycle_anchor=now, items=[{price: 'price_marketplace_eur_50_per_month'}] — idempotency key `subscription:${customerId}:create`
  3. The single SubscriptionItem from the Subscription's `items.data[0]`
**And** persists in ONE DB transaction:
  - `UPDATE customers SET stripe_customer_id = $1, stripe_subscription_id = $2 WHERE id = $3`
  - `UPDATE customer_marketplaces SET stripe_subscription_item_id = $1 WHERE id = $2`
**And** returns `{stripeCustomerId, stripeSubscriptionId, stripeSubscriptionItemId}` for the caller to confirm before transitioning cron_state to ACTIVE

**Given** `addSubscriptionItem({customerId, customerMarketplaceId})` for Story 11.4 concierge marketplace-add
**When** called for a SECOND (or later) customer_marketplace
**Then** the function reads `customers.stripe_subscription_id` (from the first Go-Live), adds a new SubscriptionItem to that EXISTING Subscription via Stripe API — idempotency key `subscription_item:${customerMarketplaceId}:create`
**And** Stripe proration applies (Stripe default: prorated charge for the partial period)
**And** persists `stripe_subscription_item_id` on the new customer_marketplaces row

**Given** `cancelSubscriptionAtPeriodEnd({customerId})` for Story 10.1 deletion-initiation
**When** called
**Then** the function calls `subscription.update({ cancel_at_period_end: true })` on the customer's Subscription
**And** Stripe stops renewing at end of current billing period; NO automatic refund for grace-period days (per AD21 + A1 lock)
**And** idempotency key `subscription:${customerId}:cancel:${attemptId}` per NFR-I2 (attemptId is a fresh UUID per call to allow retries without effect)

**Given** `getSubscriptionStatus({customerId})` is a read-only helper
**When** called
**Then** returns `{status, currentPeriodEnd, items: [{customerMarketplaceId, stripeSubscriptionItemId}]}` — used by Story 11.3 billing page to show current plan summary

**Given** the Stripe SDK initialization
**When** the module loads
**Then** it reads `STRIPE_SECRET_KEY` from env and verifies it starts with `sk_live_` or `sk_test_` (sanity check; reject startup with clear error if missing)
**And** the secret is NEVER logged (Story 1.3 redaction list includes `STRIPE_SECRET_KEY`)

**Given** unit tests in `tests/shared/stripe/subscriptions.test.js`
**When** I run them against the Stripe SDK's mocked test mode
**Then** they cover: createCustomerAndSubscription happy path; idempotency key reuse returns same result without duplicate creation; addSubscriptionItem on existing Subscription; cancelSubscriptionAtPeriodEnd preserves history; STRIPE_SECRET_KEY redaction in error stacks

---

### Story 11.2: Stripe webhook `/_webhooks/stripe` — signature + replay protection + idempotency + cron_state transitions for ALL marketplaces
**GH Issue:** #56

**Implements:** AD22 (webhook half) · **FRs:** FR43 · **NFRs:** NFR-S4 (signature + replay), NFR-I2 (idempotent webhook handling) · **Size:** L
**SSoT modules created:** `app/src/routes/_webhooks/stripe.js`, `shared/stripe/webhooks.js` (`verifySignature`, `checkReplay`, `processEvent`)
**Migrations:** `supabase/migrations/202604301215_create_stripe_webhook_events.sql` (idempotency tracking table — stores `(stripe_event_id, processed_at)` pairs)
**Depends on:** Story 4.1 (transitionCronState helper), Story 11.1 (Stripe SDK), Story 9.0 + Story 9.1 (audit emissions for `payment-failure-pause`), Story 4.6 + Story 12.2 (Resend client + templates for critical alert)
**Enables:** subscription state changes drive cron_state transitions across customer's marketplaces

As Pedro (developer/founder),
I want a webhook handler that verifies Stripe signatures, rejects replay attacks, deduplicates events idempotently, and on `customer.subscription.deleted` transitions ALL of the customer's marketplaces to `PAUSED_BY_PAYMENT_FAILURE`,
So that one failed payment cleanly pauses the entire customer's repricing across all their marketplaces (per F2's one-Subscription-per-customer model).

**Acceptance Criteria:**

**Given** the route `POST /_webhooks/stripe` (no auth middleware — public endpoint with signature-based authentication)
**When** Stripe sends a webhook
**Then** the route reads the raw body (NOT JSON-parsed yet — signature verification needs raw bytes per Stripe spec) and the `Stripe-Signature` header
**And** calls `shared/stripe/webhooks.js`'s `verifySignature(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET)` — uses Stripe SDK's `webhooks.constructEvent()` which validates HMAC-SHA256 + timestamp tolerance
**And** rejects with 401 if signature mismatches; 400 if signature header missing

**Given** signature verification passes
**When** the route checks replay protection
**Then** the request's timestamp (from the signature header's `t=` field) is compared against NOW(); if delta > 5 minutes (per NFR-S4), reject with 400
**And** the timestamp tolerance is configurable via env var `STRIPE_WEBHOOK_REPLAY_WINDOW_SEC` defaulting to `300`

**Given** the event passes signature + replay checks
**When** the route checks idempotency
**Then** it queries `SELECT 1 FROM stripe_webhook_events WHERE stripe_event_id = $1 LIMIT 1` (stored at first processing); if found → respond 200 immediately (Stripe expects 200 to stop retrying; we already processed this event)
**And** if not found → process the event (below) AND insert `(stripe_event_id, processed_at)` row in the same transaction
**And** the table has `stripe_event_id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT NOW()` + an index for retention pruning (Bob optionally adds a monthly cron to prune events older than 30 days — Stripe keeps event history accessible via API anyway)

**Given** the event router (`processEvent({event, tx})`)
**When** the event type is `customer.subscription.deleted` OR `customer.subscription.updated` with `status === 'canceled'`
**Then** for the customer identified by `event.data.object.customer` (Stripe customer ID), the handler:
  1. Loads the MarketPilot customer via `SELECT id FROM customers WHERE stripe_customer_id = $1`
  2. Loads ALL their customer_marketplaces (one Subscription per customer per F2; Subscription cancel = all marketplaces affected)
  3. For each marketplace currently in ACTIVE state: `transitionCronState({tx, from: 'ACTIVE', to: 'PAUSED_BY_PAYMENT_FAILURE'})` — this `(from, to)` IS in Story 4.1's per-(from,to) audit event map → emits `payment-failure-pause` Atenção
  4. Marketplaces NOT in ACTIVE (e.g., already in DRY_RUN or PAUSED_BY_CUSTOMER) are SKIPPED — no transition
  5. Sends ONE critical alert email to the customer via `shared/resend/client.js` (Story 12.2's `critical-alert-payment-failure-pause.eta` template) with consolidated context (all affected marketplaces in one email, not N separate emails)

**Given** the event type is `invoice.payment_succeeded`
**When** processed
**Then** the handler is a no-op at MVP (founder generates Moloni invoice manually per Story 11.5; Phase 2 trigger to auto-generate)
**And** logs at `info` level for observability

**Given** the event type is `customer.subscription.updated` with `cancel_at_period_end: true` (set by Story 10.1's deletion initiation)
**When** processed
**Then** no immediate cron_state transition (the customer is already in PAUSED_BY_ACCOUNT_GRACE_PERIOD per Story 10.1's transaction)
**And** the eventual `customer.subscription.deleted` arrives at end of billing period and DOES trigger the transition path above — but customer's cron_state is already PAUSED_BY_ACCOUNT_GRACE_PERIOD; the `(PAUSED_BY_ACCOUNT_GRACE_PERIOD, PAUSED_BY_PAYMENT_FAILURE)` transition is NOT in `LEGAL_CRON_TRANSITIONS` → the handler detects this case and skips silently (the deletion-grace cron will hard-delete the account anyway)

**Given** all other event types
**When** processed
**Then** logged at `debug` level; no action; idempotency record inserted to short-circuit retries

**Given** an integration test
**When** I run `tests/integration/stripe-webhook.test.js`
**Then** it covers: valid signature → processed; invalid signature → 401; replay >5min → 400; duplicate event_id → 200 immediate; subscription.deleted → ALL customer's marketplaces transitioned to PAUSED_BY_PAYMENT_FAILURE + payment-failure-pause Atenção emitted + critical alert sent (mock Resend received); subscription canceled while in PAUSED_BY_ACCOUNT_GRACE_PERIOD → silent skip

---

### Story 11.3: `/settings/billing` page + Stripe Customer Portal link
**GH Issue:** #57

**Implements:** AD22 (Customer Portal link delegation) · **FRs:** FR40, FR43 (customer self-manages payment method via Stripe Portal) · **Size:** S
**SSoT modules created:** `app/src/routes/settings/billing.js` (replaces Story 8.11's stub), `shared/stripe/customer-portal.js` (`createPortalLink`)
**Depends on:** Story 8.11 (settings sectioned nav scaffold), Story 11.1 (`stripe_customer_id` persisted, `getSubscriptionStatus` helper)
**Enables:** customer manages payment method, views invoices, cancels subscription via Stripe-owned UX
**Visual reference pattern:** **C** — UX skeleton §4.4 settings + visual-DNA tokens (consistent chrome from Story 8.11)

**Acceptance Criteria:**

**Given** the route `GET /settings/billing`
**When** an authenticated customer visits
**Then** the page renders:
  - Current plan summary: `€50 × {N} marketplaces / month` where N is `SELECT COUNT(*) FROM customer_marketplaces WHERE customer_id = $1`
  - Next billing date from `getSubscriptionStatus({customerId}).currentPeriodEnd` formatted via `formatLisbon` helper
  - List of recent invoices (last 12 from Stripe API or cached in `moloni_invoices` from Story 11.5) with download links
  - "Abrir Stripe Customer Portal" CTA button

**Given** the customer clicks "Abrir Stripe Customer Portal"
**When** `POST /settings/billing/portal` runs
**Then** the route calls `shared/stripe/customer-portal.js`'s `createPortalLink({stripeCustomerId, returnUrl: 'https://app.marketpilot.pt/settings/billing'})` which uses Stripe API's `billingPortal.sessions.create()`
**And** redirects the customer to the returned `url` (Stripe-hosted UI)
**And** in the Portal, customer can: update payment method, view invoices, cancel subscription
**And** customer-initiated cancel in Portal triggers `customer.subscription.deleted` webhook → Story 11.2 handles cron_state transitions

**Given** the customer has no Stripe Customer yet (e.g., still in DRY_RUN, never clicked Go-Live)
**When** they visit `/settings/billing`
**Then** the page shows: *"Ainda não estás em billing ativo. Vais ser cobrado quando carregares 'Ir live'."* with a link to the dashboard's Go-Live CTA
**And** the "Abrir Stripe Customer Portal" CTA is hidden (no Stripe Customer to portal into)

---

### Story 11.4: Concierge marketplace-add admin script (founder CLI for adding 2nd+ marketplace)
**GH Issue:** #58

**Implements:** AD22 partial (concierge backend), FR41 MVP (concierge-only, NO self-serve UI) · **FRs:** FR41 MVP · **Size:** M
**SSoT modules created:** `scripts/concierge-add-marketplace.js` (CLI; founder runs locally with .env.production-like config)
**Depends on:** Story 1.2 (envelope encryption — for new key), Story 3.3 (Mirakl smoke-test for key validation), Story 4.1 (customer_marketplaces row creation in PROVISIONING), Story 4.4 (onboarding scan — triggered for the new marketplace), Story 11.1 (`addSubscriptionItem`)
**Enables:** founder adds Tony's 2nd-5th Mirakl marketplaces without exposing customer to a UI that doesn't ship until Phase 2

As Pedro (founder),
I want a CLI script that walks me through adding a customer's additional marketplace — encrypts the new key, creates the customer_marketplaces row in PROVISIONING, adds a Stripe SubscriptionItem to their existing Subscription, and triggers the onboarding scan —
So that I can fulfill FR41 MVP (concierge-only) without ever building self-serve UI that needs to be torn out in Phase 2.

**Acceptance Criteria:**

**Given** `scripts/concierge-add-marketplace.js` is run as `node scripts/concierge-add-marketplace.js` with `.env` loaded
**When** the script starts
**Then** it prompts (interactive readline):
  1. Customer email (looks up `customers` row; aborts if not found)
  2. Marketplace operator (currently only `WORTEN` is valid at MVP — script rejects others with PT message)
  3. Marketplace instance URL (e.g., `https://marketplace.worten.pt` for a second Worten marketplace if applicable; or future Phase 2 marketplaces)
  4. Worten shop API key (input is masked — does NOT echo to terminal; key is held in process memory only, never written to disk)

**Given** valid inputs
**When** the script proceeds
**Then** it runs in this sequence:
  1. **Validate the key** via the Mirakl smoke-test logic from Story 3.3 (lightweight P11 call against a known reference EAN); aborts with PT error if invalid
  2. **Encrypt the key** via `shared/crypto/envelope.js` (Story 1.2)
  3. **Create the customer_marketplaces row** in PROVISIONING state with operator + marketplace_instance_url; A01/PC01 columns NULL (CHECK constraint allows because PROVISIONING)
  4. **Persist the encrypted key** in `shop_api_key_vault`
  5. **Add Stripe SubscriptionItem** via Story 11.1's `addSubscriptionItem({customerId, customerMarketplaceId})` — Stripe proration kicks in
  6. **Trigger onboarding scan**: insert a `scan_jobs` row in PENDING state; the worker (Story 4.4) picks it up on its next tick

**Given** the script logs progress
**When** I run it
**Then** each step logs to console with timestamp + status; the cleartext key NEVER appears in log output (verify by piping output to a file and grepping)
**And** on success, prints a summary: "Marketplace added for {customer.email}. Scan queued. Stripe SubscriptionItem: {id}. Next billing cycle will include €50/month additional charge prorated for {N} days."

**Given** any step fails
**When** the failure is detected
**Then** the script aborts with a clear PT error
**And** rolls back any partial state: if Stripe SubscriptionItem was created, it's removed; if the customer_marketplaces row was created, it's deleted (CASCADE wipes the vault row)
**And** logs the failure for founder follow-up

**Given** an integration test (CLI tests are tricky — use a programmatic test harness)
**When** I run `tests/integration/concierge-add-marketplace.test.js`
**Then** it covers: valid input happy path → all 6 steps complete; invalid key → abort + rollback; mid-step failure → rollback verified; cleartext key never in pino output

---

### Story 11.5: `moloni_invoices` table + NIF capture flow at Day-3 pulse-check + admin record route
**GH Issue:** #59

**Implements:** AD22 (with F7) — Moloni manual at MVP + NIF capture flow at Day-3 pulse-check per F7 amendment · **FRs:** FR44 · **NFRs:** NFR-O4 (≤24h post-billing invoice generation, ≤10min target per invoice; aggregate >2-3 hr/month triggers Phase 2 Moloni API integration) · **Size:** M
**SSoT modules created:** `app/src/routes/admin/moloni-record.js` (founder-only admin route to record invoice metadata), `app/src/views/pages/admin-moloni-record.eta`, `shared/moloni/invoice-metadata.js` (`recordMoloniInvoice`)
**Migrations:** `supabase/migrations/202604301213_create_moloni_invoices.sql`
**Depends on:** Story 1.5 (founder-admin gate), Story 11.1 (stripe_payment_intent_id linkage for the invoice row), Story 1.4 (customer_profiles.nif column for NIF persistence)
**Enables:** founder records each Moloni invoice generated manually; NIF captured at first invoice and pre-filled subsequently; rows retained even after FR4 deletion

**Acceptance Criteria:**

**Given** the migration `202604301213_create_moloni_invoices.sql`
**When** applied
**Then** `moloni_invoices` table exists per architecture: id PK, customer_id FK (NO CASCADE — fiscal record must survive customer deletion), customer_marketplace_id FK (nullable — covers multi-marketplace invoices), moloni_invoice_id text NOT NULL UNIQUE, stripe_payment_intent_id text NOT NULL, amount_cents integer NOT NULL, nif text NOT NULL, issued_at timestamptz NOT NULL, created_at
**And** index `idx_moloni_invoices_customer ON moloni_invoices(customer_id, issued_at DESC)`
**And** RLS: customer reads own; founder admin read-write
**And** RLS regression suite extension
**And** the FK to `customers(id)` is `ON DELETE NO ACTION` (NOT CASCADE) — verified by integration test attempting customer deletion while moloni_invoices rows exist; deletion blocks unless invoices are migrated to a fiscal-archive table first OR deleted manually by founder per legal review

**Given** the route `GET /admin/moloni-record/:customerId` (founder-only per Story 1.5 middleware)
**When** Pedro visits to record a new invoice
**Then** the page shows: customer's email + name, recent Stripe payments (from Stripe API), pre-filled NIF if `customer_profiles.nif` is populated (from prior invoices), input fields for Moloni invoice ID + amount + issued_at + NIF (editable)

**Given** Pedro submits the form (`POST /admin/moloni-record/:customerId`)
**When** `shared/moloni/invoice-metadata.js`'s `recordMoloniInvoice({customerId, moloniInvoiceId, stripePaymentIntentId, amountCents, nif, issuedAt, customerMarketplaceId})` runs
**Then** in ONE transaction:
  1. INSERT `moloni_invoices` row with all fields
  2. UPDATE `customer_profiles` SET `nif = $1` WHERE `customer_id = $2 AND (nif IS NULL OR nif != $1)` — captures or updates NIF on the profile (per F7 — captured at first Moloni invoice generation, pre-filled subsequently)
**And** returns success; founder closes the page

**Given** the F7 NIF capture flow at Day-3 pulse-check
**When** Pedro emails the customer per NFR-O3 (operational protocol)
**Then** the email includes the verbatim ask from architecture AD22 / Journey 1: *"Posso enviar a fatura Moloni para o NIF da {company}?"*
**And** the customer's response (NIF) is recorded by Pedro via `/admin/moloni-record` on their first invoice generation
**And** subsequent invoices for the same customer pre-fill NIF from `customer_profiles.nif` — Pedro doesn't need to ask again

**Given** an integration test
**When** I run `tests/integration/moloni-record.test.js`
**Then** it covers: founder records first invoice → NIF captured on customer_profiles; founder records second invoice → NIF pre-filled, no redundant capture; non-founder gets 403/404 (Story 1.5 gate); customer deletion attempt while moloni_invoices exist → NO action FK behavior preserves rows

---

## Epic 12: Operations & Failure Model

### Story 12.1: 3-tier failure model finalization + sustained-transient classifier + `cycle-fail-sustained` event_type addition
**GH Issue:** #60

**Implements:** AD24 (with F10 hardcoded threshold), AD18 (polling implies retry) · **FRs:** FR46, FR39 partial (sustained-transient banner emit — UI in Story 8.8) · **NFRs:** NFR-R4, NFR-R5 · **Size:** M
**SSoT modules created:** `worker/src/safety/failure-classifier.js`, `worker/src/safety/sustained-transient-detector.js`
**Migrations:** `supabase/migrations/202604301220_add_cycle_fail_sustained_event_type.sql` (adds 27th row to `audit_log_event_types` — `cycle-fail-sustained` Atenção; per Pedro's guidance this is a NEW event-type addition since it's mandated by AD24 but not in AD20's enumerated 26-row seed)
**Depends on:** Story 5.1 (dispatcher cycles to count), Story 9.0 + Story 9.1 (audit foundation — extends with new event_type), Story 4.6 + Story 12.2 (Resend NOT used at sustained-transient tier per AD24, but module is consumed by other tiers)
**Enables:** sustained-transient banner trigger renders in Story 8.8 banner library (UX skeleton §9.9 verbatim)

As Pedro (developer/founder),
I want the 3-tier failure model finalized as code with a hardcoded 3-cycle threshold for sustained-transient detection, and the new `cycle-fail-sustained` event_type added to the audit taxonomy,
So that flaky Mirakl periods surface clearly to the customer (PT-localized banner) without spamming Resend critical alerts on every transient blip.

**Acceptance Criteria:**

**Given** the migration `202604301220_add_cycle_fail_sustained_event_type.sql`
**When** I apply it
**Then** it INSERTs the 27th row into `audit_log_event_types`: `('cycle-fail-sustained', 'atencao', 'Verificações com a Worten estão lentas há 3+ ciclos consecutivos')`
**And** Story 9.0's `EVENT_TYPES` JS constant in `shared/audit/event-types.js` is updated in the SAME PR with this story (keeps the lookup-table seed and the JS constant in sync — bidirectional integrity)
**And** Story 9.0's integration test asserting taxonomy count is updated from 26 to 27 (or rephrased to assert "matches `EVENT_TYPES.length`" — Pedro to pick at Step 4 sweep)

**Given** `worker/src/safety/sustained-transient-detector.js` exports `incrementCycleFailureCount(customerMarketplaceId)` and `resetCycleFailureCount(customerMarketplaceId)`
**When** Story 5.1's dispatcher cycle completes
**Then** on cycle success: `resetCycleFailureCount(customerMarketplaceId)` (clears the counter — usually 0 already, but defensive)
**And** on cycle failure (e.g., persistent Mirakl 5xx after retry exhaustion across the cycle): `incrementCycleFailureCount(customerMarketplaceId)` returns the new count
**And** the counter is stored in a small table `dispatcher_cycle_failures` with `(customer_marketplace_id PRIMARY KEY, consecutive_failures smallint NOT NULL DEFAULT 0, updated_at)` — Bob may instead use a column on customer_marketplaces; either works (small in-RAM cache acceptable too — calibrate during dogfood)

**Given** the counter reaches 3 (per F10 hardcoded threshold)
**When** the detector observes the 3rd consecutive failure
**Then** in ONE transaction:
  1. Emit `cycle-fail-sustained` Atenção via writeAuditEvent with payload `{consecutiveFailures: 3, lastSuccessfulCycleAt: <timestamp>}`
  2. NO Resend email (per AD24 — sustained-transient is banner only, not critical-alert tier)
  3. Set a flag (e.g., a column on customer_marketplaces or a separate flag table) so Story 8.8's banner library renders the §9.9 banner on next dashboard load: *"Atrasos temporários — verificações com a Worten estão lentas. Sem ações de preço novas até estabilizar. Última verificação OK: {HH:MM}."*

**Given** the threshold is hardcoded per F10
**When** I read `worker/src/safety/sustained-transient-detector.js`
**Then** the constant `SUSTAINED_TRANSIENT_THRESHOLD = 3` is at module top (NOT read from `customer_marketplaces.sustained_transient_cycle_threshold` at MVP — that column is reserved for Phase 2 per F10 but no MVP migration created)
**And** a code comment notes the Phase 2 trigger: *"// Phase 2: read from customer_marketplaces.sustained_transient_cycle_threshold if non-NULL (column already reserved per F10; not migrated at MVP)"*

**Given** the 3-tier failure model is finalized
**When** I read `worker/src/safety/failure-classifier.js`
**Then** the module documents (in JSDoc + a constant `FAILURE_TIERS`) the three tiers:
  1. **Transient** (429, 5xx, transport): retry within cycle via `shared/mirakl/api-client.js` (Story 3.1's already-built retry/backoff); logged at `debug`; no audit event; no banner
  2. **Sustained-transient** (3+ consecutive cycle failures): handled by this story's detector → banner + Atenção; NO Resend
  3. **Critical** (auth invalid → key-revoked + Story 7.4 anomaly + Story 7.6 circuit-breaker + Story 11.2 payment-failure): freeze + Atenção + Resend (within ≤5 min per NFR-P9)
**And** the per-SKU operational tier (Story 6.3's pri01-fail-persistent 3-cycle escalation) is documented as a sub-tier of "critical" — it triggers Resend per its own logic

**Given** an integration test
**When** I run `tests/integration/sustained-transient.test.js`
**Then** it covers: 1 failure → no banner; 2 failures → no banner; 3 consecutive failures → cycle-fail-sustained Atenção emitted + banner trigger flag set; subsequent successful cycle → counter reset, banner clears on next dashboard load; NO Resend at this tier (mock Resend received zero alerts)

---

### Story 12.2: `shared/resend/client.js` extension — PT-localized template helpers + 8 critical-alert templates
**GH Issue:** #61

**Implements:** AD25 (Resend), AD24 (critical-tier alert) · **FRs:** FR48 · **NFRs:** NFR-I4 (PT-localized templates), NFR-P9 (≤5 min delivery), NFR-Sc4 (free tier 3k/mo budget) · **Size:** L
**SSoT modules created:** Extends `shared/resend/client.js` (Story 4.6's minimal SSoT — `sendCriticalAlert({to, subject, html})` interface PRESERVED) with `sendCriticalAlertWithTemplate({to, templateName, vars})`. Adds 8 PT-localized eta templates in `app/src/views/emails/`:
  - `critical-alert-anomaly-freeze.eta` (Story 7.4)
  - `critical-alert-circuit-breaker-trip.eta` (Story 7.6)
  - `critical-alert-circuit-breaker-per-sku-trip.eta` (Story 7.6)
  - `critical-alert-key-validation-fail.eta` (mid-life key revocation per UX skeleton §8.1)
  - `critical-alert-pri01-fail-persistent.eta` (Story 6.3)
  - `critical-alert-payment-failure-pause.eta` (Story 11.2)
  - `deletion-confirmation.eta` (Story 10.1; refactored to use renderTemplate)
  - `deletion-grace-reminder.eta` (Story 10.3)
  - `deletion-final.eta` (Story 10.3)
  - `scan-failed.eta` (Story 4.6; refactored to use renderTemplate)
**Depends on:** Story 4.6 (minimal SSoT), Story 7.1 (`formatEur` for prices in templates), Story 1.3 (pino redaction includes `RESEND_API_KEY`)
**Enables:** all critical-alert email surfaces use consistent PT templates

As Pedro (developer/founder),
I want the minimal Resend client extended (NOT replaced) with PT-localized template helpers and the full set of 8+ critical-alert templates — preserving the SSoT-from-day-one discipline established in Story 4.6,
So that every email surface across the system goes through one canonical interface and PT microcopy stays consistent.

**Acceptance Criteria:**

**Given** `shared/resend/client.js` (Story 4.6 minimal SSoT)
**When** I extend it in this story
**Then** the existing `sendCriticalAlert({to, subject, html})` interface is PRESERVED unchanged (existing call sites in Stories 4.6, 7.4, 7.6, 11.2 don't break)
**And** a new sibling `sendCriticalAlertWithTemplate({to, templateName, vars})` is added — internally renders the eta template via the eta engine, then calls `sendCriticalAlert` with the rendered html
**And** view helpers `formatEur` (Story 7.1) and `formatLisbon` (date helper) are registered with the eta instance used for emails

**Given** each of the 8+ PT-localized templates
**When** rendered with the documented vars
**Then** each follows visual-DNA tokens (Manrope/Inter, navy primary, no SPA framework) — emails render acceptably across major clients (Gmail, Outlook, Apple Mail) per a manual visual review
**And** subject lines are PT-localized per UX skeleton §9 microcopy where applicable
**And** body content is PT-localized verbatim from §9 microcopy for the events that have it; for events without explicit microcopy (e.g., critical-alert-circuit-breaker-per-sku-trip), Bob writes new PT copy following the established register (second-person singular `tu`, anti-promissory)

**Given** existing call sites in Stories 4.6 and 7.4
**When** I migrate them to use `sendCriticalAlertWithTemplate`
**Then** Story 4.6's `scan-failed.eta` rendering moves from inline html string to the templated path (same email content, just routed through the helper)
**And** Story 7.4's anomaly-freeze critical alert similarly uses the templated path
**And** the migration is mechanical — no behavior change, just consolidation

**Given** the Resend free tier 3k/mo budget per NFR-Sc4
**When** I sum expected email volume at MVP scale (10 customers × 2-3 critical alerts/month each ≈ 20-30 emails/month + deletion emails per customer that initiates ≈ 3 per deletion)
**Then** total ≈ 30-50 emails/month — well within 3k/mo
**And** the worker logs cumulative monthly send count to allow Phase 2 trigger detection (when count approaches 2k/mo, Bob upgrades Resend tier)

**Given** an integration test
**When** I run `tests/integration/resend-templates.test.js`
**Then** for each of the 8+ templates: render with sample vars → assert html output matches a golden file (snapshot test); render with missing required vars → throws clear error
**And** redaction holds: Resend API errors don't leak the API key (verified by injecting an invalid key and asserting pino output is `[REDACTED]`)

---

### Story 12.3: PC01 monthly re-pull cron + `platform-features-changed` event_type addition
**GH Issue:** #62

**Implements:** AD26 · **FRs:** (architectural — defends writer from silent operator-config drift) · **Size:** S
**SSoT modules created:** `worker/src/jobs/pc01-monthly-repull.js`
**Migrations:** `supabase/migrations/202604301221_add_platform_features_changed_event_type.sql` (adds 28th row to `audit_log_event_types` — `platform-features-changed` Atenção; per Pedro's guidance this is a 2nd new event-type addition not in AD20's enumerated 26-row seed)
**Depends on:** Story 3.2 (PC01 wrapper), Story 4.1 (`customer_marketplaces.platform_features_snapshot` JSONB column + `last_pc01_pulled_at`), Story 9.0 + Story 9.1 (audit foundation — extends with new event_type), Story 12.2 (Resend client + templates — for critical alert when PC01 changes)
**Enables:** operator-config drift detection (e.g., Worten enables `volume_pricing` → writer would break silently; this catches it before the next cycle)

As Pedro (developer/founder),
I want a monthly cron that re-pulls PC01 for every active customer marketplace, compares against the stored snapshot, and emits a `platform-features-changed` Atenção event + sends a critical alert if anything differs,
So that operator-side configuration changes (Worten enabling new features, changing CSV delimiter, etc.) don't silently break the PRI01 writer mid-cycle.

**Acceptance Criteria:**

**Given** the migration `202604301221_add_platform_features_changed_event_type.sql`
**When** I apply it
**Then** it INSERTs the 28th row into `audit_log_event_types`: `('platform-features-changed', 'atencao', 'Configuração da plataforma operadora alterada — verifica antes do próximo ciclo')`
**And** Story 9.0's `EVENT_TYPES` JS constant is updated in the SAME PR with this story (kept in sync per Story 12.1's pattern)
**And** Story 9.0's integration test (count assertion) is updated from 27 (post-Story 12.1) to 28

**Given** `worker/src/jobs/pc01-monthly-repull.js` registered with `node-cron` to run on the 1st of each month at 04:00 Lisbon (`0 4 1 * *` — staggered from Story 9.1's 02:00 partition cron, Story 9.6's 03:00 archive cron, Story 10.3's 00:30 deletion cron)
**When** the cron tick fires
**Then** for each ACTIVE customer_marketplace (NOT in PROVISIONING / PAUSED_BY_*): decrypts the customer's apiKey, calls `shared/mirakl/pc01.js`'s `getPlatformConfiguration` (Story 3.2)
**And** compares the new response against `customer_marketplaces.platform_features_snapshot` JSONB
**And** if they DIFFER (deep-equal comparison; Bob picks a stable JSON-canonicalization library or writes one):
  1. Emits `platform-features-changed` Atenção via writeAuditEvent with payload `{previousSnapshot, newSnapshot, diffSummary: <list of changed keys>}`
  2. Sends critical alert via `shared/resend/client.js` (Story 12.2) using template `critical-alert-platform-features-changed.eta` (Bob adds this 9th template — derived from Story 12.2's set; or reuses the generic `critical-alert.eta` with conditional content)
  3. UPDATEs `customer_marketplaces.platform_features_snapshot = <newSnapshot>` AND `last_pc01_pulled_at = NOW()` (so the customer doesn't get repeat alerts for the same change month after month)
**And** if they MATCH: only update `last_pc01_pulled_at = NOW()` (no audit event, no alert — silent steady state)

**Given** the cron failure handling
**When** PC01 fails for a customer (e.g., key revoked mid-month before the cron runs)
**Then** the cron logs at `error` level via pino with `customer_marketplace_id`, but does NOT abort the entire cron run for that one failure
**And** continues to the next customer marketplace
**And** the `key-validation-fail` Atenção event will be emitted by the next dispatcher cycle anyway (Story 7.x or `shared/mirakl/api-client.js`'s 401 handling)

**Given** an integration test
**When** I run `tests/integration/pc01-monthly-repull.test.js`
**Then** it covers: PC01 unchanged → no event, just timestamp update; PC01's `volume_pricing` field flips from false to true → `platform-features-changed` Atenção emitted + critical alert sent + snapshot updated; PC01 fetch fails (mock Mirakl 401) → error logged, cron continues

---

# Architectural Constraints / Negative Assertions

One-page scan reference for Bob (SM agent) + BAD subagents. Every constraint below is enforced as a NEGATIVE ASSERTION in Story 1.1's acceptance criteria (or in the relevant downstream story where the constraint becomes mechanically enforceable). BAD subagents implementing stories MUST verify their work doesn't violate these.

> **Note on enforcement timing (per readiness-check 2026-05-01).** ~11 of the 27 constraints rely on ESLint custom rules that ship WITH their target SSoT modules per the refined sequencing pattern (no-direct-fetch with `shared/mirakl/api-client.js` in Story 3.1; no-raw-CSV-building with `shared/mirakl/pri01-writer.js` in Story 6.1; no-raw-INSERT-audit-log with `shared/audit/writer.js` in Story 9.0; no-float-price with `shared/money/index.js` in Story 7.1; no-raw-cron-state-update with `shared/state/cron-state.js` in Story 4.1; worker-must-filter-by-customer with `shared/db/service-role-client.js` usage in Story 5.1). Until those stories ship, the constraints they protect are review-enforced rather than mechanically-enforced. Bob's sprint-status sequencing makes the ramp-up explicit; once the rule lands, retroactive enforcement against existing stories is automatic at next CI run. This is the agreed pattern, not a gap.

| # | Constraint | Enforced where | Rationale |
|---|---|---|---|
| 1 | **No Mirakl webhook listener** in the codebase (AD18) | Story 1.1 negative assertion (grep `package.json` + source) | Seller-side webhooks unavailable per MCP — polling-only architecture |
| 2 | **No external validator library** — Fastify built-in JSON Schema only (AD28) | Story 1.1 negative assertion (no `zod`, `yup`, `joi`, `ajv` in `package.json`) | Sufficient for MVP signup/key-entry/margin/anomaly-review/Stripe webhook payload validation; lib added in Phase 2 only if surface emerges that JSON Schema can't express ergonomically |
| 3 | **No SPA framework** | Story 1.1 negative assertion (no `react`, `vue`, `svelte`, `angular`, `solid-js` in `package.json`) | Server-rendered eta + per-page vanilla JS preserves DynamicPriceIdea's velocity datapoint and matches NFR-P7 mobile budget |
| 4 | **No bundler** | Story 1.1 negative assertion (no `vite`, `webpack`, `rollup`, `esbuild`, `parcel` in `package.json`) | Coolify runs `node app/src/server.js` directly; no build step; per-page `<script src="/js/<page>.js" defer>` per F9. **Note (I2 / readiness-check 2026-05-01):** the `defer` attribute pattern itself is review-only at MVP — no automated CI gate scans rendered HTML for missing `defer`. Code review during Epic 8 PR-merge enforces. Phase 2 trigger to add a Playwright assertion if the pattern drifts. |
| 5 | **No TypeScript at MVP** | Story 1.1 negative assertion (no `typescript`, `ts-node` in `package.json`) | JS-ESM with JSDoc type hints matches DPI shared-code reuse; TS migration is `*.js → *.ts` rename + cleanup, Phase 2 trigger if churn demands |
| 6 | **OF24 forbidden for price updates** (CLAUDE.md mandate) | Story 6.1 PRI01 writer is the SSoT path; ESLint `no-raw-CSV-building` flags any parallel writer; grep verifies no `POST /api/offers` price calls exist | OF24 resets ALL unspecified offer fields (quantity, description, leadtime) to defaults — confirmed footgun |
| 7 | **No customer-facing API at MVP** (PRD Journey 5 N/A through Epic 2 / Phase 2) | Story 1.1 negative assertion (no `/api/v1/...` routes); Stripe webhook is the only JSON-accepting route | Reopens Phase 3+ if ≥2 paying customers request audit-log export OR programmatic margin updates |
| 8 | **No Redis / BullMQ / external queue** | Story 1.1 negative assertion (no `redis`, `ioredis`, `bullmq`, `bull` in `package.json`) | `pri01_staging` table + Postgres advisory locks (Story 5.1) are the queue equivalent at MVP; Phase 2 trigger when cycle latency exceeds NFR-P1/P2 budgets |
| 9 | **No CDN in front of public/** | Story 1.1 deployment topology (`@fastify/static` serves directly) | Phase 2 trigger if dashboard rendering latency becomes customer-visible at PT/ES geo-concentration with Hetzner Frankfurt; Cloudflare in front of Coolify is config-only |
| 10 | **No ES UI translation at MVP** (NFR-L2) | Story 1.1 negative assertion (no `i18n` infrastructure, no ES translation files); Story 4.x onboarding + Story 8.x dashboard are PT-only | Phase 2 trigger when a primary-ES customer signs up |
| 11 | **No worker connection pooler beyond `pg`'s built-in** | Story 1.1 negative assertion (no `pgbouncer`-as-deployed, no `supavisor` config) | At MVP scale (5-10 customers, single worker, 5-min cycles), `pg` Pool with `max: 5` is sufficient; Phase 2 trigger when worker count exceeds 1 |
| 12 | **No mobile-optimized surfaces beyond critical-alert response** (UX-DR25-27) | Story 8.12 ships only the mobile critical-alert response surface; Stories 8.1-8.11 target ≥1280px primary, render acceptably to ~960px, mobile-degraded below 768px | Operational tasks (audit log filtering, margin editor with worked-profit-example, channel toggle for PT/ES comparison, founder admin) are structurally desktop work |
| 13 | **No customer impersonation by founder** (AD4 + UX-DR28-30) | Story 1.5 + Story 8.10 — `/admin/status` is read-only; `/audit?as_admin={customer_id}` reuses customer-side audit log via service-role bypass with red admin-mode banner; founder NEVER logs in as the customer | Trust commitment + GDPR posture |
| 14 | **No FK constraint on `audit_log.sku_id` and `sku_channel_id`** (F8) | Story 9.1 inline schema comment | Preserves audit history if a SKU is later removed from catalog; immutability per NFR-S6 trumps referential integrity to ephemeral catalog rows |
| 15 | **No moloni_invoices CASCADE on customer deletion** | Story 11.5 schema (`ON DELETE NO ACTION`) | Fiscal record per AD22 / Portuguese statutory retention — survives FR4 hard-delete; founder migrates rows to a fiscal archive before customer deletion if needed |
| 16 | **No team-membership table at MVP** (FR2 negative assertion) | Story 1.4 — schema does NOT include `customer_team_members` or equivalent; one auth.users → one customers → one customer_profiles (1:1:1) | Single-login-per-customer-account at MVP; multi-user RBAC = Phase 2 |
| 17 | **No fiscal-evidence exception in audit_log retention** (Pedro's clarification) | Story 10.3 hard-delete cron + Story 9.6 archive coordination | Zero `audit_log` rows retained on T+7d hard-delete; fiscal evidence lives in `moloni_invoices` (separate table, separate retention) |
| 18 | **No console.log in production code** | Story 1.1 ESLint `no-console` rule + Story 1.2 secret-scanning hook | All output via `pino` per AD27 |
| 19 | **No direct fetch outside `shared/mirakl/` directory** | Story 3.1 custom ESLint rule `no-direct-fetch` | One Mirakl HTTP path; allows `api-client.js` (GET) + `pri01-writer.js` (multipart POST) — no other POST endpoints exist |
| 20 | **No raw CSV building outside `shared/mirakl/pri01-writer.js`** | Story 6.1 custom ESLint rule `no-raw-CSV-building` | One PRI01 emission path; AD7 per-SKU aggregation + delete-and-replace + pending_import_id atomicity all in one place |
| 21 | **No raw `INSERT INTO audit_log` outside `shared/audit/writer.js`** | Story 9.0 custom ESLint rule `no-raw-INSERT-audit-log` | One audit emission path; trigger-derived priority + structured payload via `@typedef PayloadFor<EventType>` |
| 22 | **No float-price math outside `shared/money/index.js`** | Story 7.1 custom ESLint rule `no-float-price` | One money path; integer-cents discipline + conservative rounding (Math.ceil floor / Math.floor ceiling) |
| 23 | **No raw `UPDATE customer_marketplaces SET cron_state` outside `shared/state/cron-state.js`** | Story 4.1 custom ESLint rule | One state-machine path; legal-transitions matrix + per-(from,to) audit event lookup + optimistic-concurrency guard |
| 24 | **No worker query missing `customer_marketplace_id` filter** (RLS bypassed in worker) | Story 5.1 custom ESLint rule `worker-must-filter-by-customer` | Explicit cross-customer queries require `// safe: cross-customer cron` comment to suppress |
| 25 | **No refurbished products on Worten** | Architecture explicitly out of scope — distillate §14; do NOT propose stories addressing refurbished SKUs | Worten has no shared EAN catalog for seller-created refurbished listings; engine would tier-classify them T3 forever; structural to Worten, not a MarketPilot limitation |
| 26 | **No multi-marketplace beyond Worten at MVP** | Story 11.4 concierge-add limited to operator='WORTEN'; `marketplace_operator` enum has only `'WORTEN'` value at MVP | Phase 2 extends enum to add Phone House, Carrefour ES, PCComponentes, MediaMarkt |
| 27 | **No self-serve "Add Marketplace" UI** (FR41 MVP) | Story 8.11 `/settings/marketplaces` shows read-only list with concierge tooltip; no form/wizard | Phase 2 trigger ships self-serve add/remove with Stripe proration UI |

---

# Parallel Tracks Appendix

Three sub-tracks. None are dev stories in this document. They block first invoice (Legal track) or run in parallel to MVP build (Founder Operational track) or land as a mechanical Step 4 fill-in (Screen→Stub Mapping).

## Legal Track — blocks first invoice, NOT MVP build

Pre-revenue legal review is **fixed-fee (not retainer), funded from runway, post-build pre-Go-Live** — single engagement covering all four items below. Founder schedules this once MVP is feature-complete and before customer #1's first invoice.

| Item | Coverage | Status before legal review |
|---|---|---|
| **ToS update for price-setting agency** | The free-report ToS does NOT cover automated price-setting agency on customer's behalf (per distillate §15). New ToS must explicitly cover this scope + the customer-self-flips-Go-Live + audit-log-as-trust-deliverable architecture | Existing free-report ToS in DynamicPriceIdea repo; needs replacement |
| **B2B DPA template** | For procurement-conscious B2B customers (per distillate §15); standard GDPR DPA covering Supabase Cloud EU + Hetzner data flow | Not drafted |
| **Refund-policy ToS clause** (FR42) | "First-month money-back guarantee within 14 days of Go-Live, no questions asked" stated explicitly; aligns with dry-run-by-default + 24h post-Go-Live monitoring | Concept locked in distillate §1; ToS clause to be drafted |
| **Worten/Mirakl operator-ToS compatibility check** | Confirm automated repricing via `shop_api_key` is consistent with Worten's seller agreement (per distillate §15). UNVERIFIED — could be a hidden blocker | Not verified |

**FR42 dev-story status:** ZERO customer-facing dev stories per Pedro's directive. The policy is the ToS clause above; the operational refund process is in the Founder Operational track below.

## Founder Operational Track — drafted before customer #1, runs in parallel to MVP build

| Runbook | Covers | NFR | Drafted by |
|---|---|---|---|
| **Rollback playbook** | 30-min response target from critical alert to customer-facing action (triage → alert customer → diagnose → fix or revert); includes Coolify one-click previous-image revert procedure | NFR-O1, NFR-R2 | Pedro before customer #1 |
| **Solo-founder continuity runbook** (1-page) | Laptop loss, hospitalization, extended absence scenarios; 1Password recovery, Hetzner/Supabase/Stripe credentials access procedures | NFR-O2 | Pedro before customer #1 |
| **Day-1 active-monitoring protocol** | First 24h post-Go-Live per customer: audit-log tail + uptime status + 2-hour response SLA during launch week | NFR-O3 | Pedro before customer #1 |
| **Day-3 pulse-check NIF-capture script** (per F7) | Email script: *"Posso enviar a fatura Moloni para o NIF da {company}?"*; founder records NIF via `/admin/moloni-record` (Story 11.5) | F7 / AD22 | Pedro before customer #1 |
| **Day-7 pulse-check protocol** | Outbound call or email check-in; documents customer satisfaction + Atenção feed review + any cooperative-absorption events | NFR-O3 | Pedro before customer #1 |
| **Refund-process-via-Stripe-Dashboard runbook** (FR42 operational half) | Customer requests 14-day refund → founder issues full-amount refund via Stripe Dashboard manually → updates `moloni_invoices` row with refund-credit-note metadata; documented; no code | FR42 | Pedro before customer #1 |
| **Master-key rotation ceremony** (already in Story 1.2 as `scripts/rotate-master-key.md`) | Annual rotation procedure per AD3; on-incident rotation if compromise suspected | NFR-S1 | Story 1.2 ships the runbook; Pedro executes annually |
| **UptimeRobot configuration** | Monitor for `/health` 5-min cadence with founder-email failure alert (per FR45 + NFR-I5); manual setup via UptimeRobot UI; documented in ops runbook | FR45, NFR-I5 | Pedro post-Story 1.1 deploy |

## Screen → Stub Mapping table

Mechanical Step 4 fill-in: walk `_bmad-output/design-references/screens/` directory, cross-reference UX skeleton sitemap, populate the (stub filename, route/surface, UX skeleton §, FR/NFR, Pattern A/B/C) tuples.

> **NOTE:** Directory walked and table populated by Sally on 2026-04-30. All (TBD) prefixes resolved. Stubs 01–16 + 06b were already shipped (Phases B + C + content); stubs 17–25 generated mechanically during this sweep as Spec stubs (no Claude Design canvas backing yet — implementation uses skeleton sections + visual-DNA tokens; designate for Pass 2 polish or future Claude Design generation if visual ambiguity surfaces). Stub 26 (`26-dashboard-dryrun-minimal.html`) added to lock Story 4.9's stripped landing as distinct from Epic 8's full DRY_RUN state (`02-dashboard-dryrun.html`). Visual targets bundle: `_bmad-output/design-references/bundle/project/dashboard-and-audit.html`.

| Stub filename | Route / Surface | UX skeleton § | FR/NFR | Pattern |
|---|---|---|---|---|
| 11-onboarding-key.html | `/onboarding/key` form | §3.2 | FR8, FR9, FR10, FR11, NFR-P6 | A |
| 16-onboarding-key-help.html | "Como gerar?" modal | §3.2 + verified PT walkthrough copy delivered 2026-04-30 | FR10 | A |
| 10-onboarding-scan-ready.html | `/onboarding/scan-ready` | §8.3 + UX-DR33-34 | FR16 (gateway) | A |
| 17-scan-failed.html | `/scan-failed` interception | §8.1 (interception pattern) | FR15, UX-DR3 | A |
| 01-dashboard-loading.html | `/` initial-load skeleton state | §3.1 + §10.1 (shimmer animation) | (implicit; rendered by Story 8.1 as the loading state of FR34 KPIs) | A |
| 26-dashboard-dryrun-minimal.html | `/` minimal landing (Story 4.9) | §3.1 + §9.5 (banner copy) | FR30 partial | A |
| 02-dashboard-dryrun.html | `/` full DRY_RUN state (Epic 8) — KPIs simulated, margin editor expanded, Hoje preview, Go-Live CTA panel | §3.1 + §4.2 + §9.5 | FR30 (full), FR31, FR34, FR36 | A |
| 03-dashboard-live.html | `/` healthy live state | §3.1 + §4.2 | FR30, FR34, FR35 | A |
| 04-dashboard-paused-customer.html | `/` paused-by-customer state | §3.1 + UX-DR5 | FR32 | A |
| 05-dashboard-paused-payment.html | `/` paused-by-payment state | §3.1 + UX-DR5 | FR43 | A |
| 18-dashboard-anomaly-attention.html | `/` anomaly-attention state | §3.1 + UX-DR4 | FR29 | A |
| 19-dashboard-circuit-breaker.html | `/` circuit-breaker frozen state | §3.1 + UX-DR4 | FR27 | A |
| 20-dashboard-sustained-transient.html | `/` sustained-transient state | §3.1 + UX-DR4 | FR39 | A |
| 07-margin-editor.html | margin editor inline panel | §4.3 | FR36, UX-DR15-21 | A |
| 08-modal-go-live.html | Go-Live consent modal | §3.6 + §9.1 | FR31 | A |
| 09-modal-anomaly-review.html | Anomaly review modal | §3.7 + §9.2 | FR29 | A |
| 14-key-revoked.html | `/key-revoked` interception | §8.1 + UX-DR31 | NFR-S1 | A |
| 15-payment-failed.html | `/payment-failed` interception | §8.1 + UX-DR32 | FR43 | A |
| 13-admin-status.html | `/admin/status` founder page | §7 + UX-DR28-30 | FR6, FR47, NFR-O3 | A |
| 21-mobile-critical-alert.html | mobile `/?alert=X` stripped variant | §6 + UX-DR26-27 | FR48, NFR-P7 | A |
| 06-audit-log-root.html | `/audit` 3-surface root | §4.1.1-4.1.3 | FR37, FR38, FR38b, FR38d | A |
| 12-audit-search-active.html | `/audit?sku=EAN` search result | §4.1.4 + UX-DR10 | FR38, FR38b | A |
| 06b-audit-log-firehose.html | `/audit/firehose` cycle-aggregated | §4.1.5 + UX-DR11 | FR37, FR38c | A |
| 22-grace-period-banner.html | grace-period dashboard banner | §8.4 + UX-DR36 | FR4 amended | A |
| 23-settings-delete-step1.html | `/settings/delete` Step 1 page | §8.4 | FR4 amended | A |
| 24-delete-confirm-modal.html | Step 2 ELIMINAR modal | §8.4 + §9.12 | FR4 amended | A |
| 25-cancel-deletion-confirm.html | cancel-mid-grace confirmation | §8.4 | FR4 amended | A |
| n/a — Pattern B | `/onboarding/scan` progress page | §3.3 + AD16 Pass-2 5-phase | FR12-FR14, UX-DR6 | B (skeleton + visual fallback to `MarketPilot.html` ProgressScreen) |
| n/a — Pattern B | `/onboarding/margin` band picker | §3.3 + visual-DNA tokens | FR16, UX-DR2 | B |
| n/a — Pattern C | `/signup`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email` | §1 sitemap auth | FR1, FR3, NFR-S5 | C (skeleton + Supabase chrome + visual-DNA tokens) |
| n/a — Pattern C | `/settings/account`, `/settings/key`, `/settings/marketplaces`, `/settings/billing`, `/settings/delete` | §4.4 settings architecture | FR1, FR4, FR41, FR43 | C (skeleton + visual-DNA tokens + consistent chrome) |

**Pattern accounting verified:** 17 Pattern A surfaces + 2 Pattern B + 10 Pattern C = 29 distinct UI surfaces total. Pedro's directive 2 said 17 + 2 + 10 = 29. ✓

**Pattern accounting clarifier:** 17 Pattern A surfaces fan out to 27 rows due to multi-state surfaces (dashboard root has 9 state-variant rows: loading, dry-run-minimal, dry-run-full, live, paused-customer, paused-payment, anomaly-attention, circuit-breaker, sustained-transient; audit log has 3: root, search, firehose). The "17 + 2 + 10 = 29" total in directive 2 counts surfaces; the table counts rows for BAD subagent implementation clarity (each state-variant gets its own visual reference). Both views are consistent. Story 4.9 ships the minimal landing (`26-dashboard-dryrun-minimal.html`); Epic 8 ships the full DRY_RUN state on top (`02-dashboard-dryrun.html`).

---

# Notes for Pedro to Relay Back to Winston

Architecture-doc updates Pedro can sweep after Step 3+4 complete. None of these block development; they're docs cleanup that keeps the architecture in sync with the locked epics.

| # | Item | Source | Action |
|---|---|---|---|
| 1 | "16 fixtures" → "17 fixtures" | Architecture prose | Sweep all references; the enumerated fixture list IS 17 (architecture's prose count was off-by-one) |
| 2 | "6 Atenção / 8 Notável / 11 Rotina" → "7 / 8 / 11" base AD20 = 26 + 2 added in Epic 12 = **28 event_types total at end of MVP** | Architecture AD20 prose | Sweep; the enumerated Atenção list IS 7; the seed adds `cycle-fail-sustained` (Story 12.1) + `platform-features-changed` (Story 12.3) bringing total to 28 |
| 3 | Story 1.x Bob-trace collisions in architecture's per-AD lines (e.g., AD3 says "Story 1.3 key-entry form" but §I sequence puts key entry in Epic 4) | Architecture per-AD Bob-trace | Resolved per agreed Story 1.x layout (1.1 scaffold + /health, 1.2 envelope encryption, 1.3 pino, 1.4 signup + atomic profile, 1.5 founder admins); Winston updates the per-AD lines to match |
| 4 | Story 6.3 stale "verify via Mirakl MCP before locking" caveat | Story 6.3 AC at line 1810 (now fixed) | **APPLIED IN STEP 4 SWEEP (M1).** PRI03 path locked: `GET /api/offers/pricing/imports/{importId}/error_report` returning CSV with `line_number` + `error_reason` |
| 5 | `sku_channels.pri01_consecutive_failures smallint NOT NULL DEFAULT 0` | Story 6.3 introduces this column post-architecture | Architecture schema needs update to include this column (I1) |
| 6 | Story 6.3 frozen-state semantic-overload choice (option a `frozen_reason` enum vs option b `frozen_for_pri01_persistent` boolean) | Story 6.3 I2 AC | Bob picks during Story 6.3 sharding; architecture-doc updates the chosen pattern |
| 7 | Story 9.0 integration test count assertion | Story 9.0 hardcodes "26"; Stories 12.1 + 12.3 bring it to 28 | Refactor to assert `EVENT_TYPES.length` instead of hardcoded number — automatic with future event-type additions |
| 8 | `customers.day5_reminder_sent_at timestamptz` column | Story 10.3 idempotency Pass 1 references the column | **APPLIED IN STEP 4 SWEEP (N1).** Story 10.3 now lists `supabase/migrations/202604301216_add_day5_reminder_sent_at_to_customers.sql` migration |
| 9 | Story 1.5 `admin_access_denied` event logging — full email | Pedro flagged GDPR PII minimization consideration | Decide Phase 2 trigger: log hash of email (e.g., SHA-256 first 8 hex chars) instead of plaintext; or email-redaction list extension |
| 10 | Story 4.3 sign-off recording convention | Pedro choice: PR comment vs `_bmad-output/sign-offs/story-4.3.md` | Pedro picks once during first sign-off; documents convention going forward |
| 11 | UX-DR26 mobile bottom action bar safe-area inset (OQ-7) | Story 8.12 AC notes Step 4 verification on iPhone SE / iPhone 14 simulators | Sally verifies in Pass 2 visual review; document any iOS Safari adjustments |
| 12 | pri02-complete event granularity (per-sku_channel) | Story 6.2 emits one `pri02-complete` per affected sku_channel | Verify AD19's ~3M/quarter volume estimate accounts for this at 50k-SKU-per-import scale; if breaks NFR-P8, switch to one aggregate event per import |
| 13 | Story 9.6 `audit_log_atencao_archive` placement | At MVP it's an in-DB single non-partitioned table; Bob picks at story sharding | Phase 2 trigger to evaluate S3-equivalent external archive when scale demands |
| 14 | Story 11.4 concierge marketplace-add CLI security | Cleartext key handling reviewed against terminal masking + memory-only retention | Pre-customer-#2 security review of the CLI |
| 15 | Story 11.5 `moloni_invoices.customer_id` FK ON DELETE NO ACTION | Story 11.5 schema | Confirm fiscal-archive migration path before first deletion event hits a customer with prior invoices |
| 16 | Story 12.3 `critical-alert-platform-features-changed.eta` | Story 12.3 needs a 9th template OR reuses generic | Bob writes during Story 12.3 sharding; document the choice |
| 17 | **Q1 — Cancel-mid-grace Stripe handling** | Story 10.2 AC | **DECIDED 2026-04-30 — keep current MVP-simple "re-enter from scratch" approach.** Story 10.2 spec stays as-is. Bob adds a code comment in `app/src/routes/settings/cancel-deletion.js` documenting the Phase 2 refinement opportunity: *"Phase 2: if Stripe Subscription's current billing period has not yet ended at cancel-mid-grace time, uncancel via `cancel_at_period_end=false` instead of forcing customer to re-enter Stripe payment. Avoids the double-charge edge case for customers who cancel mid-grace early in their billing cycle. Trigger: any customer complaint about double-charge in months 1-2."* |
| 18 | **Q2 — `account-deletion-initiated` 29th event_type** | Pedro flagged | **DECIDED 2026-04-30 — NO 29th event_type.** AD20 stays at 28 event_types at end of MVP (26 base seed from Story 9.0 + `cycle-fail-sustained` from Story 12.1 + `platform-features-changed` from Story 12.3). Rationale: email trail (deletion-confirmation + deletion-grace-reminder + deletion-final per Story 12.2) is the canonical record for account-lifecycle events; audit_log scope stays restricted to engine events. audit_log entries get wiped at T+7d hard-delete anyway, so logging the deletion-initiation event would be self-erasing. Story 10.1's transition `(<current> → PAUSED_BY_ACCOUNT_GRACE_PERIOD)` correctly emits NO audit event — matches the locked Note. |

---

# Comprehensive Coverage Check

Final validation against Pedro's CE-brief checklist + the workflow's Step 4 protocol.

## FR Coverage — every FR1-FR48 + FR38b/c/d has at least one story

✅ **51 / 51 FRs covered.** Verification table consolidating story homes:

```
A. Account & Identity (FR1-FR7) — 7 FRs
  FR1  → Story 1.4 (signup endpoint + atomic profile trigger)
  FR2  → Story 1.4 (negative-assertion: schema has no team-membership table)
  FR3  → Story 1.4 (forgot-password / reset-password via Supabase Auth)
  FR4  → Stories 10.1 + 10.2 + 10.3 (4-step flow + grace + hard-delete)
  FR5  → Stories 2.1 + 2.2 (RLS clients + regression suite); extended in every customer-scoped table story
  FR6  → Stories 1.5 (founder_admins seed) + 8.10 (admin status page)
  FR7  → Story 1.4 (source-context capture middleware)

B. API Key & Catalog Onboarding (FR8-FR16) — 9 FRs
  FR8-FR11 → Story 4.3 (key entry + 5s validation + encrypted persistence)
  FR12-FR15 → Stories 4.4 + 4.5 + 4.6 (scan orchestration + progress + failure)
  FR16 → Story 4.8 (margin question + smart-default mapping)

C. Pricing Engine (FR17-FR25) — 9 FRs
  FR17 → Stories 4.2 (schema) + 7.x (engine logic)
  FR18 → Story 5.1 (single cron + per-SKU cadence dispatch)
  FR19 → Story 7.5 (tier transitions with F1)
  FR20 → Story 7.2 (P11 ranking + filter chain)
  FR21 → Story 7.2 (floor/ceiling math via Story 7.1's money module)
  FR22 → Story 7.3 (cooperative absorption)
  FR23 → Stories 6.1 + 6.2 + 6.3 (PRI01 writer + PRI02 poller + PRI03 parser)
  FR24 → Story 7.2 (full AD8 decision flow)
  FR25 → Stories 4.2 (per-channel data model) + 7.2 (engine) + 8.3 (toggle UI)

D. Engine Safety & Customer Controls (FR26-FR33) — 8 FRs
  FR26-FR27 → Story 7.6 (circuit breakers per-SKU + per-cycle)
  FR28 → Story 7.7 (Tier 3 daily reconciliation)
  FR29 → Stories 7.4 (anomaly freeze) + 8.7 (review modal)
  FR30 → Stories 4.9 (dry-run banner minimal) + 8.1 (full state-aware view)
  FR31 → Story 8.6 (Go-Live consent modal)
  FR32 → Story 8.5 (pause/resume with cron_state transitions)
  FR33 → Story 4.2 (baseline_snapshots schema captured during scan)

E. Dashboard & Audit Log (FR34-FR39 + FR38b/c/d) — 9 FRs
  FR34 → Stories 8.1 (chrome) + 8.2 (KPI cards) + 9.2 (data source)
  FR35 → Story 8.3 (PT/ES toggle)
  FR36 → Story 8.4 (margin editor + worked-profit-example)
  FR37 → Stories 9.3 + 9.4 + 9.5 (5-surface IA + search + firehose)
  FR38 → Stories 9.3 + 9.4 (filtering + search)
  FR38b → Story 9.3 (5-surface hierarchical IA)
  FR38c → Story 9.5 (firehose cycle-aggregated)
  FR38d → Stories 9.0 (event-type taxonomy) + 9.3 (default surfacing)
  FR39 → Stories 8.8 (banner UI) + 12.1 (sustained-transient classifier)

F. Subscription & Billing (FR40-FR44) — 5 FRs
  FR40 → Story 11.1 (Stripe Customer + Subscription on Go-Live)
  FR41 MVP → Stories 11.4 (concierge CLI) + 8.11 (read-only marketplaces UI)
  FR42 → Parallel Tracks → Legal (ToS clause) + Founder Operational (refund-via-Stripe-Dashboard runbook); ZERO dev stories per Pedro's directive
  FR43 → Stories 11.2 (webhook → cron_state) + 11.3 (Stripe Customer Portal)
  FR44 → Story 11.5 (Moloni metadata + NIF capture)

G. Operations & Alerting (FR45-FR48) — 4 FRs
  FR45 → Story 1.1 (/health composition)
  FR46 → Story 12.1 (3-tier failure model + sustained-transient classifier)
  FR47 → Stories 1.5 (founder_admins seed) + 8.10 (admin status page UI)
  FR48 → Stories 4.6 (Resend client foundation) + 12.2 (extended PT templates)
```

## AD Coverage — every AD1-AD30 has at least one story

✅ **30 / 30 ADs covered.** Constraint ADs (AD18 polling-only, AD28 validation lib) covered as Story 1.1 negative assertions PLUS the consolidated Architectural Constraints section above. F1-F13 amendments folded into parent ADs throughout.

```
AD1  → Story 1.1 (two services, one repo, Coolify deploy)
AD2  → Stories 2.1 (DB clients) + 2.2 (RLS regression)
AD3  → Story 1.2 (envelope encryption)
AD4  → Stories 1.5 (founder_admins) + 8.10 (admin page)
AD5  → Story 3.1 (Mirakl HTTP client port)
AD6  → Story 4.1 (channel_pricing_mode enum + per-channel data model)
AD7  → Story 6.1 (PRI01 writer) + 6.2 (PRI02 poller) — atomicity-bundle gate at Story 7.8
AD8  → Story 7.2 (full decision flow)
AD9  → Story 7.3 (cooperative absorption with skip-on-pending)
AD10 → Stories 4.1 (schema) + 7.5 (transitions with F1 atomic write)
AD11 → Story 7.6 (circuit breakers per-SKU + per-cycle with F6 denominator)
AD12 → Story 7.4 (anomaly freeze)
AD13 → Stories 3.2 (self-filter module) + 7.2 (engine integration)
AD14 → Stories 3.2 (filter chain module) + 7.2 (engine STEP 1)
AD15 → Stories 4.1 (cron_state schema + transitionCronState) + 5.1 (dispatcher reads state) + 8.8 (banner UX consumes state)
AD16 → Story 4.4 (full onboarding scan sequence with F4)
AD17 → Story 5.1 (master cron + per-customer advisory locks)
AD18 → Architectural Constraints #1 (negative assertion in Story 1.1; polling-only architecture)
AD19 → Stories 9.1 (partitioned table + monthly cron) + 9.2 (precomputed aggregates) + 9.6 (archive job)
AD20 → Story 9.0 (lookup table + 26-row seed; +27th in Story 12.1; +28th in Story 12.3)
AD21 → Stories 10.1 (initiation) + 10.2 (cancel-mid-grace) + 10.3 (T+7d hard-delete)
AD22 → Stories 11.1 + 11.2 + 11.5 (Stripe + webhook + Moloni with F2 + F7 + F12)
AD23 → Story 1.1 (/health composition reads worker_heartbeats)
AD24 → Stories 6.3 (PRI01 escalation) + 12.1 (3-tier classifier with F10) + 12.2 (Resend templates)
AD25 → Stories 4.6 (Resend client minimal SSoT) + 12.2 (PT-localized templates)
AD26 → Story 12.3 (PC01 monthly re-pull cron)
AD27 → Story 1.3 (pino redaction)
AD28 → Architectural Constraints #2 (negative assertion in Story 1.1; Fastify built-in JSON Schema only)
AD29 → Story 1.4 (atomic auth+profile trigger with F3)
AD30 → Story 2.2 (RLS regression suite + CI block)
```

## F1-F13 Amendments — all incorporated

✅ **13 / 13 amendments folded into parent ADs:**

```
F1  → Story 7.5 (T2a→T2b atomic write of tier_cadence_minutes=45)
F2  → Story 11.1 (Stripe model: ONE Customer + ONE Subscription per customer + ONE SubItem per marketplace)
F3  → Story 1.4 (Postgres trigger SECURITY DEFINER on auth.users — atomicity bundle)
F4  → Stories 4.1 + 4.4 (PROVISIONING + nullable A01/PC01 + CHECK constraint — atomicity bundle)
F5  → Story 9.0 (audit_log_event_types lookup migration ordering before audit_log)
F6  → Story 7.6 (circuit-breaker per-cycle 20% denominator clarified)
F7  → Stories 11.5 + Founder Operational track (NIF capture flow at Day-3 pulse-check)
F8  → Story 9.1 (audit_log.sku_id + sku_channel_id NO FK constraint)
F9  → Story 1.1 + per-page eta templates (no-bundler script loading via defer)
F10 → Story 12.1 (sustained-transient threshold hardcoded at 3 cycles; Phase 2 trigger)
F11 → Story 1.1 (worker process count: ONE instance at MVP via replicas: 1)
F12 → Story 11.1 (Stripe linkage layout corrected post-F2)
F13 → Story 4.1 (cron_state enum-value casing standardized to UPPER_SNAKE_CASE)
```

## Atomicity bundles preserved

✅ All three atomicity bundles ship as adjacent stories with single integration-test gates:

- **F3 + AD29** → Story 1.4 (single PR: signup endpoint + auth.users trigger + customer_profiles atomic creation + JSON Schema validation + safe-error mapping)
- **F4 + onboarding scan** → Stories 4.1 (schema with PROVISIONING + CHECK) + 4.4 (scan flow that populates A01/PC01 columns and transitions out of PROVISIONING)
- **AD7 + AD8 + AD9 + AD11** → Stories 6.1 (writer) + 7.2 (engine) + 7.3 (absorption) + 7.6 (per-SKU CB), with the integration-test gate at Story 7.8 exercising all 17 P11 fixtures

## All 17 P11 fixtures distributed

✅ **17 / 17 fixtures referenced** across Epic 7 stories with Story 7.8 integration gate covering all of them end-to-end:

```
12 fixtures in Story 7.2 (engine decision flow):
  p11-tier1-undercut-succeeds, p11-tier1-floor-bound-hold,
  p11-tier1-tie-with-competitor-hold, p11-tier2b-ceiling-raise-headroom,
  p11-all-competitors-below-floor, p11-all-competitors-above-ceiling,
  p11-self-active-in-p11, p11-self-marked-inactive-but-returned,
  p11-single-competitor-is-self, p11-zero-price-placeholder-mixed-in,
  p11-shop-name-collision, p11-pri01-pending-skip

1 fixture in Story 7.3:
  p11-cooperative-absorption-within-threshold

1 fixture in Story 7.4:
  p11-cooperative-absorption-anomaly-freeze

3 fixtures in Story 7.5:
  p11-tier2a-recently-won-stays-watched,
  p11-tier3-no-competitors,
  p11-tier3-then-new-competitor

ALL 17 in Story 7.8 integration gate (full cycle through engine + writer + cooperative-absorption + circuit-breaker against mock Mirakl seeded with verification-results.json)
```

## UX-DR coverage — every UX-DR1-UX-DR38 has a story

✅ **38 / 38 UX-DRs covered.** Distribution:

- UX-DR1 → Story 1.4 (auth middleware + ?next= preservation)
- UX-DR2 → Stories 4.3, 4.5, 4.7, 4.8, 4.9, 8.1 (forward-only state machine)
- UX-DR3 → Stories 4.6, 8.1, 8.9 (interception override)
- UX-DR4-5 → Story 8.8 (banner library)
- UX-DR6 → Story 4.5 (5-phase progress per AD16 Pass-2)
- UX-DR7-12 → Stories 9.3, 9.4, 9.5 (5-surface IA + trust property)
- UX-DR13-14 → Stories 8.1, 8.2, 8.3 (dashboard layout + channel toggle)
- UX-DR15-21 → Story 8.4 (margin editor)
- UX-DR22 → Story 8.11 (settings sectioned nav)
- UX-DR23-24 → Stories 4.3 (primary trust block) + secondary evidence across operational UI
- UX-DR25-27 → Stories 8.1, 8.12 (mobile vs desktop strategy)
- UX-DR28-30 → Story 8.10 (founder admin status page + reuse pattern)
- UX-DR31 → Story 8.9 (key-revoked interception)
- UX-DR32 → Story 8.9 (payment-failed first-time interception)
- UX-DR33-34 → Story 4.7 (scan-ready interstitial + refurbished disclosure)
- UX-DR35-37 → Stories 10.1, 10.2 (4-step deletion + grace banner + email)
- UX-DR38 → Story 8.11 (concierge marketplace-add tooltip in /settings/marketplaces)

## Story dependency check — no forward dependencies within epic

✅ Verified: every story's `Depends on:` line references only PRIOR-numbered stories (within the epic) OR stories from earlier epics (calendar-shipping order). Exception correctly documented: Story 9.0 + Story 9.1 ship calendar-early as Story 1.x siblings per Option A — this is the ONLY out-of-numerical-order shipping in the spec, and it's annotated explicitly in Epic 9's intro + every dependent story's Depends-on line.

---

# Workflow Complete

**Step 1** — Requirements extraction: 51 FRs + 42 NFRs + 30 ADs + 13 amendments + 38 UX-DRs.
**Step 2** — Epic structure: 12 epics following architecture §I sequence; FR coverage map; dependency DAG.
**Step 3** — Story creation: 62 stories across 4 batches with full BDD acceptance criteria, named files, named fixtures, pass/fail gates.
**Step 4** — Final validation: Architectural Constraints (27 items) + Parallel Tracks (Legal + Founder Operational + Screen→Stub Mapping) + Notes for Pedro (18 items) + Comprehensive coverage check.

This `epics.md` is ready for Bob (SM agent) to shard into sprints + BAD subagents to implement in parallel. Every story carries the AD/FR/NFR refs, single-source-of-truth modules, test fixtures, and pass/fail gates needed for cold pickup.

The trust property is preserved end-to-end: encrypted-at-rest keys (Story 1.2 + Story 4.3); RLS at the DB layer (Stories 2.1 + 2.2); audit log as legal/trust artifact (Story 9.0 + Story 9.1 calendar-early); customer self-flips Go-Live (Story 8.6); pause-as-freeze (Story 8.5); informed-consent modal (Story 8.6); customer-self-service investigation via 5-surface audit log (Stories 9.3 + 9.4 + 9.5); deletion at initiation (Story 10.1 destroys key immediately, not at grace-end).

The atomicity invariants are preserved: signup never lands in orphan-auth-without-profile state (F3 + AD29 trigger pattern); onboarding scan can never leave a row stuck in PROVISIONING (F4 + Story 4.1 CHECK + Story 4.4 population atomicity); engine cannot push prices that violate the writer's pending_import_id contract or the cooperative-absorption skip-on-pending (AD7 + AD8 + AD9 + AD11 atomicity-bundle gate at Story 7.8); cron_state transitions are atomic with audit emissions per the (from, to) → event_type lookup (Story 4.1).

The single-source-of-truth modules cannot be paralleled: 6 custom ESLint rules ship with their target modules (`no-direct-fetch`, `no-raw-CSV-building`, `no-raw-INSERT-audit-log`, `no-float-price`, `no-raw-cron-state-update`, `worker-must-filter-by-customer`) — divergence is mechanically impossible without explicit override comments.
