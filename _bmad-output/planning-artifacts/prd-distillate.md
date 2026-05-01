---
type: bmad-distillate
sources:
  - "prd.md"
downstream_consumer: "bmad-create-story (Bob) and bmad-dev-story (Amelia)"
created: "2026-05-01"
token_estimate: 11500
parts: 1
---

## Document Metadata
- PRD for marketpilot-repricer; status complete; date 2026-04-29; lastAmended 2026-04-29; workflow type prd
- Author: Pedro; project_name marketpilot-repricer; classification saas_b2b / general / medium-high complexity / greenfield
- Steps completed: init, discovery, vision, executive-summary, success, journeys, domain, innovation, project-type, scoping, functional, nonfunctional, polish, complete
- Post UX-skeleton amendments: FR4 (account deletion multi-step + 7-day grace), FR41 (split MVP concierge / Epic 2 self-serve), FR38b/c/d (audit log hierarchical summarization)
- Input docs: _bmad-output/planning-artifacts/product-brief-marketpilot-repricer.md, product-brief-marketpilot-repricer-distillate.md, CLAUDE.md
- External code sources for reuse: D:\Plannae Project\DynamicPriceIdea (Mirakl P11 + API patterns, in production); D:\Plannae Project\Gabriel - Marketplace (OAuth2 token mgmt, pricing engine math, price-submission batching)
- Domain notes: e-commerce/marketplace tooling — not in CSV; flags: encrypted API key vault, automated price-setting agency, multi-tenant from day 1, PT/ES NIF/IVA invoicing

## Product Identity
- MarketPilot Repricer: self-served B2B SaaS automating competitive repricing for Iberian sellers on Mirakl marketplaces; starting Worten PT/ES
- Target: Iberian Mirakl SMEs operating 10k–100k SKU catalogs (electronics, computing, gaming, appliances)
- Named warm leads: Tony @ You Get (8.4k Worten products, 5 Mirakl marketplaces, LTV €250/mo); WDMI/Oportunidade24 (50k SKUs, in-scope new commodity portion only); Servelec (70k); Twomii (100k+)
- Pricing: flat €50/marketplace/month, no setup fee; PT NIF/IVA invoicing via Moloni (manual MVP, API Epic 2)
- Stack: Node.js >=22, Fastify, Postgres, Supabase Cloud EU; Hetzner via Coolify; repricer-worker cron internal

## Strategic Wedges (4 differentiators)
- Trust as architecture: shop_api_key has no read-only mode; encryption-at-rest, founder never sees cleartext, single-purpose key form, Supabase Auth + RLS day-1, dry-run-by-default, customer self-flips Go-Live, full audit log incl. external-change-absorbed events
- Free-report → repricer funnel = trust step-up: DynamicPriceIdea (no API key, try-without-trust) → repricer (encrypted key, pay-with-trust); dashboard reuses free report KPI categories (visually consistent family, not identical UI)
- Cooperative ERP-sync: customer's ERP/manual edit/other tool is authoritative; engine absorbs external changes as new list_price baseline (not overwrite); no segment competitor does this
- Belt-and-suspenders safety surfaced to customer: 4 independent layers (4-state tier system, outbound circuit breaker ≤20%/cycle ≤15%/SKU, nightly reconciliation = Tier 3 daily pass, inbound anomaly freeze >40%)
- Worked-profit-example margin editor (live euro impact using customer's own representative SKU)
- Direct shop API key, no MiraklConnect dependency (sidesteps Boostmyshop's ceiling)
- Founder accessibility: Pedro named, directly reachable, Portuguese-speaking — trust layer VC-backed faceless competitors cannot replicate

## Competitive Context
- Fnac June 2025 Mirakl exit consolidated PT/ES volume onto Worten + Phone House; Worten Ads (July 2025) pulled fresh SME sellers
- Boardfy (Spanish, sticker €19/mo + hidden add-ons): CMS-oriented, no PT/ES presence, no ERP-cooperative model
- Boostmyshop myPricing (French, ~€99/mo+): MiraklConnect-dependent, rule-based; assumes repricer authoritative
- Omnia Retail (€10k+/yr): SME-inaccessible enterprise
- Generic Amazon repricers (Repricer.com, Informed, BQool): Capterra reviews flag silent stalls, lost-sync symptoms
- €50/mo SME band sits in gap between Boardfy/Boostmyshop mid-market and Omnia enterprise
- Caveat: assessment based on customer-facing docs/reviews, not internal architecture

## Success Criteria — User
- First 3 paying customers complete onboarding self-served end-to-end without founder intervention beyond Day-1 monitoring; concrete signal: customer accesses audit log ≥1× in first 7 days post-Go-Live
- ≥10% of free-report CTA-clickers reach key-entry form; ≥30% of customers who validate key reach Go-Live within 14 days; HYPOTHESES not validated targets — recalibrate after first 5-10 customer cohort, do not gate decisions until calibration
- Cooperative ERP-sync real not theoretical: external-change-absorbed events show in audit log of every active customer (zero = red flag); zero "tool fights my ERP" complaints in first 90 days
- Pause works as trust escape valve: customers who pause resume in ≤1 click within 24h ≥80% of time

## Success Criteria — Business
- Time to first revenue: 6-8 weeks post-MVP completion; concrete first-customer candidate Tony @ You Get (else next-most-warm from OUTREACH.md top-4)
- Time to first cohort: ≤12 weeks post-MVP = 3 paying customers (matches Day-1 active-monitoring cohort size)
- 6-month MRR floor: €500 (achievable with 4 single-marketplace customers OR Tony's 5-marketplace €250/mo + 2-3 single)
- Optimistic upside narrative (NOT a target): €1k+ MRR if multi-marketplace warm leads close (Twomii, Tek4life, PC GO)
- Plan B activation: week 6 post-MVP zero conversions → restart cold outreach + LinkedIn/ACEPI/Adigital/Worten-forum inbound
- Churn red-flag (informational): >1 of first 3 cancels in months 1-2 → forces decision on 3-month prepaid minimum (OPEN per brief §1)

## Success Criteria — Technical
- Tier 1 cycle latency p95 ≤18 min (15-min nominal cadence + retry/backoff allowance); Tier 2a holds same target per FR18 / NFR-P2
- Zero plaintext API keys at rest; verified pre-launch via internal security review + external review during legal/ToS work pre-revenue; ongoing zero plaintext key occurrences in DB dumps
- 100% of PRI01 pushes resolve to PRI02 COMPLETE or FAILED within 30 min; stuck-WAITING ≥30 min trips critical alert
- Zero out-of-tolerance prices reach Worten (enforced by circuit breaker + per-SKU floor/ceiling clamping at engine output); zero audit-log entries where pushed price < floor or > ceiling
- /health endpoint ≥99% uptime via UptimeRobot 5-min ping; below threshold trips founder email
- Critical alert delivery latency ≤5 min from event detection to customer email (auth invalid, sustained outage, anomaly freeze, circuit breaker trip)
- Catalog scan scales to 50k SKUs (~10 concurrent calls × 200ms math; UNVERIFIED — ARCH must confirm via MCP and bake real limits into pacing)

## Success Criteria — Measurable Outcomes
- ≥80% catalog cleanly repriced within 24h of Go-Live
- Customer's "SKUs in 1st place" KPI improves week-over-week for first 4 weeks post-Go-Live
- Founder ≤10 min/customer/month on Moloni manual invoicing at MVP scale (Moloni API Epic 2 trigger when aggregate exceeds 2-3 hr/month)
- Zero customer-discovered safety incidents in first 90 days

## MVP Scope (locked)
- Build budget: 2-3 weeks AI-assisted dev; 6-8 weeks to first revenue incl. legal gates and first-customer onboarding
- Resource: solo founder, €100/mo Claude subscription, €0 paid marketing, Hetzner+Coolify already running, Supabase free tier expected to cover MVP
- Final onboarding flow: signup → key entry (with linked Worten-key guide) → async catalog scan → margin band question → dry-run review → margin tuning with worked-profit-example → informed-consent Go-Live → Stripe subscription → live cron + manual Moloni invoice
- Auth & multi-tenancy: Supabase Auth (email + password + verify), Supabase RLS, two-principal model day 1 (founder admin + first customer)
- Single-purpose key-entry form with inline 5-second validation (test P11 call); encrypted-at-rest vault — KMS spec deferred to ARCH
- One-page "How to find your Worten Marketplace API key" guide linked from key-entry form (Worten Seller Center → Account → API)
- Async catalog scan: closeable progress page, server-side job state, reconnection handling, email on failure only
- Onboarding = single margin band question only; smart default max_discount_pct (<5%→0.5%, 5-10%→1%, 10-15%→2%, 15%+→3%); max_increase_pct global default 5%
- Two questions deliberately NOT asked: (1) "using another repricing tool?" — ~99% segment runs zero automation, conflicts detected at runtime; (2) "different prices PT vs ES?" — VAT pass-through (23% PT / 21% ES) + shipping deltas mean every customer technically has different per-channel prices, useless filter
- Engine: cooperative ERP-sync + 4-state tier system + per-channel; FR17–FR19 full spec; per-SKU per-channel rows; list_price, last_set_price, current_price, baseline snapshot; rank competitors by total_price (price + shipping); filter active=true offers only
- Engine safety: 3 independent layers + reconciliation (outbound circuit breaker, nightly reconciliation = Tier 3 daily pass, inbound anomaly freeze); trip = freeze + alert + manual unblock
- Engine decision table: tie cases, leader-is-self, all-competitors-above-ceiling, two-repricer-conflict, single-channel offer, single-competitor — fully enumerated in FR24 / Engine Mechanics
- Dashboard: PT/ES channel toggle; KPI cards using same categories as free report ("A tua posição agora": SKUs in 1st, losing position, exclusive, catalog value at risk); audit log per-customer-per-channel filterable by channel/SKU/event type with rich entry detail; margin editor with live worked-profit-example using customer's own SKU; big single-click Pause/Resume
- Informed-consent Go-Live modal with conditional Portuguese language ("Até N produtos poderão ter preços ajustados, dentro da margem de X%"); customer self-flips; Stripe subscription starts on flip; cron flips live
- Stripe subscription (recurring monthly €50/marketplace); Moloni manual invoicing (~5-10 min/customer/month)
- Operations: 3-tier failure model (transient retry → per-SKU operational log → critical email+banner); Resend critical alerts only (free tier 3k emails/mo); UptimeRobot 5-min /health pings; PRI02 polling; solo-founder continuity runbook (1-page) drafted before customer #1
- Day-1 customer-success: documented rollback playbook (30-min response); founder monitoring dashboard (audit-log tail + uptime); 2-hour response SLA during launch week; day-3 and day-7 pulse-check protocol
- Pre-revenue legal gates BLOCK first invoice, do NOT block MVP build: updated ToS for automated price-setting agency; B2B DPA template; refund policy (14-day money-back post-Go-Live); Worten/Mirakl operator ToS compatibility check

## MVP Excluded (explicit boundaries)
- Refurbished products on Worten — structurally out of scope at MVP AND Epic 2; Worten has no shared EAN catalog for seller-created refurbished listings → P11 returns no comparable competitor offers → engine would classify Tier 3 forever; not unlockable in Epic 2
- Multi-user within customer account: single login per account at MVP; multi-user/RBAC = Epic 2 (handles WDMI-scale; Tony-scale fine with shared login for 1-3 trusted ops)
- External API: N/A at MVP AND Epic 2; reopen Epic 3+ on demand signal (≥2 paying customers ask for audit-log export or programmatic margin updates)
- Add Marketplace UI in customer dashboard: NOT at MVP — concierge by founder per FR41 (MVP); Epic 2 ships self-serve add/remove via dashboard

## Epic 2 (Growth) — Triggered, not scheduled
- Multi-marketplace beyond Worten (Phone House ES, Carrefour ES, PCComponentes, MediaMarkt; ~1-2 weeks per integration) — trigger: first customer commits to non-Worten Mirakl marketplace
- Per-channel margin overrides — trigger: customer requests + demonstrably different per-channel competitive landscape
- Cost-CSV upload (for thin-margin power users where %-tolerance structurally insufficient) — trigger: <5% margin customer signs up + %-tolerance proves insufficient
- Per-SKU exclude / promo-mode toggle (covers flash-sale absorbed as new baseline) — trigger: customer reports flash-sale absorption or warns of upcoming promo
- Customer-tunable anomaly-freeze threshold (today hardcoded 40%) — trigger: 2+ requests OR slow-drift observed in audit log
- Restore-baseline UI (snapshot captured at MVP scan; only UI deferred) — trigger: customer requests rollback
- Revenue-impact reporting in € (requires baseline a/b methodology) — trigger: comparison data available, likely after 3-month stable cohort
- Moloni API integration — trigger: founder manual-invoicing time exceeds 2-3 hr/month aggregate
- Per-SKU manual controls — trigger: power-user demand surfaces
- Historical analytics / time-series — trigger: customer requests >1×
- Dedicated price-up candidates / ceiling-headroom panel — trigger: customer requests >1×
- RBAC multi-user-within-account (owner / operator / viewer) — trigger: first customer at scale where shared login breaks (likely WDMI in-scope portion)
- Self-serve marketplace add/remove via dashboard with Stripe proration on add, end-of-cycle removal, no mid-cycle refund (FR41 Epic 2)
- Spanish (ES) UI localization + ES email templates — trigger: primary-ES customer signs up

## Vision (Phase 3)
- Standard repricing tool for Iberian Mirakl SMEs (10k-100k SKU segment); self-sustaining inbound funnel via free report + LinkedIn/ACEPI/Adigital/seller forums
- Cross-platform beyond Mirakl (Bol.com, Real.de, other operator-specific Iberian/European marketplaces) — trigger: customer demand from existing accounts + sufficient revenue base
- Possible small team — trigger: revenue justifies + founder operationally bottlenecked; hire criteria LOCKED: Portuguese-speaking, named publicly
- Free-report ecosystem expansion (margin-erosion alerts, competitor-entry alerts) — trigger: free-report engagement metrics signal appetite
- Possible tier introduction OR separate Pro product — trigger: power-user demand exceeds flat-fee model; Pro product preserves flat-fee wedge in core; tiering carries brand cost (erodes counter-positioning)

## User Journey — Binding Requirements (no narrative)
- Tony @ You Get (success path): free-report CTA → repricer signup; smart-default margin from one onboarding question; dry-run by default with simulated events visible in audit log; informed-consent modal Portuguese conditional copy; Stripe subscription on Go-Live click; founder Day-3 pulse-check email
- Ricardo @ WDMI (thin margins): smart-default warning copy for <5% margin segment + Epic 2 cost-CSV recommendation; extended dry-run no time limit; inbound anomaly freeze (>40% deviation) with customer-facing review/confirm UI; critical alerts via Resend ≤5 min latency; outbound circuit breaker ≤20%/cycle with halt + alert + audit-log forensic trail; Pause = freeze (NOT rollback) at MVP; audit log filterable by event type ("external-change-absorbed", "circuit-breaker-trip"); Resume = single click
- Pedro (founder Day-1): /health endpoint with UptimeRobot 5-min ping; founder monitoring dashboard (internal cross-customer audit-log tail, uptime, circuit-breaker state); 3-tier failure model; customer-facing dashboard banner for sustained transient issues, Portuguese-localized; 2-hour SLA during customer launch week; Moloni invoice ~5-10 min/customer/month manual MVP; Day-3/Day-7 pulse-check protocol; solo-founder continuity runbook drafted before customer #1
- Customer self-service investigation (audit log as trust deliverable): audit log filterable by SKU/EAN (in addition to channel/event type); audit log entries include timestamp, competitor context (price, shop name, ranking position), engine decision rationale (undercut vs ceiling raise vs hold), tolerance band (floor/ceiling), tier classification, PRI01/PRI02 lifecycle status; multi-user-within-account LOCKED: single login at MVP, RBAC Epic 2
- Journey 5 (API consumer): N/A at MVP AND Epic 2

## Functional Requirements — A. Account & Identity
- FR1: self-serve signup with email + password; email verification required before app access
- FR2: single login per customer account at MVP; multi-user RBAC reserved for Epic 2
- FR3: password reset via email-verified flow
- FR4: account deletion is multi-step (NOT single-click) — (1) initiate from settings; (2) modal requires typing confirmation phrase (e.g. `ELIMINAR`); (3) 7-day soft-delete grace period (cron paused, dashboard locked, data retained, customer can cancel and restore); (4) at grace-period end, GDPR Article 17 wipe of encrypted shop API key, audit log entries (excluding fiscal-evidence exceptions per ToS), Stripe customer/subscription refs, catalog/baseline/pricing-state data; Moloni invoice metadata retained as fiscal record. Emails: at initiation + day-5 reminder + final-deletion confirmation
- FR5: tenant data-isolation enforced at DB layer (RLS); cross-customer access prevented even on misconfigured routes
- FR6: founder admin can run read-only operational queries across tenants; cannot edit customer data via normal product flows
- FR7: signup form accepts and persists optional source-context query params (e.g. `?source=free_report&campaign=tony_august`) on customer record for funnel attribution; wires DynamicPriceIdea cross-repo handoff

## Functional Requirements — B. API Key & Catalog Onboarding
- FR8: customer pastes single Worten Mirakl shop API key into single-purpose entry form during onboarding
- FR9: system validates API key inline within 5 seconds via known-good Mirakl P11 call against reference EAN; inline error feedback on failure
- FR10: one-page guide ("How to find your Worten Marketplace API key") linked from key-entry form, walking through Worten Seller Center key generation
- FR11: API key stored encrypted at rest; founder cannot view cleartext; application MUST NOT log cleartext key material
- FR12: on successful key validation, async catalog scan kicks off, reads Mirakl catalog, snapshots baseline pricing state per SKU per channel
- FR13: customer monitors catalog scan via closeable progress page; can disconnect/reconnect without disrupting scan
- FR14: scan job state persisted server-side; reconnection after disconnect does not restart scan
- FR15: email customer on scan failure or critical scan issues; healthy completion does NOT trigger email (customer logs back in to find populated dashboard)
- FR16: single onboarding margin question (bands: <5%, 5-10%, 10-15%, 15%+) drives smart-default `max_discount_pct` (0.5% / 1% / 2% / 3%) and global `max_increase_pct` default of 5%; <5% band shows warning recommending extended dry-run, notes cost-CSV control reserved for Epic 2

## Functional Requirements — C. Pricing Engine
- FR17: per-SKU per-channel pricing state includes `list_price`, `last_set_price`, `current_price`, baseline snapshot, tier classification, `last_won_at` (nullable timestamp of most recent transition into 1st place), `tier_cadence_minutes` (per-SKU cadence in minutes, derived from tier)
- FR18: 4-state tier classification + per-SKU cadence — Tier 1 (contested, position > 1) cadence 15 min; Tier 2a (winning, position = 1, `last_won_at < 4h` ago, recently won) cadence 15 min, watched as closely as Tier 1 because active-repricer markets like Worten can undercut within minutes of taking 1st; Tier 2b (winning, position = 1, `last_won_at ≥ 4h` ago, stable winner) cadence 30-60 min; Tier 3 (no competitors found) cadence daily, daily pass also serves as nightly reconciliation
- FR18 implementation: SINGLE cron polling every 5 minutes selects SKUs where `last_checked_at + tier_cadence_minutes < now()`; NOT per-tier crons; supports per-customer cadence customization in Epic 2 without rework; 4h threshold and Tier 2b 30-60 min cadence are starting defaults, calibratable downstream during dogfood / first-customer; Tier 1 / Tier 2a cadence may relax for 100k+ SKU catalogs subject to Mirakl rate-limit budget (open ARCH question)
- FR18 rationale: Tier 2a closes blind window where automated competitor repricer undercuts within minutes of customer taking 1st; original 3-state system (RESEARCH.md, superseded) assumed manual competitor changes — fails on Worten where multiple active repricers compete
- FR19: tier transitions — Tier 1 → Tier 2a on winning 1st (action: set `last_won_at = now()`); Tier 2a → Tier 2b after 4h elapsed since `last_won_at` (no DB write; classification recomputed at next cycle when cadence threshold check runs); any of {Tier 2, Tier 2a, Tier 2b} → Tier 1 on losing 1st (last_won_at preserved as most-recent-win for analytics); Tier 3 → Tier 1 or Tier 2a on new competitor entering (if already at 1st AND price still beats new competitor → Tier 2a with `last_won_at = now()`; otherwise → Tier 1)
- FR20: engine reads competitor offer data per SKU via Mirakl P11; ranks competitors by `total_price` (price + shipping); filters to active offers only
- FR21: engine computes per-SKU floor = `list_price × (1 - max_discount_pct)` and ceiling = `list_price × (1 + max_increase_pct)`; only pushes prices within band
- FR22: cooperative ERP-sync — if external entity changes `current_price` between cycles, engine treats change as new pricing intent and updates `list_price` to match (NOT overwrite)
- FR23: engine writes price updates via PRI01 ONLY (never OF24); polls PRI02 until COMPLETE or FAILED; only updates `last_set_price` after PRI02 confirms COMPLETE
- FR24: engine handles documented decision-table cases (tie cases, leader-is-self, all-competitors-above-ceiling, two-repricer-conflict, single-channel offer, single-competitor) per Engine Mechanics
- FR25: repricing is per-channel (Worten PT vs Worten ES); margin tolerance configured globally per customer at MVP; per-channel margin overrides reserved for Epic 2

## Functional Requirements — D. Engine Safety & Customer Controls
- FR26: outbound circuit breaker halts cycle if >20% of customer's catalog would be repriced in that cycle, OR if any single SKU's price would move >15%
- FR27: when circuit breaker trips, system freezes cycle, alerts customer, requires manual review/unblock before resuming
- FR28: nightly reconciliation pass (implemented as Tier 3 daily cycle) re-scans all products, re-classifies tiers, self-heals stale state
- FR29: when external price change deviation >40% from previous `list_price` detected, system freezes that SKU's repricing and surfaces review/confirm-or-reject UI to customer
- FR30: dry-run mode default — simulates price decisions, logs would-have-done events to audit log, does NOT push to Mirakl; customer can stay in dry-run as long as desired before going live
- FR31: Go-Live flip for active repricing only after viewing/accepting informed-consent modal with conditional language about how many products may be repriced and within what margin tolerance
- FR32: pause/resume active repricing single-click each; pause freezes cron, leaves current Worten prices at last-set state (NO rollback at MVP); resume reactivates cron from paused state
- FR33: pre-tool baseline pricing snapshot captured during initial scan is retained, enabling Epic 2 "restore baseline" without data archaeology

## Functional Requirements — E. Dashboard & Audit Log
- FR34: dashboard KPI cards use same categories as free report — SKUs in 1st place, SKUs losing position, SKUs exclusive / Tier 3, total catalog value at risk
- FR35: customer can toggle between Worten PT and Worten ES; dashboard reflects per-channel state
- FR36: margin editor for `max_discount_pct` and `max_increase_pct` displays worked-profit-example using representative SKU from customer's catalog, updating live as values change
- FR37: per-customer-per-channel audit log of every engine action with timestamp, competitor context (price, shop name, ranking position), engine decision rationale (undercut / ceiling raise / hold), tolerance band (floor/ceiling), tier classification, PRI01/PRI02 lifecycle status
- FR38: audit log filterable by channel, SKU/EAN, event type; external-change-absorbed and circuit-breaker-trip events tagged distinctly
- FR38b: audit log UI uses HIERARCHICAL SUMMARIZATION, not flat chronological feed. Four default surfaces — (1) daily-summary stats card at top: aggregate counts (price changes, holds, external-change-absorbed, anomaly-frozen SKUs) + position deltas vs prior day; (2) "A precisar de atenção" feed: events requiring customer decision (anomaly-freeze, circuit-breaker-trip, mid-life key revocation, persistent PRI01 failures, payment-failure-pause), steady state 0-2/day; (3) "Eventos notáveis" feed: moderate-frequency events of interest but not requiring action (external-change-absorbed, position-won, position-lost, new-competitor-entered, large-price-move within tolerance), capped with "Ver todos" link, steady state 5-30/day; (4) Search by SKU/EAN as primary investigation primitive — pulls all events for a single product chronologically, bounded by product. Routine churn (undercut decisions, ceiling raises, holds, cycle-start/end) hidden by default, accessible only via "Mostrar todos os ajustes" filter. Volume math: 50k-SKU contested catalog → 100-500 price changes per 15-min Tier 1 cycle (~10k-50k entries/day, ~3M/quarter); flat chronological feeds unusable at this volume
- FR38c: "Mostrar todos os ajustes" (firehose) filter presents events GROUPED BY CYCLE, not flat chronological — one row per cycle showing aggregate counts (e.g. "03:14 cycle: 43 undercuts, 4 raises, 12 holds, 0 failures") with per-SKU detail expandable on click
- FR38d: audit log event types classified at three priority levels driving default surfacing — "Atenção" (always shown in FR38b surface 2): anomaly-freeze, circuit-breaker-trip, key-validation-fail (mid-life revocation), persistent PRI01-fail, payment-failure-pause; "Notável" (capped feed in FR38b surface 3): external-change-absorbed, position-won, position-lost, new-competitor-entered, large-price-move-within-tolerance, customer-paused, customer-resumed; "Rotina" (hidden by default, visible only via firehose filter per FR38c): undercut-decision, ceiling-raise-decision, hold-floor-bound, hold-already-in-1st, cycle-start, cycle-end, PRI01-submit, PRI02-complete, scan-progress. Full event-type taxonomy with priority classification canonical in `_bmad-output/planning-artifacts/ux-skeleton.md`; PRD-level commitment is that classification exists and drives default UI surfacing
- FR39: dashboard surfaces Portuguese-localized banner during sustained transient issues (e.g. Mirakl outages), informing customer that no new price actions are running until conditions stabilize

## Functional Requirements — F. Subscription & Billing
- FR40: recurring monthly Stripe subscription on Go-Live, billed €50 per marketplace per month, no setup fee
- FR41 (MVP): single marketplace at MVP — Worten (both PT and ES channels under one shop API key); adding additional marketplaces is concierge-only (customer emails founder, founder manually configures second marketplace's shop API key in admin tooling, adds Stripe line item, handles next Moloni invoice for combined payment); NO "Add Marketplace" UI in customer dashboard at MVP
- FR41 (Epic 2): self-serve add/remove marketplaces from subscription via dashboard UI; additions appear as new line items on next billing cycle (Stripe proration); removals end line item at end of current billing cycle, NO mid-cycle refund
- FR42: first-month money-back guarantee within 14 days of Go-Live, no questions asked
- FR43: failed payments handled via Stripe-managed dunning at MVP; on final failure → subscription auto-cancels, cron flips paused, prices remain at last-set state until customer re-enters payment details
- FR44: founder admin generates manual Moloni invoices per Stripe payment with PT NIF/IVA compliance; invoice metadata recorded against customer account

## Functional Requirements — G. Operations & Alerting
- FR45: `/health` endpoint pinged by external uptime monitoring at 5-minute cadence; failure triggers founder email alerts
- FR46: 3-tier failure model — transient errors retry with exponential backoff within cycle; per-SKU operational failures log per-SKU and continue cycle; critical errors (auth invalid, sustained outage, anomaly freeze, circuit-breaker trip) freeze customer's repricing and trigger immediate email + dashboard banner
- FR47: founder admin can view internal monitoring dashboard (NOT customer-facing) showing cross-customer audit-log tail, uptime status, circuit-breaker state
- FR48: critical-tier alerts delivered to customers via email within 5 minutes of event detection
- Operational commitments (rollback playbook, solo-founder continuity runbook, Day-1 active-monitoring protocol, manual Moloni invoice SLA) documented in NFR Operational Quality Attributes (NFR-O1..O4), NOT as system FRs

## Engine Mechanics (binding)
- Cooperative ERP-sync mechanic: store last_set_price per SKU per channel (only updated after PRI02 confirms COMPLETE); each cycle compare current_price (from P11) vs last_set_price; if current_price ≠ last_set_price → external change → update list_price = current_price, recompute floor/ceiling, continue normal repricing
- 4-state tier system per FR18: Tier 1 / Tier 2a (recently won) 15 min; Tier 2b 30-60 min; Tier 3 daily; driven by per-SKU last_won_at timestamp + tier_cadence_minutes column; supports per-customer cadence customization (open ARCH question for 100k+ SKU customers)
- Per-channel data model is structural, not optional: Worten PT and Worten ES are different channels under one shop API key; P11 returns per-channel total_price via all_prices array (shape UNVERIFIED — ARCH MCP question); list_price, last_set_price, current_price, baseline all per-SKU per-channel
- Channel codes operator-specific and unverified: WRT_PT_ONLINE, WRT_ES_ONLINE assumed for Worten; ARCH must confirm via MCP
- Rank competitors by total_price (price + shipping), NOT price alone — Worten ranks by total_price, shipping varies per shop
- Filter active=true offers only
- Engine output safety: per-SKU floor/ceiling clamping; circuit breaker (≤20% catalog/cycle, ≤15% per-SKU move); anomaly freeze (>40% external deviation) → freeze + alert + manual unblock
- Race condition mitigation: last_set_price only updates after PRI02 COMPLETE → avoids treating own pending push as external change
- Fallback if cooperative model is fundamentally wrong: one-line config change to "snapshot at signup, never absorb"
- Decision-table coverage (FR24): tie cases, leader-is-self, all-competitors-above-ceiling, two-repricer-conflict, single-channel offer, single-competitor — fully enumerated

## Mirakl Integration Patterns (binding constraints — single canonical placement)
- Mirakl MMP only (no MiraklConnect dependency); direct shop_api_key per marketplace
- Endpoints used: P11 (read competitor offers), PRI01 (write price update via multipart CSV), PRI02 (poll import status), OF21 (read own catalog)
- NEVER OF24: full-offer write that resets ALL unspecified offer fields (quantity, description, leadtime, etc.) to defaults — confirmed footgun in brief and reinforced in CLAUDE.md
- PRI01 is async; PRI02 polling mandatory; successful PRI01 response = accepted for processing, NOT applied; last_set_price only updates after PRI02 COMPLETE — otherwise our own pending push looks like external change in next cycle and triggers spurious cooperative-absorption
- Single shop_api_key per marketplace, full account access (bank/IBAN, sales, prices, orders); no read-only mode; customer can revoke only by contacting Worten operator support — no in-Mirakl key-management UI for sellers; this is the fundamental trust constraint that makes encrypted-at-rest non-negotiable
- P11 returns ranked competitor list (NOT just best price); filter active=true; rank by total_price (price + shipping), NOT price alone — Worten ranks by total_price and shipping varies per shop
- Mirakl MCP is single source of truth for endpoint behavior, field names, pagination, error codes, rate limits, channel codes, partial-success semantics, parity rules, all_prices shape, active-flag reliability — verify before any assumption-lock; CLAUDE.md mandate applies to all agents (PM, ARCH, dev, code-review, BAD subagents)
- Per-channel data model structural: Worten PT and Worten ES = different channels under one shop API key; P11 returns per-channel total_price via all_prices array (shape UNVERIFIED — ARCH MCP question)
- Channel codes operator-specific and unverified: WRT_PT_ONLINE, WRT_ES_ONLINE assumed for Worten; ARCH MUST confirm via MCP; other Mirakl operators (Phone House ES, Carrefour ES, PCComponentes, MediaMarkt) have own channel-code conventions discovered per integration in Epic 2
- Per-customer cadence ceiling implied by Mirakl rate limits (open ARCH question); for 100k+ SKU customers (e.g. Twomii @ 100k+) default 15-min cadence on contested + recently-won SKUs may need to relax; resolution may require Tier 1/2a cadence becoming customer-config-driven (or catalog-size-driven) — supported architecturally by per-SKU `tier_cadence_minutes` column; ARCH MUST verify Mirakl rate limits via MCP and derive per-customer pacing budget before cadence default values lock

## Domain-Specific Compliance & Legal
- Domain = e-commerce/marketplace tooling; no regulator approval gate; no real-time-safety path; no payment-processing-of-customer-funds (Stripe handles billing, MarketPilot never custodies funds or sees card data); complexity sits in trust architecture, Mirakl integration, PT/ES B2B legal gates, pricing-agency liability
- GDPR (EU customer scope): all customer + operator personal data hosted on Supabase Cloud EU region; DPA template required for B2B procurement-conscious customers (brief §15 pre-revenue legal gate); standard GDPR rights (access, deletion, portability, breach-notification) honored at customer-account level
- PT NIF/IVA invoicing: PT and ES B2B SMEs require legally compliant invoices with NIF — Stripe receipts insufficient; Moloni manual invoicing at MVP (~5-10 min/customer/month); Moloni API integration triggers Epic 2 when aggregate founder time >2-3 hr/month
- Pricing-agency Terms of Service MUST explicitly cover automated price-setting agency on customer's behalf; free-report ToS does NOT cover this scope and MUST be replaced before first invoice; documented consent + customer self-flip + audit log together establish customer authorization (NOT founder authorization); legal counterpart to informed-consent Go-Live modal
- Refund policy: first-month money-back guarantee within 14 days of Go-Live, no questions asked; stated in ToS; €50 risk per refund = first-cohort trust-building investment; tighten in Epic 2 once retention data exists; aligns with dry-run-by-default + 24h post-Go-Live monitoring + day-3/day-7 pulse-check
- Worten/Mirakl operator ToS compatibility for automated repricing via shop API key: UNVERIFIED (brief §15 potential hidden blocker); pre-revenue fixed-fee legal review (post-build, pre-Go-Live) MUST include this check
- Audit log retention: lifetime of customer account; on termination GDPR Article 17 right-to-be-forgotten applies, with exceptions only for records that doubled as fiscal evidence; price-change events are operational (NOT fiscal); Stripe receipts + Moloni invoices are separate fiscal records with their own statutory retention; statutory retention re-evaluated by legal review post-revenue
- Audit log = legal/trust artifact, not logging table; per-customer-per-channel; granular log COMPLETE (every action recorded, append-only per NFR-S6); presentation hierarchically summarized per FR38b–d; trust property (complete log) and UX presentation (no-noise default) are independent
- Out of scope by design: no PCI-DSS (Stripe handles all card data, never see PANs); no KYC/AML (Stripe → customer Moloni invoice = cash path); no healthcare/government/aerospace regulators — locking scope ceiling prevents future feature creep into PCI scope without explicit decision

## Tenancy & RBAC
- Tenant boundary = customer-account; each customer's data (API keys, catalog snapshot, audit log, baseline, pricing state, Stripe customer ID, Moloni references) behind RLS policies keyed on customer_id
- Multi-tenancy from day 1 via Supabase RLS; two principals exist Day 1 (founder admin + first customer); single-tenant REJECTED (refactor would happen within a month anyway; multi-tenant is day-1 cost paid once); RLS enforced at DB layer NOT just app layer
- Founder admin server-side service-role key bypasses RLS for operational queries (audit-log tail, support investigation); never exposed to client; only used by repricer-worker and operator-only admin endpoints; founder NEVER logs in as customer impersonator at MVP — operations read-only via founder monitoring dashboard
- Multi-marketplace per customer: one customer account holds multiple marketplaces (Tony's 5 Mirakl); each marketplace = row under customer; per-marketplace shop_api_key encrypted independently; subscription scales per marketplace (€50 × N)
- Account deletion / GDPR Art 17: workflow wipes encrypted shop_api_key, audit log entries (with fiscal exceptions), Stripe customer/subscription refs, catalog/baseline/pricing-state data; Moloni invoice metadata retained (statutory fiscal); FR4 commits multi-step confirm + 7-day soft-delete grace before irreversible deletion
- RBAC matrix: Customer single login (MVP) → Customer team member RBAC owner/operator/viewer (Epic 2); Founder admin cross-tenant operational read MVP+Epic 2; Support staff N/A MVP, likely Epic 2+

## Subscription & Billing Mechanics
- No tiers at MVP; single SKU €50/marketplace/month; multi-marketplace pays €50 × N; no setup fee; no annual discount
- Tiering NOT in Epic 2 either; re-evaluate only after €5k+ MRR if power-user demand exceeds flat model
- Stripe handles recurring monthly subscription auto-renew; subscription state webhook drives cron_active flag per customer-marketplace; Stripe customer creation at Go-Live click NOT signup (no Stripe customer for free-trial dry-run users)
- 3-month minimum prepaid: OPEN DECISION (brief §1); decide post-warm-lead-re-engagement, before customer #1, NOT before MVP build
- Failed-payment: Stripe-managed dunning at MVP (Smart Retries, default email cadence); on final-failure subscription auto-cancels, cron flips paused, prices remain at last-set state, customer can re-enter card and resume manually
- Marketplace add/remove: MVP = concierge (no UI), Epic 2 = self-serve via dashboard with Stripe proration on add, end-of-cycle removal, no mid-cycle refund (FR41); ARCH should plan Stripe + Moloni mechanics so concierge → self-serve transition is data-compatible (no schema migration when self-serve UI ships)

## Implementation Topology
- app.marketpilot.pt Fastify + UI on Hetzner via Coolify; internal repricer-worker cron service (no public URL) on same Hetzner; Postgres + Auth + RLS on Supabase Cloud EU region; crosses org boundary (customer Mirakl keys at Supabase, not Hetzner) — flagged for ToS/Privacy + DPA review
- No monorepo at MVP; if shared logic emerges (Mirakl P11 client wrapper, pricing math), extract small npm package — don't preempt abstraction
- Scale boundaries MVP: 5-10 concurrent customer accounts, each up to 50k SKU, 1-5 marketplaces; revisit pacing in ARCH before onboarding 100k+ SKU customers (Twomii)
- State persistence: all customer-account state in Supabase Postgres; no application-layer state lost on restart; async catalog scan persists customer_id → job_state server-side
- Observability: /health endpoint + UptimeRobot 5-min; founder monitoring dashboard (audit-log + uptime + circuit-breaker cross-customer); Resend delivery logs for critical alerts; no customer-facing observability (status page) at MVP — Plan B if founder-facing channel insufficient
- Async-everywhere posture: PRI01 async + PRI02 polling; catalog scan async with reconnection; cron cycles independent; only synchronous customer-facing Mirakl op = key validation (5-second test P11 call); no real-time-safety-critical path — outages have graceful-degradation profile (banner + alert + freeze + manual unblock); 30-min outage = no customer harm
- Integrations: Mirakl MMP (P11/PRI01/PRI02/OF21, NEVER OF24); Stripe (subscription billing, store customer/subscription IDs only, no card data); Moloni (PT-compliant invoicing, manual MVP, API Epic 2); Resend (transactional email, free 3k/mo, critical alerts only at MVP); UptimeRobot (free, /health 5-min); Supabase Cloud EU (Auth + RLS + Postgres); DynamicPriceIdea cross-repo handoff via signup query params (FR7) — already-shipped P11 + Mirakl API code = reference implementation

## Non-Functional Requirements — Performance
- NFR-P1: Engine Tier 1 cycle latency p95 ≤18 min (15-min nominal cadence + retry/backoff allowance); measured cycle-end minus cycle-start, p95 across all customers' Tier 1 SKUs over 7-day rolling window
- NFR-P2: Engine Tier 2a cycle latency p95 ≤18 min; Tier 2a uses same close cadence as Tier 1 to protect against active-repricer undercut markets — latency target MUST match Tier 1, NOT Tier 2b
- NFR-P3: Engine Tier 2b cycle latency p95 ≤75 min (60-min nominal cadence with allowance)
- NFR-P4: Engine Tier 3 cycle latency p95 ≤28 hours (daily nominal with allowance; daily pass also serves as nightly reconciliation per FR28)
- NFR-P5: PRI01 → PRI02 resolution ≤30 min from PRI01 submission to PRI02 COMPLETE or FAILED; stuck-WAITING SKUs ≥30 min trip critical alert per FR46
- NFR-P6: Inline API key validation completes within 5 seconds (worst case) on customer's key-entry submission
- NFR-P7: Customer dashboard initial render ≤2s on broadband, ≤4s on 3G mobile
- NFR-P8: Audit log filtering responds within 2s for default 90-day window (longer windows deferred to Epic 2 historical-analytics)
- NFR-P9: Critical alert delivery latency ≤5 min from event detection to customer email (per FR48)
- NFR-P10: Catalog scan throughput target = 50k SKUs scanned within 4 hours assuming Mirakl rate-limit budget supports ~10 concurrent calls × 200ms; UNVERIFIED — ARCH MUST confirm via Mirakl MCP and re-derive target if budget tighter than assumed

## Non-Functional Requirements — Security
- NFR-S1: All customer Mirakl shop API keys encrypted at rest using KMS-managed key; founder cannot view cleartext key material; application logs never contain cleartext key material; verified pre-launch via security review and ongoing via DB-dump scans
- NFR-S2: All HTTP traffic between customer browser and `app.marketpilot.pt` uses TLS 1.2+ (no plaintext HTTP); internal traffic between Hetzner-hosted Fastify and Supabase Cloud uses TLS
- NFR-S3: Multi-tenant data isolation enforced at Postgres layer via RLS policies on every customer-scoped table; service-role-key usage limited to repricer-worker and operator-only admin endpoints; never exposed to client; RLS regressions blocked via test suite running on every deploy
- NFR-S4: Stripe webhooks signed and verified per Stripe docs; replay attacks prevented via webhook timestamp validation
- NFR-S5: Authentication uses Supabase Auth defaults (bcrypt hashing, secure session cookies, email verification); password reset flows email-verified per FR3
- NFR-S6: Audit log entries are append-only at application layer; NO admin UI to delete or edit audit log records (deletion only via documented GDPR Art 17 workflow per FR4); legal/trust property — preserved at MVP independent of durability tier
- NFR-S7: Stripe customer/subscription data — MarketPilot stores only Stripe customer IDs + subscription IDs; no card data, no PAN, no full bank details (Stripe handles all PCI-DSS scope; MarketPilot out of PCI scope by design — locking this scope ceiling prevents future feature creep into PCI scope without explicit decision)

## Non-Functional Requirements — Scalability
- NFR-Sc1: System designed for 5-10 concurrent customer accounts at MVP, scaling to 50 concurrent accounts in Epic 2 without architectural rework; per-customer state in Supabase Postgres scales linearly with customer count
- NFR-Sc2: Per-customer catalog scale = 50k SKUs at MVP with assumed Mirakl rate-limit headroom; 100k+ SKU catalogs (e.g. Twomii @ 100k+) require ARCH-confirmed cadence ceiling and may use relaxed Tier 1/2a cadence per per-SKU `tier_cadence_minutes` model (per FR17/FR18)
- NFR-Sc3: Cron scheduling pattern (single cron polling every 5 min, per-SKU cadence column per FR18) supports horizontal scale; additional worker instances can poll same SKU table without coordination overhead via advisory-lock-or-similar pattern; ARCH spec mandatory before second worker
- NFR-Sc4: Resend free tier (3k emails/mo) sized for ~10 customers × 2-3 critical alerts per month each; tier upgrade triggered when customer count or alert rate exceeds free-tier budget; migration is configuration-only
- NFR-Sc5: Supabase Cloud free tier sized for MVP catalog scale (DB size + compute utilization); paid-tier migration triggered by free-tier exhaustion; migration is configuration-only

## Non-Functional Requirements — Reliability & Availability
- NFR-R1: `/health` endpoint ≥99% uptime measured by UptimeRobot 5-min pings over 30-day rolling window (per FR45); below threshold triggers founder email alert
- NFR-R2: RTO for application service = 30 minutes from critical alert to customer-facing action per documented rollback playbook (NFR-O1)
- NFR-R3: RPO for customer data including audit log ≤24 hours via Supabase Cloud daily backups; audit log durability matches rest of customer state at MVP; audit-log-specific higher-durability (synchronous replication, external streaming append-only log) = Epic 2 only if first-cohort customers report gap incidents; append-only semantics requirement (no admin UI for delete/edit per NFR-S6) preserved at MVP — legal/trust property independent of durability tier
- NFR-R4: 3-tier failure model (per FR46): transient errors retry within cycle; per-SKU operational failures log + retry next cycle; critical errors freeze customer's repricing immediately; NO silent failures permitted
- NFR-R5: Customer impact during external dependency outages (Mirakl, Stripe, Supabase): customer-facing dashboard remains accessible; engine pauses gracefully; customer receives Portuguese-localized banner notification within 3 cycles of sustained outage detection (per FR39)

## Non-Functional Requirements — Integration Quality
- NFR-I1: Mirakl MMP integration — rate-limit budget verified via MCP per ARCH; cadence pacing baked into design pre-launch; PRI01 → PRI02 polling resilient to transient failures (exponential backoff)
- NFR-I2: Stripe integration — idempotency keys used on subscription mutations; webhook handler idempotent (same webhook event ID processed once); subscription state always reconcilable from Stripe API as source of truth
- NFR-I3: Supabase Auth + RLS integration — RLS policies tested with deliberate cross-tenant access attempts pre-launch; policy regressions blocked via test suite running on every deploy (overlaps NFR-S3 — same control, two angles)
- NFR-I4: Resend integration — critical-alert emails use templated content with conditional Portuguese localization; delivery failures logged and surfaced in founder monitoring dashboard
- NFR-I5: UptimeRobot integration — monitor configured for `/health` 5-min cadence; failure alert routed to founder email (NOT customer-facing)
- NFR-I6: Cross-repo handoff with DynamicPriceIdea — signup form accepts source-context query parameters per FR7; no shared schema, no shared DB, no shared deployment pipeline (deliberate isolation due to different security postures — free report stores no key, repricer encrypts keys)

## Non-Functional Requirements — Accessibility
- NFR-A1: Customer dashboard meets WCAG 2.1 AA practical baseline at MVP (sufficient color contrast, keyboard navigability, semantic HTML, alt text for icons); formal WCAG audit deferred until B2B procurement-conscious customer demands it (likely Epic 2 cohort)
- NFR-A2: Critical-action confirmations (Go-Live consent modal, Pause/Resume) accessible via keyboard without mouse interaction
- NFR-A3: Audit log content readable by screen readers (proper table semantics or ARIA roles); audit log = highest-leverage transparency surface; accessibility regression here = trust regression

## Non-Functional Requirements — Localization
- NFR-L1: Customer-facing UI defaults to Portuguese (PT); all conditional copy (banners, modals, validation messages, smart-default warnings, KPI card labels, audit-log event-type labels) is Portuguese-localized
- NFR-L2: Spanish (ES) UI localization NOT in MVP; Worten ES customers see Portuguese UI chrome; channel toggle reflects ES competitive landscape but UI labels remain Portuguese; ES UI localization (and ES email templates) = Epic 2 trigger when primary-ES customer signs up

## Non-Functional Requirements — Operational Quality Attributes
- These document founder-side operational commitments tied to product surfaces; NFRs (not FRs) because they describe HOW WELL operational support is delivered, not WHAT customer-facing capabilities exist
- NFR-O1: Founder admin maintains documented rollback playbook with 30-minute response target from critical alert to customer-facing action (triage → alert customer → diagnose → fix or revert); playbook drafted before customer #1
- NFR-O2: Founder admin maintains 1-page solo-founder continuity runbook covering laptop loss, hospitalization, and extended absence scenarios; drafted before customer #1
- NFR-O3: Founder admin runs documented Day-1 active-monitoring protocol for first 24 hours post-Go-Live per customer (audit-log tail + uptime status); 2-hour response SLA during customer's launch week; Day-3 and Day-7 pulse-check outreach via call or email
- NFR-O4 (BINDING TO STORY 11.5): Founder admin generates manual Moloni invoices per Stripe payment within 24 hours of billing, target ≤10 minutes per invoice; aggregate exceeding 2-3 hr/month triggers Epic 2 Moloni API integration (per FR40 Phase 2 trigger)

## Innovation Validation Approach
- Cooperative ERP-sync first proof point achievable in dogfood pre-customer: against Gabriel's live Mirakl Worten sync (15-min cadence, real catalog) — production-grade testbed; anomaly-freeze and circuit-breaker thresholds tuned against Gabriel's real traffic; tier transitions exercised with real last_won_at values
- Validation chain: dogfood Gabriel → dry-run by default for customer #1+ (7-14 days simulation, audit log shows external-change-absorbed events tagged) → Day-1 founder active-monitoring (Pedro tails first customer's audit log 24h post-Go-Live, manually reviews every external-change-absorbed event week 1) → inbound anomaly freeze + outbound circuit breaker → first-90-day metric: zero "tool fights my ERP" complaints AND non-zero external-change-absorbed events per active customer
- Production-confident across cohort bar: first 3 customers complete 90 days with cooperative-absorption handling natural ERP traffic without manual intervention beyond confirming/rejecting anomaly-freeze events
- Trust step-up funnel: free report already in production engaging warm leads; unproven whether trust step-up converts (does customer who trusted with public-listing data grant full-account access?); revisit after first 5-10 customers

## Risk Register & Mitigations
- shop_api_key exposure (full account access incl. bank/IBAN): encrypted-at-rest vault, KMS spec from ARCH, founder never sees cleartext, single-purpose key-entry form, RLS multi-tenant isolation, pause = single-click freeze
- Engine bug pushes out-of-tolerance prices: per-SKU floor/ceiling clamping at engine output, outbound circuit breaker (≤20% catalog/cycle, ≤15% per-SKU), dry-run by default, informed-consent Go-Live modal, full audit log
- Customer ERP cascade (mass-price misconfiguration absorbed): outbound circuit breaker halts cascade, inbound anomaly freeze (>40% deviation) catches per-SKU outliers, audit log preserves forensic trail, pause = freeze (not rollback) lets customer manually correct
- Mirakl outage / rate-limit hit: 3-tier failure model, customer-facing banner for sustained transient issues, rate-limit pacing per ARCH (UNVERIFIED — MCP verification mandatory before scale-claim locks)
- Worten operator ToS forbids automated repricing: pre-revenue fixed-fee legal review covers; gates first invoice NOT MVP build
- Solo-founder single point of failure (laptop loss, hospitalization, extended absence): 1-page continuity runbook drafted before customer #1; documented response procedures; founder accessibility = trust wedge; survives only with deliberate hire selection in growth phase
- First-customer trust failure (audit log not consumed): Day-1 active monitoring + 2-hour SLA + Day-3/Day-7 pulse checks; first-dashboard view uses same KPI categories as free report; worked-profit-example margin editor builds intuition pre-Go-Live
- PRI01 partial-success / EAN mismatch / pricing-import failures: 3-tier failure model with per-SKU operational logging; retry on next cycle; failures surfaced in audit log; persistent failures (>3 cycles) escalate to dashboard banner
- Mirakl-API behavior assumed but unverified (channel codes, rate limits, parity rules, all_prices shape, active-flag reliability): CLAUDE.md mandate ALL Mirakl behavior verified via MCP before architecture lock; ARCH (Winston) carries explicit open-questions list from brief §16
- Cooperative ERP-sync slow-drift erosion (costs rise 15% over months, ERP list_price static, floor erodes margin slowly): MVP — every external-change-absorbed event classified "notável" per FR38d, surfaced in default-visible "Eventos notáveis" feed (FR38b surface 3); Epic 2 — customer-tunable anomaly threshold + drift detection
- Deliberate flash-sale absorbed as new baseline: MVP — only lever is whole-tool pause; Epic 2 — per-SKU exclude / promo-mode toggle
- Trust step-up funnel underperforms: 14-day money-back, dry-run lets validate before paying, dashboard reuses free-report KPI categories; Plan B trigger week 6 post-MVP zero conversions = cold outreach restart + LinkedIn/ACEPI/Adigital/Worten-forum inbound (30 named warm leads in OUTREACH.md provide non-funnel path)
- Churn red-flag months 1-2 forces retention decision: 3-month minimum prepaid (OPEN — decide post-warm-lead-re-engagement, before customer #1, not before MVP build)
- AI-assisted dev velocity overestimates compress-ratio on integration surface: scope discipline; brief §17 caveat — well-scoped features compress, integration-heavy work less so; build sequencing should front-load PRI01 first-time live debugging + KMS work + multi-tenant RLS testing (items that compress least)
- Cash-runway constraint on legal review timing: pre-revenue legal review fixed-fee (not retainer); post-build pre-Go-Live timing means review cost incurred only after MVP ships

## Open Decisions & Unverified Assumptions
- 3-month minimum prepaid: OPEN; decide post-warm-lead-re-engagement, before customer #1
- Catalog scan rate-limit math (~10 concurrent × 200ms): UNVERIFIED; ARCH must confirm Mirakl rate limits via MCP and bake real limits into pacing
- Per-customer cadence ceiling for 100k+ SKU customers: open ARCH question; supported by per-SKU tier_cadence_minutes column
- Worten/Mirakl operator ToS compatibility for automated repricing via shop_api_key: UNVERIFIED, brief §15; pre-revenue legal review must include
- Channel codes WRT_PT_ONLINE, WRT_ES_ONLINE: assumed for Worten; ARCH must confirm via MCP
- all_prices array shape: UNVERIFIED; ARCH MCP question
- Funnel hypotheses (≥10% CTA→key-entry, ≥30% key-validate→Go-Live within 14 days): no baseline data; revisit after first 5-10 customer cohort
- KMS specification (key custody, rotation policy, recovery on Supabase incident): deferred to ARCH/Winston
- Active-flag reliability and partial-success semantics on PRI01: UNVERIFIED; ARCH MCP question
- Parity rules between channels under one shop_api_key: UNVERIFIED; ARCH MCP question

## Cross-References
- FR4: account deletion multi-step + 7-day grace (post UX-skeleton amendment)
- FR17–FR19: 4-state tier system full spec
- FR18: Tier 1/Tier 2a 15min, Tier 2b 30-60min, Tier 3 daily; per-SKU last_won_at + tier_cadence_minutes
- FR23: PRI01 only / never OF24 / PRI02 polling mandatory
- FR24: engine decision-table cases (canonical in Engine Mechanics)
- FR38b/c/d: audit log hierarchical summarization with 3-tier priority (atenção/notável/rotina); FR38b surface 3 = "Eventos notáveis" default-visible feed (post UX-skeleton amendment)
- FR41: marketplace add/remove split MVP concierge / Epic 2 self-serve (post UX-skeleton amendment)
- NFR-P1/P2: Tier 1 / Tier 2a cycle latency p95 ≤18 min
- NFR-S6: audit log append-only — preserved at MVP independent of durability tier (NFR-R3)
- NFR-O4 BINDS TO STORY 11.5: Moloni invoice operational SLA (24h, ≤10min/invoice, 2-3hr/month aggregate trigger for Moloni API Epic 2)
- F1–F13 architecture amendments: cross-referenced in PRD body; preserve all references for downstream agents
- I1–I3 identifiers: preserve all references for downstream agents
- Brief sections referenced: §1 (3-month prepaid OPEN), §2 (smart-default mapping), §6 (encryption non-negotiable + multi-tenant rejection rationale), §7 (two questions deliberately not asked), §9 (Day-1 active monitoring + 2-hour SLA + pulse checks), §10 (warm leads), §13 (deployment topology + org boundary), §15 (pre-revenue legal gates), §16 (ARCH open-questions list), §17 (AI-assisted dev velocity caveat)
- CLAUDE.md mandates: Mirakl MCP verification before assumption-lock (applies to all agents incl. BAD subagents); encryption-at-rest non-negotiable; PRI01 not OF24; Mirakl MMP only (no MiraklConnect); shop_api_key full account access requires trust-critical handling
- Rejected alternatives preserved: single-tenant deployment (refactor would happen within a month anyway); OF24 (resets unspecified offer fields); 3-state tier system from RESEARCH.md (superseded by 4-state to handle active-repricer markets); single-click account deletion (replaced by FR4 multi-step + 7-day grace); flat chronological audit log feed (unusable at ~3M entries/quarter, replaced by FR38b–d hierarchical summarization)
- Cross-references in `_bmad-output/planning-artifacts/ux-skeleton.md`: full audit-log event-type taxonomy with priority classification (canonical there; PRD-level commitment is FR38d)