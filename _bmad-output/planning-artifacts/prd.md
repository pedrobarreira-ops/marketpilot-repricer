---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-12-complete
status: 'complete'
completionDate: '2026-04-29'
lastAmendedDate: '2026-04-29'
amendments:
  - 'Post UX-skeleton: FR4 (account deletion multi-step + 7-day grace), FR41 (split MVP concierge / Epic 2 self-serve), FR38b/c/d (audit log hierarchical summarization)'
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-marketpilot-repricer.md
  - _bmad-output/planning-artifacts/product-brief-marketpilot-repricer-distillate.md
  - CLAUDE.md
documentCounts:
  briefs: 2
  research: 0
  brainstorming: 0
  projectDocs: 1
classification:
  projectType: saas_b2b
  domain: general
  domainNotes: 'e-commerce / marketplace tooling — not in CSV. Trust/integration complexity flags: encrypted API key vault, automated price-setting agency on customer''s behalf, multi-tenant from day 1, PT/ES NIF/IVA invoicing.'
  complexity: medium-high
  projectContext: greenfield
externalCodeSources:
  - 'D:\Plannae Project\DynamicPriceIdea — Mirakl P11 + API calls already implemented (free report generator)'
  - 'D:\Plannae Project\Gabriel - Marketplace — OAuth2 token mgmt, pricing engine math, price-submission batching'
workflowType: 'prd'
project_name: 'marketpilot-repricer'
user_name: 'Pedro'
date: '2026-04-29'
---

# Product Requirements Document - marketpilot-repricer

**Author:** Pedro
**Date:** 2026-04-29

## Executive Summary

MarketPilot Repricer is a self-served B2B SaaS that automates competitive repricing for Iberian sellers on Mirakl-based marketplaces, starting with Worten PT/ES. Sellers paste a single Worten shop API key into an encrypted vault, configure margin tolerance bands via one onboarding question (no cost CSV, no per-item setup), and the tool autonomously holds 1st place 24/7 within those bands — undercutting when behind, raising toward a ceiling when winning, absorbing external price changes from the seller's existing ERP rather than fighting them.

Target users are Iberian Mirakl SMEs operating 10k–100k SKU catalogs (electronics, computing, gaming, appliances) — the segment whose representative warm leads (You Get @ 8.4k Worten products, WDMI @ 50k in-scope new commodity portion, Servelec @ 70k, Twomii @ 100k+) currently run zero pricing automation and lose tens of thousands of euros per quarter to thousands-of-SKUs-in-2nd-place leak. Refurbished products on Worten are structurally out of scope (no shared EAN catalog for seller-created refurbished listings — see §Journey Requirements Summary for the structural rationale).

The market window is unusually open. Fnac's June 2025 Mirakl exit consolidated PT/ES marketplace volume onto Worten + Phone House. Worten Ads (July 2025) pulled fresh SME sellers onto the platform who will hit buybox-loss pain within months. Existing tools — Boardfy (Spanish, sticker €19/mo with hidden add-ons), Boostmyshop myPricing (French, ~€99/mo+, MiraklConnect-dependent), Omnia Retail (€10k+/yr enterprise) — have no local PT/ES presence, no flat-fee transparent pricing, and consistent Capterra complaints around silent stalls, 12h refresh delays, per-item configuration tedium, and revenue-based fees. The €50/mo SME band MarketPilot occupies sits in a genuine gap between Boardfy/Boostmyshop's mid-market pricing and Omnia's enterprise tier. Pricing is a flat **€50/marketplace/month, no setup fee**, with PT NIF/IVA-compliant invoicing via Moloni (manual at MVP, API-integrated in Epic 2).

### What Makes This Special

The differentiator is architectural posture, not feature count.

**Trust as architecture** is the brand-level wedge. The Mirakl `shop_api_key` has no read-only mode — it grants full account access including bank/IBAN, sales, and orders. Every competitor handwaves this; MarketPilot makes it the centerpiece: encryption-at-rest, single-purpose key-entry form (founder never sees cleartext), Supabase Auth + RLS multi-tenant isolation from day 1, dry-run-by-default, informed-consent Go-Live modal that the customer self-flips (not the founder), full per-customer-per-channel audit log including external-change-absorbed events tagged distinctly. Founder accessibility complements this: Pedro is named on the site, directly reachable, Portuguese-speaking — a human-trust layer that VC-backed faceless competitors structurally cannot replicate.

**The free-report → repricer funnel is product strategy, not marketing.** The DynamicPriceIdea repo (already in production, generating polished branded reports for real prospects) deliberately stores no API key — try-without-trust. The repricer encrypts the key — pay-with-trust. This is a trust step-up architecture from the customer's perspective: granting more trust as they move through the funnel. The report's existing engagement with warm leads is a concrete PMF signal that de-risks the paid-product pitch. The dashboard surfaces the same KPI categories the free report introduced (SKUs in 1st, losing position, exclusive, catalog value at risk) in a visually consistent product family — a customer who saw the report recognizes the dashboard as the same product line, though the two UIs are not identical (the dashboard is a fully interactive multi-tenant operational UI; the report is a static branded artifact).

**Cooperative ERP-sync is the primary tactical mechanic.** When the seller's ERP, manual edit, or another tool changes the price between cycles, MarketPilot absorbs the change as the new `list_price` baseline rather than overwriting it. The customer's other systems remain authoritative for pricing intent; MarketPilot only optimizes within the resulting tolerance band. No competitor in the segment does this — they all force the seller to stop editing manually.

**Belt-and-suspenders safety surfaced to the customer by default.** Four independent layers — tier system (per-product cycle cadence — see FR18 for full 4-state spec; Tier 1 / Tier 2a 15 min, Tier 2b 30-60 min, Tier 3 daily), outbound circuit breaker (≤20% of catalog repriced per cycle, ≤15% per-SKU price move), nightly reconciliation, inbound anomaly freeze on >40% external deviation — all visible in the dashboard, audit log, and consent modal.

**Worked-profit-example margin editor** shows live euro impact next to the setting being adjusted — not generic percentages — using a representative SKU from the customer's own catalog. **Direct shop API key, no MiraklConnect dependency** works on every Mirakl tenant, sidestepping Boostmyshop's architectural ceiling. **Flat €50/marketplace/month, PT/ES localization, Moloni NIF/IVA invoicing** deliberately invert every Capterra complaint about competitors (revenue-based fees, hidden add-ons, opaque results, English-only support).

The core insight binding these together: competitors fight the seller's other systems and treat trust as compliance overhead. MarketPilot inverts both — cooperatively absorbing external state and treating trust as the centerpiece — which is precisely what makes self-serve real for the first time in this segment.

## Project Classification

- **Project Type:** SaaS B2B (multi-tenant customer dashboard at `app.marketpilot.pt` + internal repricer-worker cron service + encrypted-at-rest Postgres key vault).
- **Domain:** E-commerce / marketplace tooling (no exact match in standard domain taxonomy; closest neighbors are SaaS-B2B + integration-heavy backends, with elevated trust/agency complexity from full-account-access API keys and automated price-setting on the customer's behalf).
- **Complexity:** Medium-high. No regulator approval gate; no real-time-safety-critical path; single marketplace at MVP enforces scope discipline. Real complexity sits in trust architecture (KMS key custody, RLS, encrypted vault, four-layer write safety), Mirakl integration edge cases (per-channel pricing, async PRI01/PRI02 polling, OF24 footgun, unverified rate limits), and the engine decision table (tie cases, leader-is-self, all-competitors-above-ceiling, two-repricer-conflict, single-channel offer, single-competitor).
- **Project Context:** Greenfield. Pre-build planning phase. Strategic foundation in product brief + CLAUDE.md. Identified code-reuse sources: `D:\Plannae Project\DynamicPriceIdea` (Mirakl P11 + API patterns, in production) and `D:\Plannae Project\Gabriel - Marketplace` (OAuth2 token mgmt, pricing engine math, price-submission batching).

## Success Criteria

### User Success

Each user-success metric ties back to a specific differentiator from the Executive Summary:

- **Trust architecture works as a wedge.** First 3 paying customers complete onboarding end-to-end self-served — paste API key, run scan, review dry-run, self-flip Go-Live — without founder intervention beyond the documented Day-1 monitoring. Concrete signal: customer accesses the audit log at least once in the first 7 days post-Go-Live (proves transparency is actually consumed, not just shipped).
- **Free-report → repricer funnel converts.** ≥10% of free-report recipients who click the embedded CTA reach the key-entry form. ≥30% of customers who validate a key reach Go-Live within 14 days. **⚠ No baseline data — these are starting hypotheses, not validated targets. Revisit and recalibrate after the first cohort of 5-10 customers; do not gate decisions on these specific numbers until calibration data exists.**
- **Cooperative ERP-sync is real, not theoretical.** External-change-absorbed events show up in the audit log of every active customer (zero is a red flag — means no customer's ERP is actually moving prices, which contradicts the segment assumption). Zero customers complain about "the tool fights my ERP" in the first 90 days.
- **Pause works as a trust escape valve.** Customers who pause can resume in ≤1 click within 24h ≥80% of the time (low-pause-then-resume = healthy curiosity-driven use; high-pause-and-walk-away = trust failure to investigate).

### Business Success

- **Time to first revenue: 6-8 weeks post-MVP completion.** Founder's stated target. Concrete first-customer candidate: Tony @ You Get if re-engagement lands, else next-most-warm from OUTREACH.md top-4.
- **Time to first cohort: ≤12 weeks post-MVP completion = 3 paying customers.** Matches the Day-1 active-monitoring commitment cohort size.
- **6-month MRR floor: €500.** Achievable with 4 single-marketplace customers, OR Tony's 5-marketplace account (€250/mo) plus 2-3 single-marketplace customers. Optimistic upside narrative (NOT a target): if multiple multi-marketplace warm leads close — Tony alone is €250/mo at 5 marketplaces, and second-cohort warm leads (Twomii @ 100k+ SKUs, Tek4life, PC GO) are also multi-marketplace candidates — €1k+ MRR is reachable. Floor is testable; upside is not.
- **Plan B activation criterion: week 6 post-MVP with zero conversions** → restart cold outreach (OUTREACH.md playbook) + LinkedIn/ACEPI/Adigital/Worten-forum inbound marketing.
- **Churn red-flag (informational, not yet a target): >1 of first 3 customers cancels in months 1-2** → forces decision on 3-month prepaid minimum (currently OPEN per brief §1).

### Technical Success

- **Tier 1 cycle latency p95 ≤ 18 min** (15-min nominal cadence with allowance for retries/backoff). Measured: cycle-end timestamp minus cycle-start timestamp, p95 across all customers' Tier 1 SKUs over 7-day rolling window. Tier 2a holds the same 18-min target per FR18 / NFR-P2.
- **Zero plaintext API keys at rest.** Verified pre-launch via internal security review (and by external review during legal/ToS work pre-revenue). Ongoing: zero plaintext key occurrences in DB dumps.
- **100% of PRI01 pushes resolve to PRI02 COMPLETE or FAILED within 30 min.** Stuck-WAITING SKUs ≥30 min trip a critical alert.
- **Zero out-of-tolerance prices reach Worten.** Enforced by circuit breaker (≤20% catalog/cycle, ≤15% per-SKU move) AND per-SKU floor/ceiling clamping at engine output. Measured: zero audit-log entries where pushed price < customer's floor or > customer's ceiling.
- **/health endpoint ≥99% uptime** measured by UptimeRobot (5-min ping). Below threshold trips founder email.
- **Critical alert delivery latency ≤5 min** from event detection to customer email (auth invalid, sustained outage, anomaly freeze, circuit breaker trip). Measured via Resend delivery timestamps.
- **Catalog scan scales to 50k SKUs** within ~10 concurrent calls × 200ms math (assumed below Mirakl rate limits — UNVERIFIED, ARCH must confirm via MCP and bake real limits into pacing).

### Measurable Outcomes

- **≥80% of customer's catalog gets cleanly repriced within 24h of Go-Live** (no per-SKU operational failures escalating beyond the per-cycle retry).
- **Customer's "SKUs in 1st place" KPI improves week-over-week for first 4 weeks post-Go-Live** (quantifies the buybox-leak recovery).
- **Founder spends ≤10 min/customer/month on Moloni manual invoicing at MVP scale** — Moloni API integration trigger threshold (Epic 2) hits when this exceeds 2-3 hr/month aggregate.
- **Zero customer-discovered safety incidents in first 90 days** — no "the tool changed my prices in a way I didn't expect" support tickets that aren't immediately explained by audit log + circuit breaker logic.

## Product Scope

### MVP — Minimum Viable Product

Target build: 2-3 weeks (founder's stated velocity, AI-assisted dev). 6-8 weeks to first revenue including legal gates and first-customer onboarding.

**Final onboarding flow:** signup → key entry (with linked Worten-key guide) → async catalog scan → margin band question → dry-run review → margin tuning with worked-profit-example → informed-consent Go-Live → Stripe subscription → live cron + manual Moloni invoice.

- **Auth & multi-tenancy.** Supabase Auth (email + password + verify), Supabase RLS, two-principal model from day 1 (founder admin + first customer).
- **Single-purpose key-entry form** with inline 5-second validation (test P11 call). Encrypted-at-rest key vault — KMS specification deferred to ARCH (Winston).
- **"How to find your Worten Marketplace API key" one-page guide.** Linked from the key-entry form. Walks the seller through Worten Seller Center → Account → API. Most prospects already use Seller Center but haven't generated a key. Without this guide, onboarding stalls at the key-entry step for non-technical owners.
- **Async catalog scan** with closeable progress page, server-side job state, reconnection handling. Email on failure only; healthy completion = customer logs back in to find populated dashboard.
- **Onboarding — single margin band question only.** Drives smart default `max_discount_pct` (per brief §2 mapping: <5%→0.5%, 5-10%→1%, 10-15%→2%, 15%+→3%). `max_increase_pct` global default 5%. **Two questions from brief §7 are deliberately NOT asked**: (1) "are you using another repricing tool?" — ~99% of the segment runs zero automation, and the cooperative ERP-sync model detects conflicts at runtime via anomalous external-change frequency, so an upfront filter is unnecessary for a 1% case; (2) "do you use different prices PT vs ES?" — VAT pass-through (23% PT / 21% ES) and shipping deltas mean every customer technically has different per-channel prices, making the question useless as a filter; the engine handles VAT-adjusted `total_price` per channel correctly, and strategic per-channel margin divergence waits for Epic 2 per-channel margin overrides.
- **Engine — cooperative ERP-sync + 4-state tier system + per-channel.** Tier 1 / Tier 2a / Tier 2b / Tier 3 driven by per-SKU `last_won_at` timestamp and `tier_cadence_minutes` column (full spec in §Functional Requirements FR17–FR19). Per-SKU per-channel rows. `list_price`, `last_set_price`, `current_price`, baseline snapshot. Rank competitors by `total_price` (price + shipping). Filter `active=true` offers only.
- **Engine safety — three independent layers + reconciliation.** Outbound circuit breaker (≤20% catalog/cycle, ≤15% per-SKU). Nightly reconciliation (implemented as Tier 3 daily pass). Inbound anomaly freeze (>40% external deviation). Trip = freeze + alert + manual unblock.
- **Engine decision table.** Tie cases, leader-is-self, all-competitors-above-ceiling, two-repricer-conflict, single-channel offer, single-competitor — fully enumerated in PRD §Functional Requirements.
- **Dashboard.** PT/ES channel toggle. KPI cards using the same categories the free report introduced ("*A tua posição agora*": SKUs in 1st, losing position, exclusive, catalog value at risk) — visually consistent product family with the report, not an identical UI clone. Audit log per-customer-per-channel with external-change-absorbed event tagging, filterable by channel/SKU/event type. Margin editor (`max_discount_pct`, `max_increase_pct`) with live worked-profit-example using a representative SKU from customer's own catalog. Big single-click Pause/Resume.
- **Informed-consent Go-Live modal** with conditional language ("Até **N produtos** poderão ter preços ajustados, dentro da margem de **X%** que configuraram."). Customer self-flips. Stripe subscription starts on flip; cron flips live.
- **Stripe subscription** (recurring monthly, €50/marketplace). **Moloni manual invoicing** flow (founder generates invoice per Stripe payment, ~5-10 min/customer/month).
- **Operations.** 3-tier failure model (transient retry → per-SKU operational log → critical email+banner). Resend for critical alerts only (free tier 3k emails/mo). UptimeRobot 5-min /health pings. PRI02 polling. Solo-founder continuity runbook (1-page: laptop loss, hospitalization, extended absence) drafted before customer #1.
- **Day-1 customer-success operational requirements.** Documented rollback playbook (30-min response). Founder monitoring dashboard (audit-log tail + uptime). 2-hour response SLA during customer's launch week. Day-3 and day-7 pulse-check protocol.
- **Pre-revenue legal gates** (BLOCK first invoice, do NOT block MVP build): updated ToS covering automated price-setting agency on customer's behalf, B2B DPA template, refund policy ("first-month money-back guarantee within 14 days of Go-Live, no questions asked" — €50 risk per refund as a first-cohort trust-building investment; tighten in Epic 2 once retention data exists), Worten/Mirakl operator ToS compatibility check.

### Growth Features (Post-MVP / Epic 2)

Triggered by either customer demand or scaling pain:

- **Multi-marketplace beyond Worten** — Phone House ES, Carrefour ES, PCComponentes, MediaMarkt. Per-marketplace integration testing ~1-2 weeks each. Largest LTV unlock (Tony @ You Get alone is +€200/mo on multi-marketplace).
- **Per-channel margin overrides** (today: margin tolerance is global per customer; per-channel override deferred).
- **Cost-CSV upload** for thin-margin power users where %-tolerance is structurally insufficient (flagged in onboarding for <5% margin segment).
- **Per-SKU exclude / "promo mode" toggle** for deliberate flash-sale handling (covers the cooperative ERP-sync edge case where a 24h promotional price gets absorbed as new baseline).
- **Customer-tunable anomaly-freeze threshold** (today hardcoded at 40%).
- **Restore-baseline feature** (snapshot is captured at MVP scan; UI to restore is Epic 2).
- **Revenue-impact reporting in euros** (requires baseline a/b methodology — hard to compute reliably without it; deferred until comparison data exists).
- **Moloni API integration** (replaces manual invoicing when founder time exceeds 2-3 hr/month aggregate — concrete trigger).
- **Per-SKU manual controls.**
- **Historical analytics / time-series.**
- **Dedicated "price-up candidates" / ceiling-headroom panel** (audit log + KPI cards cover transparency at MVP; this is a UX upgrade for power users).

### Vision (Future)

- **Standard repricing tool for Iberian Mirakl SMEs** (10k-100k SKU segment). Self-sustaining inbound funnel via free report + LinkedIn/ACEPI/Adigital/seller forums.
- **Cross-platform beyond Mirakl** — Bol.com, Real.de, other operator-specific Iberian or European marketplaces where the cooperative-absorption + trust-architecture posture transfers.
- **Possible small team** if MRR justifies (today: solo founder). Founder accessibility as trust wedge survives scaling only with deliberate hire selection (Portuguese-speaking, named publicly).
- **Free-report ecosystem** — additional report types (margin-erosion alerts, competitor-entry alerts) deepen the trust funnel without building paid features into the report itself.

## User Journeys

### Journey 1: Tony @ You Get — Primary seller, success path

**Persona context (brief §10):** Tony Cardosa, owner-operator. ~8.4k products on Worten, plus Carrefour ES/FR, MediaMarkt, PCComponentes — 25 marketplaces total, 5 confirmed Mirakl. Zero pricing automation today. Last meeting "very positive"; ghosted ~2 weeks. LTV potential €250/mo at 5 marketplaces.

**Opening scene.** Tony's inbox: a re-engagement email from Pedro mentions the free MarketPilot report has been refreshed with his current Worten data. He clicks through — 1.2k SKUs in 1st place, ~3.8k losing position by an average €0.12, total catalog value at risk in the high five-figures. CTA: *"Quer que isto aconteça automaticamente?"* He's seen the report twice before, but the dashboard preview embedded in the email is what tips him: same KPI cards, but live.

**Rising action.** Tony clicks the CTA → account creation form. Email + password, 30 seconds. Email verification arrives instantly. He logs in to a single page: *"Cole sua chave da API Worten."* Below: *"Como encontrar a sua chave?"* — he's never generated one. The one-page guide walks him through Worten Seller Center → Account → API in three screenshots. Three minutes later he's pasted the key. The form turns green inside 5 seconds — validation succeeded. Catalog scan progress bar: *"Carregando 4,250 / 8,432 produtos…"* He closes the tab and goes back to running his shop.

**Climax.** Two hours later, he logs back in. Dashboard loaded. PT/ES toggle at the top, KPI cards covering the same categories he remembers from the free report (SKUs in 1st, losing position, exclusive, catalog value at risk) — same product family, but live and interactive. Below the cards: *"Qual a sua margem média?"* He picks 5-10%. The margin editor populates with `max_discount_pct = 1%`, `max_increase_pct = 5%`. To the right, a worked profit example using a real SKU from his catalog: a Samsung Galaxy A54 at €289.99, his stated margin → minimum allowed price €287.10, profit impact -€2.89/unit. He nudges `max_discount_pct` to 1.5%; the example updates live. Dry-run is on by default. He clicks "Run dry-run for 24h." The audit log fills overnight — 47 SKUs would have been undercut, 12 raised toward ceiling, 8 frozen by anomaly because of an ERP price update he made yesterday on a clearance batch.

**Resolution.** Day 2: Tony reviews the dry-run. Numbers look right. **Go Live**. Conditional consent modal: *"Até **6,847 produtos** poderão ter preços ajustados, dentro da margem de **1.5%** que configurou."* Checkbox. Stripe modal. €50/mo, single marketplace. Subscription starts; cron flips live within 60 seconds. Pedro emails 48 hours later: *"Como está a correr? Posso enviar a fatura Moloni para o NIF da You Get?"* Tony confirms the NIF; the invoice arrives the next morning.

**Capability requirements revealed:**
- Free-report → repricer CTA wiring (cross-repo handoff with DynamicPriceIdea)
- Self-served signup with email verify (Supabase Auth)
- Single-purpose key-entry form with linked Worten-key one-pager
- Inline 5-second key validation
- Async catalog scan with closeable progress + reconnection
- Smart-default margin tolerance from one onboarding question
- Margin editor with worked-profit-example using customer's own SKU
- Dry-run mode by default; simulated events visible in audit log
- Anomaly-freeze events visible to customer
- Informed-consent Go-Live modal with conditional Portuguese copy
- Stripe subscription start on Go-Live click
- Founder pulse-check email (Day-3 protocol, operational)
- Moloni manual invoicing flow (founder-side)

### Journey 2: Ricardo @ WDMI — Primary seller, edge case (thin margins, trust under pressure)

**Persona context (brief §10, with corrected scope framing):** Ricardo Morais @ WDMI / Oportunidade24. 50k total SKUs across 4 Mirakl marketplaces. Catalog is a mix of new commodity electronics (in-scope) and refurbished (structurally out of scope — Worten has no shared EAN catalog for seller-created refurbished listings, so the engine would classify those Tier 3 forever). The in-scope portion runs thin margins (<5%). Group-level decision-maker, has tried other tools but none stuck.

**Opening scene.** Ricardo signs up after seeing Tony's results in the Worten seller forum (week 8 post-MVP, organic word-of-mouth path). He's tried Boardfy and Boostmyshop; neither handled the thin-margin sensitivity well. He pastes his key. Onboarding margin question: he picks <5% — the form shows a warning: *"Margens abaixo de 5% podem requerer controle baseado em custo (Epic 2). O smart default é 0.5%, mas considere ativar dry-run por mais tempo antes de ir live."* Default `max_discount_pct = 0.5%`. He's skeptical but gives it a shot for the in-scope portion of his catalog.

**Rising action.** He runs dry-run for 7 days (longer than Tony, by design — the warning nudged him). Day 4, an anomaly-freeze event fires: a SKU went from €189 to €98 in his ERP overnight (a clearance correction). The audit log entry tags it distinctly: *"⚠ Mudança externa de preço >40% absorvida; congelado para revisão. Confirmar novo list_price ou rejeitar."* Email arrives in his inbox immediately. He logs in, reviews, confirms the new list_price; the SKU unfreezes.

**Climax.** Day 7: he flips Go-Live. Within 48 hours, the circuit breaker trips — an ERP misconfiguration caused his system to push 2,300 SKUs to incorrect prices in a single batch. The cooperative ERP-sync absorbed them; the engine started repricing aggressively against the "new baseline." The 20%-of-catalog-per-cycle threshold triggers: 18% repriced, then halt. Cron freezes; Ricardo's phone gets the critical alert email and dashboard banner. He clicks the audit log; he can see exactly which 2,300 SKUs were affected, which prices MarketPilot pushed, and which were the absorbed ERP changes that started the cascade. He pauses MarketPilot, fixes the ERP issue, restores his ERP prices manually, and clicks "Resume" the next morning.

**Resolution.** No revenue cascade — the circuit breaker caught it before more than 18% of his catalog was affected. The audit log gave him the forensic trail to fix the root cause in his ERP. Week later, he's still subscribed. He tells Pedro on a pulse check: *"O facto de que a ferramenta parou sozinha — isso é o que outras não fazem."*

**Capability requirements revealed:**
- Smart-default warning for <5% margin segment + Epic 2 cost-CSV recommendation copy
- Extended dry-run (no time limit)
- Inbound anomaly freeze (>40% deviation) with customer-facing review/confirm UI
- Critical alerts via Resend with ≤5 min delivery latency
- Outbound circuit breaker (≤20% catalog/cycle) with halt + alert + audit-log forensic trail
- Pause = freeze (not rollback) at MVP
- Audit log filterable by event type ("external-change-absorbed", "circuit-breaker-trip")
- Resume = single click

### Journey 3: Pedro (founder/admin) — Day-1 active monitoring + critical alert response

**Persona context.** Pedro Belchior Barreira, solo founder. Brief §9: 24h post-Go-Live active monitoring, 2-hour response SLA during launch week, day-3/day-7 pulse checks, 30-min rollback playbook.

**Opening scene.** 22:47 Tuesday. Pedro's UptimeRobot phone alert fires: `/health` failed 2 consecutive 5-min pings. He's already at his laptop tailing Tony's audit log (Day 1 post-Go-Live). He opens the founder monitoring dashboard — internal page, NOT customer-facing — showing audit-log tail across all customers, uptime status, and circuit-breaker state.

**Rising action.** Cron service is up but Mirakl P11 latency has spiked from ~200ms to ~12s — Mirakl might be having an incident. No prices have been pushed in the last cycle because the engine couldn't read competitor data in time. The 3-tier failure model classifies this as transient — exponential backoff retry within cycle, log, surface only if persistent. After 3 consecutive failures, banner.

**Climax.** Cycle 4 fails. Customer-facing dashboard banner triggers automatically for all live customers: *"Atrasos temporários — verificações com a Worten estão lentas. Sem ações de preço novas até estabilizar."* Tony emails: *"Notei o banner — está tudo bem?"* Pedro replies inside the 2-hour SLA: *"Sim, congelado por segurança até a Worten responder normalmente."* Mirakl recovers 38 minutes later. Latency normalizes. Engine resumes on the next cycle. Pedro updates the rollback playbook: the 3-consecutive-cycles-then-banner threshold worked, no manual intervention needed.

**Resolution.** Next morning: Pedro generates the Moloni invoice for Tony's first Stripe payment (~6 minutes) and emails it. He runs the day-3 pulse-check call with Ricardo, who's been live a few days longer. He adds a one-line item to his backlog: *"consider exposing Mirakl latency p95 in customer-facing banner copy itself."*

**Capability requirements revealed:**
- /health endpoint with UptimeRobot 5-min pinging
- Founder monitoring dashboard (internal): cross-customer audit-log tail, uptime, circuit-breaker state
- 3-tier failure model: transient retry → per-SKU operational log → critical email+banner
- Customer-facing dashboard banner for sustained transient issues, Portuguese-localized
- Customer email response within 2-hour SLA during launch week (operational)
- Moloni invoice generation flow (~5-10 min/customer/month, manual at MVP)
- Day-3 / day-7 pulse-check protocol (operational)
- Solo-founder continuity runbook (drafted before customer #1)

### Journey 4: Customer self-service investigation — Trust without support staff

**Persona context.** Any active customer post-Go-Live. The trust-architecture wedge depends on customers investigating price changes themselves rather than asking the founder. This journey demonstrates the audit log as a trust deliverable, not a logging table.

**Opening scene.** A You Get warehouse manager (not Tony himself) notices in Worten Seller Center that a Samsung TV (higher-margin SKU) was repriced overnight from €1,499 to €1,478. He pings Tony: *"O MarketPilot ajustou um TV; achas que está bem?"*

**Rising action.** Tony opens the dashboard. Audit log → filter by SKU (EAN search). Three events appear in the last 24h:
- 03:14 — competitor `Shop A` listed at €1,485 `total_price` (price + shipping), ranked 1st.
- 03:14 — engine decision: undercut to €1,478 to retake 1st place. Within tolerance: floor €1,455, ceiling €1,575. Tier 1 cycle.
- 03:14 — PRI01 push submitted, PRI02 confirmed COMPLETE 03:16.

He sees competitor moved first, engine responded within tolerance, math checks out. He replies: *"Tudo certo — outro vendedor desceu para €1,485, o nosso ficou em 1.º a €1,478."*

**Climax.** Total time: 90 seconds. No founder support ticket needed.

**Resolution.** Tony shares the screen with the warehouse manager so the manager learns the workflow. Two weeks later, the manager is the one investigating audit-log questions; Tony only gets pinged when something looks structurally wrong (which is what Pedro wants to know about anyway).

**Capability requirements revealed:**
- Audit log filterable by SKU/EAN (in addition to channel and event type)
- Audit log entries include: timestamp, competitor context (price, shop name, ranking position), engine decision rationale (undercut vs ceiling raise vs hold), tolerance band (floor/ceiling), tier classification, PRI01/PRI02 lifecycle status
- **Multi-user-within-account resolution (LOCKED):** single login per customer account at MVP; multi-user/RBAC = Epic 2. The warehouse-manager case is handled by shared login, which is acceptable for Tony-scale customers (1-3 trusted ops staff). Breaks at WDMI-scale (Ricardo's group has more separation of duties), which is expected — RBAC ships in Epic 2 before that scale matters.

### Journey 5: API/Integration consumer — Closed through Epic 2

MarketPilot does NOT expose an external API at MVP or Epic 2. The product's only API consumers are internal (the repricer-worker reading from its own DB; the dashboard reading from its own DB). External integrations (e.g., customer audit-log export to BI tools, partner integrations with ERP systems beyond cooperative-absorption) are explicitly deferred.

**Capability requirements:** None at MVP or Epic 2. Reopen as Epic 3+ if customer demand emerges (specific signal: ≥2 paying customers ask for audit-log export or programmatic margin updates).

### Journey Requirements Summary

Capabilities revealed by the four active journeys, grouped by surface:

- **Onboarding & key handling:** self-served signup with email verify; single-purpose key-entry form; linked Worten-key one-pager; inline 5-second validation; encrypted vault.
- **Catalog scan:** async with progress page; closeable + reconnection; server-side job state; email on failure only.
- **Engine:** smart-default margin tolerance from one onboarding question (with <5% segment warning); tier system (4-state per FR18: T1 / T2a 15min, T2b 30-60min, T3 daily); cooperative ERP-sync; per-channel pricing; competitor ranking by `total_price`; `active=true` filter; engine decision table covering tie cases, leader-is-self, ceiling-saturation, single-channel offer, single-competitor.
- **Safety:** inbound anomaly freeze (>40%) with customer-facing review/confirm UI; outbound circuit breaker (≤20% catalog/cycle, ≤15% per-SKU); nightly reconciliation; pause = freeze (not rollback); resume single-click.
- **Dashboard:** PT/ES toggle; KPI cards using same categories as free report (SKUs in 1st, losing position, exclusive, catalog value at risk) — visually consistent family, not identical UI; margin editor with live worked-profit-example using customer's own SKU; audit log filterable by channel/SKU/event type with rich entry detail (competitor context, engine rationale, tolerance band, tier, PRI01/PRI02 status); Portuguese-localized banner for sustained transient issues; big single-click pause/resume.
- **Go-Live & billing:** dry-run by default with no time limit; informed-consent Go-Live modal; Stripe subscription on flip; Moloni manual invoicing flow.
- **Operations (founder-side):** /health endpoint + UptimeRobot 5-min pings; internal founder monitoring dashboard; 3-tier failure model; critical alerts via Resend; rollback playbook; solo-founder continuity runbook; day-3/day-7 pulse-check protocol.
- **Multi-user within customer account (LOCKED):** single login at MVP; multi-user/RBAC = Epic 2.
- **External API (LOCKED):** N/A at MVP and Epic 2; reopen Epic 3+ on customer demand signal.

#### Scope notes from journey mapping

- **Refurbished products on Worten are structurally out of scope** at MVP and Epic 2. Worten has no shared EAN catalog for seller-created refurbished listings, so P11 returns no comparable competitor offers and the engine would classify them Tier 3 (no competitors) forever. WDMI's catalog is in-scope for its new commodity electronics portion only. Other refurbished-heavy sellers face the same structural ceiling. Add to MVP scope exclusions when revisited; not unlockable in Epic 2.

## Domain-Specific Requirements

The product domain is e-commerce / marketplace tooling — not present in the standard domain taxonomy. There is no regulator approval gate (unlike fintech KYC/AML or healthcare FDA), no real-time-safety-critical path, and no payment-processing-of-customer-funds (Stripe handles billing; MarketPilot never custodies customer money or sees card data). The real complexity sits in trust architecture, integration with Mirakl, PT/ES B2B legal gates, and pricing-agency liability — captured below.

### Compliance & Regulatory

- **GDPR (EU customer scope).** All customer data and operator personal data hosted on Supabase Cloud EU region. Data Processing Agreement (DPA) template required for B2B procurement-conscious customers (brief §15 pre-revenue legal gate). Standard GDPR rights (access, deletion, portability, breach-notification) honored at the customer-account level.
- **PT NIF/IVA invoicing.** PT and ES B2B SMEs require legally compliant invoices with their NIF — Stripe receipts alone are insufficient. Moloni manual invoicing at MVP (founder-generated per Stripe payment, ~5-10 min/customer/month). Moloni API integration triggers Epic 2 when aggregate founder time exceeds 2-3 hr/month.
- **Pricing-agency Terms of Service.** ToS must explicitly cover automated price-setting agency on the customer's behalf. The free-report ToS does NOT cover this scope (brief §15) and must be replaced before first invoice. This is the legal counterpart to the informed-consent Go-Live modal: documented consent + customer self-flip + audit log together establish customer authorization, not founder authorization.
- **Refund policy.** First-month money-back guarantee within 14 days of Go-Live, no questions asked. Stated explicitly in ToS. Internal framing: €50 risk per refund is a first-cohort trust-building investment; tighten policy in Epic 2 once retention data exists. Aligns with dry-run-by-default product posture (customer can validate before paying for active repricing) and with the 24h post-Go-Live active monitoring + day-3/day-7 pulse-check protocol (gives customer time to validate the tool delivers before the 14-day window closes).
- **Worten/Mirakl operator ToS compatibility.** Confirm automated repricing via shop API key is consistent with Worten's seller agreement. UNVERIFIED — flagged in brief §15 as a potential hidden blocker. Pre-revenue legal review (fixed-fee, post-build, pre-Go-Live) must include this check.
- **Out of scope by design.** No PCI-DSS (Stripe handles all card data; we never see PANs). No KYC/AML (we don't custody customer funds; Stripe → customer Moloni invoice is the cash path). No healthcare/government/aerospace regulators apply.

### Technical Constraints

- **Encryption-at-rest for `shop_api_key` is non-negotiable** (CLAUDE.md mandate, brief §6). KMS specification — key custody, rotation policy, recovery on Supabase incident — deferred to ARCH (Winston). Hard requirement: zero plaintext API keys at rest, verified pre-launch via security review and ongoing via DB-dump scans.
- **Multi-tenancy from day 1 via Supabase RLS.** Two principals exist on Day 1 (founder admin + first customer). Single-tenant deployment was considered and rejected (brief §6) because refactor would happen within a month anyway. RLS policies enforced for all customer-scoped tables; cross-tenant data access prohibited at the database level, not just the application layer.
- **Audit log as legal/trust artifact, not logging table.** Per-customer-per-channel. Every action recorded with: timestamp, competitor context (price, shop name, ranking position), engine decision rationale, tolerance band, tier classification, PRI01/PRI02 lifecycle status, event-type tag (including external-change-absorbed and circuit-breaker-trip distinctly). Customer-readable; filterable by channel/SKU/event type. The granular log is complete (every action recorded, append-only per NFR-S6); presentation is hierarchically summarized per FR38b–d to remain usable at production event volumes (~3M entries/quarter on a 50k-SKU contested catalog). Trust property and UX presentation are independent: the log itself is complete, the UI just doesn't drown the customer in noise by default.
- **Audit log retention.** Retained for the lifetime of the customer account. Upon termination, GDPR Article 17 right-to-be-forgotten applies with exceptions only for records that doubled as fiscal evidence (price-change events themselves are operational, not fiscal — Stripe receipts and Moloni invoices are the separate fiscal records that have their own statutory retention). Statutory retention re-evaluated by legal review post-revenue.
- **Performance targets** (extracted in Success Criteria, restated here for domain context): Tier 1 / Tier 2a cycle latency p95 ≤ 18 min; PRI01 → PRI02 resolution within 30 min; ≥99% /health uptime; ≤5 min critical alert delivery; catalog scan scales to 50k SKUs.
- **Async-everywhere posture.** PRI01 is async (write submitted; PRI02 polled until COMPLETE/FAILED). Catalog scan is async (server-side job state, customer can disconnect/reconnect). Cron cycles are independent. There is no synchronous customer-facing operation that blocks on Mirakl beyond key validation (5-second test P11 call).
- **No real-time-safety-critical path.** Outages and latency spikes have a graceful-degradation profile (banner + alert + freeze + manual unblock). No customer harm occurs from a 30-minute outage. This is a deliberate scope-discipline ceiling: any feature that would create a real-time-safety-critical path (e.g., synchronous price-matching during checkout) is out of scope.

### Integration Requirements

- **Mirakl Marketplace Platform (MMP) — direct shop API key per marketplace.** No MiraklConnect dependency. P11 (read competitor offers), PRI01 (write price update via multipart CSV), PRI02 (poll import status), OF21 (read own catalog). NEVER OF24 — full-offer write that resets unspecified fields. Mirakl MCP is the single source of truth for endpoint behavior, field names, pagination, error codes; verify before any assumption-lock (CLAUDE.md mandate, applies to all agents including BAD subagents).
- **Stripe** (subscription billing). Recurring monthly €50/marketplace. MarketPilot stores Stripe customer IDs and subscription IDs only; no card data. Subscription state webhook drives cron live/paused state.
- **Moloni** (PT-compliant invoicing). MVP: manual invoice generation by founder per Stripe payment. Epic 2: API integration triggered at 2-3 hr/month aggregate founder time threshold.
- **Resend** (transactional email). Free tier 3k emails/mo. Used for critical-tier alerts only at MVP (auth invalid, sustained outage, anomaly freeze, circuit breaker trip). Day-1 customer-success outreach is founder-direct, not Resend-templated.
- **UptimeRobot** (cron health monitoring). Free tier. /health endpoint pinged every 5 min; failure → founder email.
- **Supabase Cloud (EU region)** for Auth, RLS, Postgres. Crosses an org boundary from the Hetzner-hosted application (brief §13) — needs ToS/Privacy reflection and DPA review.
- **DynamicPriceIdea repo** (cross-repo). Free-report CTA wiring funnels prospects directly to MarketPilot account creation. Already-shipped P11 and Mirakl API code in that repo serves as a reference implementation for repricer integration work.

### Risk Mitigations

| Risk | Mitigation |
|---|---|
| `shop_api_key` exposure (full account access incl. bank/IBAN) | Encrypted-at-rest vault; KMS spec from ARCH; founder never sees cleartext; single-purpose key-entry form; RLS multi-tenant isolation; pause = single-click freeze |
| Engine bug pushes out-of-tolerance prices | Per-SKU floor/ceiling clamping at engine output; outbound circuit breaker (≤20% catalog/cycle, ≤15% per-SKU); dry-run by default; informed-consent Go-Live modal; full audit log |
| Customer ERP cascade (mass-price misconfiguration absorbed by cooperative model) | Outbound circuit breaker halts cascade; inbound anomaly freeze (>40% deviation) catches per-SKU outliers; audit log preserves forensic trail; pause = freeze (not rollback) lets customer manually correct |
| Mirakl outage or rate-limit hit | 3-tier failure model (transient retry → per-SKU operational log → critical alert+banner); customer-facing banner for sustained transient issues; rate-limit pacing per ARCH (UNVERIFIED — MCP verification mandatory before scale-claim locks) |
| Worten operator ToS forbids automated repricing via shop_api_key | Pre-revenue fixed-fee legal review covers this; gate blocks first invoice (NOT MVP build) |
| Solo-founder single point of failure (laptop loss, hospitalization, extended absence) | 1-page continuity runbook drafted before customer #1; documented response procedures; founder accessibility as trust wedge survives only with deliberate hire selection in growth phase |
| First-customer trust failure (audit log not consumed, "I don't know what the tool did") | Day-1 active monitoring + 2-hour SLA + day-3/day-7 pulse checks; first-dashboard view uses same KPI categories as free report for product-family continuity; worked-profit-example margin editor builds intuition pre-Go-Live |
| PRI01 partial-success / EAN mismatch / pricing-import failures | 3-tier failure model with per-SKU operational logging; retry on next cycle; failures surfaced in audit log; persistent failures (>3 cycles) escalate to dashboard banner |
| Mirakl-API behavior assumed but unverified (channel codes, rate limits, parity rules, all_prices shape, active-flag reliability) | CLAUDE.md mandate: ALL Mirakl behavior verified via Mirakl MCP before architecture lock; ARCH (Winston) carries explicit open-questions list from brief §16 |

### Mirakl Integration Patterns (Product-Domain-Specific)

These are domain-specific *to this product*, not domain-specific to a regulated industry. They constrain every Mirakl-touching feature.

- **Always verify via MCP before assumption-locking.** Endpoint names, field names, pagination, error codes, rate limits, channel codes, partial-success semantics, parity rules, `all_prices` shape, `active` flag reliability — none assumed from training data. CLAUDE.md mandate applies to all agents (PM, ARCH, dev, code-review).
- **P11 returns ranked competitor list, not just best price.** Filter `active=true`. Rank by `total_price` (price + shipping), not `price` — Worten ranks by `total_price`, and shipping varies per shop. Comparing only `price` gets rank wrong.
- **PRI01 is async; PRI02 polling is mandatory.** A successful PRI01 response means *accepted for processing*, not *applied*. `last_set_price` only updates after PRI02 confirms COMPLETE — otherwise our own pending push looks like an external change in the next cycle and triggers a spurious cooperative-absorption.
- **OF24 is forbidden for price updates.** OF24 (`POST /api/offers`) resets ALL unspecified offer fields (quantity, description, leadtime, etc.) to defaults. Price-only-safe path is PRI01 exclusively. Confirmed footgun in the brief and reinforced in CLAUDE.md.
- **Single `shop_api_key` per marketplace, full account access.** No read-only mode. Customer can revoke only by contacting Worten operator support — there is no in-Mirakl key-management UI for sellers. This is the fundamental trust constraint that makes encrypted-at-rest non-negotiable.
- **Per-channel data model is structural, not optional.** Worten PT and Worten ES are different channels under one shop API key. P11 returns per-channel `total_price` via the `all_prices` array (shape UNVERIFIED — ARCH MCP question). `list_price`, `last_set_price`, `current_price`, baseline are all per-SKU per-channel.
- **Channel codes are operator-specific and unverified.** `WRT_PT_ONLINE`, `WRT_ES_ONLINE` are assumed for Worten; ARCH must confirm via MCP. Other Mirakl operators (Phone House ES, Carrefour ES, PCComponentes, MediaMarkt) have their own channel-code conventions discovered per integration in Epic 2.
- **Per-customer cadence ceiling implied by Mirakl rate limits (open ARCH question).** What's the largest catalog size where 15-min Tier 1 / Tier 2a cadence stays within Mirakl's rate-limit budget? For 100k+ SKU customers (e.g., Twomii @ 100k+ SKUs), the default 15-min cadence on contested + recently-won SKUs may need to relax. Resolution may require Tier 1/2a cadence becoming customer-config-driven (or catalog-size-driven) rather than globally hardcoded — supported architecturally by the per-SKU `tier_cadence_minutes` column (see Functional Requirements §C). ARCH must verify Mirakl rate limits via MCP and derive the per-customer pacing budget before the cadence default values lock.

## Innovation & Novel Patterns

### Detected Innovation Areas

#### Primary: Cooperative ERP-sync as inverted pricing-authority model

Every competitor in the segment (Boardfy, Boostmyshop, Repricer.com, Omnia, Amazon-first repricers bundled with Mirakl coverage) presents itself to the customer as **authoritative** for prices. Customers are instructed to disable other tools, stop manual edits, and route all price intent through the repricer's UI. The repricer "owns" pricing.

MarketPilot inverts this: **the customer's ERP (or manual editor, or another tool) is authoritative for pricing intent; the repricer only optimizes within tolerance bands derived from whatever pricing intent currently exists.** When an external entity changes the price between cycles, MarketPilot reads the change as a SIGNAL of new pricing intent and absorbs it as the new `list_price` baseline rather than overwriting it.

This is not a feature. It is a different conceptual frame for what a repricer is *for*. The customer's existing systems remain authoritative; MarketPilot is a layer of optimization on top, not a replacement underneath.

The implementation mechanic is concrete:
- Store `last_set_price` per SKU per channel (only updated after PRI02 confirms COMPLETE).
- Each cycle, compare `current_price` (read from P11) against `last_set_price`.
- If `current_price ≠ last_set_price` → external change occurred → update `list_price = current_price`, recompute floor/ceiling, continue normal repricing.

The conceptual claim ("seller's ERP knows the real list price; our anchor should follow theirs") is the innovation. The mechanic is the proof.

#### Secondary: Trust step-up funnel architecture

A free product (the DynamicPriceIdea opportunity report) deliberately stores **no API key** — try-without-trust. Customers grant the report only their Worten public-listing data, which is non-sensitive. The paid product (this repricer) requires the full-account-access shop API key — pay-with-trust. The customer step-UPS their trust granting as they move through the funnel: from zero (read public listings) to high (full-account API key encrypted in vault).

This funnel design uses **two distinct products** with deliberately different trust requirements, where the lower-trust product validates the value proposition before the higher-trust commitment is asked. Most B2B SaaS funnels operate with one product (demo-then-pay, freemium-then-paid, free-trial-then-paid); a two-product trust step-up is a less common shape in the segment.

The dashboard surfaces the same KPI categories the free report introduced (SKUs in 1st, losing position, exclusive, catalog value at risk), in a visually consistent family — a customer who saw the report recognizes the dashboard as the same product line, but the two UIs are not identical (dashboard is fully interactive multi-tenant operational UI; report is a static branded artifact). This continuity of trust signal across the step-up reduces friction without overclaiming visual identity.

### Market Context & Competitive Landscape

Cooperative ERP-sync was not found in any segment competitor's documented mechanics:
- **Boardfy** — CMS-oriented (Magento, Shopify, Prestashop), mid-market, sticker-priced. No documented ERP-cooperative model; standard "repricer is authoritative" customer-facing posture.
- **Boostmyshop myPricing** — French, MiraklConnect-dependent, rule-based strategies. Documented strategies (buybox, margin, loss-leader) all assume the repricer is the authoritative source of pricing decisions.
- **Omnia Retail** — Dutch enterprise (€10k+/yr). SME-inaccessible.
- **Generic Amazon repricers** (Repricer.com, Informed, BQool) — Capterra reviews flag tools "showing 'buybox won' when not won," "silent stalls for weeks" — symptoms consistent with a repricer that has lost sync with the actual pricing state on the platform, *because* it assumes authority and the platform reality has drifted from its model.

(Caveat: this assessment is based on competitors' customer-facing documentation and review patterns, not on internal architecture. Their internals could implement absorption-style logic privately; what is novel for MarketPilot is making this the explicit, customer-visible pricing posture.)

Trust step-up funnel: no documented analog in the B2B repricing segment. Free reports DO exist in marketing-automation and SEO-tooling segments, but as marketing artifacts rather than as the *first product* in a deliberate two-product funnel.

### Validation Approach

#### Cooperative ERP-sync validation

The mechanic is unproven across the customer cohort but **the FIRST proof point is achievable in dogfood pre-customer**. Validation chain:

1. **Dogfood against Gabriel's live Mirakl Worten sync (15-min cadence, real catalog)** — production-grade testbed available before customer #1. Gabriel's own system writes prices on a 15-min cadence, exactly simulating the ERP-overwrite scenario the cooperative model is designed for. Anomaly-freeze and circuit-breaker thresholds tuned against Gabriel's real traffic; Tier 1 / Tier 2a / Tier 2b / Tier 3 transitions exercised with real `last_won_at` values; cadence math validated under the per-SKU `tier_cadence_minutes` model.
2. **Dry-run mode by default for customer #1+** — customer runs the engine in simulation for 7-14 days before Go-Live. Audit log shows every external-change-absorbed event tagged distinctly. Customer reviews and validates absorption matches their pricing intent before paying.
3. **Day-1 founder active-monitoring** — Pedro tails first customer's audit log for 24h post-Go-Live; manually reviews every external-change-absorbed event week 1.
4. **Inbound anomaly freeze (>40% deviation)** — catches catastrophic ERP errors that absorption alone wouldn't catch (clearance corrections gone wrong, decimal-point bugs).
5. **Outbound circuit breaker (≤20% catalog/cycle, ≤15% per-SKU move)** — catches cascade failures where the cooperative model has chained absorptions into runaway repricing.
6. **First-90-day metric** — zero customer complaints of "the tool fights my ERP" AND non-zero external-change-absorbed events per active customer (confirms mechanic is firing, not silent).

The "production-confident across the cohort" bar is reached when the first 3 customers complete 90 days with the cooperative-absorption model handling their natural ERP traffic without manual intervention beyond confirming/rejecting anomaly-freeze events. The first proof point — dogfood validation against Gabriel — is achievable BEFORE customer #1, not contingent on real-world traffic.

#### Trust step-up funnel validation

Already partially validated: the free report is in production, engaging warm leads. What remains unproven is whether trust step-up converts — does a customer who trusted us with public-listing data actually grant full-account access?

- Hypothesis metrics from Step 3 Success Criteria: ≥10% CTA → key-entry, ≥30% key-validate → Go-Live within 14 days. **No baseline data; revisit after first 5-10 customers.**
- Plan B at week 6 post-MVP if funnel underperforms: restart cold outreach + LinkedIn/ACEPI/Adigital/Worten-forum inbound. Cold outreach already validated as a path (~30 leads tracked from cold sourcing in OUTREACH.md).

### Risk Mitigation

#### Cooperative ERP-sync risks

- **Risk: slow-drift erosion.** Customer's costs rise 15% over months; ERP `list_price` stays static; cooperative model has nothing to absorb but the floor erodes margin slowly. Brief §4 acknowledges this. **MVP mitigation:** every external-change-absorbed event is classified "notável" per FR38d and surfaced in the default-visible "Eventos notáveis" feed (FR38b surface 3) — customer doesn't need to dig through firehose to spot drift. **Epic 2:** customer-tunable anomaly threshold + drift detection.
- **Risk: deliberate flash-sale absorbed as new baseline.** Customer runs €80-for-24h promo on a normally-€100 SKU; tool absorbs €80 as new `list_price`, then undercuts further. **MVP mitigation:** customer's only lever is whole-tool pause. **Epic 2:** per-SKU exclude / promo-mode toggle.
- **Risk: race condition between our pending PRI01 push and concurrent external change.** Mitigation: `last_set_price` only updates after PRI02 confirms COMPLETE. Avoids treating our own pending push as an external change.
- **Fallback if cooperative model is fundamentally wrong:** the engine still has per-SKU floor/ceiling clamping derived from `list_price` × tolerance; if the absorption proves catastrophic, falling back to "snapshot at signup, never absorb" is a one-line config change at the engine layer. Tested implicitly: dry-run period validates absorption is working before Go-Live.

#### Trust step-up funnel risks

- **Risk: free-report users don't convert to paid because trust step-up is too steep.** Mitigation: 14-day money-back guarantee post-Go-Live; dry-run mode lets customer validate before paying; dashboard uses same KPI categories as free report for product-family recognition.
- **Fallback: cold outreach playbook (already validated in OUTREACH.md)** + alternate inbound channels (LinkedIn, ACEPI/Adigital, Worten seller forums). Plan B trigger at week 6 post-MVP with zero conversions.

## SaaS B2B Specific Requirements

### Project-Type Overview

MarketPilot Repricer is a multi-tenant SaaS where customer accounts have hard data-isolation boundaries (Supabase RLS), a flat per-marketplace subscription model (no tiered feature gates), and a deliberately small permission surface (single login per customer account at MVP, founder admin separate). Integrations to Mirakl/Stripe/Moloni/Resend/Supabase/UptimeRobot are documented in §Integration Requirements (Step 5); compliance posture is documented in §Compliance & Regulatory (Step 5). This section adds the specifics not covered elsewhere: tenancy model, RBAC matrix, subscription mechanics, and implementation topology.

### Technical Architecture Considerations

#### Tenant Model

- **Two principal types from day 1:** customer (paying account) and founder admin (Pedro). No third principal at MVP (no support staff, no billing-only role).
- **Tenancy scope:** customer-account = tenant boundary. Each customer's data (API keys, catalog snapshot, audit log, baseline, pricing state, Stripe customer ID, Moloni invoice references) lives behind RLS policies keyed on `customer_id`.
- **RLS enforcement:** at the database layer, NOT just the application layer. Even a misconfigured Fastify route cannot leak cross-tenant data because Postgres rejects the query. Verified pre-launch via deliberate cross-tenant access tests.
- **Founder admin access:** server-side service-role key bypasses RLS for operational queries (audit-log tail across all customers, support investigation). Service-role key never exposed to client; only used by repricer-worker and operator-only admin endpoints. Founder NEVER logs in as a customer impersonator at MVP — operations are read-only via the founder monitoring dashboard.
- **Multi-marketplace per customer:** one customer account can hold multiple marketplaces (e.g., Tony's 5 Mirakl accounts). Each marketplace is a row under the customer; per-marketplace shop_api_key encrypted independently. Subscription billing scales per marketplace (€50 × N).
- **Single-tenant deployment was rejected** (brief §6) because the refactor cost would arrive within a month of shipping. Multi-tenant is a day-1 cost paid once, not a future migration.
- **Account deletion / GDPR Article 17 workflow:** on customer cancellation + Article 17 request, the workflow wipes encrypted shop API key, audit log entries (with fiscal-evidence exceptions retained per ToS), Stripe customer/subscription references, and catalog/baseline/pricing-state data. Moloni invoice metadata is retained because invoices doubled as fiscal records (statutory retention). Implementation details deferred to ARCH; PRD-level commitment is that the workflow exists, is easily discoverable, and prevents accidental destructive action via multi-step confirm + 7-day soft-delete grace period before irreversible deletion (full spec in FR4).

#### RBAC Matrix (locked in Step 4 Journey 4)

| Role | Scope | At MVP | At Epic 2 |
|---|---|---|---|
| Customer (single login per account) | Full access to own customer-account data | Yes | Promoted to "owner" |
| Customer team member | Read/edit access scoped per-role | N/A — shared owner login | Yes (RBAC: owner / operator / viewer) |
| Founder admin | Cross-tenant operational read; never edit customer data without explicit request | Yes (read-only via monitoring dashboard) | Same |
| Support staff | Cross-tenant read scoped to flagged tickets | N/A — founder is support | Likely added when team grows |

The **single-login-per-customer-account** decision means a customer with multiple staff (e.g., Tony + warehouse manager from Journey 4) shares credentials. Acceptable for Tony-scale (1-3 trusted ops staff) and the MVP cohort. Breaks at WDMI-scale (Ricardo's group has more separation of duties); RBAC ships in Epic 2 before that scale matters.

#### Subscription Tier Model

- **No tiers at MVP.** Single SKU: €50 per marketplace per month. A multi-marketplace customer pays €50 × N (e.g., Tony's 5 Mirakl marketplaces = €250/mo). No setup fee. No annual discount at MVP.
- **Why no tiers:** every Capterra complaint about competitors flagged revenue-based fees, hidden add-ons, per-feature gates as a friction source. Flat-fee transparency is a deliberate counter-position; introducing tiers at MVP would erode that positioning. **Tiering is not in Epic 2 either** — re-evaluate only after €5k+ MRR if customer demand for power-user features exceeds what the flat model supports.
- **Billing mechanics:** Stripe handles recurring monthly subscription (auto-renew). Subscription state webhook drives `cron_active` flag per customer-marketplace. Stripe customer creation happens at Go-Live click (NOT at signup) — no Stripe customer exists for free-trial dry-run users.
- **3-month minimum prepaid: OPEN DECISION** (brief §1). Recommended in brief but not yet locked. Decide after re-engaging warm leads. Without it, churn risk in months 1-2 is real for SME B2B at €50/mo. Resolve in pre-revenue cycle, not in MVP build.
- **Refund policy:** first-month money-back guarantee within 14 days of Go-Live, no questions asked (per Step 5 Compliance subsection). €50 risk per refund as a first-cohort trust-building investment; tighten in Epic 2 once retention data exists.
- **Failed-payment handling:** Stripe-managed dunning at MVP (Stripe Smart Retries, default email cadence). On final-failure, subscription auto-cancels; cron flips paused; customer's prices remain at last-set state. Customer can re-enter card details and resume manually. Not over-engineered for MVP scale.
- **Marketplace add/remove (MVP = concierge, Epic 2 = self-serve).** MVP: single marketplace only (Worten — both PT and ES channels count as one Mirakl shop). Additional marketplaces handled concierge by founder per FR41 (MVP). No "Add Marketplace" UI in the customer dashboard at MVP. Epic 2 ships self-serve add/remove via dashboard with Stripe proration on add, end-of-cycle removal, no mid-cycle refund (FR41 Epic 2). ARCH should plan Stripe + Moloni mechanics so the concierge → self-serve transition is data-compatible (no schema migration when self-serve UI ships).

#### Integration List

Documented in §Integration Requirements (Step 5). Summary pointer: Mirakl MMP (P11/PRI01/PRI02/OF21, never OF24), Stripe (subscription billing), Moloni (manual invoicing at MVP, API at Epic 2), Resend (critical alerts only), UptimeRobot (cron health), Supabase Cloud EU (Auth + RLS + Postgres), DynamicPriceIdea repo (cross-repo CTA wiring + reference Mirakl integration code).

#### Compliance Requirements

Documented in §Compliance & Regulatory (Step 5). Summary pointer: GDPR (EU customer scope), PT NIF/IVA invoicing (Moloni), pricing-agency ToS update, refund policy, Worten/Mirakl operator ToS compatibility check (UNVERIFIED), DPA template for B2B procurement-conscious customers. Out of scope by design: PCI-DSS, KYC/AML.

### Implementation Considerations

- **Deployment topology** (brief §13): `app.marketpilot.pt` Fastify + UI on Hetzner via Coolify; internal `repricer-worker` cron service (no public URL) on same Hetzner; Postgres + Auth + RLS on Supabase Cloud EU region. Crosses an org boundary (customer Mirakl keys live at Supabase, not on Hetzner) — flagged for ToS/Privacy and DPA review.
- **No monorepo at MVP.** If shared logic emerges (Mirakl P11 client wrapper, pricing math), extract a small npm package — don't preempt the abstraction.
- **Stack:** Node.js >=22, Fastify, Postgres. Reusable code identified from `D:\Plannae Project\DynamicPriceIdea` (Mirakl P11 + API patterns, in production) and `D:\Plannae Project\Gabriel - Marketplace` (OAuth2 token mgmt, pricing engine math, price-submission batching).
- **Scale boundaries at MVP:** designed for 5-10 concurrent customer accounts, each with up to 50k SKU catalogs, 1-5 marketplaces. Sizing assumptions: catalog scan ~10 concurrent calls × 200ms (UNVERIFIED — ARCH MCP), Tier 1 / Tier 2a cycle on 50k SKUs within 15 min nominal cadence. If first-cohort customers exceed these (e.g., Twomii @ 100k+ SKUs), revisit pacing in ARCH before onboarding them.
- **State persistence:** all customer-account state in Supabase Postgres. No application-layer state that could be lost on restart. Async catalog scan persists `customer_id → job_state` server-side for reconnection.
- **Observability:** /health endpoint pinged by UptimeRobot (5-min); founder monitoring dashboard tails audit-log + uptime + circuit-breaker state cross-customer; Resend delivery logs for critical alerts. No customer-facing observability (e.g., status page) at MVP — Plan B if the founder-facing channel is insufficient.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach: Hybrid problem-solving + revenue MVP, explicitly NOT a platform MVP.** Two distinct goals run in parallel:

1. **Validate the cooperative-ERP-sync mechanic in production.** The mechanic is the highest-novelty piece of the engine and unproven in the segment. Cooperative-absorption gets meaningful production validation during dogfood against Gabriel's live Mirakl Worten sync (15-min cadence — simulates the ERP-overwrite scenario the cooperative model is designed for, since Gabriel's own system writes prices on the same cadence and the engine must absorb those as new `list_price` baselines). Customer #1+ extends validation across multiple ERP behaviors; 3 customers × 90 days reaches the "production-confident across the cohort" bar, but the FIRST proof point is achievable in dogfood pre-customer — anomaly-freeze and circuit-breaker thresholds can be tuned against Gabriel's real traffic before any customer sees the engine.
2. **Generate first revenue from named warm leads within 6-8 weeks of MVP completion** (revenue MVP). The free-report → repricer funnel and the 30-lead OUTREACH.md pipeline are concrete first-customer paths. A "build-it-and-they-will-come" approach was considered and rejected — the cohort is ~30 named SME leads, not an addressable market reachable via paid ads at this stage.

Explicitly NOT a platform MVP: no tier proliferation, no partner-integration APIs, no multi-marketplace expansion in Phase 1. Self-service onboarding + flat per-marketplace pricing + no tiered features are deliberate counter-positioning to competitor friction patterns; introducing platform-shape complexity at MVP would erode the wedge.

**Resource Requirements:**
- Solo founder (Pedro). Non-developer entrepreneur. Relies on AI-assisted development.
- Build budget: €100/mo Claude subscription. €0 paid marketing budget at MVP. Hetzner hosting + Coolify already running. Supabase Cloud free tier expected to cover MVP scale.
- Time budget: 2-3 weeks MVP build (founder's stated AI-assisted-dev velocity, brief §17). 6-8 weeks to first revenue including legal gates, first-customer onboarding, day-1 active monitoring.
- Skills concentration: founder owns end-to-end product, sales, customer success, founder-monitoring operations. Pre-existing Mirakl integration code (DynamicPriceIdea + Gabriel - Marketplace) reduces the highest-risk from-scratch integration work.
- Pre-revenue legal review: fixed-fee, post-build, pre-Go-Live. Funded from runway. Gates first invoice, not MVP build.

### MVP Feature Set (Phase 1)

**Core user journeys supported** (Step 4):
1. Tony @ You Get — primary seller success path (signup → key entry → scan → margin → dry-run → Go-Live → live).
2. Ricardo @ WDMI — primary seller edge case (thin margins + anomaly freeze + circuit breaker + audit-log forensics).
3. Pedro (founder admin) — Day-1 active monitoring + critical alert response.
4. Customer self-service investigation — audit log as trust deliverable.

Journey 5 (API consumer) is explicit N/A through Epic 2.

**Must-have capabilities:** documented in §Product Scope > MVP (Step 3). Summary pointer: encrypted key vault + RLS multi-tenant + Worten-key one-pager + async catalog scan + onboarding margin question + cooperative-ERP-sync engine + tier system + per-channel data + 4-layer safety architecture + dashboard (KPI cards using same categories as free report, audit log, margin editor with worked-profit-example, pause/resume) + dry-run by default + informed-consent Go-Live + Stripe + Moloni manual + 3-tier failure model + day-1 customer-success operational requirements + GDPR Art 17 deletion workflow + pre-revenue legal gates blocking first invoice.

### Post-MVP Features

#### Phase 2 (Growth) — Triggered, not scheduled

Feature list documented in §Product Scope > Growth Features (Step 3). Phase 2 features are unlocked by EITHER customer demand OR scaling pain — explicit triggers per feature:

| Phase 2 Feature | Trigger to ship |
|---|---|
| Multi-marketplace beyond Worten | First customer commits to a non-Worten Mirakl marketplace (Tony's 5-marketplace pipeline is the most likely candidate) |
| Per-channel margin overrides | Customer requests it AND has demonstrably different per-channel competitive landscape |
| Cost-CSV upload | <5% margin customer signs up AND %-tolerance proves structurally insufficient |
| Per-SKU exclude / promo mode | First customer reports a flash-sale was absorbed as new baseline (or proactively warns of upcoming promo) |
| Customer-tunable anomaly threshold | Founder receives 2+ requests OR slow-drift is observed in audit log |
| Restore-baseline UI | Customer requests rollback (data already captured at MVP scan; only UI is missing) |
| Revenue-impact reporting in € | Comparison data (a/b methodology) becomes available — likely after 3-month stable cohort |
| Moloni API integration | Founder manual-invoicing time exceeds 2-3 hr/month aggregate |
| Per-SKU manual controls | Power-user demand surfaces |
| Historical analytics / time-series | Customer requests >1× |
| Price-up candidates panel | Customer requests >1× |
| RBAC multi-user-within-account | First customer at scale where shared login breaks (likely WDMI in-scope portion) |

#### Phase 3 (Vision / Expansion) — Vaguer triggers tied to revenue and competitive context

Feature list documented in §Product Scope > Vision (Step 3). Phase 3 triggers are qualitative because they depend on cumulative MRR, founder bandwidth, and competitive context:

- **Cross-platform beyond Mirakl** (Bol.com, Real.de, etc.) — unlocked by customer demand from existing accounts for a non-Mirakl platform they also sell on, with sufficient revenue base to fund the integration work.
- **Team hire** — unlocked when revenue justifies and founder is operationally bottlenecked. Specific thresholds set when the moment arrives. Hire criteria (locked): Portuguese-speaking, named publicly — the founder-accessibility wedge survives only with deliberate selection.
- **External API (Epic 3+)** — unlocked by ≥2 paying customers requesting audit-log export or programmatic margin updates.
- **Free-report ecosystem expansion** (margin-erosion alerts, competitor-entry alerts) — unlocked by free-report engagement metrics signaling appetite for derivative report types.
- **Possible tier introduction OR separate Pro product.** If power-user demand exceeds what the flat-fee model supports, the alternative to tiering is a separate Pro product — different SKU, different pricing — that preserves the flat-fee wedge in the core product. Tiering is discretionary and carries real brand cost (it erodes the counter-positioning to revenue-based-fee competitors); a Pro product carries different tradeoffs (segmentation cost, support split) but keeps the core wedge intact. Decision deferred to whenever the demand surfaces.

### Risk Mitigation Strategy

**Technical Risks:**
- *Cooperative-ERP-sync mechanic fails in production* — 4-layer safety architecture (tier system + outbound circuit breaker + nightly reconciliation + inbound anomaly freeze) catches it. Fallback: one-line config change to "snapshot at signup, never absorb" if absorption proves catastrophic. **Pre-customer validation: dogfood against Gabriel's live Mirakl Worten sync (15-min cadence, real catalog) provides production-grade validation of the absorption mechanic before customer #1.** Customer-side validation extends through dry-run mode + day-1 founder monitoring.
- *Mirakl API behavior assumed but unverified (rate limits, channel codes, parity rules, all_prices shape, active flag)* — CLAUDE.md mandate + Mirakl MCP verification before architecture lock. ARCH (Winston) carries explicit open-questions list (brief §16). Rate-limit pacing baked into design pre-launch, not discovered in production.
- *KMS key custody on Supabase incident* — ARCH spec mandatory. Key rotation policy + recovery procedure documented before customer #1.
- *PRI01 partial-success / EAN mismatch / pricing-import failures* — 3-tier failure model with per-SKU operational logging; persistent failures (>3 cycles) escalate to dashboard banner.

**Market Risks:**
- *Free-report → repricer funnel doesn't convert* — Plan B trigger at week 6 post-MVP (cold outreach restart + LinkedIn/ACEPI/Adigital/Worten-forum inbound). 30 named warm leads in OUTREACH.md provide a non-funnel path to first customer.
- *Worten/Mirakl operator ToS forbids automated repricing via shop API key* — pre-revenue fixed-fee legal review covers this. Gate blocks first invoice (NOT MVP build), giving early warning before customer commits cash.
- *Trust step-up funnel proves too steep* — 14-day money-back guarantee post-Go-Live; dry-run mode lets customer validate before paying; dashboard uses same KPI categories as free report for product-family recognition; founder accessibility (named, reachable, Portuguese-speaking) lowers trust friction.
- *Churn red-flag in months 1-2 forces retention decision* — 3-month minimum prepaid (currently OPEN — decide post-warm-lead-re-engagement, before customer #1 not before MVP build).

**Resource Risks:**
- *Solo-founder single point of failure* — 1-page continuity runbook drafted before customer #1 (laptop loss, hospitalization, extended absence). Pre-existing Mirakl code from DynamicPriceIdea + Gabriel project reduces from-scratch integration risk.
- *AI-assisted dev velocity overestimates compress-ratio on integration surface* — scope discipline. Brief §17's velocity caveat is explicit: well-scoped features compress, integration-heavy work less so. Build sequencing should front-load PRI01 first-time live debugging + KMS work + multi-tenant RLS testing — the items that compress least.
- *Cash-runway constraint on legal review timing* — pre-revenue legal review is fixed-fee (not retainer); post-build pre-Go-Live timing means review cost is incurred only after MVP ships, allowing founder to gauge progress before spending.

## Functional Requirements

This section defines the binding capability contract for MarketPilot Repricer. Every capability listed is testable, implementation-agnostic, and traces back to the discovery work in §Executive Summary, §Success Criteria, §User Journeys, §Domain-Specific Requirements, §Innovation, and §SaaS B2B Specific Requirements. UX, ARCH, and epic breakdown will design, support, and implement only what is listed here. Operational quality attributes for founder-facing commitments (rollback playbook, continuity runbook, Day-1 monitoring protocol) are documented in §Non-Functional Requirements as operational quality attributes rather than as system FRs.

### A. Account & Identity

- **FR1:** Customers can self-serve signup with email and password, completing email verification before accessing the application.
- **FR2:** Customers can authenticate to a single login per customer account at MVP; multi-user RBAC within a customer account is reserved for Epic 2.
- **FR3:** Customers can reset their password via an email-verified flow.
- **FR4:** Customers can request account deletion via an easily-discoverable mechanism in settings. Deletion is multi-step to prevent accidental destructive action: (1) customer initiates from settings; (2) modal requires customer to type a confirmation phrase (e.g., `ELIMINAR`) before the destructive intent is accepted; (3) account enters a 7-day soft-delete grace period during which it is suspended — cron paused, dashboard locked, data retained — but the customer can cancel the deletion and restore access; (4) at grace-period end, the system executes the GDPR Article 17 workflow, wiping encrypted shop API key, audit log entries (excluding fiscal-evidence exceptions per ToS), Stripe customer/subscription references, and catalog/baseline/pricing-state data, while retaining Moloni invoice metadata as fiscal record. Customer receives email confirmation at initiation + grace-period reminder at day 5 + final-deletion confirmation at execution.
- **FR5:** The system maintains tenant data-isolation at the database layer (RLS), preventing any cross-customer data access through application code, even on misconfigured routes.
- **FR6:** Founder admin can perform read-only operational queries across customer tenants without editing customer data through normal product flows.
- **FR7:** The signup form accepts and persists optional source-context query parameters (e.g., `?source=free_report&campaign=tony_august`) against the customer record for downstream funnel-attribution analysis. This wires the cross-repo handoff from the DynamicPriceIdea free-report CTA.

### B. API Key & Catalog Onboarding

- **FR8:** Customers can paste a single Worten Mirakl shop API key into a single-purpose entry form during onboarding.
- **FR9:** The system validates the customer's API key inline within 5 seconds by performing a known-good Mirakl P11 call against a reference EAN, with inline error feedback on validation failure.
- **FR10:** Customers can access a one-page guide ("How to find your Worten Marketplace API key") linked from the key-entry form, walking them through Worten Seller Center to API key generation.
- **FR11:** The system stores the customer's API key encrypted at rest; the founder cannot view cleartext key material, and the application never logs cleartext key material.
- **FR12:** Upon successful key validation, the system kicks off an asynchronous catalog scan that reads the customer's Mirakl catalog and snapshots the baseline pricing state per SKU per channel.
- **FR13:** Customers can monitor the catalog scan progress via a closeable progress page, disconnecting and reconnecting without disrupting the scan.
- **FR14:** The system persists scan job state server-side, allowing reconnection after disconnect without restarting the scan.
- **FR15:** The system emails the customer on scan failure or critical scan issues; healthy scan completion does NOT trigger email (customer logs back in to find the populated dashboard).
- **FR16:** Customers can answer a single onboarding margin question (margin bands: <5%, 5-10%, 10-15%, 15%+) that drives the smart default `max_discount_pct` (0.5% / 1% / 2% / 3%) and global `max_increase_pct` default of 5%; the form displays a warning for the <5% band recommending extended dry-run and noting that cost-CSV control is reserved for Epic 2.

### C. Pricing Engine

- **FR17:** The engine maintains per-SKU per-channel pricing state including `list_price`, `last_set_price`, `current_price`, baseline snapshot, tier classification, `last_won_at` (nullable timestamp of the most recent transition into 1st place), and `tier_cadence_minutes` (per-SKU cycle cadence in minutes, derived from tier classification).
- **FR18:** The engine classifies each SKU into one of four tier states and assigns a per-SKU cadence accordingly:
  - **Tier 1** (contested, position > 1) — cadence: 15 min.
  - **Tier 2a** (winning, position = 1, `last_won_at < 4h` ago — recently won) — cadence: 15 min, watched as closely as Tier 1 because active-repricer markets like Worten can undercut us within minutes of taking 1st place.
  - **Tier 2b** (winning, position = 1, `last_won_at ≥ 4h` ago — stable winner) — cadence: 30-60 min.
  - **Tier 3** (no competitors found) — cadence: daily; the daily pass also serves as nightly reconciliation.

  Cycle scheduling is implemented as a SINGLE cron polling every 5 minutes that selects SKUs where `last_checked_at + tier_cadence_minutes < now()`. This pattern is cleaner than per-tier crons and supports per-customer cadence customization in Epic 2 (Schedule controls feature) without architectural rework. The 4h threshold and 30-60 min Tier 2b cadence are starting defaults, calibratable downstream during dogfood or first-customer observation; Tier 1 / Tier 2a cadence may also need to relax for 100k+ SKU catalogs subject to Mirakl rate-limit budget (open ARCH question — see §Mirakl Integration Patterns).

  > **Failure scenario the 4-state tier system addresses (illustration):** The original 3-state system (RESEARCH.md) implicitly assumed competitors change prices manually. On Worten, multiple active repricers compete on the same SKUs. Without Tier 2a:
  >
  > - **T=0:** customer in 2nd place. Tier 1 cadence (15 min).
  > - **T=15:** tool undercuts. Customer wins 1st. SKU moves to Tier 2.
  > - **T=20:** competitor's automated repricer detects the move and undercuts by €0.01. Customer in 2nd again.
  > - **T=20 → T=135:** 115 minutes of invisible loss. Engine doesn't check this SKU until next Tier 2 cycle (2h after entering Tier 2).
  > - **T=135:** engine notices, moves SKU back to Tier 1, undercuts again at next Tier 1 tick.
  >
  > In a contested catalog with hundreds of SKUs and multiple active repricers, this becomes oscillation: brief 1st-place wins followed by long invisibility. The customer's "SKUs in 1st place" KPI is unstable; the dashboard says one thing while Worten says another. Tier 2a closes this blind window.

- **FR19:** The engine handles tier transitions:
  - Tier 1 → Tier 2a on winning 1st place (action: set `last_won_at = now()`).
  - Tier 2a → Tier 2b after 4 hours have elapsed since `last_won_at` (no DB write needed; classification is recomputed at the next cycle when the cadence threshold check runs).
  - Any of {Tier 2, Tier 2a, Tier 2b} → Tier 1 on losing 1st place (last_won_at preserved as the most recent win, useful for analytics).
  - Tier 3 → Tier 1 or Tier 2a on a new competitor entering (if already at 1st place AND price still beats the new competitor → Tier 2a with `last_won_at = now()`; otherwise → Tier 1).
- **FR20:** The engine reads competitor offer data per SKU via Mirakl P11, ranking competitors by `total_price` (price + shipping) and filtering to active offers only.
- **FR21:** The engine computes per-SKU floor (`list_price × (1 - max_discount_pct)`) and ceiling (`list_price × (1 + max_increase_pct)`), and only pushes prices within that band.
- **FR22:** When an external entity changes the `current_price` between cycles, the engine treats the change as new pricing intent and updates `list_price` to match (cooperative ERP-sync), rather than overwriting the change.
- **FR23:** The engine writes price updates via PRI01 only (never OF24), polls PRI02 until COMPLETE or FAILED, and only updates `last_set_price` after PRI02 confirms COMPLETE.
- **FR24:** The engine handles the documented decision-table cases (tie cases, leader-is-self, all-competitors-above-ceiling, two-repricer-conflict, single-channel offer, single-competitor) per the rules enumerated in §Domain-Specific Requirements.
- **FR25:** Engine repricing is per-channel for Worten PT vs Worten ES, with margin tolerance configured globally per customer at MVP (per-channel margin overrides reserved for Epic 2).

### D. Engine Safety & Customer Controls

- **FR26:** The system enforces an outbound circuit breaker that halts a cycle if more than 20% of the customer's catalog would be repriced in that cycle, OR if any single SKU's price would move by more than 15%.
- **FR27:** When the circuit breaker trips, the system freezes the cycle, alerts the customer, and requires manual review/unblock before resuming.
- **FR28:** The system performs a nightly reconciliation pass (implemented as Tier 3's daily cycle) that re-scans all products, re-classifies tiers, and self-heals stale state.
- **FR29:** When the system detects an external price change with deviation greater than 40% from the previous `list_price`, it freezes that SKU's repricing and surfaces a review/confirm-or-reject UI to the customer.
- **FR30:** Customers can run the engine in dry-run mode by default (simulates price decisions, logs would-have-done events to the audit log, does not push to Mirakl) for as long as they want before going live.
- **FR31:** Customers can flip Go-Live for active repricing only after viewing and accepting an informed-consent modal containing conditional language about how many products may be repriced and within what margin tolerance.
- **FR32:** Customers can pause and resume active repricing with a single click each; pause freezes the cron and leaves current Worten prices at their last-set state (no rollback at MVP); resume reactivates the cron from the paused state.
- **FR33:** The system retains the pre-tool baseline pricing snapshot captured during initial scan, enabling Epic 2 "restore baseline" without data archaeology.

### E. Dashboard & Audit Log

- **FR34:** Customers can view a dashboard with KPI cards using the same categories as the free report (SKUs in 1st place, SKUs losing position, SKUs exclusive / Tier 3, total catalog value at risk).
- **FR35:** Customers can toggle between Worten PT and Worten ES channels, with the dashboard reflecting per-channel state.
- **FR36:** Customers can edit `max_discount_pct` and `max_increase_pct` via a margin editor that displays a worked-profit-example using a representative SKU from their catalog, with the example updating live as values change.
- **FR37:** Customers can view a per-customer-per-channel audit log of every engine action with timestamp, competitor context (price, shop name, ranking position), engine decision rationale (undercut / ceiling raise / hold), tolerance band (floor/ceiling), tier classification, and PRI01/PRI02 lifecycle status.
- **FR38:** Customers can filter the audit log by channel, SKU/EAN, and event type (with external-change-absorbed and circuit-breaker-trip events tagged distinctly).
- **FR38b:** The audit log UI uses hierarchical summarization, not a flat chronological feed. Default presentation has four surfaces:
  1. **Daily-summary stats card at the top** — aggregate counts (price changes, holds, external-change-absorbed events, anomaly-frozen SKUs) and position deltas vs prior day. The customer's daily glance.
  2. **"A precisar de atenção" feed** — events requiring customer decision (anomaly-freeze, circuit-breaker-trip, mid-life key revocation, persistent PRI01 failures, payment-failure-pause). Steady state: 0-2 entries per day.
  3. **"Eventos notáveis" feed** — moderate-frequency events of customer interest but not requiring action (external-change-absorbed, position-won, position-lost, new-competitor-entered, large-price-move within tolerance). Capped with "Ver todos" link. Steady state: 5-30 entries per day.
  4. **Search by SKU/EAN as the primary investigation primitive** — pulls all events for a single product chronologically. Bounded by product, always readable.

  Routine repricing churn (undercut decisions, ceiling raises, holds, cycle-start/end events) is hidden by default and accessible only via a "Mostrar todos os ajustes" filter. Volume math: a 50k-SKU contested catalog produces 100-500 price changes per 15-min Tier 1 cycle (~10k-50k entries/day, ~3M entries/quarter); naive flat chronological feeds are unusable at this volume.
- **FR38c:** When the customer activates the "Mostrar todos os ajustes" (firehose) filter, events are presented grouped by cycle, not flat chronologically — one row per cycle showing aggregate counts (e.g., "03:14 cycle: 43 undercuts, 4 raises, 12 holds, 0 failures") with per-SKU detail expandable on click. Cycle-aggregated presentation keeps the firehose digestible at high event volumes.
- **FR38d:** Audit log event types are classified at three priority levels that drive default surfacing:
  - **"Atenção"** (always shown in FR38b surface 2) — anomaly-freeze, circuit-breaker-trip, key-validation-fail (mid-life revocation), persistent PRI01-fail, payment-failure-pause.
  - **"Notável"** (capped feed in FR38b surface 3) — external-change-absorbed, position-won, position-lost, new-competitor-entered, large-price-move-within-tolerance, customer-paused, customer-resumed.
  - **"Rotina"** (hidden by default; visible only via firehose filter per FR38c) — undercut-decision, ceiling-raise-decision, hold-floor-bound, hold-already-in-1st, cycle-start, cycle-end, PRI01-submit, PRI02-complete, scan-progress.

  The full event-type taxonomy with priority classification is enumerated in the UX skeleton ([_bmad-output/planning-artifacts/ux-skeleton.md](_bmad-output/planning-artifacts/ux-skeleton.md)) and is the canonical reference. PRD-level commitment is that the classification exists and drives default UI surfacing.
- **FR39:** The dashboard surfaces a Portuguese-localized banner during sustained transient issues (e.g., Mirakl outages), informing the customer that no new price actions are running until conditions stabilize.

### F. Subscription & Billing

- **FR40:** Customers can start a recurring monthly Stripe subscription upon clicking Go-Live, billed at €50 per marketplace per month with no setup fee.
- **FR41 (MVP):** Customers operate a single marketplace at MVP (Worten — both PT and ES channels under one shop API key). Adding additional marketplaces is concierge-only at MVP: the customer emails the founder, who manually configures the second marketplace's shop API key in admin tooling, adds the Stripe line item, and handles the next Moloni invoice for the combined payment. There is no "Add Marketplace" UI in the customer dashboard at MVP.
- **FR41 (Epic 2):** Customers can self-serve add or remove marketplaces from their subscription via dashboard UI. Additions appear as new line items on the next billing cycle (Stripe proration); removals end the line item at the end of the current billing cycle with no mid-cycle refund.
- **FR42:** Customers can request a first-month money-back guarantee within 14 days of Go-Live, no questions asked.
- **FR43:** The system handles failed payments via Stripe-managed dunning at MVP; on final failure, the subscription auto-cancels, the cron flips paused, and prices remain at their last-set state until the customer re-enters payment details.
- **FR44:** Founder admin can generate manual Moloni invoices per Stripe payment with PT NIF/IVA compliance, recording invoice metadata against the customer account.

### G. Operations & Alerting

- **FR45:** The system exposes a `/health` endpoint pinged by external uptime monitoring at 5-minute cadence, with failure triggering founder email alerts.
- **FR46:** The system implements a 3-tier failure model: transient errors retry with exponential backoff within cycle; per-SKU operational failures log per-SKU and continue the cycle; critical errors (auth invalid, sustained outage, anomaly freeze, circuit-breaker trip) freeze the customer's repricing and trigger immediate email + dashboard banner.
- **FR47:** Founder admin can view an internal monitoring dashboard (not customer-facing) showing cross-customer audit-log tail, uptime status, and circuit-breaker state.
- **FR48:** The system delivers critical-tier alerts to customers via email within 5 minutes of event detection.

(Operational commitments — rollback playbook, solo-founder continuity runbook, Day-1 active-monitoring protocol — are documented in §Non-Functional Requirements as operational quality attributes.)

## Non-Functional Requirements

These NFRs specify HOW WELL the system must perform. Only categories that materially apply to MarketPilot are documented; categories that don't apply (real-time-safety, AI/ML accuracy, etc.) are deliberately omitted to prevent requirement bloat.

### Performance

- **NFR-P1:** Engine **Tier 1** cycle latency p95 ≤ 18 min (15-min nominal cadence with allowance for retries/backoff). Measured: cycle-end timestamp minus cycle-start timestamp, p95 across all customers' Tier 1 SKUs over 7-day rolling window.
- **NFR-P2:** Engine **Tier 2a** cycle latency p95 ≤ 18 min (Tier 2a uses the same close cadence as Tier 1 to protect against active-repricer undercut markets — this latency target must match Tier 1, NOT Tier 2b).
- **NFR-P3:** Engine **Tier 2b** cycle latency p95 ≤ 75 min (60-min nominal cadence with allowance).
- **NFR-P4:** Engine **Tier 3** cycle latency p95 ≤ 28 hours (daily nominal with allowance; the daily pass also serves as nightly reconciliation per FR28).
- **NFR-P5:** PRI01 → PRI02 resolution within 30 min from PRI01 submission to PRI02 COMPLETE or FAILED. Stuck-WAITING SKUs ≥30 min trip a critical alert per FR46.
- **NFR-P6:** Inline API key validation completes within 5 seconds (worst case) on the customer's key-entry submission.
- **NFR-P7:** Customer dashboard initial render ≤2s on broadband, ≤4s on 3G mobile.
- **NFR-P8:** Audit log filtering responds within 2s for the default 90-day window (longer windows deferred to Epic 2 historical-analytics work).
- **NFR-P9:** Critical alert delivery latency ≤5 min from event detection to customer email (per FR48).
- **NFR-P10:** Catalog scan throughput target: 50k SKUs scanned within 4 hours assuming Mirakl rate-limit budget supports ~10 concurrent calls × 200ms. UNVERIFIED — ARCH must confirm via Mirakl MCP and re-derive this target if the budget is tighter than assumed.

### Security

- **NFR-S1:** All customer Mirakl shop API keys encrypted at rest using a KMS-managed key. Founder cannot view cleartext key material; application logs never contain cleartext key material. Verified pre-launch via security review and ongoing via DB-dump scans.
- **NFR-S2:** All HTTP traffic between customer browser and `app.marketpilot.pt` uses TLS 1.2+ (no plaintext HTTP). Internal traffic between Hetzner-hosted Fastify and Supabase Cloud uses TLS.
- **NFR-S3:** Multi-tenant data isolation enforced at the Postgres layer via RLS policies on every customer-scoped table. Service-role-key usage limited to repricer-worker and operator-only admin endpoints; never exposed to client. RLS regressions blocked via test suite that runs on every deploy.
- **NFR-S4:** Stripe webhooks signed and verified per Stripe docs; replay attacks prevented via webhook timestamp validation.
- **NFR-S5:** Authentication uses Supabase Auth defaults (bcrypt hashing, secure session cookies, email verification). Password reset flows are email-verified per FR3.
- **NFR-S6:** Audit log entries are append-only at the application layer; no admin UI to delete or edit audit log records (deletion only via the documented GDPR Art 17 workflow per FR4). This is the legal/trust property — preserved at MVP independent of durability tier.
- **NFR-S7:** Stripe customer/subscription data: MarketPilot stores only Stripe customer IDs and subscription IDs — no card data, no PAN, no full bank details (Stripe handles all PCI-DSS scope, MarketPilot is out of PCI scope by design — locking this scope ceiling prevents future feature creep into PCI scope without explicit decision).

### Scalability

- **NFR-Sc1:** System designed for 5-10 concurrent customer accounts at MVP, scaling to 50 concurrent accounts in Epic 2 without architectural rework. Per-customer state in Supabase Postgres scales linearly with customer count.
- **NFR-Sc2:** Per-customer catalog scale: 50k SKUs at MVP with assumed Mirakl rate-limit headroom. 100k+ SKU catalogs (e.g., Twomii @ 100k+) require ARCH-confirmed cadence ceiling and may use relaxed Tier 1 / Tier 2a cadence per the per-SKU `tier_cadence_minutes` model (per FR17/FR18).
- **NFR-Sc3:** Cron scheduling pattern (single cron polling every 5 min, per-SKU cadence column per FR18) supports horizontal scale: additional worker instances can poll the same SKU table without coordination overhead via advisory-lock-or-similar pattern. ARCH spec mandatory before second worker.
- **NFR-Sc4:** Resend free tier (3k emails/mo) sized for ~10 customers × 2-3 critical alerts per month each. Tier upgrade triggered when customer count or alert rate exceeds free-tier budget; migration is configuration-only.
- **NFR-Sc5:** Supabase Cloud free tier sized for MVP catalog scale (DB size + compute utilization). Paid-tier migration triggered by free-tier exhaustion; migration is configuration-only.

### Reliability & Availability

- **NFR-R1:** `/health` endpoint ≥99% uptime measured by UptimeRobot 5-min pings over 30-day rolling window (per FR45). Below threshold triggers founder email alert.
- **NFR-R2:** Recovery Time Objective (RTO) for application service: 30 minutes from critical alert to customer-facing action per the documented rollback playbook (NFR-O1).
- **NFR-R3:** Recovery Point Objective (RPO) for customer data, including audit log, is ≤24 hours via Supabase Cloud daily backups. Audit log durability matches the rest of customer state at MVP. Audit-log-specific higher-durability (synchronous replication, external streaming append-only log) is Epic 2 only if first-cohort customers report gap incidents. The append-only semantics requirement (no admin UI for delete/edit per NFR-S6) is preserved at MVP — the legal/trust property is independent of the durability tier.
- **NFR-R4:** 3-tier failure model (per FR46): transient errors retry within cycle; per-SKU operational failures log + retry next cycle; critical errors freeze customer's repricing immediately. No silent failures permitted.
- **NFR-R5:** Customer impact during external dependency outages (Mirakl, Stripe, Supabase): customer-facing dashboard remains accessible; engine pauses gracefully; customer receives Portuguese-localized banner notification within 3 cycles of sustained outage detection (per FR39).

### Integration Quality

- **NFR-I1:** Mirakl MMP integration: rate-limit budget verified via MCP per ARCH; cadence pacing baked into design pre-launch; PRI01 → PRI02 polling resilient to transient failures (exponential backoff).
- **NFR-I2:** Stripe integration: idempotency keys used on subscription mutations; webhook handler idempotent (same webhook event ID processed once); subscription state always reconcilable from Stripe API as source of truth.
- **NFR-I3:** Supabase Auth + RLS integration: RLS policies tested with deliberate cross-tenant access attempts pre-launch; policy regressions blocked via test suite that runs on every deploy (overlaps NFR-S3 — same control, two angles).
- **NFR-I4:** Resend integration: critical-alert emails use templated content with conditional Portuguese localization; delivery failures logged and surfaced in founder monitoring dashboard.
- **NFR-I5:** UptimeRobot integration: monitor configured for `/health` 5-min cadence; failure alert routed to founder email (not customer-facing).
- **NFR-I6:** Cross-repo handoff with DynamicPriceIdea: signup form accepts source-context query parameters per FR7; no shared schema, no shared DB, no shared deployment pipeline (deliberate isolation due to different security postures — free report stores no key, repricer encrypts keys).

### Accessibility

- **NFR-A1:** Customer dashboard meets WCAG 2.1 AA practical baseline at MVP (sufficient color contrast, keyboard navigability, semantic HTML, alt text for icons). Formal WCAG audit deferred until a B2B procurement-conscious customer demands it (likely Epic 2 cohort).
- **NFR-A2:** Critical-action confirmations (Go-Live consent modal, Pause/Resume) accessible via keyboard without mouse interaction.
- **NFR-A3:** Audit log content readable by screen readers (proper table semantics or ARIA roles); audit log is the highest-leverage transparency surface and accessibility regression here is a trust regression.

### Localization

- **NFR-L1:** Customer-facing UI defaults to Portuguese (PT). All conditional copy (banners, modals, validation messages, smart-default warnings, KPI card labels, audit-log event-type labels) is Portuguese-localized.
- **NFR-L2:** Spanish (ES) UI localization is NOT in MVP. Worten ES customers see Portuguese UI chrome; the channel toggle reflects ES competitive landscape but UI labels remain Portuguese. ES UI localization (and ES email templates) is an Epic 2 trigger when a primary-ES customer signs up.

### Operational Quality Attributes

These document founder-side operational commitments tied to product surfaces. They are NFRs rather than FRs because they describe HOW WELL operational support is delivered, not WHAT customer-facing capabilities exist.

- **NFR-O1:** Founder admin maintains a documented rollback playbook with a 30-minute response target from critical alert to customer-facing action (triage → alert customer → diagnose → fix or revert). Playbook drafted before customer #1.
- **NFR-O2:** Founder admin maintains a 1-page solo-founder continuity runbook covering laptop loss, hospitalization, and extended absence scenarios. Drafted before customer #1.
- **NFR-O3:** Founder admin runs a documented Day-1 active-monitoring protocol for the first 24 hours post-Go-Live per customer (audit-log tail + uptime status). 2-hour response SLA during the customer's launch week. Day-3 and day-7 pulse-check outreach via call or email.
- **NFR-O4:** Founder admin generates manual Moloni invoices per Stripe payment within 24 hours of billing, target ≤10 minutes per invoice. Aggregate exceeding 2-3 hr/month triggers Epic 2 Moloni API integration (per FR40 Phase 2 trigger).
