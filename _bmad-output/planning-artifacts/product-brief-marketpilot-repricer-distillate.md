---
title: "Product Brief Distillate: marketpilot-repricer"
type: llm-distillate
source: "product-brief-marketpilot-repricer.md"
created: "2026-04-28"
purpose: "Token-efficient context for downstream PRD creation"
---

# Product Brief Distillate — MarketPilot Repricer

Dense, themed reference for the PRD agent. Each bullet stands alone — assume the reader does NOT have the full conversation loaded. Read alongside `product-brief-marketpilot-repricer.md`.

## 1. Pricing & Commercial Model

- **Headline price:** €50 per marketplace per month, no setup fee. Multi-marketplace customer = €50 × N marketplaces (Tony @ You Get with 5 Mirakl marketplaces = €250/mo).
- **Why no setup fee:** previous quotes used €1k setup + €50/mo. New narrative: "Tool is built — no setup needed." Coherent and re-engagement-friendly.
- **3-month minimum prepaid:** OPEN DECISION. Recommended but not yet locked. Decide after re-engaging warm leads. Without minimum, churn risk in months 1-2 is real for SME B2B at €50/mo. Options considered: (a) pure no-minimum, (b) 3-month minimum prepaid (€150 upfront for single-marketplace customer), (c) small "configuração inicial" fee with new label.
- **Billing infrastructure:** Stripe handles recurring monthly subscription payments (automatic, safer). Moloni invoicing is MANUAL by founder per Stripe payment for PT NIF/IVA compliance. Moloni API integration deferred to Epic 2 (when volume justifies). This costs founder ~5-10 min per customer per month — acceptable at MVP scale.
- **Refund policy:** "First-month money-back guarantee within 14 days of Go-Live, no questions asked." Reasoning: Stripe charges only on Go-Live click — if a customer never Go-Lived, no payment occurred (refund not applicable). The real refund scenario is "Go-Lived → tool failed to deliver." €50 downside per refund vs. trust-signal value for the first cohort. Tighten in Epic 2 once retention data exists. State explicitly in ToS.
- **Customers will demand NIF on invoices.** PT/ES B2B accounting practice. Stripe receipt alone is insufficient — Moloni invoice is the legally compliant deliverable.

## 2. Engine Logic & Pricing Formula

- **Formula is list_price-anchored percentage tolerance, NOT cost-based.** `floor = list_price × (1 - max_discount_pct)`, `ceiling = list_price × (1 + max_increase_pct)`. No CSV upload. No commission/VAT/shipping data entry from customer.
- **`list_price` is the customer's pricing intent baseline**, snapshotted on initial scan and updated dynamically (see ERP cooperative model). Never the floating `current_price` — that would create a race-to-bottom feedback loop.
- **Smart default mapping (drives `max_discount_pct` from onboarding margin question):**
  - <5% margin (thin-margin commodity electronics) → 0.5% default + warning + recommend Epic 2 cost-CSV
  - 5-10% (typical electronics) → 1%
  - 10-15% (mixed retail, beauty) → 2%
  - 15%+ (premium, fashion) → 3%
- **`max_increase_pct` default:** 5% globally (no margin-correlated risk on upside).
- **Both directions are first-class.** Undercut to win 1st place when behind; raise toward ceiling when already winning. Same engine, single cycle decision.
- **Rank competitors by `total_price`, NOT `price`.** `total_price = price + shipping`. Worten ranks by `total_price`. Comparing only `price` gets rank wrong when shipping varies.
- **Filter to `active=true` offers only.** Inactive offers (zero stock, paused shop) returned by P11 but must be ignored for ranking — otherwise we chase phantoms.
- **Per-channel repricing is MVP-required (NOT Epic 2).** Worten PT and Worten ES have meaningfully different competitive landscapes. A unified price serves neither optimally. `list_price`, `last_set_price`, `current_price` all per-SKU per-channel. Margin tolerance stays GLOBAL per customer in MVP (per-channel margin override = Epic 2).
- **Tie cases, leader-is-self, all-competitors-above-ceiling, single-competitor scenarios** — engine decision table to be enumerated in PRD. Tier system (below) is the foundation; PRD spells out edge cases.

## 3. Engine Safety Architecture (three independent layers)

- **Layer 1 — Tier system (refined from RESEARCH.md to handle active-repricer markets).** Per-SKU classification with per-SKU cadence:
  - **Tier 1** (position > 1, contested): cycle every 15 min. Undercut logic.
  - **Tier 2a** (position = 1, `last_won_at` < 4h ago — RECENTLY WON): cycle every 15 min. Ceiling-optimization logic. **Watched as closely as Tier 1** because active-repricer markets like Worten can undercut us within minutes of winning 1st place. The original RESEARCH.md design assumed quieter markets where 2-hour Tier 2 cadence was safe — Pedro's empirical observation of active competitor repricing on Worten invalidated that assumption.
  - **Tier 2b** (position = 1, `last_won_at` ≥ 4h ago — STABLE WINNER): cycle every 30-60 min. Ceiling-optimization logic. After 4h holding 1st, the SKU is less likely to be challenged immediately, so cadence relaxes to recover API economy.
  - **Tier 3** (no competitors): cycle daily. Monitor for new entrants. Daily pass also serves as Layer 3 nightly reconciliation.
  - **Transitions:** T1 → T2a on win (set `last_won_at = now()`); T2a → T2b after 4h elapsed (no DB write needed, just classification at next cycle); T2/T2a/T2b → T1 on loss; T3 → T1/T2a on new entrant.
  - **Implementation pattern:** per-SKU `tier_cadence_minutes` column. ONE cron polls every 5 min and selects SKUs where `last_checked_at + tier_cadence_minutes < now()`. Cleaner than per-tier crons; supports per-customer cadence customization for free in Epic 2 (just resolve defaults from a customer-config row).
  - **Reduces API call volume by ~25-30% on a 50k-SKU catalog** vs uniform 15-min cycle (down from the original ~40% estimate because Tier 2a holds the closer cadence). Trade is correct: blind-window losses in active-repricer markets cost more than the 10-15% API economy difference.
- **Layer 2 — Outbound circuit breaker.** Independent safety on top of tiers. Per cycle: no more than 20% of catalog SKUs may be repriced in a single cycle. Per SKU: no individual price can move by more than 15% in a single push. If either threshold trips: freeze cycle, alert customer, manual review unblocks. Catches engine bugs that tiers don't.
- **Layer 3 — Nightly reconciliation.** Implemented as Tier 3's daily pass. Re-scans all products, re-classifies tiers, catches drift, self-heals stale state.
- **Layer 4 (inbound) — Anomaly freeze on external changes.** When an external price change is detected, if deviation from previous `list_price` exceeds 40%, freeze that SKU's repricing, alert customer (decimal-point ERP bugs etc.). Customer reviews: confirm new list_price OR reject (tool unfreezes with old list_price).
- **Belt-and-suspenders philosophy:** four layers (tiers + circuit breaker + reconciliation + anomaly freeze) all independent. Trust dividend > complexity cost.

## 4. Cooperative ERP-Sync Model

- **Concept:** when an external entity (the seller's ERP, manual edit, another tool) changes the price between our cycles, we treat that change as a SIGNAL of new pricing intent and absorb it as the new `list_price`. We do NOT fight the change.
- **Mechanism:** store `last_set_price` (what we wrote, confirmed by PRI02 COMPLETE). Each cycle, compare `current_price` (read from P11) to `last_set_price`. If different → external change → update `list_price = current_price`, recompute floor/ceiling, continue normal repricing.
- **Why this is right:** the customer's ERP knows the "real" list price (cost-shifts, supplier changes, intentional repricing). Our anchor should follow theirs.
- **Solves drift problem:** without this, `list_price` snapshotted at signup goes stale over months. With this, it auto-refreshes.
- **PRI01 is async** — `last_set_price` only updates after PRI02 confirms COMPLETE. Avoids race condition where our own pending push looks like an external change.
- **Failure mode acknowledged:** the 40% threshold catches catastrophic ERP errors but NOT slow margin-eroding drift (e.g., customer's costs rise 15% but ERP `list_price` stays the same). MVP surfaces every external-change-absorbed event in the audit log so customer can spot drift manually. Customer-tunable threshold is Epic 2.
- **Edge case (deferred to Epic 2):** customer runs a deliberate flash-sale promo (e.g., €80 for 24h on a normally-€100 product). Our tool absorbs €80 as new list_price, then undercuts further. Solved in Epic 2 by per-SKU exclude or "promo mode" toggle. For MVP, customer's only lever is whole-tool pause.

## 5. Mirakl API Specifics

- **Platform:** Mirakl Marketplace Platform (MMP) only. NO MiraklConnect (paid aggregation layer used by large connectors). Direct shop API key per marketplace.
- **Auth:** single `Authorization: {shop_api_key}` header on all calls. Shop API key has NO read-only mode — grants full account access (bank/IBAN, orders, prices). Customer can revoke only by contacting marketplace operator support.
- **Endpoints:**
  - **P11** (`GET /api/products/offers?product_references=EAN|{ean}&all_offers=true`): reads competitor prices. Confirmed working on production Worten 2026-04-07. Returns full ranked list (NOT just best price). Includes `all_prices` array with per-channel breakdown. Returns `total_price`, `active` flag, `shop_name`, hides `shop_id`.
  - **PRI01** (`POST /api/offers/pricing/imports`): pushes price updates via multipart/form-data CSV. Returns `import_id`. Price-only-safe.
  - **PRI02** (`GET /api/offers/pricing/imports?import_id=X`): polls import status (WAITING → RUNNING → COMPLETE/FAILED).
  - **OF21** (`GET /api/offers`): reads own catalog.
- **NEVER use OF24 (`POST /api/offers`) for price updates.** OF24 resets ALL unspecified fields (quantity, description, leadtime, etc.) to defaults. Confirmed footgun.
- **Channel codes (assumed but UNVERIFIED via MCP):** `WRT_PT_ONLINE`, `WRT_ES_ONLINE`. Worten channel ID: 15218. Phone House Spain channel ID: 6343.
- **Marketplace instance URLs:** Worten PT (`marketplace.worten.pt`), Phone House ES (`phonehousespain-prod.mirakl.net`), Carrefour ES (`carrefoures-prod.mirakl.net`), PCComponentes (`pccomponentes-prod.mirakl.net`), MediaMarkt (`mediamarktsaturn.mirakl.net`).
- **Rate limits:** UNVERIFIED via MCP. Scale math assumes ~10 concurrent calls × 200ms — known to be well below limits empirically but needs MCP confirmation.
- **CLAUDE.md mandate:** every Mirakl behavior assumption MUST be verified via Mirakl MCP before architecture locks. This applies to ALL agents (BAD subagents, dev-story, code-review).

## 6. Trust Architecture (deliberate brand wedge, not features)

- **Encryption-at-rest for API keys is non-negotiable.** Trust-critical. KMS spec is OPEN for Winston (key custody, rotation, recovery on Supabase incident).
- **Single-purpose key-entry form:** customer pastes Worten shop API key into ONE form on first login. Posts to encrypted storage, never logged plaintext, never visible to founder. (Alternative considered and rejected: founder receives key via secure channel. Pattern B form is better — customer never trusts founder with cleartext.)
- **Auth + RLS via Supabase.** Email verify, password reset, multi-tenant isolation from day 1. Two principals exist on day 1 (founder admin + customer Gabriel) — single-tenant deployment was considered and rejected because refactor would happen within a month anyway.
- **Audit log of every action:** per-customer-per-channel. Includes external-change-absorbed events tagged distinctly so customer can review.
- **Pause = freeze (NOT rollback) in MVP.** Customer clicks pause → cron stops pushing, current Worten prices remain as last set. Baseline (pre-tool snapshot) is captured during initial scan and retained, enabling Epic 2 "restore baseline" feature without data archaeology.
- **Dry-run by default.** Customer can run dry-run as long as they want. Tool simulates repricing, logs what it WOULD do, doesn't push to PRI01.
- **Informed-consent Go-Live modal.** Conditional language: *"Até **N produtos** poderão ter preços ajustados, dentro da margem de **X%** que configuraram."* "Up to N" not "exactly N" — closes race condition between simulation and live (no extra build).
- **Customer self-flips Go-Live (NOT founder).** Replaces earlier-considered "Pedro reviews and flips" gate. Liability + trust + scalability all favor the consent-modal pattern. Founder monitors actively for first 3-5 customers but is not a gate.

## 7. Onboarding Flow

1. Customer clicks free report's CTA → direct to account creation (no email gate, no sales call).
2. Sign up with email/password → email verification (Supabase Auth defaults).
3. Single-purpose key-entry form. Linked guide: *"How to find your Worten Marketplace API key"* (one-page walk-through, since most prospects already use Worten Seller Center but haven't generated a key).
4. Inline 5-second key validation (test P11 call with known EAN). If invalid → inline error in form. If valid → proceed.
5. Onboarding questions:
   - **Margin band:** "<5%, 5-10%, 10-15%, 15%+" → drives smart default `max_discount_pct`.
   - **Per-channel pricing:** "Tem preços diferentes para Worten PT vs Worten ES?" → if yes, flag as Epic 2 (per-channel margin overrides not in MVP).
   - **Other repricing tools:** "Are you currently using Boardfy / Boostmyshop / internal scripts on this Worten account?" → if yes, customer must disable before Go-Live (otherwise two cooperative-absorption loops fight each other).
6. Async catalog scan kicks off. Customer sees closeable progress page (`Carregando 4,250 / 8,432 produtos...`). Email NOT sent on healthy completion — customer just logs back in to find populated dashboard.
7. Email IS sent on scan failure or critical issues (key revoked mid-scan, >50% SKUs unrepriceable, etc.).
8. Dashboard loads with first view showing the same KPI categories as the free report (SKUs in 1st, losing position, exclusive, catalog value) in a visually consistent family — recognizable as same-product-line, NOT a UI clone. The dashboard is fully interactive (channel toggle, audit log, margin editor, pause); the report is a static branded artifact. Continuity of product family across the trust step-up.
9. Customer reviews dry-run, tunes margins (worked profit example shows live impact in their euros).
10. Customer clicks Go-Live → conditional consent modal → checkbox → Stripe subscription start → cron flips live.
11. Founder generates Moloni invoice manually for Stripe payment. Customer receives compliant PT NIF/IVA invoice.

## 8. Dashboard & UI

- **Top section:** PT/ES channel toggle + KPI cards showing the same categories as the free report (SKUs in 1st, losing position, exclusive/Tier-3, total catalog value) in a visually consistent family — not a UI clone.
- **Audit log — hierarchical investigation tool, NOT a chronological feed.** Volume math forbids the naive feed: 50k-SKU contested catalog × ~30% Tier 1/2a × 15-min cadence ≈ 100-500 actual writes per cycle, ≈ 10k-50k entries/day, ≈ 3M/quarter. Flat chronological at this volume drowns the customer in routine and buries actionable events. **Five surfaces** (per PRD FR38b/c/d):
  1. **Daily summary card** at top — aggregate counts (price changes, holds, external-change-absorbed events, anomalies); position deltas vs prior day. Customer's daily glance.
  2. **"A precisar de atenção" feed** — events requiring customer decision (anomaly-freeze, circuit-breaker-trip, mid-life key-revocation, persistent PRI01 failures, payment-failure-pause). Steady state: 0-2/day. Surface ≥1 = it actually matters.
  3. **"Eventos notáveis" feed** — moderate-frequency browsable events (external-change-absorbed, position-won, position-lost, new-competitor-entered, large-price-move-within-tolerance, customer-paused/resumed). Steady state: 5-30/day. Capped feed with "Ver todos" link.
  4. **Search by SKU/EAN** — primary investigation primitive. Customer types EAN, gets all events for that single product chronologically. Bounded by product, always readable. This is how Tony's warehouse-manager scenario from PRD Journey 4 actually works.
  5. **Firehose** (behind "Mostrar todos os ajustes" filter) — cycle-aggregated, NOT flat per-SKU. Each row is one cycle showing aggregate counts; expand to per-SKU. Even the firehose is digestible.
- **Event-type taxonomy classified at three priority levels** drives default surfacing: `Atenção` (always shown in surface 2), `Notável` (capped feed in surface 3), `Rotina` (hidden by default; visible only via search or firehose). UX skeleton §4.1.6 enumerates ~22 types with classification.
- **Trust property preserved:** every action recorded and accessible. Customer can verify ANY individual decision via search-by-SKU or via firehose drill-down. The audit log is still "legal/trust artifact, not logging table" per NFR-S6. The UX just doesn't drown the customer in noise by default.
- **Pattern parallel:** mature transparency-first products (Stripe charges, 1Password compromised passwords, Plaid webhook deliveries) all do hierarchical summarization with drill-down. Naive chronological logging is what immature products do.
- **Margin editor:** two numeric fields (`max_discount_pct`, `max_increase_pct`). Worked profit example using a representative SKU from the customer's catalog and their stated margin: shows minimum allowed price (€), profit impact per unit (€ and %), updates live on input change. Explicit "estimativa baseada na margem que indicou" caveat language so example is honest about being approximate.
- **Pause button:** big, obvious, single-click. Resume is also one click.
- **NOT in MVP dashboard:** dedicated "price-up candidates" / ceiling-headroom panel (audit log + KPI cards cover transparency). Revenue-impact reporting in euros (Epic 2 — hard to compute reliably without baseline a/b). Historical analytics / time-series. Per-SKU controls.

## 9. Operations & Failure Handling

- **3-tier failure model:**
  - **Transient** (429, 5xx, timeout): exponential backoff retry within cycle, log, surface only if persistent (>3 consecutive cycle failures → dashboard banner).
  - **Per-SKU operational** (PRI01 partial failure, EAN mismatch, etc.): log per-SKU, continue cycle, retry on next cycle. Don't halt whole tool.
  - **Critical** (auth invalid, sustained outage, anomaly freeze, circuit breaker trip): pause customer's repricing, email immediately + dashboard banner.
- **Email service:** Resend (free tier 3k emails/mo, drop-in). For tier-3 critical alerts only.
- **Cron health monitoring:** UptimeRobot pings `/health` endpoint every 5 min. Free tier. Founder's email = monitoring channel for MVP.
- **PRI01 polling:** PRI02 polled until COMPLETE/FAILED. Failures logged per-SKU.
- **Async job mechanics for initial scan:** scan state persisted server-side (`customer_id` → `job_state` in DB). Client can disconnect/reconnect cleanly. Standard pattern.
- **Day-1 customer success commitments (for first 3 paying customers):**
  - Founder availability: 2-hour response SLA during customer's launch week.
  - Active monitoring: founder tails audit log + uptime status for 24h post-Go-Live, before customer asks.
  - Pulse check: explicit day-3 and day-7 outreach (call or email).
  - Pre-prepared rollback playbook: documented 30-min response (pause → alert → diagnose → fix or revert).
- **Solo founder continuity runbook:** 1-page document before customer #1 — what to do on laptop loss, hospitalization, extended absence. Mitigates single-point-of-failure risk.

## 10. Sales Pipeline & Warm Leads

- **~30 leads tracked in OUTREACH.md.** All currently silent (~2 weeks ghosted as of session date).
- **Top 4 warm by pain level + LTV potential:**
  - **Tony Cardosa @ You Get** (`+351913564463`, `tony.cardosa@youget.pt`): 8.4k Worten products, 25 marketplaces total, 5 Mirakl confirmed (Worten, PCComponentes, Carrefour ES+FR, MediaMarkt, possibly "HoodCommerce"). Zero pricing automation. Meeting "very positive." LTV: ~€250/mo if multi-marketplace lands. Recommended re-engagement target — highest signal-per-risk.
  - **Ricardo Morais @ WDMI / Oportunidade24** (`+351224075090`, `ricardom@wdmi.pt`): 50k total SKUs across 4 Mirakl marketplaces. Catalog is a MIX of new commodity electronics (in-scope) and refurbished (STRUCTURALLY out of scope — see §14). Thin margins (<5%) on the in-scope portion, floor protection critical. Group-level decision-maker, knowledgeable, has tried other tools (none stuck). **LTV partial and unknown** — could be up to ~€200/mo if in-scope SKU portion is meaningful, materially less if catalog is mostly refurbished. **Action item:** Pedro to ask Ricardo "*Dos 50k SKUs, quantos são produtos novos e quantos recondicionados?*" before counting LTV.
  - **Rui Ventura @ Servelec** (`ventura.rui@servelec.pt`): ~70k products, CEO. Quoted €1k+€50/mo with no objection. Said "makes total sense for us." API key pending from technical contact.
  - **Carlos / Rui @ MCGAD** (`+351278248103`, `mcgad.info@gmail.com`): 25k+ Worten sales, single-marketplace. Raised explicit "no company/brand" trust objection. Half-mitigated (ToS + brand exist), full mitigation pending domain + professional email.
- **Second cohort warm:** Tek4life (André Fernandes, 10k+, premium), PC GO (50k+), Ferramentaspro (10k+), You Like It / Twomii (Rui, **100k+ SKUs**, Porto), Multishop (25k+), MEGAOnline / Grupo Mega (multi-brand), Infopavon (multi-marketplace, has complaint history).
- **Cold lead-finding methodology (proven, in OUTREACH.md):** Worten product page → "+X sellers" → company info → NIF, phone, email. Target electronics, computing, gaming, appliances.
- **Founder fear acknowledged:** re-engaging silent leads is psychologically uncomfortable ("what if they're silent again?"). Smallest-action path: ship credibility infrastructure (domain marketpilot.pt + professional email — currently NOT shipped) → send to ONE lead first (Tony) → calibrate next 5-10 sends from his response.
- **Plan B for warm-lead silence:** trigger at week 6 of MVP completion. Parallel paths: (a) restart cold outreach using OUTREACH.md playbook, (b) actively market the free report as inbound funnel (LinkedIn, ACEPI/Adigital, Worten seller forums).

## 11. Competitive Intelligence

- **Boardfy** (Spanish): sticker price ~€19/mo with hidden add-ons (feed, API, repricing) inflating real cost. Trustpilot user-review base is thin (N=1 in some sources). Onboarding gap reported. CMS-oriented (Magento, Shopify, Prestashop) more than deep Mirakl integration. **Sticker creates downward price-anchor pressure — prospects comparison-shop will anchor to €19, not Boardfy's real TCO.**
- **Boostmyshop myPricing** (French): ~€99/mo+, claims 247-250 Mirakl marketplaces via MiraklConnect. Rule-based strategies (buybox, margin, loss-leader). Claims +20% sales. **Critically: depends on MiraklConnect (operator-side, paid aggregation). MarketPilot's direct shop_api_key + PRI01 sidesteps this entirely** — works on every Mirakl tenant whether or not the operator enables MiraklConnect.
- **Omnia Retail** (Dutch enterprise): €10k+/yr. SME-inaccessible. Not a real competitor in this segment.
- **Generic Amazon repricers** (Repricer.com, Informed, BQool): Amazon-first, occasionally bundle marketplace coverage. Capterra reviews flag: slow UI, 12h refresh delays, repricing silently stalls for weeks, per-item min/max/VAT config tedium, revenue-based pricing penalizing partial use.
- **No serious local PT/ES competition.** Localization gap is the wedge.
- **Capterra/GetApp sentiment patterns** (validates every MarketPilot design choice):
  - "One of the slowest programs", 12h refresh too slow → MVP cycles every 15 min.
  - Revenue-based fees feel unfair → MVP flat €50/marketplace.
  - Per-item min/max/VAT setup tedium → MVP smart defaults from one onboarding question.
  - Tools showing "buybox won" when not won → MVP P11 direct read + audit log.
  - Onboarding gaps → MVP progress page + login-back-in pattern + first-dashboard-shows-same-KPI-categories-as-report (visually consistent family, not UI clone).

## 12. Free Report (DynamicPriceIdea repo) Context

- **Already shipped, in production**, generates polished branded reports (PT/ES toggle).
- **Four sections:** "A tua posição agora" (KPI summary cards), "Maiores oportunidades" (top-value losing 1st by thin margins), "Margem para subir" (winning with headroom — ceiling angle), "Vitórias rápidas" (≤2% reduction wins 1st).
- **Strong CTA:** *"Quer que isto aconteça automaticamente? Ative o Repricing Dinâmico e mantenha-se em 1.º lugar 24/7."* This CTA leads directly to MarketPilot account creation in MVP (no email gate, no sales call).
- **Critical brand promise:** report is self-served and does NOT store API keys. Repricer must encrypt and store keys (full-account-access constraint). This creates a deliberate **two-step trust funnel: report = trust-free try, repricer = trust-yes paid.** Brief should preserve and emphasize this funnel design — it's both UX and brand strategy.
- **Already engaging real prospects.** This is not a marketing concept — it's a delivered v1 of the value prop, in market with real reports generated for the warm leads.

## 13. Architecture Decisions Made

- **Separate repo (this one):** `marketpilot-repricer`. Different security posture from report repo (DynamicPriceIdea).
- **Hosting:** same Hetzner server, new Coolify project.
- **Topology:** `app.marketpilot.pt` (customer dashboard, Fastify + UI) + internal repricer-worker (cron service, no public URL) + Postgres (with encrypted-at-rest key vault).
- **No monorepo.** If shared logic emerges (Mirakl P11 client wrapper, pricing math), extract a small npm package — don't preempt.
- **Stack:** Node.js >=22, Fastify, Postgres. Supabase Cloud (EU region) for Auth + RLS + DB hosting. Stripe for payments. Resend for transactional email. UptimeRobot for cron health. Moloni manual for invoicing.
- **Coolify project layout (per CLAUDE.md):** Coolify on Hetzner. Adding Supabase Cloud crosses an org boundary (customer Mirakl keys live at Supabase, not on Hetzner) — needs ToS/Privacy reflection.
- **Reusable code from Gabriel's project** (`D:\Plannae Project\Gabriel - Marketplace`): OAuth2 token management (`connectors/mirakl/auth.ts`), pricing formula (`lib/pricing/engine.ts`), price submission batching (`worker/src/jobs/offer-sync.ts`). P11 read is NOT in Gabriel's project — that's the new piece.
- **Database schema sketch (from RESEARCH.md, supplement with):** per-SKU per-channel rows (NOT just per-SKU), `last_set_price`, `last_set_at`, baseline snapshot, tier classification, audit log table.

## 14. Rejected Ideas (with rationale — DON'T re-propose)

- **Cost-based formula with CSV upload as MVP requirement.** Rejected: forces customers to wrangle a 50k-row spreadsheet, breaks self-serve onboarding. Replaced with %-based formula using onboarding margin question. Cost-based override comes back as Epic 2 power-user feature.
- **Concierge-only onboarding (no self-serve signup) for MVP.** Considered for simplicity. Rejected: free report taught users self-serve, breaking that for the paid tool is UX regression. Supabase Auth makes it cheap. Self-serve from MVP day 1.
- **Founder-flipped Go-Live gate.** Considered and adopted, then reversed. Rejected because: (a) doesn't scale beyond ~5 customers, (b) puts founder in worse legal position (audit trail says "Pedro approved" instead of "customer consented"), (c) trust signal is actually weaker than informed-consent modal. Replaced with conditional consent modal + customer self-flip.
- **Dedicated "price-up candidates" / ceiling-headroom panel.** Considered as MVP feature. Rejected: engine already raises autonomously within tolerance, audit log shows raises, KPI cards show "SKUs in 1st." Marginal UX gain, real implementation cost. Defer.
- **Real-catalog calibration test against multiple warm leads' data before locking engine spec.** Suggested by skeptic reviewer. Rejected: only Gabriel's API key exists pre-customer. Calibration done with Gabriel's 50-row sample (cosmetics, ~13% implied margins, validated 3% safe). Electronics catalogs remain inferred from the smart-default mapping table.
- **Stripe-only billing without manual invoicing.** Considered for simplicity. Rejected: PT/ES B2B SMEs require NIF on invoices (legal/accounting requirement). Moloni manual invoicing per Stripe payment is the compromise.
- **Unified pricing across Worten PT and Worten ES (single price both channels).** Initially recommended. Rejected after Pedro's pushback: PT and ES competitive landscapes diverge meaningfully (the free report itself has a PT/ES toggle showing different competitive picture). Per-channel repricing is MVP-required.
- **Tier system as Epic 2 (not in MVP).** Initially deferred. Restored to MVP after recognizing: (a) tiers are the engine decision framework foundation, (b) ~40% API call volume reduction on 50k-SKU catalogs is meaningful, (c) reduces Mirakl rate-limit risk.
- **Multi-marketplace at MVP (Phone House, Carrefour, etc.).** Considered as Epic 1. Rejected: single marketplace forces scope discipline. Epic 2 can add via configuration + per-operator integration testing (~1-2 weeks per marketplace).
- **Refurbished / reconditioned product repricing.** Out of scope STRUCTURALLY, not just deprioritized — do NOT propose this at any downstream stage. Worten has no shared EAN catalog for seller-created refurbished listings (each seller invents their own product entry, EAN, naming for reconditioned units). P11 returns "this product as I described it" but never returns competitors on the *same* refurbished item because no other seller has described an identical item. The engine would classify all refurbished SKUs as Tier 3 (no competitors) forever and do nothing useful. Customers selling primarily refurbished get zero value from the tool and would churn within month 1. Confirmed in OUTREACH.md WDMI note: *"Reconditioned market out of scope (no standard EANs)."* Earlier framing of WDMI as "thin-margin refurbished persona" was incorrect — WDMI is in-scope ONLY for the new-commodity portion of their catalog (see §10).
- **Account deletion as single-click for the customer** (initial PRD FR4 wording). Rejected — wrong shape for an irreversible destructive action that wipes encrypted API key + audit log + customer state. Multi-step required: discoverable button in `/settings/delete` → modal requiring customer to type "ELIMINAR" verification phrase + email → 7-day soft-delete grace period (account suspended, cron paused, dashboard locked, data still recoverable, customer can cancel) → hard-delete per GDPR Article 17 at grace-period end. **Encrypted shop API key destroyed at INITIATION (not grace-period end)** — security commitment "the moment you say delete me, the key is gone" wins over the small re-onboarding friction if customer cancels mid-grace. Moloni invoice metadata retained as fiscal record. PRD FR4 amended to reflect this. UX skeleton §8.4 carries the full flow.
- **Self-serve add/remove marketplace UI at MVP** (initial PRD FR41 wording). Rejected — MVP is single marketplace only. Adding a second marketplace is concierge-only at MVP: customer emails founder, founder configures encrypted key + Stripe line item + next Moloni invoice covers combined payment. No "Add Marketplace" CTA in customer dashboard; `/settings/marketplaces` shows read-only list with inactive button + tooltip pointing to email. Self-serve add/remove ships in Epic 2 alongside multi-marketplace UI. PRD FR41 amended to split MVP-concierge / Epic 2-self-serve.
- **`/onboarding/scan-ready` interstitial — initially un-designed.** Was implicit in PRD onboarding flow ("scan completes → dashboard"). Sally's UX skeleton (§8.3) added a deliberate readiness summary screen between scan completion and margin editor: shows in-scope SKU count + Tier 3 count + no-EAN-ignored count, with "porquê?" disclosure on refurbished structurally OOS. Sets expectations honestly using the chat-transcript register (anti-promissory, anti-fake-data) and prevents future support tickets. Not a feature change, a UX inflection — but downstream stages should treat this as a real onboarding step, not skip-able.

## 15. Pre-Revenue Legal Gates (must exist before first invoice)

- **ToS update** covering automated price-setting agency on customer's behalf. Existing free-report ToS does NOT cover this scope.
- **DPA template** for B2B customers. Procurement-conscious leads will request.
- **Refund policy** explicit: "First-month money-back guarantee within 14 days of Go-Live, no questions asked." (Earlier framing "first month refundable if Go-Live never flipped" was incoherent — Stripe charges only on Go-Live click, so a customer who never Go-Lived never paid; nothing to refund. See §1 for full reasoning.)
- **Worten/Mirakl operator ToS compatibility check.** Confirm automated repricing via shop_api_key is consistent with Worten's seller agreement. UNVERIFIED — could be a hidden blocker.
- **Account deletion workflow (GDPR Article 17 implementation per FR4 amended).** Multi-step verification + 7-day grace period before irreversible deletion. Encrypted shop API key destroyed at initiation; full hard-delete at grace-period end (audit log entries wiped, Stripe customer/subscription references wiped, catalog/baselines/pricing-state wiped; Moloni invoice metadata retained as fiscal record). UX flow specified in skeleton §8.4. Implementation deferred to ARCH but MUST exist before first paying customer (GDPR applies at first invoice).
- **Decision:** these do NOT block MVP build but DO block first invoice. Founder will scope a fixed-fee legal review post-build, pre-Go-Live.

## 16. Open Questions for ARCH (Winston) — Mirakl MCP Verification Mandatory

1. **PRI01 mechanism for per-channel price writes.** CSV format with `channel-code` column? Or separate import per channel? Or global price that propagates?
2. **Channel codes:** confirm `WRT_PT_ONLINE` / `WRT_ES_ONLINE` are the active channel codes for Worten.
3. **Cross-channel pricing constraints:** does Mirakl/Worten enforce parity rules between PT and ES prices?
4. **Single-channel offer handling:** how does P11 return SKUs that exist in PT but not ES (or vice versa)? Schema needs to handle "channel = N/A" states.
5. **`all_prices` array shape:** confirm per-channel `total_price` is available (price + shipping per channel).
6. **Source of own-shipping cost per offer:** likely OF21 returns it per offer — verify. Fallback: customer-entered flat shipping at onboarding.
7. **P11 / PRI01 rate limits + per-customer cadence ceiling:** unverified. Scale math assumes ~10 concurrent calls × 200ms. ARCH must derive a per-customer pacing budget from observed Mirakl rate limits — what's the largest catalog size where 15-min Tier 1 / Tier 2a cadence stays within budget? For Twomii (100k+ SKUs), 15-min may exceed budget; default cadence may need to be looser by catalog size. Resolution may require Tier 1/2a cadence becoming customer-config-driven (or at least catalog-size-driven) rather than globally hardcoded.
8. **KMS specification:** encryption key custody, rotation policy, recovery on Supabase incident. The brief mandates encryption-at-rest; ARCH must specify HOW.
9. **Active offer filtering:** confirm `active=true` is the right filter and is reliably populated.
10. **Failure mode behavior:** PRI01 partial-success semantics, retry idempotency, PRI02 polling cadence and timeout policy.

## 17. Founder Context & Constraints

- **Pedro Belchior Barreira** — solo developer, non-developer entrepreneur. Relies heavily on AI for implementation.
- **Cash-constrained:** running on €100/month Claude subscription, optimizing for execution speed.
- **Methodology:** BMAD Method (full chain product-brief → PRD → architecture → epics → stories → dev → review). BAD pipeline for parallel story execution. This brief is the input to the next BMAD stage (PRD with John, PM agent).
- **Communication preference:** English in chat, Portuguese for sales artifacts.
- **Velocity datapoint:** the free report (similar scope, single-tenant, no auth) was estimated at 9 months by another agent and shipped in 1 week with AI-assisted dev. Pedro's stated MVP target: 2-3 weeks build (engine + dashboard + auth + key-entry form + Stripe + audit log + pause + margin editor + dry-run + Moloni manual invoicing flow). 6-8 weeks to first revenue including first-customer onboarding + Go-Live.
- **Gabriel's live Worten Mirakl sync as cooperative-ERP-sync testbed.** Pedro has Gabriel's existing Worten Mirakl integration running an ACTIVE 15-min sync against a real catalog (not just a code-reuse source per §13). This is a production-grade testbed for the cooperative-absorption mechanic — the 15-min cadence simulates the ERP-overwrite scenario the cooperative model is designed for. **Cooperative-ERP-sync can be validated during dogfood week 3, BEFORE customer #1.** The mechanic's primary novelty risk is testable pre-revenue, not contingent on 3 paying customers × 90 days. This materially de-risks the highest-novelty part of the engine and shifts the validation window from "post-revenue" to "during dogfood." Downstream stages (ARCH, dev) should plan dogfood phase to deliberately exercise: (a) external-change absorption, (b) anomaly-freeze on intentional >40% test deviations, (c) outbound circuit breaker against synthetic-bug scenarios, (d) full Tier 1/2/3 cycle behavior across Gabriel's actual catalog mix.
- **Honest velocity caveat:** AI-assisted dev compresses well-scoped features, less so the integration surface (PRI01 first-time live debugging, encryption KMS work, multi-tenant RLS testing). Ambitious timeline is plausible IF scope discipline holds.

## 18. PRD Stage Hand-off Notes

- **Brief is the WHAT.** PRD is the WHAT-in-detail (functional spec, acceptance criteria, edge cases, user stories).
- **The engine decision table (tie cases, leader-is-self, all-competitors-above-ceiling, two-repricer-conflict, single-channel-offer, single-competitor) is the highest-leverage PRD section.** Brief gives the framework (tier system); PRD enumerates every case.
- **Onboarding flow needs to be storyboarded scene-by-scene in the PRD** — every screen, every form field, every error state, every success state. The brief sketches it; PRD draws it.
- **Margin editor's "worked profit example" is a real implementation challenge.** PRD should specify: which SKU is selected as representative? How is "stated margin" used in the back-calculation? What language explains the estimate is approximate?
- **Per-channel data model deserves a dedicated PRD section.** Schema, UI toggle behavior, audit log channel-tagging, anomaly freeze per-channel, etc. Easy to under-spec.
- **Day-1 customer success commitments belong in the PRD as operational requirements**, not just brief-level promises. Concrete: rollback playbook drafted, monitoring dashboard for founder, alert escalation rules.
- **Pre-revenue legal gates are NOT a PRD concern but should be tracked separately** (project tracker or roadmap doc) so they don't get lost between brief and dev.
